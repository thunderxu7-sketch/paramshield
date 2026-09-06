// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DemoSeed } from "./DemoSeed.sol";
import { MockERC20 } from "./MockERC20.sol";
import { ParamShieldExecutor } from "./ParamShieldExecutor.sol";
import { ReferenceLendingMarket } from "./ReferenceLendingMarket.sol";

/// @notice Deploys and seeds the complete Phase 1 ParamShield demo in one transaction.
/// @dev The caller temporarily receives every privileged role for the testnet prototype.
contract ParamShieldBootstrap {
    uint256 public constant INITIAL_COLLATERAL_PRICE_USD_E18 = 2_000e18;
    uint16 public constant INITIAL_LIQUIDATION_THRESHOLD_BPS = 8_000;
    uint256 public constant INITIAL_DEBT_LIQUIDITY = 1_000_000e6;

    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    MockERC20 public immutable collateralToken;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    MockERC20 public immutable debtToken;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    ReferenceLendingMarket public immutable market;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    ParamShieldExecutor public immutable executor;

    event DeploymentCompleted(
        address indexed admin,
        address indexed collateralToken,
        address indexed debtToken,
        address market,
        address executor
    );

    constructor() {
        address deployer = msg.sender;

        MockERC20 collateral = new MockERC20("Mock Ether", "mETH", 18, address(this));
        MockERC20 debt = new MockERC20("Mock USD Coin", "mUSDC", 6, address(this));
        ReferenceLendingMarket referenceMarket = new ReferenceLendingMarket(
            address(collateral),
            18,
            address(debt),
            6,
            INITIAL_COLLATERAL_PRICE_USD_E18,
            INITIAL_LIQUIDATION_THRESHOLD_BPS,
            address(this)
        );

        collateral.mint(address(referenceMarket), DemoSeed.totalCollateral());
        debt.mint(address(referenceMarket), INITIAL_DEBT_LIQUIDITY);

        for (uint256 i; i < DemoSeed.POSITION_COUNT; ++i) {
            (address account, uint256 collateralAmount, uint256 debtAmount) = DemoSeed.positionAt(i);
            referenceMarket.seedPosition(account, collateralAmount, debtAmount);
        }

        ParamShieldExecutor executionGate =
            new ParamShieldExecutor(deployer, deployer, deployer, address(referenceMarket));
        referenceMarket.transferOwnership(address(executionGate));
        collateral.transferOwnership(deployer);
        debt.transferOwnership(deployer);

        collateralToken = collateral;
        debtToken = debt;
        market = referenceMarket;
        executor = executionGate;

        emit DeploymentCompleted(
            deployer,
            address(collateral),
            address(debt),
            address(referenceMarket),
            address(executionGate)
        );
    }
}
