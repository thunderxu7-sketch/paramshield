import { describe, expect, it, vi } from "vitest";
import { explainEvidence, explanationFacts } from "./evidence-explanation";
import { executionFixture } from "./test-fixtures";

describe("grounded explanation", () => {
  it("never calls a provider or claims AI when configuration is absent", async () => {
    const fetcher = vi.fn();
    const result = await explainEvidence(executionFixture().bound, "解释风险", {
      fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.mode).toBe("deterministic-fallback");
    expect(result.text).toContain("ALLOW");
    expect(result.text).toContain("79.42%");
    expect(result.text).toContain("不代表整个市场安全");
  });
  function api(body: unknown) {
    return vi.fn(async () => Response.json(body));
  }
  const output = (text: string) => ({
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
  });
  it("AI can select evidence IDs, but cannot fabricate numbers or change verdict", async () => {
    const b = executionFixture().bound;
    const fetcher = api(
      output(JSON.stringify({ sources: ["simulation.decreaseBps"] })),
    );
    const result = await explainEvidence(b, "Why this LT?", {
      key: "test-only",
      model: "configured-test-model",
      fetcher,
    });
    expect(result.mode).toBe("ai");
    expect(result.sources).toEqual([
      "decision.verdict",
      "simulation.decreaseBps",
      "snapshot.block.number",
      "model.scope",
    ]);
    expect(result.text).toContain(
      explanationFacts(b)["simulation.decreaseBps"],
    );
    expect(result.text).toContain("ALLOW");
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(call[1].body as string)).toMatchObject({
      store: false,
      model: "configured-test-model",
    });
    expect(call[1].body).not.toContain(b.intent.operator);
    expect(call[1].body).not.toContain(b.intent.executor);
  });
  it.each([
    output('{"sources":["new.safeThreshold999"]}'),
    output('{"sources":["model.scope"],"verdict":"BLOCK"}'),
    output('{"sources":[]}'),
    { status: "incomplete", output: [] },
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "refusal", refusal: "no" }] },
      ],
    },
  ])("visibly falls back on ungrounded or incomplete output", async (body) => {
    const result = await explainEvidence(executionFixture().bound, "解释", {
      key: "test",
      model: "test",
      fetcher: api(body),
    });
    expect(result.mode).toBe("deterministic-fallback");
  });
  it("falls back on provider failure without leaking its response or credentials", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("secret-provider-payload");
    });
    const result = await explainEvidence(executionFixture().bound, "解释", {
      key: "secret-key",
      model: "test",
      fetcher,
    });
    expect(result.mode).toBe("deterministic-fallback");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
