// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DemoSeed } from "../src/DemoSeed.sol";
import { MockERC20 } from "../src/MockERC20.sol";
import { ReferenceLendingMarket } from "../src/ReferenceLendingMarket.sol";
import { TestBase } from "./TestBase.sol";

contract ReferenceLendingMarketTest is TestBase {
    uint256 private constant INITIAL_PRICE = 2_000e18;
    uint16 private constant INITIAL_THRESHOLD = 8_000;

    address private constant ALICE = address(0xA11CE);

    MockERC20 private collateralToken;
    MockERC20 private debtToken;
    ReferenceLendingMarket private market;

    function setUp() public {
        collateralToken = new MockERC20("Mock Ether", "mETH", 18, address(this));
        debtToken = new MockERC20("Mock USD Coin", "mUSDC", 6, address(this));
        market = new ReferenceLendingMarket(
            address(collateralToken),
            18,
            address(debtToken),
            6,
            INITIAL_PRICE,
            INITIAL_THRESHOLD,
            address(this)
        );

        collateralToken.mint(ALICE, 20 ether);
        debtToken.mint(address(market), 1_000_000e6);
    }

    function testDepositAndBorrowTracksHealthyPosition() public {
        VM.startPrank(ALICE);
        collateralToken.approve(address(market), 10 ether);
        market.depositCollateral(10 ether);
        market.borrow(15_000e6);
        VM.stopPrank();

        (uint256 collateralAmount, uint256 debtAmount) = market.positions(ALICE);
        assertEq(collateralAmount, 10 ether, "wrong collateral");
        assertEq(debtAmount, 15_000e6, "wrong debt");
        assertEq(debtToken.balanceOf(ALICE), 15_000e6, "borrower did not receive debt token");
        assertEq(market.healthFactor(ALICE), 1_066_666_666_666_666_666, "wrong health factor");
    }

    function testBorrowFailsClosedBelowOneHealthFactor() public {
        VM.startPrank(ALICE);
        collateralToken.approve(address(market), 10 ether);
        market.depositCollateral(10 ether);

        VM.expectRevert(ReferenceLendingMarket.UnhealthyPosition.selector);
        market.borrow(16_000e6 + 1);
        VM.stopPrank();

        (, uint256 debtAmount) = market.positions(ALICE);
        assertEq(debtAmount, 0, "reverted debt should not persist");
    }

    function testWithdrawFailsClosedWhenItWouldBreakHealthFactor() public {
        VM.startPrank(ALICE);
        collateralToken.approve(address(market), 10 ether);
        market.depositCollateral(10 ether);
        market.borrow(15_000e6);

        VM.expectRevert(ReferenceLendingMarket.UnhealthyPosition.selector);
        market.withdrawCollateral(1 ether);
        VM.stopPrank();

        (uint256 collateralAmount,) = market.positions(ALICE);
        assertEq(collateralAmount, 10 ether, "reverted withdrawal should not persist");
    }

    function testLowerThresholdMakesSensitivePositionLiquidatable() public {
        _prefundAndSeedOne(DemoSeed.LT_SENSITIVE, 10 ether, 15_000e6);

        assertTrue(market.healthFactor(DemoSeed.LT_SENSITIVE) > 1e18, "position starts unsafe");
        assertTrue(
            market.previewHealthFactor(DemoSeed.LT_SENSITIVE, 7_000, INITIAL_PRICE) < 1e18,
            "70 percent threshold should liquidate position"
        );

        market.setLiquidationThresholdBps(7_000);
        assertTrue(market.healthFactor(DemoSeed.LT_SENSITIVE) < 1e18, "position stayed healthy");
    }

    function testOnlyOwnerCanChangeRiskParameters() public {
        VM.startPrank(ALICE);
        VM.expectRevert(ReferenceLendingMarket.NotOwner.selector);
        market.setLiquidationThresholdBps(7_900);
        VM.expectRevert(ReferenceLendingMarket.NotOwner.selector);
        market.setCollateralPriceUsdE18(1_700e18);
        VM.stopPrank();
    }

    function testCanonicalSeedIsDeterministic() public {
        collateralToken.mint(address(market), DemoSeed.totalCollateral());

        for (uint256 i; i < DemoSeed.POSITION_COUNT; ++i) {
            (address account, uint256 collateralAmount, uint256 debtAmount) = DemoSeed.positionAt(i);
            market.seedPosition(account, collateralAmount, debtAmount);
            assertEq(debtToken.balanceOf(account), debtAmount, "seed borrower balance mismatch");
        }

        assertEq(market.totalCollateral(), DemoSeed.totalCollateral(), "seed collateral changed");
        assertEq(market.totalDebt(), DemoSeed.totalDebt(), "seed debt changed");
        assertTrue(
            market.healthFactor(DemoSeed.HEALTHY) > market.healthFactor(DemoSeed.LT_SENSITIVE),
            "seed health ordering changed"
        );
        assertTrue(
            market.healthFactor(DemoSeed.HIGH_RISK) < market.healthFactor(DemoSeed.MODERATE),
            "seed risk ordering changed"
        );
    }

    function _prefundAndSeedOne(address account, uint256 collateralAmount, uint256 debtAmount)
        private
    {
        collateralToken.mint(address(market), collateralAmount);
        market.seedPosition(account, collateralAmount, debtAmount);
    }
}
