import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  signTypedData as signMetaMaskTypedData,
  SignTypedDataVersion,
  TypedDataUtils,
} from "@metamask/eth-sig-util";
import { hashTypedData, type Hex } from "viem";
import { ConsoleService, safeConsoleError } from "./console-service";
import { DurableStore } from "./durable-store";
import { SignedReviewStore, reviewTypedData } from "./review-store";
import type { CreExecutionRun } from "./cre-execution-runner";
import { executionFixture, reviewer, stranger } from "./test-fixtures";

const lifecycle = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("./lifecycle-preflight", async (original) => ({
  ...(await original<typeof import("./lifecycle-preflight")>()),
  checkLifecycle: lifecycle.check,
}));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-review-diagnostics-"));
  lifecycle.check.mockReset();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("review outcome diagnostics with mocked lifecycle RPC and test-only keys", () => {
  function setup() {
    const fixture = executionFixture(),
      time = { now: fixture.now },
      id = "12345678-abcd-4abc-8abc-123456789012";
    const disk = new DurableStore(join(root, "flows")),
      reviewDisk = new DurableStore(join(root, "reviews")),
      reviews = new SignedReviewStore(
        reviewDisk,
        [reviewer.address],
        () => time.now,
      );
    const flow: Awaited<ReturnType<ConsoleService["flow"]>> = {
      view: {
        id,
        stage: "ALLOW",
        active: true,
        createdAt: fixture.now,
        proposedValueBps: fixture.bound.intent.proposedValueBps,
        freshUntil: fixture.now + 120,
        timeline: [],
      },
      // A mock boundary, never a real owned CRE authorization capability.
      run: {} as CreExecutionRun,
      approvedAt: fixture.now,
      plans: {},
      hashes: {},
    };
    const service = Object.create(ConsoleService.prototype) as ConsoleService;
    Object.defineProperties(service, {
      c: { value: { now: () => time.now } },
      disk: { value: disk },
      reviews: { value: reviews },
      reviewer: { value: reviewer.address },
      flows: { value: new Map([[id, flow]]) },
    });
    lifecycle.check.mockResolvedValue(fixture.bound);
    const typed = reviewTypedData(
      fixture.bound.preflight,
      fixture.bound.decision,
      fixture.now,
    );
    return { ...fixture, id, time, flow, disk, reviewDisk, service, typed };
  }

  it("does not misreport a fresh wrong-signer signature as expiration or store it as approval", async () => {
    const f = setup(),
      sig = await stranger.signTypedData(f.typed);
    const error = await f.service.approve(f.id, sig).catch((e) => e);
    expect(error).toMatchObject({ code: "REVIEW_SIGNER_MISMATCH" });
    expect(safeConsoleError(error)).toContain("不是数据倒计时到期");
    expect(f.flow.view.stage).toBe("ALLOW");
    expect(f.flow.view.lastReviewAttempt).toMatchObject({
      phase: "submit",
      outcome: "REJECTED",
      code: "REVIEW_SIGNER_MISMATCH",
      secondsRemaining: 120,
    });
    expect(await f.reviewDisk.read(f.bound.decisionHash)).toBeNull();
    const record = await f.disk.read(`flow-${f.id}`);
    expect(JSON.stringify(record)).not.toContain(sig);
    expect(record).toMatchObject({
      view: { stage: "ALLOW", lastReviewAttempt: { outcome: "REJECTED" } },
    });
  });

  it("marks a verified test-key signature accepted only after durable review authentication", async () => {
    const f = setup();
    await f.service.approve(f.id, await reviewer.signTypedData(f.typed));
    expect(f.flow.view.stage).toBe("REVIEWED");
    expect(f.flow.view.lastReviewAttempt).toMatchObject({
      phase: "submit",
      outcome: "ACCEPTED",
      code: "ACCEPTED",
    });
    expect(await f.reviewDisk.read(f.bound.decisionHash)).not.toBeNull();
  });

  it("matches MetaMask V4 hashing and accepts its signature over the exact JSON wire payload", async () => {
    const f = setup(),
      payload = await f.service.reviewPayload(f.id);
    const walletDigest = `0x${TypedDataUtils.eip712Hash(
      payload.typedData,
      SignTypedDataVersion.V4,
    ).toString("hex")}`;
    expect(walletDigest).toBe(hashTypedData(f.typed));
    expect(payload.typedData.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
    expect(payload.typedData.message.approvedAt).toBe(String(f.now));
    // The same public, trivial test-only key used by the fixture reviewer.
    // Never a browser wallet key, real human review or live authorization.
    const signature = signMetaMaskTypedData({
      privateKey: Buffer.from("a".repeat(64), "hex"),
      data: payload.typedData,
      version: SignTypedDataVersion.V4,
    }) as Hex;
    await f.service.approve(f.id, signature);
    expect(f.flow.view.stage).toBe("REVIEWED");
    expect(f.flow.view.lastReviewAttempt?.outcome).toBe("ACCEPTED");
  });

  it("reproduces and rejects the legacy missing-domain wallet signature, even from the correct test key", async () => {
    const f = setup(),
      payload = await f.service.reviewPayload(f.id);
    delete payload.typedData.types.EIP712Domain;
    const signature = signMetaMaskTypedData({
      privateKey: Buffer.from("a".repeat(64), "hex"),
      data: payload.typedData,
      version: SignTypedDataVersion.V4,
    }) as Hex;
    await expect(f.service.approve(f.id, signature)).rejects.toMatchObject({
      code: "REVIEW_SIGNER_MISMATCH",
    });
    expect(await f.reviewDisk.read(f.bound.decisionHash)).toBeNull();
    expect(f.flow.view.stage).toBe("ALLOW");
  });

  it("rejects MetaMask signatures for a different chain or verifying contract", async () => {
    const f = setup();
    for (const domainPatch of [
      { chainId: 1 },
      { verifyingContract: `0x${"3".repeat(40)}` },
    ]) {
      const payload = await f.service.reviewPayload(f.id);
      Object.assign(payload.typedData.domain, domainPatch);
      const signature = signMetaMaskTypedData({
        privateKey: Buffer.from("a".repeat(64), "hex"),
        data: payload.typedData,
        version: SignTypedDataVersion.V4,
      }) as Hex;
      await expect(f.service.approve(f.id, signature)).rejects.toMatchObject({
        code: "REVIEW_SIGNER_MISMATCH",
      });
    }
    expect(await f.reviewDisk.read(f.bound.decisionHash)).toBeNull();
  });

  it("records a time-window crossing during live revalidation without accepting the signature", async () => {
    const f = setup();
    lifecycle.check.mockImplementation(async () => {
      f.time.now += 130;
      throw new Error("Stale or future snapshot");
    });
    await expect(
      f.service.approve(f.id, await reviewer.signTypedData(f.typed)),
    ).rejects.toThrow("snapshot");
    expect(f.flow.view.stage).toBe("ALLOW");
    expect(f.flow.view.lastReviewAttempt).toMatchObject({
      startedAt: f.now,
      completedAt: f.now + 130,
      secondsRemaining: -10,
      outcome: "REJECTED",
      code: "SNAPSHOT_FRESHNESS",
    });
    expect(await f.reviewDisk.read(f.bound.decisionHash)).toBeNull();
  });

  it("distinguishes a future review timestamp from a signature mismatch and expired data", async () => {
    const f = setup();
    f.flow.approvedAt = f.now + 1;
    const typed = reviewTypedData(
      f.bound.preflight,
      f.bound.decision,
      f.now + 1,
    );
    const error = await f.service
      .approve(f.id, await reviewer.signTypedData(typed))
      .catch((e) => e);
    expect(error).toMatchObject({ code: "REVIEW_TIME_IN_FUTURE" });
    expect(safeConsoleError(error)).toContain("核查时钟");
    expect(f.flow.view.lastReviewAttempt?.code).toBe("REVIEW_TIME_IN_FUTURE");
  });

  it("records preparation separately from approval and leaves the review store empty", async () => {
    const f = setup();
    const payload = await f.service.reviewPayload(f.id);
    expect(payload.reviewer).toBe(reviewer.address);
    expect(f.flow.view.stage).toBe("ALLOW");
    expect(f.flow.view.lastReviewAttempt).toMatchObject({
      phase: "prepare",
      outcome: "ISSUED",
    });
    expect(await f.reviewDisk.read(f.bound.decisionHash)).toBeNull();
  });

  it("redacts arbitrary provider text from persistent failure messages", async () => {
    const f = setup(),
      secret = "synthetic-provider-secret-not-for-output";
    lifecycle.check.mockRejectedValue(new Error(`Provider error: ${secret}`));
    await expect(f.service.reviewPayload(f.id)).rejects.toThrow(secret);
    expect(f.flow.view.lastReviewAttempt).toMatchObject({
      phase: "prepare",
      outcome: "REJECTED",
      code: "REVIEW_CHECK_FAILED",
    });
    expect(JSON.stringify(await f.disk.read(`flow-${f.id}`))).not.toContain(
      secret,
    );
  });

  it("does not relabel authenticated approval as signer rejection when the UI journal fails", async () => {
    const f = setup();
    vi.spyOn(f.disk, "write").mockRejectedValue(
      new Error("Journal unavailable"),
    );
    await expect(
      f.service.approve(f.id, await reviewer.signTypedData(f.typed)),
    ).rejects.toThrow("Journal unavailable");
    expect(await f.reviewDisk.read(f.bound.decisionHash)).not.toBeNull();
    expect(f.flow.view.lastReviewAttempt).toMatchObject({
      outcome: "ACCEPTED",
      code: "ACCEPTED",
    });
    expect(f.flow.view.stage).toBe("REVIEWED");
  });
});
