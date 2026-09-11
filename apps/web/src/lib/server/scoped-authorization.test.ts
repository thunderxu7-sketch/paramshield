import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPreflight, hashCanonical } from "@paramshield/evidence";
import {
  evaluateConfidentialRequest,
  validateExecutionResult,
} from "@paramshield/chainlink-cre/protocol";
import { hashTypedData } from "viem";
import { TypedDataUtils, SignTypedDataVersion } from "@metamask/eth-sig-util";
import {
  executionFixture,
  reviewer,
  stranger,
  operator,
  hash,
} from "./test-fixtures";
import {
  DEMO_POLICY,
  readTrustedRun,
  type CreExecutionRun,
} from "./cre-execution-runner";
import {
  authorizationScope,
  authorizationTypedData,
  AUTHORIZATION_MODE,
} from "./authorization-scope";
import {
  bindScopedRun,
  checkScopedAuthorization,
} from "./scoped-authorization";
import { ScopedReviewStore } from "./scoped-review-store";
import { SignedReviewStore, reviewTypedData } from "./review-store";
import { DurableStore } from "./durable-store";
import { ConsoleService } from "./console-service";
import {
  lifecycleData,
  prepareLifecyclePlan,
  type V2Context,
} from "./lifecycle-preflight";

// Unit-only provenance/RPC boundaries. No real reviewer, CRE process or chain
// is claimed here; the isolated Anvil harness exercises the actual runner.
const ownership = vi.hoisted(() => new WeakMap<object, unknown>());
vi.mock("./cre-execution-runner", async (original) => ({
  ...(await original<typeof import("./cre-execution-runner")>()),
  readTrustedRun: (run: object) => {
    const data = ownership.get(run);
    if (!data)
      throw new Error("Result did not originate from this trusted runner");
    return structuredClone(data);
  },
}));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-scoped-auth-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const old = executionFixture();
  const time = { now: old.now };
  const p = old.bound.preflight;
  const preflight = createPreflight({
    snapshot: p.snapshot,
    stressBps: p.stressBps,
    validation: p.validation,
    intentCore: { ...p.intentCore, expiresAt: p.validation.validatedAt + 600 },
  }).preflight;
  const request = { ...old.request, preflight };
  const result = evaluateConfidentialRequest(
    request,
    JSON.stringify(DEMO_POLICY),
    {
      now: time.now,
      requestHash: hashCanonical(request),
      runId: request.runId,
      lane: "execution",
    },
  );
  const bound = validateExecutionResult(result, request, {
    now: time.now,
    runId: request.runId,
    policyVersion: DEMO_POLICY.version,
  });
  const run = { runId: request.runId } as CreExecutionRun;
  const policyHash = hashCanonical(DEMO_POLICY);
  ownership.set(run, {
    request,
    result,
    acceptedAt: time.now,
    policyHash,
    authorizationMode: AUTHORIZATION_MODE,
  });
  const fresh = structuredClone(p.snapshot);
  const target = {
    chainId: 11155111 as const,
    contractVersion: "v2" as const,
    executor: bound.intent.executor,
    market: bound.intent.target,
    operator: bound.intent.operator,
    decisionAuthority: stranger.address.toLowerCase(),
    executorCodeHash: hash("d"),
    marketCodeHash: hash("e"),
    policyVersion: DEMO_POLICY.version,
  };
  const live = {
    ...target,
    marketOwner: target.executor,
    block: { ...fresh.block },
    stateVersion: "7",
    authorizationEpoch: "2",
    allowedCall: true,
    proposal: { state: 0, decisionHash: hash("0") as string },
  };
  const client = {
    readContract: vi.fn(async () => false),
    getTransactionCount: vi.fn(async () => 0),
    estimateGas: vi.fn(async () => 50000n),
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas: 1000000000n,
      maxPriorityFeePerGas: 100000000n,
    })),
    getBalance: vi.fn(async () => 10n ** 18n),
  };
  const state = {
    canonicalBlockHash: vi.fn(async (n: number) =>
      n === p.snapshot.block.number
        ? p.snapshot.block.hash
        : n === fresh.block.number
          ? fresh.block.hash
          : live.block.hash,
    ),
  };
  const snapshot = vi.fn(async () => ({
    snapshot: structuredClone(fresh),
    validation: { validatedAt: time.now, headBlock: live.block.number },
  }));
  const c = {
    target,
    client,
    state,
    now: () => time.now,
    snapshot,
    live: async () => structuredClone(live),
  } as unknown as V2Context;
  const disk = new DurableStore(join(root, "scoped-reviews"));
  const reviews = new ScopedReviewStore(disk, [reviewer.address], c.now);
  const typed = authorizationTypedData(
    preflight,
    bound.decision,
    policyHash,
    old.now,
  );
  const sig = await reviewer.signTypedData(typed);
  const record = () =>
    reviews.record(preflight, bound.decision, policyHash, old.now, sig);
  function advance(seconds: number) {
    time.now = old.now + seconds;
    fresh.fetchedAt = time.now;
    fresh.block = {
      number: p.snapshot.block.number + Math.floor(seconds / 12) + 1,
      timestamp: time.now - 2,
      hash: hash("a"),
    };
    live.block = {
      ...fresh.block,
      number: fresh.block.number + 1,
      timestamp: time.now - 1,
      hash: hash("b"),
    };
  }
  return {
    old,
    time,
    bound,
    run,
    policyHash,
    fresh,
    live,
    client,
    state,
    snapshot,
    c,
    disk,
    reviews,
    typed,
    sig,
    record,
    advance,
  };
}

