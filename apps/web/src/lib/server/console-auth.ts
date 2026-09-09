import { timingSafeEqual } from "node:crypto";

/** Local single-user console, NOT a public authentication system. No cookies,
 * CORS, forwarded hosts, browser-supplied network URLs or public bind address. */
export function authenticateConsole(
  req: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const token = env.PARAMSHIELD_CONSOLE_TOKEN;
  const origin = env.PARAMSHIELD_CONSOLE_ORIGIN;
  if (!token || !/^[a-f0-9]{64}$/.test(token) || !origin)
    throw new Error("Console disabled");
  const configured = new URL(origin),
    url = new URL(req.url);
  if (
    configured.protocol !== "http:" ||
    configured.hostname !== "127.0.0.1" ||
    configured.origin !== origin ||
    // NextURL canonicalizes 127.0.0.1 to localhost internally. The literal Host
    // and browser Origin still have to match the configured 127.0.0.1 origin.
    ![origin, origin.replace("127.0.0.1", "localhost")].includes(url.origin) ||
    req.headers.get("host") !== configured.host ||
    req.headers.has("forwarded") ||
    (req.headers.has("x-forwarded-host") &&
      req.headers.get("x-forwarded-host") !== configured.host) ||
    (req.headers.has("x-forwarded-proto") &&
      req.headers.get("x-forwarded-proto") !== "http") ||
    !["GET", "POST"].includes(req.method)
  )
    throw new Error("Console origin rejected");
  const receivedOrigin = req.headers.get("origin");
  if (
    (req.method === "POST" && receivedOrigin !== origin) ||
    (receivedOrigin !== null && receivedOrigin !== origin) ||
    ["cross-site", "same-site"].includes(
      req.headers.get("sec-fetch-site") ?? "",
    )
  )
    throw new Error("Console origin rejected");
  const received =
    req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(received) ||
    !timingSafeEqual(Buffer.from(received), Buffer.from(token))
  )
    throw new Error("Console session required");
}

export async function consoleBody(
  req: Request,
): Promise<Record<string, unknown>> {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new Error("JSON required");
  if (Number(req.headers.get("content-length") ?? 0) > 4096)
    throw new Error("Request too large");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Request body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) throw new Error("Request too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Object required");
  return value as Record<string, unknown>;
}

export function exactFields(
  body: Record<string, unknown>,
  fields: readonly string[],
) {
  if (
    Object.keys(body).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(body, k))
  )
    throw new Error("Unexpected request fields");
}
export function flowId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value,
    )
  )
    throw new Error("Invalid flow ID");
  return value;
}
