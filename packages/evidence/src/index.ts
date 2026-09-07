import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";
import { z } from "zod";
import {
  assertFreshSnapshot,
  changeIntentSchema,
  intentCoreSchema,
  snapshotSchema,
  verdictSchema,
  nonzeroHashSchema,
  nonzeroAddressSchema,
  positiveUintSchema,
  thresholdSchema,
  timestampSchema,
  type ChangeIntent,
} from "@paramshield/shared";
import { simulate } from "@paramshield/risk-engine";

// This is a versioned project canonical format: sorted object keys, unchanged
// array order, UTF-8 JSON, decimal-string uints, safe integer JSON numbers only.
// Not an unqualified implementation of every JSON Canonicalization Scheme input.
export function canonicalJson(input: unknown): string {
  if (input === null || typeof input === "boolean" || typeof input === "string")
    return JSON.stringify(input);
  if (
    typeof input === "number" &&
    Number.isSafeInteger(input) &&
    !Object.is(input, -0)
  )
    return JSON.stringify(input);
  if (Array.isArray(input)) {
    if (Object.keys(input).length !== input.length)
      throw new Error("Sparse or decorated array");
    return `[${input.map(canonicalJson).join(",")}]`;
  }
  if (
    typeof input === "object" &&
    Object.getPrototypeOf(input) === Object.prototype
  ) {
    const object = input as Record<string, unknown>;
    if (Object.getOwnPropertySymbols(input).length)
      throw new Error("Symbol keys are unsupported");
    return `{${Object.keys(object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(object[k])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported canonical value");
}
export const hashCanonical = (input: unknown) =>
  keccak256(stringToHex(canonicalJson(input)));
export const LT_ABI = parseAbi([
  "function setLiquidationThresholdBps(uint16 newThresholdBps)",
]);
export function encodeThreshold(value: number) {
  thresholdSchema.parse(value);
  return encodeFunctionData({
    abi: LT_ABI,
    functionName: "setLiquidationThresholdBps",
    args: [value],
  });
}
export const CHANGE_INTENT_TYPE =
  "ChangeIntentV2(address executor,address operator,uint256 chainId,address target,uint256 value,bytes32 dataHash,uint256 nonce,bytes32 evidenceHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt)";
export const CHANGE_INTENT_TYPEHASH = keccak256(
  stringToHex(CHANGE_INTENT_TYPE),
);
export function hashChangeIntent(input: unknown) {
  const i = changeIntentSchema.parse(input);
  assertDecodedIntent(i);
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint64" },
      ],
      [
        CHANGE_INTENT_TYPEHASH,
        i.executor,
        i.operator,
        BigInt(i.chainId),
        i.target,
        0n,
        keccak256(i.calldata),
        BigInt(i.nonce),
        i.evidenceHash,
        BigInt(i.expectedStateVersion),
        BigInt(i.expectedAuthorizationEpoch),
        BigInt(i.expiresAt),
      ],
    ),
  );
}
function assertDecodedIntent(
  i: ChangeIntent | z.infer<typeof intentCoreSchema>,
): void {
  if (i.calldata !== encodeThreshold(i.proposedValueBps))
    throw new Error("Calldata does not match displayed LT");
  if (i.proposedValueBps >= i.currentValueBps)
    throw new Error("Only nonzero LT decreases are supported");
}
const validationSchema = z
  .object({
    validatedAt: timestampSchema,
    headBlock: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const preflightInputSchema = z
  .object({
    intentCore: intentCoreSchema,
    snapshot: snapshotSchema,
    stressBps: z.literal(1500),
    validation: validationSchema,
  })
  .strict();
export type Preflight = ReturnType<typeof createPreflight>["preflight"];
export function createPreflight(input: unknown) {
  const p = preflightInputSchema.parse(input),
    i = p.intentCore,
    s = p.snapshot;
  assertDecodedIntent(i);
  if (
    s.contractVersion !== "v2" ||
    s.stateVersion !== i.expectedStateVersion ||
    s.chainId !== i.chainId ||
    s.market !== i.target ||
    s.liquidationThresholdBps !== i.currentValueBps
  )
    throw new Error("Snapshot and intent binding mismatch (v2 required)");
  assertFreshSnapshot(s, p.validation.validatedAt, p.validation.headBlock);
  if (
    i.expiresAt <= p.validation.validatedAt ||
    i.expiresAt > p.validation.validatedAt + 600
  )
    throw new Error("Intent expiry must be within ten minutes");
  const preflight = {
    schemaVersion: "paramshield.preflight.v2" as const,
    ...p,
    simulation: simulate(s, i.proposedValueBps, p.stressBps),
  };
  const preflightHash = hashCanonical(preflight);
  const intent = changeIntentSchema.parse({
    ...i,
    evidenceHash: preflightHash,
  });
  return {
    preflight,
    preflightHash,
    intent,
    changeHash: hashChangeIntent(intent),
  };
}
const preflightEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("paramshield.preflight.v2"),
    ...preflightInputSchema.shape,
    simulation: z.unknown(),
  })
  .strict();
export function verifyPreflight(input: unknown) {
  const p = preflightEnvelopeSchema.parse(input);
  const result = createPreflight({
    intentCore: p.intentCore,
    snapshot: p.snapshot,
    stressBps: p.stressBps,
    validation: p.validation,
  });
  if (
    canonicalJson(p.simulation) !== canonicalJson(result.preflight.simulation)
  )
    throw new Error("Simulation mismatch");
  return result;
}
export function bindDecision(preflightInput: unknown, decisionInput: unknown) {
  const p = verifyPreflight(preflightInput),
    decision = verdictSchema.parse(decisionInput);
  if (
    decision.changeHash !== p.changeHash ||
    decision.preflightHash !== p.preflightHash ||
    decision.expiresAt !== p.intent.expiresAt
  )
    throw new Error("Decision binding mismatch");
  // Public binding validation does not certify the confidential policy verdict.
  return { ...p, decision, decisionHash: hashCanonical(decision) };
}
export const receiptSchema = z
  .object({
    transactionHash: nonzeroHashSchema,
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    blockNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    blockHash: nonzeroHashSchema,
    status: z.literal("success"),
    from: nonzeroAddressSchema,
    to: nonzeroAddressSchema,
    changeHash: nonzeroHashSchema,
    preflightHash: nonzeroHashSchema,
    decisionHash: nonzeroHashSchema,
  })
  .strict();
export const finalStateSchema = z
  .object({
    market: nonzeroAddressSchema,
    blockNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    blockHash: nonzeroHashSchema,
    liquidationThresholdBps: thresholdSchema,
    stateVersion: positiveUintSchema,
  })
  .strict();
const bundleInputSchema = z
  .object({
    preflight: z.unknown(),
    decision: z.unknown(),
    receipt: receiptSchema,
    finalState: finalStateSchema,
    authorization: z
      .object({
        provider: z.literal("privy"),
        walletId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
        controlId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
        requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
      })
      .strict(),
  })
  .strict();
export function createFinalBundle(input: unknown) {
  const parsed = bundleInputSchema.parse(input),
    bound = bindDecision(parsed.preflight, parsed.decision),
    i = bound.intent,
    r = parsed.receipt,
    f = parsed.finalState;
  if (bound.decision.verdict !== "ALLOW")
    throw new Error("Only ALLOW can have execution evidence");
  if (
    r.changeHash !== bound.changeHash ||
    r.preflightHash !== bound.preflightHash ||
    r.decisionHash !== bound.decisionHash ||
    r.from !== i.operator ||
    r.to !== i.executor ||
    r.chainId !== i.chainId ||
    r.blockNumber < bound.preflight.snapshot.block.number
  )
    throw new Error("Receipt binding mismatch");
  if (
    f.market !== i.target ||
    f.blockHash !== r.blockHash ||
    f.blockNumber !== r.blockNumber ||
    f.liquidationThresholdBps !== i.proposedValueBps ||
    BigInt(f.stateVersion) !== BigInt(i.expectedStateVersion) + 1n
  )
    throw new Error("Final state mismatch");
  const bundle = {
    schemaVersion: "paramshield.bundle.v2" as const,
    preflight: bound.preflight,
    preflightHash: bound.preflightHash,
    changeHash: bound.changeHash,
    decision: bound.decision,
    decisionHash: bound.decisionHash,
    authorization: parsed.authorization,
    receipt: r,
    finalState: f,
  };
  return { bundle, finalBundleHash: hashCanonical(bundle) };
}
// This library verifies internal consistency, not RPC authenticity, finality, or
// that a Privy request really occurred. Fetch/verify those at the trusted relay.
