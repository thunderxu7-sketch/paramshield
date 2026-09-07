import { describe, expect, it } from "vitest";
import { demoSnapshot } from "@paramshield/risk-engine/fixtures";
import {
  bindDecision,
  canonicalJson,
  createFinalBundle,
  createPreflight,
  encodeThreshold,
  hashCanonical,
  hashChangeIntent,
  verifyPreflight,
} from "./index";
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const h = (n: string) => `0x${n.repeat(64)}`;
function input() {
  const snapshot = demoSnapshot();
  snapshot.contractVersion = "v2";
  snapshot.stateVersion = "7";
  // Synthetic provider metadata for a UNIT test, not live Graph evidence.
  snapshot.source = {
    ...snapshot.source,
    kind: "graph",
    deployment: "unit-test-synthetic",
  };
  const now = snapshot.fetchedAt + 1;
  return {
    intentCore: {
      schemaVersion: "paramshield.intent.v2",
      executor: addr(0x1555),
      operator: addr(0x1444),
      chainId: snapshot.chainId,
      target: snapshot.market,
      value: "0",
      calldata: encodeThreshold(7942),
      currentValueBps: 8000,
      proposedValueBps: 7942,
      nonce: "42",
      expectedStateVersion: "7",
      expectedAuthorizationEpoch: "2",
      expiresAt: now + 300,
      reason: "Reviewed decrease",
    },
    snapshot,
    stressBps: 1500,
    validation: { validatedAt: now, headBlock: snapshot.block.number + 1 },
  };
}
function allowed() {
  const p = createPreflight(input());
  const decision = {
    schemaVersion: "paramshield.decision.v2",
    changeHash: p.changeHash,
    preflightHash: p.preflightHash,
    verdict: "ALLOW",
    policyVersion: "incremental-exposure-v2",
    violations: [],
    recommendedValueBps: null,
    recommendationStatus: "NOT_NEEDED",
    expiresAt: p.intent.expiresAt,
    workflow: {
      id: "paramshield-policy",
      runId: "unit-run",
      mode: "cli-simulation-trusted-relay",
    },
  };
  const b = bindDecision(p.preflight, decision);
  const receipt = {
    transactionHash: h("2"),
    chainId: 11155111,
    blockNumber: p.preflight.snapshot.block.number + 2,
    blockHash: h("3"),
    status: "success",
    from: p.intent.operator,
    to: p.intent.executor,
    changeHash: b.changeHash,
    preflightHash: b.preflightHash,
    decisionHash: b.decisionHash,
  };
  return {
    preflight: p.preflight,
    decision,
    receipt,
    finalState: {
      market: p.intent.target,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      liquidationThresholdBps: 7942,
      stateVersion: "8",
    },
    authorization: {
      provider: "privy",
      walletId: "unit-wallet",
      controlId: "unit-control",
      requestId: "unit-request",
    },
  };
}
describe("canonical public evidence", () => {
  it("matches the independent Solidity golden vector", () => {
    const p = input().intentCore;
    expect(
      hashChangeIntent({
        ...p,
        target: addr(0x1333),
        expiresAt: 1800000060,
        evidenceHash: h("a"),
      }),
    ).toBe(
      "0x5004ec90a5a68e3f7958682a2b913947e7ce285a25c2661c27e50c78927023e4",
    );
  });

  it("sorts keys and refuses lossy/non-JSON values", () => {
    expect(canonicalJson({ b: 1, a: [true, "2"] })).toBe(
      '{"a":[true,"2"],"b":1}',
    );
    expect(hashCanonical({ b: 1, a: 2 })).toBe(hashCanonical({ a: 2, b: 1 }));
    for (const invalid of [
      undefined,
      1n,
      NaN,
      Infinity,
      1.1,
      Number.MAX_SAFE_INTEGER + 1,
      -0,
      new Date(),
      { a: undefined },
      Array(1),
    ])
      expect(() => canonicalJson(invalid)).toThrow();
  });
  it("recomputes metrics and creates an acyclic intent/preflight binding", () => {
    const p = createPreflight(input());
    expect(verifyPreflight(p.preflight).preflightHash).toBe(p.preflightHash);
    expect(p.preflight).not.toHaveProperty("preflightHash");
    expect(p.preflight).not.toHaveProperty("receipt");
    expect(p.intent.evidenceHash).toBe(p.preflightHash);
    expect(hashChangeIntent(p.intent)).toBe(p.changeHash);
  });
  it("rejects extra secret fields, altered metrics and calldata mismatch", () => {
    const p = createPreflight(input());
    expect(() =>
      verifyPreflight({ ...p.preflight, privatePolicy: { budget: 10 } }),
    ).toThrow();
    expect(() =>
      createPreflight({ ...input(), privateKey: "sensitive" }),
    ).toThrow();
    expect(() =>
      verifyPreflight({
        ...p.preflight,
        simulation: {
          ...p.preflight.simulation,
          additionalStressedDebtUsdE18: "1",
        },
      }),
    ).toThrow("Simulation mismatch");
    const i = input();
    i.intentCore.calldata = encodeThreshold(7000);
    expect(() => createPreflight(i)).toThrow("Calldata");
  });
  it("refuses v1, fixtures, incomplete input, invalid expiry and no-op changes", () => {
    const a = input();
    a.snapshot.contractVersion = "v1";
    a.snapshot.stateVersion = null;
    expect(() => createPreflight(a)).toThrow("v2 required");
    const b = input();
    b.snapshot.source.kind = "fixture";
    expect(() => createPreflight(b)).toThrow("Live Graph");
    b.snapshot.source.kind = "graph-local";
    expect(() => createPreflight(b)).toThrow("Live Graph");
    const c = input();
    c.intentCore.expiresAt = c.validation.validatedAt + 601;
    expect(() => createPreflight(c)).toThrow("expiry");
    const d = input();
    d.intentCore.expectedStateVersion = "6";
    expect(() => createPreflight(d)).toThrow("binding");
    const e = input();
    e.intentCore.proposedValueBps = 8000;
    e.intentCore.calldata = encodeThreshold(8000);
    expect(() => createPreflight(e)).toThrow("nonzero");
  });
  it("makes each execution domain and precondition hash-significant", () => {
    const p = createPreflight(input());
    for (const change of [
      { executor: addr(1) },
      { operator: addr(2) },
      { chainId: 1 },
      { target: addr(3) },
      { nonce: "43" },
      { expectedStateVersion: "8" },
      { expectedAuthorizationEpoch: "3" },
      { expiresAt: p.intent.expiresAt + 1 },
      { evidenceHash: h("4") },
      { calldata: encodeThreshold(7950), proposedValueBps: 7950 },
    ])
      expect(hashChangeIntent({ ...p.intent, ...change })).not.toBe(
        p.changeHash,
      );
  });
  it("rejects foreign/expired decision bindings and private candidate traces", () => {
    const a = allowed();
    expect(() =>
      bindDecision(a.preflight, { ...a.decision, changeHash: h("4") }),
    ).toThrow("binding");
    expect(() =>
      bindDecision(a.preflight, {
        ...a.decision,
        expiresAt: a.decision.expiresAt + 1,
      }),
    ).toThrow("binding");
    expect(() =>
      bindDecision(a.preflight, { ...a.decision, candidates: [7000] }),
    ).toThrow();
  });
  it("does not let a receipt alter an already bound preflight hash", () => {
    const a = allowed(),
      b = createFinalBundle(a);
    const next = createFinalBundle({
      ...a,
      receipt: { ...a.receipt, transactionHash: h("4") },
    });
    expect(b.bundle.preflightHash).toBe(next.bundle.preflightHash);
    expect(b.finalBundleHash).not.toBe(next.finalBundleHash);
    expect(b.finalBundleHash).not.toBe(b.bundle.preflightHash);
  });
  it("rejects fake final success, wrong receipt events and BLOCK/ESCALATE execution", () => {
    const a = allowed();
    expect(() =>
      createFinalBundle({
        ...a,
        finalState: { ...a.finalState, liquidationThresholdBps: 7000 },
      }),
    ).toThrow("Final state");
    expect(() =>
      createFinalBundle({
        ...a,
        receipt: { ...a.receipt, decisionHash: h("4") },
      }),
    ).toThrow("Receipt binding");
    expect(() =>
      createFinalBundle({
        ...a,
        receipt: { ...a.receipt, status: "reverted" },
      }),
    ).toThrow();
    expect(() =>
      createFinalBundle({
        ...a,
        decision: {
          ...a.decision,
          verdict: "BLOCK",
          violations: ["STRESS_EXPOSURE"],
        },
      }),
    ).toThrow("Only ALLOW");
    expect(() =>
      createFinalBundle({
        ...a,
        decision: { ...a.decision, verdict: "ESCALATE" },
      }),
    ).toThrow("Only ALLOW");
  });
});
