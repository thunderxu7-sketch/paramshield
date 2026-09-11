import { MinedTransactionValidationError } from "./decision-7702";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConsoleService, safeConsoleError } from "./console-service";
import { DurableStore } from "./durable-store";
import { verifyLifecycleReceipt } from "./lifecycle-receipt";

// Isolate the receipt verifier exercised by the Anvil integration harness. These
// tests check recovery routing/persistence, not fabricate a chain confirmation.
vi.mock("./lifecycle-receipt", () => ({
  verifyLifecycleReceipt: vi.fn(async () => ({})),
}));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-console-journal-"));
  vi.clearAllMocks();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const id = "12345678-abcd-4abc-8abc-123456789012";
const hash = `0x${"ab".repeat(32)}`;
async function setup(stage = "DECIDED") {
  const service = Object.create(ConsoleService.prototype) as ConsoleService;
  const disk = new DurableStore(root);
  const remote = vi.fn(async () => {
    throw new Error("external service unavailable");
  });
  const sign = vi.fn(),
    send = vi.fn();
  Object.defineProperties(service, {
    disk: { value: disk },
    flows: { value: new Map() },
    c: {
      value: {
        target: {
          operator: "operator",
          market: "market",
          executor: "executor",
          decisionAuthority: "authority",
        },
        graphDeployment: "graph",
        now: () => 300,
        client: { getBalance: remote },
        live: remote,
      },
    },
    control: { value: { assertPolicy: remote, sign } },
    broadcast: { value: { send } },
    admin: { value: "admin" },
    reviewer: { value: "private-reviewer" },
  });
  const record = {
    view: {
      id,
      stage,
      active: true,
      createdAt: 100,
      freshUntil: 200,
      proposedValueBps: 7942,
      timeline: [],
      revision: 5,
    },
    bound: { privateData: "not-a-public-plan" },
    plans: { decision: { privatePlan: "not-a-public-plan" } },
    hashes: { decision: hash },
  };
  await disk.write(`flow-${id}`, record);
  await disk.write("index", [id]);
  return { service, disk, remote, sign, send, record };
}
describe("journal independent of live providers", () => {
  it("explains unavailable historical RPC state without claiming the transaction failed or leaking details", () => {
    const message = safeConsoleError(
      new Error("historical state private-provider-detail is not available"),
    );
    expect(message).toContain("原交易和已保存进度仍保留");
    expect(message).toContain("不要重发");
    expect(message).not.toContain("private-provider-detail");
  });
  it("restores saved progress with RPC/Privy down and without rehydrating owned CRE trust", async () => {
    const f = await setup("PROPOSED");
    const before = await f.disk.read(`flow-${id}`);
    const journal = await f.service.journal();
    expect(f.remote).not.toHaveBeenCalled();
    expect(journal.history[0]).toMatchObject({
      id,
      stage: "PROPOSED",
      active: false,
      transactions: { decision: hash },
    });
    expect(JSON.stringify(journal.history)).not.toContain("not-a-public-plan");
    expect(await f.disk.read(`flow-${id}`)).toEqual(before);
    await expect(f.service.status()).rejects.toThrow(
      "external service unavailable",
    );
    expect((await f.service.journal()).history[0]!.stage).toBe("PROPOSED");
  });
  it("projects hashes from legacy records without needing to rewrite private evidence", async () => {
    const f = await setup();
    const restored = await f.service.flow(id);
    expect(restored.view.transactions?.decision).toBe(hash);
    expect(restored.view.preparedLegs).toEqual(["decision"]);
    expect(restored.run).toBeUndefined();
    expect(await f.disk.read(`flow-${id}`)).toEqual(f.record);
  });
});
describe("read-only receipt recheck", () => {
  it("rechecks a completed matching leg after expiry, increments revision, and does not sign or send", async () => {
    const f = await setup();
    const result = await f.service.recover(id, "decision");
    expect(verifyLifecycleReceipt).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      stage: "DECIDED",
      active: false,
      revision: 6,
      freshUntil: 200,
      transactions: { decision: hash },
    });
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.service.journal()).history[0]).toEqual(result);
  });
  it("recovers pending decisions after expiry, preserving plan/hash and without renewing authorization", async () => {
    const f = await setup("DECISION_PENDING");
    const result = await f.service.recover(id, "decision");
    expect(result.stage).toBe("DECIDED");
    expect(result.active).toBe(false);
    expect(result.freshUntil).toBe(200);
    const saved = (await f.disk.read(`flow-${id}`)) as typeof f.record;
    expect(saved.bound).toEqual(f.record.bound);
    expect(saved.plans).toEqual(f.record.plans);
    expect(saved.hashes).toEqual(f.record.hashes);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("keeps the pending hash on format errors, then clears only the current error after read-only recovery", async () => {
    const f = await setup("DECISION_PENDING");
    vi.mocked(verifyLifecycleReceipt).mockRejectedValueOnce(
      new MinedTransactionValidationError("ENVELOPE_MISMATCH"),
    );
    const failed = await f.service.recover(id, "decision");
    expect(failed.stage).toBe("DECISION_PENDING");
    expect(failed.transactions?.decision).toBe(hash);
    expect(failed.error).toContain("钱包交易格式或执行内容");
    const recovered = await f.service.recover(id, "decision");
    expect(recovered.stage).toBe("DECIDED");
    expect(recovered.error).toBeUndefined();
    expect(recovered.freshUntil).toBe(200);
    expect(recovered.transactions?.decision).toBe(hash);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("does not downgrade a later stage by rechecking an earlier leg", async () => {
    const f = await setup("EXECUTED");
    const result = await f.service.recover(id, "decision");
    expect(result.stage).toBe("EXECUTED");
    expect(result.error).toBeTruthy();
    expect(verifyLifecycleReceipt).not.toHaveBeenCalled();
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});

describe("explicit expired-flow retirement", () => {
  async function retireFixture(stage = "PROPOSED") {
    const f = await setup(stage);
    const block = { number: 50, timestamp: 300, hash: hash as `0x${string}` };
    const record = {
      ...f.record,
      bound: {
        changeHash: hash,
        decisionHash: hash,
        intent: { expiresAt: 200 },
      },
      plans: { ...(stage === "PROPOSED" ? { propose: {} } : { decision: {} }) },
      hashes: {
        ...(stage === "PROPOSED" ? { propose: hash } : { decision: hash }),
      },
    };
    await f.disk.write(`flow-${id}`, record);
    Object.assign(f.service.c, {
      live: async () => ({
        block,
        proposal: { state: stage === "PROPOSED" ? 1 : 2, decisionHash: hash },
      }),
      state: { canonicalBlockHash: async () => block.hash },
    });
    return { ...f, block, record };
  }
  it("preserves the confirmed stage and hash, and never signs, sends or clears nonce records", async () => {
    const f = await retireFixture();
    const view = await f.service.retireExpired(id);
    expect(view).toMatchObject({
      stage: "PROPOSED",
      active: false,
      retired: { checkedAt: 300, blockNumber: 50 },
    });
    const saved = (await f.disk.read(`flow-${id}`)) as typeof f.record;
    expect(saved.bound).toEqual(f.record.bound);
    expect(saved.hashes).toEqual(f.record.hashes);
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(verifyLifecycleReceipt).toHaveBeenCalledOnce();
    await f.service.retireExpired(id);
    expect(verifyLifecycleReceipt).toHaveBeenCalledOnce();
  });
  it("does not mistake a 120-second data deadline for actual on-chain intent expiry", async () => {
    const f = await retireFixture();
    f.block.timestamp = 200;
    expect((await f.service.retireExpired(id)).retired).toBeUndefined();
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each(["PROPOSING", "DECISION_READY", "DECISION_PENDING", "EXECUTING"])(
    "cannot retire unknown/issued %s requests",
    async (stage) => {
      const f = await retireFixture(stage);
      expect((await f.service.retireExpired(id)).retired).toBeUndefined();
      expect(verifyLifecycleReceipt).not.toHaveBeenCalled();
    },
  );
  it("does not retire when receipt verification is unavailable", async () => {
    const f = await retireFixture();
    vi.mocked(verifyLifecycleReceipt).mockRejectedValueOnce(
      new Error("historical state is not available"),
    );
    expect((await f.service.retireExpired(id)).retired).toBeUndefined();
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
  it("blocks direct-API analysis over a pending transaction, independent of the UI", async () => {
    const f = await retireFixture();
    await expect(
      f.service.analyze("22345678-abcd-4abc-8abc-123456789012", 7942),
    ).rejects.toThrow("unfinished flow");
    expect(
      await f.disk.read("flow-22345678-abcd-4abc-8abc-123456789012"),
    ).toBeNull();
    expect(f.sign).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });
});
