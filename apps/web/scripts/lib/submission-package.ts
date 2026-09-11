/** Offline artifact inventory, NOT an external acceptance or publishing tool. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export const REQUIRED_GATES = [
  "public-source",
  "human-contribution",
  "prompt-reconciliation",
  "sepolia-execution",
  "graph-after",
  "runtime-ai",
  "three-live-runs",
  "public-demo",
  "human-video",
] as const;
export const REQUIRED_ARTIFACTS = [
  "README.md",
  "LICENSE",
  "docs/product-spec.md",
  "docs/architecture.md",
  "docs/threat-model.md",
  "docs/ai-usage.md",
  "docs/implementation-plan.md",
  "docs/planning/README.md",
  "docs/planning/PLAN.md",
  "docs/submission/README.md",
  "docs/submission/project-description.md",
  "docs/submission/sponsor-applications.md",
  "docs/submission/demo-script.md",
  "docs/submission/judge-quickstart.md",
  "docs/submission/rules-and-gates.md",
  "apps/web/src/lib/server/evidence-explanation.ts",
] as const;
type Gate = { id: string; status: "pending" | "recorded"; evidence: string[] };
type Manifest = {
  schemaVersion: "paramshield.submission-package.v1";
  project: "ParamShield";
  repositoryUrl: string;
  demoUrl: string | null;
  videoUrl: string | null;
  artifacts: string[];
  gates: Gate[];
};
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): Record<string, unknown> {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "Object required",
  );
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  check(
    Object.keys(value).length === allowed.length &&
      Object.keys(value).every((k) => allowed.includes(k)),
    "Unexpected or missing manifest fields",
  );
}
export function publicArtifactPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length <= 240 &&
    /^(README\.md|LICENSE|apps\/web\/src\/lib\/server\/evidence-explanation\.ts|(?:docs|deployments|workflows)\/[A-Za-z0-9_./-]+)$/.test(
      path,
    ) &&
    !path
      .split("/")
      .some(
        (p) =>
          !p ||
          p.startsWith(".") ||
          ["node_modules", "secrets", "broadcast"].includes(p),
      ) &&
    !/\.(pem|key)$/.test(path)
  );
}
function publicUrl(input: unknown): input is string {
  if (typeof input !== "string" || input.length > 2048) return false;
  try {
    const u = new URL(input);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) &&
      !/(?:localhost|\.local|\.internal|\.test)$/.test(u.hostname) &&
      !/^\d+(?:\.\d+){3}$/.test(u.hostname) &&
      ![...u.searchParams.keys()].some((k) =>
        /key|token|secret|signature|auth/i.test(k),
      )
    );
  } catch {
    return false;
  }
}
export function validateManifest(input: unknown): Manifest {
  const m = record(input);
  keys(m, [
    "schemaVersion",
    "project",
    "repositoryUrl",
    "demoUrl",
    "videoUrl",
    "artifacts",
    "gates",
  ]);
  check(
    m.schemaVersion === "paramshield.submission-package.v1" &&
      m.project === "ParamShield",
    "Wrong submission schema or project",
  );
  check(publicUrl(m.repositoryUrl), "Invalid public repository URL");
  for (const k of ["demoUrl", "videoUrl"])
    check(
      m[k] === null || publicUrl(m[k]),
      "Public URL must be null or credential-free HTTPS",
    );
  check(
    Array.isArray(m.artifacts) &&
      m.artifacts.length <= 100 &&
      m.artifacts.every(publicArtifactPath),
    "Unsafe or oversized artifact list",
  );
  const artifacts = m.artifacts as string[];
  check(
    new Set(artifacts).size === artifacts.length &&
      REQUIRED_ARTIFACTS.every((p) => artifacts.includes(p)),
    "Missing or duplicate required artifact",
  );
  check(
    Array.isArray(m.gates) && m.gates.length === REQUIRED_GATES.length,
    "Required gates cannot be omitted",
  );
  const gates = m.gates.map((value) => {
    const g = record(value);
    keys(g, ["id", "status", "evidence"]);
    check(
      typeof g.id === "string" && REQUIRED_GATES.some((id) => id === g.id),
      "Unknown gate",
    );
    check(
      g.status === "pending" || g.status === "recorded",
      "Gate must be pending or recorded, not verified by this tool",
    );
    check(
      Array.isArray(g.evidence) &&
        g.evidence.every((p) => artifacts.includes(p)),
      "Gate evidence must be inventoried",
    );
    check(
      g.status !== "recorded" || g.evidence.length > 0,
      "Recorded gate requires an evidence artifact",
    );
    if (g.status === "recorded" && g.id === "human-video")
      check(m.videoUrl !== null, "Video URL missing");
    if (g.status === "recorded" && g.id === "public-demo")
      check(m.demoUrl !== null, "Demo URL missing");
    return g as Gate;
  });
  check(
    new Set(gates.map((g) => g.id)).size === REQUIRED_GATES.length,
    "Duplicate or missing gate",
  );
  return { ...m, gates } as Manifest;
}
export function privacyFindings(text: string): string[] {
  return [
    ["private-key-block", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["api-secret-pattern", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
    ["bearer-credential", /Bearer\s+[A-Za-z0-9_.-]{32,}/],
    ["personal-home-path", /\/Users\/[^\s/]+\//],
    ["personal-email", /[\w.+-]+@(?:gmail|icloud|outlook)\.com/i],
    [
      "private-session-url",
      /https?:\/\/[^\s)]+[#?](?:[^\s)]*&)?(?:token|session|api[_-]?key)=[A-Za-z0-9_-]{16,}/i,
    ],
  ]
    .filter(([, pattern]) => (pattern as RegExp).test(text))
    .map(([id]) => id as string);
}
async function regularFile(root: string, path: string) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  check(
    rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/"),
    "Path outside repository",
  );
  check(
    !rel.split("/").some((p) => p.startsWith(".") || p === "node_modules") &&
      rel !== "PLAN.md",
    "Private link target",
  );
  check(
    (await realpath(absolute)) === absolute,
    "Symlink targets are not public artifacts",
  );
  const stat = await lstat(absolute);
  check(
    stat.isFile() && stat.size <= 2_000_000,
    "Artifact must be a bounded regular file",
  );
  return absolute;
}
export async function inspectSubmission(rootInput: string, input: unknown) {
  const root = await realpath(rootInput);
  const m = validateManifest(input);
  const issues: { path: string; code: string }[] = [];
  const artifacts: { path: string; bytes: number; sha256: string }[] = [];
  for (const path of m.artifacts) {
    try {
      const body = await readFile(await regularFile(root, path));
      artifacts.push({
        path,
        bytes: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
      });
      for (const code of privacyFindings(body.toString("utf8")))
        issues.push({ path, code });
      if (!path.endsWith(".md")) continue;
      // Conventional inline Markdown file links only; no network or anchor proof.
      for (const match of body
        .toString("utf8")
        .matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1]!;
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        try {
          check(
            !target.startsWith("/") && !/^[a-z]+:/i.test(target),
            "Unsupported link",
          );
          const decoded = decodeURIComponent(target.split("#")[0]!);
          check(!decoded.includes("\\"), "Invalid link");
          await regularFile(
            root,
            relative(root, join(root, dirname(path), decoded)),
          );
        } catch {
          issues.push({ path, code: "missing-or-unsafe-local-link" });
        }
      }
    } catch {
      issues.push({ path, code: "missing-unsafe-or-oversized-artifact" });
    }
  }
  return {
    schemaVersion: "paramshield.submission-check.v1",
    packageValid: issues.length === 0,
    submissionReady: false,
    acceptance:
      "Offline inventory only; human, provider, video and publication claims require independent review",
    pendingGates: m.gates
      .filter((g) => g.status === "pending")
      .map((g) => g.id),
    recordedGates: m.gates
      .filter((g) => g.status === "recorded")
      .map((g) => g.id),
    remoteLinksChecked: false,
    markdownAnchorsChecked: false,
    fullSecretAudit: false,
    artifacts,
    issues,
  };
}
