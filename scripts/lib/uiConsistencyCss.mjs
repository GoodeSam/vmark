/**
 * WI-UI0.3 — CSS-side checks of the ui-consistency gate (C3, C4, C5, C8, C9,
 * C11, and C10's class→focus-paint map). Pure functions over source text; the
 * CLI owns files, the baseline and the exit code.
 *
 * Shared exemption grammar: `/* ui-ok(<check>): <reason> *\/` INSIDE the rule
 * body, `<check>` ∈ overlay|target|state|font|icon|height|focus|float. A marker
 * with no reason (or punctuation only) is refused — the same rule as
 * `focus: caret-only` and `button-shape-ok`.
 *
 * @coordinates-with scripts/check-ui-consistency.mjs — the CLI
 * @coordinates-with scripts/lib/uiConsistencyTsx.mjs — the TSX half
 * @coordinates-with scripts/lib/cssRules.mjs — the one CSS grammar
 */
import { cssRules, stripComments } from "./cssRules.mjs";

const UI_OK_RE = /ui-ok\((overlay|target|state|font|icon|height|focus|float)\)\s*:\s*([^*]*)/g;

/** Markers present in a rule's RAW body text (comments included). */
export function uiOkMarkers(rawBody) {
  const out = new Map();
  const problems = [];
  UI_OK_RE.lastIndex = 0;
  for (const m of rawBody.matchAll(UI_OK_RE)) {
    const reason = m[2].trim().replace(/[—–\-\s]+$/g, "");
    if (reason.length === 0 || /^[^\w]+$/.test(reason)) {
      problems.push(`ui-ok(${m[1]}) marker has no reason — state why, or delete the marker.`);
    } else {
      out.set(m[1], reason);
    }
  }
  return { markers: out, problems };
}

/** `:root` token map from index.css, with one level of var() resolved. */
export function indexTokens(indexCss) {
  const tokens = new Map();
  for (const rule of cssRules(indexCss)) {
    const sel = rule.selector.split(";").pop().trim();
    if (sel !== ":root") continue;
    for (const m of rule.body.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)/g)) {
      tokens.set(m[1], m[2].trim());
    }
  }
  for (const [k, v] of tokens) {
    const alias = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(v);
    if (alias && tokens.has(alias[1])) tokens.set(k, tokens.get(alias[1]));
  }
  return tokens;
}

