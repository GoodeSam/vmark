// @vitest-environment node
// WI-LX2.4 — patch-queue algebra: target identity, dedup order, the bound-queue mirror, bind stash/restore, rename carry.
import { describe, expect, it } from "vitest";
import type { IRPatch } from "@/lib/ghaWorkflow/save/mutators";
import {
  bindEditDocument,
  cancelTarget,
  dedupQueue,
  mirrorActiveQueue,
  patchTarget,
  renameEditDocument,
  type EditSlice,
} from "./workflowEditQueue";

// ─── Fixtures ────────────────────────────────────────────────────────

function setName(value: string): IRPatch {
  return { kind: "workflow.set", path: "name", value };
}

function setRunsOn(jobId: string, value: string): IRPatch {
  return { kind: "job.set", jobId, path: "runs-on", value };
}

function slice(overrides: Partial<EditSlice> = {}): EditSlice {
  return {
    pendingPatches: [],
    preserveYamlFormatting: null,
    boundDocumentId: null,
    patchesByDocument: {},
    ...overrides,
  };
}

/** Deep-frozen copy, so any in-place mutation by the function under test throws. */
function frozen(s: EditSlice): EditSlice {
  for (const queue of Object.values(s.patchesByDocument)) Object.freeze(queue);
  Object.freeze(s.patchesByDocument);
  Object.freeze(s.pendingPatches);
  return Object.freeze(s);
}

const A1 = setName("A1");
const B1 = setRunsOn("build", "ubuntu-latest");
const C1 = setRunsOn("test", "macos-latest");

// ─── patchTarget ─────────────────────────────────────────────────────