describe("exact-state authorization / distinct EIP-712 grant", () => {
  it("the console issues and records the new grant after a long wallet delay, preserving the original evidence", async () => {
    const f = await fixture();
    const id = "12345678-abcd-4abc-8abc-123456789012";
    const service = Object.create(ConsoleService.prototype) as ConsoleService;
    const scope = authorizationScope(
      f.bound.preflight,
      f.bound.decision,
      f.policyHash,
    );
    const flow: Awaited<ReturnType<ConsoleService["flow"]>> = {
      view: {
        id,
        stage: "ALLOW",
        active: true,
        createdAt: f.old.now,
        proposedValueBps: 7942,
        freshUntil: f.old.now + 120,
        expiresAt: f.bound.intent.expiresAt,
        authorization: scope,
        timeline: [],
      },
      run: f.run,
      bound: f.bound,
      plans: {},
      hashes: {},
    };
    const disk = new DurableStore(join(root, "flows"));
    Object.defineProperties(service, {
      c: { value: f.c },
      disk: { value: disk },
      reviewer: { value: reviewer.address },
      scopedReviews: { value: f.reviews },
      flows: { value: new Map([[id, flow]]) },
    });
    const original = hashCanonical(f.bound);
    const payload = await service.reviewPayload(id);
    expect(payload.typedData.primaryType).toBe("ExactStateAuthorization");
    f.advance(300);
    await service.approve(id, f.sig);
    expect(flow.view.stage).toBe("REVIEWED");
    expect(flow.view.lastReviewAttempt?.outcome).toBe("ACCEPTED");
    expect(flow.view.lastReviewAttempt?.secondsRemaining).toBeGreaterThan(200);
    expect(flow.freshnessChecks).toHaveLength(3);
    expect(flow.view.lastFreshCheck?.blockNumber).toBe(f.fresh.block.number);
    expect(hashCanonical(flow.bound)).toBe(original);
    const saved = await disk.read(`flow-${id}`);
    expect(JSON.stringify(saved)).not.toContain(f.sig);
    service.flows.clear(); // Reloading disk is not owned CRE authorization.
    await expect(service.propose(id)).resolves.toMatchObject({
      stage: "REVIEWED",
      active: false,
    });
    expect((await service.flow(id)).view.error).toContain("过期");
  });
  it("a five-minute human delay does not require another signature when fresh state is identical", async () => {
    const f = await fixture();
    const before = hashCanonical(f.bound);
    f.advance(300);
    await checkScopedAuthorization(f.run, f.c, f.reviews, 0, false);
    await f.record(); // The human signed the originally issued payload.
    const { checkpoint, bound } = await checkScopedAuthorization(
      f.run,
      f.c,
      f.reviews,
      0,
    );
    expect(hashCanonical(bound)).toBe(before);
    expect(bound.preflight.snapshot.block.number).toBe(
      f.old.bound.preflight.snapshot.block.number,
    );
    expect(checkpoint.snapshotBlock.number).toBeGreaterThan(
      bound.preflight.snapshot.block.number + 12,
    );
    expect(checkpoint.freshUntil).toBeGreaterThan(f.time.now);
    expect(checkpoint.scopeHash).toBe(
      authorizationScope(bound.preflight, bound.decision, f.policyHash)
        .scopeHash,
    );
    expect(
      await new ScopedReviewStore(f.disk, [reviewer.address], f.c.now).get(
        bound.decisionHash,
      ),
    ).toBeTruthy();
  });
  it("matches MetaMask V4 wire hashing, without inferring a missing EIP712Domain", async () => {
    const f = await fixture();
    const wire = JSON.parse(
      JSON.stringify(f.typed, (_, v) =>
        typeof v === "bigint" ? String(v) : v,
      ),
    );
    expect(
      `0x${TypedDataUtils.eip712Hash(wire, SignTypedDataVersion.V4).toString("hex")}`,
    ).toBe(hashTypedData(f.typed));
    delete wire.types.EIP712Domain;
    expect(
      `0x${TypedDataUtils.eip712Hash(wire, SignTypedDataVersion.V4).toString("hex")}`,
    ).not.toBe(hashTypedData(f.typed));
  });
  it("rejects old v2 signatures, wrong signers and policy/destination/chain/expiry changes", async () => {
    const f = await fixture();
    const legacy = reviewTypedData(
      f.bound.preflight,
      f.bound.decision,
      f.old.now,
    );
    for (const sig of [
      await reviewer.signTypedData(legacy),
      await stranger.signTypedData(f.typed),
      await reviewer.signTypedData({
        ...f.typed,
        domain: { ...f.typed.domain, chainId: 1n },
      }),
      await reviewer.signTypedData({
        ...f.typed,
        domain: { ...f.typed.domain, verifyingContract: stranger.address },
      }),
      await reviewer.signTypedData({
        ...f.typed,
        message: {
          ...f.typed.message,
          expiresAt: f.typed.message.expiresAt + 1n,
        },
      }),
    ])
      await expect(
        f.reviews.record(
          f.bound.preflight,
          f.bound.decision,
          f.policyHash,
          f.old.now,
          sig,
        ),
      ).rejects.toThrow("Unauthorized");
    await expect(
      f.reviews.record(
        f.bound.preflight,
        f.bound.decision,
        hash("c"),
        f.old.now,
        f.sig,
      ),
    ).rejects.toThrow("Unauthorized");
    const legacyStore = new SignedReviewStore(
      new DurableStore(join(root, "legacy")),
      [reviewer.address],
      f.c.now,
    );
    await expect(
      legacyStore.record(f.bound.preflight, f.bound.decision, f.old.now, f.sig),
    ).rejects.toThrow("Unauthorized");
  });
  it("rejects self-review, conflicting writes, future reviews, tampering and post-restart expiry", async () => {
    const f = await fixture();
    const self = new ScopedReviewStore(f.disk, [operator.address], f.c.now);
    await expect(
      self.record(
        f.bound.preflight,
        f.bound.decision,
        f.policyHash,
        f.old.now,
        await operator.signTypedData(f.typed),
      ),
    ).rejects.toThrow("self-review");
    await f.record();
    const nextTyped = authorizationTypedData(
      f.bound.preflight,
      f.bound.decision,
      f.policyHash,
      f.old.now + 1,
    );
    const nextSig = await reviewer.signTypedData(nextTyped);
    await expect(
      f.reviews.record(
        f.bound.preflight,
        f.bound.decision,
        f.policyHash,
        f.old.now + 1,
        nextSig,
      ),
    ).rejects.toThrow("future");
    f.advance(2);
    await expect(
      f.reviews.record(
        f.bound.preflight,
        f.bound.decision,
        f.policyHash,
        f.old.now + 1,
        nextSig,
      ),
    ).rejects.toThrow("overwritten");
    const record = (await f.disk.read(f.bound.decisionHash)) as Record<
      string,
      unknown
    >;
    await f.disk.write(hash("1"), record);
    await expect(f.reviews.get(hash("1"))).rejects.toThrow("lookup mismatch");
    const { digest: _digest, ...payload } = record;
    void _digest;
    const altered = { ...payload, policyHash: hash("c") };
    await f.disk.write(f.bound.decisionHash, {
      ...altered,
      digest: hashCanonical(altered),
    });
    await expect(f.reviews.get(f.bound.decisionHash)).rejects.toThrow(
      "Unauthorized",
    );
    await f.disk.write(f.bound.decisionHash, record);
    f.time.now = f.bound.intent.expiresAt;
    await expect(
      new ScopedReviewStore(f.disk, [reviewer.address], f.c.now).get(
        f.bound.decisionHash,
      ),
    ).rejects.toThrow("expired");
  });
});

