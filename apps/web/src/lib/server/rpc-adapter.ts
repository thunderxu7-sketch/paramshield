import {
  createPublicClient,
  http,
  keccak256,
  parseAbi,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import {
  corroborateSnapshot,
  type RpcSnapshotPort,
} from "@paramshield/graph-client";
import type { ExecutionStatePort } from "../execution-preflight";

export const MARKET_ABI = parseAbi([
  "function owner() view returns(address)",
  "function stateVersion() view returns(uint256)",
  "function liquidationThresholdBps() view returns(uint16)",
  "function collateralPriceUsdE18() view returns(uint256)",
  "function totalCollateral() view returns(uint256)",
  "function totalDebt() view returns(uint256)",
  "function collateralScale() view returns(uint256)",
  "function debtScale() view returns(uint256)",
  "function positions(address) view returns(uint256 collateralAmount,uint256 debtAmount)",
]);
export const EXECUTOR_ABI = parseAbi([
  "function admin() view returns(address)",
  "function operator() view returns(address)",
  "function decisionAuthority() view returns(address)",
  "function authorizationEpoch() view returns(uint256)",
  "function allowedCalls(address,bytes4) view returns(bool)",
  "function nonceUsed(address,uint256) view returns(bool)",
  "function proposals(bytes32) view returns(address operator,address target,bytes4 selector,bytes32 dataHash,bytes32 evidenceHash,bytes32 decisionHash,uint256 nonce,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt,uint8 state)",
  "function propose((uint256 chainId,address target,uint256 value,bytes data,uint256 nonce,bytes32 evidenceHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt) intent) returns(bytes32)",
  "function execute((uint256 chainId,address target,uint256 value,bytes data,uint256 nonce,bytes32 evidenceHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch,uint64 expiresAt) intent) returns(bytes)",
  "function recordDecision(bytes32 changeHash,uint8 decision,bytes32 decisionHash)",
]);
export function createSepoliaClient(url: string) {
  const u = new URL(url);
  if (
    u.username ||
    u.password ||
    (u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(u.hostname)
      ))
  )
    throw new Error("Configured HTTPS or loopback RPC required");
  return createPublicClient({
    chain: sepolia,
    cacheTime: 0,
    transport: http(url, { timeout: 10_000, retryCount: 0 }),
  });
}
export type SepoliaClient = ReturnType<typeof createSepoliaClient>;
const safeNumber = (n: bigint) => {
  const value = Number(n);
  if (!Number.isSafeInteger(value)) throw new Error("Unsafe RPC integer");
  return value;
};
function decimals(scale: bigint) {
  for (let i = 0; i <= 18; i++) if (10n ** BigInt(i) === scale) return i;
  throw new Error("Unsupported token scale");
}
export function createRpcSnapshotPort(
  client: SepoliaClient,
  version: "v1" | "v2",
): RpcSnapshotPort {
  return {
    getChainId: () => client.getChainId(),
    block: async (number) => {
      const b = await client.getBlock({ blockNumber: BigInt(number) });
      return { hash: b.hash, timestamp: safeNumber(b.timestamp) };
    },
    market: async (address, number) => {
      const p = {
        address: address as Address,
        blockNumber: BigInt(number),
        abi: MARKET_ABI,
      };
      const [lt, price, collateral, debt, cScale, dScale, stateVersion] =
        await Promise.all([
          client.readContract({
            ...p,
            functionName: "liquidationThresholdBps",
          }),
          client.readContract({ ...p, functionName: "collateralPriceUsdE18" }),
          client.readContract({ ...p, functionName: "totalCollateral" }),
          client.readContract({ ...p, functionName: "totalDebt" }),
          client.readContract({ ...p, functionName: "collateralScale" }),
          client.readContract({ ...p, functionName: "debtScale" }),
          version === "v2"
            ? client.readContract({ ...p, functionName: "stateVersion" })
            : null,
        ]);
      return {
        liquidationThresholdBps: lt,
        collateralPriceUsdE18: price.toString(),
        totalCollateral: collateral.toString(),
        totalDebt: debt.toString(),
        collateralDecimals: decimals(cScale),
        debtDecimals: decimals(dScale),
        stateVersion: stateVersion?.toString() ?? null,
      };
    },
    position: async (address, account, number) => {
      const [c, d] = await client.readContract({
        address: address as Address,
        abi: MARKET_ABI,
        functionName: "positions",
        args: [account as Address],
        blockNumber: BigInt(number),
      });
      return { collateralAmount: c.toString(), debtAmount: d.toString() };
    },
  };
}
export function createExecutionStatePort(
  client: SepoliaClient,
): ExecutionStatePort {
  return {
    corroborateSnapshot: (snapshot) =>
      corroborateSnapshot(snapshot, createRpcSnapshotPort(client, "v2")),
    canonicalBlockHash: async (number) =>
      (await client.getBlock({ blockNumber: BigInt(number) })).hash,
    read: async ({ executor, target, changeHash }) => {
      if ((await client.getChainId()) !== 11155111)
        throw new Error("Sepolia RPC required");
      const b = await client.getBlock({ blockTag: "latest" });
      const e = { address: executor, abi: EXECUTOR_ABI, blockNumber: b.number };
      const m = { address: target, abi: MARKET_ABI, blockNumber: b.number };
      // No multicall or latest-state mixing: every read is at one exact block.
      const [
        executorCode,
        marketCode,
        operator,
        authority,
        owner,
        version,
        epoch,
        allowed,
        proposal,
      ] = await Promise.all([
        client.getCode({ address: executor, blockNumber: b.number }),
        client.getCode({ address: target, blockNumber: b.number }),
        client.readContract({ ...e, functionName: "operator" }),
        client.readContract({ ...e, functionName: "decisionAuthority" }),
        client.readContract({ ...m, functionName: "owner" }),
        client.readContract({ ...m, functionName: "stateVersion" }),
        client.readContract({ ...e, functionName: "authorizationEpoch" }),
        client.readContract({
          ...e,
          functionName: "allowedCalls",
          args: [target, "0x4d5bcf96"],
        }),
        client.readContract({
          ...e,
          functionName: "proposals",
          args: [changeHash],
        }),
      ]);
      if (
        !executorCode ||
        executorCode === "0x" ||
        !marketCode ||
        marketCode === "0x"
      )
        throw new Error("Deployed contracts required");
      if ((await client.getBlock({ blockNumber: b.number })).hash !== b.hash)
        throw new Error("RPC state reorganized during read");
      return {
        chainId: 11155111,
        block: {
          number: safeNumber(b.number),
          hash: b.hash,
          timestamp: safeNumber(b.timestamp),
        },
        executorCodeHash: keccak256(executorCode),
        marketCodeHash: keccak256(marketCode),
        operator,
        decisionAuthority: authority,
        marketOwner: owner,
        stateVersion: version.toString(),
        authorizationEpoch: epoch.toString(),
        allowedCall: allowed,
        proposal: { state: proposal[10], decisionHash: proposal[5] },
      };
    },
  };
}
