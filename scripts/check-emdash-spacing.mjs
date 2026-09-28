#!/usr/bin/env node
/**
 * Check em-dash spacing in markdown files.
 * Rule: Em-dashes in English text should have spaces around them: "word — word"
 *
 * Skips:
 * - Code blocks (fenced and indented)
 * - Inline code
 * - URLs
 * - CJK text (different rules apply)
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** Directories never checked: generated output, vendored code, maintainer-local notes. */
const SKIP_DIRS = new Set(["node_modules", "dist", ".vitepress", ".git", "target", "dev-docs"]);

/**
 * The markdown files git would publish: tracked plus untracked-but-not-ignored
 * — the population `check-no-nul-bytes.mjs` reads. A filesystem walk also read
 * gitignored local files (a `.cc-suite/audits/` findings file, scratch notes)
 * and failed a repository check on text that is not in the repository.
 */
function findMarkdownFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((f) => f !== "" && existsSync(f))
    .filter((f) => !f.split("/").some((part) => SKIP_DIRS.has(part)))
    .filter((f) => f.split("/").pop() !== "CHANGELOG.md");
}

const args = process.argv.slice(2);
const files = args.length ? args : findMarkdownFiles();

// Em-dash character
const EM_DASH = "—";

// CJK character ranges
const CJK_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/;

// Pattern: word character + em-dash + word character (no spaces)
// This catches "word—word" but not "word — word"
const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");

  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track fenced code blocks
    if (line.trimStart().startsWith("```") || line.trimStart().startsWith("~~~")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip inside code blocks
    if (inCodeBlock) continue;

    // Skip indented code blocks (4+ spaces or tab at start)
    if (/^(?:    |\t)/.test(line)) continue;

    // Find em-dashes in the line
    let pos = 0;
    while ((pos = line.indexOf(EM_DASH, pos)) !== -1) {
      const before = line[pos - 1];
      const after = line[pos + 1];

      // Skip if inside inline code
      const beforeLine = line.slice(0, pos);
      const afterLine = line.slice(pos + 1);
      const backticksBefore = (beforeLine.match(/`/g) || []).length;
      if (backticksBefore % 2 === 1) {
        pos++;
        continue;
      }

      // Skip if adjacent to CJK characters (different rules)
      if ((before && CJK_RANGE.test(before)) || (after && CJK_RANGE.test(after))) {
        pos++;
        continue;
      }

      // Skip double em-dash "——" (valid CJK punctuation)
      if (before === EM_DASH || after === EM_DASH) {
        pos++;
        continue;
      }

      // Check for missing spaces
      const needsSpaceBefore = before && /\w/.test(before);
      const needsSpaceAfter = after && /\w/.test(after);

      if (needsSpaceBefore || needsSpaceAfter) {
        // Extract context
        const start = Math.max(0, pos - 15);
        const end = Math.min(line.length, pos + 16);
        const context = line.slice(start, end);

        violations.push({
          file,
          line: lineNum,
          col: pos + 1,
          context: context.trim(),
        });
      }

      pos++;
    }
  }
}

if (violations.length > 0) {
  console.error("Em-dash spacing violations (use spaces: word — word):\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}`);
    console.error(`    Found: ...${v.context}...`);
    console.error("");
  }
  console.error(`Found ${violations.length} violation(s). Em-dashes should have spaces around them in English.`);
  process.exit(1);
}

console.log("Em-dash spacing check passed.");
