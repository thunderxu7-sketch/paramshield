import { describe, expect, it } from "vitest";
import { demoSnapshot } from "@paramshield/risk-engine/fixtures";
import {
  createPreflight,
  encodeThreshold,
  hashCanonical,
} from "@paramshield/evidence";
import {
  evaluateConfidentialRequest,
  validateExecutionResult,
  validatePreviewResult,
} from "./protocol";

// Public demo values only. No production confidential information in tests.
const policy = {
  version: "incremental-exposure-v2",
  maxDecreaseBps: 300,
  maxNewNormalLiquidatable: 0,
  maxStressExposureBps: 200,
  stressExposureMode: "incremental",
  stressBps: 1500,
};
function preview(proposedValueBps = 7000) {
  const snapshot = demoSnapshot();
  snapshot.source.kind = "graph-local";
  return {
    schemaVersion: "paramshield.policy-preview.request.v1",
    runId: "unit-preview",
    snapshot,
    proposedValueBps,
    stressBps: 1500,
    headBlock: snapshot.block.number + 1,
    expiresAt: snapshot.fetchedAt + 240,
  };
}
function execution(proposed = 7000) {
  const snapshot = demoSnapshot();
  // Synthetic v2 metadata ONLY for unit tests; never a live deployment claim.
  snapshot.source.kind = "graph";
  snapshot.contractVersion = "v2";
  snapshot.stateVersion = "7";
  const p = createPreflight({
    snapshot,
    stressBps: 1500,
    validation: {
      validatedAt: snapshot.fetchedAt + 1,
      headBlock: snapshot.block.number + 1,
    },
    intentCore: {
      schemaVersion: "paramshield.intent.v2",
      executor: `0x${"2".repeat(40)}`,
      operator: `0x${"3".repeat(40)}`,
      chainId: snapshot.chainId,
      target: snapshot.market,
      value: "0",
      calldata: encodeThreshold(proposed),
      currentValueBps: 8000,
      proposedValueBps: proposed,
      nonce: "1",
      expectedStateVersion: "7",
      expectedAuthorizationEpoch: "2",
      expiresAt: snapshot.fetchedAt + 240,
      reason: "Unit test proposal",
    },
  });
  return {
    schemaVersion: "paramshield.policy-execution.request.v1",
    runId: "unit-execution",
    preflight: p.preflight,
  };
}
const now = demoSnapshot().fetchedAt + 2;
function run(
  request: ReturnType<typeof preview> | ReturnType<typeof execution>,
  lane: "development" | "execution",
  secret = JSON.stringify(policy),
) {
  return evaluateConfidentialRequest(request, secret, {
    now,
    requestHash: hashCanonical(request),
    runId: request.runId,
    lane,
  });
}
const expected = {
  runId: "unit-execution",
  policyVersion: policy.version,
  now,
};
describe("confidential policy product protocol", () => {
  it("evaluates and searches in the handler core, without exporting private inputs", () => {
    const result = run(preview(), "development");
    expect(result).toMatchObject({
      verdict: "BLOCK",
      recommendedValueBps: 7942,
      executable: false,
      source: "graph-local",
    });
    for (const field of [
      "maxDecreaseBps",
      "maxStressExposureBps",
      "maxNewNormalLiquidatable",
      "candidates",
      "simulation",
    ])
      expect(JSON.stringify(result)).not.toContain(`"${field}":`);
  });
  it("requires a new review for 7942; 7941 is still blocked", () => {
    expect(run(preview(7941), "development")).toMatchObject({
      verdict: "BLOCK",
    });
    expect(run(preview(7942), "development")).toMatchObject({
      verdict: "ALLOW",
      executable: false,
    });
  });
  it("changing the secret policy changes the result", () => {
    expect(
      run(
        preview(),
        "development",
        JSON.stringify({
          ...policy,
          maxDecreaseBps: 10000,
          maxNewNormalLiquidatable: 10000,
          maxStressExposureBps: 10000,
        }),
      ),
    ).toMatchObject({ verdict: "ALLOW", recommendedValueBps: null });
    expect(
      run(
        preview(),
        "development",
        JSON.stringify({ ...policy, stressExposureMode: "absolute" }),
      ),
    ).toMatchObject({
      verdict: "BLOCK",
      recommendationStatus: "NO_SAFE_VALUE",
    });
  });
  it("redacts malformed policy, extra fields and mismatched stress failures", () => {
    for (const secret of [
      "secret-invalid-json",
      JSON.stringify({ ...policy, maxDecreaseBps: "secret-threshold" }),
      JSON.stringify({ ...policy, privateKey: "secret" }),
      JSON.stringify({ ...policy, stressBps: 2000 }),
    ]) {
      expect(() => run(preview(), "development", secret)).toThrow(
        "private details omitted",
      );
      try {
        run(preview(), "development", secret);
      } catch (error) {
        expect(String(error)).not.toContain("secret");
      }
    }
  });
  it("rejects hash/run/lane mismatch, stale input and expired preview", () => {
    const request = preview();
    const binding = {
      now,
      requestHash: hashCanonical(request),
      runId: request.runId,
      lane: "development" as const,
    };
    for (const change of [
      { requestHash: `0x${"f".repeat(64)}` },
      { runId: "other" },
      { now: now + 121 },
      { lane: "execution" as const },
    ])
      expect(() =>
        evaluateConfidentialRequest(request, JSON.stringify(policy), {
          ...binding,
          ...change,
        }),
      ).toThrow();
    const expired = { ...request, expiresAt: now };
    expect(() => run(expired, "development")).toThrow();
  });
  it("cannot promote a local/v1 preview into an executable decision", () => {
    expect(() =>
      validateExecutionResult(
        run(preview(), "development"),
        execution(),
        expected,
      ),
    ).toThrow();
    const req = execution();
    req.preflight.snapshot.source.kind = "graph-local";
    expect(() => run(req, "execution")).toThrow();
  });
  it("returns exact v2 intent/evidence bindings for the future execution lane", () => {
    const request = execution(7942),
      result = run(request, "execution");
    const bound = validateExecutionResult(result, request, expected);
    expect(bound.decision.verdict).toBe("ALLOW");
    expect(bound.decision.changeHash).toBe(bound.changeHash);
  });
  it("rejects altered metrics, result fields, policy/run/hash mismatch and stale delivery", () => {
    const request = execution(7942),
      result = run(request, "execution");
    for (const e of [
      { ...expected, runId: "other" },
      { ...expected, policyVersion: "other" },
      { ...expected, now: now + 121 },
      { ...expected, now: now + 500 },
    ])
      expect(() => validateExecutionResult(result, request, e)).toThrow();
    expect(() =>
      validateExecutionResult(
        { ...result, rawPolicy: policy },
        request,
        expected,
      ),
    ).toThrow();
    expect(() =>
      validateExecutionResult(
        { ...result, requestHash: `0x${"f".repeat(64)}` },
        request,
        expected,
      ),
    ).toThrow();
    request.preflight.simulation.additionalStressedDebtUsdE18 = "1";
    expect(() => run(request, "execution")).toThrow();
  });
});

