# Modifica Multi-Cursore

VMark supporta una potente modifica multi-cursore sia in modalità WYSIWYG che Sorgente, consentendo di modificare più posizioni contemporaneamente.

## Avvio Rapido

| Azione | Scorciatoia |
|--------|-------------|
| Aggiungi cursore alla corrispondenza successiva | `Mod + D` |
| Salta corrispondenza, vai alla successiva | `Mod + Shift + D` |
| Aggiungi cursori a tutte le corrispondenze | `Mod + Shift + L` |
| Aggiungi cursori a tutte le corrispondenze nel blocco corrente | `Alt + Mod + Shift + L` |
| Annulla ultima aggiunta cursore | `Alt + Mod + Z` |
| Aggiungi cursore sopra | `Mod + Alt + Su` |
| Aggiungi cursore sotto | `Mod + Alt + Giù` |
| Aggiungi/rimuovi cursore al clic | `Alt + Clic` |
| Comprimi al cursore singolo | `Escape` |

::: tip
**Mod** = Cmd su macOS, Ctrl su Windows/Linux
**Alt** = Option su macOS
:::

## Aggiunta di Cursori

### Seleziona Occorrenza Successiva (`Mod + D`)

1. Seleziona una parola o posiziona il cursore su una parola
2. Premi `Mod + D` per aggiungere un cursore alla prossima occorrenza
3. Premi di nuovo per aggiungere altri cursori
4. Digita per modificare tutte le posizioni contemporaneamente

<div class="feature-box">
<strong>Esempio:</strong> Per rinominare una variabile <code>count</code> in <code>total</code>:
<ol>
<li>Fai doppio clic su <code>count</code> per selezionarla</li>
<li>Premi <code>Mod + D</code> ripetutamente per selezionare ogni occorrenza</li>
<li>Digita <code>total</code> — tutte le occorrenze vengono aggiornate contemporaneamente</li>
</ol>
</div>

### Seleziona Tutte le Occorrenze (`Mod + Shift + L`)

Seleziona tutte le occorrenze della parola o della selezione corrente contemporaneamente:

1. Seleziona una parola o un testo
2. Premi `Mod + Shift + L`
3. Tutte le occorrenze corrispondenti nel documento vengono selezionate — oppure, all'interno di un blocco di codice, tutte le corrispondenze in quel blocco (vedi [Ambito](#ambito))
4. Digita per sostituire tutte contemporaneamente

Per restare nel paragrafo, nell'intestazione o nell'elemento di elenco in cui ti trovi, usa invece `Alt + Mod + Shift + L`.

### Alt + Clic

Tieni premuto `Alt` (Option su macOS) e fai clic per:
- **Aggiungere** un cursore in quella posizione
- **Rimuovere** un cursore se ne esiste già uno lì

Questo è utile per posizionare cursori in posizioni arbitrarie che non sono testo corrispondente.

### Salta Occorrenza (`Mod + Shift + D`)

Quando `Mod + D` seleziona una corrispondenza che non vuoi, saltala:

1. Premi `Mod + D` per iniziare ad aggiungere corrispondenze
2. Se l'ultima corrispondenza è indesiderata, premi `Mod + Shift + D` per saltarla
3. La corrispondenza saltata viene rimossa e viene selezionata la corrispondenza successiva

Questo è l'equivalente multi-cursore di "Trova Successivo" — ti permette di scegliere quali occorrenze modificare.

### Annullamento Soft (`Alt + Mod + Z`)

Annulla l'ultima aggiunta di cursore senza perdere tutti i cursori:

1. Premi `Mod + D` più volte per accumulare cursori
2. Se ne hai aggiunto uno di troppo, premi `Alt + Mod + Z`
3. L'ultimo cursore aggiunto viene rimosso, ripristinando lo stato precedente

A differenza di `Escape` (che comprime tutto), l'annullamento soft torna indietro un cursore alla volta.

### Aggiungi Cursore Sopra / Sotto (`Mod + Alt + Su/Giù`)

