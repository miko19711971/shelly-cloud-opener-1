# Dispositivi Shelly — configurazione attesa

Rilevato il **2026-08-27** dal cloud Shelly (`https://shelly-77-eu.shelly.cloud`).

Questo file non cambia il comportamento del sistema: serve a non riperdere la
configurazione dei dispositivi, che vive **sul dispositivo** e non nel codice.
Se uno Shelly viene resettato o sostituito, nessun deploy se ne accorge.

---

## Mappa dispositivi

| ID | Nome sul cloud | Target nel codice | Rete WiFi | IP | Stanza |
|---|---|---|---|---|---|
| `3494547745ee` | Scala Buolding door | `via-della-scala-building` | FASTWEB-N5FD77 | 192.168.1.51 | 4 |
| `3494547a1075` | Scala apt door | `via-della-scala-door` | FASTWEB-N5FD77 | 192.168.1.50 | 4 |
| `34945479fbbe` | Portone Leonina. | `leonina-building` | FASTWEB-HZ9DZ5-2G | 192.168.1.51 | 1 |
| `3494547a9395` | Porta Leonina | `leonina-door` | FASTWEB-HZ9DZ5-2G | 192.168.1.50 | 1 |
| `34945479fd73` | Trastevere Building | `viale-trastevere-building` | FASTWEB-3DG3AQ | 192.168.1.51 | 5 |
| `34945479fa35` | Trastevere apt door | `viale-trastevere-door` | FASTWEB-3DG3AQ | 192.168.1.50 | 5 |
| `2cbcbb30fb90` | Portico Building door | `portico-1d-building` | WINDTRE-20CFE0_2G | 192.168.1.3 | 3 |
| `2cbcbb2f8ae8` | Porta ottavia | `portico-1d-door` | WINDTRE-20CFE0_2G | 192.168.1.2 | 3 |
| `3494547ab05e` | Arenula Portone | `arenula-building` | Wind3 HUB - FD8F4E | 192.168.1.2 | 2 |
| `3494547a887d` | Deposito | *(non usato dal server)* | Wind3 HUB-E27C05 | 192.168.1.174 | 6 |

I due dispositivi di ogni immobile stanno sempre sulla stessa rete e nella
stessa stanza: è il modo più rapido per verificare che un'etichetta non sia
stata scambiata.

---

## Impostazioni del relè

`auto_off` genera l'impulso ed è corretto che sia valorizzato.
**`auto_on` deve essere 0 (disattivato) su TUTTI i dispositivi.**
`auto_on` riaccende il relè dopo lo spegnimento: con `auto_on` e `auto_off`
entrambi valorizzati il relè oscilla all'infinito invece di fare un impulso
singolo, e il centralino del cancello riceve una raffica di comandi.

| Dispositivo | `auto_on` | `auto_off` | `default_state` | `btn_type` | Letto il |
|---|---|---|---|---|---|
| Scala portone `3494547745ee` | **0** ⚠️ vedi nota | 0.5 | switch | toggle | 2026-08-06 |
| Scala porta apt `3494547a1075` | **0.5 — DA CORREGGERE** | 0.5 | switch | toggle | 2026-08-06 |
| Leonina portone `34945479fbbe` | 0 | 1 | switch | toggle | 2026-08-24 |
| Leonina porta `3494547a9395` | 0 | 1 | switch | toggle | 2026-08-25 |
| Trastevere portone `34945479fd73` | 0 | 0.5 | last | momentary | 2026-08-24 |
| Trastevere porta `34945479fa35` | 0 | 0.5 | switch | momentary | 2026-08-24 |
| Arenula portone `3494547ab05e` | 0 | 0.5 | switch | momentary | 2026-08-25 |
| Portico portone `2cbcbb30fb90` | *non rilevato* | | | | Gen2 |
| Portico porta `2cbcbb2f8ae8` | *non rilevato* | | | | Gen2 |

**Nota su Scala portone:** `auto_on` è stato riportato a 0 dall'app Shelly il
2026-08-27. Il cloud continuava a esporre `0.5` perché serve uno snapshot in
cache non aggiornabile da remoto — il valore corretto è quello impostato
nell'app, non quello letto dall'API.

**Portico** monta dispositivi Gen2, con struttura delle impostazioni diversa:
i campi sopra non si applicano e non sono stati rilevati.

---

## Limiti dell'API cloud Shelly (verificati il 2026-08-27)

- `POST /interface/device/list` → **`cloud_online` è l'unico campo affidabile**
  per sapere se un dispositivo è connesso
- `POST /device/status` → il campo `online` è **sempre `false`**: non usarlo.
  Anche `_updated`, `ison` e `has_timer` vengono da una fotografia in cache che
  **non si aggiorna dopo un impulso** (verificato su due dispositivi diversi:
  un'apertura riuscita non muove `_updated`). Non è utilizzabile per capire se
  un'apertura è avvenuta.
- `POST /device/settings` → legge le impostazioni, anch'esse in cache
- `POST /device/relay/control` → comanda il relè
- **Le impostazioni non sono scrivibili via API.** `/device/settings/relay/0`,
  `/device/settings/relay`, `/interface/device/settings*` rispondono 404 e
  `/device/relay/settings` risponde `max_req` anche dopo lunghe pause.
  Ogni modifica va fatta dall'app Shelly o dall'IP locale del dispositivo,
  raggiungibile solo dalla rete dell'immobile.
- Nessun registro eventi: `/device/event_log` e `/statistics/relay/consumption`
  non esistono.
- Rate limit stretto: distanziare le chiamate di circa 12 secondi.

---

## Punti da sapere sul codice

- **`via-della-scala-building` ha l'ID ripetuto due volte** in `TARGETS`
  (`["3494547745ee", "3494547745ee"]`): è voluto. I due cancelli sono comandati
  dallo stesso relè e il secondo richiede un impulso separato, 10 secondi dopo.
  Una pressione del pulsante = due impulsi.
- La guida di check-in di Scala ha **due pulsanti**, entrambi collegati allo
  stesso endpoint: un check-in completo manda quindi **4 impulsi** invece di 2.
  Scelta consapevole, confermata il 2026-08-27 (si è tornati alla versione del
  2026-07-06 dopo un tentativo di ridurli a uno solo).
- **`arenula-door` è un riferimento morto**: le mappe degli endpoint lo citano
  ma non esiste in `TARGETS` e non esiste un dispositivo corrispondente sul
  cloud. Nessun ospite ci arriva, perché la guida di Arenula espone solo il
  pulsante del portone.
- `shellyTurnOn()` considera un successo la risposta `isok: true` del cloud, che
  significa **"comando accettato"**, non "porta aperta". Non esiste alcun
  riscontro del movimento fisico: non ci sono sensori sui cancelli.

---

## Notifiche

Le notifiche dell'app Shelly non arrivano più su nessuno dei cinque immobili:
nell'account non risulta configurata alcuna notifica di apertura, e non è
riscrivibile via API.

Sostituite da **email dal server a ogni apertura**, che riportano anche i
tentativi falliti (vedi `openTargetAndNotify()` in `src/server.js`).
Variabili: `OPEN_NOTIFY=0` le disattiva, `OPEN_NOTIFY_TO` cambia destinatario.
Richiedono `GMAIL_USER` + `GMAIL_APP_PASSWORD` (o le `SMTP_*`) su Render.
