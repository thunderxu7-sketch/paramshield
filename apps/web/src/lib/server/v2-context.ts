import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchGraphSnapshot,
  corroborateSnapshot,
} from "@paramshield/graph-client";
import {
  nonzeroAddressSchema,
  nonzeroHashSchema,
  assertFreshSnapshot,
} from "@paramshield/shared";
import { createPreflight, encodeThreshold } from "@paramshield/evidence";
import { randomBytes } from "node:crypto";
import type { ReviewedExecutionTarget } from "../execution-preflight";
import {
  createSepoliaClient,
  createRpcSnapshotPort,
  createExecutionStatePort,
  EXECUTOR_ABI,
} from "./rpc-adapter";
import { DEMO_POLICY } from "./cre-execution-runner";
import {
  AUTHORIZATION_MODE,
  AUTHORIZATION_SECONDS,
} from "./authorization-scope";

type Manifest = {
  schemaVersion: string;
  deploymentVersion: string;
  network: { chainId: number };
  contracts: Record<
    "market" | "executor",
    { address: string; runtimeCodeHash: string }
  >;
  controlPlane: { executorOperator: string; decisionAuthority: string };
};
type GraphManifest = {
  chainId: number;
  contractVersion: string;
  market: string;
  executor: string;
  deployment: string;
};

/** Configuration comes only from local reviewed manifests, never a request body. */
export async function v2Context(root: string) {
  const m = JSON.parse(
    await readFile(join(root, "deployments/sepolia-v2.json"), "utf8"),
  ) as Manifest;
  const g = JSON.parse(
    await readFile(join(root, "deployments/graph-sepolia-v2.json"), "utf8"),
  ) as GraphManifest;
  if (
    m.schemaVersion !== "paramshield.deployment.v2" ||
    m.deploymentVersion !== "v2" ||
    m.network.chainId !== 11155111 ||
    g.chainId !== 11155111 ||
    g.contractVersion !== "v2"
  )
    throw new Error("Reviewed Sepolia v2 manifests required");
  const target: ReviewedExecutionTarget = {
    chainId: 11155111,
    contractVersion: "v2",
    executor: nonzeroAddressSchema.parse(m.contracts.executor.address),
    market: nonzeroAddressSchema.parse(m.contracts.market.address),
    operator: nonzeroAddressSchema.parse(m.controlPlane.executorOperator),
    decisionAuthority: nonzeroAddressSchema.parse(
      m.controlPlane.decisionAuthority,
    ),
    executorCodeHash: nonzeroHashSchema.parse(
      m.contracts.executor.runtimeCodeHash,
    ),
    marketCodeHash: nonzeroHashSchema.parse(m.contracts.market.runtimeCodeHash),
    policyVersion: DEMO_POLICY.version,
  };
  if (
    nonzeroAddressSchema.parse(g.market) !== target.market ||
    nonzeroAddressSchema.parse(g.executor) !== target.executor ||
    !/^Qm[a-zA-Z0-9]{44}$/.test(g.deployment)
  )
    throw new Error("Graph manifest is not bound to the v2 deployment");
  const url = process.env.GRAPH_V2_QUERY_URL;
  if (!url) throw new Error("GRAPH_V2_QUERY_URL is not configured");
  const client = createSepoliaClient(
    process.env.SEPOLIA_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
  );
  const state = createExecutionStatePort(client);
  const now = () => Math.floor(Date.now() / 1000);
  async function snapshot() {
    if ((await client.getChainId()) !== 11155111)
      throw new Error("Wrong RPC chain");
    const result = await fetchGraphSnapshot({
      url: url!,
      market: target.market,
      chainId: 11155111,
      now: now(),
      headBlock: Number(await client.getBlockNumber()),
      expectedDeployment: g.deployment,
      expectedContractVersion: "v2",
    });
    await corroborateSnapshot(result, createRpcSnapshotPort(client, "v2"));
    const validation = {
      validatedAt: now(),
      headBlock: Number(await client.getBlockNumber()),
    };
    assertFreshSnapshot(result, validation.validatedAt, validation.headBlock);
    return { snapshot: result, validation };
  }
  async function live(changeHash = `0x${"0".repeat(64)}` as `0x${string}`) {
    const live = await state.read({
      ...target,
      target: target.market,
      changeHash,
    });
    if (
      live.executorCodeHash !== target.executorCodeHash ||
      live.marketCodeHash !== target.marketCodeHash ||
      live.operator.toLowerCase() !== target.operator ||
      live.decisionAuthority.toLowerCase() !== target.decisionAuthority ||
      live.marketOwner.toLowerCase() !== target.executor ||
      !live.allowedCall
    )
      throw new Error("V2 code, ownership or roles changed");
    return live;
  }
  async function preflight(
    threshold: number,
    reason: string,
    mode?: typeof AUTHORIZATION_MODE,
  ) {
    const data = await snapshot();
    const current = await live();
    const nonce = BigInt(`0x${randomBytes(16).toString("hex")}`);
    if (
      await client.readContract({
        address: target.executor,
        abi: EXECUTOR_ABI,
        functionName: "nonceUsed",
        args: [target.operator, nonce],
      })
    )
      throw new Error("Intent nonce already used");
    const headBlock = Number(await client.getBlockNumber());
    const validatedAt = now();
    return createPreflight({
      snapshot: data.snapshot,
      stressBps: 1500,
      validation: {
        validatedAt,
        headBlock,
      },
      intentCore: {
        schemaVersion: "paramshield.intent.v2",
        chainId: 11155111,
        executor: target.executor,
        operator: target.operator,
        target: target.market,
        value: "0",
        calldata: encodeThreshold(threshold),
        currentValueBps: data.snapshot.liquidationThresholdBps,
        proposedValueBps: threshold,
        nonce: nonce.toString(),
        expectedStateVersion: current.stateVersion,
        expectedAuthorizationEpoch: current.authorizationEpoch,
        // Snapshot age stays 120s. Only NEW explicitly scoped grants may use
        // the existing protocol's ten-minute maximum authorization window.
        expiresAt:
          validatedAt +
          (mode === AUTHORIZATION_MODE ? AUTHORIZATION_SECONDS : 240),
        reason,
      },
    }).preflight;
  }
  return {
    target,
    graphDeployment: g.deployment,
    client,
    state,
    now,
    snapshot,
    live,
    preflight,
  };
}
