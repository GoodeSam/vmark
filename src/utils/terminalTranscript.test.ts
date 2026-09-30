// WI-TP1.1: exact assistant-only transcript parsing.
import { describe, expect, it } from "vitest";
import { parseTerminalTranscript } from "./terminalTranscript";
const line = (value: unknown) => JSON.stringify(value) + "\n";
describe("parseTerminalTranscript", () => {
  it("reads Claude assistant text and ignores tools, user text and partial lines", () => {
    const data = line({ type: "user", message: { role: "user", content: "secret" } }) +
      line({ type: "assistant", uuid: "a", message: { role: "assistant", content: [{ type: "text", text: "中文 | table" }, { type: "tool_use", name: "shell" }] } }) + '{"type":"assistant"';
    expect(parseTerminalTranscript(data)).toEqual([{ id: "a:0", text: "中文 | table" }]);
  });
  it("reads Codex output_text once and updates repeated identities", () => {
    const record = (text: string) => ({ type: "response_item", payload: { type: "message", role: "assistant", id: "m", content: [{ type: "output_text", text }] } });
    expect(parseTerminalTranscript(line(record("old")) + "bad\n" + line(record("new")))).toEqual([{ id: "m:0", text: "new" }]);
  });
  it("handles empty input and bounds retained messages", () => {
    expect(parseTerminalTranscript("")).toEqual([]);
    const data = Array.from({ length: 150 }, (_, i) => line({ type: "assistant", uuid: String(i), message: { role: "assistant", content: [{ type: "text", text: String(i) }] } })).join("");
    expect(parseTerminalTranscript(data)).toHaveLength(100);
    expect(parseTerminalTranscript(data)[0].text).toBe("50");
  });
});
// Preserve repeated legitimate replies when Codex does not supply a message id.
it("uses event timestamps to preserve repeated assistant replies", () => {
  const record = (timestamp: string) => ({ timestamp, type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] } });
  expect(parseTerminalTranscript(line(record("first")) + line(record("second")))).toHaveLength(2);
});
