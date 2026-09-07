import { z } from "zod";
import {
  assertFreshSnapshot,
  assertSnapshotFreshness,
  snapshotSchema,
  verdictSchema,
} from "@paramshield/shared";
import {
  bindDecision,
  hashCanonical,
  verifyPreflight,
} from "@paramshield/evidence";
import { assessAndRecommend } from "@paramshield/risk-engine/policy";

const uint = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
const id = z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/);
export const privatePolicySchema = z
  .object({
    version: id.max(80),
    maxDecreaseBps: uint.max(10000),
    maxNewNormalLiquidatable: uint.max(10000),
    maxStressExposureBps: uint.max(10000),
    stressExposureMode: z.enum(["incremental", "absolute"]),
    stressBps: uint.max(10000),
  })
  .strict();
export const previewRequestSchema = z
  .object({
    schemaVersion: z.literal("paramshield.policy-preview.request.v1"),
    runId: id,
    snapshot: z.unknown(),
    proposedValueBps: uint.min(5000).max(9500),
    stressBps: uint.max(10000),
    headBlock: uint,
    expiresAt: uint.positive(),
  })
  .strict();
const executionRequestSchema = z
  .object({
    schemaVersion: z.literal("paramshield.policy-execution.request.v1"),
    runId: id,
    preflight: z.unknown(),
  })
  .strict();
const bindingSchema = z
  .object({
    now: uint.positive(),
    requestHash: hash,
    runId: id,
    lane: z.enum(["development", "execution"]),
  })
  .strict();
const publicAssessment = (a: ReturnType<typeof assessAndRecommend>) => ({
  verdict: a.verdict,
  policyVersion: a.policyVersion,
  violations: a.violations,
  recommendationStatus: a.recommendationStatus,
  recommendedValueBps: a.recommendedValueBps,
});

/** Called INSIDE handlerInTee, never by a browser or general-purpose API. */
export function evaluateConfidentialRequest(
  input: unknown,
  policySecret: string,
  bindingInput: z.infer<typeof bindingSchema>,
) {
  // Do not expose JSON/Zod errors from private data, even during simulation.
  try {
    const binding = bindingSchema.parse(bindingInput);
    if (hashCanonical(input) !== binding.requestHash) throw new Error();
    const policy = privatePolicySchema.parse(JSON.parse(policySecret));
    if (binding.lane === "development") {
      const request = previewRequestSchema.parse(input);
      const snapshot = snapshotSchema.parse(request.snapshot);
      if (
        request.runId !== binding.runId ||
        snapshot.source.kind !== "graph-local" ||
        request.stressBps !== policy.stressBps ||
        request.expiresAt <= binding.now ||
        request.expiresAt > binding.now + 300
      )
        throw new Error();
      assertSnapshotFreshness(snapshot, binding.now, request.headBlock);
      const result = assessAndRecommend(
        snapshot,
        request.proposedValueBps,
        policy,
      );
      return {
        schemaVersion: "paramshield.policy-preview.result.v1" as const,
        requestHash: binding.requestHash,
        runId: request.runId,
        snapshotHash: hashCanonical(snapshot),
        proposedValueBps: request.proposedValueBps,
        ...publicAssessment(result),
        expiresAt: request.expiresAt,
        executable: false as const,
        source: "graph-local" as const,
        workflow: {
          id: "paramshield-policy",
          mode: "cli-simulation-preview" as const,
        },
      };
    }
    const request = executionRequestSchema.parse(input);
    const bound = verifyPreflight(request.preflight);
    const p = bound.preflight;
    if (
      request.runId !== binding.runId ||
      p.intentCore.expiresAt <= binding.now ||
      p.stressBps !== policy.stressBps
    )
      throw new Error();
    assertFreshSnapshot(p.snapshot, binding.now, p.validation.headBlock);
    const assessment = assessAndRecommend(
      p.snapshot,
      p.intentCore.proposedValueBps,
      policy,
    );
    const decision = verdictSchema.parse({
      schemaVersion: "paramshield.decision.v2",
      changeHash: bound.changeHash,
      preflightHash: bound.preflightHash,
      ...publicAssessment(assessment),
      expiresAt: p.intentCore.expiresAt,
      workflow: {
        id: "paramshield-policy",
        runId: request.runId,
        mode: "cli-simulation-trusted-relay",
      },
    });
    return {
      schemaVersion: "paramshield.cre-result.v1" as const,
      requestHash: binding.requestHash,
      decision,
    };
  } catch {
    throw new Error(
      "Confidential evaluation failed closed; private details omitted",
    );
  }
}

