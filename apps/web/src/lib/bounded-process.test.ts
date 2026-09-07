import { describe, expect, it } from "vitest";
import { parseCreOutput, runBoundedProcess } from "./bounded-process";
const opts = { cwd: process.cwd(), timeoutMs: 3000 };
describe("fail-closed local process runner", () => {
  it("accepts only successful bounded commands", async () => {
    expect(
      (
        await runBoundedProcess(
          process.execPath,
          ["-e", "console.log('ready')"],
          opts,
        )
      ).stdout.trim(),
    ).toBe("ready");
    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", "console.error('secret');process.exit(1)"],
        opts,
      ),
    ).rejects.toThrow("Runner failed");
  });
  it("terminates stalled and overproducing processes", async () => {
    await expect(
      runBoundedProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        ...opts,
        timeoutMs: 80,
      }),
    ).rejects.toThrow("timed out");
    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", "console.log('x'.repeat(10000))"],
        { ...opts, maxBytes: 100 },
      ),
    ).rejects.toThrow("output limit");
  });
  it("rejects malformed, duplicate or absent result framing", () => {
    const result = { schemaVersion: "test", verdict: "BLOCK" };
    const line = JSON.stringify(JSON.stringify(result));
    expect(
      parseCreOutput(`progress\nWorkflow Simulation Result:\n${line}\n`),
    ).toEqual(result);
    for (const bad of [
      line,
      "Workflow Simulation Result:\ninvalid",
      `Workflow Simulation Result:\n${line}\n${line}`,
      `Workflow Simulation Result:\n${line}\nWorkflow Simulation Result:`,
    ])
      expect(() => parseCreOutput(bad)).toThrow();
  });
});
