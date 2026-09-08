import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DurableStore } from "./durable-store";
import { SignedReviewStore, reviewTypedData } from "./review-store";
import {
  executionFixture,
  reviewer,
  operator,
  stranger,
  hash,
} from "./test-fixtures";
import { hashCanonical } from "@paramshield/evidence";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "paramshield-store-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("single-host durable storage", () => {
  it("survives a new instance with private atomic files and bounded keys/records", async () => {
    const a = new DurableStore(root);
    await a.write("job", { stage: "SIGNING" });
    const b = new DurableStore(root);
    expect(await b.read("job")).toEqual({ stage: "SIGNING" });
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "job.json"))).mode & 0o777).toBe(0o600);
    expect(await b.read("missing")).toBeNull();
    await expect(a.write("../escape", {})).rejects.toThrow("key");
    await expect(a.write("large", "x".repeat(1_000_001))).rejects.toThrow(
      "oversized",
    );
    expect(await readdir(root)).toEqual(["job.json"]);
  });
  it("rejects concurrent writers and never guesses stale lock recovery", async () => {
    const a = new DurableStore(root),
      b = new DurableStore(root);
    await a.exclusive("job", async () => {
      await expect(b.exclusive("job", async () => {})).rejects.toThrow(
        "locked",
      );
      await a.write("job", { stage: "UNKNOWN" });
    });
    await b.exclusive("job", async () => {
      expect(await b.read("job")).toEqual({ stage: "UNKNOWN" });
    });
    await expect(
      a.exclusive("job", async () => {
        throw new Error("test");
      }),
    ).rejects.toThrow("test");
    expect(await readdir(root)).toEqual(["job.json"]);
  });
  it("fails closed on corrupt persistent data", async () => {
    await writeFile(join(root, "job.json"), "{broken");
    await expect(new DurableStore(root).read("job")).rejects.toThrow("Corrupt");
  });
});
describe("authenticated EIP-712 human reviews", () => {
  function setup() {
    const f = executionFixture(),
      time = { now: f.now };
    const disk = new DurableStore(root),
      store = new SignedReviewStore(disk, [reviewer.address], () => time.now);
    const typed = reviewTypedData(f.bound.preflight, f.bound.decision, f.now);
    return { ...f, disk, store, time, typed };
  }
  it("authenticates, persists and reloads the exact independently signed decision", async () => {
    const f = setup(),
      sig = await reviewer.signTypedData(f.typed);
    const a = await f.store.record(
      f.bound.preflight,
      f.bound.decision,
      f.now,
      sig,
    );
    const reload = new SignedReviewStore(
      new DurableStore(root),
      [reviewer.address],
      () => f.now,
    );
    expect(await reload.get(f.bound.decisionHash)).toEqual(a);
    expect(a.reviewer).toBe(reviewer.address);
    expect(
      await f.store.record(f.bound.preflight, f.bound.decision, f.now, sig),
    ).toEqual(a);
    expect(await f.store.get(hash("0"))).toBeNull();
  });
  it("rejects outsiders, operator self-review and altered domains", async () => {
    const f = setup();
    for (const sig of [
      await stranger.signTypedData(f.typed),
      await reviewer.signTypedData({
        ...f.typed,
        domain: { ...f.typed.domain, chainId: 1 },
      }),
    ])
      await expect(
        f.store.record(f.bound.preflight, f.bound.decision, f.now, sig),
      ).rejects.toThrow("Unauthorized");
    const self = new SignedReviewStore(f.disk, [operator.address], () => f.now);
    await expect(
      self.record(
        f.bound.preflight,
        f.bound.decision,
        f.now,
        await operator.signTypedData(f.typed),
      ),
    ).rejects.toThrow("self-review");
  });
  it("rejects replayed/tampered records even with a recomputed storage digest", async () => {
    const f = setup();
    await f.store.record(
      f.bound.preflight,
      f.bound.decision,
      f.now,
      await reviewer.signTypedData(f.typed),
    );
    const record = (await f.disk.read(f.bound.decisionHash)) as Record<
      string,
      unknown
    >;
    await f.disk.write(hash("0"), record);
    await expect(f.store.get(hash("0"))).rejects.toThrow("lookup mismatch");
    const payload = { ...record };
    delete payload.digest;
    const altered = { ...payload, approvedAt: f.now - 1 };
    await f.disk.write(f.bound.decisionHash, {
      ...altered,
      digest: hashCanonical(altered),
    });
    await expect(f.store.get(f.bound.decisionHash)).rejects.toThrow(
      "Unauthorized",
    );
  });
  it("rejects conflicting overwrite, future reviews and expired reviews after restart", async () => {
    const f = setup();
    await f.store.record(
      f.bound.preflight,
      f.bound.decision,
      f.now,
      await reviewer.signTypedData(f.typed),
    );
    const next = reviewTypedData(
        f.bound.preflight,
        f.bound.decision,
        f.now + 1,
      ),
      sig = await reviewer.signTypedData(next);
    await expect(
      f.store.record(f.bound.preflight, f.bound.decision, f.now + 1, sig),
    ).rejects.toThrow("Unauthorized");
    f.time.now++;
    await expect(
      f.store.record(f.bound.preflight, f.bound.decision, f.now + 1, sig),
    ).rejects.toThrow("overwritten");
    f.time.now = f.bound.intent.expiresAt;
    await expect(f.store.get(f.bound.decisionHash)).rejects.toThrow("expired");
  });
});
