# Datenschutz

VMark respektiert Ihre Privatsphäre. Hier ist genau, was passiert — und was nicht.

## Was VMark sendet

VMark enthält einen **Auto-Update-Checker**, der unseren Server regelmäßig kontaktiert, um zu prüfen, ob eine neue Version verfügbar ist. Dies ist die **einzige** Netzwerkanfrage, die VMark stellt.

Jede Überprüfung sendet genau diese Felder — nicht mehr:

| Daten | Beispiel | Zweck |
|-------|---------|-------|
| IP-Adresse | `203.0.113.42` | Inhärent in jeder HTTP-Anfrage — wir können sie nicht nicht empfangen |
| Betriebssystem | `darwin`, `windows`, `linux` | Um das korrekte Update-Paket bereitzustellen |
| Architektur | `aarch64`, `x86_64` | Um das korrekte Update-Paket bereitzustellen |
| App-Version | `0.5.10` | Um zu bestimmen, ob ein Update verfügbar ist |
| Maschinen-Hash | `a3f8c2...` (64-stelliger Hex) | Anonymer Gerätezähler — SHA-256 aus Hostname + OS + Architektur; nicht umkehrbar |

Die vollständige URL sieht so aus:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Sie können dies selbst überprüfen — der Endpunkt befindet sich in [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (suchen Sie nach `"endpoints"`), und der Hash befindet sich in [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (suchen Sie nach `machine_id_hash`).

## Was VMark NICHT sendet

- Ihre Dokumente oder deren Inhalte
- Dateinamen oder Pfade
- Nutzungsmuster oder Funktionsanalysen
- Persönliche Informationen jeglicher Art
- Absturzberichte
- Tastenanschlag- oder Bearbeitungsdaten
- Umkehrbare Hardware-Kennungen oder Fingerabdrücke
- Der Maschinen-Hash ist ein Einweg-SHA-256-Digest — er kann nicht umgekehrt werden, um Ihren Hostname oder andere Eingaben wiederherzustellen

## Wie wir die Daten verwenden

Wir aggregieren die Update-Check-Protokolle, um die Live-Statistiken zu erstellen, die auf unserer [Startseite](/de/) angezeigt werden:

| Metrik | Wie sie berechnet wird |
|--------|----------------------|
| **Eindeutige Geräte** | Anzahl unterschiedlicher Maschinen-Hashes pro Tag/Woche/Monat |
| **Eindeutige IPs** | Anzahl unterschiedlicher IP-Adressen pro Tag/Woche/Monat |
| **Pings** | Gesamtanzahl der Update-Check-Anfragen |
| **Plattformen** | Anzahl der Pings pro OS + Architektur-Kombination |
| **Versionen** | Anzahl der Pings pro App-Version |

Diese Zahlen werden offen unter [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats) veröffentlicht. Nichts ist verborgen.

**Wichtige Vorbehalte:**
- Eindeutige IPs unterschätzen tatsächliche Benutzer — mehrere Personen hinter demselben Router/VPN zählen als eine
- Eindeutige Geräte liefern genauere Zählungen, aber eine Hostname-Änderung oder eine frische OS-Installation erzeugt einen neuen Hash
- Pings überschätzen tatsächliche Benutzer — eine Person kann mehrmals täglich prüfen

## Datenspeicherung

- Protokolle werden auf unserem Server im Standard-Zugriffsprotokollformat gespeichert
- Protokolldateien rotieren bei 1 MB und nur die 3 neuesten Dateien werden aufbewahrt
- Protokolle werden mit niemandem geteilt
- Es gibt kein Kontosystem — VMark weiß nicht, wer Sie sind
- Der Maschinen-Hash ist nicht mit einem Konto, einer E-Mail oder einer IP-Adresse verknüpft — er ist ausschließlich ein pseudonymer Gerätezähler
- Wir verwenden keine Tracking-Cookies, Fingerabdrücke oder Analytics-SDKs

## Was VMark auf dem Datenträger lesen kann

Der Dateizugriff von VMark ist ein eng begrenzter Berechtigungsbereich, nicht die ganze Festplatte:

- **Statischer Bereich**: Ihr Benutzerordner (`$HOME/**`) sowie eingebundene Laufwerke — `/Volumes/**` unter macOS, `/mnt/**` und `/media/**` unter Linux. Unter Windows umfasst er zusätzlich die Laufwerke `C:\` bis `F:\`, sodass nur `G:\` und spätere Laufwerke sowie Netzwerkfreigaben eine Laufzeitfreigabe benötigen. Unter macOS und Linux liegt alles innerhalb eines versteckten Ordners (dessen Name mit `.` beginnt) außerhalb des statischen Bereichs.
- **Laufzeitfreigaben**: Eine Datei, die Sie ausdrücklich öffnen — aus dem Finder oder Explorer, über die Befehlszeile `vmark` oder über einen Dateidialog —, erhält eine Freigabe für genau diese Datei. Ein **Ordner** wird nur freigegeben, wenn VMark erkennen kann, dass Sie ihn ausgewählt haben: Sie haben ihn im Ordnerdialog von VMark gewählt oder aus dem Finder geöffnet. VMark führt eine Liste dieser Ordner (`workspace-grants.json` im App-Datenordner) und gibt sie bei jedem Start erneut frei, damit Ihre wiederhergestellte Sitzung und **Zuletzt geöffneter Arbeitsbereich** weiter funktionieren. Ein zuletzt verwendeter Arbeitsbereich, der nicht auf dieser Liste steht und nicht im statischen Bereich liegt, öffnet den Ordnerdialog bei genau diesem Ordner — wählen Sie ihn zur Bestätigung aus. Wenn ein KI-Assistent einen solchen Ordner öffnen möchte, verfährt VMark genauso, nachdem Sie die Anfrage genehmigt haben.
- **Bilder und Medien**: Lokale Bilder, Videos und Audiodateien zeigt VMark über sein Asset-Protokoll an, das dieselben Orte erreicht — den statischen Bereich plus die oben genannten Laufzeitfreigaben. Der Medienbetrachter fügt eine Freigabe für die eine Datei hinzu, die er anzeigt, und nur für eine Datei mit Medienendung; eine Anfrage für einen anderen Pfad wird abgelehnt, statt den Bereich zu erweitern. Ein Bild außerhalb dieser Orte, etwa eines neben einem Dokument, das Sie einzeln von außerhalb des statischen Bereichs geöffnet haben, wird erst angezeigt, wenn Sie seinen Ordner als Arbeitsbereich öffnen.

Hier wird nichts irgendwohin gesendet; der Bereich legt fest, was die App selbst lesen darf.

## Open-Source-Transparenz

VMark ist vollständig Open Source. Sie können alles hier Beschriebene überprüfen:

- Update-Endpunkt-Konfiguration: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Maschinen-Hash-Generierung: [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — nach `machine_id_hash` suchen
- Dateisystem- und Asset-Bereich: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), der Eintrag `assetProtocol` in [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) und [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- Serverseitige Statistik-Aggregation: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — das genaue Skript, das auf unserem Server läuft, um die [öffentlichen Statistiken](https://log.vmark.app/api/stats) zu erstellen
- Es gibt keine anderen Netzwerkaufrufe im Codebase — suchen Sie selbst nach `fetch`, `http` oder `reqwest`

## Update-Prüfungen deaktivieren

Wenn Sie automatische Update-Prüfungen vollständig deaktivieren möchten, können Sie `log.vmark.app` auf Netzwerkebene blockieren (Firewall, `/etc/hosts` oder DNS). VMark funktioniert weiterhin normal ohne diese — Sie erhalten nur keine Update-Benachrichtigungen mehr.
