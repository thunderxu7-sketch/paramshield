// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { DemoSeed } from "../src/DemoSeed.sol";
import { MockERC20 } from "../src/MockERC20.sol";
import { ReferenceLendingMarket } from "../src/ReferenceLendingMarket.sol";

interface VmSeed {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Seeds an owner-controlled market before ownership is handed to the executor.
contract SeedReferenceMarket {
    VmSeed private constant VM = VmSeed(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant INITIAL_DEBT_LIQUIDITY = 1_000_000e6;

    function run() external {
        uint256 deployerPrivateKey = VM.envUint("SEPOLIA_DEPLOYER_PRIVATE_KEY");
        ReferenceLendingMarket market =
            ReferenceLendingMarket(VM.envAddress("REFERENCE_MARKET_ADDRESS"));
        MockERC20 collateralToken = MockERC20(address(market.collateralToken()));
        MockERC20 debtToken = MockERC20(address(market.debtToken()));

        VM.startBroadcast(deployerPrivateKey);
        collateralToken.mint(address(market), DemoSeed.totalCollateral());
        debtToken.mint(address(market), INITIAL_DEBT_LIQUIDITY);

        for (uint256 i; i < DemoSeed.POSITION_COUNT; ++i) {
            (address account, uint256 collateralAmount, uint256 debtAmount) = DemoSeed.positionAt(i);
            market.seedPosition(account, collateralAmount, debtAmount);
        }
        VM.stopBroadcast();
    }
}
