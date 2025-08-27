import express from "express";
import cors from "cors";
import crypto from "crypto";
import axios from "axios";

const app = express();
app.use(cors());
app.use(express.json());
app.set("trust proxy", true);

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const SHELLY_API_KEY = process.env.SHELLY_API_KEY || "";
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-77-eu.shelly.cloud";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "change-me";
const LINK_TTL_SECONDS = parseInt(process.env.LINK_TTL_SECONDS || "300", 10);

// ===== DEVICES =====
const DEVICES = {
  "3494547ab05e": { name: "Arenula 16 — Building Door", alias: "arenula-building" },
  "3494547a9395": { name: "Leonina 71 — Apartment Door", alias: "leonina-door" },
  "34945479fbbe": { name: "Leonina 71 — Building Door", alias: "leonina-building" },
  "3494547a1075": { name: "Via della Scala 17 — Apartment Door", alias: "scala-door" },
  "3494547745ee": { name: "Via della Scala 17 — Building Door", alias: "scala-building" }, // speciale
  "3494547a887d": { name: "Portico d’Ottavia 1D — Apartment Door", alias: "ottavia-door" },
  "3494547ab62b": { name: "Portico d’Ottavia 1D — Building Door", alias: "ottavia-building" },
  "34945479fa35": { name: "Viale Trastevere 108 — Apartment Door", alias: "trastevere-door" },
  "34945479fd73": { name: "Viale Trastevere 108 — Building Door", alias: "trastevere-building" }
};

// Mappa alias -> hexId
const ALIAS = {};
for (const [hexId, meta] of Object.entries(DEVICES)) {
  ALIAS[meta.alias] = hexId;
}

// ===== Session & Nonce store =====
const NONCE_TTL_MS = 60 * 60 * 1000;   // 60 minuti per il link
const SESS_TTL_MS = 15 * 60 * 1000;    // 15 minuti di sessione
const SESS_MAX_OPENS = 2;              // max 2 aperture
const SESS_COOLDOWN_MS = 6000;         // 6s tra aperture

const nonces = new Map();   // nonce -> { alias, exp, used }
const sessions = new Map(); // sid -> { alias, exp, opens, cooldown, ua, ip }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k);
  for (const [k, v] of sessions) if (v.exp < now) sessions.delete(k);
}, 60 * 1000);

function rndId(n = 24) {
  return crypto.randomBytes(n).toString("base64url");
}

// ===== Shelly helpers =====
async function resolveBaseUrl() {
  return SHELLY_BASE_URL; // semplificato: usiamo sempre base configurata
}
async function openPulse(hexId, seconds = 1) {
  const baseUrl = await resolveBaseUrl();
  const payload = { id: hexId, auth_key: SHELLY_API_KEY, channel: "0", turn: "on", timer: String(seconds) };
  try {
    const url = `${baseUrl}/device/relay/control`;
    const body = new URLSearchParams(payload).toString();
    const { data } = await axios.post(url, body, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
    return { ok: true, on: data };
  } catch (err) {
    return { ok: false, error: err?.message || "request_failed" };
  }
}
async function openPulseSequenceSame(hexId, gapSeconds = 10, seconds = 1) {
  const first = await openPulse(hexId, seconds);
  if (!first.ok) return { ok: false, step: "first", first, note: "second skipped" };
  await new Promise(r => setTimeout(r, gapSeconds * 1000));
  const second = await openPulse(hexId, seconds);
  return { ok: second.ok, first, second, gapSeconds };
}

// ===== Landing con nonce =====
app.get("/k/:alias/:nonce", (req, res) => {
  const { alias, nonce } = req.params;
  const hexId = ALIAS[alias];
  if (!hexId) return res.status(404).send("Unknown alias");
  const rec = nonces.get(nonce);
  const now = Date.now();
  if (!rec) return res.status(400).send("Invalid link");
  if (rec.used) return res.status(410).send("Link already used");
  if (rec.exp < now) return res.status(410).send("Link expired");
  if (rec.alias !== alias) return res.status(400).send("Alias mismatch");

  // Consuma nonce e crea sessione
  rec.used = true; nonces.set(nonce, rec);
  const sid = rndId(18);
  const ua = req.get("user-agent") || "";
  const ip = req.ip || req.connection?.remoteAddress || "";
  sessions.set(sid, { alias, exp: now + SESS_TTL_MS, opens: SESS_MAX_OPENS, cooldown: 0, ua, ip });

  res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESS_TTL_MS/1000)}`);
  return renderLanding(res, alias);
});

// Pagina con bottoni
function renderLanding(res, alias) {
  const deviceName = DEVICES[ALIAS[alias]].name;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${deviceName} – Accesso</title>
      <style>
        body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; margin:24px; }
        .btn { padding:14px 18px; border:1px solid #ccc; border-radius:10px; font-size:18px; margin:10px 0; cursor:pointer; }
        .hint { font-size:13px; opacity:.75; margin-top:6px; }
        .disabled { opacity:.5; pointer-events:none; }
      </style>
    </head>
    <body>
      <h1>${deviceName}</h1>
      <button id="btn" class="btn">Apri</button>
      <div class="hint">Max 2 aperture entro 15 minuti</div>
      <pre id="out" class="hint"></pre>
      <script>
        const btn = document.getElementById('btn');
        const out = document.getElementById('out');
        async function doOpen(){
          btn.classList.add('disabled');
          out.textContent = 'Richiesta...';
          try {
            const r = await fetch('/api/open', {
              method:'POST',
              headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ alias })
            });
            const j = await r.json();
            out.textContent = JSON.stringify(j,null,2);
            if(j.ok && j.remain>0){
              setTimeout(()=>btn.classList.remove('disabled'), j.cooldownMs||6000);
            }
          } catch(e){
            out.textContent = 'Errore: '+e;
          }
        }
        btn.addEventListener('click', doOpen);
      </script>
    </body></html>
  `);
}

