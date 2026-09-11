/** No environment credentials, wallets, network calls or publishing. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { inspectSubmission } from "./lib/submission-package";
async function main() {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args.length === 1 && args[0] !== "--require-evidence")
  )
    throw new Error("Usage: submission-check.ts [--require-evidence]");
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const input = JSON.parse(
    await readFile(join(root, "docs/submission/manifest.json"), "utf8"),
  );
  const result = await inspectSubmission(root, input);
  console.log(JSON.stringify(result, null, 2));
  if (!result.packageValid) process.exitCode = 1;
  else if (args.length && result.pendingGates.length) process.exitCode = 2;
}
main().catch(() => {
  console.error(
    "Submission package invalid or unreadable. Inspect the manifest locally; no content or credentials were exported.",
  );
  process.exitCode = 1;
});
