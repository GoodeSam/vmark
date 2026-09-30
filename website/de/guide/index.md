# Erste Schritte mit VMark

VMark ist der Klartext-Arbeitsbereich, in dem Menschen und KI zusammenarbeiten. Beide Seiten lesen und schreiben dieselben Artefakte direkt — Markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, Code — ohne Übersetzungsschicht dazwischen. Ist eine Datei ein bekanntes Artefakt (ein GitHub-Actions-Workflow, `Cargo.toml`, `package.json`, `pyproject.toml`), rendert VMark die *passende* Ansicht und keinen generischen JSON-Baum.

Das Unterscheidungsmerkmal ist nicht „mehr Dateitypen öffnen“ — das kann jede IDE. Es sind **schemabewusste Vorschauen**: die strukturierte Ansicht pro Artefakt, kombiniert mit einem Live-Quelltextbereich.

## Schnellstart

1. **VMark herunterladen und installieren** von der [Download-Seite](/de/download)
2. **Die App starten** und sofort mit dem Schreiben beginnen
3. **Eine Datei öffnen** über **Datei → Datei öffnen…** oder per Drag & Drop in jedem [unterstützten Format](/de/guide/formats) — `Cmd/Strg + O` ist **Schnell öffnen**, um zu einer zuletzt verwendeten, geöffneten oder Arbeitsbereichsdatei zu springen
4. **Einen Ordner öffnen** mit `Cmd/Strg + Umschalt + O` für den Arbeitsbereichsmodus

## Überblick über die Benutzeroberfläche

### Hauptbereiche

