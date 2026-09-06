// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ParamShieldBootstrap } from "../src/ParamShieldBootstrap.sol";

interface VmDeploy {
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Reproducible Foundry deployment path for the single-transaction Sepolia bootstrap.
contract DeploySepolia {
    VmDeploy private constant VM =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ParamShieldBootstrap deployment) {
        uint256 deployerPrivateKey = VM.envUint("SEPOLIA_DEPLOYER_PRIVATE_KEY");

        VM.startBroadcast(deployerPrivateKey);
        deployment = new ParamShieldBootstrap();
        VM.stopBroadcast();
    }
}
