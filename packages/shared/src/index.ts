import { z } from "zod";

export const projectMetadata = {
  name: "ParamShield",
  tagline: "Preflight risk checks for DeFi protocol parameter changes.",
} as const;
export const UINT256_MAX = (1n << 256n) - 1n;
export const ethereumAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as `0x${string}`);
export const nonzeroAddressSchema = ethereumAddressSchema.refine(
  (v) => BigInt(v) !== 0n,
  "Zero address",
);
export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v.toLowerCase() as `0x${string}`);
export const nonzeroHashSchema = bytes32Schema.refine(
  (v) => BigInt(v) !== 0n,
  "Zero hash",
);
export const uint256Schema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/, { abort: true })
  .refine((v) => BigInt(v) <= UINT256_MAX, "uint256 overflow");
export const positiveUintSchema = uint256Schema.refine(
  (v) => BigInt(v) > 0n,
  "Expected positive integer",
);
export const basisPointsSchema = z.number().int().min(0).max(10_000);
export const thresholdSchema = z.number().int().min(5_000).max(9_500);
export const timestampSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
export const positionSchema = z
  .object({
    account: nonzeroAddressSchema,
    collateralAmount: uint256Schema,
    debtAmount: uint256Schema,
  })
  .strict();

export const snapshotSchema = z
  .object({
    schemaVersion: z.literal("paramshield.snapshot.v1"),
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    market: nonzeroAddressSchema,
    contractVersion: z.enum(["v1", "v2"]),
    stateVersion: positiveUintSchema.nullable(),
    block: z
      .object({
        number: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        hash: nonzeroHashSchema,
        timestamp: timestampSchema,
      })
      .strict(),
    source: z
      .object({
        kind: z.enum(["graph", "graph-local", "fixture"]),
        deployment: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
        queryId: z.literal("market-snapshot-v1"),
      })
      .strict(),
    fetchedAt: timestampSchema,
    liquidationThresholdBps: thresholdSchema,
    collateralPriceUsdE18: positiveUintSchema,
    collateralDecimals: z.number().int().min(0).max(18),
    debtDecimals: z.number().int().min(0).max(18),
    totalCollateral: uint256Schema,
    totalDebt: uint256Schema,
    positionCount: z.number().int().min(0).max(10_000),
    positions: z.array(positionSchema).max(10_000),
  })
  .strict()
  .superRefine((s, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (s.contractVersion === "v2" && s.stateVersion === null)
      issue("v2 requires stateVersion");
    if (s.contractVersion === "v1" && s.stateVersion !== null)
      issue("v1 cannot claim stateVersion");
    if (s.positionCount !== s.positions.length)
      issue("Incomplete position count");
    if (new Set(s.positions.map((p) => p.account)).size !== s.positions.length)
      issue("Duplicate position");
    if (
      s.positions.reduce((n, p) => n + BigInt(p.collateralAmount), 0n) !==
      BigInt(s.totalCollateral)
    )
      issue("Collateral totals mismatch");
    if (
      s.positions.reduce((n, p) => n + BigInt(p.debtAmount), 0n) !==
      BigInt(s.totalDebt)
    )
      issue("Debt totals mismatch");
    if (s.fetchedAt < s.block.timestamp)
      issue("Fetched before block timestamp");
  })
  .transform((s) => ({
    ...s,
    positions: [...s.positions].sort((a, b) =>
      a.account.localeCompare(b.account),
    ),
  }));
export type MarketSnapshot = z.infer<typeof snapshotSchema>;

export const intentCoreSchema = z
  .object({
    schemaVersion: z.literal("paramshield.intent.v2"),
    executor: nonzeroAddressSchema,
    operator: nonzeroAddressSchema,
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    target: nonzeroAddressSchema,
    value: z.literal("0"),
    calldata: z
      .string()
      .regex(/^0x(?:[0-9a-fA-F]{2}){36}$/)
      .transform((v) => v.toLowerCase() as `0x${string}`),
    currentValueBps: thresholdSchema,
    proposedValueBps: thresholdSchema,
    nonce: uint256Schema,
    expectedStateVersion: positiveUintSchema,
    expectedAuthorizationEpoch: positiveUintSchema,
    expiresAt: timestampSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
export const changeIntentSchema = intentCoreSchema.extend({
  evidenceHash: nonzeroHashSchema,
});
export type IntentCore = z.infer<typeof intentCoreSchema>;
export type ChangeIntent = z.infer<typeof changeIntentSchema>;

export const verdictSchema = z
  .object({
    schemaVersion: z.literal("paramshield.decision.v2"),
    changeHash: nonzeroHashSchema,
    preflightHash: nonzeroHashSchema,
    verdict: z.enum(["ALLOW", "BLOCK", "ESCALATE"]),
    policyVersion: z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/),
    violations: z
      .array(
        z.enum([
          "MAX_LT_DECREASE",
          "NEW_NORMAL_LIQUIDATABLE",
          "STRESS_EXPOSURE",
        ]),
      )
      .max(3),
    recommendedValueBps: thresholdSchema.nullable(),
    recommendationStatus: z.enum([
      "RECOMMENDED",
      "NO_SAFE_VALUE",
      "NO_CHANGE",
      "NOT_NEEDED",
    ]),
    expiresAt: timestampSchema,
    workflow: z
      .object({
        id: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
        runId: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
        mode: z.literal("cli-simulation-trusted-relay"),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      v.verdict === "ALLOW" &&
      (v.violations.length ||
        v.recommendationStatus !== "NOT_NEEDED" ||
        v.recommendedValueBps !== null)
    )
      issue("Invalid ALLOW");
    if (v.verdict === "BLOCK" && !v.violations.length)
      issue("BLOCK needs violations");
    if (
      (v.recommendationStatus === "RECOMMENDED" ||
        v.recommendationStatus === "NO_CHANGE") !==
      (v.recommendedValueBps !== null)
    )
      issue("Recommendation mismatch");
  });
export type Verdict = z.infer<typeof verdictSchema>;

export function assertFreshSnapshot(
  s: MarketSnapshot,
  now: number,
  head: number,
  maxAgeSeconds = 120,
  maxBlockLag = 12,
): void {
  if (s.source.kind !== "graph") throw new Error("Live Graph data required");
  assertSnapshotFreshness(s, now, head, maxAgeSeconds, maxBlockLag);
}

/** Freshness only, NOT an execution/provenance authorization check. */
export function assertSnapshotFreshness(
  s: MarketSnapshot,
  now: number,
  head: number,
  maxAgeSeconds = 120,
  maxBlockLag = 12,
): void {
  if (
    ![now, head, maxAgeSeconds, maxBlockLag].every(Number.isSafeInteger) ||
    now <= 0 ||
    head < 0 ||
    maxAgeSeconds < 0 ||
    maxBlockLag < 0
  )
    throw new Error("Invalid freshness configuration");
  if (
    s.fetchedAt > now ||
    s.block.timestamp > now ||
    now - s.block.timestamp > maxAgeSeconds ||
    now - s.fetchedAt > maxAgeSeconds ||
    head < s.block.number ||
    head - s.block.number > maxBlockLag
  )
    throw new Error("Stale or future snapshot");
}