describe("fresh observations are mandatory at each scoped boundary", () => {
  it.each([
    "collateralPriceUsdE18",
    "stateVersion",
    "liquidationThresholdBps",
    "positions",
    "source",
  ] as const)(
    "rejects changed %s even with the same target LT",
    async (field) => {
      const f = await fixture();
      await f.record();
      f.advance(300);
      if (field === "positions")
        f.fresh.positions[0]!.account =
          stranger.address.toLowerCase() as `0x${string}`;
      else if (field === "source")
        f.fresh.source.deployment = "another-deployment";
      else if (field === "liquidationThresholdBps")
        f.fresh.liquidationThresholdBps = 7999;
      else if (field === "stateVersion") f.fresh.stateVersion = "8";
      else f.fresh.collateralPriceUsdE18 = "1";
      await expect(
        checkScopedAuthorization(f.run, f.c, f.reviews, 0),
      ).rejects.toThrow("market state changed");
    },
  );
  it.each([
    "authorizationEpoch",
    "operator",
    "decisionAuthority",
    "stateVersion",
    "allowedCall",
    "executorCodeHash",
    "marketCodeHash",
    "marketOwner",
  ] as const)("rejects changed live %s", async (field) => {
    const f = await fixture();
    await f.record();
    f.advance(300);
    if (field === "allowedCall") f.live.allowedCall = false;
    else
      Object.assign(f.live, {
        [field]:
          field === "stateVersion" || field === "authorizationEpoch"
            ? "99"
            : field.endsWith("CodeHash")
              ? hash("f")
              : reviewer.address.toLowerCase(),
      });
    await expect(
      checkScopedAuthorization(f.run, f.c, f.reviews, 0),
    ).rejects.toThrow("permissions or proposal changed");
  });
  it("rejects stale/future/lagging snapshots, old-block reorgs and fresh-block reorgs", async () => {
    for (const cause of [
      "age",
      "future",
      "lag",
      "original-reorg",
      "fresh-reorg",
    ] as const) {
      const f = await fixture();
      await f.record();
      f.advance(300);
      if (cause === "age") f.fresh.block.timestamp -= 121;
      if (cause === "future") f.fresh.fetchedAt++;
      if (cause === "lag") f.live.block.number += 13;
      if (cause.endsWith("reorg"))
        f.state.canonicalBlockHash.mockImplementation(async (n) =>
          cause === "original-reorg" || n === f.fresh.block.number
            ? hash("f")
            : f.old.bound.preflight.snapshot.block.hash,
        );
      await expect(
        checkScopedAuthorization(f.run, f.c, f.reviews, 0),
      ).rejects.toThrow(/snapshot|reorganized/);
    }
  });
  it("does not accept missing reviews, consumed nonces or a mismatched on-chain decision", async () => {
    const f = await fixture();
    f.advance(300);
    await expect(
      checkScopedAuthorization(f.run, f.c, f.reviews, 0),
    ).rejects.toThrow("scoped review");
    await f.record();
    f.client.readContract.mockResolvedValue(true);
    await expect(
      checkScopedAuthorization(f.run, f.c, f.reviews, 0),
    ).rejects.toThrow("nonce");
    f.live.proposal.state = 2;
    await expect(
      checkScopedAuthorization(f.run, f.c, f.reviews, 2),
    ).rejects.toThrow("proposal changed");
  });
  it("fails closed if a slow final dependency crosses the 120-second data window", async () => {
    const f = await fixture();
    await f.record();
    f.advance(300);
    const original = f.state.canonicalBlockHash.getMockImplementation()!;
    f.state.canonicalBlockHash.mockImplementation(async (n) => {
      if (n === f.live.block.number) f.time.now += 121;
      return original(n);
    });
    await expect(
      checkScopedAuthorization(f.run, f.c, f.reviews, 0),
    ).rejects.toThrow("snapshot");
  });
  it("rejects JSON/legacy capability upgrades, altered policy and authorization expiry even with new data", async () => {
    const f = await fixture();
    await f.record();
    expect(() => bindScopedRun(JSON.parse(JSON.stringify(f.run)), f.c)).toThrow(
      "trusted runner",
    );
    const data = readTrustedRun(f.run);
    ownership.set(f.run, { ...data, acceptedAt: f.old.now - 3 });
    expect(() => bindScopedRun(f.run, f.c)).toThrow("acceptance precedes");
    ownership.set(f.run, { ...data, authorizationMode: undefined });
    expect(() => bindScopedRun(f.run, f.c)).toThrow("Scoped runner capability");
    ownership.set(f.run, { ...data, policyHash: hash("c") });
    expect(() => bindScopedRun(f.run, f.c)).toThrow("unchanged policy");
    ownership.set(f.run, data);
    f.advance(600);
    await expect(
      checkScopedAuthorization(f.run, f.c, f.reviews, 0),
    ).rejects.toThrow("authorization expired");
  });
  it.each([
    [0, "propose", 200],
    [1, "decision", 300],
    [2, "execute", 400],
  ] as const)(
    "same reviewed intent reaches state %s / %s after %s seconds; drift is still blocked",
    async (state, method, delay) => {
      const f = await fixture();
      await f.record();
      const immutable = hashCanonical(f.bound);
      f.advance(delay);
      f.live.proposal.state = state;
      f.live.proposal.decisionHash =
        state === 2 ? f.bound.decisionHash : hash("0");
      const check = () =>
        checkScopedAuthorization(f.run, f.c, f.reviews, state);
      const ready = await prepareLifecyclePlan({
        client: f.c.client,
        from: method === "decision" ? stranger.address : operator.address,
        to: f.bound.intent.executor,
        data: lifecycleData(f.bound, method),
        expiresAt: f.bound.intent.expiresAt,
        revalidate: check,
      });
      await ready.revalidate();
      expect(ready.plan.data).toBe(lifecycleData(f.bound, method));
      expect(hashCanonical((await check()).bound)).toBe(immutable);
      f.live.authorizationEpoch = "3";
      await expect(ready.revalidate()).rejects.toThrow(
        "permissions or proposal changed",
      );
      f.live.authorizationEpoch = "2";
    },
  );
});
