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

// endpoint account per discovery (se serve)
const ACCOUNT_BASE = "https://shelly-api-eu.shelly.cloud";

// ===== DEVICES =====
const DEVICES = {
  "3494547ab05e": { name: "Arenula 16 — Building Door", dec: "57811677130846" },
  "3494547a9395": { name: "Leonina 71 — Apartment Door", dec: "57811677123477" },
  "34945479fd73": { name: "Leonina 71 — Building Door", dec: "57811677085043" },
  "3494547a1075": { name: "Via della Scala 17 — Apartment Door", dec: "57811677089909" },
  "3494547745ee": { name: "Via della Scala 17 — Building Door", dec: "57811676906990" },
  "3494547a887d": { name: "Portico d’Ottavia 1D — Apartment Door", dec: "57811677120637" },
  "3494547ab62b": { name: "Portico d’Ottavia 1D — Building Door", dec: "57811677132331" },
  "34945479fa35": { name: "Viale Trastevere 108 — Apartment Door", dec: "57811677084213" },
  "34945479fbbe": { name: "Viale Trastevere 108 — Building Door", dec: "57811677084606" }
};

// ===== FLOW per Via della Scala (2 portoni + 1 porta) =====
const FLOWS = {
  scala: {
    title: "Via della Scala 17",
    steps: [
      { label: "Apri Portone (usalo 2 volte: esterno e interno)", device: "3494547745ee" },
      { label: "Apri Porta Appartamento", device: "3494547a1075" }
    ]
  }
};

// ===== HMAC (Smart Link) =====
function sign(deviceId, ts) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(`${deviceId}:${ts}`).digest("hex");
}
function verify(deviceId, ts, sig) {
  const now = Math.floor(Date.now() / 1000);
  if (!ts || Math.abs(now - Number(ts)) > LINK_TTL_SECONDS) return false;
  const good = sign(deviceId, ts);
  try { return crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig)); } catch { return false; }
}
// helper per generare link firmati
function signedLinkFor(deviceId) {
  const ts = Math.floor(Date.now() / 1000);
  const sig = sign(deviceId, ts);
  return `/open?device=${encodeURIComponent(deviceId)}&ts=${ts}&sig=${sig}`;
}

// ===== Discovery shard (HEX -> DEC -> fallback) =====
const shardCache = new Map();
async function discoveryStatus(idValue) {
  const url = `${ACCOUNT_BASE}/device/status`;
  const body = new URLSearchParams({ id: idValue, auth_key: SHELLY_API_KEY }).toString();
  const { data } = await axios.post(url, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000
  });
  return data;
}
async function resolveBaseUrl(hexId) {
  if (shardCache.has(hexId)) return shardCache.get(hexId);

  try {
    const d = await discoveryStatus(hexId);
    const server = d?.data?.device?.server_name || d?.data?.server || d?.data?.domain || d?.server || d?.domain;
    if (server) {
      const base = server.startsWith("http") ? server : `https://${server}`;
      shardCache.set(hexId, base);
      return base;
    }
  } catch (_) {}

  const dec = DEVICES[hexId]?.dec;
  if (dec) {
    try {
      const d = await discoveryStatus(dec);
      const server = d?.data?.device?.server_name || d?.data?.server || d?.data?.domain || d?.server || d?.domain;
      if (server) {
        const base = server.startsWith("http") ? server : `https://${server}`;
        shardCache.set(hexId, base);
        return base;
      }
    } catch (_) {}
  }

  shardCache.set(hexId, SHELLY_BASE_URL);
  return SHELLY_BASE_URL;
}

// ===== POST helper =====
async function shellyForm(baseUrl, path, payload) {
  const url = `${baseUrl}${path}`;
  const body = new URLSearchParams(payload).toString();
  return axios.post(url, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000
  });
}

// ===== Apertura con singolo POST (timer lato cloud) =====
async function openPulse(hexId, seconds = 1) {
  const baseUrl = await resolveBaseUrl(hexId);
  const payload = {
    id: hexId,
    auth_key: SHELLY_API_KEY,
    channel: "0",
    turn: "on",
    timer: String(seconds)
  };
  try {
    const res = await shellyForm(baseUrl, "/device/relay/control", payload);
    return { ok: true, on: res.data, path: "/device/relay/control", baseUrl, encoding: "form" };
  } catch (err) {
    return {
      ok: false,
      error: "Shelly request failed",
      details: {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message,
        path: "/device/relay/control",
        encoding: "form"
      },
      baseUrl
    };
  }
}

