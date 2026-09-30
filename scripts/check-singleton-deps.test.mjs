// Self-test for check-singleton-deps: a package whose objects cross package
// boundaries must resolve to exactly ONE version in pnpm-lock.yaml.
import { describe, it, expect } from "vitest";
import { lockedVersions, singletonFindings, SINGLETONS } from "./check-singleton-deps.mjs";

const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      '@codemirror/language':
        specifier: ^6.12.4
        version: 6.12.4

packages:

  '@codemirror/language@6.12.4':
    resolution: {integrity: sha512-a}

  '@lezer/common@1.5.2':
    resolution: {integrity: sha512-b}

  '@lezer/common@1.5.3':
    resolution: {integrity: sha512-c}

  react@19.3.0:
    resolution: {integrity: sha512-d}

  zustand@4.5.7:
    resolution: {integrity: sha512-e}

  zustand@5.0.15:
    resolution: {integrity: sha512-f}

snapshots:

  '@lezer/common@1.5.2': {}
`;

describe("lockedVersions", () => {
  it("reads every resolved version from the packages section only", () => {
    const v = lockedVersions(LOCK);
    expect([...v.get("@lezer/common")]).toEqual(["1.5.2", "1.5.3"]);
    expect([...v.get("react")]).toEqual(["19.3.0"]);
    expect([...v.get("@codemirror/language")]).toEqual(["6.12.4"]);
  });

  it("reads a peer-suffixed key as its bare version", () => {
    const v = lockedVersions(`packages:\n\n  '@tiptap/core@3.1.0(@tiptap/pm@3.1.0)':\n    resolution: {}\n\nsnapshots:\n`);
    expect([...v.get("@tiptap/core")]).toEqual(["3.1.0"]);
  });
});

describe("singletonFindings", () => {
  it("flags a singleton resolved to two versions, and nothing else", () => {
    expect(singletonFindings(lockedVersions(LOCK), ["@lezer/common", "react"])).toEqual([
      "@lezer/common resolves to 2 versions: 1.5.2, 1.5.3",
    ]);
  });

  it("does not police packages outside the list (a private zustand 4 inside a dependency is fine)", () => {
    expect(singletonFindings(lockedVersions(LOCK), ["react"])).toEqual([]);
  });

  it("fails closed when a listed singleton is missing from the lockfile", () => {
    expect(singletonFindings(lockedVersions(LOCK), ["@codemirror/view"])).toEqual([
      "@codemirror/view is not in the lockfile — remove it from SINGLETONS or fix the parser",
    ]);
  });

  it("covers the editor cores whose split broke highlighting", () => {
    for (const name of ["@lezer/common", "@lezer/highlight", "@codemirror/state", "@codemirror/view", "@codemirror/language"]) {
      expect(SINGLETONS).toContain(name);
    }
  });
});
