// server.js
import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// ========= STATIC =========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// cartella public (già usata per check-in ecc.)
const PUBLIC_DIR = path.join(__dirname, "..", "public");

// 1) continua a servire tutta la /public a root (com'era)
app.use(express.static(PUBLIC_DIR));

// 2) alias ESPICITO per le guide semplici sotto /guides (come avevi)
app.use("/guides", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));

// 2bis) NUOVO: alias per le Virtual Guide MULTILINGUA (bottone EN/4 lingue)
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guest-assistant"), { fallthrough: false }));

// 3) redirect 301 dai vecchi percorsi (se ne avevi) ai nuovi /guides/...
app.get(["/checkin/scala", "/checkin/scala/index.html"], (req, res) =>
  res.redirect(301, "/guides/scala/")
);
app.get(["/checkin/leonina", "/checkin/leonina/index.html"], (req, res) =>
  res.redirect(301, "/guides/leonina/")
);
app.get(["/checkin/arenula", "/checkin/arenula/index.html"], (req, res) =>
  res.redirect(301, "/guides/arenula/")
);
app.get(["/checkin/trastevere", "/checkin/trastevere/index.html"], (req, res) =>
  res.redirect(301, "/guides/trastevere/")
);
app.get(["/checkin/ottavia", "/checkin/ottavia/index.html", "/checkin/portico", "/checkin/portico/index.html"], (req, res) =>
  res.redirect(301, "/guides/portico/")
);

// ========= ENV =========
const SHELLY_API_KEY  = process.env.SHELLY_API_KEY;
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET = process.env.TOKEN_SECRET;
if (!TOKEN_SECRET) {
  console.error("❌ Missing TOKEN_SECRET env var");
  process.exit(1);
}
const TIMEZONE        = process.env.TIMEZONE        || "Europe/Rome";

// Limiti sicurezza: di default 2 aperture entro 15 minuti
const DEFAULT_WINDOW_MIN = parseInt(process.env.WINDOW_MIN || "15", 10);
const DEFAULT_MAX_OPENS  = parseInt(process.env.MAX_OPENS  || "2", 10);

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

// Shelly 1: relay = channel 0
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
    if (data && data.isok) return { ok: true, data, path: "/device/relay/control", encoding: "form" };
    return { ok: false, status: 400, data, path: "/device/relay/control", encoding: "form" };
  } catch (err) {
    try {
      const { data } = await axios.post(
        `${SHELLY_BASE_URL}/device/relay/turn`,
        form.toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 7000 }
      );
      if (data && data.isok) return { ok: true, data, path: "/device/relay/turn", encoding: "form" };
      return { ok: false, status: 400, data, path: "/device/relay/turn", encoding: "form" };
    } catch (err2) {
      return {
        ok: false,
        status: err2?.response?.status || 500,
        data: err2?.response?.data || String(err2),
        path: "/device/relay/turn",
        encoding: "form"
      };
    }
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
    if (i < ids.length - 1) {
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  const ok = logs.every(l => l.ok);
  return { ok, logs };
}

// ========== TOKEN MONOUSO ==========
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function hmac(str) {
  return b64url(crypto.createHmac("sha256", TOKEN_SECRET).update(str).digest());
}
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
  return { ok: true, payload };
}
function newTokenFor(targetKey, opts = {}) {
  const max = opts.max ?? DEFAULT_MAX_OPENS;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const exp = Date.now() + windowMin * 60 * 1000;
  const jti = b64url(crypto.randomBytes(9));
  const payload = { tgt: targetKey, exp, max, used: opts.used ?? 0, jti };
  return { token: makeToken(payload), payload };
}
const seenJti = new Set();
function markJti(jti) { seenJti.add(jti); }
function isSeenJti(jti) { return seenJti.has(jti); }
setInterval(() => { seenJti.clear(); }, 60 * 60 * 1000);

