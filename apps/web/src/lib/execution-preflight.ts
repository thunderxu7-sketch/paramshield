import { encodeFunctionData, parseAbi } from "viem";
import { assertFreshSnapshot, type MarketSnapshot } from "@paramshield/shared";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";

const EXECUTE_ABI = parseAbi([
  "function execute((uint256 chainId,address target,uint256 value,bytes data,uint256 nonce,bytes32 evidenceHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt) intent) returns(bytes)",
]);
type Hex = `0x${string}`;

/** Internal adapter contract, NOT a JSON body accepted from the browser.
 * Implement with hash-pinned RPC reads against a reviewed v2 manifest. */
export interface ExecutionStatePort {
  corroborateSnapshot(snapshot: MarketSnapshot): Promise<void>;
  read(intent: {
    executor: Hex;
    operator: Hex;
    target: Hex;
    changeHash: Hex;
  }): Promise<{
    chainId: number;
    block: { number: number; hash: Hex; timestamp: number };
    executorCodeHash: Hex;
    marketCodeHash: Hex;
    operator: Hex;
    decisionAuthority: Hex;
    marketOwner: Hex;
    stateVersion: string;
    authorizationEpoch: string;
    allowedCall: boolean;
    // Read proposals(changeHash) at the same pinned block, never a UI status.
    proposal: { state: number; decisionHash: Hex };
  }>;
  canonicalBlockHash(number: number): Promise<Hex>;
}
export interface ExecutionApprovalStore {
  /** Load a persisted, authenticated review by exact decision hash. A browser
   * boolean or a freely supplied approval object is not an approval store. */
  get(decisionHash: Hex): Promise<{
    changeHash: Hex;
    preflightHash: Hex;
    decisionHash: Hex;
    reviewer: string;
    approvedAt: number;
  } | null>;
}
export interface ReviewedExecutionTarget {
  chainId: 11155111;
  contractVersion: "v2";
  executor: Hex;
  market: Hex;
  operator: Hex;
  decisionAuthority: Hex;
  executorCodeHash: Hex;
  marketCodeHash: Hex;
  policyVersion: string;
}
const equalHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Server-only pre-sign preparation. `result` must come from our bounded CRE
 * runner, not client-supplied JSON. Binding validation alone cannot authenticate
 * a simulator result. No signing, provider policy update or broadcast happens
 * here; Privy must still enforce the final control and recover the exact tx. */
export async function prepareExecutionCall(args: {
  request: unknown;
  result: unknown;
  runId: string;
  target: ReviewedExecutionTarget;
  state: ExecutionStatePort;
  approvals: ExecutionApprovalStore;
  now: () => number;
}) {
  const { target, state, approvals } = args;
  if (target.contractVersion !== "v2" || target.chainId !== 11155111)
    throw new Error("Reviewed Sepolia v2 deployment required");
  if (equalHex(target.operator, target.decisionAuthority))
    throw new Error("Independent decision authority required");
  for (const codeHash of [target.executorCodeHash, target.marketCodeHash])
    if (!/^0x[0-9a-fA-F]{64}$/.test(codeHash) || BigInt(codeHash) === 0n)
      throw new Error("Pinned deployed bytecode hashes required");

  const bound = validateExecutionResult(args.result, args.request, {
    runId: args.runId,
    policyVersion: target.policyVersion,
    now: args.now(),
  });
  const i = bound.intent;
  if (bound.decision.verdict !== "ALLOW")
    throw new Error("Only ALLOW can reach signing preparation");
  if (
    i.chainId !== target.chainId ||
    !equalHex(i.executor, target.executor) ||
    !equalHex(i.target, target.market) ||
    !equalHex(i.operator, target.operator)
  )
    throw new Error("Intent does not match reviewed deployment");

  await state.corroborateSnapshot(bound.preflight.snapshot);
  const live = await state.read({
    executor: i.executor,
    operator: i.operator,
    target: i.target,
    changeHash: bound.changeHash,
  });
  if (
    live.chainId !== target.chainId ||
    !equalHex(live.executorCodeHash, target.executorCodeHash) ||
    !equalHex(live.marketCodeHash, target.marketCodeHash) ||
    !equalHex(live.operator, target.operator) ||
    !equalHex(live.decisionAuthority, target.decisionAuthority) ||
    !equalHex(live.marketOwner, target.executor) ||
    live.stateVersion !== i.expectedStateVersion ||
    live.authorizationEpoch !== i.expectedAuthorizationEpoch ||
    live.allowedCall !== true ||
    live.proposal.state !== 2 || // ALLOWED in the v2 executor.
    !equalHex(live.proposal.decisionHash, bound.decisionHash)
  )
    throw new Error("Live execution preconditions changed or are not ALLOWED");
  const approval = await approvals.get(bound.decisionHash);
  const now = args.now();
  if (
    !approval ||
    !equalHex(approval.changeHash, bound.changeHash) ||
    !equalHex(approval.preflightHash, bound.preflightHash) ||
    !equalHex(approval.decisionHash, bound.decisionHash) ||
    !approval.reviewer.trim() ||
    !Number.isSafeInteger(approval.approvedAt) ||
    approval.approvedAt < bound.preflight.validation.validatedAt ||
    approval.approvedAt > now
  )
    throw new Error("Matching persisted human review required");
  assertFreshSnapshot(bound.preflight.snapshot, now, live.block.number);
  if (
    !Number.isSafeInteger(live.block.timestamp) ||
    live.block.timestamp < bound.preflight.snapshot.block.timestamp ||
    live.block.timestamp > now ||
    now - live.block.timestamp > 120 ||
    now >= i.expiresAt
  )
    throw new Error("Expired execution or stale RPC state");
  if (
    !equalHex(
      await state.canonicalBlockHash(live.block.number),
      live.block.hash,
    )
  )
    throw new Error("RPC state block was reorganized");
  // Recheck time after the final asynchronous dependency; no stale approval on
  // a slow provider response. The contract checks version/epoch again at mining.
  const finalNow = args.now();
  assertFreshSnapshot(bound.preflight.snapshot, finalNow, live.block.number);
  if (finalNow >= i.expiresAt)
    throw new Error("Execution expired before signing");
  return {
    chainId: i.chainId,
    from: i.operator,
    to: i.executor,
    value: 0n,
    data: encodeFunctionData({
      abi: EXECUTE_ABI,
      functionName: "execute",
      args: [
        {
          chainId: BigInt(i.chainId),
          target: i.target,
          value: 0n,
          data: i.calldata,
          nonce: BigInt(i.nonce),
          evidenceHash: i.evidenceHash,
          expectedStateVersion: BigInt(i.expectedStateVersion),
          expectedAuthorizationEpoch: BigInt(i.expectedAuthorizationEpoch),
          expiresAt: BigInt(i.expiresAt),
        },
      ],
    }),
    changeHash: bound.changeHash,
    preflightHash: bound.preflightHash,
    decisionHash: bound.decisionHash,
    checkedBlock: live.block,
  };
}
