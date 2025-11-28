import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
// Guest Assistant AI → JSON dinamico (guides-v2)
import { reply as guideAIreply } from "./guide-ai.js";
const app = express();
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// ========= STATIC PATHS =========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// ========= ENV BASE =========
const SHELLY_API_KEY  = process.env.SHELLY_API_KEY;
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET    = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) {
  console.error("❌ Missing TOKEN_SECRET env var");
  process.exit(1);
}
const TIMEZONE        = process.env.TIMEZONE || "Europe/Rome";
const ALLOW_TODAY_FALLBACK = process.env.ALLOW_TODAY_FALLBACK === "1";

// ========= ROTAZIONE HARD-CODED =========
const ROTATION_TAG   = "R-2025-09-18-final"; // revoca globale futura
const TOKEN_VERSION  = 100;
const LINK_PREFIX    = "/k3";
const SIGNING_SECRET = `${TOKEN_SECRET}|${ROTATION_TAG}`;
const REVOKE_BEFORE  = parseInt(process.env.REVOKE_BEFORE || "0", 10);
const STARTED_AT     = Date.now();

// Limiti sicurezza default (apertura porte)
const DEFAULT_WINDOW_MIN = parseInt(process.env.WINDOW_MIN || "15", 10);
const DEFAULT_MAX_OPENS  = parseInt(process.env.MAX_OPENS  || "2", 10);

// (guide sono statiche; mantenuta solo per riferimento)
const GUIDE_WINDOW_MIN   = 1440;
// ✅ Validità token dei SELF-CHECK-IN (UI countdown); la regola REALE è “solo giorno di check-in”
const CHECKIN_WINDOW_MIN = 1440;

// ======== Security headers (CSP, ecc.) ========
const GUIDE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "navigate-to 'self' https://shelly-cloud-opener-1.onrender.com"
].join("; ");

function setGuideSecurityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", GUIDE_CSP);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}
app.use(["/checkin", "/guides", "/guest-assistant", LINK_PREFIX], setGuideSecurityHeaders);

// ========= NO-CACHE & DEBUG HEADERS =========
app.use((req, res, next) => {
  if (req.path.startsWith("/k/") || req.path.startsWith("/k2/") || req.path.startsWith(LINK_PREFIX)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }
  res.setHeader("X-Link-Prefix", LINK_PREFIX);
  res.setHeader("X-Token-Version", String(TOKEN_VERSION));
  res.setHeader("X-Rotation-Tag", ROTATION_TAG);
  res.setHeader("X-Started-At", String(STARTED_AT));
  next();
});

// ========= MAPPATURA DISPOSITIVI =========
const TARGETS = {
  "arenula-building":         { name: "Arenula 16 — Building Door",                ids: ["3494547ab05e"] },
  "leonina-door":             { name: "Leonina 71 — Apartment Door",               ids: ["3494547a9395"] },
  "leonina-building": { name: "Via Leonina 71 — Building Door",                    ids: ["34945479fbbe"] },
  "via-della-scala-door":     { name: "Via della Scala 17 — Apartment Door",       ids: ["3494547a1075"] },
  "via-della-scala-building": { name: "Via della Scala 17 — Building Door",        ids: ["3494547745ee", "3494547745ee"] },
  "portico-1d-door":          { name: "Portico d'Ottavia 1D — Apartment Door",     ids: ["3494547a887d"] },
  "portico-1d-building":      { name: "Portico d'Ottavia 1D — Building Door",      ids: ["3494547ab62b"] },
  "viale-trastevere-door":    { name: "Viale Trastevere 108 — Apartment Door",     ids: ["34945479fa35"] },
  "viale-trastevere-building":{ name: "Building Door",                             ids: ["34945479fd73"] },
};

const RELAY_CHANNEL = 0;

