/**
 * Split-pane chrome must not overlap, measured in a real engine.
 *
 * The Source/Split/Preview toggle used to be `position: absolute` over the
 * panes' top-right corner, so it lay across whatever each pane drew there: the
 * HTML trust bar, the read-only banner, source text. Static CSS lint can flag
 * the pattern (C12), but only rendered geometry proves the chrome does not
 * collide — so this builds the editor's structure with its REAL stylesheets
 * and asserts on bounding boxes and hit-testing.
 *
 * The structure mirrors SplitPaneEditor.tsx's JSX (header, banner, body with
 * source | preview); SplitPaneEditor.test.tsx pins those class names.
 */
import { describe, it, expect, afterEach } from "vitest";
import "@/styles/index.css";
import "./split-pane-editor.css";
import "./view-mode-toggle.css";
import "./read-only-banner.css";
import "@/lib/formats/adapters/html-preview.css";

type Box = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

const intersects = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

function el(tag: string, className: string, children: (Node | string)[] = []): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  for (const c of children) node.append(c);
  return node;
}

function mountSplitEditor({ banner }: { banner: boolean }) {
  const root = el("div", "split-pane-editor");
  // Fit the viewport: elementFromPoint returns null for points outside it.
  root.style.cssText = `width: ${Math.min(1000, window.innerWidth - 16)}px; height: 600px; position: relative`;

  const toggle = el("div", "view-mode-toggle", [
    el("button", "view-mode-toggle__btn", ["Source"]),
    el("button", "view-mode-toggle__btn view-mode-toggle__btn--active", ["Split"]),
    el("button", "view-mode-toggle__btn", ["Preview"]),
  ]);
  const header = el("div", "split-pane-editor__header", [toggle]);

  const trust = el("div", "html-preview__trust html-preview__trust--active", [
    el("span", "html-preview__trust-badge", ["Trusted — scripts enabled"]),
    el("span", "html-preview__trust-spacer"),
    el("button", "vm-btn", ["Revoke trust"]),
  ]);
  const preview = el("div", "split-pane-editor__preview", [el("div", "html-preview", [trust])]);
  const source = el("div", "split-pane-editor__source", ["<!doctype html>"]);
  const body = el("div", "split-pane-editor__body", [source, preview]);

  const children: HTMLElement[] = [];
  if (banner) children.push(el("div", "read-only-banner", ["Read-only preview"]));
  root.append(header, ...children, body);
  document.body.append(root);
  return { root, header, toggle, body, trust, preview, source };
}

describe("split-pane chrome layout (real engine)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each([{ banner: false }, { banner: true }])(
    "the mode toggle sits in its own row, clear of every pane (banner: $banner)",
    ({ banner }) => {
      const m = mountSplitEditor({ banner });
      const toggle = m.toggle.getBoundingClientRect();
      const body = m.body.getBoundingClientRect();

      expect(intersects(toggle, body)).toBe(false);
      expect(intersects(toggle, m.trust.getBoundingClientRect())).toBe(false);
      expect(intersects(toggle, m.source.getBoundingClientRect())).toBe(false);
      expect(toggle.bottom).toBeLessThanOrEqual(body.top);
    },
  );

  it("the trust bar's right end is the trust bar, not something floating over it", () => {
    const m = mountSplitEditor({ banner: false });
    const bar = m.trust.getBoundingClientRect();
    const hit = document.elementFromPoint(bar.right - 4, bar.top + bar.height / 2);
    expect(hit && m.trust.contains(hit)).toBe(true);
  });
});
