/** Public fixture only. No env, RPC, CRE, Privy, wallet or execution imports. */
import { assessAndRecommend } from "@paramshield/risk-engine/policy";
import { demoSnapshot, DEMO_POLICY } from "@paramshield/risk-engine/fixtures";
if (process.argv.length !== 2)
  throw new Error(
    "judge-preview.ts accepts no live configuration or arguments",
  );
const blocked = assessAndRecommend(demoSnapshot(), 7000, DEMO_POLICY);
const candidate = blocked.recommendedValueBps;
if (candidate === null) throw new Error("No candidate in the public fixture");
const replacement = assessAndRecommend(demoSnapshot(), candidate, DEMO_POLICY);
console.log(
  JSON.stringify(
    {
      kind: "public-fixture-judge-preview",
      executable: false,
      liveGraph: false,
      creCli: false,
      privy: false,
      humanReview: false,
      sepoliaExecution: false,
      note: "Deterministic local explanation, not current market data or an authorization. USD quantities use 18 decimal fixed-point units.",
      proposedLTBps: 7000,
      verdict: blocked.verdict,
      violations: blocked.violations,
      recommendedValueBps: candidate,
      replacementVerdict: replacement.verdict,
      fourCells: Object.fromEntries(
        [
          "currentNormal",
          "proposedNormal",
          "currentStress",
          "proposedStress",
        ].map((key) => [key, blocked.simulation[key as "currentNormal"]]),
      ),
      replacementSimulation: replacement.simulation,
    },
    null,
    2,
  ),
);
