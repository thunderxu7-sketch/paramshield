import { cre, ok, text, type TeeRuntime } from "@chainlink/cre-sdk";
import { z } from "zod";
import { evaluateConfidentialRequest } from "./protocol";

export const configSchema = z
  .object({
    schedule: z.literal("0 */5 * * * *"),
    requestUrl: z
      .string()
      .max(512)
      // QuickJS has no WHATWG URL constructor. Accept only the fixed local
      // route or a conservative ASCII HTTPS subset from trusted runner config.
      // No credentials, ports, queries, fragments, escapes or backslashes.
      .refine(
        (value) =>
          value === "http://127.0.0.1:18321/review" ||
          (value.trim() === value &&
            /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[a-zA-Z0-9._~/-]*)?$/.test(
              value,
            )),
      ),
    requestHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    runId: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
    secretId: z.literal("PARAMSHIELD_POLICY"),
    lane: z.enum(["development", "execution"]),
  })
  .strict();
export type Config = z.infer<typeof configSchema>;

export function onCronTrigger(runtime: TeeRuntime<Config>): string {
  try {
    const config = configSchema.parse(runtime.config);
    // Vault secret is fetched and parsed only within the confidential handler.
    const policy = runtime.getSecret({ id: config.secretId }).result().value;
    const response = new cre.capabilities.HTTPClient()
      .sendRequest(runtime, {
        url: config.requestUrl,
        method: "GET",
      })
      .result();
    if (!ok(response)) throw new Error();
    const body = text(response);
    if (body.length > 2_000_000) throw new Error();
    const result = evaluateConfidentialRequest(JSON.parse(body), policy, {
      now: Math.floor(runtime.now().getTime() / 1000),
      requestHash: config.requestHash,
      runId: config.runId,
      lane: config.lane,
    });
    // Only this allowlisted public envelope crosses the handler boundary.
    // No private policy, search trace, logs, transaction or claimed TEE proof.
    return JSON.stringify(result);
  } catch {
    throw new Error(
      "Confidential workflow failed closed; private details omitted",
    );
  }
}
export function initWorkflow(config: Config) {
  return [
    cre.handlerInTee(
      new cre.capabilities.CronCapability().trigger({
        schedule: config.schedule,
      }),
      onCronTrigger,
      [{ tee: "nitro", regions: ["us-west-2"] }],
    ),
  ];
}
