import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import bodyParser from "body-parser";
import { matchIntent } from "./matcher.js";
import { detectLanguage } from "./language.js";
import { ANSWERS } from "./answers.js";
import { askGemini } from "./gemini.js";
import nodemailer from "nodemailer";
 const SAFE_FALLBACK_REPLY =
  "Thank you for your message. We’ve received your request and we’ll get back to you as soon as possible.";
const app = express();

app.use(bodyParser.json({ limit: "100kb" }));
app.disable("x-powered-by");
app.set("trust proxy", true);
  // ========================================================================
// ARRIVAL SLOT DECIDER — SAFE, NON ROMPE NULLA
// ========================================================================
function decideSlots(arrivalTime) {
  if (!arrivalTime || !arrivalTime.includes(":")) {
    return ["11", "18", "2030", "2330"];
  }

  const [h, m] = arrivalTime.split(":").map(Number);
  const minutes = h * 60 + m;

  if (minutes <= 12 * 60) {
    return ["11", "18", "2030", "2330"];
  }

  if (minutes <= 16 * 60) {
    return ["18", "2030", "2330"];
  }

  if (minutes <= 19 * 60) {
    return ["2030", "2330"];
  }

  return ["2330"];
}

 function slotToDate(slot, checkInDate) {
  const hours = slot.length === 2 ? Number(slot) : Number(slot.slice(0, 2));
  const minutes = slot.length === 2 ? 0 : Number(slot.slice(2));

  const target = new Date(checkInDate);
  target.setHours(hours, minutes, 0, 0);

  return target;
}



// ========================================================================
// SLOT SCHEDULER — PRODUZIONE (UNICO)
// ========================================================================

const SLOT_JOBS = new Map();

 function scheduleSlotMessages({
  reservationId,
  conversationId,
  apartment,
  slots,
  sendFn,
  checkInDate
}) {
    console.log("🔍 scheduleSlotMessages chiamata:", { reservationId, conversationId, apartment, slots, checkInDate });

  if (!reservationId || !conversationId || !Array.isArray(slots) || !checkInDate) return;

   slots.forEach(slot => {
    const when = slotToDate(slot, checkInDate);
    const delay = when.getTime() - Date.now();
    if (delay <= 0) {
      console.log("⏭️ Slot già passato, ignorato:", slot, when.toISOString());
      return;
    }
    if (delay > 86400000) {
      console.log("⏭️ Slot troppo lontano, ignorato:", slot, when.toISOString());
      return;
    }

    const key = `${reservationId}-${slot}`;
    if (SLOT_JOBS.has(key)) return;

    const timer = setTimeout(async () => {
      try {
        await sendFn({ conversationId, apartment, slot });
        console.log("📨 Slot inviato:", apartment, slot);
      } catch (e) {
        console.error("❌ Errore slot", slot, e.message);
      }
      SLOT_JOBS.delete(key);
    }, delay);

    SLOT_JOBS.set(key, timer);
    console.log("⏰ Slot schedulato:", apartment, slot, "per", when.toISOString());
  });
}


 // ========================================================================
// METEO — RAIN DETECTION (ROMA)
// ========================================================================
const ROME_LAT = 41.9028;
const ROME_LON = 12.4964;

async function isRainingToday() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${ROME_LAT}&lon=${ROME_LON}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`;
    const { data } = await axios.get(url, { timeout: 8000 });

    const nextHours = data.list.slice(0, 4);
    return nextHours.some(item =>
      item.weather.some(w =>
        ["Rain", "Drizzle", "Thunderstorm"].includes(w.main)
      )
    );
  } catch (err) {
    console.error("☔ METEO ERROR → fallback asciutto", err.message);
    return false;
  }
}

   async function sendSlotLiveMessage({ conversationId, apartment, slot, lang = "en" }) {
  const baseUrlMap = {
    arenula: "/portico",
    leonina: "/monti",
    portico: "/portico",
    scala: "/scala",
    trastevere: "/viale-trastevere"
  };

  const choiceMap = {
    "11": "passeggiata",
    "18": "aperitivo",
    "2030": "passeggiata",
    "2330": "dormire"
  };

  const textMap = {
    it: "Scopri cosa fare ora:",
    en: "Discover what to do now:",
    fr: "Découvrez quoi faire maintenant:",
    es: "Descubre qué hacer ahora:",
    de: "Entdecke, was du jetzt tun kannst:"
  };

  const base = baseUrlMap[apartment];
  const choice = choiceMap[slot];
  const text = textMap[lang] || textMap.en;
  
  if (!base || !choice) return;

  const message =
    `🕒 ${slot}\n` +
    `${text}\n` +
    `${process.env.BASE_URL}${base}?slot=${slot}&choice=${choice}`;

  await sendHostawayMessage({
    conversationId,
    message
  });
}



// ========================================================================
// ARRIVAL TIME WEBHOOK — HostAway
// ========================================================================

app.post("/arrival-time", async (req, res) => {
  try {
    const payload = req.body;

    // sicurezza minima
    if (!payload || !payload.reservation) {
      return res.status(400).send("No reservation data");
    }

    const reservationId = payload.reservation.id;
    const arrivalTime = payload.reservation.arrivalTime; // es: "15:30"

    if (!arrivalTime) {
      console.log("⏰ Arrival time missing for reservation", reservationId);
      return res.status(200).send("No arrival time");
    }

    // usa la funzione che abbiamo già messo
    const slots = decideSlots(arrivalTime);

    console.log("📥 ARRIVAL TIME RECEIVED");
    console.log("Reservation:", reservationId);
    console.log("Arrival time:", arrivalTime);
    console.log("Scheduled slots:", slots);

    // per ora NON inviamo nulla
    // nel passo 3 useremo questi slot per schedulare i messaggi

    res.status(200).send("Arrival time processed");
  } catch (err) {
    console.error("❌ ARRIVAL TIME ERROR", err);
    res.status(500).send("Server error");
  }
});
 

app.use((req, res, next) => {
  if (req.url.includes("/feedback")) {
    console.log("HIT FEEDBACK RAW", req.method, req.headers["content-type"]);
  }
  next();
});

app.options("/feedback", cors());

app.post("/feedback", cors(), async (req, res) => {
  console.log("FEEDBACK ARRIVATO", req.body);
  try {
    await fetch("https://script.google.com/macros/s/AKfycbwut-C1NoqZAxAPKFQO_JVb_O5mPbEYjCVTVecWiSOMgJ31GCtiQjNPHOnQI3h5KZsy/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("ERRORE FEEDBACK â APPS SCRIPT", err);
    res.status(500).json({ ok: false });
  }
});

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
};

const corsMw = cors(corsOptions);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const SHELLY_API_KEY  = process.env.SHELLY_API_KEY;
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET    = process.env.TOKEN_SECRET;
const HOSTAWAY_TOKEN  = process.env.HOSTAWAY_TOKEN;
const HOSTAWAY_WEBHOOK_BOOKING_SECRET = process.env.HOSTAWAY_WEBHOOK_BOOKING_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error("â Missing ADMIN_SECRET env var");
  process.exit(1);
}

function requireAdmin(req, res, next) {
  const h = req.get("x-admin-secret") || "";
  if (!safeEqual(h, ADMIN_SECRET)) {
    return res.status(403).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

console.log("ð¥ Hostaway token caricato:", HOSTAWAY_TOKEN ? "OK" : "MANCANTE");

if (!HOSTAWAY_TOKEN) {
  console.error("â Missing HOSTAWAY_TOKEN env var (risposte automatiche HostAway disattivate).");
}

if (!HOSTAWAY_WEBHOOK_BOOKING_SECRET) {
  console.error("â Missing HOSTAWAY_WEBHOOK_BOOKING_SECRET env var.");
}

if (!TOKEN_SECRET) {
  console.error("â Missing TOKEN_SECRET env var");
  process.exit(1);
}

const TIMEZONE = process.env.TIMEZONE || "Europe/Rome";
const ALLOW_TODAY_FALLBACK = process.env.ALLOW_TODAY_FALLBACK === "1";
const ROTATION_TAG   = "R-2025-09-18-final";
const TOKEN_VERSION  = 100;
const LINK_PREFIX    = "/k3";
const SIGNING_SECRET = `${TOKEN_SECRET}|${ROTATION_TAG}`;
const REVOKE_BEFORE  = parseInt(process.env.REVOKE_BEFORE || "0", 10);
const STARTED_AT     = Date.now();
const DEFAULT_WINDOW_MIN = parseInt(process.env.WINDOW_MIN || "15", 10);
const DEFAULT_MAX_OPENS  = parseInt(process.env.MAX_OPENS  || "2", 10);
const GUIDE_WINDOW_MIN   = 1440;
const CHECKIN_WINDOW_MIN = 1440;

const GUIDE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https://script.google.com https://shelly-cloud-opener-1.onrender.com",
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

const TARGETS = {
  "arenula-building": { name: "Arenula 16 â Building Door", ids: ["3494547ab05e"] },
  "leonina-door": { name: "Leonina 71 â Apartment Door", ids: ["3494547a9395"] },
  "leonina-building": { name: "Via Leonina 71 â Building Door", ids: ["34945479fbbe"] },
  "via-della-scala-door": { name: "Via della Scala 17 â Apartment Door", ids: ["3494547a1075"] },
  "via-della-scala-building": { name: "Via della Scala 17 â Building Door", ids: ["3494547745ee", "3494547745ee"] },
  "portico-1d-door": { name: "Portico d'Ottavia 1D â Apartment Door", ids: ["2cbcbb2f8ae8"] },
  "portico-1d-building": { name: "Portico d'Ottavia 1D â Building Door", ids: ["2cbcbb30fb90"] },
  "viale-trastevere-door": { name: "Viale Trastevere 108 â Apartment Door", ids: ["34945479fa35"] },
  "viale-trastevere-building": { name: "Building Door", ids: ["34945479fd73"] },
};

const RELAY_CHANNEL = 0;

async function shellyTurnOn(deviceId) {
  const form = new URLSearchParams({ id: deviceId, auth_key: SHELLY_API_KEY, channel: String(RELAY_CHANNEL), turn: "on" });
  try {
    const { data } = await axios.post(`${SHELLY_BASE_URL}/device/relay/control`, form.toString(), 
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 7000 });
    if (data && data.isok) return { ok: true, data };
    return { ok: false, status: 400, data };
  } catch (err) {
    return { ok: false, status: err?.response?.status || 500, data: err?.response?.data || String(err) };
  }
}

async function openOne(deviceId) {
  const first = await shellyTurnOn(deviceId);
  return first.ok ? { ok: true, first } : { ok: false, first };
}

async function openSequence(ids, delayMs = 10000) {
  const logs = [];
  for (let i = 0; i < ids.length; i++) {
    const r = await openOne(ids[i]);
    logs.push({ step: i + 1, device: ids[i], ...r });
    if (i < ids.length - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  return { ok: logs.every(l => l.ok), logs };
}

function b64urlToBuf(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hmac(str) {
  return b64url(crypto.createHmac("sha256", SIGNING_SECRET).update(String(str)).digest());
}

function makeToken(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = hmac(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}
function safeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
function parseToken(token) {
  const [h, b, s] = (token || "").split(".");
  if (!h || !b || !s) return { ok: false, error: "bad_format" };
  const sig = hmac(`${h}.${b}`);
  if (!safeEqual(sig, s)) return { ok: false, error: "bad_signature" };
  let payload;
  try {
    payload = JSON.parse(b64urlToBuf(b).toString("utf8"));
  } catch {
    return { ok: false, error: "bad_payload" };
  }
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

const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const TODAY_LOCK = new Map();
const OPEN_USAGE = new Map();

function usageKey(p) {
  return `${p.tgt}:${p.jti}`;
}

function getUsage(p) {
  const key = usageKey(p);
  const u = OPEN_USAGE.get(key);
  if (u && u.exp && Date.now() > u.exp) {
    OPEN_USAGE.delete(key);
    return { count: 0, exp: p.exp };
  }
  return u || { count: 0, exp: p.exp };
}

function tzToday() {
  return fmtDay.format(new Date());
}

function isYYYYMMDD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

const MONTHS_MAP = (() => {
  const m = new Map();
  ["january","february","march","april","may","june","july","august","september","october","november","december"]
    .forEach((n, i) => m.set(n, i + 1));
  ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"]
    .forEach((n, i) => m.set(n, i + 1));
  [["gennaio","gen"],["febbraio","feb"],["marzo","mar"],["aprile","apr"],["maggio","mag"],["giugno","giu"],
   ["luglio","lug"],["agosto","ago"],["settembre","set"],["ottobre","ott"],["novembre","nov"],["dicembre","dic"]]
    .forEach(([full, short], i) => { m.set(full, i + 1); m.set(short, i + 1); });
  [["enero","ene"],["febrero","feb"],["marzo","mar"],["abril","abr"],["mayo","may"],["junio","jun"],
   ["julio","jul"],["agosto","ago"],["septiembre","sep"],["octubre","oct"],["noviembre","nov"],["diciembre","dic"]]
    .forEach(([full, short], i) => { m.set(full, i + 1); m.set(short, i + 1); });
  [["janvier","jan"],["fÃ©vrier","fevrier"],["mars","mar"],["avril","avr"],["mai","mai"],["juin","juin"],
   ["juillet","juillet"],["aoÃ»t","aout"],["septembre","sep"],["octobre","oct"],["novembre","nov"],["dÃ©cembre","decembre"]]
    .forEach(([full, short], i) => { 
      const f = full.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const s = short.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      m.set(f, i + 1); m.set(s, i + 1);
    });
  [["januar","jan"],["februar","feb"],["mÃ¤rz","marz"],["april","apr"],["mai","mai"],["juni","jun"],
   ["juli","jul"],["august","aug"],["september","sep"],["oktober","okt"],["november","nov"],["dezember","dez"]]
    .forEach(([full, short], i) => { 
      const f = full.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const s = short.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      m.set(f, i + 1); m.set(s, i + 1);
    });
  return m;
})();

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function normalizeCheckinDate(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const sClean = s.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(sClean)) return sClean;
  let m = sClean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  m = sClean.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10), monName = m[2], y = parseInt(m[3], 10), mo = MONTHS_MAP.get(monName);
    if (mo && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  return null;
}

function pageCss() {
  return `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}
