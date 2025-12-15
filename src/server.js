import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
// Guest Assistant AI → JSON dinamico (guides-v2)
import { reply as guideAIreply } from "./guide-ai.js";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

 const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: true, limit: "50kb" }));
app.use(express.json({ limit: "100kb" }));

// ✅ CORS solo dove serve (non globale)
const corsOptions = {
  origin: (origin, cb) => {
    // Se non c’è Origin (curl/server-to-server) -> OK
    if (!origin) return cb(null, true);

    // Default: blocca TUTTO cross-origin (le tue pagine chiamano in same-origin, quindi non si rompe nulla)
    return cb(null, false);
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
};

const corsMw = cors(corsOptions);

// ========= STATIC PATHS =========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// ========= ENV BASE =========
const SHELLY_API_KEY  = process.env.SHELLY_API_KEY;
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET    = process.env.TOKEN_SECRET;
const HOSTAWAY_TOKEN  = process.env.HOSTAWAY_TOKEN;   // <-- nome come messo su render

const HOSTAWAY_WEBHOOK_BOOKING_SECRET = process.env.HOSTAWAY_WEBHOOK_BOOKING_SECRET;

// ========= ADMIN (route sensibili) =========
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error("❌ Missing ADMIN_SECRET env var");
  process.exit(1);
}

