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

// ===== ENV (coerenti con le tue foto su Render) =====
const PORT = process.env.PORT || 3000;
const SHELLY_AUTH_KEY =
  process.env.SHELLY_API_KEY || process.env.SHELLY_AUTH_KEY || "";
const SHELLY_CLOUD_BASE_URL =
  process.env.SHELLY_BASE_URL ||
  process.env.SHELLY_CLOUD_BASE_URL ||
  "https://shelly-api-eu.shelly.cloud";
const HMAC_SECRET =
  process.env.TOKEN_SECRET || process.env.HMAC_SECRET || "change-me";
const LINK_TTL_SECONDS = parseInt(process.env.LINK_TTL_SECONDS || "300", 10);

if (!SHELLY_AUTH_KEY) {
  console.warn("[WARN] SHELLY_API_KEY (auth_key) non impostata.");
}

// ===== DEVICES =====
const DEVICES = {
  "34945479fbbe": { name: "Arenula 16 – Gate" },
  "3494547a9395": { name: "Arenula 16 – Door" },
  "3494547ab05e": { name: "Portico 1D – Gate" },
  "3494547ab62b": { name: "Portico 1D – Door" },
  "3494547a887d": { name: "Via della Scala 17 – Gate" },
  "3494547745ee": { name: "Via della Scala 17 – Door" },
  "3494547a1075": { name: "Viale Trastevere 108 – Gate" },
  "34945479fa35": { name: "Viale Trastevere 108 – Door" },
  "34945479fd73": { name: "Leonina 71 – Gate/Door" }
};

// ===== HMAC =====
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

// ===== Shelly pulse: prova /turn e poi /control =====
async function shellyCall(path, payload) {
  const url = `${SHELLY_CLOUD_BASE_URL}${path}`;
  return axios.post(url, payload, { timeout: 10000 });
}
async function shellyPulse(deviceId, durationMs = 800) {
  const payloadOn  = { id: deviceId, auth_key: SHELLY_AUTH_KEY, channel: 0, turn: "on"  };
  const payloadOff = { id: deviceId, auth_key: SHELLY_AUTH_KEY, channel: 0, turn: "off" };

  const tryPaths = ["/device/relay/turn", "/device/relay/control"];
  let lastErr = null;

  for (const p of tryPaths) {
    try {
      const onRes = await shellyCall(p, payloadOn);
      await new Promise(r => setTimeout(r, durationMs));
      const offRes = await shellyCall(p, payloadOff);
      return { ok: true, on: onRes.data, off: offRes.data, path: p };
    } catch (err) {
      lastErr = {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err.message,
        path: p,
        baseUrl: SHELLY_CLOUD_BASE_URL
      };
      const code = err?.response?.status;
      if (![401, 403, 404].includes(code)) break;
    }
  }
  return { ok: false, error: "Shelly request failed", details: lastErr };
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
    <p style="margin-top:16px;font-size:12px;opacity:.7">Shelly base: <code>${SHELLY_CLOUD_BASE_URL}</code></p>
  </body></html>`);
});

// ===== Smart Link =====
app.get("/open", async (req, res) => {
  const { device, ts, sig } = req.query;
  if (!device || !ts || !sig) return res.status(400).json({ ok:false, error:"Missing query params" });
  if (!DEVICES[device]) return res.status(404).json({ ok:false, error:"Unknown device" });
  if (!verify(device, ts, sig)) return res.status(401).json({ ok:false, error:"Invalid or expired link" });

  const result = await shellyPulse(device);
  if (result.ok) return res.json({ ok:true, device, name:DEVICES[device].name, path: result.path });
  return res.status(502).json(result);
});

// ===== Manual Open =====
app.get("/manual-open/:deviceId", async (req, res) => {
  const device = req.params.deviceId;
  if (!DEVICES[device]) return res.status(404).send("Unknown device");
  const result = await shellyPulse(device);
  if (result.ok) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<p>✅ Aperto: <b>${DEVICES[device].name}</b> (<code>${device}</code>) – via <code>${result.path}</code></p>
    <p><a href="/">← Torna alla lista</a></p>`);
  }
  res.status(502).send(`<pre>${JSON.stringify(result, null, 2)}</pre>`);
});

// ===== Health =====
app.get("/health", (_req, res) => res.json({ ok:true, shard:SHELLY_CLOUD_BASE_URL }));

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