/** Resolve a declaration value to a number where possible (`var(--z-popup)` → 9999). */
function resolveNumeric(value, tokens) {
  const v = value.trim();
  const varRef = /^var\(\s*(--[A-Za-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(v);
  const raw = varRef ? (tokens.get(varRef[1]) ?? "") : v;
  const num = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(raw.trim());
  return num ? Number(num[1]) : null;
}

const EDITOR_SCOPE_RE = /\.tiptap-editor|\.ProseMirror|\.source-editor|\.cm-|\.editor-content|\.markdown-body/;

function isEditorScoped(selector) {
  return EDITOR_SCOPE_RE.test(selector);
}

/** Iterate rules of a file WITH raw body (markers) and comment-blanked body. */
function* rulesWithMarkers(css) {
  // cssRules blanks comments in the body, which erases the markers — but the
  // blanking is LENGTH-PRESERVING, so the blanked offsets map 1:1 into the
  // original text. Slice the raw views from the original rather than re-walking
  // it with the grammar: a comment containing `{` or `}` desynchronizes an
  // index-paired second walk, misattributing every later rule's markers.
  // rawSelector spans from the END of the previous rule, so a marker comment
  // ABOVE the rule (the documented `focus: caret-only` placement) stays
  // attached to the rule it precedes.
  let prevEnd = 0;
  for (const rule of cssRules(css)) {
    yield {
      ...rule,
      rawBody: css.slice(rule.bodyIndex, rule.bodyIndex + rule.body.length),
      rawSelector: css.slice(prevEnd, rule.bodyIndex - 1),
    };
    prevEnd = rule.bodyIndex + rule.body.length + 1;
  }
}

/** C3 — chrome font-size must be a token; editor em ratios are exempt. */
export function checkFontSize(css, file, { problems }) {
  const findings = [];
  for (const rule of rulesWithMarkers(css)) {
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    for (const m of rule.body.matchAll(/(?:^|[;{])\s*font-size\s*:\s*([^;}]+)/g)) {
      const value = m[1].trim();
      if (/var\(--(?:font-size|editor-font-size)/.test(value)) continue;
      if (/^(inherit|unset|initial)$/.test(value)) continue;
      if (isEditorScoped(rule.selector) && /(em|%)\s*$/.test(value)) continue;
      if (markers.has("font")) continue;
      findings.push({
        check: "C3",
        id: `${file}:${rule.selector}`,
        message: `${file}:${rule.line} font-size: ${value} — chrome type uses a --font-size-* token (or an em ratio under an editor selector). See rule 31.`,
      });
      break; // one identity per rule
    }
  }
  return findings;
}

/** C4 — a fixed, high-z shell whose panel is not a canonical class. */
export function checkOverlayShell(css, file, tokens, { problems }) {
  const zFloor = resolveNumeric("var(--z-context-menu)", tokens) ?? 1000;
  let shellRule = null;
  for (const rule of rulesWithMarkers(css)) {
    if (!/position\s*:\s*fixed/.test(rule.body)) continue;
    const z = /(?:^|[;{])\s*z-index\s*:\s*([^;}]+)/.exec(rule.body);
    if (!z) continue;
    const zv = resolveNumeric(z[1], tokens);
    if (zv === null || zv < zFloor) continue;
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    if (markers.has("overlay")) continue;
    if (/\.(popup-container|media-popup|vm-overlay|vm-menu)\b/.test(rule.selector)) continue;
    shellRule = shellRule ?? rule;
  }
  if (!shellRule) return [];
  // Panel: the shell rule itself, or a sibling rule with the popup surface.
  let panel = null;
  for (const rule of rulesWithMarkers(css)) {
    const hasShadow = /box-shadow\s*:\s*var\(--popup-shadow/.test(rule.body);
    const hasBorderPanel =
      /(?:^|[;{])\s*border\s*:/.test(rule.body) && /border-radius\s*:\s*var\(--radius-lg\)/.test(rule.body);
    if (!hasShadow && !hasBorderPanel) continue;
    if (/\.(popup-container|media-popup|vm-overlay|vm-menu)\b/.test(rule.selector)) return [];
    const { markers } = uiOkMarkers(rule.rawBody);
    if (markers.has("overlay")) return [];
    panel = panel ?? rule;
  }
  const key = panel ?? shellRule;
  return [
    {
      check: "C4",
      id: `${file}:${key.selector}`,
      message: `${file}:${key.line} ${key.selector}: overlay/popup shell restated — use .vm-overlay__panel/.vm-menu/.popup-container (WI-UI3.1/3.2), or mark the rule ui-ok(overlay): <reason>.`,
    },
  ];
}

/** C5 — var(--font-sans) belongs to the document, not chrome. */
export function checkFontSans(css, file, { problems }) {
  const findings = [];
  for (const rule of rulesWithMarkers(css)) {
    if (!/var\(--font-sans\b/.test(rule.body)) continue;
    if (isEditorScoped(rule.selector)) continue;
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    if (markers.has("font")) continue;
    findings.push({
      check: "C5",
      id: `${file}:${rule.selector}`,
      message: `${file}:${rule.line} ${rule.selector}: --font-sans is the READING font (written from settings); chrome uses var(--font-ui) (WI-UI2.1).`,
    });
  }
  return findings;
}

const TARGETY_SELECTOR = /(btn|button|-close\b|-toggle\b|handle|chevron|arrow|-action\b|-tab\b)/;

/** C8 — clickable smaller than the 24px target floor with no expander. */
export function checkTargets(css, file, tokens, { problems }) {
  const findings = [];
  const expanders = new Set();
  for (const rule of rulesWithMarkers(css)) {
    if (/::(before|after)/.test(rule.selector) && /position\s*:\s*absolute/.test(rule.body)) {
      expanders.add(rule.selector.replace(/::(before|after).*$/, "").trim());
    }
  }
  const seen = new Set();
  for (const rule of rulesWithMarkers(css)) {
    if (/::(before|after)/.test(rule.selector)) continue;
    const base = rule.selector;
    if (!TARGETY_SELECTOR.test(base)) continue;
    if (/\b(svg|img|span|i)\s*$/.test(base)) continue; // glyph child, not the hit box
    if (/:(hover|active|focus|disabled)/.test(base)) continue; // state variants restate the box
    let below = false;
    for (const m of rule.body.matchAll(/(?:^|[;{])\s*(width|height|min-width|min-height)\s*:\s*([^;}]+)/g)) {
      const n = resolveNumeric(m[2], tokens);
      if (n !== null && n > 0 && n < 24) below = true;
    }
    if (!below) continue;
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    if (markers.has("target")) continue;
    if ([...expanders].some((e) => base.startsWith(e))) continue;
    const id = `${file}:${base}`;
    if (seen.has(id)) continue; // the @media (pointer: coarse) branch is the same class
    seen.add(id);
    findings.push({
      check: "C8",
      id,
      message: `${file}:${rule.line} ${base}: hit target under 24px with no ::before expander — grow the hit box (WI-UI2.3) or mark ui-ok(target): spaced.`,
    });
  }
  return findings;
}

const HOVER_VOCAB = ["--hover-bg", "--hover-bg-strong", "--bg-tertiary", "--subtle-bg", "--subtle-bg-hover"];
const ACTIVE_VOCAB = ["--hover-bg-strong", "--accent-bg"];
const SELECTED_VOCAB = ["--accent-bg"];
/** Selector families whose state fills are sanctioned elsewhere, with where. */
const SANCTIONED = [
  /context-menu|-menu__item|menu-item/, // rule 32 "Popups": a hovered menu item takes the accent fill
  /::-webkit-scrollbar/, // rule 32 "Other patterns": scrollbar thumb colours
  /resize-handle|divider/, // resize handles light up on drag, not a selection
  /\.vm-btn|\.popup-icon-btn|\.universal-toolbar-btn|\.toolbar-btn/, // canonical controls own their states
];
/**
 * Semantic fills are judged by VALUE: a danger/success state may take its
 * token. (A selector that merely SAYS "error" once exempted any fill at all.)
 */
const SEMANTIC_FILL = /var\(\s*--(?:error|danger|warning|success)[-\w]*/;

/**
 * A selected / checked / pressed / current state, in every spelling the
 * codebase uses: `.active`/`.selected`/`.is-selected`-style classes, BEM
 * `--active` modifiers, ARIA and data-* state attributes, `:checked`. An
 * attribute EXPLICITLY false (`[aria-selected="false"]`) is the opposite of a
 * selection, and `.is-loading`-style classes are not selections at all.
 */
const SELECTION_WORD = "selected|active|checked|current|pressed";
const SELECTED_STATE = new RegExp(
  `\\.(?:is-)?(?:${SELECTION_WORD})\\b(?!-)|--(?:${SELECTION_WORD}|on)\\b|\\[data-(?:active|selected|checked|pinned)\\s*(?:\\]|=(?!\\s*["']?\\s*false))|\\[aria-(?:selected|checked|pressed|current)\\s*(?:\\]|=(?!\\s*["']?\\s*false))|:checked\\b`,
);
/** Accent inks a selected LABEL must not take (R6: selection keeps its ink). */
const ACCENT_INK = /(?:^|[;{\s])color\s*:\s*var\(\s*(--accent-primary|--primary-color|--browser-accent-primary)\b/;
/** Where accent ink IS the design: the selection's icon or indicator — read on the TARGET only. */
const INDICATOR_TARGET = /::?(before|after)\b|^svg\b|^path\b|\s(svg|path)\b|[-_](icon|check|dot|glyph|indicator|chevron|caret)\b/;

/** Split a selector list on top-level commas (not inside `()` or `[]`). */
function splitSelectorList(selector) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** A selector in a selected state — `:not(...)` and explicit false excluded. */
function isSelectedSelector(selector) {
  // A state inside :not(...) is the OPPOSITE of a selection.
  return SELECTED_STATE.test(selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ""));
}

/** The last compound of a selector — the element the rule actually styles. */
function targetCompound(selector) {
  const parts = selector.split(/\s+|\s*[>+~]\s*/).filter(Boolean);
  return parts[parts.length - 1] ?? selector;
}

/**
 * C9 (ink) — a selected label keeps --text-color (rule 30, R6).
 *
 * The background half reads only `background`, so `color:
 * var(--accent-primary)` on a selected TEXT label passed everywhere, including
 * the canonical `.vm-chip--toggle`. Both halves read selection through
 * `isSelectedSelector` — BEM modifiers, ARIA and data-* states, `:not()` and
 * explicit false excluded — which the background half once lacked. Each selector in a list is
 * judged on its own; indicator words are read from its TARGET compound only
 * (an ancestor named `.list-check` does not make `.row.active` an icon).
 * Icon-only controls, whose glyph IS the indicator, say so with
 * `ui-ok(state): <reason>`.
 */
function checkSelectionInk(css, file, { problems }) {
  const findings = [];
  for (const rule of rulesWithMarkers(css)) {
    if (!ACCENT_INK.test(rule.body)) continue;
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    if (markers.has("state")) continue;
    for (const selector of splitSelectorList(rule.selector)) {
      if (!isSelectedSelector(selector)) continue;
      if (INDICATOR_TARGET.test(targetCompound(selector)) || /::?(before|after)\b/.test(selector)) continue;
      findings.push({
        check: "C9",
        id: `${file}:${selector} (ink)`,
        message: `${file}:${rule.line} ${selector}: a selected label in accent ink — selection keeps its ink (rule 30, R6): var(--accent-bg) fill, color var(--text-color); accent goes on the icon/indicator. Icon-only control? ui-ok(state): <reason>.`,
      });
    }
  }
  return findings;
}

/** C9 — hover/active/selected backgrounds speak the state vocabulary. */
export function checkStateVocabulary(css, file, { problems }) {
  const findings = checkSelectionInk(css, file, { problems });
  const seen = new Set();
  // R5 (WI-UI1.3) — tertiary is decorative/disabled ink: an ENABLED control
  // (`-btn|-toggle|-close` selector outside :disabled) may not rest at
  // `--text-tertiary`. Measured 0 after the WI, so no baseline entries exist
  // and none may be added.
  for (const rule of rulesWithMarkers(css)) {
    if (!/(-btn\b|-toggle\b|-close\b)/.test(rule.selector)) continue;
    if (/:disabled|\[disabled\]|::(before|after)/.test(rule.selector)) continue;
    if (!/(?:^|[;{])\s*color\s*:\s*var\(--text-tertiary\)/.test(rule.body)) continue;
    const { markers } = uiOkMarkers(rule.rawBody);
    if (markers.has("state")) continue;
    findings.push({
      check: "C9",
      id: `${file}:${rule.selector}`,
      message: `${file}:${rule.line} ${rule.selector}: an enabled control resting at --text-tertiary — decorative/disabled ink only (R5); rest at --text-secondary.`,
    });
  }
  for (const rule of rulesWithMarkers(css)) {
    const bg = /(?:^|[;{])\s*background(?:-color)?\s*:\s*([^;}]+)/.exec(rule.body);
    if (!bg) continue;
    const value = bg[1].trim();
    if (/^(transparent|none|inherit|unset|initial)$/.test(value) || SEMANTIC_FILL.test(value)) continue;
    let markers = null;
    // Each selector in a list is judged on its own, with the same selected-
    // state reading as the ink half: BEM `--active`, ARIA and data-* states.
    for (const selector of splitSelectorList(rule.selector)) {
      if (/::(before|after)/.test(selector)) continue; // indicators, not fills
      const isHover = /:hover/.test(selector);
      const isActivePseudo = /:active\b/.test(selector);
      const isSelected = isSelectedSelector(selector);
      if (!isHover && !isActivePseudo && !isSelected) continue;
      if (SANCTIONED.some((re) => re.test(selector))) continue;
      const vocab = isSelected ? SELECTED_VOCAB : isHover ? HOVER_VOCAB : ACTIVE_VOCAB;
      if (vocab.some((t) => value.includes(`var(${t}`) || value.includes(`var(${t})`))) continue;
      if (HOVER_VOCAB.concat(ACTIVE_VOCAB, SELECTED_VOCAB).some((t) => value.includes(t)) && !isSelected) continue;
      if (!markers) {
        const parsed = uiOkMarkers(rule.rawBody);
        problems.push(...parsed.problems.map((p) => `${file}:${rule.selector}: ${p}`));
        markers = parsed.markers;
      }
      if (markers.has("state")) break;
      const id = `${file}:${selector}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const want = isSelected
        ? "selected rows use var(--accent-bg) (+ color var(--text-color))"
        : isHover
          ? "hover uses --hover-bg/--hover-bg-strong/--bg-tertiary/--subtle-bg"
          : ":active uses --hover-bg-strong";
      findings.push({
        check: "C9",
        id,
        message: `${file}:${rule.line} ${selector} background: ${value} — ${want} (rule 30/32), or ui-ok(state): <reason>.`,
      });
    }
  }
  return findings;
}

/** Overlay families whose job IS to sit above content on a high layer. */
const OVERLAY_FAMILY =
  /popup|popover|menu|dropdown|tooltip|toast|overlay|backdrop|dialog|modal|picker|palette|finder|context|suggest|autocomplete|hover-card/i;

/**
 * C12 — nothing floats over content without a stated reason.
 *
 * The split-pane view-mode toggle was `position: absolute` at --z-toolbar,
 * pinned top-right over the panes, where it lay across the HTML trust bar,
 * the read-only banner and source text. C4 reads only `fixed` overlays at
 * --z-context-menu and above, so no check looked at it. A positioned element
 * on a layer at or above --z-bar is either an overlay family (what those
 * layers are for), the layer's owner in rule 32's z-table, or something that
 * covers content on purpose — the last two say so with ui-ok(float): <reason>.
 *
 * Judged PER SELECTOR, with `position` and `z-index` merged across every rule
 * in the file that names that selector: an overlay neighbour in a selector
 * list exempts nothing, and splitting the two declarations into separate rules
 * does not hide the pair. `calc(var(--z-x) ± n)` resolves.
 */
export function checkFloatingOverContent(css, file, tokens, { problems }) {
  const barLayer = resolveNumeric("var(--z-bar)", tokens) ?? 100;
  const contextAt = atRuleContexts(css);
  /** Every position/z-index declaration, in source order, with its context path. */
  const events = [];
  const contexts = new Set([""]);
  const floatOk = new Set();
  const lines = new Map();
  for (const rule of rulesWithMarkers(css)) {
    const path = contextAt(rule.index);
    if (path.some((p) => /^@(-\w+-)?keyframes\b/.test(p))) continue; // animation steps, not boxes
    const positions = [...rule.body.matchAll(/(?:^|[;{\s])position\s*:\s*([a-z-]+)/g)];
    const zs = [...rule.body.matchAll(/(?:^|[;{\s])z-index\s*:\s*([^;}]+)/g)];
    if (positions.length === 0 && zs.length === 0) continue;
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    // Within one rule the LAST declaration of each property applies.
    const position = positions.length ? positions[positions.length - 1][1] : undefined;
    const layer = zs.length ? resolveZ(zs[zs.length - 1][1], tokens) : undefined;
    const key = path.join(" > ");
    contexts.add(key);
    for (const selector of splitSelectorList(rule.selector)) {
      events.push({ selector, key, position, layer });
      if (markers.has("float")) floatOk.add(selector);
      if (!lines.has(selector)) lines.set(selector, rule.line);
    }
  }
  const applies = (eventKey, target) => eventKey === "" || target === eventKey || target.startsWith(`${eventKey} > `);
  const covers = (st) => (st.position === "absolute" || st.position === "fixed") && st.layer != null && st.layer >= barLayer;
  const findings = [];
  for (const selector of new Set(events.map((e) => e.selector))) {
    if (OVERLAY_FAMILY.test(selector) || floatOk.has(selector)) continue;
    // The cascade, per context: in source order, apply every declaration whose
    // context is this one or an ancestor of it. A later unconditional reset
    // therefore overrides an earlier @media rule, and a nested @supports
    // z-index composes with its @media's position.
    let hit = null;
    for (const target of contexts) {
      const st = {};
      for (const e of events) {
        if (e.selector !== selector || !applies(e.key, target)) continue;
        if (e.position !== undefined) st.position = e.position;
        if (e.layer !== undefined) st.layer = e.layer;
      }
      if (covers(st)) {
        hit = st;
        break;
      }
    }
    if (!hit) continue;
    findings.push({
      check: "C12",
      id: `${file}:${selector}`,
      message: `${file}:${lines.get(selector)} ${selector}: positioned at z-index ${hit.layer} (>= --z-bar) — it can cover content. Put it in flow (a header row, a docked slot), or mark ui-ok(float): <why it may cover content> (rule 32).`,
    });
  }
  return findings;
}

/**
 * index -> enclosing at-rule preludes, outermost first ([] at top level), by
 * brace matching on comment-blanked text with quoted strings skipped (a "}"
 * inside `content: "}"` is not a brace). cssRules reads flat text, so a rule
 * inside `@media` comes back with the same selector as the base rule; C12
 * must not merge the two.
 */
function atRuleContexts(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const ranges = [];
  const stack = [];
  let segmentStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      for (i += 1; i < text.length && text[i] !== ch; i += 1) if (text[i] === "\\") i += 1;
      continue;
    }
    if (ch === "{") {
      const prelude = text.slice(segmentStart, i).trim();
      stack.push({ prelude: prelude.startsWith("@") ? prelude.replace(/\s+/g, " ") : null, start: i });
      segmentStart = i + 1;
    } else if (ch === "}") {
      const open = stack.pop();
      if (open && open.prelude) ranges.push({ start: open.start, end: i, prelude: open.prelude });
      segmentStart = i + 1;
    } else if (ch === ";") {
      segmentStart = i + 1;
    }
  }
  return (index) =>
    ranges
      .filter((r) => r.start < index && index < r.end)
      .sort((a, b) => a.start - b.start)
      .map((r) => r.prelude);
}

/** A z-index value to a number: a literal, a token, or calc(token ± n). */
function resolveZ(value, tokens) {
  const direct = resolveNumeric(value, tokens);
  if (direct !== null) return direct;
  const calc = /^calc\(\s*var\(\s*(--[\w-]+)\s*\)\s*([+-])\s*(\d+)\s*\)$/.exec(value.trim());
  if (!calc) return null;
  const base = resolveNumeric(`var(${calc[1]})`, tokens);
  if (base === null) return null;
  return calc[2] === "+" ? base + Number(calc[3]) : base - Number(calc[3]);
}

/** C11 — bar-height literals and z-index literals outside index.css. */
export function checkHeightsAndZ(css, file, { problems }) {
  const findings = [];
  const seen = new Set();
  for (const rule of rulesWithMarkers(css)) {
    const { markers, problems: mp } = uiOkMarkers(rule.rawBody);
    problems.push(...mp.map((p) => `${file}:${rule.selector}: ${p}`));
    const declaresLocalHeightVar = /--[A-Za-z0-9-]*height\s*:/.test(rule.body);
    for (const m of rule.body.matchAll(/(?:^|[;{])\s*(height|min-height)\s*:\s*(40|38|28|22)px\s*[;}]?/g)) {
      if (declaresLocalHeightVar || markers.has("height")) continue;
      const id = `${file}:${rule.selector}`;
      if (seen.has(id)) continue;
      seen.add(id);
      findings.push({
        check: "C11",
        id,
        message: `${file}:${rule.line} ${rule.selector}: ${m[1]}: ${m[2]}px — this is a bar height; consume var(--bar-height)/the owning token (WI-UI3.5) or declare a local --*-height var (rule 31).`,
      });
    }
    for (const m of rule.body.matchAll(/(?:^|[;{])\s*z-index\s*:\s*(-?\d+)\s*[;}]?/g)) {
      const z = Number(m[1]);
      if (z <= 2) continue;
      findings.push({
        check: "C11z",
        id: `${file}:${rule.selector}`,
        message: `${file}:${rule.line} ${rule.selector}: z-index: ${z} — use the --z-* stack (rule 31); literals fork the stacking order.`,
      });
    }
  }
  return findings;
}

/** A value that renders nothing, so it cannot serve as a focus indicator. */
const INVISIBLE = /^\s*(none|transparent|0|initial|unset|inherit)\s*$/;
const INDICATOR_PROP = /(?:^|[;{])\s*(background(?:-color)?|outline|border(?:-[a-z]+)*|box-shadow|text-decoration)\s*:\s*([^;}]+)/g;

/**
 * C10's CSS half: the set of class names that paint something on
 * :focus/:focus-visible (or carry the declared caret-only marker).
 */
export function focusPaintedClasses(css) {
  const covered = new Set();
  for (const rule of rulesWithMarkers(css)) {
    // Pseudo-class and class collection use the comment-stripped selector;
    // the caret-only marker is read from the RAW views (comments included),
    // where the documented placement is a comment above the rule.
    // `:not(:focus-visible)` is a NEGATIVE focus state — blank :not() groups
    // first, or a hover rule that yields to focus reads as focus coverage
    // (universal-toolbar.css's hover rule was exactly that).
    const selector = rule.selector.replace(/:not\([^)]*\)/g, ":not()");
    const body = rule.rawBody;
    if (!/:focus(-visible|-within)?\b/.test(selector)) continue;
    let paints = false;
    INDICATOR_PROP.lastIndex = 0;
    let d;
    while ((d = INDICATOR_PROP.exec(stripComments(body))) !== null) {
      if (!INVISIBLE.test(d[2])) paints = true;
    }
    const caretOnly = /focus:\s*caret-only\s*[—–-]\s*\S/.test(rule.rawSelector) || /focus:\s*caret-only\s*[—–-]\s*\S/.test(body);
    if (!paints && !caretOnly) continue;
    // Only the compound selector that CARRIES the :focus pseudo-class is
    // focus-painted. Collecting every class in the selector marks ancestor
    // context classes (`.tiptap-editor .btn:focus-visible` covering
    // `tiptap-editor`) as covered, masking real C10 gaps.
    for (const part of selector.split(",")) {
      for (const compound of part.split(/[\s>+~]+/)) {
        if (!/:focus(-visible|-within)?\b/.test(compound)) continue;
        for (const cls of compound.matchAll(/\.([A-Za-z_][\w-]*)/g)) covered.add(cls[1]);
      }
    }
  }
  return covered;
}