// ========== HELPER Shelly ==========
async function shellyTurnOn(deviceId) {
  const form = new URLSearchParams({
    id: deviceId,
    auth_key: SHELLY_API_KEY,
    channel: String(RELAY_CHANNEL),
    turn: "on"
  });
  try {
    const { data } = await axios.post(
      `${SHELLY_BASE_URL}/device/relay/control`,
      form.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 7000 }
    );
    if (data && data.isok) return { ok: true, data };
    return { ok: false, status: 400, data };
  } catch (err) {
    return { ok: false, status: err?.response?.status || 500, data: err?.response?.data || String(err) };
  }
}
async function openOne(deviceId) { const first = await shellyTurnOn(deviceId); return first.ok ? { ok:true, first } : { ok:false, first }; }
async function openSequence(ids, delayMs = 10000) {
  const logs = [];
  for (let i = 0; i < ids.length; i++) {
    const r = await openOne(ids[i]);
    logs.push({ step: i + 1, device: ids[i], ...r });
    if (i < ids.length - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  return { ok: logs.every(l => l.ok), logs };
}

// ========== TOKEN MONOUSO ==========
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function hmac_raw(str) { return crypto.createHmac("sha256", SIGNING_SECRET).update(str).digest(); }
function hmac(str) { return b64url(hmac_raw(str)); }
function makeToken(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "TOK" }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = hmac(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}
function parseToken(token) {
  const [h, b, s] = (token || "").split(".");
  if (!h || !b || !s) return { ok: false, error: "bad_format" };
  const sig = hmac(`${h}.${b}`);
  if (sig !== s) return { ok: false, error: "bad_signature" };
  let payload;
  try { payload = JSON.parse(Buffer.from(b, "base64").toString("utf8")); }
  catch { return { ok: false, error: "bad_payload" }; }
  if (typeof payload.ver !== "number" || payload.ver !== TOKEN_VERSION) return { ok: false, error: "bad_version" };
  if (REVOKE_BEFORE && typeof payload.iat === "number" && payload.iat < REVOKE_BEFORE) return { ok: false, error: "revoked" };
  if (typeof payload.iat !== "number" || payload.iat < STARTED_AT) return { ok: false, error: "revoked_boot" };
  return { ok: true, payload };
}
function newTokenFor(targetKey, opts = {}) {
  const max = opts.max ?? DEFAULT_MAX_OPENS;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const now = Date.now();
  const exp = now + windowMin * 60 * 1000;
  const jti = b64url(crypto.randomBytes(9));
  const payload = { tgt: targetKey, exp, max, used: opts.used ?? 0, jti, iat: now, ver: TOKEN_VERSION, day: opts.day };
  return { token: makeToken(payload), payload };
}

// ====== Time helpers (Europe/Rome) ======
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
// YYYY-MM-DD nel fuso definito
function tzToday() { return fmtDay.format(new Date()); }
function isYYYYMMDD(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s); }
const TODAY_LOCK = new Map(); // 🔒 memorizza il giorno di utilizzo di ogni appartamento
// ====== Normalizzatore formati data Hostaway → YYYY-MM-DD ======
const MONTHS_MAP = (() => {
  const m = new Map();
  // Inglese
  ["january","february","march","april","may","june","july","august","september","october","november","december"]
    .forEach((n,i)=>m.set(n,i+1));
  ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"]
    .forEach((n,i)=>m.set(n,i+1));
  // Italiano
  [["gennaio","gen"],["febbraio","feb"],["marzo","mar"],["aprile","apr"],["maggio","mag"],["giugno","giu"],["luglio","lug"],["agosto","ago"],["settembre","set"],["ottobre","ott"],["novembre","nov"],["dicembre","dic"]]
    .forEach(([full,short],i)=>{ m.set(full,i+1); m.set(short,i+1); });
  // Spagnolo
  [["enero","ene"],["febrero","feb"],["marzo","mar"],["abril","abr"],["mayo","may"],["junio","jun"],["julio","jul"],["agosto","ago"],["septiembre","sep"],["octubre","oct"],["noviembre","nov"],["diciembre","dic"]]
    .forEach(([full,short],i)=>{ m.set(full,i+1); m.set(short,i+1); });
  // Francese (senza diacritici)
  [["janvier","jan"],["février","fevrier"],["mars","mar"],["avril","avr"],["mai","mai"],["juin","juin"],["juillet","juillet"],["août","aout"],["septembre","sep"],["octobre","oct"],["novembre","nov"],["décembre","decembre"]]
    .forEach(([full,short],i)=>{ m.set(full.normalize("NFD").replace(/\p{Diacritic}/gu,''),i+1); m.set(short.normalize("NFD").replace(/\p{Diacritic}/gu,''),i+1); });
  // Tedesco
  [["januar","jan"],["februar","feb"],["märz","marz"],["april","apr"],["mai","mai"],["juni","jun"],["juli","jul"],["august","aug"],["september","sep"],["oktober","okt"],["november","nov"],["dezember","dez"]]
    .forEach(([full,short],i)=>{ m.set(full.normalize("NFD").replace(/\p{Diacritic}/gu,''),i+1); m.set(short.normalize("NFD").replace(/\p{Diacritic}/gu,''),i+1); });
  return m;
})();

function pad2(n){ return n < 10 ? "0"+n : String(n); }

function normalizeCheckinDate(raw){
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // pulizia base: togli virgole, normalizza spazi e diacritici
  const sClean = s.replace(/,/g," ").replace(/\s+/g," ").trim()
    .toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,'');
  // 1) YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(sClean)) return sClean;
  // 2) DD/MM/YYYY o DD-MM-YYYY
  let m = sClean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = parseInt(m[1],10), mo = parseInt(m[2],10), y = parseInt(m[3],10);
    if (d>=1 && d<=31 && mo>=1 && mo<=12) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  // 3) DD MMM YYYY o DD MMMM YYYY (multilingua)
  m = sClean.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m) {
    const d = parseInt(m[1],10), monName = m[2];
    const y = parseInt(m[3],10);
    const mo = MONTHS_MAP.get(monName);
    if (mo && d>=1 && d<=31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  return null;
}

// ====== Landing HTML (pagina intermedia /k3/:target/:token) ======
function pageCss() { return `
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}
  .wrap{max-width:680px}
  h1{font-size:28px;margin:0 0 8px}
  p{color:#444}
  button{font-size:18px;padding:10px 18px;border:1px solid #333;border-radius:8px;background:#fff;cursor:pointer}
  .muted{color:#777;font-size:14px;margin-top:14px}
  .ok{color:#0a7b34}
  .err{color:#b21a1a;white-space:pre-wrap}
  .hidden{display:none}
`; }
function landingHtml(targetKey, targetName, tokenPayload) {
  const remaining = Math.max(0, (tokenPayload?.max || 0) - (tokenPayload?.used || 0));
  const expInSec = Math.max(0, Math.floor((tokenPayload.exp - Date.now()) / 1000));
  const day = tokenPayload.day || "-";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${targetName}</title><style>${pageCss()}</style></head><body><div class="wrap">
  <h1>${targetName}</h1>
  <p class="muted">Valido solo nel giorno di check-in: <b>${day}</b> (${TIMEZONE})</p>
  <button id="btn">Apri</button>
  <div class="muted" id="hint">Max ${tokenPayload.max} aperture entro ${DEFAULT_WINDOW_MIN} minuti · residuo: <b id="left">${remaining}</b> · scade tra <span id="ttl">${expInSec}</span>s</div>
  <p class="ok hidden" id="okmsg">✔ Apertura inviata.</p>
  <pre class="err hidden" id="errmsg"></pre>
  <script>
    const btn=document.getElementById('btn'),okmsg=document.getElementById('okmsg'),errmsg=document.getElementById('errmsg'),leftEl=document.getElementById('left'),ttlEl=document.getElementById('ttl');
    let ttl=${expInSec}; setInterval(()=>{ if(ttl>0){ttl--; ttlEl.textContent=ttl;} },1000);
    btn.addEventListener('click', async ()=>{ 
      btn.disabled=true; okmsg.classList.add('hidden'); errmsg.classList.add('hidden');
      try{
        const res=await fetch(window.location.pathname+'/open',{method:'POST'}); 
        const j=await res.json();
        if(j.ok){ okmsg.classList.remove('hidden'); if(typeof j.remaining==='number'){ leftEl.textContent=j.remaining; } if(j.nextUrl){ try{history.replaceState(null,'',j.nextUrl);}catch(_){}} }
        else { errmsg.textContent=JSON.stringify(j,null,2); errmsg.classList.remove('hidden'); }
      }catch(e){ errmsg.textContent=String(e); errmsg.classList.remove('hidden'); } 
      finally{ btn.disabled=false; }
    });
  </script></div></body></html>`;
}

// ====== Home di servizio (facoltativa) ======
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS).map(([key, t]) => {
    const ids = t.ids.join(", ");
    return `<tr>
      <td>${t.name}</td>
      <td><code>${ids}</code></td>
      <td><a href="/token/${key}">Crea link</a></td>
      <td><form method="post" action="/api/open-now/${key}" style="display:inline"><button>Manual Open</button></form></td>
    </tr>`;
  }).join("\n");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"/><style>
    body{font-family:system-ui;margin:24px} table{border-collapse:collapse}
    td,th{border:1px solid #ccc;padding:8px 12px}
  </style><title>Door & Gate Opener</title></head><body>
  <h1>Door & Gate Opener</h1>
  <p>Link firmati temporanei e apertura manuale.</p>
  <table><thead><tr><th>Nome</th><th>Device ID</th><th>Smart Link</th><th>Manual Open</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p class="muted">Shard fallback: <code>${SHELLY_BASE_URL}</code></p>
  </body></html>`);
});

