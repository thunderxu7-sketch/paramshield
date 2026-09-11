import { createAnalysisReport } from "./analysis-report";
import { MinedTransactionValidationError } from "./decision-7702";
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
import type { ConsoleJournal, ConsoleStatus, FlowView } from "../console-types";
import { explainEvidence } from "./evidence-explanation";
import { readGraphV2State } from "./graph-v2-state";
import { simulate } from "@paramshield/risk-engine";
import {
  AUTHORIZATION_MODE,
  authorizationTypedData,
} from "./authorization-scope";
import { ScopedReviewStore } from "./scoped-review-store";
import {
  bindScopedRun,
  checkScopedAuthorization,
  isScopedRun,
  type FreshCheckpoint,
} from "./scoped-authorization";
import { authorizationDeadline, unfinishedTransaction } from "../console-state";

type Flow = {
  view: FlowView;
  run?: CreExecutionRun;
  bound?: BoundRun;
  approvedAt?: number;
  freshnessChecks?: FreshCheckpoint[];
  plans: Partial<Record<"propose" | "decision" | "execute", SigningPlan>>;
  hashes: Partial<Record<"propose" | "decision" | "execute", Hex>>;
};
export function safeConsoleError(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (
    /Scoped market state changed|Scoped live state, permissions or proposal changed/.test(
      text,
    )
  )
    return "市场数据或权限已变化；本次授权不再适用。已完成的交易保留，必须重新分析和审核，不能只刷新时间戳。";
  if (/Scoped authorization expired/.test(text))
    return "本次精确授权已到期，不能续期或复用签名。请核对已有交易，再创建新的分析。";
  if (/Scoped runner capability/.test(text))
    return "当前策略或可信运行能力不匹配；旧审核不会自动升级为新授权。";
  if (/unfinished flow|Unknown transaction|Retirement requires/.test(text))
    return "先核对已有交易。仅已确认且链上意图已到期的提案可以结束；未知钱包请求不能跳过。";
  if (
    /historical state.+not available|missing trie node|state.+pruned/is.test(
      text,
    )
  )
    return "RPC 不提供该回执区块的历史状态，暂不能完成重新核验。原交易和已保存进度仍保留；需要支持历史状态的 RPC，不要重发。";
  if (
    error instanceof MinedTransactionValidationError ||
    /^(Mined|Signed) transaction does not match reviewed plan$/.test(text)
  )
    return "钱包交易格式或执行内容与已审阅计划不匹配，暂不能完成回执核验。这不代表审核签名无效或链上交易失败；保留已有哈希，只读核对，不要重签或重发。";
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
  readonly scopedReviews: ScopedReviewStore;
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
    this.scopedReviews = new ScopedReviewStore(
      new DurableStore(join(root, ".local/console/scoped-reviews")),
      [reviewer],
      c.now,
    );
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
    f.view.revision = (f.view.revision ?? 0) + 1;
    f.view.updatedAt = this.c.now();
    this.projectTransactions(f);
    await this.disk.write(`flow-${f.view.id}`, {
      view: f.view,
      bound: f.bound,
      approvedAt: f.approvedAt,
      ...(f.freshnessChecks ? { freshnessChecks: f.freshnessChecks } : {}),
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
    this.projectTransactions(stored);
    return stored;
  }
  private projectTransactions(f: Flow) {
    // Public hashes only. Never expose plans, raw transactions or signatures.
    f.view.transactions = { ...f.hashes };
    f.view.preparedLegs = Object.keys(f.plans) as (keyof Flow["plans"])[];
  }
  private run(f: Flow) {
    if (!f.run || !f.view.active || f.view.retired)
      throw new Error("Restarted or expired flow; fresh analysis required");
    return f.run;
  }
  private async check(f: Flow, expectedState: 0 | 1 | 2, requireReview = true) {
    const run = this.run(f);
    if (!isScopedRun(run)) {
      if (expectedState === 2)
        throw new Error("Legacy execution uses its original gate");
      return checkLifecycle(
        run,
        this.c,
        this.reviews,
        expectedState,
        requireReview,
      );
    }
    const { bound, checkpoint } = await checkScopedAuthorization(
      run,
      this.c,
      this.scopedReviews,
      expectedState,
      requireReview,
    );
    f.freshnessChecks ??= [];
    f.freshnessChecks.push(checkpoint);
    f.view.lastFreshCheck = {
      checkedAt: checkpoint.checkedAt,
      freshUntil: checkpoint.freshUntil,
      blockNumber: checkpoint.snapshotBlock.number,
    };
    await this.save(f);
    if (this.c.now() >= checkpoint.freshUntil)
      throw new Error(
        "Fresh checkpoint expired while persisting; no signing allowed",
      );
    return bound;
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
        authorizationDeadline(f.view) === undefined
          ? null
          : authorizationDeadline(f.view)! - completedAt,
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
  async journal(): Promise<ConsoleJournal> {
    // Recovery must not depend on Privy/RPC availability. Read committed disk
    // records, not a mutable in-flight view that may not have been saved yet.
    const ids = ((await this.disk.read("index")) as string[] | null) ?? [];
    const history = await Promise.all(
      ids.map(async (id) => {
        const stored = (await this.disk.read(`flow-${id}`)) as Flow | null;
        if (!stored) throw new Error("Missing durable history record");
        stored.view.active = Boolean(this.flows.get(id)?.view.active);
        this.projectTransactions(stored);
        return stored.view;
      }),
    );
    return {
      chainId: 11155111,
      market: this.c.target.market,
      executor: this.c.target.executor,
      operator: this.c.target.operator,
      authority: this.c.target.decisionAuthority,
      reviewer: this.reviewer,
      admin: this.admin,
      graphDeployment: this.c.graphDeployment,
      aiConfigured: Boolean(
        process.env.OPENAI_API_KEY?.trim() &&
        process.env.PARAMSHIELD_EXPLANATION_MODEL?.trim(),
      ),
      readAt: this.c.now(),
      history,
    };
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
    return {
      ...(await this.journal()),
      checkedAt: this.c.now(),
      operatorBalanceWei: balance.toString(),
      locked: policy.locked,
      stateVersion: live.stateVersion,
      authorizationEpoch: live.authorizationEpoch,
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
      // Browser-side disabling is not authority. Do not orphan an outstanding
      // chain action by creating another flow through a direct API request.
      const journal = await this.journal();
      if (journal.history.some(unfinishedTransaction))
        throw new Error(
          "Existing unfinished flow must be recovered or retired first",
        );
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
        f.run = await new CreExecutionRunner(this.root, this.c.now).run(
          () =>
            this.c.preflight(
              threshold,
              "ParamShield local console: reviewed LT decrease",
              AUTHORIZATION_MODE,
            ),
          { authorizationMode: AUTHORIZATION_MODE },
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
        if (b.decision.verdict === "ALLOW") {
          const { scope } = bindScopedRun(f.run, this.c);
          f.view.authorization = {
            mode: scope.mode,
            expiresAt: scope.expiresAt,
            scopeHash: scope.scopeHash,
            marketStateHash: scope.marketStateHash,
            policyHash: scope.policyHash,
          };
        }
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
      let typed:
        | ReturnType<typeof reviewTypedData>
        | ReturnType<typeof authorizationTypedData>;
      try {
        if (f.view.stage !== "ALLOW")
          throw new Error("Review is unavailable at this stage");
        const b = await this.check(f, 0, false);
        f.approvedAt ??= this.c.now();
        typed = isScopedRun(this.run(f))
          ? authorizationTypedData(
              b.preflight,
              b.decision,
              bindScopedRun(this.run(f), this.c).scope.policyHash,
              f.approvedAt,
            )
          : reviewTypedData(b.preflight, b.decision, f.approvedAt);
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
        const b = await this.check(f, 0, false);
        if (isScopedRun(this.run(f))) {
          await this.scopedReviews.record(
            b.preflight,
            b.decision,
            bindScopedRun(this.run(f), this.c).scope.policyHash,
            f.approvedAt,
            signature,
          );
          await this.check(f, 0);
        } else
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
      const check = () => this.check(f, 0);
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
        check = () => this.check(f, 1);
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
      const run = this.run(f);
      const ready = isScopedRun(run)
        ? await prepareLifecyclePlan({
            client: this.c.client,
            from: this.c.target.operator,
            to: this.c.target.executor,
            data: lifecycleData(await this.check(f, 2), "execute"),
            expiresAt: f.bound!.intent.expiresAt,
            revalidate: () => this.check(f, 2),
          })
        : await prepareRelaySigning({
            run,
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
        ...(f.view.authorization
          ? {
              scopedAuthorization: f.view.authorization,
              freshnessChecks: f.freshnessChecks ?? [],
              renewalRule:
                "New observations of exactly the reviewed state; original evidence and signatures unchanged",
            }
          : {}),
      };
      // This is a separately hashed redacted proof, not the original bundle hash.
      f.view.proof = { proof, publicProofHash: hashCanonical(proof) };
      f.view.stage = "EXECUTED";
    } else f.view.stage = leg === "propose" ? "PROPOSED" : "DECIDED";
    delete f.view.error;
    await this.event(
      f,
      `${leg}：两次确认、交易意图与钱包格式、合约事件和同区块回读全部核对`,
      hash,
    );
  }
  async recover(id: string, leg: "propose" | "decision" | "execute") {
    return this.operation(id, async (f) => {
      const stages = {
        propose: ["PROPOSING", "PROPOSED"],
        decision: ["DECISION_READY", "DECISION_PENDING", "DECIDED"],
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
      // Only the matching current leg can be rechecked; an earlier leg must
      // never downgrade a later confirmed stage.
      f.hashes[leg] = hash;
      await this.confirm(f, leg, hash);
    });
  }
  async retireExpired(id: string) {
    return this.operation(id, async (f) => {
      if (f.view.retired) return; // Idempotent, no repeated network or writes.
      // NEVER infer failure from a UI timer or from a missing hash. Issued or
      // unknown wallet/signing jobs must first obtain a verified receipt.
      if (!f.bound || !["PROPOSED", "DECIDED"].includes(f.view.stage))
        throw new Error("Retirement requires a confirmed proposal or decision");
      const leg = f.view.stage === "PROPOSED" ? "propose" : "decision";
      if (
        !f.hashes[leg] ||
        !f.plans[leg] ||
        (leg === "propose" && f.plans.decision) ||
        f.plans.execute
      )
        throw new Error(
          "Unknown transaction must be resolved before retirement",
        );
      await verifyLifecycleReceipt(
        this.c.client,
        f.plans[leg],
        f.hashes[leg],
        f.bound,
        leg,
      );
      const live = await this.c.live(f.bound.changeHash);
      if (
        live.block.timestamp <= f.bound.intent.expiresAt ||
        this.c.now() <= f.bound.intent.expiresAt ||
        ![leg === "propose" ? 1 : 2, 6].includes(live.proposal.state) ||
        (leg === "decision" &&
          live.proposal.decisionHash !== f.bound.decisionHash) ||
        live.block.hash !==
          (await this.c.state.canonicalBlockHash(live.block.number))
      )
        throw new Error(
          "Retirement requires canonical on-chain expiry and matching state",
        );
      f.view.retired = {
        checkedAt: this.c.now(),
        blockNumber: live.block.number,
        blockTimestamp: live.block.timestamp,
      };
      f.view.active = false;
      delete f.view.error;
      await this.event(
        f,
        "只读核验：链上意图已到期，结束本机授权；保留提案、回执和全部证据，没有发送交易",
      );
    });
  }
  async analysisReport(id: string) {
    const f = await this.flow(id);
    if (!f.bound) throw new Error("Analysis evidence required");
    return createAnalysisReport(f.bound);
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
