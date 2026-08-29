# vrbo-block

Blocco automatico anti-overbooking per le prenotazioni VRBO.

Quando arriva una prenotazione su VRBO, Hostaway la riceve tramite iCal con un
ritardo di circa 30 minuti. In quella finestra l'appartamento risulta ancora
libero su tutti gli altri canali e puo' essere prenotato una seconda volta.
Questo servizio legge le email di conferma VRBO da Gmail e, se Hostaway non ha
ancora la prenotazione, blocca subito quelle date sul calendario.

**Questa cartella e' indipendente dal resto del repository.** Non condivide
codice, dipendenze o configurazione con il servizio Node della radice
(`src/server.js`), che continua a funzionare esattamente come prima. Non e'
stato aggiunto nessun `render.yaml`: un blueprint alla radice ridefinirebbe
anche il servizio esistente, e non e' quello che vogliamo.

## Da dove viene

Sostituisce `vrbo_email_block.py`, che girava sul PC di casa tramite Task
Scheduler. Il PC resta spento circa 15 ore al giorno, quindi la protezione non
esisteva proprio di notte, che e' quando arrivano le prenotazioni VRBO.

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

Sul PC va disattivato il task `HostawayVrboEmailBlock`, altrimenti i due
lavorano in parallelo sulle stesse date.

```
Utilita di pianificazione > Libreria > HostawayVrboEmailBlock > Disattiva
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
