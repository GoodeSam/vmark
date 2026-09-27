# Mehrcursor-Bearbeitung

VMark unterstützt leistungsstarke Mehrcursor-Bearbeitung sowohl im WYSIWYG- als auch im Quellmodus, sodass Sie mehrere Stellen gleichzeitig bearbeiten können.

## Schnellstart

| Aktion | Kürzel |
|--------|--------|
| Cursor bei nächster Übereinstimmung hinzufügen | `Mod + D` |
| Übereinstimmung überspringen, zur nächsten springen | `Mod + Umschalt + D` |
| Cursor bei allen Übereinstimmungen hinzufügen | `Mod + Umschalt + L` |
| Cursor bei allen Übereinstimmungen im aktuellen Block hinzufügen | `Alt + Mod + Umschalt + L` |
| Letzte Cursor-Hinzufügung rückgängig machen | `Alt + Mod + Z` |
| Cursor darüber hinzufügen | `Mod + Alt + Auf` |
| Cursor darunter hinzufügen | `Mod + Alt + Ab` |
| Cursor hinzufügen/entfernen per Klick | `Alt + Klick` |
| Auf einzelnen Cursor reduzieren | `Escape` |

::: tip
**Mod** = Cmd auf macOS, Strg auf Windows/Linux
**Alt** = Option auf macOS
:::

## Cursor hinzufügen

### Nächstes Vorkommen auswählen (`Mod + D`)

1. Ein Wort auswählen oder Cursor auf ein Wort setzen
2. `Mod + D` drücken, um einen Cursor beim nächsten Vorkommen hinzuzufügen
3. Erneut drücken, um weitere Cursor hinzuzufügen
4. Tippen, um alle Stellen gleichzeitig zu bearbeiten

<div class="feature-box">
<strong>Beispiel:</strong> Eine Variable <code>count</code> in <code>total</code> umbenennen:
<ol>
<li>Doppelklick auf <code>count</code> zum Auswählen</li>
<li><code>Mod + D</code> wiederholt drücken, um jedes Vorkommen auszuwählen</li>
<li><code>total</code> eingeben — alle Vorkommen werden gleichzeitig aktualisiert</li>
</ol>
</div>

### Alle Vorkommen auswählen (`Mod + Umschalt + L`)

Alle Vorkommen des aktuellen Wortes oder der Auswahl auf einmal auswählen:

1. Ein Wort oder Text auswählen
2. `Mod + Umschalt + L` drücken
3. Alle übereinstimmenden Vorkommen im Dokument werden ausgewählt — oder, innerhalb eines Code-Blocks, alle Treffer in diesem Block (siehe [Geltungsbereich](#geltungsbereich))
4. Tippen, um alle auf einmal zu ersetzen

Um innerhalb des aktuellen Absatzes, der Überschrift oder des Listenelements zu bleiben, verwenden Sie stattdessen `Alt + Mod + Umschalt + L`.

### Alt + Klick

`Alt` (Option auf macOS) gedrückt halten und klicken, um:
- **Einen Cursor hinzuzufügen** an dieser Position
- **Einen Cursor zu entfernen**, wenn dort bereits einer vorhanden ist

Dies ist nützlich, um Cursor an beliebigen Positionen zu platzieren, die keinen übereinstimmenden Text haben.

### Vorkommen überspringen (`Mod + Umschalt + D`)

Wenn `Mod + D` eine ungewünschte Übereinstimmung auswählt, können Sie diese überspringen:

1. `Mod + D` drücken, um mit dem Hinzufügen von Übereinstimmungen zu beginnen
2. Wenn die neueste Übereinstimmung unerwünscht ist, `Mod + Umschalt + D` drücken, um sie zu überspringen
3. Die übersprungene Übereinstimmung wird entfernt und die nächste wird stattdessen ausgewählt

Dies ist das Mehrcursor-Äquivalent von „Weitersuchen" — es ermöglicht die gezielte Auswahl der zu bearbeitenden Vorkommen.

### Weiches Rückgängig (`Alt + Mod + Z`)

Die letzte Cursor-Hinzufügung rückgängig machen, ohne alle Cursor zu verlieren:

1. `Mod + D` mehrmals drücken, um Cursor aufzubauen
2. Wenn einer zu viele hinzugefügt wurden, `Alt + Mod + Z` drücken
3. Der zuletzt hinzugefügte Cursor wird entfernt und der vorherige Zustand wiederhergestellt

Im Gegensatz zu `Escape` (das alles reduziert) macht das weiche Rückgängig einen Cursor nach dem anderen zurück.

### Cursor darüber/darunter hinzufügen (`Mod + Alt + Auf/Ab`)

Cursor vertikal hinzufügen, eine Zeile nach der anderen:

1. Cursor auf eine Zeile setzen
2. `Mod + Alt + Ab` drücken, um einen Cursor in der nächsten Zeile hinzuzufügen
3. Erneut drücken, um weitere Cursor nach unten hinzuzufügen
4. `Mod + Alt + Auf` verwenden, um Cursor nach oben hinzuzufügen

Dies eignet sich ideal für die Bearbeitung spaltenausgerichteten Texts oder für gleiche Bearbeitungen über aufeinanderfolgende Zeilen hinweg.

## Bearbeitung mit mehreren Cursorn

Sobald Sie mehrere Cursor haben, funktioniert jede Standard-Bearbeitung an jedem Cursor:

### Tippen
- Zeichen werden an allen Cursorpositionen eingefügt
- Auswahlen werden an allen Positionen ersetzt

### Löschen
- **Rücktaste** — löscht das Zeichen vor jedem Cursor
- **Entf** — löscht das Zeichen nach jedem Cursor

### Navigation
- **Pfeiltasten** — bewegen alle Cursor gemeinsam
- **Umschalt + Pfeil** — Auswahl an jedem Cursor erweitern
- **Mod + Pfeil** — wortweise/zeilenweise an jedem Cursor springen

### Tab-Escape

Tab-Escape funktioniert unabhängig für jeden Cursor:

- Cursor innerhalb von **Fett**, *Kursiv*, `Code` oder ~~Durchgestrichen~~ springen ans Ende der Formatierung
- Cursor innerhalb von Links verlassen den Link
- Cursor vor schließenden Klammern `)` `]` `}` springen darüber
- Cursor im Klartext bleiben an ihrer Position

Dies ermöglicht das gleichzeitige Verlassen mehrerer formatierter Bereiche. Siehe [Intelligente Tab-Navigation](/de/guide/tab-navigation#mehrcursor-unterstutzung) für Details.

### Zwischenablage

**Kopieren** (`Mod + C`):
- Kopiert Text aus allen Auswahlen, zusammengefügt durch Zeilenumbrüche

**Einfügen** (`Mod + V`):
- Wenn die Zwischenablage genauso viele Zeilen wie Cursor enthält, geht jede Zeile zu jedem Cursor
- Andernfalls wird der vollständige Inhalt der Zwischenablage an allen Cursorn eingefügt

## Geltungsbereich

**Code ist begrenzt, Fließtext nicht.** Innerhalb eines Code-Blocks (WYSIWYG) oder eines umzäunten Blocks (Quellmodus) überschreiten Cursor nie die Zaungrenze — das Abgleichen eines Variablennamens in einem Snippet kann keinen Cursor in einem anderen platzieren. Im gewöhnlichen Fließtext durchsuchen `Mod + D` und `Mod + Umschalt + L` das **gesamte Dokument**.

Das ist oft genau das, was Sie wollen, gelegentlich aber nicht: In einem langen Dokument platziert das Abgleichen eines häufigen Wortes Cursor in Absätzen weit außerhalb des sichtbaren Bereichs.

### Alle Vorkommen im Block auswählen

`Alt + Mod + Umschalt + L` wählt jeden Treffer **nur innerhalb des aktuellen Blocks** aus — des Absatzes, der Überschrift oder des Listenelements, in dem sich Ihr Cursor befindet. Im Quellmodus begrenzen Leerzeilen einen Block; im WYSIWYG-Modus begrenzt ihn der umschließende Block. Innerhalb eines Code-Zauns verhält es sich genau wie `Mod + Umschalt + L`, da der Zaun bereits der Block ist.

Die beiden sind Geschwister, kein Modus: `Mod + Umschalt + L` reicht weiterhin über das gesamte Dokument, sodass sich an nichts, worauf Sie sich bereits verlassen, etwas ändert.

<div class="feature-box">
<strong>Welches nehmen?</strong>
<p>Greifen Sie zur blockbegrenzten Variante, wenn das Wort häufig vorkommt — etwa beim Umbenennen einer Variablen, die im Fließtext erwähnt wird, oder beim Bearbeiten des Musters eines einzelnen Listenelements. Greifen Sie zur dokumentweiten Variante, wenn Sie wirklich überall meinen.</p>
</div>

## Cursor reduzieren

`Escape` drücken, um auf einen einzelnen Cursor an der primären Position zu reduzieren.

::: tip Cursor-Stabilität
Reduzierte Cursor bleiben stabil, wenn Text an der Cursorposition eingefügt wird. Sie expandieren nach zugeordneten Einfügungen nicht unerwartet zu Auswahlen (behoben in v0.6.x).
:::

## Visuelles Feedback

- **Primärer Cursor** — Standard-blinkender Cursor
- **Sekundäre Cursor** — zusätzliche blinkende Cursor mit eigenem Stil
- **Auswahlen** — die Auswahl jedes Cursors ist hervorgehoben

Im Dunkelmodus passen sich Cursor- und Auswahlfarben automatisch für bessere Sichtbarkeit an.

## Modusvergleich

| Funktion | WYSIWYG | Quelle |
|----------|---------|--------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Umschalt + D` (Überspringen) | ✓ | ✓ |
| `Mod + Umschalt + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Weiches Rückgängig) | ✓ | ✓ |
| `Mod + Alt + Auf/Ab` | ✓ | ✓ |
| `Alt + Klick` | ✓ | ✓ |
| Zaun-Begrenzung | Code-Blöcke | Code-Zäune |
| Blockbegrenztes Alles-Auswählen | `Alt + Mod + Umschalt + L` | `Alt + Mod + Umschalt + L` |
| Rundum-Suche | ✓ | ✓ |

## Tipps & Bewährte Praktiken

### Variablen umbenennen
1. Doppelklick auf den Variablennamen
2. `Alt + Mod + Umschalt + L`, um jeden Treffer in diesem Block auszuwählen (oder `Mod + Umschalt + L` für das gesamte Dokument)
3. Neuen Namen eingeben

### Präfixe/Suffixe hinzufügen
1. Cursor vor/nach wiederholtem Text platzieren
2. `Mod + D`, um Cursor bei jedem Vorkommen hinzuzufügen
3. Präfix oder Suffix eingeben

### Listenelemente bearbeiten
1. Das gemeinsame Muster auswählen (z.B. `- ` am Zeilenanfang)
2. `Mod + Umschalt + L`, um alle auszuwählen
3. Alle Listenelemente auf einmal bearbeiten

### Wann welches Kürzel verwenden

| Szenario | Bestes Kürzel |
|----------|---------------|
| Sorgfältige, schrittweise Auswahl | `Mod + D` |
| Unerwünschte Übereinstimmung überspringen | `Mod + Umschalt + D` |
| Alle im aktuellen Block ersetzen | `Alt + Mod + Umschalt + L` |
| Alle im Dokument ersetzen | `Mod + Umschalt + L` |
| Letzten Cursor-Schritt rückgängig machen | `Alt + Mod + Z` |
| Aufeinanderfolgende Zeilen bearbeiten | `Mod + Alt + Auf/Ab` |
| Beliebige Positionen | `Alt + Klick` |
| Schneller Ausstieg | `Escape` |

## Einschränkungen

- **Atom-Knoten**: Im WYSIWYG-Modus können keine Cursor innerhalb von Bildern, eingebetteten Inhalten oder Mathe-Blöcken platziert werden
- **IME-Eingabe**: Bei der Verwendung von Eingabemethoden (Chinesisch, Japanisch usw.) beeinflusst die Komposition nur den primären Cursor
- **Code-Blöcke**: Innerhalb eines Code-Blocks (WYSIWYG) oder umzäunten Blocks (Quellmodus) verlässt die Suche nach Vorkommen diesen Block nie

## Tastaturkurzreferenz

| Aktion | Kürzel |
|--------|--------|
| Nächstes Vorkommen auswählen | `Mod + D` |
| Vorkommen überspringen | `Mod + Umschalt + D` |
| Alle Vorkommen auswählen | `Mod + Umschalt + L` |
| Cursor weiches Rückgängig | `Alt + Mod + Z` |
| Cursor darüber hinzufügen | `Mod + Alt + Auf` |
| Cursor darunter hinzufügen | `Mod + Alt + Ab` |
| Cursor hinzufügen/entfernen | `Alt + Klick` |
| Auf einzelnen Cursor reduzieren | `Escape` |
| Alle Cursor bewegen | Pfeiltasten |
| Alle Auswahlen erweitern | `Umschalt + Pfeil` |
| Wortweise springen | `Alt + Pfeil` |
| Zeilenweise springen | `Mod + Pfeil` |

<!-- Styles in style.css -->
