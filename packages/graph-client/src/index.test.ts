import { describe, expect, it, vi } from "vitest";
import { demoSnapshot } from "@paramshield/risk-engine/fixtures";
import { assertFreshSnapshot } from "@paramshield/shared";
import {
  fetchGraphSnapshot,
  fetchLocalGraphSnapshot,
  LOCAL_GRAPH_URL,
  corroborateSnapshot,
  type RpcSnapshotPort,
} from "./index";
const s = demoSnapshot();
const meta = {
  deployment: "unit-test-deployment",
  hasIndexingErrors: false,
  block: s.block,
};
const market = {
  id: s.market,
  contractVersion: s.contractVersion,
  stateVersion: s.stateVersion,
  liquidationThresholdBps: s.liquidationThresholdBps,
  collateralPriceUsdE18: s.collateralPriceUsdE18,
  collateralDecimals: 18,
  debtDecimals: 6,
  totalCollateral: s.totalCollateral,
  totalDebt: s.totalDebt,
  positionCount: 5,
};
function page() {
  return {
    _meta: meta,
    market,
    positions: s.positions.map((p) => ({
      ...p,
      id: `${s.market}-${p.account}`,
    })),
  };
}
function stub(data: unknown[]) {
  const requests: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(init?.body as string));
    return new Response(JSON.stringify(data.shift()), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}
