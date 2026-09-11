import { describe, it, expect, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  type Hex,
} from "viem";
import { operator, stranger, hash, executionFixture } from "./test-fixtures";
import { verifyMinedTransaction } from "./transaction-broadcast";
import { verifyLifecycleReceipt } from "./lifecycle-receipt";
import { lifecycleData } from "./lifecycle-preflight";
import { safeConsoleError } from "./console-service";
import {
  MM_MANAGER,
  MM_DELEGATOR,
  MM_BALANCE,
  DELEGATION_PARAMS,
  DELEGATION_TYPES,
  REDEEM_ABI,
  MinedTransactionValidationError,
} from "./decision-7702";
import codes from "./fixtures/metamask-v1.3.0-code.json";
import type { SigningPlan } from "./transaction-signing";
import type { SepoliaClient } from "./rpc-adapter";

async function fixture() {
  const b = executionFixture().bound;
  const plan: SigningPlan = {
    chainId: 11155111,
    from: operator.address,
    to: b.intent.executor,
    value: "0",
    data: lifecycleData(b, "decision"),
    nonce: 0,
    gas: "86043",
    maxFeePerGas: "1318450912",
    maxPriorityFeePerGas: "1000000",
    expiresAt: b.intent.expiresAt,
  };
  const delegation = {
    delegate: plan.from,
    delegator: plan.from,
    authority: `0x${"ff".repeat(32)}` as Hex,
    caveats: [
      {
        enforcer: MM_BALANCE,
        terms: encodePacked(
          ["uint8", "address", "uint256"],
          [1, plan.from, 0n],
        ),
        args: "0x" as Hex,
      },
    ],
    salt: 1n,
    signature: "0x" as Hex,
  };
  delegation.signature = await operator.signTypedData({
    domain: {
      name: "DelegationManager",
      version: "1",
      chainId: 11155111,
      verifyingContract: MM_MANAGER,
    },
    types: DELEGATION_TYPES,
    primaryType: "Delegation",
    message: delegation,
  });
  const context = encodeAbiParameters(DELEGATION_PARAMS, [[delegation]]);
  const mode = `0x${"00".repeat(32)}` as Hex;
  const call = encodePacked(
    ["address", "uint256", "bytes"],
    [plan.to, 0n, plan.data],
  );
  const wrap = (
    contexts: readonly Hex[] = [context],
    modes: readonly Hex[] = [mode],
    calls: readonly Hex[] = [call],
  ) =>
    encodeFunctionData({
      abi: REDEEM_ABI,
      functionName: "redeemDelegations",
      args: [contexts, modes, calls],
    });
  const tx = {
    type: "eip7702" as const,
    chainId: 11155111,
    hash: hash("1"),
    from: plan.from,
    to: MM_MANAGER as string,
    input: wrap(),
    value: 0n,
    nonce: 0,
    gas: 206576n,
    maxFeePerGas: BigInt(plan.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(plan.maxPriorityFeePerGas),
    accessList: [],
    authorizationList: [
      await operator.signAuthorization({
        contractAddress: MM_DELEGATOR,
        chainId: 11155111,
        nonce: 1,
      }),
    ],
    blockNumber: 101n,
    blockHash: hash("2"),
  };
  const receipt = {
    status: "success",
    transactionHash: tx.hash,
    from: tx.from,
    to: tx.to,
    blockNumber: tx.blockNumber,
    blockHash: tx.blockHash,
    logs: [],
  };
  const rpc = {
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
    getChainId: vi.fn(async () => 11155111),
    getBlock: vi.fn(async () => ({ hash: tx.blockHash })),
    getBlockNumber: vi.fn(async () => 110n),
    getCode: vi.fn(async ({ address }: { address: string }) =>
      address.toLowerCase() === plan.from.toLowerCase()
        ? `0xef0100${MM_DELEGATOR.slice(2)}`
        : codes[address.toLowerCase() as keyof typeof codes],
    ),
    readContract: vi.fn(),
    sendRawTransaction: vi.fn(),
  };
  return {
    plan,
    b,
    tx,
    receipt,
    rpc,
    client: rpc as unknown as SepoliaClient,
    delegation,
    context,
    mode,
    call,
    wrap,
  };
}

describe("narrow MetaMask 7702 decision receipt compatibility", () => {
  it("verifies real signatures, canonical single-call encoding and pinned code at the receipt block", async () => {
    const f = await fixture();
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash, {
        decisionWallet: true,
      }),
    ).resolves.toBe(f.receipt);
    expect(f.rpc.getCode).toHaveBeenCalledTimes(4);
    for (const call of f.rpc.getCode.mock.calls)
      expect(call[0]).toMatchObject({ blockNumber: 101n });
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("recognizes the same exact wrapper for an already-delegated type-2 account, but still pins account code", async () => {
    const f = await fixture();
    const wrapped = { ...f.tx, type: "eip1559", authorizationList: undefined };
    f.rpc.getTransaction.mockResolvedValue(wrapped as unknown as typeof f.tx);
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash, {
        decisionWallet: true,
      }),
    ).resolves.toBe(f.receipt);
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash),
    ).rejects.toThrow();
    f.rpc.getCode.mockImplementation(
      async ({ address }) =>
        codes[address.toLowerCase() as keyof typeof codes] ?? "0x",
    );
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash, {
        decisionWallet: true,
      }),
    ).rejects.toThrow();
  });
  it("never enables 7702 for operator propose/execute receipts", async () => {
    const f = await fixture();
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash),
    ).rejects.toBeInstanceOf(MinedTransactionValidationError);
    for (const leg of ["propose", "execute"] as const)
      await expect(
        verifyLifecycleReceipt(f.client, f.plan, f.tx.hash, f.b, leg),
      ).rejects.toBeInstanceOf(MinedTransactionValidationError);
    expect(f.rpc.getCode).not.toHaveBeenCalled();
  });
  it.each([
    "sender",
    "chain",
    "nonce",
    "value",
    "fees",
    "gas",
    "manager",
    "extraAuth",
    "wrongAuthSigner",
    "authChain",
    "authNonce",
    "authTarget",
    "authSignature",
    "batch",
    "mode",
    "innerTarget",
    "innerValue",
    "innerData",
    "trailingData",
    "thirdParty",
    "hook",
    "terms",
    "hookArgs",
    "delegationSignature",
    "code",
    "accountCode",
    "revert",
    "reorg",
    "receiptTo",
  ])("rejects %s without sending", async (kind) => {
    const f = await fixture();
    switch (kind) {
      case "sender":
        f.tx.from = stranger.address;
        break;
      case "chain":
        f.tx.chainId = 1;
        break;
      case "nonce":
        f.tx.nonce = 3;
        break;
      case "value":
        f.tx.value = 1n;
        break;
      case "fees":
        f.tx.maxFeePerGas++;
        break;
      case "gas":
        f.tx.gas = BigInt(f.plan.gas) * 3n + 1n;
        break;
      case "manager":
        f.tx.to = stranger.address;
        f.receipt.to = f.tx.to;
        break;
      case "extraAuth":
        f.tx.authorizationList.push(f.tx.authorizationList[0]!);
        break;
      case "wrongAuthSigner":
        f.tx.authorizationList = [
          await stranger.signAuthorization({
            contractAddress: MM_DELEGATOR,
            chainId: 11155111,
            nonce: 1,
          }),
        ];
        break;
      case "authChain":
        f.tx.authorizationList[0]!.chainId = 1;
        break;
      case "authNonce":
        f.tx.authorizationList[0]!.nonce = 0;
        break;
      case "authTarget":
        f.tx.authorizationList[0]!.address = stranger.address;
        break;
      case "authSignature":
        f.tx.authorizationList[0]!.r = hash("0");
        break;
      case "batch":
        f.tx.input = f.wrap(
          [f.context, f.context],
          [f.mode, f.mode],
          [f.call, f.call],
        );
        break;
      case "mode":
        f.tx.input = f.wrap(undefined, [hash("1")]);
        break;
      case "innerTarget":
        f.tx.input = f.wrap(undefined, undefined, [
          encodePacked(
            ["address", "uint256", "bytes"],
            [stranger.address, 0n, f.plan.data],
          ),
        ]);
        break;
      case "innerValue":
        f.tx.input = f.wrap(undefined, undefined, [
          encodePacked(
            ["address", "uint256", "bytes"],
            [f.plan.to, 1n, f.plan.data],
          ),
        ]);
        break;
      case "innerData":
        f.tx.input = f.wrap(undefined, undefined, [
          encodePacked(
            ["address", "uint256", "bytes"],
            [f.plan.to, 0n, "0x12345678"],
          ),
        ]);
        break;
      case "trailingData":
        f.tx.input = `${f.tx.input}00`;
        break;
      case "thirdParty":
        f.delegation.delegate = stranger.address;
        break;
      case "hook":
        f.delegation.caveats[0]!.enforcer =
          stranger.address as typeof MM_BALANCE;
        break;
      case "terms":
        f.delegation.caveats[0]!.terms = "0x";
        break;
      case "hookArgs":
        f.delegation.caveats[0]!.args = "0x01";
        break;
      case "delegationSignature":
        f.delegation.signature = `0x${"01".repeat(65)}`;
        break;
      case "code":
        f.rpc.getCode.mockResolvedValueOnce("0x1234");
        break;
      case "accountCode":
        f.rpc.getCode.mockImplementation(
          async ({ address }) =>
            codes[address.toLowerCase() as keyof typeof codes] ?? "0x",
        );
        break;
      case "revert":
        f.receipt.status = "reverted";
        break;
      case "reorg":
        f.rpc.getBlock.mockResolvedValueOnce({ hash: hash("9") });
        break;
      case "receiptTo":
        f.receipt.to = stranger.address;
        break;
    }
    if (
      [
        "thirdParty",
        "hook",
        "terms",
        "hookArgs",
        "delegationSignature",
      ].includes(kind)
    )
      f.tx.input = f.wrap([
        encodeAbiParameters(DELEGATION_PARAMS, [[f.delegation]]),
      ]);
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash, {
        decisionWallet: true,
      }),
    ).rejects.toThrow();
    expect(f.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("requires lifecycle event and receipt-block state even after envelope compatibility passes", async () => {
    const f = await fixture();
    const i = f.b.intent;
    f.rpc.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "liquidationThresholdBps"
        ? i.currentValueBps
        : functionName === "stateVersion"
          ? BigInt(i.expectedStateVersion)
          : [
              i.operator,
              i.target,
              i.calldata.slice(0, 10),
              (await import("viem")).keccak256(i.calldata),
              f.b.preflightHash,
              f.b.decisionHash,
              BigInt(i.nonce),
              BigInt(i.expectedStateVersion),
              BigInt(i.expectedAuthorizationEpoch),
              BigInt(i.expiresAt),
              2,
            ],
    );
    await expect(
      verifyLifecycleReceipt(f.client, f.plan, f.tx.hash, f.b, "decision"),
    ).rejects.toThrow("Decision event mismatch");
  });
  it("preserves historical-RPC failures as unverified instead of accepting or blaming signatures", async () => {
    const f = await fixture();
    f.rpc.getCode.mockRejectedValueOnce(
      new Error("historical state is not available"),
    );
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.tx.hash, {
        decisionWallet: true,
      }),
    ).rejects.toThrow("historical state");
  });
  it.each([
    new MinedTransactionValidationError("ENVELOPE_MISMATCH"),
    new MinedTransactionValidationError("UNSUPPORTED_WALLET_WRAPPER"),
    new Error("Mined transaction does not match reviewed plan"),
    new Error("Signed transaction does not match reviewed plan"),
  ])(
    "does not misclassify transaction errors as missing reviewer signatures",
    (error) => {
      expect(safeConsoleError(error)).toContain("钱包交易格式或执行内容");
      expect(safeConsoleError(error)).toContain("不要重签或重发");
      expect(safeConsoleError(error)).not.toContain("需要指定审核人");
    },
  );
});
