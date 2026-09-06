// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DemoSeed } from "../src/DemoSeed.sol";
import { MockERC20 } from "../src/MockERC20.sol";
import { ParamShieldBootstrap } from "../src/ParamShieldBootstrap.sol";
import { ParamShieldExecutor } from "../src/ParamShieldExecutor.sol";
import { ReferenceLendingMarket } from "../src/ReferenceLendingMarket.sol";
import { TestBase } from "./TestBase.sol";

contract ParamShieldBootstrapTest is TestBase {
    address private constant DEPLOYER = address(0xD3E10);

    ParamShieldBootstrap private bootstrap;
    MockERC20 private collateralToken;
    MockERC20 private debtToken;
    ReferenceLendingMarket private market;
    ParamShieldExecutor private executor;

    function setUp() public {
        VM.prank(DEPLOYER);
        bootstrap = new ParamShieldBootstrap();

        collateralToken = bootstrap.collateralToken();
        debtToken = bootstrap.debtToken();
        market = bootstrap.market();
        executor = bootstrap.executor();
    }

    function testDeploysExpectedOwnershipAndRoles() public view {
        assertEq(collateralToken.owner(), DEPLOYER, "collateral token owner mismatch");
        assertEq(debtToken.owner(), DEPLOYER, "debt token owner mismatch");
        assertEq(market.owner(), address(executor), "market is not gated by executor");
        assertEq(executor.admin(), DEPLOYER, "admin mismatch");
        assertEq(executor.operator(), DEPLOYER, "operator mismatch");
        assertEq(executor.decisionAuthority(), DEPLOYER, "decision authority mismatch");
        assertTrue(
            executor.allowedCalls(address(market), executor.SET_LIQUIDATION_THRESHOLD_SELECTOR()),
            "threshold call was not allowlisted"
        );
    }

    function testSeedsCanonicalMarketState() public view {
        assertEq(
            market.collateralPriceUsdE18(),
            bootstrap.INITIAL_COLLATERAL_PRICE_USD_E18(),
            "initial price mismatch"
        );
        assertEq(
            market.liquidationThresholdBps(),
            bootstrap.INITIAL_LIQUIDATION_THRESHOLD_BPS(),
            "initial threshold mismatch"
        );
        assertEq(market.totalCollateral(), DemoSeed.totalCollateral(), "collateral total mismatch");
        assertEq(market.totalDebt(), DemoSeed.totalDebt(), "debt total mismatch");
        assertEq(
            collateralToken.balanceOf(address(market)),
            DemoSeed.totalCollateral(),
            "market collateral balance mismatch"
        );
        assertEq(
            debtToken.balanceOf(address(market)),
            bootstrap.INITIAL_DEBT_LIQUIDITY() - DemoSeed.totalDebt(),
            "market debt liquidity mismatch"
        );

        for (uint256 i; i < DemoSeed.POSITION_COUNT; ++i) {
            (address account, uint256 collateralAmount, uint256 debtAmount) = DemoSeed.positionAt(i);
            (uint256 actualCollateral, uint256 actualDebt) = market.positions(account);

            assertEq(actualCollateral, collateralAmount, "position collateral mismatch");
            assertEq(actualDebt, debtAmount, "position debt mismatch");
            assertEq(debtToken.balanceOf(account), debtAmount, "borrower balance mismatch");
            assertTrue(market.healthFactor(account) >= 1e18, "seeded position is unhealthy");
        }
    }
}
