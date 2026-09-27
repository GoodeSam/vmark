# Controllo collegamenti

VMark verifica che i target locali di collegamenti e immagini nel tuo markdown esistano effettivamente su disco. Viene eseguito insieme al [motore di lint markdown](/it/guide/lint) tramite `Alt + Mod + V` o **Vista → Controlla Markdown**.

## Cosa controlla

Per ogni collegamento e immagine locale nel documento:

- `[testo](./altro.md)` — il file `./altro.md` si risolve ed esiste
- `![alt](./immagine.png)` — il file immagine esiste
- `[testo](./altro.md#sezione)` — il file esiste (il controllo dell'ancoraggio è gestito dalla [regola `linkFragments`](/it/guide/lint#riferimento-delle-regole))

Quando un target è mancante, una voce appare nel badge del lint e nella navigazione `F2` / `Shift + F2`. Il modo in cui viene disegnato dipende dalla modalità: in modalità Sorgente il collegamento riceve la sottolineatura diagnostica rossa di CodeMirror; in modalità WYSIWYG l'intero blocco che contiene il collegamento viene marcato con una barra rossa lungo il bordo sinistro e una leggera tinta — i segni di lint in WYSIWYG sono a livello di blocco, mai una sottolineatura inline.

## Cosa salta

- **Collegamenti solo frammento** (`#ancoraggio`) — gestiti dalla regola `linkFragments` che controlla rispetto alle intestazioni del documento corrente
- **URL esterni** — qualsiasi schema URI (`http:`, `https:`, `mailto:`, `obsidian:`, `vscode:`, …) e gli URL relativi al protocollo `//host/…`. I percorsi Windows con lettera di unità (`C:\…`, `C:/…`) vengono comunque controllati come percorsi di file
- **Documenti senza titolo** — senza un percorso di file salvato, gli URL relativi non possono essere risolti rispetto a nessuna directory
- **Percorsi di rete e percorsi relativi all'unità** — un percorso UNC (`\\server\share\…`) non viene mai cercato, perché controllarlo su Windows contatterebbe quell'host attraverso la rete (e potrebbe offrirgli le tue credenziali di accesso a Windows). Anche un percorso relativo all'unità come `C:file.md` (una lettera di unità senza barra dopo) viene saltato: è relativo alla directory di lavoro dell'app, non al documento

## Come funziona la risoluzione

Il controllo dei collegamenti risolve un percorso relativo rispetto alla directory del file sorgente, e considera un percorso assoluto come il file che nomina:

| Collegamento in `/repo/docs/intro.md` | Si risolve in |
|---|---|
| `[a](./altro.md)` | `/repo/docs/altro.md` |
| `[a](../condiviso.md)` | `/repo/condiviso.md` |
| `[a](immagini/logo.png)` | `/repo/docs/immagini/logo.png` |
| `[a](/docs/intro.md)` | `/docs/intro.md` (un percorso assoluto nomina quel file; su Windows finisce sull'unità del documento stesso) |

I frammenti vengono rimossi prima della ricerca del file — `[a](./altro.md#sezione)` controlla solo `./altro.md`.

## Prestazioni

- **Asincrono** — viene eseguito in parallelo con le regole sincrone; i risultati vengono integrati quando pronti
- **Deduplicato** — ogni percorso risolto univoco viene controllato una sola volta per esecuzione, anche se collegato più volte
- **Nessun trigger su pressione tasto** — `fs.exists` su ogni pressione tasto sarebbe gravoso; viene eseguito solo sul trigger esplicito di lint
- **Tolleranza agli errori operativi** — se `fs.exists` lancia un'eccezione (permesso negato, problema di scope delle capacità), il risultato è `error` (saltato), non `missing`. Meglio silenzioso che sbagliato.

## Codici diagnostici

| Codice | Gravità | Trigger |
|---|---|---|
| **M001** | Errore | File immagine non trovato nel percorso locale risolto |
| **M002** | Errore | File collegato non trovato nel percorso locale risolto |

## Vedi anche

- [Lint markdown](/it/guide/lint) — riferimento completo delle regole
- [Impostazioni → Markdown → Lint](/it/guide/settings#lint)
