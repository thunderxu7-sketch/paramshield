/** Source freeze, not a release/live acceptance claim. No network or wallet. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, relative } from "node:path";
import { randomUUID } from "node:crypto";
import {
  captureSources,
  sourceChanges,
  sameSources,
  type SourceSnapshot,
} from "./lib/release-workspace";
async function main() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const args = process.argv.slice(2),
    current = await captureSources(root);
  if (args.length === 1 && args[0] === "--create") {
    const dir = join(root, ".local/releases");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `freeze-${randomUUID()}.json`);
    await writeFile(
      path,
      JSON.stringify(
        {
          schemaVersion: "paramshield.source-freeze.v1",
          createdAt: new Date().toISOString(),
          releaseAccepted: false,
          sources: current,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        manifest: relative(root, path),
        sourceFiles: Object.keys(current).length,
        releaseAccepted: false,
      }),
    );
  } else if (args.length === 2 && args[0] === "--verify") {
    const path = resolve(root, args[1]!);
    if (
      !relative(join(root, ".local/releases"), path).match(
        /^freeze-[a-f0-9-]+\.json$/,
      )
    )
      throw new Error("Local freeze manifest required");
    const before = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion: string;
      sources: SourceSnapshot;
    };
    if (
      before.schemaVersion !== "paramshield.source-freeze.v1" ||
      !before.sources
    )
      throw new Error("Invalid freeze manifest");
    const unchanged = sameSources(before.sources, current);
    console.log(
      JSON.stringify({
        unchanged,
        ...sourceChanges(before.sources, current),
        releaseAccepted: false,
      }),
    );
    if (!unchanged) process.exitCode = 2;
  } else
    throw new Error(
      "Usage: release-freeze.ts --create | --verify .local/releases/freeze-<id>.json",
    );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Freeze failed");
  process.exitCode = 1;
});