.wrap{max-width:680px}h1{font-size:28px;margin:0 0 8px}p{color:#444}
button{font-size:18px;padding:10px 18px;border:1px solid #333;border-radius:8px;background:#fff;cursor:pointer}
.muted{color:#777;font-size:14px;margin-top:14px}.ok{color:#0a7b34}.err{color:#b21a1a;white-space:pre-wrap}.hidden{display:none}`;
}

function landingHtml(targetKey, targetName, tokenPayload) {
  const remaining = Math.max(0, (tokenPayload?.max || 0) - (tokenPayload?.used || 0));
  const expInSec = Math.max(0, Math.floor((tokenPayload.exp - Date.now()) / 1000));
  const day = tokenPayload.day || "-";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${targetName}</title><style>${pageCss()}</style></head><body><div class="wrap">
<h1>${targetName}</h1><p class="muted">Valido solo nel giorno di check-in: <b>${day}</b> (${TIMEZONE})</p>
<button id="btn">Apri</button>
<div class="muted" id="hint">Max ${tokenPayload.max} aperture entro ${DEFAULT_WINDOW_MIN} minuti Â· residuo: <b id="left">${remaining}</b> Â· scade tra <span id="ttl">${expInSec}</span>s</div>
<p class="ok hidden" id="okmsg">â Apertura inviata.</p><pre class="err hidden" id="errmsg"></pre>
<script>const btn=document.getElementById('btn'),okmsg=document.getElementById('okmsg'),errmsg=document.getElementById('errmsg'),
leftEl=document.getElementById('left'),ttlEl=document.getElementById('ttl');let ttl=${expInSec};
setInterval(()=>{if(ttl>0){ttl--;ttlEl.textContent=ttl;}},1000);
btn.addEventListener('click',async ()=>{btn.disabled=true;okmsg.classList.add('hidden');errmsg.classList.add('hidden');
try{const res=await fetch(window.location.pathname+'/open',{method:'POST'});const j=await res.json();
if(j.ok){okmsg.classList.remove('hidden');if(typeof j.remaining==='number'){leftEl.textContent=j.remaining;}
if(j.nextUrl){try{history.replaceState(null,'',j.nextUrl);}catch(_){}}}else{errmsg.textContent=JSON.stringify(j,null,2);
errmsg.classList.remove('hidden');}}catch(e){errmsg.textContent=String(e);errmsg.classList.remove('hidden');}
finally{btn.disabled=false;}});</script></div></body></html>`;
}

app.get("/", requireAdmin, (req, res) => {
  const rows = Object.entries(TARGETS).map(([key, t]) => {
    const ids = t.ids.join(", ");
    return `<tr><td>${t.name}</td><td><code>${ids}</code></td><td><a href="/token/${key}">Crea link</a></td>
<td><form method="post" action="/api/open-now/${key}" style="display:inline"><button>Manual Open</button></form></td></tr>`;
  }).join("\n");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"/><style>
body{font-family:system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px 12px}
</style><title>Door & Gate Opener</title></head><body><h1>Door & Gate Opener</h1>
<p>Link firmati temporanei e apertura manuale.</p>
<table><thead><tr><th>Nome</th><th>Device ID</th><th>Smart Link</th><th>Manual Open</th></tr></thead>
<tbody>${rows}</tbody></table><p class="muted">Shard fallback: <code>${SHELLY_BASE_URL}</code></p></body></html>`);
});

app.get("/token/:target", requireAdmin, (req, res) => {
  const targetKey = req.params.target, target = TARGETS[targetKey];
  if (!target) return res.status(404).json({ ok: false, error: "unknown_target" });
  const windowMin = parseInt(req.query.mins || DEFAULT_WINDOW_MIN, 10);
  const maxOpens = parseInt(req.query.max  || DEFAULT_MAX_OPENS, 10);
  const { token, payload } = newTokenFor(targetKey, { windowMin, max: maxOpens, used: 0 });
  const url = `${req.protocol}://${req.get("host")}${LINK_PREFIX}/${targetKey}/${token}`;
  return res.json({ ok: true, url, expiresInMin: Math.round((payload.exp - Date.now()) / 60000) });
});

app.all("/k/:target/:token", (req, res) => res.status(410).send("Link non piÃ¹ valido."));
app.all("/k/:target/:token/open", (req, res) => res.status(410).json({ ok: false, error: "gone" }));
app.all("/k2/:target/:token", (req, res) => res.status(410).send("Link non piÃ¹ valido."));
app.all("/k2/:target/:token/open", (req, res) => res.status(410).json({ ok: false, error: "gone" }));

app.get(`${LINK_PREFIX}/:target/:token`, (req, res) => {
  const { target, token } = req.params, targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");
  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = ["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error) ? 410 : 400;
    const msg = parsed.error === "bad_signature" ? "Link non piÃ¹ valido (firma)." :
      parsed.error === "bad_version" ? "Link non piÃ¹ valido." :
      parsed.error === "revoked" ? "Link revocato." :
      parsed.error === "revoked_boot" ? "Link revocato (riavvio sistema)." : "Invalid link";
    return res.status(code).send(msg);
  }
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).send("Invalid link");
  if (Date.now() > p.exp) return res.status(400).send("Link scaduto");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.type("html").send(landingHtml(target, targetDef.name, p));
});

app.post(`${LINK_PREFIX}/:target/:token/open`, async (req, res) => {
  const { target, token } = req.params, targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = ["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error) ? 410 : 400;
    return res.status(code).json({ ok: false, error: parsed.error });
  }
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok: false, error: "target_mismatch" });
  if (Date.now() > p.exp) return res.status(400).json({ ok: false, error: "expired" });
  if (p.day && isYYYYMMDD(p.day) && p.day !== tzToday()) return res.status(410).json({ ok: false, error: "wrong_day" });
  const max = Number(p.max || 0), u = getUsage(p);
  if (max > 0 && u.count >= max) return res.status(429).json({ ok: false, error: "max_opens_reached" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  const newCount = (max > 0) ? (u.count + 1) : u.count;
  OPEN_USAGE.set(usageKey(p), { count: newCount, exp: p.exp });
  const remaining = (max > 0) ? Math.max(0, max - newCount) : null;
  return res.json({ ok: true, remaining, opened: result });
});

app.all("/api/open-now/:target", requireAdmin, (req, res) => {
  const targetKey = req.params.target, targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).send("Unknown target");
  const { token } = newTokenFor(targetKey, { windowMin: DEFAULT_WINDOW_MIN, max: DEFAULT_MAX_OPENS, used: 0 });
  return res.redirect(302, `${LINK_PREFIX}/${targetKey}/${token}`);
});

app.use("/guides", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
app.use("/guides-v2", express.static(path.join(PUBLIC_DIR, "guides-v2"), { fallthrough: false }));
app.use("/public-test-ai-html", express.static(path.join(PUBLIC_DIR, "public-test-ai-html"), { fallthrough: false }));
 
app.get("/checkin/:apt/today", (req, res) => {
  const apt = req.params.apt.toLowerCase(), today = tzToday();
  const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day: today });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  return res.redirect(302, url);
});

app.get("/checkin/:apt/:rawDate([^/.]+)", (req, res) => {
  const apt = req.params.apt.toLowerCase(), today = tzToday();
  const raw = String(req.params.rawDate || "");
  let day = normalizeCheckinDate(raw);
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) day = today;
    else return res.status(410).send("Link scaduto.");
  }
  if (day !== today) return res.status(410).send("Link scaduto.");
  const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});

app.get("/checkin/:apt/", (req, res) => {
  const apt = req.params.apt.toLowerCase(), today = tzToday();
  const raw = (req.query.d || "").toString();
  let day = normalizeCheckinDate(raw);
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) day = today;
    else return res.status(410).send("Link scaduto.");
  }
  if (day !== today) return res.status(410).send("Link scaduto.");
  if (day !== today) return res.status(410).send("Questo link Ã¨ valido solo nel giorno di check-in.");
  const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});

