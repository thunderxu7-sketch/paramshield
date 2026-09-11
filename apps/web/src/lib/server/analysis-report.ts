import { verdictSchema } from "@paramshield/shared";
import { hashCanonical, verifyPreflight } from "@paramshield/evidence";
import type { BoundRun } from "./lifecycle-preflight";

/** Whitelisted analysis summary, not a raw Flow/BoundRun dump, not an execution
 * proof. Can be read while transaction verification is paused or expired. */
export function createAnalysisReport(b: BoundRun) {
  const verified = verifyPreflight(b.preflight);
  const decision = verdictSchema.parse(b.decision);
  if (
    verified.preflightHash !== b.preflightHash ||
    hashCanonical(b.decision) !== b.decisionHash ||
    verified.changeHash !== b.changeHash ||
    hashCanonical(verified.intent) !== hashCanonical(b.intent) ||
    decision.changeHash !== b.changeHash ||
    decision.preflightHash !== b.preflightHash
  )
    throw new Error("Analysis evidence binding mismatch");
  const { snapshot: s, simulation: sim } = b.preflight;
  const cell = (c: typeof sim.currentNormal) => ({
    liquidatableCount: c.liquidatableCount,
    liquidatableDebtUsdE18: c.liquidatableDebtUsdE18,
    collateralShortfallUsdE18: c.collateralShortfallUsdE18,
    minFiniteHealthFactorE18: c.minFiniteHealthFactorE18,
  });
  const report = {
    schemaVersion: "paramshield.analysis-report.v1",
    kind: "analysis-only",
    executionProven: false,
    hardwareTeeAttested: false,
    description:
      "Historical analysis, not current authorization or proof of execution. Redacted summary; its hash is not the preflight hash or an on-chain anchor.",
    hashes: {
      changeHash: b.changeHash,
      preflightHash: b.preflightHash,
      decisionHash: b.decisionHash,
    },
    snapshot: {
      chainId: s.chainId,
      market: s.market,
      block: s.block,
      fetchedAt: s.fetchedAt,
      source: { kind: s.source.kind, deployment: s.source.deployment },
      stateVersion: s.stateVersion,
      positionsCount: s.positions.length,
      collateralPriceUsdE18: s.collateralPriceUsdE18,
    },
    change: {
      currentValueBps: b.intent.currentValueBps,
      proposedValueBps: b.intent.proposedValueBps,
      target: b.intent.target,
      calldata: b.intent.calldata,
      expiresAt: b.intent.expiresAt,
      expectedStateVersion: b.intent.expectedStateVersion,
      expectedAuthorizationEpoch: b.intent.expectedAuthorizationEpoch,
    },
    simulation: {
      algorithmVersion: sim.algorithmVersion,
      stressBps: sim.stressBps,
      currentNormal: cell(sim.currentNormal),
      proposedNormal: cell(sim.proposedNormal),
      currentStress: cell(sim.currentStress),
      proposedStress: cell(sim.proposedStress),
      newlyLiquidatableCount: sim.newlyLiquidatableAccounts.length,
      newlyLiquidatableDebtUsdE18: sim.newlyLiquidatableDebtUsdE18,
      additionalStressedDebtUsdE18: sim.additionalStressedDebtUsdE18,
    },
    decision: {
      verdict: b.decision.verdict,
      violations: b.decision.violations,
      recommendedValueBps: b.decision.recommendedValueBps,
    },
    redactions: [
      "individual positions",
      "reviewer identity",
      "signatures",
      "wallet resource IDs",
      "provider endpoints and keys",
      "private policy thresholds",
      "candidate search trace",
    ],
  };
  return { report, reportHash: hashCanonical(report) };
}
export type AnalysisReport = ReturnType<typeof createAnalysisReport>;
