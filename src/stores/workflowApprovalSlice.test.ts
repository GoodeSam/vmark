// @vitest-environment node
// WI-LX2.4 — the approval slice's transitions: enqueue replaces, dismiss clears, a scoped dismiss that misses returns the same slice.
import { describe, expect, it } from "vitest";
import {
  dismiss,
  enqueue,
  initialApproval,
  type ApprovalRequestPayload,
  type ApprovalSlice,
} from "./workflowApprovalSlice";

function request(overrides: Partial<ApprovalRequestPayload> = {}): ApprovalRequestPayload {
  return {
    executionId: "exec-1",
    stepId: "step-1",
    summary: "Write report.md",
    preview: "# Report",
    ...overrides,
  };
}

describe("initialApproval", () => {
  it("starts with nothing pending", () => {
    expect(initialApproval).toEqual({ pending: null });
  });
});

describe("enqueue", () => {
  it("makes the request the pending approval", () => {
    const req = request();
    expect(enqueue(req)).toEqual({ pending: req });
  });

  it("keeps the optional model, including an explicit null", () => {
    expect(enqueue(request({ model: "claude-opus" })).pending?.model).toBe("claude-opus");
    expect(enqueue(request({ model: null })).pending?.model).toBeNull();
    expect(enqueue(request()).pending).not.toHaveProperty("model");
  });

  it("replaces whatever was pending — there is one slot, not a queue", () => {
    const first = enqueue(request({ stepId: "step-1" }));
    const second = enqueue(request({ stepId: "step-2" }));
    expect(second.pending?.stepId).toBe("step-2");
    // The earlier slice is a separate value and is not touched.
    expect(first.pending?.stepId).toBe("step-1");
  });

  it("carries CJK and empty strings through verbatim", () => {
    const req = request({ summary: "写入 报告.md", preview: "" });
    expect(enqueue(req).pending).toEqual(req);
  });
});

describe("dismiss without a scope", () => {
  it("clears a pending approval", () => {
    expect(dismiss(enqueue(request()))).toEqual({ pending: null });
  });

  it("is harmless when nothing is pending", () => {
    expect(dismiss(initialApproval)).toEqual({ pending: null });
  });

  it("does not mutate the slice it was given", () => {
    const slice = enqueue(request());
    dismiss(slice);
    expect(slice.pending).not.toBeNull();
  });
});

describe("dismiss scoped with `only`", () => {
  it("clears the pending approval when both ids match", () => {
    const slice = enqueue(request({ executionId: "e", stepId: "s" }));
    expect(dismiss(slice, { executionId: "e", stepId: "s" })).toEqual({ pending: null });
  });

  it("matches empty-string ids exactly rather than treating them as absent", () => {
    const slice = enqueue(request({ executionId: "", stepId: "" }));
    expect(dismiss(slice, { executionId: "", stepId: "" })).toEqual({ pending: null });
  });

  // The #1009 race: the runner has already emitted the NEXT step's request by
  // the time the reply to the previous one resolves. A scoped dismiss for the
  // old step must leave the new request on screen — and hand back the very
  // same slice so the store can skip the write.
  it.each<{ name: string; pending: ApprovalRequestPayload; only: { executionId: string; stepId: string } }>([
    {
      name: "a different step of the same execution",
      pending: request({ executionId: "e1", stepId: "s2" }),
      only: { executionId: "e1", stepId: "s1" },
    },
    {
      name: "the same step id in a different execution",
      pending: request({ executionId: "e2", stepId: "s1" }),
      only: { executionId: "e1", stepId: "s1" },
    },
    {
      name: "both ids different",
      pending: request({ executionId: "e2", stepId: "s2" }),
      only: { executionId: "e1", stepId: "s1" },
    },
    {
      name: "the ids swapped between the two fields",
      pending: request({ executionId: "s1", stepId: "e1" }),
      only: { executionId: "e1", stepId: "s1" },
    },
    {
      name: "a case-only difference",
      pending: request({ executionId: "E1", stepId: "s1" }),
      only: { executionId: "e1", stepId: "s1" },
    },
  ])("leaves the request pending and returns the same slice for $name", ({ pending, only }) => {
    const slice: ApprovalSlice = { pending };
    const result = dismiss(slice, only);
    expect(result).toBe(slice);
    expect(result.pending).toBe(pending);
  });

  it("returns the same slice when nothing is pending", () => {
    const slice: ApprovalSlice = { pending: null };
    expect(dismiss(slice, { executionId: "e1", stepId: "s1" })).toBe(slice);
  });

  it("returns a NEW slice when it does clear, leaving the input intact", () => {
    const slice = enqueue(request({ executionId: "e", stepId: "s" }));
    const result = dismiss(slice, { executionId: "e", stepId: "s" });
    expect(result).not.toBe(slice);
    expect(slice.pending?.stepId).toBe("s");
  });

  it("an undefined scope behaves exactly like no scope", () => {
    const slice = enqueue(request());
    expect(dismiss(slice, undefined)).toEqual({ pending: null });
  });
});
