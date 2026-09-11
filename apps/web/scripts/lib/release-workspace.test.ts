import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  captureSources,
  isReleaseSource,
  isolatedWorkspace,
  rehearsalEnvironment,
  sameSources,
  sourceChanges,
} from "./release-workspace";
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-release-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  await mkdir(join(root, "apps/web/src/app/console"), { recursive: true });
  await writeFile(join(root, "package.json"), "{}");
  await writeFile(
    join(root, "apps/web/src/app/console/page.tsx"),
    "export default 1",
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("release freeze and disposable rehearsal boundaries", () => {
  it("detects uncommitted edits, additions and deletions instead of trusting only git HEAD", async () => {
    const before = await captureSources(root);
    await writeFile(join(root, "package.json"), '{"changed":true}');
    await writeFile(join(root, "apps/web/src/new.ts"), "export const x=1");
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/old.ts"), "1");
    const withOld = await captureSources(root);
    await rm(join(root, "scripts/old.ts"));
    const after = await captureSources(root);
    expect(sourceChanges(before, after)).toMatchObject({
      added: ["apps/web/src/new.ts"],
      changed: ["package.json"],
    });
    expect(sourceChanges(withOld, after).removed).toEqual(["scripts/old.ts"]);
    expect(sameSources(before, after)).toBe(false);
    expect(sameSources(after, await captureSources(root))).toBe(true);
  });
  it("never stages live journals, credentials, build output or traversal paths into the rehearsal", async () => {
    for (const path of [
      ".local/console/session.json",
      "apps/web/.env.local",
      "apps/web/src/private.key",
      "../package.json",
      "/tmp/package.json",
      "apps/web/.next/server/app.js",
      "subgraph/generated/v2/a.ts",
    ])
      expect(isReleaseSource(path)).toBe(false);
    for (const path of [
      "subgraph/abis/market.json",
      "deployments/sepolia-v2.json",
      "apps/web/public/icon.svg",
    ])
      expect(isReleaseSource(path)).toBe(true);
    await mkdir(join(root, ".local/console"), { recursive: true });
    await writeFile(
      join(root, ".local/console/session.json"),
      '{"token":"private"}',
    );
    await writeFile(join(root, "apps/web/.env.local"), "PRIVATE=secret");
    const sources = await captureSources(root),
      target = join(root, "disposable");
    await isolatedWorkspace(root, target, sources);
    expect(await readFile(join(target, "package.json"), "utf8")).toBe("{}");
    await expect(access(join(target, ".local"))).rejects.toThrow();
    await expect(access(join(target, "apps/web/.env.local"))).rejects.toThrow();
    expect(
      await readFile(join(root, ".local/console/session.json"), "utf8"),
    ).toContain("private");
    await expect(isolatedWorkspace(root, target, sources)).rejects.toThrow();
  });
  it("refuses source changes between freeze and copy, and symlinked source inputs", async () => {
    const sources = await captureSources(root);
    await writeFile(join(root, "package.json"), "changed");
    await expect(
      isolatedWorkspace(root, join(root, "changed"), sources),
    ).rejects.toThrow(/Source changed/);
    await symlink(
      join(root, "package.json"),
      join(root, "apps/web/src/link.ts"),
    );
    await expect(captureSources(root)).rejects.toThrow(/regular file/);
  });
  it("does not forward console, AI, Privy or wallet environment secrets", () => {
    const env = rehearsalEnvironment({
      NODE_ENV: "production",
      PATH: "/test/bin",
      HOME: "/test/home",
      PARAMSHIELD_CONSOLE_TOKEN: "private",
      OPENAI_API_KEY: "private",
      PRIVY_APP_SECRET: "private",
      SEPOLIA_RPC_URL: "https://private",
      PRIVATE_KEY: "private",
    });
    expect(env).toEqual({
      NODE_ENV: "test",
      PATH: "/test/bin",
      HOME: "/test/home",
    });
  });
});
