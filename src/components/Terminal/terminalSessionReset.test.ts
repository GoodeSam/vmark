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
import { setupOsc133 } from "./setupOsc";
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

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(await queryState(term)).toEqual(await pristineState(productionOptions(true)));
  });

  it.each([true, false])("restores cursor blink to the setting (%s) whichever way the program left it", async (cursorBlink) => {
    const term = productionTerminal(cursorBlink);
    await writeParsed(term, cursorBlink ? "\x1b[?12l" : "\x1b[?12h");

    await resetTerminalForNewSession(term, { cursorBlink });

    expect(term.options.cursorBlink).toBe(cursorBlink);
    expect(await queryState(term)).toEqual(await pristineState(productionOptions(cursorBlink)));
  });

  it("returns to the normal screen with the old session's text gone", async () => {
    const term = productionTerminal();
    await writeParsed(term, "old prompt $ codex\r\n" + TUI_LEFTOVERS + "TUI frame");

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(term.buffer.active.type).toBe("normal");
    expect(bufferText(term).trim()).toBe("");
  });

  it("writes the status line AFTER the reset, readable", async () => {
    const term = productionTerminal();
    await writeParsed(term, TUI_LEFTOVERS);

    await resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "Restarting shell…" });

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

    await resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "Restarting shell…" });

    expect(bufferText(term).trim()).toBe("Restarting shell…");
  });

  it("resolves only once xterm has parsed the reset, backlog included", async () => {
    const term = productionTerminal();
    term.write("x".repeat(200_000) + "\x1b[?1003h\x1b[?1006h");

    await resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "ready" });

    // No extra flush: the caller attaches the new PTY right after this. The
    // status line proves the reset was parsed (an unparsed backlog would also
    // read "none", so the mode alone could not tell).
    expect(bufferText(term).trim()).toBe("ready");
    expect(term.modes.mouseTrackingMode).toBe("none");
  });

  it.each([
    ["a DECRQSS query", "\x1bP$q", undefined],
    ["a title", "\x1b]2;half a title", "half a title"],
  ])("abandons %s the program left unterminated instead of completing it", async (_label, fragment, title) => {
    const term = productionTerminal();
    await writeParsed(term, fragment);
    const sent: string[] = [];
    const titles: string[] = [];
    term.onData((d) => sent.push(d));
    term.onTitleChange((t) => titles.push(t));

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(sent).toEqual([]);
    if (title) expect(titles).not.toContain(title);
  });

  it("is ordered after output the old PTY had already queued", async () => {
    const term = productionTerminal();
    // Not awaited: xterm parses big writes in time slices, so this is still
    // queued when the reset is requested — the restart-click race.
    term.write("x".repeat(200_000) + "\x1b[?1003h\x1b[?1006h\x1b[?25l");

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(term.modes.mouseTrackingMode).toBe("none");
    expect(await queryState(term)).toEqual(await pristineState(productionOptions(true)));
  });

  it("sends nothing to the PTY while resetting, even with focus reporting on", async () => {
    const term = productionTerminal();
    await writeParsed(term, TUI_LEFTOVERS);
    const sent: string[] = [];
    term.onData((d) => sent.push(d));

    await resetTerminalForNewSession(term, { cursorBlink: true, statusLine: "x" });

    expect(sent).toEqual([]);
  });

  // RIS replaces xterm's buffers WITHOUT disposing their markers. xterm's own
  // OSC 8 hyperlink registry keeps a marker per link, and an undisposed one
  // pins the whole discarded buffer (scrollback included) for the life of the
  // terminal — one leaked buffer per restart. A public marker lives in the
  // same list and dies by the same path, so its disposal proves theirs.
  it("disposes the markers of both discarded buffers, not just the visible one", async () => {
    const term = productionTerminal();
    await writeParsed(term, "shell output\r\n".repeat(40));
    const normal = term.registerMarker(0);
    await writeParsed(term, "\x1b[?1049hTUI frame"); // killed on the alternate screen
    const alternate = term.registerMarker(0);

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(normal?.isDisposed).toBe(true);
    expect(alternate?.isDisposed).toBe(true);
  });

  it("disposes them with the cursor home and no scrollback, where a bare clear() does nothing", async () => {
    const term = productionTerminal();
    await writeParsed(term, "one line");
    const marker = term.registerMarker(0);
    await writeParsed(term, "\x1b[H");

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(marker?.isDisposed).toBe(true);
  });

  it("leaves no OSC 133 command mark behind", async () => {
    const term = productionTerminal();
    const osc = setupOsc133(term);
    await writeParsed(term, "\x1b]133;A\x07$ ls\r\n\x1b]133;A\x07$ ");
    expect(osc.getCommands()).toHaveLength(2);

    await resetTerminalForNewSession(term, { cursorBlink: true });

    expect(osc.getCommands()).toEqual([]);
  });

  it("is idempotent on a terminal that is already pristine", async () => {
    const term = productionTerminal();

    await resetTerminalForNewSession(term, { cursorBlink: true });
    await resetTerminalForNewSession(term, { cursorBlink: true });

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

  it.each([
    ["a DECRQSS query", "\x1bP$q"],
    ["a title", "\x1b]2;half a title"],
  ])("abandons %s the program died inside, sending nothing", async (_label, fragment) => {
    // A reply here would reach onData — "press any key" — and respawn the
    // shell with no key pressed.
    const term = productionTerminal();
    await writeParsed(term, fragment);
    const sent: string[] = [];
    term.onData((d) => sent.push(d));

    stopUnsolicitedInput(term);
    await writeParsed(term, "[Process exited with code 1]");

    expect(sent).toEqual([]);
    expect(bufferText(term)).toContain("[Process exited with code 1]");
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