- **Editor**: Der Hauptbereich zum Verfassen Ihrer Dokumente
- **Seitenleiste**: Dateibaum-Navigation (umschalten mit `Strg + Umschalt + 2`)
- **Gliederung**: Dokumentstrukturansicht (umschalten mit `Strg + Umschalt + 1`)
- **Statusleiste**: Wortanzahl, Zeichenanzahl und Autospeicher-Status (umschalten mit `F7`)
- **Terminal**: Integriertes Shell-Panel (umschalten mit `` Strg + ` ``)

### Menüleiste

- **Datei**: Neu, Schnell öffnen, zuletzt geöffnete Dateien und Arbeitsbereiche, Dokumentverlauf, Speichern, Exportieren, Drucken, Schließen
- **Bearbeiten**: Rückgängig/Wiederholen, Zwischenablage, Suchen (einschließlich In Dateien suchen), Auswahl, Zeilenoperationen, Zeilenenden, Genies
- **Format**: Textstile, Überschriften, Listen, Blockzitate, Texttransformationen, CJK-Formatierung, Textbereinigung, Bildbereinigung
- **Einfügen**: Links, Bilder, Video, Audio, Tabellen, Code-Blöcke, Mathematik, Diagramme, Fußnoten, zusammenklappbare Blöcke, Infoboxen
- **Ansicht**: Editormodi, Bereiche, Seitenleisten-Panels, Fokus-/Schreibmaschinenmodi, Symbolleiste, Terminal, Fensterstatus, Markdown prüfen, Zoom
- **Fenster** (macOS): Minimieren, Maximieren, Kohärenz-Aufschlüsselung, Alle nach vorne bringen
- **Hilfe**: VMark-Hilfe, Tastenkürzel, der Shell-Befehl `vmark` (macOS), Problem melden

### Bearbeitungsmodi

VMark unterstützt drei Bearbeitungsmodi, zwischen denen Sie wechseln können:

| Modus | Beschreibung | Tastenkürzel |
|-------|-------------|--------------|
| Rich-Text | WYSIWYG-Bearbeitung mit Live-Formatierung | Standard |
| Quelle | Rohes Markdown mit Syntaxhervorhebung | `F6` |
| Geteilt | Quelltext links, schreibgeschützte Live-Vorschau rechts | `Umschalt + F6` |

### Ansichtsmodi

Verbessern Sie Ihren Schreibfokus mit diesen Ansichtsmodi:

| Modus | Beschreibung | Tastenkürzel |
|-------|-------------|--------------|
| Fokus | Aktuellen Absatz hervorheben | `F8` |
| Schreibmaschine | Cursor zentriert halten | `F9` |
| Zeilenumbruch | Zeilenumbruch ein-/ausschalten | `Alt + Z` |

## Grundlegende Formatierung

### Textstile

| Stil | Syntax | Tastenkürzel |
|------|--------|--------------|
| **Fett** | `**Text**` | `Cmd/Strg + B` |
| *Kursiv* | `*Text*` | `Cmd/Strg + I` |
| ~~Durchgestrichen~~ | `~~Text~~` | `Cmd/Strg + Umschalt + X` |
| `Code` | `` `code` `` | `Cmd/Strg + Umschalt + `` ` `` |

### Blockelemente

- **Überschriften**: `#`-Symbole verwenden oder `Cmd/Strg + 1-6`
- **Listen**: Zeilen mit `-`, `*`, `1.` oder `- [ ]` für Aufgabenlisten beginnen
- **Zitate**: Mit `>` beginnen oder `Alt/Option + Cmd + Q` verwenden
- **Codeblöcke**: Dreifache Backticks mit optionaler Sprache verwenden
- **Tabellen**: Über **Einfügen → Tabelle** oder `Cmd/Strg + Umschalt + T`

## Mit Dateien arbeiten

### Erstellen und Öffnen

- **Neue Datei**: `Cmd/Strg + N`
- **Datei öffnen**: **Datei → Datei öffnen…** (kein Standardkürzel)
- **Schnell öffnen**: `Cmd/Strg + O` — zu einer zuletzt verwendeten, geöffneten oder Arbeitsbereichsdatei springen
- **Ordner öffnen**: `Cmd/Strg + Umschalt + O` (Arbeitsbereichsmodus)

### Speichern

- **Speichern**: `Cmd/Strg + S`
- **Speichern unter**: `Cmd/Strg + Umschalt + S`
- **Autospeichern**: Standardmäßig aktiviert, in den Einstellungen konfigurierbar

### Exportieren

- **HTML exportieren**: **Datei → Exportieren → HTML** — ein Ordner mit `index.html`, `standalone.html` und dem interaktiven VMark Reader
- **PDF exportieren**: **Datei → Exportieren → PDF** — Seiteneinrichtung, Schriftarten, Seitenzahlen und eine Gliederung in der Seitenleiste; oder Drucken (`Cmd/Strg + P`) und im Systemdialog als PDF speichern
- **Als HTML kopieren**: `Cmd/Strg + Umschalt + C`

Exportiertes HTML enthält den VMark Reader mit Inhaltsverzeichnis, Einstellungsbereich und mehr. [Mehr erfahren →](/de/guide/export)

## Einstellungen

Öffnen Sie die Einstellungen mit `Cmd/Strg + ,`, um Folgendes anzupassen:

- **Erscheinungsbild**: Design, Schriftarten, Schriftgröße, Zeilenhöhe
- **Editor**: Autospeicher-Intervall, Standardverhalten
- **Dateien & Bilder**: Asset-Verwaltung, Dokumentwerkzeuge
- **Integrationen**: KI-Anbieter, MCP-Server
- **Sprache**: CJK-Formatierungsregeln
- **Markdown**: Exportoptionen, Formatierungseinstellungen
- **Tastaturkürzel**: Tastaturkürzel anpassen
- **Terminal**: Terminalschriftgröße und Zeilenhöhe

## KI-Schreibassistenz

VMark enthält integrierte KI-Genies — wählen Sie Text aus und drücken Sie `Mod + Y`, um mit KI zu verfeinern, zu erweitern, zu übersetzen oder Ihren Text zu transformieren. Konfigurieren Sie Ihren bevorzugten Anbieter unter **Einstellungen > Integrationen**.

[Mehr über KI-Genies →](/de/guide/ai-genies) | [Anbieter konfigurieren →](/de/guide/ai-providers)

## Tipps für den Einstieg

1. **Mit der Gliederung navigieren**: Klicken Sie auf Gliederungselemente, um zu Abschnitten zu springen
2. **Fokusmodus ausprobieren**: `F8` blendet alles außer dem aktuellen Absatz ab
3. **Während des Schreibens validieren**: `Alt + Mod + V` (**Ansicht → Markdown prüfen**) führt die Markdown-Lint-Engine und die Prüfung auf defekte Links aus
4. **Tastaturkürzel lernen**: Die vollständige Referenz finden Sie im [Tastaturkürzel-Leitfaden](/de/guide/shortcuts)

## Nächste Schritte

- Lernen Sie alle [Funktionen](/de/guide/features) kennen
- Meistern Sie [Tastaturkürzel](/de/guide/shortcuts)
- Erkunden Sie [CJK-Formatierung](/de/guide/cjk-formatting) Werkzeuge
