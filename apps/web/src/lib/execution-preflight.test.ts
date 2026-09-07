import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
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
import {
  prepareExecutionCall,
  type ReviewedExecutionTarget,
  type ExecutionStatePort,
} from "./execution-preflight";

const address = (n: string) => `0x${n.repeat(40)}` as const;
const hash = (n: string) => `0x${n.repeat(64)}` as const;
// Synthetic v2 RPC/approval data ONLY. This does not represent deployed v2 or a
// real authenticated human review. Production ports are a separate gate.
function setup() {
  const snapshot = demoSnapshot();
  snapshot.source.kind = "graph";
  snapshot.contractVersion = "v2";
  snapshot.stateVersion = "7";
  const time = { now: snapshot.fetchedAt + 3 };
  const core = {
    schemaVersion: "paramshield.intent.v2",
    chainId: 11155111,
    executor: address("2"),
    operator: address("3"),
    target: snapshot.market,
    value: "0",
    calldata: encodeThreshold(7942),
    currentValueBps: 8000,
    proposedValueBps: 7942,
    nonce: "1",
    expectedStateVersion: "7",
    expectedAuthorizationEpoch: "2",
    expiresAt: snapshot.fetchedAt + 240,
    reason: "Synthetic pre-sign unit test",
  };
  const preflight = createPreflight({
    snapshot,
    intentCore: core,
    stressBps: 1500,
    validation: {
      validatedAt: snapshot.fetchedAt + 1,
      headBlock: snapshot.block.number + 1,
    },
  });
  const request = {
    schemaVersion: "paramshield.policy-execution.request.v1",
    runId: "unit-sign-preparation",
    preflight: preflight.preflight,
  };
  const policy = {
    version: "unit-policy",
    maxDecreaseBps: 300,
    maxNewNormalLiquidatable: 0,
    maxStressExposureBps: 200,
    stressExposureMode: "incremental",
    stressBps: 1500,
  };
  const result = evaluateConfidentialRequest(request, JSON.stringify(policy), {
    now: time.now,
    requestHash: hashCanonical(request),
    runId: request.runId,
    lane: "execution",
  });
  if (!("decision" in result)) throw new Error("Expected execution fixture");
  const bound = validateExecutionResult(result, request, {
    runId: request.runId,
    policyVersion: policy.version,
    now: time.now,
  });
  const target: ReviewedExecutionTarget = {
    chainId: 11155111,
    contractVersion: "v2",
    executor: core.executor,
    market: snapshot.market,
    operator: core.operator,
    decisionAuthority: address("4"),
    executorCodeHash: hash("a"),
    marketCodeHash: hash("b"),
    policyVersion: policy.version,
  };
  const live: Awaited<ReturnType<ExecutionStatePort["read"]>> = {
    chainId: 11155111,
    block: {
      number: snapshot.block.number + 1,
      hash: hash("c"),
      timestamp: time.now,
    },
    executorCodeHash: target.executorCodeHash,
    marketCodeHash: target.marketCodeHash,
    operator: target.operator,
    decisionAuthority: target.decisionAuthority,
    marketOwner: target.executor,
    stateVersion: "7",
    authorizationEpoch: "2",
    allowedCall: true,
    proposal: { state: 2, decisionHash: bound.decisionHash },
  };
  const approval = {
    changeHash: bound.changeHash,
    preflightHash: bound.preflightHash,
    decisionHash: bound.decisionHash,
    reviewer: "unit-reviewer",
    approvedAt: time.now,
  };
  const state = {
    corroborateSnapshot: vi.fn(async () => {}),
    read: vi.fn(async () => live),
    canonicalBlockHash: vi.fn(async () => live.block.hash),
  };
  const approvals = { get: vi.fn(async () => approval) };
  return {
    args: {
      request,
      result,
      runId: request.runId,
      target,
      state,
      approvals,
      now: () => time.now,
    },
    live,
    time,
    bound,
    approval,
  };
}

