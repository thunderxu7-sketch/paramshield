import { describe, expect, it } from "vitest";
import { signingSpikePolicy } from "./privy-spike-policy";
describe("sign-only Privy control proof", () => {
  it("grants no broadcast, export or arbitrary message method", () => {
    const p = signingSpikePolicy(`0x${"1".repeat(40)}`);
    expect(p.rules.map((r) => r.method)).toEqual(["eth_signTransaction"]);
    expect(p.rules[0]!.conditions).toHaveLength(5);
    expect(p.rules[0]!.conditions.map((c) => [c.field, c.value])).toEqual([
      ["chain_id", "11155111"],
      ["to", `0x${"1".repeat(40)}`],
      ["value", "0"],
      ["function_name", "markExpired"],
      ["markExpired.changeHash", `0x${"0".repeat(64)}`],
    ]);
  });
  it("refuses malformed target addresses", () =>
    expect(() => signingSpikePolicy("not-an-address")).toThrow());
});
