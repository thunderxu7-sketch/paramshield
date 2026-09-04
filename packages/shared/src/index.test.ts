import { describe, expect, it } from "vitest";

import { changeIntentSchema, verdictSchema } from "./index";

const address = `0x${"1".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;

describe("changeIntentSchema", () => {
  it("accepts a bounded liquidation-threshold intent", () => {
    const intent = changeIntentSchema.parse({
      chainId: 11_155_111,
      target: address,
      selector: "0x12345678",
      calldata: "0x12345678",
      currentValueBps: 8_000,
      proposedValueBps: 7_000,
      nonce: "demo-1",
      expiresAt: 1_800_000_000,
      reason: "Reduce liquidation threshold",
    });

    expect(intent.proposedValueBps).toBe(7_000);
  });

  it("rejects values outside the basis-point range", () => {
    expect(() =>
      changeIntentSchema.parse({
        chainId: 11_155_111,
        target: address,
        selector: "0x12345678",
        calldata: "0x12345678",
        currentValueBps: 8_000,
        proposedValueBps: 10_001,
        nonce: "demo-2",
        expiresAt: 1_800_000_000,
        reason: "Invalid threshold",
      }),
    ).toThrow();
  });
});

describe("verdictSchema", () => {
  it("rejects unrecognized execution decisions", () => {
    expect(() =>
      verdictSchema.parse({
        changeId: hash,
        verdict: "PROCEED_ANYWAY",
        policyVersion: "2026-09-05-v1",
        violations: [],
        recommendedValueBps: null,
        evidenceHash: hash,
        expiresAt: 1_800_000_000,
      }),
    ).toThrow();
  });
});
