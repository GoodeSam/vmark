/** Collapsed by default; each NEW reply with a table or diagram opens the transcript
 * once. Content present when a session is first loaded is the baseline, not news, and
 * a collapse by the user holds until the next rich reply.
 * @module components/Terminal/useTranscriptAutoOpen */
import { useEffect, useRef, useState } from "react";
import type { TranscriptMessage } from "@/utils/terminalTranscript";
import { hasRichTranscriptContent } from "./transcriptMarkdownTree";
/** Newest message holding rich content; results are cached by message id. */
function newestRichId(messages: TranscriptMessage[], cache: Map<string, boolean>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const { id, text } = messages[i];
    let rich = cache.get(id);
    if (rich === undefined) cache.set(id, rich = hasRichTranscriptContent(text));
    if (rich) return id;
  }
  return null;
}
export function useTranscriptAutoOpen(
  sessionId: string | null,
  messages: TranscriptMessage[],
  loaded: boolean,
): [boolean, (open: boolean) => void] {
  const [expanded, setExpanded] = useState(false);
  const baseline = useRef<{ sessionId: string | null; richId: string | null } | null>(null);
  const cache = useRef(new Map<string, boolean>());
  useEffect(() => {
    if (baseline.current && baseline.current.sessionId !== sessionId) {
      baseline.current = null;
      cache.current.clear();
    }
    if (!loaded) return;
    const richId = newestRichId(messages, cache.current);
    if (!baseline.current) {
      baseline.current = { sessionId, richId };
    } else if (richId !== null && richId !== baseline.current.richId) {
      baseline.current = { sessionId, richId };
      setExpanded(true);
    }
    // Bound the cache to the retained window (the parser keeps the last 100).
    if (cache.current.size > messages.length * 2) {
      const live = new Set(messages.map(message => message.id));
      for (const id of cache.current.keys()) if (!live.has(id)) cache.current.delete(id);
    }
  }, [sessionId, messages, loaded]);
  return [expanded, setExpanded];
}