app.get("/checkin/:apt/index.html", (req, res) => {
  try {
    const apt = req.params.apt.toLowerCase(), t = String(req.query.t || "");
    const parsed = parseToken(t);
    if (!parsed.ok) return res.status(410).send("Questo link non Ã¨ piÃ¹ valido.");
    const p = parsed.payload || {};
    if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).send("Questo link Ã¨ scaduto. Richiedi un nuovo link.");
    const { tgt, day } = p;
    if (tgt !== `checkin-${apt}`) return res.status(410).send("Link non valido.");
    if (!isYYYYMMDD(day) || day !== tzToday()) return res.status(410).send("Questo link Ã¨ valido solo nel giorno di check-in.");
    const filePath = path.join(PUBLIC_DIR, "checkin", apt, "index.html");
    return res.sendFile(filePath, (err) => {
      if (err) {
        console.error("â sendFile error:", { filePath, code: err.code, message: err.message });
        if (!res.headersSent) return res.status(err.statusCode || 404).send("Check-in page missing on server.");
      }
    });
  } catch (e) {
    console.error("â /checkin/:apt/index.html crashed:", e);
    return res.status(500).send("Internal Server Error");
  }
});

function requireCheckinToken(req, res, next) {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  const parsed = parseToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload || {};
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  const { tgt, day } = p;
  if (tgt !== `checkin-${apt}`) return res.status(410).json({ ok: false, error: "token_target_mismatch" });
  if (!isYYYYMMDD(day) || day !== tzToday()) return res.status(410).json({ ok: false, error: "wrong_day" });
  next();
}

app.post("/checkin/:apt/open/building", requireCheckinToken, async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const map = {
    arenula: "arenula-building",
    leonina: "leonina-building",
    scala: "via-della-scala-building",
    portico: "portico-1d-building",
    trastevere: "viale-trastevere-building"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});

app.post("/checkin/:apt/open/door", requireCheckinToken, async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const map = {
    arenula: "arenula-door",
    leonina: "leonina-door",
    scala: "via-della-scala-door",
    portico: "portico-1d-door",
    trastevere: "viale-trastevere-door"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});

app.use("/checkin", express.static(path.join(PUBLIC_DIR, "checkin"), { fallthrough: false }));
 // ========================================================================
// MONTI LIVE — SLOT GIORNALIERI MULTILINGUA
// Lingue: it, en, fr, es, de
// ========================================================================

const MONTI_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata leggera",
        text: "È il momento perfetto per uscire senza fretta.\nFai due passi tra Via Leonina e Via del Boschetto, guarda le botteghe che aprono e prenditi il quartiere con calma.\nMonti la mattina è autentica e silenziosa."
      },
      caffe: {
        title: "☕ Caffè e pausa",
        text: "Siediti per un caffè fatto bene.\nUn tavolino, un cornetto se ti va, e nessun programma.\nRoma a quest’ora non corre."
      },
      rientro: {
        title: "🏠 Rientro breve",
        text: "Se preferisci, rientra.\nSistema le tue cose, una doccia veloce, poi esci quando ti senti pronto.\nMonti è lì, non scappa."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo vicino",
        text: "Se vuoi fare pochissima strada, vai in Piazza della Madonna dei Monti.\nSiediti ai tavolini, ordina un calice o uno spritz e guarda il quartiere che si accende piano piano."
      },
      sedersi: {
        title: "🪑 Sedersi e guardare",
        text: "Prenditi una pausa vera.\nSiediti in piazza o lungo una via laterale, senza meta.\nA Monti alle 18 non serve fare nulla."
      },
      rientro: {
        title: "🏠 Rientro breve",
        text: "Se sei stanco davvero, rientra.\nDoccia, silenzio, magari un po’ di musica.\nTra poco Roma riparte."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Cena senza stress",
        text: "È l’ora giusta per cena.\nA Monti puoi mangiare bene senza formalità.\nEntra dove ti ispira, resta quanto vuoi."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Fai due passi verso i Fori Imperiali.\nLa luce cambia, la città rallenta.\nRoma di sera è tutta qui."
      },
      rientro: {
        title: "🏠 Serata tranquilla",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery e riposo.\nDomani si ricomincia."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va un’ultima uscita, Monti di notte è discreta.\nUn drink tranquillo, poche parole.\nPoi rientro senza fretta."
      },
      silenzio: {
        title: "🌌 Silenzio",
        text: "Le strade si svuotano.\nIl quartiere riposa.\nÈ un buon momento per fermarsi."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nRoma domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Easy walk",
        text: "Perfect time to step out slowly.\nWalk around Via Leonina and Via del Boschetto, watch the shops open and enjoy the neighborhood.\nMorning Monti is quiet and authentic."
      },
      caffe: {
        title: "☕ Coffee break",
        text: "Sit down for a good coffee.\nNo plans, no rush.\nRome moves slowly at this hour."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back inside.\nQuick shower, unpack a bit.\nMonti will wait for you."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo nearby",
        text: "Go to Piazza della Madonna dei Monti.\nSit outside, order a drink and watch the area come alive."
      },
      sedersi: {
        title: "🪑 Sit and watch",
        text: "Take a real break.\nSit anywhere, no destination.\nAt 6 pm Monti doesn’t ask for plans."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you’re tired, go back.\nShower, quiet time.\nThe evening will come naturally."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Dinner",
        text: "It’s dinner time.\nMonti offers relaxed places with good food.\nNo rush, no dress code."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the Imperial Fora.\nLights change, the city slows down.\nPure Rome."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nLight dinner and rest.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you want, Monti at night is calm and charming.\nOne last drink, then home."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "Streets empty.\nThe neighborhood sleeps.\nTime to stop."
      },
      dormire: {
        title: "😴 Sleep",
        text: "Close the day.\nRest well.\nRome is still here tomorrow."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: {
        title: "☀️ Promenade tranquille",
        text: "Moment parfait pour sortir sans se presser.\nPromène-toi autour de Via Leonina.\nMonti le matin est calme et vrai."
      },
      caffe: {
        title: "☕ Pause café",
        text: "Installe-toi pour un bon café.\nSans programme.\nRome ralentit à cette heure."
      },
      rientro: {
        title: "🏠 Retour",
        text: "Si tu préfères, rentre.\nDouche rapide, repos.\nMonti t’attend."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Apéritif",
        text: "Va à la Piazza della Madonna dei Monti.\nUn verre et regarde la vie passer."
      },
      sedersi: {
        title: "🪑 S’asseoir",
        text: "Prends une vraie pause.\nSans but.\nMonti suffit."
      },
      rientro: {
        title: "🏠 Retour",
        text: "Si tu es fatigué, rentre.\nCalme et silence."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Dîner",
        text: "C’est l’heure du dîner.\nRestaurants simples et bons.\nSans stress."
      },
      passeggiata: {
        title: "🌙 Promenade",
        text: "Marche vers les Forums.\nRome ralentit."
      },
      rientro: {
        title: "🏠 Soirée calme",
        text: "Reste à la maison.\nRepos mérité."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Dernier verre",
        text: "Un dernier verre si tu veux.\nPuis retour tranquille."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "Le quartier dort.\nMoment de calme."
      },
      dormire: {
        title: "😴 Dormir",
        text: "Bonne nuit.\nRome demain."
      }
    }
  },

  es: {
    "11": {
      passeggiata: {
        title: "☀️ Paseo tranquilo",
        text: "Momento perfecto para salir sin prisa.\nMonti por la mañana es auténtico."
      },
      caffe: {
        title: "☕ Café",
        text: "Siéntate y disfruta.\nRoma va despacio."
      },
      rientro: {
        title: "🏠 Volver",
        text: "Si prefieres, regresa.\nDescansa un poco."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo",
        text: "Plaza Madonna dei Monti.\nUna copa y nada más."
      },
      sedersi: {
        title: "🪑 Sentarse",
        text: "Pausa real.\nSin destino."
      },
      rientro: {
        title: "🏠 Volver",
        text: "Ducha, calma."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Cena",
        text: "Hora de cenar.\nSin estrés."
      },
      passeggiata: {
        title: "🌙 Paseo",
        text: "Camina hacia los Foros."
      },
      rientro: {
        title: "🏠 Noche tranquila",
        text: "Descanso."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Última copa",
        text: "Una última si te apetece."
      },
      silenzio: {
        title: "🌌 Silencio",
        text: "Todo se calma."
      },
      dormire: {
        title: "😴 Dormir",
        text: "Buen descanso."
      }
    }
  },

  de: {
    "11": {
      passeggiata: {
        title: "☀️ Ruhiger Spaziergang",
        text: "Perfekte Zeit ohne Eile.\nMonti ist morgens still."
      },
      caffe: {
        title: "☕ Kaffee",
        text: "Setz dich.\nRom ist langsam."
      },
      rientro: {
        title: "🏠 Zurück",
        text: "Wenn du willst, geh zurück.\nKurze Pause."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitif",
        text: "Piazza Madonna dei Monti.\nEin Glas genügt."
      },
      sedersi: {
        title: "🪑 Sitzen",
        text: "Einfach da sein."
      },
      rientro: {
        title: "🏠 Zurück",
        text: "Ruhe und Pause."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Abendessen",
        text: "Zeit zum Essen.\nGanz entspannt."
      },
      passeggiata: {
        title: "🌙 Abendspaziergang",
        text: "Zu den Foren gehen."
      },
      rientro: {
        title: "🏠 Ruhiger Abend",
        text: "Erholung."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Letztes Glas",
        text: "Wenn du willst, noch eins."
      },
      silenzio: {
        title: "🌌 Stille",
        text: "Alles schläft."
      },
      dormire: {
        title: "😴 Schlafen",
        text: "Gute Nacht."
      }
    }
  }
};
// ========================================================================
// PORTICO LIVE — VIA DEL PORTICO D’OTTAVIA
// TEMPLATE DEFINITIVO PER TUTTE LE LIVE
// ========================================================================

