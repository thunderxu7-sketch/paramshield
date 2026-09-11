"use client";

import { useState } from "react";
import {
  BusyButton,
  LoadingHint,
  OperationNotice,
  Skeleton,
  Spinner,
} from "@/components/loading-feedback";
import { EvidenceSources } from "@/components/evidence-sources";
import type { AnalysisReport } from "@/lib/server/analysis-report";
import { operationFeedback } from "@/lib/loading-state";
import Link from "next/link";
import { formatEther, formatUnits } from "viem";
import { useConsole } from "@/lib/use-console";
import {
  completedSteps,
  nextStep,
  recoveryLeg,
  unfinishedTransaction,
  authorizationDeadline,
} from "@/lib/console-state";

const short = (value?: string) =>
  value ? `${value.slice(0, 10)}…${value.slice(-6)}` : "—";
const pct = (value: number) => `${(value / 100).toFixed(2)}%`;
const usd = (value: string) =>
  `$${Number(formatUnits(BigInt(value), 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const stageNames: Record<string, string> = {
  ANALYZING: "正在分析",
  BLOCKED: "已阻断",
  ALLOW: "等待人工审核",
  REVIEWED: "审核签名已验证",
  PROPOSING: "提案待确认",
  PROPOSED: "提案已上链",
  DECISION_READY: "等待 authority 交易",
  DECISION_PENDING: "决策交易待确认",
  DECIDED: "链上决策已确认",
  EXECUTING: "执行待确认",
  EXECUTED: "执行已验证",
  FAILED: "分析失败",
};

export default function ConsolePage() {
  const {
    ready,
    authenticated,
    journal,
    status,
    history,
    flow,
    threshold,
    pending,
    selectedId,
    busy,
    busyStartedAt,
    error,
    now,
    account,
    chainId,
    storageError,
    liveError,
    journalError,
    loadingJournal,
    loadingLive,
    fundingHash,
    liveFresh,
    api,
    load,
    loadJournal,
    task,
    select,
    setThreshold,
    analyze,
    action,
    walletFor,
    beginOperation,
    patchOperation,
    clearOperation,
    recordFundingHash,
  } = useConsole();
  const [question, setQuestion] = useState(
    "为什么阻断？哪个风险是这次参数修改额外带来的？",
  );
  const [recoveryHash, setRecoveryHash] = useState("");
  const feedback = operationFeedback(busy, pending, busyStartedAt, now);
  const analyzing = Boolean(busy && pending?.kind === "analyze");
  const explaining = busy === "生成证据式解释";
  const executionBusy = Boolean(
    busy &&
    pending &&
    ["review", "propose", "decision", "execute"].includes(pending.kind),
  );
  const deadline = flow ? authorizationDeadline(flow) : undefined;
  const expired =
    !flow?.active || !deadline || now >= deadline || Boolean(flow.retired);
  const disabled = Boolean(busy) || !ready || !authenticated || !journal;
  const writeDisabled =
    disabled || !liveFresh || Boolean(storageError || pending || journalError);
  const gasNeeded = status
    ? BigInt(status.operatorBalanceWei) < 1_000_000_000_000_000n
    : true;
  const bps = Math.round(Number(threshold) * 100);
  const canAnalyze =
    threshold.trim() !== "" && Number.isFinite(bps) && bps > 0 && bps < 10000;
  const draftMatchesFlow = Boolean(
    flow && canAnalyze && bps === flow.proposedValueBps,
  );
  const authorizationDisabled = writeDisabled || expired || !draftMatchesFlow;
  const step = nextStep(flow, now);
  const completed = flow ? completedSteps(flow.stage) : 0;
  const unfinished = history.find(unfinishedTransaction);
  const expectedWallet =
    step.action === "review"
      ? journal?.reviewer
      : step.action === "decision"
        ? journal?.authority
        : undefined;
  const walletMatches =
    !expectedWallet ||
    (account.toLowerCase() === expectedWallet.toLowerCase() &&
      chainId === "0xaa36a7");
  const role = !account
    ? "钱包未连接"
    : !journal
      ? "钱包已连接 · 等待本机角色配置"
      : account.toLowerCase() === journal.reviewer.toLowerCase()
        ? "Account 2 · 审核人"
        : account.toLowerCase() === journal?.authority.toLowerCase()
          ? "Account 1 · 决策人"
          : account.toLowerCase() === journal?.admin.toLowerCase()
            ? "Imported Account 1 · 管理员"
            : "当前账号不属于指定角色";
  const resumeFlow = pending
    ? (history.find((f) => f.id === pending.flowId) ?? null)
    : flow;
  async function recover() {
    if (!resumeFlow) {
      await loadJournal();
      return;
    }
    const leg = recoveryLeg(resumeFlow);
    if (!leg) {
      await loadJournal();
      return;
    }
    const saved =
      pending?.hash ??
      sessionStorage.getItem(`paramshield-decision-${resumeFlow.id}`) ??
      "";
    const hash = /^0x[0-9a-fA-F]{64}$/.test(saved)
      ? saved
      : recoveryHash.trim();
    if (
      leg === "decision" &&
      ["DECISION_READY", "DECISION_PENDING"].includes(resumeFlow.stage) &&
      /^0x[0-9a-fA-F]{64}$/.test(hash)
    )
      await action("decision-receipt", { hash }, resumeFlow.id);
    else await action("recover", { leg }, resumeFlow.id);
  }

  return (
    <main className="ps-console">
      <header className="ps-topbar">
        <Link href="/" className="ps-brand">
          <span>P</span> ParamShield
        </Link>
        <div className="ps-network">
          <i /> Sepolia · v2 <span>LOCAL CONTROL PLANE</span>
        </div>
        <BusyButton
          loading={busy === "连接钱包"}
          className="ps-button secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            void task("连接钱包", async () => {
              await walletFor();
            })
          }
        >
          {account
            ? `${short(account)} · ${chainId === "0xaa36a7" ? "Sepolia" : "网络待切换"}`
            : "连接 MetaMask"}
        </BusyButton>
      </header>
      <div className="ps-layout">
        <aside className="ps-sidebar">
          <p className="ps-eyebrow">WORKSPACE</p>
          <a className="selected" href="#change">
            参数预检
          </a>
          <a href="#evidence">证据时间线</a>
          <a href="#explanation">风险解释</a>
          <div className="ps-sidebar-note">
            <strong>安全边界</strong>
            <p>
              实际 CRE CLI 模拟
              <br />
              非硬件 TEE
              <br />
              AI 没有执行权限
              <br />
              不使用主网资产
            </p>
          </div>
          <p className="ps-eyebrow">RECENT RUNS</p>
          <div className="ps-history">
            {!journal && (
              <p className="ps-muted">
                {journalError ? (
                  "读取记录失败，可重试"
                ) : ready && !authenticated ? (
                  "请先载入本机会话"
                ) : (
                  <LoadingHint>正在恢复本机记录</LoadingHint>
                )}
              </p>
            )}
            {journal && history.length === 0 && (
              <p className="ps-muted">还没有分析记录</p>
            )}
            {history.slice(0, 8).map((f) => (
              <BusyButton
                key={f.id}
                disabled={Boolean(busy)}
                onClick={() => select(f)}
                className={flow?.id === f.id ? "selected" : ""}
              >
                <span>{pct(f.proposedValueBps)}</span>
                <small>
                  {busy && pending?.flowId === f.id && <Spinner />}
                  {stageNames[f.stage]}
                </small>
                <small>
                  {new Date(f.createdAt * 1000).toLocaleString("zh-CN", {
                    hour12: false,
                  })}{" "}
                  · {f.id.slice(0, 8)}
                </small>
              </BusyButton>
            ))}
          </div>
        </aside>
        <div className="ps-main">
          {feedback && <OperationNotice {...feedback} />}
          <div className="ps-heading">
            <div>
              <p className="ps-eyebrow">EVIDENCE BEFORE EXECUTION</p>
              <h1>参数变更控制台</h1>
              <p>审核一次精确修改；每步刷新数据，状态变化即停止。</p>
            </div>
            <BusyButton
              loading={loadingLive || loadingJournal}
              loadingText="正在读取状态"
              className="ps-button secondary"
              disabled={
                !ready || !authenticated || loadingLive || loadingJournal
              }
              onClick={() => void load()}
            >
              {loadingLive || loadingJournal ? "正在读取状态…" : "刷新链上状态"}
            </BusyButton>
          </div>
          {!authenticated && ready && (
            <div className="ps-warning">
              控制台未认证。请使用本机启动程序生成的私有链接；不要分享 session
              URL。
            </div>
          )}
          {authenticated && !journal && !journalError && (
            <div className="ps-progress" role="status">
              <LoadingHint>正在恢复本机进度；无需重新分析或签名。</LoadingHint>
            </div>
          )}
          {journalError && (
            <div className="ps-warning" role="alert">
              {journalError}{" "}
              <BusyButton
                loading={loadingJournal}
                loadingText="正在读取记录"
                className="ps-button secondary"
                disabled={loadingJournal}
                onClick={() => void loadJournal()}
              >
                重试读取记录
              </BusyButton>
            </div>
          )}
          {storageError && (
            <div className="ps-warning" role="alert">
              {storageError}
            </div>
          )}
          {(liveError || (status && !liveFresh)) && (
            <div className="ps-warning" role="status">
              实时校验暂不可用或已过时；已完成的进度仍保留。新授权暂停，刷新仅重新读取状态，不会重发交易。
            </div>
          )}
          <p className="ps-caption" aria-live="polite">
            {role} · {chainId === "0xaa36a7" ? "Sepolia" : "网络待核对"}
            {journal &&
              ` · 本机记录已同步 ${new Date(journal.readAt * 1000).toLocaleTimeString("zh-CN", { hour12: false })}`}
            {status &&
              ` · 链上/策略最近核验 ${new Date(status.checkedAt * 1000).toLocaleTimeString("zh-CN", { hour12: false })}`}
            {loadingLive && (
              <LoadingHint>实时校验中（不影响查看记录）</LoadingHint>
            )}
          </p>
          {pending && !busy && (
            <div className="ps-warning" role="alert">
              <strong>已恢复中断的 {pending.kind} 请求，未自动重发。</strong>
              <p>先核对记录与钱包活动；页面刷新不代表钱包拒绝或交易失败。</p>
              <BusyButton
                loading={busy === "只读核对中断请求"}
                className="ps-button secondary"
                disabled={disabled}
                onClick={() => void task("只读核对中断请求", recover)}
              >
                只读核对已有请求
              </BusyButton>
              {pending.kind === "review" && pending.phase === "wallet" && (
                <BusyButton
                  className="ps-button secondary"
                  disabled={disabled}
                  onClick={() => clearOperation(pending.id)}
                >
                  我已在钱包取消审核请求
                </BusyButton>
              )}
            </div>
          )}
          {selectedId && !flow && journal && (
            <div className="ps-warning">
              正在查找已选记录 {selectedId.slice(0, 8)}
              ；不会自动切到另一份证据。
              {history[0] && (
                <BusyButton
                  className="ps-button secondary"
                  onClick={() => select(history[0]!)}
                >
                  查看最新已保存记录
                </BusyButton>
              )}
            </div>
          )}
          {flow && (
            <section className="ps-resume" aria-label="当前进度">
              <div>
                <small>已保存的进度 · {flow.id.slice(0, 8)}</small>
                <h2>{stageNames[flow.stage]}</h2>
                <p>{step.title}</p>
              </div>
              <div>
                <strong>{pct(flow.proposedValueBps)}</strong>
                <small>本份证据的目标 LT</small>
                <a href="#execution">查看下一步 ↓</a>
              </div>
            </section>
          )}
          {(error || flow?.error) && (
            <div className="ps-warning" role="alert">
              {error || flow?.error}
            </div>
          )}

          <section className="ps-metrics" aria-label="Live integration status">
            <article>
              <small>THE GRAPH</small>
              <strong>独立 v2 索引</strong>
              <LoadingHint active={analyzing}>
                Graph / RPC 同区块核对与 CRE 分析中
              </LoadingHint>
              <span title={journal?.graphDeployment}>
                {short(journal?.graphDeployment)}
              </span>
            </article>
            <article>
              <small>MARKET STATE</small>
              <strong>
                {status ? (
                  `Version ${status.stateVersion}`
                ) : loadingLive ? (
                  <Skeleton label="正在读取市场状态" />
                ) : (
                  "Version —"
                )}
              </strong>
              <LoadingHint active={loadingLive}>读取链上状态</LoadingHint>
              <span>授权 Epoch {status?.authorizationEpoch ?? "—"}</span>
            </article>
            <article>
              <small>PRIVY OPERATOR</small>
              <strong>
                {status ? (
                  status.locked && liveFresh ? (
                    "DENY 已核验"
                  ) : (
                    "待实时核验"
                  )
                ) : loadingLive ? (
                  <Skeleton label="正在读取 Privy 策略" />
                ) : (
                  "待实时核验"
                )}
              </strong>
              <LoadingHint active={loadingLive}>核对策略与余额</LoadingHint>
              <span>
                {status
                  ? Number(
                      formatEther(BigInt(status.operatorBalanceWei)),
                    ).toFixed(5)
                  : "—"}{" "}
                Sepolia ETH
              </span>
            </article>
            <article>
              <small>EXECUTION</small>
              <strong>
                {flow?.stage === "EXECUTED" ? "回执已核验" : "尚未完成"}
              </strong>
              <LoadingHint
                active={Boolean(
                  busy &&
                  pending &&
                  ["propose", "decision", "execute"].includes(pending.kind),
                )}
              >
                处理当前执行步骤
              </LoadingHint>
              <span>仅 ALLOW + 真人签名 + 链上决策</span>
            </article>
          </section>
          {status && gasNeeded && (
            <section className="ps-preparation">
              <div>
                <strong>先为专用 operator 准备 gas</strong>
                <p>
                  从 admin {short(status.admin)} 向 {short(status.operator)}{" "}
                  转入 0.01 Sepolia ETH。仅测试币，不转移任何角色。
                </p>
              </div>
              <BusyButton
                loading={busy === "等待测试币转账确认"}
                className="ps-button secondary"
                disabled={writeDisabled || Boolean(fundingHash)}
                onClick={() =>
                  void task("等待测试币转账确认", async () => {
                    const p = await walletFor(status.admin);
                    beginOperation("funding", crypto.randomUUID());
                    patchOperation({ phase: "wallet" });
                    const hash = (await p.request({
                      method: "eth_sendTransaction",
                      params: [
                        {
                          from: status.admin,
                          to: status.operator,
                          value: "0x2386f26fc10000",
                          data: "0x",
                          chainId: "0xaa36a7",
                        },
                      ],
                    })) as string;
                    if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
                      throw new Error(
                        "未收到有效交易哈希；请检查钱包活动，勿重复转账。",
                      );
                    patchOperation({ phase: "submitted", hash });
                    recordFundingHash(hash);
                  })
                }
              >
                {fundingHash ? "已发送，请刷新余额" : "审阅 gas 转账"}
              </BusyButton>
              {fundingHash && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://sepolia.etherscan.io/tx/${fundingHash}`}
                >
                  查看 gas 交易 ↗
                </a>
              )}
            </section>
          )}
          <div className="ps-work-grid">
            <section className="ps-panel" id="change">
              <div className="ps-section-label">
                <span>01 / CHANGE REQUEST</span>
                <small>Reference Lending Market</small>
              </div>
              <h2>降低清算阈值</h2>
              <p className="ps-muted">
                唯一支持的参数；压力情景为抵押品价格下跌 15%。
              </p>
              <div className="ps-threshold">
                <div>
                  <small>分析时 LT</small>
                  <strong>
                    {flow?.snapshot
                      ? pct(flow.snapshot.liquidationThresholdBps)
                      : "读取后显示"}
                  </strong>
                </div>
                <span>→</span>
                <label>
                  目标 LT (%)
                  <input
                    type="number"
                    disabled={Boolean(busy)}
                    min="0.01"
                    max="99.99"
                    step="0.01"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </label>
              </div>
              <BusyButton
                loading={busy === "读取 Graph 并运行实际 CRE"}
                className="ps-button primary"
                disabled={writeDisabled || !canAnalyze || Boolean(unfinished)}
                onClick={() =>
                  void task("读取 Graph 并运行实际 CRE", () => analyze(bps))
                }
              >
                读取实时数据并分析
              </BusyButton>
              <p className="ps-caption">
                不会请求签名或广播交易。新授权最长 10
                分钟；每步自动读取新数据，仍严格限制 120 秒 / 12 区块。
              </p>
              {unfinished && (
                <div className="ps-freshness expired">
                  已有尚未完成的链上流程 {unfinished.id.slice(0, 8)}
                  ，先核对它；不会用新分析覆盖或重复提案。
                  {unfinished.id !== flow?.id && (
                    <BusyButton
                      className="ps-button secondary"
                      onClick={() => select(unfinished)}
                    >
                      返回已有提案
                    </BusyButton>
                  )}
                  {["PROPOSED", "DECIDED"].includes(unfinished.stage) &&
                    unfinished.expiresAt &&
                    now > unfinished.expiresAt && (
                      <BusyButton
                        loading={busy === "只读核验旧授权到期"}
                        className="ps-button secondary"
                        disabled={disabled || Boolean(pending)}
                        onClick={() =>
                          void task("只读核验旧授权到期", () =>
                            action("retire-expired", {}, unfinished.id),
                          )
                        }
                      >
                        核验链上到期并结束旧授权（不发交易）
                      </BusyButton>
                    )}
                </div>
              )}
              {flow?.decision?.recommendedValueBps != null && (
                <div className="ps-recommendation">
                  <div>
                    <small>DETERMINISTIC SEARCH</small>
                    <strong>{pct(flow.decision.recommendedValueBps)}</strong>
                    <p>不是 AI 猜测；必须新建 intent 并重算。</p>
                  </div>
                  <BusyButton
                    loading={busy === "用推荐值重新分析"}
                    className="ps-button secondary"
                    disabled={writeDisabled || Boolean(unfinished)}
                    onClick={() =>
                      void task("用推荐值重新分析", () => {
                        const v = flow.decision!.recommendedValueBps!;
                        setThreshold((v / 100).toFixed(2));
                        return analyze(v);
                      })
                    }
                  >
                    采用候选值重算
                  </BusyButton>
                </div>
              )}
            </section>
            <section className="ps-panel ps-verdict" aria-busy={analyzing}>
              {analyzing && (
                <div className="ps-local-progress">
                  <LoadingHint>
                    读取 Graph → 确定性仿真 → CRE 政策核验
                  </LoadingHint>
                  <div className="ps-indeterminate" aria-hidden="true">
                    <span />
                  </div>
                </div>
              )}
              <div className="ps-section-label">
                <span>02 / POLICY DECISION</span>
                <small>Actual CRE CLI</small>
              </div>
              <div
                className={`ps-verdict-word ${flow?.decision?.verdict === "BLOCK" ? "blocked" : ""}`}
              >
                {analyzing ? (
                  <LoadingHint>分析中</LoadingHint>
                ) : (
                  (flow?.decision?.verdict ??
                  (journal ? "READY" : <LoadingHint>载入中</LoadingHint>))
                )}
              </div>
              <h2>
                {flow
                  ? stageNames[flow.stage]
                  : journal
                    ? "等待第一份证据"
                    : "正在恢复记录"}
              </h2>
              {flow && (
                <p className="ps-muted">
                  本份证据绑定 LT：
                  {flow.snapshot
                    ? pct(flow.snapshot.liquidationThresholdBps)
                    : "—"}{" "}
                  → <strong>{pct(flow.proposedValueBps)}</strong>
                </p>
              )}
              <p className="ps-muted">
                {flow?.decision
                  ? "判定只针对本次 LT 变更，不代表整个市场安全。"
                  : "Graph 与 RPC 同区块核对后，再运行确定性仿真与 CRE 政策。"}
              </p>
              {flow?.decision && !draftMatchesFlow && (
                <div className="ps-freshness expired" role="alert">
                  输入值尚未分析；当前判定仅绑定 {pct(flow.proposedValueBps)}。
                  {unfinished
                    ? "草稿不会改变已上链提案；请先核对已有流程。"
                    : "请重新分析，不能用旧判定授权。"}
                </div>
              )}
              {flow?.freshUntil && (
                <div className={`ps-freshness ${expired ? "expired" : ""}`}>
                  {flow.authorization ? (
                    <>
                      <strong>
                        {flow.retired
                          ? "旧授权已结束"
                          : expired
                            ? "本次授权不可继续"
                            : `精确授权剩余 ${Math.ceil(Math.max(0, deadline! - now) / 60)} 分钟`}
                      </strong>
                      <p>
                        只允许本次
                        LT、状态版本和权限版本；不续期、不自动换参数。每步重新核验
                        Graph/RPC，旧快照变老不等于人工授权失效。
                      </p>
                      <small>
                        {flow.lastFreshCheck
                          ? `最近数据核验：区块 ${flow.lastFreshCheck.blockNumber} · ${new Date(flow.lastFreshCheck.checkedAt * 1000).toLocaleTimeString("zh-CN", { hour12: false })}；下一次操作会再次核验。`
                          : "尚未执行授权前的数据复核；点击下一步时自动完成。"}
                      </small>
                    </>
                  ) : expired ? (
                    "证据不可用于继续授权；已完成步骤和交易记录仍保留。"
                  ) : (
                    `数据可用窗口剩余 ${Math.max(0, flow.freshUntil - now)} 秒`
                  )}
                </div>
              )}
              <div className="ps-hashes">
                <span>
                  区块 <b>{flow?.snapshot?.block.number ?? "—"}</b>
                </span>
                <span>
                  Change{" "}
                  <code title={flow?.changeHash}>
                    {short(flow?.changeHash)}
                  </code>
                </span>
                <span>
                  Preflight{" "}
                  <code title={flow?.preflightHash}>
                    {short(flow?.preflightHash)}
                  </code>
                </span>
                <span>
                  Decision{" "}
                  <code title={flow?.decisionHash}>
                    {short(flow?.decisionHash)}
                  </code>
                </span>
              </div>
            </section>
          </div>
          {flow?.simulation && (
            <section className="ps-panel">
              <div className="ps-section-label">
                <span>03 / BEFORE & AFTER</span>
                <small>额外压力敞口，不混淆存量风险</small>
              </div>
              <div className="ps-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>情景</th>
                      <th>正常 · Before</th>
                      <th>正常 · After</th>
                      <th>压力 · Before</th>
                      <th>压力 · After</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>可清算仓位</th>
                      {[
                        flow.simulation.currentNormal,
                        flow.simulation.proposedNormal,
                        flow.simulation.currentStress,
                        flow.simulation.proposedStress,
                      ].map((c, n) => (
                        <td key={n}>
                          <a
                            href={`#source-simulation.${["currentNormal", "proposedNormal", "currentStress", "proposedStress"][n]}.liquidatableCount`}
                          >
                            {c.liquidatableCount}
                          </a>
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th>可清算债务</th>
                      {[
                        flow.simulation.currentNormal,
                        flow.simulation.proposedNormal,
                        flow.simulation.currentStress,
                        flow.simulation.proposedStress,
                      ].map((c, n) => (
                        <td key={n}>
                          <a
                            href={`#source-simulation.${["currentNormal", "proposedNormal", "currentStress", "proposedStress"][n]}.liquidatableDebtUsdE18`}
                          >
                            {usd(c.liquidatableDebtUsdE18)}
                          </a>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="ps-deltas">
                <span>
                  正常新增：
                  <b>
                    {flow.simulation.newlyLiquidatableAccounts.length} 个仓位
                  </b>
                </span>
                <span>
                  压力额外债务：
                  <b>{usd(flow.simulation.additionalStressedDebtUsdE18)}</b>
                </span>
              </div>
            </section>
          )}
          {flow && <EvidenceSources flow={flow} />}
          <section className="ps-panel" id="execution">
            <div className="ps-section-label">
              <span>04 / CONTROLLED EXECUTION</span>
              <small>人工审核与 authority 分离 · 交易价值为 0</small>
            </div>
            <ol
              className={`ps-steps ${executionBusy ? "is-processing" : ""}`}
              aria-label="执行进度"
            >
              {["人工审核", "提案上链", "链上决策", "受控执行"].map(
                (label, i) => (
                  <li
                    key={label}
                    className={
                      completed > i
                        ? "complete"
                        : completed === i
                          ? "current"
                          : ""
                    }
                  >
                    <span>{completed > i ? "✓" : i + 1}</span>
                    <b>{label}</b>
                    <small>
                      {completed > i
                        ? "已完成 · 记录保留"
                        : completed === i
                          ? "尚未完成"
                          : "后续步骤"}
                    </small>
                  </li>
                ),
              )}
            </ol>
            <div className="ps-next-step" aria-live="polite">
              <h2>{step.title}</h2>
              <p>{step.detail}</p>
              {flow && expired && unfinishedTransaction(flow) && (
                <p className="ps-muted">
                  旧签名不会自动升级或续期。先核对已有交易；链上意图已到期后，可在上方只读核验并结束旧授权，再创建新分析。
                </p>
              )}
              {expectedWallet && (
                <p
                  className={
                    walletMatches ? "ps-muted" : "ps-freshness expired"
                  }
                >
                  {walletMatches
                    ? "账号与 Sepolia 网络已匹配。"
                    : `请先在 MetaMask 切到${step.action === "review" ? " Account 2（审核人）" : " Account 1（决策人）"} ${short(expectedWallet)}，并选择 Sepolia；切换后页面自动同步。`}
                </p>
              )}
              {step.action === "review" && (
                <BusyButton
                  loading={busy === "等待真人审核签名"}
                  className="ps-button primary"
                  disabled={
                    authorizationDisabled ||
                    !walletMatches ||
                    Boolean(unfinished)
                  }
                  onClick={() =>
                    void task("等待真人审核签名", async () => {
                      const id = flow!.id;
                      const p = await walletFor(journal!.reviewer);
                      beginOperation("review", id);
                      const payload = await api<{
                        reviewer: string;
                        typedData: unknown;
                      }>("review-payload", { id });
                      patchOperation({ phase: "wallet" });
                      const signature = (await p.request({
                        method: "eth_signTypedData_v4",
                        params: [
                          payload.reviewer,
                          JSON.stringify(payload.typedData),
                        ],
                      })) as string;
                      patchOperation({ phase: "submitted" });
                      await action("approve", { signature }, id);
                    })
                  }
                >
                  {flow?.authorization
                    ? "我已审阅，授权本次修改"
                    : "我已审阅，签署审核"}
                </BusyButton>
              )}
              {step.action === "propose" && (
                <BusyButton
                  loading={busy === "Privy 签名并提交提案（无需 MetaMask）"}
                  className="ps-button primary"
                  disabled={
                    authorizationDisabled || gasNeeded || Boolean(unfinished)
                  }
                  onClick={() =>
                    void task(
                      "Privy 签名并提交提案（无需 MetaMask）",
                      async () => {
                        beginOperation("propose", flow!.id);
                        await action("propose");
                      },
                    )
                  }
                >
                  提交已审核提案
                </BusyButton>
              )}
              {step.action === "decision" && (
                <BusyButton
                  loading={busy === "等待 Account 1 审阅链上决策"}
                  className="ps-button primary"
                  disabled={
                    authorizationDisabled ||
                    !walletMatches ||
                    Boolean(unfinished && unfinished.id !== flow?.id)
                  }
                  onClick={() =>
                    void task("等待 Account 1 审阅链上决策", async () => {
                      const id = flow!.id;
                      const p = await walletFor(journal!.authority);
                      beginOperation("decision", id);
                      const payload = await api<{
                        transaction: Record<string, string>;
                      }>("decision-payload", { id });
                      patchOperation({ phase: "wallet" });
                      sessionStorage.setItem(
                        `paramshield-decision-${id}`,
                        "REQUESTED",
                      );
                      const hash = (await p.request({
                        method: "eth_sendTransaction",
                        params: [payload.transaction],
                      })) as string;
                      if (!/^0x[0-9a-fA-F]{64}$/.test(hash))
                        throw new Error(
                          "未收到有效交易哈希；请检查钱包活动，不要重发。",
                        );
                      patchOperation({ phase: "submitted", hash });
                      sessionStorage.setItem(
                        `paramshield-decision-${id}`,
                        hash,
                      );
                      await action("decision-receipt", { hash }, id);
                    })
                  }
                >
                  审阅并发送 ALLOW 决策
                </BusyButton>
              )}
              {step.action === "execute" && (
                <BusyButton
                  loading={busy === "Privy 执行并核对真实回执（无需 MetaMask）"}
                  className="ps-button primary"
                  disabled={
                    authorizationDisabled ||
                    gasNeeded ||
                    Boolean(unfinished && unfinished.id !== flow?.id)
                  }
                  onClick={() =>
                    void task(
                      "Privy 执行并核对真实回执（无需 MetaMask）",
                      async () => {
                        beginOperation("execute", flow!.id);
                        await action("execute");
                      },
                    )
                  }
                >
                  执行本次参数修改
                </BusyButton>
              )}
              {step.action === "analyze" && (
                <a href="#change">返回参数输入与分析 ↑</a>
              )}
              {step.action === "recover" && (
                <>
                  {resumeFlow?.stage === "DECISION_READY" &&
                    !resumeFlow.transactions?.decision && (
                      <label className="ps-question">
                        已有决策交易哈希（从钱包活动中复制；仅用于核对，不发新交易）
                        <input
                          value={recoveryHash}
                          maxLength={66}
                          onChange={(e) => setRecoveryHash(e.target.value)}
                          placeholder="0x…"
                        />
                      </label>
                    )}
                  <BusyButton
                    loading={busy === "只读检查已记录交易"}
                    className="ps-button secondary"
                    disabled={disabled}
                    onClick={() => void task("只读检查已记录交易", recover)}
                  >
                    只读检查已记录交易（不重发）
                  </BusyButton>
                </>
              )}
              {step.action === "wait" && (
                <BusyButton
                  loading={loadingJournal}
                  loadingText="正在读取记录"
                  className="ps-button secondary"
                  disabled={loadingJournal}
                  onClick={() => void loadJournal()}
                >
                  只读刷新分析进度
                </BusyButton>
              )}
            </div>
            {flow?.transactions && (
              <div className="ps-saved-transactions">
                {Object.entries(flow.transactions).map(([leg, hash]) => (
                  <a
                    key={leg}
                    href={`https://sepolia.etherscan.io/tx/${hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {leg} · {short(hash)} ↗
                  </a>
                ))}
              </div>
            )}
            <p className="ps-caption">
              倒计时只显示时间预算；服务端仍核验区块、签名和版本。刷新只恢复记录，不续期、不重签、不自动广播。
            </p>
            {flow?.lastReviewAttempt && (
              <details className="ps-review-details">
                <summary>
                  审核记录：
                  {flow.lastReviewAttempt.outcome === "ACCEPTED"
                    ? "指定审核人签名已验证"
                    : flow.lastReviewAttempt.message}
                </summary>
                <p>{flow.lastReviewAttempt.message}</p>
                <small>
                  {new Date(
                    flow.lastReviewAttempt.completedAt * 1000,
                  ).toLocaleTimeString("zh-CN", { hour12: false })}{" "}
                  · {flow.lastReviewAttempt.code}
                  {flow.lastReviewAttempt.secondsRemaining !== null &&
                    ` · 核验时数据时间预算 ${flow.lastReviewAttempt.secondsRemaining} 秒`}
                </small>
              </details>
            )}
          </section>
          <div className="ps-work-grid">
            <section className="ps-panel" id="evidence">
              <div className="ps-section-label">
                <span>05 / EVIDENCE TIMELINE</span>
                <small>持久记录，不是 UI 推测</small>
              </div>
              <LoadingHint active={Boolean(busy)}>
                正在处理；完成后更新持久时间线
              </LoadingHint>
              <ol className="ps-timeline">
                {flow?.timeline.map((item, n) => (
                  <li key={n}>
                    <time>
                      {new Date(item.at * 1000).toLocaleTimeString("zh-CN", {
                        hour12: false,
                      })}
                    </time>
                    <p>{item.label}</p>
                    {item.transactionHash && (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${item.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(item.transactionHash)} ↗
                      </a>
                    )}
                  </li>
                )) ?? (
                  <li>
                    <p>分析后显示来源、决策、审核、交易与核验结果。</p>
                  </li>
                )}
              </ol>
              {flow?.decision && (
                <BusyButton
                  className="ps-button secondary"
                  loading={busy === "准备分析证据"}
                  disabled={disabled}
                  onClick={() =>
                    void task("准备分析证据", async () => {
                      const result = await api<AnalysisReport>(
                        "analysis-report",
                        { id: flow.id },
                      );
                      const url = URL.createObjectURL(
                        new Blob([JSON.stringify(result, null, 2)], {
                          type: "application/json",
                        }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `paramshield-analysis-${flow.id}.json`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    })
                  }
                >
                  下载分析证据（非执行证明）
                </BusyButton>
              )}
              {Boolean(flow?.proof) && (
                <BusyButton
                  className="ps-button secondary"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(flow!.proof, null, 2)], {
                        type: "application/json",
                      }),
                    );
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `paramshield-${flow!.id}.json`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  }}
                >
                  下载已脱敏执行证据
                </BusyButton>
              )}
              {flow?.stage === "EXECUTED" && (
                <BusyButton
                  loading={busy === "核对 Graph 新事件与分析变化"}
                  className="ps-button secondary"
                  disabled={disabled}
                  onClick={() =>
                    void task("核对 Graph 新事件与分析变化", () =>
                      action("graph-after"),
                    )
                  }
                >
                  核对 Graph 新事件 → 分析变化
                </BusyButton>
              )}
            </section>
            <section
              className="ps-panel"
              id="explanation"
              aria-busy={explaining}
            >
              <div className="ps-section-label">
                <span>06 / GROUNDED EXPLANATION</span>
                <small>
                  {journal?.aiConfigured
                    ? "AI 证据选择已配置"
                    : "AI 尚未配置 · 明确降级"}
                </small>
              </div>
              <h2>哪些风险由这次变更引起？</h2>
              <p className="ps-muted">
                AI 只能选取已有证据，不能计算数字、改变判定或授权交易。
              </p>
              <div className="ps-question-presets" aria-label="常见风险问题">
                {[
                  "这次修改额外增加了哪些风险？",
                  "为什么推荐这个参数？",
                  "数据来自哪里，哪些内容尚未验证？",
                ].map((q) => (
                  <BusyButton
                    key={q}
                    className="ps-button secondary"
                    disabled={Boolean(busy)}
                    onClick={() => setQuestion(q)}
                  >
                    {q}
                  </BusyButton>
                ))}
              </div>
              <label className="ps-question">
                询问本次风险
                <textarea
                  maxLength={400}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                />
              </label>
              <BusyButton
                loading={busy === "生成证据式解释"}
                className="ps-button secondary"
                disabled={disabled || !flow?.decision || !question.trim()}
                onClick={() =>
                  void task("生成证据式解释", () =>
                    action("explain", { question }),
                  )
                }
              >
                解释本次风险
              </BusyButton>
              {explaining && (
                <div className="ps-local-progress">
                  <LoadingHint>正在从本次证据中生成解释</LoadingHint>
                  <Skeleton label="风险解释加载中" />
                </div>
              )}
              {flow?.explanation && (
                <div className="ps-explanation">
                  <strong>
                    {flow.explanation.mode === "ai"
                      ? "AI 已选择证据 · 数值保持原样"
                      : "确定性说明（非 AI）"}
                  </strong>
                  {flow.explanation.question && (
                    <p className="ps-caption">
                      本条回答的问题：{flow.explanation.question}
                    </p>
                  )}
                  {flow.explanation.promptVersion && (
                    <p className="ps-caption">
                      {flow.explanation.mode === "ai"
                        ? `模型：${flow.explanation.model}`
                        : "无模型调用"}{" "}
                      · {flow.explanation.promptVersion} · 区块{" "}
                      {flow.explanation.evidence?.snapshotBlock}
                    </p>
                  )}
                  {flow.explanation.reason && (
                    <p className="ps-muted">{flow.explanation.reason}</p>
                  )}
                  <p className="ps-prewrap">{flow.explanation.text}</p>
                  <nav className="ps-citation-links" aria-label="解释证据来源">
                    {flow.explanation.sources.map((id) => (
                      <a key={id} href={`#source-${id}`}>
                        {id}
                      </a>
                    ))}
                  </nav>
                  {flow.explanation.citations && (
                    <details className="ps-citation-details">
                      <summary>展开逐条证据</summary>
                      {flow.explanation.citations.map((c) => (
                        <p key={c.id}>
                          <a href={c.href}>{c.id}</a>
                          <br />
                          {c.text}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
              )}
            </section>
          </div>
          <footer className="ps-footer">
            本机单用户原型 · 实际 CLI 不等于 TEE · 两次确认不等于最终性 ·
            历史证据不能复用为新授权
          </footer>
        </div>
      </div>
    </main>
  );
}
