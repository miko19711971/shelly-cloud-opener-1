// ════════════════════════════════════════════════════════════════════════════
// CONTROLLO PASSAPORTI T-1
// Il giorno prima di ogni check-in verifica che sull'arrival form di Hostaway
// ci sia un documento per OGNI ospite, minori compresi. Se ne mancano, parte
// un avviso.
//
// Il blocco non e' una minaccia a vuoto: la Fase 2 (link della guida) e la
// Fase 3 (chiavi digitali) partono dal webhook di check-in online in
// /hostaway-incoming, cioe' solo quando l'ospite ha completato il form. Chi
// non carica i documenti non riceve il link e il giorno dell'arrivo non entra:
// l'avviso serve a dirglielo mentre c'e' ancora tempo per rimediare.
//
// Da dove arriva il dato: l'API pubblica v1 NON espone i documenti caricati
// (/v1/arrivalForms restituisce solo reservationId + isSubmitted). I documenti
// stanno sull'endpoint del guest portal, che si legge con il guestAuthHash
// della prenotazione:
//   GET https://platform.hostaway.com/guestPortal/arrivalForm/:rid?auth=:hash
// Ogni ospite e' un blocco con due campi foto, idPhoto (bottone "Upload") e
// selfie (bottone "Selfie"): il blocco conta come coperto se almeno uno dei
// due e' pieno. Se il form non e' mai stato aperto l'endpoint risponde 200 con
// result null (o 404 con {"status":"fail"}): nessun documento caricato.
// ════════════════════════════════════════════════════════════════════════════

import axios from "axios";

const HOSTAWAY_API = "https://api.hostaway.com/v1";
const GUEST_PORTAL_API = "https://platform.hostaway.com/guestPortal";

const CANCELLED = new Set([
  "cancelled", "canceled", "declined", "expired",
  "inquiry", "inquirynotpossible", "inquiry_timedout", "inquirytimedout"
]);

