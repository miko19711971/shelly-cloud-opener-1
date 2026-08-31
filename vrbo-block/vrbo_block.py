#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vrbo_block.py - Cron Job su Render

Due lavori indipendenti sulle prenotazioni VRBO, nello stesso processo perche'
usano lo stesso token e le stesse credenziali, e un secondo cron job costerebbe
un servizio in piu' su Render.

FASE 1 - blocco anti-overbooking (critica, gira per prima).
Legge da Gmail le conferme di prenotazione VRBO e, se Hostaway non ha ancora la
prenotazione, blocca subito quelle date sul calendario Hostaway. Serve a coprire
i ~30 minuti che il sync iCal impiega ad arrivare: in quella finestra
l'appartamento risulta ancora libero e puo' essere prenotato una seconda volta
su un altro canale.

FASE 2 - pagato e documenti.
Marca la prenotazione come pagata (le VRBO sono sempre pagate in anticipo fuori
Hostaway) e chiede all'ospite i documenti nella conversazione Hostaway. Parte
solo quando l'utente ha inserito a mano l'email dell'ospite, che l'iCal non
porta. Vedi la sezione "passaporti" piu' sotto per il dettaglio.

Le due fasi sono isolate: un errore nell'una non impedisce all'altra di girare.

Sostituisce vrbo_email_block.py e vrbo_auto_passport.ps1, che giravano sul PC di
casa con il Task Scheduler e quindi erano spenti circa 15 ore al giorno - proprio
le ore in cui arrivano le prenotazioni VRBO.

DIFFERENZA IMPORTANTE rispetto alla versione PC: nessun file di stato. Su Render
il disco si azzera a ogni esecuzione, quindi ogni decisione viene ricavata da
capo incrociando le email con il calendario Hostaway. Dettagli nel README.

Configurazione: solo variabili d'ambiente, nessuna credenziale nel codice.
  HOSTAWAY_TOKEN       token API Hostaway
  GMAIL_USER           indirizzo Gmail da cui leggere
  GMAIL_APP_PASSWORD   password per app di Google (non la password normale)
  DRY_RUN              se vale 1 simula soltanto e non tocca Hostaway
