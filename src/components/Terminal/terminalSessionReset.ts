/**
 * terminalSessionReset
 *
 * Purpose: What an xterm instance must shed at a PTY session boundary (#1471).
 * One instance outlives many PTYs — first spawn, the tab bar's restart, the
 * press-any-key respawn after a non-zero exit or a failed spawn — and xterm
 * keeps every mode the last program set until something resets it. A TUI
 * killed mid-run never does, so a restart used to hand the new shell a
 * terminal still in any-event mouse tracking: pointer motion became
 * `ESC[<35;col;rowM`, and the shell echoed `35;79;40M35;76;39M…`.
 *
 * Key decisions:
 *   - A new session starts with RIS (`ESC c`) WRITTEN IN-BAND, not
 *     `term.reset()`. xterm runs the same reset for it, but through the write
 *     queue: output the old PTY had already queued is parsed BEFORE it (a
 *     synchronous reset() ran first and that output re-armed mouse tracking),
 *     and RIS also resets the parser (reset() left it mid-sequence when the
 *     program died inside one, eating the next character).
 *   - RIS in xterm.js 6 misses state kept outside the modes it resets, so the
 *     sequence adds exactly those, each verified against xterm's own reports
 *     in terminalSessionReset.test.ts:
 *       · cursor visibility (`?25`) lives in CoreService.isCursorHidden;
 *       · `?12` (blink) and LNM (`20`) write the cursorBlink / convertEol
 *         OPTIONS, which no reset restores — blink goes back to the user's
 *         setting, LNM off (VMark leaves convertEol at xterm's default);
 *       · OSC 4/10/11/12 palette overrides live in the theme service — OSC
 *         104/110/111/112 restore the configured theme's colors.
 *   - A DEAD session (non-zero exit) keeps its buffer so the failure stays
 *     readable, which rules RIS out there. It only loses the modes that make
 *     xterm emit input with no key pressed — mouse tracking (9/1000/1002/1003)
 *     and focus reporting (1004) — because "press any key to restart" listens
 *     to onData, and a mouse move over the panel would otherwise restart the
 *     shell and wipe the message.
 *
 * @coordinates-with useTerminalShellLifecycle.ts — sole caller (startShell, exit)
 * @coordinates-with setupOsc.ts — drops OSC 133 marks when RIS wipes the buffer
 * @module components/Terminal/terminalSessionReset
 */
import type { Terminal } from "@xterm/xterm";

/** RIS — Reset to Initial State. */
const RESET_TO_INITIAL_STATE = "\x1bc";
/** DECTCEM set: RIS leaves a hidden cursor hidden in xterm.js. */
const SHOW_CURSOR = "\x1b[?25h";
/** LNM reset: backed by options.convertEol, which RIS does not restore. */
const NEWLINE_MODE_OFF = "\x1b[20l";
/** Restore the theme's ANSI palette (104), foreground (110), background (111)
 *  and cursor (112) colors over any OSC 4/10/11/12 override. */
const RESTORE_THEME_COLORS = "\x1b]104\x07\x1b]110\x07\x1b]111\x07\x1b]112\x07";
/** DECRST of every mode that makes xterm emit data with no key pressed. */
const STOP_POINTER_AND_FOCUS_REPORTS = "\x1b[?9;1000;1002;1003;1004l";

/** Cursor blink (`?12`), set to the user's setting — xterm stores it in the
 *  cursorBlink option, so a program's `?12l` outlives RIS. */
function cursorBlinkMode(cursorBlink: boolean): string {
  return cursorBlink ? "\x1b[?12h" : "\x1b[?12l";
}

/** Options for {@link resetTerminalForNewSession}. */
export interface NewSessionResetOptions {
  /** The user's cursor-blink setting, restored over whatever the last program set. */
  cursorBlink: boolean;
  /** Shown after the reset (e.g. the localized "Restarting shell…" notice). */
  statusLine?: string;
}

/**
 * Return `term` to the state a freshly created terminal is in, ordered after
 * everything already written to it, then show `statusLine`. Call before a new
 * PTY is attached. Clears the screen and scrollback.
 */
export function resetTerminalForNewSession(
  term: Pick<Terminal, "write">,
  { cursorBlink, statusLine = "" }: NewSessionResetOptions,
): void {
  term.write(
    RESET_TO_INITIAL_STATE +
      SHOW_CURSOR +
      NEWLINE_MODE_OFF +
      cursorBlinkMode(cursorBlink) +
      RESTORE_THEME_COLORS +
      statusLine,
  );
}

/**
 * Stop a terminal whose PTY has died from reporting pointer movement, clicks
 * and focus changes as input. Leaves the screen, scrollback and every other
 * mode alone.
 */
export function stopUnsolicitedInput(term: Pick<Terminal, "write">): void {
  term.write(STOP_POINTER_AND_FOCUS_REPORTS);
}