// ====== Genera smart link /token/:target ======
app.get("/token/:target", (req, res) => {
  const targetKey = req.params.target;
  const target = TARGETS[targetKey];
  if (!target) return res.status(404).json({ ok:false, error:"unknown_target" });

  const windowMin = parseInt(req.query.mins || DEFAULT_WINDOW_MIN, 10);
  const maxOpens  = parseInt(req.query.max  || DEFAULT_MAX_OPENS, 10);

  const { token, payload } = newTokenFor(targetKey, { windowMin, max: maxOpens, used: 0 });
  const url = `${req.protocol}://${req.get("host")}${LINK_PREFIX}/${targetKey}/${token}`;
  return res.json({ ok:true, url, expiresInMin: Math.round((payload.exp - Date.now())/60000) });
});

// 🔥 Vecchi link disattivati
app.all("/k/:target/:token", (req, res) => res.status(410).send("Link non più valido."));
app.all("/k/:target/:token/open", (req, res) => res.status(410).json({ ok:false, error:"gone" }));
app.all("/k2/:target/:token", (req, res) => res.status(410).send("Link non più valido."));
app.all("/k2/:target/:token/open", (req, res) => res.status(410).json({ ok:false, error:"gone" }));

// ====== /k3 landing + open ======
app.get(`${LINK_PREFIX}/:target/:token`, (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");

  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = (["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error)) ? 410 : 400;
    const msg  = parsed.error === "bad_signature" ? "Link non più valido (firma)." :
                 parsed.error === "bad_version"   ? "Link non più valido." :
                 parsed.error === "revoked"       ? "Link revocato." :
                 parsed.error === "revoked_boot"  ? "Link revocato (riavvio sistema)." :
                 "Invalid link";
    return res.status(code).send(msg);
  }
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).send("Invalid link");
  if (Date.now() > p.exp) return res.status(400).send("Link scaduto");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.type("html").send(landingHtml(target, targetDef.name, p));
});

