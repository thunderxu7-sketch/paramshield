"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatEther, formatUnits } from "viem";
import type { ConsoleStatus, FlowView } from "@/lib/console-types";

type Provider = {
  isMetaMask?: boolean;
  providers?: Provider[];
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
};
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
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
  const session = useRef("");
  const provider = useRef<Provider | null>(null);
  const [ready, setReady] = useState(false),
    [authenticated, setAuthenticated] = useState(false),
    [status, setStatus] = useState<ConsoleStatus | null>(null);
  const [flow, setFlow] = useState<FlowView | null>(null),
    [threshold, setThreshold] = useState("70.00");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [account, setAccount] = useState("");
  const [now, setNow] = useState(0),
    [question, setQuestion] = useState(
      "为什么阻断？哪个风险是这次参数修改额外带来的？",
    );
  const [fundingHash, setFundingHash] = useState("");

  const api = useCallback(
    async <T,>(
      action?: string,
      extra: Record<string, unknown> = {},
    ): Promise<T> => {
      const response = await fetch("/api/console", {
        method: action ? "POST" : "GET",
        cache: "no-store",
        credentials: "omit",
        headers: {
          authorization: `Bearer ${session.current}`,
          ...(action ? { "content-type": "application/json" } : {}),
        },
        ...(action ? { body: JSON.stringify({ action, ...extra }) } : {}),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "服务校验失败，执行保持阻断。");
      return data as T;
    },
    [],
  );
  const load = useCallback(
    async (syncDraft = false) => {
      const next = await api<ConsoleStatus>();
      setStatus(next);
      const selected = sessionStorage.getItem("paramshield-flow"),
        selectedFlow =
          next.history.find((f) => f.id === selected) ??
          next.history[0] ??
          null;
      setFlow(selectedFlow);
      if (syncDraft && selectedFlow)
        setThreshold((selectedFlow.proposedValueBps / 100).toFixed(2));
    },
    [api],
  );
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "session",
    );
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      sessionStorage.setItem("paramshield-session", token);
      window.history.replaceState(null, "", window.location.pathname);
    }
    session.current = sessionStorage.getItem("paramshield-session") ?? "";
    // The session secret never appears in a request URL, public env var or log.
    const initialize = window.setTimeout(() => {
      setFundingHash(sessionStorage.getItem("paramshield-funding-hash") ?? "");
      setAuthenticated(Boolean(session.current));
      setReady(true);
      setNow(Math.floor(Date.now() / 1000));
    }, 0);
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    const discovered = (event: Event) => {
      const detail = (
        event as CustomEvent<{ info: { rdns: string }; provider: Provider }>
      ).detail;
      if (detail?.info.rdns === "io.metamask")
        provider.current = detail.provider;
    };
    window.addEventListener("eip6963:announceProvider", discovered);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (session.current) void load(true).catch((e) => setError(e.message));
    return () => {
      window.clearTimeout(initialize);
      window.clearInterval(timer);
      window.removeEventListener("eip6963:announceProvider", discovered);
    };
  }, [load]);

  async function task(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      // Never stringify a wallet/provider error with arbitrary payload data.
      setError(
        e instanceof Error && e.message.length < 220
          ? e.message
          : "钱包操作未完成；请检查账号、网络和待处理请求。",
      );
      await load().catch(() => {});
    } finally {
      setBusy("");
    }
  }
  function wallet() {
    const injected = window.ethereum;
    const p =
      provider.current ??
      injected?.providers?.find((p) => p.isMetaMask) ??
      (injected?.isMetaMask ? injected : null);
    if (!p)
      throw new Error("没有找到 MetaMask，请在 thunderxu 的 Chrome 中打开。");
    provider.current = p;
    return p;
  }
  async function walletFor(expected?: string) {
    const p = wallet();
    let accounts = (await p.request({ method: "eth_accounts" })) as string[];
    if (!accounts.length)
      accounts = (await p.request({
        method: "eth_requestAccounts",
      })) as string[];
    const active = accounts[0] ?? "";
    setAccount(active);
    if (expected && active.toLowerCase() !== expected.toLowerCase())
      throw new Error(
        `请先在 MetaMask 切换到 ${short(expected)}，当前为 ${short(active)}。`,
      );
    if ((await p.request({ method: "eth_chainId" })) !== "0xaa36a7")
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
    if ((await p.request({ method: "eth_chainId" })) !== "0xaa36a7")
      throw new Error("仅允许 Sepolia。");
    return p;
  }
  function select(f: FlowView) {
    setFlow(f);
    setThreshold((f.proposedValueBps / 100).toFixed(2));
    sessionStorage.setItem("paramshield-flow", f.id);
  }
  async function analyze(value: number) {
    const id = crypto.randomUUID();
    sessionStorage.setItem("paramshield-flow", id);
    // A duplicate request ID returns its durable result; it never reruns CRE.
    const f = await api<FlowView>("analyze", { id, thresholdBps: value });
    select(f);
    await load();
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!flow) return;
    const f = await api<FlowView>(name, { id: flow.id, ...extra });
    select(f);
    if (f.error) setError(f.error);
  }
  const expired = !flow?.active || !flow.freshUntil || now >= flow.freshUntil;
  const disabled = Boolean(busy) || !ready || !status;
  const gasNeeded = status
    ? BigInt(status.operatorBalanceWei) < 1_000_000_000_000_000n
    : true;
  const bps = Math.round(Number(threshold) * 100);
  const canAnalyze = Number.isFinite(bps) && bps > 0 && bps < 10000;
  const draftMatchesFlow = Boolean(
    flow && canAnalyze && bps === flow.proposedValueBps,
  );
  const authorizationDisabled = disabled || expired || !draftMatchesFlow;

  return (
    <main className="ps-console">
      <header className="ps-topbar">
        <Link href="/" className="ps-brand">
          <span>P</span> ParamShield
        </Link>
        <div className="ps-network">
          <i /> Sepolia · v2 <span>LOCAL CONTROL PLANE</span>
        </div>
        <button
          className="ps-button secondary"
          disabled={Boolean(busy)}
          onClick={() =>
            void task("连接钱包", async () => {
              await walletFor();
            })
          }
        >
          {account ? short(account) : "连接 MetaMask"}
        </button>
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
            {status?.history.slice(0, 8).map((f) => (
              <button
                key={f.id}
                disabled={Boolean(busy)}
                onClick={() => select(f)}
                className={flow?.id === f.id ? "selected" : ""}
              >
                <span>{pct(f.proposedValueBps)}</span>
                <small>{stageNames[f.stage]}</small>
              </button>
            ))}
          </div>
        </aside>
        <div className="ps-main">
          <div className="ps-heading">
            <div>
              <p className="ps-eyebrow">EVIDENCE BEFORE EXECUTION</p>
              <h1>参数变更控制台</h1>
              <p>先证明风险，再授权交易。每一步都绑定同一份证据。</p>
            </div>
            <button
              className="ps-button secondary"
              disabled={disabled}
              onClick={() => void task("读取状态", load)}
            >
              刷新链上状态
            </button>
          </div>
          {!authenticated && ready && (
            <div className="ps-warning">
              控制台未认证。请使用本机启动程序生成的私有链接；不要分享 session
              URL。
            </div>
          )}
          {error && (
            <div className="ps-warning" role="alert">
              {error}
            </div>
          )}
          {busy && (
            <div className="ps-progress" role="status">
              <span className="ps-spinner" />
              {busy}… 请勿重复发送或关闭钱包请求。
            </div>
          )}
          <section className="ps-metrics" aria-label="Live integration status">
            <article>
              <small>THE GRAPH</small>
              <strong>独立 v2 索引</strong>
              <span title={status?.graphDeployment}>
                {short(status?.graphDeployment)}
              </span>
            </article>
            <article>
              <small>MARKET STATE</small>
              <strong>Version {status?.stateVersion ?? "—"}</strong>
              <span>授权 Epoch {status?.authorizationEpoch ?? "—"}</span>
            </article>
            <article>
              <small>PRIVY OPERATOR</small>
              <strong>{status?.locked ? "DENY 已核验" : "待核验"}</strong>
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
              <button
                className="ps-button secondary"
                disabled={disabled || Boolean(fundingHash)}
                onClick={() =>
                  void task("等待测试币转账确认", async () => {
                    const p = await walletFor(status.admin);
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
                    sessionStorage.setItem("paramshield-funding-hash", hash);
                    setFundingHash(hash);
                  })
                }
              >
                {fundingHash ? "已发送，请刷新余额" : "审阅 gas 转账"}
              </button>
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
                  <small>当前 LT</small>
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
              <button
                className="ps-button primary"
                disabled={disabled || !canAnalyze}
                onClick={() =>
                  void task("读取 Graph 并运行实际 CRE", () => analyze(bps))
                }
              >
                读取实时数据并分析
              </button>
              <p className="ps-caption">
                不会请求签名，也不会广播交易。freshness 固定为 120 秒 / 12
                区块。
              </p>
              {flow?.decision?.recommendedValueBps != null && (
                <div className="ps-recommendation">
                  <div>
                    <small>DETERMINISTIC SEARCH</small>
                    <strong>{pct(flow.decision.recommendedValueBps)}</strong>
                    <p>不是 AI 猜测；必须新建 intent 并重算。</p>
                  </div>
                  <button
                    className="ps-button secondary"
                    disabled={disabled}
                    onClick={() =>
                      void task("用推荐值重新分析", () => {
                        const v = flow.decision!.recommendedValueBps!;
                        setThreshold((v / 100).toFixed(2));
                        return analyze(v);
                      })
                    }
                  >
                    采用候选值重算
                  </button>
                </div>
              )}
            </section>
            <section className="ps-panel ps-verdict">
              <div className="ps-section-label">
                <span>02 / POLICY DECISION</span>
                <small>Actual CRE CLI</small>
              </div>
              <div
                className={`ps-verdict-word ${flow?.decision?.verdict === "BLOCK" ? "blocked" : ""}`}
              >
                {flow?.decision?.verdict ?? "READY"}
              </div>
              <h2>{flow ? stageNames[flow.stage] : "等待第一份证据"}</h2>
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
                  请重新分析，不能用旧判定授权。
                </div>
              )}
              {flow?.freshUntil && (
                <div className={`ps-freshness ${expired ? "expired" : ""}`}>
                  {expired
                    ? "历史结果 · 不可继续授权，需重新分析"
                    : `数据可用窗口剩余 ${Math.max(0, flow.freshUntil - now)} 秒`}
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
                        <td key={n}>{c.liquidatableCount}</td>
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
                        <td key={n}>{usd(c.liquidatableDebtUsdE18)}</td>
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
          <section className="ps-panel">
            <div className="ps-section-label">
              <span>04 / CONTROLLED EXECUTION</span>
              <small>人工审核与 authority 分离 · 交易价值为 0</small>
            </div>
            <p className="ps-muted">
              先准备好钱包账号，再开始新一轮分析。过期不会自动续期；BLOCK
              没有签名入口。
            </p>
            <p className="ps-caption">
              倒计时仅显示时间预算；服务端还会核验区块、钱包签名和版本。
              只有显示「审核签名已验证」才算审核成功。
            </p>
            {flow?.lastReviewAttempt && (
              <div className="ps-sidebar-note" aria-live="polite">
                <strong>
                  最近审核请求 ·{" "}
                  {flow.lastReviewAttempt.phase === "prepare"
                    ? "内容准备"
                    : "签名核验"}
                </strong>
                <p>{flow.lastReviewAttempt.message}</p>
                <small>
                  {new Date(
                    flow.lastReviewAttempt.completedAt * 1000,
                  ).toLocaleTimeString("zh-CN", { hour12: false })}
                  {" · "}记录代码：{flow.lastReviewAttempt.code}
                  {flow.lastReviewAttempt.secondsRemaining !== null &&
                    ` · 核验时数据时间预算 ${flow.lastReviewAttempt.secondsRemaining} 秒`}
                </small>
              </div>
            )}
            <div className="ps-actions">
              <div>
                <b>1. 人工证据审核</b>
                <small>MetaMask Account 2 · {short(status?.reviewer)}</small>
                <button
                  className="ps-button secondary"
                  disabled={authorizationDisabled || flow?.stage !== "ALLOW"}
                  onClick={() =>
                    void task("等待真人审核签名", async () => {
                      const p = await walletFor(status!.reviewer);
                      const payload = await api<{
                        reviewer: string;
                        typedData: unknown;
                      }>("review-payload", { id: flow!.id });
                      const signature = (await p.request({
                        method: "eth_signTypedData_v4",
                        params: [
                          payload.reviewer,
                          JSON.stringify(payload.typedData),
                        ],
                      })) as string;
                      await action("approve", { signature });
                    })
                  }
                >
                  我已审阅，签署审核
                </button>
              </div>
              <div>
                <b>2. Privy 提交提案</b>
                <small>仅放行本次精确 propose</small>
                <button
                  className="ps-button secondary"
                  disabled={
                    authorizationDisabled ||
                    gasNeeded ||
                    flow?.stage !== "REVIEWED"
                  }
                  onClick={() =>
                    void task("Privy 签名并提交提案", () => action("propose"))
                  }
                >
                  提交已审核提案
                </button>
              </div>
              <div>
                <b>3. 链上决策确认</b>
                <small>MetaMask Account 1 · {short(status?.authority)}</small>
                <button
                  className="ps-button secondary"
                  disabled={authorizationDisabled || flow?.stage !== "PROPOSED"}
                  onClick={() =>
                    void task("等待独立 authority 交易", async () => {
                      const p = await walletFor(status!.authority);
                      const payload = await api<{
                        transaction: Record<string, string>;
                      }>("decision-payload", { id: flow!.id });
                      // Persist uncertainty before opening MetaMask; never auto-request a replacement.
                      sessionStorage.setItem(
                        `paramshield-decision-${flow!.id}`,
                        "REQUESTED",
                      );
                      const hash = (await p.request({
                        method: "eth_sendTransaction",
                        params: [payload.transaction],
                      })) as string;
                      sessionStorage.setItem(
                        `paramshield-decision-${flow!.id}`,
                        hash,
                      );
                      await action("decision-receipt", { hash });
                    })
                  }
                >
                  审阅并发送 ALLOW 决策
                </button>
              </div>
              <div>
                <b>4. 精确受控执行</b>
                <small>Privy 签名 → 恢复 DENY → 广播</small>
                <button
                  className="ps-button primary"
                  disabled={authorizationDisabled || flow?.stage !== "DECIDED"}
                  onClick={() =>
                    void task("执行并核对真实回执", () => action("execute"))
                  }
                >
                  执行本次参数修改
                </button>
              </div>
            </div>
            {flow &&
              [
                "PROPOSING",
                "DECISION_READY",
                "DECISION_PENDING",
                "EXECUTING",
              ].includes(flow.stage) && (
                <button
                  className="ps-button secondary"
                  disabled={disabled}
                  onClick={() =>
                    void task("只读恢复回执", async () => {
                      const hash = sessionStorage.getItem(
                        `paramshield-decision-${flow.id}`,
                      );
                      if (
                        ["DECISION_READY", "DECISION_PENDING"].includes(
                          flow.stage,
                        ) &&
                        hash &&
                        /^0x[0-9a-fA-F]{64}$/.test(hash)
                      )
                        await action("decision-receipt", { hash });
                      else
                        await action("recover", {
                          leg:
                            flow.stage === "PROPOSING"
                              ? "propose"
                              : flow.stage === "EXECUTING"
                                ? "execute"
                                : "decision",
                        });
                    })
                  }
                >
                  只读检查已记录交易（不重发）
                </button>
              )}
          </section>
          <div className="ps-work-grid">
            <section className="ps-panel" id="evidence">
              <div className="ps-section-label">
                <span>05 / EVIDENCE TIMELINE</span>
                <small>持久记录，不是 UI 推测</small>
              </div>
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
              {Boolean(flow?.proof) && (
                <button
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
                </button>
              )}
              {flow?.stage === "EXECUTED" && (
                <button
                  className="ps-button secondary"
                  disabled={disabled}
                  onClick={() =>
                    void task("核对 Graph 新事件与分析变化", () =>
                      action("graph-after"),
                    )
                  }
                >
                  核对 Graph 新事件 → 分析变化
                </button>
              )}
            </section>
            <section className="ps-panel" id="explanation">
              <div className="ps-section-label">
                <span>06 / GROUNDED EXPLANATION</span>
                <small>
                  {status?.aiConfigured
                    ? "AI 证据选择已配置"
                    : "AI 尚未配置 · 明确降级"}
                </small>
              </div>
              <h2>哪些风险由这次变更引起？</h2>
              <p className="ps-muted">
                AI 只能选取已有证据，不能计算数字、改变判定或授权交易。
              </p>
              <label className="ps-question">
                询问本次风险
                <textarea
                  maxLength={400}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={2}
                />
              </label>
              <button
                className="ps-button secondary"
                disabled={disabled || !flow?.decision || !question.trim()}
                onClick={() =>
                  void task("生成证据式解释", () =>
                    action("explain", { question }),
                  )
                }
              >
                解释本次风险
              </button>
              {flow?.explanation && (
                <div className="ps-explanation">
                  <strong>
                    {flow.explanation.mode === "ai"
                      ? "AI 已选择证据 · 数值保持原样"
                      : "确定性说明（非 AI）"}
                  </strong>
                  {flow.explanation.reason && (
                    <p className="ps-muted">{flow.explanation.reason}</p>
                  )}
                  <p className="ps-prewrap">{flow.explanation.text}</p>
                  <details>
                    <summary>来源字段</summary>
                    {flow.explanation.sources.map((ref) => (
                      <code key={ref}>
                        {ref}
                        <br />
                      </code>
                    ))}
                  </details>
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
