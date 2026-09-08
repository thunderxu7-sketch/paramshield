import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { hashCanonical } from "@paramshield/evidence";
import { PrivyClient } from "@privy-io/node";
import { DurableStore } from "./durable-store";
import {
  exactExecutionPolicy,
  executionPolicyFingerprint,
} from "./execution-policy";

/** Internal server plan. Never accept this object as an unauthenticated HTTP body.
 * Production plans come ONLY from prepareExecutionCall + live nonce/gas reads. */
export interface SigningPlan {
  chainId: 11155111;
  from: Address;
  to: Address;
  value: "0";
  data: Hex;
  nonce: number;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  expiresAt: number;
}
export function validateSigningPlan(input: SigningPlan): SigningPlan {
  const p = structuredClone(input);
  if (
    p.chainId !== 11155111 ||
    p.value !== "0" ||
    !Number.isSafeInteger(p.nonce) ||
    p.nonce < 0 ||
    !Number.isSafeInteger(p.expiresAt) ||
    p.expiresAt <= 0
  )
    throw new Error("Invalid signing plan");
  for (const a of [p.from, p.to])
    if (!/^0x[0-9a-fA-F]{40}$/.test(a) || BigInt(a) === 0n)
      throw new Error("Invalid signing address");
  if (!/^0x(?:[0-9a-f]{2}){4,4096}$/.test(p.data))
    throw new Error("Invalid signing calldata");
  for (const n of [p.gas, p.maxFeePerGas, p.maxPriorityFeePerGas])
    if (!/^(0|[1-9][0-9]{0,20})$/.test(n))
      throw new Error("Invalid signing quantity");
  if (
    BigInt(p.gas) < 21000n ||
    BigInt(p.gas) > 1_000_000n ||
    BigInt(p.maxFeePerGas) > 50_000_000_000n ||
    BigInt(p.maxFeePerGas) === 0n ||
    BigInt(p.maxPriorityFeePerGas) > BigInt(p.maxFeePerGas)
  )
    throw new Error("Signing gas/fee budget exceeded");
  return Object.freeze(p);
}
export function viemTransaction(p: SigningPlan) {
  return {
    type: "eip1559" as const,
    chainId: p.chainId,
    to: p.to,
    value: 0n,
    data: p.data,
    nonce: p.nonce,
    gas: BigInt(p.gas),
    maxFeePerGas: BigInt(p.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(p.maxPriorityFeePerGas),
    accessList: [],
  };
}
/** Recover and compare EVERY signed field; never broadcast a provider response
 * merely because the HTTP call or signature recovery succeeded. */
export async function verifySignedTransaction(raw: Hex, plan: SigningPlan) {
  if (!/^0x(?:[0-9a-fA-F]{2}){1,8192}$/.test(raw))
    throw new Error("Invalid serialized transaction");
  const p = validateSigningPlan(plan),
    tx = parseTransaction(raw as TransactionSerialized);
  const from = await recoverTransactionAddress({
    serializedTransaction: raw as TransactionSerialized,
  });
  if (
    tx.type !== "eip1559" ||
    tx.chainId !== p.chainId ||
    from.toLowerCase() !== p.from.toLowerCase() ||
    tx.to?.toLowerCase() !== p.to.toLowerCase() ||
    (tx.value ?? 0n) !== 0n ||
    tx.data !== p.data ||
    tx.nonce !== p.nonce ||
    tx.gas !== BigInt(p.gas) ||
    tx.maxFeePerGas !== BigInt(p.maxFeePerGas) ||
    tx.maxPriorityFeePerGas !== BigInt(p.maxPriorityFeePerGas) ||
    (tx.accessList?.length ?? 0) !== 0
  )
    throw new Error("Signed transaction does not match reviewed plan");
  return keccak256(raw);
}
export interface TransactionSigner {
  sign(plan: SigningPlan, idempotencyKey: string): Promise<Hex>;
}
export function privySigner(
  client: PrivyClient,
  walletId: string,
  policyId: string,
): TransactionSigner {
  return {
    async sign(plan, idempotencyKey) {
      const p = validateSigningPlan(plan);
      const wallet = await client.wallets().get(walletId);
      if (
        wallet.address.toLowerCase() !== p.from.toLowerCase() ||
        wallet.policy_ids?.length !== 1 ||
        wallet.policy_ids[0] !== policyId
      )
        throw new Error("Configured Privy wallet/policy mismatch");
      const policy = await client.policies().get(policyId);
      if (
        executionPolicyFingerprint(policy) !==
        executionPolicyFingerprint(exactExecutionPolicy(p.to, p.data))
      )
        throw new Error(
          "Privy policy no longer matches the exact reviewed intent",
        );
      const result = await client
        .wallets()
        .ethereum()
        .signTransaction(walletId, {
          idempotency_key: idempotencyKey,
          params: {
            transaction: {
              type: 2,
              chain_id: p.chainId,
              to: p.to,
              value: "0x0",
              data: p.data,
              nonce: p.nonce,
              gas_limit: toHex(BigInt(p.gas)),
              max_fee_per_gas: toHex(BigInt(p.maxFeePerGas)),
              max_priority_fee_per_gas: toHex(BigInt(p.maxPriorityFeePerGas)),
            },
          },
        });
      return result.signed_transaction as TransactionSerialized;
    },
  };
}
type SigningJob = {
  schemaVersion: "paramshield.signing-job.v1";
  planHash: Hex;
  plan: SigningPlan;
  state: "SIGNING" | "SIGNED" | "UNKNOWN" | "QUARANTINED";
  transactionHash?: Hex;
  signedTransaction?: Hex;
};
/** Single-host, sign-only coordinator. Persists intent BEFORE any provider call.
 * Timeout/crash/ambiguity permanently holds the nonce until operator recovery.
 * It has NO broadcast method and returns NO raw transaction to the UI. */
export class DurableSigningService {
  constructor(
    readonly store: DurableStore,
    readonly now: () => number,
    readonly timeoutMs = 20_000,
  ) {
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 60_000
    )
      throw new Error("Invalid signing timeout");
  }
  async sign(
    jobId: string,
    input: SigningPlan,
    signer: TransactionSigner,
    revalidate: () => Promise<void>,
  ) {
    const plan = validateSigningPlan(input),
      planHash = hashCanonical(plan);
    const fresh = () => {
      if (this.now() >= plan.expiresAt) throw new Error("Signing plan expired");
    };
    const key = `job-${jobId}`;
    return this.store.exclusive(key, async () => {
      const existing = (await this.store.read(key)) as SigningJob | null;
      if (existing) {
        if (
          existing.schemaVersion !== "paramshield.signing-job.v1" ||
          existing.planHash !== planHash ||
          hashCanonical(existing.plan) !== planHash
        )
          throw new Error("Signing job binding mismatch");
        if (existing.state !== "SIGNED" || !existing.signedTransaction)
          throw new Error(
            "Signing job requires manual recovery; no automatic retry",
          );
        const transactionHash = await verifySignedTransaction(
          existing.signedTransaction,
          plan,
        );
        if (transactionHash !== existing.transactionHash)
          throw new Error("Stored transaction hash mismatch");
        try {
          fresh();
          await revalidate();
          fresh();
        } catch {
          existing.state = "QUARANTINED";
          await this.store.write(key, existing);
          throw new Error(
            "Stored signature quarantined; execution preconditions changed",
          );
        }
        return { state: "SIGNED" as const, transactionHash, reused: true };
      }
      fresh();
      await revalidate();
      fresh();
      const nonceKey = `nonce-${plan.chainId}-${plan.from.toLowerCase()}-${plan.nonce}`;
      // Reservations are never automatically released, even on a provider error.
      // This prevents a different job from replacing an uncertain transaction.
      await this.store.exclusive(nonceKey, async () => {
        if (await this.store.read(nonceKey))
          throw new Error(
            "Wallet nonce already reserved; inspect recovery state",
          );
        await this.store.write(nonceKey, { jobId, planHash });
      });
      const job: SigningJob = {
        schemaVersion: "paramshield.signing-job.v1",
        planHash,
        plan,
        state: "SIGNING",
      };
      await this.store.write(key, job);
      let timer: NodeJS.Timeout | undefined;
      try {
        // Timeout cannot cancel the remote request: UNKNOWN is deliberately not
        // retryable. A late signature is discarded; the nonce remains held.
        const raw = await Promise.race([
          signer.sign(plan, `paramshield-${planHash.slice(2)}`),
          new Promise<never>((_r, reject) => {
            timer = setTimeout(
              () => reject(new Error("Signing timeout")),
              this.timeoutMs,
            );
          }),
        ]);
        if (timer) clearTimeout(timer);
        const transactionHash = await verifySignedTransaction(raw, plan);
        job.signedTransaction = raw;
        job.transactionHash = transactionHash;
        try {
          fresh();
          await revalidate();
          fresh();
        } catch {
          job.state = "QUARANTINED";
          await this.store.write(key, job);
          throw new Error(
            "Signed transaction quarantined; approval/state changed",
          );
        }
        job.state = "SIGNED";
        await this.store.write(key, job);
        return { state: "SIGNED" as const, transactionHash, reused: false };
      } catch {
        if (job.state !== "QUARANTINED") {
          job.state = "UNKNOWN";
          await this.store.write(key, job);
        }
        throw new Error(
          "Signing incomplete; inspect durable recovery state, no retry or broadcast",
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
  }
}