// Frase presente in ogni avviso: serve a non mandarlo due volte se il servizio
// riparte (lo stato in memoria si azzera, la conversazione Hostaway no).
export const PASSPORT_MARKER = "we must register an identity document for every guest";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}`,
    "Cache-control": "no-cache"
  };
}

// Serve un documento per ogni persona che dorme in casa, minori di qualunque
// eta' compresi. numberOfGuests di solito li contiene gia', ma i neonati su
// Hostaway stanno in un campo a parte: si prende il totale piu' alto.
export function expectedDocuments(r) {
  const adults = Number(r.adults) || 0;
  const children = Number(r.children) || 0;
  const infants = Number(r.infants) || 0;
  return Math.max(Number(r.numberOfGuests) || 0, adults + children + infants, 1);
}

// Arrivi di una data precisa, cancellazioni escluse.
export async function fetchArrivals(day) {
  const params = new URLSearchParams({
    arrivalStartDate: day, arrivalEndDate: day, limit: "100"
  });
  const resp = await axios.get(`${HOSTAWAY_API}/reservations?${params}`, {
    headers: authHeaders(), timeout: 15000
  });
  const all = resp.data?.result || [];
  // Hostaway a volte ignora i filtri di data → si rifiltra qui.
  return all.filter(r =>
    (r.arrivalDate || r.checkInDate) === day &&
    !CANCELLED.has(String(r.status || "").toLowerCase())
  );
}

// Quanti documenti sono stati caricati.
// Ritorna { status: "read" | "no_form" | "unknown", docs, photos, slots }
export async function fetchUploadedDocuments(r) {
  if (!r.guestAuthHash) return { status: "unknown", reason: "guestAuthHash mancante", docs: 0 };
  const url = `${GUEST_PORTAL_API}/arrivalForm/${r.id}?auth=${encodeURIComponent(r.guestAuthHash)}`;
  let resp;
  try {
    resp = await axios.get(url, { timeout: 15000 });
  } catch (e) {
    const code = e.response?.status;
    const body = e.response?.data;
    // 404 + {"status":"fail"} = form mai aperto, quindi zero documenti.
    if (code === 404 && body && typeof body === "object" && body.status === "fail") {
      return { status: "no_form", docs: 0, photos: 0, slots: 0 };
    }
    // Qualsiasi altra risposta: non si sa. Meglio non accusare nessuno.
    return { status: "unknown", reason: `HTTP ${code || e.code || e.message}`, docs: 0 };
  }
  // Form mai aperto: l'endpoint risponde 200 con result null (oppure 404, sopra).
  const form = resp.data?.result;
  if (resp.data?.status === "success" && (form === null || form === undefined)) {
    return { status: "no_form", docs: 0, photos: 0, slots: 0 };
  }
  if (!form || !Array.isArray(form.guests)) {
    return { status: "unknown", reason: "risposta senza guests", docs: 0 };
  }
  let docs = 0, photos = 0;
  for (const g of form.guests) {
    const n = (g.idPhoto ? 1 : 0) + (g.selfie ? 1 : 0);
    photos += n;
    if (n > 0) docs++;
  }
  return {
    status: "read", docs, photos, slots: form.guests.length,
    isSubmitted: !!form.isSubmitted, updatedOn: form.updatedOn
  };
}

// L'arrival form deve essere attivo per quell'appartamento e quel canale:
// se Hostaway non lo propone all'ospite, non gli si puo' chiedere niente.
export async function isArrivalFormActive(r) {
  if (!r.guestAuthHash) return { active: false, reason: "guestAuthHash mancante" };
  try {
    const resp = await axios.get(
      `${GUEST_PORTAL_API}/arrivalFormSetting/${r.id}?auth=${encodeURIComponent(r.guestAuthHash)}`,
      { timeout: 15000 }
    );
    const s = resp.data?.result;
    if (!s) return { active: false, reason: "nessuna impostazione" };
    if (!s.isActive) return { active: false, reason: "form non attivo sull'appartamento" };
    const channels = Array.isArray(s.channelIds) ? s.channelIds.map(Number) : null;
    if (channels && r.channelId && !channels.includes(Number(r.channelId))) {
      return { active: false, reason: `canale ${r.channelName || r.channelId} escluso dal form` };
    }
    return { active: true };
  } catch (e) {
    // Impostazione illeggibile: si prosegue, il controllo sui documenti resta valido.
    return { active: true, reason: `impostazione non letta (${e.response?.status || e.message})` };
  }
}

// L'avviso e' gia' partito nelle ultime ore su questa conversazione?
export async function warningAlreadySent(conversationId, hours = 20) {
  if (!conversationId) return false;
  try {
    const resp = await axios.get(
      `${HOSTAWAY_API}/conversations/${conversationId}/messages?limit=20`,
      { headers: authHeaders(), timeout: 10000 }
    );
    const cutoff = Date.now() - hours * 3600 * 1000;
    return (resp.data?.result || []).some(m => {
      if (!String(m.body || "").includes(PASSPORT_MARKER)) return false;
      const ts = new Date(m.date || m.insertedOn || m.insertedAt || 0).getTime();
      return !ts || ts >= cutoff;
    });
  } catch {
    return false; // in caso di errore non si blocca l'invio
  }
}

export function buildGuestWarning(r, { docs, expected }) {
  const name = r.guestFirstName || (r.guestName || "").split(" ")[0] || "there";
  const portal = r.guestPortalUrl ||
    (r.guestAuthHash ? `https://guest-portal.hostaway.com/${r.id}/${r.guestAuthHash}` : "");
  const missing = Math.max(expected - docs, 0);
  const have = docs === 0
    ? "So far we have not received any document."
    : `So far we have received ${docs} document${docs === 1 ? "" : "s"} out of ${expected}.`;

  return [
    `Hello ${name},`,
    ``,
    `You are checking in tomorrow (${r.arrivalDate}) and your online check-in is not complete yet.`,
    ``,
    `As required by Italian law, ${PASSPORT_MARKER} staying in the apartment, children of any age included: ${expected} document${expected === 1 ? "" : "s"} in total. ${have}`,
    ``,
    `Please upload the missing ${missing === 1 ? "one" : `${missing} documents`} here:`,
    portal,
    ``,
    `For each guest use the "Upload" button or the "Selfie" button and send a clear photo of the front page of the passport or ID card.`,
    ``,
    `Please note: the link to your digital guide — the one that carries the electronic keys to open the building door and the apartment — is sent automatically only once the online check-in is complete, with the document of every guest. Until then the keys cannot be issued and you will not be able to get into the apartment on the day of your arrival.`,
    ``,
    `It only takes a minute. Thank you!`,
    ``,
    `Michele`,
    `NiceFlat Rome`
  ].join("\n");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function buildHostReport(day, rows) {
  const missing = rows.filter(x => x.outcome === "warned" || x.outcome === "would_warn" || x.outcome === "already_warned");
  const unknown = rows.filter(x => x.outcome === "unknown");
  const lines = [];
  lines.push(`Controllo passaporti — arrivi del ${day}`);
  lines.push(`Prenotazioni controllate: ${rows.length}`);
  lines.push("");
  if (missing.length) {
    lines.push("DOCUMENTI MANCANTI:");
    for (const x of missing) {
      lines.push(`- ${x.guestName} (${x.reservationId}, apt ${x.listingMapId}, ${x.channelName}): ${x.docs}/${x.expected} — ${x.outcome === "already_warned" ? "avviso gia' inviato" : x.outcome === "would_warn" ? "avviso NON inviato (prova a secco)" : "avviso inviato"}`);
    }
    lines.push("");
  }
  if (unknown.length) {
    lines.push("DA VERIFICARE A MANO (dato non letto, nessun avviso inviato):");
    for (const x of unknown) lines.push(`- ${x.guestName} (${x.reservationId}): ${x.reason}`);
    lines.push("");
  }
  const ok = rows.filter(x => x.outcome === "ok");
  if (ok.length) {
    lines.push("COMPLETE:");
    for (const x of ok) lines.push(`- ${x.guestName} (${x.reservationId}): ${x.docs}/${x.expected}`);
  }

  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto">
    <h2 style="font-size:17px;color:#1d1812;margin:0 0 4px">🛂 Controllo passaporti — arrivi del ${esc(day)}</h2>
    <p style="color:#7a6f5c;font-size:13px;margin:0 0 16px">${rows.length} prenotazione/i controllate · ${missing.length} incomplete · ${unknown.length} da verificare</p>
    ${rows.map(x => {
      const bad = x.outcome !== "ok";
      return `<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 10px;background:#fff;border:1px solid ${bad ? "#e0b4b4" : "#e6e0d5"};border-radius:10px;overflow:hidden">
        <tr><td style="background:${bad ? "#7d2a2a" : "#1d1812"};color:#f2d58a;padding:9px 13px;font-weight:700;font-size:14px">${bad ? "⚠️" : "✅"} ${esc(x.guestName)}</td></tr>
        <tr><td style="padding:10px 13px;font-size:13px;color:#222;line-height:1.6">
          <b>Documenti:</b> ${esc(x.docs)}/${esc(x.expected)}${x.photos != null ? ` (foto totali: ${esc(x.photos)})` : ""}<br>
          <b>Prenotazione:</b> ${esc(x.reservationId)} · apt ${esc(x.listingMapId)} · ${esc(x.channelName)}<br>
          <b>Esito:</b> ${esc(x.outcome)}${x.reason ? ` — ${esc(x.reason)}` : ""}
        </td></tr></table>`;
    }).join("")}
    <p style="color:#9a8f7c;font-size:12px;margin-top:16px">Controllo automatico NiceFlat · un giorno prima di ogni check-in</p>
  </div>`;

  const subject = `🛂 Passaporti arrivi ${day} — ${missing.length} incomplete su ${rows.length}`;
  return { subject, text: lines.join("\n"), html };
}

// ── Il controllo ────────────────────────────────────────────────────────────
// deps: { getConversationId, sendGuestMessage, sendHostEmail, log }
// opts: { day, dryRun }
export async function runPassportCheck(deps, opts = {}) {
  const log = deps.log || console.log;
  const dryRun = !!opts.dryRun;
  const day = opts.day;
  if (!process.env.HOSTAWAY_TOKEN) {
    log("❌ Controllo passaporti: HOSTAWAY_TOKEN mancante");
    return { day, rows: [], skipped: "no_token" };
  }

  const arrivals = await fetchArrivals(day);
  log(`🛂 Controllo passaporti ${day}: ${arrivals.length} arrivo/i da controllare${dryRun ? " (prova a secco)" : ""}`);
  const rows = [];

  for (const r of arrivals) {
    const base = {
      reservationId: r.id, guestName: r.guestName || "Ospite",
      listingMapId: r.listingMapId, channelName: r.channelName || "—",
      expected: expectedDocuments(r)
    };

    const active = await isArrivalFormActive(r);
    if (!active.active) {
      rows.push({ ...base, docs: 0, outcome: "skipped", reason: active.reason });
      log(`   ↷ ${r.id} ${base.guestName}: saltata (${active.reason})`);
      continue;
    }

    const found = await fetchUploadedDocuments(r);
    if (found.status === "unknown") {
      rows.push({ ...base, docs: 0, outcome: "unknown", reason: found.reason });
      log(`   ? ${r.id} ${base.guestName}: dato non letto (${found.reason}) → nessun avviso`);
      continue;
    }

    const row = { ...base, docs: found.docs, photos: found.photos, slots: found.slots };

    if (found.docs >= base.expected) {
      rows.push({ ...row, outcome: "ok" });
      log(`   ✅ ${r.id} ${base.guestName}: ${found.docs}/${base.expected}`);
      continue;
    }

    const conversationId = await deps.getConversationId(r.id);
    if (!conversationId) {
      rows.push({ ...row, outcome: "unknown", reason: "conversazione Hostaway non trovata" });
      log(`   ? ${r.id} ${base.guestName}: nessuna conversazione → avviso non inviabile`);
      continue;
    }
    if (await warningAlreadySent(conversationId)) {
      rows.push({ ...row, outcome: "already_warned" });
      log(`   ⏭ ${r.id} ${base.guestName}: ${found.docs}/${base.expected}, avviso gia' inviato`);
      continue;
    }
    if (dryRun) {
      rows.push({ ...row, outcome: "would_warn" });
      log(`   ⚠️ ${r.id} ${base.guestName}: ${found.docs}/${base.expected} → avviso DA INVIARE (prova a secco)`);
      continue;
    }

    const message = buildGuestWarning(r, { docs: found.docs, expected: base.expected });
    await deps.sendGuestMessage({ conversationId, message });
    rows.push({ ...row, outcome: "warned" });
    log(`   📨 ${r.id} ${base.guestName}: ${found.docs}/${base.expected} → avviso inviato`);
  }

  // Riepilogo all'host solo se c'e' qualcosa da dire.
  const worth = rows.some(x => x.outcome !== "ok" && x.outcome !== "skipped");
  if (worth && deps.sendHostEmail && !dryRun) {
    try {
      await deps.sendHostEmail(buildHostReport(day, rows));
      log("📧 Controllo passaporti: riepilogo inviato all'host");
    } catch (e) {
      log(`❌ Controllo passaporti: riepilogo non inviato (${e.message})`);
    }
  }

  return { day, dryRun, rows };
}
