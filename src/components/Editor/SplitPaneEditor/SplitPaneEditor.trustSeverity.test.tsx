/**
 * SplitPaneEditor — trust-aware severity on the validation LIST.
 *
 * The list and CodeMirror's lint are two surfaces for one set of findings;
 * both must present them through the same mapping (presentDiagnostics), or
 * the gutter says "info" while the list still says "warning". SourcePane is
 * mocked to report one script finding, as the real linter would.
 */
import { render, screen, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useDocumentStore } from "@/stores/documentStore";
import { useHtmlTrustStore } from "@/stores/htmlTrustStore";
import { htmlFormat } from "@/lib/formats/adapters/html";
import type { ValidationDiagnostic } from "@/lib/formats/types";
import { SplitPaneEditor } from "./SplitPaneEditor";

const SCRIPT: ValidationDiagnostic = {
  severity: "warning",
  line: 2,
  column: 1,
  message: "Script tag detected — blocked unless trusted preview is enabled.",
  ruleId: "html/script-blocked",
};

vi.mock("./SourcePane", () => ({
  SourcePane: ({ onDiagnostics }: { onDiagnostics?: (d: ValidationDiagnostic[]) => void }) => {
    useEffect(() => onDiagnostics?.([SCRIPT]), [onDiagnostics]);
    return <div data-testid="source-pane" />;
  },
}));

const TAB = "tab-list";
const A = "/docs/list-a.html";
const TOKEN = "b".repeat(64);
const rowSeverities = () =>
  [...document.querySelectorAll(".validation-gutter__row")].map((r) => r.getAttribute("data-severity"));

afterEach(() => {
  cleanup();
  useHtmlTrustStore.getState().clearAll();
});

describe("SplitPaneEditor validation list under trust", () => {
  it("lists the script finding as a warning, then info once trusted, then warning after Save As elsewhere", () => {
    useDocumentStore.getState().initDocument(TAB, "<p>x</p>\n<script>1</script>", A);
    render(<SplitPaneEditor tabId={TAB} formatConfig={htmlFormat} />);
    expect(screen.getByTestId("validation-summary")).toBeInTheDocument();
    expect(rowSeverities()).toEqual(["warning"]);

    act(() => useHtmlTrustStore.getState().grant(A, TOKEN));
    expect(rowSeverities()).toEqual(["info"]);

    act(() => useDocumentStore.getState().setFilePath(TAB, "/docs/list-b.html"));
    expect(rowSeverities()).toEqual(["warning"]);
  });
});
