import { describe, expect, it } from "vitest";
import { changeIntentSchema, uint256Schema, verdictSchema } from "./index";
const address = `0x${"1".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const intent = {
  schemaVersion: "paramshield.intent.v2",
  executor: address,
  operator: address,
  chainId: 11155111,
  target: address,
  value: "0",
  calldata: `0x4d5bcf96${"0".repeat(60)}1b58`,
  currentValueBps: 8000,
  proposedValueBps: 7000,
  nonce: "1",
  expectedStateVersion: "6",
  expectedAuthorizationEpoch: "1",
  expiresAt: 1800000000,
  reason: "Decrease LT",
  evidenceHash: hash,
};
describe("strict transport", () => {
  it("accepts the exact versioned transport", () =>
    expect(changeIntentSchema.parse(intent).nonce).toBe("1"));
  it.each(["demo-1", "01", "-1", "1.2", (1n << 256n).toString()])(
    "rejects invalid uint %s",
    (value) => expect(uint256Schema.safeParse(value).success).toBe(false),
  );
  it("rejects unsupported value, missing preconditions and unknown secret fields", () => {
    expect(
      changeIntentSchema.safeParse({ ...intent, proposedValueBps: 4900 })
        .success,
    ).toBe(false);
    expect(
      changeIntentSchema.safeParse({
        ...intent,
        expectedStateVersion: undefined,
      }).success,
    ).toBe(false);
    expect(
      changeIntentSchema.safeParse({ ...intent, privateKey: "secret" }).success,
    ).toBe(false);
  });
  it("rejects an invented verdict", () =>
    expect(verdictSchema.safeParse({ verdict: "PROCEED_ANYWAY" }).success).toBe(
      false,
    ));
});