// Lettura cookie sid
function readSid(req){
  const raw = req.headers.cookie || "";
  const m = raw.split(/; */).find(s => s.trim().startsWith("sid="));
  return m ? decodeURIComponent(m.trim().slice(4)) : null;
}

// API protetta
app.post("/api/open", async (req, res) => {
  const sid = readSid(req);
  if (!sid) return res.status(401).json({ ok:false, error:"no_session" });
  const sess = sessions.get(sid);
  const now = Date.now();
  if (!sess) return res.status(401).json({ ok:false, error:"session_missing" });
  if (sess.exp < now) { sessions.delete(sid); return res.status(401).json({ ok:false, error:"session_expired" }); }
  if (sess.cooldown && now < sess.cooldown) return res.status(429).json({ ok:false, error:"cooldown", retryInMs:sess.cooldown-now });
  if (sess.opens <= 0) return res.status(403).json({ ok:false, error:"no_opens_left" });

  const alias = req.body?.alias;
  if (sess.alias !== alias) return res.status(403).json({ ok:false, error:"wrong_alias" });

  const hexId = ALIAS[alias];
  if (!hexId) return res.status(404).json({ ok:false, error:"unknown_device" });

  let result;
  if (hexId === "3494547745ee") { // Scala Building speciale
    result = await openPulseSequenceSame(hexId, 10, 1);
  } else {
    result = await openPulse(hexId, 1);
  }

  if (result.ok) {
    sess.opens -= 1;
    sess.cooldown = Date.now() + SESS_COOLDOWN_MS;
    sessions.set(sid, sess);
  }

  return res.status(result.ok ? 200 : 502).json({ ok: result.ok, alias, device: hexId, remain: sess.opens, cooldownMs: SESS_COOLDOWN_MS, details: result });
});

// Admin per generare link
app.get("/admin/new-link/:alias", (req,res)=>{
  const {alias} = req.params;
  if(!ALIAS[alias]) return res.status(404).json({ok:false,error:"unknown_alias"});
  const nonce = rndId(18);
  nonces.set(nonce,{alias,exp:Date.now()+NONCE_TTL_MS,used:false});
  const url = `${req.protocol}://${req.get("host")}/k/${alias}/${nonce}`;
  res.json({ok:true,url,expiresInMin:NONCE_TTL_MS/60000});
});

// Health
app.get("/health", (_req,res)=>res.json({ok:true}));

// Start
app.listen(PORT, ()=>console.log("Server running on",PORT));
