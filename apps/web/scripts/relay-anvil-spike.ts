/** Explicit Anvil-only integration harness. Chain ID 11155111 here is configured
 * for ABI parity, NOT proof of a public Sepolia transaction or hosted Graph.
 * The Graph-shaped test fixture below is never used by the production fetcher. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createWalletClient,
  http,
  encodeDeployData,
  parseAbi,
  toHex,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import { sepolia } from "viem/chains";
import { createPreflight, encodeThreshold } from "@paramshield/evidence";
import { snapshotSchema } from "@paramshield/shared";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";
import {
  createSepoliaClient,
  createRpcSnapshotPort,
  createExecutionStatePort,
  EXECUTOR_ABI,
  MARKET_ABI,
} from "../src/lib/server/rpc-adapter";
import {
  CreExecutionRunner,
  readTrustedRun,
  DEMO_POLICY,
} from "../src/lib/server/cre-execution-runner";
import { DurableStore } from "../src/lib/server/durable-store";
import {
  SignedReviewStore,
  reviewTypedData,
} from "../src/lib/server/review-store";
import {
  DurableSigningService,
  type TransactionSigner,
} from "../src/lib/server/transaction-signing";
import { prepareRelaySigning } from "../src/lib/server/execution-relay";
import { runBoundedProcess } from "../src/lib/bounded-process";

const root = fileURLToPath(new URL("../../../", import.meta.url)),
  rpcUrl = "http://127.0.0.1:18545";
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function main() {
  if (!process.argv.includes("--anvil-only"))
    throw new Error("Explicit --anvil-only flag required");
  // Refuse an existing listener; never attach writes to someone else's node.
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(18545, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  await runBoundedProcess("forge", ["build"], {
    cwd: join(root, "contracts"),
    timeoutMs: 60_000,
  });
  const anvil = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      "18545",
      "--chain-id",
      "11155111",
      "--block-time",
      // Match the 12-second slot cadence used by the target EVM environment.
      // One-second test blocks consumed the 12-block freshness window while a
      // loaded machine ran the CLI. Production freshness limits stay unchanged.
      "12",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let launchError = false;
  anvil.once("error", () => {
    launchError = true;
  });
  const client = createSepoliaClient(rpcUrl),
    wallet = createWalletClient({
      chain: sepolia,
      transport: http(rpcUrl, { retryCount: 0 }),
      pollingInterval: 100,
    });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (launchError || anvil.exitCode !== null)
        throw new Error("Owned Anvil failed to start");
      try {
        ready = (await client.getChainId()) === 11155111;
      } catch {
        /* bounded startup wait */
      }
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error("Owned Anvil startup timed out");
    const accounts = await wallet.getAddresses();
    const [admin, operator, authority, reviewer] = accounts as [
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
    const initcode = encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [admin, operator, authority],
    });
    const estimatedGas = await client.estimateGas({
      account: admin,
      data: initcode,
    });
    const deploymentHash = await wallet.sendTransaction({
      account: admin,
      data: initcode,
      gas: (estimatedGas * 120n) / 100n,
    });
    const deployment = await client.waitForTransactionReceipt({
      hash: deploymentHash,
      pollingInterval: 100,
    });
    assert.equal(deployment.status, "success");
    assert.ok(deployment.contractAddress);
    const bootstrapAbi = parseAbi([
      "function market() view returns(address)",
      "function executor() view returns(address)",
    ]);
    const market = await client.readContract({
      address: deployment.contractAddress,
      abi: bootstrapAbi,
      functionName: "market",
    });
    const executor = await client.readContract({
      address: deployment.contractAddress,
      abi: bootstrapAbi,
      functionName: "executor",
    });
    const rpc = createRpcSnapshotPort(client, "v2"),
      state = createExecutionStatePort(client);
    const initial = await state.read({
      executor,
      operator,
      target: market,
      changeHash: `0x${"0".repeat(64)}`,
    });
    assert.equal(initial.operator, operator);
    assert.equal(initial.decisionAuthority, authority);
    assert.equal(initial.marketOwner, executor);
    assert.equal(initial.authorizationEpoch, "1");
    assert.equal(initial.allowedCall, true);
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
    const local = join(root, ".local/anvil-relay", randomUUID());
    const approvals = new SignedReviewStore(
      new DurableStore(join(local, "reviews")),
      [reviewer],
      now,
    );
    const signs = new DurableSigningService(
      new DurableStore(join(local, "signs")),
      now,
    );
    const runner = new CreExecutionRunner(root);
    const checks: string[] = [
      "bootstrap-independent-roles",
      "v2-real-rpc-hash-pinned-reads",
    ];
    const runs = [];
    let nonce = 0;
    for (const threshold of [7000, 7942]) {
      const run = await runner.run(async () => {
        const block = await client.getBlock({ blockTag: "latest" }),
          n = Number(block.number);
        const m = await rpc.market(market, n);
        const positions = await Promise.all(
          Array.from({ length: 5 }, async (_, i) => {
            const account =
              `0x${(0x1001 + i).toString(16).padStart(40, "0")}` as Address;
            return { account, ...(await rpc.position(market, account, n)) };
          }),
        );
        // Synthetic Graph envelope, actual ANVIL RPC values. Explicit test-only.
        const snapshot = snapshotSchema.parse({
          schemaVersion: "paramshield.snapshot.v1",
          chainId: 11155111,
          market: market.toLowerCase(),
          contractVersion: "v2",
          ...m,
          block: {
            number: n,
            hash: block.hash,
            timestamp: Number(block.timestamp),
          },
          fetchedAt: now(),
          source: {
            kind: "graph",
            deployment: "anvil-only-NOT-hosted-Graph",
            queryId: "market-snapshot-v1",
          },
          positionCount: 5,
          positions,
        });
        await state.corroborateSnapshot(snapshot);
        const config = await state.read({
          executor,
          operator,
          target: market,
          changeHash: `0x${"0".repeat(64)}`,
        });
        return createPreflight({
          snapshot,
          stressBps: 1500,
          validation: { validatedAt: now(), headBlock: config.block.number },
          intentCore: {
            schemaVersion: "paramshield.intent.v2",
            chainId: 11155111,
            executor,
            operator,
            target: market,
            value: "0",
            calldata: encodeThreshold(threshold),
            currentValueBps: snapshot.liquidationThresholdBps,
            proposedValueBps: threshold,
            nonce: String(++nonce),
            expectedStateVersion: config.stateVersion,
            expectedAuthorizationEpoch: config.authorizationEpoch,
            expiresAt: now() + 240,
            reason:
              "Anvil-only integration fixture; NOT hosted Graph or public Sepolia",
          },
        }).preflight;
      });
      const data = readTrustedRun(run),
        bound = validateExecutionResult(data.result, data.request, {
          runId: run.runId,
          policyVersion: DEMO_POLICY.version,
          now: now(),
        });
      assert.equal(
        bound.decision.verdict,
        threshold === 7000 ? "BLOCK" : "ALLOW",
      );
      const i = bound.intent;
      const intent = {
        chainId: 11155111n,
        target: i.target,
        value: 0n,
        data: i.calldata,
        nonce: BigInt(i.nonce),
        evidenceHash: i.evidenceHash,
        expectedStateVersion: BigInt(i.expectedStateVersion),
        expectedAuthorizationEpoch: BigInt(i.expectedAuthorizationEpoch),
        expiresAt: BigInt(i.expiresAt),
      };
      const proposeHash = await wallet.writeContract({
        account: operator,
        address: executor,
        abi: EXECUTOR_ABI,
        functionName: "propose",
        args: [intent],
      });
      assert.equal(
        (
          await client.waitForTransactionReceipt({
            hash: proposeHash,
            pollingInterval: 100,
          })
        ).status,
        "success",
      );
      const decisionHash = await wallet.writeContract({
        account: authority,
        address: executor,
        abi: EXECUTOR_ABI,
        functionName: "recordDecision",
        args: [
          bound.changeHash,
          threshold === 7000 ? 2 : 1,
          bound.decisionHash,
        ],
      });
      assert.equal(
        (
          await client.waitForTransactionReceipt({
            hash: decisionHash,
            pollingInterval: 100,
          })
        ).status,
        "success",
      );
      if (threshold === 7000) {
        await assert.rejects(
          prepareRelaySigning({ run, client, target, approvals, now }),
          /Only ALLOW/,
        );
        await assert.rejects(
          client.simulateContract({
            account: operator,
            address: executor,
            abi: EXECUTOR_ABI,
            functionName: "execute",
            args: [intent],
          }),
        );
        checks.push(
          "actual-CRE-BLOCK",
          "contract-rejects-blocked-intent",
          "relay-rejects-BLOCK-before-signing",
        );
      } else {
        await assert.rejects(
          prepareRelaySigning({ run, client, target, approvals, now }),
          /persisted human review/,
        );
        const approvedAt = now(),
          typed = reviewTypedData(bound.preflight, bound.decision, approvedAt);
        // The ephemeral Anvil account signs EIP-712 through unlocked local RPC;
        // this tests signature authentication, NOT a real human or Privy quorum.
        const signature = await wallet.signTypedData({
          account: reviewer,
          ...typed,
        });
        await approvals.record(
          bound.preflight,
          bound.decision,
          approvedAt,
          signature,
        );
        const prepared = await prepareRelaySigning({
          run,
          client,
          target,
          approvals,
          now,
        });
        let calls = 0;
        const signer: TransactionSigner = {
          async sign(p) {
            calls++;
            // Local Anvil sign-only RPC, never Privy or a user private key.
            return wallet.request({
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
            });
          },
        };
        const signed = await signs.sign(
          bound.changeHash,
          prepared.plan,
          signer,
          prepared.revalidate,
        );
        const duplicate = await signs.sign(
          bound.changeHash,
          prepared.plan,
          signer,
          prepared.revalidate,
        );
        assert.equal(calls, 1);
        assert.equal(duplicate.transactionHash, signed.transactionHash);
        assert.equal(duplicate.reused, true);
        // Exercise a real epoch rotation on Anvil before any submission. The
        // signing service has no broadcaster, and must not reuse this signature.
        const adminAbi = parseAbi([
          "function setAllowedCall(address,bytes4,bool)",
        ]);
        const rotated = await wallet.writeContract({
          account: admin,
          address: executor,
          abi: adminAbi,
          functionName: "setAllowedCall",
          args: [market, "0x4d5bcf96", true],
        });
        await client.waitForTransactionReceipt({
          hash: rotated,
          pollingInterval: 100,
        });
        await assert.rejects(
          signs.sign(
            bound.changeHash,
            prepared.plan,
            signer,
            prepared.revalidate,
          ),
          /preconditions/,
        );
        const lt = await client.readContract({
          address: market,
          abi: MARKET_ABI,
          functionName: "liquidationThresholdBps",
        });
        assert.equal(lt, 8000);
        checks.push(
          "actual-CRE-ALLOW",
          "missing-review-blocks",
          "RPC-EIP712-review-recovery",
          "relay-real-nonce-gas-balance-checks",
          "exact-local-signature-and-durable-idempotency",
          "real-epoch-rotation-blocks-signature-reuse",
          "no-execute-broadcast-or-parameter-change",
        );
      }
      runs.push({
        run,
        changeHash: bound.changeHash,
        preflightHash: bound.preflightHash,
        snapshotProvenance:
          "synthetic-Graph-envelope-over-owned-Anvil-RPC-only",
      });
    }
    const evidence = {
      checkedAt: new Date().toISOString(),
      kind: "anvil-only-v2-cre-relay-integration",
      network: "owned ephemeral Anvil, NOT public Sepolia",
      configuredChainId: 11155111,
      anvilBlockTimeSeconds: 12,
      hostedGraphProviderVerified: false,
      realHumanApproval: false,
      privyUsedInThisHarness: false,
      hardwareTeeAttested: false,
      publicNetworkTransactionsSent: false,
      executeBroadcast: false,
      bootstrap: {
        estimatedGas: estimatedGas.toString(),
        gasUsed: deployment.gasUsed.toString(),
        initcodeBytes: (initcode.length - 2) / 2,
      },
      checks,
      runs,
    };
    await writeFile(
      join(root, "docs/evidence/relay-anvil-only-2026-09-08.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    // Only stop the child we started; leave local Graph/other nodes untouched.
    if (anvil.exitCode === null && anvil.pid) {
      anvil.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        anvil.once("exit", () => resolve());
        setTimeout(() => {
          anvil.kill("SIGKILL");
          resolve();
        }, 2000).unref();
      });
    }
  }
}
main().catch(async (e: unknown) => {
  await new DurableStore(join(root, ".local/anvil-relay")).write(
    "last-failure",
    {
      checkedAt: new Date().toISOString(),
      message: e instanceof Error ? e.message : "Non-Error failure",
      stack: e instanceof Error ? e.stack : null,
    },
  );
  console.error(
    JSON.stringify({
      integration: "anvil-only-relay",
      status: "failed",
      reason:
        e instanceof Error && /^(Explicit|Owned)/.test(e.message)
          ? e.message
          : "Validation failed; raw RPC/runner details omitted",
    }),
  );
  process.exitCode = 1;
});
