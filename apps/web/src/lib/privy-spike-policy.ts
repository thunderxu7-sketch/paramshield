import type { PrivyClient } from "@privy-io/node";
import { ethereumAddressSchema } from "@paramshield/shared";
import { encodeFunctionData, parseAbi } from "viem";

const ABI = parseAbi(["function markExpired(bytes32 changeHash)"]);
const ZERO_HASH = `0x${"0".repeat(64)}` as const;
export const SPIKE_CALLDATA = encodeFunctionData({
  abi: ABI,
  functionName: "markExpired",
  args: [ZERO_HASH],
});
type PolicyInput = Parameters<ReturnType<PrivyClient["policies"]>["create"]>[0];
// SIGN-ONLY zero-value call for a nonexistent proposal. The isolated proof
// wallet has no executor role; this is not the final product execution policy.
export function signingSpikePolicy(target: string): PolicyInput {
  const address = ethereumAddressSchema.parse(target);
  return {
    version: "1.0",
    name: "ParamShield Sepolia signing-only control spike",
    chain_type: "ethereum",
    rules: [
      {
        name: "Sign exact harmless Sepolia test call only",
        method: "eth_signTransaction",
        action: "ALLOW",
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
            value: address,
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
            abi: ABI,
            operator: "eq",
            value: "markExpired",
          },
          {
            field_source: "ethereum_calldata",
            field: "markExpired.changeHash",
            abi: ABI,
            operator: "eq",
            value: ZERO_HASH,
          },
        ],
      },
    ],
  };
}
