import { hashCanonical } from "@paramshield/evidence";
import { assertFreshSnapshot } from "@paramshield/shared";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";
import {
  readTrustedRun,
  DEMO_POLICY,
  type CreExecutionRun,
} from "./cre-execution-runner";
import {
  AUTHORIZATION_MODE,
  authorizationScope,
  marketStateHash,
} from "./authorization-scope";
import { EXECUTOR_ABI } from "./rpc-adapter";
import type { V2Context } from "./lifecycle-preflight";
import type { ScopedReviewStore } from "./scoped-review-store";

export function isScopedRun(run: CreExecutionRun) {
  return readTrustedRun(run).authorizationMode === AUTHORIZATION_MODE;
}

/** Historical binding check ONLY, using the immutable acceptance time held by
 * our runner. This is NOT a fresh execution permission. The only action path
 * below must then fetch/corroborate fresh state and authenticate the NEW grant.
 * Old JSON, a legacy run or a signature by itself cannot enter this path. */
export function bindScopedRun(run: CreExecutionRun, c: V2Context) {
  const data = readTrustedRun(run);
  if (
    data.authorizationMode !== AUTHORIZATION_MODE ||
    data.policyHash !== hashCanonical(DEMO_POLICY) ||
    c.target.policyVersion !== DEMO_POLICY.version
  )
    throw new Error("Scoped runner capability and unchanged policy required");
  const b = validateExecutionResult(data.result, data.request, {
    runId: run.runId,
    now: data.acceptedAt,
    policyVersion: c.target.policyVersion,
  });
  const i = b.intent;
  if (data.acceptedAt < b.preflight.validation.validatedAt)
    throw new Error("Scoped runner acceptance precedes preflight validation");
  if (c.now() < data.acceptedAt || c.now() >= i.expiresAt)
    throw new Error("Scoped authorization expired or clock moved backwards");
  if (
    b.decision.verdict !== "ALLOW" ||
    i.chainId !== 11155111 ||
    i.executor !== c.target.executor ||
    i.target !== c.target.market ||
    i.operator !== c.target.operator ||
    c.target.contractVersion !== "v2"
  )
    throw new Error("Scoped ALLOW must match the reviewed deployment");
  return {
    bound: b,
    scope: authorizationScope(b.preflight, b.decision, data.policyHash),
  };
}

export type FreshCheckpoint = {
  scopeHash: `0x${string}`;
  snapshotHash: `0x${string}`;
  snapshotFetchedAt: number;
  marketStateHash: `0x${string}`;
  checkedAt: number;
  freshUntil: number;
  snapshotBlock: { number: number; hash: `0x${string}`; timestamp: number };
  stateBlock: { number: number; hash: `0x${string}`; timestamp: number };
  expectedProposalState: 0 | 1 | 2;
};

/** Freshness is renewed by NEW observations of exactly the same state, never
 * by editing the report's block, fetchedAt, decision hash, nonce or expiry. */
export async function checkScopedAuthorization(
  run: CreExecutionRun,
  c: V2Context,
  reviews: ScopedReviewStore,
  expectedState: 0 | 1 | 2,
  requireReview = true,
) {
  const { bound: b, scope } = bindScopedRun(run, c);
  const i = b.intent;
  // Original block must remain canonical, but don't require historical eth_call
  // for the old state on every step. Fresh snapshot() corroborates ALL fields
  // and ALL positions against RPC at its own pinned block.
  if (
    (await c.state.canonicalBlockHash(b.preflight.snapshot.block.number)) !==
    b.preflight.snapshot.block.hash
  )
    throw new Error("Reviewed snapshot reorganized; new analysis required");
  const fresh = (await c.snapshot()).snapshot;
  if (
    fresh.block.number < b.preflight.snapshot.block.number ||
    fresh.block.timestamp < b.preflight.snapshot.block.timestamp ||
    marketStateHash(fresh) !== scope.marketStateHash
  )
    throw new Error(
      "Scoped market state changed; new analysis and review required",
    );
  const live = await c.live(b.changeHash);
  if (
    live.chainId !== 11155111 ||
    live.executorCodeHash !== c.target.executorCodeHash ||
    live.marketCodeHash !== c.target.marketCodeHash ||
    live.operator.toLowerCase() !== i.operator ||
    live.decisionAuthority.toLowerCase() !== c.target.decisionAuthority ||
    live.operator.toLowerCase() === live.decisionAuthority.toLowerCase() ||
    live.marketOwner.toLowerCase() !== i.executor ||
    !live.allowedCall ||
    live.stateVersion !== i.expectedStateVersion ||
    live.authorizationEpoch !== i.expectedAuthorizationEpoch ||
    live.proposal.state !== expectedState ||
    (expectedState === 2 && live.proposal.decisionHash !== b.decisionHash)
  )
    throw new Error(
      "Scoped live state, permissions or proposal changed; new review required",
    );
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
    const review = await reviews.get(b.decisionHash);
    if (!review || review.scopeHash !== scope.scopeHash)
      throw new Error("Matching authenticated scoped review required");
  }
  // Check canonicality and time AFTER all slow dependencies, including review
  // storage/nonce reads. The executor checks version/epoch again at mining.
  const [snapshotHash, stateHash] = await Promise.all([
    c.state.canonicalBlockHash(fresh.block.number),
    c.state.canonicalBlockHash(live.block.number),
  ]);
  if (snapshotHash !== fresh.block.hash || stateHash !== live.block.hash)
    throw new Error("Fresh authorization observations reorganized");
  const now = c.now();
  assertFreshSnapshot(fresh, now, live.block.number);
  if (
    !Number.isSafeInteger(live.block.timestamp) ||
    live.block.timestamp < fresh.block.timestamp ||
    live.block.timestamp > now ||
    now - live.block.timestamp > 120 ||
    now >= i.expiresAt
  )
    throw new Error("Scoped authorization expired or RPC state is stale");
  const checkpoint: FreshCheckpoint = {
    scopeHash: scope.scopeHash,
    snapshotHash: hashCanonical(fresh),
    snapshotFetchedAt: fresh.fetchedAt,
    marketStateHash: scope.marketStateHash,
    checkedAt: now,
    freshUntil: Math.min(
      i.expiresAt,
      fresh.block.timestamp + 120,
      fresh.fetchedAt + 120,
    ),
    snapshotBlock: fresh.block,
    stateBlock: live.block,
    expectedProposalState: expectedState,
  };
  return { bound: b, checkpoint };
}
