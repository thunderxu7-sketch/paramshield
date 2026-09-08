import { hashCanonical } from "@paramshield/evidence";
import { validateExecutionResult } from "@paramshield/chainlink-cre/protocol";
import {
  prepareExecutionCall,
  type ExecutionApprovalStore,
  type ReviewedExecutionTarget,
} from "../execution-preflight";
import { readTrustedRun, type CreExecutionRun } from "./cre-execution-runner";
import { createExecutionStatePort, type SepoliaClient } from "./rpc-adapter";
import { validateSigningPlan } from "./transaction-signing";

/** Connects our own CRE run + authenticated review + actual RPC state to the
 * durable Privy signing service. No arbitrary browser result/nonce/fee override.
 * Caller still must configure an exact provider policy on a reviewed v2 wallet. */
export async function prepareRelaySigning(args: {
  run: CreExecutionRun;
  client: SepoliaClient;
  target: ReviewedExecutionTarget;
  approvals: ExecutionApprovalStore;
  now: () => number;
}) {
  const data = readTrustedRun(args.run),
    target = structuredClone(args.target);
  const state = createExecutionStatePort(args.client);
  const bound = validateExecutionResult(data.result, data.request, {
    runId: args.run.runId,
    policyVersion: target.policyVersion,
    now: args.now(),
  });
  const check = () =>
    prepareExecutionCall({
      ...data,
      runId: args.run.runId,
      target,
      state,
      approvals: args.approvals,
      now: args.now,
    });
  const call = await check();
  const [nonce, gas, fees, balance] = await Promise.all([
    args.client.getTransactionCount({
      address: call.from,
      blockTag: "pending",
    }),
    args.client.estimateGas({
      account: call.from,
      to: call.to,
      value: 0n,
      data: call.data,
    }),
    args.client.estimateFeesPerGas({ type: "eip1559" }),
    args.client.getBalance({ address: call.from, blockTag: "pending" }),
  ]);
  const plan = validateSigningPlan({
    chainId: 11155111,
    from: call.from,
    to: call.to,
    value: "0",
    data: call.data,
    nonce,
    gas: ((gas * 120n + 99n) / 100n).toString(),
    maxFeePerGas: fees.maxFeePerGas.toString(),
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
    expiresAt: bound.intent.expiresAt,
  });
  if (balance < BigInt(plan.gas) * BigInt(plan.maxFeePerGas))
    throw new Error(
      "Operator needs sufficient Sepolia test ETH for reviewed gas budget",
    );
  const callBinding = (c: typeof call) =>
    hashCanonical({
      chainId: c.chainId,
      from: c.from,
      to: c.to,
      value: c.value.toString(),
      data: c.data,
      changeHash: c.changeHash,
      preflightHash: c.preflightHash,
      decisionHash: c.decisionHash,
    });
  const revalidate = async () => {
    // The complete freshness check must be LAST, after even a slow nonce read.
    const currentNonce = await args.client.getTransactionCount({
      address: call.from,
      blockTag: "pending",
    });
    if (
      callBinding(await check()) !== callBinding(call) ||
      currentNonce !== plan.nonce
    )
      throw new Error("Execution binding or wallet nonce changed");
  };
  await revalidate();
  return {
    plan,
    revalidate,
    changeHash: call.changeHash,
    preflightHash: call.preflightHash,
    decisionHash: call.decisionHash,
  };
}
