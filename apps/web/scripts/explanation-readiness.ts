/** No browser, wallet, signing or broadcast access. --check prints configuration
 * booleans only; --live reads an existing local flow and explicitly calls AI. */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  explainEvidence,
  EXPLANATION_PROMPT_VERSION,
} from "../src/lib/server/evidence-explanation";
import { createAnalysisReport } from "../src/lib/server/analysis-report";
import type { BoundRun } from "../src/lib/server/lifecycle-preflight";

async function main() {
  const args = process.argv.slice(2);
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.PARAMSHIELD_EXPLANATION_MODEL?.trim();
  const configured = Boolean(key && model);
  if (args.length === 1 && args[0] === "--check") {
    console.log(
      JSON.stringify({
        configured,
        providerCalled: false,
        promptVersion: EXPLANATION_PROMPT_VERSION,
        keyPresent: Boolean(key),
        modelPresent: Boolean(model),
      }),
    );
  } else if (
    args.length === 3 &&
    args[0] === "--live" &&
    args[1] === "--flow" &&
    /^[a-f0-9-]{36}$/.test(args[2]!)
  ) {
    if (!key || !model) {
      console.log(
        JSON.stringify({
          verified: false,
          reason:
            "Configure OPENAI_API_KEY and PARAMSHIELD_EXPLANATION_MODEL locally; no provider called",
        }),
      );
      process.exitCode = 2;
    } else {
      try {
        const root = resolve(process.env.PARAMSHIELD_ROOT ?? "../..");
        const flow = JSON.parse(
          await readFile(
            join(root, ".local/console/flows", `flow-${args[2]}.json`),
            "utf8",
          ),
        ) as { bound: BoundRun };
        createAnalysisReport(flow.bound); // validate the original historical bindings first
        const result = await explainEvidence(
          flow.bound,
          "这次参数修改额外增加了哪些风险？",
          {
            key,
            model,
          },
        );
        console.log(
          JSON.stringify({
            verified: result.mode === "ai",
            mode: result.mode,
            model: result.model ?? null,
            promptVersion: result.promptVersion,
            evidence: result.evidence,
            sources: result.sources,
            reason: result.reason ?? null,
          }),
        );
        if (result.mode !== "ai") process.exitCode = 2;
      } catch {
        console.log(
          JSON.stringify({
            verified: false,
            reason:
              "Local evidence or AI verification unavailable; no transaction sent",
          }),
        );
        process.exitCode = 1;
      }
    }
  } else {
    console.error(
      "Usage: explanation-readiness.ts --check | --live --flow <existing-flow-id>",
    );
    process.exitCode = 1;
  }
}
void main();
