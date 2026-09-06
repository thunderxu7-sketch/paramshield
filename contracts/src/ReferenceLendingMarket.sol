// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Deterministic ETH-collateral/USDC-debt market used by the ParamShield demo.
/// @dev This intentionally small reference market is not intended for production deposits.
contract ReferenceLendingMarket {
    error AlreadySeeded();
    error InsufficientLiquidity();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidLiquidationThreshold();
    error InvalidPrice();
    error NotOwner();
    error TransferFailed();
    error UnhealthyPosition();

    uint16 public constant BPS = 10_000;
    uint16 public constant MIN_LIQUIDATION_THRESHOLD_BPS = 5_000;
    uint16 public constant MAX_LIQUIDATION_THRESHOLD_BPS = 9_500;
    uint256 public constant WAD = 1e18;

    struct Position {
        uint256 collateralAmount;
        uint256 debtAmount;
    }

    IERC20Like public immutable collateralToken;
    IERC20Like public immutable debtToken;
    uint256 public immutable collateralScale;
    uint256 public immutable debtScale;

    address public owner;
    uint16 public liquidationThresholdBps;
    uint256 public collateralPriceUsdE18;
    uint256 public totalCollateral;
    uint256 public totalDebt;

    mapping(address account => Position position) public positions;

    event CollateralDeposited(address indexed account, uint256 amount);
    event CollateralPriceUpdated(
        uint256 previousPriceUsdE18, uint256 newPriceUsdE18, address indexed operator
    );
    event DebtBorrowed(address indexed account, uint256 amount);
    event DebtRepaid(address indexed account, uint256 amount);
    event LiquidationThresholdUpdated(
        uint16 previousThresholdBps, uint16 newThresholdBps, address indexed operator
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PositionSeeded(
        address indexed account,
        uint256 collateralAmount,
        uint256 debtAmount,
        uint256 healthFactorE18
    );
    event PositionUpdated(
        address indexed account,
        uint256 collateralAmount,
        uint256 debtAmount,
        uint256 healthFactorE18
    );
    event CollateralWithdrawn(address indexed account, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address collateralToken_,
        uint8 collateralDecimals_,
        address debtToken_,
        uint8 debtDecimals_,
        uint256 collateralPriceUsdE18_,
        uint16 liquidationThresholdBps_,
        address owner_
    ) {
        if (collateralToken_ == address(0) || debtToken_ == address(0) || owner_ == address(0)) {
            revert InvalidAddress();
        }
        if (collateralDecimals_ > 18 || debtDecimals_ > 18) revert InvalidAmount();
        _validatePrice(collateralPriceUsdE18_);
        _validateLiquidationThreshold(liquidationThresholdBps_);

        collateralToken = IERC20Like(collateralToken_);
        debtToken = IERC20Like(debtToken_);
        collateralScale = 10 ** collateralDecimals_;
        debtScale = 10 ** debtDecimals_;
        collateralPriceUsdE18 = collateralPriceUsdE18_;
        liquidationThresholdBps = liquidationThresholdBps_;
        owner = owner_;

        emit OwnershipTransferred(address(0), owner_);
    }

    function depositCollateral(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        _safeTransferFrom(collateralToken, msg.sender, address(this), amount);

        Position storage position = positions[msg.sender];
        position.collateralAmount += amount;
        totalCollateral += amount;

        emit CollateralDeposited(msg.sender, amount);
        _emitPosition(msg.sender, position);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (debtToken.balanceOf(address(this)) < amount) revert InsufficientLiquidity();

        Position storage position = positions[msg.sender];
        position.debtAmount += amount;
        totalDebt += amount;

        if (_healthFactor(position, liquidationThresholdBps, collateralPriceUsdE18) < WAD) {
            revert UnhealthyPosition();
        }

        _safeTransfer(debtToken, msg.sender, amount);
        emit DebtBorrowed(msg.sender, amount);
        _emitPosition(msg.sender, position);
    }

    function repay(uint256 amount) external {
        Position storage position = positions[msg.sender];
        if (amount == 0 || amount > position.debtAmount) revert InvalidAmount();

        _safeTransferFrom(debtToken, msg.sender, address(this), amount);
        unchecked {
            position.debtAmount -= amount;
            totalDebt -= amount;
        }

        emit DebtRepaid(msg.sender, amount);
        _emitPosition(msg.sender, position);
    }

    function withdrawCollateral(uint256 amount) external {
        Position storage position = positions[msg.sender];
        if (amount == 0 || amount > position.collateralAmount) revert InvalidAmount();

        unchecked {
            position.collateralAmount -= amount;
            totalCollateral -= amount;
        }
        if (_healthFactor(position, liquidationThresholdBps, collateralPriceUsdE18) < WAD) {
            revert UnhealthyPosition();
        }

        _safeTransfer(collateralToken, msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
        _emitPosition(msg.sender, position);
    }

    /// @notice Adds a deterministic demo position from prefunded market balances.
    function seedPosition(address account, uint256 collateralAmount, uint256 debtAmount)
        external
        onlyOwner
    {
        if (account == address(0)) revert InvalidAddress();
        if (collateralAmount == 0 || debtAmount == 0) revert InvalidAmount();
        Position storage position = positions[account];
        if (position.collateralAmount != 0 || position.debtAmount != 0) revert AlreadySeeded();
        if (collateralToken.balanceOf(address(this)) < totalCollateral + collateralAmount) {
            revert InsufficientLiquidity();
        }
        if (debtToken.balanceOf(address(this)) < debtAmount) revert InsufficientLiquidity();

        position.collateralAmount = collateralAmount;
        position.debtAmount = debtAmount;
        totalCollateral += collateralAmount;
        totalDebt += debtAmount;

        uint256 healthFactorE18 =
            _healthFactor(position, liquidationThresholdBps, collateralPriceUsdE18);
        if (healthFactorE18 < WAD) revert UnhealthyPosition();

        _safeTransfer(debtToken, account, debtAmount);
        emit PositionSeeded(account, collateralAmount, debtAmount, healthFactorE18);
        emit PositionUpdated(account, collateralAmount, debtAmount, healthFactorE18);
    }

    function setLiquidationThresholdBps(uint16 newThresholdBps) external onlyOwner {
        _validateLiquidationThreshold(newThresholdBps);

        uint16 previousThresholdBps = liquidationThresholdBps;
        liquidationThresholdBps = newThresholdBps;
        emit LiquidationThresholdUpdated(previousThresholdBps, newThresholdBps, msg.sender);
    }

    function setCollateralPriceUsdE18(uint256 newPriceUsdE18) external onlyOwner {
        _validatePrice(newPriceUsdE18);

        uint256 previousPriceUsdE18 = collateralPriceUsdE18;
        collateralPriceUsdE18 = newPriceUsdE18;
        emit CollateralPriceUpdated(previousPriceUsdE18, newPriceUsdE18, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function healthFactor(address account) external view returns (uint256) {
        return _healthFactor(positions[account], liquidationThresholdBps, collateralPriceUsdE18);
    }

    function previewHealthFactor(address account, uint16 thresholdBps, uint256 priceUsdE18)
        external
        view
        returns (uint256)
    {
        _validateLiquidationThreshold(thresholdBps);
        _validatePrice(priceUsdE18);
        return _healthFactor(positions[account], thresholdBps, priceUsdE18);
    }

    function collateralValueUsdE18(address account) external view returns (uint256) {
        return _collateralValueUsdE18(positions[account].collateralAmount, collateralPriceUsdE18);
    }

    function debtValueUsdE18(address account) external view returns (uint256) {
        return _debtValueUsdE18(positions[account].debtAmount);
    }

    function _healthFactor(Position memory position, uint16 thresholdBps, uint256 priceUsdE18)
        internal
        view
        returns (uint256)
    {
        if (position.debtAmount == 0) return type(uint256).max;

        uint256 collateralValue = _collateralValueUsdE18(position.collateralAmount, priceUsdE18);
        uint256 debtValue = _debtValueUsdE18(position.debtAmount);
        uint256 adjustedCollateral = collateralValue * thresholdBps / BPS;
        return adjustedCollateral * WAD / debtValue;
    }

    function _collateralValueUsdE18(uint256 collateralAmount, uint256 priceUsdE18)
        internal
        view
        returns (uint256)
    {
        return collateralAmount * priceUsdE18 / collateralScale;
    }

    function _debtValueUsdE18(uint256 debtAmount) internal view returns (uint256) {
        return debtAmount * WAD / debtScale;
    }

    function _emitPosition(address account, Position memory position) internal {
        emit PositionUpdated(
            account,
            position.collateralAmount,
            position.debtAmount,
            _healthFactor(position, liquidationThresholdBps, collateralPriceUsdE18)
        );
    }

    function _safeTransfer(IERC20Like token, address to, uint256 amount) internal {
        try token.transfer(to, amount) returns (bool success) {
            if (!success) revert TransferFailed();
        } catch {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(IERC20Like token, address from, address to, uint256 amount)
        internal
    {
        try token.transferFrom(from, to, amount) returns (bool success) {
            if (!success) revert TransferFailed();
        } catch {
            revert TransferFailed();
        }
    }

    function _validateLiquidationThreshold(uint16 thresholdBps) internal pure {
        if (
            thresholdBps < MIN_LIQUIDATION_THRESHOLD_BPS
                || thresholdBps > MAX_LIQUIDATION_THRESHOLD_BPS
        ) revert InvalidLiquidationThreshold();
    }

    function _validatePrice(uint256 priceUsdE18) internal pure {
        if (priceUsdE18 == 0) revert InvalidPrice();
    }
}
