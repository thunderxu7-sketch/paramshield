import { Change } from "../generated/schema";
import {
  ProposalCreated,
  DecisionRecorded,
  ProposalExecuted,
  ProposalMarkedExpired,
} from "../generated/ParamShieldExecutor/ParamShieldExecutor";
export function handleProposalCreated(event: ProposalCreated): void {
  const c = new Change(event.params.changeHash.toHexString());
  c.executor = event.address;
  c.operator = event.params.operator;
  c.target = event.params.target;
  c.selector = event.params.selector;
  c.dataHash = event.params.dataHash;
  c.nonce = event.params.nonce;
  c.preflightHash = event.params.evidenceHash;
  c.expiresAt = event.params.expiresAt;
  c.decision = 0;
  c.state = "PENDING";
  c.createdAtBlock = event.block.number;
  c.updatedAtBlock = event.block.number;
  c.save();
}
export function handleDecisionRecorded(event: DecisionRecorded): void {
  const c = Change.load(event.params.changeHash.toHexString());
  assert(c !== null, "Decision before proposal");
  if (c === null) return;
  c.decision = event.params.decision;
  c.decisionHash = event.params.decisionHash;
  c.state =
    event.params.decision === 1
      ? "ALLOWED"
      : event.params.decision === 2
        ? "BLOCKED"
        : "ESCALATED";
  c.updatedAtBlock = event.block.number;
  c.save();
}
export function handleProposalExecuted(event: ProposalExecuted): void {
  const c = Change.load(event.params.changeHash.toHexString());
  assert(c !== null, "Execution before proposal");
  if (c === null) return;
  c.state = "EXECUTED";
  c.executionTransaction = event.transaction.hash;
  c.updatedAtBlock = event.block.number;
  c.save();
}
export function handleProposalExpired(event: ProposalMarkedExpired): void {
  const c = Change.load(event.params.changeHash.toHexString());
  assert(c !== null, "Expiry before proposal");
  if (c === null) return;
  c.state = "EXPIRED";
  c.updatedAtBlock = event.block.number;
  c.save();
}
