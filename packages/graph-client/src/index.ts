import { z } from "zod";
import {
  assertFreshSnapshot,
  assertSnapshotFreshness,
  nonzeroAddressSchema,
  nonzeroHashSchema,
  positionSchema,
  snapshotSchema,
  positiveUintSchema,
  uint256Schema,
  thresholdSchema,
  type MarketSnapshot,
} from "@paramshield/shared";
export const META_QUERY = `query SnapshotHead { _meta { deployment hasIndexingErrors block { number hash timestamp } } }`;
export const PAGE_QUERY = `query MarketSnapshot($market: ID!, $marketFilter: String!, $block: Block_height!, $cursor: ID!) {
  _meta(block: $block) { deployment hasIndexingErrors block { number hash timestamp } }
  market(id: $market, block: $block) { id contractVersion stateVersion liquidationThresholdBps collateralPriceUsdE18 collateralDecimals debtDecimals totalCollateral totalDebt positionCount }
  positions(first: 100, orderBy: id, orderDirection: asc, where: {market: $marketFilter, id_gt: $cursor}, block: $block) { id account collateralAmount debtAmount }
}`;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metaSchema = z
  .object({
    deployment: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
    hasIndexingErrors: z.literal(false),
    block: z
      .object({ number: integer, hash: nonzeroHashSchema, timestamp: integer })
      .strict(),
  })
  .strict();
const marketSchema = z
  .object({
    id: nonzeroAddressSchema,
    contractVersion: z.enum(["v1", "v2"]),
    stateVersion: positiveUintSchema.nullable(),
    liquidationThresholdBps: thresholdSchema,
    collateralPriceUsdE18: positiveUintSchema,
    collateralDecimals: integer.max(18),
    debtDecimals: integer.max(18),
    totalCollateral: uint256Schema,
    totalDebt: uint256Schema,
    positionCount: integer.max(10000),
  })
  .strict();
const pageSchema = z
  .object({
    _meta: metaSchema,
    market: marketSchema,
    positions: z
      .array(positionSchema.extend({ id: z.string().min(1).max(100) }))
      .max(100),
  })
  .strict();
