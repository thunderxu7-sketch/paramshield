import { z } from "zod";

export const projectMetadata = {
  name: "ParamShield",
  tagline: "Preflight risk checks for DeFi protocol parameter changes.",
} as const;

export const ethereumAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Expected an EVM address");

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte hex value");

export const basisPointsSchema = z.number().int().min(0).max(10_000);

export const changeIntentSchema = z
  .object({
    chainId: z.number().int().positive(),
    target: ethereumAddressSchema,
    selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/),
    calldata: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/),
    currentValueBps: basisPointsSchema,
    proposedValueBps: basisPointsSchema,
    nonce: z.string().min(1),
    expiresAt: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type ChangeIntent = z.infer<typeof changeIntentSchema>;

export const verdictSchema = z
  .object({
    changeId: bytes32Schema,
    verdict: z.enum(["ALLOW", "BLOCK", "ESCALATE"]),
    policyVersion: z.string().min(1),
    violations: z.array(z.string().min(1)),
    recommendedValueBps: basisPointsSchema.nullable(),
    evidenceHash: bytes32Schema,
    expiresAt: z.number().int().positive(),
  })
  .strict();

export type Verdict = z.infer<typeof verdictSchema>;
