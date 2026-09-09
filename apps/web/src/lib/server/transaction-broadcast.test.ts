import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { keccak256, type Hex } from "viem";
import { DurableStore } from "./durable-store";
import {
  DurableBroadcastService,
  verifyMinedTransaction,
} from "./transaction-broadcast";
import {
  DurableSigningService,
  viemTransaction,
  type SigningPlan,
} from "./transaction-signing";
import { lifecycleData } from "./lifecycle-preflight";
import {
  executionFixture,
  hash as fixedHash,
  operator,
  stranger,
} from "./test-fixtures";
import type { SepoliaClient } from "./rpc-adapter";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-broadcast-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function setup() {
  const f = executionFixture();
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
  const raw = await operator.signTransaction(viemTransaction(plan)),
    hash = keccak256(raw);
  const tx = {
    ...viemTransaction(plan),
    input: plan.data,
    hash,
    from: plan.from,
    blockNumber: 101n,
    blockHash: fixedHash("1"),
  };
  const receipt = {
    status: "success",
    transactionHash: hash,
    from: plan.from,
    to: plan.to,
    blockNumber: 101n,
    blockHash: fixedHash("1"),
  };
  const send = vi.fn(async () => hash),
    wait = vi.fn(async () => receipt);
  const rpc = {
    getTransaction: vi.fn(async () => tx),
    getTransactionReceipt: vi.fn(async () => receipt),
    getChainId: vi.fn(async () => 11155111),
    getBlock: vi.fn(async () => ({ hash: fixedHash("1") })),
    sendRawTransaction: send,
    waitForTransactionReceipt: wait,
  };
  const client = rpc as unknown as SepoliaClient;
  const signing = new DurableSigningService(
    new DurableStore(join(root, "signs")),
    () => f.now,
  );
  const broadcast = new DurableBroadcastService(
    new DurableStore(join(root, "broadcast")),
    signing.store,
    () => f.now,
  );
  await signing.sign("test", plan, { sign: async () => raw }, async () => {});
  return {
    ...f,
    plan,
    raw,
    hash,
    tx,
    receipt,
    send,
    wait,
    rpc,
    client,
    signing,
    broadcast,
  };
}
describe("durable exact transaction broadcast", () => {
  it("persists before sending and never resends on duplicate confirmed requests", async () => {
    const f = await setup();
    f.send.mockImplementationOnce(async () => {
      expect(await f.broadcast.store.read("broadcast-test")).toMatchObject({
        state: "BROADCASTING",
      });
      return f.hash;
    });
    await f.broadcast.send("test", f.plan, f.client, async () => {});
    await f.broadcast.send("test", f.plan, f.client, async () => {});
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.wait).toHaveBeenCalledOnce();
    expect(await f.broadcast.store.read("broadcast-test")).toMatchObject({
      state: "CONFIRMED",
      transactionHash: f.hash,
    });
  });
  it.each(["timeout", "wrong-hash"])(
    "holds %s ambiguity without signing a replacement or resending",
    async (mode) => {
      const f = await setup();
      if (mode === "timeout")
        f.send.mockRejectedValueOnce(new Error("timed out"));
      else f.send.mockResolvedValueOnce(fixedHash("9") as Hex);
      await expect(
        f.broadcast.send("test", f.plan, f.client, async () => {}),
      ).rejects.toThrow("unknown");
      expect(await f.broadcast.store.read("broadcast-test")).toMatchObject({
        state: "UNKNOWN",
      });
      await expect(
        f.broadcast.send("test", f.plan, f.client, async () => {}),
      ).rejects.toThrow("never automatically resend");
      expect(f.send).toHaveBeenCalledOnce();
    },
  );
  it("holds a submitted transaction when receipt waiting fails", async () => {
    const f = await setup();
    f.wait.mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(
      f.broadcast.send("test", f.plan, f.client, async () => {}),
    ).rejects.toThrow("unavailable");
    expect(await f.broadcast.store.read("broadcast-test")).toMatchObject({
      state: "SUBMITTED",
    });
    await expect(
      f.broadcast.send("test", f.plan, f.client, async () => {}),
    ).rejects.toThrow("recovery");
    expect(f.send).toHaveBeenCalledOnce();
  });
  it("does not send if the final authorization check fails", async () => {
    const f = await setup();
    await expect(
      f.broadcast.send("test", f.plan, f.client, async () => {
        throw new Error("expired review");
      }),
    ).rejects.toThrow("expired");
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    { nonce: 1 },
    { value: 1n },
    { gas: 300001n },
    { maxFeePerGas: 2000000001n },
    { maxPriorityFeePerGas: 1n },
    { to: stranger.address },
    { from: stranger.address },
    { chainId: 1 },
    { input: "0x12345678" },
    { blockHash: fixedHash("9") },
    { accessList: [{ address: stranger.address, storageKeys: [] }] },
  ])("rejects mutated mined envelope %#", async (mutation) => {
    const f = await setup();
    Object.assign(f.tx, mutation);
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.hash),
    ).rejects.toThrow("match");
  });
  it("rejects reverts and reorganized receipts", async () => {
    const f = await setup();
    f.receipt.status = "reverted";
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.hash),
    ).rejects.toThrow("match");
    f.receipt.status = "success";
    f.rpc.getBlock.mockResolvedValueOnce({ hash: fixedHash("9") });
    await expect(
      verifyMinedTransaction(f.client, f.plan, f.hash),
    ).rejects.toThrow("reorg");
  });
});