describe("patchTarget — which patches are the same edit made twice", () => {
  it.each<{ name: string; a: IRPatch; b: IRPatch }>([
    {
      name: "workflow.set on one path, different values",
      a: { kind: "workflow.set", path: "env.NODE", value: "18" },
      b: { kind: "workflow.set", path: "env.NODE", value: 20 },
    },
    {
      name: "job.set on one job+path, different values",
      a: { kind: "job.set", jobId: "build", path: "timeout-minutes", value: 5 },
      b: { kind: "job.set", jobId: "build", path: "timeout-minutes", value: null },
    },
    {
      name: "step.set on one step+path",
      a: { kind: "step.set", jobId: "build", stepIndex: 2, path: "name", value: "x" },
      b: { kind: "step.set", jobId: "build", stepIndex: 2, path: "name", value: "y" },
    },
    {
      name: "with.set then with.remove of the same key (a removal supersedes a set)",
      a: { kind: "with.set", jobId: "build", stepIndex: 0, key: "node-version", value: "20" },
      b: { kind: "with.remove", jobId: "build", stepIndex: 0, key: "node-version" },
    },
    {
      name: "needs.add then needs.remove of the same ref",
      a: { kind: "needs.add", jobId: "deploy", ref: "build" },
      b: { kind: "needs.remove", jobId: "deploy", ref: "build" },
    },
    {
      name: "trigger.setFilters on one event+filter, different values",
      a: { kind: "trigger.setFilters", event: "push", filter: "branches", value: ["main"] },
      b: { kind: "trigger.setFilters", event: "push", filter: "branches", value: [] },
    },
    {
      name: "job.create of one id, different runner",
      a: { kind: "job.create", jobId: "lint" },
      b: { kind: "job.create", jobId: "lint", runsOn: "macos-latest" },
    },
    {
      name: "job.delete of one id",
      a: { kind: "job.delete", jobId: "lint" },
      b: { kind: "job.delete", jobId: "lint" },
    },
    {
      name: "step.insert of an identical step at one index",
      a: { kind: "step.insert", jobId: "build", index: 1, step: { run: "make" } },
      b: { kind: "step.insert", jobId: "build", index: 1, step: { run: "make" } },
    },
    {
      name: "step.delete of one index",
      a: { kind: "step.delete", jobId: "build", stepIndex: 0 },
      b: { kind: "step.delete", jobId: "build", stepIndex: 0 },
    },
    {
      name: "step.move with one from/to pair",
      a: { kind: "step.move", jobId: "build", fromIndex: 1, toIndex: 0 },
      b: { kind: "step.move", jobId: "build", fromIndex: 1, toIndex: 0 },
    },
    {
      name: "workflow.permissions.set, whatever the value",
      a: { kind: "workflow.permissions.set", value: "read-all" },
      b: { kind: "workflow.permissions.set", value: { contents: "write" } },
    },
    {
      name: "workflow.concurrency.set, whatever the value",
      a: { kind: "workflow.concurrency.set", value: "ci-${{ github.ref }}" },
      b: { kind: "workflow.concurrency.set", value: null },
    },
  ])("shares a target: $name", ({ a, b }) => {
    expect(patchTarget(a)).toBe(patchTarget(b));
  });

  it.each<{ name: string; a: IRPatch; b: IRPatch }>([
    {
      name: "workflow.set on different paths",
      a: { kind: "workflow.set", path: "name", value: "x" },
      b: { kind: "workflow.set", path: "run-name", value: "x" },
    },
    {
      name: "job.set on different jobs",
      a: setRunsOn("build", "ubuntu-latest"),
      b: setRunsOn("test", "ubuntu-latest"),
    },
    {
      name: "job.set on different paths of one job",
      a: { kind: "job.set", jobId: "build", path: "runs-on", value: "x" },
      b: { kind: "job.set", jobId: "build", path: "timeout-minutes", value: "x" },
    },
    {
      name: "step.set on different steps",
      a: { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "x" },
      b: { kind: "step.set", jobId: "build", stepIndex: 1, path: "name", value: "x" },
    },
    {
      name: "with.set on different keys",
      a: { kind: "with.set", jobId: "build", stepIndex: 0, key: "a", value: true },
      b: { kind: "with.set", jobId: "build", stepIndex: 0, key: "b", value: true },
    },
    {
      name: "with.set on the same key of different steps",
      a: { kind: "with.set", jobId: "build", stepIndex: 0, key: "a", value: 1 },
      b: { kind: "with.set", jobId: "build", stepIndex: 1, key: "a", value: 1 },
    },
    {
      name: "needs.add of different refs",
      a: { kind: "needs.add", jobId: "deploy", ref: "build" },
      b: { kind: "needs.add", jobId: "deploy", ref: "test" },
    },
    {
      name: "trigger.setFilters on different filters of one event",
      a: { kind: "trigger.setFilters", event: "push", filter: "branches", value: ["main"] },
      b: { kind: "trigger.setFilters", event: "push", filter: "paths", value: ["main"] },
    },
    {
      name: "trigger.setFilters on different events",
      a: { kind: "trigger.setFilters", event: "push", filter: "branches", value: ["main"] },
      b: { kind: "trigger.setFilters", event: "pull_request", filter: "branches", value: ["main"] },
    },
    {
      name: "job.create and job.delete of the same id",
      a: { kind: "job.create", jobId: "lint" },
      b: { kind: "job.delete", jobId: "lint" },
    },
    {
      name: "step.insert of different steps at one index",
      a: { kind: "step.insert", jobId: "build", index: 1, step: { run: "make" } },
      b: { kind: "step.insert", jobId: "build", index: 1, step: { run: "make test" } },
    },
    {
      name: "step.move with different destinations",
      a: { kind: "step.move", jobId: "build", fromIndex: 1, toIndex: 0 },
      b: { kind: "step.move", jobId: "build", fromIndex: 1, toIndex: 2 },
    },
    {
      name: "workflow.set on `permissions` versus the permissions patch",
      a: { kind: "workflow.set", path: "permissions", value: "read-all" },
      b: { kind: "workflow.permissions.set", value: "read-all" },
    },
    {
      name: "the permissions patch versus the concurrency patch",
      a: { kind: "workflow.permissions.set", value: null },
      b: { kind: "workflow.concurrency.set", value: null },
    },
  ])("keeps targets apart: $name", ({ a, b }) => {
    expect(patchTarget(a)).not.toBe(patchTarget(b));
  });
});

// ─── dedupQueue ──────────────────────────────────────────────────────