Aggiungi cursori verticalmente, una riga alla volta:

1. Posiziona il cursore su una riga
2. Premi `Mod + Alt + Giù` per aggiungere un cursore nella riga successiva
3. Premi di nuovo per continuare ad aggiungere cursori verso il basso
4. Usa `Mod + Alt + Su` per aggiungere cursori verso l'alto

Questo è ideale per modificare testo allineato in colonne o per fare la stessa modifica su righe consecutive.

## Modifica con Più Cursori

Una volta che hai più cursori, tutte le modifiche standard funzionano su ogni cursore:

### Digitazione
- I caratteri vengono inseriti in tutte le posizioni dei cursori
- Le selezioni vengono sostituite in tutte le posizioni

### Eliminazione
- **Backspace** — elimina il carattere prima di ogni cursore
- **Canc** — elimina il carattere dopo ogni cursore

### Navigazione
- **Tasti freccia** — spostano tutti i cursori insieme
- **Shift + Freccia** — estendono la selezione su ogni cursore
- **Mod + Freccia** — saltano per parola/riga su ogni cursore

### Escape con Tab

L'escape con Tab funziona indipendentemente per ogni cursore:

- I cursori all'interno di **grassetto**, *corsivo*, `codice`, o ~~barrato~~ saltano alla fine di quella formattazione
- I cursori all'interno dei collegamenti escono dal collegamento
- I cursori prima delle parentesi di chiusura `)` `]` `}` saltano oltre di esse
- I cursori nel testo normale rimangono fermi