describe("development result validation", () => {
  const expectedPreview = { ...expected, runId: "unit-preview" };
  it("accepts bound BLOCK and ALLOW previews without granting execution", () => {
    for (const proposed of [7000, 7942]) {
      const request = preview(proposed);
      expect(
        validatePreviewResult(
          run(request, "development"),
          request,
          expectedPreview,
        ).executable,
      ).toBe(false);
    }
  });
  it("rejects changed request, provenance, result identity, expiry and private fields", () => {
    const request = preview();
    const result = run(request, "development");
    for (const change of [
      { requestHash: `0x${"f".repeat(64)}` },
      { snapshotHash: `0x${"f".repeat(64)}` },
      { runId: "replayed-run" },
      { policyVersion: "other-policy" },
      { proposedValueBps: 7800 },
      { expiresAt: request.expiresAt + 1 },
      { executable: true },
      { source: "graph" },
      { rawPolicy: policy },
    ])
      expect(() =>
        validatePreviewResult(
          { ...result, ...change },
          request,
          expectedPreview,
        ),
      ).toThrow();
    expect(() =>
      validatePreviewResult(
        result,
        { ...request, proposedValueBps: 7800 },
        expectedPreview,
      ),
    ).toThrow();
    expect(() =>
      validatePreviewResult(result, request, {
        ...expectedPreview,
        now: now + 121,
      }),
    ).toThrow();
    expect(() =>
      validatePreviewResult(result, request, {
        ...expectedPreview,
        now: request.expiresAt,
      }),
    ).toThrow();
  });
  it("rejects inconsistent verdicts and out-of-range recommendations", () => {
    const request = preview(),
      result = run(request, "development");
    for (const change of [
      { verdict: "ALLOW" },
      { violations: [] },
      { recommendationStatus: "NOT_NEEDED" },
      { recommendationStatus: "NO_SAFE_VALUE" },
      { recommendedValueBps: null },
      { recommendedValueBps: 7000 },
      { recommendedValueBps: 8001 },
      { recommendedValueBps: 8000 },
      { recommendationStatus: "NO_CHANGE" },
    ])
      expect(() =>
        validatePreviewResult(
          { ...result, ...change },
          request,
          expectedPreview,
        ),
      ).toThrow();
    expect(
      validatePreviewResult(
        {
          ...result,
          recommendationStatus: "NO_CHANGE",
          recommendedValueBps: 8000,
        },
        request,
        expectedPreview,
      ).recommendationStatus,
    ).toBe("NO_CHANGE");
  });
});
