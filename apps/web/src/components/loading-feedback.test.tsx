import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BusyButton,
  LoadingHint,
  OperationNotice,
  Skeleton,
} from "./loading-feedback";
import { readFileSync } from "node:fs";
import { operationFeedback } from "../lib/loading-state";
import type { PendingOperation } from "../lib/console-state";

describe("visible and truthful loading feedback", () => {
  it("shows the busy button's spinner and text while synchronously disabling duplicate clicks", () => {
    const html = renderToStaticMarkup(
      <BusyButton loading loadingText="正在读取">
        刷新
      </BusyButton>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("ps-spinner");
    expect(html).toContain("正在读取");
    const idle = renderToStaticMarkup(<BusyButton>刷新</BusyButton>);
    expect(idle).not.toContain("ps-spinner");
    expect(idle).not.toContain("disabled");
  });
  it("does not disguise a disabled-but-idle action as loading", () => {
    const html = renderToStaticMarkup(
      <BusyButton disabled>过期授权</BusyButton>,
    );
    expect(html).not.toContain("ps-spinner");
    expect(html).not.toContain("aria-busy");
  });
  it("names skeletons for assistive tech and hides purely decorative motion", () => {
    expect(renderToStaticMarkup(<Skeleton label="加载市场状态" />)).toContain(
      'aria-label="加载市场状态"',
    );
    expect(renderToStaticMarkup(<LoadingHint>查询</LoadingHint>)).toContain(
      'aria-hidden="true"',
    );
    expect(
      renderToStaticMarkup(<LoadingHint active={false}>查询</LoadingHint>),
    ).toBe("");
  });
  it("distinguishes an active wallet prompt from recovered uncertainty; elapsed time never means success", () => {
    const pending = { phase: "wallet" } as PendingOperation;
    expect(operationFeedback("", pending, 1, 100)).toBeNull();
    expect(operationFeedback("等待签名", pending, 1, 30)).toMatchObject({
      wallet: true,
      elapsed: 29,
      slow: true,
    });
    const html = renderToStaticMarkup(
      <OperationNotice {...operationFeedback("等待签名", pending, 1, 30)!} />,
    );
    expect(html).toContain("MetaMask");
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("已完成");
    expect(operationFeedback("核对", null, 100, 99)?.elapsed).toBe(0);
  });
  it("keeps status and text when reduced motion is requested", () => {
    const css = readFileSync(
      new URL("../app/console/console.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    // Same specificity as `.ps-console button:disabled`, declared later.
    const busyRule = '.ps-console button[aria-busy="true"]';
    expect(css.indexOf(busyRule)).toBeGreaterThan(
      css.indexOf(".ps-console button:disabled"),
    );
    expect(css.slice(css.indexOf(busyRule)).split("}")[0]).toContain(
      "opacity: 1",
    );
    for (const name of [
      ".ps-loading-dots i",
      ".ps-indeterminate span",
      ".ps-skeleton",
    ])
      expect(
        css.slice(
          css.lastIndexOf(
            "@media (prefers-reduced-motion: reduce)",
            css.indexOf(".ps-source-list"),
          ),
        ),
      ).toContain(name);
  });
});
