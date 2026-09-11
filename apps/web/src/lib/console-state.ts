import type { FlowLeg, FlowStage, FlowView } from "./console-types";

export const WORKSPACE_KEY = "paramshield-workspace-v2";
export type PendingOperation = {
  id: string;
  flowId: string;
  kind: "analyze" | "review" | "propose" | "decision" | "execute" | "funding";
  phase: "request" | "wallet" | "submitted";
  startedAt: number;
  baseRevision: number;
  hash?: string;
};
export type Workspace = {
  version: 1;
  selectedId: string | null;
  draft: string | null;
  pending: PendingOperation | null;
};
export const emptyWorkspace: Workspace = {
  version: 1,
  selectedId: null,
  draft: null,
  pending: null,
};
export function rejectedCurrentWalletRequest(
  code: unknown,
  pending: PendingOperation | null,
  previousOperation: string | undefined,
): boolean {
  return (
    code === 4001 &&
    Boolean(
      pending &&
      pending.id !== previousOperation &&
      pending.phase === "wallet" &&
      !pending.hash,
    )
  );
}
const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const txHash = /^0x[0-9a-f]{64}$/i;
export function restoreWorkspace(raw: string | null): Workspace {
  if (!raw) return { ...emptyWorkspace };
  try {
    const w = JSON.parse(raw) as Workspace;
    if (
      w.version !== 1 ||
      (w.selectedId !== null && !uuid.test(w.selectedId)) ||
      (w.draft !== null && (typeof w.draft !== "string" || w.draft.length > 32))
    )
      throw new Error("Invalid workspace");
    const p = w.pending;
    if (
      p &&
      (!uuid.test(p.id) ||
        !uuid.test(p.flowId) ||
        ![
          "analyze",
          "review",
          "propose",
          "decision",
          "execute",
          "funding",
        ].includes(p.kind) ||
        !["request", "wallet", "submitted"].includes(p.phase) ||
        !Number.isSafeInteger(p.startedAt) ||
        !Number.isSafeInteger(p.baseRevision) ||
        (p.hash !== undefined && !txHash.test(p.hash)))
    )
      throw new Error("Invalid pending operation");
    // Explicit allowlist: this storage is UX metadata, never authority.
    return {
      version: 1,
      selectedId: w.selectedId,
      draft: w.draft,
      pending: p
        ? {
            id: p.id,
            flowId: p.flowId,
            kind: p.kind,
            phase: p.phase,
            startedAt: p.startedAt,
            baseRevision: p.baseRevision,
            ...(p.hash ? { hash: p.hash } : {}),
          }
        : null,
    };
  } catch {
    // Do not silently erase a possibly outstanding wallet request.
    throw new Error(
      "本机恢复记录无法读取；签名与交易已暂停。请检查记录，不要清空后重发。",
    );
  }
}

