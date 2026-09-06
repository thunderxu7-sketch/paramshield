// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { MockERC20 } from "../src/MockERC20.sol";
import { ParamShieldExecutor } from "../src/ParamShieldExecutor.sol";
import { ReferenceLendingMarket } from "../src/ReferenceLendingMarket.sol";
import { TestBase } from "./TestBase.sol";

contract ParamShieldExecutorTest is TestBase {
    address private constant OUTSIDER = address(0xBAD);
    bytes32 private constant DECISION_HASH = keccak256("cre-decision");
    bytes32 private constant EVIDENCE_HASH = keccak256("simulation-evidence");

    MockERC20 private collateralToken;
    MockERC20 private debtToken;
    ReferenceLendingMarket private market;
    ParamShieldExecutor private executor;

    function setUp() public {
        collateralToken = new MockERC20("Mock Ether", "mETH", 18, address(this));
        debtToken = new MockERC20("Mock USD Coin", "mUSDC", 6, address(this));
        market = new ReferenceLendingMarket(
            address(collateralToken), 18, address(debtToken), 6, 2_000e18, 8_000, address(this)
        );
        executor =
            new ParamShieldExecutor(address(this), address(this), address(this), address(market));
        market.transferOwnership(address(executor));
    }

    function testAllowedProposalExecutesExactCall() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 1);
        bytes32 changeHash = executor.propose(intent);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ALLOW, DECISION_HASH);
        executor.execute(intent);

        assertEq(market.liquidationThresholdBps(), 7_900, "threshold was not updated");
        assertEq(
            uint256(_proposalState(changeHash)),
            uint256(ParamShieldExecutor.ProposalState.EXECUTED),
            "proposal did not reach executed"
        );
    }

    function testBlockedProposalCannotExecute() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_000, 2);
        bytes32 changeHash = executor.propose(intent);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.BLOCK, DECISION_HASH);

        VM.expectRevert(ParamShieldExecutor.InvalidState.selector);
        executor.execute(intent);
        assertEq(market.liquidationThresholdBps(), 8_000, "blocked proposal changed market");
    }

    function testEscalatedProposalCannotExecute() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_700, 3);
        bytes32 changeHash = executor.propose(intent);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ESCALATE, DECISION_HASH);

        VM.expectRevert(ParamShieldExecutor.InvalidState.selector);
        executor.execute(intent);
    }

    function testExpiredProposalFailsClosedAndCanBeMarked() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 4);
        intent.expiresAt = uint64(block.timestamp + 10);
        bytes32 changeHash = executor.propose(intent);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ALLOW, DECISION_HASH);

        VM.warp(block.timestamp + 11);
        VM.expectRevert(ParamShieldExecutor.ProposalExpired.selector);
        executor.execute(intent);

        executor.markExpired(changeHash);
        assertEq(
            uint256(_proposalState(changeHash)),
            uint256(ParamShieldExecutor.ProposalState.EXPIRED),
            "proposal did not expire"
        );
    }

    function testNonceCannotBeReplayed() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 5);
        executor.propose(intent);

        VM.expectRevert(ParamShieldExecutor.NonceAlreadyUsed.selector);
        executor.propose(intent);
    }

    function testModifiedCalldataDoesNotMatchApprovedProposal() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 6);
        bytes32 changeHash = executor.propose(intent);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ALLOW, DECISION_HASH);

        intent.data = abi.encodeCall(ReferenceLendingMarket.setLiquidationThresholdBps, (7_800));
        VM.expectRevert(ParamShieldExecutor.ProposalNotFound.selector);
        executor.execute(intent);
    }

    function testUnknownSelectorIsRejected() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 7);
        intent.data = abi.encodeCall(ReferenceLendingMarket.setCollateralPriceUsdE18, (1_700e18));

        VM.expectRevert(ParamShieldExecutor.SelectorNotAllowed.selector);
        executor.propose(intent);
    }

    function testUnauthorizedRolesAreRejected() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 8);

        VM.prank(OUTSIDER);
        VM.expectRevert(ParamShieldExecutor.NotOperator.selector);
        executor.propose(intent);

        bytes32 changeHash = executor.propose(intent);
        VM.prank(OUTSIDER);
        VM.expectRevert(ParamShieldExecutor.NotDecisionAuthority.selector);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ALLOW, DECISION_HASH);
    }

    function testInvalidDecisionEvidenceIsRejected() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 9);
        bytes32 changeHash = executor.propose(intent);

        VM.expectRevert(ParamShieldExecutor.InvalidEvidenceHash.selector);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ALLOW, bytes32(0));
    }

    function testTargetFailureDoesNotConsumeApproval() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(4_900, 10);
        bytes32 changeHash = executor.propose(intent);
        executor.recordDecision(changeHash, ParamShieldExecutor.Decision.ALLOW, DECISION_HASH);

        VM.expectRevert(
            abi.encodeWithSelector(
                ParamShieldExecutor.TargetCallFailed.selector,
                abi.encodeWithSelector(ReferenceLendingMarket.InvalidLiquidationThreshold.selector)
            )
        );
        executor.execute(intent);
        assertEq(
            uint256(_proposalState(changeHash)),
            uint256(ParamShieldExecutor.ProposalState.ALLOWED),
            "failed call consumed approval"
        );
    }

    function testIntentValidationRejectsWrongBindings() public {
        ParamShieldExecutor.ChangeIntent memory intent = _thresholdIntent(7_900, 11);

        intent.chainId = block.chainid + 1;
        VM.expectRevert(ParamShieldExecutor.InvalidChainId.selector);
        executor.propose(intent);

        intent = _thresholdIntent(7_900, 12);
        intent.target = OUTSIDER;
        VM.expectRevert(ParamShieldExecutor.SelectorNotAllowed.selector);
        executor.propose(intent);

        intent = _thresholdIntent(7_900, 13);
        intent.value = 1;
        VM.expectRevert(ParamShieldExecutor.InvalidValue.selector);
        executor.propose(intent);

        intent = _thresholdIntent(7_900, 14);
        intent.evidenceHash = bytes32(0);
        VM.expectRevert(ParamShieldExecutor.InvalidEvidenceHash.selector);
        executor.propose(intent);
    }

    function _thresholdIntent(uint16 newThresholdBps, uint256 nonce)
        private
        view
        returns (ParamShieldExecutor.ChangeIntent memory)
    {
        return ParamShieldExecutor.ChangeIntent({
            chainId: block.chainid,
            target: address(market),
            value: 0,
            data: abi.encodeCall(
                ReferenceLendingMarket.setLiquidationThresholdBps, (newThresholdBps)
            ),
            nonce: nonce,
            evidenceHash: EVIDENCE_HASH,
            expiresAt: uint64(block.timestamp + 1 days)
        });
    }

    function _proposalState(bytes32 changeHash)
        private
        view
        returns (ParamShieldExecutor.ProposalState state)
    {
        (,,,,,,,, state) = executor.proposals(changeHash);
    }
}
