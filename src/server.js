import express from "express";
import cors from "cors";
import crypto from "crypto";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.set("trust proxy", true);

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const SHELLY_AUTH_KEY =
  process.env.SHELLY_API_KEY || process.env.SHELLY_AUTH_KEY || ""; // API key account
const HMAC_SECRET =
  process.env.TOKEN_SECRET || process.env.HMAC_SECRET || "change-me";
const LINK_TTL_SECONDS = parseInt(process.env.LINK_TTL_SECONDS || "300", 10);

// endpoint "generico" account (solo per discovery shard)
const ACCOUNT_BASE = "https://shelly-api-eu.shelly.cloud";

if (!SHELLY_AUTH_KEY) {
  console.warn("[WARN] SHELLY_API_KEY non impostata.");
}

// ===== DEVICES (mappatura definitiva) =====
const DEVICES = {
  // Arenula 16 → solo Building Door
  "3494547ab05e": { name: "Arenula 16 — Building Door" },

  // Leonina 71 → due dispositivi
  "3494547a9395": { name: "Leonina 71 — Apartment Door" },
  "34945479fbbe": { name: "Leonina 71 — Building Door" },

  // Via della Scala 17
  "3494547a1075": { name: "Via della Scala 17 — Apartment Door" },
  "3494547745ee": { name: "Via della Scala 17 — Building Door" },

  // Portico d’Ottavia 1D
  "3494547a887d": { name: "Portico d’Ottavia 1D — Apartment Door" },
  "3494547ab62b": { name: "Portico d’Ottavia 1D — Building Door" },

  // Viale Trastevere 108
  "34945479fa35": { name: "Viale Trastevere 108 — Apartment Door" },
  "34945479fd73": { name: "Viale Trastevere 108 — Building Door" }
};

// ===== HMAC (Smart Link) =====
function sign(deviceId, ts) {
  return crypto.createHmac("sha256", HMAC_SECRET)
    .update(`${deviceId}:${ts}`)
    .digest("hex");
}
function verify(deviceId, ts, sig) {
  const now = Math.floor(Date.now() / 1000);
  if (!ts || Math.abs(now - Number(ts)) > LINK_TTL_SECONDS) return false;
  const good = sign(deviceId, ts);
  try { return crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig)); }
  catch { return false; }
}

// ===== Risoluzione shard per device (cache) =====
const deviceShardCache = new Map(); // deviceId -> baseUrl (https://shelly-xx-eu.shelly.cloud)

async function resolveDeviceBaseUrl(deviceId) {
  if (deviceShardCache.has(deviceId)) return deviceShardCache.get(deviceId);

  // Chiamata account → lista dispositivi con info server
  const url = `${ACCOUNT_BASE}/device/all`;
  const form = new URLSearchParams({ auth_key: SHELLY_AUTH_KEY }).toString();
  const { data } = await axios.post(url, form, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000
  });

  // Estraggo id + server; i nomi campo possono variare leggermente
  const list = Array.isArray(data?.data?.devices) ? data.data.devices : [];
  for (const d of list) {
    const id = d?.id || d?.device_id || d?.deviceid;
    const server = d?.server_name || d?.server || d?.domain || d?.server_domain;
    if (id && server) {
      const base = server.startsWith("http") ? server : `https://${server}`;
      deviceShardCache.set(id, base);
    }
  }
  return deviceShardCache.get(deviceId); // può essere undefined se non trovato
}

// ===== POST helper (form) =====
async function shellyPostForm(baseUrl, path, payloadObj) {
  const url = `${baseUrl}${path}`;
  const body = new URLSearchParams(payloadObj).toString();
  return axios.post(url, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000
  });
}

