import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrivyClient } from "@privy-io/node";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";
import {
  signingSpikePolicy,
  SPIKE_CALLDATA,
} from "../src/lib/privy-spike-policy";

const root = new URL("../../../", import.meta.url);
const stateUrl = new URL(".local/privy-control-spike.json", root);
const target = "0xf5523bdb15d353abce276bf6ae02c1c7244381d2";
type State = { policyId?: string; walletId?: string; address?: string };
async function save(s: State) {
  await mkdir(new URL(".local/", root), { recursive: true, mode: 0o700 });
  await writeFile(stateUrl, JSON.stringify(s), { mode: 0o600 });
  await chmod(stateUrl, 0o600);
}
async function main() {
  if (!process.argv.includes("--create-test-wallet"))
    throw new Error("Explicit --create-test-wallet flag required");
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Local Privy credentials missing");
  const client = new PrivyClient({
    appId,
    appSecret,
    maxRetries: 0,
    timeout: 15000,
  });
  let state: State = {};
  try {
    state = JSON.parse(await readFile(stateUrl, "utf8")) as State;
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  if (!state.policyId) {
    const policy = await client.policies().create({
      ...signingSpikePolicy(target),
      idempotency_key: "paramshield-signing-policy-spike-20260907-v2",
    });
    state.policyId = policy.id;
    await save(state);
  }
  if (!state.walletId) {
    const wallet = await client.wallets().create({
      chain_type: "ethereum",
      display_name: "ParamShield isolated Sepolia control proof",
      external_id: "paramshield-control-spike-20260907-v2",
      policy_ids: [state.policyId],
      idempotency_key: "paramshield-signing-wallet-spike-20260907-v2",
    });
    state.walletId = wallet.id;
    state.address = wallet.address;
    await save(state);
  }
  const wallet = await client.wallets().get(state.walletId);
  if (!wallet.policy_ids?.includes(state.policyId))
    throw new Error("Provider wallet is not attached to expected policy");
  const transaction = {
    chain_id: 11155111,
    to: target,
    value: "0x0",
    data: SPIKE_CALLDATA,
    nonce: 0,
    gas_limit: "0x5208",
    gas_price: "0x3b9aca00",
    type: 0 as const,
  };
  const allowed = await client
    .wallets()
    .ethereum()
    .signTransaction(state.walletId, { params: { transaction } });
  const serialized = allowed.signed_transaction as TransactionSerialized;
  const recovered = await recoverTransactionAddress({
    serializedTransaction: serialized,
  });
  const decoded = parseTransaction(serialized);
  if (
    recovered.toLowerCase() !== wallet.address.toLowerCase() ||
    decoded.chainId !== 11155111 ||
    decoded.to?.toLowerCase() !== target ||
    (decoded.value ?? 0n) !== 0n ||
    decoded.data !== SPIKE_CALLDATA
  )
    throw new Error("Signed payload mismatch");
  const denied = [];
  for (const [name, mutation] of [
    ["wrong-chain", { chain_id: 1 }],
    ["wrong-target", { to: "0x0000000000000000000000000000000000000001" }],
    ["nonzero-value", { value: "0x1" }],
    ["wrong-calldata-argument", { data: SPIKE_CALLDATA.slice(0, -1) + "1" }],
  ] as const) {
    try {
      await client
        .wallets()
        .ethereum()
        .signTransaction(state.walletId, {
          params: { transaction: { ...transaction, ...mutation } },
        });
      throw new Error("Policy unexpectedly allowed forbidden input");
    } catch (e) {
      const error = e as {
        status?: number;
        error?: { code?: string; error?: string };
        message?: string;
      };
      // Inspect only for classification, never log potentially credential-bearing bodies.
      const isPolicy =
        [400, 403].includes(error.status ?? 0) &&
        /polic(y|ies)/i.test(
          JSON.stringify(error.error ?? {}) + " " + (error.message ?? ""),
        );
      if (!isPolicy)
        throw new Error(
          `Control proof failed at ${name}; status ${error.status ?? "unknown"}`,
        );
      denied.push({
        case: name,
        result: "provider-policy-denied",
        status: error.status,
      });
    }
  }
  const result = {
    checkedAt: new Date().toISOString(),
    provider: "privy",
    sdk: "@privy-io/node 0.34.0",
    mode: "isolated-sign-only-spike",
    walletAddress: wallet.address,
    policyAttached: true,
    allowed: {
      signatureRecovered: true,
      chainId: decoded.chainId,
      transactionDigest: keccak256(serialized),
      broadcast: false,
    },
    denied,
    limitations: [
      "No chain broadcast, funding, operator role, human approval or quorum proved",
      "App-managed test policy; final execution policy and independent decision authority are separate gates",
    ],
  };
  await mkdir(new URL("docs/evidence/", root), { recursive: true });
  await writeFile(
    new URL("docs/evidence/privy-control-spike-2026-09-07.json", root),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  console.log(
    `Local resource IDs persisted in ignored ${fileURLToPath(stateUrl)}`,
  );
}
main().catch((e: unknown) => {
  const error = e as { status?: number; message?: string };
  console.error(
    JSON.stringify({
      integration: "privy-control",
      status: "failed",
      httpStatus: error.status ?? null,
      reason:
        error.message?.startsWith("Control proof") ||
        error.message?.startsWith("Explicit") ||
        error.message?.startsWith("Local")
          ? error.message
          : "Provider/setup request failed; raw response omitted",
    }),
  );
  process.exitCode = 1;
});
