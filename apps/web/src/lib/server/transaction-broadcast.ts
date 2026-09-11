import type { Hex } from "viem";
import { hashCanonical } from "@paramshield/evidence";
import { DurableStore } from "./durable-store";
import {
  validateSigningPlan,
  verifySignedTransaction,
  type SigningPlan,
} from "./transaction-signing";
import type { SepoliaClient } from "./rpc-adapter";
import {
  MinedTransactionValidationError,
  verifyDecisionWalletWrapper,
  MM_MANAGER,
} from "./decision-7702";

/** An RPC hash or a UI "success" is insufficient. Compare the complete mined
 * envelope and canonical receipt before any lifecycle/evidence progression. */
export async function verifyMinedTransaction(
  client: SepoliaClient,
  plan: SigningPlan,
  hash: Hex,
  options: { decisionWallet?: boolean } = {},
) {
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash }),
    client.getTransactionReceipt({ hash }),
  ]);
  if (
    receipt.status !== "success" ||
    tx.hash !== hash ||
    receipt.transactionHash !== hash ||
    tx.chainId !== plan.chainId ||
    tx.from.toLowerCase() !== plan.from.toLowerCase() ||
    tx.value !== 0n ||
    tx.nonce !== plan.nonce ||
    tx.maxFeePerGas !== BigInt(plan.maxFeePerGas) ||
    tx.maxPriorityFeePerGas !== BigInt(plan.maxPriorityFeePerGas) ||
    (tx.accessList?.length ?? 0) !== 0 ||
    receipt.from.toLowerCase() !== plan.from.toLowerCase() ||
    receipt.to?.toLowerCase() !== tx.to?.toLowerCase() ||
    tx.blockHash !== receipt.blockHash ||
    tx.blockNumber !== receipt.blockNumber
  )
    throw new MinedTransactionValidationError("ENVELOPE_MISMATCH");
  if (
    options.decisionWallet &&
    (tx.type === "eip7702" ||
      (tx.type === "eip1559" && tx.to?.toLowerCase() === MM_MANAGER))
  ) {
    await verifyDecisionWalletWrapper(client, plan, tx, receipt.blockNumber);
  } else if (
    tx.type !== "eip1559" ||
    tx.to?.toLowerCase() !== plan.to.toLowerCase() ||
    tx.input !== plan.data ||
    tx.gas !== BigInt(plan.gas)
  )
    throw new MinedTransactionValidationError("ENVELOPE_MISMATCH");
  if (
    (await client.getChainId()) !== 11155111 ||
    (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
      receipt.blockHash
  )
    throw new Error("Receipt chain mismatch or reorg");
  return receipt;
}

type BroadcastRecord = {
  state: "BROADCASTING" | "SUBMITTED" | "UNKNOWN" | "CONFIRMED";
  planHash: Hex;
  transactionHash: Hex;
  blockNumber?: string;
  blockHash?: Hex;
};
export class DurableBroadcastService {
  constructor(
    readonly store: DurableStore,
    readonly signed: DurableStore,
    readonly now: () => number,
  ) {}
  async send(
    jobId: string,
    input: SigningPlan,
    client: SepoliaClient,
    revalidate: () => Promise<void>,
  ) {
    const plan = validateSigningPlan(input),
      planHash = hashCanonical(plan);
    return this.store.exclusive(`broadcast-${jobId}`, async () => {
      const key = `broadcast-${jobId}`;
      const prior = (await this.store.read(key)) as BroadcastRecord | null;
      if (prior) {
        if (prior.planHash !== planHash)
          throw new Error("Broadcast binding mismatch");
        if (prior.state !== "CONFIRMED")
          throw new Error(
            "Broadcast requires receipt recovery; never automatically resend",
          );
        return verifyMinedTransaction(client, plan, prior.transactionHash);
      }
      const job = (await this.signed.read(`job-${jobId}`)) as {
        state: string;
        planHash: Hex;
        signedTransaction?: Hex;
        transactionHash?: Hex;
      } | null;
      if (
        !job ||
        job.state !== "SIGNED" ||
        job.planHash !== planHash ||
        !job.signedTransaction ||
        !job.transactionHash
      )
        throw new Error("Verified durable signature required");
      const hash = await verifySignedTransaction(job.signedTransaction, plan);
      if (hash !== job.transactionHash)
        throw new Error("Stored signature hash changed");
      await revalidate();
      if (this.now() >= plan.expiresAt)
        throw new Error("Expired before broadcast");
      const record: BroadcastRecord = {
        state: "BROADCASTING",
        planHash,
        transactionHash: hash,
      };
      await this.store.write(key, record);
      try {
        // No automatic RPC retry. An uncertain response is reconciled by hash,
        // not by signing or broadcasting a replacement transaction.
        const returned = await client.sendRawTransaction({
          serializedTransaction: job.signedTransaction,
        });
        if (returned !== hash) throw new Error("Unexpected broadcast hash");
        record.state = "SUBMITTED";
        await this.store.write(key, record);
      } catch {
        record.state = "UNKNOWN";
        await this.store.write(key, record);
        throw new Error(
          "Broadcast outcome unknown; inspect the recorded hash before recovery",
        );
      }
      await client.waitForTransactionReceipt({
        hash,
        confirmations: 2,
        timeout: 60_000,
        pollingInterval: 3000,
      });
      const receipt = await verifyMinedTransaction(client, plan, hash);
      record.state = "CONFIRMED";
      record.blockNumber = receipt.blockNumber.toString();
      record.blockHash = receipt.blockHash;
      await this.store.write(key, record);
      return receipt;
    });
  }
}
