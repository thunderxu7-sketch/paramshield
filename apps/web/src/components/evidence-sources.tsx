"use client";
import type { FlowView } from "@/lib/console-types";
import { formatUnits } from "viem";

export function EvidenceSources({ flow }: { flow: FlowView }) {
  const s = flow.snapshot,
    sim = flow.simulation;
  if (!s || !sim || !flow.decision) return null;
  const rows = [
    ["snapshot.block.number", "Graph 输入区块", String(s.block.number)],
    ["snapshot.stateVersion", "市场状态版本", s.stateVersion ?? "—"],
    ["snapshot.positions.length", "纳入计算的仓位", String(s.positions.length)],
    [
      "snapshot.collateralPriceUsdE18",
      "抵押品价格（USD）",
      formatUnits(BigInt(s.collateralPriceUsdE18), 18),
    ],
    ["simulation.decreaseBps", "LT 下调", `${sim.decreaseBps} bps`],
    [
      "simulation.stressBps",
      "压力价格跌幅",
      `${(sim.stressBps / 100).toFixed(2)}%`,
    ],
    ...(
      [
        "currentNormal",
        "proposedNormal",
        "currentStress",
        "proposedStress",
      ] as const
    ).flatMap((key) => [
      [
        `simulation.${key}.liquidatableCount`,
        `${key} · 可清算仓位`,
        String(sim[key].liquidatableCount),
      ],
      [
        `simulation.${key}.liquidatableDebtUsdE18`,
        `${key} · 可清算债务 USD`,
        formatUnits(BigInt(sim[key].liquidatableDebtUsdE18), 18),
      ],
    ]),
    [
      "simulation.newlyLiquidatableAccounts",
      "正常新增可清算仓位",
      String(sim.newlyLiquidatableAccounts.length),
    ],
    [
      "simulation.additionalStressedDebtUsdE18",
      "压力额外可清算债务 USD",
      formatUnits(BigInt(sim.additionalStressedDebtUsdE18), 18),
    ],
    ["decision.verdict", "政策判定", flow.decision.verdict],
    [
      "decision.recommendedValueBps",
      "确定性候选 LT",
      flow.decision.recommendedValueBps === null
        ? "无新候选值"
        : `${(flow.decision.recommendedValueBps / 100).toFixed(2)}%`,
    ],
  ];
  return (
    <section className="ps-panel" id="evidence-sources">
      <div className="ps-section-label">
        <span>DATA PROVENANCE</span>
        <small>历史证据，不自动更新为当前授权</small>
      </div>
      <h2>每个数字从哪里来？</h2>
      <p className="ps-muted">
        {s.source.kind === "graph"
          ? "The Graph 输入"
          : "Fixture 输入（不是实时数据）"}{" "}
        · {s.source.deployment} · 算法 {sim.algorithmVersion}
      </p>
      <p className="ps-caption">
        采集时间：
        {new Date(s.fetchedAt * 1000).toLocaleString("zh-CN", {
          hour12: false,
        })}{" "}
        · 区块哈希 <code>{s.block.hash}</code>
      </p>
      <a
        target="_blank"
        rel="noreferrer"
        href={`https://sepolia.etherscan.io/block/${s.block.number}`}
      >
        查看对应 Sepolia 区块 ↗
      </a>
      <div className="ps-source-list">
        {rows.map(([id, label, value]) => (
          <details key={id} id={`source-${id}`}>
            <summary>
              <span>{label}</span>
              <strong>{value}</strong>
            </summary>
            <code>{id}</code>
            <p>
              Preflight：<code>{flow.preflightHash}</code>
            </p>
          </details>
        ))}
      </div>
      <p id="source-model.scope" className="ps-caption">
        仅覆盖参考借贷市场、LT 下调和一个压力情景。ALLOW
        不是整个市场安全声明；来源字段不能替代新分析或真人审核。
      </p>
    </section>
  );
}