describe("server-only v2 pre-sign preparation", () => {
  it("encodes only the exact reviewed, allowed, fresh intent", async () => {
    const s = setup(),
      call = await prepareExecutionCall(s.args);
    expect(call).toMatchObject({
      chainId: 11155111,
      from: s.args.target.operator,
      to: s.args.target.executor,
      value: 0n,
      changeHash: s.bound.changeHash,
    });
    const decoded = decodeFunctionData({
      abi: parseAbi([
        "function execute((uint256 chainId,address target,uint256 value,bytes data,uint256 nonce,bytes32 evidenceHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt) intent) returns(bytes)",
      ]),
      data: call.data,
    });
    expect(decoded.functionName).toBe("execute");
    expect(decoded.args[0]).toMatchObject({
      chainId: 11155111n,
      value: 0n,
      nonce: 1n,
      data: encodeThreshold(7942),
      evidenceHash: s.bound.preflightHash,
      expectedStateVersion: 7n,
      expectedAuthorizationEpoch: 2n,
    });
    expect(s.args.state.corroborateSnapshot).toHaveBeenCalledOnce();
    expect(s.args.approvals.get).toHaveBeenCalledWith(s.bound.decisionHash);
  });
  it.each([
    ["wrong chain", { chainId: 1 }],
    ["wrong executor bytecode", { executorCodeHash: hash("d") }],
    ["wrong market bytecode", { marketCodeHash: hash("d") }],
    ["changed operator", { operator: address("9") }],
    ["changed authority", { decisionAuthority: address("9") }],
    ["wrong market owner", { marketOwner: address("9") }],
    ["changed state", { stateVersion: "8" }],
    ["rotated authorization", { authorizationEpoch: "3" }],
    ["revoked call", { allowedCall: false }],
    ["pending proposal", { proposal: { state: 1, decisionHash: hash("a") } }],
    ["executed proposal", { proposal: { state: 5, decisionHash: hash("a") } }],
    ["wrong decision", { proposal: { state: 2, decisionHash: hash("d") } }],
  ])("rejects %s from live RPC state", async (_name, change) => {
    const s = setup();
    Object.assign(s.live, change);
    await expect(prepareExecutionCall(s.args)).rejects.toThrow("preconditions");
  });
  it("rejects preview, v1, BLOCK and ESCALATE before any RPC/signing", async () => {
    const s = setup();
    await expect(
      prepareExecutionCall({
        ...s.args,
        result: { executable: false, verdict: "ALLOW" },
      }),
    ).rejects.toThrow();
    await expect(
      prepareExecutionCall({
        ...s.args,
        target: {
          ...s.args.target,
          contractVersion: "v1",
        } as unknown as ReviewedExecutionTarget,
      }),
    ).rejects.toThrow("v2");
    for (const verdict of ["BLOCK", "ESCALATE"] as const) {
      const result = {
        ...s.args.result,
        decision: {
          ...s.args.result.decision,
          verdict,
          violations: ["MAX_LT_DECREASE"],
          recommendationStatus: "NO_SAFE_VALUE",
          recommendedValueBps: null,
        },
      };
      await expect(prepareExecutionCall({ ...s.args, result })).rejects.toThrow(
        "Only ALLOW",
      );
    }
    expect(s.args.state.read).not.toHaveBeenCalled();
  });
  it("rejects role collision, unpinned code and mismatched configured target", async () => {
    const s = setup();
    for (const target of [
      { ...s.args.target, decisionAuthority: s.args.target.operator },
      { ...s.args.target, executorCodeHash: hash("0") },
      { ...s.args.target, market: address("9") },
    ])
      await expect(
        prepareExecutionCall({ ...s.args, target }),
      ).rejects.toThrow();
  });
  it("requires a matching persisted review, not a front-end approval flag", async () => {
    const s = setup();
    await expect(
      prepareExecutionCall({ ...s.args, approvals: { get: async () => null } }),
    ).rejects.toThrow("persisted human review");
    for (const change of [
      { changeHash: hash("d") },
      { decisionHash: hash("d") },
      { preflightHash: hash("d") },
      { reviewer: " " },
      { approvedAt: s.time.now + 1 },
      { approvedAt: 1 },
    ])
      await expect(
        prepareExecutionCall({
          ...s.args,
          approvals: { get: async () => ({ ...s.approval, ...change }) },
        }),
      ).rejects.toThrow("persisted human review");
  });
  it("fails on unavailable/mismatched Graph corroboration and reorgs", async () => {
    const s = setup();
    s.args.state.corroborateSnapshot.mockRejectedValueOnce(
      new Error("RPC mismatch"),
    );
    await expect(prepareExecutionCall(s.args)).rejects.toThrow("RPC mismatch");
    s.args.state.canonicalBlockHash.mockResolvedValueOnce(hash("d"));
    await expect(prepareExecutionCall(s.args)).rejects.toThrow("reorganized");
  });
  it("rechecks freshness and expiry after slow dependencies", async () => {
    const s = setup();
    s.args.state.canonicalBlockHash.mockImplementationOnce(async () => {
      s.time.now += 500;
      return s.live.block.hash;
    });
    await expect(prepareExecutionCall(s.args)).rejects.toThrow();
    const future = setup();
    future.live.block.timestamp += 1;
    await expect(prepareExecutionCall(future.args)).rejects.toThrow(
      "stale RPC",
    );
  });
});
