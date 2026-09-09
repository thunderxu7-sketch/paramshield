import { describe, expect, it } from "vitest";
import {
  authenticateConsole,
  consoleBody,
  exactFields,
  flowId,
} from "./console-auth";
const origin = "http://127.0.0.1:4180",
  token = "a".repeat(64);
const env = {
  PARAMSHIELD_CONSOLE_TOKEN: token,
  PARAMSHIELD_CONSOLE_ORIGIN: origin,
};
function request(
  headers: Record<string, string> = {},
  method = "POST",
  body = "{}",
) {
  return new Request(`${origin}/api/console`, {
    method,
    headers: {
      host: "127.0.0.1:4180",
      origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...headers,
    },
    ...(method === "POST" ? { body } : {}),
  });
}
describe("local console boundary", () => {
  it("accepts exact loopback origin/session including Next's matching forwarded headers", () => {
    expect(() =>
      authenticateConsole(
        request({
          "x-forwarded-host": "127.0.0.1:4180",
          "x-forwarded-proto": "http",
        }),
        env,
      ),
    ).not.toThrow();
  });
  it.each([
    { origin: "https://evil.test" },
    { host: "evil.test" },
    { authorization: `Bearer ${"b".repeat(64)}` },
    { authorization: "" },
    { "x-forwarded-host": "evil.test" },
    { "x-forwarded-proto": "https" },
    { forwarded: "for=127.0.0.1" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ])("rejects cross-origin/session mutation %j", (headers) => {
    expect(() => authenticateConsole(request(headers), env)).toThrow();
  });
  it("rejects a public bind and disabled console", () => {
    expect(() =>
      authenticateConsole(request(), {
        ...env,
        PARAMSHIELD_CONSOLE_ORIGIN: "http://0.0.0.0:4180",
      }),
    ).toThrow();
    expect(() => authenticateConsole(request(), {})).toThrow();
  });
  it("requires explicit POST origin and allows authenticated originless GET", () => {
    const post = request();
    post.headers.delete("origin");
    expect(() => authenticateConsole(post, env)).toThrow();
    const get = request({}, "GET");
    get.headers.delete("origin");
    expect(() => authenticateConsole(get, env)).not.toThrow();
  });
  it("handles NextURL's internal localhost normalization without accepting a different Host", () => {
    const original = request();
    const normalized = new Request("http://localhost:4180/api/console", {
      method: "POST",
      headers: original.headers,
      body: "{}",
    });
    expect(() => authenticateConsole(normalized, env)).not.toThrow();
    normalized.headers.set("host", "localhost:4180");
    expect(() => authenticateConsole(normalized, env)).toThrow("origin");
  });
  it("limits streamed body size even without Content-Length", async () => {
    await expect(
      consoleBody(
        request({}, "POST", JSON.stringify({ data: "x".repeat(4096) })),
      ),
    ).rejects.toThrow("large");
    await expect(
      consoleBody(request({ "content-type": "text/plain" })),
    ).rejects.toThrow("JSON");
    await expect(consoleBody(request({}, "POST", "[]"))).rejects.toThrow(
      "Object",
    );
    expect(
      await consoleBody(request({}, "POST", '{"action":"analyze"}')),
    ).toEqual({ action: "analyze" });
  });
  it("rejects extra commands, paths or browser-supplied network parameters", () => {
    expect(() =>
      exactFields({ action: "analyze", id: "x", rpcUrl: "https://evil.test" }, [
        "action",
        "id",
      ]),
    ).toThrow();
    for (const id of ["../../secrets", "run;touch x", "", null])
      expect(() => flowId(id)).toThrow();
    expect(flowId("12345678-abcd-4abc-8abc-123456789012")).toContain(
      "12345678",
    );
  });
});