"""
import imaplib, email, re, json, os, sys, urllib.request, datetime, time, traceback
from email.header import decode_header

# ---------------------------------------------------------------- config
TOKEN    = os.environ.get("HOSTAWAY_TOKEN", "")
GMAIL_U  = os.environ.get("GMAIL_USER", "")
GMAIL_PW = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
DRY_RUN  = os.environ.get("DRY_RUN", "0").strip() == "1"

IMAP_TIMEOUT = 45   # secondi: senza questo una connessione muta resta appesa
WINDOW_DAYS  = 14   # quante email indietro guardare

# VRBO property ID -> Hostaway listing ID (confermato con l'utente 02/07/2026)
PROPERTY_MAP = {
    "10906107": 194162,  # Via della Scala
    "11962741": 194164,  # Viale Trastevere, 108
    "11141833": 194165,  # Portico d'Ottavia
    "11229112": 194166,  # Via Arenula
}
NAMES = {194162: "Scala", 194164: "Trastevere", 194165: "Portico", 194166: "Arenula"}
MONTHS = {'gen': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'mag': 5, 'giu': 6,
          'lug': 7, 'ago': 8, 'set': 9, 'ott': 10, 'nov': 11, 'dic': 12}

HDR = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}


def log(msg):
    """Su Render i log sono semplicemente lo stdout del processo."""
    print("[{}] {}".format(datetime.datetime.now().strftime("%H:%M:%S"), msg), flush=True)


# ---------------------------------------------------------------- Hostaway
def hget(path):
    rq = urllib.request.Request("https://api.hostaway.com/v1/" + path, headers=HDR)
    return json.load(urllib.request.urlopen(rq, timeout=30))


def hput_avail(lid, start, end, avail):
    body = json.dumps({"startDate": start, "endDate": end, "isAvailable": avail}).encode()
    rq = urllib.request.Request("https://api.hostaway.com/v1/listings/{}/calendar".format(lid),
                                headers=HDR, data=body, method="PUT")
    return json.load(urllib.request.urlopen(rq, timeout=30)).get("status")


def hsend(path, obj, metodo):
    """POST o PUT con corpo JSON. Ritorna il JSON di risposta."""
    rq = urllib.request.Request("https://api.hostaway.com/v1/" + path,
                                headers=HDR, data=json.dumps(obj).encode(), method=metodo)
    return json.load(urllib.request.urlopen(rq, timeout=30))


def calendario(lid, start, end):
    return hget("listings/{}/calendar?startDate={}&endDate={}".format(lid, start, end))["result"]


def libera(lid, giorno, motivo):
    if DRY_RUN:
        log("[DRY] libererei {} {} ({})".format(NAMES.get(lid), giorno, motivo))
    else:
        hput_avail(lid, giorno, giorno, 1)
        log("LIBERATO {} {} ({})".format(NAMES.get(lid), giorno, motivo))


# ---------------------------------------------------------------- email
def dec(s):
    out = ""
    for t, e in decode_header(s or ""):
        out += t.decode(e or "utf-8", "ignore") if isinstance(t, bytes) else t
    return out


def body_text(m):
    for part in (m.walk() if m.is_multipart() else [m]):
        if part.get_content_type() == "text/plain":
            try:
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore")
            except Exception:
                pass
    for part in (m.walk() if m.is_multipart() else [m]):
        if part.get_content_type() == "text/html":
            try:
                grezzo = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "ignore")
                return re.sub("<[^>]+>", " ", grezzo)
            except Exception:
                pass
    return ""


def parse_dates(text):
    """Estrae arrivo e partenza da 'Date: 19 mar - 22 mar 2026', gestendo il cambio anno."""
    m = re.search(r'(\d{1,2})\s+([A-Za-zàèéìòù]{3,})\.?\s*[-–a]{1,3}\s*(\d{1,2})\s+([A-Za-zàèéìòù]{3,})\.?\s+(\d{4})', text)
    if not m:
        return None, None
    d1, mo1 = m.group(1), m.group(2).lower()[:3]
    d2, mo2 = m.group(3), m.group(4).lower()[:3]
    yr = int(m.group(5))
    if mo1 not in MONTHS or mo2 not in MONTHS:
        return None, None
    arr_year = yr - 1 if MONTHS[mo1] > MONTHS[mo2] else yr
    try:
        return datetime.date(arr_year, MONTHS[mo1], int(d1)), datetime.date(yr, MONTHS[mo2], int(d2))
    except Exception:
        return None, None


def parse_email(m):
    subj = dec(m.get("Subject"))
    body = body_text(m)
    txt = subj + "\n" + body
    mp = re.search(r'#\s*(\d{7,})', txt)
    ha = re.search(r'(HA-[A-Z0-9]{5,})', txt)
    arr, dep = parse_dates(body)
    if not arr:
        arr, dep = parse_dates(subj)
    guest = re.search(r'Nome del viaggiatore:\s*(.+)', body)
    return {
        "pid": mp.group(1) if mp else None,
        "ha": ha.group(1) if ha else None,
        "arr": arr.isoformat() if arr else None,
        "dep": dep.isoformat() if dep else None,
        "guest": guest.group(1).strip() if guest else None,
        "cancel": "cancellat" in subj.lower(),
        "confirm": "confermata" in body.lower(),
        "subject": subj,
    }


def chiave(info):
    """Identifica la prenotazione: il codice HA- se c'e', altrimenti property + arrivo."""
    return info["ha"] or "{}|{}".format(info["pid"], info["arr"])


# ---------------------------------------------------------------- lettura
def leggi_email():
    t0 = time.time()
    try:
        M = imaplib.IMAP4_SSL("imap.gmail.com", timeout=IMAP_TIMEOUT)
        M.login(GMAIL_U, GMAIL_PW)
        M.select("INBOX", readonly=True)
    except Exception as e:
        log("IMAP FALLITO dopo {:.1f}s -> {}: {}".format(time.time() - t0, type(e).__name__, e))
        raise
    log("IMAP connesso in {:.1f}s".format(time.time() - t0))

    query = '"from:messages.homeaway.com newer_than:{}d"'.format(WINDOW_DAYS)
    typ, data = M.search(None, 'X-GM-RAW', query)
    ids = data[0].split()
    log("Email VRBO trovate negli ultimi {} giorni: {}".format(WINDOW_DAYS, len(ids)))

    messaggi = []
    for i in ids:
        t, d = M.fetch(i, '(BODY.PEEK[])')
        messaggi.append(parse_email(email.message_from_bytes(d[0][1])))
    try:
        M.logout()
    except Exception:
        pass
    return messaggi


# ---------------------------------------------------------------- passaporti
# Seconda fase, ex vrbo_auto_passport.ps1 sul PC di casa. Marca la prenotazione
# come pagata (le VRBO sono sempre pagate in anticipo, fuori Hostaway) e chiede
# all'ospite i documenti nella conversazione Hostaway.
#
# Niente file di stato: il registro di cio' che e' gia' partito e' la
# conversazione stessa. Se contiene gia' un messaggio con SENTINELLA la
# prenotazione e' fatta e si salta. Ogni dubbio - errore di lettura, risposta
# inattesa - porta a NON mandare: meglio un messaggio in ritardo che un
# messaggio doppio all'ospite.
CHANNEL_VRBO = 2010
SENTINELLA   = "upload a photo of your passport"
MESI_EN = [None, "January", "February", "March", "April", "May", "June",
           "July", "August", "September", "October", "November", "December"]


def prenotazioni_vrbo():
    """Prenotazioni del canale VRBO, con paginazione."""
    out, offset = [], 0
    while True:
        lista = hget("reservations?channelId={}&limit=100&offset={}".format(
            CHANNEL_VRBO, offset)).get("result") or []
        for res in lista:
            # La query filtra per canale: se torna altro la risposta non e'
            # affidabile e non si tocca niente (stesso blocco del vecchio .ps1).
            if res.get("channelName") != "vrboical":
                raise RuntimeError("BLOCCO SICUREZZA: prenotazione non-vrboical id={} canale={}".format(
                    res.get("id"), res.get("channelName")))
            out.append(res)
        if len(lista) < 100:
            return out
        offset += 100


def conversazione(res_id):
    """Id della conversazione della prenotazione; la crea se non esiste."""
    esistenti = hget("conversations?reservationId={}".format(res_id)).get("result") or []
    if esistenti:
        return esistenti[0].get("id")
    nuova = hsend("conversations", {"reservationId": int(res_id),
                                    "type": "host-guest-email"}, "POST")
    conv_id = (nuova.get("result") or {}).get("id")
    log("  conversazione creata (id {})".format(conv_id))
    return conv_id


def documenti_gia_chiesti(conv_id):
    messaggi = hget("conversations/{}/messages".format(conv_id)).get("result") or []
    return any(SENTINELLA in (m.get("body") or "") for m in messaggi)


def marca_pagata(res, tag):
    """Scrive totalPaid = totalPrice, se non risulta gia' pagata."""
    total = res.get("totalPrice") or 0
    if total <= 0:
        return
    # L'elenco delle prenotazioni NON porta financeField: per sapere quanto
    # risulta pagato serve il dettaglio. Senza questa lettura si riscriverebbe
    # l'importo a ogni giro.
    dettaglio = hget("reservations/{}".format(res["id"])).get("result") or {}
    pagato = 0
    for f in (dettaglio.get("financeField") or []):
        if f.get("name") == "totalPaid":
            pagato = f.get("value") or 0
    if pagato >= total:
        return
    if DRY_RUN:
        log("  [DRY] marcherei pagata EUR {}: {}".format(total, tag))
        return
    hsend("reservations/{}".format(res["id"]), {"financeField": [
        {"type": "totals", "name": "totalPaid", "title": "Total paid",
         "value": total, "units": 1, "isIncludedInTotalPrice": 0,
         "isOverriddenByUser": 1, "isMandatory": 0, "isQuantitySelectable": 0},
        {"type": "totals", "name": "totalPriceFromChannel", "title": "Total price from channel",
         "value": total, "units": 1, "isIncludedInTotalPrice": 0,
         "isOverriddenByUser": 0, "isMandatory": 0, "isQuantitySelectable": 0},
    ]}, "PUT")
    log("  MARCATA PAGATA EUR {}: {}".format(total, tag))