const PORTICO_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata lenta",
        text: "La mattina qui è speciale.\nFai due passi tra Via del Portico d’Ottavia e Piazza Costaguti.\nIl quartiere si sveglia piano, senza rumore."
      },
      dolce: {
        title: "🥐 Qualcosa di dolce",
        text: "Fermati da Pasticceria Boccione.\nPizza ebraica o torta ricotta e visciole.\nSi mangia in piedi, come una volta."
      },
      rientro: {
        title: "🏠 Rientro tranquillo",
        text: "Se preferisci, rientra.\nSistema le tue cose, una pausa breve.\nQui il tempo non corre."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo nel Ghetto",
        text: "È l’ora giusta per fermarsi.\nUn calice da Il Beppe e i Suoi Formaggi o uno spritz da Ghetto 05.\nTutto è a pochi passi."
      },
      piazza: {
        title: "⛲ Sedersi in piazza",
        text: "Vai verso Piazza Mattei.\nSiediti davanti alla Fontana delle Tartarughe.\nGuarda il quartiere vivere."
      },
      rientro: {
        title: "🏠 Pausa breve",
        text: "Se sei stanco, rientra.\nUna doccia, silenzio.\nTra poco la sera cambia ritmo."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Cena senza fretta",
        text: "È il momento di mangiare.\nBa’Ghetto o Renato al Ghetto.\nCucina vera, senza formalità."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Fai due passi verso il Teatro di Marcello.\nLe rovine illuminate cambiano tutto.\nRoma di sera è qui."
      },
      rientro: {
        title: "🏠 Serata calma",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery.\nDomani è un altro giorno."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va ancora qualcosa, un drink discreto.\nBartaruga, senza rumore.\nPoi rientro."
      },
      fiume: {
        title: "🌉 Camminata breve",
        text: "Attraversa verso l’Isola Tiberina.\nLe luci sul Tevere chiudono la giornata.\nBasta poco."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nQuesto quartiere domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Slow walk",
        text: "Morning here is special.\nWalk between Via del Portico d’Ottavia and Piazza Costaguti.\nThe neighborhood wakes up quietly."
      },
      dolce: {
        title: "🥐 Something sweet",
        text: "Stop at Pasticceria Boccione.\nJewish pizza or ricotta and sour cherry cake.\nSimple and traditional."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back.\nUnpack and rest a bit.\nTime moves slowly here."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo time",
        text: "Perfect time to stop.\nWine at Il Beppe e i Suoi Formaggi or a spritz nearby.\nEverything is within walking distance."
      },
      piazza: {
        title: "⛲ Sit in the square",
        text: "Go to Piazza Mattei.\nSit by the Turtle Fountain.\nWatch the neighborhood live."
      },
      rientro: {
        title: "🏠 Short break",
        text: "If tired, go back.\nShower and quiet time.\nEvening comes naturally."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Dinner",
        text: "Dinner time.\nBa’Ghetto or Renato al Ghetto.\nHonest food, no rush."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the Theatre of Marcellus.\nLights change everything."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you feel like it, one last quiet drink.\nThen head back."
      },
      fiume: {
        title: "🌉 River walk",
        text: "Cross to Tiber Island.\nCity lights on the river close the day."
      },
      dormire: {
        title: "😴 Sleep",
        text: "End the day.\nRest well."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: { title: "☀️ Promenade lente", text: "Le matin ici est spécial.\nPromène-toi autour du Portique d’Ottavie.\nLe quartier s’éveille doucement." },
      dolce: { title: "🥐 Pause sucrée", text: "Arrête-toi chez Boccione.\nPizza juive ou gâteau ricotta-griottes.\nSimple et authentique." },
      rientro: { title: "🏠 Retour calme", text: "Si tu préfères, rentre.\nIci, le temps ralentit." }
    },
    "18": {
      aperitivo: { title: "🍷 Apéritif", text: "Moment parfait pour s’arrêter.\nUn verre et le quartier autour." },
      piazza: { title: "⛲ La place", text: "Assieds-toi Piazza Mattei.\nRegarde la vie passer." },
      rientro: { title: "🏠 Pause", text: "Si tu es fatigué, rentre.\nLe soir arrive doucement." }
    },
    "2030": {
      cena: { title: "🍽️ Dîner", text: "Cuisine juive romaine.\nSans stress, sans hâte." },
      passeggiata: { title: "🌙 Promenade", text: "Vers le Théâtre de Marcellus.\nLa lumière change tout." },
      rientro: { title: "🏠 Soirée calme", text: "Reste tranquille.\nDemain continue." }
    },
    "2330": {
      ultimo: { title: "🍸 Dernier verre", text: "Un dernier verre si tu veux.\nPuis retour." },
      fiume: { title: "🌉 Le fleuve", text: "Traverse vers l’Île Tibérine.\nLa ville se tait." },
      dormire: { title: "😴 Dormir", text: "Bonne nuit.\nÀ demain." }
    }
  },

  es: {
    "11": {
      passeggiata: { title: "☀️ Paseo lento", text: "La mañana aquí es especial.\nEl barrio despierta despacio." },
      dolce: { title: "🥐 Algo dulce", text: "Boccione.\nPizza judía o tarta tradicional." },
      rientro: { title: "🏠 Volver", text: "Si prefieres, regresa.\nAquí no hay prisa." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitivo", text: "Hora perfecta para parar.\nUna copa y nada más." },
      piazza: { title: "⛲ Plaza", text: "Siéntate en Piazza Mattei.\nObserva." },
      rientro: { title: "🏠 Descanso", text: "Ducha y calma.\nLa tarde sigue." }
    },
    "2030": {
      cena: { title: "🍽️ Cena", text: "Cocina tradicional.\nSin estrés." },
      passeggiata: { title: "🌙 Paseo", text: "Hacia el Teatro de Marcelo." },
      rientro: { title: "🏠 Noche tranquila", text: "Descansa.\nMañana continúa." }
    },
    "2330": {
      ultimo: { title: "🍸 Última copa", text: "Si te apetece, una más." },
      fiume: { title: "🌉 Río", text: "Isla Tiberina.\nTodo se calma." },
      dormire: { title: "😴 Dormir", text: "Buenas noches." }
    }
  },

  de: {
    "11": {
      passeggiata: { title: "☀️ Ruhiger Spaziergang", text: "Der Morgen hier ist besonders.\nAlles beginnt langsam." },
      dolce: { title: "🥐 Etwas Süßes", text: "Boccione.\nTraditionell und einfach." },
      rientro: { title: "🏠 Zurück", text: "Wenn du willst, geh zurück.\nKeine Eile." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitif", text: "Zeit für eine Pause.\nEin Glas genügt." },
      piazza: { title: "⛲ Platz", text: "Setz dich auf den Platz.\nBeobachte." },
      rientro: { title: "🏠 Pause", text: "Ruhe.\nDer Abend kommt." }
    },
    "2030": {
      cena: { title: "🍽️ Abendessen", text: "Ehrliche Küche.\nGanz entspannt." },
      passeggiata: { title: "🌙 Spaziergang", text: "Zum Marcellustheater." },
      rientro: { title: "🏠 Ruhiger Abend", text: "Erholung.\nMorgen geht es weiter." }
    },
    "2330": {
      ultimo: { title: "🍸 Letztes Glas", text: "Wenn du willst, noch eins." },
      fiume: { title: "🌉 Fluss", text: "Zur Tiberinsel.\nStille." },
      dormire: { title: "😴 Schlafen", text: "Gute Nacht." }
    }
  }
};
// ========================================================================
// TRASTEVERE LIVE — VIA DELLA SCALA
// TEMPLATE DEFINITIVO (IDENTICO A PORTICO)
// ========================================================================

const SCALA_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata lenta",
        text: "La mattina a Trastevere è speciale.\nCammina lungo Via della Scala e nei vicoli intorno.\nIl quartiere si sveglia piano, senza rumore."
      },
      caffe: {
        title: "☕ Caffè tranquillo",
        text: "Fermati per un caffè semplice.\nUn tavolino, poche parole.\nQui la giornata inizia lentamente."
      },
      rientro: {
        title: "🏠 Rientro tranquillo",
        text: "Se preferisci, rientra.\nSistema le tue cose, una pausa breve.\nTrastevere non scappa."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo a Trastevere",
        text: "È l’ora giusta per fermarsi.\nUn drink nei dintorni di Piazza Santa Maria.\nL’atmosfera cambia senza fretta."
      },
      piazza: {
        title: "⛲ Sedersi in piazza",
        text: "Siediti in piazza.\nVoci, passi, risate.\nTrastevere vive così."
      },
      rientro: {
        title: "🏠 Pausa breve",
        text: "Se sei stanco, rientra.\nDoccia, silenzio.\nTra poco la sera prende forma."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Cena senza fretta",
        text: "È il momento di mangiare.\nCucina romana, porzioni generose.\nSenza formalità."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Cammina verso il Tevere.\nLe luci si riflettono sull’acqua.\nRoma di sera è qui."
      },
      rientro: {
        title: "🏠 Serata calma",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery.\nDomani continua."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va ancora qualcosa, un ultimo drink.\nSenza musica alta.\nPoi rientro."
      },
      silenzio: {
        title: "🌌 Silenzio",
        text: "I vicoli si svuotano.\nRestano luci e passi lontani.\nÈ il momento di fermarsi."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nTrastevere domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Slow walk",
        text: "Morning in Trastevere is special.\nWalk along Via della Scala and nearby alleys.\nThe neighborhood wakes up quietly."
      },
      caffe: {
        title: "☕ Coffee break",
        text: "Stop for a simple coffee.\nSoft light, no rush.\nThe day starts slowly here."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back.\nUnpack and rest a bit.\nTrastevere will wait."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo time",
        text: "Perfect moment to stop.\nA drink near Santa Maria Square.\nThe mood changes gently."
      },
      piazza: {
        title: "⛲ Sit in the square",
        text: "Sit down.\nPeople, voices, movement.\nThat’s Trastevere."
      },
      rientro: {
        title: "🏠 Short break",
        text: "If tired, go back.\nShower and quiet.\nEvening comes naturally."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Dinner",
        text: "Dinner time.\nRoman food, relaxed places.\nNo rush."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the river.\nLights reflect on the water."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you feel like it, one last drink.\nThen head back."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "Alleys empty.\nThe city slows down."
      },
      dormire: {
        title: "😴 Sleep",
        text: "End the day.\nRest well."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: { title: "☀️ Promenade lente", text: "Le matin à Trastevere est spécial.\nLe quartier se réveille doucement." },
      caffe: { title: "☕ Café", text: "Un café simple.\nLa journée commence lentement." },
      rientro: { title: "🏠 Retour calme", text: "Rentre si tu veux.\nIci, rien ne presse." }
    },
    "18": {
      aperitivo: { title: "🍷 Apéritif", text: "Moment idéal pour s’arrêter.\nUn verre suffit." },
      piazza: { title: "⛲ La place", text: "Assieds-toi.\nRegarde la vie passer." },
      rientro: { title: "🏠 Pause", text: "Un peu de repos avant la soirée." }
    },
    "2030": {
      cena: { title: "🍽️ Dîner", text: "Cuisine romaine simple.\nSans hâte." },
      passeggiata: { title: "🌙 Promenade", text: "Vers le Tibre.\nLumières du soir." },
      rientro: { title: "🏠 Soirée calme", text: "Reste tranquille.\nDemain continue." }
    },
    "2330": {
      ultimo: { title: "🍸 Dernier verre", text: "Un dernier verre si tu veux." },
      silenzio: { title: "🌌 Silence", text: "Les ruelles se vident." },
      dormire: { title: "😴 Dormir", text: "Bonne nuit." }
    }
  },

  es: {
    "11": {
      passeggiata: { title: "☀️ Paseo lento", text: "La mañana en Trastevere es especial.\nTodo empieza despacio." },
      caffe: { title: "☕ Café", text: "Un café tranquilo.\nSin prisa." },
      rientro: { title: "🏠 Volver", text: "Descanso breve.\nEl barrio espera." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitivo", text: "Hora perfecta para parar.\nUna copa basta." },
      piazza: { title: "⛲ Plaza", text: "Siéntate.\nObserva." },
      rientro: { title: "🏠 Descanso", text: "Pausa antes de la noche." }
    },
    "2030": {
      cena: { title: "🍽️ Cena", text: "Cocina romana sencilla.\nSin estrés." },
      passeggiata: { title: "🌙 Paseo", text: "Hacia el río.\nLuces nocturnas." },
      rientro: { title: "🏠 Noche tranquila", text: "Descansa.\nMañana sigue." }
    },
    "2330": {
      ultimo: { title: "🍸 Última copa", text: "Si te apetece, una más." },
      silenzio: { title: "🌌 Silencio", text: "Todo se calma." },
      dormire: { title: "😴 Dormir", text: "Buenas noches." }
    }
  },

  de: {
    "11": {
      passeggiata: { title: "☀️ Ruhiger Spaziergang", text: "Der Morgen in Trastevere ist besonders.\nAlles beginnt langsam." },
      caffe: { title: "☕ Kaffee", text: "Einfach sitzen.\nOhne Eile." },
      rientro: { title: "🏠 Zurück", text: "Kurze Pause.\nDas Viertel wartet." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitif", text: "Zeit für eine Pause.\nEin Glas genügt." },
      piazza: { title: "⛲ Platz", text: "Setz dich.\nBeobachte." },
      rientro: { title: "🏠 Pause", text: "Ruhe vor dem Abend." }
    },
    "2030": {
      cena: { title: "🍽️ Abendessen", text: "Ehrliche römische Küche.\nGanz entspannt." },
      passeggiata: { title: "🌙 Spaziergang", text: "Richtung Fluss.\nAbendlicht." },
      rientro: { title: "🏠 Ruhiger Abend", text: "Erholung.\nMorgen geht es weiter." }
    },
    "2330": {
      ultimo: { title: "🍸 Letztes Glas", text: "Wenn du willst, noch eins." },
      silenzio: { title: "🌌 Stille", text: "Alles wird ruhig." },
      dormire: { title: "😴 Schlafen", text: "Gute Nacht." }
    }
  }
};
// ========================================================================
// VIALE TRASTEVERE LIVE — VIALE TRASTEVERE 108
// TEMPLATE DEFINITIVO
// ========================================================================

const VIALE_TRASTEVERE_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata mattutina",
        text: "La mattina qui è autentica.\nCammina verso Porta Portese o lungo il viale.\nRoma si muove lentamente, senza turisti."
      },
      mercato: {
        title: "🛍️ Mercato e botteghe",
        text: "Se è domenica, Porta Portese è a due passi.\nAltrimenti esplora le botteghe storiche della zona.\nÈ la Roma vera."
      },
      rientro: {
        title: "🏠 Rientro tranquillo",
        text: "Se preferisci, rientra.\nSistema le tue cose, una pausa breve.\nIl quartiere ti aspetta."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo locale",
        text: "È l’ora giusta per fermarsi.\nUn drink tra San Francesco a Ripa e dintorni.\nAtmosfera rilassata."
      },
      sedersi: {
        title: "🪑 Sedersi e osservare",
        text: "Siediti lungo il viale.\nGente che passa, tram che scorrono.\nTrastevere cambia ritmo."
      },
      rientro: {
        title: "🏠 Pausa breve",
        text: "Se sei stanco, rientra.\nDoccia e silenzio.\nLa sera arriva piano."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Cena senza stress",
        text: "È il momento di mangiare.\nCucina romana e piatti laziali.\nSenza formalità."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Cammina verso Piazza Mastai o il Tevere.\nLuci morbide, meno folla.\nRoma di sera è qui."
      },
      rientro: {
        title: "🏠 Serata calma",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery.\nDomani continua."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va ancora qualcosa, un ultimo drink.\nAtmosfera tranquilla.\nPoi rientro."
      },
      silenzio: {
        title: "🌌 Silenzio",
        text: "Il viale rallenta.\nRestano luci e passi lontani.\nÈ il momento di fermarsi."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nRoma domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Morning walk",
        text: "Morning here feels real.\nWalk toward Porta Portese or along the avenue.\nRome moves slowly."
      },
      mercato: {
        title: "🛍️ Market & shops",
        text: "If it’s Sunday, Porta Portese is nearby.\nOtherwise explore local shops.\nThis is real Rome."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back.\nUnpack and rest a bit.\nThe area will wait."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo time",
        text: "Perfect moment to stop.\nA relaxed drink nearby.\nEasy atmosphere."
      },
      sedersi: {
        title: "🪑 Sit and watch",
        text: "Sit along the avenue.\nPeople, trams, city life.\nTrastevere shifts."
      },
      rientro: {
        title: "🏠 Short break",
        text: "If tired, go back.\nShower and quiet.\nEvening comes gently."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Dinner",
        text: "Dinner time.\nRoman food, relaxed places.\nNo rush."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the river.\nSoft lights, fewer crowds."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you feel like it, one last drink.\nThen head back."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "The avenue slows down.\nTime to stop."
      },
      dormire: {
        title: "😴 Sleep",
        text: "End the day.\nRest well."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: { title: "☀️ Promenade", text: "Le matin ici est authentique.\nRome avance doucement." },
      mercato: { title: "🛍️ Marché", text: "Porta Portese si tout près.\nSinon, boutiques locales." },
      rientro: { title: "🏠 Retour", text: "Rentre si tu veux.\nLe quartier attend." }
    },
    "18": {
      aperitivo: { title: "🍷 Apéritif", text: "Moment idéal pour s’arrêter.\nAmbiance détendue." },
      sedersi: { title: "🪑 Observer", text: "Assieds-toi.\nLa ville passe." },
      rientro: { title: "🏠 Pause", text: "Un peu de repos avant la soirée." }
    },
    "2030": {
      cena: { title: "🍽️ Dîner", text: "Cuisine romaine simple.\nSans hâte." },
      passeggiata: { title: "🌙 Promenade", text: "Vers le Tibre.\nLumières du soir." },
      rientro: { title: "🏠 Soirée calme", text: "Repos.\nDemain continue." }
    },
    "2330": {
      ultimo: { title: "🍸 Dernier verre", text: "Un dernier verre si tu veux." },
      silenzio: { title: "🌌 Silence", text: "Tout ralentit." },
      dormire: { title: "😴 Dormir", text: "Bonne nuit." }
    }
  },

  es: {
    "11": {
      passeggiata: { title: "☀️ Paseo", text: "La mañana aquí es real.\nRoma va despacio." },
      mercato: { title: "🛍️ Mercado", text: "Porta Portese cerca.\nTiendas locales." },
      rientro: { title: "🏠 Volver", text: "Descanso breve.\nEl barrio espera." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitivo", text: "Momento perfecto para parar." },
      sedersi: { title: "🪑 Sentarse", text: "Observa la ciudad." },
      rientro: { title: "🏠 Descanso", text: "Pausa antes de la noche." }
    },
    "2030": {
      cena: { title: "🍽️ Cena", text: "Cocina romana sencilla." },
      passeggiata: { title: "🌙 Paseo", text: "Hacia el río." },
      rientro: { title: "🏠 Noche tranquila", text: "Descansa.\nMañana sigue." }
    },
    "2330": {
      ultimo: { title: "🍸 Última copa", text: "Si te apetece, una más." },
      silenzio: { title: "🌌 Silencio", text: "Todo se calma." },
      dormire: { title: "😴 Dormir", text: "Buenas noches." }
    }
  },

  de: {
    "11": {
      passeggiata: { title: "☀️ Spaziergang", text: "Der Morgen hier ist echt.\nRom bewegt sich langsam." },
      mercato: { title: "🛍️ Markt", text: "Porta Portese in der Nähe.\nLokale Geschäfte." },
      rientro: { title: "🏠 Zurück", text: "Kurze Pause.\nDas Viertel wartet." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitif", text: "Zeit für eine Pause." },
      sedersi: { title: "🪑 Beobachten", text: "Stadtleben beobachten." },
      rientro: { title: "🏠 Pause", text: "Ruhe vor dem Abend." }
    },
    "2030": {
      cena: { title: "🍽️ Abendessen", text: "Einfache römische Küche." },
      passeggiata: { title: "🌙 Spaziergang", text: "Richtung Fluss." },
      rientro: { title: "🏠 Ruhiger Abend", text: "Erholung.\nMorgen weiter." }
    },
    "2330": {
      ultimo: { title: "🍸 Letztes Glas", text: "Wenn du willst, noch eins." },
      silenzio: { title: "🌌 Stille", text: "Alles wird ruhig." },
      dormire: { title: "😴 Schlafen", text: "Gute Nacht." }
    }
  }
};
// ========================================================================
// VIALE TRASTEVERE LIVE — API
// ========================================================================

app.get("/viale-trastevere", (req, res) => {
  const { slot, choice } = req.query;

  const langHeader = req.headers["accept-language"] || "en";
  const lang = langHeader.slice(0, 2).toLowerCase();
  const supported = ["it", "en", "fr", "es", "de"];
  const l = supported.includes(lang) ? lang : "en";

  const data =
    VIALE_TRASTEVERE_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) {
    return res.status(404).send("Not available");
  }

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Viale Trastevere Live</title>
<style>
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  background: #f6f6f6;
  margin: 0;
}
.wrap {
  max-width: 680px;
  margin: auto;
  padding: 24px;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 28px;
}
h1 {
  font-size: 22px;
  margin-top: 0;
}
p {
  line-height: 1.6;
  white-space: pre-line;
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${data.title}</h1>
      <p>${data.text}</p>
    </div>
  </div>
</body>
</html>
`);
});
// ========================================================================
// VIA DELLA SCALA LIVE — API
// ========================================================================

app.get("/scala", (req, res) => {
  const { slot, choice } = req.query;

  const langHeader = req.headers["accept-language"] || "en";
  const lang = langHeader.slice(0, 2).toLowerCase();
  const supported = ["it", "en", "fr", "es", "de"];
  const l = supported.includes(lang) ? lang : "en";

  const data =
    SCALA_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) {
    return res.status(404).send("Not available");
  }

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trastevere Live</title>
<style>
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  background: #f6f6f6;
  margin: 0;
}
.wrap {
  max-width: 680px;
  margin: auto;
  padding: 24px;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 28px;
}
h1 {
  font-size: 22px;
  margin-top: 0;
}
p {
  line-height: 1.6;
  white-space: pre-line;
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${data.title}</h1>
      <p>${data.text}</p>
    </div>
  </div>
</body>
</html>
`);
});
// ========================================================================
// PORTICO LIVE — ROUTE (IDENTICA A /monti)
// ========================================================================

