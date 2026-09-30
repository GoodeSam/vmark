/** The rendered transcript region beside the CLI grid. Mounted only while open —
 * its toggle lives in the tab bar and its state in useRenderedTranscript — so a
 * collapsed transcript costs no space and renders no diagrams.
 * @module components/Terminal/TerminalTranscript */
import { useTranslation } from "react-i18next";
import type { TranscriptMessage } from "@/utils/terminalTranscript";
import { TranscriptMarkdown } from "./TranscriptMarkdown";
import type { TranscriptConfigStatus } from "./useTranscriptConfiguration";
import "./terminal-transcript.css";
export function TerminalTranscript({ id, messages, failed, configuration }: { id: string; messages: TranscriptMessage[]; failed: boolean; configuration: TranscriptConfigStatus }) {
  const { t } = useTranslation("settings");
  return <section id={id} className="terminal-transcript" aria-label={t("terminal.transcript.title")}>
    {configuration === "failed" || failed ? <p role="alert">{t("terminal.transcript.error")}</p> : messages.length ? messages.map(message => <article key={message.id}><TranscriptMarkdown text={message.text} /></article>) : <p>{t("terminal.transcript.waiting")}</p>}
  </section>;
}
