import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleRequest, ConsoleRequestError } from "./console-request";

afterEach(() => vi.useRealTimers());
describe("bounded console requests", () => {
  it("keeps authentication in headers, including the read-only journal request", async () => {
    const transport = vi.fn(async () => Response.json({ history: [] }));
    await consoleRequest("test-token", undefined, {}, "journal", transport);
    expect(transport).toHaveBeenCalledWith(
      "/api/console?view=journal",
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        headers: { authorization: "Bearer test-token" },
      }),
    );
  });
  it("times out hung reads, making retry available without claiming an empty journal", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("timeout")),
          );
        }),
    );
    const result = consoleRequest(
      "test-token",
      undefined,
      {},
      "journal",
      transport,
    );
    const assertion = expect(result).rejects.toMatchObject({
      uncertain: false,
      message: expect.stringContaining("仍保留"),
    });
    await vi.advanceTimersByTimeAsync(6000);
    await assertion;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("lost POST response stays uncertain; it never retries or exposes the provider payload", async () => {
    const transport = vi.fn(async () => {
      throw new Error("secret raw transaction");
    });
    await expect(
      consoleRequest(
        "test-token",
        "propose",
        { id: "test" },
        undefined,
        transport,
      ),
    ).rejects.toMatchObject({
      uncertain: true,
      message: expect.stringContaining("不会重发"),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("preserves sanitized server rejection without calling it a successful operation", async () => {
    const transport = vi.fn(async () =>
      Response.json({ error: "审核已过期" }, { status: 409 }),
    );
    await expect(
      consoleRequest("test-token", "approve", {}, undefined, transport),
    ).rejects.toEqual(new ConsoleRequestError("审核已过期", false));
  });
});
