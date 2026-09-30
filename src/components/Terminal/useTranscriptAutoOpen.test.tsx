// WI-TP3.1: collapsed by default; each new rich reply opens once; a user's collapse is respected.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTranscriptAutoOpen } from "./useTranscriptAutoOpen";
import type { TranscriptMessage } from "@/utils/terminalTranscript";
const TABLE = "| A |\n| - |\n| 1 |";
const plain = (id: string): TranscriptMessage => ({ id, text: `plain ${id}` });
const rich = (id: string): TranscriptMessage => ({ id, text: TABLE });
interface Props { sessionId: string | null; messages: TranscriptMessage[]; loaded: boolean }
function setup(initial: Props) {
  return renderHook((props: Props) => useTranscriptAutoOpen(props.sessionId, props.messages, props.loaded), { initialProps: initial });
}
describe("useTranscriptAutoOpen", () => {
  it("starts collapsed and stays collapsed for plain replies", () => {
    const { result, rerender } = setup({ sessionId: "s", messages: [], loaded: true });
    expect(result.current[0]).toBe(false);
    rerender({ sessionId: "s", messages: [plain("1"), plain("2")], loaded: true });
    expect(result.current[0]).toBe(false);
  });
  it("opens when a new reply contains a table or diagram", () => {
    const { result, rerender } = setup({ sessionId: "s", messages: [plain("1")], loaded: true });
    rerender({ sessionId: "s", messages: [plain("1"), rich("2")], loaded: true });
    expect(result.current[0]).toBe(true);
  });
  it("does not reopen for the same reply after the user collapses it, but does for the next", () => {
    const { result, rerender } = setup({ sessionId: "s", messages: [], loaded: true });
    rerender({ sessionId: "s", messages: [rich("1")], loaded: true });
    act(() => result.current[1](false));
    rerender({ sessionId: "s", messages: [rich("1"), plain("2")], loaded: true });
    expect(result.current[0]).toBe(false);
    rerender({ sessionId: "s", messages: [rich("1"), plain("2"), rich("3")], loaded: true });
    expect(result.current[0]).toBe(true);
  });
  it("treats history present on the first loaded snapshot as the baseline", () => {
    const { result, rerender } = setup({ sessionId: "s", messages: [], loaded: false });
    rerender({ sessionId: "s", messages: [rich("old")], loaded: true });
    expect(result.current[0]).toBe(false);
  });
  it("re-baselines when the terminal switches session, without opening for old content", () => {
    const { result, rerender } = setup({ sessionId: "a", messages: [], loaded: true });
    rerender({ sessionId: "b", messages: [], loaded: false });
    rerender({ sessionId: "b", messages: [rich("b1")], loaded: true });
    expect(result.current[0]).toBe(false);
    rerender({ sessionId: "b", messages: [rich("b1"), rich("b2")], loaded: true });
    expect(result.current[0]).toBe(true);
  });
  it("lets the user open it manually with nothing rich", () => {
    const { result } = setup({ sessionId: "s", messages: [plain("1")], loaded: true });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
