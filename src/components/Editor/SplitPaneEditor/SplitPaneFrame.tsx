/**
 * SplitPaneFrame — the split-pane editor's layout, and nothing else.
 *
 * Purpose: own the DOM structure every split-pane surface shares — banner,
 * header row, then the source | resize | preview body — so the structure can
 * be rendered by itself. SplitPaneEditor fills the slots; the real-engine
 * geometry test (splitPaneLayout.webkit.test.tsx) renders THIS component, so
 * it measures the production layout rather than a hand-built copy of it.
 *
 * Key decisions:
 *   - The header row is in flow, above the body. The view-mode toggle used to
 *     float absolutely over the panes' top-right corner and lay across the
 *     HTML trust bar, the read-only banner and source text.
 *   - A slot left undefined renders nothing, so a source-only or preview-only
 *     mode is the same component with one pane slot empty.
 *
 * @coordinates-with SplitPaneEditor.tsx — fills the slots
 * @coordinates-with split-pane-editor.css — the layout's styles
 * @module components/Editor/SplitPaneEditor/SplitPaneFrame
 */

import type { CSSProperties, ReactNode } from "react";
import "./split-pane-editor.css";

export interface SplitPaneFrameProps {
  ariaLabel: string;
  formatId: string;
  /** Share of the body width the source pane takes, 0..1. */
  sourceFraction: number;
  /** Full-width notice above everything (the read-only banner). */
  banner?: ReactNode;
  /** Content of the header row (the view-mode toggle); no row when omitted. */
  header?: ReactNode;
  source?: ReactNode;
  resizeHandle?: ReactNode;
  preview?: ReactNode;
}

export function SplitPaneFrame({
  ariaLabel,
  formatId,
  sourceFraction,
  banner,
  header,
  source,
  resizeHandle,
  preview,
}: SplitPaneFrameProps) {
  return (
    <div
      className="split-pane-editor"
      role="group"
      aria-label={ariaLabel}
      data-format-id={formatId}
      style={{ "--split-pane-source-fraction": String(sourceFraction) } as CSSProperties}
    >
      {banner}
      {header !== undefined && <div className="split-pane-editor__header">{header}</div>}
      {/* Row body: source | resize | preview. Separated from the banner and the
          header so both span full width on top — the editor is a column, the
          body is the row. */}
      <div className="split-pane-editor__body">
        {source !== undefined && <div className="split-pane-editor__source">{source}</div>}
        {resizeHandle}
        {preview !== undefined && <div className="split-pane-editor__preview">{preview}</div>}
      </div>
    </div>
  );
}
