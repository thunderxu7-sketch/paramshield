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
export type FlowView = {
  id: string;
  stage: FlowStage;
  createdAt: number;
  active: boolean;
  proposedValueBps: number;
  expiresAt?: number;
  freshUntil?: number;
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
  proof?: unknown;
  explanation?: {
    mode: "ai" | "deterministic-fallback";
    text: string;
    sources: string[];
    reason?: string;
  };
};
export type ConsoleStatus = {
  chainId: 11155111;
  market: string;
  executor: string;
  operator: string;
  authority: string;
  reviewer: string;
  admin: string;
  operatorBalanceWei: string;
  locked: boolean;
  graphDeployment: string;
  aiConfigured: boolean;
  stateVersion: string;
  authorizationEpoch: string;
  history: FlowView[];
};