def testo_documenti(nome, checkin, ospiti, portale):
    d = datetime.date.fromisoformat(checkin)
    quando = "{} {}".format(MESI_EN[d.month], d.day)
    extra = ("\n\nSince you are travelling with {} guests, please also upload the second "
             "guest's document using the Selfie button on the same page.".format(ospiti)) if (ospiti or 0) >= 2 else ""
    return ("Hi {},\n\nWe look forward to welcoming you on {}!\n\n"
            "As required by Italian law, we need to register the ID documents of all guests "
            "before check-in. Please upload a photo of your passport or ID card using the "
            "link below:\n\n{}{}\n\nSee you soon!\nMichele\nNiceFlat Rome").format(
                nome, quando, portale, extra)


def fase_passaporti():
    oggi = datetime.date.today().isoformat()
    tutte = prenotazioni_vrbo()
    fatte = 0

    for res in tutte:
        rid = res.get("id")
        email = (res.get("guestEmail") or "").strip()
        tag = "{} | {} | {}..{}".format(rid, res.get("guestName"),
                                        res.get("arrivalDate"), res.get("departureDate"))

        if res.get("status") == "cancelled":
            continue
        if (res.get("departureDate") or "") < oggi:
            continue
        # Senza email non si va avanti: la mette a mano l'utente su Hostaway
        # dopo che l'iCal ha creato la prenotazione. E' il passo che sblocca
        # tutto il resto.
        if not email:
            continue

        try:
            conv_id = conversazione(rid)
            if not conv_id:
                log("  SALTO, nessuna conversazione: {}".format(tag))
                continue
            if documenti_gia_chiesti(conv_id):
                continue
        except Exception as e:
            # Non si riesce a stabilire se il messaggio e' gia' partito:
            # si salta, si ritenta al giro dopo. Mai mandare nel dubbio.
            log("  SALTO, conversazione illeggibile ({}): {}".format(type(e).__name__, tag))
            continue

        try:
            marca_pagata(res, tag)
        except Exception as e:
            log("  ERRORE marca pagata ({}): {}".format(e, tag))

        testo = testo_documenti(res.get("guestName"), res.get("arrivalDate"),
                                res.get("numberOfGuests"), res.get("guestPortalUrl"))
        if DRY_RUN:
            log("  [DRY] chiederei i documenti a {}: {}".format(email, tag))
            continue
        try:
            hsend("conversations/{}/messages".format(conv_id), {"body": testo}, "POST")
            log("  DOCUMENTI RICHIESTI a {}: {}".format(email, tag))
            fatte += 1
        except Exception as e:
            log("  ERRORE invio messaggio ({}): {}".format(e, tag))

    log("Passaporti: {} prenotazioni VRBO attive, {} messaggi inviati.".format(len(tutte), fatte))


