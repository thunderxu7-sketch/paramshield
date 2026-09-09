import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConsoleService } from "./console-service";
import { DurableStore } from "./durable-store";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ps-console-idempotency-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
describe("analysis idempotency across process restart", () => {
  async function setup() {
    // A persisted historical result cannot acquire an owned CRE capability.
    const service = Object.create(ConsoleService.prototype) as ConsoleService;
    const disk = new DurableStore(root),
      id = "12345678-abcd-4abc-8abc-123456789012";
    Object.defineProperties(service, {
      disk: { value: disk },
      flows: { value: new Map() },
    });
    const record = {
      view: {
        id,
        proposedValueBps: 7942,
        stage: "ALLOW",
        active: true,
        timeline: [],
      },
      plans: {},
      hashes: {},
    };
    await disk.write(`flow-${id}`, record);
    return { service, disk, id, record };
  }
  it("returns the same recorded result without rerunning CRE or restoring signing authority", async () => {
    const f = await setup(),
      before = await f.disk.read(`flow-${f.id}`);
    expect(await f.service.analyze(f.id, 7942)).toMatchObject({
      id: f.id,
      proposedValueBps: 7942,
      stage: "ALLOW",
      active: false,
    });
    expect(await f.disk.read(`flow-${f.id}`)).toEqual(before);
  });
  it("rejects a changed threshold under an existing request ID", async () => {
    const f = await setup();
    await expect(f.service.analyze(f.id, 7000)).rejects.toThrow(
      "binding mismatch",
    );
    expect(await f.disk.read(`flow-${f.id}`)).toEqual(f.record);
  });
});
