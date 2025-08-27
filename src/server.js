 // Shelly Cloud Opener — Gen1 (relay) — by Michele
// Usa Shelly Cloud v1: /device/relay/control

import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== ENV =====
const SHELLY_API_KEY = process.env.SHELLY_API_KEY; // obbligatoria
const SHELLY_BASE_URL =
  process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "changeme";
const TZ = process.env.TZ || "Europe/Rome"; // opzionale, utile per /health

if (!SHELLY_API_KEY) console.error("MISSING ENV: SHELLY_API_KEY");

// ===== MAPPATURA DEVICE =====
const TARGETS = {
  "leonina-door": { id: "3494547a9395", name: "Leonina — Apartment Door" },
  "leonina-building-door": { id: "34945479fbbe", name: "Leonina — Building Door" },
  "scala-door": { id: "3494547a1075", name: "Scala — Apartment Door" },
  "scala-building-door": { id: "3494547745ee", name: "Scala — Building Door" },
  "ottavia-door": { id: "3494547a887d", name: "Ottavia — Apartment Door" },
  "ottavia-building-door": { id: "3494547ab62b", name: "Ottavia — Building Door" },
  "viale-trastevere-door": { id: "34945479fa35", name: "Viale Trastevere — Apartment Door" },
  "viale-trastevere-building-door": { id: "34945479fd73", name: "Viale Trastevere — Building Door" },
  "arenula-building-door": { id: "3494547ab05e", name: "Arenula — Building Door" }
};

// Shelly 1 → relay channel 0
const RELAY_CHANNEL = 0;

// ===== HELPERS =====
function todayISO() {
  // data del server (Render) — meglio avere TZ=Europe/Rome nelle env
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function tokenFor(target, dateStr) {
  const payload = `${target}:${dateStr}`;
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

// Chiamata Shelly Cloud v1 per GEN1 (relay)
async function cloudOpenRelayGen1(deviceId) {
  const url = `${SHELLY_BASE_URL}/device/relay/control`;
  const form = new URLSearchParams({
    id: deviceId,
    auth_key: SHELLY_API_KEY,
    channel: String(RELAY_CHANNEL),
    turn: "on"
    // Se hai impostato l'impulso (auto-off) nel device, basta "on"
  });

  try {
    const { data } = await axios.post(url, form.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    });

    // Risposta tipica: { isok: true, ... }
    if (data && data.isok) return { ok: true, data };
    return { ok: false, error: "cloud_error", details: data };
  } catch (err) {
    const details = err.response
      ? { status: err.response.status, data: err.response.data }
      : String(err);
    return { ok: false, error: "cloud_error", details };
  }
}

// ===== ROUTES =====

// Home con lista e link utili
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS)
    .map(([key, v]) => {
      const base = `${req.protocol}://${req.get("host")}`;
      return `<li>
        <b>${v.name}</b> — <code>${key}</code>
        &nbsp; <a href="/t/${key}">smart link</a>
        &nbsp; <a href="/gen/${key}">gen token</a>
        &nbsp; <a href="/open?target=${key}">manual open</a>
      </li>`;
    })
    .join("\n");

  res.type("html").send(`
    <h3>Shelly Opener — Guest Assistant</h3>
    <p>Configured targets: ${Object.keys(TARGETS).length}, TZ=${TZ}</p>
    <ul>${rows}</ul>
    <p><a href="/health">Health Check</a></p>
  `);
});

// Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    uptime: process.uptime(),
    tz: TZ
  });
});

// Genera token (solo utilità)
app.get("/gen/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `${req.protocol}://${req.get("host")}/open/${target}/${date}/${sig}`;
  res.json({ ok: true, target, date, sig, url });
});

// Smart link: redirecta al link del giorno (per Hostaway/email)
app.get("/t/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `${req.protocol}://${req.get("host")}/open/${target}/${date}/${sig}`;
  res.redirect(url);
});

// Apertura senza token (test manuale)
app.get("/open", async (req, res) => {
  const target = req.query.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const deviceId = TARGETS[target].id;
  const out = await cloudOpenRelayGen1(deviceId);
  res.json(out);
});

// Apertura con token giornaliero
app.get("/open/:target/:date/:sig", async (req, res) => {
  const { target, date, sig } = req.params;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const expected = tokenFor(target, date);
  if (sig !== expected) return res.json({ ok: false, error: "invalid_token" });

  const today = todayISO();
  if (date !== today) return res.json({ ok: false, error: "expired_or_wrong_date" });

  const deviceId = TARGETS[target].id;
  const out = await cloudOpenRelayGen1(deviceId);
  res.json(out);
});

// ===== START =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
 