// ========== PAGINE HTML ==========
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
function landingHtml(targetKey, targetName, tokenPayload, tokenStr) {
  const remaining = Math.max(0, (tokenPayload?.max || 0) - (tokenPayload?.used || 0));
  const expInSec = Math.max(0, Math.floor((tokenPayload.exp - Date.now()) / 1000));
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${targetName}</title><style>${pageCss()}</style></head><body><div class="wrap">
  <h1>${targetName}</h1>
  <button id="btn">Apri</button>
  <div class="muted" id="hint">Max ${tokenPayload.max} aperture entro ${DEFAULT_WINDOW_MIN} minuti · residuo: <b id="left">${remaining}</b> · scade tra <span id="ttl">${expInSec}</span>s</div>
  <p class="ok hidden" id="okmsg">✔ Apertura inviata.</p>
  <pre class="err hidden" id="errmsg"></pre>
  <script>
    const btn=document.getElementById('btn'),okmsg=document.getElementById('okmsg'),errmsg=document.getElementById('errmsg'),leftEl=document.getElementById('left'),ttlEl=document.getElementById('ttl');
    let ttl=${expInSec}; setInterval(()=>{ if(ttl>0){ttl--; ttlEl.textContent=ttl;} },1000);
    btn.addEventListener('click', async ()=>{ btn.disabled=true; okmsg.classList.add('hidden'); errmsg.classList.add('hidden');
      try{ const res=await fetch(window.location.pathname+'/open',{method:'POST'}); const j=await res.json();
        if(j.ok){ okmsg.classList.remove('hidden'); if(j.nextUrl){ window.location.replace(j.nextUrl); } else if(typeof j.remaining==='number'){ leftEl.textContent=j.remaining; } }
        else { errmsg.textContent=JSON.stringify(j,null,2); errmsg.classList.remove('hidden'); }
      }catch(e){ errmsg.textContent=String(e); errmsg.classList.remove('hidden'); } finally{ btn.disabled=false; }
    });
  </script></div></body></html>`; }

// ========== ROUTES ==========
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

// token & opener (identici ai tuoi)
app.get("/token/:target", (req, res) => {
  const targetKey = req.params.target;
  const target = TARGETS[targetKey];
  if (!target) return res.status(404).json({ ok:false, error:"unknown_target" });

  const windowMin = parseInt(req.query.mins || DEFAULT_WINDOW_MIN, 10);
  const maxOpens  = parseInt(req.query.max  || DEFAULT_MAX_OPENS, 10);

  const { token, payload } = newTokenFor(targetKey, { windowMin, max: maxOpens, used: 0 });
  const url = `${req.protocol}://${req.get("host")}/k/${targetKey}/${token}`;
  return res.json({ ok:true, url, expiresInMin: Math.round((payload.exp - Date.now())/60000) });
});

app.get("/k/:target/:token", (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");
  const parsed = parseToken(token);
  if (!parsed.ok) return res.status(400).send("Invalid link");
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).send("Invalid link");
  if (Date.now() > p.exp) return res.status(400).send("Link scaduto");
  res.type("html").send(landingHtml(target, targetDef.name, p, token));
});

app.post("/k/:target/:token/open", async (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok:false, error:"unknown_target" });

  const parsed = parseToken(token);
  if (!parsed.ok) return res.status(400).json({ ok:false, error:parsed.error });

  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok:false, error:"target_mismatch" });
  if (Date.now() > p.exp) return res.status(400).json({ ok:false, error:"expired" });
  if (isSeenJti(p.jti)) return res.status(400).json({ ok:false, error:"replayed" });

  let result;
  if (targetDef.ids.length === 1) result = await openOne(targetDef.ids[0]);
  else result = await openSequence(targetDef.ids, 10000);

  markJti(p.jti);

  const used = (p.used || 0) + 1;
  const remaining = Math.max(0, p.max - used);

  if (used < p.max) {
    const { token: nextTok } = newTokenFor(target, {
      used,
      max: p.max,
      windowMin: Math.ceil((p.exp - Date.now())/60000)
    });
    const nextUrl = `${req.protocol}://${req.get("host")}/k/${target}/${nextTok}`;
    return res.json({ ok: true, opened: result, remaining, nextUrl });
  }
  return res.json({ ok: true, opened: result, remaining: 0 });
});

app.post("/api/open-now/:target", async (req, res) => {
  const key = req.params.target;
  const t = TARGETS[key];
  if (!t) return res.status(404).json({ ok:false, error:"unknown_target" });

  const out = (t.ids.length === 1)
    ? await openOne(t.ids[0])
    : await openSequence(t.ids, 10000);

  res.json({ target: key, name: t.name, ...out, baseUrl: SHELLY_BASE_URL });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    uptime: process.uptime(),
    baseUrl: SHELLY_BASE_URL,
  });
});

// ========= START =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on", PORT, "TZ:", TIMEZONE);
});