describe("dedupQueue", () => {
  it("appends to an empty queue", () => {
    expect(dedupQueue([], A1)).toEqual([A1]);
  });

  it("appends patches with distinct targets in arrival order", () => {
    const queue = dedupQueue(dedupQueue(dedupQueue([], A1), B1), C1);
    expect(queue).toEqual([A1, B1, C1]);
  });

  it("drops the earlier same-target patch and appends the new one at the END", () => {
    const A2 = setName("A2");
    expect(dedupQueue([A1, B1, C1], A2)).toEqual([B1, C1, A2]);
  });

  it("keeps the relative order of the untouched patches", () => {
    const B2 = setRunsOn("build", "windows-latest");
    expect(dedupQueue([A1, B1, C1], B2)).toEqual([A1, C1, B2]);
  });

  it("drops EVERY earlier patch with the new patch's target", () => {
    const A2 = setName("A2");
    const A3 = setName("A3");
    expect(dedupQueue([A1, B1, A2], A3)).toEqual([B1, A3]);
  });

  it("a removal supersedes a queued set of the same with-key", () => {
    const set: IRPatch = { kind: "with.set", jobId: "b", stepIndex: 0, key: "k", value: "v" };
    const remove: IRPatch = { kind: "with.remove", jobId: "b", stepIndex: 0, key: "k" };
    expect(dedupQueue([set], remove)).toEqual([remove]);
  });

  it("re-queuing the identical patch leaves one copy, at the end", () => {
    expect(dedupQueue([A1, B1], A1)).toEqual([B1, A1]);
  });

  it("returns a new array and leaves the input queue untouched", () => {
    const queue = Object.freeze([A1, B1]) as unknown as IRPatch[];
    const next = dedupQueue(queue, setName("A2"));
    expect(next).not.toBe(queue);
    expect(queue).toEqual([A1, B1]);
  });
});

// ─── mirrorActiveQueue ───────────────────────────────────────────────

describe("mirrorActiveQueue", () => {
  it("unbound: sets the live queue and leaves every stash alone", () => {
    const stash = { other: [C1] };
    const input = frozen(slice({ patchesByDocument: stash }));
    const out = mirrorActiveQueue(input, [A1]);
    expect(out.pendingPatches).toEqual([A1]);
    expect(out.patchesByDocument).toBe(stash);
    expect(out.boundDocumentId).toBeNull();
  });

  it("bound, non-empty: mirrors the queue under the bound id and keeps the other stashes", () => {
    const input = frozen(
      slice({ boundDocumentId: "doc", pendingPatches: [A1], patchesByDocument: { doc: [A1], other: [C1] } }),
    );
    const out = mirrorActiveQueue(input, [A1, B1]);
    expect(out.pendingPatches).toEqual([A1, B1]);
    expect(out.patchesByDocument).toEqual({ doc: [A1, B1], other: [C1] });
  });

  it("bound, first patch: creates the mirror key", () => {
    const out = mirrorActiveQueue(slice({ boundDocumentId: "doc" }), [A1]);
    expect(out.patchesByDocument).toEqual({ doc: [A1] });
  });

  it("bound, emptied: removes the key rather than storing an empty queue", () => {
    const input = frozen(
      slice({ boundDocumentId: "doc", pendingPatches: [A1], patchesByDocument: { doc: [A1], other: [C1] } }),
    );
    const out = mirrorActiveQueue(input, []);
    expect(out.pendingPatches).toEqual([]);
    expect(out.patchesByDocument).toEqual({ other: [C1] });
    expect(Object.hasOwn(out.patchesByDocument, "doc")).toBe(false);
  });

  it("does not mutate the input slice's stash map", () => {
    const input = frozen(slice({ boundDocumentId: "doc", patchesByDocument: { other: [C1] } }));
    const out = mirrorActiveQueue(input, [A1]);
    expect(out.patchesByDocument).not.toBe(input.patchesByDocument);
    expect(input.patchesByDocument).toEqual({ other: [C1] });
  });

  it.each([true, false, null])("carries preserveYamlFormatting=%s through untouched", (preserve) => {
    const out = mirrorActiveQueue(slice({ boundDocumentId: "doc", preserveYamlFormatting: preserve }), [A1]);
    expect(out.preserveYamlFormatting).toBe(preserve);
    expect(out.boundDocumentId).toBe("doc");
  });

  it("treats an empty-string id as bound, not as unbound", () => {
    const out = mirrorActiveQueue(slice({ boundDocumentId: "" }), [A1]);
    expect(out.patchesByDocument).toEqual({ "": [A1] });
  });
});

// ─── bindEditDocument ────────────────────────────────────────────────