Questo ti permette di uscire da più regioni formattate contemporaneamente. Vedi [Navigazione Intelligente con Tab](./tab-navigation.md#supporto-multi-cursore) per i dettagli.

### Appunti

**Copia** (`Mod + C`):
- Copia il testo da tutte le selezioni, unito da newline

**Incolla** (`Mod + V`):
- Se gli appunti hanno lo stesso numero di righe dei cursori, ogni riga va a ogni cursore
- Altrimenti, il contenuto completo degli appunti viene incollato su tutti i cursori

## Ambito

**Il codice ha un ambito delimitato; il testo normale no.** All'interno di un blocco di codice (WYSIWYG) o di un blocco delimitato (Sorgente), i cursori non attraversano mai il delimitatore — cercare il nome di una variabile in un frammento non può posizionare un cursore in un altro. Nel testo normale, `Mod + D` e `Mod + Shift + L` cercano in **tutto il documento**.

Spesso è proprio ciò che vuoi, a volte no: in un documento lungo, cercare una parola comune posiziona cursori in paragrafi lontani, fuori dallo schermo.

### Seleziona Tutte le Occorrenze nel Blocco

`Alt + Mod + Shift + L` seleziona ogni corrispondenza **solo all'interno del blocco corrente** — il paragrafo, l'intestazione o l'elemento di elenco in cui si trova il cursore. In modalità Sorgente il blocco è delimitato dalle righe vuote; in WYSIWYG dal blocco che lo contiene. All'interno di un blocco di codice delimitato si comporta esattamente come `Mod + Shift + L`, perché il blocco delimitato è già il blocco.

Le due scorciatoie sono sorelle, non una modalità: `Mod + Shift + L` raggiunge ancora l'intero documento, quindi nulla di ciò su cui già fai affidamento cambia.

<div class="feature-box">
<strong>Quale usare?</strong>
<p>Scegli la versione limitata al blocco quando la parola è comune — per rinominare una variabile citata nel testo, o per modificare lo schema di un singolo elemento di elenco. Scegli quella sull'intero documento quando intendi davvero ovunque.</p>
</div>

## Compressione dei Cursori

Premi `Escape` per comprimere di nuovo a un singolo cursore nella posizione primaria.

::: tip Stabilità del cursore
I cursori compressi rimangono stabili quando il testo viene inserito nella posizione del cursore. Non si espandono inaspettatamente in selezioni dopo inserimenti mappati (corretto in v0.6.x).
:::

## Feedback Visivo

- **Cursore primario** — cursore lampeggiante standard
- **Cursori secondari** — cursori lampeggianti aggiuntivi con stile distinto
- **Selezioni** — la selezione di ogni cursore è evidenziata

In modalità scura, i colori del cursore e della selezione si adattano automaticamente per la visibilità.

## Confronto tra Modalità

| Funzione | WYSIWYG | Sorgente |
|----------|---------|---------|
| `Mod + D` | ✓ | ✓ |
| `Mod + Shift + D` (Salta) | ✓ | ✓ |
| `Mod + Shift + L` | ✓ | ✓ |
| `Alt + Mod + Z` (Annullamento Soft) | ✓ | ✓ |
| `Mod + Alt + Su/Giù` | ✓ | ✓ |
| `Alt + Clic` | ✓ | ✓ |
| Ambito delimitato dal blocco di codice | Blocchi di codice | Blocchi di codice delimitati |
| Selezione di tutto limitata al blocco | `Alt + Mod + Shift + L` | `Alt + Mod + Shift + L` |
| Ricerca con ritorno a capo | ✓ | ✓ |

## Suggerimenti e Best Practice

### Rinominare Variabili
1. Fai doppio clic sul nome della variabile
2. `Alt + Mod + Shift + L` per selezionare ogni corrispondenza in questo blocco (oppure `Mod + Shift + L` per l'intero documento)
3. Digita il nuovo nome

### Aggiungere Prefissi/Suffissi
1. Posiziona il cursore prima/dopo testo ripetuto
2. `Mod + D` per aggiungere cursori a ogni occorrenza
3. Digita il prefisso o il suffisso

### Modifica degli Elementi di Elenco
1. Seleziona il pattern comune (come `- ` all'inizio delle righe)
2. `Mod + Shift + L` per selezionare tutti
3. Modifica tutti gli elementi dell'elenco contemporaneamente

### Quando Usare Ogni Scorciatoia

| Scenario | Scorciatoia Migliore |
|----------|---------------------|
| Selezione attenta e incrementale | `Mod + D` |
| Salta la corrispondenza indesiderata | `Mod + Shift + D` |
| Sostituisci tutto nel blocco corrente | `Alt + Mod + Shift + L` |
| Sostituisci tutto nel documento | `Mod + Shift + L` |
| Annulla l'ultimo passo del cursore | `Alt + Mod + Z` |
| Modifica righe consecutive | `Mod + Alt + Su/Giù` |
| Posizioni arbitrarie | `Alt + Clic` |
| Uscita rapida | `Escape` |

## Limitazioni

- **Nodi atomici**: Non è possibile posizionare cursori all'interno di immagini, contenuto incorporato o blocchi matematici in modalità WYSIWYG
- **Input IME**: Quando si usano metodi di input (cinese, giapponese, ecc.), la composizione influenza solo il cursore primario
- **Blocchi di codice**: All'interno di un blocco di codice (WYSIWYG) o di un blocco delimitato (Sorgente), la ricerca delle occorrenze non esce mai da quel blocco

## Riferimento Tastiera

| Azione | Scorciatoia |
|--------|-------------|
| Seleziona occorrenza successiva | `Mod + D` |
| Salta occorrenza | `Mod + Shift + D` |
| Seleziona tutte le occorrenze | `Mod + Shift + L` |
| Annullamento soft cursore | `Alt + Mod + Z` |
| Aggiungi cursore sopra | `Mod + Alt + Su` |
| Aggiungi cursore sotto | `Mod + Alt + Giù` |
| Aggiungi/rimuovi cursore | `Alt + Clic` |
| Comprimi al cursore singolo | `Escape` |
| Sposta tutti i cursori | Tasti freccia |
| Estendi tutte le selezioni | `Shift + Freccia` |
| Salta per parola | `Alt + Freccia` |
| Salta per riga | `Mod + Freccia` |

<!-- Styles in style.css -->
