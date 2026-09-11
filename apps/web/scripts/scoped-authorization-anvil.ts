/** Isolated local integration. Synthetic Graph-shaped observations, actual CRE
 * CLI + owned Anvil RPC/contracts/signatures/receipts. NO hosted Graph, Privy,
 * user wallet, public Sepolia deployment or public-chain transaction. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWalletClient,
  http,
  encodeDeployData,
  parseAbi,
  toHex,
  type Abi,
  type Hex,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import {
  createPreflight,
  encodeThreshold,
  hashCanonical,
} from "@paramshield/evidence";
import { snapshotSchema } from "@paramshield/shared";
import {
  CreExecutionRunner,
  DEMO_POLICY,
  readTrustedRun,
} from "../src/lib/server/cre-execution-runner";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";
import {
  AUTHORIZATION_MODE,
  authorizationTypedData,
} from "../src/lib/server/authorization-scope";
import {
  bindScopedRun,
  checkScopedAuthorization,
  type FreshCheckpoint,
} from "../src/lib/server/scoped-authorization";
import { ScopedReviewStore } from "../src/lib/server/scoped-review-store";
import { DurableStore } from "../src/lib/server/durable-store";
import {
  createSepoliaClient,
  createRpcSnapshotPort,
  createExecutionStatePort,
} from "../src/lib/server/rpc-adapter";
import {
  lifecycleData,
  prepareLifecyclePlan,
  type V2Context,
} from "../src/lib/server/lifecycle-preflight";
import { verifyLifecycleReceipt } from "../src/lib/server/lifecycle-receipt";
import {
  DurableSigningService,
  type TransactionSigner,
} from "../src/lib/server/transaction-signing";
import { DurableBroadcastService } from "../src/lib/server/transaction-broadcast";
import { runBoundedProcess } from "../src/lib/bounded-process";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const rpcUrl = "http://127.0.0.1:18546";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function main() {
  if (!process.argv.includes("--anvil-only"))
    throw new Error("Explicit --anvil-only flag required");
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(18546, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await runBoundedProcess("forge", ["build"], {
    cwd: join(root, "contracts"),
    timeoutMs: 60000,
  });
  const node = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      "18546",
      "--chain-id",
      "11155111",
      "--block-time",
      "12",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let failed = false;
  node.once("error", () => {
    failed = true;
  });
  const client = createSepoliaClient(rpcUrl);
  const wallet = createWalletClient({
    chain: sepolia,
    transport: http(rpcUrl, { retryCount: 0 }),
  });
  // Anvil-only RPC, restricted to the fixed node we just created.
  async function localRpc(
    method: "evm_increaseTime" | "evm_mine" | "evm_snapshot" | "evm_revert",
    params: unknown[],
  ) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (data.error) throw new Error("Owned Anvil control failed");
    return data.result;
  }
  try {
    let ready = false;
    for (let n = 0; n < 40; n++) {
      if (failed || node.exitCode !== null)
        throw new Error("Owned Anvil exited");
      try {
        ready = (await client.getChainId()) === 11155111;
      } catch {
        /* bounded startup */
      }
      if (ready) break;
      await sleep(100);
    }
    assert.ok(ready);
    const [admin, operator, authority, reviewer] = (await wallet.getAddresses())
      .slice(0, 4)
      .map((a) => a.toLowerCase() as Address) as [
      Address,
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
    const data = encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [admin, operator, authority],
    });
    const gas = await client.estimateGas({ account: admin, data });
    const deployment = await client.waitForTransactionReceipt({
      hash: await wallet.sendTransaction({
        account: admin,
        data,
        gas: (gas * 120n) / 100n,
      }),
      pollingInterval: 100,
    });
    assert.equal(deployment.status, "success");
    assert.ok(deployment.contractAddress);
    const abi = parseAbi([
      "function market() view returns(address)",
      "function executor() view returns(address)",
    ]);
    const market = (
      await client.readContract({
        address: deployment.contractAddress,
        abi,
        functionName: "market",
      })
    ).toLowerCase() as Address;
    const executor = (
      await client.readContract({
        address: deployment.contractAddress,
        abi,
        functionName: "executor",
      })
    ).toLowerCase() as Address;
    const state = createExecutionStatePort(client),
      rpc = createRpcSnapshotPort(client, "v2");
    const zero = `0x${"0".repeat(64)}` as Hex;
    const live = (changeHash = zero) =>
      state.read({ executor, operator, target: market, changeHash });
    const initial = await live();
    assert.equal(initial.stateVersion, "7");
    assert.equal(initial.authorizationEpoch, "1");
    assert.equal(
      (await rpc.market(market, initial.block.number)).liquidationThresholdBps,
      8000,
    );
    const target = {
      chainId: 11155111 as const,
      contractVersion: "v2" as const,
      executor,
      market,
      operator,
      decisionAuthority: authority,
      executorCodeHash: initial.executorCodeHash,
      marketCodeHash: initial.marketCodeHash,
      policyVersion: DEMO_POLICY.version,
    };
    let offset = 0;
    const now = () => Math.floor(Date.now() / 1000) + offset;
    async function advance(seconds: number) {
      await localRpc("evm_increaseTime", [seconds]);
      offset += seconds;
      await localRpc("evm_mine", []);
    }
    async function snapshot() {
      const block = await client.getBlock({ blockTag: "latest" });
      const number = Number(block.number),
        m = await rpc.market(market, number);
      const positions = await Promise.all(
        Array.from({ length: 5 }, async (_, n) => {
          const account =
            `0x${(0x1001 + n).toString(16).padStart(40, "0")}` as Address;
          return { account, ...(await rpc.position(market, account, number)) };
        }),
      );
      const s = snapshotSchema.parse({
        schemaVersion: "paramshield.snapshot.v1",
        chainId: 11155111,
        market,
        contractVersion: "v2",
        ...m,
        block: { number, hash: block.hash, timestamp: Number(block.timestamp) },
        fetchedAt: now(),
        source: {
          kind: "graph",
          deployment: "anvil-only-NOT-hosted-Graph",
          queryId: "market-snapshot-v1",
        },
        positionCount: 5,
        positions,
      });
      await state.corroborateSnapshot(s);
      return {
        snapshot: s,
        validation: {
          validatedAt: now(),
          headBlock: Number(await client.getBlockNumber()),
        },
      };
    }
    const c = { target, client, state, snapshot, live, now } as V2Context;
    const runner = new CreExecutionRunner(root, now);
    const analyze = (threshold: number, nonce: string) =>
      runner.run(
        async () => {
          const s = await snapshot(),
            current = await live(),
            validatedAt = now();
          return createPreflight({
            snapshot: s.snapshot,
            stressBps: 1500,
            validation: { validatedAt, headBlock: current.block.number },
            intentCore: {
              schemaVersion: "paramshield.intent.v2",
              chainId: 11155111,
              executor,
              operator,
              target: market,
              value: "0",
              calldata: encodeThreshold(threshold),
              currentValueBps: 8000,
              proposedValueBps: threshold,
              nonce,
              expectedStateVersion: current.stateVersion,
              expectedAuthorizationEpoch: current.authorizationEpoch,
              expiresAt: validatedAt + 600,
              reason:
                "Anvil-only exact-state authorization integration, not a public-chain action",
            },
          }).preflight;
        },
        { authorizationMode: AUTHORIZATION_MODE },
      );
    const blocked = await analyze(7000, "0");
    assert.equal(blocked.verdict, "BLOCK");
    assert.throws(() => bindScopedRun(blocked, c), /Scoped ALLOW/);
    const blockedData = readTrustedRun(blocked);
    const rejected = validateExecutionResult(
      blockedData.result,
      blockedData.request,
      {
        runId: blocked.runId,
        now: blockedData.acceptedAt,
        policyVersion: DEMO_POLICY.version,
      },
    );
    assert.equal(rejected.decision.recommendedValueBps, 7942);
    assert.equal(await client.getTransactionCount({ address: operator }), 0);
    const run = await analyze(rejected.decision.recommendedValueBps!, "1");
    assert.equal(run.verdict, "ALLOW");
    const { bound, scope } = bindScopedRun(run, c);
    assert.notEqual(bound.changeHash, rejected.changeHash);
    const immutable = hashCanonical(bound);
    const local = join(root, ".local/anvil-scoped-authorization", randomUUID());
    const reviews = new ScopedReviewStore(
      new DurableStore(join(local, "reviews")),
      [reviewer],
      now,
    );
    const signs = new DurableSigningService(
      new DurableStore(join(local, "signs")),
      now,
    );
    const broadcaster = new DurableBroadcastService(
      new DurableStore(join(local, "broadcast")),
      signs.store,
      now,
    );
    const approvedAt = now(),
      typed = authorizationTypedData(
        bound.preflight,
        bound.decision,
        scope.policyHash,
        approvedAt,
      );
    await advance(180); // Deliberately exceed the OLD snapshot freshness window.
    assert.ok(now() - bound.preflight.snapshot.block.timestamp > 120);
    const sig = await wallet.signTypedData({ account: reviewer, ...typed });
    await reviews.record(
      bound.preflight,
      bound.decision,
      scope.policyHash,
      approvedAt,
      sig,
    );
    const checkpoints: FreshCheckpoint[] = [];
    const check = (expectedState: 0 | 1 | 2) => async () => {
      const checked = await checkScopedAuthorization(
        run,
        c,
        reviews,
        expectedState,
      );
      assert.equal(hashCanonical(checked.bound), immutable);
      checkpoints.push(checked.checkpoint);
    };
    const signer: TransactionSigner = {
      sign: async (p) =>
        wallet.request({
          method: "eth_signTransaction",
          params: [
            {
              from: p.from,
              to: p.to,
              type: "0x2",
              chainId: toHex(p.chainId),
              value: "0x0",
              data: p.data,
              nonce: toHex(p.nonce),
              gas: toHex(BigInt(p.gas)),
              maxFeePerGas: toHex(BigInt(p.maxFeePerGas)),
              maxPriorityFeePerGas: toHex(BigInt(p.maxPriorityFeePerGas)),
            },
          ],
        }),
    };
    const transactions: Partial<
      Record<"propose" | "decision" | "execute", Hex>
    > = {};
    let epochRaceBlocked = false;
    let duplicateBroadcasts = 0;
    const receipts: Record<string, unknown> = {};
    for (const [expectedState, leg] of [
      [0, "propose"],
      [1, "decision"],
      [2, "execute"],
    ] as const) {
      if (expectedState) await advance(60);
      const prepared = await prepareLifecyclePlan({
        client,
        from: leg === "decision" ? authority : operator,
        to: executor,
        data: lifecycleData(bound, leg),
        expiresAt: bound.intent.expiresAt,
        revalidate: check(expectedState),
      });
      // Every signature and broadcast goes through actual durable safety gates;
      // the provider is unlocked LOCAL Anvil, never Privy or a user wallet.
      const job = `scoped-${leg}`;
      const signed = await signs.sign(
        job,
        prepared.plan,
        signer,
        prepared.revalidate,
      );
      if (leg === "execute") {
        const checkpoint = await localRpc("evm_snapshot", []);
        const rotation = await wallet.writeContract({
          account: admin,
          address: executor,
          abi: parseAbi(["function setAllowedCall(address,bytes4,bool)"]),
          functionName: "setAllowedCall",
          args: [market, "0x4d5bcf96", true],
        });
        await client.waitForTransactionReceipt({
          hash: rotation,
          pollingInterval: 100,
        });
        await assert.rejects(
          prepared.revalidate(),
          /permissions or proposal changed/,
        );
        epochRaceBlocked = true;
        assert.equal(await localRpc("evm_revert", [checkpoint]), true);
        await prepared.revalidate();
      }
      await broadcaster.send(job, prepared.plan, client, prepared.revalidate);
      transactions[leg] = signed.transactionHash;
      const receipt = await verifyLifecycleReceipt(
        client,
        prepared.plan,
        signed.transactionHash,
        bound,
        leg,
      );
      assert.equal(
        receipt.finalState.liquidationThresholdBps,
        leg === "execute" ? 7942 : 8000,
      );
      receipts[leg] = {
        transactionHash: signed.transactionHash,
        blockNumber: receipt.receipt.blockNumber.toString(),
        blockHash: receipt.receipt.blockHash,
        stateVersion: receipt.finalState.stateVersion,
        liquidationThresholdBps: receipt.finalState.liquidationThresholdBps,
      };
      // Reconstruct from disk as after a process restart. A duplicate confirmed
      // request must only inspect the existing hash, never invoke send again.
      const restored = new DurableBroadcastService(
        new DurableStore(join(local, "broadcast")),
        new DurableStore(join(local, "signs")),
        now,
      );
      const recovered = await restored.send(
        job,
        prepared.plan,
        {
          ...client,
          sendRawTransaction: async () => {
            duplicateBroadcasts++;
            throw new Error("Confirmed replay must never broadcast");
          },
        },
        async () => {
          throw new Error("Confirmed replay must not renew authorization");
        },
      );
      assert.equal(recovered.transactionHash, signed.transactionHash);
    }
    await assert.rejects(
      checkScopedAuthorization(run, c, reviews, 2),
      /market state changed/,
    );
    assert.equal(hashCanonical(bound), immutable);
    const proof = {
      checkedAt: new Date().toISOString(),
      kind: "owned-anvil-only-scoped-authorization",
      actualCreCli: true,
      hostedGraph: false,
      privyUsed: false,
      publicSepolia: false,
      hardwareTeeAttested: false,
      graphProvenance:
        "synthetic Graph-shaped envelope corroborated against owned Anvil RPC",
      simulatedHumanDelaySeconds: 180,
      simulatedInterStepDelaySeconds: 60,
      scope,
      originalSnapshotBlock: bound.preflight.snapshot.block,
      originalEvidenceUnchanged: true,
      baseline: {
        liquidationThresholdBps: 8000,
        stateVersion: "7",
        authorizationEpoch: "1",
      },
      blockedRun: {
        runId: blocked.runId,
        verdict: blocked.verdict,
        proposedValueBps: 7000,
        recommendedValueBps: rejected.decision.recommendedValueBps,
        changeHash: rejected.changeHash,
      },
      newIntentAfterBlock: bound.changeHash !== rejected.changeHash,
      restartRecoveryVerified: true,
      duplicateBroadcasts,
      epochRaceAfterSigningBlocked: epochRaceBlocked,
      replayAfterExecutionBlocked: true,
      finalLTBps: 7942,
      transactions,
      receipts,
      checkpoints,
      run,
    };
    const proofPath = join(local, "proof.json");
    await writeFile(proofPath, JSON.stringify(proof, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        ok: true,
        actualCreCli: true,
        chain: "owned Anvil ONLY",
        simulatedHumanDelaySeconds: 180,
        finalLTBps: 7942,
        epochRaceBlocked,
        checkpointCount: checkpoints.length,
        originalEvidenceUnchanged: true,
        proofPath: relative(root, proofPath),
      }),
    );
  } finally {
    if (node.exitCode === null && node.pid) {
      node.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          node.kill("SIGKILL");
          resolve();
        }, 5000);
        node.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Scoped Anvil integration failed",
  );
  process.exitCode = 1;
});
