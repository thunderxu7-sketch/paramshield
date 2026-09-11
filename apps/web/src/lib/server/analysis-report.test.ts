import { describe, it, expect, vi } from "vitest";
import { executionFixture, hash } from "./test-fixtures";
import { createAnalysisReport } from "./analysis-report";
import { hashCanonical } from "@paramshield/evidence";
import { ConsoleService } from "./console-service";

describe("read-only redacted analysis reports", () => {
  it("recomputes an independently hashed summary without claiming execution, fresh authorization or TEE", () => {
    const { bound: b } = executionFixture();
    const before = structuredClone(b);
    const result = createAnalysisReport(b);
    expect(result.reportHash).toBe(hashCanonical(result.report));
    expect(result.reportHash).not.toBe(b.preflightHash);
    expect(result.report.executionProven).toBe(false);
    expect(result.report.kind).toBe("analysis-only");
    expect(result.report.hardwareTeeAttested).toBe(false);
    expect(result.report.change.calldata).toBe(b.intent.calldata);
    expect(result.report.simulation.currentNormal.liquidatableCount).toBe(
      b.preflight.simulation.currentNormal.liquidatableCount,
    );
    expect(b).toEqual(before);
    const text = JSON.stringify(result);
    expect(text).not.toContain(b.intent.operator);
    for (const p of b.preflight.snapshot.positions)
      expect(text).not.toContain(p.account);
    expect(result.report.snapshot).not.toHaveProperty("positions");
    expect(result.report).not.toHaveProperty("policy");
  });
  it.each(["simulation", "intent", "hash", "decision"])(
    "rejects tampered %s bindings",
    (kind) => {
      const b = structuredClone(executionFixture().bound);
      if (kind === "simulation") b.preflight.simulation.decreaseBps++;
      if (kind === "intent") b.intent.calldata = "0x12345678";
      if (kind === "hash") b.changeHash = hash("9");
      if (kind === "decision") b.decisionHash = hash("9");
      expect(() => createAnalysisReport(b)).toThrow();
    },
  );
  it("reads an expired/paused flow without signing, network calls or modifying its saved stage", async () => {
    const service = Object.create(ConsoleService.prototype) as ConsoleService;
    const record = {
      bound: executionFixture().bound,
      view: { stage: "DECISION_PENDING", active: false },
    };
    const before = structuredClone(record);
    const read = vi.fn(async () => record);
    Object.defineProperty(service, "flow", { value: read });
    const result = await service.analysisReport("existing-flow");
    expect(result.report.executionProven).toBe(false);
    expect(record).toEqual(before);
    expect(read).toHaveBeenCalledOnce();
  });
});
