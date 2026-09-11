import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { hashCanonical, verifyPreflight } from "@paramshield/evidence";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";
import { parseCreOutput, runBoundedProcess } from "../bounded-process";
import { DurableStore } from "./durable-store";
import { AUTHORIZATION_MODE } from "./authorization-scope";

// Deliberately PUBLIC demo policy; local CLI simulation is not a hardware TEE.
export const DEMO_POLICY = Object.freeze({
  version: "incremental-exposure-v2",
  maxDecreaseBps: 300,
  maxNewNormalLiquidatable: 0,
  maxStressExposureBps: 200,
  stressExposureMode: "incremental",
  stressBps: 1500,
});
export type CreExecutionRun = Readonly<{
  runId: string;
  verdict: string;
  decisionHash: string;
  wasmSha256: string;
  sourceSha256: Readonly<Record<string, string>>;
  mode: "cli-simulation-trusted-relay";
}>;
const ownedRuns = new WeakMap<
  CreExecutionRun,
  {
    request: unknown;
    result: unknown;
    acceptedAt: number;
    policyHash: `0x${string}`;
    authorizationMode?: typeof AUTHORIZATION_MODE;
  }
>();
/** A browser-supplied result JSON cannot create this in-process runner capability.
 * Do not expose the factory/callback/CLI paths as request parameters. Restart
 * requires a NEW fresh run, not trusting an old JSON artifact as authorization. */