app.post(`${LINK_PREFIX}/:target/:token/open`, async (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok:false, error:"unknown_target" });

  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = (["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error)) ? 410 : 400;
    return res.status(code).json({ ok:false, error:parsed.error });
  }
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok:false, error:"target_mismatch" });
  if (Date.now() > p.exp) return res.status(400).json({ ok:false, error:"expired" });

  let result;
  if (targetDef.ids.length === 1) result = await openOne(targetDef.ids[0]);
  else result = await openSequence(targetDef.ids, 10000);

  return res.json({ ok:true, opened: result });
});

// ✅ “apri subito” interno
app.all("/api/open-now/:target", (req, res) => {
  const targetKey = req.params.target;
  const targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).send("Unknown target");
  const { token } = newTokenFor(targetKey, { windowMin: DEFAULT_WINDOW_MIN, max: DEFAULT_MAX_OPENS, used: 0 });
  return res.redirect(302, `${LINK_PREFIX}/${targetKey}/${token}`);
});

// ====== GUIDES STATICHE SEMPRE ACCESSIBILI ======

app.use("/guides", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
// ====== VIRTUAL GUIDE AI (JSON + risposte automatiche) ======
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
app.use("/guides-v2", express.static(path.join(PUBLIC_DIR, "guides-v2"), { fallthrough: false }));
app.use("/public-test-ai-html", express.static(path.join(PUBLIC_DIR, "public-test-ai-html"), { fallthrough: false }));
// --- ALIAS: /checkin/:apt/today  (valido SOLO oggi) ---
// ✅ PATCH: /checkin/:apt/today — valido solo il giorno in cui viene usato
app.get("/checkin/:apt/today", (req, res) => {
  const apt = req.params.apt.toLowerCase();
  const today = tzToday();

  // Se non è mai stato usato, blocco al giorno corrente
  if (!TODAY_LOCK.has(apt)) TODAY_LOCK.set(apt, today);

  // ✅ Consentiamo fino alle 04:00 del mattino successivo
  const now = new Date();
  const hour = now.getHours();
  const sameDay = TODAY_LOCK.get(apt) === today;

  // Se è un nuovo giorno ma dopo le 04:00 → link scaduto
  if (!sameDay && hour >= 4) {
    return res.status(410).send("Link scaduto: valido solo nel giorno di check-in.");
  }

  // Genera token valido solo oggi
  const { token } = newTokenFor(`checkin-${apt}`, {
    windowMin: CHECKIN_WINDOW_MIN,
    max: 200,
    day: today
  });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});


// ✅ NUOVO: /checkin/:apt/:rawDate — pensato per HostAway {{checkin_date}}
app.get("/checkin/:apt/:rawDate([^/.]+)", (req, res) => {
  const apt   = req.params.apt.toLowerCase();
  const today = tzToday();

  // rawDate arriva da HostAway, es: "2025-11-21" oppure "21 Nov 2025"
  const raw = String(req.params.rawDate || "");
  let day = normalizeCheckinDate(raw);

  // se data non valida → errore (o fallback opzionale a oggi)
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) {
      day = today;
    } else {
      return res
        .status(410)
        .send("Questo link richiede una data valida di check-in nel percorso, es. /checkin/arenula/2025-11-21.");
    }
  }

  // valido SOLO nel giorno di check-in (Europe/Rome)
  if (day !== today) {
    return res.status(410).send("Questo link è valido solo nel giorno di check-in.");
  }

  const { token } = newTokenFor(`checkin-${apt}`, {
    windowMin: CHECKIN_WINDOW_MIN,
    max: 200,
    day
  });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});


// ====== SELF-CHECK-IN — VALIDI SOLO IL GIORNO DI CHECK-IN ======
// Link breve: /checkin/:apt/?d=<data>
app.get("/checkin/:apt/", (req, res) => {
  const apt = req.params.apt.toLowerCase();
  const today = tzToday();

  // 1) leggi raw e normalizza
  const raw = (req.query.d || "").toString();
  let day = normalizeCheckinDate(raw);

  // 2) se mancante/non valida -> fallback opzionale a oggi
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) {
      day = today;
    } else {
      return res.status(410).send("Questo link richiede la data di check-in (?d), es. ?d=2025-09-22.");
    }
  }

  // 3) vincolo: valido SOLO nel giorno di check-in (Europe/Rome)
  if (day !== today) {
    return res.status(410).send("Questo link è valido solo nel giorno di check-in.");
  }

  const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});

