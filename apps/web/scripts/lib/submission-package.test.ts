import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  inspectSubmission,
  privacyFindings,
  publicArtifactPath,
  REQUIRED_ARTIFACTS,
  REQUIRED_GATES,
  validateManifest,
} from "./submission-package";
const dirs: string[] = [];
const manifest = () => ({
  schemaVersion: "paramshield.submission-package.v1",
  project: "ParamShield",
  repositoryUrl: "https://github.com/example/paramshield",
  demoUrl: null,
  videoUrl: null,
  artifacts: [...REQUIRED_ARTIFACTS],
  gates: REQUIRED_GATES.map((id) => ({
    id,
    status: "pending",
    evidence: [] as string[],
  })),
});
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), "paramshield-submission-"));
  dirs.push(dir);
  for (const path of REQUIRED_ARTIFACTS) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), "# Public test artifact\n");
  }
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("offline submission package boundaries", () => {
  it("inventories an incomplete package without claiming acceptance", async () => {
    const result = await inspectSubmission(await workspace(), manifest());
    expect(result.packageValid).toBe(true);
    expect(result.submissionReady).toBe(false);
    expect(result.pendingGates).toHaveLength(9);
    expect(result.remoteLinksChecked).toBe(false);
    expect(result.artifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("does not turn recorded human/provider statements into verification", async () => {
    const m = manifest();
    m.gates.forEach((g) => {
      g.status = "recorded";
      g.evidence = ["README.md"];
    });
    const result = await inspectSubmission(await workspace(), {
      ...m,
      demoUrl: "https://example.com/demo",
      videoUrl: "https://example.com/video",
    });
    expect(result.pendingGates).toHaveLength(0);
    expect(result.submissionReady).toBe(false);
  });
  it("rejects dropping required gates or required documents", () => {
    const m = manifest();
    m.gates.pop();
    expect(() => validateManifest(m)).toThrow();
    const a = manifest();
    a.artifacts.shift();
    expect(() => validateManifest(a)).toThrow();
  });
  it("rejects duplicate gates, unknown status and extra acceptance fields", () => {
    const m = manifest();
    m.gates[1] = m.gates[0]!;
    expect(() => validateManifest(m)).toThrow();
    const a = manifest();
    a.gates[0]!.status = "verified";
    expect(() => validateManifest(a)).toThrow();
    expect(() =>
      validateManifest({ ...manifest(), submissionReady: true }),
    ).toThrow();
  });
  it("requires evidence and media URL for recorded gates", () => {
    const m = manifest();
    m.gates[8]!.status = "recorded";
    expect(() => validateManifest(m)).toThrow();
    m.gates[8]!.evidence = ["README.md"];
    expect(() => validateManifest(m)).toThrow();
    m.gates[8]!.evidence = [".local/video-review.json"];
    expect(() => validateManifest(m)).toThrow();
  });
  it.each([
    "PLAN.md",
    ".local/secrets.json",
    "docs/../.env.local",
    "docs/.env.local",
    "/tmp/file",
    "docs/x.key",
    "docs//x.md",
    "docs/a\\x.md",
  ])("rejects private/traversal artifact %s", (path) => {
    expect(publicArtifactPath(path)).toBe(false);
  });
  it.each([
    "http://example.com",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://user:pass@example.com",
    "https://example.com/#token=abc",
    "https://example.com/?api_key=secret",
  ])("rejects unsafe public URL %s", (url) => {
    expect(() => validateManifest({ ...manifest(), demoUrl: url })).toThrow();
  });
  it("detects missing artifacts and changed source hashes", async () => {
    const dir = await workspace();
    const before = await inspectSubmission(dir, manifest());
    await writeFile(join(dir, "README.md"), "# Changed\n");
    const after = await inspectSubmission(dir, manifest());
    expect(before.artifacts[0]?.sha256).not.toBe(after.artifacts[0]?.sha256);
    await rm(join(dir, "LICENSE"));
    expect((await inspectSubmission(dir, manifest())).packageValid).toBe(false);
  });
  it("checks normal file links and rejects private/broken/encoded escape targets", async () => {
    const dir = await workspace();
    await writeFile(
      join(dir, "README.md"),
      "[Spec](docs/product-spec.md#problem) [Web](https://example.com)\n",
    );
    expect((await inspectSubmission(dir, manifest())).packageValid).toBe(true);
    await writeFile(join(dir, "PLAN.md"), "Do not read me");
    await writeFile(
      join(dir, "README.md"),
      "[private](PLAN.md) [escape](%2e%2e/secret) [missing](gone.md)",
    );
    expect((await inspectSubmission(dir, manifest())).issues).toHaveLength(3);
  });
  it("refuses symlink artifacts rather than reading their content", async () => {
    const dir = await workspace();
    await rm(join(dir, "LICENSE"));
    await symlink(join(dir, "README.md"), join(dir, "LICENSE"));
    expect((await inspectSubmission(dir, manifest())).issues).toContainEqual({
      path: "LICENSE",
      code: "missing-unsafe-or-oversized-artifact",
    });
  });
  it("refuses artifacts over the bound", async () => {
    const dir = await workspace();
    await writeFile(join(dir, "LICENSE"), "x".repeat(2_000_001));
    expect((await inspectSubmission(dir, manifest())).packageValid).toBe(false);
  });
  it("reports secret categories, never the matching secret", async () => {
    const secret = "sk-proj-" + "example_not_real_".repeat(3);
    expect(privacyFindings(secret)).toEqual(["api-secret-pattern"]);
    const dir = await workspace();
    await writeFile(join(dir, "README.md"), secret);
    const report = await inspectSubmission(dir, manifest());
    expect(report.packageValid).toBe(false);
    expect(JSON.stringify(report)).not.toContain(secret);
  });
});
