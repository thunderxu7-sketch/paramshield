import { privateKeyToAccount } from "viem/accounts";
import { demoSnapshot } from "@paramshield/risk-engine/fixtures";
import {
  createPreflight,
  encodeThreshold,
  hashCanonical,
} from "@paramshield/evidence";
import {
  evaluateConfidentialRequest,
  validateExecutionResult,
} from "@paramshield/chainlink-cre/protocol";

// Synthetic unit tests only; these public, trivial keys never hold funds/roles.
export const reviewer = privateKeyToAccount(`0x${"a".repeat(64)}`);
export const operator = privateKeyToAccount(`0x${"b".repeat(64)}`);
export const stranger = privateKeyToAccount(`0x${"c".repeat(64)}`);
export const hash = (s: string) => `0x${s.repeat(64)}` as const;
export function executionFixture() {
  const snapshot = demoSnapshot();
  snapshot.source.kind = "graph";
  snapshot.contractVersion = "v2";
  snapshot.stateVersion = "7";
  const now = snapshot.fetchedAt + 3;
  const preflight = createPreflight({
    snapshot,
    stressBps: 1500,
    validation: { validatedAt: now - 2, headBlock: snapshot.block.number + 1 },
    intentCore: {
      schemaVersion: "paramshield.intent.v2",
      chainId: 11155111,
      executor: `0x${"2".repeat(40)}`,
      operator: operator.address.toLowerCase(),
      target: snapshot.market,
      value: "0",
      calldata: encodeThreshold(7942),
      currentValueBps: 8000,
      proposedValueBps: 7942,
      nonce: "1",
      expectedStateVersion: "7",
      expectedAuthorizationEpoch: "2",
      expiresAt: now + 180,
      reason: "Synthetic server integration unit test",
    },
  });
  const request = {
    schemaVersion: "paramshield.policy-execution.request.v1",
    runId: "server-test",
    preflight: preflight.preflight,
  };
  const policy = {
    version: "test-policy",
    maxDecreaseBps: 300,
    maxNewNormalLiquidatable: 0,
    maxStressExposureBps: 200,
    stressExposureMode: "incremental",
    stressBps: 1500,
  };
  const result = evaluateConfidentialRequest(request, JSON.stringify(policy), {
    now,
    requestHash: hashCanonical(request),
    runId: request.runId,
    lane: "execution",
  });
  const bound = validateExecutionResult(result, request, {
    now,
    runId: request.runId,
    policyVersion: policy.version,
  });
  return { now, request, result, bound, policy };
}