// Pagina protetta: verifica token + giorno
app.get("/checkin/:apt/index.html", (req, res) => {
  const apt = req.params.apt.toLowerCase();
  const t = String(req.query.t || "");
  const parsed = parseToken(t);
  if (!parsed.ok) return res.status(410).send("Questo link non è più valido.");
  const { tgt, day } = parsed.payload || {};
  if (tgt !== `checkin-${apt}`) return res.status(410).send("Link non valido.");
  if (!isYYYYMMDD(day) || day !== tzToday()) return res.status(410).send("Questo link è valido solo nel giorno di check-in.");
  res.sendFile(path.join(PUBLIC_DIR, "checkin", apt, "index.html"));
});

// ========= STATIC (asset) =========
app.use("/checkin", express.static(path.join(PUBLIC_DIR, "checkin"), { fallthrough: false }));
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guest-assistant"), { fallthrough: false }));
app.use(express.static(PUBLIC_DIR));
// ====== GUEST ASSISTANT AI (JSON → risposta) ======

// directory delle guide v2 (json)
const GUIDES_V2_DIR = path.join(PUBLIC_DIR, "guides-v2");

// cache in memoria per non rileggere i file ogni volta
const guidesCache = new Map();

/**
 * Carica il JSON della guida per un appartamento.
 * Si aspetta un file tipo: public/guides-v2/arenula.json, leonina.json, ecc.
 */
