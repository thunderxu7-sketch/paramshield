import { describe, expect, it } from "vitest";
import type { FlowView } from "./console-types";
import {
  completedSteps,
  emptyWorkspace,
  mergeHistory,
  nextStep,
  reconcilePending,
  rejectedCurrentWalletRequest,
  recoveryLeg,
  restoreWorkspace,
  unfinishedTransaction,
  type PendingOperation,
} from "./console-state";

const id = "12345678-abcd-4abc-8abc-123456789012";
const hash = `0x${"ab".repeat(32)}`;
const f = (extra: Partial<FlowView> = {}): FlowView => ({
  id,
  stage: "ALLOW",
  createdAt: 100,
  active: true,
  proposedValueBps: 7942,
  freshUntil: 220,
  revision: 1,
  timeline: [],
  ...extra,
});
const pending = (extra: Partial<PendingOperation> = {}): PendingOperation => ({
  id,
  flowId: id,
  kind: "decision",
  phase: "wallet",
  startedAt: 150,
  baseRevision: 1,
  ...extra,
});

describe("durable console UI recovery", () => {
  it("a cancelled connection prompt cannot clear a previous unknown transaction", () => {
    const p = pending();
    expect(rejectedCurrentWalletRequest(4001, p, p.id)).toBe(false);
    expect(rejectedCurrentWalletRequest(4001, p, undefined)).toBe(true);
    expect(
      rejectedCurrentWalletRequest(
        4001,
        pending({ phase: "submitted", hash }),
        undefined,
      ),
    ).toBe(false);
    expect(rejectedCurrentWalletRequest(-32002, p, undefined)).toBe(false);
  });
  it("does not let a late GET downgrade an accepted review or hide its transaction", () => {
    const proposed = f({
      stage: "PROPOSED",
      revision: 4,
      transactions: { propose: hash },
    });
    expect(mergeHistory([proposed], [f()])).toEqual([proposed]);
    expect(mergeHistory([f()], [proposed])[0]!.stage).toBe("PROPOSED");
  });
  it("retains history on an empty refresh rather than resetting to READY", () => {
    expect(mergeHistory([f()], [])).toEqual([f()]);
  });
  it("orders runs by creation, not the last old run that was rechecked", () => {
    const older = f({ createdAt: 10, revision: 50 });
    const newer = f({
      id: "22345678-abcd-4abc-8abc-123456789012",
      createdAt: 200,
    });
    expect(mergeHistory([newer], [older])[0]).toEqual(newer);
  });
  it("never restores process-owned trust from equal-revision late responses", () => {
    const revoked = mergeHistory([f()], [f({ active: false })]);
    expect(mergeHistory(revoked, [f()])[0]!.active).toBe(false);
  });
  it("preserves selected run, invalid draft-in-progress and unknown wallet request across reload", () => {
    const workspace = {
      ...emptyWorkspace,
      selectedId: id,
      draft: "100",
      pending: pending(),
    };
    expect(restoreWorkspace(JSON.stringify(workspace))).toEqual(workspace);
  });
  it("persists hashes, not credentials, signatures or raw transaction payloads", () => {
    const restored = restoreWorkspace(
      JSON.stringify({
        ...emptyWorkspace,
        token: "secret",
        signature: "raw-review",
        pending: {
          ...pending({ phase: "submitted", hash }),
          rawTransaction: "raw-tx",
        },
      }),
    );
    expect(JSON.stringify(restored)).not.toMatch(/secret|raw-review|raw-tx/);
    expect(restored.pending?.hash).toBe(hash);
  });
  it.each([
    "{broken",
    JSON.stringify({
      ...emptyWorkspace,
      pending: { ...pending(), hash: "not-a-hash" },
    }),
  ])("fails closed rather than discarding a corrupt recovery marker", (raw) => {
    expect(() => restoreWorkspace(raw)).toThrow("不要清空后重发");
  });
  it("missing history, expiry and DECISION_READY do not prove a wallet request was rejected", () => {
    const p = pending();
    expect(reconcilePending(p, [])).toBe(p);
    expect(
      reconcilePending(p, [
        f({
          stage: "DECISION_READY",
          active: false,
          freshUntil: 1,
          revision: 5,
        }),
      ]),
    ).toBe(p);
  });
  it("pending receipts and failures after a prepared plan stay blocked", () => {
    const p = pending({ kind: "propose", phase: "request" });
    const view = f({
      stage: "PROPOSING",
      revision: 5,
      error: "unknown",
      preparedLegs: ["propose"],
      transactions: { propose: hash },
    });
    expect(reconcilePending(p, [view])).toBe(p);
  });
  it("confirmed server stages reconcile the matching operation only", () => {
    expect(
      reconcilePending(pending({ kind: "propose" }), [
        f({ stage: "PROPOSED" }),
      ]),
    ).toBeNull();
    const p = pending();
    expect(reconcilePending(p, [f({ stage: "PROPOSED" })])).toBe(p);
    expect(reconcilePending(p, [f({ stage: "DECIDED" })])).toBeNull();
  });
  it("a saved review rejection or pre-plan failure permits safe user-driven retry, not auto signing", () => {
    expect(
      reconcilePending(pending({ kind: "propose" }), [
        f({ revision: 2, error: "preflight failed", preparedLegs: [] }),
      ]),
    ).toBeNull();
    expect(
      reconcilePending(pending({ kind: "review", phase: "submitted" }), [
        f({
          revision: 2,
          lastReviewAttempt: {
            phase: "submit",
            outcome: "REJECTED",
            startedAt: 151,
            completedAt: 152,
            secondsRemaining: 20,
            code: "REJECTED",
            message: "Rejected",
          },
        }),
      ]),
    ).toBeNull();
  });
  it("does not match another run's result to the pending request", () => {
    const p = pending();
    expect(
      reconcilePending(p, [
        f({ id: "22345678-abcd-4abc-8abc-123456789012", stage: "EXECUTED" }),
      ]),
    ).toBe(p);
  });
  it("an analysis response clears its marker but does not authorize or submit", () => {
    expect(
      reconcilePending(pending({ kind: "analyze", phase: "request" }), [f()]),
    ).toBeNull();
    expect(nextStep(f(), 160).action).toBe("review");
  });
});

