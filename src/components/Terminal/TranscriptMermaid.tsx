/** Lazy Mermaid preview in a scriptless sandbox. Invalid input remains readable.
 * @module components/Terminal/TranscriptMermaid */
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { renderMermaid } from "@/plugins/mermaid";
export function TranscriptMermaid({ source }: { source: string }) {
  const { t } = useTranslation("settings");
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [rendered, setRendered] = useState<{ source: string; html: string; ratio: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void renderMermaid(source, `transcript-${id}`, true).then(svg => {
      if (!cancelled && svg) {
        const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["script", "image", "a"] });
        const box = new DOMParser().parseFromString(clean, "image/svg+xml").documentElement.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
        const ratio = box && box.length === 4 && box[2] > 0 && box[3] > 0 && Number.isFinite(box[2] / box[3]) ? box[2] / box[3] : 2;
        setRendered({ source, ratio, html: '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;"><style>body{margin:0}svg{max-width:100%;height:auto}</style>' + clean });
      }
    });
    return () => { cancelled = true; };
  }, [source, id]);
  return rendered?.source === source ? <iframe sandbox="" title={t("terminal.transcript.diagram")} srcDoc={rendered.html} style={{ aspectRatio: rendered.ratio }} className="transcript-diagram" /> : <pre><code>{source}</code></pre>;
}
