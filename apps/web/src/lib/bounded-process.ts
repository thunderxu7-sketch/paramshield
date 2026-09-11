import { spawn } from "node:child_process";

/** Internal runner only. Never expose executable/args/cwd as HTTP inputs. */
export function runBoundedProcess(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    maxBytes?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ stdout: string; stderr: string }> {
  const limit = options.maxBytes ?? 2_000_000;
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 300_000 ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > 4_000_000
  )
    return Promise.reject(new Error("Invalid runner bounds"));
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let finished = false,
      stdout = "",
      stderr = "",
      bytes = 0;
    function stop(message: string) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        if (grouped && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* Process already exited. */
      }
      reject(new Error(message, { cause: { stdout, stderr } }));
    }
    const timer = setTimeout(
      () => stop("Runner timed out; no decision accepted"),
      options.timeoutMs,
    );
    function collect(chunk: Buffer, stream: "stdout" | "stderr") {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > limit) return stop("Runner output limit exceeded");
      if (stream === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    }
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
    child.on("error", () => stop("Runner could not start"));
    child.on("close", (code) => {
      if (finished) return;
      if (code !== 0) return stop("Runner failed; no decision accepted");
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
  });
}

export function parseCreOutput(stdout: string): unknown {
  // CLI 1.32 prints the handler's returned JSON string as a JSON-quoted line.
  // Require exactly one result; never parse a log line into an ALLOW fallback.
  const marker = "Workflow Simulation Result:";
  // Strip ANSI color escapes from the CLI framing, not from policy data.
  const clean = stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const at = clean.indexOf(marker);
  if (at < 0 || clean.indexOf(marker, at + marker.length) >= 0)
    throw new Error("Missing or ambiguous CRE result");
  const candidates: unknown[] = [];
  for (const line of clean.slice(at + marker.length).split("\n")) {
    try {
      let value: unknown = JSON.parse(line.trim());
      if (typeof value === "string") value = JSON.parse(value);
      if (value && typeof value === "object") candidates.push(value);
    } catch {
      /* Non-result CLI progress line. */
    }
  }
  if (candidates.length !== 1)
    throw new Error("Missing or ambiguous CRE JSON result");
  return candidates[0];
}
