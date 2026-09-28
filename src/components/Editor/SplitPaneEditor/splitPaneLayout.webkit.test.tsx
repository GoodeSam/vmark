/**
 * Split-pane chrome must not overlap, measured in a real engine.
 *
 * The Source/Split/Preview toggle used to be `position: absolute` over the
 * panes' top-right corner, so it lay across whatever each pane drew there: the
 * HTML trust bar, the read-only banner, source text. Static CSS lint flags the
 * pattern (C12); only rendered geometry proves the chrome does not collide.
 *
 * This renders the PRODUCTION layout — SplitPaneFrame, the component
 * SplitPaneEditor renders through — with the real ViewModeToggle,
 * ReadOnlyBanner and HtmlTrustBar and their real stylesheets. The first
 * version built a static copy of the DOM, which had already drifted from the
 * JSX (header/banner order, no resize handle) when review caught it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "@/styles/index.css";
import "@/styles/button-shared.css";
import "@/lib/formats/adapters/html-preview.css";
import { SplitPaneFrame } from "./SplitPaneFrame";
import { ViewModeToggle } from "./ViewModeToggle";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { HtmlTrustBar } from "@/lib/formats/adapters/HtmlTrustBar";
import type { SplitViewMode } from "@/lib/formats/types";

type Box = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "height">;
const intersects = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const noop = () => {};

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(mode: SplitViewMode, banner: boolean): HTMLElement {
  host = document.createElement("div");
  // Fit the viewport: elementFromPoint returns null for points outside it.
  host.style.cssText = `width: ${Math.min(1000, window.innerWidth - 16)}px; height: 600px; display: flex`;
  document.body.append(host);
  root = createRoot(host);
  const trustBar = (
    <div className="html-preview">
      <HtmlTrustBar documentKey="/doc.html" trusted stale={false} canTrust error={null} onEnable={noop} onRevoke={noop} onReload={noop} />
    </div>
  );
  flushSync(() =>
    root!.render(
      <SplitPaneFrame
        ariaLabel="Editor"
        formatId="html"
        sourceFraction={mode === "split" ? 0.5 : mode === "source" ? 1 : 0}
        banner={banner ? <ReadOnlyBanner formatNameI18nKey="format.html" onEnableEditing={noop} /> : undefined}
        header={<ViewModeToggle mode={mode} onChange={noop} />}
        source={mode === "preview" ? undefined : <pre className="probe-source">{"<!doctype html>\n<p>x</p>"}</pre>}
        resizeHandle={mode === "split" ? <div className="split-pane-editor__resize-handle" /> : undefined}
        preview={mode === "source" ? undefined : trustBar}
      />,
    ),
  );
  return host;
}

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  document.documentElement.classList.remove("dark-theme");
});

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const box = (sel: string) => q(sel)!.getBoundingClientRect();

const CASES = (["split", "source", "preview"] as const).flatMap((mode) =>
  [false, true].flatMap((banner) => [false, true].map((dark) => ({ mode, banner, dark }))),
);

describe("split-pane chrome layout (real engine, production frame)", () => {
  it.each(CASES)("mode $mode, banner $banner, dark $dark: toggle row is clear of everything", ({ mode, banner, dark }) => {
    if (dark) document.documentElement.classList.add("dark-theme");
    mount(mode, banner);
    const toggle = box(".view-mode-toggle");
    const header = box(".split-pane-editor__header");
    const body = box(".split-pane-editor__body");

    expect(intersects(toggle, body)).toBe(false);
    expect(toggle.bottom).toBeLessThanOrEqual(body.top);
    // A header row, not a second toolbar: compact, and it leaves the body room.
    expect(header.height).toBeLessThanOrEqual(48);
    expect(body.height).toBeGreaterThan(400);
    if (banner) {
      const bannerBox = box(".read-only-banner");
      expect(intersects(bannerBox, header)).toBe(false);
      expect(intersects(bannerBox, body)).toBe(false);
    }
    if (mode !== "source") expect(intersects(toggle, box(".html-preview__trust"))).toBe(false);
    if (mode !== "preview") expect(intersects(toggle, box(".probe-source"))).toBe(false);
  });

  it("both ends of the trust bar hit-test to the trust bar", () => {
    mount("split", false);
    const bar = box(".html-preview__trust");
    const mid = bar.top + bar.height / 2;
    for (const x of [bar.left + 4, bar.right - 4]) {
      const hit = document.elementFromPoint(x, mid);
      expect(hit !== null && q(".html-preview__trust")!.contains(hit)).toBe(true);
    }
  });
});
