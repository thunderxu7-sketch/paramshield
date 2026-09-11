import type { MarketSnapshot, Verdict } from "@paramshield/shared";
import type { Simulation } from "@paramshield/risk-engine";

export type FlowStage =
  | "ANALYZING"
  | "BLOCKED"
  | "ALLOW"
  | "REVIEWED"
  | "PROPOSING"
  | "PROPOSED"
  | "DECISION_READY"
  | "DECISION_PENDING"
  | "DECIDED"
  | "EXECUTING"
  | "EXECUTED"
  | "FAILED";
export type TimelineItem = {
  at: number;
  label: string;
  transactionHash?: string;
};
export type FlowLeg = "propose" | "decision" | "execute";
export type FlowView = {
  id: string;
  stage: FlowStage;
  createdAt: number;
  active: boolean;
  proposedValueBps: number;
  /** Monotonic durable revision; older journals predate this field. */
  revision?: number;
  updatedAt?: number;
  transactions?: Partial<Record<FlowLeg, string>>;
  preparedLegs?: FlowLeg[];
  expiresAt?: number;
  freshUntil?: number;
  /** Absent means legacy snapshot-bound review. Never infer from expiry alone. */
  authorization?: {
    mode: "exact-state-v1";
    expiresAt: number;
    scopeHash: string;
    marketStateHash: string;
    policyHash: string;
  };
  lastFreshCheck?: {
    checkedAt: number;
    freshUntil: number;
    blockNumber: number;
  };
  /** Explicit read-only retirement, only after canonical on-chain expiry. */
  retired?: { checkedAt: number; blockNumber: number; blockTimestamp: number };
  snapshot?: MarketSnapshot;
  simulation?: Simulation;
  decision?: Verdict;
  changeHash?: string;
  preflightHash?: string;
  decisionHash?: string;
  expectedStateVersion?: string;
  authorizationEpoch?: string;
  timeline: TimelineItem[];
  error?: string;
  lastReviewAttempt?: {
    phase: "prepare" | "submit";
    outcome: "ISSUED" | "ACCEPTED" | "REJECTED";
    startedAt: number;
    completedAt: number;
    issuedAt?: number;
    secondsRemaining: number | null;
    code: string;
    message: string;
  };
  proof?: unknown;
  explanation?: {
    mode: "ai" | "deterministic-fallback";
    text: string;
    sources: string[];
    reason?: string;
    question?: string;
    generatedAt?: number;
    model?: string;
    promptVersion?: string;
    evidence?: {
      preflightHash: string;
      decisionHash: string;
      snapshotBlock: number;
    };
    citations?: { id: string; text: string; href: string }[];
  };
};
export type ConsoleJournal = {
  chainId: 11155111;
  market: string;
  executor: string;
  operator: string;
  authority: string;
  reviewer: string;
  admin: string;
  graphDeployment: string;
  aiConfigured: boolean;
  readAt: number;
  history: FlowView[];
};
export type ConsoleStatus = ConsoleJournal & {
  checkedAt: number;
  operatorBalanceWei: string;
  locked: boolean;
  stateVersion: string;
  authorizationEpoch: string;
};
