import { recoverAuthorizationAddress } from "viem/utils";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  keccak256,
  parseAbi,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import type { SepoliaClient } from "./rpc-adapter";
import type { SigningPlan } from "./transaction-signing";

// MetaMask delegation-framework v1.3.0, Sepolia. Only receipt verification:
// never used to authorize/sign/broadcast, and NEVER used for Privy legs.
// Deployment/source references and the narrowly supported shape: ADR 0003.
export const MM_MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3" as const;
export const MM_DELEGATOR =
  "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b" as const;
export const MM_BALANCE = "0xbd7b277507723490cd50b12eaafe87c616be6880" as const;
export const MM_CODE_HASHES = {
  [MM_MANAGER]:
    "0x49c7f94924ffb53300b7e8ee613814d5ba587fd886177f1e72b3203bf17da673",
  [MM_DELEGATOR]:
    "0x9270f73d98e7ed6978677bf0550038289efd510e67e700d024502d62510fc1e4",
  [MM_BALANCE]:
    "0x61f455a893e4dcb39599bfcd8f59000e438c52639b278b933e469610c7761b76",
} as const;
export const REDEEM_ABI = parseAbi([
  "function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas)",
]);
export const DELEGATION_PARAMS = [
  {
    type: "tuple[]",
    components: [
      { name: "delegate", type: "address" },
      { name: "delegator", type: "address" },
      { name: "authority", type: "bytes32" },
      {
        name: "caveats",
        type: "tuple[]",
        components: [
          { name: "enforcer", type: "address" },
          { name: "terms", type: "bytes" },
          { name: "args", type: "bytes" },
        ],
      },
      { name: "salt", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
  },
] as const;
export const DELEGATION_TYPES = {
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" },
    { name: "caveats", type: "Caveat[]" },
    { name: "salt", type: "uint256" },
  ],
  Caveat: [
    { name: "enforcer", type: "address" },
    { name: "terms", type: "bytes" },
  ],
} as const;
const ZERO_MODE = `0x${"00".repeat(32)}` as Hex;
const ROOT = `0x${"ff".repeat(32)}` as Hex;
const same = (a: string | null | undefined, b: string) =>
  a?.toLowerCase() === b.toLowerCase();
export class MinedTransactionValidationError extends Error {
  constructor(
    readonly code: "ENVELOPE_MISMATCH" | "UNSUPPORTED_WALLET_WRAPPER",
  ) {
    super(
      code === "ENVELOPE_MISMATCH"
        ? "Mined transaction does not match reviewed plan"
        : "Unsupported wallet transaction wrapper or mismatched intent",
    );
    this.name = "MinedTransactionValidationError";
  }
}
function requireMatch(ok: unknown): asserts ok {
  if (!ok)
    throw new MinedTransactionValidationError("UNSUPPORTED_WALLET_WRAPPER");
}

/** Read-only, fail-closed recognition of one self-delegated, zero-value SINGLE
 * CALL through pinned MetaMask code. No batches, delegatecall, arbitrary hooks,
 * third-party delegations, fee changes, or unknown account implementations. */
export async function verifyDecisionWalletWrapper(
  client: SepoliaClient,
  plan: SigningPlan,
  tx: Awaited<ReturnType<SepoliaClient["getTransaction"]>>,
  blockNumber: bigint,
) {
  requireMatch(
    (tx.type === "eip7702" || tx.type === "eip1559") && same(tx.to, MM_MANAGER),
  );
  // Wallet wrapping increases gas, but this read-only compatibility branch has
  // a hard 3x / 1M gas ceiling. Fee caps, sender and nonce stay exact upstream.
  requireMatch(
    tx.gas >= BigInt(plan.gas) &&
      tx.gas <= BigInt(plan.gas) * 3n &&
      tx.gas <= 1_000_000n,
  );
  try {
    if (tx.type === "eip7702") {
      requireMatch(tx.authorizationList.length === 1);
      const auth = tx.authorizationList[0]!;
      requireMatch(
        auth.chainId === plan.chainId &&
          same(auth.address, MM_DELEGATOR) &&
          auth.nonce === plan.nonce + 1,
      );
      requireMatch(
        same(
          await recoverAuthorizationAddress({ authorization: auth }),
          plan.from,
        ),
      );
    } else {
      // Already-delegated accounts need no new 7702 authorization. Their receipt-
      // block delegation designation and code pins are still mandatory below.
      requireMatch(tx.authorizationList === undefined);
    }
    const decoded = decodeFunctionData({ abi: REDEEM_ABI, data: tx.input });
    const [contexts, modes, calls] = decoded.args;
    requireMatch(
      contexts.length === 1 &&
        modes.length === 1 &&
        calls.length === 1 &&
        modes[0] === ZERO_MODE,
    );
    requireMatch(
      encodeFunctionData({
        abi: REDEEM_ABI,
        functionName: "redeemDelegations",
        args: decoded.args,
      }) === tx.input,
    );
    requireMatch(
      same(
        calls[0],
        encodePacked(["address", "uint256", "bytes"], [plan.to, 0n, plan.data]),
      ),
    );
    const [delegations] = decodeAbiParameters(DELEGATION_PARAMS, contexts[0]!);
    requireMatch(
      encodeAbiParameters(DELEGATION_PARAMS, [delegations]) === contexts[0],
    );
    requireMatch(delegations.length === 1);
    const delegation = delegations[0]!;
    requireMatch(
      same(delegation.delegate, plan.from) &&
        same(delegation.delegator, plan.from) &&
        delegation.authority === ROOT,
    );
    requireMatch(delegation.caveats.length === 1);
    const caveat = delegation.caveats[0]!;
    requireMatch(same(caveat.enforcer, MM_BALANCE) && caveat.args === "0x");
    requireMatch(
      same(
        caveat.terms,
        encodePacked(["uint8", "address", "uint256"], [1, plan.from, 0n]),
      ),
    );
    requireMatch(
      same(
        await recoverTypedDataAddress({
          domain: {
            name: "DelegationManager",
            version: "1",
            chainId: plan.chainId,
            verifyingContract: MM_MANAGER,
          },
          types: DELEGATION_TYPES,
          primaryType: "Delegation",
          message: delegation,
          signature: delegation.signature,
        }),
        plan.from,
      ),
    );
  } catch (error) {
    if (error instanceof MinedTransactionValidationError) throw error;
    throw new MinedTransactionValidationError("UNSUPPORTED_WALLET_WRAPPER");
  }
  // Pin implementation and every hook AT the canonical receipt block, not latest.
  await Promise.all(
    Object.entries(MM_CODE_HASHES).map(async ([address, hash]) => {
      const code = await client.getCode({
        address: address as Address,
        blockNumber,
      });
      requireMatch(code && keccak256(code) === hash);
    }),
  );
  const accountCode = await client.getCode({ address: plan.from, blockNumber });
  requireMatch(same(accountCode, `0xef0100${MM_DELEGATOR.slice(2)}`));
}