async function loadGuideJson(apt) {
  const aptKey = String(apt || "").toLowerCase();
  if (!aptKey) return null;

  if (guidesCache.has(aptKey)) {
    return guidesCache.get(aptKey);
  }

  const filePath = path.join(GUIDES_V2_DIR, `${aptKey}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    guidesCache.set(aptKey, json);
    return json;
  } catch (err) {
    console.error("❌ Impossibile leggere guida JSON per", aptKey, filePath, err.message);
    return null;
  }
}

/**
 * Normalizza la lingua richiesta (it/en/fr/de/es) e la confronta con quelle disponibili nel JSON.
 */
function normalizeLang(lang, availableFromJson) {
  const fallback = "en";
  const requested = (lang || "").toLowerCase().slice(0, 2);

  const known = ["it", "en", "fr", "de", "es"];

  // Se il JSON espone la proprietà "languages": [...]
  if (Array.isArray(availableFromJson) && availableFromJson.length) {
    if (availableFromJson.includes(requested)) return requested;
    if (availableFromJson.includes(fallback)) return fallback;
    return availableFromJson[0]; // prima disponibile
  }

  // Se non c'è "languages", prova a usare un codice pulito
  if (known.includes(requested)) return requested;
  return fallback;
}

// 🔎 Match con parole chiave globali (vale per tutte le guide JSON)
function findAnswerByKeywords(question, answersForLang) {
  const text = String(question || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;

  // Le chiavi devono corrispondere a quelle dei JSON (wifi, bathroom, gas, AC, transport, emergency, check_in, check_out, ecc.)
  const KEYWORDS = {
    wifi: ["wifi", "wi fi", "internet", "wireless", "password"],
    bathroom: ["bathroom", "toilet", "wc", "restroom"],
    gas: ["gas", "stove", "hob", "cooktop", "fornello"],
    AC: ["ac", "air conditioning", "aircon", "condizionata", "climate"],
    transport: ["bus", "tram", "metro", "subway", "train", "transport", "taxi"],
    emergency: ["emergency", "doctor", "hospital", "ambulance", "help"],
    check_in: ["check in", "check-in", "arrival", "arrive", "come in", "access"],
    check_out: ["check out", "checkout", "leave", "departure"],
    water: ["water", "hot water", "shower"],
  };

  for (const [key, synonyms] of Object.entries(KEYWORDS)) {
    for (const word of synonyms) {
      if (text.includes(word) && answersForLang[key]) {
        return { intent: key, answer: answersForLang[key] };
      }
    }
  }

  return null;
}

/**
 * Endpoint API chiamato dalla Virtual Guide.
 *
 * BODY atteso (JSON):
 * {
 *   "apartment": "arenula" | "leonina" | "ottavia" | "scala" | "trastevere",
 *   "lang": "it" | "en" | "fr" | "de" | "es",
 *   "question": "testo domanda dell'ospite"
 * }
 *
 * Risposta:
 * {
 *   ok: true,
 *   apartment: "...",
 *   language: "it",
 *   intent: "wifi",
 *   answer: "testo da mostrare all'ospite"
 * }
 */
 app.post("/api/guest-assistant", async (req, res) => {
  try {
    const { apartment, lang, question } = req.body || {};

    if (!apartment || !question) {
      return res.status(400).json({
        ok: false,
        error: "missing_params",
        message: "Servono 'apartment' e 'question' nel body."
      });
    }

    const aptKey = String(apartment).toLowerCase();
    const guide = await loadGuideJson(aptKey);

    if (!guide) {
      return res.status(404).json({
        ok: false,
        error: "guide_not_found",
        message: `Nessuna guida JSON trovata per '${aptKey}'.`
      });
    }

    const language = normalizeLang(lang, guide.languages);
    const answersForLang =
      (guide.answers && guide.answers[language]) ||
      guide[language] ||   // fallback vecchia struttura
      {};

    let intentKey = null;
    let answerText = null;

        // 1) (TEMP) salta il match "intents" se non abbiamo findBestIntent
    if (guide.intents && guide.intents[language] && typeof findBestIntent === "function") {
      intentKey = findBestIntent(guide, language, question);
    }
    // 2) Se non abbiamo trovato nulla, prova le parole chiave globali
     if (!answerText) {
  const match = findAnswerByKeywords(question, answersForLang);
  if (match) {
    intentKey = match.intent;   // ✔ CORRETTO
    answerText = match.answer;  // ✔ CORRETTO
  }
     }
    // 3) Se ancora nulla, usa "services" o la prima chiave disponibile
    if (!answerText) {
      if (!intentKey && answersForLang.services) {
        intentKey = "services";
      } else if (!intentKey) {
        const keys = Object.keys(answersForLang);
        if (keys.length > 0) {
          intentKey = keys[0];
        }
      }

      answerText =
        (intentKey && answersForLang[intentKey]) ||
        "I didn’t find a direct answer. Try one of the quick buttons in the guide.";
    }

    return res.json({
      ok: true,
      apartment: guide.apartment || aptKey,
      language,
      intent: intentKey || null,
      answer: answerText
    });
  } catch (err) {
    console.error("❌ Errore /api/guest-assistant:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: "Errore interno nel guest assistant."
    });
  }
});
 // ========= HOSTAWAY AI BRIDGE =========
// Riceve JSON da HostAway e chiama il vero Guest Assistant
app.post("/api/hostaway-ai-bridge", async (req, res) => {
  try {
    // LOG per vedere sempre cosa arriva da HostAway
    console.log("🔔 Hostaway webhook body:");
    console.log(JSON.stringify(req.body, null, 2));

    const payload = req.body || {};

    // 1) Testo del messaggio dell'ospite (nei log si vede come "body")
    const message =
      payload.body ||
      payload.message ||
      (payload.communicationBody && payload.communicationBody.body) ||
      "";

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "missing_message",
        message:
          "Nel JSON non trovo il testo del messaggio (es. campo 'body').",
      });
    }

         // 2) Listing → nome appartamento interno
    const listingId = String(payload.listingMapId || payload.listingId || "");

    // ==== MAPPATURA LISTING → APARTMENT (per il Guest Assistant) ====
const LISTING_TO_APARTMENT = {
  "194162": "scala",       // Scala (Via della Scala 17)
  "194163": "leonina",     // Top floor studio apt with terrace (Via Leonina 71)
  "194164": "trastevere",  // Viale Trastevere 108
  "194165": "portico",     // Portico d'Ottavia 1D
  "194166": "arenula"      // Near Pantheon and Piazza Argentina
};
    // Usa la mappa; se qualcosa non torna, default "arenula"
    const apartment = LISTING_TO_APARTMENT[listingId] || "arenula";

    // 3) Lingua (fallback 'en')
    const languageRaw =
      payload.language || payload.locale || payload.guestLocale || "en";
    const language = String(languageRaw).slice(0, 2).toLowerCase();

    // 4) Nome guest se presente
    const guestName =
      payload.guestName ||
      payload.guest_first_name ||
      payload.firstName ||
      "Guest";

    // 5) CHIAMO IL VERO GUEST ASSISTANT INTERNO
    const url = `${req.protocol}://${req.get("host")}/api/guest-assistant`;

    const aiResponse = await axios.post(
      url,
      {
        apartment,
        language,
        // Il Guest Assistant si aspetta "question"
        question: message,
        guestName,
        source: "hostaway",
      },
      { timeout: 8000 }
    );

    const data = aiResponse.data || {};

    if (!data.ok || !data.answer) {
      console.error("❌ guest-assistant error:", data);
      return res.status(502).json({
        ok: false,
        error: "guest_assistant_failed",
        details: data,
      });
    }

    console.log("✅ AI answer for Hostaway:", data.answer);

    // 6) Risposta finale (per ora solo JSON, HostAway NON la usa ancora)
    return res.json({
      ok: true,
      apartment,
      language,
      question: message,
      answer: data.answer,
    });
  } catch (err) {
    console.error("❌ Errore /api/hostaway-ai-bridge:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err.message,
    });
  }
});
// ========= HEALTH & START =========
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    uptime: process.uptime(),
    baseUrl: SHELLY_BASE_URL,
    tokenVersion: TOKEN_VERSION,
    rotationTag: ROTATION_TAG,
    linkPrefix: LINK_PREFIX,
    startedAt: STARTED_AT,
    revokeBefore: REVOKE_BEFORE
  });
});
// Guest Assistant AI → JSON dinamico (guides-v2)

// ========== NUOVO ENDPOINT: HostAway → Email ospite VRBO ==========

