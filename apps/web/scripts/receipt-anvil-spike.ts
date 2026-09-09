/** Real v2 bytecode and RPC receipts on an OWNED disposable Anvil only.
 * Synthetic policy/reviewer and node-managed signing are NOT Privy or human
 * approval evidence. Never attach this harness to a public/testnet endpoint. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  createWalletClient,
  createTestClient,
  http,
  encodeDeployData,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import {
  createPreflight,
  encodeThreshold,
  hashCanonical,
} from "@paramshield/evidence";
import { demoSnapshot } from "@paramshield/risk-engine/fixtures";
import {
  evaluateConfidentialRequest,
  validateExecutionResult,
} from "@paramshield/chainlink-cre/protocol";
import {
  createSepoliaClient,
  createRpcSnapshotPort,
  EXECUTOR_ABI,
} from "../src/lib/server/rpc-adapter";
import {
  prepareLifecyclePlan,
  lifecycleData,
  intentTuple,
} from "../src/lib/server/lifecycle-preflight";
import { verifyLifecycleReceipt } from "../src/lib/server/lifecycle-receipt";
import {
  DurableSigningService,
  viemTransaction,
} from "../src/lib/server/transaction-signing";
import { DurableBroadcastService } from "../src/lib/server/transaction-broadcast";
import { DurableStore } from "../src/lib/server/durable-store";
import { DEMO_POLICY } from "../src/lib/server/cre-execution-runner";
import { runBoundedProcess } from "../src/lib/bounded-process";

async function main() {
  if (!process.argv.includes("--anvil-only"))
    throw new Error("Explicit --anvil-only required");
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    port = 18548,
    url = `http://127.0.0.1:${port}`;
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await runBoundedProcess("forge", ["build"], {
    cwd: join(root, "contracts"),
    timeoutMs: 60_000,
  });
  const child = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "11155111",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  const client = createSepoliaClient(url),
    wallet = createWalletClient({
      chain: sepolia,
      transport: http(url, { retryCount: 0 }),
    });
  const test = createTestClient({
    mode: "anvil",
    chain: sepolia,
    transport: http(url, { retryCount: 0 }),
  });
  const now = () => Math.floor(Date.now() / 1000);
  try {
    let ready = false;
    for (let n = 0; n < 30; n++) {
      try {
        ready = (await client.getChainId()) === 11155111;
      } catch {
        /* owned startup only */
      }
      if (ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(ready, "Owned Anvil startup failed");
    const [admin, operator, authority] = (await wallet.getAddresses()) as [
      Address,
      Address,
      Address,
    ];
    const artifact = JSON.parse(
      await readFile(
        join(
          root,
          "contracts/out/ParamShieldBootstrapV2.sol/ParamShieldBootstrapV2.json",
        ),
        "utf8",
      ),
    ) as { abi: Abi; bytecode: { object: Hex } };
    const deployed = await wallet.sendTransaction({
      account: admin,
      data: encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
        args: [admin, operator, authority],
      }),
    });
    const deployment = await client.waitForTransactionReceipt({
      hash: deployed,
    });
    assert(deployment.contractAddress);
    const abi = parseAbi([
      "function market() view returns(address)",
      "function executor() view returns(address)",
    ]);
    const market = await client.readContract({
      address: deployment.contractAddress,
      abi,
      functionName: "market",
    });
    const executor = await client.readContract({
      address: deployment.contractAddress,
      abi,
      functionName: "executor",
    });
    const block = await client.getBlock({ blockTag: "latest" }),
      rpc = createRpcSnapshotPort(client, "v2");
    const snapshot = demoSnapshot();
    snapshot.market = market.toLowerCase() as Address;
    snapshot.contractVersion = "v2";
    Object.assign(snapshot, await rpc.market(market, Number(block.number)));
    snapshot.stateVersion = "7";
    snapshot.block = {
      number: Number(block.number),
      hash: block.hash,
      timestamp: Number(block.timestamp),
    };
    snapshot.fetchedAt = now();
    snapshot.source = {
      kind: "graph",
      deployment: "anvil-only-synthetic-envelope",
      queryId: "market-snapshot-v1",
    };
    snapshot.positions = await Promise.all(
      snapshot.positions.map(async (p) => ({
        account: p.account,
        ...(await rpc.position(market, p.account, Number(block.number))),
      })),
    );
    const { preflight } = createPreflight({
      snapshot,
      stressBps: 1500,
      validation: { validatedAt: now(), headBlock: Number(block.number) },
      intentCore: {
        schemaVersion: "paramshield.intent.v2",
        chainId: 11155111,
        executor,
        operator,
        target: market,
        value: "0",
        calldata: encodeThreshold(7942),
        currentValueBps: 8000,
        proposedValueBps: 7942,
        expectedStateVersion: "7",
        expectedAuthorizationEpoch: "1",
        nonce: "1",
        expiresAt: now() + 240,
        reason: "Owned Anvil receipt integration; no public execution claim",
      },
    });
    const request = {
      schemaVersion: "paramshield.policy-execution.request.v1",
      runId: "receipt-anvil",
      preflight,
    };
    const result = evaluateConfidentialRequest(
      request,
      JSON.stringify(DEMO_POLICY),
      {
        now: now(),
        requestHash: hashCanonical(request),
        runId: request.runId,
        lane: "execution",
      },
    );
    const bound = validateExecutionResult(result, request, {
      now: now(),
      runId: request.runId,
      policyVersion: DEMO_POLICY.version,
    });
    assert.equal(bound.decision.verdict, "ALLOW");
    const store = new DurableStore(
      join(root, ".local/receipt-anvil", randomUUID()),
    );
    const signing = new DurableSigningService(
      new DurableStore(join(store.root, "signing")),
      now,
    );
    const broadcast = new DurableBroadcastService(
      new DurableStore(join(store.root, "broadcast")),
      signing.store,
      now,
    );
    const checks: string[] = [];
    let finalState;
    for (const leg of ["propose", "decision", "execute"] as const) {
      const from = leg === "decision" ? authority : operator;
      const data =
        leg === "execute"
          ? encodeFunctionData({
              abi: EXECUTOR_ABI,
              functionName: "execute",
              args: [intentTuple(bound)],
            })
          : lifecycleData(bound, leg);
      const ready = await prepareLifecyclePlan({
        client,
        from,
        to: executor,
        data,
        expiresAt: bound.intent.expiresAt,
        revalidate: async () => {},
      });
      const signed = await signing.sign(
        leg,
        ready.plan,
        {
          sign: (p) =>
            wallet.signTransaction({ account: from, ...viemTransaction(p) }),
        },
        ready.revalidate,
      );
      // Create the extra confirmation only AFTER sendRawTransaction mines the tx.
      const minedClient = {
        ...client,
        sendRawTransaction: async (
          args: Parameters<typeof client.sendRawTransaction>[0],
        ) => {
          const hash = await client.sendRawTransaction(args);
          await test.mine({ blocks: 1 });
          return hash;
        },
      };
      await broadcast.send(leg, ready.plan, minedClient, ready.revalidate);
      const verified = await verifyLifecycleReceipt(
        client,
        ready.plan,
        signed.transactionHash,
        bound,
        leg,
      );
      checks.push(
        `${leg}: exact envelope, canonical receipt, events, proposal tuple and receipt-block state`,
      );
      finalState = verified.finalState;
      await assert.rejects(() =>
        verifyLifecycleReceipt(
          client,
          { ...ready.plan, nonce: ready.plan.nonce + 1 },
          signed.transactionHash,
          bound,
          leg,
        ),
      );
      checks.push(`${leg}: altered transaction plan rejected`);
    }
    assert.equal(finalState?.liquidationThresholdBps, 7942);
    assert.equal(finalState?.stateVersion, "8");
    await writeFile(
      join(root, "docs/evidence/receipt-anvil-only-2026-09-09.json"),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          kind: "owned-anvil-lifecycle-receipts",
          publicSepolia: false,
          hostedGraph: false,
          realPrivy: false,
          humanReview: false,
          checks,
          finalState,
        },
        null,
        2,
      ) + "\n",
    );
    console.log({
      checks: checks.length,
      finalThreshold: finalState.liquidationThresholdBps,
      stateVersion: finalState.stateVersion,
      publicSepolia: false,
    });
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve();
      else child.once("exit", () => resolve());
    });
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Anvil receipt verification failed",
  );
  process.exitCode = 1;
});