describe("bindEditDocument", () => {
  it.each<string | null>([null, "doc", ""])("returns null when %j is already bound", (id) => {
    expect(bindEditDocument(slice({ boundDocumentId: id, pendingPatches: [A1] }), id)).toBeNull();
  });

  it("binding a document with no stash starts an empty queue", () => {
    const out = bindEditDocument(slice(), "doc");
    expect(out).toEqual(slice({ boundDocumentId: "doc" }));
  });

  it("binding a document restores its stashed queue", () => {
    const out = bindEditDocument(slice({ patchesByDocument: { doc: [A1, B1] } }), "doc");
    expect(out?.boundDocumentId).toBe("doc");
    expect(out?.pendingPatches).toEqual([A1, B1]);
    // The mirror invariant holds straight after the bind.
    expect(out?.patchesByDocument).toEqual({ doc: [A1, B1] });
  });

  it("switching documents stashes the outgoing queue and restores the incoming one", () => {
    const input = frozen(
      slice({ boundDocumentId: "a", pendingPatches: [A1], patchesByDocument: { a: [A1], b: [B1] } }),
    );
    const out = bindEditDocument(input, "b");
    expect(out?.boundDocumentId).toBe("b");
    expect(out?.pendingPatches).toEqual([B1]);
    expect(out?.patchesByDocument).toEqual({ a: [A1], b: [B1] });
  });

  it("the live queue is what gets stashed, even when the mirror lags behind it", () => {
    const out = bindEditDocument(
      slice({ boundDocumentId: "a", pendingPatches: [A1, C1], patchesByDocument: { a: [A1] } }),
      "b",
    );
    expect(out?.patchesByDocument).toEqual({ a: [A1, C1] });
  });

  it("an empty outgoing queue leaves no key behind, even a stale one", () => {
    const out = bindEditDocument(
      slice({ boundDocumentId: "a", pendingPatches: [], patchesByDocument: { a: [A1], b: [B1] } }),
      "b",
    );
    expect(out?.patchesByDocument).toEqual({ b: [B1] });
    expect(Object.hasOwn(out?.patchesByDocument ?? {}, "a")).toBe(false);
  });

  it("unbinding stashes the outgoing queue and leaves the live queue empty", () => {
    const out = bindEditDocument(
      slice({ boundDocumentId: "a", pendingPatches: [A1], patchesByDocument: { a: [A1] } }),
      null,
    );
    expect(out?.boundDocumentId).toBeNull();
    expect(out?.pendingPatches).toEqual([]);
    expect(out?.patchesByDocument).toEqual({ a: [A1] });
  });

  it("a round trip a → b → a gives each document back exactly its own queue", () => {
    const start = slice({ boundDocumentId: "a", pendingPatches: [A1], patchesByDocument: { a: [A1] } });
    const onB = bindEditDocument(start, "b");
    if (!onB) throw new Error("expected a rebind to b");
    const onBEdited = mirrorActiveQueue(onB, [B1, C1]);
    const backOnA = bindEditDocument(onBEdited, "a");
    expect(backOnA?.pendingPatches).toEqual([A1]);
    expect(backOnA?.patchesByDocument).toEqual({ a: [A1], b: [B1, C1] });
    const backOnB = backOnA && bindEditDocument(backOnA, "b");
    expect(backOnB?.pendingPatches).toEqual([B1, C1]);
  });

  // Adopting an orphaned unbound queue is the STORE's job (workflowStore
  // bindToDocument, audit #1004); the pure bind only restores the incoming
  // document's own stash and files nothing under a null id.
  it("does not file an unbound queue anywhere — the incoming stash is all it restores", () => {
    const out = bindEditDocument(slice({ boundDocumentId: null, pendingPatches: [A1] }), "doc");
    expect(out?.pendingPatches).toEqual([]);
    expect(out?.patchesByDocument).toEqual({});
  });

  it("binds an empty-string id like any other id", () => {
    const out = bindEditDocument(slice({ patchesByDocument: { "": [A1] } }), "");
    expect(out?.boundDocumentId).toBe("");
    expect(out?.pendingPatches).toEqual([A1]);
  });

  it("keeps preserveYamlFormatting and does not mutate the input", () => {
    const input = frozen(
      slice({ boundDocumentId: "a", pendingPatches: [A1], preserveYamlFormatting: false }),
    );
    const out = bindEditDocument(input, "b");
    expect(out?.preserveYamlFormatting).toBe(false);
    expect(input.patchesByDocument).toEqual({});
  });
});

