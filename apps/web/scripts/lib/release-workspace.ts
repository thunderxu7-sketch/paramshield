/** Local release tooling only. Never imported by the console API. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  symlink,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type SourceSnapshot = Record<string, string>;
export function isReleaseSource(path: string) {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /\.(pem|key)$/.test(path) ||
    path
      .split("/")
      .some(
        (p) =>
          [
            "..",
            ".local",
            "node_modules",
            ".next",
            "out",
            "cache",
            "dist",
            "generated",
            "build",
          ].includes(p) || p.startsWith(".env"),
      )
  )
    return false;
  return (
    /^(apps\/web\/|packages\/|workflows\/|contracts\/|subgraph\/|tests\/|scripts\/|infra\/|deployments\/|\.github\/)/.test(
      path,
    ) ||
    /^(package\.json|tsconfig[^/]*\.json|vitest\.config\.ts)$/.test(path) ||
    [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "turbo.json",
      "eslint.config.mjs",
      ".nvmrc",
      ".gitignore",
      ".prettierignore",
      "apps/web/next.config.ts",
      "apps/web/postcss.config.mjs",
      "contracts/foundry.toml",
      "subgraph/schema.graphql",
      "subgraph/subgraph.yaml",
    ].includes(path)
  );
}
export async function captureSources(root: string): Promise<SourceSnapshot> {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 4_000_000 },
  )
    .split("\0")
    .filter(isReleaseSource);
  const result: SourceSnapshot = {};
  for (const path of [...new Set(paths)].sort()) {
    const file = join(root, path);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("Release source must be a regular file");
      const actual = relative(await realpath(root), await realpath(file));
      if (actual.startsWith("../"))
        throw new Error("Release source escapes repository");
      result[path] = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue; // tracked deletion captured by diff
      throw error;
    }
  }
  if (!result["package.json"] || !result["apps/web/src/app/console/page.tsx"])
    throw new Error("ParamShield source root required");
  return result;
}
export function sourceChanges(before: SourceSnapshot, after: SourceSnapshot) {
  return {
    added: Object.keys(after).filter((p) => !(p in before)),
    removed: Object.keys(before).filter((p) => !(p in after)),
    changed: Object.keys(before).filter(
      (p) => p in after && before[p] !== after[p],
    ),
  };
}
export function sameSources(before: SourceSnapshot, after: SourceSnapshot) {
  return Object.values(sourceChanges(before, after)).every(
    (paths) => paths.length === 0,
  );
}
/** Copy only hashed source; NEVER copy existing .local, env, private keys,
 * or browser state. Dependency links are read-only inputs, not source copies. */
export async function isolatedWorkspace(
  root: string,
  target: string,
  sources: SourceSnapshot,
) {
  await mkdir(target, { recursive: false, mode: 0o700 });
  for (const [path, digest] of Object.entries(sources)) {
    if (!isReleaseSource(path))
      throw new Error("Non-source file in freeze manifest");
    const content = await readFile(join(root, path));
    if (createHash("sha256").update(content).digest("hex") !== digest)
      throw new Error("Source changed during rehearsal setup");
    await mkdir(dirname(join(target, path)), { recursive: true });
    await copyFile(join(root, path), join(target, path));
    if (
      createHash("sha256")
        .update(await readFile(join(target, path)))
        .digest("hex") !== digest
    )
      throw new Error("Source changed during copy");
  }
  for (const path of [
    "node_modules",
    "apps/web/node_modules",
    "workflows/chainlink-cre/node_modules",
    ...["shared", "evidence", "risk-engine", "graph-client"].map(
      (p) => `packages/${p}/node_modules`,
    ),
  ]) {
    await mkdir(dirname(join(target, path)), { recursive: true });
    await symlink(join(root, path), join(target, path), "dir");
  }
}
export function rehearsalEnvironment(env: NodeJS.ProcessEnv) {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(([key]) =>
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
    ),
    NODE_ENV: "test" as const,
  };
}
