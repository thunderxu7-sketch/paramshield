import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { v2Context } from "../src/lib/server/v2-context";
import {
  CreExecutionRunner,
  readTrustedRun,
  DEMO_POLICY,
} from "../src/lib/server/cre-execution-runner";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";

async function main() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const c = await v2Context(root),
    runner = new CreExecutionRunner(root);
  const results = [];
  let threshold = 7000;
  for (let index = 0; index < 2; index++) {
    const run = await runner.run(() =>
      c.preflight(
        threshold,
        "Hosted v2 Graph + actual CRE CLI verification; no transaction authorization",
      ),
    );
    const data = readTrustedRun(run);
    const bound = validateExecutionResult(data.result, data.request, {
      runId: run.runId,
      policyVersion: DEMO_POLICY.version,
      now: c.now(),
    });
    if (bound.decision.verdict !== (index === 0 ? "BLOCK" : "ALLOW"))
      throw new Error("Unexpected verdict");
    results.push({
      run,
      preflight: bound.preflight,
      decision: bound.decision,
      changeHash: bound.changeHash,
      decisionHash: bound.decisionHash,
    });
    if (index === 0) {
      const next = bound.decision.recommendedValueBps;
      if (typeof next !== "number")
        throw new Error("No recommended safe change");
      threshold = next;
    }
  }
  await writeFile(
    join(root, "docs/evidence/cre-hosted-v2-2026-09-09.json"),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        kind: "hosted-v2-graph-actual-cre-cli",
        hardwareTeeAttested: false,
        humanReviewPerformed: false,
        executionPerformed: false,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    results.map((r) => ({
      verdict: r.decision.verdict,
      proposedValueBps: r.preflight.intentCore.proposedValueBps,
      block: r.preflight.snapshot.block.number,
    })),
  );
}
main().catch(() => {
  console.error(
    "Hosted v2 CRE verification failed; no signing or chain writes performed.",
  );
  process.exitCode = 1;
});
