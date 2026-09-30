/** Assistant-only JSONL transcript decoding. Complete lines only; bounded history.
 * @module utils/terminalTranscript */
export interface TranscriptMessage { id: string; text: string }
export function parseTerminalTranscript(data: string): TranscriptMessage[] {
  const messages = new Map<string, TranscriptMessage>();
  const lines = data.split("\n");
  lines.pop(); // A writer may still be appending the final record.
  for (const [lineIndex, line] of lines.entries()) {
    try {
      const value = JSON.parse(line);
      const message = value.type === "assistant" ? value.message :
        value.type === "response_item" && value.payload?.type === "message" ? value.payload : null;
      if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
      message.content.forEach((part: { type?: string; text?: unknown }, index: number) => {
        if (!["text", "output_text"].includes(part.type ?? "") || typeof part.text !== "string") return;
        const id = `${value.uuid ?? message.id ?? value.timestamp ?? lineIndex}:${index}`;
        messages.set(id, { id, text: part.text.slice(0, 100_000) });
      });
    } catch { /* Malformed or non-message records do not interrupt following. */ }
  }
  return [...messages.values()].slice(-100);
}
