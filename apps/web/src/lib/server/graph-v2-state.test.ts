import { afterEach, describe, expect, it, vi } from "vitest";
import { readGraphV2State } from "./graph-v2-state";
import { executionFixture, hash } from "./test-fixtures";
import type { V2Context } from "./lifecycle-preflight";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function setup() {
  const b = executionFixture().bound,
    snapshot = b.preflight.snapshot,
    tx = hash("8");
  const target = {
    executor: b.intent.executor,
    market: b.intent.target,
    operator: b.intent.operator,
    decisionAuthority: `0x${"4".repeat(40)}`,
  };
  const admin = `0x${"5".repeat(40)}`;
  const c = {
    target,
    graphDeployment: snapshot.source.deployment,
    client: {
      readContract: vi.fn(async (args: { functionName: string }) =>
        args.functionName === "admin" ? admin : 2n,
      ),
    },
    state: { canonicalBlockHash: vi.fn(async () => snapshot.block.hash) },
  } as unknown as V2Context;
  const data = {
    _meta: {
      deployment: snapshot.source.deployment,
      hasIndexingErrors: false,
      block: { number: snapshot.block.number, hash: snapshot.block.hash },
    },
    executor: {
      admin,
      operator: target.operator,
      decisionAuthority: target.decisionAuthority,
      authorizationEpoch: "2",
    },
    allowedCall: {
      executor: target.executor,
      target: target.market,
      selector: "0x4d5bcf96",
      allowed: true,
    },
    change: {
      executor: target.executor,
      operator: target.operator,
      target: target.market,
      preflightHash: b.preflightHash,
      decisionHash: b.decisionHash,
      expectedStateVersion: b.intent.expectedStateVersion,
      expectedAuthorizationEpoch: b.intent.expectedAuthorizationEpoch,
      state: "EXECUTED",
      executionTransaction: tx,
    },
    marketEvents: ["LT", "STATE_VERSION"].map((kind) => ({
      kind,
      transactionHash: tx,
      blockNumber: snapshot.block.number.toString(),
      market: { id: target.market },
    })),
  };
  const fetcher = vi.fn(async () => Response.json({ data }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("GRAPH_V2_QUERY_URL", "https://graph.example.test/v2");
  return {
    c,
    b,
    snapshot,
    data,
    fetcher,
    expected: { bound: b, transactionHash: tx },
  };
}
describe("indexed v2 controls and post-execution events", () => {
  it("requires pinned Graph provenance, indexed role/allowlist and matching v2 proposal fields", async () => {
    const f = setup();
    const result = await readGraphV2State(f.c, f.snapshot, f.expected);
    expect(result.change.state).toBe("EXECUTED");
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it.each([
    "deployment",
    "block",
    "errors",
    "operator",
    "epoch",
    "allowlist",
    "preconditions",
    "hash",
    "state",
    "events",
  ])("rejects changed %s", async (field) => {
    const f = setup();
    switch (field) {
      case "deployment":
        f.data._meta.deployment = "wrong";
        break;
      case "block":
        f.data._meta.block.hash = hash("9");
        break;
      case "errors":
        f.data._meta.hasIndexingErrors = true;
        break;
      case "operator":
        f.data.executor.operator = `0x${"a".repeat(40)}`;
        break;
      case "epoch":
        f.data.executor.authorizationEpoch = "3";
        break;
      case "allowlist":
        f.data.allowedCall.allowed = false;
        break;
      case "preconditions":
        f.data.change.expectedStateVersion = "8";
        break;
      case "hash":
        f.data.change.executionTransaction = hash("7");
        break;
      case "state":
        f.data.change.state = "PENDING";
        break;
      case "events":
        f.data.marketEvents.pop();
        break;
    }
    await expect(readGraphV2State(f.c, f.snapshot, f.expected)).rejects.toThrow(
      "Graph",
    );
  });
  it("refuses RPC reorg and does not substitute direct RPC for missing events", async () => {
    const f = setup();
    vi.mocked(f.c.state.canonicalBlockHash).mockResolvedValueOnce(hash("9"));
    await expect(readGraphV2State(f.c, f.snapshot, f.expected)).rejects.toThrow(
      "reorganized",
    );
    f.data.marketEvents = [];
    await expect(readGraphV2State(f.c, f.snapshot, f.expected)).rejects.toThrow(
      "events",
    );
  });
});

describe("R-11 Graph transport and evidence regressions", () => {
  it("pins query variables and every RPC read to the same observation block", async () => {
    const f = setup();
    await readGraphV2State(f.c, f.snapshot, f.expected);
    const [url, init] = f.fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://graph.example.test/v2");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string).variables).toMatchObject({
      blockHash: f.snapshot.block.hash,
      tx: f.expected.transactionHash,
      change: f.b.changeHash,
    });
    for (const [args] of vi.mocked(f.c.client.readContract).mock.calls)
      expect(args).toMatchObject({
        blockNumber: BigInt(f.snapshot.block.number),
      });
  });
  it.each(["preflight", "decision", "eventMarket"])(
    "rejects a different %s binding even when the transaction matches",
    async (field) => {
      const f = setup();
      if (field === "preflight") f.data.change.preflightHash = hash("9");
      if (field === "decision") f.data.change.decisionHash = hash("9");
      if (field === "eventMarket")
        f.data.marketEvents[0]!.market.id = `0x${"9".repeat(40)}`;
      await expect(
        readGraphV2State(f.c, f.snapshot, f.expected),
      ).rejects.toThrow(/Graph v2 execution events/);
    },
  );
  it("bounds provider output and propagates failure without a fixture fallback", async () => {
    const f = setup();
    f.fetcher.mockResolvedValue(new Response("x".repeat(64001)));
    await expect(readGraphV2State(f.c, f.snapshot, f.expected)).rejects.toThrow(
      /too large/,
    );
    f.fetcher.mockRejectedValue(new Error("timeout"));
    await expect(readGraphV2State(f.c, f.snapshot, f.expected)).rejects.toThrow(
      "timeout",
    );
    expect(f.c.client.readContract).not.toHaveBeenCalled();
  });
  it("rejects non-HTTPS endpoints before sending a request", async () => {
    const f = setup();
    vi.stubEnv("GRAPH_V2_QUERY_URL", "http://127.0.0.1/private");
    await expect(readGraphV2State(f.c, f.snapshot, f.expected)).rejects.toThrow(
      /hosted Graph required/,
    );
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
