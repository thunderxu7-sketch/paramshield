import { describe, expect, it } from "vitest";
import {
  assertFreshSnapshot,
  snapshotSchema,
  UINT256_MAX,
} from "@paramshield/shared";
import { simulate } from "./index";
import { assessAndRecommend } from "./policy";
import { demoSnapshot, DEMO_POLICY } from "./fixtures";
const usd = (v: number) => (BigInt(v) * 10n ** 18n).toString();
describe("canonical reference-market risk", () => {
  it.each([
    [8000, 0, 22800, 0],
    [7000, 22800, 48300, 25500],
    [7800, 0, 36300, 13500],
    [7941, 0, 36300, 13500],
    [7942, 0, 22800, 0],
  ])(
    "reproduces integer metrics at LT %s",
    (lt, normal, stress, additional) => {
      const r = simulate(demoSnapshot(), lt!);
      expect(r.proposedNormal.liquidatableDebtUsdE18).toBe(usd(normal!));
      expect(r.proposedStress.liquidatableDebtUsdE18).toBe(usd(stress!));
      expect(r.additionalStressedDebtUsdE18).toBe(usd(additional!));
      expect(r.currentStress.liquidatableDebtUsdE18).toBe(usd(22800));
      expect(r.proposedStress.collateralShortfallUsdE18).toBe("0");
    },
  );
  it("finds 7942 without rounding away the 7941 boundary", () => {
    const r = assessAndRecommend(demoSnapshot(), 7000, DEMO_POLICY);
    expect(r.verdict).toBe("BLOCK");
    expect(r.violations).toHaveLength(3);
    expect(r.recommendedValueBps).toBe(7942);
    expect(assessAndRecommend(demoSnapshot(), 7942, DEMO_POLICY).verdict).toBe(
      "ALLOW",
    );
    expect(assessAndRecommend(demoSnapshot(), 7941, DEMO_POLICY).verdict).toBe(
      "BLOCK",
    );
  });
  it("does not raise LT to game an impossible absolute exposure cap", () => {
    const r = assessAndRecommend(demoSnapshot(), 7000, {
      ...DEMO_POLICY,
      stressExposureMode: "absolute",
    });
    expect(r.recommendationStatus).toBe("NO_SAFE_VALUE");
    expect(r.recommendedValueBps).toBeNull();
  });
  it("returns NO_CHANGE if only current is permitted", () => {
    const r = assessAndRecommend(demoSnapshot(), 7000, {
      ...DEMO_POLICY,
      maxDecreaseBps: 0,
    });
    expect(r.recommendationStatus).toBe("NO_CHANGE");
    expect(r.recommendedValueBps).toBe(8000);
  });
  it("recomputes recommendations when policy or indexed positions change", () => {
    expect(
      assessAndRecommend(demoSnapshot(), 7000, {
        ...DEMO_POLICY,
        maxDecreaseBps: 50,
      }).recommendedValueBps,
    ).toBe(7950);
    const s = demoSnapshot();
    s.positions[2]!.debtAmount = "12000000000";
    s.totalDebt = "66800000000";
    expect(assessAndRecommend(s, 7000, DEMO_POLICY).recommendedValueBps).toBe(
      7800,
    );
  });
  it("produces exact HF=1 without marking the position liquidatable", () => {
    const s = demoSnapshot();
    s.positions = [
      {
        account: s.positions[0]!.account,
        collateralAmount: "10000000000000000000",
        debtAmount: "16000000000",
      },
    ];
    s.totalCollateral = s.positions[0]!.collateralAmount;
    s.totalDebt = s.positions[0]!.debtAmount;
    s.positionCount = 1;
    const r = simulate(s, 8000);
    expect(r.currentNormal.positions[0]!.healthFactorE18).toBe(usd(1));
    expect(r.currentNormal.liquidatableCount).toBe(0);
    expect(simulate(s, 7999).proposedNormal.liquidatableCount).toBe(1);
  });
  it("matches staged floors, not a single floating-point expression", () => {
    const s = demoSnapshot();
    s.collateralPriceUsdE18 = "2000000000000000000123";
    s.positions = [
      {
        account: s.positions[0]!.account,
        collateralAmount: "1234567890123456789",
        debtAmount: "1700123456",
      },
    ];
    s.positionCount = 1;
    s.totalCollateral = s.positions[0]!.collateralAmount;
    s.totalDebt = s.positions[0]!.debtAmount;
    const cv =
      (BigInt(s.totalCollateral) * BigInt(s.collateralPriceUsdE18)) /
      10n ** 18n;
    const expected =
      (((cv * 7942n) / 10000n) * 10n ** 18n) /
      (BigInt(s.totalDebt) * 10n ** 12n);
    expect(simulate(s, 7942).proposedNormal.positions[0]!.healthFactorE18).toBe(
      expected.toString(),
    );
  });
  it("represents zero debt as infinite and reports true shortfall separately", () => {
    const s = demoSnapshot();
    for (const p of s.positions) p.debtAmount = "0";
    s.totalDebt = "0";
    expect(
      simulate(s, 7000).proposedNormal.minFiniteHealthFactorE18,
    ).toBeNull();
    expect(simulate(s, 7000).proposedStress.liquidatableCount).toBe(0);
    const debt = demoSnapshot();
    debt.collateralPriceUsdE18 = usd(100);
    expect(
      BigInt(simulate(debt, 7000).proposedNormal.collateralShortfallUsdE18),
    ).toBeGreaterThan(0n);
  });
  it("is order-independent and never returns private limits or candidate traces", () => {
    const s = demoSnapshot(),
      a = assessAndRecommend(s, 7000, DEMO_POLICY);
    s.positions.reverse();
    expect(assessAndRecommend(s, 7000, DEMO_POLICY)).toEqual(a);
    const json = JSON.stringify(a);
    expect(json).not.toContain("maxDecreaseBps");
    expect(json).not.toContain("candidates");
  });
  it("rejects invalid inputs, unsupported direction, zero price and Solidity overflow", () => {
    const s = demoSnapshot();
    expect(() => simulate({ ...s, totalDebt: "1" }, 7000)).toThrow();
    expect(() =>
      simulate({ ...s, positions: s.positions.slice(1) }, 7000),
    ).toThrow();
    expect(() =>
      simulate(
        { ...s, positions: [s.positions[0], ...s.positions.slice(0, 4)] },
        7000,
      ),
    ).toThrow();
    expect(() =>
      simulate({ ...s, collateralPriceUsdE18: "0" }, 7000),
    ).toThrow();
    expect(() =>
      simulate({ ...s, collateralPriceUsdE18: UINT256_MAX.toString() }, 7000),
    ).toThrow("overflow");
    expect(() => simulate(s, 7000, 10000)).toThrow("Zero stress price");
    expect(() => assessAndRecommend(s, 9000, DEMO_POLICY)).toThrow("decreases");
    expect(() =>
      assessAndRecommend(s, 7000, { ...DEMO_POLICY, maxDecreaseBps: -1 }),
    ).toThrow();
  });
});
describe("bounded confidential workload", () => {
  it("rejects expensive scans before searching", () => {
    const s = demoSnapshot();
    s.positions = Array.from({ length: 60 }, (_, i) => ({
      account: `0x${(i + 1).toString(16).padStart(40, "0")}` as const,
      collateralAmount: "0",
      debtAmount: "0",
    }));
    s.totalCollateral = "0";
    s.totalDebt = "0";
    s.positionCount = 60;
    expect(() => assessAndRecommend(s, 7000, DEMO_POLICY)).toThrow("workload");
  });
});

describe("freshness is a separate live gate", () => {
  it("rejects fixtures, old/future blocks and lag; accepts bounded live metadata", () => {
    const s = snapshotSchema.parse(demoSnapshot());
    const now = s.block.timestamp + 12;
    expect(() => assertFreshSnapshot(s, now, s.block.number + 1)).toThrow(
      "Live Graph",
    );
    s.source.kind = "graph";
    expect(() => assertFreshSnapshot(s, now, s.block.number + 1)).not.toThrow();
    expect(() => assertFreshSnapshot(s, now + 121, s.block.number + 1)).toThrow(
      "Stale",
    );
    expect(() => assertFreshSnapshot(s, now, s.block.number + 13)).toThrow(
      "Stale",
    );
    expect(() => assertFreshSnapshot(s, now - 13, s.block.number + 1)).toThrow(
      "future",
    );
  });
  it("rejects fake v1 stateVersion and unknown secret fields", () => {
    expect(() =>
      snapshotSchema.parse({ ...demoSnapshot(), stateVersion: "1" }),
    ).toThrow();
    expect(() =>
      snapshotSchema.parse({ ...demoSnapshot(), privatePolicy: DEMO_POLICY }),
    ).toThrow();
  });
});
