// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Canonical, repeatable positions used in local tests and the Sepolia demo.
library DemoSeed {
    uint256 internal constant POSITION_COUNT = 5;

    address internal constant HEALTHY = address(0x1001);
    address internal constant LT_SENSITIVE = address(0x1002);
    address internal constant MODERATE = address(0x1003);
    address internal constant HIGH_RISK = address(0x1004);
    address internal constant CONSERVATIVE = address(0x1005);

    function positionAt(uint256 index)
        internal
        pure
        returns (address account, uint256 collateralAmount, uint256 debtAmount)
    {
        if (index == 0) return (HEALTHY, 10 ether, 12_000e6);
        if (index == 1) return (LT_SENSITIVE, 10 ether, 15_000e6);
        if (index == 2) return (MODERATE, 10 ether, 13_500e6);
        if (index == 3) return (HIGH_RISK, 5 ether, 7_800e6);
        if (index == 4) return (CONSERVATIVE, 20 ether, 20_000e6);
        revert("seed index out of bounds");
    }

    function totalCollateral() internal pure returns (uint256) {
        return 55 ether;
    }

    function totalDebt() internal pure returns (uint256) {
        return 68_300e6;
    }
}
