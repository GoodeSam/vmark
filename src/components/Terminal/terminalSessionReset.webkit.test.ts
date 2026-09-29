/**
 * terminalSessionReset (#1471) in REAL WebKit with a real, OPENED xterm.
 *
 * jsdom can answer "which mode is set"; only a rendered terminal can answer
 * the two questions this file exists for:
 *   1. Does real pointer motion still produce the `ESC[<35;col;rowM` reports
 *      the issue's shell echoed as `35;79;40M…`? (onData stands in for the PTY.)
 *   2. Are OSC 4/10/11/12 palette overrides restored? Colors live in the
 *      renderer's theme service, which an unopened terminal does not have.
 */
import { describe, it, expect, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { resetTerminalForNewSession, stopUnsolicitedInput } from "./terminalSessionReset";

const opened: Array<{ term: Terminal; host: HTMLElement }> = [];

afterEach(() => {
  for (const { term, host } of opened.splice(0)) {
    term.dispose();
    host.remove();
  }
});

function openTerminal(options: ITerminalOptions = {}): Terminal {
  const host = document.createElement("div");
  host.style.width = "800px";
  host.style.height = "400px";
  document.body.appendChild(host);
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true, ...options });
  term.open(host);
  opened.push({ term, host });
  return term;
}

function parsed(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

/** Everything the terminal sends toward the PTY from now on (disposed with
 *  the terminal). */
function capture(term: Terminal): string[] {
  const sent: string[] = [];
  term.onData((data) => sent.push(data));
  return sent;
}

/** Move the real pointer across the terminal in a few steps. */
async function sweepPointer(term: Terminal): Promise<void> {
  const screen = term.element?.querySelector(".xterm-screen");
  if (!(screen instanceof HTMLElement)) throw new Error("xterm did not render a screen");
  for (const [x, y] of [[40, 20], [120, 60], [260, 110]]) {
    await userEvent.hover(screen, { position: { x, y } });
  }
}

/** The terminal's own reports of foreground, background, cursor and ANSI-1. */
async function queryColors(term: Terminal): Promise<string[]> {
  const replies: string[] = [];
  let current = "";
  const sub = term.onData((data) => {
    current += data;
  });
  try {
    for (const query of ["\x1b]10;?\x07", "\x1b]11;?\x07", "\x1b]12;?\x07", "\x1b]4;1;?\x07"]) {
      current = "";
      await parsed(term, query);
      replies.push(current);
    }
  } finally {
    sub.dispose();
  }
  return replies;
}

describe("resetTerminalForNewSession — real pointer, real renderer", () => {
  it("stops the any-event mouse reports that leaked into the next shell", async () => {
    const term = openTerminal();
    await parsed(term, "\x1b[?1003h\x1b[?1006h"); // what the Codex TUI turned on
    const beforeReset = capture(term);
    await sweepPointer(term);
    // The bug's bytes: SGR report, button 35 = motion with no button held.
    const leaked = beforeReset.join("");
    expect(leaked).toContain("\x1b[<35;");
    expect(leaked).toMatch(/\[<35;\d+;\d+M/);

    await resetTerminalForNewSession(term, { cursorBlink: () => true });
    const afterReset = capture(term);
    await sweepPointer(term);

    expect(afterReset).toEqual([]);
  });

  it("restores palette, foreground, background and cursor colors a dead program overrode", async () => {
    const term = openTerminal({ theme: { foreground: "#eeeeee", background: "#101010", cursor: "#abcdef" } });
    const pristine = await queryColors(term);
    await parsed(
      term,
      "\x1b]10;rgb:12/34/56\x07\x1b]11;rgb:ff/00/00\x07\x1b]12;rgb:00/ff/00\x07\x1b]4;1;rgb:00/00/ff\x07",
    );
    expect(await queryColors(term)).not.toEqual(pristine);

    await resetTerminalForNewSession(term, { cursorBlink: () => true });

    expect(await queryColors(term)).toEqual(pristine);
  });
});

describe("stopUnsolicitedInput — real pointer", () => {
  it("a dead session no longer reports pointer motion, clicks or focus", async () => {
    const term = openTerminal();
    await parsed(term, "\x1b[?1003h\x1b[?1006h\x1b[?1004h");

    stopUnsolicitedInput(term);
    await parsed(term, "");
    const sent = capture(term);
    await sweepPointer(term);
    await userEvent.click(term.element!.querySelector(".xterm-screen")!);

    expect(sent).toEqual([]);
  });
});