// Per inviare le email sfruttiamo un piccolo ponte (Apps Script o altro servizio Mail)
const MAILER_URL = process.env.MAILER_URL || "https://script.google.com/macros/s/XXXXXXX/exec"; // <-- metterai il tuo URL Apps Script
const MAIL_SHARED_SECRET = process.env.MAIL_SHARED_SECRET || "super-segreto-lungo";

app.post("/hostaway-outbound", async (req, res) => {
  try {
    const { reservationId, guestEmail, guestName, message } = req.body || {};

    if (!guestEmail || !message) {
      console.log("❌ Dati insufficienti per invio email:", req.body);
      return res.status(400).json({ ok: false, error: "missing_email_or_message" });
    }

    const subject = `Messaggio da NiceFlatInRome`;
const htmlBody = `
  <p>Ciao ${guestName || "ospite"},</p>
  <p>${message.replace(/\n/g, "<br>")}</p>
  <p>Un saluto da Michele e dal team NiceFlatInRome.</p>
`;

// Invia la mail passando dal ponte (Apps Script o servizio esterno)
const response = await axios.post(
  `${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
  { to: guestEmail, subject, htmlBody },
  { headers: { "Content-Type": "application/json" }, timeout: 10000 }
);

    if (String(response.data).trim() === "ok") {
      console.log(`📤 Email inviata con successo a ${guestEmail}`);
      return res.json({ ok: true });
    } else {
      console.error("❌ Errore dal mailer:", response.data);
      return res.status(502).json({ ok: false, error: "mailer_failed" });
    }
  } catch (err) {
    console.error("Errore invio email:", err.message);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});
// ------ Pagina di test per inviare un'email di prova ------
app.get("/test-mail", (req, res) => {
  res.type("html").send(`
    <!doctype html><meta charset="utf-8">
    <div style="font-family: system-ui; max-width: 680px; margin: 24px auto;">
      <h2>Test invio email VRBO</h2>
      <form method="post" action="/hostaway-outbound" style="display:grid; gap:8px;">
        <label>Guest email
          <input name="guestEmail" type="email" required style="width:100%;padding:8px">
        </label>
        <label>Guest name
          <input name="guestName" type="text" style="width:100%;padding:8px">
        </label>
        <label>Reservation ID
          <input name="reservationId" type="text" style="width:100%;padding:8px">
        </label>
        <label>Messaggio
          <textarea name="message" rows="6" required style="width:100%;padding:8px">Ciao, confermo il tuo check-in!</textarea>
        </label>
        <button style="padding:10px 16px">Invia</button>
      </form>
    </div>
    <script>
      // trasforma il submit in JSON (il tuo endpoint si aspetta JSON)
      const form = document.querySelector("form");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const resp = await fetch(form.action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data)
        });
        const txt = await resp.text();
        alert("Risposta server:\\n" + txt);
      });
    </script>
  `);
  // ====== VRBO MAILER BRIDGE ======
app.post("/api/vbro-mail", async (req, res) => {
  const { to, subject, body, secret } = req.body;
  if (secret !== process.env.MAIL_SHARED_SECRET)
    return res.status(403).json({ ok: false, error: "Unauthorized" });

  try {
    const response = await axios.post(
      `${process.env.MAILER_URL}?secret=${process.env.MAIL_SHARED_SECRET}`,
      { to, subject, htmlBody: body },
      { headers: { "Content-Type": "application/json" } }
    );
    console.log("📨 Email VRBO inviata con successo", response.status);
    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Errore invio mail:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});
});
// ========== HOSTAWAY → AUTO RISPOSTA AI PER MESSAGGI ==========
app.post("/hostaway-incoming", async (req, res) => {
  try {
    const { listingId, message, guestName, guestEmail, language, conversationId } = req.body || {};

    // 🔐 Controllo dati minimi
    if (!listingId || !message || !guestEmail) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // 🔎 Mappa appartamento con gli ID REALI (solo per info umana nel log / risposta)
    const LISTINGS = {
      194166: "Via Arenula 16",
      194164: "Via della Scala 17",
      194165: "Portico d'Ottavia 1D",
      194167: "Viale Trastevere 108",
      194168: "Via Leonina 71"
    };
    const apt = LISTINGS[listingId] || "Appartamento";

    // 🔐 Mappa LISTING → chiave usata dalla Virtual Guide
const LISTING_TO_APARTMENT = {
  "194166": "arenula",
  "194164": "scala",
  "194165": "ottavia",   // <-- CAMBIATA QUI
  "194167": "trastevere",
  "194168": "leonina"
};
    const listingStr = String(listingId);
    const apartmentKey = LISTING_TO_APARTMENT[listingStr] || "arenula";

    // 🌍 Normalizzo lingua (it/en/fr/de/es) per la Virtual Guide
    const langCode = String(language || "en").slice(0, 2).toLowerCase();

    // 🧠 Chiamo la Virtual Guide interna /api/guest-assistant
    let aiReply = "Errore interno. Posso risponderti a breve.";
    try {
      const url = `${req.protocol}://${req.get("host")}/api/guest-assistant`;

      const aiResp = await axios.post(
        url,
        {
          apartment: apartmentKey,
          lang: langCode,
          question: message
        },
        { timeout: 8000 }
      );

      const data = aiResp.data || {};
      if (data.ok && data.answer) {
        aiReply = data.answer;
        // === INVIA RISPOSTA AL GUEST SU HOSTAWAY ===
// Serve conversationId dal webhook:
const { conversationId } = req.body || {};

if (conversationId) {
  try {
    await axios.post(
      "https://api.hostaway.com/v1/conversations/sendMessage",
      {
        conversationId,
        message: aiReply,
        type: "guest" // oppure "email" per forzare email
      },
      {
        headers: {
          "Authorization": `Bearer ${process.env.HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );
    console.log("📨 Messaggio AI inviato su HostAway!");
  } catch (err) {
    console.error("❌ ERRORE invio su HostAway:", err.message);
  }
}
      } else {
        console.error("guest-assistant risposta non valida:", data);
      }
    } catch (err) {
      console.error("❌ Errore chiamata /api/guest-assistant:", err.message);
    }
    // 7) INVIO EMAIL AUTOMATICO AL GUEST
try {
  const subject = `NiceFlatInRome – ${apt}`;
  const htmlBody = `
    <p>Ciao ${guestName || "ospite"},</p>
    <p>${aiReply.replace(/\n/g, "<br>")}</p>
    <p><strong>Guest question:</strong> ${message || ''}</p>
    <!-- ITALIANO -->
<p>
  Se il problema non è risolto, contattami al
  <strong>+39 335 5245 756 (Michele)</strong> oppure al
  <strong>+39 347 784 7205 (Marco)</strong>, oppure via e-mail a
  <a href="mailto:info@niceflatinrome.com">info@niceflatinrome.com</a>.
</p>

<!-- ENGLISH -->
<p>
  If the problem is not solved, please contact me at
  <strong>+39 335 5245 756 (Michele)</strong> or
  <strong>+39 347 784 7205 (Marco)</strong>, or by e-mail at
  <a href="mailto:info@niceflatinrome.com">info@niceflatinrome.com</a>.
</p>

<!-- FRANÇAIS -->
<p>
  Si le problème n’est pas résolu, veuillez me contacter au
  <strong>+39 335 5245 756 (Michele)</strong> ou au
  <strong>+39 347 784 7205 (Marco)</strong>, ou par e-mail à
  <a href="mailto:info@niceflatinrome.com">info@niceflatinrome.com</a>.
</p>

<!-- DEUTSCH -->
<p>
  Wenn das Problem nicht gelöst ist, kontaktieren Sie mich bitte unter
  <strong>+39 335 5245 756 (Michele)</strong> oder
  <strong>+39 347 784 7205 (Marco)</strong> oder per E-Mail an
  <a href="mailto:info@niceflatinrome.com">info@niceflatinrome.com</a>.
</p>

<!-- ESPAÑOL -->
<p>
  Si el problema no está resuelto, por favor contáctame al
  <strong>+39 335 5245 756 (Michele)</strong> o al
  <strong>+39 347 784 7205 (Marco)</strong>, o por correo electrónico en
  <a href="mailto:info@niceflatinrome.com">info@niceflatinrome.com</a>.
</p>
    <p>Un saluto da Michele e dal team NiceFlatInRome.</p>
  `;

 await axios.post(
  `${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
  {
    to: "mikbondi@gmail.com",           // tua email in copia
    subject: `Copia risposta al guest – ${apt}`,
    htmlBody: `
      <p>Hai inviato automaticamente questa risposta al guest:</p>
      <p><strong>Guest:</strong> ${guestName} (${guestEmail})</p>
      <p><strong>Domanda:</strong> ${message}</p>
      <p><strong>Risposta inviata:</strong></p>
      <p>${aiReply.replace(/\n/g, "<br>")}</p>
    `
  },
  { headers: { "Content-Type": "application/json" }, timeout: 10000 }
  );

      console.log("📤 Email automatica inviata a", guestEmail);
    } catch (err) {
      console.error("❌ Errore invio email automatica:", err.message);
    }
    // 🔙 Risposta JSON finale (per ora niente email, solo test)
    return res.json({
      ok: true,
      apartment: apt,
      language: langCode,
      aiReply,
      guestName,
      guestEmail
});
  } catch (err) {
    console.error("❌ ERRORE HOSTAWAY:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(
    "Server running on", PORT,
    "TZ:", TIMEZONE,
    "TokenVer:", TOKEN_VERSION,
    "RotationTag:", ROTATION_TAG,
    "LinkPrefix:", LINK_PREFIX,
    "StartedAt:", STARTED_AT,
    "RevokeBefore:", REVOKE_BEFORE || "-",
    "AllowTodayFallback:", ALLOW_TODAY_FALLBACK ? "1" : "0"
  );
});