app.get("/portico", (req, res) => {
  const { slot, choice } = req.query;

  // lingua automatica dal browser
  const langHeader = req.headers["accept-language"] || "en";
  const lang = langHeader.slice(0, 2).toLowerCase();
  const supported = ["it", "en", "fr", "es", "de"];
  const l = supported.includes(lang) ? lang : "en";

  const data =
    PORTICO_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) {
    return res.status(404).send("Not available");
  }

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portico Live</title>
<style>
body{font-family:system-ui;background:#f6f6f6;margin:0}
.wrap{max-width:680px;margin:auto;padding:24px}
.card{background:#fff;border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 12px}
p{line-height:1.6;white-space:pre-line}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>${data.title}</h1>
    <p>${data.text}</p>
  </div>
</div>
</body>
</html>
  `);
});
 app.get("/monti", (req, res) => {
  const { slot, choice } = req.query;
  const langHeader = req.headers["accept-language"] || "en";
  const lang = langHeader.slice(0, 2).toLowerCase();
  const supported = ["it","en","fr","es","de"];
  const l = supported.includes(lang) ? lang : "en";

  const data = MONTI_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) return res.status(404).send("Not available");

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monti Live</title>
<style>
body{font-family:system-ui;background:#f6f6f6;margin:0}
.wrap{max-width:680px;margin:auto;padding:24px}
.card{background:#fff;border-radius:16px;padding:28px}
h1{font-size:22px}
p{line-height:1.6;white-space:pre-line}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
<h1>${data.title}</h1>
<p>${data.text}</p>
</div>
</div>
</body>
</html>
`);
});
app.use(express.static(PUBLIC_DIR));


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
  
