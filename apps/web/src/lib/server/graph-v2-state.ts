import { hashCanonical } from "@paramshield/evidence";
import type { MarketSnapshot } from "@paramshield/shared";
import type { Hex } from "viem";
import { EXECUTOR_ABI } from "./rpc-adapter";
import type { V2Context, BoundRun } from "./lifecycle-preflight";

const zero = `0x${"0".repeat(64)}` as Hex;
const QUERY = `query V2Controls($blockHash:Bytes!, $executor:ID!, $call:ID!, $change:ID!, $tx:Bytes!) {
  _meta(block:{hash:$blockHash}) { deployment hasIndexingErrors block { number hash } }
  executor(id:$executor,block:{hash:$blockHash}) { admin operator decisionAuthority authorizationEpoch }
  allowedCall(id:$call,block:{hash:$blockHash}) { executor target selector allowed }
  change(id:$change,block:{hash:$blockHash}) { executor operator target preflightHash decisionHash expectedStateVersion expectedAuthorizationEpoch state executionTransaction }
  marketEvents(first:10,where:{transactionHash:$tx},block:{hash:$blockHash}) { market { id } kind transactionHash blockNumber }
}`;
/** Fixed query against the configured, pinned hosted v2 index. No user URLs,
 * dynamic GraphQL or fabricated event/role fallbacks. */
export async function readGraphV2State(
  c: V2Context,
  snapshot: MarketSnapshot,
  expected?: { bound: BoundRun; transactionHash: Hex },
) {
  const url = process.env.GRAPH_V2_QUERY_URL;
  if (!url || new URL(url).protocol !== "https:")
    throw new Error("Configured hosted Graph required");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        blockHash: snapshot.block.hash,
        executor: c.target.executor,
        call: `${c.target.executor}-${c.target.market}-0x4d5bcf96`,
        change: expected?.bound.changeHash ?? zero,
        tx: expected?.transactionHash ?? zero,
      },
    }),
  });
  if (!response.ok || !response.body)
    throw new Error("Graph v2 control query unavailable");
  const reader = response.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > 64_000) throw new Error("Graph response too large");
      parts.push(p.value);
    }
  } finally {
    await reader.cancel();
  }
  const body = JSON.parse(Buffer.concat(parts).toString("utf8")),
    g = body.data;
  if (
    body.errors?.length ||
    !g ||
    g._meta?.deployment !== c.graphDeployment ||
    g._meta.hasIndexingErrors !== false ||
    g._meta.block?.number !== snapshot.block.number ||
    g._meta.block.hash !== snapshot.block.hash
  )
    throw new Error("Graph v2 control provenance mismatch");
  const admin = await c.client.readContract({
    address: c.target.executor,
    abi: EXECUTOR_ABI,
    functionName: "admin",
    blockNumber: BigInt(snapshot.block.number),
  });
  const epoch = await c.client.readContract({
    address: c.target.executor,
    abi: EXECUTOR_ABI,
    functionName: "authorizationEpoch",
    blockNumber: BigInt(snapshot.block.number),
  });
  if (
    g.executor?.admin !== admin.toLowerCase() ||
    g.executor.operator !== c.target.operator ||
    g.executor.decisionAuthority !== c.target.decisionAuthority ||
    g.executor.authorizationEpoch !== epoch.toString() ||
    g.allowedCall?.executor !== c.target.executor ||
    g.allowedCall.target !== c.target.market ||
    g.allowedCall.selector !== "0x4d5bcf96" ||
    g.allowedCall.allowed !== true
  )
    throw new Error("Graph v2 indexed roles or allowlist mismatch");
  if (expected) {
    const b = expected.bound,
      change = g.change;
    if (
      !change ||
      change.executor !== b.intent.executor ||
      change.operator !== b.intent.operator ||
      change.target !== b.intent.target ||
      change.preflightHash !== b.preflightHash ||
      change.decisionHash !== b.decisionHash ||
      change.expectedStateVersion !== b.intent.expectedStateVersion ||
      change.expectedAuthorizationEpoch !==
        b.intent.expectedAuthorizationEpoch ||
      change.state !== "EXECUTED" ||
      change.executionTransaction !== expected.transactionHash ||
      !Array.isArray(g.marketEvents) ||
      !["LT", "STATE_VERSION"].every((kind) =>
        g.marketEvents.some(
          (event: {
            kind: string;
            transactionHash: string;
            market: { id: string };
          }) =>
            event.kind === kind &&
            event.transactionHash === expected.transactionHash &&
            event.market?.id === c.target.market,
        ),
      )
    )
      throw new Error("Graph v2 execution events not yet verified");
  }
  if (
    (await c.state.canonicalBlockHash(snapshot.block.number)) !==
    snapshot.block.hash
  )
    throw new Error("Graph block reorganized during control check");
  return {
    ...g,
    snapshotHash: hashCanonical(snapshot),
    checkedAt: new Date().toISOString(),
  };
}
