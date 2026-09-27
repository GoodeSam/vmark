# Introduzione a VMark

VMark è lo spazio di lavoro in testo semplice dove esseri umani e IA collaborano. Entrambe le parti leggono e scrivono direttamente gli stessi artefatti — markdown, YAML, JSON, TOML, Mermaid, SVG, HTML, codice — senza alcuno strato di traduzione nel mezzo. Quando il file è un artefatto noto (un workflow di GitHub Actions, `Cargo.toml`, `package.json`, `pyproject.toml`), VMark mostra la vista *giusta*, non un generico albero JSON.

Il fattore distintivo non è "aprire più tipi di file" — lo fa qualsiasi IDE. Sono le **anteprime consapevoli dello schema**: la vista strutturata per ogni artefatto, affiancata da un riquadro sorgente in tempo reale.

## Avvio Rapido

1. **Scarica e installa** VMark dalla [pagina di download](/it/download)
2. **Avvia l'app** e inizia subito a scrivere
3. **Apri un file** con **File → Apri file…** oppure trascina e rilascia un file in qualsiasi [formato supportato](/it/guide/formats) — `Cmd/Ctrl + O` è **Apertura rapida**, per passare a un file recente, aperto o dello spazio di lavoro
4. **Apri una cartella** con `Cmd/Ctrl + Shift + O` per la modalità workspace

## Panoramica dell'Interfaccia

### Aree Principali

