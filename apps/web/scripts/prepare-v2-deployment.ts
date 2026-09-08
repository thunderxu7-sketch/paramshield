import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  encodeDeployData,
  keccak256,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import {
  createSepoliaClient,
  createRpcSnapshotPort,
} from "../src/lib/server/rpc-adapter";
import { runBoundedProcess } from "../src/lib/bounded-process";
import { DurableStore } from "../src/lib/server/durable-store";

// Read-only preparation. There is intentionally NO signer/broadcast operation.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sha = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
async function main() {
  const historical = await readFile(join(root, "deployments/sepolia.json"));
  const v1 = JSON.parse(historical.toString());
  const admin = v1.deployment.deployer as Address;
  const client = createSepoliaClient(
    process.env.SEPOLIA_RPC_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com",
  );
  if ((await client.getChainId()) !== 11155111)
    throw new Error("Sepolia RPC required");
  await runBoundedProcess("forge", ["build"], {
    cwd: join(root, "contracts"),
    timeoutMs: 60_000,
  });
  const names = [
    "ParamShieldBootstrapV2",
    "ReferenceLendingMarket",
    "ParamShieldExecutor",
    "MockERC20",
  ];
  await mkdir(join(root, "deployments/v2/abi"), { recursive: true });
  const artifacts: Record<string, { abi: Abi; bytecode: { object: Hex } }> = {};
  const abiHashes: Record<string, string> = {};
  for (const name of names) {
    const a = JSON.parse(
      await readFile(
        join(root, `contracts/out/${name}.sol/${name}.json`),
        "utf8",
      ),
    );
    artifacts[name] = a;
    const body = JSON.stringify(a.abi, null, 2) + "\n";
    await writeFile(join(root, `deployments/v2/abi/${name}.json`), body);
  }
  await runBoundedProcess(
    "pnpm",
    ["exec", "prettier", "--write", "deployments/v2/abi"],
    { cwd: root, timeoutMs: 30_000 },
  );
  for (const name of names)
    abiHashes[name] = sha(
      await readFile(join(root, `deployments/v2/abi/${name}.json`)),
    );
  const block = await client.getBlock({ blockTag: "latest" });
  const [balance, nonce, fees, oldMarket] = await Promise.all([
    client.getBalance({ address: admin, blockNumber: block.number }),
    client.getTransactionCount({ address: admin, blockTag: "pending" }),
    client.estimateFeesPerGas({ type: "eip1559" }),
    createRpcSnapshotPort(client, "v1").market(
      v1.contracts.market.address,
      Number(block.number),
    ),
  ]);
  let v1RejectedByV2Adapter = false;
  try {
    await createRpcSnapshotPort(client, "v2").market(
      v1.contracts.market.address,
      Number(block.number),
    );
  } catch (error) {
    if (
      !(error instanceof ContractFunctionExecutionError) ||
      !(
        error.cause instanceof ContractFunctionRevertedError ||
        error.cause instanceof ContractFunctionZeroDataError
      )
    )
      throw error;
    v1RejectedByV2Adapter = true;
  }
  if (!v1RejectedByV2Adapter)
    throw new Error(
      "Unexpected v2 method on historical market; review deployment",
    );
  const op = process.env.PARAMSHIELD_OPERATOR,
    authority = process.env.PARAMSHIELD_DECISION_AUTHORITY;
  if (Boolean(op) !== Boolean(authority))
    throw new Error(
      "Both independent role addresses are required for final payload estimation",
    );
  let roles: { operator: Address; decisionAuthority: Address } | null = null;
  let payload: {
    initcodeHash: Hex;
    initcodeBytes: number;
    estimatedGas: string;
    gasLimit: string;
  } | null = null;
  if (op && authority) {
    for (const a of [op, authority])
      if (!/^0x[0-9a-fA-F]{40}$/.test(a) || BigInt(a) === 0n)
        throw new Error("Invalid role address");
    if (new Set([admin, op, authority].map((a) => a.toLowerCase())).size !== 3)
      throw new Error("Admin/operator/authority must be independent addresses");
    roles = {
      operator: op as Address,
      decisionAuthority: authority as Address,
    };
    const a = artifacts.ParamShieldBootstrapV2!;
    const initcode = encodeDeployData({
      abi: a.abi,
      bytecode: a.bytecode.object,
      args: [admin, roles.operator, roles.decisionAuthority],
    });
    const estimatedGas = await client.estimateGas({
      account: admin,
      data: initcode,
      value: 0n,
    });
    payload = {
      initcodeHash: keccak256(initcode),
      initcodeBytes: (initcode.length - 2) / 2,
      estimatedGas: estimatedGas.toString(),
      gasLimit: ((estimatedGas * 120n + 99n) / 100n).toString(),
    };
    await new DurableStore(join(root, ".local/deployment-review")).write(
      "sepolia-v2-unsigned",
      {
        chainId: 11155111,
        from: admin,
        value: "0",
        data: initcode,
        nonce,
        ...payload,
      },
    );
  }
  const sourcePaths = [
    "contracts/src/ParamShieldBootstrapV2.sol",
    "contracts/src/ParamShieldExecutor.sol",
    "contracts/src/ReferenceLendingMarket.sol",
    "contracts/src/MockERC20.sol",
    "contracts/src/DemoSeed.sol",
    "contracts/script/DeploySepoliaV2.s.sol",
    "contracts/foundry.toml",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (p) => [p, sha(await readFile(join(root, p)))]),
    ),
  );
  const gasForBudget = payload ? BigInt(payload.gasLimit) : 5_500_000n;
  const evidence = {
    checkedAt: new Date().toISOString(),
    schemaVersion: "paramshield.v2-deployment-preparation.v1",
    status: "PREPARED_NOT_DEPLOYED",
    network: "Sepolia",
    chainId: 11155111,
    admin,
    roles,
    roleCapabilitiesVerified: false,
    governanceAdminTrusted: true,
    payload,
    sourceSha256: sourceHashes,
    abiSha256: abiHashes,
    readOnlyRpc: {
      blockNumber: Number(block.number),
      blockHash: block.hash,
      adminBalanceWei: balance.toString(),
      pendingNonce: nonce,
      v1MarketState: oldMarket,
      v1RejectedByV2Adapter,
    },
    budget: {
      basis: payload
        ? "live-estimate-plus-20-percent"
        : "planning-only-5500000-gas-ceiling-NOT-final-estimate",
      gas: gasForBudget.toString(),
      maxFeePerGasWei: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGasWei: fees.maxPriorityFeePerGas.toString(),
      maximumCostWei: (gasForBudget * fees.maxFeePerGas).toString(),
      adminHasPlanningBudget: balance >= gasForBudget * fees.maxFeePerGas,
    },
    historicalV1ManifestSha256: sha(historical),
    broadcast: false,
    remaining: [
      "Select/verify distinct operator and decision authority capabilities; isolated proof wallets are not assigned these roles",
      "Generate and review exact constructor payload/gas once role addresses are set",
      "Deploy separately, verify source and bytecode, save a NEW v2 manifest; leave v1 intact",
      "Reconfigure/index hosted Graph for v2 before any execution",
    ],
  };
  if (
    sha(await readFile(join(root, "deployments/sepolia.json"))) !==
    sha(historical)
  )
    throw new Error("Historical manifest changed during preparation");
  await writeFile(
    join(root, "deployments/v2/preparation.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(() => {
  console.error(
    "v2 preparation failed; no transaction signed or sent; provider details omitted",
  );
  process.exitCode = 1;
});
