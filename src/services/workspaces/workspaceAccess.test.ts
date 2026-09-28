// @vitest-environment node
// WI-LX1.1 — the frontend half of Rust-owned workspace grants.
//
// Rust answers "was this folder chosen before?" and nothing else. Whether the
// folder is readable WITHOUT a grant (the static scope covers `$HOME/**`) is
// measured by reading it, never modelled here, so the outcomes below map one
// Rust answer plus one probe onto what the caller should do.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.fn();
const mockExists = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: (...args: unknown[]) => mockExists(...args),
}));

import {
  pickWorkspaceFolder,
  regrantWorkspaceAccess,
  requestWorkspaceConfirmation,
  resolveWorkspaceAccess,
} from "./workspaceAccess";

const typed = (code: string) => ({ code, message: `${code} happened` });

beforeEach(() => {
  mockInvoke.mockReset();
  mockExists.mockReset();
});

describe("resolveWorkspaceAccess", () => {
  it("asks Rust about the folder, by name", async () => {
    mockInvoke.mockResolvedValue("/work/proj");
    await resolveWorkspaceAccess("/work/proj");
    expect(mockInvoke).toHaveBeenCalledWith("allow_workspace_access", { path: "/work/proj" });
  });

  it("a folder chosen before is granted, and Rust's canonical root is returned", async () => {
    mockInvoke.mockResolvedValue("/private/work/proj");
    await expect(resolveWorkspaceAccess("/work/proj")).resolves.toEqual({
      kind: "granted",
      root: "/private/work/proj",
    });
    expect(mockExists).not.toHaveBeenCalled();
  });

  it("a refused folder the static scope already reads needs nothing", async () => {
    mockInvoke.mockRejectedValue(typed("permission-denied"));
    mockExists.mockResolvedValue(true);
    await expect(resolveWorkspaceAccess("/Users/me/notes")).resolves.toEqual({ kind: "readable" });
    expect(mockExists).toHaveBeenCalledWith("/Users/me/notes");
  });

  it("a refused folder nothing can read needs the user to confirm it", async () => {
    mockInvoke.mockRejectedValue(typed("permission-denied"));
    mockExists.mockRejectedValue(new Error("forbidden path: /opt/proj"));
    await expect(resolveWorkspaceAccess("/opt/proj")).resolves.toEqual({
      kind: "needs-confirmation",
    });
  });

  it("reads the scope refusal the way the fs plugin sends it: a bare string", async () => {
    mockInvoke.mockRejectedValue(typed("permission-denied"));
    mockExists.mockRejectedValue(
      "forbidden path: /opt/proj, maybe it is not allowed on the scope for `allow-exists` permission in your capability file",
    );
    await expect(resolveWorkspaceAccess("/opt/proj")).resolves.toEqual({
      kind: "needs-confirmation",
    });
  });

  // The folder existed when Rust resolved it and is gone when the probe runs.
  it("a refused folder the probe finds gone is missing, not readable", async () => {
    mockInvoke.mockRejectedValue(typed("permission-denied"));
    mockExists.mockResolvedValue(false);
    await expect(resolveWorkspaceAccess("/Users/me/notes")).resolves.toEqual({ kind: "missing" });
  });

  // Only the scope refusal means "outside the scope". A probe that failed for
  // any other reason (IPC down, an I/O error) answers nothing about the scope.
  it.each([
    ["an IPC failure", new Error("ipc down")],
    ["an I/O error", "failed to check existence: Input/output error (os error 5)"],
    ["nothing at all", undefined],
  ])("a probe that fails with %s is unverified, not a request to confirm", async (_l, error) => {
    mockInvoke.mockRejectedValue(typed("permission-denied"));
    mockExists.mockRejectedValue(error);
    const access = await resolveWorkspaceAccess("/opt/proj");
    expect(access).toEqual({ kind: "unverified", error });
  });

  it.each(["not-found", "invalid-input"])("a %s answer means the folder is gone", async (code) => {
    mockInvoke.mockRejectedValue(typed(code));
    await expect(resolveWorkspaceAccess("/gone")).resolves.toEqual({ kind: "missing" });
    expect(mockExists).not.toHaveBeenCalled();
  });

  it.each([
    ["an untyped rejection", new Error("ipc down")],
    ["an unexpected code", typed("io")],
    ["nothing at all", undefined],
  ])("%s is unverified, never read as permission", async (_label, error) => {
    mockInvoke.mockRejectedValue(error);
    const access = await resolveWorkspaceAccess("/x");
    expect(access.kind).toBe("unverified");
    expect(mockExists).not.toHaveBeenCalled();
  });

  it("a malformed success is unverified, not a grant", async () => {
    // Zero trust at the boundary: a non-string root is not a root.
    mockInvoke.mockResolvedValue(undefined);
    await expect(resolveWorkspaceAccess("/x")).resolves.toMatchObject({ kind: "unverified" });
  });
});

