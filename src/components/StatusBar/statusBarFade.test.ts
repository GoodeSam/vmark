// @vitest-environment node
/**
 * The tab-strip fades must melt into the bar they sit on.
 *
 * The fades that replace the hidden scrollbar started from `--bg-secondary`
 * while `.status-bar` paints `--bg-color`, so on light themes each fade drew a
 * grey block over the white bar, behind the chevron and the clipped pill. A
 * fade is only invisible when it starts from the surface's own colour, so the
 * two are pinned together here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/components/StatusBar/StatusBar.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe("status-bar tab-strip fades", () => {
  const barToken = /background(?:-color)?\s*:\s*var\((--[\w-]+)\)/.exec(ruleBody(".status-bar"))?.[1];

  it("the bar declares its background as a token", () => {
    expect(barToken).toMatch(/^--/);
  });

  it.each([[".status-tabs-wrap::before"], [".status-tabs-wrap::after"]])("%s fades from the bar's own background", (selector) => {
    const gradient = /background\s*:\s*linear-gradient\(([^;]*)\)/.exec(ruleBody(selector))?.[1] ?? "";
    expect(gradient).toContain(`var(${barToken})`);
  });
});
