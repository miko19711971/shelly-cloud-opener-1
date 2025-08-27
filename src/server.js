// src/server.js
// Shelly Cloud Opener — robusto per Gen1 (relay/control) e Gen2 (switch/control)

import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== ENV =====
const SHELLY_API_KEY = process.env.SHELLY_API_KEY || "";
const SHELLY_BASE_URL =
  process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "changeme";
const TZ = process.env.TZ || "Europe/Rome";

if (!SHELLY_API_KEY) console.error("MISSING ENV: SHELLY_API_KEY");

// ===== MAPPATURA DEVICE =====
const TARGETS = {
  "leonina-door": { id: "3494547a9395", name: "Leonina — Apartment Door" },
  "leonina-building-door": {
    id: "34945479fbbe",
    name: "Leonina — Building Door",
  },
  "scala-door": { id: "3494547a1075", name: "Scala — Apartment Door" },
  "scala-building-door": {
    id: "3494547745ee",
    name: "Scala — Building Door",
  },
  "ottavia-door": { id: "3494547a887d", name: "Ottavia — Apartment Door" },
  "ottavia-building-door": {
    id: "3494547ab62b",
    name: "Ottavia — Building Door",
  },
  "viale-trastevere-door": {
    id: "34945479fa35",
    name: "Viale Trastevere — Apartment Door",
  },
  "viale-trastevere-building-door": {
    id: "34945479fd73",
    name: "Viale Trastevere — Building Door",
  },
  "arenula-building-door": {
    id: "3494547ab05e",
    name: "Arenula — Building Door",
  },
};

// Shelly 1 Gen1 usa channel 0
const RELAY_CHANNEL = 0;

// helper axios
function ax() {
  return axios.create({
    timeout: 10000,
    validateStatus: () => true,
  });
}

// ====== OPEN: prova sequenziale Gen1 -> Gen1-GET -> Gen2 ======
async function cloudOpen(deviceId) {
  const bases = [
    SHELLY_BASE_URL, // es. https://shelly-api-eu.shelly.cloud
    "https://shelly-api.shelly.cloud", // fallback globale
  ];

  const tries = [];

  // 1) Gen1 - POST x-www-form-urlencoded -> /device/relay/control
  for (const base of bases) {
    try {
      const url = `${base}/device/relay/control`;
      const form = new URLSearchParams({
        id: deviceId,
        auth_key: SHELLY_API_KEY,
        channel: String(RELAY_CHANNEL),
        turn: "on",
      });
      const r = await ax().post(url, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (r.data && r.data.isok) return { ok: true, data: r.data, used: url };
      tries.push({ base, note: "POST relay/control", err: r.data || r.status });
    } catch (e) {
      tries.push({ base, note: "POST relay/control", err: errToObj(e) });
    }
  }

  // 2) Gen1 - GET querystring -> /device/relay/control
  for (const base of bases) {
    try {
      const url = `${base}/device/relay/control?id=${encodeURIComponent(
        deviceId
      )}&auth_key=${encodeURIComponent(
        SHELLY_API_KEY
      )}&channel=${RELAY_CHANNEL}&turn=on`;
      const r = await ax().get(url);
      if (r.data && r.data.isok) return { ok: true, data: r.data, used: url };
      tries.push({ base, note: "GET relay/control", err: r.data || r.status });
    } catch (e) {
      tries.push({ base, note: "GET relay/control", err: errToObj(e) });
    }
  }

  // 3) Gen2 - POST -> /device/switch/control (alcuni Cloud mappano così)
  for (const base of bases) {
    try {
      const url = `${base}/device/switch/control`;
      const form = new URLSearchParams({
        id: deviceId,
        auth_key: SHELLY_API_KEY,
        channel: String(RELAY_CHANNEL),
        turn: "on",
      });
      const r = await ax().post(url, form.toString(), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (r.data && r.data.isok) return { ok: true, data: r.data, used: url };
      tries.push({ base, note: "POST switch/control", err: r.data || r.status });
    } catch (e) {
      tries.push({ base, note: "POST switch/control", err: errToObj(e) });
    }
  }

  return { ok: false, error: "cloud_error", tried: tries, last: tries.at(-1) };
}

function errToObj(e) {
  if (!e) return "unknown";
  if (e.response) return { status: e.response.status, data: e.response.data };
  return String(e);
}

// ===== Token giornaliero YYYY-MM-DD =====
function todayISO() {
  const now = new Date();
  // Forziamo il fuso in modo semplice (Render usa UTC); il token vale su "oggi" lato server.
  // Per coerenza operiamo su UTC ma il valore è solo stringa di calendario.
  return now.toISOString().slice(0, 10);
}
function tokenFor(target, dateStr) {
  const payload = `${target}:${dateStr}`;
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

// ====== ROUTES ======

// Pagina indice con link utili
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS)
    .map(([key, v]) => {
      const t = encodeURIComponent(key);
      return `<li>
        ${v.name} —
        <a href="/t/${t}">smart link</a> |
        <a href="/open?target=${t}">manual open (fake token)</a>
      </li>`;
    })
    .join("\n");

  res.type("html").send(
    `<h3>Shelly Opener — Guest Assistant</h3>
     <p>Configured targets: ${Object.keys(TARGETS).length}, TZ=${TZ}</p>
     <ul>${rows}</ul>
     <p><a href="/health">Health Check</a></p>`
  );
});

// Salute
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    uptime: process.uptime(),
  });
});

// Genera (solo JSON) il token giornaliero per un target
app.get("/gen/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });
  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `${req.protocol}://${req.get("host")}/open/${target}/${date}/${sig}`;
  res.json({ ok: true, target, date, sig, url });
});

// Smart link: genera e reindirizza subito alla /open corretta
app.get("/t/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).send("Unknown target");
  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `/open/${encodeURIComponent(target)}/${date}/${sig}`;
  res.redirect(url);
});

// Apertura *senza* token (solo test manuale)
app.get("/open", async (req, res) => {
  const target = req.query.target;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });
  const deviceId = TARGETS[target].id;
  const out = await cloudOpen(deviceId);
  res.json(out);
});

// Apertura *con* token giornaliero
app.get("/open/:target/:date/:sig", async (req, res) => {
  const { target, date, sig } = req.params;
  if (!TARGETS[target]) return res.json({ ok: false, error: "unknown_target" });

  const expected = tokenFor(target, date);
  if (sig !== expected) return res.json({ ok: false, error: "invalid_token" });

  const today = todayISO();
  if (date !== today) return res.json({ ok: false, error: "expired_or_wrong_date" });

  const deviceId = TARGETS[target].id;
  const out = await cloudOpen(deviceId);
  res.json(out);
});

// ===== START =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server listening on", PORT);
});
