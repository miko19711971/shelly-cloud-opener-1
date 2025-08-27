// src/server.js
import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== ENV ======
const SHELLY_API_KEY = process.env.SHELLY_API_KEY; // OBBLIGATORIA
const TOKEN_SECRET   = process.env.TOKEN_SECRET || "changeme";
const TZ             = process.env.TZ || "Europe/Rome";

// Endpoint principali (eu + global) in fallback
const BASES = [
  process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud",
  "https://shelly-api.shelly.cloud",
];

// Sanity check
if (!SHELLY_API_KEY) {
  console.error("MISSING ENV: SHELLY_API_KEY");
}

// ====== MAPPATURA TUTTI I DEVICE ======
const TARGETS = {
  "leonina-door":              { id: "3494547a9395", name: "Leonina — Apartment Door" },
  "leonina-building-door":     { id: "34945479fbbe", name: "Leonina — Building Door" },
  "scala-door":                { id: "3494547a1075", name: "Scala — Apartment Door" },
  "scala-building-door":       { id: "3494547745ee", name: "Scala — Building Door" },
  "ottavia-door":              { id: "3494547a887d", name: "Ottavia — Apartment Door" },
  "ottavia-building-door":     { id: "3494547ab62b", name: "Ottavia — Building Door" },
  "viale-trastevere-door":     { id: "34945479fa35", name: "Viale Trastevere — Apartment Door" },
  "viale-trastevere-building-door": { id: "34945479fd73", name: "Viale Trastevere — Building Door" },
  "arenula-building-door":     { id: "3494547ab05e", name: "Arenula — Building Door" }
};

// Shelly 1 => relay channel 0
const RELAY_CHANNEL = 0;

// ====== UTILS ======
function todayISO() {
  // Forziamo il giorno in TZ impostata dal container (Render: setta ENV TZ=Europe/Rome)
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD in UTC, ma per i link giornalieri va bene
}

function tokenFor(target, dateStr) {
  const payload = `${target}:${dateStr}`;
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

// Chiamata cloud con header Bearer + body JSON
async function cloudOpenRelay(deviceId) {
  const body = {
    id: deviceId,
    channel: RELAY_CHANNEL,
    turn: "on",
    // Molti endpoint non lo richiedono nel body se c'è il Bearer, ma lo aggiungo per compatibilità:
    auth_key: SHELLY_API_KEY
  };

  const tried = [];
  for (const base of BASES) {
    try {
      const url = `${base}/device/relay/control`;
      const { data } = await axios.post(url, body, {
        headers: {
          "Authorization": `Bearer ${SHELLY_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      });

      // Risposta tipica: { isok: true/false, ... }
      if (data && data.isok) {
        return { ok: true, data, base };
      }
      tried.push({ base, note: "API replied", data });
    } catch (err) {
      const pack = err?.response
        ? { status: err.response.status, data: err.response.data }
        : { data: String(err) };
      tried.push({ base, note: "request failed", err: pack });
    }
  }
  return { ok: false, error: "cloud_error", tried, last: tried.at(-1) };
}

// ====== ROUTES ======
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    tz: TZ,
    today: todayISO()
  });
});

// Index con link utili
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS).map(([key, v]) => {
    return `<li>
      ${v.name} —
      <a href="/t/${key}">smart link</a> |
      <a href="/open?target=${key}">manual open (fake token)</a>
    </li>`;
  }).join("\n");

  res.type("html").send(`
    <h3>Shelly Opener — Guest Assistant</h3>
    <p>Configured targets: ${Object.keys(TARGETS).length}, TZ=${TZ}</p>
    <ul>${rows}</ul>
    <p><a href="/health">Health Check</a></p>
  `);
});

// Smart link che genera e reindirizza al link con token giornaliero
app.get("/t/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).send("unknown target");
  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `/open/${target}/${date}/${sig}`;
  res.redirect(url);
});

// Test senza token (solo per prove)
app.get("/open", async (req, res) => {
  const target = req.query.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });
  const out = await cloudOpenRelay(TARGETS[target].id);
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

  const out = await cloudOpenRelay(TARGETS[target].id);
  res.json(out);
});

// ====== START ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
