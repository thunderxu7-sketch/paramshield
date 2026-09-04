// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { BuildInfo } from "../src/BuildInfo.sol";

contract BuildInfoTest {
    function testProductName() public {
        BuildInfo info = new BuildInfo();

        require(
            keccak256(bytes(info.PRODUCT())) == keccak256(bytes("ParamShield")),
            "unexpected product name"
        );
    }
}
