import type { PrivyClient } from "@privy-io/node";
import { decodeFunctionData, encodeFunctionData, type Hex } from "viem";
import { EXECUTOR_ABI } from "./rpc-adapter";
import { hashCanonical } from "@paramshield/evidence";
type Policy = Parameters<ReturnType<PrivyClient["policies"]>["create"]>[0];
export function executionPolicyFingerprint(
  policy: Pick<Policy, "version" | "chain_type" | "rules">,
) {
  // Privy normalizes address condition values to EIP-55 on read. Preserve all
  // rule/ABI/operator semantics; normalize ONLY known address-valued fields.
  return hashCanonical({
    version: policy.version,
    chain_type: policy.chain_type,
    rules: (policy.rules ?? []).map((r) => ({
      method: r.method,
      action: r.action,
      conditions: r.conditions.map((c) => {
        if (
          (c.field_source === "ethereum_transaction" && c.field === "to") ||
          (c.field_source === "ethereum_calldata" &&
            c.field === "execute.intent.target")
        ) {
          if (
            typeof c.value !== "string" ||
            !/^0x[0-9a-fA-F]{40}$/.test(c.value)
          )
            throw new Error("Invalid policy address condition");
          return { ...c, value: c.value.toLowerCase() };
        }
        return c;
      }),
    })),
  });
}

/** App-managed sign-only policy for ONE exact v2 execute intent. Default DENY.
 * Tuple path support must be verified with the actual provider control spike.
 * This is not quorum, human authentication, attestation or an admin-proof policy. */
export function exactExecutionPolicy(target: Hex, data: Hex): Policy {
  const call = decodeFunctionData({ abi: EXECUTOR_ABI, data });
  if (
    call.functionName !== "execute" ||
    encodeFunctionData({
      abi: EXECUTOR_ABI,
      functionName: "execute",
      args: call.args,
    }) !== data
  )
    throw new Error("Canonical v2 execute calldata required");
  if (!/^0x[0-9a-fA-F]{40}$/.test(target) || BigInt(target) === 0n)
    throw new Error("Invalid execution target");
  const intent = call.args[0];
  if (intent.chainId !== 11155111n || intent.value !== 0n)
    throw new Error("Zero-value Sepolia intent required");
  return {
    version: "1.0",
    name: "ParamShield exact v2 intent sign-only control",
    chain_type: "ethereum",
    rules: [
      {
        name: "Exact reviewed execute intent only",
        action: "ALLOW",
        method: "eth_signTransaction",
        conditions: [
          {
            field_source: "ethereum_transaction",
            field: "chain_id",
            operator: "eq",
            value: "11155111",
          },
          {
            field_source: "ethereum_transaction",
            field: "to",
            operator: "eq",
            value: target,
          },
          {
            field_source: "ethereum_transaction",
            field: "value",
            operator: "eq",
            value: "0",
          },
          {
            field_source: "ethereum_calldata",
            field: "function_name",
            abi: EXECUTOR_ABI,
            operator: "eq",
            value: "execute",
          },
          ...Object.entries(intent).map(([name, value]) => ({
            field_source: "ethereum_calldata" as const,
            field: `execute.intent.${name}`,
            abi: EXECUTOR_ABI,
            operator: "eq" as const,
            value: value.toString(),
          })),
        ],
      },
    ],
  };
}
