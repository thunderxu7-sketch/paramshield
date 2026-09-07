import { afterEach, describe, expect, it, vi } from "vitest";
import { cre, type TeeRuntime } from "@chainlink/cre-sdk";
import { demoSnapshot } from "@paramshield/risk-engine/fixtures";
import { hashCanonical } from "@paramshield/evidence";
import { configSchema, onCronTrigger, type Config } from "./workflow";

function setup() {
  const snapshot = demoSnapshot();
  snapshot.source.kind = "graph-local";
  const request = {
    schemaVersion: "paramshield.policy-preview.request.v1",
    runId: "handler-unit",
    snapshot,
    proposedValueBps: 7000,
    stressBps: 1500,
    headBlock: snapshot.block.number,
    expiresAt: snapshot.fetchedAt + 240,
  };
  const config: Config = {
    schedule: "0 */5 * * * *",
    requestUrl: "http://127.0.0.1:18321/review",
    requestHash: hashCanonical(request),
    runId: request.runId,
    secretId: "PARAMSHIELD_POLICY",
    lane: "development",
  };
  const getSecret = vi.fn(() => ({
    result: () => ({
      value: JSON.stringify({
        version: "unit-public-policy",
        maxDecreaseBps: 300,
        maxNewNormalLiquidatable: 0,
        maxStressExposureBps: 200,
        stressExposureMode: "incremental",
        stressBps: 1500,
      }),
    }),
  }));
  const log = vi.fn();
  const runtime = {
    config,
    getSecret,
    now: () => new Date((snapshot.fetchedAt + 1) * 1000),
    log,
  };
  const response = {
    statusCode: 200,
    body: new TextEncoder().encode(JSON.stringify(request)),
  };
  vi.spyOn(
    cre.capabilities.HTTPClient.prototype,
    "sendRequest",
  ).mockReturnValue({
    result: () => response,
  } as unknown as ReturnType<
    InstanceType<typeof cre.capabilities.HTTPClient>["sendRequest"]
  >);
  return { config, response, runtime, getSecret, log };
}
afterEach(() => vi.restoreAllMocks());
describe("confidential handler boundary", () => {
  it("loads the runtime secret and returns only the public product decision", () => {
    const s = setup();
    const output = onCronTrigger(s.runtime as unknown as TeeRuntime<Config>);
    expect(s.getSecret).toHaveBeenCalledWith({ id: "PARAMSHIELD_POLICY" });
    expect(JSON.parse(output)).toMatchObject({
      verdict: "BLOCK",
      recommendedValueBps: 7942,
      executable: false,
    });
    expect(output).not.toContain("maxDecreaseBps");
    expect(s.log).not.toHaveBeenCalled();
  });
  it("fails closed and redacts secret/provider failures", () => {
    const s = setup();
    s.response.statusCode = 503;
    expect(() =>
      onCronTrigger(s.runtime as unknown as TeeRuntime<Config>),
    ).toThrow("private details omitted");
    s.getSecret.mockImplementation(() => {
      throw new Error("private-value-must-not-escape");
    });
    expect(() =>
      onCronTrigger(s.runtime as unknown as TeeRuntime<Config>),
    ).toThrow("private details omitted");
    expect(s.log).not.toHaveBeenCalled();
  });
  it("validates a conservative URL subset without depending on global URL", () => {
    const s = setup();
    for (const url of [
      "http://127.0.0.1:18321/review",
      "https://runner.example.com/review/run-1",
    ])
      expect(
        configSchema.safeParse({ ...s.config, requestUrl: url }).success,
      ).toBe(true);
    for (const url of [
      "http://example.com/review",
      "http://localhost:18321/review",
      "http://127.0.0.1:18321/other",
      "https://u:p@example.com/review",
      "https://example.com/review?key=secret",
      "https://example.com/review#secret",
      "https://example.com/review\n",
      "https://example.com\\evil",
      "https://example.com/%0a",
    ])
      expect(
        configSchema.safeParse({ ...s.config, requestUrl: url }).success,
      ).toBe(false);
  });
});
