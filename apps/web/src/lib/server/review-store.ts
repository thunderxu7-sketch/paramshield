import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { hashCanonical, bindDecision } from "@paramshield/evidence";
import type { ExecutionApprovalStore } from "../execution-preflight";
import { DurableStore } from "./durable-store";
const TYPES = {
  ParamShieldReview: [
    { name: "changeHash", type: "bytes32" },
    { name: "preflightHash", type: "bytes32" },
    { name: "decisionHash", type: "bytes32" },
    { name: "approvedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;
export function reviewTypedData(
  preflight: unknown,
  decision: unknown,
  approvedAt: number,
) {
  const b = bindDecision(preflight, decision);
  if (
    b.decision.verdict !== "ALLOW" ||
    !Number.isSafeInteger(approvedAt) ||
    approvedAt < b.preflight.validation.validatedAt ||
    approvedAt >= b.intent.expiresAt
  )
    throw new Error("Invalid approval scope/time");
  return {
    domain: {
      name: "ParamShield review",
      version: "2",
      chainId: b.intent.chainId,
      verifyingContract: b.intent.executor,
    },
    types: TYPES,
    primaryType: "ParamShieldReview" as const,
    message: {
      changeHash: b.changeHash,
      preflightHash: b.preflightHash,
      decisionHash: b.decisionHash,
      approvedAt: BigInt(approvedAt),
      expiresAt: BigInt(b.intent.expiresAt),
    },
  };
}
type Record = {
  schemaVersion: "paramshield.signed-review.v1";
  preflight: unknown;
  decision: unknown;
  approvedAt: number;
  signature: Hex;
  reviewer: Address;
  revoked: boolean;
  digest: Hex;
};
/** Approval authentication is a recovered EIP-712 signature from the configured
 * reviewer set, not an API boolean or the wallet address supplied by a browser. */
export class SignedReviewStore implements ExecutionApprovalStore {
  readonly reviewers: readonly Address[];
  constructor(
    readonly store: DurableStore,
    reviewers: readonly Address[],
    readonly now: () => number,
  ) {
    if (
      !reviewers.length ||
      reviewers.some((a) => !/^0x[0-9a-fA-F]{40}$/.test(a) || BigInt(a) === 0n)
    )
      throw new Error("Configured reviewers required");
    this.reviewers = Object.freeze([...reviewers]);
  }
  private async verify(record: Record) {
    if (
      !record ||
      typeof record !== "object" ||
      record.revoked !== false ||
      typeof record.signature !== "string" ||
      !/^0x[0-9a-fA-F]{130}$/.test(record.signature) ||
      typeof record.reviewer !== "string"
    )
      throw new Error("Invalid review record");
    const { digest, ...payload } = record;
    if (
      record.schemaVersion !== "paramshield.signed-review.v1" ||
      record.revoked ||
      hashCanonical(payload) !== digest
    )
      throw new Error("Invalid/revoked review record");
    const typed = reviewTypedData(
      record.preflight,
      record.decision,
      record.approvedAt,
    );
    const reviewer = await recoverTypedDataAddress({
      ...typed,
      signature: record.signature,
    });
    if (
      !this.reviewers.some((a) => a.toLowerCase() === reviewer.toLowerCase()) ||
      reviewer.toLowerCase() !== record.reviewer.toLowerCase() ||
      record.approvedAt > this.now() ||
      Number(typed.message.expiresAt) <= this.now()
    )
      throw new Error("Unauthorized or expired review");
    const b = bindDecision(record.preflight, record.decision);
    if (reviewer.toLowerCase() === b.intent.operator.toLowerCase())
      throw new Error("Operator cannot self-review");
    return {
      changeHash: b.changeHash,
      preflightHash: b.preflightHash,
      decisionHash: b.decisionHash,
      reviewer,
      approvedAt: record.approvedAt,
    };
  }
  async record(
    preflight: unknown,
    decision: unknown,
    approvedAt: number,
    signature: Hex,
  ) {
    // Copy validated inputs before asynchronous signature recovery; caller-owned
    // objects must not change the durable record while recovery is in flight.
    const bound = bindDecision(preflight, decision);
    preflight = bound.preflight;
    decision = bound.decision;
    const typed = reviewTypedData(preflight, decision, approvedAt);
    const reviewer = await recoverTypedDataAddress({ ...typed, signature });
    const payload = {
      schemaVersion: "paramshield.signed-review.v1" as const,
      preflight,
      decision,
      approvedAt,
      signature,
      reviewer,
      revoked: false,
    };
    const record = { ...payload, digest: hashCanonical(payload) };
    const verified = await this.verify(record);
    return this.store.exclusive(verified.decisionHash, async () => {
      const existing = (await this.store.read(
        verified.decisionHash,
      )) as Record | null;
      if (existing) {
        const prior = await this.verify(existing);
        if (existing.digest !== record.digest)
          throw new Error("Existing review cannot be overwritten");
        return prior;
      }
      await this.store.write(verified.decisionHash, record);
      return verified;
    });
  }
  async get(decisionHash: Hex) {
    const record = (await this.store.read(decisionHash)) as Record | null;
    if (!record) return null;
    const verified = await this.verify(record);
    if (verified.decisionHash !== decisionHash)
      throw new Error("Review lookup mismatch");
    return verified;
  }
}
