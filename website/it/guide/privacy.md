# Privacy

VMark rispetta la tua privacy. Ecco esattamente cosa accade — e cosa non accade.

## Cosa Invia VMark

VMark include un **controllo degli aggiornamenti automatici** che contatta periodicamente il nostro server per verificare se è disponibile una nuova versione. Questa è l'**unica** richiesta di rete che VMark effettua.

Ogni controllo invia esattamente questi campi — niente di più:

| Dato | Esempio | Scopo |
|------|---------|-------|
| Indirizzo IP | `203.0.113.42` | Inerente a qualsiasi richiesta HTTP — non possiamo non riceverlo |
| OS | `darwin`, `windows`, `linux` | Per fornire il pacchetto di aggiornamento corretto |
| Architettura | `aarch64`, `x86_64` | Per fornire il pacchetto di aggiornamento corretto |
| Versione app | `0.5.10` | Per determinare se è disponibile un aggiornamento |
| Hash macchina | `a3f8c2...` (hex a 64 caratteri) | Contatore dispositivi anonimo — SHA-256 di hostname + OS + arch; non reversibile |

L'URL completo appare così:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

Puoi verificarlo tu stesso — l'endpoint è in [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (cerca `"endpoints"`), e l'hash è in [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (cerca `machine_id_hash`).

## Cosa VMark NON Invia

- I tuoi documenti o i loro contenuti
- Nomi di file o percorsi
- Pattern di utilizzo o analisi delle funzionalità
- Informazioni personali di qualsiasi tipo
- Segnalazioni di crash
- Dati di battitura o modifica
- Identificatori hardware reversibili o impronte digitali
- L'hash della macchina è un digest SHA-256 unidirezionale — non può essere invertito per recuperare il tuo hostname o qualsiasi altro input

## Come Usiamo i Dati

Aggreghiamo i log dei controlli degli aggiornamenti per produrre le statistiche live mostrate sulla nostra [homepage](/it/):

| Metrica | Come viene calcolata |
|---------|---------------------|
| **Dispositivi unici** | Conteggio degli hash macchina distinti per giorno/settimana/mese |
| **IP unici** | Conteggio degli indirizzi IP distinti per giorno/settimana/mese |
| **Ping** | Numero totale di richieste di controllo aggiornamenti |
| **Piattaforme** | Conteggio dei ping per combinazione OS + architettura |
| **Versioni** | Conteggio dei ping per versione dell'app |

Questi numeri sono pubblicati apertamente su [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats). Niente è nascosto.

**Avvertenze importanti:**
- Gli IP unici sottostimano gli utenti reali — più persone dietro lo stesso router/VPN contano come uno
- I dispositivi unici forniscono conteggi più accurati, ma un cambio di hostname o una nuova installazione dell'OS genera un nuovo hash
- I ping sovrastimano gli utenti reali — una persona può effettuare controlli più volte al giorno

## Conservazione dei Dati

- I log vengono memorizzati sul nostro server nel formato log di accesso standard
- I file di log ruotano a 1 MB e vengono conservati solo i 3 file più recenti
- I log non vengono condivisi con nessuno
- Non esiste nessun sistema di account — VMark non sa chi sei
- L'hash della macchina non è collegato a nessun account, email o indirizzo IP — è solo un contatore di dispositivi pseudonimo
- Non utilizziamo cookie di tracciamento, fingerprinting o SDK di analisi

## Cosa Può Leggere VMark sul Disco

L'accesso di VMark ai file è un ambito di permessi ristretto, non l'intero disco:

- **Ambito statico**: la tua cartella home (`$HOME/**`) più i volumi montati — `/Volumes/**` su macOS, `/mnt/**` e `/media/**` su Linux. Su Windows copre anche le unità da `C:\` a `F:\`, quindi solo `G:\` e le unità successive, e le condivisioni di rete, richiedono un'autorizzazione in fase di esecuzione. Su macOS e Linux, tutto ciò che si trova in una cartella nascosta (il cui nome inizia con `.`) è fuori dall'ambito statico.
- **Autorizzazioni in fase di esecuzione**: un file che apri esplicitamente — dal Finder o da Esplora file, dalla riga di comando `vmark` o da una finestra di dialogo dei file — riceve un'autorizzazione solo per quel file. Una **cartella** viene autorizzata solo quando VMark può stabilire che l'hai scelta tu: l'hai selezionata nella finestra di selezione cartelle di VMark oppure l'hai aperta dal Finder. VMark conserva un elenco di queste cartelle (`workspace-grants.json` nella sua cartella dei dati dell'app) e le autorizza di nuovo a ogni avvio, così la sessione ripristinata e **Apri spazio di lavoro recente** continuano a funzionare. Uno spazio di lavoro recente che non è in quell'elenco, e che l'ambito statico non copre, apre la finestra di selezione cartelle su quella cartella — sceglila per confermare. Quando un assistente IA chiede di aprire una cartella del genere, VMark fa lo stesso dopo che hai approvato la richiesta.
- **Immagini e contenuti multimediali**: immagini, video e audio locali vengono mostrati tramite il protocollo delle risorse di VMark, che raggiunge gli stessi luoghi — l'ambito statico più le autorizzazioni in fase di esecuzione descritte sopra. Il visualizzatore multimediale aggiunge un'autorizzazione per l'unico file che mostra, e solo per un file con un'estensione multimediale; una richiesta per qualsiasi altro percorso viene rifiutata invece di ampliare l'ambito. Un'immagine fuori da quei luoghi, come una accanto a un documento aperto da solo dall'esterno dell'ambito statico, non viene mostrata finché non apri la sua cartella come spazio di lavoro.

Niente di tutto questo viene inviato altrove; l'ambito decide cosa può leggere l'app stessa.

## Trasparenza Open Source

VMark è completamente open source. Puoi verificare tutto ciò che è descritto qui:

- Configurazione dell'endpoint di aggiornamento: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- Generazione dell'hash macchina: [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — cerca `machine_id_hash`
- Ambito del file system e delle risorse: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), la voce `assetProtocol` in [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json), [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs) e [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- Aggregazione delle statistiche lato server: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — lo script esatto che gira sul nostro server per produrre le [statistiche pubbliche](https://log.vmark.app/api/stats)
- Non esistono altre chiamate di rete nel codebase — cerca `fetch`, `http`, o `reqwest` tu stesso

## Disabilitare i Controlli degli Aggiornamenti

Se preferisci disabilitare completamente i controlli automatici degli aggiornamenti, puoi bloccare `log.vmark.app` a livello di rete (firewall, `/etc/hosts`, o DNS). VMark continuerà a funzionare normalmente senza di esso — semplicemente non riceverai notifiche di aggiornamento.

## Segnalare un problema di sicurezza

Se trovi una vulnerabilità in VMark, ad esempio nel bridge MCP, nel browser integrato, nel programma di aggiornamento o nella gestione dei file, segnalala in privato tramite [la segnalazione privata delle vulnerabilità di GitHub](https://github.com/xiaolai/vmark/security/advisories/new) invece di aprire una issue pubblica. La [politica di sicurezza](https://github.com/xiaolai/vmark/blob/main/SECURITY.md) indica che cosa rientra nell'ambito e che cosa aspettarsi.
