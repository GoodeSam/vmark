// WI-RA19.3 — the status bar's AI controls act on the invocation, not only on
// the status row: Retry re-runs the request that failed (it used to only
// dismiss the error, duplicating the × beside it), Retry is absent when the
// failure has nothing to re-run, and Cancel asks Rust to stop the provider
// (it used to reset the store while the provider ran on, still billing).
// StatusBarRight is replaced by a probe that records the handlers StatusBar
// hands it; StatusBarRight.test.tsx covers how it renders them.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

interface AiProps {
  onRetryAi?: () => void;
  onCancelAi: () => void;
}
const probe = vi.hoisted(() => ({ props: null as AiProps | null }));
vi.mock("./StatusBarRight", () => ({
  StatusBarRight: (props: AiProps) => {
    probe.props = props;
    return null;
  },
}));

const mockInvoke = vi.hoisted(() => vi.fn((..._args: unknown[]) => Promise.resolve()));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: () => "main",
  useIsDocumentWindow: () => true,
}));

vi.mock("@/hooks/useDocumentState", () => ({
  useDocumentLastAutoSave: () => null,
  useDocumentIsMissing: () => false,
  useDocumentIsDivergent: () => false,
}));

vi.mock("@/hooks/useMcpServer", () => ({
  useMcpServer: () => ({
    running: false,
    loading: false,
    error: null,
    port: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMcpClients", () => ({
  useMcpClients: () => [],
}));

vi.mock("@/services/tabs/tabOperations", () => ({
  closeTabWithDirtyCheck: vi.fn(),
}));

vi.mock("@/services/navigation/settingsWindow", () => ({
  openSettingsWindow: vi.fn(),
}));

vi.mock("./useStatusBarTabDrag", () => ({
  useStatusBarTabDrag: () => ({
    getTabDragHandlers: () => ({ onPointerDown: vi.fn() }),
    isDragging: false,
    isReordering: false,
    dragMode: "idle",
    dragTabId: null,
    dropIndex: null,
    dragPoint: null,
    snapbackTabId: null,
    isDropPreviewTarget: false,
    isDropInvalid: false,
    isReorderBlocked: false,
    dragHint: null,
    ariaAnnouncement: "",
    handleTabKeyDown: vi.fn(),
  }),
}));

vi.mock("./useQuitFeedback", () => ({
  useQuitFeedback: () => false,
}));

vi.mock("@/components/Tabs/Tab", () => ({
  Tab: () => <div data-testid="tab" />,
}));

vi.mock("@/components/Tabs/TabContextMenu", () => ({
  TabContextMenu: () => null,
}));

import { StatusBar } from "./StatusBar";
import { useUIStore } from "@/stores/uiStore";
import { useAiInvocationStore } from "@/stores/aiStore";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const store = () => useAiInvocationStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  probe.props = null;
  useUIStore.setState({ statusBarVisible: true });
  store().cancel();
});

function aiProps(): AiProps {
  if (!probe.props) throw new Error("StatusBarRight was not rendered");
  return probe.props;
}

describe("status bar AI controls", () => {
  it("Retry re-runs the failed request and clears the error", () => {
    const retry = vi.fn();
    store().tryStart("r1");
    store().setError("Provider timeout", "r1", retry);
    render(<StatusBar />);

    act(() => aiProps().onRetryAi?.());

    expect(retry).toHaveBeenCalledOnce();
    expect(store().error).toBeNull();
  });

  it("offers no Retry when the failure has nothing to re-run", () => {
    store().setError("No AI provider configured");
    render(<StatusBar />);
    expect(aiProps().onRetryAi).toBeUndefined();
  });

  it("Cancel asks Rust to stop the running request, then resets the status", () => {
    store().tryStart("req-42");
    render(<StatusBar />);

    act(() => aiProps().onCancelAi());

    expect(mockInvoke).toHaveBeenCalledWith("cancel_ai_prompt", { requestId: "req-42" });
    expect(store().isRunning).toBe(false);
  });
});