describe("pickWorkspaceFolder", () => {
  it("opens the Rust picker at the requested folder", async () => {
    mockInvoke.mockResolvedValue("/opt/proj");
    await expect(pickWorkspaceFolder({ defaultPath: "/opt/proj" })).resolves.toBe("/opt/proj");
    expect(mockInvoke).toHaveBeenCalledWith("pick_workspace_folder", { defaultPath: "/opt/proj" });
  });

  it("opens it with no starting folder when none is given", async () => {
    mockInvoke.mockResolvedValue(null);
    await expect(pickWorkspaceFolder()).resolves.toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith("pick_workspace_folder", { defaultPath: null });
  });

  // Only `null` is a cancel. Anything else that is not a folder is Rust
  // breaking its contract, and reading it as "the user changed their mind"
  // would hide that — the caller reports a rejection instead.
  it.each([42, "", {}, undefined])("rejects a malformed answer (%j)", async (answer) => {
    mockInvoke.mockResolvedValue(answer);
    await expect(pickWorkspaceFolder()).rejects.toThrow(/malformed/);
  });

  it("lets a failure reach the caller", async () => {
    mockInvoke.mockRejectedValue(typed("conflict"));
    await expect(pickWorkspaceFolder()).rejects.toEqual(typed("conflict"));
  });
});

describe("requestWorkspaceConfirmation", () => {
  // Rust answers once the dialog is ON SCREEN (the transport cannot wait for
  // the user), so the caller knows which of three things happened.
  it("asks Rust to show the picker at the folder and reports it opened", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await expect(requestWorkspaceConfirmation("/opt/proj")).resolves.toEqual({ kind: "opened" });
    expect(mockInvoke).toHaveBeenCalledWith("request_workspace_confirmation", { path: "/opt/proj" });
  });

  it("reports busy when another folder dialog is open", async () => {
    mockInvoke.mockRejectedValue(typed("conflict"));
    await expect(requestWorkspaceConfirmation("/opt/proj")).resolves.toEqual({ kind: "busy" });
  });

  it.each([new Error("ipc down"), typed("invalid-input")])(
    "reports any other failure with its error (%j)",
    async (error) => {
      mockInvoke.mockRejectedValue(error);
      await expect(requestWorkspaceConfirmation("/opt/proj")).resolves.toEqual({
        kind: "failed",
        error,
      });
    },
  );
});

describe("regrantWorkspaceAccess", () => {
  it("re-issues the grant for a chosen folder", async () => {
    mockInvoke.mockResolvedValue("/opt/proj");
    await regrantWorkspaceAccess("/opt/proj");
    expect(mockInvoke).toHaveBeenCalledWith("allow_workspace_access", { path: "/opt/proj" });
  });

  it.each([typed("permission-denied"), typed("not-found"), new Error("ipc down")])(
    "never throws (%j)",
    async (error) => {
      mockInvoke.mockRejectedValue(error);
      await expect(regrantWorkspaceAccess("/x")).resolves.toBeUndefined();
    },
  );
});
