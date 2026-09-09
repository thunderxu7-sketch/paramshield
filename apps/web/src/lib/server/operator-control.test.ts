import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PrivyClient } from "@privy-io/node";
import { OperatorControl } from "./operator-control";
import { DurableStore } from "./durable-store";
import {
  DurableSigningService,
  viemTransaction,
  type SigningPlan,
} from "./transaction-signing";
import {
  exactIntentPolicy,
  executionPolicyFingerprint,
} from "./execution-policy";
import { executionFixture, operator } from "./test-fixtures";
import { lifecycleData } from "./lifecycle-preflight";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-control-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function setup() {
  const f = executionFixture();
  const resource = {
    walletId: "synthetic-wallet",
    policyId: "synthetic-policy",
    address: operator.address,
    assignedExecutor: f.bound.intent.executor,
    assignedChainId: 11155111,
  };
  type Policy = OperatorControl["lock"];
  const lock: Policy = {
    version: "1.0",
    name: "Test DENY",
    chain_type: "ethereum",
    rules: [{ name: "DENY", method: "*", action: "DENY", conditions: [] }],
  };
  let policy = structuredClone(lock);
  const plan: SigningPlan = {
    chainId: 11155111,
    from: operator.address,
    to: f.bound.intent.executor,
    data: lifecycleData(f.bound, "propose"),
    value: "0",
    nonce: 0,
    gas: "300000",
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000",
    expiresAt: f.bound.intent.expiresAt,
  };
  const wallet = {
    address: operator.address,
    policy_ids: [resource.policyId],
    additional_signers: [] as unknown[],
  };
  const update = vi.fn(
    async (_id: string, input: { rules: Policy["rules"] }) => {
      policy = { ...policy, rules: input.rules! };
      return policy;
    },
  );
  const signTransaction = vi.fn(async () => ({
    signed_transaction: await operator.signTransaction(viemTransaction(plan)),
  }));
  const client = {
    policies: () => ({ get: async () => structuredClone(policy), update }),
    wallets: () => ({
      get: async () => wallet,
      ethereum: () => ({ signTransaction }),
    }),
  } as unknown as PrivyClient;
  const control = new OperatorControl(
    client,
    resource,
    lock,
    new DurableStore(join(root, "control")),
  );
  const signing = new DurableSigningService(
    new DurableStore(join(root, "signing")),
    () => f.now,
  );
  return {
    ...f,
    plan,
    control,
    signing,
    update,
    signTransaction,
    wallet,
    lock,
    getPolicy: () => policy,
    setPolicy: (p: Policy) => {
      policy = p;
    },
  };
}
describe("exact intent activation and DENY restoration (mocked provider)", () => {
  it("supports exact propose tuple only; never substitutes execute or broad raw signing", async () => {
    const f = setup(),
      policy = exactIntentPolicy(f.plan.to, f.plan.data, "propose");
    expect(policy.rules![0]!.conditions).toHaveLength(13);
    expect(policy.rules![0]!.conditions).toContainEqual(
      expect.objectContaining({
        field: "propose.intent.evidenceHash",
        value: f.bound.preflightHash,
      }),
    );
    expect(() => exactIntentPolicy(f.plan.to, f.plan.data, "execute")).toThrow(
      "Canonical",
    );
    const result = await f.control.sign(
      "test",
      f.plan,
      "propose",
      f.signing,
      async () => {},
    );
    expect(result.state).toBe("SIGNED");
    expect(f.signTransaction).toHaveBeenCalledOnce();
    expect(f.update).toHaveBeenCalledTimes(2);
    expect(executionPolicyFingerprint(f.getPolicy())).toBe(
      executionPolicyFingerprint(f.lock),
    );
    expect(await f.control.store.read("interrupted")).toBeNull();
  });
  it("restores DENY even when signing fails; the nonce stays held", async () => {
    const f = setup();
    f.signTransaction.mockRejectedValueOnce(new Error("provider failure"));
    await expect(
      f.control.sign("test", f.plan, "propose", f.signing, async () => {}),
    ).rejects.toThrow("no retry");
    expect(executionPolicyFingerprint(f.getPolicy())).toBe(
      executionPolicyFingerprint(f.lock),
    );
    expect(await f.signing.store.read("job-test")).toMatchObject({
      state: "UNKNOWN",
    });
    expect(f.update).toHaveBeenCalledTimes(2);
  });
  it("does not activate a policy on missing review or an extra signer", async () => {
    const f = setup();
    await expect(
      f.control.sign("test", f.plan, "propose", f.signing, async () => {
        throw new Error("review missing");
      }),
    ).rejects.toThrow("review missing");
    f.wallet.additional_signers.push({ signer_id: "untrusted" });
    await expect(
      f.control.sign("test", f.plan, "propose", f.signing, async () => {}),
    ).rejects.toThrow("binding");
    expect(f.update).not.toHaveBeenCalled();
    expect(f.signTransaction).not.toHaveBeenCalled();
  });
  it("preserves an unexpected external policy and leaves recovery evidence", async () => {
    const f = setup();
    f.signTransaction.mockImplementationOnce(async () => {
      const foreign = structuredClone(f.lock);
      foreign.rules = [];
      f.setPolicy(foreign);
      return {
        signed_transaction: await operator.signTransaction(
          viemTransaction(f.plan),
        ),
      };
    });
    await expect(
      f.control.sign("test", f.plan, "propose", f.signing, async () => {}),
    ).rejects.toThrow("Unexpected policy mutation");
    expect(f.update).toHaveBeenCalledTimes(1);
    expect(await f.control.store.read("interrupted")).not.toBeNull();
    await expect(
      f.control.sign("test2", f.plan, "propose", f.signing, async () => {}),
    ).rejects.toThrow("manual recovery");
  });
  it("restores the exact policy after an ambiguous activation response", async () => {
    const f = setup(),
      original = f.update.getMockImplementation()!;
    f.update.mockImplementationOnce(async (id, input) => {
      await original(id, input);
      throw new Error("update timeout");
    });
    await expect(
      f.control.sign("test", f.plan, "propose", f.signing, async () => {}),
    ).rejects.toThrow("update timeout");
    expect(executionPolicyFingerprint(f.getPolicy())).toBe(
      executionPolicyFingerprint(f.lock),
    );
    expect(f.signTransaction).not.toHaveBeenCalled();
  });
});