/** Binding checks only. The caller must trust its own runner and recheck live
 * RPC/contract state; CLI simulation is not an attestation or an authorization. */
export function validateExecutionResult(
  result: unknown,
  requestInput: unknown,
  expected: { runId: string; policyVersion: string; now: number },
) {
  const request = executionRequestSchema.parse(requestInput);
  const envelope = z
    .object({
      schemaVersion: z.literal("paramshield.cre-result.v1"),
      requestHash: hash,
      decision: z.unknown(),
    })
    .strict()
    .parse(result);
  const decision = verdictSchema.parse(envelope.decision);
  const bound = bindDecision(request.preflight, decision);
  if (
    envelope.requestHash !== hashCanonical(request) ||
    request.runId !== expected.runId ||
    decision.workflow.runId !== expected.runId ||
    decision.workflow.id !== "paramshield-policy" ||
    decision.policyVersion !== expected.policyVersion ||
    decision.expiresAt <= expected.now
  )
    throw new Error("Untrusted or expired workflow result binding");
  assertFreshSnapshot(
    bound.preflight.snapshot,
    expected.now,
    bound.preflight.validation.headBlock,
  );
  return bound;
}

const previewResultSchema = z
  .object({
    schemaVersion: z.literal("paramshield.policy-preview.result.v1"),
    requestHash: hash,
    runId: id,
    snapshotHash: hash,
    proposedValueBps: uint.min(5000).max(9500),
    verdict: z.enum(["ALLOW", "BLOCK"]),
    policyVersion: id.max(80),
    violations: z
      .array(
        z.enum([
          "MAX_LT_DECREASE",
          "NEW_NORMAL_LIQUIDATABLE",
          "STRESS_EXPOSURE",
        ]),
      )
      .max(3),
    recommendationStatus: z.enum([
      "RECOMMENDED",
      "NO_SAFE_VALUE",
      "NO_CHANGE",
      "NOT_NEEDED",
    ]),
    recommendedValueBps: uint.min(5000).max(9500).nullable(),
    expiresAt: uint.positive(),
    executable: z.literal(false),
    source: z.literal("graph-local"),
    workflow: z
      .object({
        id: z.literal("paramshield-policy"),
        mode: z.literal("cli-simulation-preview"),
      })
      .strict(),
  })
  .strict();

export function validatePreviewResult(
  result: unknown,
  requestInput: unknown,
  expected: { now: number; runId: string; policyVersion: string },
) {
  const request = previewRequestSchema.parse(requestInput);
  const snapshot = snapshotSchema.parse(request.snapshot);
  const r = previewResultSchema.parse(result);
  if (
    snapshot.source.kind !== "graph-local" ||
    r.runId !== expected.runId ||
    request.runId !== expected.runId ||
    r.requestHash !== hashCanonical(request) ||
    r.snapshotHash !== hashCanonical(snapshot) ||
    r.policyVersion !== expected.policyVersion ||
    r.proposedValueBps !== request.proposedValueBps ||
    r.expiresAt !== request.expiresAt ||
    r.expiresAt <= expected.now
  )
    throw new Error("Preview result binding mismatch");
  assertSnapshotFreshness(snapshot, expected.now, request.headBlock);
  if (r.verdict === "ALLOW") {
    if (
      r.violations.length ||
      r.recommendationStatus !== "NOT_NEEDED" ||
      r.recommendedValueBps !== null
    )
      throw new Error("Invalid preview ALLOW");
  } else {
    if (!r.violations.length || r.recommendationStatus === "NOT_NEEDED")
      throw new Error("Invalid preview BLOCK");
    const value = r.recommendedValueBps;
    if (
      r.recommendationStatus === "NO_SAFE_VALUE"
        ? value !== null
        : value === null ||
          value <= request.proposedValueBps ||
          value > snapshot.liquidationThresholdBps ||
          (r.recommendationStatus === "NO_CHANGE"
            ? value !== snapshot.liquidationThresholdBps
            : value === snapshot.liquidationThresholdBps)
    )
      throw new Error("Invalid preview recommendation");
  }
  return r;
}
