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

// ====== Nuove route operative su /k3 ======
app.get(`${LINK_PREFIX}/:target/:token`, (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");

  const parsed = parseToken(token);
  if (!parsed.ok || Date.now() > parsed.payload.exp) return res.status(410).send("Link scaduto");
  res.type("html").send(`<h1>${targetDef.name}</h1><p>Token valido per apertura.</p>`);
});

app.post(`${LINK_PREFIX}/:target/:token/open`, async (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok:false, error:"unknown_target" });

  const parsed = parseToken(token);
  if (!parsed.ok || Date.now() > parsed.payload.exp) return res.status(410).json({ ok:false, error:"expired" });

  let result;
  if (targetDef.ids.length === 1) result = await openOne(targetDef.ids[0]);
  else result = await openSequence(targetDef.ids, 10000);

  return res.json({ ok:true, opened: result });
});

// ========= START =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on", PORT, "TZ:", TIMEZONE, "TokenVer:", TOKEN_VERSION);
});