// ===== Apertura relè (CONTROL → fallback TURN) =====
async function shellyPulse(deviceId, durationMs = 800) {
  const baseUrl =
    (await resolveDeviceBaseUrl(deviceId)) ||
    ACCOUNT_BASE; // fallback se non risolto, ma è quasi sempre risolto

  const payloadOn  = { id: deviceId, auth_key: SHELLY_AUTH_KEY, channel: "0", turn: "on"  };
  const payloadOff = { id: deviceId, auth_key: SHELLY_AUTH_KEY, channel: "0", turn: "off" };

  try {
    const onRes  = await shellyPostForm(baseUrl, "/device/relay/control", payloadOn);
    await new Promise(r => setTimeout(r, durationMs));
    const offRes = await shellyPostForm(baseUrl, "/device/relay/control", payloadOff);
    return { ok: true, on: onRes.data, off: offRes.data, path: "/device/relay/control", baseUrl, encoding: "form" };
  } catch (err1) {
    try {
      const onRes  = await shellyPostForm(baseUrl, "/device/relay/turn", payloadOn);
      await new Promise(r => setTimeout(r, durationMs));
      const offRes = await shellyPostForm(baseUrl, "/device/relay/turn", payloadOff);
      return { ok: true, on: onRes.data, off: offRes.data, path: "/device/relay/turn", baseUrl, encoding: "form" };
    } catch (err2) {
      return {
        ok: false,
        error: "Shelly request failed",
        details: {
          first:  { status: err1?.response?.status, data: err1?.response?.data, message: err1?.message, path: "/device/relay/control", encoding: "form" },
          second: { status: err2?.response?.status, data: err2?.response?.data, message: err2?.message, path: "/device/relay/turn",    encoding: "form" },
          baseUrl
        }
      };
    }
  }
}

// ===== UI =====
app.get("/", (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const rows = Object.entries(DEVICES).map(([id, meta]) => {
    const ts = now;
    const sig = sign(id, ts);
    const smart = `/open?device=${encodeURIComponent(id)}&ts=${ts}&sig=${sig}`;
    const manual = `/manual-open/${encodeURIComponent(id)}`;
    return `
      <tr>
        <td style="padding:8px 12px">${meta.name}</td>
        <td style="padding:8px 12px"><code>${id}</code></td>
        <td style="padding:8px 12px"><a href="${smart}">Smart Link</a></td>
        <td style="padding:8px 12px"><a href="${manual}">Manual Open</a></td>
      </tr>`;
  });

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
  <html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NiceFlatInRome – Door Opener</title>
  </head>
  <body style="font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.4;margin:24px">
    <h1 style="margin:0 0 8px">Door & Gate Opener</h1>
    <p style="margin:0 0 16px">Link firmati (scadenza: ${LINK_TTL_SECONDS}s) e apertura manuale.</p>
    <table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;min-width:300px">
      <thead><tr>
        <th style="padding:8px 12px;text-align:left">Nome</th>
        <th style="padding:8px 12px;text-align:left">Device ID</th>
        <th style="padding:8px 12px;text-align:left">Smart Link</th>
        <th style="padding:8px 12px;text-align:left">Manual Open</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    <p style="margin-top:16px;font-size:12px;opacity:.7">Shard auto: account discovery via <code>${ACCOUNT_BASE}</code></p>
  </body></html>`);
});

// ===== Smart Link =====
app.get("/open", async (req, res) => {
  const { device, ts, sig } = req.query;
  if (!device || !ts || !sig) return res.status(400).json({ ok:false, error:"Missing query params" });
  if (!DEVICES[device]) return res.status(404).json({ ok:false, error:"Unknown device" });
  if (!verify(device, ts, sig)) return res.status(401).json({ ok:false, error:"Invalid or expired link" });

  const result = await shellyPulse(device);
  if (result.ok) return res.json({ ok:true, device, name:DEVICES[device].name, path: result.path, baseUrl: result.baseUrl, encoding: "form" });
  return res.status(502).json(result);
});

// ===== Manual Open =====
app.get("/manual-open/:deviceId", async (req, res) => {
  const device = req.params.deviceId;
  if (!DEVICES[device]) return res.status(404).send("Unknown device");
  const result = await shellyPulse(device);
  if (result.ok) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<p>✅ Aperto: <b>${DEVICES[device].name}</b> (<code>${device}</code>) – via <code>${result.path}</code> su <code>${result.baseUrl}</code> (form)</p>
    <p><a href="/">← Torna alla lista</a></p>`);
  }
  res.status(502).send(`<pre>${JSON.stringify(result, null, 2)}</pre>`);
});

// ===== Health =====
app.get("/health", (_req, res) => res.json({ ok:true }));

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