export function readTrustedRun(run: CreExecutionRun) {
  const data = ownedRuns.get(run);
  if (!data)
    throw new Error("Result did not originate from this trusted runner");
  return structuredClone(data);
}
export class CreExecutionRunner {
  constructor(
    readonly root: string,
    readonly now = () => Math.floor(Date.now() / 1000),
  ) {}
  async run(
    buildFreshPreflight: () => Promise<unknown>,
    authorizationOptions?: { authorizationMode: typeof AUTHORIZATION_MODE },
  ): Promise<CreExecutionRun> {
    const local = join(this.root, ".local/cre-execution"),
      disk = new DurableStore(local);
    return disk.exclusive("runner", async () => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([k]) =>
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
          ].includes(k),
        ),
      );
      const options = {
        cwd: this.root,
        env: { ...env, NODE_ENV: "development" as const },
        timeoutMs: 180_000,
      };
      const workflow = join(this.root, "workflows/chainlink-cre");
      await runBoundedProcess(
        "pnpm",
        [
          "--dir",
          workflow,
          "exec",
          "cre-compile",
          "src/main.ts",
          join(local, "policy.wasm"),
        ],
        options,
      );
      const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
      const wasmSha256 = sha(await readFile(join(local, "policy.wasm")));
      const sourcePaths = [
        "workflows/chainlink-cre/src/main.ts",
        "workflows/chainlink-cre/src/workflow.ts",
        "workflows/chainlink-cre/src/protocol.ts",
        "workflows/chainlink-cre/workflow.yaml",
        "workflows/chainlink-cre/project.yaml",
        "packages/evidence/src/index.ts",
        "packages/shared/src/index.ts",
        "packages/risk-engine/src/index.ts",
        "packages/risk-engine/src/policy.ts",
        "apps/web/src/lib/server/cre-execution-runner.ts",
        "apps/web/src/lib/server/execution-relay.ts",
        "apps/web/src/lib/server/rpc-adapter.ts",
        "apps/web/src/lib/server/review-store.ts",
        "apps/web/src/lib/server/authorization-scope.ts",
        "apps/web/src/lib/server/scoped-review-store.ts",
        "apps/web/src/lib/server/scoped-authorization.ts",
        "apps/web/src/lib/server/transaction-signing.ts",
        "apps/web/src/lib/server/execution-policy.ts",
        "apps/web/src/lib/server/operator-control.ts",
        "apps/web/src/lib/server/transaction-broadcast.ts",
        "apps/web/src/lib/server/decision-7702.ts",
        "apps/web/src/lib/server/lifecycle-preflight.ts",
        "apps/web/src/lib/server/lifecycle-receipt.ts",
        "apps/web/src/lib/server/v2-context.ts",
        "apps/web/src/lib/server/graph-v2-state.ts",
        "apps/web/src/lib/server/console-auth.ts",
        "apps/web/src/lib/server/console-service.ts",
        "apps/web/src/app/api/console/route.ts",
        "apps/web/src/lib/server/durable-store.ts",
        "apps/web/src/lib/execution-preflight.ts",
        "apps/web/src/lib/bounded-process.ts",
        "apps/web/scripts/relay-anvil-spike.ts",
        "apps/web/scripts/scoped-authorization-anvil.ts",
        "pnpm-lock.yaml",
      ];
      const sourceHashes = Object.fromEntries(
        await Promise.all(
          sourcePaths.map(async (p) => [
            p,
            // Runtime-only, allowlisted source paths on the trusted local host.
            // Do not trace/copy the workspace (including private journals) into
            // a deployable Next server artifact.
            sha(
              await readFile(
                /* turbopackIgnore: true */ join(
                  /* turbopackIgnore: true */ this.root,
                  p,
                ),
              ),
            ),
          ]),
        ),
      );
      // Compilation first: a slow compiler must not consume the snapshot lifetime.
      const preflight = verifyPreflight(await buildFreshPreflight()).preflight;
      const runId = randomUUID();
      const request = {
        schemaVersion: "paramshield.policy-execution.request.v1",
        runId,
        preflight,
      };
      const requestBody = JSON.stringify(request);
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
      async function privateFile(name: string, body: string) {
        const path = join(local, name);
        await writeFile(path, body, { mode: 0o600 });
        await chmod(path, 0o600);
      }
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(18321, "127.0.0.1", resolve);
        });
        await disk.write("config", {
          schedule: "0 */5 * * * *",
          requestUrl: "http://127.0.0.1:18321/review",
          requestHash: hashCanonical(request),
          runId,
          secretId: "PARAMSHIELD_POLICY",
          lane: "execution",
        });
        await privateFile(
          "secrets.yaml",
          "secretsNames:\n  PARAMSHIELD_POLICY:\n    - SECRET_PARAMSHIELD_POLICY\n",
        );
        await privateFile(
          "policy.env",
          `SECRET_PARAMSHIELD_POLICY='${JSON.stringify(DEMO_POLICY)}'\n`,
        );
        await disk.write(`run-${runId}`, {
          state: "RUNNING",
          request,
          wasmSha256,
          sourceHashes,
        });
        const output = await runBoundedProcess(
          join(homedir(), ".cre/bin/cre"),
          [
            "workflow",
            "simulate",
            ".",
            "--project-root",
            ".",
            "--target",
            "execution-simulation-settings",
            "--env",
            "../../.local/cre-execution/policy.env",
            "--non-interactive",
            "--trigger-index",
            "0",
            "--wasm",
            "../../.local/cre-execution/policy.wasm",
          ],
          { ...options, cwd: workflow, timeoutMs: 90_000 },
        );
        const result = parseCreOutput(output.stdout);
        const acceptedAt = this.now();
        const bound = validateExecutionResult(result, request, {
          runId,
          policyVersion: DEMO_POLICY.version,
          now: acceptedAt,
        });
        const run: CreExecutionRun = Object.freeze({
          runId,
          verdict: bound.decision.verdict,
          decisionHash: bound.decisionHash,
          wasmSha256,
          mode: "cli-simulation-trusted-relay",
          sourceSha256: Object.freeze({ ...sourceHashes }),
        });
        await disk.write(`run-${runId}`, {
          state: "COMPLETED",
          request,
          result,
          wasmSha256,
          sourceHashes,
          hardwareTeeAttested: false,
        });
        ownedRuns.set(
          run,
          structuredClone({
            request,
            result,
            acceptedAt,
            policyHash: hashCanonical(DEMO_POLICY),
            ...(authorizationOptions?.authorizationMode === AUTHORIZATION_MODE
              ? { authorizationMode: AUTHORIZATION_MODE }
              : {}),
          }),
        );
        return run;
      } catch {
        await disk.write(`run-${runId}`, {
          state: "FAILED",
          requestHash: hashCanonical(request),
          wasmSha256,
          sourceHashes,
        });
        // Do not propagate CLI output/private policy or provider responses.
        throw new Error(
          "CRE execution simulation failed closed; no decision accepted",
        );
      } finally {
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  }
}
