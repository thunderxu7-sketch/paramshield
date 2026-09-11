import { bindDecision, hashCanonical } from "@paramshield/evidence";
import { nonzeroAddressSchema } from "@paramshield/shared";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { DurableStore } from "./durable-store";
import {
  authorizationScope,
  authorizationTypedData,
} from "./authorization-scope";
import { ReviewValidationError } from "./review-store";

type Record = {
  schemaVersion: "paramshield.scoped-review.v1";
  preflight: unknown;
  decision: unknown;
  policyHash: Hex;
  approvedAt: number;
  signature: Hex;
  revoked: boolean;
  digest: Hex;
};

/** Separate directory, schema AND EIP-712 domain from the legacy review store.
 * Reloading this signature alone never restores the owned CRE capability. */
export class ScopedReviewStore {
  readonly reviewers: readonly Address[];
  constructor(
    readonly store: DurableStore,
    reviewers: readonly Address[],
    readonly now: () => number,
  ) {
    if (!reviewers.length) throw new Error("Configured reviewers required");
    this.reviewers = Object.freeze(
      reviewers.map((a) => nonzeroAddressSchema.parse(a)),
    );
  }
  private async verify(record: Record) {
    if (
      !record ||
      record.schemaVersion !== "paramshield.scoped-review.v1" ||
      record.revoked !== false ||
      !/^0x[0-9a-fA-F]{130}$/.test(record.signature)
    )
      throw new Error("Invalid or revoked scoped review");
    const { digest, ...payload } = record;
    if (hashCanonical(payload) !== digest)
      throw new Error("Invalid scoped review digest");
    const typed = authorizationTypedData(
      record.preflight,
      record.decision,
      record.policyHash,
      record.approvedAt,
    );
    const reviewer = await recoverTypedDataAddress({
      ...typed,
      signature: record.signature,
    });
    if (!this.reviewers.includes(reviewer.toLowerCase() as Address))
      throw new ReviewValidationError("REVIEW_SIGNER_MISMATCH");
    const b = bindDecision(record.preflight, record.decision);
    if (reviewer.toLowerCase() === b.intent.operator)
      throw new Error("Operator cannot self-review");
    if (record.approvedAt > this.now())
      throw new ReviewValidationError("REVIEW_TIME_IN_FUTURE");
    if (b.intent.expiresAt <= this.now())
      throw new ReviewValidationError("REVIEW_EXPIRED");
    return {
      ...authorizationScope(
        record.preflight,
        record.decision,
        record.policyHash,
      ),
      reviewer,
      approvedAt: record.approvedAt,
    };
  }
  async record(
    preflight: unknown,
    decision: unknown,
    policyHash: Hex,
    approvedAt: number,
    signature: Hex,
  ) {
    const b = bindDecision(preflight, decision);
    const payload = {
      schemaVersion: "paramshield.scoped-review.v1" as const,
      preflight: b.preflight,
      decision: b.decision,
      policyHash,
      approvedAt,
      signature,
      revoked: false,
    };
    const record = { ...payload, digest: hashCanonical(payload) };
    const verified = await this.verify(record);
    return this.store.exclusive(verified.decisionHash, async () => {
      const previous = (await this.store.read(
        verified.decisionHash,
      )) as Record | null;
      if (previous) {
        await this.verify(previous);
        if (previous.digest !== record.digest)
          throw new Error("Existing scoped review cannot be overwritten");
      } else await this.store.write(verified.decisionHash, record);
      return verified;
    });
  }
  async get(decisionHash: Hex) {
    const record = (await this.store.read(decisionHash)) as Record | null;
    if (!record) return null;
    const verified = await this.verify(record);
    if (verified.decisionHash !== decisionHash)
      throw new Error("Scoped review lookup mismatch");
    return verified;
  }
}