# ---------------------------------------------------------------- main
def fase_blocco():
    messaggi = leggi_email()

    # Le cancellazioni servono a capire se una prenotazione confermata nella
    # finestra e' poi stata annullata.
    annullate = set(chiave(x) for x in messaggi if x["cancel"])

    oggi = datetime.date.today()
    conferme = {}
    for info in messaggi:
        if info["cancel"] or not info["confirm"]:
            continue
        if not info["pid"] or info["pid"] not in PROPERTY_MAP:
            log("SALTO: property {} sconosciuta ({})".format(info["pid"], info["subject"][:40]))
            continue
        if not info["arr"] or not info["dep"]:
            log("SALTO: date non riconosciute ({})".format(info["subject"][:50]))
            continue
        if datetime.date.fromisoformat(info["dep"]) < oggi:
            continue
        # una sola voce per prenotazione, anche se VRBO manda piu' email
        conferme[chiave(info)] = info

    log("Prenotazioni da controllare: {}".format(len(conferme)))

    for key, info in conferme.items():
        lid = PROPERTY_MAP[info["pid"]]
        start = info["arr"]
        end = (datetime.date.fromisoformat(info["dep"]) - datetime.timedelta(days=1)).isoformat()
        if end < start:
            log("SALTO: intervallo incoerente {}..{}".format(start, end))
            continue

        tag = "{} ({}) {}..{} | {} | {}".format(NAMES[lid], lid, start, end, info["guest"], key)

        try:
            cal = calendario(lid, start, end)
        except Exception as e:
            log("ERRORE lettura calendario {}: {}".format(tag, e))
            continue

        prenotati = [d["date"] for d in cal if d["status"] == "reserved"]
        bloccati = [d["date"] for d in cal if d["status"] == "blocked" and d.get("isAvailable") == 0]

        # --- prenotazione annullata su VRBO ---
        if key in annullate:
            if prenotati:
                log("ANNULLATA ma risulta ancora prenotata su Hostaway, non tocco niente: {}".format(tag))
            elif bloccati:
                log("ANNULLATA -> rilascio le date bloccate: {}".format(tag))
                for g in bloccati:
                    libera(lid, g, "prenotazione VRBO annullata")
            continue

        # --- iCal arrivato: la prenotazione tiene le date ---
        if prenotati:
            extra = [g for g in bloccati if g not in prenotati]
            if extra:
                log("iCal sincronizzato -> libero i giorni bloccati in piu: {}".format(tag))
                for g in extra:
                    libera(lid, g, "giorno bloccato oltre la prenotazione")
            else:
                log("OK gia su Hostaway, nessun blocco necessario: {}".format(tag))
            continue

        # --- iCal non ancora arrivato: blocca ---
        if DRY_RUN:
            log("[DRY] BLOCCHEREI: {}".format(tag))
        else:
            st = hput_avail(lid, start, end, 0)
            log("BLOCCO CREATO [{}]: {}".format(st, tag))


