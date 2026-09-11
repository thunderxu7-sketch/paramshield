/** Three disposable local deployments. NO reset of an existing node/market,
 * real console, wallet, Privy control or hosted index. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { runBoundedProcess } from "../src/lib/bounded-process";
import {
  captureSources,
  isolatedWorkspace,
  rehearsalEnvironment,
  sameSources,
} from "./lib/release-workspace";
async function main() {
  if (process.argv.slice(2).join(" ") !== "--anvil-only")
    throw new Error(
      "Explicit --anvil-only required; arbitrary RPC/reset targets are not supported",
    );
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const sources = await captureSources(root);
  const dir = join(root, ".local/rehearsals", randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const results: Record<string, unknown>[] = [];
  const report = () => ({
    schemaVersion: "paramshield.local-rehearsal.v1",
    checkedAt: new Date().toISOString(),
    expectedRuns: 3,
    completedRuns: results.length,
    publicSepolia: false,
    hostedGraph: false,
    privyUsed: false,
    humanReview: false,
    hardwareTeeAttested: false,
    resetMode:
      "new owned Anvil process and deployment per run; no existing state reset",
    sources,
    results,
  });
  await writeFile(join(dir, "report.json"), JSON.stringify(report(), null, 2));
  for (let n = 1; n <= 3; n++) {
    assert(
      sameSources(sources, await captureSources(root)),
      "Source changed; stop rehearsal and refreeze",
    );
    const workspace = join(dir, `run-${n}`);
    await isolatedWorkspace(root, workspace, sources);
    console.log(
      JSON.stringify({
        run: n,
        phase:
          "isolated BLOCK -> new ALLOW -> review -> propose -> decision -> execute -> receipt recovery",
      }),
    );
    try {
      const output = await runBoundedProcess(
        process.execPath,
        [
          "--import",
          join(root, "apps/web/node_modules/tsx/dist/loader.mjs"),
          join(workspace, "apps/web/scripts/scoped-authorization-anvil.ts"),
          "--anvil-only",
        ],
        {
          cwd: workspace,
          timeoutMs: 300_000,
          maxBytes: 1_000_000,
          env: rehearsalEnvironment(process.env),
        },
      );
      const result = JSON.parse(output.stdout.trim());
      assert.match(
        result.proofPath,
        /^\.local\/anvil-scoped-authorization\/[a-f0-9-]{36}\/proof\.json$/,
      );
      const p = JSON.parse(
        await readFile(join(workspace, result.proofPath), "utf8"),
      );
      assert.equal(p.kind, "owned-anvil-only-scoped-authorization");
      for (const k of [
        "publicSepolia",
        "hostedGraph",
        "privyUsed",
        "hardwareTeeAttested",
      ])
        assert.equal(p[k], false);
      for (const k of [
        "actualCreCli",
        "epochRaceAfterSigningBlocked",
        "replayAfterExecutionBlocked",
        "originalEvidenceUnchanged",
        "newIntentAfterBlock",
        "restartRecoveryVerified",
      ])
        assert.equal(p[k], true);
      assert.equal(p.duplicateBroadcasts, 0);
      assert.equal(p.finalLTBps, 7942);
      assert.equal(p.receipts.execute.stateVersion, "8");
      assert.equal(p.blockedRun.verdict, "BLOCK");
      assert.equal(p.blockedRun.recommendedValueBps, 7942);
      assert.equal(p.run.verdict, "ALLOW");
      assert(
        !results.some((r) => r.allowRunId === p.run.runId),
        "Each rehearsal needs a fresh intent/run",
      );
      assert(
        sameSources(sources, await captureSources(root)),
        "Source changed during rehearsal",
      );
      results.push({
        run: n,
        baseline: p.baseline,
        blockedRunId: p.blockedRun.runId,
        allowRunId: p.run.runId,
        unsafeThresholdBps: 7000,
        recommendedValueBps: 7942,
        finalLTBps: p.finalLTBps,
        finalStateVersion: p.receipts.execute.stateVersion,
        receipts: p.receipts,
        actualCreCli: true,
        epochRaceBlocked: true,
        replayBlocked: true,
        restartRecoveryVerified: true,
        duplicateBroadcasts: 0,
      });
      await writeFile(
        join(dir, "report.json"),
        JSON.stringify(report(), null, 2) + "\n",
      );
      console.log(
        JSON.stringify({ run: n, passed: true, publicSepolia: false }),
      );
    } catch (error) {
      await writeFile(
        join(dir, "failure.json"),
        JSON.stringify(
          {
            run: n,
            completedRuns: results.length,
            failed: true,
            logsKeptPrivate: true,
          },
          null,
          2,
        ),
      );
      if (error instanceof Error)
        await writeFile(
          join(dir, "failure-detail.json"),
          JSON.stringify(
            { message: error.message, cause: error.cause },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      throw new Error(
        `Local rehearsal ${n} failed; inspect ${relative(root, dir)}. No public transaction sent.`,
      );
    }
  }
  console.log(
    JSON.stringify({
      passed: true,
      completedRuns: 3,
      report: relative(root, join(dir, "report.json")),
      liveAcceptance: false,
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Local rehearsal failed");
  process.exitCode = 1;
});
