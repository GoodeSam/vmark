// @vitest-environment node
/**
 * terminalSessionReset (#1471) against the REAL xterm parser.
 *
 * "Pristine" is never written down here: it is whatever a never-used terminal
 * built from the PRODUCTION options (buildTerminalOptions) answers to the same
 * DECRQM/DECRQSS queries. So if VMark ever configures an option that one of
 * these modes is backed by (convertEol, cursorBlink), the expectation moves
 * with it and a stale reset sequence fails here.
 */
import { describe, it, expect } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { resetTerminalForNewSession, stopUnsolicitedInput } from "./terminalSessionReset";
import { buildTerminalOptions } from "./terminalOptions";
import {
  createRealTerminal,
  flushWrites,
  writeParsed,
  queryState,
  pristineState,
  bufferText,
  TUI_LEFTOVER_CASES,
  TUI_LEFTOVERS,
} from "./realXterm.testUtils";

function productionOptions(cursorBlink: boolean) {
  return buildTerminalOptions(
    {
      fontSize: 13,
      lineHeight: 1.2,
      cursorStyle: "bar",
      cursorBlink,
      useWebGL: false,
      macOptionIsMeta: true,
      screenReaderMode: false,
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      osc52Clipboard: false,
      themeId: "paper",
    },
    "monospace",
  );
}

function productionTerminal(cursorBlink = true): Terminal {
  return createRealTerminal(productionOptions(cursorBlink));
}

describe("resetTerminalForNewSession", () => {
  it.each(TUI_LEFTOVER_CASES)("undoes a dead program's %s", async (_label, sequence) => {
    const term = productionTerminal();
    await writeParsed(term, sequence);
    expect(await queryState(term)).not.toEqual(await pristineState(productionOptions(true)));

    resetTerminalForNewSession(term, { cursorBlink: true });
    await flushWrites(term);

    expect(await queryState(term)).toEqual(await pristineState(productionOptions(true)));
  });

  it.each([true, false])("restores cursor blink to the setting (%s) whichever way the program left it", async (cursorBlink) => {
    const term = productionTerminal(cursorBlink);
    await writeParsed(term, cursorBlink ? "\x1b[?12l" : "\x1b[?12h");

    resetTerminalForNewSession(term, { cursorBlink });
    await flushWrites(term);

    expect(term.options.cursorBlink).toBe(cursorBlink);
    expect(await queryState(term)).toEqual(await pristineState(productionOptions(cursorBlink)));
  });

  it("returns to the normal screen with the old session's text gone", async () => {
    const term = productionTerminal();
    await writeParsed(term, "old prompt $ codex\r\n" + TUI_LEFTOVERS + "TUI frame");

    resetTerminalForNewSession(term, { cursorBlink: true });
    await flushWrites(term);

    expect(term.buffer.active.type).toBe("normal");
    expect(bufferText(term).trim()).toBe("");
  });

  it("writes the status line AFTER the reset, readable", async () => {
    const term = productionTerminal();
    await writeParsed(term, TUI_LEFTOVERS);

    resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "Restarting shell…" });
    await flushWrites(term);

    expect(bufferText(term).trim()).toBe("Restarting shell…");
    // …and the line is plain text: the leftover SGR did not paint it.
    const cell = term.buffer.active.getLine(0)?.getCell(0);
    expect(cell?.isBold()).toBe(0);
    expect(cell?.isFgDefault()).toBe(true);
  });

  it.each([
    ["a CSI", "\x1b[?100"],
    ["an OSC string", "\x1b]0;half a title"],
    ["a DCS string", "\x1bP$q"],
  ])("recovers a parser the program left inside %s", async (_label, fragment) => {
    const term = productionTerminal();
    await writeParsed(term, fragment);

    resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "Restarting shell…" });
    await flushWrites(term);

    expect(bufferText(term).trim()).toBe("Restarting shell…");
  });

  it("is ordered after output the old PTY had already queued", async () => {
    const term = productionTerminal();
    // Not awaited: xterm parses big writes in time slices, so this is still
    // queued when the reset is requested — the restart-click race.
    term.write("x".repeat(200_000) + "\x1b[?1003h\x1b[?1006h\x1b[?25l");

    resetTerminalForNewSession(term, { cursorBlink: true });
    await flushWrites(term);

    expect(term.modes.mouseTrackingMode).toBe("none");
    expect(await queryState(term)).toEqual(await pristineState(productionOptions(true)));
  });

  it("sends nothing to the PTY while resetting, even with focus reporting on", async () => {
    const term = productionTerminal();
    await writeParsed(term, TUI_LEFTOVERS);
    const sent: string[] = [];
    term.onData((d) => sent.push(d));

    resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "x" });
    await flushWrites(term);

    expect(sent).toEqual([]);
  });

  it("is idempotent on a terminal that is already pristine", async () => {
    const term = productionTerminal();

    resetTerminalForNewSession(term, { cursorBlink: true });
    resetTerminalForNewSession(term, { cursorBlink: true });
    await flushWrites(term);

    expect(await queryState(term)).toEqual(await pristineState(productionOptions(true)));
  });
});

describe("stopUnsolicitedInput", () => {
  // xterm.js resets the whole mouse protocol on DECRST of ANY of 9/1000/1002/
  // 1003, so these cases cannot tell the four apart; the sequence still names
  // each one, as the modes are separate in the spec and in other terminals.
  it.each([
    ["X10 mouse", "\x1b[?9h"],
    ["click mouse", "\x1b[?1000h\x1b[?1006h"],
    ["drag mouse", "\x1b[?1002h\x1b[?1015h"],
    ["any-event mouse", "\x1b[?1003h\x1b[?1006h"],
  ])("turns off %s reporting", async (_label, sequence) => {
    const term = productionTerminal();
    await writeParsed(term, sequence);
    expect(term.modes.mouseTrackingMode).not.toBe("none");

    stopUnsolicitedInput(term);
    await flushWrites(term);

    expect(term.modes.mouseTrackingMode).toBe("none");
  });

  it("turns off focus reporting and sends nothing while doing it", async () => {
    const term = productionTerminal();
    await writeParsed(term, "\x1b[?1004h");
    const sent: string[] = [];
    term.onData((d) => sent.push(d));

    stopUnsolicitedInput(term);
    await flushWrites(term);

    expect(term.modes.sendFocusMode).toBe(false);
    expect(sent).toEqual([]);
  });

  it("keeps the dead session's output on screen", async () => {
    const term = productionTerminal();
    await writeParsed(term, "\x1b[?1049h\x1b[?1003h\x1b[?1006hpanic: something broke");

    stopUnsolicitedInput(term);
    await flushWrites(term);

    expect(bufferText(term)).toContain("panic: something broke");
    expect(term.buffer.active.type).toBe("alternate");
  });
});
