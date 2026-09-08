import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { PrivyClient } from "@privy-io/node";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { hashCanonical } from "@paramshield/evidence";
import { DurableStore } from "../src/lib/server/durable-store";
import { EXECUTOR_ABI } from "../src/lib/server/rpc-adapter";
import { exactExecutionPolicy } from "../src/lib/server/execution-policy";
import {
  privySigner,
  verifySignedTransaction,
  type SigningPlan,
} from "../src/lib/server/transaction-signing";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const disk = new DurableStore(join(root, ".local/privy-v2-proof"));
type State = {
  expiresAt: number;
  policyId?: string;
  walletId?: string;
  address?: Address;
};
async function main() {
  if (!process.argv.includes("--create-isolated-test-wallet"))
    throw new Error("Explicit isolated test flag required");
  process.loadEnvFile(join(root, ".env.local"));
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Local credentials missing");
  const client = new PrivyClient({
    appId,
    appSecret,
    maxRetries: 0,
    timeout: 15000,
  });
  await disk.exclusive("provider-proof", async () => {
    const state = ((await disk.read("resources")) as State | null) ?? {
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
    };
    await disk.write("resources", state);
    // Existing v1 target is used ONLY as a no-role, unfunded sign-only ABI probe.
    // The v2 selector cannot execute there. No preflight/approval/chain tx claimed.
    const target: Address = "0xf5523bdb15d353abce276bf6ae02c1c7244381d2";
    const intent = {
      chainId: 11155111n,
      target: "0xfabda359d272974f6561e907a4bb740b11a9fc26" as Address,
      value: 0n,
      data: "0x4d5bcf960000000000000000000000000000000000000000000000000000000000001f06" as Hex,
      nonce: 1n,
      evidenceHash: `0x${"1".repeat(64)}` as Hex,
      expectedStateVersion: 7n,
      expectedAuthorizationEpoch: 1n,
      expiresAt: BigInt(state.expiresAt),
    };
    const data = encodeFunctionData({
      abi: EXECUTOR_ABI,
      functionName: "execute",
      args: [intent],
    });
    const policy = exactExecutionPolicy(target, data),
      policyHash = hashCanonical(policy);
    if (!state.policyId) {
      const p = await client.policies().create({
        ...policy,
        idempotency_key: `paramshield-v2-tuple-${policyHash.slice(2)}`,
      });
      state.policyId = p.id;
      await disk.write("resources", state);
    }
    if (!state.walletId) {
      const w = await client.wallets().create({
        chain_type: "ethereum",
        display_name: "ParamShield isolated v2 tuple control proof",
        external_id: "paramshield-v2-control-proof-20260908",
        policy_ids: [state.policyId],
        idempotency_key: "paramshield-v2-control-wallet-20260908",
      });
      state.walletId = w.id;
      state.address = w.address as Address;
      await disk.write("resources", state);
    }
    if (!state.address) throw new Error("Missing isolated wallet address");
    const plan: SigningPlan = {
      chainId: 11155111,
      from: state.address,
      to: target,
      value: "0",
      data,
      nonce: 0,
      gas: "180000",
      maxFeePerGas: "2000000000",
      maxPriorityFeePerGas: "1000000000",
      expiresAt: state.expiresAt,
    };
    const raw = await privySigner(client, state.walletId, state.policyId).sign(
      plan,
      `paramshield-v2-allowed-${policyHash.slice(2)}`,
    );
    const transactionHash = await verifySignedTransaction(raw, plan);
    // No raw signed bytes are logged or saved, even in this unfunded proof.
    const mutations: [string, Record<string, unknown>][] = [
      ["outer-chain", { chain_id: 1 }],
      ["outer-target", { to: "0x0000000000000000000000000000000000000001" }],
      ["outer-value", { value: "0x1" }],
      ...Object.entries({
        chainId: 1n,
        target: "0x0000000000000000000000000000000000000001",
        value: 1n,
        data: "0x12345678",
        nonce: 2n,
        evidenceHash: `0x${"2".repeat(64)}`,
        expectedStateVersion: 8n,
        expectedAuthorizationEpoch: 2n,
        expiresAt: BigInt(state.expiresAt) + 1n,
      }).map(([name, value]): [string, Record<string, unknown>] => [
        `intent-${name}`,
        {
          data: encodeFunctionData({
            abi: EXECUTOR_ABI,
            functionName: "execute",
            args: [{ ...intent, [name]: value }],
          }),
        },
      ]),
      [
        "wrong-function",
        {
          data: encodeFunctionData({
            abi: EXECUTOR_ABI,
            functionName: "propose",
            args: [intent],
          }),
        },
      ],
    ];
    const denied = [];
    for (const [name, change] of mutations) {
      try {
        await client
          .wallets()
          .ethereum()
          .signTransaction(state.walletId, {
            params: {
              transaction: {
                type: 2,
                chain_id: 11155111,
                to: target,
                value: "0x0",
                data,
                nonce: 0,
                gas_limit: "0x2bf20",
                max_fee_per_gas: "0x77359400",
                max_priority_fee_per_gas: "0x3b9aca00",
                ...change,
              },
            },
          });
        throw new Error("Unexpected provider allow");
      } catch (e) {
        const error = e as {
          status?: number;
          error?: unknown;
          message?: string;
        };
        if (
          ![400, 403].includes(error.status ?? 0) ||
          !/polic(y|ies)/i.test(
            JSON.stringify(error.error ?? {}) + " " + (error.message ?? ""),
          )
        )
          throw new Error(
            `Control proof failed at ${name}; no policy denial verified`,
          );
        denied.push({
          case: name,
          result: "provider-policy-denied",
          httpStatus: error.status,
        });
      }
    }
    const evidence = {
      checkedAt: new Date().toISOString(),
      kind: "privy-v2-tuple-isolated-sign-only",
      sdk: "@privy-io/node 0.34.0",
      walletAddress: state.address,
      policyHash,
      tuplePathsVerified: true,
      allowed: {
        signatureAndAllTransactionFieldsVerified: true,
        transactionHash,
      },
      denied,
      broadcast: false,
      funded: false,
      chainRoleAssigned: false,
      humanReviewVerified: false,
      limitations: [
        "Synthetic v2 calldata only; target is preserved v1, NOT a live v2 execution",
        "App-managed exact intent policy; fee/nonce checks are in the trusted server, not provider policy",
        "No organization quorum, hosted Graph, CRE result or end-to-end approval proven",
      ],
    };
    await writeFile(
      join(root, "docs/evidence/privy-v2-control-2026-09-08.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence, null, 2));
  });
}
main().catch((e: unknown) => {
  const error = e as { status?: number; message?: string };
  console.error(
    JSON.stringify({
      integration: "privy-v2-control",
      status: "failed",
      httpStatus: error.status ?? null,
      reason:
        error.message?.startsWith("Control proof") ||
        error.message?.startsWith("Explicit")
          ? error.message
          : "Provider/configuration failed; details redacted. No broadcast.",
    }),
  );
  process.exitCode = 1;
});
