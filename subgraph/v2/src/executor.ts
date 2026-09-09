import { ethereum } from "@graphprotocol/graph-ts";
import {
  Change,
  ProposalPrecondition,
  Executor,
  AllowedCall,
} from "../../generated/v2/schema";
import {
  ParamShieldExecutor,
  ProposalPreconditions,
  AuthorizationEpochUpdated,
  OperatorUpdated,
  DecisionAuthorityUpdated,
  OwnershipTransferred,
  AllowedCallUpdated,
  ProposalCreated,
  DecisionRecorded,
  ProposalExecuted,
  ProposalMarkedExpired,
} from "../../generated/v2/ParamShieldExecutor/ParamShieldExecutor";
export function handleProposalCreated(event: ProposalCreated): void {
  const c = new Change(event.params.changeHash.toHexString());
  // The Solidity contract emits Preconditions BEFORE ProposalCreated.
  // Keep its own entity instead of requiring a Change that does not exist yet.
  const p = ProposalPrecondition.load(c.id);
  assert(p !== null, "Proposal lacks v2 preconditions");
  if (p === null) return;
  assert(p.executor.equals(event.address), "Foreign preconditions");
  c.expectedStateVersion = p.expectedStateVersion;
  c.expectedAuthorizationEpoch = p.expectedAuthorizationEpoch;
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

export function handleProposalPreconditions(
  event: ProposalPreconditions,
): void {
  const p = new ProposalPrecondition(event.params.changeHash.toHexString());
  p.executor = event.address;
  p.expectedStateVersion = event.params.expectedStateVersion;
  p.expectedAuthorizationEpoch = event.params.expectedAuthorizationEpoch;
  p.save();
}
function executorFor(event: ethereum.Event): Executor {
  let e = Executor.load(event.address.toHexString());
  if (e === null) {
    e = new Executor(event.address.toHexString());
    const contract = ParamShieldExecutor.bind(event.address);
    e.admin = contract.admin();
    e.operator = contract.operator();
    e.decisionAuthority = contract.decisionAuthority();
    e.authorizationEpoch = contract.authorizationEpoch();
  }
  e.updatedAtBlock = event.block.number;
  return e;
}
export function handleEpochUpdated(event: AuthorizationEpochUpdated): void {
  const e = executorFor(event);
  e.authorizationEpoch = event.params.authorizationEpoch;
  e.save();
}
export function handleOperatorUpdated(event: OperatorUpdated): void {
  const e = executorFor(event);
  e.operator = event.params.newOperator;
  e.save();
}
export function handleAuthorityUpdated(event: DecisionAuthorityUpdated): void {
  const e = executorFor(event);
  e.decisionAuthority = event.params.newDecisionAuthority;
  e.save();
}
export function handleAdminUpdated(event: OwnershipTransferred): void {
  const e = executorFor(event);
  e.admin = event.params.newAdmin;
  e.save();
}
export function handleAllowedCallUpdated(event: AllowedCallUpdated): void {
  const e = executorFor(event);
  e.save();
  const a = new AllowedCall(
    e.id +
      "-" +
      event.params.target.toHexString() +
      "-" +
      event.params.selector.toHexString(),
  );
  a.executor = event.address;
  a.target = event.params.target;
  a.selector = event.params.selector;
  a.allowed = event.params.allowed;
  a.updatedAtBlock = event.block.number;
  a.save();
}