function requireAdmin(req, res, next) {
  const h = req.get("x-admin-secret") || "";
  if (!safeEqual(h, ADMIN_SECRET)) {
    return res.status(403).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

console.log("🔥 Hostaway token caricato:", HOSTAWAY_TOKEN ? "OK" : "MANCANTE");

if (!HOSTAWAY_TOKEN) {
  console.error("❌ Missing HOSTAWAY_TOKEN env var (risposte automatiche HostAway disattivate).");
}

if (!HOSTAWAY_WEBHOOK_BOOKING_SECRET) {
  console.error("❌ Missing HOSTAWAY_WEBHOOK_BOOKING_SECRET env var (webhook HostAway: tutte le richieste verranno rifiutate).");
}

if (!TOKEN_SECRET) {
  console.error("❌ Missing TOKEN_SECRET env var");
  process.exit(1);
}

const TIMEZONE             = process.env.TIMEZONE || "Europe/Rome";
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
  "leonina-building":         { name: "Via Leonina 71 — Building Door",            ids: ["34945479fbbe"] },
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
    return {
      ok: false,
      status: err?.response?.status || 500,
      data: err?.response?.data || String(err)
    };
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

// ========== TOKEN MONOUSO ==========
 function b64urlToBuf(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
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

  if (typeof payload.ver !== "number" || payload.ver !== TOKEN_VERSION) {
    return { ok: false, error: "bad_version" };
  }
  if (REVOKE_BEFORE && typeof payload.iat === "number" && payload.iat < REVOKE_BEFORE) {
    return { ok: false, error: "revoked" };
  }
  if (typeof payload.iat !== "number" || payload.iat < STARTED_AT) {
    return { ok: false, error: "revoked_boot" };
  }
  return { ok: true, payload };
}

function newTokenFor(targetKey, opts = {}) {
  const max       = opts.max ?? DEFAULT_MAX_OPENS;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const now       = Date.now();
  const exp       = now + windowMin * 60 * 1000;
  const jti       = b64url(crypto.randomBytes(9));

  const payload = {
    tgt: targetKey,
    exp,
    max,
    used: opts.used ?? 0,
    jti,
    iat: now,
    ver: TOKEN_VERSION,
    day: opts.day
  };

  return { token: makeToken(payload), payload };
}

// ====== Time helpers (Europe/Rome) ======
const fmtDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const TODAY_LOCK = new Map(); // 🔒 memorizza il giorno di utilizzo di ogni appartamento

// 🔒 Limita riuso token /k3 (per jti) — in memoria
const OPEN_USAGE = new Map(); // key -> { count, exp }

function usageKey(p) {
  return `${p.tgt}:${p.jti}`;
}

function getUsage(p) {
  const key = usageKey(p);
  const u = OPEN_USAGE.get(key);
  // se scaduto, pulisci
  if (u && u.exp && Date.now() > u.exp) {
    OPEN_USAGE.delete(key);
    return { count: 0, exp: p.exp };
  }
  return u || { count: 0, exp: p.exp };
}

// YYYY-MM-DD nel fuso definito
function tzToday() {
  return fmtDay.format(new Date());
}

function isYYYYMMDD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

 

// ====== Normalizzatore formati data Hostaway → YYYY-MM-DD ======
const MONTHS_MAP = (() => {
  const m = new Map();

  // Inglese
  [
    "january","february","march","april","may","june",
    "july","august","september","october","november","december"
  ].forEach((n, i) => m.set(n, i + 1));

  [
    "jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"
  ].forEach((n, i) => m.set(n, i + 1));

  // Italiano
  [
    ["gennaio","gen"],["febbraio","feb"],["marzo","mar"],["aprile","apr"],
    ["maggio","mag"],["giugno","giu"],["luglio","lug"],["agosto","ago"],
    ["settembre","set"],["ottobre","ott"],["novembre","nov"],["dicembre","dic"]
  ].forEach(([full, short], i) => {
    m.set(full, i + 1);
    m.set(short, i + 1);
  });

  // Spagnolo
  [
    ["enero","ene"],["febrero","feb"],["marzo","mar"],["abril","abr"],
    ["mayo","may"],["junio","jun"],["julio","jul"],["agosto","ago"],
    ["septiembre","sep"],["octubre","oct"],["noviembre","nov"],["diciembre","dic"]
  ].forEach(([full, short], i) => {
    m.set(full, i + 1);
    m.set(short, i + 1);
  });

  // Francese (senza diacritici)
  [
    ["janvier","jan"],["février","fevrier"],["mars","mar"],["avril","avr"],
    ["mai","mai"],["juin","juin"],["juillet","juillet"],["août","aout"],
    ["septembre","sep"],["octobre","oct"],["novembre","nov"],["décembre","decembre"]
  ].forEach(([full, short], i) => {
    const f = full.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const s = short.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    m.set(f, i + 1);
    m.set(s, i + 1);
  });

  // Tedesco
  [
    ["januar","jan"],["februar","feb"],["märz","marz"],["april","apr"],
    ["mai","mai"],["juni","jun"],["juli","jul"],["august","aug"],
    ["september","sep"],["oktober","okt"],["november","nov"],["dezember","dez"]
  ].forEach(([full, short], i) => {
    const f = full.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const s = short.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    m.set(f, i + 1);
    m.set(s, i + 1);
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

  // pulizia base: togli virgole, normalizza spazi e diacritici
  const sClean = s
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  // 1) YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(sClean)) return sClean;

  // 2) DD/MM/YYYY o DD-MM-YYYY
  let m = sClean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d  = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y  = parseInt(m[3], 10);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  // 3) DD MMM YYYY o DD MMMM YYYY (multilingua)
  m = sClean.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m) {
    const d       = parseInt(m[1], 10);
    const monName = m[2];
    const y       = parseInt(m[3], 10);
    const mo      = MONTHS_MAP.get(monName);
    if (mo && d >= 1 && d <= 31) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  return null;
}

// ====== Landing HTML (pagina intermedia /k3/:target/:token) ======
function pageCss() {
  return `
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}
  .wrap{max-width:680px}
  h1{font-size:28px;margin:0 0 8px}
  p{color:#444}
  button{font-size:18px;padding:10px 18px;border:1px solid #333;border-radius:8px;background:#fff;cursor:pointer}
  .muted{color:#777;font-size:14px;margin-top:14px}
  .ok{color:#0a7b34}
  .err{color:#b21a1a;white-space:pre-wrap}
  .hidden{display:none}
`;
}

function landingHtml(targetKey, targetName, tokenPayload) {
  const remaining = Math.max(
    0,
    (tokenPayload?.max || 0) - (tokenPayload?.used || 0)
  );
  const expInSec = Math.max(
    0,
    Math.floor((tokenPayload.exp - Date.now()) / 1000)
  );
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
    const btn=document.getElementById('btn'),
          okmsg=document.getElementById('okmsg'),
          errmsg=document.getElementById('errmsg'),
          leftEl=document.getElementById('left'),
          ttlEl=document.getElementById('ttl');
    let ttl=${expInSec};
    setInterval(()=>{ if(ttl>0){ttl--; ttlEl.textContent=ttl;} },1000);
    btn.addEventListener('click', async ()=>{ 
      btn.disabled=true; okmsg.classList.add('hidden'); errmsg.classList.add('hidden');
      try{
        const res=await fetch(window.location.pathname+'/open',{method:'POST'}); 
        const j=await res.json();
        if(j.ok){
          okmsg.classList.remove('hidden');
          if(typeof j.remaining==='number'){ leftEl.textContent=j.remaining; }
          if(j.nextUrl){ try{history.replaceState(null,'',j.nextUrl);}catch(_){}} 
        } else {
          errmsg.textContent=JSON.stringify(j,null,2);
          errmsg.classList.remove('hidden');
        }
      }catch(e){
        errmsg.textContent=String(e);
        errmsg.classList.remove('hidden');
      } finally {
        btn.disabled=false;
      }
    });
  </script></div></body></html>`;
}

// ====== Home di servizio (facoltativa) ======
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS)
    .map(([key, t]) => {
      const ids = t.ids.join(", ");
      return `<tr>
      <td>${t.name}</td>
      <td><code>${ids}</code></td>
      <td><a href="/token/${key}">Crea link</a></td>
      <td><form method="post" action="/api/open-now/${key}" style="display:inline"><button>Manual Open</button></form></td>
    </tr>`;
    })
    .join("\n");

  res
    .type("html")
    .send(`<!doctype html><html><head><meta charset="utf-8"/><style>
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
  const target    = TARGETS[targetKey];
  if (!target) {
    return res.status(404).json({ ok: false, error: "unknown_target" });
  }

  const windowMin = parseInt(req.query.mins || DEFAULT_WINDOW_MIN, 10);
  const maxOpens  = parseInt(req.query.max  || DEFAULT_MAX_OPENS, 10);

  const { token, payload } = newTokenFor(targetKey, {
    windowMin,
    max: maxOpens,
    used: 0
  });

  const url = `${req.protocol}://${req.get("host")}${LINK_PREFIX}/${targetKey}/${token}`;
  return res.json({
    ok: true,
    url,
    expiresInMin: Math.round((payload.exp - Date.now()) / 60000)
  });
});

// 🔥 Vecchi link disattivati
app.all("/k/:target/:token",       (req, res) => res.status(410).send("Link non più valido."));
app.all("/k/:target/:token/open",  (req, res) => res.status(410).json({ ok: false, error: "gone" }));
app.all("/k2/:target/:token",      (req, res) => res.status(410).send("Link non più valido."));
app.all("/k2/:target/:token/open", (req, res) => res.status(410).json({ ok: false, error: "gone" }));

// ====== /k3 landing + open ======
app.get(`${LINK_PREFIX}/:target/:token`, (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");

  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = ["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error) ? 410 : 400;
    const msg  =
      parsed.error === "bad_signature" ? "Link non più valido (firma)." :
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
  if (!targetDef) {
    return res.status(404).json({ ok: false, error: "unknown_target" });
  }

  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = ["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error) ? 410 : 400;
    return res.status(code).json({ ok: false, error: parsed.error });
  }

  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok: false, error: "target_mismatch" });
  if (Date.now() > p.exp) return res.status(400).json({ ok: false, error: "expired" });

// ✅ LIMITA RIUSO TOKEN (server-side, per jti)
const max = Number(p.max || 0); // 0 = illimitato
if (max > 0) {
  const u = getUsage(p);
  if (u.count >= max) {
    return res.status(429).json({ ok: false, error: "max_opens_reached" });
  }

  let result;
  if (targetDef.ids.length === 1) {
    result = await openOne(targetDef.ids[0]);
  } else {
    result = await openSequence(targetDef.ids, 10000);
  }

  return res.json({ ok: true, opened: result });
});

// ✅ “apri subito” interno
app.all("/api/open-now/:target", (req, res) => {
  const targetKey = req.params.target;
  const targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).send("Unknown target");

  const { token } = newTokenFor(targetKey, {
    windowMin: DEFAULT_WINDOW_MIN,
    max: DEFAULT_MAX_OPENS,
    used: 0
  });

  return res.redirect(302, `${LINK_PREFIX}/${targetKey}/${token}`);
});

// ====== GUIDES STATICHE SEMPRE ACCESSIBILI ======
app.use("/guides",          express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
// ====== VIRTUAL GUIDE AI (JSON + risposte automatiche) ======
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
app.use("/guides-v2",       express.static(path.join(PUBLIC_DIR, "guides-v2"), { fallthrough: false }));
app.use("/public-test-ai-html", express.static(path.join(PUBLIC_DIR, "public-test-ai-html"), { fallthrough: false }));

// --- ALIAS: /checkin/:apt/today  (valido SOLO oggi) ---
// ✅ PATCH: /checkin/:apt/today — valido solo il giorno in cui viene usato
app.get("/checkin/:apt/today", (req, res) => {
  const apt   = req.params.apt.toLowerCase();
  const today = tzToday();

  // Se non è mai stato usato, blocco al giorno corrente
  if (!TODAY_LOCK.has(apt)) TODAY_LOCK.set(apt, today);

  // ✅ Consentiamo fino alle 04:00 del mattino successivo
  const now     = new Date();
  const hour    = now.getHours();
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
  let day   = normalizeCheckinDate(raw);

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
  const apt   = req.params.apt.toLowerCase();
  const today = tzToday();

  // 1) leggi raw e normalizza
  const raw = (req.query.d || "").toString();
  let day   = normalizeCheckinDate(raw);

  // 2) se mancante/non valida -> fallback opzionale a oggi
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) {
      day = today;
    } else {
      return res
        .status(410)
        .send("Questo link richiede la data di check-in (?d), es. ?d=2025-09-22.");
    }
  }

  // 3) vincolo: valido SOLO nel giorno di check-in (Europe/Rome)
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

// Pagina protetta: verifica token + giorno
app.get("/checkin/:apt/index.html", (req, res) => {
  const apt = req.params.apt.toLowerCase();
  const t   = String(req.query.t || "");
  const parsed = parseToken(t);

  if (!parsed.ok) return res.status(410).send("Questo link non è più valido.");
  const { tgt, day } = parsed.payload || {};
  if (tgt !== `checkin-${apt}`)        return res.status(410).send("Link non valido.");
  if (!isYYYYMMDD(day) || day !== tzToday()) {
    return res.status(410).send("Questo link è valido solo nel giorno di check-in.");
  }

  res.sendFile(path.join(PUBLIC_DIR, "checkin", apt, "index.html"));
});

// ========= STATIC (asset) =========
app.use("/checkin",        express.static(path.join(PUBLIC_DIR, "checkin"), { fallthrough: false }));
 
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
    const raw  = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    guidesCache.set(aptKey, json);
    return json;
  } catch (err) {
    console.error("❌ Impossibile leggere guida JSON per", aptKey, filePath, err.message);
    return null;
  }
}

 /**
 * Normalizza la lingua richiesta rispetto a quelle disponibili nel JSON.
 * - lang: stringa richiesta (es. "en", "de-DE", "auto" già risolta prima)
 * - availableFromJson: array di lingue disponibili (es. ["en","it","fr","de","es"])
 */
function normalizeLang(lang, availableFromJson) {
  const fallback  = "en";
  const known     = ["it", "en", "fr", "de", "es"];
  const requested = (lang || "").toLowerCase().slice(0, 2);

  const list = Array.isArray(availableFromJson)
    ? availableFromJson.map(l => String(l).toLowerCase().slice(0, 2))
    : [];

  // Tieni solo lingue “serie”, deduplicate
  const available = [...new Set(list.filter(code => known.includes(code)))];

  // Se il JSON espone lingue disponibili, cerco di restare dentro a quelle
  if (available.length) {
    if (available.includes(requested)) return requested;   // lingua richiesta supportata
    if (available.includes(fallback))  return fallback;    // altrimenti inglese, se c’è
    return available[0];                                   // altrimenti la prima disponibile
  }

  // Se il JSON non dichiara lingue, uso solo la richiesta se è “nota”
  if (known.includes(requested)) return requested;
  return fallback;
}
 function normalizeNoAccents(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // ✅ unifica varianti Wi-Fi / Wi Fi
    .replace(/\bwi\s+fi\b/g, "wifi")
    // ✅ unifica W LAN / W-LAN
    .replace(/\bw\s+lan\b/g, "wlan")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 🔎 Match con parole chiave globali (multi-intent, max 2, emergenza prioritaria)
function findAnswerByKeywords(question, answersForLang) {
  const text = normalizeNoAccents(question);
  if (!text) return null;

  const words = text.split(" ");

   // dentro findAnswerByKeywords()

const hasToken = (syn) => {
  const s = normalizeNoAccents(syn);
  if (!s) return false;

  const synTokens = s.split(" ").filter(Boolean);

  // 1 parola: match esatto sul token
  if (synTokens.length === 1) {
    return words.includes(synTokens[0]);
  }

  // frasi: match su token contigui (NO substring)
  for (let i = 0; i <= words.length - synTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < synTokens.length; j++) {
      if (words[i + j] !== synTokens[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};
  const KEYWORDS = {
    // WIFI / INTERNET
    wifi: [
      "wifi","wi fi","wi-fi","internet","wireless","router","wlan","network","ssid",
      "wifi password","wifi code","internet connection","connection","no connection","no internet",
      "slow wifi","slow internet","weak signal","no signal",
      "rete wifi","rete wi-fi","rete internet","password wifi","codice wifi",
      "connessione internet","connessione","nessuna connessione","niente internet",
      "segnale debole","nessun segnale","wifi lento","internet lento",
      "red wifi","clave wifi","contrasena wifi","internet wifi",
      "conexion internet","conexion","sin conexion","sin internet",
      "senal debil","sin senal","wifi lento","internet lento",
      "connexion wifi","connexion wi-fi","reseau wifi","mot de passe wifi","code wifi",
      "connexion internet","reseau","pas de connexion","pas d internet",
      "signal faible","pas de signal","wifi lent","internet lent",
      "wlan","w-lan","wlan verbindung","wlan passwort","wlan code",
      "internetverbindung","keine verbindung","kein internet",
      "schlechtes signal","kein signal","langsames wlan","langsames internet"
    ],

      wifi_troubleshooting: [
  // EN
  "wifi not working","internet not working","no internet","no connection",
  "slow wifi","slow internet","weak signal","wifi keeps disconnecting","wifi disconnects","unstable wifi",

  // IT
  "wifi non funziona","internet non funziona","non c e internet","nessuna connessione",
  "wifi lento","internet lento","segnale debole","si disconnette","wifi si disconnette","wifi instabile",

  // FR
  "wifi ne marche pas","internet ne marche pas","pas d internet","pas de connexion",
  "wifi lent","internet lent","signal faible","wifi se deconnecte","connexion instable",

  // DE
  "wlan funktioniert nicht","internet funktioniert nicht","kein internet","keine verbindung",
  "langsames wlan","langsames internet","schlechtes signal","wlan trennt sich","wlan instabil",

  // ES
  "wifi no funciona","internet no funciona","sin internet","sin conexion",
  "wifi lento","internet lento","senal debil","se desconecta","wifi inestable",

  // IT (extra)
  "non riesco a collegarmi",
  "non riesco a connettermi",
  "non si collega",
  "non si connette",
  "non mi connetto",
  "non va il wifi",
  "il wifi non va",
  "wifi non prende",
  "internet non va",

  // EN (extra)
  "i can't connect",
  "can't connect",
  "cannot connect",
  "won't connect",
  "it won't connect",
  "wifi won't connect",
  "wifi doesn't work",
  "internet doesn't work",

  // FR (extra)
  "je n'arrive pas a me connecter",
  "impossible de se connecter",
  "ca ne se connecte pas",
  "le wifi ne marche pas",
  "pas d'internet",

  // DE (extra)
  "ich kann mich nicht verbinden",
  "kann mich nicht verbinden",
  "verbindung klappt nicht",
  "es verbindet sich nicht",
  "wlan geht nicht",

  // ES (extra)
  "no puedo conectarme",
  "no me puedo conectar",
  "no conecta",
  "no se conecta",
  "el wifi no funciona"
],

water_troubleshooting: [
  // EN
  "no hot water","no water","water not working","low pressure","cold shower","shower is cold","no pressure",
  // IT
  "acqua calda non c e","non esce acqua","doccia fredda","pressione bassa","manca acqua","acqua non funziona","niente acqua",
  // FR
  "pas d eau chaude","pas d eau","eau ne marche pas","pression faible","douche froide","pas de pression",
  // DE
  "kein warmwasser","kein wasser","wasser funktioniert nicht","niedriger wasserdruck","dusche kalt","kein druck",
  // ES
  "no hay agua caliente","no hay agua","el agua no funciona","poca presion","ducha fria","no sale agua","sin presion"
],

electric_panel_troubleshooting: [
  // EN
  "power outage","no power","electricity is out","breaker","trip","tripped breaker","fuse box","electrical panel",
  // IT
  "salta la luce","manca la corrente","non c e corrente","quadro elettrico","interruttore generale","contatore","è saltata la luce",
  // FR
  "coupure de courant","pas de courant","plus d electricite","disjoncteur","tableau electrique","le disjoncteur a saute",
  // DE
  "stromausfall","kein strom","sicherung","sicherungen","sicherungskasten","strom ist weg","sicherung rausgeflogen",
  // ES
  "corte de luz","no hay luz","no hay electricidad","se fue la luz","cuadro electrico","interruptor general","disyuntor","saltaron los plomos"
],

heating_troubleshooting: [
  // EN
  "heating not working","heater not working","radiator not working","no heating","heating doesn t work","radiator is cold",
  // IT
  "riscaldamento non funziona","termosifoni non funzionano","non va il riscaldamento","non parte il riscaldamento","termosifoni freddi",
  // FR
  "chauffage ne marche pas","chauffage ne fonctionne pas","radiateur ne marche pas","pas de chauffage","radiateur froid",
  // DE
  "heizung funktioniert nicht","heizung geht nicht","heizkorper funktioniert nicht","keine heizung","heizkorper kalt",
  // ES
  "calefaccion no funciona","no funciona la calefaccion","no hay calefaccion","radiador no funciona","radiador frio","la calefaccion no arranca"
],

AC_troubleshooting: [
  // EN
  "ac not working","air conditioning not working","air conditioner not working","no cold air","no hot air",
  "ac doesn t work","not blowing cold","not blowing hot",
  // IT
  "aria condizionata non funziona","condizionatore non va","non esce aria fredda","non esce aria calda",
  "clima non funziona","non raffredda","non riscalda",
  // FR
  "clim ne marche pas","climatisation ne fonctionne pas","pas d air froid","pas d air chaud",
  "la clim ne refroidit pas","la clim ne chauffe pas",
  // DE
  "klima funktioniert nicht","klimaanlage geht nicht","keine kalte luft","keine warme luft",
  "klima kuehlt nicht","klima heizt nicht",
  // ES
  "aire acondicionado no funciona","el aire no funciona","no sale aire frio","no sale aire caliente",
  "no enfria","no calienta","el aire no enfria","el aire no calienta"
],

gas_troubleshooting: [
  // EN
  "gas not working","stove not working","cooktop not working","no flame","burner not working","won t ignite","doesn t ignite",
  // IT
  "gas non funziona","non esce gas","fornello non funziona","non si accende","fiamma non esce","non si accende il fornello",
  // FR
  "gaz ne marche pas","la cuisiniere ne marche pas","feu ne s allume pas","pas de flamme","bruleur ne marche pas",
  // DE
  "gas funktioniert nicht","kochfeld geht nicht","flamme","brenner funktioniert nicht","zuendet nicht","gasherd geht nicht",
  // ES
  "el gas no funciona","la cocina no funciona","no sale gas","no se enciende","no hay llama","el fuego no enciende","el quemador no funciona"
],

bathroom_troubleshooting: [
  // EN
  "toilet not working","toilet not flushing","clogged","blocked","toilet is blocked","sink is blocked","shower drain clogged",
  // IT
  "wc non scarica","scarico non funziona","water closet","bagno problema","wc intasato","lavandino intasato","scarico doccia intasato",
  // FR
  "toilettes bouchees","ne chasse pas","wc bouche","evacuation bouchee","lavabo bouche","douche bouchee",
  // DE
  "toilette verstopft","spulung funktioniert nicht","wc verstopft","abfluss verstopft","waschbecken verstopft","dusche verstopft",
  // ES
  "el bano no funciona","el inodoro no descarga","no tira la cadena","inodoro atascado","wc atascado","desague atascado","lavabo atascado","ducha atascada"
],

    // TRASH / SPAZZATURA / RIFIUTI
    trash: [
      "trash","garbage","rubbish","waste","trashcan","trash can","garbage can","trash bin","garbage bin","rubbish bin",
      "recycling","recycle","bin","trash bags","garbage bags",
      "spazzatura","immondizia","rifiuti","pattumiera","bidone","cestino","sacchetto","sacchetto della spazzatura",
      "raccolta differenziata","differenziata","secchio dell immondizia",
      "basura","residuos","papelera","cubo","contenedor","bolsa de basura",
      "reciclaje","reciclar",
      "poubelle","ordures","dechets","sac poubelle","tri selectif","poubelles",
      "mull","muell","abfall","mulleimer","mulltonne","abfalleimer","restmull","papierkorb"
    ],

    // HEATING / RISCALDAMENTO
    heating: [
      "heating","heater","radiator","central heating","heating system","warm air","turn on heating","temperature","thermostat",
      "riscaldamento","radiatori","termosifoni","caloriferi","impianto di riscaldamento","termosifone",
      "alzare la temperatura","abbassare la temperatura","termostato",
      "calefaccion","radiador","calor","calefaccion central","caldera","subir la temperatura","bajar la temperatura",
      "chauffage","radiateur","chauffage central","augmenter la temperature","baisser la temperature","thermostat",
      "heizung","heizkorper","heizanlage","heizung anmachen","heizung ausmachen","thermostat"
    ],

    // GAS / STOVE / COOKTOP
    gas: [
      "gas","gas stove","stove","hob","cooktop","burner","cooker","gas cooker","gas on","gas off","flame","ignite","ignition",
      "fornello","fornelli","piano cottura","fuochi","manopola gas","rubinetto gas","valvola gas",
      "accendere il gas","accendere i fornelli","spegnere il gas",
      "cocina de gas","fogones","fogon","hornilla","fuego","llama gas","encender gas","apagar gas",
      "gaziniere","cuisiniere gaz","bruleur","feu gaz","allumer le gaz","eteindre le gaz",
      "gasherd","kochfeld","brenner","gasflamme","gas anmachen","gas ausmachen"
    ],

    // AC / ARIA CONDIZIONATA
    AC: [
      "air conditioning","air conditioner","ac","aircon","cooling","cold air","fan mode","turn on ac","turn off ac",
      "aria condizionata","clima","condizionatore","aria fredda","aria calda","pompa di calore",
      "accendere il clima","spegnere il clima","accendere l aria condizionata","spegnere l aria condizionata",
      "aire acondicionado","ac","aire frio","aire caliente","encender aire acondicionado","apagar aire acondicionado",
      "clim","climatisation","air climatise","allumer la clim","eteindre la clim",
      "klima","klimaanlage","klima anmachen","klima ausmachen","kalte luft","warme luft"
    ],

    // WATER / ACQUA  ← ORA VIENE PRIMA DI BATHROOM
    water: [
      "water","hot water","cold water","no water","tap water","water pressure","boiler","water heater","shower water",
      "shower is cold","no hot water","no pressure",
      "acqua","acqua calda","acqua fredda","manca acqua","senza acqua","pressione acqua",
      "caldaia","scaldabagno","rubinetto","doccia senza acqua","doccia fredda","non esce acqua",
      "agua","agua caliente","agua fria","sin agua","ducha sin agua","ducha fria",
      "presion agua","termo","calentador","no sale agua",
      "eau","eau chaude","eau froide","pas d eau","pression eau","chauffe eau","robinet",
      "pas d eau chaude","douche froide","pas d eau dans la douche",
      "wasser","warmwasser","kaltwasser","kein wasser","wasserdruck","boiler","wasserboiler","durchlauferhitzer",
      "dusche kalt","kein warmwasser","kein wasser im bad"
    ],

    // TRANSPORT / TRASPORTI
    transport: [
      "bus","tram","tramway","metro","subway","underground","train","public transport","transport","taxi","airport","station",
      "bus stop","tram stop","metro station","go to center","go to city centre","go downtown",
      "autobus","bus","tram","tramvia","metropolitana","metro","treno","trasporti","trasporto pubblico","mezzi pubblici",
      "fermata","fermata autobus","fermata bus","fermata tram","fermata metro",
      "come andare in centro","andare in centro","centro citta","aeroporto","stazione",
      "autobus","metro","tranvia","parada","parada de autobus","parada de bus","parada de metro",
      "transporte publico","ir al centro","centro ciudad","aeropuerto","estacion",
      "bus","tramway","metro","gare","station","aeroport","taxi",
      "transports publics","transport public","arret de bus","arret de tram","station de metro",
      "aller au centre ville","centre ville",
      "bus","strassenbahn","straßenbahn","bahn","ubahn","u bahn","s bahn","sbahn","haltestelle",
      "offentliche verkehrsmittel","oeffentliche verkehrsmittel",
      "bahnhof","flughafen","ins zentrum","stadtzentrum"
    ],

    // EMERGENCY / EMERGENZE
    emergency: [
      "emergency","urgent","urgency","er","emergency room","hospital","doctor","ambulance","help",
      "emergenza","urgenza","pronto soccorso","ospedale","medico","ambulanza","aiuto","ho bisogno di aiuto",
      "emergencia","urgencias","hospital","ambulancia","ayuda","necesito ayuda",
      "urgence","urgences","hopital","hospital","ambulance","besoin d aide","au secours",
      "notfall","notruf","krankenhaus","rettungswagen","ambulanz","hilfe","ich brauche hilfe"
    ],

    // CHECK-IN
    check_in: [
      "check in","check-in","checkin","arrival","arrive","check in time","self check in","early check in",
      "keys","key collection","access code","door code",
      "check in","arrivo","orario di arrivo","accesso","ingresso","codice portone","codice porta","ritiro chiavi",
      "come faccio il check in","self check in",
      "check in","llegada","hora de llegada","entrada","codigo puerta","codigo de acceso","self check in",
      "check in","arrivee","heure d arrivee","entree","code porte","code d acces","self check in",
      "check in","einchecken","ankunft","ankunftszeit","zugang","turcode","tuer code","schloss code"
    ],

    // CHECK-OUT
    check_out: [
      "check out","check-out","checkout","leave","departure","departure time","check out time","late check out",
      "what time is check out","leave the keys","where to leave the keys",
      "check out","uscita","partenza","orario di uscita","late check out","rilascio appartamento",
      "a che ora e il check out","dove lascio le chiavi","lasciare le chiavi",
      "check out","salida","hora de salida","dejar apartamento","late check out",
      "a que hora es el check out","donde dejo las llaves","dejar las llaves",
      "check out","depart","heure de depart","sortie","late check out",
      "a quelle heure est le check out","ou laisser les cles","laisser les cles",
      "check out","auschecken","abreise","abfahrtszeit","wohnung verlassen","spater check out",
      "um wie viel uhr ist der check out","wann ist der check out","wo soll ich die schlussel lassen","schlussel abgeben"
    ],

    // BATHROOM / BAGNO  ← ORA IN FONDO, E SENZA "baño"
    bathroom: [
      "bathroom","toilet","wc","restroom","bath","shower","lavatory","washroom","toilet not flushing","no flush","bathroom problem",
      "bagno","wc","doccia","toilette","servizi","servizio","water","scarico non funziona","wc non scarica",
      "bano","aseo","ducha","servicio","wc","inodoro","no descarga",
      "salle de bain","salle de bains","toilettes","wc","douche","toilette bouchee","ne chasse pas",
      "bad","badezimmer","wc","toilette","dusche","toilette verstopft","spulung funktioniert nicht"
    ]
     
  };

  // trova TUTTI gli intent che matchano
  const foundIntents = [];
  for (const [key, synonyms] of Object.entries(KEYWORDS)) {
    if (!answersForLang[key]) continue;
    if (synonyms.some(hasToken)) {
      foundIntents.push(key);
    }
  }

  if (!foundIntents.length) return null;

  // deduplica
  const unique = [...new Set(foundIntents)];

  // priorità (emergency in testa, max 2 intent totali)
   const PRIORITY = [
  "emergency",
  "wifi_troubleshooting",
  "water_troubleshooting",
  "electric_panel_troubleshooting",
  "heating_troubleshooting",
  "AC_troubleshooting",
  "gas_troubleshooting",
  "bathroom_troubleshooting",
  "wifi",
  "water",
  "electric_panel",
  "heating",
  "AC",
  "gas",
  "bathroom",
  "trash",
  "check_in",
  "check_out",
  "transport"
];

  unique.sort((a, b) => {
    const ia = PRIORITY.indexOf(a);
    const ib = PRIORITY.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const selectedIntents = unique.slice(0, 3);
  const answers = selectedIntents
    .map((intent) => String(answersForLang[intent] || "").trim())
    .filter(Boolean);

  if (!answers.length) return null;

  const combinedAnswer = answers.join("\n\n");

  return {
    intents: selectedIntents,
    answer: combinedAnswer
  };
}

// ====== Estrazione robusta del nome guest dal payload HostAway ======
function extractGuestName(payload) {
  if (!payload || typeof payload !== "object") return "Guest";

  const direct =
    payload.guestName ||
    payload.guest_full_name ||
    payload.guestFullName ||
    payload.travellerName ||
    payload.contactName ||
    payload.firstName ||
    payload.first_name ||
    payload.guest_first_name;

  const nested =
    (payload.guest && (
      payload.guest.firstName ||
      payload.guest.first_name ||
      payload.guest.fullName ||
      payload.guest.name
    )) ||
    null;

  const name = direct || nested;
  if (!name || typeof name !== "string") return "Guest";

  const trimmed   = name.trim();
  const firstWord = trimmed.split(/\s+/)[0];
  return firstWord || "Guest";
}

 // ====== Riconoscimento lingua dal testo (IT / EN / FR / DE / ES) ======
function detectLangFromMessage(msg) {
  let text = normalizeNoAccents(msg || "");
  if (!text) return "en";

  // Fix Wi-Fi -> wifi (dopo la normalizzazione diventa "wi fi")
  text = text.replace(/\bwi\s*fi\b/g, "wifi");

  const tokens = text.split(" ").filter(Boolean);
  const has = (t) => tokens.includes(t);

  const scores = { de: 0, it: 0, es: 0, fr: 0, en: 0 };

  // 🇩🇪
  [
    "hallo","guten","danke","bitte","wohnung","warmwasser","kaltwasser","heizung",
    "schlussel","schluessel","tur","tuer","abreise","wlan","wasser"
  ].forEach(t => { if (has(t)) scores.de++; });

  // 🇮🇹 (token “veri” per i tuoi casi) — tolto "non" perché troppo generico
  [
    "ciao","buongiorno","buonasera","grazie","appartamento","casa",
    "spazzatura","immondizia","pattumiera","riscaldamento","termosifone",
    "doccia","bagno","uscita","chiavi",
    "riesco","collegarmi","connettermi","connessione",
    "acqua","rubinetto","potabile","calda","fredda","pressione","rete"
  ].forEach(t => { if (has(t)) scores.it++; });

  // 🇪🇸
  [
    "hola","gracias","apartamento","piso","ducha","bano","basura","salida","llaves",
    "agua","potable","caliente","fria","wifi","conexion"
  ].forEach(t => { if (has(t)) scores.es++; });

  // 🇫🇷
  [
    "bonjour","salut","merci","appartement","logement","poubelle","ordures","chauffage","eau",
    "sortie","cle","cles","wifi","connexion"
  ].forEach(t => { if (has(t)) scores.fr++; });

  // 🇬🇧 — tolto "wifi" per non spingere verso EN quando la frase è italiana
  [
    "hi","hello","thanks","thank","apartment","trash","garbage","network","password",
    "check","shower","bathroom","keys","water"
  ].forEach(t => { if (has(t)) scores.en++; });

  const order = ["it","es","fr","de","en"]; // preferisci IT quando i punteggi sono vicini
  let best = "en";
  let bestScore = 0;

  for (const lang of order) {
    if (scores[lang] > bestScore) {
      bestScore = scores[lang];
      best = lang;
    }
  }

// ✅ Se EN è a pari merito col migliore, preferisco EN
const top = Math.max(...Object.values(scores));
if (top > 0 && scores.en === top) return "en";

  return bestScore > 0 ? best : "en";
}
// Saluto in base alla lingua
function makeGreeting(lang, name) {
  const n    = name || "Guest";
  const code = String(lang || "en").slice(0, 2).toLowerCase();

  switch (code) {
    case "it":
      return `Caro ${n},`;
    case "es":
      return `Hola ${n},`;
    case "fr":
      return `Bonjour ${n},`;
    case "de":
      return `Hallo ${n},`;
    default:
      return `Hi ${n},`;
  }
}

/**
 * Endpoint API chiamato dalla Virtual Guide.
 *
 * BODY atteso (JSON):
 * {
 *   "apartment": "arenula" | "leonina" | "ottavia" | "scala" | "trastevere",
 *   "lang": "it" | "en" | "fr" | "de" | "es" | "auto",
 *   "question": "testo domanda dell'ospite"
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
    const guide  = await loadGuideJson(aptKey);

    if (!guide) {
      return res.status(404).json({
        ok: false,
        error: "guide_not_found",
        message: `Nessuna guida JSON trovata per '${aptKey}'.`
      });
    }

    // 👇 se lang manca o è "auto", rilevo dal testo
    let requestedLang = lang;
    if (!requestedLang || requestedLang === "auto") {
      requestedLang = detectLangFromMessage(question);
    }

    // 👇 ricavo le lingue disponibili dal JSON (compatibile con entrambe le strutture)
    const availableLangs =
      Array.isArray(guide.languages) && guide.languages.length
        ? guide.languages
        : guide.answers
          ? Object.keys(guide.answers)
          : Object.keys(guide);

    const language = normalizeLang(requestedLang, availableLangs);

    const answersForLang =
      (guide.answers && guide.answers[language]) ||
      guide[language] ||   // fallback vecchia struttura (come il tuo JSON di Arenula)
      {};

    let intentKey  = null;
    let answerText = null;
    let matched    = false;

    // 1) (futuro) se un domani usi findBestIntent
    if (guide.intents && guide.intents[language] && typeof findBestIntent === "function") {
      const k = findBestIntent(guide, language, question);
      if (k && answersForLang[k]) {
        intentKey  = k;
        answerText = answersForLang[k];
        matched    = true;
      }
    }

         // 2) Se non abbiamo ancora match, usa le parole chiave globali (multi-intent)
    if (!matched) {
      const match = findAnswerByKeywords(question, answersForLang);
      if (match && match.answer) {
        // prendiamo come "intent principale" il primo della lista
        const primary =
          Array.isArray(match.intents) && match.intents.length
            ? match.intents[0]
            : null;

        intentKey  = primary;
        answerText = match.answer;   // contiene già 1 o 2 risposte combinate
        matched    = true;
      }
    }
     

     if (!matched) {
  return res.json({
    ok: true,
    apartment: guide.apartment || aptKey,
    language,
    intent: null,
    answer: null,
    noMatch: true
  });
}

return res.json({
  ok: true,
  apartment: guide.apartment || aptKey,
  language,
  intent: intentKey,
  answer: answerText,
  noMatch: false
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
// Mappa condivisa listingId Hostaway → apartment key
const LISTING_TO_APARTMENT = {
  "194166": "arenula",     // Via Arenula 16
  "194165": "portico",     // Portico d'Ottavia 1D
  "194163": "leonina",     // Via Leonina 71
  "194164": "trastevere",  // Brand new flat in Trastevere, 4 min
  "194162": "scala"        // Via della Scala 17
};

app.post("/api/hostaway-ai-bridge", async (req, res) => {
  try {
    // LOG per vedere sempre cosa arriva da HostAway
    console.log("🔔 Hostaway webhook body:");
    console.log(JSON.stringify(req.body, null, 2));

    const payload = req.body || {};

    // 1) Testo del messaggio dell'ospite
    const message =
      payload.body ||
      payload.message ||
      (payload.communicationBody && payload.communicationBody.body) ||
      "";

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "missing_message",
        message: "Nel JSON non trovo il testo del messaggio (es. campo 'body')."
      });
    }

    // 2) Listing → nome appartamento interno
    const listingId = String(payload.listingMapId || payload.listingId || "");

    // Usa la mappa; se qualcosa non torna, default "arenula"
    const apartment = LISTING_TO_APARTMENT[listingId] || "arenula";

    // 3) Lingua (fallback 'en', ma corretta dal testo)
    const language = detectLangFromMessage(message);

    // 4) Nome guest se presente (estrazione robusta)
    const guestName = extractGuestName(payload);

    // 5) CHIAMO IL VERO GUEST ASSISTANT INTERNO
    const aiResponse = await axios.post(
      `${req.protocol}://${req.get("host")}/api/guest-assistant`,
      {
        apartment,        // es. "arenula"
        lang: language,   // 👈 importante: chiave "lang"
        question: message,
        guestName,
        source: "hostaway"
      },
      { timeout: 8000 }
    );

    const data = aiResponse.data || {};

     // ✅ gestione corretta: se noMatch o answer mancante → NON è un errore
if (!data.ok) {
  console.error("❌ guest-assistant error:", data);
  return res.status(502).json({
    ok: false,
    error: "guest_assistant_failed",
    details: data
  });
}

if (data.noMatch || !data.answer) {
  return res.json({
    ok: true,
    apartment,
    language,
    question: message,
    answer: null,
    noMatch: true
  });
}

    console.log("✅ AI answer for Hostaway:", data.answer);

    // 6) Risposta finale (per ora solo JSON, HostAway NON la usa ancora)
    return res.json({
      ok: true,
      apartment,
      language,
      question: message,
      answer: data.answer
    });
  } catch (err) {
    console.error("❌ Errore /api/hostaway-ai-bridge:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err.message
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

// ========== NUOVO ENDPOINT: HostAway → Email ospite VRBO ==========

// Per inviare le email sfruttiamo un piccolo ponte (Apps Script o altro servizio Mail)
 const MAILER_URL         = process.env.MAILER_URL || "https://script.google.com/macros/s/XXXXXXX/exec";
const MAIL_SHARED_SECRET = process.env.MAIL_SHARED_SECRET;

if (!MAIL_SHARED_SECRET) {
  console.error("❌ Missing MAIL_SHARED_SECRET env var");
  process.exit(1);
}
app.post("/hostaway-outbound", async (req, res) => {
  try {
    const { reservationId, guestEmail, guestName, message } = req.body || {};

    if (!guestEmail || !message) {
      console.log("❌ Dati insufficienti per invio email:", req.body);
      return res.status(400).json({
        ok: false,
        error: "missing_email_or_message"
      });
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
});

// ====== VRBO MAILER BRIDGE ======
  app.post("/api/vbro-mail", async (req, resInner) => {
    const { to, subject, body, secret } = req.body;
   if (!safeEqual(secret, process.env.MAIL_SHARED_SECRET)) {
  return resInner.status(403).json({ ok: false, error: "Unauthorized" });
}

    try {
      const response = await axios.post(
        `${process.env.MAILER_URL}?secret=${process.env.MAIL_SHARED_SECRET}`,
        { to, subject, htmlBody: body },
        { headers: { "Content-Type": "application/json" } }
      );
      console.log("📨 Email VRBO inviata con successo", response.status);
      return resInner.json({ ok: true });
    } catch (err) {
      console.error("❌ Errore invio mail:", err);
      return resInner.status(500).json({ ok: false, error: String(err) });
    }
  });

// ========== HOSTAWAY → AUTO RISPOSTA AI PER MESSAGGI ==========
 
app.post("/hostaway-incoming", async (req, res) => {
  try {
    console.log("🔔 Hostaway message webhook:");
    console.log(JSON.stringify(req.body, null, 2));

    const payload = req.body || {};

     // ✅ Webhook secret check — SOLO header (niente query/body)
 // ✅ Legge il secret da:
// 1) header custom x-hwwb-secret (utile per ReqBin)
// 2) Basic Auth (HostAway usa i campi Login/Password)
function getIncomingSecret(req) {
  const h = req.get("x-hwwb-secret");
  if (h) return h;

  const auth = req.get("authorization") || "";
  const m = auth.match(/^Basic\s+(.+)$/i);
  if (!m) return "";

  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8"); // "user:pass"
    const idx = decoded.indexOf(":");
    if (idx < 0) return "";
    const pass = decoded.slice(idx + 1);
    return pass || "";
  } catch {
    return "";
  }
}

const incomingSecret = getIncomingSecret(req);

if (!safeEqual(incomingSecret, HOSTAWAY_WEBHOOK_BOOKING_SECRET)) {
  return res.status(403).json({ ok: false, error: "unauthorized" });
}
    const listingId = payload.listingId || payload.listingMapId;
    const conversationId = payload.conversationId;

    // Estrai subito nome ed email
    const guestName = extractGuestName(payload);
    const guestEmail =
      payload.guestEmail ||
      payload.guestEmailAddress ||
      payload.email ||
      "";

    // Log di debug per capire dove sta il nome
    console.log("🔍 Name fields in payload:", {
      guestName_raw: payload.guestName,
      guest_first_name_raw: payload.guest_first_name,
      firstName_raw: payload.firstName,
      guestFullName_raw: payload.guestFullName,
      travellerName_raw: payload.travellerName,
      contactName_raw: payload.contactName,
      nested_guest: payload.guest || null,
      nested_contact: payload.contact || null,
      email_raw: guestEmail,
      extracted_guestName: guestName
    });

    // ==== TESTO VERO DEL MESSAGGIO DEL GUEST (SOLO ULTIMA COMUNICAZIONE) ====
    const communication = payload.communicationBody || {};

    const bodyFromCommunication =
      (communication && communication.body) || "";

    // fallback sugli altri campi solo se proprio vuoto
    const finalMessage =
      (bodyFromCommunication && bodyFromCommunication.trim()) ||
      payload.message ||
      payload.body ||
      "";

    // ---- LINGUA: prima proviamo a leggere dal payload, poi dal testo ----
    const languageRaw =
      communication.language ||
      payload.language ||
      "";

     const known = new Set(["it","en","fr","de","es"]);
const raw2 = String(languageRaw || "").slice(0, 2).toLowerCase();
const langCode = known.has(raw2) ? raw2 : detectLangFromMessage(finalMessage);

    // Controllo minimo: deve esserci almeno listingId e finalMessage
    if (!listingId || !finalMessage) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // Mappa ID listing → nome appartamento (solo per log / email)
    const LISTING_TO_APARTMENT = {
      "194166": "arenula",     // Via Arenula 16
      "194165": "portico",     // Portico d'Ottavia 1D
      "194163": "leonina",     // Via Leonina 71
      "194164": "trastevere",  // Brand new flat in Trastevere, 4 min
      "194162": "scala"        // Via della Scala 17
    };

    const apt = LISTING_TO_APARTMENT[String(listingId)] || "Appartamento";

    // Chiave usata dalla Virtual Guide
    const apartmentKey = LISTING_TO_APARTMENT[String(listingId)] || "arenula";

    const name = guestName || "Guest";
    const email = guestEmail || "";

    // 👉 Da ora: nessuna risposta se la guida non trova un match
    let aiReply = null;
    let aiMatched = false;

    try {
      const gaResp = await axios.post(
        `${req.protocol}://${req.get("host")}/api/guest-assistant`,
        {
          apartment: apartmentKey,
          lang: langCode,
          question: finalMessage,
          guestName: name,          // nome reale
          source: "hostaway"        // solo per log
        },
        { timeout: 8000 }
      );

      const data = gaResp.data || {};

       if (data.ok && data.answer && !data.noMatch) {
  aiReply = data.answer;
  aiMatched = true;
      } else { 
         console.log("⚠️ guest-assistant: noMatch o risposta mancante:", data);
      }
    } catch (err) {
      console.error("Errore Virtual Guide:", err.message);
      // nessun fallback: risponderai tu a mano dalla dashboard
    }

    // 2) Invio risposta nella chat Hostaway SOLO se abbiamo una risposta AI valida
    if (aiReply && HOSTAWAY_TOKEN && conversationId) {
      const greeting = makeGreeting(langCode, name);
      const fullReply = `${greeting}\n\n${aiReply}`;

      try {
        const hostawayUrl = `https://api.hostaway.com/v1/conversations/${conversationId}/messages`;
        const hostawayBody = {
          body: fullReply,
          communicationType: "email"
        };

        const haRes = await axios.post(hostawayUrl, hostawayBody, {
          headers: {
            Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
            "Content-Type": "application/json"
          },
          timeout: 10000
        });

        console.log("✅ Hostaway message sent:", haRes.data);
      } catch (err) {
        console.error(
          "❌ Errore invio a Hostaway:",
          err.response?.data || err.message
        );
      }
    } else {
      console.log("ℹ️ Nessuna risposta AI da inviare in HostAway (aiReply vuota o mancano token/conversationId).");
    }

    // 3) Email: se ho una risposta AI, mando SEMPRE una copia a Michele.
    //    Se ho anche l'email del guest, la mando anche a lui.
    if (aiReply) {
      try {
        if (!MAILER_URL || !MAIL_SHARED_SECRET) {
  console.log("ℹ️ Mailer disattivato: MAILER_URL/MAIL_SHARED_SECRET mancanti.");
  return res.json({ ok: true, mailer: "disabled" });
}
        const greeting = makeGreeting(langCode, name);
        const subject = `NiceFlatInRome – ${apt}`;
        const htmlBody = `
          <p>${greeting}</p>
          <p>${aiReply.replace(/\n/g, "<br>")}</p>
          <p><strong>Guest question:</strong> ${finalMessage || ""}</p>
          <p>Un saluto da Michele e dal team NiceFlatInRome.</p>
        `;

        // Copia la risposta anche via email a Michele
        await axios.post(
          `${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
          {
            to: "mikbondi@gmail.com",
            subject: `Copia risposta guest – ${apt}`,
            htmlBody
          },
          { headers: { "Content-Type": "application/json" }, timeout: 10000 }
        );

        // Invia al guest solo se l’email è presente
        if (email) {
          await axios.post(
            `${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
            { to: email, subject, htmlBody },
            { headers: { "Content-Type": "application/json" }, timeout: 10000 }
          );
        }

        console.log("📧 Email inviata a guest e copia a Michele");
      } catch (err) {
        console.error("❌ Errore invio email:", err.message);
      }
    }

    // Risposta JSON finale
    return res.json({
      ok: true,
      apartment: apt,
      language: langCode,
      aiReply,
      matched: aiMatched,
      guestName: name,
      guestEmail: email
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