- **Editor**: L'area di scrittura principale dove componi i tuoi documenti
- **Barra laterale**: Navigazione ad albero dei file (attiva/disattiva con `Ctrl + Shift + 2`)
- **Struttura**: Vista della struttura del documento (attiva/disattiva con `Ctrl + Shift + 1`)
- **Barra di stato**: Conteggio parole, conteggio caratteri e stato del salvataggio automatico (attiva/disattiva con `F7`)
- **Terminale**: Pannello shell integrato (attiva/disattiva con `` Ctrl + ` ``)

### Barra dei Menu

- **File**: Nuovo, Apertura rapida, file e spazi di lavoro recenti, cronologia documento, salva, esporta, stampa, chiudi
- **Modifica**: Annulla/ripeti, appunti, trova (incluso Trova nei file), selezione, operazioni sulle righe, fine riga, Genies
- **Formato**: Stili di testo, titoli, elenchi, citazioni, trasformazioni del testo, formattazione CJK, pulizia testo, pulizia immagini
- **Inserisci**: Link, immagini, video, audio, tabelle, blocchi di codice, formule matematiche, diagrammi, note a piè di pagina, blocchi comprimibili, riquadri informativi
- **Vista**: Modalità editor, riquadri, pannelli della barra laterale, modalità focus/macchina da scrivere, barra degli strumenti, terminale, Stato finestre, Controlla Markdown, zoom
- **Finestra** (macOS): Riduci a icona, Ingrandisci, Dettaglio coerenza, Porta tutto in primo piano
- **Aiuto**: Guida VMark, Scorciatoie da tastiera, il comando shell `vmark` (macOS), Segnala un problema

### Modalità di Modifica

VMark supporta tre modalità di modifica tra cui puoi passare:

| Modalità | Descrizione | Scorciatoia |
|----------|-------------|-------------|
| Rich Text | Modifica WYSIWYG con formattazione in tempo reale | Predefinita |
| Sorgente | Markdown grezzo con evidenziazione della sintassi | `F6` |
| Divisa | Sorgente a sinistra, anteprima dal vivo in sola lettura a destra | `Shift + F6` |

### Modalità di Visualizzazione

Migliora la concentrazione nella scrittura con queste modalità di visualizzazione:

| Modalità | Descrizione | Scorciatoia |
|----------|-------------|-------------|
| Focus | Evidenzia il paragrafo corrente | `F8` |
| Macchina da scrivere | Mantieni il cursore centrato | `F9` |
| Testo a capo | Attiva/disattiva il ritorno a capo automatico | `Alt + Z` |

## Formattazione di Base

### Stili di Testo

| Stile | Sintassi | Scorciatoia |
|-------|----------|-------------|
| **Grassetto** | `**testo**` | `Cmd/Ctrl + B` |
| *Corsivo* | `*testo*` | `Cmd/Ctrl + I` |
| ~~Barrato~~ | `~~testo~~` | `Cmd/Ctrl + Shift + X` |
| `Codice` | `` `codice` `` | `Cmd/Ctrl + Shift + `` ` `` |

### Elementi a Blocco

- **Intestazioni**: Usa i simboli `#` oppure `Cmd/Ctrl + 1-6`
- **Elenchi**: Inizia le righe con `-`, `*`, `1.` o `- [ ]` per elenchi di attività
- **Citazioni**: Inizia con `>` oppure usa `Alt/Option + Cmd + Q`
- **Blocchi di codice**: Usa tre apici inversi con linguaggio opzionale
- **Tabelle**: Usa **Inserisci → Tabella** oppure `Cmd/Ctrl + Shift + T`

## Lavorare con i File

### Creazione e Apertura

- **Nuovo file**: `Cmd/Ctrl + N`
- **Apri file**: **File → Apri file…** (nessuna scorciatoia predefinita)
- **Apertura rapida**: `Cmd/Ctrl + O` — passa a un file recente, aperto o dello spazio di lavoro
- **Apri cartella**: `Cmd/Ctrl + Shift + O` (modalità workspace)

### Salvataggio

- **Salva**: `Cmd/Ctrl + S`
- **Salva come**: `Cmd/Ctrl + Shift + S`
- **Salvataggio automatico**: Abilitato per impostazione predefinita, configurabile nelle impostazioni

### Esportazione

- **Esporta HTML**: **File → Esporta → HTML** — una cartella con `index.html`, `standalone.html` e il VMark Reader interattivo
- **Esporta PDF**: **File → Esporta → PDF** — impostazione pagina, font, numeri di pagina e struttura nella barra laterale; oppure Stampa (`Cmd/Ctrl + P`) e usa l'opzione di salvataggio come PDF della finestra di dialogo di sistema
- **Copia come HTML**: `Cmd/Ctrl + Shift + C`

L'HTML esportato include il VMark Reader con sommario, pannello impostazioni e altro. [Scopri di più →](/it/guide/export)

## Impostazioni

Apri le impostazioni con `Cmd/Ctrl + ,` per personalizzare:

- **Aspetto**: Tema, font, dimensione font, interlinea
- **Editor**: Intervallo di salvataggio automatico, comportamenti predefiniti
- **File e immagini**: Gestione delle risorse, strumenti documento
- **Integrazioni**: Provider IA, server MCP
- **Lingua**: Regole di formattazione CJK
- **Markdown**: Opzioni di esportazione, preferenze di formattazione
- **Scorciatoie**: Personalizza le scorciatoie da tastiera
- **Terminale**: Dimensione font e interlinea del terminale

## Assistenza alla Scrittura con IA

VMark include Genies IA integrati — seleziona del testo e premi `Mod + Y` per rifinire, espandere, tradurre o trasformare la tua scrittura con l'IA. Configura il tuo provider preferito in **Impostazioni > Integrazioni**.

[Scopri di più sui Genies IA →](/it/guide/ai-genies) | [Configura i provider →](/it/guide/ai-providers)

## Suggerimenti per Iniziare

1. **Naviga con la struttura**: Fai clic sugli elementi della struttura per passare alle sezioni
2. **Prova la modalità focus**: `F8` attenua tutto tranne il paragrafo corrente
3. **Convalida durante la scrittura**: `Alt + Mod + V` (**Vista → Controlla Markdown**) esegue il motore di lint markdown e il controllo dei collegamenti interrotti
4. **Impara le scorciatoie**: il riferimento completo è nella [guida alle scorciatoie](/it/guide/shortcuts)

## Prossimi Passi

- Scopri tutte le [funzionalità](/it/guide/features)
- Padroneggia le [scorciatoie da tastiera](/it/guide/shortcuts)
- Esplora gli strumenti di [formattazione CJK](/it/guide/cjk-formatting)
