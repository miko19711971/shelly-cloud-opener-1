# vrbo-block

Due lavori automatici sulle prenotazioni VRBO: il blocco anti-overbooking e la
pratica di pagamento e documenti. Stanno nello stesso cron job perche' usano lo
stesso token e le stesse credenziali, e un secondo servizio su Render costerebbe
un servizio in piu' del piano.

## Fase 1 - blocco anti-overbooking

Quando arriva una prenotazione su VRBO, Hostaway la riceve tramite iCal con un
ritardo di circa 30 minuti. In quella finestra l'appartamento risulta ancora
libero su tutti gli altri canali e puo' essere prenotato una seconda volta.
Questo servizio legge le email di conferma VRBO da Gmail e, se Hostaway non ha
ancora la prenotazione, blocca subito quelle date sul calendario.

## Fase 2 - pagato e documenti

Marca la prenotazione come pagata, perche' le VRBO sono sempre incassate in
anticipo fuori Hostaway, e chiede all'ospite i documenti nella conversazione
Hostaway, come richiede la legge italiana.

Questa fase parte **solo quando l'email dell'ospite e' presente**: l'iCal non la
porta, la inserisce a mano il proprietario dopo che la prenotazione e' comparsa
su Hostaway. Finche' manca, la prenotazione viene saltata a ogni giro.

Le due fasi sono isolate una dall'altra: il blocco anti-overbooking gira per
primo perche' e' quello critico, e un errore nella seconda fase non gli impedisce
di fare il suo giro. Se una delle due fallisce il run risulta comunque fallito,
cosi' il problema si vede nella lista dei run.

**Questa cartella e' indipendente dal resto del repository.** Non condivide
codice, dipendenze o configurazione con il servizio Node della radice
(`src/server.js`), che continua a funzionare esattamente come prima. Non e'
stato aggiunto nessun `render.yaml`: un blueprint alla radice ridefinirebbe
anche il servizio esistente, e non e' quello che vogliamo.

## Da dove viene

Sostituisce due script che giravano sul PC di casa tramite Task Scheduler:
`vrbo_email_block.py` (fase 1) e `vrbo_auto_passport.ps1` (fase 2). Il PC resta
spento circa 15 ore al giorno, quindi la protezione non esisteva proprio di
notte, che e' quando arrivano le prenotazioni VRBO, e la richiesta dei documenti
poteva restare ferma fino al mattino dopo.

## Configurazione

Tutto tramite variabili d'ambiente. Nessuna credenziale nel codice.

| Variabile | Cosa contiene |
|---|---|
| `HOSTAWAY_TOKEN` | Token API Hostaway |
| `GMAIL_USER` | Indirizzo Gmail da cui leggere le conferme |
| `GMAIL_APP_PASSWORD` | Password per app di Google, non quella normale |
| `DRY_RUN` | Se vale `1` simula soltanto e non tocca Hostaway. Utile per il primo avvio |

I valori si trovano oggi in `hostaway-revenue/config.ps1` sul PC. Quel file non
deve finire su GitHub.

## Deploy su Render

1. Render, **New > Cron Job**
2. Repository: `miko19711971/shelly-cloud-opener-1`
3. **Root Directory: `vrbo-block`** - e' il campo che tiene il servizio isolato
   dal resto del repo. Senza questo, Render proverebbe a costruire il progetto
   Node della radice
4. Runtime: **Python 3**
5. Build Command: `pip install -r requirements.txt`
6. Command: `python vrbo_block.py`
7. Schedule: `*/5 * * * *` (ogni 5 minuti)
8. Nella sezione Environment inserire le quattro variabili della tabella sopra,
   partendo con `DRY_RUN=1`

Al primo avvio, con `DRY_RUN=1`, il log deve mostrare `BLOCCHEREI` oppure
`OK gia su Hostaway` ma nessuna modifica reale. Quando il comportamento
convince, si toglie `DRY_RUN` (o si mette a `0`) e il servizio diventa operativo.

## Dopo il passaggio

Sul PC vanno disattivati i due task sostituiti, altrimenti lavorano in parallelo
sulle stesse prenotazioni.

```
Utilita di pianificazione > Libreria > HostawayVrboEmailBlock     > Disattiva
Utilita di pianificazione > Libreria > HostawayVrboAutoPassport   > Disattiva
```

## Nota tecnica: perche' non ci sono piu' i file di stato

La versione sul PC teneva due file, `vrbo_email_processed.json` e
`vrbo_email_blocks.json`, per ricordare quali email aveva gia visto e quali
blocchi aveva creato. Su Render il disco di un cron job si azzera a ogni
esecuzione, quindi quei file non sopravvivrebbero.

Lo stato viene quindi ricostruito da capo a ogni giro, incrociando le email
degli ultimi 14 giorni con il calendario Hostaway. Funziona perche' ogni
decisione e' verificabile guardando il calendario:

- se le date risultano gia **prenotate**, l'iCal e' arrivato e non serve fare
  niente (vengono solo liberati eventuali giorni bloccati oltre la prenotazione)
- se non risultano prenotate, si blocca; rifare il blocco su date gia bloccate
  non cambia nulla, quindi ripetere l'operazione e' innocuo
- se nella finestra compare anche l'email di cancellazione della stessa
  prenotazione, le date bloccate vengono rilasciate

La finestra e' passata da 4 a 14 giorni proprio perche' senza memoria su file
serve un margine piu' ampio: una prenotazione confermata deve restare visibile
abbastanza a lungo da poter essere ripulita quando l'iCal arriva.

**Differenza di comportamento da valutare.** La versione sul PC rilasciava un
blocco solo se lo aveva creato lei, perche' se lo ricordava dal file. Qui la
prova equivalente e' la presenza dell'email di conferma per quelle stesse date.
Nel caso limite in cui il proprietario avesse bloccato a mano le stesse date di
una prenotazione VRBO poi annullata, quelle date verrebbero riaperte. E' un caso
molto improbabile, ma va conosciuto: in cambio si ottiene un servizio senza
stato, che e' l'unico modo di girare su un cron job.

## Nota tecnica: come fa la fase 2 a non mandare due volte lo stesso messaggio

La versione sul PC teneva `vrbo_processed.json` con gli id gia' processati. Qui
il registro e' la **conversazione Hostaway stessa**: prima di scrivere si leggono
i messaggi della conversazione e si cerca la frase del messaggio documenti. Se
c'e' gia', la prenotazione e' fatta e si salta. Il testo inviato e' identico a
quello che mandava il PC, quindi anche le prenotazioni gia' processate prima del
passaggio vengono riconosciute.

Ogni dubbio porta a **non** mandare: se la conversazione non e' leggibile la
prenotazione viene saltata e si ritenta al giro dopo. Meglio un messaggio in
ritardo di cinque minuti che un messaggio doppio all'ospite.

Il "marca pagato" e' idempotente per conto suo: legge `totalPaid` dal dettaglio
della prenotazione e scrive solo se e' inferiore al totale. La lettura va fatta
sul dettaglio e non sull'elenco, perche' l'elenco non restituisce `financeField`.
