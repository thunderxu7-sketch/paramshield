// Pure confidential-handler library. Call evaluation AND search inside the CRE
// handler; do not provide real policy values to a browser or ordinary API.
import {
  basisPointsSchema,
  snapshotSchema,
  thresholdSchema,
} from "@paramshield/shared";
import { simulate, type Simulation } from "./index";
export type PrivatePolicy = {
  version: string;
  maxDecreaseBps: number;
  maxNewNormalLiquidatable: number;
  maxStressExposureBps: number;
  stressExposureMode: "incremental" | "absolute";
  stressBps: number;
};
export type Violation =
  "MAX_LT_DECREASE" | "NEW_NORMAL_LIQUIDATABLE" | "STRESS_EXPOSURE";
function validatePolicy(p: PrivatePolicy): void {
  if (
    !/^[a-zA-Z0-9._-]{1,80}$/.test(p.version) ||
    !["incremental", "absolute"].includes(p.stressExposureMode) ||
    !Number.isSafeInteger(p.maxNewNormalLiquidatable) ||
    p.maxNewNormalLiquidatable < 0
  )
    throw new Error("Invalid policy");
  basisPointsSchema.parse(p.maxDecreaseBps);
  basisPointsSchema.parse(p.maxStressExposureBps);
  basisPointsSchema.parse(p.stressBps);
}
function violations(sim: Simulation, p: PrivatePolicy): Violation[] {
  const result: Violation[] = [];
  if (sim.decreaseBps > p.maxDecreaseBps) result.push("MAX_LT_DECREASE");
  if (sim.newlyLiquidatableAccounts.length > p.maxNewNormalLiquidatable)
    result.push("NEW_NORMAL_LIQUIDATABLE");
  const exposure = BigInt(
    p.stressExposureMode === "incremental"
      ? sim.additionalStressedDebtUsdE18
      : sim.proposedStress.liquidatableDebtUsdE18,
  );
  // Cross-multiply: never round ratios down across a decision boundary.
  if (
    exposure * 10000n >
    BigInt(sim.totalDebtUsdE18) * BigInt(p.maxStressExposureBps)
  )
    result.push("STRESS_EXPOSURE");
  return result;
}
export function assessAndRecommend(
  input: unknown,
  proposed: number,
  policy: PrivatePolicy,
) {
  validatePolicy(policy);
  const s = snapshotSchema.parse(input);
  thresholdSchema.parse(proposed);
  if (proposed >= s.liquidationThresholdBps)
    throw new Error("Only LT decreases are supported by this policy");
  // A synchronous confidential handler must not accept an arbitrarily expensive
  // position × candidate workload. Larger jobs fail closed for explicit review.
  if (
    s.positions.length * (s.liquidationThresholdBps - proposed + 1) >
    50_000
  ) {
    throw new Error("Confidential search workload exceeds the P0 limit");
  }
  const original = simulate(s, proposed, policy.stressBps);
  const failed = violations(original, policy);
  if (failed.length === 0)
    return {
      policyVersion: policy.version,
      verdict: "ALLOW" as const,
      violations: failed,
      recommendationStatus: "NOT_NEEDED" as const,
      recommendedValueBps: null,
      simulation: original,
    };
  for (
    let candidate = proposed + 1;
    candidate <= s.liquidationThresholdBps;
    candidate++
  ) {
    const sim = simulate(s, candidate, policy.stressBps);
    if (violations(sim, policy).length === 0)
      return {
        policyVersion: policy.version,
        verdict: "BLOCK" as const,
        violations: failed,
        recommendationStatus:
          candidate === s.liquidationThresholdBps
            ? ("NO_CHANGE" as const)
            : ("RECOMMENDED" as const),
        recommendedValueBps: candidate,
        simulation: original,
      };
  }
  return {
    policyVersion: policy.version,
    verdict: "BLOCK" as const,
    violations: failed,
    recommendationStatus: "NO_SAFE_VALUE" as const,
    recommendedValueBps: null,
    simulation: original,
  };
}
