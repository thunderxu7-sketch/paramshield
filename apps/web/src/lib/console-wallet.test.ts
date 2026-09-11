import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { observeWallet, type ConsoleProvider } from "./console-wallet";

describe("MetaMask passive state synchronization", () => {
  it("reads accounts/network without permission prompts and tracks changes without reload", async () => {
    const events = new EventEmitter();
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === "eth_accounts" ? ["account-2"] : "0xaa36a7",
    );
    const p = Object.assign(events, { request }) as ConsoleProvider;
    const update = vi.fn();
    const dispose = observeWallet(p, update);
    await Promise.resolve();
    expect(request.mock.calls.map(([p]) => p.method)).toEqual([
      "eth_accounts",
      "eth_chainId",
    ]);
    expect(update).toHaveBeenCalledWith({ account: "account-2" });
    events.emit("accountsChanged", ["account-1"]);
    events.emit("chainChanged", "0x1");
    expect(update).toHaveBeenCalledWith({ account: "account-1" });
    expect(update).toHaveBeenLastCalledWith({ chainId: "0x1" });
    events.emit("disconnect");
    expect(update).toHaveBeenCalledWith({ account: "" });
    dispose();
    expect(events.eventNames()).toEqual([]);
  });
  it("does not overwrite a newer account/chain event with a slow initial read", async () => {
    const events = new EventEmitter();
    const pending: ((v: unknown) => void)[] = [];
    const p = Object.assign(events, {
      request: () => new Promise((resolve) => pending.push(resolve)),
    }) as ConsoleProvider;
    const update = vi.fn();
    const dispose = observeWallet(p, update);
    events.emit("accountsChanged", ["new-account"]);
    events.emit("chainChanged", "0xaa36a7");
    pending[0]!(["old-account"]);
    pending[1]!("0x1");
    await Promise.resolve();
    expect(update.mock.calls).toEqual([
      [{ account: "new-account" }],
      [{ chainId: "0xaa36a7" }],
    ]);
    dispose();
  });
  it("late provider reads cannot repopulate a disposed component", async () => {
    const events = new EventEmitter();
    const request = vi.fn(async () => ["old"]);
    const update = vi.fn();
    const dispose = observeWallet(Object.assign(events, { request }), update);
    dispose();
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
  });
});