const opts = {
  url: "https://unit.invalid/graph",
  market: s.market,
  chainId: s.chainId,
  now: s.fetchedAt + 1,
  headBlock: s.block.number + 1,
};
describe("complete pinned Graph snapshot", () => {
  it("pins every page by block hash and preserves live provenance", async () => {
    const mock = stub([{ data: { _meta: meta } }, { data: page() }]);
    const result = await fetchGraphSnapshot({ ...opts, ...mock });
    expect(result.positions).toEqual(s.positions);
    expect(result.source.kind).toBe("graph");
    expect(mock.requests[1]).toMatchObject({
      variables: { block: { hash: s.block.hash } },
    });
  });
  it.each([
    "totals",
    "missing-position",
    "duplicate",
    "block",
    "deployment",
    "indexing-errors",
    "wrong-market",
  ])("fails closed for %s", async (kind) => {
    const p = structuredClone(page());
    if (kind === "totals") p.market.totalDebt = "1";
    if (kind === "missing-position") p.positions.pop();
    if (kind === "duplicate") p.positions[1] = p.positions[0]!;
    if (kind === "block") p._meta.block.hash = `0x${"2".repeat(64)}`;
    if (kind === "deployment") p._meta.deployment = "other";
    if (kind === "indexing-errors") p._meta.hasIndexingErrors = true;
    if (kind === "wrong-market") p.market.id = `0x${"2".repeat(40)}`;
    await expect(
      fetchGraphSnapshot({
        ...opts,
        ...stub([{ data: { _meta: meta } }, { data: p }]),
      }),
    ).rejects.toThrow();
  });
  it("rejects partial GraphQL errors, stale input and redacts provider secrets", async () => {
    await expect(
      fetchGraphSnapshot({
        ...opts,
        ...stub([
          { data: { _meta: meta }, errors: [{ message: "secret API token" }] },
        ]),
      }),
    ).rejects.toThrow("redacted");
    await expect(
      fetchGraphSnapshot({
        ...opts,
        now: opts.now + 121,
        ...stub([{ data: { _meta: meta } }, { data: page() }]),
      }),
    ).rejects.toThrow("Stale");
    await expect(
      fetchGraphSnapshot({ ...opts, url: "http://localhost/" }),
    ).rejects.toThrow("HTTPS");
  });
  it("paginates over 100 positions without truncation", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({
      account: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      collateralAmount: "1",
      debtAmount: "0",
    })).map((p) => ({ ...p, id: `${s.market}-${p.account}` }));
    const m = {
      ...market,
      totalCollateral: "101",
      totalDebt: "0",
      positionCount: 101,
    };
    const mock = stub([
      { data: { _meta: meta } },
      { data: { _meta: meta, market: m, positions: rows.slice(0, 100) } },
      { data: { _meta: meta, market: m, positions: rows.slice(100) } },
    ]);
    const result = await fetchGraphSnapshot({ ...opts, ...mock });
    expect(result.positions).toHaveLength(101);
    expect(mock.requests[2]).toMatchObject({
      variables: { cursor: rows[99]!.id, block: { hash: s.block.hash } },
    });
  });
});
describe("explicit local development transport", () => {
  it("keeps real local indexing distinct from hosted execution evidence", async () => {
    const result = await fetchLocalGraphSnapshot({
      ...opts,
      url: LOCAL_GRAPH_URL,
      ...stub([{ data: { _meta: meta } }, { data: page() }]),
    });
    expect(result.source.kind).toBe("graph-local");
    expect(result.positions).toEqual(s.positions);
    expect(() => assertFreshSnapshot(result, opts.now, opts.headBlock)).toThrow(
      "Live Graph",
    );
  });
  it.each([
    "http://example.com/graph",
    "http://127.0.0.1:18020/",
    "http://localhost:18000/subgraphs/name/paramshield-v1",
    `${LOCAL_GRAPH_URL}?token=secret`,
    "http://user:secret@127.0.0.1:18000/subgraphs/name/paramshield-v1",
  ])("rejects a non-allowlisted local URL: %s", async (url) => {
    await expect(fetchLocalGraphSnapshot({ ...opts, url })).rejects.toThrow(
      "local development endpoint",
    );
  });
  it("keeps stale local data fail-closed and rejects API credentials", async () => {
    await expect(
      fetchLocalGraphSnapshot({
        ...opts,
        now: opts.now + 121,
        url: LOCAL_GRAPH_URL,
        ...stub([{ data: { _meta: meta } }, { data: page() }]),
      }),
    ).rejects.toThrow("Stale");
    const unsafe = { ...opts, url: LOCAL_GRAPH_URL, apiKey: "never-send-this" };
    await expect(fetchLocalGraphSnapshot(unsafe)).rejects.toThrow(
      "credential-free",
    );
  });
});
describe("RPC corroboration does not replace Graph input", () => {
  const snapshot = { ...s, source: { ...s.source, kind: "graph" as const } };
  function port(): RpcSnapshotPort {
    return {
      getChainId: async () => s.chainId,
      block: async () => s.block,
      market: async () => ({ ...market, stateVersion: null }),
      position: async (_address, account) =>
        s.positions.find((p) => p.account === account)!,
    };
  }
  it("checks every amount at the indexed block", async () => {
    const p = port();
    p.position = vi.fn(p.position);
    await corroborateSnapshot(snapshot, p);
    expect(p.position).toHaveBeenCalledTimes(5);
    expect(p.position).toHaveBeenCalledWith(
      s.market,
      s.positions[0]!.account,
      s.block.number,
    );
  });
  it("rejects incorrect chain, amounts, block and a mid-read reorg", async () => {
    const a = port();
    a.getChainId = async () => 1;
    await expect(corroborateSnapshot(snapshot, a)).rejects.toThrow("chain");
    const b = port();
    b.position = async () => ({ collateralAmount: "1", debtAmount: "1" });
    await expect(corroborateSnapshot(snapshot, b)).rejects.toThrow("position");
    const c = port();
    c.block = async () => ({ ...s.block, hash: `0x${"2".repeat(64)}` });
    await expect(corroborateSnapshot(snapshot, c)).rejects.toThrow("block");
    const d = port();
    let reads = 0;
    d.block = async () => ({
      ...s.block,
      hash: ++reads === 1 ? s.block.hash : `0x${"2".repeat(64)}`,
    });
    await expect(corroborateSnapshot(snapshot, d)).rejects.toThrow("reorg");
  });
});