def main():
    """Due lavori distinti, isolati uno dall'altro.

    Il blocco anti-overbooking viene per primo ed e' quello critico: se la
    seconda fase esplode, il suo giro l'ha gia' fatto. Un errore in una fase
    non impedisce all'altra di girare; il run risulta comunque fallito, cosi'
    il problema si vede nella lista dei run e non passa inosservato.
    """
    if not TOKEN or not GMAIL_U or not GMAIL_PW:
        log("CONFIGURAZIONE INCOMPLETA: mancano HOSTAWAY_TOKEN, GMAIL_USER o GMAIL_APP_PASSWORD")
        return 1

    log("===== VRBO Block - {} =====".format("DRY-RUN" if DRY_RUN else "LIVE"))
    esito = 0

    try:
        fase_blocco()
    except Exception as e:
        log("ERRORE FASE BLOCCO -> {}: {}".format(type(e).__name__, e))
        log("dettaglio: " + traceback.format_exc().replace(chr(10), " | "))
        esito = 1

    try:
        fase_passaporti()
    except Exception as e:
        log("ERRORE FASE PASSAPORTI -> {}: {}".format(type(e).__name__, e))
        log("dettaglio: " + traceback.format_exc().replace(chr(10), " | "))
        esito = 1

    log("Fine.")
    return esito


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as e:
        log("ERRORE NON GESTITO -> {}: {}".format(type(e).__name__, e))
        log("dettaglio: " + traceback.format_exc().replace(chr(10), " | "))
        sys.exit(1)