// ─── renameEditDocument ──────────────────────────────────────────────

describe("renameEditDocument", () => {
  it("returns null when from and to are the same id", () => {
    const input = slice({ boundDocumentId: "a", pendingPatches: [A1], patchesByDocument: { a: [A1] } });
    expect(renameEditDocument(input, "a", "a")).toBeNull();
  });

  it.each<{ name: string; input: EditSlice }>([
    { name: "an empty slice", input: slice() },
    { name: "an unrelated stash", input: slice({ patchesByDocument: { other: [A1] } }) },
    {
      name: "a different bound document",
      input: slice({ boundDocumentId: "c", pendingPatches: [C1], patchesByDocument: { c: [C1] } }),
    },
  ])("returns null for an unknown `from` with $name", ({ input }) => {
    expect(renameEditDocument(input, "ghost", "new")).toBeNull();
  });

  it("carries the bound document's queue AND the binding to the new id", () => {
    const input = frozen(
      slice({ boundDocumentId: "a.yml", pendingPatches: [A1, B1], patchesByDocument: { "a.yml": [A1, B1] } }),
    );
    const out = renameEditDocument(input, "a.yml", "b.yml");
    expect(out?.boundDocumentId).toBe("b.yml");
    expect(out?.pendingPatches).toEqual([A1, B1]);
    expect(out?.patchesByDocument).toEqual({ "b.yml": [A1, B1] });
  });

  it("moves the binding even when the bound document has no edits yet", () => {
    const out = renameEditDocument(slice({ boundDocumentId: "a" }), "a", "b");
    expect(out?.boundDocumentId).toBe("b");
    expect(out?.pendingPatches).toEqual([]);
    expect(out?.patchesByDocument).toEqual({});
  });

  it("an empty-queue bound rename onto a document with edits adopts that document's queue", () => {
    const out = renameEditDocument(
      slice({ boundDocumentId: "a", patchesByDocument: { b: [B1] } }),
      "a",
      "b",
    );
    expect(out?.boundDocumentId).toBe("b");
    expect(out?.pendingPatches).toEqual([B1]);
    expect(out?.patchesByDocument).toEqual({ b: [B1] });
  });

  it("renames a stashed (unbound) document without touching the bound one", () => {
    const input = frozen(
      slice({
        boundDocumentId: "c",
        pendingPatches: [C1],
        patchesByDocument: { a: [A1], c: [C1] },
      }),
    );
    const out = renameEditDocument(input, "a", "b");
    expect(out?.boundDocumentId).toBe("c");
    expect(out?.pendingPatches).toEqual([C1]);
    expect(out?.patchesByDocument).toEqual({ b: [A1], c: [C1] });
  });

  it("renames a stashed document while nothing is bound, keeping the unbound live queue", () => {
    const out = renameEditDocument(slice({ pendingPatches: [C1], patchesByDocument: { a: [A1] } }), "a", "b");
    expect(out?.boundDocumentId).toBeNull();
    expect(out?.pendingPatches).toEqual([C1]);
    expect(out?.patchesByDocument).toEqual({ b: [A1] });
  });

  it("onto an existing queue: the target's own patches come first, the moved ones follow", () => {
    const out = renameEditDocument(
      slice({ boundDocumentId: "a", pendingPatches: [A1], patchesByDocument: { a: [A1], b: [B1, C1] } }),
      "a",
      "b",
    );
    expect(out?.boundDocumentId).toBe("b");
    expect(out?.pendingPatches).toEqual([B1, C1, A1]);
    expect(out?.patchesByDocument).toEqual({ b: [B1, C1, A1] });
  });

  it("onto the BOUND document: its live queue picks up the moved patches", () => {
    const out = renameEditDocument(
      slice({ boundDocumentId: "b", pendingPatches: [B1], patchesByDocument: { a: [A1], b: [B1] } }),
      "a",
      "b",
    );
    expect(out?.boundDocumentId).toBe("b");
    expect(out?.pendingPatches).toEqual([B1, A1]);
    expect(out?.patchesByDocument).toEqual({ b: [B1, A1] });
  });

  it("leaves a following bind unable to resurrect the old id's queue", () => {
    const renamed = renameEditDocument(
      slice({ boundDocumentId: "a", pendingPatches: [A1], patchesByDocument: { a: [A1] } }),
      "a",
      "b",
    );
    if (!renamed) throw new Error("expected a rename");
    const rebound = bindEditDocument(renamed, "a");
    expect(rebound?.pendingPatches).toEqual([]);
    expect(rebound?.patchesByDocument).toEqual({ b: [A1] });
  });

  it("handles empty-string ids as real ids", () => {
    const out = renameEditDocument(slice({ patchesByDocument: { "": [A1] } }), "", "b");
    expect(out?.patchesByDocument).toEqual({ b: [A1] });
    const back = renameEditDocument(slice({ patchesByDocument: { a: [A1] } }), "a", "");
    expect(back?.patchesByDocument).toEqual({ "": [A1] });
  });

  it("keeps preserveYamlFormatting and does not mutate the input", () => {
    const input = frozen(
      slice({
        boundDocumentId: "a",
        pendingPatches: [A1],
        preserveYamlFormatting: true,
        patchesByDocument: { a: [A1], b: [B1] },
      }),
    );
    const out = renameEditDocument(input, "a", "b");
    expect(out?.preserveYamlFormatting).toBe(true);
    expect(input.patchesByDocument).toEqual({ a: [A1], b: [B1] });
    expect(input.boundDocumentId).toBe("a");
  });
});

