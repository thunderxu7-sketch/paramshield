import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { toHex, type Address, type Hex } from "viem";
import { createFinalBundle, hashCanonical } from "@paramshield/evidence";
import { nonzeroAddressSchema } from "@paramshield/shared";
import { DurableStore } from "./durable-store";
import {
  CreExecutionRunner,
  type CreExecutionRun,
} from "./cre-execution-runner";
import {
  SignedReviewStore,
  reviewTypedData,
  ReviewValidationError,
} from "./review-store";
import { OperatorControl } from "./operator-control";
import {
  DurableSigningService,
  verifySignedTransaction,
  type SigningPlan,
} from "./transaction-signing";
import { DurableBroadcastService } from "./transaction-broadcast";
import { v2Context } from "./v2-context";
import {
  bindRun,
  checkLifecycle,
  lifecycleData,
  prepareLifecyclePlan,
  type BoundRun,
  type V2Context,
} from "./lifecycle-preflight";
import { verifyLifecycleReceipt } from "./lifecycle-receipt";
import { prepareRelaySigning } from "./execution-relay";
import type { ConsoleStatus, FlowView } from "../console-types";
import { explainEvidence } from "./evidence-explanation";
import { readGraphV2State } from "./graph-v2-state";
import { simulate } from "@paramshield/risk-engine";

type Flow = {
  view: FlowView;
  run?: CreExecutionRun;
  bound?: BoundRun;
  approvedAt?: number;
  plans: Partial<Record<"propose" | "decision" | "execute", SigningPlan>>;
  hashes: Partial<Record<"propose" | "decision" | "execute", Hex>>;
};
export function safeConsoleError(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (error instanceof ReviewValidationError) {
    if (error.code === "REVIEW_SIGNER_MISMATCH")
      return "审核签名未匹配指定钱包或本次签名内容；未批准，不是数据倒计时到期。";
    if (error.code === "REVIEW_TIME_IN_FUTURE")
      return "审核时间晚于服务器时间；未批准，请核查时钟，不要重复签名。";
    return "审核签名绑定的意图已过期；请重新分析并重新审核。";
  }
  if (text === "Stale or future snapshot")
    return "数据新鲜度校验未通过（时间、区块距离或区块顺序）；页面倒计时不代表完整授权。";
  if (text === "Expired intent or stale RPC state")
    return "意图有效期或实时 RPC 区块时间校验未通过；未批准，请检查审核记录。";
  if (/stale|expired|future snapshot/i.test(text))
    return "数据或审核已过期；请重新分析并重新审核，不复用旧签名。";
  if (/balance|gas budget/i.test(text))
    return "测试网 gas 余额不足；请先为对应钱包补充 Sepolia ETH。";
  if (
    /nonce|locked|recovery|unknown|no retry|quarantin|broadcast|receipt/i.test(
      text,
    )
  )
    return "操作或交易状态待核实。不要重复发送；使用只读回执恢复或检查本地记录。";
  if (/review|signature|signer|approval/i.test(text))
    return "需要指定审核人的有效签名，并且必须匹配本次决策。";
  if (/policy|wallet binding|operator/i.test(text))
    return "钱包或精确策略检查未通过；未授权继续执行。";
  return "操作未通过校验或外部服务暂不可用；执行保持阻断。请刷新状态后检查。";
}

/** One local operator process. Disk holds evidence, not rehydratable CRE trust.
 * A restart may inspect receipts but cannot resume signing an old run. */
