// src/server.js
import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cors());

// ====== ENV ======
const SHELLY_API_KEY = process.env.SHELLY_API_KEY; 
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-77-eu.shelly.cloud";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "default_secret";
const TIMEZONE = process.env.TIMEZONE || "Europe/Rome";

// ====== DEVICES ======
const TARGETS = {
  "arenula-building-door": { id: "3494547ab05e", name: "Arenula — Building Door" },
  "leonina-door":          { id: "3494547a9395", name: "Leonina — Apartment Door" },
  "leonina-building-door": { id: "34945479fd73", name: "Leonina — Building Door" },
  "scala-door":            { id: "3494547a1075", name: "Via della Scala 17 — Apartment Door" },
  "scala-building-door":   { id: "3494547745ee", name: "Via della Scala 17 — Building Door" },
  "ottavia-door":          { id: "3494547a887d", name: "Portico d’Ottavia 1D — Apartment Door" },
  "ottavia-building-door": { id: "3494547ab62b", name: "Portico d’Ottavia 1D — Building Door" },
  "trastevere-door":       { id: "34945479fa35", name: "Viale Trastevere 108 — Apartment Door" },
  "trastevere-building":   { id: "34945479fbbe", name: "Viale Trastevere 108 — Building Door" }
};

// Relay channel sempre 0
const RELAY_CHANNEL = 0;

// ====== TOKEN (5 minuti monouso) ======
const usedTokens = new Map();
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
  if (Date.now() - parseInt(ts, 10) > 5 * 60 * 1000) return { ok: false, error: "expired" };
  if (usedTokens.has(sig)) return { ok: false, error: "already_used" };
  usedTokens.set(sig, Date.now() + 5 * 60 * 1000);
  return { ok: true };
}
setInterval(() => {
  const now = Date.now();
  for (const [sig, exp] of usedTokens.entries()) {
    if (exp < now) usedTokens.delete(sig);
  }
}, 60 * 1000);

// ====== Shelly Cloud API ======
async function cloudOpenRelay(deviceId) {
  try {
    const url = `${SHELLY_BASE_URL}/device/relay/control`;
    const form = new URLSearchParams({
      id: deviceId,
      auth_key: SHELLY_API_KEY,
      channel: String(RELAY_CHANNEL),
      turn: "on"
    });

    const { data } = await axios.post(url, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 5000
    });

    if (data?.isok) {
      return { ok: true, data };
    }
    return { ok: false, error: "shelly_error", details: data };
  } catch (err) {
    return { ok: false, error: "network_error", details: err.message };
  }
}

// ====== ROUTES ======
app.get("/", (req, res) => {
  const items = Object.entries(TARGETS).map(([key, t]) =>
    `<li>
      <b>${t.name}</b> —
      <a href="/t/${key}">Smart Link</a> |
      <a href="/open/${key}/123/fake">Manual Open</a>
    </li>`).join("\n");

  res.type("html").send(`
    <h2>Door & Gate Opener</h2>
    <p>Link firmati (scadenza: 300s) e apertura manuale.</p>
    <ul>${items}</ul>
    <p>Shelly base: ${SHELLY_BASE_URL}</p>
  `);
});

app.get("/t/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).send("unknown_target");
  const { ts, sig } = makeToken(target);
  res.redirect(`/open/${target}/${ts}/${sig}`);
});

app.get("/open/:target/:ts/:sig", async (req, res) => {
  const { target, ts, sig } = req.params;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });
  const check = verifyToken(target, ts, sig);
  if (!check.ok) return res.json(check);
  const out = await cloudOpenRelay(TARGETS[target].id);
  res.json({ device: TARGETS[target].name, ...out });
});

app.post("/open/:target", async (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).json({ ok: false, error: "unknown_target" });
  const out = await cloudOpenRelay(TARGETS[target].id);
  res.json({ device: TARGETS[target].name, ...out });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, targets: Object.keys(TARGETS).length, node: process.version });
});

// ====== START ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on", PORT));r
