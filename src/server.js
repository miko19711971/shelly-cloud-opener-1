import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.set("trust proxy", true);   // ✅ garantisce HTTPS su Render
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

// ========= ROTAZIONE HARD-CODED =========
const ROTATION_TAG   = "R-2025-09-18-final";
const TOKEN_VERSION  = 100;
const LINK_PREFIX    = "/k3";
const SIGNING_SECRET = `${TOKEN_SECRET}|${ROTATION_TAG}`;
const REVOKE_BEFORE  = parseInt(process.env.REVOKE_BEFORE || "0", 10);
const STARTED_AT     = Date.now();

// Limiti sicurezza default
const DEFAULT_WINDOW_MIN = parseInt(process.env.WINDOW_MIN || "15", 10);
const DEFAULT_MAX_OPENS  = parseInt(process.env.MAX_OPENS  || "2", 10);
const GUIDE_WINDOW_MIN   = 1440;   // ⏱ 24 ore validità guide

// ======== CSP per le guide =========
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
app.use(["/checkin", "/guides", "/guest-assistant"], setGuideSecurityHeaders);

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

// ========= STATIC =========
app.use(express.static(PUBLIC_DIR));
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guest-assistant"), { fallthrough: false }));

// Redirect vecchi percorsi → nuove guide
app.get(["/checkin/scala", "/checkin/scala/index.html"], (req, res) => res.redirect(301, "/guides/scala/"));
app.get(["/checkin/leonina", "/checkin/leonina/index.html"], (req, res) => res.redirect(301, "/guides/leonina/"));
app.get(["/checkin/arenula", "/checkin/arenula/index.html"], (req, res) => res.redirect(301, "/guides/arenula/"));
app.get(["/checkin/trastevere", "/checkin/trastevere/index.html"], (req, res) => res.redirect(301, "/guides/trastevere/"));
app.get(["/checkin/portico", "/checkin/portico/index.html"], (req, res) => res.redirect(301, "/guides/portico/"));

// ========= MAPPATURA DISPOSITIVI =========
const TARGETS = {
  "arenula-building":         { name: "Arenula 16 — Building Door",                ids: ["3494547ab05e"] },
  "leonina-door":             { name: "Leonina 71 — Apartment Door",               ids: ["3494547a9395"] },
  "leonina-building":         { name: "Building Door",                             ids: ["34945479fd73"] },
  "via-della-scala-door":     { name: "Via della Scala 17 — Apartment Door",       ids: ["3494547a1075"] },
  "via-della-scala-building": { name: "Via della Scala 17 — Building Door",        ids: ["3494547745ee", "3494547745ee"] },
  "portico-1d-door":          { name: "Portico d'Ottavia 1D — Apartment Door",     ids: ["3494547a887d"] },
  "portico-1d-building":      { name: "Portico d'Ottavia 1D — Building Door",      ids: ["3494547ab62b"] },
  "viale-trastevere-door":    { name: "Viale Trastevere 108 — Apartment Door",     ids: ["34945479fa35"] },
  "viale-trastevere-building":{ name: "Building Door",                             ids: ["34945479fbbe"] },
};

const RELAY_CHANNEL = 0;

// ========== HELPER: chiamate Shelly Cloud ==========
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

async function openOne(deviceId) {
  const first = await shellyTurnOn(deviceId);
  if (first.ok) return { ok: true, first };
  return { ok: false, first };
}
async function openSequence(ids, delayMs = 10000) {
  const logs = [];
  for (let i = 0; i < ids.length; i++) {
    const r = await openOne(ids[i]);
    logs.push({ step: i + 1, device: ids[i], ...r });
    if (i < ids.length - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  const ok = logs.every(l => l.ok);
  return { ok, logs };
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
  const [h, b, s] = token.split(".");
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
  const payload = { tgt: targetKey, exp, max, used: opts.used ?? 0, jti, iat: now, ver: TOKEN_VERSION };
  return { token: makeToken(payload), payload };
}

// ====== Landing HTML (bottone Apri per i link /k3/:target/:token) ======
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
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${targetName}</title><style>${pageCss()}</style></head><body><div class="wrap">
  <h1>${targetName}</h1>
  <button id="btn">Apri</button>
  <div class="muted" id="hint">Token valido · residuo stimato: <b id="left">${remaining}</b> · scade tra <span id="ttl">${expInSec}</span>s</div>
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
        if(j.ok){ okmsg.classList.remove('hidden'); if(typeof j.remaining==='number'){ leftEl.textContent=j.remaining; } }
        else { errmsg.textContent=JSON.stringify(j,null,2); errmsg.classList.remove('hidden'); }
      }catch(e){ errmsg.textContent=String(e); errmsg.classList.remove('hidden'); } 
      finally{ btn.disabled=false; }
    });
  </script></div></body></html>`;
}

// ====== GUIDE DINAMICHE (24h) ======
app.get("/guides/:apt", (req, res) => {
  const apt = req.params.apt;
  const { token } = newTokenFor(`guide-${apt}`, { windowMin: GUIDE_WINDOW_MIN, max: 50 });
  const url = `${req.protocol}://${req.get("host")}${LINK_PREFIX}/guide-${apt}/${token}`;
  res.redirect(302, url);
});

app.get(`${LINK_PREFIX}/guide-:apt/:token`, (req, res) => {
  const { apt, token } = req.params;
  const parsed = parseToken(token);
  if (!parsed.ok || Date.now() > parsed.payload.exp) return res.status(410).send("Guide link expired");
  res.sendFile(path.join(PUBLIC_DIR, "guides", apt, "index.html"));
});

// ====== Genera smart link (usato dai bottoni nelle guide) ======
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

// ====== Pagina intermedia sicura per i link /k3 (aperture) ======
app.get(`${LINK_PREFIX}/:target/:token`, (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");

  const parsed = parseToken(token);
  if (!parsed.ok) return res.status(410).send("Link non più valido");
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).send("Invalid link");
  if (Date.now() > p.exp) return res.status(410).send("Link scaduto");

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.type("html").send(landingHtml(target, targetDef.name, p));
});

app.post(`${LINK_PREFIX}/:target/:token/open`, async (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok:false, error:"unknown_target" });

  const parsed = parseToken(token);
  if (!parsed.ok) return res.status(410).json({ ok:false, error:"invalid" });
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok:false, error:"target_mismatch" });
  if (Date.now() > p.exp) return res.status(410).json({ ok:false, error:"expired" });

  let result;
  if (targetDef.ids.length === 1) result = await openOne(targetDef.ids[0]);
  else result = await openSequence(targetDef.ids, 10000);

  return res.json({ ok:true, opened: result });
});

// ====== Home di servizio (facoltativa) ======
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS).map(([key, t]) => {
    const ids = t.ids.join(", ");
    return `<tr>
      <td>${t.name}</td>
      <td><code>${ids}</code></td>
      <td><a href="/token/${key}">Crea link</a></td>
      <td><form method="post" action="${LINK_PREFIX}/${key}/DUMMY/open" onsubmit="alert('Usa prima /token per generare un link valido');return false;"><button disabled>Manual Open</button></form></td>
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

// ========= START =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(
    "Server running on", PORT,
    "TZ:", TIMEZONE,
    "TokenVer:", TOKEN_VERSION,
    "RotationTag:", ROTATION_TAG,
    "LinkPrefix:", LINK_PREFIX,
    "StartedAt:", STARTED_AT,
    "RevokeBefore:", REVOKE_BEFORE || "-"
  );
});
