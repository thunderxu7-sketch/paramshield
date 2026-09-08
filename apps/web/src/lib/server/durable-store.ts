import { mkdir, open, rename, unlink, rmdir, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
const validKey = (s: string) => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s)) throw new Error("Invalid store key");
  return s;
};
const MAX_RECORD_BYTES = 1_000_000;
/** Single-host durable storage. OS directory permissions are part of the trust
 * boundary. Never serve the directory; it may contain signatures/raw txs.
 * An abandoned lock requires operator inspection, not automatic stale deletion. */
export class DurableStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }
  async read(key: string): Promise<unknown | null> {
    const p = join(this.root, validKey(key) + ".json");
    try {
      const file = await open(p, "r");
      try {
        if ((await file.stat()).size > MAX_RECORD_BYTES) throw new Error();
        const bytes = await file.readFile();
        if (bytes.length > MAX_RECORD_BYTES) throw new Error();
        return JSON.parse(bytes.toString("utf8"));
      } finally {
        await file.close();
      }
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
      throw new Error("Corrupt or unavailable durable record");
    }
  }
  async write(key: string, value: unknown) {
    validKey(key);
    const body = JSON.stringify(value);
    if (body === undefined || Buffer.byteLength(body) > MAX_RECORD_BYTES)
      throw new Error("Invalid or oversized durable record");
    await this.init();
    const target = join(this.root, validKey(key) + ".json");
    const temp = join(this.root, ".tmp-" + randomUUID());
    const f = await open(temp, "wx", 0o600);
    try {
      try {
        await f.writeFile(body);
        await f.sync();
      } finally {
        await f.close();
      }
      await rename(temp, target);
      const dir = await open(this.root, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch (e) {
      await unlink(temp).catch(() => {});
      throw e;
    }
  }
  async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await this.init();
    const lock = join(this.root, validKey(key) + ".lock");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch {
      throw new Error(
        "Operation already locked; inspect recovery state before retry",
      );
    }
    try {
      return await fn();
    } finally {
      await rmdir(lock);
    }
  }
}
