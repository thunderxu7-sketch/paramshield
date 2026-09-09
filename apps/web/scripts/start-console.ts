import { readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
import { createServer } from "node:net";
import { DurableStore } from "../src/lib/server/durable-store";

async function main() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(4180, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const disk = new DurableStore(join(root, ".local/console"));
  await disk.init();
  const token = randomBytes(32).toString("hex"),
    origin = "http://127.0.0.1:4180";
  let local: NodeJS.Dict<string> = {};
  try {
    local = parseEnv(await readFile(join(root, ".env.local"), "utf8"));
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  await disk.write("session", {
    token,
    origin,
    createdAt: new Date().toISOString(),
  });
  const path = join(disk.root, "open-url.txt");
  await writeFile(path, `${origin}/console#session=${token}\n`, {
    mode: 0o600,
  });
  await chmod(path, 0o600);
  console.log(
    `Starting local console at ${origin}/console. Private session URL saved in .local/console/open-url.txt (do not publish).`,
  );
  const child = spawn(
    process.execPath,
    [
      join(root, "apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "4180",
    ],
    {
      cwd: join(root, "apps/web"),
      stdio: "inherit",
      env: {
        ...process.env,
        ...local,
        PARAMSHIELD_ROOT: root,
        PARAMSHIELD_CONSOLE_ORIGIN: origin,
        PARAMSHIELD_CONSOLE_TOKEN: token,
      },
    },
  );
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}
main().catch(() => {
  console.error(
    "Console startup failed. Check the production build and owned port 4180; no transaction was requested.",
  );
  process.exitCode = 1;
});