type Options = {
  url: string;
  apiKey?: string;
  market: string;
  chainId: number;
  now: number;
  headBlock: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Server-side configured endpoint only. Never supply arbitrary browser URLs or log keys. */
export async function fetchGraphSnapshot(
  options: Options,
): Promise<MarketSnapshot> {
  return fetchIndexedSnapshot(options, "graph");
}

export const LOCAL_GRAPH_URL =
  "http://127.0.0.1:18000/subgraphs/name/paramshield-v1";

/** Explicit development lane. Never turns local data into hosted-provider proof. */
export async function fetchLocalGraphSnapshot(
  options: Omit<Options, "apiKey">,
): Promise<MarketSnapshot> {
  return fetchIndexedSnapshot(options, "graph-local");
}

async function fetchIndexedSnapshot(
  options: Options,
  sourceKind: "graph" | "graph-local",
): Promise<MarketSnapshot> {
  const market = nonzeroAddressSchema.parse(options.market),
    fetcher = options.fetchImpl ?? fetch;
  const url = new URL(options.url);
  if (sourceKind === "graph-local") {
    if (url.href !== LOCAL_GRAPH_URL || options.apiKey)
      throw new Error(
        "Only the credential-free local development endpoint is allowed",
      );
  } else if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Configured HTTPS Graph endpoint required");
  const timeout = options.timeoutMs ?? 10000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30000)
    throw new Error("Invalid Graph timeout");
  const signal = AbortSignal.timeout(timeout);
  async function query(query: string, variables: Record<string, unknown> = {}) {
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey
            ? { authorization: `Bearer ${options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error("Graph HTTP error");
      const body = await response.text();
      if (body.length > 2_000_000) throw new Error("Oversized Graph response");
      const envelope = z
        .object({ data: z.unknown(), errors: z.array(z.unknown()).optional() })
        .strict()
        .parse(JSON.parse(body));
      if (envelope.errors?.length)
        throw new Error("Graph response contains errors");
      return envelope.data;
    } catch {
      throw new Error("Graph request failed (response details redacted)");
    }
  }
  const head = z
    .object({ _meta: metaSchema })
    .strict()
    .parse(await query(META_QUERY))._meta;
  const positions: MarketSnapshot["positions"] = [];
  let cursor = "",
    initialMarket: z.infer<typeof marketSchema> | undefined;
  for (let pageNumber = 0; pageNumber <= 100; pageNumber++) {
    const page = pageSchema.parse(
      await query(PAGE_QUERY, {
        market,
        marketFilter: market,
        block: { hash: head.block.hash },
        cursor,
      }),
    );
    if (JSON.stringify(page._meta) !== JSON.stringify(head))
      throw new Error("Graph block/deployment changed during pagination");
    if (page.market.id !== market) throw new Error("Wrong indexed market");
    if (
      initialMarket &&
      JSON.stringify(initialMarket) !== JSON.stringify(page.market)
    )
      throw new Error("Inconsistent market across pages");
    initialMarket = page.market;
    for (const p of page.positions) {
      if (p.id <= cursor || p.id !== `${market}-${p.account}`)
        throw new Error("Invalid position cursor or market scope");
      cursor = p.id;
      positions.push({
        account: p.account,
        collateralAmount: p.collateralAmount,
        debtAmount: p.debtAmount,
      });
    }
    if (positions.length > 10000) throw new Error("Position limit exceeded");
    if (page.positions.length < 100) break;
    if (pageNumber === 100) throw new Error("Unbounded pagination");
  }
  if (!initialMarket) throw new Error("Missing market");
  const { id: _id, ...state } = initialMarket;
  const snapshot = snapshotSchema.parse({
    schemaVersion: "paramshield.snapshot.v1",
    chainId: options.chainId,
    market,
    ...state,
    block: head.block,
    fetchedAt: options.now,
    source: {
      kind: sourceKind,
      deployment: head.deployment,
      queryId: "market-snapshot-v1",
    },
    positions,
  });
  if (sourceKind === "graph")
    assertFreshSnapshot(snapshot, options.now, options.headBlock);
  else assertSnapshotFreshness(snapshot, options.now, options.headBlock);
  return snapshot;
}

export type RpcSnapshotPort = {
  getChainId(): Promise<number>;
  block(number: number): Promise<{ hash: string; timestamp: number }>;
  market(
    address: string,
    block: number,
  ): Promise<{
    liquidationThresholdBps: number;
    collateralPriceUsdE18: string;
    totalCollateral: string;
    totalDebt: string;
    collateralDecimals: number;
    debtDecimals: number;
    stateVersion: string | null;
  }>;
  position(
    address: string,
    account: string,
    block: number,
  ): Promise<{ collateralAmount: string; debtAmount: string }>;
};
/** Corroborates indexed amounts; never replaces a failed Graph query with RPC data. */
export async function corroborateSnapshot(
  input: unknown,
  rpc: RpcSnapshotPort,
): Promise<void> {
  const s = snapshotSchema.parse(input);
  if (s.source.kind !== "graph" && s.source.kind !== "graph-local")
    throw new Error("Only indexed Graph snapshots can be corroborated");
  if ((await rpc.getChainId()) !== s.chainId)
    throw new Error("RPC chain mismatch");
  const block = await rpc.block(s.block.number);
  if (
    block.hash.toLowerCase() !== s.block.hash ||
    block.timestamp !== s.block.timestamp
  )
    throw new Error("RPC block mismatch");
  const state = await rpc.market(s.market, s.block.number);
  for (const key of [
    "liquidationThresholdBps",
    "collateralPriceUsdE18",
    "totalCollateral",
    "totalDebt",
    "collateralDecimals",
    "debtDecimals",
    "stateVersion",
  ] as const)
    if (state[key] !== s[key]) throw new Error("RPC market mismatch");
  for (let i = 0; i < s.positions.length; i += 20)
    await Promise.all(
      s.positions.slice(i, i + 20).map(async (p) => {
        const actual = await rpc.position(s.market, p.account, s.block.number);
        if (
          actual.collateralAmount !== p.collateralAmount ||
          actual.debtAmount !== p.debtAmount
        )
          throw new Error("RPC position mismatch");
      }),
    );
  if ((await rpc.block(s.block.number)).hash.toLowerCase() !== s.block.hash)
    throw new Error("RPC reorg during snapshot verification");
}