export class ConsoleService {
  readonly disk: DurableStore;
  readonly signing: DurableSigningService;
  readonly broadcast: DurableBroadcastService;
  readonly flows = new Map<string, Flow>();
  private constructor(
    readonly root: string,
    readonly c: V2Context,
    readonly control: OperatorControl,
    readonly reviews: SignedReviewStore,
    readonly admin: Address,
    readonly reviewer: Address,
  ) {
    this.disk = new DurableStore(join(root, ".local/console/flows"));
    this.signing = new DurableSigningService(
      new DurableStore(join(root, ".local/console/signing")),
      c.now,
    );
    this.broadcast = new DurableBroadcastService(
      new DurableStore(join(root, ".local/console/broadcast")),
      this.signing.store,
      c.now,
    );
  }
  static async load(root: string) {
    const c = await v2Context(root),
      control = await OperatorControl.load(root);
    const roles = JSON.parse(
      await readFile(
        join(root, ".local/deployment-review/approved-v2-roles.json"),
        "utf8",
      ),
    );
    const admin = nonzeroAddressSchema.parse(roles.admin),
      reviewer = nonzeroAddressSchema.parse(roles.reviewer);
    if (
      roles.chainId !== 11155111 ||
      nonzeroAddressSchema.parse(roles.operator) !== c.target.operator ||
      nonzeroAddressSchema.parse(roles.decisionAuthority) !==
        c.target.decisionAuthority ||
      control.resource.address.toLowerCase() !== c.target.operator ||
      control.resource.assignedExecutor.toLowerCase() !== c.target.executor ||
      new Set([admin, reviewer, c.target.operator, c.target.decisionAuthority])
        .size !== 4
    )
      throw new Error("Approved role separation required");
    return new ConsoleService(
      root,
      c,
      control,
      new SignedReviewStore(
        new DurableStore(join(root, ".local/console/reviews")),
        [reviewer],
        c.now,
      ),
      admin,
      reviewer,
    );
  }
  private async save(f: Flow) {
    // Do not serialize an owned-run object as a future authorization capability.
    await this.disk.write(`flow-${f.view.id}`, {
      view: f.view,
      bound: f.bound,
      approvedAt: f.approvedAt,
      plans: f.plans,
      hashes: f.hashes,
    });
    const ids = ((await this.disk.read("index")) as string[] | null) ?? [];
    await this.disk.write(
      "index",
      [f.view.id, ...ids.filter((id) => id !== f.view.id)].slice(0, 30),
    );
  }
  async flow(id: string): Promise<Flow> {
    const active = this.flows.get(id);
    if (active) return active;
    const stored = (await this.disk.read(`flow-${id}`)) as Flow | null;
    if (!stored) throw new Error("Unknown flow");
    stored.view.active = false;
    return stored;
  }
  private run(f: Flow) {
    if (!f.run || !f.view.active)
      throw new Error("Restarted or expired flow; fresh analysis required");
    return f.run;
  }
  private async event(f: Flow, label: string, hash?: Hex) {
    f.view.timeline.push({
      at: this.c.now(),
      label,
      ...(hash ? { transactionHash: hash } : {}),
    });
    await this.save(f);
  }
  private async recordReviewAttempt(
    f: Flow,
    phase: "prepare" | "submit",
    startedAt: number,
    outcome: "ISSUED" | "ACCEPTED" | "REJECTED",
    error?: unknown,
  ) {
    const completedAt = this.c.now();
    const text = error instanceof Error ? error.message : "";
    // Only fixed reason codes and sanitized text go into the user-facing log.
    // Never persist rejected signatures, provider payloads or credentials here.
    const code =
      error instanceof ReviewValidationError
        ? error.code
        : text === "Stale or future snapshot"
          ? "SNAPSHOT_FRESHNESS"
          : text === "Expired intent or stale RPC state"
            ? "RPC_OR_INTENT_FRESHNESS"
            : text === "Untrusted or expired workflow result binding"
              ? "CRE_RESULT_BINDING"
              : outcome === "REJECTED"
                ? "REVIEW_CHECK_FAILED"
                : outcome;
    const message =
      outcome === "REJECTED"
        ? safeConsoleError(error)
        : outcome === "ISSUED"
          ? "已生成本次审核内容，尚未收到有效审核签名。"
          : "指定审核人的签名已验证并绑定本次证据。";
    f.view.lastReviewAttempt = {
      phase,
      outcome,
      startedAt,
      completedAt,
      ...(f.approvedAt === undefined ? {} : { issuedAt: f.approvedAt }),
      secondsRemaining:
        f.view.freshUntil === undefined
          ? null
          : f.view.freshUntil - completedAt,
      code,
      message,
    };
    if (outcome === "REJECTED") f.view.error = message;
    else delete f.view.error;
    await this.event(
      f,
      `${phase === "prepare" ? "审核内容准备" : "审核签名核验"}：${message}`,
    );
  }
  async status(): Promise<ConsoleStatus> {
    const [policy, balance, live] = await Promise.all([
      this.control.assertPolicy(),
      this.c.client.getBalance({
        address: this.c.target.operator,
        blockTag: "pending",
      }),
      this.c.live(),
    ]);
    const ids = ((await this.disk.read("index")) as string[] | null) ?? [];
    const history = await Promise.all(
      ids.map(async (id) => (await this.flow(id)).view),
    );
    return {
      chainId: 11155111,
      market: this.c.target.market,
      executor: this.c.target.executor,
      operator: this.c.target.operator,
      authority: this.c.target.decisionAuthority,
      reviewer: this.reviewer,
      admin: this.admin,
      operatorBalanceWei: balance.toString(),
      locked: policy.locked,
      graphDeployment: this.c.graphDeployment,
      aiConfigured: Boolean(
        process.env.OPENAI_API_KEY && process.env.PARAMSHIELD_EXPLANATION_MODEL,
      ),
      stateVersion: live.stateVersion,
      authorizationEpoch: live.authorizationEpoch,
      history,
    };
  }
  async analyze(id: string, threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 9999)
      throw new Error("Invalid LT");
    return this.disk.exclusive("operation", async () => {
      if (await this.disk.read(`flow-${id}`)) {
        const existing = (await this.flow(id)).view;
        if (existing.proposedValueBps !== threshold)
          throw new Error("Analysis request ID binding mismatch");
        return existing;
      }
      const f: Flow = {
        view: {
          id,
          createdAt: this.c.now(),
          active: true,
          proposedValueBps: threshold,
          stage: "ANALYZING",
          timeline: [],
        },
        plans: {},
        hashes: {},
      };
      this.flows.set(id, f);
      await this.event(f, "读取独立 v2 Graph，并在同一区块与 RPC 核对");
      try {
        f.run = await new CreExecutionRunner(this.root, this.c.now).run(() =>
          this.c.preflight(
            threshold,
            "ParamShield local console: reviewed LT decrease",
          ),
        );
        f.bound = bindRun(f.run, this.c);
        const b = f.bound;
        Object.assign(f.view, {
          stage: b.decision.verdict === "ALLOW" ? "ALLOW" : "BLOCKED",
          snapshot: b.preflight.snapshot,
          simulation: b.preflight.simulation,
          decision: b.decision,
          changeHash: b.changeHash,
          preflightHash: b.preflightHash,
          decisionHash: b.decisionHash,
          expiresAt: b.intent.expiresAt,
          freshUntil: Math.min(
            b.intent.expiresAt,
            b.preflight.snapshot.block.timestamp + 120,
            b.preflight.snapshot.fetchedAt + 120,
          ),
          expectedStateVersion: b.intent.expectedStateVersion,
          authorizationEpoch: b.intent.expectedAuthorizationEpoch,
        });
        await this.event(
          f,
          `实际 CRE CLI：${b.decision.verdict}；无硬件 TEE 声明`,
        );
      } catch (e) {
        f.view.stage = "FAILED";
        f.view.error = safeConsoleError(e);
        await this.save(f);
      }
      return f.view;
    });
  }
  async reviewPayload(id: string) {
    return this.disk.exclusive("operation", async () => {
      const f = await this.flow(id);
      const startedAt = this.c.now();
      let typed: ReturnType<typeof reviewTypedData>;
      try {
        if (f.view.stage !== "ALLOW")
          throw new Error("Review is unavailable at this stage");
        const b = await checkLifecycle(
          this.run(f),
          this.c,
          this.reviews,
          0,
          false,
        );
        f.approvedAt ??= this.c.now();
        typed = reviewTypedData(b.preflight, b.decision, f.approvedAt);
      } catch (error) {
        await this.recordReviewAttempt(
          f,
          "prepare",
          startedAt,
          "REJECTED",
          error,
        );
        throw error;
      }
      await this.recordReviewAttempt(f, "prepare", startedAt, "ISSUED");
      return {
        reviewer: this.reviewer,
        typedData: JSON.parse(
          JSON.stringify(typed, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        ),
      };
    });
  }
  async approve(id: string, signature: Hex) {
    return this.disk.exclusive("operation", async () => {
      const f = await this.flow(id);
      const startedAt = this.c.now();
      try {
        if (f.view.stage !== "ALLOW" || f.approvedAt === undefined)
          throw new Error("Issued review required");
        const b = await checkLifecycle(
          this.run(f),
          this.c,
          this.reviews,
          0,
          false,
        );
        await this.reviews.record(
          b.preflight,
          b.decision,
          f.approvedAt,
          signature,
        );
      } catch (error) {
        await this.recordReviewAttempt(
          f,
          "submit",
          startedAt,
          "REJECTED",
          error,
        );
        throw error;
      }
      f.view.stage = "REVIEWED";
      await this.recordReviewAttempt(f, "submit", startedAt, "ACCEPTED");
      return f.view;
    });
  }
  async propose(id: string) {
    return this.operation(id, async (f) => {
      if (f.view.stage !== "REVIEWED")
        throw new Error("Matching human review required before proposal");
      const run = this.run(f),
        check = () => checkLifecycle(run, this.c, this.reviews, 0);
      const b = await check();
      const ready = await prepareLifecyclePlan({
        client: this.c.client,
        from: this.c.target.operator,
        to: this.c.target.executor,
        data: lifecycleData(b, "propose"),
        expiresAt: b.intent.expiresAt,
        revalidate: check,
      });
      f.plans.propose = ready.plan;
      f.view.stage = "PROPOSING";
      await this.event(f, "准备精确 propose 签名；只授权本次 intent");
      await this.operatorSend(f, "propose", ready.plan, ready.revalidate);
    });
  }
  async decisionPayload(id: string) {
    return this.disk.exclusive("operation", async () => {
      const f = await this.flow(id),
        run = this.run(f),
        check = () => checkLifecycle(run, this.c, this.reviews, 1);
      if (!["PROPOSED", "DECISION_READY"].includes(f.view.stage))
        throw new Error("Confirmed proposal required");
      const b = await check();
      const ready = await prepareLifecyclePlan({
        client: this.c.client,
        from: this.c.target.decisionAuthority,
        to: this.c.target.executor,
        data: lifecycleData(b, "decision"),
        expiresAt: b.intent.expiresAt,
        revalidate: check,
      });
      if (
        f.plans.decision &&
        hashCanonical(f.plans.decision) !== hashCanonical(ready.plan)
      )
        throw new Error(
          "Existing wallet request requires receipt recovery; no replacement plan",
        );
      f.plans.decision = ready.plan;
      f.view.stage = "DECISION_READY";
      await this.event(
        f,
        "等待独立 decision authority 在 MetaMask 审阅并发送零价值交易",
      );
      const p = ready.plan;
      return {
        transaction: {
          from: p.from,
          to: p.to,
          chainId: toHex(11155111),
          type: "0x2",
          value: "0x0",
          data: p.data,
          nonce: toHex(p.nonce),
          gas: toHex(BigInt(p.gas)),
          maxFeePerGas: toHex(BigInt(p.maxFeePerGas)),
          maxPriorityFeePerGas: toHex(BigInt(p.maxPriorityFeePerGas)),
        },
      };
    });
  }
  async decisionReceipt(id: string, hash: Hex) {
    return this.operation(id, async (f) => {
      if (
        !f.bound ||
        !f.plans.decision ||
        !["DECISION_READY", "DECISION_PENDING"].includes(f.view.stage)
      )
        throw new Error("Issued decision plan required");
      if (f.hashes.decision && f.hashes.decision !== hash)
        throw new Error("Different transaction hash rejected");
      f.hashes.decision = hash;
      f.view.stage = "DECISION_PENDING";
      await this.event(f, "已保存 authority 交易哈希；等待真实回执", hash);
      await this.c.client.waitForTransactionReceipt({
        hash,
        confirmations: 2,
        timeout: 60_000,
        pollingInterval: 3000,
      });
      await this.confirm(f, "decision", hash);
    });
  }
  async execute(id: string) {
    return this.operation(id, async (f) => {
      if (f.view.stage !== "DECIDED")
        throw new Error("Confirmed on-chain decision required");
      const ready = await prepareRelaySigning({
        run: this.run(f),
        client: this.c.client,
        target: this.c.target,
        approvals: this.reviews,
        now: this.c.now,
      });
      f.plans.execute = ready.plan;
      f.view.stage = "EXECUTING";
      await this.event(
        f,
        "执行前重新核验 Graph/RPC、版本、权限、审核、nonce 与精确策略",
      );
      await this.operatorSend(f, "execute", ready.plan, ready.revalidate);
    });
  }
  private async operatorSend(
    f: Flow,
    leg: "propose" | "execute",
    plan: SigningPlan,
    revalidate: () => Promise<void>,
  ) {
    const job = `${f.view.id}-${leg}`;
    const signed = await this.control.sign(
      job,
      plan,
      leg,
      this.signing,
      revalidate,
    );
    f.hashes[leg] = signed.transactionHash;
    await this.event(
      f,
      "Privy 精确签名已核对，策略已恢复 DENY；尚未证明上链",
      signed.transactionHash,
    );
    await this.broadcast.send(job, plan, this.c.client, async () => {
      await this.control.assertPolicy();
      await revalidate();
    });
    await this.confirm(f, leg, signed.transactionHash);
  }
  private async confirm(
    f: Flow,
    leg: "propose" | "decision" | "execute",
    hash: Hex,
  ) {
    const b = f.bound,
      plan = f.plans[leg];
    if (!b || !plan) throw new Error("Missing durable transaction binding");
    if (leg !== "decision") {
      const job = (await this.signing.store.read(
        `job-${f.view.id}-${leg}`,
      )) as { state?: string; signedTransaction?: Hex; planHash?: Hex } | null;
      const policy = (await this.control.store.read(
        `signed-${f.view.id}-${leg}`,
      )) as { method?: string; restoredDeny?: boolean } | null;
      if (
        job?.state !== "SIGNED" ||
        !job.signedTransaction ||
        job.planHash !== hashCanonical(plan) ||
        policy?.method !== leg ||
        policy.restoredDeny !== true ||
        (await verifySignedTransaction(job.signedTransaction, plan)) !== hash
      )
        throw new Error(
          "Verified Privy signing and restored policy evidence required",
        );
      await this.control.assertPolicy();
    }
    const verified = await verifyLifecycleReceipt(
      this.c.client,
      plan,
      hash,
      b,
      leg,
    );
    if (leg === "execute") {
      const { receipt, finalState } = verified;
      const bundle = createFinalBundle({
        preflight: b.preflight,
        decision: b.decision,
        authorization: {
          provider: "privy",
          walletId: this.control.resource.walletId,
          controlId: this.control.resource.policyId,
          requestId: `${f.view.id}-execute`,
        },
        receipt: {
          transactionHash: hash,
          chainId: 11155111,
          blockNumber: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
          status: "success",
          from: receipt.from,
          to: receipt.to,
          changeHash: b.changeHash,
          preflightHash: b.preflightHash,
          decisionHash: b.decisionHash,
        },
        finalState,
      });
      await new DurableStore(join(this.root, ".local/console/evidence")).write(
        f.view.id,
        bundle,
      );
      const { authorization: _private, ...publicBundle } = bundle.bundle;
      void _private;
      const proof = {
        ...publicBundle,
        schemaVersion: "paramshield.public-execution-proof.v1",
        authorization: {
          provider: "privy",
          resourceIdentifiersRedacted: true,
          exactIntentPolicy: true,
          restoredDeny: true,
        },
        hardwareTeeAttested: false,
        confirmationsChecked: 2,
        finalityClaimed: false,
        source: "canonical RPC receipt + receipt-block reads",
      };
      // This is a separately hashed redacted proof, not the original bundle hash.
      f.view.proof = { proof, publicProofHash: hashCanonical(proof) };
      f.view.stage = "EXECUTED";
    } else f.view.stage = leg === "propose" ? "PROPOSED" : "DECIDED";
    delete f.view.error;
    await this.event(
      f,
      `${leg}：两次确认、完整交易字段、合约事件和同区块回读全部核对`,
      hash,
    );
  }
  async recover(id: string, leg: "propose" | "decision" | "execute") {
    return this.operation(id, async (f) => {
      const stages = {
        propose: ["PROPOSING"],
        decision: ["DECISION_READY", "DECISION_PENDING"],
        execute: ["EXECUTING"],
      };
      if (!stages[leg].includes(f.view.stage))
        throw new Error("No pending receipt at this stage");
      let hash = f.hashes[leg];
      if (leg !== "decision") {
        const record = (await this.broadcast.store.read(
          `broadcast-${id}-${leg}`,
        )) as { transactionHash?: Hex } | null;
        hash ??= record?.transactionHash;
      }
      if (!hash)
        throw new Error(
          "No recorded transaction; inspect signing/policy recovery manually",
        );
      // Read-only: never sign, resend, release a nonce, or rehydrate CRE trust.
      await this.confirm(f, leg, hash);
    });
  }
  async explain(id: string, question: string) {
    return this.disk.exclusive("operation", async () => {
      const f = await this.flow(id);
      if (!f.bound) throw new Error("Evidence required before explanation");
      f.view.explanation = await explainEvidence(f.bound, question, {
        ...(process.env.OPENAI_API_KEY
          ? { key: process.env.OPENAI_API_KEY }
          : {}),
        ...(process.env.PARAMSHIELD_EXPLANATION_MODEL
          ? { model: process.env.PARAMSHIELD_EXPLANATION_MODEL }
          : {}),
      });
      await this.save(f);
      return f.view;
    });
  }
  async graphAfter(id: string) {
    return this.operation(id, async (f) => {
      if (
        f.view.stage !== "EXECUTED" ||
        !f.bound ||
        !f.hashes.execute ||
        !f.plans.execute
      )
        throw new Error("Confirmed execution required");
      const receipt = await verifyLifecycleReceipt(
        this.c.client,
        f.plans.execute,
        f.hashes.execute,
        f.bound,
        "execute",
      );
      const after = await this.c.snapshot();
      if (
        after.snapshot.block.number < Number(receipt.receipt.blockNumber) ||
        after.snapshot.liquidationThresholdBps !==
          receipt.finalState.liquidationThresholdBps ||
        after.snapshot.stateVersion !== receipt.finalState.stateVersion
      )
        throw new Error(
          "Graph has not indexed the reviewed execution, or later state changed",
        );
      const indexed = await readGraphV2State(this.c, after.snapshot, {
        bound: f.bound,
        transactionHash: f.hashes.execute,
      });
      // Recompute at the indexed AFTER state. A parameter update need not change
      // every verdict; demonstrate actual source-dependent health metrics.
      const simulation = simulate(
        after.snapshot,
        f.bound.intent.proposedValueBps,
        f.bound.preflight.stressBps,
      );
      if (
        simulation.currentNormal.minFiniteHealthFactorE18 ===
        f.bound.preflight.simulation.currentNormal.minFiniteHealthFactorE18
      )
        throw new Error("Expected new-event-to-analysis effect not observed");
      const old = f.view.proof as { proof: Record<string, unknown> };
      const proof = {
        ...old.proof,
        graphAfter: {
          snapshot: after.snapshot,
          indexed,
          simulation,
          beforeMinHealthFactorE18:
            f.bound.preflight.simulation.currentNormal.minFiniteHealthFactorE18,
          afterMinHealthFactorE18:
            simulation.currentNormal.minFiniteHealthFactorE18,
          newEventChangesAnalysis: true,
        },
      };
      f.view.proof = { proof, publicProofHash: hashCanonical(proof) };
      await this.event(
        f,
        "新 LT 与状态版本事件已进入 hosted Graph，并改变重新计算的健康度",
      );
    });
  }
  private async operation(id: string, fn: (f: Flow) => Promise<void>) {
    return this.disk.exclusive("operation", async () => {
      const f = await this.flow(id);
      try {
        await fn(f);
      } catch (e) {
        f.view.error = safeConsoleError(e);
        await this.event(f, f.view.error);
      }
      return f.view;
    });
  }
}

let service: Promise<ConsoleService> | undefined;
export function consoleService() {
  const root = process.env.PARAMSHIELD_ROOT;
  if (!root || !process.env.PARAMSHIELD_CONSOLE_TOKEN)
    throw new Error("Local console is disabled");
  service ??= ConsoleService.load(root).catch((e) => {
    service = undefined;
    throw e;
  });
  return service;
}
