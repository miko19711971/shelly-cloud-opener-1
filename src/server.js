// src/server.js
import express from "express";
import axios from "axios";
import crypto from "crypto";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== ENV =====
const SHELLY_API_KEY = process.env.SHELLY_API_KEY;
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET = process.env.TOKEN_SECRET || "changeme";
const TZ = process.env.TZ || "Europe/Rome";

if (!SHELLY_API_KEY) console.error("MISSING ENV: SHELLY_API_KEY");

// ===== TARGETS =====
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

const RELAY_CHANNEL = 0;

// ===== Helpers =====
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

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function tokenFor(target, dateStr) {
  const payload = `${target}:${dateStr}`;
  return crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("base64url");
}

// ===== Routes =====

// index con lista link
app.get("/", (req, res) => {
  const list = Object.entries(TARGETS).map(([k, v]) =>
    `<li>${v.name} — <a href="/t/${k}">smart link</a> | <a href="/gen/${k}">manual open (fake token)</a></li>`
  ).join("");
  res.type("html").send(
    `<h3>Shelly Opener — Guest Assistant</h3>
     <p>Configured targets: ${Object.keys(TARGETS).length}, TZ=${TZ}</p>
     <ul>${list}</ul>
     <p><a href="/health">Health Check</a></p>`
  );
});

// health
app.get("/health", (req, res) => {
  res.json({ ok: true, targets: Object.keys(TARGETS).length, node: process.version, TZ });
});

// genera link del giorno (mostra url ma non apre)
app.get("/gen/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).json({ ok: false, error: "unknown_target" });
  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `${req.protocol}://${req.get("host")}/open/${target}/${date}/${sig}`;
  res.json({ ok: true, target, date, sig, url });
});

// apertura senza token (solo test)
app.get("/open", async (req, res) => {
  const target = req.query.target;
  if (!TARGETS[target]) return res.status(404).json({ ok: false, error: "unknown_target" });
  const deviceId = TARGETS[target].id;
  const out = await cloudOpenRelay(deviceId);
  res.json(out);
});

// apertura con token
app.get("/open/:target/:date/:sig", async (req, res) => {
  const { target, date, sig } = req.params;
  if (!TARGETS[target]) return res.status(404).json({ ok: false, error: "unknown_target" });

  const expected = tokenFor(target, date);
  if (sig !== expected) return res.status(401).json({ ok: false, error: "invalid_token" });

  if (date !== todayISO()) return res.status(401).json({ ok: false, error: "expired_or_wrong_date" });

  const deviceId = TARGETS[target].id;
  const out = await cloudOpenRelay(deviceId);
  res.json(out);
});

// smart link: genera il token di oggi e TI REDIRIGE all'URL /open/...
app.get("/t/:target", (req, res) => {
  const target = req.params.target;
  if (!TARGETS[target]) return res.status(404).send("unknown_target");
  const date = todayISO();
  const sig = tokenFor(target, date);
  const url = `/open/${target}/${date}/${sig}`;
  res.redirect(url);
});

// ===== start =====
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server listening on", PORT)); 
