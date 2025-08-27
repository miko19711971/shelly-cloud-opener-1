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
  process.env.SHELLY_API_KEY || process.env.SHELLY_AUTH_KEY || ""; // chiave cloud dell'account
const HMAC_SECRET =
  process.env.TOKEN_SECRET || process.env.HMAC_SECRET || "change-me";
const LINK_TTL_SECONDS = parseInt(process.env.LINK_TTL_SECONDS || "300", 10);

// endpoint account per discovery
const ACCOUNT_BASE = "https://shelly-api-eu.shelly.cloud";
// fallback shard forzato (dalle Impostazioni Utente dell’app)
const FORCED_BASE =
  process.env.SHELLY_BASE_URL && process.env.SHELLY_BASE_URL.startsWith("http")
    ? process.env.SHELLY_BASE_URL
    : null;

if (!SHELLY_AUTH_KEY) {
  console.warn("[WARN] SHELLY_API_KEY non impostata.");
}

// ===== DEVICES (HEX -> { name, dec }) =====
// Inserisci i Decimal Id quando li hai (Arenula già inserito).
const DEVICES = {
  // Arenula 16 — Building Door
  "3494547ab05e": { name: "Arenula 16 — Building Door", dec: "57811677130846" },

  // Leonina 71
  "3494547a9395": { name: "Leonina 71 — Apartment Door", dec: "" },
  "34945479fbbe": { name: "Leonina 71 — Building Door", dec: "" },

  // Via della Scala 17
  "3494547a1075": { name: "Via della Scala 17 — Apartment Door", dec: "" },
  "3494547745ee": { name: "Via della Scala 17 — Building Door", dec: "" },

  // Portico d’Ottavia 1D
  "3494547a887d": { name: "Portico d’Ottavia 1D — Apartment Door", dec: "" },
  "3494547ab62b": { name: "Portico d’Ottavia 1D — Building Door", dec: "" },

  // Viale Trastevere 108
  "34945479fa35": { name: "Viale Trastevere 108 — Apartment Door", dec: "" },
  "34945479fd73": { name: "Viale Trastevere 108 — Building Door", dec: "" }
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

// ===== Discovery shard (prova HEX, poi DEC; altrimenti FORCED_BASE) =====
const deviceShardCache = new Map(); // HEX -> baseUrl

async function statusQuery(idValue) {
  const url = `${ACCOUNT_BASE}/device/status`;
  const body = new URLSearchParams({ id: idValue, auth_key: SHELLY_AUTH_KEY }).toString();
  const { data } = await axios.post(url, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000
  });
  return data;
}

async function resolveDeviceBaseUrl(hexId) {
  if (deviceShardCache.has(hexId)) return deviceShardCache.get(hexId);

  const decId = DEVICES[hexId]?.dec || null;

  // 1) tenta con HEX
  try {
    const d1 = await statusQuery(hexId);
    console.log("[status.hex.raw]", JSON.stringify(d1));
    const server =
      d1?.data?.device?.server_name || d1?.data?.server || d1?.data?.domain || d1?.server || d1?.domain;
    if (server) {
      const base = server.startsWith("http") ? server : `https://${server}`;
      deviceShardCache.set(hexId, base);
      console.log("[status.ok HEX]", hexId, "->", base);
      return base;
    }
  } catch (e) {
    const st = e?.response?.status;
    const msg = e?.response?.data || e?.message;
    console.log("[status.hex.error]", st, msg);
  }

  // 2) se fallisce e abbiamo il DEC, ritenta con DEC
  if (decId) {
    try {
      const d2 = await statusQuery(decId);
      console.log("[status.dec.raw]", JSON.stringify(d2));
      const server =
        d2?.data?.device?.server_name || d2?.data?.server || d2?.data?.domain || d2?.server || d2?.domain;
      if (server) {
        const base = server.startsWith("http") ? server : `https://${server}`;
        deviceShardCache.set(hexId, base);
        console.log("[status.ok DEC]", hexId, "->", base);
        return base;
      }
    } catch (e) {
      const st = e?.response?.status;
      const msg = e?.response?.data || e?.message;
      console.log("[status.dec.error]", st, msg);
    }
  }

  // 3) fallback sul FORCED_BASE se impostato nelle env
  if (FORCED_BASE) {
    console.log("[status.fallback FORCED_BASE]", hexId, "->", FORCED_BASE);
    deviceShardCache.set(hexId, FORCED_BASE);
    return FORCED_BASE;
  }

  // 4) ultimissimo ripiego (potrebbe dare wrong_type)
  console.log("[status.fallback ACCOUNT_BASE]", hexId, "->", ACCOUNT_BASE);
  return ACCOUNT_BASE;
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

// ===== Apertura relè con un'unica chiamata (timer lato cloud) =====
async function shellyPulse(hexId, seconds = 1) {
  const baseUrl = await resolveDeviceBaseUrl(hexId);

  // un solo POST: ON + timer (Shelly spegne da solo)
  const payload = {
    id: hexId,
    auth_key: SHELLY_AUTH_KEY,
    channel: "0",
    turn: "on",
    timer: String(seconds)   // spegni dopo N secondi
  };

  try {
    const res = await shellyPostForm(baseUrl, "/device/relay/control", payload);
    const data = res.data || {};
    // Consideriamo ok anche se non espone esplicitamente isok:true
    return { ok: true, on: data, path: "/device/relay/control", baseUrl, encoding: "form" };
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
    <p style="margin-top:16px;font-size:12px;opacity:.7">Discovery: HEX→DEC→FORCED_BASE | account: <code>${ACCOUNT_BASE}</code></p>
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

// ===== Manual Open (JSON) =====
app.get("/manual-open/:hexId", async (req, res) => {
  const hexId = req.params.hexId;
  if (!DEVICES[hexId]) return res.status(404).json({ ok:false, error:"Unknown device", device: hexId });
  try {
    const result = await shellyPulse(hexId);
    return res.status(result.ok ? 200 : 502).json({ device: hexId, name: DEVICES[hexId].name, ...result });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"handler_crash", message: e?.message });
  }
});

// ===== Health & debug =====
app.get("/health", (_req, res) => res.json({ ok:true, forcedBase: FORCED_BASE || null, accountBase: ACCOUNT_BASE }));
app.get("/resolve/:hexId", async (req, res) => {
  const baseUrl = await resolveDeviceBaseUrl(req.params.hexId);
  res.json({ ok:true, device: req.params.hexId, baseUrl });
});

app.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
