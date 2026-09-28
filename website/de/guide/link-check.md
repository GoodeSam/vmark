# Link-Prüfung

VMark verifiziert, dass lokale Link- und Bildziele in Ihrem Markdown tatsächlich auf der Festplatte existieren. Läuft zusammen mit der [Markdown-Lint-Engine](/de/guide/lint) bei `Alt + Mod + V` oder **Ansicht → Markdown prüfen**.

## Was geprüft wird

Für jeden lokalen Link und jedes Bild im Dokument:

- `[text](./other.md)` — die Datei `./other.md` lässt sich auflösen und existiert
- `![alt](./image.png)` — die Bilddatei existiert
- `[text](./other.md#section)` — die Datei existiert (Anker-Prüfung erfolgt durch die [`linkFragments`-Regel](/de/guide/lint#regelreferenz))

Wenn ein Ziel fehlt, erscheint ein Eintrag im Lint-Badge und in der Navigation mit `F2` / `Shift + F2`. Wie er dargestellt wird, hängt vom Modus ab: Im Quellmodus erhält der Link die rote Diagnose-Wellenlinie von CodeMirror; im WYSIWYG-Modus wird der gesamte Block, der den Link enthält, mit einem roten Balken am linken Rand und einer leichten Tönung markiert — Lint-Markierungen im WYSIWYG-Modus gelten immer für den ganzen Block, nie als Unterstreichung im Text.

## Was übersprungen wird

- **Reine Fragment-Links** (`#anchor`) — werden von der `linkFragments`-Regel behandelt, die gegen die Überschriften des aktuellen Dokuments prüft
- **Externe URLs** — jedes URI-Schema (`http:`, `https:`, `mailto:`, `obsidian:`, `vscode:`, …) sowie protokollrelative `//host/…`-URLs. Windows-Pfade mit Laufwerksbuchstaben (`C:\…`, `C:/…`) werden weiterhin als Dateipfade geprüft
- **Unbenannte Dokumente** — ohne gespeicherten Dateipfad lassen sich relative URLs gegen kein Verzeichnis auflösen
- **Netzwerkpfade und laufwerksrelative Pfade** — ein UNC-Pfad (`\\server\share\…`) wird nie nachgeschlagen, weil die Prüfung unter Windows diesen Host über das Netzwerk kontaktieren würde (und ihm dabei Ihre Windows-Anmeldedaten anbieten könnte). Ein laufwerksrelativer Pfad wie `C:file.md` (ein Laufwerksbuchstabe ohne nachfolgenden Schrägstrich) wird ebenfalls übersprungen: Er ist relativ zum Arbeitsverzeichnis der App, nicht zum Dokument

## Wie die Auflösung funktioniert

Link-Prüfung löst einen relativen Pfad gegen das Verzeichnis der Quelldatei auf und behandelt einen absoluten Pfad als die Datei, die er benennt:

| Link in `/repo/docs/intro.md` | Wird aufgelöst zu |
|---|---|
| `[a](./other.md)` | `/repo/docs/other.md` |
| `[a](../shared.md)` | `/repo/shared.md` |
| `[a](images/logo.png)` | `/repo/docs/images/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md` (ein absoluter Pfad benennt genau diese Datei; unter Windows landet er auf dem Laufwerk des Dokuments) |

Fragmente werden vor der Datei-Suche entfernt — `[a](./other.md#section)` prüft nur `./other.md`.

## Performance

- **Asynchron** — läuft parallel zu den synchronen Regeln; Ergebnisse werden eingemischt, sobald sie bereit sind
- **Dedupliziert** — jeder eindeutige aufgelöste Pfad wird pro Lauf nur einmal geprüft, auch bei Mehrfachverlinkung
- **Kein Trigger pro Tastendruck** — `fs.exists` bei jedem Tastenanschlag würde das System überlasten; läuft nur bei explizitem Lint-Trigger
- **Toleranz gegenüber operationalen Fehlern** — wenn `fs.exists` eine Ausnahme wirft (Berechtigung verweigert, Capability-Scope-Problem), ist das Ergebnis `error` (übersprungen), nicht `missing`. Lieber stumm als falsch.

## Diagnosecodes

| Code | Schweregrad | Auslöser |
|---|---|---|
| **M001** | Fehler | Bilddatei am aufgelösten lokalen Pfad nicht gefunden |
| **M002** | Fehler | Verlinkte Datei am aufgelösten lokalen Pfad nicht gefunden |

## Siehe auch

- [Markdown-Lint](/de/guide/lint) — vollständige Regelreferenz
- [Einstellungen → Markdown → Lint](/de/guide/settings#lint)
