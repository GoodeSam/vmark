/**
 * Both builds of the installed `mdast-util-from-markdown`, loaded by path.
 *
 * The package ships two copies of its code: `dev/` behind the `development`
 * export condition, which vitest resolves, and `lib/` behind `default`, which
 * the production bundle ships. `patches/mdast-util-from-markdown@2.0.3.patch`
 * edits each separately, so a test that only goes through remark-parse checks
 * only `dev/`. Loading each entry by path checks what ships too.
 *
 * @coordinates-with listPreparation.differential.test.ts — output equivalence, both builds
 * @coordinates-with pathologicalScaling.test.ts — growth of the shipped build
 * @coordinates-with patches/mdast-util-from-markdown@2.0.3.patch — what both builds carry
 * @module utils/markdownPipeline/__tests__/pathological/fromMarkdownBuilds
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

type FromMarkdown = (
  markdown: string,
  options: { extensions: unknown[]; mdastExtensions: unknown[] },
) => unknown;

export type Build = "development" | "production";
export const BUILDS: readonly Build[] = ["development", "production"];

const ENTRY: Record<Build, string> = { development: "dev/index.js", production: "index.js" };
const IMPLEMENTATION: Record<Build, string> = { development: "dev/lib/index.js", production: "lib/index.js" };

/** sha256 of each build's implementation file in the pristine 2.0.3 tarball. */
export const PRISTINE_SHA256: Record<Build, string> = {
  development: "bc4760bec02ae905b362fbe7eb7dd935ceb49cfcff8728c6cc07f5940a1a26c8",
  production: "2b19a9873232679ef08429e08c5836c865a54d8113ae5d58cb9409a60863727b",
};

/**
 * The installed package's directory, found the way remark-parse finds it. The
 * resolved entry depends on the export conditions in force (vitest adds
 * `development`), so walk up from it to the package's own `package.json`.
 */
function packageRoot(): string {
  const remarkParse = createRequire(import.meta.url).resolve("remark-parse");
  let dir = dirname(createRequire(remarkParse).resolve("mdast-util-from-markdown"));
  while (dirname(dir) !== dir) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string };
      if (manifest.name === "mdast-util-from-markdown") return dir;
    } catch {
      // No package.json here; keep walking up.
    }
    dir = dirname(dir);
  }
  throw new Error("mdast-util-from-markdown: package root not found");
}

const PACKAGE_ROOT = packageRoot();

const fromMarkdown = {} as Record<Build, FromMarkdown>;
for (const build of BUILDS) {
  const url = pathToFileURL(join(PACKAGE_ROOT, ENTRY[build])).href;
  fromMarkdown[build] = ((await import(url)) as { fromMarkdown: FromMarkdown }).fromMarkdown;
}

/** Stock syntax only: GFM (with VMark's `singleTilde: false`) and math. */
const syntax = unified().use(remarkGfm, { singleTilde: false }).use(remarkMath).freeze().data() as {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
};
const EXTENSIONS: unknown[] = syntax.micromarkExtensions ?? [];
export const MDAST_EXTENSIONS: unknown[] = syntax.fromMarkdownExtensions ?? [];

/** Parse as remark-parse would, with one build of from-markdown. */
export function parseWith(build: Build, markdown: string, mdastExtensions: unknown[] = []): unknown {
  return fromMarkdown[build](markdown, {
    extensions: EXTENSIONS,
    mdastExtensions: [...MDAST_EXTENSIONS, ...mdastExtensions],
  });
}

/** sha256 of the installed build's implementation file. */
export function implementationSha256(build: Build): string {
  const source = readFileSync(join(PACKAGE_ROOT, IMPLEMENTATION[build]));
  return createHash("sha256").update(source).digest("hex");
}

/** Where the build's implementation lives, for messages. */
export function implementationPath(build: Build): string {
  return IMPLEMENTATION[build];
}
