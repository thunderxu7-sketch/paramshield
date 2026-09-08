import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { encodeFunctionData, type TransactionSerializableEIP1559 } from "viem";
import { DurableStore } from "./durable-store";
import {
  DurableSigningService,
  verifySignedTransaction,
  viemTransaction,
  type SigningPlan,
} from "./transaction-signing";
import {
  exactExecutionPolicy,
  executionPolicyFingerprint,
} from "./execution-policy";
import { EXECUTOR_ABI } from "./rpc-adapter";
import { readTrustedRun, type CreExecutionRun } from "./cre-execution-runner";
import { executionFixture, operator, stranger } from "./test-fixtures";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "paramshield-sign-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
function setup() {
  const f = executionFixture(),
    i = f.bound.intent;
  const data = encodeFunctionData({
    abi: EXECUTOR_ABI,
    functionName: "execute",
    args: [
      {
        chainId: 11155111n,
        target: i.target,
        value: 0n,
        data: i.calldata,
        nonce: BigInt(i.nonce),
        evidenceHash: i.evidenceHash,
        expectedStateVersion: 7n,
        expectedAuthorizationEpoch: 2n,
        expiresAt: BigInt(i.expiresAt),
      },
    ],
  });
  const plan: SigningPlan = {
    chainId: 11155111,
    from: operator.address,
    to: i.executor,
    value: "0",
    data,
    nonce: 0,
    gas: "180000",
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000000",
    expiresAt: i.expiresAt,
  };
  const time = { now: f.now },
    disk = new DurableStore(root);
  const signer = {
    sign: vi.fn(async (p: SigningPlan) =>
      operator.signTransaction(viemTransaction(p)),
    ),
  };
  const revalidate = vi.fn(async () => {});
  return {
    ...f,
    plan,
    time,
    disk,
    signer,
    revalidate,
    service: new DurableSigningService(disk, () => time.now, 1000),
  };
}
describe("exact EIP-1559 transaction verification", () => {
  it("recovers the planned signer and checks the exact payload", async () => {
    const f = setup();
    expect(
      await verifySignedTransaction(await f.signer.sign(f.plan), f.plan),
    ).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it.each([
    ["chain", { chainId: 1 }],
    ["target", { to: stranger.address }],
    ["value", { value: 1n }],
    ["data", { data: "0x12345678" }],
    ["nonce", { nonce: 1 }],
    ["gas", { gas: 180001n }],
    ["max fee", { maxFeePerGas: 3000000000n }],
    ["priority fee", { maxPriorityFeePerGas: 1n }],
    [
      "access list",
      { accessList: [{ address: stranger.address, storageKeys: [] }] },
    ],
  ])("rejects signed %s mutations", async (_name, mutation) => {
    const f = setup();
    const raw = await operator.signTransaction({
      ...viemTransaction(f.plan),
      ...mutation,
    } as TransactionSerializableEIP1559);
    await expect(verifySignedTransaction(raw, f.plan)).rejects.toThrow("match");
  });
  it("rejects the wrong recovered signer and a legacy transaction", async () => {
    const f = setup();
    await expect(
      verifySignedTransaction(
        await stranger.signTransaction(viemTransaction(f.plan)),
        f.plan,
      ),
    ).rejects.toThrow("match");
    const raw = await operator.signTransaction({
      type: "legacy",
      chainId: 11155111,
      to: f.plan.to,
      value: 0n,
      data: f.plan.data,
      nonce: 0,
      gas: 180000n,
      gasPrice: 2000000000n,
    });
    await expect(verifySignedTransaction(raw, f.plan)).rejects.toThrow("match");
  });
  it("rejects a fabricated browser CRE result capability", () => {
    expect(() =>
      readTrustedRun({ runId: "browser", verdict: "ALLOW" } as CreExecutionRun),
    ).toThrow("trusted runner");
  });
  it("constructs an exact tuple policy and rejects noncanonical calldata", () => {
    const f = setup(),
      policy = exactExecutionPolicy(f.plan.to, f.plan.data);
    expect(policy.rules).toHaveLength(1);
    const conditions = policy.rules![0]!.conditions;
    expect(conditions).toHaveLength(13);
    expect(conditions).toContainEqual(
      expect.objectContaining({
        field: "execute.intent.evidenceHash",
        value: f.bound.preflightHash,
      }),
    );
    expect(conditions).toContainEqual(
      expect.objectContaining({
        field: "execute.intent.expectedStateVersion",
        value: "7",
      }),
    );
    expect(() => exactExecutionPolicy(f.plan.to, `${f.plan.data}00`)).toThrow(
      "Canonical",
    );
  });
  it("accepts only provider address casing normalization, not changed policy rules", () => {
    const f = setup(),
      policy = exactExecutionPolicy(f.plan.to, f.plan.data),
      changed = structuredClone(policy);
    const c = changed.rules![0]!.conditions.find(
      (c) => c.field_source === "ethereum_transaction" && c.field === "to",
    )!;
    if ("value" in c && typeof c.value === "string")
      c.value = "0x" + c.value.slice(2).toUpperCase();
    expect(executionPolicyFingerprint(changed)).toBe(
      executionPolicyFingerprint(policy),
    );
    changed.rules![0]!.conditions.pop();
    expect(executionPolicyFingerprint(changed)).not.toBe(
      executionPolicyFingerprint(policy),
    );
    changed.rules![0]!.method = "*";
    expect(executionPolicyFingerprint(changed)).not.toBe(
      executionPolicyFingerprint(policy),
    );
  });
});
describe("durable sign-only service", () => {
  it("persists before signing, survives restart and returns only metadata on duplicate", async () => {
    const f = setup();
    f.signer.sign.mockImplementationOnce(async (p) => {
      expect(await f.disk.read("job-one")).toMatchObject({ state: "SIGNING" });
      return operator.signTransaction(viemTransaction(p));
    });
    const a = await f.service.sign("one", f.plan, f.signer, f.revalidate);
    const b = await new DurableSigningService(
      new DurableStore(root),
      () => f.now,
    ).sign("one", f.plan, f.signer, f.revalidate);
    expect(a).toEqual({
      state: "SIGNED",
      transactionHash: b.transactionHash,
      reused: false,
    });
    expect(b.reused).toBe(true);
    expect(f.signer.sign).toHaveBeenCalledOnce();
    expect(f.revalidate).toHaveBeenCalledTimes(3);
    expect(Object.keys(b)).not.toContain("signedTransaction");
    await expect(
      f.service.sign(
        "one",
        { ...f.plan, gas: "200000" },
        f.signer,
        f.revalidate,
      ),
    ).rejects.toThrow("binding mismatch");
    await expect(
      f.service.sign("two", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("nonce already reserved");
  });
  it("holds timeout ambiguity across retries and different job IDs", async () => {
    const f = setup(),
      s = new DurableSigningService(f.disk, () => f.now, 20);
    f.signer.sign.mockImplementationOnce(() => new Promise(() => {}));
    await expect(s.sign("one", f.plan, f.signer, f.revalidate)).rejects.toThrow(
      "no retry or broadcast",
    );
    expect(await f.disk.read("job-one")).toMatchObject({ state: "UNKNOWN" });
    await expect(s.sign("one", f.plan, f.signer, f.revalidate)).rejects.toThrow(
      "manual recovery",
    );
    await expect(s.sign("two", f.plan, f.signer, f.revalidate)).rejects.toThrow(
      "nonce already reserved",
    );
    expect(f.signer.sign).toHaveBeenCalledOnce();
  });
  it("does not sign on missing approval, expired data or excessive fees", async () => {
    const f = setup();
    f.revalidate.mockRejectedValueOnce(new Error("Missing approval"));
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("Missing approval");
    await expect(
      f.service.sign(
        "one",
        { ...f.plan, maxFeePerGas: "50000000001" },
        f.signer,
        f.revalidate,
      ),
    ).rejects.toThrow("budget");
    f.time.now = f.plan.expiresAt;
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("expired");
    expect(f.signer.sign).not.toHaveBeenCalled();
  });
  it("quarantines a signature when state/approval changes while the provider runs", async () => {
    const f = setup();
    f.revalidate
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Epoch changed"));
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("no retry");
    expect(await f.disk.read("job-one")).toMatchObject({
      state: "QUARANTINED",
    });
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("manual recovery");
  });
  it("quarantines expiry during provider latency", async () => {
    const f = setup();
    f.signer.sign.mockImplementationOnce(async (p) => {
      f.time.now = p.expiresAt;
      return operator.signTransaction(viemTransaction(p));
    });
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("no retry");
    expect(await f.disk.read("job-one")).toMatchObject({
      state: "QUARANTINED",
    });
  });
  it("never accepts a mismatched provider signature or signs again after failure", async () => {
    const f = setup();
    f.signer.sign.mockImplementationOnce(async (p) =>
      stranger.signTransaction(viemTransaction(p)),
    );
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("no retry");
    expect(await f.disk.read("job-one")).toMatchObject({ state: "UNKNOWN" });
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("manual recovery");
    expect(f.signer.sign).toHaveBeenCalledOnce();
  });
  it("blocks a second request while the same job is in flight", async () => {
    const f = setup();
    let release: () => void = () => {},
      started: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
        started = resolve;
      }),
      waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
    f.signer.sign.mockImplementationOnce(async (p) => {
      started();
      await waiting;
      return operator.signTransaction(viemTransaction(p));
    });
    const first = f.service.sign("one", f.plan, f.signer, f.revalidate);
    await ready;
    await expect(
      f.service.sign("one", f.plan, f.signer, f.revalidate),
    ).rejects.toThrow("locked");
    release();
    await first;
    expect(f.signer.sign).toHaveBeenCalledOnce();
  });
});
