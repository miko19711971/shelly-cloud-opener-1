#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
vrbo_block.py - Cron Job su Render

Legge da Gmail le conferme di prenotazione VRBO e, se Hostaway non ha ancora la
prenotazione, blocca subito quelle date sul calendario Hostaway. Serve a coprire
i ~30 minuti che il sync iCal impiega ad arrivare: in quella finestra
l'appartamento risulta ancora libero e puo' essere prenotato una seconda volta
su un altro canale.

Sostituisce vrbo_email_block.py, che girava sul PC di casa con il Task Scheduler
e quindi era spento circa 15 ore al giorno - proprio le ore in cui arrivano le
prenotazioni VRBO.

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


# ---------------------------------------------------------------- main
def main():
    if not TOKEN or not GMAIL_U or not GMAIL_PW:
        log("CONFIGURAZIONE INCOMPLETA: mancano HOSTAWAY_TOKEN, GMAIL_USER o GMAIL_APP_PASSWORD")
        sys.exit(1)

    log("===== VRBO Block - {} =====".format("DRY-RUN" if DRY_RUN else "LIVE"))
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

    log("Fine.")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log("ERRORE NON GESTITO -> {}: {}".format(type(e).__name__, e))
        log("dettaglio: " + traceback.format_exc().replace(chr(10), " | "))
        sys.exit(1)
