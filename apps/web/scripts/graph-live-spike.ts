import { createPublicClient, http, parseAbi, type Address } from "viem";
import { sepolia } from "viem/chains";
import {
  fetchGraphSnapshot,
  corroborateSnapshot,
  type RpcSnapshotPort,
} from "@paramshield/graph-client";
import { simulate } from "@paramshield/risk-engine";
import { hashCanonical } from "@paramshield/evidence";
import { mkdir, writeFile } from "node:fs/promises";
const ABI = parseAbi([
  "function liquidationThresholdBps() view returns(uint16)",
  "function collateralPriceUsdE18() view returns(uint256)",
  "function totalCollateral() view returns(uint256)",
  "function totalDebt() view returns(uint256)",
  "function collateralScale() view returns(uint256)",
  "function debtScale() view returns(uint256)",
  "function positions(address) view returns(uint256 collateralAmount,uint256 debtAmount)",
]);
async function main() {
  const url = process.env.GRAPH_QUERY_URL;
  if (!url)
    throw new Error(
      "GRAPH_QUERY_URL not configured: live Graph verification is pending",
    );
  const client = createPublicClient({
    chain: sepolia,
    transport: http(
      process.env.SEPOLIA_RPC_URL ||
        "https://ethereum-sepolia-rpc.publicnode.com",
      { timeout: 15000, retryCount: 0 },
    ),
  });
  const chainId = await client.getChainId();
  if (chainId !== 11155111) throw new Error("Sepolia required");
  const headBlock = Number(await client.getBlockNumber());
  const snapshot = await fetchGraphSnapshot({
    url,
    ...(process.env.GRAPH_API_KEY ? { apiKey: process.env.GRAPH_API_KEY } : {}),
    market: "0xFabda359d272974F6561E907a4BB740b11A9fC26",
    chainId,
    now: Math.floor(Date.now() / 1000),
    headBlock,
  });
  if (snapshot.contractVersion !== "v1")
    throw new Error("This spike only targets the recorded v1 deployment");
  const port: RpcSnapshotPort = {
    getChainId: () => client.getChainId(),
    block: async (number) => {
      const b = await client.getBlock({ blockNumber: BigInt(number) });
      return { hash: b.hash, timestamp: Number(b.timestamp) };
    },
    market: async (address, block) => {
      const config = {
        address: address as Address,
        abi: ABI,
        blockNumber: BigInt(block),
      };
      const [lt, price, collateral, debt, cScale, dScale] = await Promise.all([
        client.readContract({
          ...config,
          functionName: "liquidationThresholdBps",
        }),
        client.readContract({
          ...config,
          functionName: "collateralPriceUsdE18",
        }),
        client.readContract({ ...config, functionName: "totalCollateral" }),
        client.readContract({ ...config, functionName: "totalDebt" }),
        client.readContract({ ...config, functionName: "collateralScale" }),
        client.readContract({ ...config, functionName: "debtScale" }),
      ]);
      function decimals(scale: bigint) {
        for (let i = 0; i <= 18; i++) if (10n ** BigInt(i) === scale) return i;
        throw new Error("Invalid token scale");
      }
      return {
        liquidationThresholdBps: lt,
        collateralPriceUsdE18: price.toString(),
        totalCollateral: collateral.toString(),
        totalDebt: debt.toString(),
        collateralDecimals: decimals(cScale),
        debtDecimals: decimals(dScale),
        stateVersion: null,
      };
    },
    position: async (address, account, block) => {
      const [c, d] = await client.readContract({
        address: address as Address,
        abi: ABI,
        functionName: "positions",
        args: [account as Address],
        blockNumber: BigInt(block),
      });
      return { collateralAmount: c.toString(), debtAmount: d.toString() };
    },
  };
  await corroborateSnapshot(snapshot, port);
  const simulation = simulate(snapshot, 7000);
  const evidence = {
    checkedAt: new Date().toISOString(),
    kind: "graph-v1-data-readiness",
    snapshot,
    snapshotHash: hashCanonical(snapshot),
    simulation,
    rpcCorroborated: true,
    executable: false,
  };
  const root = new URL("../../../", import.meta.url);
  await mkdir(new URL("docs/evidence/", root), { recursive: true });
  await writeFile(
    new URL("docs/evidence/graph-live-v1.json", root),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      kind: evidence.kind,
      indexedBlock: snapshot.block.number,
      positions: snapshot.positionCount,
      snapshotHash: evidence.snapshotHash,
      proposedStressDebtUsdE18:
        simulation.proposedStress.liquidatableDebtUsdE18,
      rpcCorroborated: true,
      executable: false,
    }),
  );
}
main().catch(() => {
  console.error(
    "Live Graph spike failed; verify endpoint configuration, freshness, indexing and RPC corroboration. No fallback data was used; provider details omitted.",
  );
  process.exitCode = 1;
});