// ===== UI =====
app.get("/", (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const rows = Object.entries(DEVICES).map(([hexId, meta]) => {
    const ts = now;
    const sig = sign(hexId, ts);
    const smart = `/open?device=${encodeURIComponent(hexId)}&ts=${ts}&sig=${sig}`;
    const manual = `/manual-open/${encodeURIComponent(hexId)}`;
    return `
      <tr>
        <td style="padding:8px 12px">${meta.name}</td>
        <td style="padding:8px 12px"><code>${hexId}</code>${meta.dec ? ` <small>(dec ${meta.dec})</small>` : ""}</td>
        <td style="padding:8px 12px"><a href="${smart}">Smart Link</a></td>
        <td style="padding:8px 12px"><a href="${manual}">Manual Open</a></td>
      </tr>`;
  }).join("");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
  <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Door Opener</title></head>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.4;margin:24px">
    <h1>Door & Gate Opener</h1>
    <p>Link firmati (scadenza: ${LINK_TTL_SECONDS}s) e apertura manuale.</p>
    <table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <thead><tr><th style="padding:8px 12px;text-align:left">Nome</th>
      <th style="padding:8px 12px;text-align:left">Device ID</th>
      <th style="padding:8px 12px;text-align:left">Smart Link</th>
      <th style="padding:8px 12px;text-align:left">Manual Open</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:12px;font-size:12px;opacity:.7">Shard fallback: <code>${SHELLY_BASE_URL}</code></p>
  </body></html>`);
});

// ===== Pagina ospite dedicata a Via della Scala =====
app.get("/flow/scala", (_req, res) => {
  const flow = FLOWS.scala;
  const gateLink = signedLinkFor("3494547745ee"); // stesso relè per entrambi i portoni
  const doorLink = signedLinkFor("3494547a1075");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${flow.title} – Aperture</title>
      <style>
        body { font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; line-height: 1.4; margin: 24px; }
        .btn { display:inline-block; padding:14px 18px; text-decoration:none; border:1px solid #ccc; border-radius:10px; font-size:18px; margin:10px 0; }
        .hint { font-size:13px; opacity:.75; margin-top: 4px; }
        .card { border:1px solid #e5e5e5; border-radius:12px; padding:16px; margin:12px 0; }
      </style>
    </head>
    <body>
      <h1 style="margin:0 0 8px">${flow.title} – Accesso</h1>
      <p class="hint">Usa i pulsanti nell'ordine. I link scadono dopo ${LINK_TTL_SECONDS}s: se scadono, aggiorna la pagina.</p>

      <div class="card">
        <h2 style="margin:0 0 8px">Portoni condominiali</h2>
        <p class="hint">È lo <b>stesso</b> comando: usalo davanti al <b>primo</b> portone e poi di nuovo davanti al <b>secondo</b>.</p>
        <p><a class="btn" href="${gateLink}">Apri Portone</a></p>
        <p><a class="btn" href="${gateLink}">Apri Portone (secondo)</a></p>
      </div>

      <div class="card">
        <h2 style="margin:0 0 8px">Porta appartamento</h2>
        <p><a class="btn" href="${doorLink}">Apri Porta Appartamento</a></p>
      </div>
    </body></html>
  `);
});

// Smart link
app.get("/open", async (req, res) => {
  const { device, ts, sig } = req.query;
  if (!device || !ts || !sig) return res.status(400).json({ ok:false, error:"Missing query params" });
  if (!DEVICES[device]) return res.status(404).json({ ok:false, error:"Unknown device" });
  if (!verify(device, ts, sig)) return res.status(401).json({ ok:false, error:"Invalid or expired link" });

  const result = await openPulse(device);
  return res.status(result.ok ? 200 : 502).json({ device, name: DEVICES[device].name, ...result });
});

// Manual open
app.get("/manual-open/:hexId", async (req, res) => {
  const hexId = req.params.hexId;
  if (!DEVICES[hexId]) return res.status(404).json({ ok:false, error:"Unknown device", device: hexId });
  const result = await openPulse(hexId);
  return res.status(result.ok ? 200 : 502).json({ device: hexId, name: DEVICES[hexId].name, ...result });
});

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// Start
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
