/**
 * Purpose: read ONE test file's use of the clock off its syntax tree, for
 *   `check-test-timer-isolation.mjs`.
 *
 * Three questions, each answered on the AST rather than by matching text, so a
 * `Date.now()` in a comment or a `setTimeout` in a string is not an answer:
 *
 *   - does the file CONTROL the clock? (`useFakeTimers()`, `setSystemTime()`,
 *     or `spyOn(Date, …)`)
 *   - where does it READ the wall clock? (`Date.now()`, `new Date()` with no
 *     argument — `new Date(0)` names an instant and is deterministic)
 *   - where does it SLEEP on the wall clock? (`new Promise(r => setTimeout(r,
 *     N))` with a literal N, directly or through a helper defined in the same
 *     file and called with a literal)
 *
 * Key decisions:
 *   - A sleep helper is recognized only when it is declared in the file being
 *     read. One imported from a shared test utility is not followed: resolving
 *     imports would make this a module graph, and the inline idiom is the
 *     overwhelming majority.
 *   - A duration that is not a numeric literal is not reported. The gate
 *     reports what it can prove, and a threshold needs a number.
 *
 * @coordinates-with scripts/check-test-timer-isolation.mjs — the gate that applies the rules
 * @module scripts/check-test-timer-isolation.scan
 */
import ts from "typescript";

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** `vi.useFakeTimers` -> "useFakeTimers"; `useFakeTimers` -> "useFakeTimers". */
function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

const isDateIdentifier = (node) => node !== undefined && ts.isIdentifier(node) && node.text === "Date";

/** The numeric value of a literal duration (`200`, `1_000`), else null. */
function literalMs(node) {
  if (node === undefined || !ts.isNumericLiteral(node)) return null;
  const value = Number(node.text);
  return Number.isFinite(value) ? value : null;
}

/** `setTimeout(...)` / `window.setTimeout(...)` / `globalThis.setTimeout(...)`. */
function isSetTimeoutCall(node) {
  return ts.isCallExpression(node) && calleeName(node.expression) === "setTimeout";
}

/**
 * If `node` is `new Promise(<fn>)` whose executor resolves through
 * `setTimeout(<its first parameter>, <delay>)`, return that delay expression.
 *
 * The resolver must be the executor's own first parameter: a timeout-GUARD
 * (`new Promise((_, reject) => setTimeout(reject, n))`) is not a sleep, and
 * neither is a promise that schedules unrelated work.
 */
function sleepDelayOf(node) {
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "Promise") {
    return undefined;
  }
  const executor = node.arguments?.[0];
  if (!executor || !(ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))) return undefined;
  const resolver = executor.parameters[0]?.name;
  if (!resolver || !ts.isIdentifier(resolver)) return undefined;

  let delay;
  const visit = (child) => {
    if (delay !== undefined) return;
    if (isSetTimeoutCall(child)) {
      const [callback, ms] = child.arguments;
      const resolvesDirectly = callback && ts.isIdentifier(callback) && callback.text === resolver.text;
      // `setTimeout(() => resolve(), n)` and `setTimeout(() => resolve(value), n)`.
      const resolvesInArrow =
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        callback.getText().includes(`${resolver.text}(`);
      if ((resolvesDirectly || resolvesInArrow) && ms !== undefined) {
        delay = ms;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(executor.body);
  return delay;
}

/**
 * Names of sleep helpers declared in this file, mapped to the index of the
 * parameter that carries the duration: `const sleep = (ms) => new Promise(r =>
 * setTimeout(r, ms))` -> `{ sleep: 0 }`.
 */
function sleepHelpers(sf) {
  const helpers = new Map();
  const consider = (name, fn) => {
    if (!name || !fn?.parameters) return;
    let found;
    const visit = (child) => {
      if (found !== undefined) return;
      const delay = sleepDelayOf(child);
      if (delay !== undefined && ts.isIdentifier(delay)) {
        const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === delay.text);
        if (index !== -1) found = index;
        return;
      }
      ts.forEachChild(child, visit);
    };
    if (fn.body) visit(fn.body);
    if (found !== undefined) helpers.set(name, found);
  };
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) consider(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      consider(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return helpers;
}

/**
 * Read one test file.
 *
 * @param {string} source
 * @param {string} [fileName] decides TS vs TSX parsing
 * @returns {{
 *   controlsClock: boolean,
 *   wallClockReads: { line: number, what: string }[],
 *   sleeps: { line: number, ms: number }[],
 * }}
 * @throws when the file does not parse — the caller reports that rather than
 *   treating an unreadable file as a clean one.
 */
export function scanTestClockUsage(source, fileName = "file.test.ts") {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const parseErrors = sf.parseDiagnostics ?? [];
  if (parseErrors.length > 0) {
    throw new Error(ts.flattenDiagnosticMessageText(parseErrors[0].messageText, " "));
  }

  const helpers = sleepHelpers(sf);
  let controlsClock = false;
  const wallClockReads = [];
  const sleeps = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "useFakeTimers" || name === "setSystemTime") controlsClock = true;
      if (name === "spyOn" && isDateIdentifier(node.arguments[0])) controlsClock = true;

      if (
        ts.isPropertyAccessExpression(node.expression) &&
        isDateIdentifier(node.expression.expression) &&
        node.expression.name.text === "now"
      ) {
        wallClockReads.push({ line: lineOf(sf, node), what: "Date.now()" });
      }

      if (ts.isIdentifier(node.expression) && helpers.has(node.expression.text)) {
        const ms = literalMs(node.arguments[helpers.get(node.expression.text)]);
        if (ms !== null) sleeps.push({ line: lineOf(sf, node), ms });
      }
    }

    if (ts.isNewExpression(node)) {
      if (isDateIdentifier(node.expression) && (node.arguments?.length ?? 0) === 0) {
        wallClockReads.push({ line: lineOf(sf, node), what: "new Date()" });
      }
      const ms = literalMs(sleepDelayOf(node));
      if (ms !== null) sleeps.push({ line: lineOf(sf, node), ms });
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { controlsClock, wallClockReads, sleeps };
}
