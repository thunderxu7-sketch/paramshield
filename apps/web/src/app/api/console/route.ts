import {
  authenticateConsole,
  consoleBody,
  exactFields,
  flowId,
} from "@/lib/server/console-auth";
import { consoleService, safeConsoleError } from "@/lib/server/console-service";
import type { Hex } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}
export async function GET(req: Request) {
  try {
    authenticateConsole(req);
  } catch {
    return json({ error: "仅限本机有效会话；请使用私有启动链接。" }, 401);
  }
  try {
    const service = await consoleService(),
      params = new URL(req.url).searchParams,
      id = params.get("id");
    return json(
      id
        ? (await service.flow(flowId(id))).view
        : params.get("view") === "journal"
          ? await service.journal()
          : await service.status(),
    );
  } catch (e) {
    return json({ error: safeConsoleError(e) }, 409);
  }
}
export async function POST(req: Request) {
  try {
    authenticateConsole(req);
  } catch {
    return json({ error: "请求会话或来源不匹配。" }, 401);
  }
  try {
    const b = await consoleBody(req),
      service = await consoleService();
    const id = flowId(b.id);
    switch (b.action) {
      case "analyze":
        exactFields(b, ["action", "id", "thresholdBps"]);
        if (typeof b.thresholdBps !== "number")
          throw new Error("Invalid threshold");
        return json(await service.analyze(id, b.thresholdBps));
      case "review-payload":
        exactFields(b, ["action", "id"]);
        return json(await service.reviewPayload(id));
      case "approve":
        exactFields(b, ["action", "id", "signature"]);
        if (
          typeof b.signature !== "string" ||
          !/^0x[0-9a-fA-F]{130}$/.test(b.signature)
        )
          throw new Error("Invalid signature");
        return json(await service.approve(id, b.signature as Hex));
      case "propose":
        exactFields(b, ["action", "id"]);
        return json(await service.propose(id));
      case "decision-payload":
        exactFields(b, ["action", "id"]);
        return json(await service.decisionPayload(id));
      case "decision-receipt":
        exactFields(b, ["action", "id", "hash"]);
        if (typeof b.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(b.hash))
          throw new Error("Invalid transaction hash");
        return json(await service.decisionReceipt(id, b.hash as Hex));
      case "execute":
        exactFields(b, ["action", "id"]);
        return json(await service.execute(id));
      case "graph-after":
        exactFields(b, ["action", "id"]);
        return json(await service.graphAfter(id));
      case "recover":
        exactFields(b, ["action", "id", "leg"]);
        if (b.leg !== "propose" && b.leg !== "decision" && b.leg !== "execute")
          throw new Error("Invalid recovery leg");
        return json(await service.recover(id, b.leg));
      case "retire-expired":
        exactFields(b, ["action", "id"]);
        return json(await service.retireExpired(id));
      case "analysis-report":
        exactFields(b, ["action", "id"]);
        return json(await service.analysisReport(id));
      case "explain":
        exactFields(b, ["action", "id", "question"]);
        if (typeof b.question !== "string")
          throw new Error("Risk question required");
        return json(await service.explain(id, b.question));
      default:
        throw new Error("Unsupported action");
    }
  } catch (e) {
    return json({ error: safeConsoleError(e) }, 409);
  }
}