const MAILER_URL = process.env.MAILER_URL || "https://script.google.com/macros/s/XXXXXXX/exec";
const MAIL_SHARED_SECRET = process.env.MAIL_SHARED_SECRET;

if (!MAIL_SHARED_SECRET) {
  console.error("â Missing MAIL_SHARED_SECRET env var");
  process.exit(1);
}

app.post("/hostaway-outbound", requireAdmin, async (req, res) => {
  try {
    const { reservationId, guestEmail, guestName, message } = req.body || {};
    if (!guestEmail || !message) {
      console.log("â Dati insufficienti per invio email:", req.body);
      return res.status(400).json({ ok: false, error: "missing_email_or_message" });
    }
    const subject = `Messaggio da NiceFlatInRome`;
    const htmlBody = `<p>Ciao ${guestName || "ospite"},</p><p>${message.replace(/\n/g, "<br>")}</p><p>Un saluto da Michele e dal team NiceFlatInRome.</p>`;
    const mailResponse = await axios.post(`${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
      { to: guestEmail, subject, htmlBody },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 });
    if (String(mailResponse.data).trim() === "ok") {
      console.log(`ð¤ Email inviata con successo a ${guestEmail}`);
      return res.json({ ok: true });
    } else {
      console.error("â Errore dal mailer:", mailResponse.data);
      return res.status(502).json({ ok: false, error: "mailer_failed" });
    }
  } catch (err) {
    console.error("Errore invio email:", err.message);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/test-mail", requireAdmin, (req, res) => {
  res.type("html").send(`<!doctype html><meta charset="utf-8">
<div style="font-family: system-ui; max-width: 680px; margin: 24px auto;">
<h2>Test invio email VRBO</h2>
<form method="post" action="/hostaway-outbound" style="display:grid; gap:8px;">
<label>Guest email<input name="guestEmail" type="email" required style="width:100%;padding:8px"></label>
<label>Guest name<input name="guestName" type="text" style="width:100%;padding:8px"></label>
<label>Reservation ID<input name="reservationId" type="text" style="width:100%;padding:8px"></label>
<label>Messaggio<textarea name="message" rows="6" required style="width:100%;padding:8px">Ciao, confermo il tuo check-in!</textarea></label>
<button style="padding:10px 16px">Invia</button>
</form></div>
<script>
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
</script>`);
});

app.post("/api/vbro-mail", requireAdmin, async (req, resInner) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to || !subject || !body) return resInner.status(400).json({ ok: false, error: "missing_fields" });
    const mailResp = await axios.post(`${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
      { to, subject, htmlBody: body },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 });
    console.log("ð¨ Email VRBO inviata con successo", mailResp.status);
    return resInner.json({ ok: true });
  } catch (err) {
    console.error("â Errore invio mail:", err);
    return resInner.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
 // ========================================================================
// HostAway â AI Guest Assistant (chat reply)
// ========================================================================

 // ========================================================================
// HostAway Incoming Webhook â UPDATED WITH NEW MATCHER
// ========================================================================

const APT_DEFAULT_LANG = {
  arenula: "en",
  leonina: "en",
  scala: "en",
  portico: "en",
  trastevere: "en"
};

function normalizeLang(lang) {
  if (!lang || typeof lang !== "string") return null;
  return lang.slice(0, 2).toLowerCase();
}

app.post("/hostaway-incoming", async (req, res) => {
  console.log("\n" + "=".repeat(60));
  console.log("ð© HOSTAWAY WEBHOOK RECEIVED");
  console.log("=".repeat(60));
  console.log("ð¦ Request Body:", JSON.stringify(req.body, null, 2));
  console.log("=".repeat(60) + "\n");

  try {
    const payload = req.body;

// ✅ IGNORA messaggi in uscita (evita loop e __INTERNAL_AI__ in chat)
 // ✅ IGNORA SOLO i messaggi OUTGOING (evita loop), NON quelli incoming
const isIncoming = payload?.isIncoming;
const sentUsingHostaway = payload?.sentUsingHostaway;
const status = payload?.status;

 if (isIncoming === 0 || isIncoming === false || sentUsingHostaway === 1) {
  console.log("🛑 Outgoing message -> ignored", { status, isIncoming, sentUsingHostaway });
  return res.json({ ok: true, silent: true });
}


const message = payload.body;

// ✅ IGNORA eco interno (se mai arriva come body)
if (message?.trim?.() === "__INTERNAL_AI__") {
  console.log("🛑 Echo INTERNAL_AI → ignored");
  return res.json({ ok: true, silent: true });
}

const guestName = payload.guestName;
const reservationId = payload.reservationId;
const conversationId = payload.conversationId;
const listingId = payload.listingMapId;
const guestLanguage = payload.guestLanguage;

 // STEP 1.5 — Resolve apartment EARLY (prima di matcher / Gemini)
const apartment = (() => {
  switch (listingId) {
    case 194164: return "trastevere";
    case 194165: return "portico";
    case 194166: return "arenula";
    case 194162: return "scala";
    case 194163: return "leonina";
    default: return "rome";
  }
})();
   // PATCH: recupera reservationId dalla chat se manca
let effectiveReservationId = reservationId;

if (!effectiveReservationId && conversationId) {
  console.log("🧩 ReservationId mancante, provo da conversationId:", conversationId);

  try {
    const r = await fetch(
      `https://api.hostaway.com/v1/conversations/${conversationId}`,
      {
        headers: {
         Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await r.json();
    effectiveReservationId = data?.result?.reservationId;

    console.log("🧩 ReservationId risolto:", effectiveReservationId);
  } catch (err) {
    console.error("❌ Errore fetch conversation → reservation", err);
  }
}
// ===============================
// PATCH — ARRIVAL TIME VIA GUEST MESSAGE
// ===============================
if (effectiveReservationId && conversationId) {
  try {
     const r = await axios.get(
  `https://api.hostaway.com/v1/reservations/${effectiveReservationId}`,
  {
    headers: {
      Authorization: `Bearer ${HOSTAWAY_TOKEN}`
    },
    timeout: 10000
  }
);

    const reservation = r.data?.result;
    const arrivalTime =
      reservation?.arrivalTime ||
      reservation?.checkinTime ||
      reservation?.customFields?.arrival_time ||
      null;

    if (arrivalTime) {
      const slots = decideSlots(arrivalTime);

      console.log("🧩 ARRIVAL TIME (via guest message):", arrivalTime);
      console.log("🧩 SLOT CALCOLATI:", slots);

   const checkInDate = reservation?.arrivalDate || reservation?.checkInDate;
const today = new Date().toISOString().slice(0, 10);
if (checkInDate !== today) {
  console.log("⏭️ Check-in non oggi, slot ignorati:", checkInDate);
} else {
  const guestLang = (reservation?.guestLanguage || "en").slice(0, 2).toLowerCase();
  scheduleSlotMessages({
    reservationId: effectiveReservationId,
    conversationId,
    apartment,
    slots,
    sendFn: (params) => sendSlotLiveMessage({ ...params, lang: guestLang }),
    checkInDate: checkInDate
  });
}

    } else {
      console.log("⚠️ Arrival time non presente nella reservation");
    }
  } catch (e) {
    console.error("❌ Errore fetch reservation (guest message):", e.message);
  }
}
    // ======================================================
    // ð Resolve Listing ID from reservation (HostAway)
    // ======================================================
    let resolvedListingId = listingId;

    if (!resolvedListingId && reservationId) {
      try {
        console.log("ð Fetching reservation from HostAway:", reservationId);

         const r = await axios.get(
  `https://api.hostaway.com/v1/reservations/${effectiveReservationId}`,
  {
    headers: {
      Authorization: `Bearer ${HOSTAWAY_TOKEN}`
    },
    timeout: 10000
  }
);

        console.log("ð FULL API Response:", JSON.stringify(r.data, null, 2));

        resolvedListingId = r.data?.result?.listingId;
        console.log("ð  ListingId resolved from reservation:", resolvedListingId);
      } catch (e) {
        console.error("â Failed to resolve listingId from reservation", e.message);
      }
    }

    req.body = req.body?.data ?? req.body;

    console.log("📋 STEP 1: Extract Data");
    console.log("  ââ message:", message);
    console.log("  ââ conversationId:", conversationId);
    console.log("  ââ guestName:", guestName);
    console.log("  ââ reservationId:", reservationId);

    if (!message || !conversationId) {
      console.log("â ï¸ Missing required fields â SILENT");
      return res.json({ ok: true, silent: true });
    }

    // ======================================================
    // ð STEP 2: Check HostAway Token
    // ======================================================
    if (!HOSTAWAY_TOKEN) {
      console.error("â HOSTAWAY_TOKEN is NOT configured!");
      return res.status(500).json({ ok: false });
    }

    console.log("  â Token configured");

   // ======================================================
// 🎯 STEP 3: Match Intent + Language
// ====================================================== 
const match = matchIntent(message); 
console.log("🎯 Matcher result:", match || "NONE");

const detectedLang = detectLanguage(message);
console.log("🌍 Lingua rilevata:", detectedLang);

 const intent = match?.intent || null;

    // ======================================================
    // ð  STEP 4: listingId â apartment
    // ======================================================
    const LISTING_TO_APARTMENT = {
      "194166": "arenula",
      "194165": "portico",
      "194163": "leonina",
      "194164": "trastevere",
      "194162": "scala"
    };

    console.log("  ââ listingId ricevuto:", resolvedListingId);

     

    if (!apartment) {
      console.error("â ListingId non mappato:", resolvedListingId);
      return res.json({ ok: true, silent: true });
    }

    console.log("  ââ Appartamento:", apartment);

    // ======================================================
    // ð STEP 5: Language selection (3-LEVEL CASCADE)
    // ======================================================
    const platformLang = normalizeLang(guestLanguage);
    const defaultLang = APT_DEFAULT_LANG[apartment] || "en";

    let answer = null;
    let usedLang = null;

    // LEVEL 1 â Lingua rilevata dal messaggio
    if (
      detectedLang &&
      ANSWERS[apartment]?.[detectedLang]?.[intent]
    ) {
      answer = ANSWERS[apartment][detectedLang][intent];
      usedLang = detectedLang;
      console.log("  â Usata lingua del messaggio:", detectedLang);
    }

    // LEVEL 2 â Lingua da HostAway
    else if (
      platformLang &&
      ANSWERS[apartment]?.[platformLang]?.[intent]
    ) {
      answer = ANSWERS[apartment][platformLang][intent];
      usedLang = platformLang;
      console.log("  â Usata lingua piattaforma:", platformLang);
    }

    // LEVEL 3 â Lingua default appartamento
    else if (
      ANSWERS[apartment]?.[defaultLang]?.[intent]
    ) {
      answer = ANSWERS[apartment][defaultLang][intent];
      usedLang = defaultLang;
      console.log("  â Usata lingua default:", defaultLang);
    }
 // ⛔ BLOCCO SENTINELLA: se AI interna dice di tacere → TACI
if (answer === "__INTERNAL_AI__") {
  console.log("⛔ INTERNAL_AI → sistema deve tacere");
  return res.json({ ok: true, silent: true });
}

 // ======================================================
// 🤖 FALLBACK GEMINI — domande turistiche + ringraziamenti
// ======================================================
if (!answer) {
  // BLOCCA domande sulla prenotazione
  const isBookingQuestion = /people|guest|accommodate|room|bed|extra|date|night|stay|cancel|refund|change|modify|price|cost|pay|book|ospiti|persone|prenotazione|capienza|letti|camera|notte|cancellare|cambiare|prezzo|pagare/i.test(message);
  
  if (isBookingQuestion) {
    console.log("📋 Domanda sulla prenotazione → SILENZIO (gestione manuale)");
    return res.json({ ok: true, silent: true, reason: "booking_question" });
  }

  // Controlla se è una DOMANDA turistica
  const isQuestion = /\?|where|what|when|how|which|dove|cosa|quando|come|où|quand|comment|dónde|cuándo|cómo|wo|wann|wie/i.test(message);
  
  // Controlla se è un RINGRAZIAMENTO
  const isThanks = /thank|thanks|grazie|merci|danke|appreciate|wonderful|amazing|perfect|excellent|great|fantastic|loved|enjoyed|beautiful/i.test(message);
  
  // Se non è né domanda né ringraziamento → SILENZIO
  if (!isQuestion && !isThanks) {
    console.log("💬 Messaggio casual → SILENZIO (risposta manuale)");
    return res.json({ ok: true, silent: true, reason: "casual_message" });
  }

  console.log("🤖 Domanda turistica o ringraziamento → Gemini");

  try {
    const geminiReply = await askGemini({
      message,
      apartment: LISTING_TO_APARTMENT[listingId] || "rome",
      lang: detectedLang || "en"
    });

    if (!geminiReply) {
      console.log("🤖 Gemini returned empty → silent");
      return res.json({ ok: true, silent: true });
    }

    answer = geminiReply;
    usedLang = detectedLang || platformLang || defaultLang || "en";

    console.log("🤖 Gemini answer ready");
  } catch (e) {
    console.error("❌ Gemini error:", e.message);
    return res.json({ ok: true, silent: true });
  }
}

// 🛟 SAFE FALLBACK — risposta cortese standard
if (!answer) {
  console.log("🛟 SAFE FALLBACK reply used");
  answer = SAFE_FALLBACK_REPLY;
  usedLang = detectedLang || platformLang || defaultLang || "en";
}

console.log("  ✅ Answer found");
console.log("  ─→ Language used:", usedLang);
console.log("  ─→ Preview:", answer.substring(0, 80) + "...");

// ⛔ FINAL GUARD — niente __INTERNAL_AI__ verso Hostaway
if (
  !answer ||
  answer === "__INTERNAL_AI__" ||
  answer.trim() === ""
) {
  console.log("🛑 Final guard: risposta mancante o INTERNAL_AI → SILENT");
  return res.json({ ok: true, silent: true });
}


    // ======================================================
    // ð¤ STEP 6: Send Reply to HostAway
    // ======================================================
    await axios.post(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
      {
        body: answer,
        sendToGuest: true
      },
      {
        headers: {
          Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    console.log("â Reply sent successfully");

    return res.json({
      ok: true,
      replied: true,
      intent,
      lang: usedLang
    });

  } catch (err) {
    console.error("â ERROR IN /hostaway-incoming");
    console.error(err.message);
    return res.status(500).json({ ok: false });
  }
});


 // ========================================================================
// INTEGRAZIONI PAGAMENTI - DA AGGIUNGERE AL SERVER.JS
// ========================================================================

// 1) AGGIUNGI QUESTE VARIABILI AMBIENTE ALL'INIZIO (dopo le altre)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const GOOGLE_SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

if (!STRIPE_WEBHOOK_SECRET) {
  console.error("⚠️ Missing STRIPE_WEBHOOK_SECRET");
}
if (!PAYPAL_WEBHOOK_ID) {
  console.error("⚠️ Missing PAYPAL_WEBHOOK_ID");
}
if (!GOOGLE_SHEETS_WEBHOOK_URL) {
  console.error("⚠️ Missing GOOGLE_SHEETS_WEBHOOK_URL");
}

// ========================================================================
// FUNZIONE SCRITTURA GOOGLE SHEETS
// ========================================================================

async function writeToGoogleSheets(data) {
  try {
    console.log("📊 Invio dati a Google Sheets:", data);
    
    const response = await axios.post(
      GOOGLE_SHEETS_WEBHOOK_URL,
      data,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000
      }
    );
    
    console.log("✅ Dati salvati su Sheets");
    return { ok: true, response: response.data };
  } catch (err) {
    console.error("❌ Errore scrittura Sheets:", err.message);
    return { ok: false, error: err.message };
  }
}
// ========================================================================
// INVIO MESSAGGIO REALE A HOSTAWAY (PRODUZIONE)
// ========================================================================

async function sendHostawayMessage({ conversationId, message }) {
  if (!HOSTAWAY_TOKEN) {
    console.error("❌ HOSTAWAY_TOKEN mancante");
    return;
  }

  try {
    await axios.post(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
      {
        body: message,
        sendToGuest: true
      },
      {
        headers: {
          Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    console.log("📨 Messaggio inviato a HostAway");
  } catch (err) {
    console.error("❌ Errore invio HostAway:", err.message);
  }
}
app.get("/test-paypal-simple", async (req, res) => {
  const secret = req.query.secret;
  if (!safeEqual(secret || "", ADMIN_SECRET)) {
    return res.status(403).send("unauthorized");
  }

  const testData = {
    source: "PayPal",
    timestamp: new Date().toISOString(),
    eventType: "PAYMENT.CAPTURE.COMPLETED",
    paymentId: "test_paypal_" + Date.now(),
    amount: 200.00,
    currency: "EUR",
    status: "COMPLETED",
    customerEmail: "test@paypal.com",
    customerName: "Luigi Verdi",
    description: "Test PayPal payment",
    metadata: "{}"
  };

  const result = await writeToGoogleSheets(testData);
  res.type("html").send(`<h1>Test PayPal Completato</h1><pre>${JSON.stringify({ ok: result.ok, testData, result }, null, 2)}</pre>`);
});
// ========================================================================
// STRIPE WEBHOOK
// ========================================================================

app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  
  console.log("\n" + "=".repeat(60));
  console.log("💳 STRIPE WEBHOOK RECEIVED");
  console.log("=".repeat(60));
  
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("❌ Stripe webhook secret non configurato");
    return res.status(500).send("Configuration error");
  }

  let event;
  
  try {
    // Verifica firma Stripe
    const stripe = (await import("stripe")).default(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    console.log("✅ Firma Stripe verificata");
  } catch (err) {
    console.error("❌ Errore verifica firma:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Eventi Stripe da gestire
  if (event.type === "payment_intent.succeeded" || 
      event.type === "charge.succeeded" ||
      event.type === "checkout.session.completed") {
    
    const paymentData = event.data.object;
    
    console.log("📝 Tipo evento:", event.type);
    console.log("💰 Importo:", paymentData.amount / 100, paymentData.currency?.toUpperCase());
    
    // Estrai dati pagamento
    const rowData = {
      source: "Stripe",
      timestamp: new Date().toISOString(),
      eventType: event.type,
      paymentId: paymentData.id,
      amount: paymentData.amount / 100,
      currency: (paymentData.currency || "eur").toUpperCase(),
      status: paymentData.status,
      customerEmail: paymentData.receipt_email || paymentData.customer_email || "",
      customerName: paymentData.billing_details?.name || "",
      description: paymentData.description || "",
      metadata: JSON.stringify(paymentData.metadata || {})
    };
    
    console.log("📊 Dati estratti:", rowData);
    
    // Scrivi su Google Sheets
    await writeToGoogleSheets(rowData);
  }
  
  res.json({ received: true });
});

// ========================================================================
// PAYPAL WEBHOOK
// ========================================================================

app.post("/paypal-webhook", async (req, res) => {
  console.log("\n" + "=".repeat(60));
  console.log("💙 PAYPAL WEBHOOK RECEIVED");
  console.log("=".repeat(60));
  console.log("📦 Body:", JSON.stringify(req.body, null, 2));
  
  if (!PAYPAL_WEBHOOK_ID) {
    console.error("❌ PayPal webhook ID non configurato");
    return res.status(500).send("Configuration error");
  }

  try {
    // Verifica firma PayPal
    const headers = {
      "auth-algo": req.headers["paypal-auth-algo"],
      "cert-url": req.headers["paypal-cert-url"],
      "transmission-id": req.headers["paypal-transmission-id"],
      "transmission-sig": req.headers["paypal-transmission-sig"],
      "transmission-time": req.headers["paypal-transmission-time"]
    };
    
    // Verifica webhook PayPal (richiede SDK PayPal)
    // Per semplicità, procediamo con i dati
    // In produzione aggiungi verifica firma completa
    
    const event = req.body;
    const eventType = event.event_type;
    
    console.log("📝 Tipo evento:", eventType);
    
    // Eventi PayPal da gestire
    if (eventType === "PAYMENT.CAPTURE.COMPLETED" ||
        eventType === "CHECKOUT.ORDER.APPROVED" ||
        eventType === "PAYMENT.SALE.COMPLETED") {
      
      const resource = event.resource;
      const amount = resource.amount || resource.purchase_units?.[0]?.amount;
      const payer = resource.payer || resource.purchase_units?.[0]?.payee;
      
      console.log("💰 Importo:", amount?.value, amount?.currency_code);
      
      const rowData = {
        source: "PayPal",
        timestamp: new Date().toISOString(),
        eventType: eventType,
        paymentId: resource.id,
        status: resource.status,
        customerEmail: payer?.email_address || "",
        customerName: payer?.name?.given_name + " " + payer?.name?.surname || "",
        description: resource.description || "",
        metadata: JSON.stringify({ paypal_event_id: event.id })
      };
      
      console.log("📊 Dati estratti:", rowData);
      
      // Scrivi su Google Sheets
      await writeToGoogleSheets(rowData);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error("❌ Errore PayPal webhook:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

  // ========================================================================
// HOSTAWAY BOOKING WEBHOOK — FIXED & DEPLOY SAFE
// ========================================================================
 app.post("/hostaway-booking-webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
     const data = req.body;
// ✅ GESTISCI ENTRAMBE LE STRUTTURE
const reservation = data?.reservation || data?.result || data;

console.log("🏠 HOSTAWAY BOOKING:", JSON.stringify(data, null, 2));

const reservationId = reservation?.id || reservation?.reservationId || data?.reservationId;
const effectiveReservationId = reservationId;
let conversationId = reservation?.conversationId || data?.conversationId;

// ✅ ESTRAI LISTING ID da più posizioni possibili
const listingMapId = reservation?.listingMapId || data?.listingMapId || reservation?.listingId;

    
    // ✅ MAPPA A APPARTAMENTO
    const apartment = (() => {
      switch (listingMapId) {
        case 194164: return "trastevere";
        case 194165: return "portico";
        case 194166: return "arenula";
        case 194162: return "scala";
        case 194163: return "leonina";
        default: return null;
      }
    })();

    let arrivalTime = reservation?.arrivalTime;
    if (!arrivalTime && reservation?.checkInTime) {
      arrivalTime = `${reservation.checkInTime}:00`;
    }

    console.log("✅ DATI ESTRATTI:");
    console.log("   reservationId:", effectiveReservationId);
    console.log("   conversationId:", conversationId);
    console.log("   listingMapId:", listingMapId);
    console.log("   apartment:", apartment);
    console.log("   arrivalTime:", arrivalTime);

    if (!effectiveReservationId) {
      console.log("⚠️ ReservationId mancante → ignorato");
      return;
    }

    if (!apartment) {
      console.log("⚠️ Appartamento sconosciuto → ignorato");
      return;
    }

    // Filtra cancellazioni
    if (
      data.event === "reservation_cancelled" ||
      data.event === "reservation_canceled" ||
      reservation.status === "cancelled" ||
      reservation.status === "canceled"
    ) {
      console.log("🗑️ Cancellazione → ignorata");
      return;
    }

    const EVENTI_VALIDI = [
      "reservation_created",
      "reservation_new",
      "booking_event"
    ];

    const eventoCorrente = data.event || "booking_event";

    if (!EVENTI_VALIDI.includes(eventoCorrente)) {
      console.log("⏭️ Evento ignorato:", eventoCorrente);
      return;
    }

    // Recupera conversationId se mancante
    if (!conversationId && effectiveReservationId) {
      try {
        const convResp = await axios.get(
          `https://api.hostaway.com/v1/conversations?reservationId=${effectiveReservationId}`,
          {
            headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` },
            timeout: 10000
          }
        );
        
        conversationId = convResp.data?.result?.[0]?.id;
        console.log("✅ ConversationId recuperato:", conversationId);
      } catch (e) {
        console.error("❌ Impossibile recuperare conversationId:", e.message);
      }
    }

    // ✅ Recupera arrivalTime se mancante
    if (!arrivalTime && effectiveReservationId) {
      try {
        const resResp = await axios.get(
          `https://api.hostaway.com/v1/reservations/${effectiveReservationId}`,
          {
            headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` },
            timeout: 10000
          }
        );
        
        const resData = resResp.data?.result;
        arrivalTime = resData?.arrivalTime;
        
        if (!arrivalTime && resData?.checkInTime) {
          arrivalTime = `${resData.checkInTime}:00`;
        }
        
        console.log("✅ ArrivalTime recuperato:", arrivalTime);
      } catch (e) {
        console.error("❌ Errore recupero arrivalTime:", e.message);
      }
    }

    const slots = decideSlots(arrivalTime);

    console.log("⏰ Arrival time:", arrivalTime);
    console.log("📆 Slot calcolati:", slots);

 if (conversationId) {
  const checkInDate = reservation?.arrivalDate || reservation?.checkInDate;
  const guestLang = (reservation?.guestLanguage || "en").slice(0, 2).toLowerCase();

  scheduleSlotMessages({
    reservationId: effectiveReservationId,
    conversationId: conversationId,
    apartment: apartment,
    slots,
    sendFn: (params) => sendSlotLiveMessage({ ...params, lang: guestLang }),
    checkInDate: checkInDate
  });
} else {
  console.log("⚠️ conversationId mancante → slot non inviati");
}

} catch (err) {
  console.error("❌ ERRORE hostaway-booking-webhook:", err);
}
 });

// ========================================================================
// ENDPOINT TEST MANUALE
// ========================================================================

app.get("/test-sheets-integration", requireAdmin, (req, res) => {
  res.type("html").send(`<!doctype html><meta charset="utf-8">
<div style="font-family: system-ui; max-width: 800px; margin: 24px auto;">
<h2>🧪 Test Integrazione Google Sheets</h2>

<h3>1️⃣ Test Stripe</h3>
<button onclick="testStripe()">Simula Pagamento Stripe</button>

<h3>2️⃣ Test PayPal</h3>
<button onclick="testPayPal()">Simula Pagamento PayPal</button>

<h3>3️⃣ Test Hostaway</h3>
<button onclick="testHostaway()">Simula Prenotazione Hostaway</button>

<pre id="result" style="background: #f5f5f5; padding: 16px; margin-top: 20px;"></pre>

<script>
async function testStripe() {
  const result = document.getElementById('result');
  result.textContent = 'Invio test Stripe...';
  
  try {
    const res = await fetch('/test-stripe-webhook', { 
      method: 'POST',
      headers: { 'x-admin-secret': prompt('Admin secret:') }
    });
    const data = await res.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    result.textContent = 'Errore: ' + e.message;
  }
}

async function testPayPal() {
  const result = document.getElementById('result');
  result.textContent = 'Invio test PayPal...';
  
  try {
    const res = await fetch('/test-paypal-webhook', { 
      method: 'POST',
      headers: { 'x-admin-secret': prompt('Admin secret:') }
    });
    const data = await res.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    result.textContent = 'Errore: ' + e.message;
  }
}

async function testHostaway() {
  const result = document.getElementById('result');
  result.textContent = 'Invio test Hostaway...';
  
  try {
    const res = await fetch('/test-hostaway-webhook', { 
      method: 'POST',
      headers: { 'x-admin-secret': prompt('Admin secret:') }
    });
    const data = await res.json();
    result.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    result.textContent = 'Errore: ' + e.message;
  }
}
</script>
</div>`);
});

// Endpoint test interni
app.post("/test-stripe-webhook", requireAdmin, async (req, res) => {
  const testData = {
    source: "Stripe",
    timestamp: new Date().toISOString(),
    eventType: "payment_intent.succeeded",
    paymentId: "test_" + Date.now(),
    amount: 150.00,
    currency: "EUR",
    status: "succeeded",
    customerEmail: "test@example.com",
    customerName: "Mario Rossi",
    description: "Test payment",
    metadata: "{}"
  };

  const result = await writeToGoogleSheets(testData);
  res.json({ ok: result.ok, testData, result });
});

app.post("/test-paypal-webhook", requireAdmin, async (req, res) => {
  const testData = {
    source: "PayPal",
    timestamp: new Date().toISOString(),
    eventType: "PAYMENT.CAPTURE.COMPLETED",
    paymentId: "test_" + Date.now(),
    amount: 200.00,
    currency: "EUR",
    status: "COMPLETED",
    customerEmail: "test@paypal.com",
    customerName: "Luigi Verdi",
    description: "Test PayPal payment",
    metadata: "{}"
  };

  const result = await writeToGoogleSheets(testData);
  res.json({ ok: result.ok, testData, result });
});

app.post("/test-hostaway-webhook", requireAdmin, async (req, res) => {
  const testData = {
    source: "Hostaway",
    timestamp: new Date().toISOString(),
    eventType: "reservation_created", // ← ALLINEATO AL FLUSSO REALE
    reservationId: "test_" + Date.now(),
    listingId: "194166",
    channelName: "Booking.com",
    guestName: "Anna Bianchi",
    guestEmail: "anna@example.com",
    guestPhone: "+39 123 456 7890",
    checkIn: "2026-02-15",
    checkOut: "2026-02-20",
    numberOfGuests: 2,
    status: "confirmed",
    isPaid: "Yes"
  };

  const result = await writeToGoogleSheets(testData);
  res.json({ ok: result.ok, testData, result });
});

// Test GET per iPhone
app.get("/test-stripe-simple", async (req, res) => {
  const secret = req.query.secret;
  if (!safeEqual(secret || "", ADMIN_SECRET)) {
    return res.status(403).send("unauthorized");
  }

  const testData = {
    source: "Stripe",
    timestamp: new Date().toISOString(),
    eventType: "payment_intent.succeeded",
    paymentId: "test_" + Date.now(),
    amount: 150.00,
    currency: "EUR",
    status: "succeeded",
    customerEmail: "test@example.com",
    customerName: "Mario Rossi",
    description: "Test payment",
    metadata: "{}"
  };

  const result = await writeToGoogleSheets(testData);
  res
    .type("html")
    .send(`<h1>Test Completato</h1><pre>${JSON.stringify({ ok: result.ok, testData, result }, null, 2)}</pre>`);
});

// ========================================================================
// Server
// ========================================================================
// ========================================================================
// TEST MANUALE INVIO A GOOGLE APPS SCRIPT (TEMPORANEO)
// ========================================================================

app.get("/test-gs", async (req, res) => {
  try {
    await fetch(process.env.GS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "Stripe",
        eventType: "payment_intent.succeeded",
        paymentId: "test_manual_001",
        amount: 150,
        currency: "EUR",
        status: "succeeded",
        customerEmail: "test@example.com",
        customerName: "Mario Rossi",
        description: "Manual test"
      })
    });

    res.send("OK – webhook inviato a Google Apps Script");
  } catch (err) {
    console.error("❌ Errore test-gs:", err);
    res.status(500).send("ERRORE: " + err.message);
  }
});
app.post("/allegria-info", express.urlencoded({ extended: true }), async (req, res) => {
  const { email } = req.body;
 // === SALVATAGGIO LEAD SU GOOGLE SHEET (Webhook) ===
try {
 await axios.post(process.env.GS_WEBHOOK_URL, {
  source: "Allegria Landing",
  timestamp: new Date().toISOString(),
  email: email,
  ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || ""
});

  console.log("Lead salvato:", email);
} catch (err) {
  console.error("Errore salvataggio lead:", err.message);
}
  res.send("Grazie. Riceverai le informazioni via email tra pochi minuti.");

  setTimeout(async () => {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      });

      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Informazioni sul servizio Allegria",
        text: "In allegato trovi il PDF con la spiegazione completa del servizio Allegria.",
        attachments: [
          {
            filename: "Allegria.pdf",
            path: "public/allegria/Allegria.pdf"
          }
        ]
      });

      console.log("Email inviata a:", email);
    } catch (err) {
      console.error("Errore invio email:", err);
    }
  }, 600000); // 10 minuti
});
async function getConversationId(reservationId) {
  try {
    const r = await axios.get(
      `https://api.hostaway.com/v1/conversations?reservationId=${reservationId}&limit=1`,
      { headers: { Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}` }, timeout: 8000 }
    );
    return r.data?.result?.[0]?.id || null;
  } catch (e) {
    console.error("❌ getConversationId error:", e.message);
    return null;
  }
}
async function initScheduledSlots() {
  try {
    console.log("🚀 Init slot al boot...");
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const r = await axios.get(
     `https://api.hostaway.com/v1/conversations?checkInStartDate=${today}&checkInEndDate=${today}&limit=50`,


      { headers: { Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}` }, timeout: 10000 }
    );
    const reservations = r.data?.result || [];
    console.log(`📋 Prenotazioni trovate al boot: ${reservations.length}`);
    for (const res of reservations) {
      const checkInDate = res.arrivalDate || res.checkInDate;
      if (!checkInDate) continue;
      if (checkInDate !== today) continue;
      const arrivalTime = res.arrivalTime || null;
      const slots = decideSlots(arrivalTime);
      const guestLang = (res.guestLanguage || "en").slice(0, 2).toLowerCase();
      scheduleSlotMessages({
        reservationId: res.id,
        conversationId: await getConversationId(res.id),
        apartment: res.listingMapId,
        slots,
        sendFn: (params) => sendSlotLiveMessage({ ...params, lang: guestLang }),
        checkInDate
      });
    }
  } catch (e) {
    console.error("❌ initScheduledSlots error:", e.message);
  }
}
// Ogni giorno alle 07:00 ricarica gli slot del giorno
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 7 && now.getMinutes() === 0) {
    console.log("🔄 Cron giornaliero slot...");
    await initScheduledSlots();
  }
}, 60000); // controlla ogni minuto


const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log("Server running on", PORT);
  await initScheduledSlots();
});
