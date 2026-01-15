import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
 import bodyParser from "body-parser";
import { matchIntent } from "./matcher.js";
import { ANSWERS } from "./answers.js";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

const app = express();
const rawBodySaver = (req, res, buf) => {
  req.rawBody = buf;
};

app.use(bodyParser.json({
  verify: rawBodySaver,
  limit: "100kb"
}));
app.disable("x-powered-by");
app.set("trust proxy", true);
 

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
    const {
      body: message,
      guestName,
      reservationId,
      conversationId,
      listingMapId: listingId,
      guestLanguage
    } = req.body || {};

    // ======================================================
    // ð Resolve Listing ID from reservation (HostAway)
    // ======================================================
    let resolvedListingId = listingId;

    if (!resolvedListingId && reservationId) {
      try {
        console.log("ð Fetching reservation from HostAway:", reservationId);

        const r = await axios.get(
          `https://api.hostaway.com/v1/reservations/${reservationId}`,
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

    console.log("ð STEP 1: Extract Data");
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
    // ð¯ STEP 3: Match Intent + Language
    // ======================================================
    const match = matchIntent(message);
    console.log("ð¯ Matcher result:", match || "NONE");

    if (!match || !match.intent) {
      console.log("ð No intent â silent");
      return res.json({ ok: true, silent: true });
    }

    const { intent, language: detectedLang } = match;

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

    const apartment = LISTING_TO_APARTMENT[String(resolvedListingId)];

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

    if (!answer) {
      console.log("ð No answer for language â silent");
      return res.json({ ok: true, silent: true });
    }

    console.log("  â Answer found");
    console.log("  ââ Language used:", usedLang);
    console.log("  ââ Preview:", answer.substring(0, 80) + "...");

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
// HOSTAWAY BOOKING WEBHOOK (prenotazioni, non solo chat)
// ========================================================================

   // 🔧 HOSTAWAY BOOKING WEBHOOK - VERSIONE CORRETTA
app.post("/hostaway-booking-webhook", async (req, res) => {
  console.log("🏠 HOSTAWAY BOOKING:", JSON.stringify(req.body, null, 2));
  
  // ✅ Risposta immediata 200 OK
  res.status(200).json({ received: true });
  
  try {
    // Verifica firma se configurata
  
    
    // 📊 Hostaway standard payload structure
    const data = req.body;
    const reservation = data.reservation || data || {};
    
    // Mappa listingId → appartamento per report
    const LISTING_MAP = {
      "194166": "Arenula", "194165": "Portico", "194163": "Leonina", 
      "194164": "Trastevere", "194162": "Scala"
    };
    
    const rowData = {
      source: "Hostaway",
      timestamp: new Date().toISOString(),
      eventType: data.event || "booking_event",
      reservationId: reservation.reservationId || reservation.id || data.reservationId,
      listingId: resolvedListingId,
      apartment: apartment,
      guestName: reservation.guestName || reservation.guestFirstName + " " + reservation.guestLastName || "",
      guestEmail: reservation.guestEmail || "",
      guestPhone: reservation.guestPhone || reservation.phone || "",
      checkIn: reservation.checkIn || reservation.arrivalDate || "",
      checkOut: reservation.checkOut || reservation.departureDate || "",
      nights: reservation.nights || "",
      guests: reservation.numberOfGuests || "",
      status: reservation.status || "confirmed",
      channel: reservation.channelName || reservation.source || "",
      isPaid: reservation.isPaid ? "Yes" : "No"
    };
    
    // ✅ Usa LA STESSA URL del feedback che funziona
      await axios.post(
  "https://script.google.com/macros/s/AKfycbyBSm76cluEYl8A1T0yc3Jf7tDszUPhJW6LeRU-ISVyIRdTsSWjgfST7ExPAJdJ122s/exec",
  rowData,
  {
    headers: { "Content-Type": "application/json" },
    timeout: 10000
  }
);
    console.log("✅ Prenotazione scritta su Sheets:", rowData.reservationId);
    
  } catch (err) {
    console.error("❌ Errore Hostaway webhook:", err.message);
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