// ─── WI-LX2.4: structural step edits are operations, not values ─────────
//
// Found by this file's own first pass: dedup treated two deletes at index 0 as
// "the same edit made twice", so deleting two steps saved one deletion; and a
// rename queued BEFORE an insert above it was dropped by a rename queued after,
// though the two addressed different steps.

describe("dedupQueue — step insert / delete / move", () => {
  const del0: IRPatch = { kind: "step.delete", jobId: "build", stepIndex: 0 };
  const move10: IRPatch = { kind: "step.move", jobId: "build", fromIndex: 1, toIndex: 0 };
  const insert0: IRPatch = { kind: "step.insert", jobId: "build", index: 0, step: { run: "make" } };

  it.each([
    ["two deletes at one index", del0],
    ["two identical moves", move10],
    ["two identical inserts", insert0],
  ])("keeps both of %s — each shifts the steps the next one sees", (_name, patch) => {
    expect(dedupQueue([patch], patch)).toEqual([patch, patch]);
  });

  it("does not let a step edit replace one queued before an index shift in the same job", () => {
    const renameA: IRPatch = { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "A" };
    const renameB: IRPatch = { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "B" };
    expect(dedupQueue([renameA, insert0], renameB)).toEqual([renameA, insert0, renameB]);
  });

  it("still collapses repeated edits made after the last shift", () => {
    const renameA: IRPatch = { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "A" };
    const renameB: IRPatch = { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "B" };
    expect(dedupQueue([insert0, renameA], renameB)).toEqual([insert0, renameB]);
  });

  it("a shift in ANOTHER job is no barrier", () => {
    const shiftTest: IRPatch = { kind: "step.delete", jobId: "test", stepIndex: 0 };
    const withA: IRPatch = { kind: "with.set", jobId: "build", stepIndex: 0, key: "k", value: "a" };
    const withB: IRPatch = { kind: "with.set", jobId: "build", stepIndex: 0, key: "k", value: "b" };
    expect(dedupQueue([withA, shiftTest], withB)).toEqual([shiftTest, withB]);
  });
});

describe("cancelTarget", () => {
  const renameA: IRPatch = { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "A" };
  const insert0: IRPatch = { kind: "step.insert", jobId: "build", index: 0, step: { run: "make" } };

  it("removes the queued edit for the target", () => {
    expect(cancelTarget([renameA, setName("x")], renameA)).toEqual([setName("x")]);
  });

  it("does not reach past an index shift: the older edit addresses a different step", () => {
    const renameB: IRPatch = { kind: "step.set", jobId: "build", stepIndex: 0, path: "name", value: "B" };
    expect(cancelTarget([renameA, insert0, renameB], renameB)).toEqual([renameA, insert0]);
  });

  it("returns the same queue when nothing matches", () => {
    const queue = [setName("x")];
    expect(cancelTarget(queue, renameA)).toBe(queue);
  });
});
