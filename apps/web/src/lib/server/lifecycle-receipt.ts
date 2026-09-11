import { keccak256, parseAbi, parseEventLogs, type Hex } from "viem";
import { EXECUTOR_ABI, MARKET_ABI, type SepoliaClient } from "./rpc-adapter";
import { verifyMinedTransaction } from "./transaction-broadcast";
import type { SigningPlan } from "./transaction-signing";
import type { BoundRun } from "./lifecycle-preflight";

const EVENTS = parseAbi([
  "event ProposalCreated(bytes32 indexed changeHash,address indexed operator,address indexed target,bytes4 selector,bytes32 dataHash,uint256 nonce,bytes32 evidenceHash,uint64 expiresAt)",
  "event ProposalPreconditions(bytes32 indexed changeHash,uint256 expectedStateVersion,uint256 expectedAuthorizationEpoch)",
  "event DecisionRecorded(bytes32 indexed changeHash,uint8 decision,bytes32 indexed decisionHash,uint8 resultingState)",
  "event ProposalExecuted(bytes32 indexed changeHash,address indexed target,bytes32 returnDataHash)",
  "event LiquidationThresholdUpdated(uint16 previousThresholdBps,uint16 newThresholdBps,address indexed caller)",
  "event MarketStateUpdated(uint256 stateVersion)",
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export async function verifyLifecycleReceipt(
  client: SepoliaClient,
  plan: SigningPlan,
  hash: Hex,
  b: BoundRun,
  leg: "propose" | "decision" | "execute",
) {
  const receipt = await verifyMinedTransaction(client, plan, hash, {
      decisionWallet: leg === "decision",
    }),
    i = b.intent;
  if ((await client.getBlockNumber()) < receipt.blockNumber + 1n)
    throw new Error("Two confirmations required");
  const e = {
    address: i.executor,
    abi: EXECUTOR_ABI,
    blockNumber: receipt.blockNumber,
  };
  const m = {
    address: i.target,
    abi: MARKET_ABI,
    blockNumber: receipt.blockNumber,
  };
  const [p, threshold, version] = await Promise.all([
    client.readContract({
      ...e,
      functionName: "proposals",
      args: [b.changeHash],
    }),
    client.readContract({ ...m, functionName: "liquidationThresholdBps" }),
    client.readContract({ ...m, functionName: "stateVersion" }),
  ]);
  if (
    !same(p[0], i.operator) ||
    !same(p[1], i.target) ||
    p[2] !== i.calldata.slice(0, 10) ||
    p[3] !== keccak256(i.calldata) ||
    p[4] !== b.preflightHash ||
    p[6] !== BigInt(i.nonce) ||
    p[7] !== BigInt(i.expectedStateVersion) ||
    p[8] !== BigInt(i.expectedAuthorizationEpoch) ||
    p[9] !== BigInt(i.expiresAt) ||
    p[10] !== ({ propose: 1, decision: 2, execute: 5 } as const)[leg] ||
    (leg === "propose" ? BigInt(p[5]) !== 0n : p[5] !== b.decisionHash) ||
    threshold !==
      (leg === "execute" ? i.proposedValueBps : i.currentValueBps) ||
    version !== BigInt(i.expectedStateVersion) + (leg === "execute" ? 1n : 0n)
  )
    throw new Error("Receipt-block proposal or market state mismatch");
  const logs = parseEventLogs({
    abi: EVENTS,
    logs: receipt.logs.filter((l) => same(l.address, i.executor)),
    strict: true,
  });
  if (leg === "propose") {
    const created = logs.filter((l) => l.eventName === "ProposalCreated"),
      pre = logs.filter((l) => l.eventName === "ProposalPreconditions");
    if (
      created.length !== 1 ||
      pre.length !== 1 ||
      created[0]!.args.changeHash !== b.changeHash ||
      !same(created[0]!.args.operator, i.operator) ||
      !same(created[0]!.args.target, i.target) ||
      created[0]!.args.evidenceHash !== b.preflightHash ||
      created[0]!.args.dataHash !== keccak256(i.calldata) ||
      created[0]!.args.nonce !== BigInt(i.nonce) ||
      created[0]!.args.expiresAt !== BigInt(i.expiresAt) ||
      created[0]!.args.selector !== i.calldata.slice(0, 10) ||
      pre[0]!.args.changeHash !== b.changeHash ||
      pre[0]!.args.expectedStateVersion !== BigInt(i.expectedStateVersion) ||
      pre[0]!.args.expectedAuthorizationEpoch !==
        BigInt(i.expectedAuthorizationEpoch)
    )
      throw new Error("Proposal events mismatch");
  } else if (leg === "decision") {
    const events = logs.filter((l) => l.eventName === "DecisionRecorded");
    if (
      events.length !== 1 ||
      events[0]!.args.changeHash !== b.changeHash ||
      events[0]!.args.decisionHash !== b.decisionHash ||
      events[0]!.args.decision !== 1 ||
      events[0]!.args.resultingState !== 2
    )
      throw new Error("Decision event mismatch");
  } else {
    const events = logs.filter((l) => l.eventName === "ProposalExecuted");
    const marketLogs = parseEventLogs({
      abi: EVENTS,
      logs: receipt.logs.filter((l) => same(l.address, i.target)),
      strict: true,
    });
    const changed = marketLogs.filter(
        (l) => l.eventName === "LiquidationThresholdUpdated",
      ),
      state = marketLogs.filter((l) => l.eventName === "MarketStateUpdated");
    if (
      events.length !== 1 ||
      events[0]!.args.changeHash !== b.changeHash ||
      !same(events[0]!.args.target, i.target) ||
      changed.length !== 1 ||
      changed[0]!.args.previousThresholdBps !== i.currentValueBps ||
      changed[0]!.args.newThresholdBps !== i.proposedValueBps ||
      !same(changed[0]!.args.caller, i.executor) ||
      state.length !== 1 ||
      state[0]!.args.stateVersion !== version
    )
      throw new Error("Execution events mismatch");
  }
  if (
    (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
    receipt.blockHash
  )
    throw new Error("Receipt reorganized during verification");
  return {
    receipt,
    finalState: {
      market: i.target,
      blockNumber: Number(receipt.blockNumber),
      blockHash: receipt.blockHash,
      liquidationThresholdBps: threshold,
      stateVersion: version.toString(),
    },
  };
}
