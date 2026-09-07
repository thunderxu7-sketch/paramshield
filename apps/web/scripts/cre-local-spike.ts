import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import { snapshotSchema } from "@paramshield/shared";
import { hashCanonical } from "@paramshield/evidence";
import {
  privatePolicySchema,
  validatePreviewResult,
} from "@paramshield/chainlink-cre/protocol";
import { parseCreOutput, runBoundedProcess } from "../src/lib/bounded-process";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workdir = join(root, "workflows/chainlink-cre");
const local = join(root, ".local/cre-run");
const sha256 = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
let phase = "initialization";
// Intentionally public demo policy. Do NOT put production secrets in a CLI simulation.
const policy = privatePolicySchema.parse({
  version: "incremental-exposure-v2",
  maxDecreaseBps: 300,
  maxNewNormalLiquidatable: 0,
  maxStressExposureBps: 200,
  stressExposureMode: "incremental",
  stressBps: 1500,
});

async function main() {
  await mkdir(local, { recursive: true });
  const lock = await open(join(local, "runner.lock"), "wx", 0o600);
  let requestBody = "";
  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/review") {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      })
      .end(requestBody);
  });
  try {
    // Do not pass unrelated Privy/Graph credentials into the workflow process.
    const filteredEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        [
          "PATH",
          "HOME",
          "TMPDIR",
          "LANG",
          "XDG_CONFIG_HOME",
          "HTTP_PROXY",
          "HTTPS_PROXY",
          "ALL_PROXY",
          "NO_PROXY",
          "http_proxy",
          "https_proxy",
          "all_proxy",
          "no_proxy",
          "NODE_EXTRA_CA_CERTS",
        ].includes(key),
      ),
    );
    const env = { ...filteredEnv, NODE_ENV: "development" as const };
    const bounded = { cwd: root, timeoutMs: 180_000, env };
    phase = "compilation";
    await runBoundedProcess(
      "pnpm",
      [
        "--dir",
        workdir,
        "exec",
        "cre-compile",
        "src/main.ts",
        join(local, "policy.wasm"),
      ],
      bounded,
    );
    const wasmHash = sha256(await readFile(join(local, "policy.wasm")));
    const sourcePaths = [
      "workflows/chainlink-cre/src/main.ts",
      "workflows/chainlink-cre/src/workflow.ts",
      "workflows/chainlink-cre/src/protocol.ts",
      "packages/risk-engine/src/index.ts",
      "packages/risk-engine/src/policy.ts",
      "packages/shared/src/index.ts",
      "packages/evidence/src/index.ts",
      "pnpm-lock.yaml",
      "workflows/chainlink-cre/tsconfig.json",
      "workflows/chainlink-cre/project.yaml",
      "workflows/chainlink-cre/workflow.yaml",
      "apps/web/scripts/cre-local-spike.ts",
      "apps/web/scripts/graph-live-spike.ts",
      "apps/web/src/lib/bounded-process.ts",
      "packages/graph-client/src/index.ts",
    ];
    const sourceHashes = Object.fromEntries(
      await Promise.all(
        sourcePaths.map(async (p) => [
          p,
          sha256(await readFile(join(root, p))),
        ]),
      ),
    );
    await writeFile(
      join(local, "secrets.yaml"),
      "secretsNames:\n  PARAMSHIELD_POLICY:\n    - SECRET_PARAMSHIELD_POLICY\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(local, "policy.env"),
      `SECRET_PARAMSHIELD_POLICY='${JSON.stringify(policy)}'\n`,
      { mode: 0o600 },
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(18321, "127.0.0.1", resolve);
    });
    const runs = [];
    const cli = join(homedir(), ".cre/bin/cre");
    const version = (
      await runBoundedProcess(cli, ["version"], {
        ...bounded,
        timeoutMs: 10_000,
      })
    ).stdout.trim();
    for (const proposedValueBps of [7000, 7942]) {
      phase = "fresh Graph snapshot";
      // Fresh read AND RPC corroboration must succeed; no cached/fixture fallback.
      await runBoundedProcess(
        process.execPath,
        [
          "--import",
          join(root, "apps/web/node_modules/tsx/dist/loader.mjs"),
          join(root, "apps/web/scripts/graph-live-spike.ts"),
          "--local",
        ],
        { ...bounded, timeoutMs: 60_000 },
      );
      const graphEvidence = JSON.parse(
        await readFile(
          join(root, "docs/evidence/graph-local-live-v1.json"),
          "utf8",
        ),
      );
      const snapshot = snapshotSchema.parse(graphEvidence.snapshot);
      if (
        graphEvidence.rpcCorroborated !== true ||
        snapshot.source.kind !== "graph-local"
      )
        throw new Error("Local verified Graph input required");
      const now = Math.floor(Date.now() / 1000),
        runId = randomUUID();
      const request = {
        schemaVersion: "paramshield.policy-preview.request.v1",
        runId,
        snapshot,
        proposedValueBps,
        stressBps: 1500,
        headBlock: graphEvidence.validation.headBlock,
        expiresAt: now + 240,
      };
      requestBody = JSON.stringify(request);
      const config = {
        schedule: "0 */5 * * * *",
        requestUrl: "http://127.0.0.1:18321/review",
        requestHash: hashCanonical(request),
        runId,
        secretId: "PARAMSHIELD_POLICY",
        lane: "development",
      };
      await writeFile(join(local, "config.json"), JSON.stringify(config));
      await writeFile(join(local, "request.json"), requestBody);
      phase = "CRE CLI simulation";
      const output = await runBoundedProcess(
        cli,
        [
          "workflow",
          "simulate",
          ".",
          "--project-root",
          // CRE CLI path flags require ASCII; the checkout may be in 其他.
          ".",
          "--target",
          "development-settings",
          "--env",
          "../../.local/cre-run/policy.env",
          "--non-interactive",
          "--trigger-index",
          "0",
          "--wasm",
          "../../.local/cre-run/policy.wasm",
        ],
        { ...bounded, cwd: workdir, timeoutMs: 90_000 },
      );
      const result = validatePreviewResult(
        parseCreOutput(output.stdout),
        request,
        {
          now: Math.floor(Date.now() / 1000),
          runId,
          policyVersion: policy.version,
        },
      );
      if (result.verdict !== (proposedValueBps === 7000 ? "BLOCK" : "ALLOW"))
        throw new Error("Unexpected live demonstration result");
      runs.push({ request, result, resultHash: hashCanonical(result) });
      console.log(
        JSON.stringify({
          runId,
          proposedValueBps,
          verdict: result.verdict,
          recommendedValueBps: result.recommendedValueBps,
          source: result.source,
          executable: false,
        }),
      );
    }
    const evidence = {
      checkedAt: new Date().toISOString(),
      kind: "cre-local-graph-policy-preview",
      cliVersion: version,
      wasmSha256: wasmHash,
      sourceHashes,
      policyInput: "public-demo-values-loaded-as-runtime-secret",
      hardwareTeeAttested: false,
      hostedGraphProviderVerified: false,
      onchainTransactionsSent: false,
      executable: false,
      runs,
    };
    await writeFile(
      join(root, "docs/evidence/cre-local-graph-preview.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await lock.close();
    await unlink(join(local, "runner.lock"));
  }
}
main().catch(async (error: unknown) => {
  if (error instanceof Error && error.cause) {
    await writeFile(
      join(local, "last-run-error.log"),
      JSON.stringify({ phase, diagnostics: error.cause }),
      { mode: 0o600 },
    );
  }
  // Never print subprocess output or private parser/provider failures.
  const reason =
    error instanceof Error &&
    /^(Runner|Missing or ambiguous|Preview result)/.test(error.message)
      ? error.message
      : "Input, compilation or provider validation failed";
  console.error(
    `${phase}: ${reason}; preview incomplete, no executable approval produced.`,
  );
  process.exitCode = 1;
});
