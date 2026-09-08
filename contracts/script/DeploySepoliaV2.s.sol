// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import { ParamShieldBootstrapV2 } from "../src/ParamShieldBootstrapV2.sol";

interface VmDeployV2 {
    function envAddress(string calldata name) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @dev Supply a reviewed signer with Foundry --account/--sender, not a committed key.
/// Without --broadcast Foundry only simulates. Do not reuse the v1 script or ABI.
contract DeploySepoliaV2 {
    VmDeployV2 private constant VM =
        VmDeployV2(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (ParamShieldBootstrapV2 deployment) {
        require(block.chainid == 11155111, "Sepolia only");
        address admin = VM.envAddress("PARAMSHIELD_ADMIN");
        address operator = VM.envAddress("PARAMSHIELD_OPERATOR");
        address authority = VM.envAddress("PARAMSHIELD_DECISION_AUTHORITY");
        VM.startBroadcast();
        deployment = new ParamShieldBootstrapV2(admin, operator, authority);
        VM.stopBroadcast();
    }
}