describe("one next action, independent of preserved completion", () => {
  const authorization = {
    mode: "exact-state-v1" as const,
    expiresAt: 700,
    scopeHash: hash,
    policyHash: hash,
    marketStateHash: hash,
  };
  it("new explicit scopes use the authorization deadline, not the old observation timer", () => {
    expect(nextStep(f({ authorization, stage: "PROPOSED" }), 500).action).toBe(
      "decision",
    );
    expect(nextStep(f({ authorization, stage: "DECIDED" }), 500).action).toBe(
      "execute",
    );
    expect(nextStep(f({ authorization, stage: "ALLOW" }), 500).action).toBe(
      "review",
    );
    expect(nextStep(f({ stage: "PROPOSED", expiresAt: 700 }), 500).action).toBe(
      "recover",
    );
    expect(nextStep(f({ authorization, stage: "PROPOSED" }), 700).action).toBe(
      "recover",
    );
    expect(
      nextStep(f({ authorization, stage: "PROPOSED", active: false }), 500)
        .action,
    ).toBe("recover");
  });
  it("retirement preserves completed stages while allowing a new analysis, never an old signature", () => {
    const retired = f({
      stage: "PROPOSED",
      active: false,
      retired: { checkedAt: 800, blockNumber: 1, blockTimestamp: 800 },
    });
    expect(unfinishedTransaction(retired)).toBe(false);
    expect(completedSteps(retired.stage)).toBe(2);
    expect(nextStep(retired, 800).action).toBe("analyze");
  });
  it.each([
    ["ALLOW", "review"],
    ["REVIEWED", "propose"],
    ["PROPOSED", "decision"],
    ["DECIDED", "execute"],
    ["DECISION_READY", "recover"],
    ["PROPOSING", "recover"],
  ] as const)("%s has only the expected next action", (stage, action) => {
    expect(nextStep(f({ stage }), 160).action).toBe(action);
  });
  it("expired PROPOSED remains two completed steps, with read-only recovery, never a new proposal", () => {
    const proposed = f({ stage: "PROPOSED", transactions: { propose: hash } });
    expect(completedSteps(proposed.stage)).toBe(2);
    expect(nextStep(proposed, 250)).toMatchObject({ action: "recover" });
    expect(nextStep(proposed, 250).detail).toContain("不要重复提案");
    expect(unfinishedTransaction(proposed)).toBe(true);
    expect(recoveryLeg(proposed)).toBe("propose");
  });
  it("a restarted run cannot offer signing even within its old timestamp window", () => {
    expect(nextStep(f({ active: false, stage: "PROPOSED" }), 160).action).toBe(
      "recover",
    );
    expect(nextStep(f({ active: false }), 160).action).toBe("analyze");
  });
  it("final execution stays complete after expiry, rather than requesting analysis again", () => {
    const done = f({ active: false, stage: "EXECUTED" });
    expect(nextStep(done, 300).action).toBe("done");
    expect(completedSteps(done.stage)).toBe(4);
    expect(unfinishedTransaction(done)).toBe(false);
  });
});
