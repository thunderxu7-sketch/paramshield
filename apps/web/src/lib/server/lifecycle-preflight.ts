import { encodeFunctionData, type Address, type Hex } from "viem";
import { assertFreshSnapshot } from "@paramshield/shared";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";
import { readTrustedRun, type CreExecutionRun } from "./cre-execution-runner";
import { EXECUTOR_ABI, type SepoliaClient } from "./rpc-adapter";
import { validateSigningPlan } from "./transaction-signing";
import type { v2Context } from "./v2-context";
import type { SignedReviewStore } from "./review-store";

export type V2Context = Awaited<ReturnType<typeof v2Context>>;
export type BoundRun = ReturnType<typeof validateExecutionResult>;
export function bindRun(run: CreExecutionRun, c: V2Context): BoundRun {
  const data = readTrustedRun(run);
  return validateExecutionResult(data.result, data.request, {
    runId: run.runId,
    now: c.now(),
    policyVersion: c.target.policyVersion,
  });
}

/** Checks apply both before and after asynchronous signing. UI stage is never
 * sufficient: use the exact stored review plus pinned, canonical RPC reads. */
export async function checkLifecycle(
  run: CreExecutionRun,
  c: V2Context,
  reviews: SignedReviewStore,
  expectedState: 0 | 1,
  requireReview = true,
) {
  const b = bindRun(run, c),
    i = b.intent;
  if (
    b.decision.verdict !== "ALLOW" ||
    i.executor !== c.target.executor ||
    i.target !== c.target.market ||
    i.operator !== c.target.operator ||
    i.chainId !== 11155111
  )
    throw new Error("Reviewed ALLOW bound to v2 required");
  await c.state.corroborateSnapshot(b.preflight.snapshot);
  const live = await c.live(b.changeHash);
  if (
    live.stateVersion !== i.expectedStateVersion ||
    live.authorizationEpoch !== i.expectedAuthorizationEpoch ||
    live.proposal.state !== expectedState
  )
    throw new Error("Live proposal/version/epoch changed");
  if (
    expectedState === 0 &&
    (await c.client.readContract({
      address: i.executor,
      abi: EXECUTOR_ABI,
      functionName: "nonceUsed",
      args: [i.operator, BigInt(i.nonce)],
    }))
  )
    throw new Error("Intent nonce already consumed");
  if (requireReview) {
    const approval = await reviews.get(b.decisionHash);
    if (
      !approval ||
      approval.changeHash !== b.changeHash ||
      approval.preflightHash !== b.preflightHash
    )
      throw new Error("Matching authenticated human review required");
  }
  const now = c.now();
  assertFreshSnapshot(b.preflight.snapshot, now, live.block.number);
  if (
    now >= i.expiresAt ||
    live.block.timestamp > now ||
    now - live.block.timestamp > 120
  )
    throw new Error("Expired intent or stale RPC state");
  return b;
}
export function intentTuple(b: BoundRun) {
  const i = b.intent;
  return {
    chainId: BigInt(i.chainId),
    target: i.target,
    value: 0n,
    data: i.calldata,
    nonce: BigInt(i.nonce),
    evidenceHash: i.evidenceHash,
    expectedStateVersion: BigInt(i.expectedStateVersion),
    expectedAuthorizationEpoch: BigInt(i.expectedAuthorizationEpoch),
    expiresAt: BigInt(i.expiresAt),
  };
}
export function lifecycleData(
  b: BoundRun,
  method: "propose" | "decision" | "execute",
) {
  return method !== "decision"
    ? encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: method,
        args: [intentTuple(b)],
      })
    : encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: "recordDecision",
        args: [b.changeHash, 1, b.decisionHash],
      });
}
export async function prepareLifecyclePlan(args: {
  client: SepoliaClient;
  from: Address;
  to: Address;
  data: Hex;
  expiresAt: number;
  revalidate: () => Promise<unknown>;
}) {
  await args.revalidate();
  const [nonce, gas, fees, balance] = await Promise.all([
    args.client.getTransactionCount({
      address: args.from,
      blockTag: "pending",
    }),
    args.client.estimateGas({
      account: args.from,
      to: args.to,
      data: args.data,
      value: 0n,
    }),
    args.client.estimateFeesPerGas({ type: "eip1559" }),
    args.client.getBalance({ address: args.from, blockTag: "pending" }),
  ]);
  const plan = validateSigningPlan({
    chainId: 11155111,
    from: args.from,
    to: args.to,
    value: "0",
    data: args.data,
    nonce,
    gas: ((gas * 120n + 99n) / 100n).toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    expiresAt: args.expiresAt,
  });
  if (balance < BigInt(plan.gas) * BigInt(plan.maxFeePerGas))
    throw new Error("Insufficient Sepolia gas balance");
  const revalidate = async () => {
    if (
      (await args.client.getTransactionCount({
        address: args.from,
        blockTag: "pending",
      })) !== nonce
    )
      throw new Error("Wallet nonce changed");
    await args.revalidate();
  };
  await revalidate();
  return { plan, revalidate };
}
