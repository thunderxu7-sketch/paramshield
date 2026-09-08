// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DemoSeed } from "./DemoSeed.sol";
import { MockERC20 } from "./MockERC20.sol";
import { ParamShieldExecutor } from "./ParamShieldExecutor.sol";
import { ReferenceLendingMarket } from "./ReferenceLendingMarket.sol";

/// @notice A separate v2 bootstrap; never overwrites the historical v1 deployment.
contract ParamShieldBootstrapV2 {
    error InvalidRoles();
    error WrongDeployer();

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
        address indexed operator,
        address indexed decisionAuthority,
        address market,
        address executor
    );

    constructor(address admin, address operator, address authority) {
        if (
            admin == address(0) || operator == address(0) || authority == address(0)
                || admin == operator || admin == authority || operator == authority
        ) revert InvalidRoles();
        if (msg.sender != admin) revert WrongDeployer();
        collateralToken = new MockERC20("Mock Ether", "mETH", 18, address(this));
        debtToken = new MockERC20("Mock USD Coin", "mUSDC", 6, address(this));
        market = new ReferenceLendingMarket(
            address(collateralToken), 18, address(debtToken), 6, 2_000e18, 8_000, address(this)
        );
        collateralToken.mint(address(market), DemoSeed.totalCollateral());
        debtToken.mint(address(market), 1_000_000e6);
        for (uint256 i; i < DemoSeed.POSITION_COUNT; ++i) {
            (address account, uint256 collateral, uint256 debt) = DemoSeed.positionAt(i);
            market.seedPosition(account, collateral, debt);
        }
        executor = new ParamShieldExecutor(admin, operator, authority, address(market));
        market.transferOwnership(address(executor));
        collateralToken.transferOwnership(admin);
        debtToken.transferOwnership(admin);
        emit DeploymentCompleted(admin, operator, authority, address(market), address(executor));
    }
}
