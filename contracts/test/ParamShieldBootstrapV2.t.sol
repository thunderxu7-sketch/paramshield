// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import { ParamShieldBootstrapV2 } from "../src/ParamShieldBootstrapV2.sol";
import { DemoSeed } from "../src/DemoSeed.sol";
import { TestBase } from "./TestBase.sol";

contract ParamShieldBootstrapV2Test is TestBase {
    address private constant ADMIN = address(0xA11);
    address private constant OPERATOR = address(0xB22);
    address private constant AUTHORITY = address(0xC33);

    function testIndependentRolesAndCompleteSeed() public {
        VM.prank(ADMIN);
        ParamShieldBootstrapV2 b = new ParamShieldBootstrapV2(ADMIN, OPERATOR, AUTHORITY);
        assertEq(b.executor().admin(), ADMIN, "admin");
        assertEq(b.executor().operator(), OPERATOR, "operator");
        assertEq(b.executor().decisionAuthority(), AUTHORITY, "authority");
        assertEq(b.market().owner(), address(b.executor()), "market owner");
        assertEq(b.market().totalCollateral(), DemoSeed.totalCollateral(), "collateral");
        assertEq(b.market().totalDebt(), DemoSeed.totalDebt(), "debt");
        assertTrue(b.market().stateVersion() > 0, "version required");
        assertEq(b.executor().authorizationEpoch(), 1, "epoch");
        assertEq(b.collateralToken().owner(), ADMIN, "token owner");
        assertEq(b.debtToken().owner(), ADMIN, "token owner");
        for (uint256 i; i < DemoSeed.POSITION_COUNT; ++i) {
            (address a, uint256 c, uint256 d) = DemoSeed.positionAt(i);
            (uint256 actualC, uint256 actualD) = b.market().positions(a);
            assertEq(actualC, c, "position collateral");
            assertEq(actualD, d, "position debt");
        }
    }

    function testRejectsRoleCollisionAndWrongSender() public {
        VM.expectRevert(ParamShieldBootstrapV2.InvalidRoles.selector);
        new ParamShieldBootstrapV2(ADMIN, ADMIN, AUTHORITY);
        VM.expectRevert(ParamShieldBootstrapV2.InvalidRoles.selector);
        new ParamShieldBootstrapV2(ADMIN, OPERATOR, OPERATOR);
        VM.expectRevert(ParamShieldBootstrapV2.InvalidRoles.selector);
        new ParamShieldBootstrapV2(ADMIN, OPERATOR, ADMIN);
        VM.expectRevert(ParamShieldBootstrapV2.InvalidRoles.selector);
        new ParamShieldBootstrapV2(ADMIN, address(0), AUTHORITY);
        VM.expectRevert(ParamShieldBootstrapV2.WrongDeployer.selector);
        new ParamShieldBootstrapV2(ADMIN, OPERATOR, AUTHORITY);
    }
}