export function mergeHistory(
  current: FlowView[],
  incoming: FlowView[],
): FlowView[] {
  const byId = new Map(current.map((f) => [f.id, f]));
  for (const next of incoming) {
    const previous = byId.get(next.id);
    if (!previous || (next.revision ?? 0) >= (previous.revision ?? 0)) {
      byId.set(next.id, {
        ...next,
        // Equal-revision results after a restart may revoke, never restore,
        // process-owned CRE trust. It cannot be resurrected by a late GET.
        active:
          previous && (next.revision ?? 0) === (previous.revision ?? 0)
            ? previous.active && next.active
            : next.active,
      });
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
  );
}

export function completedSteps(stage: FlowStage): number {
  if (stage === "EXECUTED") return 4;
  if (["DECIDED", "EXECUTING"].includes(stage)) return 3;
  if (["PROPOSED", "DECISION_READY", "DECISION_PENDING"].includes(stage))
    return 2;
  if (["REVIEWED", "PROPOSING"].includes(stage)) return 1;
  return 0;
}
export function unfinishedTransaction(f: FlowView): boolean {
  return (
    !f.retired &&
    [
      "PROPOSING",
      "PROPOSED",
      "DECISION_READY",
      "DECISION_PENDING",
      "DECIDED",
      "EXECUTING",
    ].includes(f.stage)
  );
}
export function authorizationDeadline(f: FlowView): number | undefined {
  return f.authorization?.mode === "exact-state-v1"
    ? f.authorization.expiresAt
    : f.freshUntil;
}
export function recoveryLeg(f: FlowView): FlowLeg | null {
  if (["EXECUTING", "EXECUTED"].includes(f.stage)) return "execute";
  if (["DECISION_READY", "DECISION_PENDING", "DECIDED"].includes(f.stage))
    return "decision";
  if (["PROPOSING", "PROPOSED"].includes(f.stage)) return "propose";
  return null;
}

export function reconcilePending(
  p: PendingOperation | null,
  history: FlowView[],
): PendingOperation | null {
  if (!p || p.kind === "funding") return p;
  const f = history.find((f) => f.id === p.flowId);
  if (!f) return p; // Missing/slow GET is not proof that nothing was sent.
  const done = completedSteps(f.stage);
  if (p.kind === "analyze" && f.stage !== "ANALYZING") return null;
  if (p.kind === "review" && done >= 1) return null;
  if (p.kind === "propose" && done >= 2) return null;
  if (p.kind === "decision" && done >= 3) return null;
  if (p.kind === "execute" && done >= 4) return null;
  if ((f.revision ?? 0) > p.baseRevision) {
    if (
      p.kind === "review" &&
      f.lastReviewAttempt?.outcome === "REJECTED" &&
      f.lastReviewAttempt.completedAt >= p.startedAt
    )
      return null;
    if (
      (p.kind === "propose" || p.kind === "execute") &&
      f.error &&
      !f.preparedLegs?.includes(p.kind)
    )
      return null;
  }
  return p;
}

export type NextAction =
  | "analyze"
  | "review"
  | "propose"
  | "decision"
  | "execute"
  | "recover"
  | "wait"
  | "done";
export function nextStep(
  f: FlowView | null,
  now: number,
): { action: NextAction; title: string; detail: string } {
  if (!f)
    return {
      action: "analyze",
      title: "从一份新的分析开始",
      detail: "分析不会签名或广播交易。",
    };
  if (f.stage === "EXECUTED")
    return {
      action: "done",
      title: "参数修改已核验完成",
      detail: "交易与证据已经保存；可继续核对 Graph 新事件。",
    };
  if (f.retired)
    return {
      action: "analyze",
      title: "旧授权已核验到期，可以创建新分析",
      detail:
        "旧提案和回执保留；新流程使用新 nonce、新证据和新签名，不会续期旧授权。",
    };
  if (
    ["PROPOSING", "DECISION_READY", "DECISION_PENDING", "EXECUTING"].includes(
      f.stage,
    )
  )
    return {
      action: "recover",
      title: "核对已有请求，不重新发送",
      detail: "恢复只查询已记录的交易。没有哈希时先检查钱包活动与服务端记录。",
    };
  if (f.stage === "ANALYZING")
    return {
      action: "wait",
      title: "分析记录已保存，正在等待结果",
      detail: f.active
        ? "页面会自动同步；不需要再次点击分析。"
        : "服务已重启，本次分析不能自动续跑。请保留记录并检查中断原因。",
    };
  const deadline = authorizationDeadline(f);
  if (!f.active || !deadline || now >= deadline) {
    if (unfinishedTransaction(f))
      return {
        action: "recover",
        title: "已上链的进度保留；当前授权已不可继续",
        detail:
          "数据窗口已到期或服务已重启。这不是交易丢失。不要重复提案，也不复用旧签名；先核对现有回执。",
      };
    return {
      action: "analyze",
      title: "历史证据已保存，需要新分析才能授权",
      detail: "不会延长旧证据的有效期；旧审核签名不能用于新分析。",
    };
  }
  if (f.stage === "BLOCKED" || f.stage === "FAILED")
    return {
      action: "analyze",
      title: "修改参数后重新分析",
      detail: "当前结果不允许进入签名或交易。",
    };
  if (f.stage === "ALLOW")
    return {
      action: "review",
      title: "下一步：人工审核签名",
      detail: f.authorization
        ? "使用 MetaMask Account 2，授权本次精确修改（最长 10 分钟）。后续自动核验新数据；不是链上交易。"
        : "使用 MetaMask Account 2；这是证据签名，不是链上交易。",
    };
  if (f.stage === "REVIEWED")
    return {
      action: "propose",
      title: "下一步：提交已审核提案",
      detail: "由专用 Privy operator 发送；这里不会出现 MetaMask 确认弹窗。",
    };
  if (f.stage === "PROPOSED")
    return {
      action: "decision",
      title: "下一步：链上决策确认",
      detail: "切换至 MetaMask Account 1，审阅一笔 Sepolia 零价值交易。",
    };
  return {
    action: "execute",
    title: "下一步：受控执行参数修改",
    detail:
      "由专用 Privy operator 发送；恢复 DENY 后才广播，不需要 MetaMask 签名。",
  };
}
