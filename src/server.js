// src/server.js
import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== ENV ======
const SHELLY_API_KEY  = process.env.SHELLY_API_KEY; // tua chiave Shelly Cloud
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET    = process.env.TOKEN_SECRET || "changeme"; // metti un segreto lungo
const TIMEZONE        = process.env.TIMEZONE || "Europe/Rome";

// ====== DEVICE MAP ======
const TARGETS = {
  "leonina-door":                   { id: "3494547a9395", name: "Leonina — Apartment Door" },
  "leonina-building-door":          { id: "34945479fbbe", name: "Leonina — Building Door" },
  "scala-door":                     { id: "3494547a1075", name: "Scala — Apartment Door" },
  "scala-building-door":            { id: "3494547745ee", name: "Scala — Building Door" },
  "ottavia-door":                   { id: "3494547a887d", name: "Ottavia — Apartment Door" },
  "ottavia-building-door":          { id: "3494547ab62b", name: "Ottavia — Building Door" },
  "viale-trastevere-door":          { id: "34945479fa35", name: "Viale Trastevere — Apartment Door" },
  "viale-trastevere-building-door": { id: "34945479fd73", name: "Viale Trastevere — Building Door" },
  "arenula-building-door":          { id: "3494547ab05e", name: "Arenula — Building Door" }
};

// Shelly 1 => relay channel 0
const RELAY_CHANNEL = 0;

// ====== Shelly Cloud helper (v1) ======
async function cloudOpenRelay(deviceId) {
  const url = `${SHELLY_BASE_URL}/device/relay/control`;
  const form = new URLSearchParams({
    id: deviceId,
    auth_key: SHELLY_API_KEY,
    channel: String(RELAY_CHANNEL),
    turn: "on"
  });

  try {
    const { data } = await axios.post(url, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });
    if (data && data.isok) return { ok: true, data };
    return { ok: false, error: data || { message: "cloud_isok_false" } };
  } catch (err) {
    return {
      ok: false,
      error: "cloud_error",
      details: err.response ? { status: err.response.status, data: err.response.data } : String(err)
    };
  }
}

// ====== TOKEN MONOUSO (5 minuti) ======
const usedTokens = new Map(); // sig -> expireTime(ms)

function makeToken(target) {
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", TOKEN_SECRET)
    .update(`${target}:${ts}`)
    .digest("base64url");
  return { ts, sig };
}

function verifyToken(target, ts, sig) {
  const expected = crypto.createHmac("sha256", TOKEN_SECRET)
    .update(`${target}:${ts}`)
    .digest("base64url");

  if (sig !== expected) return { ok: false, error: "invalid_signature" };

  const ageMs = Date.now() - parseInt(ts, 10);
  if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) return { ok: false, error: "expired" };

  if (usedTokens.has(sig)) return { ok: false, error: "already_used" };

  usedTokens.set(sig, Date.now() + 5 * 60 * 1000); // segna come usato
  return { ok: true };
}

// pulizia periodica
setInterval(() => {
  const now = Date.now();
  for (const [sig, exp] of usedTokens.entries()) {
    if (exp < now) usedTokens.delete(sig);
  }
}, 60 * 1000);

// ====== ROUTES ======

// Home con tutti i link utili
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS)
    .map(([key, v]) => {
      return `<li>
        <b>${key}</b> — ${v.name}
        &nbsp; <a href="/t/${key}">smart link (token 5 min)</a>
        &nbsp; <a href="/open?target=${key}">test open (senza token)</a>
      </li>`;
    })
    .join("\n");

  res.type("html").send(
    `<h1>Shelly unified opener</h1>
     <p>${Object.keys(TARGETS).length} targets · TZ=${TIMEZONE}</p>
     <ul>${rows}</ul>
     <p><a href="/health">/health</a></p>`
  );
});

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    hasApiKey: !!SHELLY_API_KEY,
    baseUrl: SHELLY_BASE_URL,
    timezone: TIMEZONE,
    node: process.version,
    targets: Object.keys(TARGETS).length
  });
});

// Smart redirect: genera token e redirige al link firmato
app.get("/t/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).send("unknown_target");
  const { ts, sig } = makeToken(target);
  res.redirect(302, `/open/${target}/${ts}/${sig}`);
});

// Apertura con token monouso
app.get("/open/:target/:ts/:sig", async (req, res) => {
  const { target, ts, sig } = req.params;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const check = verifyToken(target, ts, sig);
  if (!check.ok) return res.json(check);

  const deviceId = TARGETS[target].id;
  const out = await cloudOpenRelay(deviceId);
  res.json(out);
});

// Apertura *senza* token (solo test)
app.get("/open", async (req, res) => {
  const target = req.query.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const deviceId = TARGETS[target].id;
  const out = await cloudOpenRelay(deviceId);
  res.json(out);
});

// ====== START ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server listening on", PORT, "TZ:", TIMEZONE);
});
