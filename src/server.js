import express from "express";
import axios from "axios";
import crypto from "crypto";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import bodyParser from "body-parser";
import { matchIntent } from "./matcher.js";
import { detectLanguage } from "./language.js";
import { ANSWERS } from "./answers.js";
import { askGemini, askGeminiGuide } from "./gemini.js";
import bibaRouter from "./biba-router.js";
 const SAFE_FALLBACK_REPLY =
  "Thank you for your message. We've received your request and we'll get back to you as soon as possible.";
const app = express();

app.use(bodyParser.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.disable("x-powered-by");
app.set("trust proxy", true);

// ── Biba QR token system ──────────────────────────────────────────────────────
app.use("/biba", bibaRouter);
  
 // ========================================================================
// ARRIVAL SLOT DECIDER
// ========================================================================
function decideSlots(arrivalTime, checkInDate) {
  const allSlots = ["11", "18", "2030", "2330"];
  const slotMinutes = { "11": 660, "18": 1080, "2030": 1230, "2330": 1410 };


  if (!checkInDate) {
    return allSlots.map(slot => ({ slot, date: checkInDate }));
  }
  if (!arrivalTime) {
    arrivalTime = "13:00";
  }

  let arrivalMinutes;
  if (arrivalTime.includes(":")) {
    const parts = arrivalTime.replace(/[apm]/gi, "").trim().split(":");
    let h = parseInt(parts[0]);
    const m = parseInt(parts[1]) || 0;
    if (/pm/i.test(arrivalTime) && h !== 12) h += 12;
    if (/am/i.test(arrivalTime) && h === 12) h = 0;
    arrivalMinutes = h * 60 + m;
  } else {
    arrivalMinutes = 780;
  }

  // FIX: ogni slot calcola il proprio offset indipendentemente
  return allSlots.map(slot => {
    const offset = slotMinutes[slot] <= arrivalMinutes ? 1 : 0;
    const date = new Date(checkInDate + "T12:00:00");
    date.setDate(date.getDate() + offset);
    return { slot, date: date.toISOString().slice(0, 10) };
  });
}
// ========================================================================
// SLOT SCHEDULER — CRON OGNI MINUTO
// ========================================================================



async function getConversationId(reservationId) {
  try {
    const r = await axios.get(
      `https://api.hostaway.com/v1/conversations?reservationId=${reservationId}`,
      { headers: { Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}` }, timeout: 8000 }
    );
    const conversations = r.data?.result || [];
    return conversations[0]?.id || null;
  } catch (e) {
    console.error("❌ getConversationId error:", reservationId, e.message);
    return null;
  }
}

// Restituisce true se l'ospite ha scritto un messaggio negli ultimi `minutes` minuti.
// Usata dai cron per non interrompere conversazioni attive.
async function hasRecentGuestMessage(conversationId, minutes = 30) {
  try {
    const r = await axios.get(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages?limit=10`,
      { headers: { Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}` }, timeout: 8000 }
    );
    const messages = r.data?.result || [];
    const cutoff = Date.now() - minutes * 60 * 1000;
    return messages.some(msg => {
      const isGuest = msg.senderRole === "guest" || msg.authorRole === "guest";
      const ts = new Date(msg.insertedAt || msg.createdAt || 0).getTime();
      return isGuest && ts >= cutoff;
    });
  } catch (e) {
    console.error("❌ hasRecentGuestMessage error:", conversationId, e.message);
    return false; // In caso di errore, non bloccare l'invio
  }
}

async function runSlotCron() {
  const now = new Date();

  const today = now
    .toLocaleString("it-IT", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
    .split("/").reverse().join("-");

  const h = parseInt(now.toLocaleString("it-IT", { timeZone: "Europe/Rome", hour: "numeric", hour12: false }));
  const m = parseInt(now.toLocaleString("it-IT", { timeZone: "Europe/Rome", minute: "numeric" }));


  const currentSlot =
    h === 11 && m === 0 ? "11" :
    h === 18 && m === 0 ? "18" :
    h === 20 && m === 30 ? "2030" :
    h === 23 && m === 30 ? "2330" :
    null;

  if (!currentSlot) return;
  console.log("🔄 runSlotCron slot:", currentSlot, now.toISOString());

  try {
    const r = await axios.get(
      `https://api.hostaway.com/v1/reservations?limit=500`,
      { headers: { Authorization: `Bearer ${process.env.HOSTAWAY_TOKEN}` }, timeout: 30000 }

    );

    const reservations = r.data?.result || [];

    const yesterday = new Date(Date.now() - 86400000)
      .toLocaleString("it-IT", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
      .split("/").reverse().join("-");

    const dayBeforeYesterday = new Date(Date.now() - 172800000)
      .toLocaleString("it-IT", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
      .split("/").reverse().join("-");

    for (const res of reservations) {
      const checkInDate = res.arrivalDate || res.checkInDate;
      if (checkInDate !== today && checkInDate !== yesterday && checkInDate !== dayBeforeYesterday) continue;
      if (res.status === "cancelled") continue;

      console.log("🔍 res:", res.id, checkInDate, res.arrivalTime, res.listingMapId);

      // Usa cache GUEST_ARRIVAL_TIMES (popolata da webhook/first-open) con fallback API
      const arrivalTime = await getArrivalTime(res.id, res.arrivalTime || null);
      console.log("🔎 arrivalTime risolto:", res.id, arrivalTime);

      const slots = decideSlots(arrivalTime, checkInDate);

      const matchingSlot = slots.find(s => s.slot === currentSlot && s.date === today);
     
      if (!matchingSlot) continue;

      const key = `${res.id}-${currentSlot}`;
      if (SENT_SLOTS.has(key)) continue;

      const conversationId = await getConversationId(res.id);
      if (!conversationId) continue;

      const langRaw = (res.guestLanguage || res.guestLocale || "en").toLowerCase();
      const langMap = {
        "spanish": "es", "castilian": "es", "french": "fr", "italian": "it",
        "german": "de", "english": "en", "deutsch": "de", "italiano": "it",
        "français": "fr", "español": "es"
      };
      const guestLang = langMap[langRaw.split(",")[0].trim()] || langRaw.slice(0, 2) || "en";
      console.log("🌍 Lingua rilevata:", res.id, langRaw, "→", guestLang);

      const apartmentMap = {
        194164: "trastevere",
        194165: "portico",
        194166: "arenula",
        194162: "scala",
        194163: "leonina"
      };
      const apartment = apartmentMap[res.listingMapId];
      if (!apartment) continue;

      try {
        // Non interrompere una conversazione attiva con l'ospite
        const conversationBusy = await hasRecentGuestMessage(conversationId, 30);
        if (conversationBusy) {
          console.log("⏸ Slot skippato (conversazione attiva):", apartment, currentSlot);
          SENT_SLOTS.add(key); // Evita retry: il messaggio di attività non è critico
          continue;
        }
        await sendSlotLiveMessage({ conversationId, apartment, slot: currentSlot, lang: guestLang });
        SENT_SLOTS.add(key);
        console.log("📨 Slot inviato:", apartment, currentSlot);
      } catch (e) {
        console.error("❌ Errore slot", currentSlot, e.message);
      }
    }
    console.log("✅ runSlotCron completato:", currentSlot);
  } catch (e) {
    console.error("❌ runSlotCron error:", e.message);
  }
}

const SENT_SLOTS = new Set();
setInterval(runSlotCron, 60000);

// ========================================================================
// PHASE 3 GUIDE SCHEDULER
// ========================================================================
// Map<key, { conversationId, apartment, lang, sendAt: Date, sent: boolean }>
const PENDING_PHASE3 = new Map();

// ── Persistence: sopravvive ai deploy ────────────────────────────────────
const PHASE3_PERSIST_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'phase3-pending.json');

function savePhase3State() {
  const data = [];
  for (const [key, entry] of PENDING_PHASE3.entries()) {
    data.push([key, { ...entry, sendAt: entry.sendAt instanceof Date ? entry.sendAt.toISOString() : entry.sendAt }]);
  }
  fs.writeFile(PHASE3_PERSIST_FILE, JSON.stringify(data, null, 2), 'utf8')
    .catch(e => console.error('❌ Save phase3 state error:', e.message));
}

// Carica stato precedente all'avvio (non-blocking)
fs.readFile(PHASE3_PERSIST_FILE, 'utf8').then(raw => {
  const data = JSON.parse(raw);
  let loaded = 0;
  for (const [key, entry] of data) {
    if (entry.sent) continue;
    PENDING_PHASE3.set(key, { ...entry, sendAt: new Date(entry.sendAt) });
    loaded++;
  }
  if (loaded > 0) console.log(`✅ Phase 3 state restored: ${loaded} pending entries`);
}).catch(() => {}); // file non esiste al primo avvio — OK

async function sendPhase2GuideMessage({ conversationId, apartment, lang = "en", reservationId = null, checkoutDate = null }) {
  // Send personalised /stay link — device registration + session happen server-side on first open
  const guideUrl     = `https://shelly-cloud-opener-1.onrender.com/stay/${apartment}?r=${reservationId}&lang=${lang}`;
  const homeGuideUrl = `https://shelly-cloud-opener-1.onrender.com/stay-home/${apartment}?r=${reservationId}&lang=${lang}`;
  const textMap = {
    en: `✅ Your online check-in is confirmed!\nYour personal guest guide is now ready — apartment info, Wi-Fi and everything you need:\n${guideUrl}\n\n🗺 Rome Concierge — restaurants, experiences and local tips:\n${homeGuideUrl}`,
    it: `✅ Il tuo check-in online è confermato!\nLa tua guida personale è ora disponibile — info appartamento, Wi-Fi e tutto quello che ti serve:\n${guideUrl}\n\n🗺 Roma Concierge — ristoranti, esperienze e consigli locali:\n${homeGuideUrl}`,
    fr: `✅ Votre check-in en ligne est confirmé!\nVotre guide personnel est maintenant disponible — infos appartement, Wi-Fi et tout ce dont vous avez besoin:\n${guideUrl}\n\n🗺 Rome Concierge — restaurants, expériences et conseils locaux:\n${homeGuideUrl}`,
    de: `✅ Ihr Online-Check-in ist bestätigt!\nIhr persönlicher Guide ist jetzt verfügbar — Wohnungsinfos, WLAN und alles was Sie brauchen:\n${guideUrl}\n\n🗺 Rom Concierge — Restaurants, Erlebnisse und lokale Tipps:\n${homeGuideUrl}`,
    es: `✅ ¡Tu check-in online está confirmado!\nTu guía personal ya está disponible — info del apartamento, Wi-Fi y todo lo que necesitas:\n${guideUrl}\n\n🗺 Roma Concierge — restaurantes, experiencias y consejos locales:\n${homeGuideUrl}`,
  };
  const message = textMap[lang] || textMap.en;
  await sendHostawayMessage({ conversationId, message });
  console.log(`📲 Phase 2 guide sent: ${apartment} | res:${reservationId} | lang:${lang}`);
}

async function sendPhase3GuideMessage({ conversationId, apartment, lang = "en", checkinDate = null }) {
  const _now = Date.now();
  const _jti = b64url(crypto.randomBytes(9));
  const _tp = { tgt: `checkin-${apartment}`, exp: _now + 1440*60*1000, max: 200, used: 0, jti: _jti, iat: _now, ver: TOKEN_VERSION, day: checkinDate || tzToday(), cid: conversationId };
  const t = makeToken(_tp);
  const guideUrl = `https://shelly-cloud-opener-1.onrender.com/checkin/${apartment}/index.html?t=${t}&lang=${lang}`;

  const textMap = {
    en: `🗝 Your digital keys are now active!\nOpen your guide to access the building and apartment:\n${guideUrl}`,
    it: `🗝 Le tue chiavi digitali sono ora attive!\nApri la guida per accedere al palazzo e all'appartamento:\n${guideUrl}`,
    fr: `🗝 Vos clés numériques sont maintenant actives!\nOuvrez votre guide pour accéder à l'immeuble et à l'appartement:\n${guideUrl}`,
    de: `🗝 Ihre digitalen Schlüssel sind jetzt aktiv!\nÖffnen Sie Ihren Guide für den Zugang zum Gebäude und zur Wohnung:\n${guideUrl}`,
    es: `🗝 ¡Tus llaves digitales están ahora activas!\nAbre tu guía para acceder al edificio y al apartamento:\n${guideUrl}`,
  };

  const message = textMap[lang] || textMap.en;
  await sendHostawayMessage({ conversationId, message });
  console.log(`📲 Phase 3 guide sent: ${apartment} | lang:${lang}`);
}

async function runPhase3Cron() {
  const now = new Date();
  for (const [key, entry] of PENDING_PHASE3.entries()) {
    if (entry.sent) continue;
    if (now >= entry.sendAt) {
      try {
        await sendPhase3GuideMessage({
          conversationId: entry.conversationId,
          apartment: entry.apartment,
          lang: entry.lang,
          checkinDate: entry.checkinDate || null,
        });
        entry.sent = true;
        savePhase3State();
        console.log(`✅ Phase 3 inviato: ${key}`);
      } catch (e) {
        console.error(`❌ Errore phase 3 send: ${key}`, e.message);
      }
    }
  }
}
setInterval(runPhase3Cron, 60000);

// OTP STORE
const OTP_STORE = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of OTP_STORE.entries()) if (now > v.exp) OTP_STORE.delete(k);
}, 60000);


// ========================================================================
// SEND SLOT LIVE MESSAGE
// ========================================================================
 async function sendSlotLiveMessage({ conversationId, apartment, slot, lang = "en" }) {
  const baseUrlMap = {
    arenula: "/portico",
    leonina: "/monti",
    portico: "/portico",
    scala: "/scala",
    trastevere: "/viale-trastevere"
  };

  const choiceMap = {
    "11": "passeggiata",
    "18": "aperitivo",
    "2030": "passeggiata",
    "2330": "dormire"
  };

  const rainSafeChoiceMap = {
    "11": "caffe",
    "18": "aperitivo",
    "2030": "cena",
    "2330": "dormire"
  };

  const textMap = {
    it: "Scopri cosa fare ora:",
    en: "Discover what to do now:",
    fr: "Découvrez quoi faire maintenant:",
    es: "Descubre qué hacer ahora:",
    de: "Entdecke, was du jetzt tun kannst:"
  };

  const base = baseUrlMap[apartment];
  if (!base) return;

  let raining = false;
  try {
    raining = await isRainingToday();
  } catch (e) {
    console.error("☔ Rain check error:", e.message);
  }

  const choice = raining
    ? rainSafeChoiceMap[slot]
    : choiceMap[slot];

  if (!choice) return;

  const text = textMap[lang] || textMap.en;

  const message =
    `🕒 ${slot}\n` +
    `${text}\n` +
    `${process.env.BASE_URL}${base}?slot=${slot}&choice=${choice}&lang=${lang}`;

  await sendHostawayMessage({
    conversationId,
    message
  });
}


 // ========================================================================
// METEO — RAIN DETECTION (ROMA)
// ========================================================================
const ROME_LAT = 41.9028;
const ROME_LON = 12.4964;

async function isRainingToday() {
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${ROME_LAT}&lon=${ROME_LON}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric`;
    const { data } = await axios.get(url, { timeout: 8000 });

    const nextHours = data.list.slice(0, 4);
    return nextHours.some(item =>
      item.weather.some(w =>
        ["Rain", "Drizzle", "Thunderstorm"].includes(w.main)
      )
    );
  } catch (err) {
    console.error("☔ METEO ERROR → fallback asciutto", err.message);
    return false;
  }
}

app.use((req, res, next) => {
  if (req.url.includes("/feedback")) {
    console.log("HIT FEEDBACK RAW", req.method, req.headers["content-type"]);
  }
  next();
});

app.options("/feedback", cors());

app.post("/feedback", cors(), async (req, res) => {
  console.log("FEEDBACK ARRIVATO", req.body);
  try {
    await fetch("https://script.google.com/macros/s/AKfycbwut-C1NoqZAxAPKFQO_JVb_O5mPbEYjCVTVecWiSOMgJ31GCtiQjNPHOnQI3h5KZsy/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("ERRORE FEEDBACK â APPS SCRIPT", err);
    res.status(500).json({ ok: false });
  }
});

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    return cb(null, false);
  },
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400
};

const corsMw = cors(corsOptions);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const SHELLY_API_KEY  = process.env.SHELLY_API_KEY;
const SHELLY_BASE_URL = process.env.SHELLY_BASE_URL || "https://shelly-api-eu.shelly.cloud";
const TOKEN_SECRET    = process.env.TOKEN_SECRET;
const SESSION_SECRET  = process.env.SESSION_SECRET || (TOKEN_SECRET + '|guide-sessions');
const HOSTAWAY_TOKEN  = process.env.HOSTAWAY_TOKEN;
const HOSTAWAY_WEBHOOK_BOOKING_SECRET = process.env.HOSTAWAY_WEBHOOK_BOOKING_SECRET;
const ADMIN_SECRET = process.env.ADMIN_SECRET;

if (!ADMIN_SECRET) {
  console.error("â Missing ADMIN_SECRET env var");
  process.exit(1);
}

function requireAdmin(req, res, next) {
  const h = req.get("x-admin-secret") || "";
  if (!safeEqual(h, ADMIN_SECRET)) {
    return res.status(403).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

console.log("ð¥ Hostaway token caricato:", HOSTAWAY_TOKEN ? "OK" : "MANCANTE");

if (!HOSTAWAY_TOKEN) {
  console.error("â Missing HOSTAWAY_TOKEN env var (risposte automatiche HostAway disattivate).");
}

if (!HOSTAWAY_WEBHOOK_BOOKING_SECRET) {
  console.error("â Missing HOSTAWAY_WEBHOOK_BOOKING_SECRET env var.");
}

if (!TOKEN_SECRET) {
  console.error("â Missing TOKEN_SECRET env var");
  process.exit(1);
}

const TIMEZONE = process.env.TIMEZONE || "Europe/Rome";
const ALLOW_TODAY_FALLBACK = process.env.ALLOW_TODAY_FALLBACK === "1";
const ROTATION_TAG   = "R-2025-09-18-final";
const TOKEN_VERSION  = 100;
const LINK_PREFIX    = "/k3";
const SIGNING_SECRET = `${TOKEN_SECRET}|${ROTATION_TAG}`;
const REVOKE_BEFORE  = parseInt(process.env.REVOKE_BEFORE || "0", 10);
const STARTED_AT     = Date.now();
const DEFAULT_WINDOW_MIN = parseInt(process.env.WINDOW_MIN || "15", 10);
const DEFAULT_MAX_OPENS  = parseInt(process.env.MAX_OPENS  || "2", 10);
const GUIDE_WINDOW_MIN   = 1440;
const CHECKIN_WINDOW_MIN = 1440;

const GUIDE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https://script.google.com https://shelly-cloud-opener-1.onrender.com https://generativelanguage.googleapis.com https://api.open-meteo.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "navigate-to 'self' https://shelly-cloud-opener-1.onrender.com"
].join("; ");

function setGuideSecurityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", GUIDE_CSP);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
}
app.use(["/checkin", "/guides", "/guest-assistant", LINK_PREFIX], setGuideSecurityHeaders);

app.use((req, res, next) => {
  if (req.path.startsWith("/k/") || req.path.startsWith("/k2/") || req.path.startsWith(LINK_PREFIX)) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
  }
  res.setHeader("X-Link-Prefix", LINK_PREFIX);
  res.setHeader("X-Token-Version", String(TOKEN_VERSION));
  res.setHeader("X-Rotation-Tag", ROTATION_TAG);
  res.setHeader("X-Started-At", String(STARTED_AT));
  next();
});

const TARGETS = {
  "arenula-building": { name: "Arenula 16 â Building Door", ids: ["3494547ab05e"] },
  "leonina-door": { name: "Leonina 71 â Apartment Door", ids: ["3494547a9395"] },
  "leonina-building": { name: "Via Leonina 71 â Building Door", ids: ["34945479fbbe"] },
  "via-della-scala-door": { name: "Via della Scala 17 â Apartment Door", ids: ["3494547a1075"] },
  "via-della-scala-building": { name: "Via della Scala 17 â Building Door", ids: ["3494547745ee", "3494547745ee"] },
  "portico-1d-door": { name: "Portico d'Ottavia 1D â Apartment Door", ids: ["2cbcbb2f8ae8"] },
  "portico-1d-building": { name: "Portico d'Ottavia 1D â Building Door", ids: ["2cbcbb30fb90"] },
  "viale-trastevere-door": { name: "Viale Trastevere 108 â Apartment Door", ids: ["34945479fa35"] },
  "viale-trastevere-building": { name: "Building Door", ids: ["34945479fd73"] },
};

const RELAY_CHANNEL = 0;

async function shellyTurnOn(deviceId) {
  const form = new URLSearchParams({ id: deviceId, auth_key: SHELLY_API_KEY, channel: String(RELAY_CHANNEL), turn: "on" });
  try {
    const { data } = await axios.post(`${SHELLY_BASE_URL}/device/relay/control`, form.toString(), 
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 7000 });
    if (data && data.isok) return { ok: true, data };
    return { ok: false, status: 400, data };
  } catch (err) {
    return { ok: false, status: err?.response?.status || 500, data: err?.response?.data || String(err) };
  }
}

async function openOne(deviceId) {
  const first = await shellyTurnOn(deviceId);
  return first.ok ? { ok: true, first } : { ok: false, first };
}

async function openSequence(ids, delayMs = 10000) {
  const logs = [];
  for (let i = 0; i < ids.length; i++) {
    const r = await openOne(ids[i]);
    logs.push({ step: i + 1, device: ids[i], ...r });
    if (i < ids.length - 1) await new Promise(res => setTimeout(res, delayMs));
  }
  return { ok: logs.every(l => l.ok), logs };
}

function b64urlToBuf(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hmac(str) {
  return b64url(crypto.createHmac("sha256", SIGNING_SECRET).update(String(str)).digest());
}

function makeToken(payload) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = hmac(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}
function safeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
function parseToken(token) {
  const [h, b, s] = (token || "").split(".");
  if (!h || !b || !s) return { ok: false, error: "bad_format" };
  const sig = hmac(`${h}.${b}`);
  if (!safeEqual(sig, s)) return { ok: false, error: "bad_signature" };
  let payload;
  try {
    payload = JSON.parse(b64urlToBuf(b).toString("utf8"));
  } catch {
    return { ok: false, error: "bad_payload" };
  }
  if (typeof payload.ver !== "number" || payload.ver !== TOKEN_VERSION) return { ok: false, error: "bad_version" };
  if (REVOKE_BEFORE && typeof payload.iat === "number" && payload.iat < REVOKE_BEFORE) return { ok: false, error: "revoked" };
  if (typeof payload.iat !== "number" || payload.iat < STARTED_AT) return { ok: false, error: "revoked_boot" };
  return { ok: true, payload };
}

// Like parseToken but skips revoked_boot — for long-lived guide tokens
function parseGuideToken(token) {
  const [h, b, s] = (token || "").split(".");
  if (!h || !b || !s) return { ok: false, error: "bad_format" };
  const sig = hmac(`${h}.${b}`);
  if (!safeEqual(sig, s)) return { ok: false, error: "bad_signature" };
  let payload;
  try {
    payload = JSON.parse(b64urlToBuf(b).toString("utf8"));
  } catch {
    return { ok: false, error: "bad_payload" };
  }
  if (typeof payload.ver !== "number" || payload.ver !== TOKEN_VERSION) return { ok: false, error: "bad_version" };
  if (REVOKE_BEFORE && typeof payload.iat === "number" && payload.iat < REVOKE_BEFORE) return { ok: false, error: "revoked" };
  return { ok: true, payload };
}

function newTokenFor(targetKey, opts = {}) {
  const max = opts.max ?? DEFAULT_MAX_OPENS;
  const windowMin = opts.windowMin ?? DEFAULT_WINDOW_MIN;
  const now = Date.now();
  const exp = now + windowMin * 60 * 1000;
  const jti = b64url(crypto.randomBytes(9));
  const payload = { tgt: targetKey, exp, max, used: opts.used ?? 0, jti, iat: now, ver: TOKEN_VERSION, day: opts.day };
  return { token: makeToken(payload), payload };
}

const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const TODAY_LOCK = new Map();
const OPEN_USAGE = new Map();

function usageKey(p) {
  return `${p.tgt}:${p.jti}`;
}

function getUsage(p) {
  const key = usageKey(p);
  const u = OPEN_USAGE.get(key);
  if (u && u.exp && Date.now() > u.exp) {
    OPEN_USAGE.delete(key);
    return { count: 0, exp: p.exp };
  }
  return u || { count: 0, exp: p.exp };
}

function tzToday() {
  return fmtDay.format(new Date());
}

function isYYYYMMDD(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Returns UTC ms for 11:00 AM Europe/Rome on checkoutDateStr (YYYY-MM-DD).
// Handles both CET (UTC+1) and CEST (UTC+2) automatically.
function checkoutExpiryMs(checkoutDateStr) {
  if (!isYYYYMMDD(checkoutDateStr)) return null;
  const [y, mo, d] = checkoutDateStr.split('-').map(Number);
  // Try UTC 09:00 (= 11:00 CEST) then UTC 10:00 (= 11:00 CET)
  for (const utcH of [9, 10]) {
    const candidate = new Date(Date.UTC(y, mo - 1, d, utcH, 0, 0));
    const romeHour = parseInt(
      candidate.toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: 'numeric', hour12: false })
    );
    if (romeHour === 11) return candidate.getTime();
  }
  return Date.UTC(y, mo - 1, d, 9, 0, 0); // fallback CEST
}

// ========================================================================
// GUIDE GUARD — device registry + session cookies (max 2 devices/reservation)
// ========================================================================
const GUIDE_DEVICES = new Map();   // reservationId → Set<deviceId>
const MAX_GUIDE_DEVICES = 2;
const GUIDE_PING_SENT = new Set(); // reservationId → già notificato (dedup in-memory)
const VALID_APARTMENTS = ['trastevere', 'portico', 'arenula', 'scala', 'leonina'];

// ── Guest arrival time cache ─────────────────────────────────────────────────
// Populated by webhook (reservation.updated / guestCheckin) and live Hostaway lookup.
// Key: reservationId (string) → { time: "HH:MM", fetchedAt: Date.now() }
const GUEST_ARRIVAL_TIMES = new Map();
const ARRIVAL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function parseArrivalTime(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[apm\s]/gi, '');
  const parts = cleaned.split(':').map(n => parseInt(n, 10));
  let h = parts[0], m = parts[1] || 0;
  if (/pm/i.test(raw) && h !== 12) h += 12;
  if (/am/i.test(raw) && h === 12) h = 0;
  if (isNaN(h) || h < 0 || h > 23) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function fetchAndCacheArrivalTime(reservationId) {
  if (!reservationId || !HOSTAWAY_TOKEN) return null;
  try {
    const r = await axios.get(
      `https://api.hostaway.com/v1/reservations/${reservationId}`,
      { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 8000 }
    );
    const raw = r.data?.result?.arrivalTime || r.data?.result?.checkInTime || null;
    const parsed = parseArrivalTime(typeof raw === 'number' ? `${raw}:00` : raw);
    if (parsed) {
      GUEST_ARRIVAL_TIMES.set(String(reservationId), { time: parsed, fetchedAt: Date.now() });
      console.log(`⏰ ArrivalTime cached for res ${reservationId}: ${parsed}`);
    }
    return parsed;
  } catch (e) {
    console.error('❌ fetchAndCacheArrivalTime error:', reservationId, e.message);
    return null;
  }
}

async function getArrivalTime(reservationId, fallback) {
  const cached = GUEST_ARRIVAL_TIMES.get(String(reservationId));
  if (cached && Date.now() - cached.fetchedAt < ARRIVAL_CACHE_TTL_MS) return cached.time;
  const live = await fetchAndCacheArrivalTime(reservationId);
  return live || fallback || '13:00';
}
const APT_LISTING_MAP  = { 194164: 'trastevere', 194165: 'portico', 194166: 'arenula', 194162: 'scala', 194163: 'leonina' };

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    try { cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim()); } catch {}
  });
  return cookies;
}

function signGuardCookie(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyGuardCookie(value) {
  try {
    if (!value || typeof value !== 'string') return null;
    const dot  = value.lastIndexOf('.');
    if (dot < 0) return null;
    const data = value.slice(0, dot);
    const sig  = value.slice(dot + 1);
    const exp  = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    if (sig.length !== exp.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    return JSON.parse(Buffer.from(data, 'base64url').toString());
  } catch { return null; }
}

function requireGuideSession(req, res, next) {
  const apt     = String(req.params.apt || '').toLowerCase();
  const cookies = parseCookies(req);
  const session = verifyGuardCookie(cookies['guide_sess']);
  if (!session || Date.now() > session.exp || session.apartment !== apt) {
    return res.redirect(302, `/stay/${apt}`);
  }
  // Operator sessions bypass device limit
  if (!session.operator) {
    if (!GUIDE_DEVICES.has(session.reservationId)) GUIDE_DEVICES.set(session.reservationId, new Set());
    GUIDE_DEVICES.get(session.reservationId).add(session.deviceId);
  }
  req.guideSession = session;
  next();
}

function blockedPage(apt, reservationId, lang = 'en', emailError = false) {
  const L = {
    en: { title: 'App already active', msg: 'This Concierge App is already active on the maximum number of allowed devices.', resetTitle: 'Reset with booking email', placeholder: 'Email used for booking', btn: 'Reset access', err: 'Email not recognized. Please try again.', contact: 'Contact Michele' },
    it: { title: 'App già attiva', msg: "Quest'app è già attiva sul numero massimo di dispositivi consentiti.", resetTitle: "Reimposta con l'email di prenotazione", placeholder: 'Email usata per la prenotazione', btn: 'Reimposta accesso', err: 'Email non riconosciuta. Riprova.', contact: 'Contatta Michele' },
    fr: { title: 'App déjà active', msg: "Cette application est déjà active sur le nombre maximum d'appareils autorisés.", resetTitle: 'Réinitialiser avec l\'email de réservation', placeholder: 'Email utilisé pour la réservation', btn: 'Réinitialiser l\'accès', err: 'Email non reconnu. Veuillez réessayer.', contact: 'Contacter Michele' },
    de: { title: 'App bereits aktiv', msg: 'Diese App ist bereits auf der maximalen Anzahl erlaubter Geräte aktiv.', resetTitle: 'Mit Buchungs-E-Mail zurücksetzen', placeholder: 'Bei der Buchung verwendete E-Mail', btn: 'Zugang zurücksetzen', err: 'E-Mail nicht erkannt. Bitte erneut versuchen.', contact: 'Michele kontaktieren' },
    es: { title: 'App ya activa', msg: 'Esta aplicación ya está activa en el número máximo de dispositivos permitidos.', resetTitle: 'Restablecer con el email de reserva', placeholder: 'Email usado para la reserva', btn: 'Restablecer acceso', err: 'Email no reconocido. Por favor, inténtelo de nuevo.', contact: 'Contactar a Michele' },
  };
  const t = L[lang] || L.en;
  const hasReset = apt && reservationId;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NiceFlat Rome Concierge</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#120d09;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:24px}
.card{max-width:380px;width:100%;text-align:center}.icon{font-size:52px;margin-bottom:20px}
h1{color:#f5ead8;font-size:22px;font-weight:700;margin:0 0 12px}
p{color:#b7a894;font-size:15px;line-height:1.6;margin:0 0 28px}
a.btn{display:inline-block;background:linear-gradient(135deg,#e8c67a,#c89a48);color:#120d09;font-weight:700;font-size:15px;padding:14px 28px;border-radius:14px;text-decoration:none}
hr{border:none;border-top:1px solid rgba(214,176,109,.18);margin:28px 0}
.reset-title{color:#d6b06d;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:14px}
input[type=email]{width:100%;padding:13px 16px;background:rgba(255,255,255,.07);border:1px solid rgba(214,176,109,.3);border-radius:12px;color:#f5ead8;font-size:15px;margin-bottom:12px;outline:none}
input[type=email]::placeholder{color:#7a6d5e}
button{width:100%;padding:13px;background:linear-gradient(135deg,#e8c67a,#c89a48);color:#120d09;font-weight:700;font-size:15px;border:none;border-radius:14px;cursor:pointer}
.err{color:#e07a5f;font-size:13px;margin-bottom:12px}
</style></head><body><div class="card">
<div class="icon">🔒</div>
<h1>${t.title}</h1>
<p>${t.msg}</p>
<a class="btn" href="https://wa.me/393478783030">${t.contact}</a>
${hasReset ? `<hr>
<div class="reset-title">${t.resetTitle}</div>
${emailError ? `<div class="err">${t.err}</div>` : ''}
<form method="POST" action="/stay/${apt}/reset-session">
  <input type="hidden" name="r" value="${reservationId}">
  <input type="hidden" name="lang" value="${lang}">
  <input type="email" name="email" placeholder="${t.placeholder}" required autocomplete="email">
  <button type="submit">${t.btn}</button>
</form>` : ''}
</div></body></html>`;
}
// ── End Guide Guard ────────────────────────────────────────────────────────

const MONTHS_MAP = (() => {
  const m = new Map();
  ["january","february","march","april","may","june","july","august","september","october","november","december"]
    .forEach((n, i) => m.set(n, i + 1));
  ["jan","feb","mar","apr","may","jun","jul","aug","sep","sept","oct","nov","dec"]
    .forEach((n, i) => m.set(n, i + 1));
  [["gennaio","gen"],["febbraio","feb"],["marzo","mar"],["aprile","apr"],["maggio","mag"],["giugno","giu"],
   ["luglio","lug"],["agosto","ago"],["settembre","set"],["ottobre","ott"],["novembre","nov"],["dicembre","dic"]]
    .forEach(([full, short], i) => { m.set(full, i + 1); m.set(short, i + 1); });
  [["enero","ene"],["febrero","feb"],["marzo","mar"],["abril","abr"],["mayo","may"],["junio","jun"],
   ["julio","jul"],["agosto","ago"],["septiembre","sep"],["octubre","oct"],["noviembre","nov"],["diciembre","dic"]]
    .forEach(([full, short], i) => { m.set(full, i + 1); m.set(short, i + 1); });
  [["janvier","jan"],["fÃ©vrier","fevrier"],["mars","mar"],["avril","avr"],["mai","mai"],["juin","juin"],
   ["juillet","juillet"],["aoÃ»t","aout"],["septembre","sep"],["octobre","oct"],["novembre","nov"],["dÃ©cembre","decembre"]]
    .forEach(([full, short], i) => { 
      const f = full.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const s = short.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      m.set(f, i + 1); m.set(s, i + 1);
    });
  [["januar","jan"],["februar","feb"],["mÃ¤rz","marz"],["april","apr"],["mai","mai"],["juni","jun"],
   ["juli","jul"],["august","aug"],["september","sep"],["oktober","okt"],["november","nov"],["dezember","dez"]]
    .forEach(([full, short], i) => { 
      const f = full.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      const s = short.normalize("NFD").replace(/\p{Diacritic}/gu, "");
      m.set(f, i + 1); m.set(s, i + 1);
    });
  return m;
})();

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function normalizeCheckinDate(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const sClean = s.replace(/,/g, " ").replace(/\s+/g, " ").trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(sClean)) return sClean;
  let m = sClean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  m = sClean.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10), monName = m[2], y = parseInt(m[3], 10), mo = MONTHS_MAP.get(monName);
    if (mo && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  return null;
}

function pageCss() {
  return `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:24px}
.wrap{max-width:680px}h1{font-size:28px;margin:0 0 8px}p{color:#444}
button{font-size:18px;padding:10px 18px;border:1px solid #333;border-radius:8px;background:#fff;cursor:pointer}
.muted{color:#777;font-size:14px;margin-top:14px}.ok{color:#0a7b34}.err{color:#b21a1a;white-space:pre-wrap}.hidden{display:none}`;
}

function landingHtml(targetKey, targetName, tokenPayload) {
  const remaining = Math.max(0, (tokenPayload?.max || 0) - (tokenPayload?.used || 0));
  const expInSec = Math.max(0, Math.floor((tokenPayload.exp - Date.now()) / 1000));
  const day = tokenPayload.day || "-";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${targetName}</title><style>${pageCss()}</style></head><body><div class="wrap">
<h1>${targetName}</h1><p class="muted">Valido solo nel giorno di check-in: <b>${day}</b> (${TIMEZONE})</p>
<button id="btn">Apri</button>
<div class="muted" id="hint">Max ${tokenPayload.max} aperture entro ${DEFAULT_WINDOW_MIN} minuti Â· residuo: <b id="left">${remaining}</b> Â· scade tra <span id="ttl">${expInSec}</span>s</div>
<p class="ok hidden" id="okmsg">â Apertura inviata.</p><pre class="err hidden" id="errmsg"></pre>
<script>const btn=document.getElementById('btn'),okmsg=document.getElementById('okmsg'),errmsg=document.getElementById('errmsg'),
leftEl=document.getElementById('left'),ttlEl=document.getElementById('ttl');let ttl=${expInSec};
setInterval(()=>{if(ttl>0){ttl--;ttlEl.textContent=ttl;}},1000);
btn.addEventListener('click',async ()=>{btn.disabled=true;okmsg.classList.add('hidden');errmsg.classList.add('hidden');
try{const res=await fetch(window.location.pathname+'/open',{method:'POST'});const j=await res.json();
if(j.ok){okmsg.classList.remove('hidden');if(typeof j.remaining==='number'){leftEl.textContent=j.remaining;}
if(j.nextUrl){try{history.replaceState(null,'',j.nextUrl);}catch(_){}}}else{errmsg.textContent=JSON.stringify(j,null,2);
errmsg.classList.remove('hidden');}}catch(e){errmsg.textContent=String(e);errmsg.classList.remove('hidden');}
finally{btn.disabled=false;}});</script></div></body></html>`;
}

app.get("/", requireAdmin, (req, res) => {
  const rows = Object.entries(TARGETS).map(([key, t]) => {
    const ids = t.ids.join(", ");
    return `<tr><td>${t.name}</td><td><code>${ids}</code></td><td><a href="/token/${key}">Crea link</a></td>
<td><form method="post" action="/api/open-now/${key}" style="display:inline"><button>Manual Open</button></form></td></tr>`;
  }).join("\n");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"/><style>
body{font-family:system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px 12px}
</style><title>Door & Gate Opener</title></head><body><h1>Door & Gate Opener</h1>
<p>Link firmati temporanei e apertura manuale.</p>
<table><thead><tr><th>Nome</th><th>Device ID</th><th>Smart Link</th><th>Manual Open</th></tr></thead>
<tbody>${rows}</tbody></table><p class="muted">Shard fallback: <code>${SHELLY_BASE_URL}</code></p></body></html>`);
});

app.get("/token/:target", requireAdmin, (req, res) => {
  const targetKey = req.params.target, target = TARGETS[targetKey];
  if (!target) return res.status(404).json({ ok: false, error: "unknown_target" });
  const windowMin = parseInt(req.query.mins || DEFAULT_WINDOW_MIN, 10);
  const maxOpens = parseInt(req.query.max  || DEFAULT_MAX_OPENS, 10);
  const { token, payload } = newTokenFor(targetKey, { windowMin, max: maxOpens, used: 0 });
  const url = `${req.protocol}://${req.get("host")}${LINK_PREFIX}/${targetKey}/${token}`;
  return res.json({ ok: true, url, expiresInMin: Math.round((payload.exp - Date.now()) / 60000) });
});

app.all("/k/:target/:token", (req, res) => res.status(410).send("Link non piÃ¹ valido."));
app.all("/k/:target/:token/open", (req, res) => res.status(410).json({ ok: false, error: "gone" }));
app.all("/k2/:target/:token", (req, res) => res.status(410).send("Link non piÃ¹ valido."));
app.all("/k2/:target/:token/open", (req, res) => res.status(410).json({ ok: false, error: "gone" }));

app.get(`${LINK_PREFIX}/:target/:token`, (req, res) => {
  const { target, token } = req.params, targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");
  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = ["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error) ? 410 : 400;
    const msg = parsed.error === "bad_signature" ? "Link non piÃ¹ valido (firma)." :
      parsed.error === "bad_version" ? "Link non piÃ¹ valido." :
      parsed.error === "revoked" ? "Link revocato." :
      parsed.error === "revoked_boot" ? "Link revocato (riavvio sistema)." : "Invalid link";
    return res.status(code).send(msg);
  }
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).send("Invalid link");
  if (Date.now() > p.exp) return res.status(400).send("Link scaduto");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.type("html").send(landingHtml(target, targetDef.name, p));
});

app.post(`${LINK_PREFIX}/:target/:token/open`, async (req, res) => {
  const { target, token } = req.params, targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const parsed = parseToken(token);
  if (!parsed.ok) {
    const code = ["bad_signature","bad_version","revoked","revoked_boot"].includes(parsed.error) ? 410 : 400;
    return res.status(code).json({ ok: false, error: parsed.error });
  }
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok: false, error: "target_mismatch" });
  if (Date.now() > p.exp) return res.status(400).json({ ok: false, error: "expired" });
  if (p.day && isYYYYMMDD(p.day) && p.day !== tzToday()) return res.status(410).json({ ok: false, error: "wrong_day" });
  const max = Number(p.max || 0), u = getUsage(p);
  if (max > 0 && u.count >= max) return res.status(429).json({ ok: false, error: "max_opens_reached" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  const newCount = (max > 0) ? (u.count + 1) : u.count;
  OPEN_USAGE.set(usageKey(p), { count: newCount, exp: p.exp });
  const remaining = (max > 0) ? Math.max(0, max - newCount) : null;
  return res.json({ ok: true, remaining, opened: result });
});

app.all("/api/open-now/:target", requireAdmin, (req, res) => {
  const targetKey = req.params.target, targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).send("Unknown target");
  const { token } = newTokenFor(targetKey, { windowMin: DEFAULT_WINDOW_MIN, max: DEFAULT_MAX_OPENS, used: 0 });
  return res.redirect(302, `${LINK_PREFIX}/${targetKey}/${token}`);
});

// ── Email-verify token (secondary devices) ───────────────────────────────
// Short-lived HMAC bucket token (valid ~10 min) — never exposes guest email.
function _evBucket() { return Math.floor(Date.now() / (10 * 60 * 1000)); }
function makeEmailVerifyToken(rid) { return hmac(`ev:${rid}:${_evBucket()}`); }
function isValidEmailVerifyToken(ev, rid) {
  if (!ev) return false;
  const b = _evBucket();
  return safeEqual(ev, hmac(`ev:${rid}:${b}`)) || safeEqual(ev, hmac(`ev:${rid}:${b - 1}`));
}

function renderEmailVerifyPage(apt, rid, lang, guestEmailHash, error) {
  const T = {
    it: { title: 'Conferma la tua identità', sub: "Inserisci l'email usata per la prenotazione.", btn: 'Conferma', err: 'Email non riconosciuta. Riprova.' },
    en: { title: 'Confirm your identity',    sub: 'Enter the email address used when booking.', btn: 'Confirm', err: 'Email not recognized. Please try again.' },
    fr: { title: 'Confirmez votre identité', sub: "Entrez l'email utilisé lors de la réservation.", btn: 'Confirmer', err: 'Email non reconnue. Réessayez.' },
    es: { title: 'Confirma tu identidad',    sub: 'Introduce el correo electrónico usado al reservar.', btn: 'Confirmar', err: 'Email no reconocida. Inténtalo de nuevo.' },
    de: { title: 'Identität bestätigen',     sub: 'Geben Sie die bei der Buchung verwendete E-Mail ein.', btn: 'Bestätigen', err: 'E-Mail nicht erkannt. Erneut versuchen.' },
  };
  const t = T[lang] || T.en;
  const errHtml = error ? `<div style="color:#f08080;font-size:13px;margin-bottom:16px">${t.err}</div>` : '';
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NiceFlat Rome</title>
<style>*{box-sizing:border-box}body{margin:0;background:#120d09;color:#f5ead8;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.box{max-width:380px;width:100%;text-align:center}.brand{font-size:11px;font-weight:700;letter-spacing:3px;color:#d6b06d;text-transform:uppercase;margin-bottom:24px}
h2{font-size:22px;font-weight:800;margin:0 0 10px}p{font-size:14px;color:#b7a894;line-height:1.6;margin:0 0 20px}
input[type=email]{width:100%;padding:14px 16px;border-radius:12px;border:1.5px solid #3a2e20;background:#1e1610;color:#f5ead8;font-size:15px;margin-bottom:16px;outline:none}
input[type=email]:focus{border-color:#c9a45c}
button{width:100%;padding:14px;border-radius:14px;border:none;background:linear-gradient(135deg,#e2c07a,#c89a48);color:#120d09;font-weight:800;font-size:15px;cursor:pointer}
</style></head><body><div class="box">
<div class="brand">NiceFlat Rome</div>
<h2>${t.title}</h2><p>${t.sub}</p>
${errHtml}
<form method="POST" action="/stay/${apt}/verify-email">
  <input type="hidden" name="r" value="${rid}">
  <input type="hidden" name="lang" value="${lang}">
  <input type="hidden" name="rt" value="${guestEmailHash}">
  <input type="email" name="email" placeholder="email@example.com" required autocomplete="email">
  <button type="submit">${t.btn}</button>
</form>
</div></body></html>`;
}

// ── /stay/:apt — personalised entry point sent by Hostaway ───────────────
app.get('/stay/:apt', async (req, res) => {
  const apt          = String(req.params.apt || '').toLowerCase();
  const reservationId = String(req.query.r || '');
  const lang         = String(req.query.lang || 'en').slice(0, 2).toLowerCase();

  if (!VALID_APARTMENTS.includes(apt)) return res.status(404).send('Not found');
  if (!reservationId) return res.status(400).type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NiceFlat Rome</title><style>body{margin:0;background:#120d09;color:#f5ead8;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box}.box{max-width:400px;text-align:center}.logo{font-size:11px;font-weight:700;letter-spacing:3px;color:#d6b06d;text-transform:uppercase;margin-bottom:16px}.title{font-size:24px;font-weight:800;margin-bottom:12px}.sub{font-size:14px;color:#b7a894;line-height:1.6;margin-bottom:28px}.btn{display:inline-block;background:linear-gradient(135deg,#e2c07a,#c89a48);color:#120d09;padding:14px 28px;border-radius:14px;font-weight:800;text-decoration:none;font-size:15px}</style></head><body><div class="box"><div class="logo">NiceFlat Rome</div><div class="title">Link scaduto</div><div class="sub">Il tuo link di accesso non è più valido.<br>Contatta il tuo host per ricevere il nuovo link personale.</div><a class="btn" href="https://wa.me/393355245756">💬 Contatta l'host su WhatsApp</a></div></body></html>`);

  // Fetch & validate reservation
  // Strategy:
  //   1. Direct lookup if pure numeric (internal Hostaway ID like 52098758)
  //   2. Extract first numeric segment of compound ID (74831-...) and try direct lookup
  //   3. Fallback: list search by channelReservationId
  let reservation;

  // Build list of candidate IDs to try as direct lookup.
  // Only short numeric IDs (≤8 digits) are Hostaway internal IDs.
  // Long numeric IDs (9+ digits) are channel IDs (Booking.com, Airbnb) and must
  // NOT be used for direct lookup — they can collide with other reservations.
  const candidateIds = [];
  if (/^\d+$/.test(reservationId) && reservationId.length <= 8) {
    candidateIds.push(reservationId);
  } else if (!/^\d+$/.test(reservationId)) {
    // Compound format: take first numeric segment (e.g. "74831" from "74831-194163-2000-...")
    const firstSegment = reservationId.split('-')[0];
    if (/^\d+$/.test(firstSegment) && firstSegment.length <= 8) candidateIds.push(firstSegment);
  }

  for (const id of candidateIds) {
    try {
      const r = await axios.get(`https://api.hostaway.com/v1/reservations/${id}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 });
      if (r.data?.result) {
        const candidate = r.data.result;
        const candidateApt = APT_LISTING_MAP[candidate.listingMapId];
        if (candidateApt === apt) { reservation = candidate; break; }
        console.warn(`⚠️ /stay direct ID ${id} → apt mismatch (${candidateApt} ≠ ${apt}), trying channelReservationId`);
      }
    } catch (e) {
      console.error(`❌ /stay direct fetch (${id}) error:`, e.message);
    }
  }

  // Fallback: search by channelReservationId — only for channel IDs (9+ digits or non-numeric).
  // Internal Hostaway IDs (≤8 digits) already went through direct lookup above; using them
  // as channelReservationId causes Hostaway to ignore the filter and return a random reservation.
  if (!reservation && candidateIds.length === 0) {
    try {
      const listingId = Object.entries(APT_LISTING_MAP).find(([, v]) => v === apt)?.[0];
      const params = new URLSearchParams({ channelReservationId: reservationId, limit: '1' });
      if (listingId) params.set('listingMapId', listingId);
      const r = await axios.get(
        `https://api.hostaway.com/v1/reservations?${params}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 });
      reservation = r.data?.result?.[0];
      // Discard if apartment doesn't match (API may ignore listingMapId filter)
      if (reservation) {
        const resApt = APT_LISTING_MAP[reservation.listingMapId];
        if (resApt !== apt) { reservation = null; }
      }
    } catch (e) {
      console.error('❌ /stay channel lookup error:', e.message);
    }
  }

if (!reservation) return res.status(502).send('Unable to verify reservation. Please try again in a moment.');
  if (reservation.status === 'cancelled') return res.status(410).send('This reservation has been cancelled');

  // Apartment must match reservation
  const expectedApt = APT_LISTING_MAP[reservation.listingMapId];
  if (expectedApt !== apt) {
    console.warn(`⚠️ /stay apartment mismatch: expected ${expectedApt}, got ${apt}`);
    return res.status(403).send('This link is not valid for this apartment');
  }

  // Stay must not be expired (checkout at 11:00 Rome)
  const checkoutDate  = reservation.departureDate || reservation.checkOutDate || reservation.checkoutDate || null;
  const checkinDate   = reservation.arrivalDate   || reservation.checkInDate  || null;
  const checkinTime   = reservation.arrivalTime   || '13:00';
  if (checkoutDate && isYYYYMMDD(checkoutDate)) {
    const expMs = checkoutExpiryMs(checkoutDate);
    if (expMs && Date.now() > expMs) return res.status(410).send('Your stay has ended. Thank you for choosing NiceFlat!');
  }

  // Determina lingua dalla reservation HostAway (priorità su URL param)
  // In questo modo la guida è sempre nella lingua della prenotazione,
  // indipendentemente dal link ricevuto.
  const _resLangRaw = (reservation.guestLanguage || reservation.guestLocale || '').toLowerCase();
  const _resLangMap = { spanish:'es', french:'fr', italian:'it', german:'de', english:'en',
                        deutsch:'de', italiano:'it', 'français':'fr', 'español':'es',
                        es:'es', fr:'fr', it:'it', de:'de', en:'en' };
  const _resLangMapped = _resLangMap[_resLangRaw.split(',')[0].trim()] || _resLangRaw.slice(0, 2);
  const finalLang = ['en','it','fr','de','es'].includes(_resLangMapped) ? _resLangMapped : lang;

  // Device registration
  const cookies         = parseCookies(req);
  const existingSession = verifyGuardCookie(cookies['guide_sess']);
  let deviceId;

  if (existingSession && existingSession.reservationId === reservationId && existingSession.apartment === apt) {
    // Same device, same reservation — returning visit
    deviceId = existingSession.deviceId;
    if (!GUIDE_DEVICES.has(reservationId)) GUIDE_DEVICES.set(reservationId, new Set());
    GUIDE_DEVICES.get(reservationId).add(deviceId);
  } else {
    // New device
    if (!GUIDE_DEVICES.has(reservationId)) GUIDE_DEVICES.set(reservationId, new Set());
    const devices = GUIDE_DEVICES.get(reservationId);

    // Secondary device: require email verification before granting access
    if (devices.size >= 1) {
      const ev = String(req.query.ev || '');
      if (!isValidEmailVerifyToken(ev, reservationId)) {
        const guestEmail = (reservation.guestEmail || '').toLowerCase().trim();
        // Booking.com usa email mascherate (@guest.booking.com): l'ospite non può conoscerla.
        // In quel caso saltiamo la verifica email — MAX_GUIDE_DEVICES protegge comunque da abusi.
        const isBookingComMasked = guestEmail.includes('@guest.booking.com') || guestEmail.includes('@booking.com');
        if (!isBookingComMasked) {
          const emailHash = hmac(`${reservationId}:${guestEmail}`);
          return res.type('html').send(renderEmailVerifyPage(apt, reservationId, finalLang, emailHash, false));
        }
      }
    }

    if (devices.size >= MAX_GUIDE_DEVICES) {
      console.warn(`⚠️ /stay max devices reached: res:${reservationId} count:${devices.size}`);
      return res.status(403).type('html').send(blockedPage(apt, reservationId, finalLang));
    }
    const isFirstOpen = devices.size === 0;
    deviceId = crypto.randomBytes(16).toString('hex');
    devices.add(deviceId);
    console.log(`📱 Device registered: ${apt} | res:${reservationId} | total:${devices.size}`);

    // Notifica interna all'host + auto-schedule Phase 3 alla prima apertura
    if (isFirstOpen) {
      const guestName = reservation.guestName || reservation.guestFirstName || 'Ospite';
      const checkinFmt = checkinDate || '?';
      const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
      getConversationId(reservationId).then(cid => {
        if (!cid) return;

        // 1) Nota interna all'host
        sendHostawayInternalNote({
          conversationId: cid,
          message: `✅ ${guestName} ha aperto la guida (${apt}) — check-in: ${checkinFmt} — ${now}`
        });

        // 2) Auto-schedule Phase 3 (chiavi digitali) se non già schedulata dal webhook
        const phase3Key = `phase3-${reservationId}`;
        if (!PENDING_PHASE3.has(phase3Key)) {
          const langRaw = (reservation.guestLanguage || reservation.guestLocale || 'en').toLowerCase();
          const langMap = { spanish:'es', french:'fr', italian:'it', german:'de', english:'en',
                            deutsch:'de', italiano:'it', 'français':'fr', 'español':'es' };
          const guestLang3 = langMap[langRaw.split(',')[0].trim()] || langRaw.slice(0, 2) || 'en';
          const safeLang3  = ['en','it','fr','de','es'].includes(guestLang3) ? guestLang3 : 'en';

          let sendAt;
          if (checkinTime && checkinDate) {
            const parts = checkinTime.replace(/[apm]/gi, '').trim().split(':').map(Number);
            const h = parts[0] || 13;
            const m = parts[1] || 0;
            const candidate = new Date(`${checkinDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+02:00`);
            candidate.setMinutes(candidate.getMinutes() + 2);
            sendAt = candidate;
          } else if (checkinDate) {
            sendAt = new Date(`${checkinDate}T13:02:00+02:00`);
          } else {
            sendAt = new Date(Date.now() + 2 * 60 * 1000);
          }

          // Minimo: mai prima delle 13:02 del giorno di check-in
          if (checkinDate) {
            const minTime = new Date(`${checkinDate}T13:02:00+02:00`);
            if (sendAt < minTime) sendAt = minTime;
          }

          // Se l'orario è già passato (es. ospite arriva tardi e apre subito) → manda tra 2 min
          if (sendAt <= new Date()) sendAt = new Date(Date.now() + 2 * 60 * 1000);

          PENDING_PHASE3.set(phase3Key, {
            conversationId: cid,
            apartment: apt,
            lang: safeLang3,
            sendAt,
            checkinDate,
            sent: false
          });
          savePhase3State();
          console.log(`🗓 Phase 3 auto-scheduled (first open): ${apt} | res:${reservationId} | sendAt:${sendAt.toISOString()}`);
        }
      }).catch(e => console.error('❌ Notifica prima apertura guida:', e.message));
    }
  }

  // Session cookie (expires at checkout + 1h grace)
  const cookieExp = (checkoutDate && isYYYYMMDD(checkoutDate))
    ? (checkoutExpiryMs(checkoutDate) || 0) + 3600000
    : Date.now() + 30 * 86400000;

  res.cookie('guide_sess', signGuardCookie({ reservationId, deviceId, apartment: apt, exp: cookieExp }), {
    httpOnly: true, secure: true, sameSite: 'lax',
    maxAge: Math.max(0, Math.floor((cookieExp - Date.now()) / 1000))
  });

  // Generate guide JWT and redirect to guide page
  const _now = Date.now(), _jti = b64url(crypto.randomBytes(9));
  const _expMs = (checkoutDate && isYYYYMMDD(checkoutDate))
    ? checkoutExpiryMs(checkoutDate) || (_now + 30 * 86400000)
    : _now + 30 * 86400000;
  const _tp = { tgt: `guide-${apt}`, exp: _expMs, jti: _jti, iat: _now, ver: TOKEN_VERSION,
    day: checkinDate || tzToday(), ct: checkinTime, cid: null, co: checkoutDate || null, rid: reservationId || null };
  const guideToken = makeToken(_tp);
  return res.redirect(302, `/guides/${apt}/premium_rome_concierge.html?t=${guideToken}&lang=${finalLang}`);
});

// ── POST /stay/:apt/verify-email — confirm guest email for secondary device ─
app.post('/stay/:apt/verify-email', (req, res) => {
  const apt  = String(req.params.apt || '').toLowerCase();
  const rid  = String(req.body.r   || '').trim();
  const lang = String(req.body.lang || 'en').slice(0, 2).toLowerCase();
  const rt   = String(req.body.rt  || '');   // signed hash of guest email
  const submitted = (req.body.email || '').toLowerCase().trim();

  if (!VALID_APARTMENTS.includes(apt) || !rid || !rt || !submitted) {
    return res.status(400).send('Bad request');
  }
  const check = hmac(`${rid}:${submitted}`);
  if (!safeEqual(check, rt)) {
    // Wrong email — re-render page with error flag
    return res.type('html').send(renderEmailVerifyPage(apt, rid, lang, rt, true));
  }
  const ev = makeEmailVerifyToken(rid);
  const safeLang = ['en','it','fr','de','es'].includes(lang) ? lang : 'en';
  return res.redirect(302, `/stay/${apt}?r=${encodeURIComponent(rid)}&ev=${encodeURIComponent(ev)}&lang=${safeLang}`);
});

// ── POST /stay/:apt/reset-session — guest resets device slots via booking email ─
app.post('/stay/:apt/reset-session', async (req, res) => {
  const apt  = String(req.params.apt || '').toLowerCase();
  const rid  = String(req.body?.r   || '').trim();
  const lang = String(req.body?.lang || 'en').slice(0, 2).toLowerCase();
  const safeLang = ['en','it','fr','de','es'].includes(lang) ? lang : 'en';
  const email = String(req.body?.email || '').toLowerCase().trim();

  if (!VALID_APARTMENTS.includes(apt) || !rid || !email || !email.includes('@')) {
    return res.status(400).send('Bad request');
  }

  try {
    // Stessa logica lookup di /stay/: diretto solo per ID interni ≤8 cifre
    let reservation = null;
    const isShortId = /^\d+$/.test(rid) && rid.length <= 8;
    if (isShortId) {
      const r = await axios.get(
        `https://api.hostaway.com/v1/reservations/${rid}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
      );
      reservation = r.data?.result || null;
    } else {
      const listingId = Object.entries(APT_LISTING_MAP).find(([, v]) => v === apt)?.[0];
      const params = new URLSearchParams({ channelReservationId: rid, limit: '1' });
      if (listingId) params.set('listingMapId', listingId);
      const r = await axios.get(
        `https://api.hostaway.com/v1/reservations?${params}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
      );
      reservation = r.data?.result?.[0] || null;
    }

    if (!reservation || reservation.status === 'cancelled') {
      return res.status(403).type('html').send(blockedPage(apt, rid, safeLang, true));
    }

    const guestEmail = (reservation.guestEmail || reservation.guest?.email || '').toLowerCase().trim();
    const isBookingComMasked = guestEmail.includes('@guest.booking.com') || guestEmail.includes('@booking.com');

    if (!isBookingComMasked) {
      if (!guestEmail || guestEmail !== email) {
        console.warn(`⚠️ /reset-session email mismatch: apt=${apt} res=${rid}`);
        return res.status(403).type('html').send(blockedPage(apt, rid, safeLang, true));
      }
    }

    GUIDE_DEVICES.delete(rid);
    console.log(`🔄 Device reset via email: ${apt} | res:${rid}`);
    return res.redirect(302, `/stay/${apt}?r=${encodeURIComponent(rid)}&lang=${safeLang}`);
  } catch (e) {
    console.error('❌ /reset-session error:', e.message);
    return res.status(502).type('html').send(blockedPage(apt, rid, safeLang, false));
  }
});

// ── DELETE /admin/guide-devices/:reservationId — reset device slots ───────
app.delete('/admin/guide-devices/:reservationId', requireAdmin, (req, res) => {
  const rid = String(req.params.reservationId || '').trim();
  if (!rid) return res.status(400).json({ ok: false, error: 'missing reservationId' });
  const existed = GUIDE_DEVICES.has(rid);
  const count   = existed ? GUIDE_DEVICES.get(rid).size : 0;
  GUIDE_DEVICES.delete(rid);
  console.log(`🗑️ Admin reset guide devices: res:${rid} (was ${count} device${count !== 1 ? 's' : ''})`);
  return res.json({ ok: true, reservationId: rid, devicesCleared: count, existed });
});

// ── GET /admin/fix-city-tax-once — TEMPORANEO: corregge 5 TASSA_IMPORTO sbagliati ──
app.get('/admin/fix-city-tax-once', async (req, res) => {
  const ONE_TIME_TOKEN = 'fix-ct-9k2m4p7r1x';
  if (req.query.token !== ONE_TIME_TOKEN) return res.status(403).json({ ok: false, error: 'unauthorized' });

  const FIXES = {
    '60054762': { guest: 'Sarah Macdonald',   apt: 'Via Leonina',      old: '30,00', newVal: '36,00' },
    '59587542': { guest: 'Matt Symonds',       apt: 'Via Leonina',      old: '30,00', newVal: '36,00' },
    '59809165': { guest: 'Laurent GALY',       apt: 'Via Leonina',      old: '50,00', newVal: '60,00' },
    '58151141': { guest: 'Gloria P Trueblood', apt: 'Via Leonina',      old: '40,00', newVal: '48,00' },
    '55099056': { guest: 'Carol Gonsalvez',    apt: 'Viale Trastevere', old: '175,00', newVal: '210,00' },
  };

  try {
    const { google } = await import('googleapis');
    const SPREADSHEET_ID = '11Ga4BUVzR2x0i37QEUhu-KkfFCLpN2zUjmypoNp_Co0';
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Foglio1!A:I',
    });
    const rows = data.values || [];
    const results = [];
    for (let i = 0; i < rows.length; i++) {
      const resId = String(rows[i][0] || '').trim();
      const fix = FIXES[resId];
      if (!fix) continue;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Foglio1!I${i + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[fix.newVal]] },
      });
      results.push({ row: i + 1, resId, guest: fix.guest, old: fix.old, new: fix.newVal });
    }
    console.log('✅ fix-city-tax-once eseguito:', results);
    return res.json({ ok: true, updated: results.length, results });
  } catch (err) {
    console.error('❌ fix-city-tax-once error:', err.message);
    return res.json({ ok: false, error: err.message });
  }
});

// ── /stay-home/:apt — Home concierge guide entry point ────────────────────
const HOME_APT_SUFFIX = { arenula: 'Arenula', leonina: 'Leonina', portico: 'Portico', scala: 'Scala', trastevere: 'Trastevere' };

app.get('/stay-home/:apt', async (req, res) => {
  const apt          = String(req.params.apt || '').toLowerCase();
  const reservationId = String(req.query.r || '');
  const lang         = String(req.query.lang || 'en').slice(0, 2).toLowerCase();

  if (!VALID_APARTMENTS.includes(apt)) return res.status(404).send('Not found');

  // Operator bypass — no reservation needed
  if (!reservationId) {
    const cookies = parseCookies(req);
    if (verifyOperatorCookie(cookies['op_sess'])) {
      const now = Date.now();
      const tp = { tgt: `home-${apt}`, exp: now + 4 * 60 * 60 * 1000,
        jti: b64url(crypto.randomBytes(9)), iat: now, ver: TOKEN_VERSION, day: tzToday() };
      const homeToken = makeToken(tp);
      const safeLang = ['en','it','fr','de','es'].includes(lang) ? lang : 'en';
      const suffix = HOME_APT_SUFFIX[apt] || apt;
      return res.redirect(302, `/guides/Premium_Roman_Concierge_Home_${suffix}.html?t=${homeToken}&lang=${safeLang}`);
    }
    return res.status(400).send('Missing reservation ID');
  }

  let reservation;
  const candidateIds = [];
  if (/^\d+$/.test(reservationId) && reservationId.length <= 8) {
    candidateIds.push(reservationId);
  } else if (!/^\d+$/.test(reservationId)) {
    const firstSegment = reservationId.split('-')[0];
    if (/^\d+$/.test(firstSegment) && firstSegment.length <= 8) candidateIds.push(firstSegment);
  }
  for (const id of candidateIds) {
    try {
      const r = await axios.get(`https://api.hostaway.com/v1/reservations/${id}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 });
      if (r.data?.result && APT_LISTING_MAP[r.data.result.listingMapId] === apt) {
        reservation = r.data.result; break;
      }
    } catch (e) { console.error(`❌ /stay-home direct fetch error:`, e.message); }
  }
  if (!reservation && candidateIds.length === 0) {
    try {
      const listingId = Object.entries(APT_LISTING_MAP).find(([, v]) => v === apt)?.[0];
      const params = new URLSearchParams({ channelReservationId: reservationId, limit: '1' });
      if (listingId) params.set('listingMapId', listingId);
      const r = await axios.get(`https://api.hostaway.com/v1/reservations?${params}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 });
      reservation = r.data?.result?.[0];
      if (reservation && APT_LISTING_MAP[reservation.listingMapId] !== apt) reservation = null;
    } catch (e) { console.error('❌ /stay-home channel lookup error:', e.message); }
  }

  if (!reservation) return res.status(502).send('Unable to verify reservation. Please try again.');
  if (reservation.status === 'cancelled') return res.status(410).send('Reservation cancelled');

  const checkoutDate = reservation.departureDate || reservation.checkOutDate || reservation.checkoutDate || null;
  const checkinDate  = reservation.arrivalDate   || reservation.checkInDate  || null;

  if (checkoutDate && isYYYYMMDD(checkoutDate)) {
    const expMs = checkoutExpiryMs(checkoutDate);
    if (expMs && Date.now() > expMs) return res.status(410).send('Your stay has ended. Thank you for choosing NiceFlat!');
  }

  // Lingua dalla reservation (priorità su URL param)
  const _hlRaw = (reservation.guestLanguage || reservation.guestLocale || '').toLowerCase();
  const _hlMap = { spanish:'es', french:'fr', italian:'it', german:'de', english:'en',
                   deutsch:'de', italiano:'it', 'français':'fr', 'español':'es',
                   es:'es', fr:'fr', it:'it', de:'de', en:'en' };
  const _hlMapped = _hlMap[_hlRaw.split(',')[0].trim()] || _hlRaw.slice(0, 2);
  const homeFinalLang = ['en','it','fr','de','es'].includes(_hlMapped) ? _hlMapped : lang;

  const now = Date.now();
  const jti = b64url(crypto.randomBytes(9));
  const expMs = (checkoutDate && isYYYYMMDD(checkoutDate))
    ? checkoutExpiryMs(checkoutDate) || (now + 30 * 86400000)
    : now + 30 * 86400000;
  const tp = { tgt: `home-${apt}`, exp: expMs, jti, iat: now, ver: TOKEN_VERSION,
    day: checkinDate || tzToday(), co: checkoutDate || null, rid: reservationId };
  const homeToken = makeToken(tp);
  const suffix = HOME_APT_SUFFIX[apt] || apt;
  return res.redirect(302, `/guides/Premium_Roman_Concierge_Home_${suffix}.html?t=${homeToken}&lang=${homeFinalLang}`);
});

// ── /home/:apt/status — validate home concierge guide token ──────────────
app.get('/home/:apt/status', (req, res) => {
  const apt = String(req.params.apt || '').toLowerCase();
  const t   = String(req.query.t || '');
  if (!VALID_APARTMENTS.includes(apt)) return res.json({ ok: false, reason: 'invalid' });
  if (!t) return res.json({ ok: false, reason: 'no_token' });

  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.json({ ok: false, reason: 'invalid' });

  const p = parsed.payload;
  if (p.tgt !== `home-${apt}`) return res.json({ ok: false, reason: 'invalid' });

  const today = tzToday();
  if (p.day && today < p.day) return res.json({ ok: false, reason: 'not_yet', available_from: p.day });

  if (p.co && isYYYYMMDD(p.co)) {
    const expMs = checkoutExpiryMs(p.co);
    if (expMs && Date.now() > expMs) return res.json({ ok: false, reason: 'expired' });
  }
  if (typeof p.exp === 'number' && Date.now() > p.exp) return res.json({ ok: false, reason: 'expired' });

  return res.json({ ok: true });
});

// ── /tablet/:apt — fixed URL for in-apartment tablet ─────────────────────
// Always-on tablet shows the Home Concierge guide when a stay is active,
// or a standby screen otherwise. Auto-reloads every 10 minutes.
const TABLET_CACHE = new Map(); // apt → { active, reservation, fetchedAt }
const TABLET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getTabletStatus(apt) {
  const cached = TABLET_CACHE.get(apt);
  if (cached && Date.now() - cached.fetchedAt < TABLET_CACHE_TTL) return cached;

  try {
    const listingId = Object.entries(APT_LISTING_MAP).find(([, v]) => v === apt)?.[0];
    if (!listingId) { const r = { active: false, reservation: null, fetchedAt: Date.now() }; TABLET_CACHE.set(apt, r); return r; }

    const today = tzToday();
    const params = new URLSearchParams({ listingMapId: listingId, status: 'confirmed', limit: '10' });
    const resp = await axios.get(`https://api.hostaway.com/v1/reservations?${params}`,
      { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 });
    const reservations = resp.data?.result || [];

    let activeReservation = null;
    for (const res of reservations) {
      if (APT_LISTING_MAP[res.listingMapId] !== apt) continue; // wrong apartment — API may ignore filter
      const ci = res.arrivalDate || res.checkInDate;
      const co = res.departureDate || res.checkOutDate;
      if (!ci || !co) continue;
      if (today < ci) continue;                         // not checked in yet
      const expMs = checkoutExpiryMs(co);
      if (expMs && Date.now() > expMs) continue;        // checked out
      activeReservation = res;
      break;
    }

    const result = { active: !!activeReservation, reservation: activeReservation, fetchedAt: Date.now() };
    TABLET_CACHE.set(apt, result);
    console.log(`📱 TabletStatus ${apt}: ${result.active ? 'ACTIVE' : 'standby'}`);
    return result;
  } catch (e) {
    console.error('❌ getTabletStatus error:', apt, e.message);
    const r = { active: false, reservation: null, fetchedAt: Date.now() };
    TABLET_CACHE.set(apt, r);
    return r;
  }
}

function tabletStandbyHtml(apt) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NiceFlat Rome</title><meta http-equiv="refresh" content="300"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%;background:#0e0b08;display:flex;align-items:center;justify-content:center;font-family:Georgia,'Times New Roman',serif;color:#f5ead8;overflow:hidden}.wrap{text-align:center;padding:40px}.logo{font-size:11px;font-weight:700;letter-spacing:4px;color:#d6b06d;text-transform:uppercase;margin-bottom:40px}.title{font-size:52px;font-weight:400;letter-spacing:2px;margin-bottom:16px;opacity:.88}.sub{font-size:16px;color:#b7a894;letter-spacing:1px;line-height:1.8}.divider{width:60px;height:1px;background:#d6b06d;opacity:.4;margin:32px auto}.city{font-size:13px;letter-spacing:6px;color:#d6b06d;opacity:.6;text-transform:uppercase;margin-top:32px}</style></head><body><div class="wrap"><div class="logo">NiceFlat Rome</div><div class="title">Benvenuti a Roma</div><div class="divider"></div><div class="sub">La vostra guida personale<br>sarà disponibile al momento del check-in</div><div class="city">Roma · Italia</div></div></body></html>`;
}

app.get('/tablet/:apt', async (req, res) => {
  const apt = String(req.params.apt || '').toLowerCase();
  if (!VALID_APARTMENTS.includes(apt)) return res.status(404).send('Not found');

  if (req.query.preview === 'standby') {
    return res.type('html').send(tabletStandbyHtml(apt));
  }

  const status = await getTabletStatus(apt);

  if (!status.active) {
    return res.type('html').send(tabletStandbyHtml(apt));
  }

  const rv          = status.reservation;
  const checkinDate = rv?.arrivalDate   || rv?.checkInDate   || tzToday();
  const checkoutDate= rv?.departureDate || rv?.checkOutDate  || null;
  const reservationId = String(rv?.id || '');
  const rawLang     = (rv?.guestPreferredLocale || rv?.preferredLocale || 'it').slice(0, 2).toLowerCase();
  const safeLang    = ['en', 'it', 'fr', 'de', 'es'].includes(rawLang) ? rawLang : 'it';

  const now     = Date.now();
  const jti     = b64url(crypto.randomBytes(9));
  const tokenExp = now + 12 * 60 * 60 * 1000; // 12h — tablet reloads well before this
  const tp = { tgt: `home-${apt}`, exp: tokenExp, jti, iat: now, ver: TOKEN_VERSION,
    day: checkinDate, co: checkoutDate, rid: reservationId };
  const homeToken = makeToken(tp);
  const suffix    = HOME_APT_SUFFIX[apt] || apt;

  return res.redirect(302, `/guides/Premium_Roman_Concierge_Home_${suffix}.html?t=${homeToken}&lang=${safeLang}&tablet=1`);
});

// ── Old guide-link recovery ───────────────────────────────────────────────
// Guests who received the old bare link (no token, no r=) are shown an email
// form. We look up their reservation in Hostaway and redirect to /stay/.
// Guests with a valid JWT token in the URL are redirected immediately.

function recoveryFormHtml(apt, lang, error) {
  const msgs = {
    en: {
      title: 'Access your guide', sub: 'Enter the email address you used for your booking.', btn: 'Continue',
      err: 'No active reservation found for this email. Please check and try again or contact your host.',
      warnT: '⚠️  iPhone: you must use Safari',
      warnN: 'If you are using Chrome or another browser, please open this page in Safari first — otherwise the install will not work.',
      iosTitle: 'Install the guide on your phone',
      s1t: 'Step 1 — Find the Share button',
      s1d: 'Look at the bottom bar of the screen. Tap the icon that looks like a square with an arrow pointing upward  [ ⬆ ]',
      s2t: 'Step 2 — Tap "Add to Home Screen"',
      s2d: 'A menu will open. Scroll down and look for "Add to Home Screen" (it has a small square icon with a +). Tap it.',
      s3t: 'Step 3 — Tap "Add"',
      s3d: 'A small window appears. Tap the "Add" button in the top right corner. Done! The app icon will appear on your home screen.',
      andBtn: '📲  Install the App',
      andNote: 'Free · Works offline · No App Store needed',
      fbT: "Don't see the install button?",
      fbS: 'Tap the three dots ⋮ at the top right of Chrome, then tap "Add to Home Screen" or "Install App".',
      skip: 'Continue without installing →',
    },
    it: {
      title: 'Accedi alla tua guida', sub: "Inserisci l'email usata per la prenotazione.", btn: 'Continua',
      err: "Nessuna prenotazione attiva trovata per questa email. Controlla e riprova oppure contatta l'host.",
      warnT: '⚠️  iPhone: devi usare Safari',
      warnN: "Se stai usando Chrome o un altro browser, apri prima questa pagina in Safari — altrimenti l'installazione non funzionerà.",
      iosTitle: 'Installa la guida sul tuo telefono',
      s1t: 'Passo 1 — Trova il pulsante Condividi',
      s1d: "Guarda la barra in fondo allo schermo. Tocca l'icona che sembra un quadrato con una freccia verso l'alto  [ ⬆ ]",
      s2t: 'Passo 2 — Tocca "Aggiungi a schermata Home"',
      s2d: 'Si aprirà un menu. Scorri verso il basso e cerca "Aggiungi a schermata Home" (ha una piccola icona quadrata con un +). Toccala.',
      s3t: 'Passo 3 — Tocca "Aggiungi"',
      s3d: "Appare una piccola finestra. Tocca il pulsante \"Aggiungi\" in alto a destra. Fatto! L'icona dell'app apparirà nella schermata Home.",
      andBtn: '📲  Installa la Guida',
      andNote: 'Gratis · Funziona offline · Senza App Store',
      fbT: 'Non vedi il pulsante di installazione?',
      fbS: 'Tocca i tre puntini ⋮ in alto a destra in Chrome, poi tocca "Aggiungi a schermata Home" o "Installa app".',
      skip: 'Continua senza installare →',
    },
    fr: {
      title: 'Accédez à votre guide', sub: "Entrez l'email utilisé pour votre réservation.", btn: 'Continuer',
      err: "Aucune réservation active trouvée. Vérifiez et réessayez ou contactez votre hôte.",
      warnT: '⚠️  iPhone : vous devez utiliser Safari',
      warnN: "Si vous utilisez Chrome ou un autre navigateur, ouvrez d'abord cette page dans Safari — sinon l'installation ne fonctionnera pas.",
      iosTitle: 'Installez le guide sur votre téléphone',
      s1t: 'Étape 1 — Trouvez le bouton Partager',
      s1d: "Regardez la barre en bas de l'écran. Appuyez sur l'icône qui ressemble à un carré avec une flèche vers le haut  [ ⬆ ]",
      s2t: "Étape 2 — «Sur l'écran d'accueil»",
      s2d: "Un menu s'ouvrira. Faites défiler vers le bas et cherchez «Sur l'écran d'accueil» (avec une petite icône carrée +). Appuyez dessus.",
      s3t: 'Étape 3 — Appuyez sur «Ajouter»',
      s3d: "Une petite fenêtre apparaît. Appuyez sur «Ajouter» en haut à droite. Voilà ! L'icône de l'app apparaîtra sur votre écran d'accueil.",
      andBtn: "📲  Installer l'Application",
      andNote: 'Gratuit · Fonctionne hors ligne · Sans App Store',
      fbT: 'Vous ne voyez pas le bouton ?',
      fbS: "Appuyez sur les trois points ⋮ en haut à droite de Chrome, puis sur «Ajouter à l'écran d'accueil».",
      skip: 'Continuer sans installer →',
    },
    de: {
      title: 'Auf Ihren Guide zugreifen', sub: 'Geben Sie die E-Mail-Adresse Ihrer Buchung ein.', btn: 'Weiter',
      err: 'Keine aktive Reservierung gefunden. Bitte prüfen Sie die Adresse oder kontaktieren Sie Ihren Gastgeber.',
      warnT: '⚠️  iPhone: Sie müssen Safari verwenden',
      warnN: 'Wenn Sie Chrome oder einen anderen Browser verwenden, öffnen Sie diese Seite bitte zuerst in Safari — sonst funktioniert die Installation nicht.',
      iosTitle: 'Guide auf Ihrem Telefon installieren',
      s1t: 'Schritt 1 — Finden Sie die Teilen-Schaltfläche',
      s1d: 'Schauen Sie auf die untere Leiste des Bildschirms. Tippen Sie auf das Symbol, das wie ein Quadrat mit einem Pfeil nach oben aussieht  [ ⬆ ]',
      s2t: 'Schritt 2 — «Zum Home-Bildschirm»',
      s2d: 'Ein Menü öffnet sich. Scrollen Sie nach unten und suchen Sie «Zum Home-Bildschirm hinzufügen» (mit einem kleinen quadratischen + Symbol). Tippen Sie darauf.',
      s3t: 'Schritt 3 — Tippen Sie auf «Hinzufügen»',
      s3d: 'Ein kleines Fenster erscheint. Tippen Sie oben rechts auf «Hinzufügen». Fertig! Das App-Symbol erscheint auf Ihrem Startbildschirm.',
      andBtn: '📲  App Installieren',
      andNote: 'Kostenlos · Offline verfügbar · Kein App Store nötig',
      fbT: 'Sehen Sie den Installations-Button nicht?',
      fbS: 'Tippen Sie auf die drei Punkte ⋮ oben rechts in Chrome, dann auf «Zum Startbildschirm hinzufügen».',
      skip: 'Ohne Installation fortfahren →',
    },
    es: {
      title: 'Accede a tu guía', sub: 'Introduce el email con el que reservaste.', btn: 'Continuar',
      err: 'No se encontró reserva activa. Comprueba el email o contacta con tu anfitrión.',
      warnT: '⚠️  iPhone: debe usar Safari',
      warnN: 'Si usa Chrome u otro navegador, abra primero esta página en Safari — de lo contrario la instalación no funcionará.',
      iosTitle: 'Instala la guía en tu teléfono',
      s1t: 'Paso 1 — Busque el botón Compartir',
      s1d: 'Mire la barra inferior de la pantalla. Toque el icono que parece un cuadrado con una flecha apuntando hacia arriba  [ ⬆ ]',
      s2t: 'Paso 2 — «Añadir a pantalla de inicio»',
      s2d: 'Se abrirá un menú. Desplace hacia abajo y busque «Añadir a pantalla de inicio» (con un pequeño icono cuadrado +). Tóquelo.',
      s3t: 'Paso 3 — Toque «Añadir»',
      s3d: 'Aparecerá una pequeña ventana. Toque «Añadir» en la esquina superior derecha. ¡Listo! El icono de la app aparecerá en su pantalla de inicio.',
      andBtn: '📲  Instalar la App',
      andNote: 'Gratis · Funciona sin internet · Sin App Store',
      fbT: '¿No ve el botón de instalación?',
      fbS: 'Toque los tres puntos ⋮ arriba a la derecha en Chrome, luego toque «Añadir a la pantalla de inicio».',
      skip: 'Continuar sin instalar →',
    },
  };
  const t = msgs[lang] || msgs.en;
  return `<!doctype html><html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#120d09">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Rome Concierge">
<link rel="apple-touch-icon" href="/guides/icons/icon-192.png">
<link rel="manifest" href="/guides/${apt}/manifest.webmanifest">
<title>NiceFlat Rome</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#120d09;color:#f5ead8;font-family:system-ui,sans-serif;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;padding:24px}
.box{width:100%;max-width:380px;text-align:center;padding-top:16px}
.logo{font-size:10px;font-weight:700;letter-spacing:3px;color:#d6b06d;text-transform:uppercase;margin-bottom:20px}
.title{font-size:22px;font-weight:800;margin-bottom:10px}
.sub{font-size:14px;color:#b7a894;line-height:1.6;margin-bottom:24px}
input[type=text]{width:100%;padding:14px 16px;background:rgba(255,255,255,.07);border:1px solid rgba(214,176,109,.3);border-radius:12px;color:#f5ead8;font-size:16px;margin-bottom:14px;outline:none}
input[type=text]:focus{border-color:#d6b06d}
.submit-btn{width:100%;padding:14px;background:linear-gradient(135deg,#e2c07a,#c89a48);color:#120d09;border:none;border-radius:14px;font-weight:800;font-size:15px;cursor:pointer}
.err{color:#fca5a5;font-size:13px;margin-bottom:16px;padding:12px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);border-radius:10px}
.pwa-section{margin-top:24px;text-align:left}
.pwa-warn{background:rgba(255,180,50,.12);border:1px solid rgba(255,180,50,.35);border-radius:14px;padding:14px 16px;margin-bottom:16px}
.pwa-warn-t{color:#f5c842;font-size:14px;font-weight:800;margin-bottom:4px}
.pwa-warn-n{color:#b7a894;font-size:13px;line-height:1.5}
.pwa-steps{background:rgba(214,176,109,.07);border:1px solid rgba(214,176,109,.2);border-radius:16px;padding:18px 16px;margin-bottom:16px}
.pwa-step{display:flex;align-items:flex-start;gap:14px;margin-bottom:16px}
.pwa-step:last-child{margin-bottom:0}
.pwa-num{background:rgba(214,176,109,.18);border-radius:12px;min-width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#d6b06d;flex-shrink:0}
.pwa-st{color:#f5ead8;font-size:15px;font-weight:700;margin-bottom:4px}
.pwa-sd{color:#b7a894;font-size:13px;line-height:1.5}
.pwa-and-btn{width:100%;padding:16px;background:linear-gradient(135deg,#e8c67a,#c89a48);color:#120d09;border:none;border-radius:16px;font-weight:800;font-size:17px;cursor:pointer;margin-bottom:10px}
.pwa-and-note{font-size:12px;color:#b7a894;text-align:center;margin-bottom:16px}
.pwa-fb{display:none;background:rgba(214,176,109,.07);border:1px solid rgba(214,176,109,.2);border-radius:14px;padding:16px;margin-bottom:16px}
.pwa-fb-t{color:#d6b06d;font-size:13px;font-weight:700;margin-bottom:6px}
.pwa-fb-s{color:#b7a894;font-size:13px;line-height:1.6}
.pwa-skip{background:none;border:none;color:#6b5e52;font-size:13px;text-decoration:underline;cursor:pointer;padding:6px;width:100%;text-align:center}
</style>
</head>
<body><div class="box">
<div class="logo">NiceFlat · Boutique Rome Concierge</div>
<div class="title">${t.title}</div>
<div class="sub">${t.sub}</div>
${error ? `<div class="err">${t.err}</div>` : ''}
<form method="POST" action="/guides/${apt}/recover">
  <input type="hidden" name="lang" value="${lang}">
  <input type="text" name="email" placeholder="email@example.com" required autocomplete="email" inputmode="email">
  <button type="submit" class="submit-btn">${t.btn}</button>
</form>

<div id="pwa-ios" style="display:none" class="pwa-section">
  <div class="pwa-warn">
    <div class="pwa-warn-t">${t.warnT}</div>
    <div class="pwa-warn-n">${t.warnN}</div>
  </div>
  <div class="pwa-steps">
    <div class="pwa-step"><div class="pwa-num">1</div><div><div class="pwa-st">${t.s1t}</div><div class="pwa-sd">${t.s1d}</div></div></div>
    <div class="pwa-step"><div class="pwa-num">2</div><div><div class="pwa-st">${t.s2t}</div><div class="pwa-sd">${t.s2d}</div></div></div>
    <div class="pwa-step"><div class="pwa-num">3</div><div><div class="pwa-st">${t.s3t}</div><div class="pwa-sd">${t.s3d}</div></div></div>
  </div>
  <button class="pwa-skip" id="pwa-skip-ios">${t.skip}</button>
</div>

<div id="pwa-android" style="display:none" class="pwa-section">
  <button id="pwa-android-btn" class="pwa-and-btn">${t.andBtn}</button>
  <div class="pwa-and-note">${t.andNote}</div>
  <div id="pwa-android-fb" class="pwa-fb">
    <div class="pwa-fb-t">${t.fbT}</div>
    <div class="pwa-fb-s">${t.fbS}</div>
  </div>
  <button class="pwa-skip" id="pwa-skip-android">${t.skip}</button>
</div>

</div>
<script>
(function(){
  var isIos=/iphone|ipad|ipod/i.test(navigator.userAgent||'')&&!window.MSStream;
  var isAndroid=/android/i.test(navigator.userAgent||'');
  var isStandalone=('standalone' in navigator&&navigator.standalone)||window.matchMedia('(display-mode: standalone)').matches;
  if(isStandalone||(!isIos&&!isAndroid)) return;
  document.getElementById('pwa-skip-ios').onclick=function(){document.getElementById('pwa-ios').style.display='none';};
  document.getElementById('pwa-skip-android').onclick=function(){document.getElementById('pwa-android').style.display='none';};
  if(isIos){
    document.getElementById('pwa-ios').style.display='block';
    return;
  }
  var deferredPrompt=null;
  var androidDiv=document.getElementById('pwa-android');
  var fallbackTimer=setTimeout(function(){
    if(!deferredPrompt){androidDiv.style.display='block';document.getElementById('pwa-android-fb').style.display='block';document.getElementById('pwa-android-btn').style.display='none';}
  },3000);
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();clearTimeout(fallbackTimer);
    deferredPrompt=e;androidDiv.style.display='block';
    document.getElementById('pwa-android-btn').onclick=function(){
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(){deferredPrompt=null;androidDiv.style.display='none';});
    };
  });
  window.addEventListener('appinstalled',function(){androidDiv.style.display='none';});
})();
</script>
</body></html>`;
}

app.get('/guides/:apt/premium_rome_concierge.html', async (req, res, next) => {
  const apt = String(req.params.apt || '').toLowerCase();
  if (!VALID_APARTMENTS.includes(apt)) return next();

  // Valid session → proceed to requireGuideSession
  const cookies = parseCookies(req);
  const session = verifyGuardCookie(cookies['guide_sess']);
  if (session && Date.now() <= session.exp && session.apartment === apt) return next();

  const lang = String(req.query.lang || req.query.l || 'en').slice(0, 2).toLowerCase();
  const safeLang = ['en','it','fr','de','es'].includes(lang) ? lang : 'en';

  // Case A: old JWT token present → resolve via conversationId and redirect
  const urlToken = String(req.query.t || '');
  if (urlToken) {
    const parsed = parseGuideToken(urlToken);
    if (parsed.ok && parsed.payload.cid && parsed.payload.tgt === `guide-${apt}`) {
      const p = parsed.payload;
      const day = p.day || '';
      if (day >= '2026-05-17' && day <= '2027-12-31') {
        try {
          const convResp = await axios.get(
            `https://api.hostaway.com/v1/conversations/${p.cid}`,
            { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
          );
          const reservationId = convResp.data?.result?.reservationId;
          if (reservationId) {
            const resResp = await axios.get(
              `https://api.hostaway.com/v1/reservations/${reservationId}`,
              { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
            );
            const reservation = resResp.data?.result;
            if (reservation && reservation.status !== 'cancelled') {
              const co = reservation.departureDate || reservation.checkOutDate || reservation.checkoutDate;
              const expMs = co && isYYYYMMDD(co) ? checkoutExpiryMs(co) : null;
              if (!expMs || Date.now() <= expMs) {
                console.log(`↩️ JWT old-link → /stay: ${apt} | res:${reservationId}`);
                return res.redirect(302, `/stay/${apt}?r=${reservationId}&lang=${safeLang}`);
              }
            }
          }
        } catch (e) { console.error('❌ old JWT lookup:', e.message); }
      }
    }
  }

  // Case B: no token → show email recovery form
  return res.type('html').send(recoveryFormHtml(apt, safeLang, false));
});


// ── Operator backdoor ─────────────────────────────────────────────────────
const OPERATOR_CODE = '6793844';

function signOperatorCookie() {
  const data = Buffer.from(JSON.stringify({ operator: true, exp: Date.now() + 4 * 60 * 60 * 1000 })).toString('base64url');
  const sig  = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyOperatorCookie(value) {
  try {
    if (!value || typeof value !== 'string') return null;
    const dot  = value.lastIndexOf('.');
    if (dot < 0) return null;
    const data = value.slice(0, dot);
    const sig  = value.slice(dot + 1);
    const exp  = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
    if (sig.length !== exp.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!p.operator || Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

function makeOperatorToken(apt, opPhase) {
  const now = Date.now();
  return makeToken({ tgt: `guide-${apt}`, op_phase: opPhase, ver: TOKEN_VERSION, iat: now, exp: now + 4 * 60 * 60 * 1000 });
}

const OPERATOR_APTS = ['trastevere','portico','arenula','scala','leonina'];
const OPERATOR_APT_LABELS = { trastevere:'Trastevere', portico:"Portico d'Ottavia", arenula:'Arenula', scala:'Scala', leonina:'Leonina' };
const OPERATOR_PHASE_LABELS = ['📋 After Booking', '✅ After Check-in', '🗝 Check-in Day'];

function operatorPanelHtml() {
  const rows = OPERATOR_APTS.map(apt => {
    const btns = [1,2,3].map(ph => {
      return `<a href="/operator-guide?apt=${apt}&phase=${ph}" style="display:inline-block;padding:10px 18px;background:rgba(214,176,109,${ph===3?'.22':'.08'});border:1px solid rgba(214,176,109,${ph===3?'.6':'.25'});border-radius:10px;color:${ph===3?'#f2d58a':'#b7a894'};font-size:13px;font-weight:700;text-decoration:none;margin:4px">${OPERATOR_PHASE_LABELS[ph-1]}</a>`;
    }).join('');
    return `<div style="padding:16px 0;border-bottom:1px solid rgba(214,176,109,.12)"><div style="font-size:16px;font-weight:800;color:#f5ead8;margin-bottom:10px">${OPERATOR_APT_LABELS[apt]}</div>${btns}</div>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Operator Panel</title>
<style>*{box-sizing:border-box}body{margin:0;background:#120d09;color:#f5ead8;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.box{width:100%;max-width:460px}.logo{font-size:10px;font-weight:700;letter-spacing:3px;color:#d6b06d;text-transform:uppercase;margin-bottom:8px}.title{font-size:20px;font-weight:800;margin-bottom:4px}.sub{font-size:13px;color:#b7a894;margin-bottom:24px}</style>
</head><body><div class="box">
<div class="logo">NiceFlat · Operator Panel</div>
<div class="title">Select apartment & phase</div>
<div class="sub">Session expires in 4 hours</div>
${rows}
</div></body></html>`;
}
// ── End Operator backdoor ─────────────────────────────────────────────────

// POST /guides/:apt/recover — email lookup → redirect to /stay/
app.use(express.urlencoded({ extended: false }));
app.post('/guides/:apt/recover', async (req, res) => {
  const apt = String(req.params.apt || '').toLowerCase();
  if (!VALID_APARTMENTS.includes(apt)) return res.status(404).send('Not found');

  const email = String(req.body?.email || '').trim().toLowerCase();
  const lang = String(req.body?.lang || 'en').slice(0, 2).toLowerCase();
  const safeLang = ['en','it','fr','de','es'].includes(lang) ? lang : 'en';
  const today = tzToday();

  // Operator backdoor
  if (email === OPERATOR_CODE) {
    console.log('🔑 Operator access granted:', apt);
    res.cookie('op_sess', signOperatorCookie(), { httpOnly: true, sameSite: 'lax', maxAge: 4 * 60 * 60 * 1000, path: '/' });
    return res.redirect(302, '/operator-panel');
  }

  // Accetta anche un numero di prenotazione diretto (es. 57412110)
  if (/^\d{5,10}$/.test(email.replace(/\D/g, '')) && !email.includes('@')) {
    const rid = email.replace(/\D/g, '');
    console.log(`↩️ recover: reservation ID diretto: ${rid} apt=${apt}`);
    return res.redirect(302, `/stay/${apt}?r=${rid}&lang=${safeLang}`);
  }

  if (!email || !email.includes('@')) return res.type('html').send(recoveryFormHtml(apt, safeLang, true));

  try {
    // Search Hostaway reservations by guest email
    const listingId = Object.entries(APT_LISTING_MAP).find(([,v]) => v === apt)?.[0];
    const params = new URLSearchParams({ limit: '10', guestEmail: email });
    if (listingId) params.set('listingMapId', listingId);

    const r = await axios.get(
      `https://api.hostaway.com/v1/reservations?${params}`,
      { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
    );
    let results = r.data?.result || [];

    // Booking.com uses relay/masked emails so the guestEmail API filter returns nothing.
    // Fallback: fetch all confirmed reservations for the listing and match email client-side.
    if (results.length === 0 && listingId) {
      console.log(`↩️ recover: guestEmail filter empty, trying client-side match for apt=${apt}`);
      const fbParams = new URLSearchParams({ listingMapId: listingId, status: 'confirmed', limit: '20' });
      const r2 = await axios.get(
        `https://api.hostaway.com/v1/reservations?${fbParams}`,
        { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
      );
      results = (r2.data?.result || []).filter(rv =>
        (rv.guestEmail || '').toLowerCase() === email ||
        (rv.guest?.email || '').toLowerCase() === email
      );
      console.log(`↩️ recover: client-side fallback found ${results.length} match(es) for email=${email} apt=${apt}`);
    }

    // Terzo tentativo: cerca per nome estratto dall'email (per ospiti Booking.com con email mascherata)
    if (results.length === 0 && listingId) {
      const nameParts = email.split('@')[0]
        .replace(/[._+\-]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(p => p.length > 2);
      if (nameParts.length > 0) {
        console.log(`↩️ recover: name-based match, parts=${JSON.stringify(nameParts)} apt=${apt}`);
        const r3 = await axios.get(
          `https://api.hostaway.com/v1/reservations?listingMapId=${listingId}&limit=20`,
          { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
        );
        results = (r3.data?.result || []).filter(rv => {
          if (rv.status === 'cancelled') return false;
          const fn = (rv.guestFirstName || '').toLowerCase();
          const ln = (rv.guestLastName || '').toLowerCase();
          const full = (rv.guestName || '').toLowerCase();
          return nameParts.every(p => fn.includes(p) || ln.includes(p) || full.includes(p));
        });
        console.log(`↩️ recover: name-based found ${results.length}`);
      }
    }

    // Find first active reservation with check-in >= today and not expired
    const match = results.find(res => {
      if (res.status === 'cancelled') return false;
      const arrivalDate = res.arrivalDate || res.checkInDate || '';
      const departureDate = res.departureDate || res.checkOutDate || res.checkoutDate || '';
      if (arrivalDate && arrivalDate > '2027-12-31') return false;
      if (departureDate && isYYYYMMDD(departureDate)) {
        const expMs = checkoutExpiryMs(departureDate);
        if (expMs && Date.now() > expMs) return false; // stay ended
      }
      // Must be a current or future stay
      return !departureDate || departureDate >= today;
    });

    if (!match) {
      console.warn(`↩️ recover: no match for email=${email} apt=${apt}`);
      return res.type('html').send(recoveryFormHtml(apt, safeLang, true));
    }

    const reservationId = match.id || match.reservationId;
    console.log(`↩️ Email recovery → /stay: ${apt} | res:${reservationId} | email:${email}`);
    return res.redirect(302, `/stay/${apt}?r=${reservationId}&lang=${safeLang}`);

  } catch (e) {
    console.error('❌ /guides/recover error:', e.message);
    return res.type('html').send(recoveryFormHtml(apt, safeLang, true));
  }
});

// ── Protected guide HTML (session required) ──────────────────────────────
app.get('/guides/:apt/premium_rome_concierge.html', requireGuideSession, (req, res) => {
  const apt = String(req.params.apt || '').toLowerCase();
  if (!VALID_APARTMENTS.includes(apt)) return res.status(404).send('Not found');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.sendFile(path.join(PUBLIC_DIR, 'guides', apt, 'premium_rome_concierge.html'));
});

// ── Dynamic manifest — embeds token in start_url so iOS home screen keeps it ──
const MANIFEST_APT_NAMES = { arenula:'Via Arenula', portico:"Portico d'Ottavia", leonina:'Via Leonina', scala:'Via della Scala', trastevere:'Viale Trastevere' };
app.get('/guides/:apt/manifest', (req, res) => {
  const apt = String(req.params.apt || '').toLowerCase();
  if (!['arenula','portico','leonina','scala','trastevere'].includes(apt)) return res.status(404).end();
  const t = String(req.query.t || '');
  const startUrl = t
    ? `/guides/${apt}/premium_rome_concierge.html?t=${encodeURIComponent(t)}`
    : `/guides/${apt}/premium_rome_concierge.html`;
  res.setHeader('Content-Type', 'application/manifest+json');
  res.json({
    id: `/guides/${apt}/`,
    name: `NiceFlat — ${MANIFEST_APT_NAMES[apt] || apt}`,
    short_name: 'Rome Concierge',
    description: 'Your premium concierge guide for your NiceFlat apartment in Rome',
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    background_color: '#120d09',
    theme_color: '#120d09',
    icons: [
      { src: '/guides/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/guides/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  });
});

// ── Static guide assets (icons, manifests — no session needed) ───────────
app.use("/guides", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
app.use("/guest-assistant", express.static(path.join(PUBLIC_DIR, "guides"), { fallthrough: false }));
app.use("/guides-v2", express.static(path.join(PUBLIC_DIR, "guides-v2"), { fallthrough: false }));
app.use("/public-test-ai-html", express.static(path.join(PUBLIC_DIR, "public-test-ai-html"), { fallthrough: false }));
 
app.get("/checkin/:apt/today", (req, res) => {
  const apt = req.params.apt.toLowerCase(), today = tzToday();
  const lang = String(req.query.lang || "en").slice(0, 2).toLowerCase();
  const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day: today });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}&lang=${lang}`;
  return res.redirect(302, url);
});
app.get("/checkin/:apt/res/:reservationId", async (req, res) => {
  const apt = req.params.apt.toLowerCase();
  const reservationId = req.params.reservationId;

  try {
    const r = await axios.get(
      `https://api.hostaway.com/v1/reservations/${reservationId}`,
      { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
    );

    const reservation = r.data?.result;
    if (!reservation) return res.status(404).send("Reservation not found");

    const day = reservation.arrivalDate || reservation.checkInDate;
    if (!day || !isYYYYMMDD(day)) return res.status(400).send("Invalid date");

    const today = tzToday();
    if (day !== today) return res.status(410).send("Link scaduto.");

    const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day });
    const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
    return res.redirect(302, url);

  } catch (e) {
    console.error("❌ /checkin/res error:", e.message);
    return res.status(500).send("Errore interno");
  }
});
app.get("/checkin/:apt/:rawDate(\\d[^/.]*)", (req, res) => {
  const apt = req.params.apt.toLowerCase(), today = tzToday();
  const raw = String(req.params.rawDate || "");
  let day = normalizeCheckinDate(raw);
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) day = today;
    else return res.status(410).send("Link scaduto.");
  }
  if (day !== today) return res.status(410).send("Link scaduto.");
  const { token } = newTokenFor(`checkin-${apt}`, { windowMin: CHECKIN_WINDOW_MIN, max: 200, day });
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});

app.get("/checkin/:apt/", async (req, res) => {
  const apt = req.params.apt.toLowerCase(), today = tzToday();
  const raw = (req.query.d || "").toString();
  let day = normalizeCheckinDate(raw);
  if (!day) {
    if (ALLOW_TODAY_FALLBACK) day = today;
    else return res.status(410).send("Link scaduto.");
  }
  if (day !== today) return res.status(410).send("Link scaduto.");
  // Look up conversationId from session cookie so OTP can be sent via Hostaway
  let cid = null;
  try {
    const session = verifyGuardCookie(parseCookies(req)['guide_sess']);
    if (session?.reservationId) cid = await getConversationId(session.reservationId);
  } catch (e) { console.error('❌ /checkin/?d getConversationId:', e.message); }
  // Build checkin token with cid
  const _now = Date.now(), _jti = b64url(crypto.randomBytes(9));
  const _tp = { tgt: `checkin-${apt}`, exp: _now + CHECKIN_WINDOW_MIN * 60 * 1000,
    max: 200, used: 0, jti: _jti, iat: _now, ver: TOKEN_VERSION, day, cid };
  const token = makeToken(_tp);
  const url = `${req.protocol}://${req.get("host")}/checkin/${apt}/index.html?t=${token}`;
  res.redirect(302, url);
});

app.get("/checkin/:apt/index.html", (req, res) => {
  try {
    const apt = req.params.apt.toLowerCase(), t = String(req.query.t || "");
    const parsed = parseGuideToken(t);
    if (!parsed.ok) return res.status(410).send("Questo link non è più valido.");
    const p = parsed.payload || {};
    if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).send("Questo link Ã¨ scaduto. Richiedi un nuovo link.");
    const { tgt, day } = p;
    const validTgts = [`checkin-${apt}`, `guide-${apt}`];
    if (!validTgts.includes(tgt) && typeof p.op_phase !== "number") return res.status(410).send("Link non valido.");
    // Operator tokens and guide tokens skip the day check
    const isOperator = typeof p.op_phase === "number";
    const isGuideToken = tgt === `guide-${apt}`;
    if (!isOperator && !isGuideToken && (!isYYYYMMDD(day) || day !== tzToday())) return res.status(410).send("Questo link Ã¨ valido solo nel giorno di check-in.");
    const filePath = path.join(PUBLIC_DIR, "checkin", apt, "index.html");
    return res.sendFile(filePath, (err) => {
      if (err) {
        console.error("â sendFile error:", { filePath, code: err.code, message: err.message });
        if (!res.headersSent) return res.status(err.statusCode || 404).send("Check-in page missing on server.");
      }
    });
  } catch (e) {
    console.error("â /checkin/:apt/index.html crashed:", e);
    return res.status(500).send("Internal Server Error");
  }
});

function requireCheckinToken(req, res, next) {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload || {};
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  const { tgt, day } = p;
  if (tgt !== `checkin-${apt}` && tgt !== `guide-${apt}` && typeof p.op_phase !== "number") return res.status(410).json({ ok: false, error: "token_target_mismatch" });
  // Token valid for 24h via exp field - no midnight cutoff
  next();
}

// OTP ENDPOINTS
app.post("/checkin/:apt/send-otp", async (req, res) => {
  const t = String(req.query.t || "");
  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload;
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  if (!p.cid) return res.status(400).json({ ok: false, error: "no_cid" });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  OTP_STORE.set(p.jti, { code, exp: Date.now() + 5 * 60 * 1000, cid: p.cid });
  const langParam = String(req.query.lang || "en").slice(0, 2);
  const msgs = {
    en: `Your door access code: ${code}. Valid 5 minutes. Do not share it.`,
    it: `Il tuo codice di accesso: ${code}. Valido 5 minuti. Non condividerlo.`,
    fr: `Votre code: ${code}. Valable 5 minutes. Ne le partagez pas.`,
    de: `Ihr Zugangscode: ${code}. Gueltig 5 Minuten. Nicht weitergeben.`,
    es: `Tu codigo de acceso: ${code}. Valido 5 minutos. No lo compartas.`,
  };
  const message = "\uD83D\uDD10 " + (msgs[langParam] || msgs.en);
  try { await sendHostawayMessage({ conversationId: p.cid, message }); } catch(e) { console.error("OTP send:", e.message); }
  res.json({ ok: true });
});

app.post("/checkin/:apt/verify-otp", async (req, res) => {
  const t = String(req.query.t || "");
  const { code } = req.body;
  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload;
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  const stored = OTP_STORE.get(p.jti);
  if (!stored) return res.status(400).json({ ok: false, error: "no_otp_pending" });
  if (Date.now() > stored.exp) { OTP_STORE.delete(p.jti); return res.status(400).json({ ok: false, error: "otp_expired" }); }
  if (String(code).trim() !== stored.code) return res.status(400).json({ ok: false, error: "wrong_code" });
  OTP_STORE.delete(p.jti);
  const stPayload = { tgt: `session-${req.params.apt}`, jti_ref: p.jti, exp: p.exp, iat: Date.now(), ver: TOKEN_VERSION };
  const st = makeToken(stPayload);
  res.json({ ok: true, st });
});

function requireVerifiedToken(req, res, next) {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  const parsedT = parseGuideToken(t);
  if (!parsedT.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const tp = parsedT.payload;
  if (typeof tp.exp !== "number" || Date.now() > tp.exp) return res.status(410).json({ ok: false, error: "expired" });
  if (tp.tgt !== `checkin-${apt}` && tp.tgt !== `guide-${apt}` && typeof tp.op_phase !== "number") return res.status(410).json({ ok: false, error: "token_target_mismatch" });
  const st = String(req.query.st || "");
  if (!st) return res.status(401).json({ ok: false, error: "otp_required" });
  const parsedSt = parseToken(st);
  if (!parsedSt.ok) return res.status(401).json({ ok: false, error: "bad_session_token" });
  const sp = parsedSt.payload;
  if (typeof sp.exp !== "number" || Date.now() > sp.exp) return res.status(401).json({ ok: false, error: "session_expired" });
  if (sp.tgt !== `session-${apt}`) return res.status(401).json({ ok: false, error: "session_target_mismatch" });
  next();
}

app.post("/checkin/:apt/open/building", requireVerifiedToken, async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const map = {
    arenula: "arenula-building",
    leonina: "leonina-building",
    scala: "via-della-scala-building",
    portico: "portico-1d-building",
    trastevere: "viale-trastevere-building"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});

app.post("/checkin/:apt/open/door", requireVerifiedToken, async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const map = {
    arenula: "arenula-door",
    leonina: "leonina-door",
    scala: "via-della-scala-door",
    portico: "portico-1d-door",
    trastevere: "viale-trastevere-door"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});

// Direct open endpoints — no OTP required, only valid checkin-* token
// Used by the illustrated self check-in form (/checkin/{apt}/index.html)
app.post("/checkin/:apt/open-direct/building", async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload;
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  if (p.tgt !== `checkin-${apt}` && p.tgt !== `guide-${apt}` && typeof p.op_phase !== "number") return res.status(410).json({ ok: false, error: "token_target_mismatch" });
  const map = {
    arenula: "arenula-building",
    leonina: "leonina-building",
    scala: "via-della-scala-building",
    portico: "portico-1d-building",
    trastevere: "viale-trastevere-building"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});

app.post("/checkin/:apt/open-direct/door", async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload;
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  if (p.tgt !== `checkin-${apt}` && p.tgt !== `guide-${apt}` && typeof p.op_phase !== "number") return res.status(410).json({ ok: false, error: "token_target_mismatch" });
  const map = {
    arenula: "arenula-door",
    leonina: "leonina-door",
    scala: "via-della-scala-door",
    portico: "portico-1d-door",
    trastevere: "viale-trastevere-door"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});


// Alias apartment endpoint for premium check-in guides.
// The HTML guides call /open-direct/apartment.
// /open-direct/door remains available as fallback.
app.post("/checkin/:apt/open-direct/apartment", async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.status(410).json({ ok: false, error: "bad_token" });
  const p = parsed.payload;
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.status(410).json({ ok: false, error: "expired" });
  if (p.tgt !== `checkin-${apt}` && p.tgt !== `guide-${apt}` && typeof p.op_phase !== "number") return res.status(410).json({ ok: false, error: "token_target_mismatch" });
  const map = {
    leonina: "leonina-door",
    scala: "via-della-scala-door",
    portico: "portico-1d-door",
    trastevere: "viale-trastevere-door"
  };
  const targetKey = map[apt], targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).json({ ok: false, error: "unknown_target" });
  const result = (targetDef.ids.length === 1) ? await openOne(targetDef.ids[0]) : await openSequence(targetDef.ids, 10000);
  if (!result.ok) return res.status(502).json({ ok: false, error: "open_failed", details: result });
  return res.json({ ok: true, opened: result });
});


// ── Guide ping — notifica host alla prima interazione dell'ospite con la guida ─
// Chiamato dal JS della guida al primo click. Manda UNA nota interna HostAway
// (deduplicata per reservationId) per confermare che la guida è aperta e usata.
app.post("/api/guide-ping", async (req, res) => {
  res.json({ ok: true }); // risponde subito, processamento in background
  try {
    const t = String(req.query.t || '');
    if (!t) return;
    const parsed = parseGuideToken(t);
    if (!parsed.ok) return;
    const p = parsed.payload;
    const rid = p.rid ? String(p.rid) : null;
    if (!rid) return;
    if (GUIDE_PING_SENT.has(rid)) return; // già notificato per questa reservation
    GUIDE_PING_SENT.add(rid);
    // Estrai apartment dal tgt (es. "guide-portico" → "portico")
    const apt = p.tgt ? String(p.tgt).replace(/^(guide|checkin)-/, '') : '?';
    const cid = await getConversationId(rid);
    if (!cid) { console.log(`⚠️ guide-ping: no conversationId for res ${rid}`); return; }
    const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' });
    await sendHostawayInternalNote({
      conversationId: cid,
      message: `📲 Ospite sta usando la guida digitale (${apt}) — ${now}`
    });
    console.log(`📲 Guide ping notificato: ${apt} | res:${rid} | conv:${cid}`);
  } catch (e) {
    console.error('❌ guide-ping error:', e.message);
  }
});

// ── Dynamic phase endpoint ───────────────────────────────────────────────────
// Returns { phase: 1|2|3 } based on token type and current time (Europe/Rome)
// Guide tokens (tgt: guide-*) → phase 2 or 3 based on time
// Checkin tokens (tgt: checkin-*) → phase 3 if today + time reached, else 2
// On check-in day: fetches live arrivalTime from Hostaway (cached 30 min) so
// the unlock time always reflects what the guest entered in the online check-in form.
app.get("/checkin/:apt/phase", async (req, res) => {
  const apt = String(req.params.apt || "").toLowerCase();
  const t = String(req.query.t || "");
  if (!t) return res.json({ phase: 1 });

  const parsed = parseGuideToken(t);
  if (!parsed.ok) return res.json({ phase: 1 });

  const p = parsed.payload;
  if (typeof p.exp !== "number" || Date.now() > p.exp) return res.json({ phase: 1 });

  const validTargets = [`guide-${apt}`, `checkin-${apt}`];
  if (!validTargets.includes(p.tgt)) return res.json({ phase: 1 });

  // Operator token: return requested phase directly
  if (typeof p.op_phase === 'number' && p.op_phase >= 1 && p.op_phase <= 3) {
    return res.json({ phase: p.op_phase });
  }

  const today = tzToday();
  const day = p.day || null;

  if (!day || day > today) return res.json({ phase: 2 });  // no date or future check-in
  if (day < today) return res.json({ phase: 3 });          // past check-in day → keys always unlocked

  // It's check-in day: get the most up-to-date arrival time.
  // If the guest filled the Hostaway online check-in form, arrivalTime is updated there.
  // We fetch it live (with 30-min cache) so the unlock time is always accurate.
  let checkinTime = p.ct || '13:00';
  if (p.rid) {
    try {
      checkinTime = await getArrivalTime(p.rid, checkinTime);
    } catch (_) { /* fallback to token value */ }
  }

  // Check if current Rome time >= checkin time
  const nowRome = new Date().toLocaleString("en-CA", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false });
  const phase = nowRome >= checkinTime ? 3 : 2;
  return res.json({ phase, unlocksAt: phase < 3 ? checkinTime : null });
});

 app.use("/checkin", express.static(path.join(PUBLIC_DIR, "checkin"), { fallthrough: true }));
 // ========================================================================
// MONTI LIVE — SLOT GIORNALIERI MULTILINGUA
// Lingue: it, en, fr, es, de
// ========================================================================

const MONTI_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata leggera",
        text: "È il momento perfetto per uscire senza fretta.\nFai due passi tra Via Leonina e Via del Boschetto, guarda le botteghe che aprono e prenditi il quartiere con calma.\nMonti la mattina è autentica e silenziosa."
      },
      caffe: {
        title: "☕ Caffè e pausa",
        text: "Siediti per un caffè fatto bene.\nUn tavolino, un cornetto se ti va, e nessun programma.\nRoma a quest’ora non corre."
      },
      rientro: {
        title: "🏠 Rientro breve",
        text: "Se preferisci, rientra.\nSistema le tue cose, una doccia veloce, poi esci quando ti senti pronto.\nMonti è lì, non scappa."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo vicino",
        text: "Se vuoi fare pochissima strada, vai in Piazza della Madonna dei Monti.\nSiediti ai tavolini, ordina un calice o uno spritz e guarda il quartiere che si accende piano piano."
      },
      sedersi: {
        title: "🪑 Sedersi e guardare",
        text: "Prenditi una pausa vera.\nSiediti in piazza o lungo una via laterale, senza meta.\nA Monti alle 18 non serve fare nulla."
      },
      rientro: {
        title: "🏠 Rientro breve",
        text: "Se sei stanco davvero, rientra.\nDoccia, silenzio, magari un po’ di musica.\nTra poco Roma riparte."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Cena senza stress",
        text: "È l’ora giusta per cena.\nA Monti puoi mangiare bene senza formalità.\nEntra dove ti ispira, resta quanto vuoi."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Fai due passi verso i Fori Imperiali.\nLa luce cambia, la città rallenta.\nRoma di sera è tutta qui."
      },
      rientro: {
        title: "🏠 Serata tranquilla",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery e riposo.\nDomani si ricomincia."
      },
    
      cena: {
        title: "🍽️ Cena senza stress",
        text: "È l'ora giusta per cena.\nA Monti puoi mangiare bene senza formalità.\nEntra dove ti ispira, resta quanto vuoi."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va un’ultima uscita, Monti di notte è discreta.\nUn drink tranquillo, poche parole.\nPoi rientro senza fretta."
      },
      silenzio: {
        title: "🌌 Silenzio",
        text: "Le strade si svuotano.\nIl quartiere riposa.\nÈ un buon momento per fermarsi."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nRoma domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Easy walk",
        text: "Perfect time to step out slowly.\nWalk around Via Leonina and Via del Boschetto, watch the shops open and enjoy the neighborhood.\nMorning Monti is quiet and authentic."
      },
      caffe: {
        title: "☕ Coffee break",
        text: "Sit down for a good coffee.\nNo plans, no rush.\nRome moves slowly at this hour."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back inside.\nQuick shower, unpack a bit.\nMonti will wait for you."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo nearby",
        text: "Go to Piazza della Madonna dei Monti.\nSit outside, order a drink and watch the area come alive."
      },
      sedersi: {
        title: "🪑 Sit and watch",
        text: "Take a real break.\nSit anywhere, no destination.\nAt 6 pm Monti doesn’t ask for plans."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you’re tired, go back.\nShower, quiet time.\nThe evening will come naturally."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Dinner",
        text: "It’s dinner time.\nMonti offers relaxed places with good food.\nNo rush, no dress code."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the Imperial Fora.\nLights change, the city slows down.\nPure Rome."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nLight dinner and rest.\nTomorrow awaits."
      },
    
      cena: {
        title: "🍽️ Dinner",
        text: "It's dinner time.\nMonti offers relaxed places with good food.\nNo rush, no dress code."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you want, Monti at night is calm and charming.\nOne last drink, then home."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "Streets empty.\nThe neighborhood sleeps.\nTime to stop."
      },
      dormire: {
        title: "😴 Sleep",
        text: "Close the day.\nRest well.\nRome is still here tomorrow."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: {
        title: "☀️ Promenade tranquille",
        text: "Moment parfait pour sortir sans se presser.\nPromène-toi autour de Via Leonina.\nMonti le matin est calme et vrai."
      },
      caffe: {
        title: "☕ Pause café",
        text: "Installe-toi pour un bon café.\nSans programme.\nRome ralentit à cette heure."
      },
      rientro: {
        title: "🏠 Retour",
        text: "Si tu préfères, rentre.\nDouche rapide, repos.\nMonti t’attend."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Apéritif",
        text: "Va à la Piazza della Madonna dei Monti.\nUn verre et regarde la vie passer."
      },
      sedersi: {
        title: "🪑 S’asseoir",
        text: "Prends une vraie pause.\nSans but.\nMonti suffit."
      },
      rientro: {
        title: "🏠 Retour",
        text: "Si tu es fatigué, rentre.\nCalme et silence."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Dîner",
        text: "C’est l’heure du dîner.\nRestaurants simples et bons.\nSans stress."
      },
      passeggiata: {
        title: "🌙 Promenade",
        text: "Marche vers les Forums.\nRome ralentit."
      },
      rientro: {
        title: "🏠 Soirée calme",
        text: "Reste à la maison.\nRepos mérité."
      },
    
      cena: { title: "🍽️ Dîner", text: "C'est l'heure du dîner.\nRestaurants simples et bons.\nSans stress." }
    },
    "2330": {
      ultimo: {
        title: "🍸 Dernier verre",
        text: "Un dernier verre si tu veux.\nPuis retour tranquille."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "Le quartier dort.\nMoment de calme."
      },
      dormire: {
        title: "😴 Dormir",
        text: "Bonne nuit.\nRome demain."
      }
    }
  },

  es: {
    "11": {
      passeggiata: {
        title: "☀️ Paseo tranquilo",
        text: "Momento perfecto para salir sin prisa.\nMonti por la mañana es auténtico."
      },
      caffe: {
        title: "☕ Café",
        text: "Siéntate y disfruta.\nRoma va despacio."
      },
      rientro: {
        title: "🏠 Volver",
        text: "Si prefieres, regresa.\nDescansa un poco."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo",
        text: "Plaza Madonna dei Monti.\nUna copa y nada más."
      },
      sedersi: {
        title: "🪑 Sentarse",
        text: "Pausa real.\nSin destino."
      },
      rientro: {
        title: "🏠 Volver",
        text: "Ducha, calma."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Cena",
        text: "Hora de cenar.\nSin estrés."
      },
      passeggiata: {
        title: "🌙 Paseo",
        text: "Camina hacia los Foros."
      },
      rientro: {
        title: "🏠 Noche tranquila",
        text: "Descanso."
      },
    
      cena: { title: "🍽️ Cena", text: "Hora de cenar.\nSin estrés." }
    },
    "2330": {
      ultimo: {
        title: "🍸 Última copa",
        text: "Una última si te apetece."
      },
      silenzio: {
        title: "🌌 Silencio",
        text: "Todo se calma."
      },
      dormire: {
        title: "😴 Dormir",
        text: "Buen descanso."
      }
    }
  },

  de: {
    "11": {
      passeggiata: {
        title: "☀️ Ruhiger Spaziergang",
        text: "Perfekte Zeit ohne Eile.\nMonti ist morgens still."
      },
      caffe: {
        title: "☕ Kaffee",
        text: "Setz dich.\nRom ist langsam."
      },
      rientro: {
        title: "🏠 Zurück",
        text: "Wenn du willst, geh zurück.\nKurze Pause."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitif",
        text: "Piazza Madonna dei Monti.\nEin Glas genügt."
      },
      sedersi: {
        title: "🪑 Sitzen",
        text: "Einfach da sein."
      },
      rientro: {
        title: "🏠 Zurück",
        text: "Ruhe und Pause."
      }
    },
    "2030": {
      mangiare: {
        title: "🍽️ Abendessen",
        text: "Zeit zum Essen.\nGanz entspannt."
      },
      passeggiata: {
        title: "🌙 Abendspaziergang",
        text: "Zu den Foren gehen."
      },
      rientro: {
        title: "🏠 Ruhiger Abend",
        text: "Erholung."
      },
    
      cena: { title: "🍽️ Abendessen", text: "Zeit zum Essen.\nGanz entspannt." }
    },
    "2330": {
      ultimo: {
        title: "🍸 Letztes Glas",
        text: "Wenn du willst, noch eins."
      },
      silenzio: {
        title: "🌌 Stille",
        text: "Alles schläft."
      },
      dormire: {
        title: "😴 Schlafen",
        text: "Gute Nacht."
      }
    }
  }
};
// ========================================================================
// PORTICO LIVE — VIA DEL PORTICO D’OTTAVIA
// TEMPLATE DEFINITIVO PER TUTTE LE LIVE
// ========================================================================

const PORTICO_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata lenta",
        text: "La mattina qui è speciale.\nFai due passi tra Via del Portico d’Ottavia e Piazza Costaguti.\nIl quartiere si sveglia piano, senza rumore."
      },
      dolce: {
        title: "🥐 Qualcosa di dolce",
        text: "Fermati da Pasticceria Boccione.\nPizza ebraica o torta ricotta e visciole.\nSi mangia in piedi, come una volta."
      },
      rientro: {
        title: "🏠 Rientro tranquillo",
        text: "Se preferisci, rientra.\nSistema le tue cose, una pausa breve.\nQui il tempo non corre."
      },
    
      caffe: {
        title: "☕ Caffè nel Ghetto",
        text: "Fermati per un caffè tranquillo.\nUn bar del quartiere, niente folla.\nLa mattina nel Ghetto inizia piano."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo nel Ghetto",
        text: "È l’ora giusta per fermarsi.\nUn calice da Il Beppe e i Suoi Formaggi o uno spritz da Ghetto 05.\nTutto è a pochi passi."
      },
      piazza: {
        title: "⛲ Sedersi in piazza",
        text: "Vai verso Piazza Mattei.\nSiediti davanti alla Fontana delle Tartarughe.\nGuarda il quartiere vivere."
      },
      rientro: {
        title: "🏠 Pausa breve",
        text: "Se sei stanco, rientra.\nUna doccia, silenzio.\nTra poco la sera cambia ritmo."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Cena senza fretta",
        text: "È il momento di mangiare.\nBa’Ghetto o Renato al Ghetto.\nCucina vera, senza formalità."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Fai due passi verso il Teatro di Marcello.\nLe rovine illuminate cambiano tutto.\nRoma di sera è qui."
      },
      rientro: {
        title: "🏠 Serata calma",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery.\nDomani è un altro giorno."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va ancora qualcosa, un drink discreto.\nBartaruga, senza rumore.\nPoi rientro."
      },
      fiume: {
        title: "🌉 Camminata breve",
        text: "Attraversa verso l’Isola Tiberina.\nLe luci sul Tevere chiudono la giornata.\nBasta poco."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nQuesto quartiere domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Slow walk",
        text: "Morning here is special.\nWalk between Via del Portico d’Ottavia and Piazza Costaguti.\nThe neighborhood wakes up quietly."
      },
      dolce: {
        title: "🥐 Something sweet",
        text: "Stop at Pasticceria Boccione.\nJewish pizza or ricotta and sour cherry cake.\nSimple and traditional."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back.\nUnpack and rest a bit.\nTime moves slowly here."
      },
    
      caffe: {
        title: "☕ Coffee in the Ghetto",
        text: "Stop for a quiet coffee.\nA local bar, no crowds.\nMorning in the Jewish quarter starts slowly."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo time",
        text: "Perfect time to stop.\nWine at Il Beppe e i Suoi Formaggi or a spritz nearby.\nEverything is within walking distance."
      },
      piazza: {
        title: "⛲ Sit in the square",
        text: "Go to Piazza Mattei.\nSit by the Turtle Fountain.\nWatch the neighborhood live."
      },
      rientro: {
        title: "🏠 Short break",
        text: "If tired, go back.\nShower and quiet time.\nEvening comes naturally."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Dinner",
        text: "Dinner time.\nBa’Ghetto or Renato al Ghetto.\nHonest food, no rush."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the Theatre of Marcellus.\nLights change everything."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you feel like it, one last quiet drink.\nThen head back."
      },
      fiume: {
        title: "🌉 River walk",
        text: "Cross to Tiber Island.\nCity lights on the river close the day."
      },
      dormire: {
        title: "😴 Sleep",
        text: "End the day.\nRest well."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: { title: "☀️ Promenade lente", text: "Le matin ici est spécial.\nPromène-toi autour du Portique d’Ottavie.\nLe quartier s’éveille doucement." },
      dolce: { title: "🥐 Pause sucrée", text: "Arrête-toi chez Boccione.\nPizza juive ou gâteau ricotta-griottes.\nSimple et authentique." },
      rientro: { title: "🏠 Retour calme", text: "Si tu préfères, rentre.\nIci, le temps ralentit." },
    
      caffe: { title: "☕ Café", text: "Un café simple.\nLe matin ici est calme." }
    },
    "18": {
      aperitivo: { title: "🍷 Apéritif", text: "Moment parfait pour s’arrêter.\nUn verre et le quartier autour." },
      piazza: { title: "⛲ La place", text: "Assieds-toi Piazza Mattei.\nRegarde la vie passer." },
      rientro: { title: "🏠 Pause", text: "Si tu es fatigué, rentre.\nLe soir arrive doucement." }
    },
    "2030": {
      cena: { title: "🍽️ Dîner", text: "Cuisine juive romaine.\nSans stress, sans hâte." },
      passeggiata: { title: "🌙 Promenade", text: "Vers le Théâtre de Marcellus.\nLa lumière change tout." },
      rientro: { title: "🏠 Soirée calme", text: "Reste tranquille.\nDemain continue." }
    },
    "2330": {
      ultimo: { title: "🍸 Dernier verre", text: "Un dernier verre si tu veux.\nPuis retour." },
      fiume: { title: "🌉 Le fleuve", text: "Traverse vers l’Île Tibérine.\nLa ville se tait." },
      dormire: { title: "😴 Dormir", text: "Bonne nuit.\nÀ demain." }
    }
  },

  es: {
    "11": {
      passeggiata: { title: "☀️ Paseo lento", text: "La mañana aquí es especial.\nEl barrio despierta despacio." },
      dolce: { title: "🥐 Algo dulce", text: "Boccione.\nPizza judía o tarta tradicional." },
      rientro: { title: "🏠 Volver", text: "Si prefieres, regresa.\nAquí no hay prisa." },
    
      caffe: { title: "☕ Café", text: "Un café tranquilo.\nSin prisa." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitivo", text: "Hora perfecta para parar.\nUna copa y nada más." },
      piazza: { title: "⛲ Plaza", text: "Siéntate en Piazza Mattei.\nObserva." },
      rientro: { title: "🏠 Descanso", text: "Ducha y calma.\nLa tarde sigue." }
    },
    "2030": {
      cena: { title: "🍽️ Cena", text: "Cocina tradicional.\nSin estrés." },
      passeggiata: { title: "🌙 Paseo", text: "Hacia el Teatro de Marcelo." },
      rientro: { title: "🏠 Noche tranquila", text: "Descansa.\nMañana continúa." }
    },
    "2330": {
      ultimo: { title: "🍸 Última copa", text: "Si te apetece, una más." },
      fiume: { title: "🌉 Río", text: "Isla Tiberina.\nTodo se calma." },
      dormire: { title: "😴 Dormir", text: "Buenas noches." }
    }
  },

  de: {
    "11": {
      passeggiata: { title: "☀️ Ruhiger Spaziergang", text: "Der Morgen hier ist besonders.\nAlles beginnt langsam." },
      dolce: { title: "🥐 Etwas Süßes", text: "Boccione.\nTraditionell und einfach." },
      rientro: { title: "🏠 Zurück", text: "Wenn du willst, geh zurück.\nKeine Eile." },
    
      caffe: { title: "☕ Kaffee", text: "Einfach sitzen.\nOhne Eile." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitif", text: "Zeit für eine Pause.\nEin Glas genügt." },
      piazza: { title: "⛲ Platz", text: "Setz dich auf den Platz.\nBeobachte." },
      rientro: { title: "🏠 Pause", text: "Ruhe.\nDer Abend kommt." }
    },
    "2030": {
      cena: { title: "🍽️ Abendessen", text: "Ehrliche Küche.\nGanz entspannt." },
      passeggiata: { title: "🌙 Spaziergang", text: "Zum Marcellustheater." },
      rientro: { title: "🏠 Ruhiger Abend", text: "Erholung.\nMorgen geht es weiter." }
    },
    "2330": {
      ultimo: { title: "🍸 Letztes Glas", text: "Wenn du willst, noch eins." },
      fiume: { title: "🌉 Fluss", text: "Zur Tiberinsel.\nStille." },
      dormire: { title: "😴 Schlafen", text: "Gute Nacht." }
    }
  }
};
// ========================================================================
// TRASTEVERE LIVE — VIA DELLA SCALA
// TEMPLATE DEFINITIVO (IDENTICO A PORTICO)
// ========================================================================

const SCALA_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata lenta",
        text: "La mattina a Trastevere è speciale.\nCammina lungo Via della Scala e nei vicoli intorno.\nIl quartiere si sveglia piano, senza rumore."
      },
      caffe: {
        title: "☕ Caffè tranquillo",
        text: "Fermati per un caffè semplice.\nUn tavolino, poche parole.\nQui la giornata inizia lentamente."
      },
      rientro: {
        title: "🏠 Rientro tranquillo",
        text: "Se preferisci, rientra.\nSistema le tue cose, una pausa breve.\nTrastevere non scappa."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo a Trastevere",
        text: "È l’ora giusta per fermarsi.\nUn drink nei dintorni di Piazza Santa Maria.\nL’atmosfera cambia senza fretta."
      },
      piazza: {
        title: "⛲ Sedersi in piazza",
        text: "Siediti in piazza.\nVoci, passi, risate.\nTrastevere vive così."
      },
      rientro: {
        title: "🏠 Pausa breve",
        text: "Se sei stanco, rientra.\nDoccia, silenzio.\nTra poco la sera prende forma."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Cena senza fretta",
        text: "È il momento di mangiare.\nCucina romana, porzioni generose.\nSenza formalità."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Cammina verso il Tevere.\nLe luci si riflettono sull’acqua.\nRoma di sera è qui."
      },
      rientro: {
        title: "🏠 Serata calma",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery.\nDomani continua."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va ancora qualcosa, un ultimo drink.\nSenza musica alta.\nPoi rientro."
      },
      silenzio: {
        title: "🌌 Silenzio",
        text: "I vicoli si svuotano.\nRestano luci e passi lontani.\nÈ il momento di fermarsi."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nTrastevere domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Slow walk",
        text: "Morning in Trastevere is special.\nWalk along Via della Scala and nearby alleys.\nThe neighborhood wakes up quietly."
      },
      caffe: {
        title: "☕ Coffee break",
        text: "Stop for a simple coffee.\nSoft light, no rush.\nThe day starts slowly here."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back.\nUnpack and rest a bit.\nTrastevere will wait."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo time",
        text: "Perfect moment to stop.\nA drink near Santa Maria Square.\nThe mood changes gently."
      },
      piazza: {
        title: "⛲ Sit in the square",
        text: "Sit down.\nPeople, voices, movement.\nThat’s Trastevere."
      },
      rientro: {
        title: "🏠 Short break",
        text: "If tired, go back.\nShower and quiet.\nEvening comes naturally."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Dinner",
        text: "Dinner time.\nRoman food, relaxed places.\nNo rush."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the river.\nLights reflect on the water."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you feel like it, one last drink.\nThen head back."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "Alleys empty.\nThe city slows down."
      },
      dormire: {
        title: "😴 Sleep",
        text: "End the day.\nRest well."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: { title: "☀️ Promenade lente", text: "Le matin à Trastevere est spécial.\nLe quartier se réveille doucement." },
      caffe: { title: "☕ Café", text: "Un café simple.\nLa journée commence lentement." },
      rientro: { title: "🏠 Retour calme", text: "Rentre si tu veux.\nIci, rien ne presse." }
    },
    "18": {
      aperitivo: { title: "🍷 Apéritif", text: "Moment idéal pour s’arrêter.\nUn verre suffit." },
      piazza: { title: "⛲ La place", text: "Assieds-toi.\nRegarde la vie passer." },
      rientro: { title: "🏠 Pause", text: "Un peu de repos avant la soirée." }
    },
    "2030": {
      cena: { title: "🍽️ Dîner", text: "Cuisine romaine simple.\nSans hâte." },
      passeggiata: { title: "🌙 Promenade", text: "Vers le Tibre.\nLumières du soir." },
      rientro: { title: "🏠 Soirée calme", text: "Reste tranquille.\nDemain continue." }
    },
    "2330": {
      ultimo: { title: "🍸 Dernier verre", text: "Un dernier verre si tu veux." },
      silenzio: { title: "🌌 Silence", text: "Les ruelles se vident." },
      dormire: { title: "😴 Dormir", text: "Bonne nuit." }
    }
  },

  es: {
    "11": {
      passeggiata: { title: "☀️ Paseo lento", text: "La mañana en Trastevere es especial.\nTodo empieza despacio." },
      caffe: { title: "☕ Café", text: "Un café tranquilo.\nSin prisa." },
      rientro: { title: "🏠 Volver", text: "Descanso breve.\nEl barrio espera." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitivo", text: "Hora perfecta para parar.\nUna copa basta." },
      piazza: { title: "⛲ Plaza", text: "Siéntate.\nObserva." },
      rientro: { title: "🏠 Descanso", text: "Pausa antes de la noche." }
    },
    "2030": {
      cena: { title: "🍽️ Cena", text: "Cocina romana sencilla.\nSin estrés." },
      passeggiata: { title: "🌙 Paseo", text: "Hacia el río.\nLuces nocturnas." },
      rientro: { title: "🏠 Noche tranquila", text: "Descansa.\nMañana sigue." }
    },
    "2330": {
      ultimo: { title: "🍸 Última copa", text: "Si te apetece, una más." },
      silenzio: { title: "🌌 Silencio", text: "Todo se calma." },
      dormire: { title: "😴 Dormir", text: "Buenas noches." }
    }
  },

  de: {
    "11": {
      passeggiata: { title: "☀️ Ruhiger Spaziergang", text: "Der Morgen in Trastevere ist besonders.\nAlles beginnt langsam." },
      caffe: { title: "☕ Kaffee", text: "Einfach sitzen.\nOhne Eile." },
      rientro: { title: "🏠 Zurück", text: "Kurze Pause.\nDas Viertel wartet." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitif", text: "Zeit für eine Pause.\nEin Glas genügt." },
      piazza: { title: "⛲ Platz", text: "Setz dich.\nBeobachte." },
      rientro: { title: "🏠 Pause", text: "Ruhe vor dem Abend." }
    },
    "2030": {
      cena: { title: "🍽️ Abendessen", text: "Ehrliche römische Küche.\nGanz entspannt." },
      passeggiata: { title: "🌙 Spaziergang", text: "Richtung Fluss.\nAbendlicht." },
      rientro: { title: "🏠 Ruhiger Abend", text: "Erholung.\nMorgen geht es weiter." }
    },
    "2330": {
      ultimo: { title: "🍸 Letztes Glas", text: "Wenn du willst, noch eins." },
      silenzio: { title: "🌌 Stille", text: "Alles wird ruhig." },
      dormire: { title: "😴 Schlafen", text: "Gute Nacht." }
    }
  }
};
// ========================================================================
// VIALE TRASTEVERE LIVE — VIALE TRASTEVERE 108
// TEMPLATE DEFINITIVO
// ========================================================================

const VIALE_TRASTEVERE_RESPONSES = {
  it: {
    "11": {
      passeggiata: {
        title: "☀️ Passeggiata mattutina",
        text: "La mattina qui è autentica.\nCammina verso Porta Portese o lungo il viale.\nRoma si muove lentamente, senza turisti."
      },
      mercato: {
        title: "🛍️ Mercato e botteghe",
        text: "Se è domenica, Porta Portese è a due passi.\nAltrimenti esplora le botteghe storiche della zona.\nÈ la Roma vera."
      },
      rientro: {
        title: "🏠 Rientro tranquillo",
        text: "Se preferisci, rientra.\nSistema le tue cose, una pausa breve.\nIl quartiere ti aspetta."
      },
    
      caffe: {
        title: "☕ Caffè a Trastevere",
        text: "Fermati per un caffè.\nUn tavolino, la luce del mattino.\nTrastevere si sveglia lentamente."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo locale",
        text: "È l’ora giusta per fermarsi.\nUn drink tra San Francesco a Ripa e dintorni.\nAtmosfera rilassata."
      },
      sedersi: {
        title: "🪑 Sedersi e osservare",
        text: "Siediti lungo il viale.\nGente che passa, tram che scorrono.\nTrastevere cambia ritmo."
      },
      rientro: {
        title: "🏠 Pausa breve",
        text: "Se sei stanco, rientra.\nDoccia e silenzio.\nLa sera arriva piano."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Cena senza stress",
        text: "È il momento di mangiare.\nCucina romana e piatti laziali.\nSenza formalità."
      },
      passeggiata: {
        title: "🌙 Passeggiata serale",
        text: "Cammina verso Piazza Mastai o il Tevere.\nLuci morbide, meno folla.\nRoma di sera è qui."
      },
      rientro: {
        title: "🏠 Serata calma",
        text: "Se la giornata è stata lunga, rientra.\nCena leggera o delivery.\nDomani continua."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Ultimo bicchiere",
        text: "Se ti va ancora qualcosa, un ultimo drink.\nAtmosfera tranquilla.\nPoi rientro."
      },
      silenzio: {
        title: "🌌 Silenzio",
        text: "Il viale rallenta.\nRestano luci e passi lontani.\nÈ il momento di fermarsi."
      },
      dormire: {
        title: "😴 Riposo",
        text: "Chiudi la giornata.\nRiposa bene.\nRoma domani è ancora qui."
      }
    }
  },

  en: {
    "11": {
      passeggiata: {
        title: "☀️ Morning walk",
        text: "Morning here feels real.\nWalk toward Porta Portese or along the avenue.\nRome moves slowly."
      },
      mercato: {
        title: "🛍️ Market & shops",
        text: "If it’s Sunday, Porta Portese is nearby.\nOtherwise explore local shops.\nThis is real Rome."
      },
      rientro: {
        title: "🏠 Short rest",
        text: "If you prefer, go back.\nUnpack and rest a bit.\nThe area will wait."
      },
    
      caffe: {
        title: "☕ Coffee in Trastevere",
        text: "Stop for a coffee.\nA small table, morning light.\nTrastevere wakes up slowly."
      }
    },
    "18": {
      aperitivo: {
        title: "🍷 Aperitivo time",
        text: "Perfect moment to stop.\nA relaxed drink nearby.\nEasy atmosphere."
      },
      sedersi: {
        title: "🪑 Sit and watch",
        text: "Sit along the avenue.\nPeople, trams, city life.\nTrastevere shifts."
      },
      rientro: {
        title: "🏠 Short break",
        text: "If tired, go back.\nShower and quiet.\nEvening comes gently."
      }
    },
    "2030": {
      cena: {
        title: "🍽️ Dinner",
        text: "Dinner time.\nRoman food, relaxed places.\nNo rush."
      },
      passeggiata: {
        title: "🌙 Evening walk",
        text: "Walk toward the river.\nSoft lights, fewer crowds."
      },
      rientro: {
        title: "🏠 Quiet night",
        text: "If the day was long, stay in.\nTomorrow awaits."
      }
    },
    "2330": {
      ultimo: {
        title: "🍸 Last drink",
        text: "If you feel like it, one last drink.\nThen head back."
      },
      silenzio: {
        title: "🌌 Silence",
        text: "The avenue slows down.\nTime to stop."
      },
      dormire: {
        title: "😴 Sleep",
        text: "End the day.\nRest well."
      }
    }
  },

  fr: {
    "11": {
      passeggiata: { title: "☀️ Promenade", text: "Le matin ici est authentique.\nRome avance doucement." },
      mercato: { title: "🛍️ Marché", text: "Porta Portese si tout près.\nSinon, boutiques locales." },
      rientro: { title: "🏠 Retour", text: "Rentre si tu veux.\nLe quartier attend." },
    
      caffe: { title: "☕ Café", text: "Un café simple.\nTrastevere s'éveille doucement." }
    },
    "18": {
      aperitivo: { title: "🍷 Apéritif", text: "Moment idéal pour s’arrêter.\nAmbiance détendue." },
      sedersi: { title: "🪑 Observer", text: "Assieds-toi.\nLa ville passe." },
      rientro: { title: "🏠 Pause", text: "Un peu de repos avant la soirée." }
    },
    "2030": {
      cena: { title: "🍽️ Dîner", text: "Cuisine romaine simple.\nSans hâte." },
      passeggiata: { title: "🌙 Promenade", text: "Vers le Tibre.\nLumières du soir." },
      rientro: { title: "🏠 Soirée calme", text: "Repos.\nDemain continue." }
    },
    "2330": {
      ultimo: { title: "🍸 Dernier verre", text: "Un dernier verre si tu veux." },
      silenzio: { title: "🌌 Silence", text: "Tout ralentit." },
      dormire: { title: "😴 Dormir", text: "Bonne nuit." }
    }
  },

  es: {
    "11": {
      passeggiata: { title: "☀️ Paseo", text: "La mañana aquí es real.\nRoma va despacio." },
      mercato: { title: "🛍️ Mercado", text: "Porta Portese cerca.\nTiendas locales." },
      rientro: { title: "🏠 Volver", text: "Descanso breve.\nEl barrio espera." },
    
      caffe: { title: "☕ Café", text: "Un café tranquilo.\nTrastevere despierta despacio." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitivo", text: "Momento perfecto para parar." },
      sedersi: { title: "🪑 Sentarse", text: "Observa la ciudad." },
      rientro: { title: "🏠 Descanso", text: "Pausa antes de la noche." }
    },
    "2030": {
      cena: { title: "🍽️ Cena", text: "Cocina romana sencilla." },
      passeggiata: { title: "🌙 Paseo", text: "Hacia el río." },
      rientro: { title: "🏠 Noche tranquila", text: "Descansa.\nMañana sigue." }
    },
    "2330": {
      ultimo: { title: "🍸 Última copa", text: "Si te apetece, una más." },
      silenzio: { title: "🌌 Silencio", text: "Todo se calma." },
      dormire: { title: "😴 Dormir", text: "Buenas noches." }
    }
  },

  de: {
    "11": {
      passeggiata: { title: "☀️ Spaziergang", text: "Der Morgen hier ist echt.\nRom bewegt sich langsam." },
      mercato: { title: "🛍️ Markt", text: "Porta Portese in der Nähe.\nLokale Geschäfte." },
      rientro: { title: "🏠 Zurück", text: "Kurze Pause.\nDas Viertel wartet." },
    
      caffe: { title: "☕ Kaffee", text: "Einfach sitzen.\nTrastevere erwacht langsam." }
    },
    "18": {
      aperitivo: { title: "🍷 Aperitif", text: "Zeit für eine Pause." },
      sedersi: { title: "🪑 Beobachten", text: "Stadtleben beobachten." },
      rientro: { title: "🏠 Pause", text: "Ruhe vor dem Abend." }
    },
    "2030": {
      cena: { title: "🍽️ Abendessen", text: "Einfache römische Küche." },
      passeggiata: { title: "🌙 Spaziergang", text: "Richtung Fluss." },
      rientro: { title: "🏠 Ruhiger Abend", text: "Erholung.\nMorgen weiter." }
    },
    "2330": {
      ultimo: { title: "🍸 Letztes Glas", text: "Wenn du willst, noch eins." },
      silenzio: { title: "🌌 Stille", text: "Alles wird ruhig." },
      dormire: { title: "😴 Schlafen", text: "Gute Nacht." }
    }
  }
};
// ========================================================================
// VIALE TRASTEVERE LIVE — API
// ========================================================================

app.get("/viale-trastevere", (req, res) => {
  const { slot, choice } = req.query;

   const supported = ["it","en","fr","es","de"];
const l = supported.includes(req.query.lang) ? req.query.lang : "en";


  const data =
    VIALE_TRASTEVERE_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) {
    return res.status(404).send("Not available");
  }

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Viale Trastevere Live</title>
<style>
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  background: #f6f6f6;
  margin: 0;
}
.wrap {
  max-width: 680px;
  margin: auto;
  padding: 24px;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 28px;
}
h1 {
  font-size: 22px;
  margin-top: 0;
}
p {
  line-height: 1.6;
  white-space: pre-line;
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${data.title}</h1>
      <p>${data.text}</p>
    </div>
  </div>
</body>
</html>
`);
});
// ========================================================================
// VIA DELLA SCALA LIVE — API
// ========================================================================

app.get("/scala", (req, res) => {
  const { slot, choice } = req.query;

   const supported = ["it","en","fr","es","de"];
const l = supported.includes(req.query.lang) ? req.query.lang : "en";


  const data =
    SCALA_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) {
    return res.status(404).send("Not available");
  }

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trastevere Live</title>
<style>
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  background: #f6f6f6;
  margin: 0;
}
.wrap {
  max-width: 680px;
  margin: auto;
  padding: 24px;
}
.card {
  background: #fff;
  border-radius: 16px;
  padding: 28px;
}
h1 {
  font-size: 22px;
  margin-top: 0;
}
p {
  line-height: 1.6;
  white-space: pre-line;
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${data.title}</h1>
      <p>${data.text}</p>
    </div>
  </div>
</body>
</html>
`);
});
// ========================================================================
// PORTICO LIVE — ROUTE (IDENTICA A /monti)
// ========================================================================

app.get("/portico", (req, res) => {
  const { slot, choice } = req.query;

  // lingua automatica dal browser
   const supported = ["it","en","fr","es","de"];
const l = supported.includes(req.query.lang) ? req.query.lang : "en";

  const data =
    PORTICO_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) {
    return res.status(404).send("Not available");
  }

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portico Live</title>
<style>
body{font-family:system-ui;background:#f6f6f6;margin:0}
.wrap{max-width:680px;margin:auto;padding:24px}
.card{background:#fff;border-radius:16px;padding:28px}
h1{font-size:22px;margin:0 0 12px}
p{line-height:1.6;white-space:pre-line}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>${data.title}</h1>
    <p>${data.text}</p>
  </div>
</div>
</body>
</html>
  `);
});
 app.get("/monti", (req, res) => {
  const { slot, choice } = req.query;
  const supported = ["it","en","fr","es","de"];
const l = supported.includes(req.query.lang) ? req.query.lang : "en";


  const data = MONTI_RESPONSES?.[l]?.[slot]?.[choice];

  if (!data) return res.status(404).send("Not available");

  res.type("html").send(`
<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Monti Live</title>
<style>
body{font-family:system-ui;background:#f6f6f6;margin:0}
.wrap{max-width:680px;margin:auto;padding:24px}
.card{background:#fff;border-radius:16px;padding:28px}
h1{font-size:22px}
p{line-height:1.6;white-space:pre-line}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
<h1>${data.title}</h1>
<p>${data.text}</p>
</div>
</div>
</body>
</html>
`);
});
app.use(express.static(PUBLIC_DIR));


const GUIDE_AI_EXTRA = `

ROME RESTAURANT DATABASE — use this data when guests ask about food:

KOSHER:
- Ba'Ghetto | Via del Portico d'Ottavia 2 | +39 06 6889 2868 | Mon–Thu 12:30–15 & 19–23, Fri 12:30–15, Sun 12:30–15 & 19–23 | €35–55 | Roman-Jewish classics: carciofi alla giudia, fiori di zucca, baccalà
- Nonna Betta | Via del Portico d'Ottavia 16 | +39 06 6880 6263 | Mon–Thu & Sun 12–15 & 19–23 | €25–45 | Traditional kosher, Roman Jewish recipes since 1989
- Zi Fenizia | Via Santa Maria del Pianto 64 | +39 06 689 6976 | Mon–Fri 9–20, Sat 9–16 | €10–20 | Kosher bakery and street food, supplì and pizza al taglio
- Il Giardino Romano | Via del Portico d'Ottavia 18 | +39 06 6813 4590 | Tue–Sun 12–15 & 19–23 | €30–50 | Kosher meat restaurant

INDIAN:
- Maharajah | Via dei Serpenti 124, Monti | +39 06 474 7144 | Daily 12–15 & 19–23 | €20–35 | One of Rome's best Indian, excellent thali and tandoori
- Guru | Via della Croce 81, Spanish Steps area | +39 06 678 4554 | Daily 12–15 & 19–23 | €25–40 | North Indian cuisine, popular with locals
- Himalaya's Kashmir | Via Principe Amedeo 26, near Termini | +39 06 446 1539 | Daily 12–15 & 19–23 | €15–30 | Nepalese and Indian, great value

VEGETARIAN/VEGAN:
- Ops! | Via Ferruccio 1 | +39 06 4547 6235 | Tue–Sun 12:30–15 & 19:30–23 | €20–35 | Creative vegetarian, great natural wines
- Il Canestro | Via Luca della Robbia 47, Testaccio | +39 06 574 1374 | Mon–Sat 12–15 & 19–22:30 | €15–25 | Organic vegetarian restaurant
- Rifugio Romano | Via della Cordonata 6 | daily | €10–20 | Vegan street food near Piazza Venezia

PIZZA (best in Rome):
- Seu Pizza Illuminati | Via Angelo Bargoni 10, Trastevere | +39 06 588 2428 | Wed–Mon 19–23 | €12–20 | Best contemporary pizza in Rome
- Pizzarium | Via della Meloria 43, Prati | +39 06 3974 5416 | Mon–Sat 10–22 | €5–15 | Bonci's legendary pizza al taglio
- Da Remo | Piazza Santa Maria Liberatrice 44, Testaccio | +39 06 574 6270 | Mon–Sat 19–23 | €10–18 | Roman-style thin crust, queues outside are normal

ALWAYS format your answer: Name | Address | Phone | Hours | Price | Description. Minimum 3 places per answer. Never give generic answers without specific names and addresses.`;

app.post("/api/ai/guide", cors(), async (req, res) => {
  try {
    const { message, systemPrompt, history } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "missing message" });
    const enrichedPrompt = (systemPrompt || "You are a helpful Rome apartment concierge. Answer in the same language the user writes in.") + GUIDE_AI_EXTRA;
    const reply = await askGeminiGuide({
      message,
      systemPrompt: enrichedPrompt,
      history: Array.isArray(history) ? history : []
    });
    res.json({ ok: true, reply: reply || null });
  } catch (e) {
    console.error("❌ /api/ai/guide:", e.message);
    res.status(500).json({ ok: false, error: "AI error" });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    uptime: process.uptime(),
    baseUrl: SHELLY_BASE_URL,
    tokenVersion: TOKEN_VERSION,
    rotationTag: ROTATION_TAG,
    linkPrefix: LINK_PREFIX,
    startedAt: STARTED_AT,
    revokeBefore: REVOKE_BEFORE
  });
});
  
const MAILER_URL = process.env.MAILER_URL || "https://script.google.com/macros/s/XXXXXXX/exec";
const MAIL_SHARED_SECRET = process.env.MAIL_SHARED_SECRET;

if (!MAIL_SHARED_SECRET) {
  console.error("â Missing MAIL_SHARED_SECRET env var");
  process.exit(1);
}

app.post("/hostaway-outbound", requireAdmin, async (req, res) => {
  try {
    const { reservationId, guestEmail, guestName, message } = req.body || {};
    if (!guestEmail || !message) {
      console.log("â Dati insufficienti per invio email:", req.body);
      return res.status(400).json({ ok: false, error: "missing_email_or_message" });
    }
    const subject = `Messaggio da NiceFlatInRome`;
    const htmlBody = `<p>Ciao ${guestName || "ospite"},</p><p>${message.replace(/\n/g, "<br>")}</p><p>Un saluto da Michele e dal team NiceFlatInRome.</p>`;
    const mailResponse = await axios.post(`${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
      { to: guestEmail, subject, htmlBody },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 });
    if (String(mailResponse.data).trim() === "ok") {
      console.log(`ð¤ Email inviata con successo a ${guestEmail}`);
      return res.json({ ok: true });
    } else {
      console.error("â Errore dal mailer:", mailResponse.data);
      return res.status(502).json({ ok: false, error: "mailer_failed" });
    }
  } catch (err) {
    console.error("Errore invio email:", err.message);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});
   app.post('/allegria-info', async (req, res) => {
  try {
    const email = req.body?.email;
    if (!email) return res.status(400).send('Email mancante');
    try {
      await axios.post(
        "https://script.google.com/macros/s/AKfycbzsuNiIXjdnWMuRocDkpqCU4c-4sUlwVMplebibQGaPFMIVF0sE41QKjsldlMVthH-CbA/exec",
        { email: email, source: "Landing Allegria" },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 }
      );
      console.log("Lead salvato:", email);
    } catch (err) {
      console.error("Errore Google Sheet:", err.message);
    }
      const htmlBody = `
<p>Grazie per aver richiesto informazioni sul servizio <strong>Allegria</strong>.</p>
<p>Allegria offre presenza e compagnia a domicilio per persone anziane autosufficienti.</p>
<p>Per velocizzare la call, compila prima questo breve questionario (2 minuti):</p>
<p>
<a href="https://docs.google.com/forms/d/e/1FAIpQLSeCW1NSxx0UyypaxrY9hQvo2ISs2S7sHfIhB-DjvGGdIiHTBQ/viewform"
style="background:#8b6a4f;color:white;padding:12px 18px;border-radius:6px;text-decoration:none;">
Compila il questionario preliminare
</a>
</p>
<p>Poi prenota la call conoscitiva:</p>
<p>
<a href="https://script.google.com/macros/s/AKfycbw4-s3ZMVBxbNgqfs4vbpBxBaDpiOfK9s-AAxyFtSuKX5gl1gsufhOa5JqV-1b3fn7PTg/exec?page=prenota-cliente&email=${encodeURIComponent(email)}"
style="background:#8b6a4f;color:white;padding:12px 18px;border-radius:6px;text-decoration:none;">
Prenota la call conoscitiva
</a>
</p>
<p>Oppure puoi leggere prima i dettagli del servizio:</p>
<p>
<a href="https://www.vitasemper.com/allegria/info.html">
Scopri il servizio Allegria
</a>
</p>
<p>Un caro saluto<br>
Michele<br>
Vita Semper S.r.l.</p>
`;
    await axios.post(
      `${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
      { to: email, subject: 'Informazioni allegria/info', htmlBody },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    res.send(`<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allegria</title>
<style>body{font-family:Georgia,serif;background:#f6f3ee;color:#2f2f2f;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
.box{text-align:center;padding:40px;} .btn{display:inline-block;margin-top:24px;padding:14px 28px;background:#8b6a4f;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;}.back{display:inline-block;padding:14px 28px;background:#8b6a4f;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;}</style>
</head>
<body>
<div class="box">
  <h2>Grazie!</h2>
  <p>Ti abbiamo inviato le informazioni su Allegria.</p>
  <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-top:40px;">
   <a href="/allegria/" class="btn">Torna alla pagina</a>
</div>
</div>
</body>
</html>`);

  } catch (err) {
    console.error('Errore allegria-info:', err.message);
    res.status(500).send('Errore');
  }
});


app.post("/api/vbro-mail", requireAdmin, async (req, resInner) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to || !subject || !body) return resInner.status(400).json({ ok: false, error: "missing_fields" });
    const mailResp = await axios.post(`${MAILER_URL}?secret=${encodeURIComponent(MAIL_SHARED_SECRET)}`,
      { to, subject, htmlBody: body },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 });
    console.log("ð¨ Email VRBO inviata con successo", mailResp.status);
    return resInner.json({ ok: true });
  } catch (err) {
    console.error("â Errore invio mail:", err);
    return resInner.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
 // ========================================================================
// HostAway â AI Guest Assistant (chat reply)
// ========================================================================

 // ========================================================================
// HostAway Incoming Webhook â UPDATED WITH NEW MATCHER
// ========================================================================

const APT_DEFAULT_LANG = {
  arenula: "en",
  leonina: "en",
  scala: "en",
  portico: "en",
  trastevere: "en"
};

function normalizeLang(lang) {
  if (!lang || typeof lang !== "string") return null;
  return lang.slice(0, 2).toLowerCase();
}

// Dedup cache: evita doppia risposta se Hostaway fa retry del webhook
const _webhookSeen = new Map();
function _webhookDedup(id) {
  if (!id) return false;
  const now = Date.now();
  if (_webhookSeen.has(id)) { if (now - _webhookSeen.get(id) < 5 * 60 * 1000) return true; }
  _webhookSeen.set(id, now);
  if (_webhookSeen.size > 500) { for (const [k, t] of _webhookSeen) { if (now - t > 10 * 60 * 1000) _webhookSeen.delete(k); } }
  return false;
}

app.post("/hostaway-incoming", async (req, res) => {
  console.log("\n" + "=".repeat(60));
  console.log("ð© HOSTAWAY WEBHOOK RECEIVED");
  console.log("=".repeat(60));
  console.log("ð¦ Request Body:", JSON.stringify(req.body, null, 2));
  console.log("=".repeat(60) + "\n");

  try {
    const payload = req.body;

// Dedup: ignora webhook duplicato (Hostaway retry)
const _whMsgId = payload?.id || payload?.messageId;
if (_webhookDedup(_whMsgId)) {
  console.log("🔁 Webhook duplicato ignorato:", _whMsgId);
  return res.json({ ok: true, silent: true, reason: "duplicate" });
}

// ── Intercept reservation updates to refresh arrivalTime cache ───────────────
// Hostaway sends action=updated (or guestCheckin) when guest fills the online
// check-in form and enters their arrival time.
{
  const whAction = payload?.action || payload?.event || payload?.type || '';
  const isResUpdate = /updated|modified|checkin|pre.?check/i.test(String(whAction));
  const whResId = payload?.reservationId || payload?.id;
  if (isResUpdate && whResId) {
    const rawTime = payload?.arrivalTime || payload?.data?.arrivalTime || null;
    if (rawTime) {
      const parsed = parseArrivalTime(typeof rawTime === 'number' ? `${rawTime}:00` : rawTime);
      if (parsed) {
        GUEST_ARRIVAL_TIMES.set(String(whResId), { time: parsed, fetchedAt: Date.now() });
        console.log(`⏰ ArrivalTime updated via webhook for res ${whResId}: ${parsed}`);
      }
    } else {
      // arrivalTime not in payload → invalidate cache so next phase-check fetches fresh data
      GUEST_ARRIVAL_TIMES.delete(String(whResId));
      console.log(`🔄 ArrivalTime cache invalidated for res ${whResId} (will re-fetch)`);
    }
  }
  // ── Se l'evento è specificamente un checkin/pre-check, trigghera Phase 2+3 ──
  const isCheckinEvent = /^(checkin|pre.?check|guestcheckin|reservation\.checkin|pre_checkin)$/i.test(String(whAction));
  if (isCheckinEvent && whResId) {
    console.log(`🔔 Checkin event detected (action=${whAction}) → triggering Phase 2+3 for res ${whResId}`);
    (async () => {
      try {
        if (PENDING_PHASE3.has(`phase3-${whResId}`)) {
          console.log(`⏭️ Phase 3 already pending for res ${whResId} — skipping duplicate Phase 2`);
          return;
        }
        const resResp = await axios.get(`https://api.hostaway.com/v1/reservations/${whResId}`, { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 });
        const resData = resResp.data?.result;
        if (!resData) { console.log(`⚠️ No reservation data for res ${whResId}`); return; }
        const apt = APT_LISTING_MAP[resData.listingMapId] || 'rome';
        const arrivalTime = resData.arrivalTime || null;
        const arrivalDate = resData.arrivalDate || resData.checkInDate || null;
        const checkoutDate = resData.departureDate || resData.checkOutDate || null;
        const langRaw = (resData.guestLanguage || resData.guestLocale || 'en').toLowerCase();
        const langMap = { spanish:'es', french:'fr', italian:'it', german:'de', english:'en', deutsch:'de', italiano:'it' };
        const guestLang = langMap[langRaw.split(',')[0].trim()] || langRaw.slice(0, 2) || 'en';
        const safeLang = ['en','it','fr','de','es'].includes(guestLang) ? guestLang : 'en';
        const cid = await getConversationId(whResId);
        if (!cid) { console.log(`⚠️ No conversationId found for res ${whResId} — Phase 2 skipped`); return; }
        await sendPhase2GuideMessage({ conversationId: cid, apartment: apt, lang: safeLang, reservationId: String(whResId), checkoutDate });
        // Schedule Phase 3
        let sendAt;
        if (arrivalTime && arrivalDate) {
          const parts = arrivalTime.replace(/[apm]/gi, '').trim().split(':').map(Number);
          const h = parts[0] || 13; const m = parts[1] || 0;
          const candidate = new Date(`${arrivalDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+02:00`);
          candidate.setMinutes(candidate.getMinutes() + 2);
          sendAt = candidate;
        } else if (arrivalDate) { sendAt = new Date(`${arrivalDate}T13:02:00+02:00`);
        } else { sendAt = new Date(Date.now() + 2 * 60 * 1000); }
        if (arrivalDate) { const minTime = new Date(`${arrivalDate}T13:02:00+02:00`); if (sendAt < minTime) sendAt = minTime; }
        if (sendAt <= new Date()) sendAt = new Date(Date.now() + 2 * 60 * 1000);
        PENDING_PHASE3.set(`phase3-${whResId}`, { conversationId: cid, apartment: apt, lang: safeLang, sendAt, checkinDate: arrivalDate, sent: false });
        savePhase3State();
        console.log(`📅 Phase 2 sent + Phase 3 scheduled via checkin event: ${apt} | res:${whResId} | sendAt:${sendAt.toISOString()}`);
      } catch (e) { console.error(`❌ Phase 2/3 via checkin event failed for res ${whResId}:`, e.message); }
    })();
  }
  // Invalidate tablet cache for this apartment so next /tablet/:apt gets fresh data
  const whListingId = payload?.listingMapId || payload?.data?.listingMapId;
  if (whListingId) {
    const whApt = APT_LISTING_MAP[whListingId];
    if (whApt) { TABLET_CACHE.delete(whApt); console.log(`🔄 TabletCache invalidated for ${whApt}`); }
  } else {
    // No listing ID in payload — clear all tablet caches to be safe
    TABLET_CACHE.clear();
    console.log(`🔄 TabletCache cleared (no listingId in webhook payload)`);
  }
}

// ✅ IGNORA messaggi in uscita (evita loop e __INTERNAL_AI__ in chat)
 // ✅ IGNORA SOLO i messaggi OUTGOING (evita loop), NON quelli incoming
const isIncoming = payload?.isIncoming;
const sentUsingHostaway = payload?.sentUsingHostaway;
const status = payload?.status;

// ECCEZIONE: messaggi di sistema HostAway per form submission sono outgoing ma vanno processati
const _msgBodyLower = (payload?.body || '').toLowerCase();
const _isFormSubmission = _msgBodyLower.includes('submitted') && (_msgBodyLower.includes('check') || _msgBodyLower.includes('pre-check'));

 if ((isIncoming === 0 || isIncoming === false || sentUsingHostaway === 1) && !_isFormSubmission) {
  console.log("🛑 Outgoing message -> ignored", { status, isIncoming, sentUsingHostaway });
  return res.json({ ok: true, silent: true });
}
if (_isFormSubmission && (isIncoming === 0 || isIncoming === false || sentUsingHostaway === 1)) {
  console.log("✅ Form submission system message detected — bypassing outgoing filter");
}


const message = payload.body;
if (message && message.includes("shelly-cloud-opener-1.onrender.com")) {
  console.log("🛑 Slot message echo → ignored");
  return res.json({ ok: true, silent: true });
}

// ✅ IGNORA eco interno (se mai arriva come body)
if (message?.trim?.() === "__INTERNAL_AI__") {
  console.log("🛑 Echo INTERNAL_AI → ignored");
  return res.json({ ok: true, silent: true });
}

const guestName = payload.guestName;
const reservationId = payload.reservationId;
const conversationId = payload.conversationId;
const listingId = payload.listingMapId;
const guestLanguage = payload.guestLanguage;

 // STEP 1.5 — Resolve apartment EARLY (prima di matcher / Gemini)
const apartment = (() => {
  switch (listingId) {
    case 194164: return "trastevere";
    case 194165: return "portico";
    case 194166: return "arenula";
    case 194162: return "scala";
    case 194163: return "leonina";
    default: return "rome";
  }
})();
   // PATCH: recupera reservationId dalla chat se manca
let effectiveReservationId = reservationId;

if (!effectiveReservationId && conversationId) {
  console.log("🧩 ReservationId mancante, provo da conversationId:", conversationId);

  try {
    const r = await fetch(
      `https://api.hostaway.com/v1/conversations/${conversationId}`,
      {
        headers: {
         Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await r.json();
    effectiveReservationId = data?.result?.reservationId;

    console.log("🧩 ReservationId risolto:", effectiveReservationId);
  } catch (err) {
    console.error("❌ Errore fetch conversation → reservation", err);
  }
}
// ===============================
// PATCH — ARRIVAL TIME VIA GUEST MESSAGE
// ===============================
if (effectiveReservationId && conversationId) {
  try {
     const r = await axios.get(
  `https://api.hostaway.com/v1/reservations/${effectiveReservationId}`,
  {
    headers: {
      Authorization: `Bearer ${HOSTAWAY_TOKEN}`
    },
    timeout: 10000
  }
);

    const reservation = r.data?.result;
    const arrivalTime =
      reservation?.arrivalTime ||
      reservation?.checkinTime ||
      reservation?.customFields?.arrival_time ||
      null;

    if (arrivalTime) {
      const slots = decideSlots(arrivalTime);

      console.log("🧩 ARRIVAL TIME (via guest message):", arrivalTime);
      console.log("🧩 SLOT CALCOLATI:", slots);

   const checkInDate = reservation?.arrivalDate || reservation?.checkInDate;
const guestLang = (reservation?.guestLanguage || "en").slice(0, 2).toLowerCase();

 

    } else {
      console.log("⚠️ Arrival time non presente nella reservation");
    }
  } catch (e) {
    console.error("❌ Errore fetch reservation (guest message):", e.message);
  }
}
    // ======================================================
    // ð Resolve Listing ID from reservation (HostAway)
    // ======================================================
    let resolvedListingId = listingId;

    if (!resolvedListingId && reservationId) {
      try {
        console.log("ð Fetching reservation from HostAway:", reservationId);

         const r = await axios.get(
  `https://api.hostaway.com/v1/reservations/${effectiveReservationId}`,
  {
    headers: {
      Authorization: `Bearer ${HOSTAWAY_TOKEN}`
    },
    timeout: 10000
  }
);

        console.log("ð FULL API Response:", JSON.stringify(r.data, null, 2));

        resolvedListingId = r.data?.result?.listingId;
        console.log("ð  ListingId resolved from reservation:", resolvedListingId);
      } catch (e) {
        console.error("â Failed to resolve listingId from reservation", e.message);
      }
    }

    req.body = req.body?.data ?? req.body;

    console.log("📋 STEP 1: Extract Data");
    console.log("  ââ message:", message);
    console.log("  ââ conversationId:", conversationId);
    console.log("  ââ guestName:", guestName);
    console.log("  ââ reservationId:", reservationId);

    if (!message || !conversationId) {
      console.log("â ï¸ Missing required fields â SILENT");
      return res.json({ ok: true, silent: true });
    }

    // ======================================================
    // CHECK-IN FORM SUBMITTED -> schedule phase=3 guide
    // ======================================================
    if (message.toLowerCase().includes('submitted') && message.toLowerCase().includes('check')) {
      console.log('CHECK-IN FORM SUBMITTED detected for reservation:', effectiveReservationId);
      res.json({ ok: true, silent: true });

      try {
        const resResp = await axios.get(
          `https://api.hostaway.com/v1/reservations/${effectiveReservationId}`,
          { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
        );
        const resData = resResp.data?.result;
        const arrivalTime = resData?.arrivalTime || null;
        const arrivalDate = resData?.arrivalDate || resData?.checkInDate || null;
        const checkoutDate = resData?.departureDate || resData?.checkOutDate || resData?.checkoutDate || null;
        const langRaw = (resData?.guestLanguage || resData?.guestLocale || 'en').toLowerCase();
        const langMap = { spanish:'es', french:'fr', italian:'it', german:'de', english:'en', deutsch:'de', italiano:'it' };
        const guestLang = langMap[langRaw.split(',')[0].trim()] || langRaw.slice(0,2) || 'en';

        const now = new Date();
        let sendAt;

        if (arrivalTime && arrivalDate) {
          // Arrival time specified: schedule at arrivalTime + 2min
          const parts = arrivalTime.replace(/[apm]/gi, '').trim().split(':').map(Number);
          const h = parts[0] || 13;
          const m = parts[1] || 0;
          const candidate = new Date(`${arrivalDate}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+02:00`);
          candidate.setMinutes(candidate.getMinutes() + 2);
          sendAt = candidate;
        } else if (arrivalDate) {
          // No arrival time: default to 13:02 on check-in date
          sendAt = new Date(`${arrivalDate}T13:02:00+02:00`);
        } else {
          // No date at all: 13:02 today (Rome time)
          const todayRome = now.toLocaleString('it-IT', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
          sendAt = new Date(`${todayRome}T13:02:00+02:00`);
        }

        // Enforce minimum: never send before 13:02 (check-in starts at 13:00)
        if (arrivalDate) {
          const minTime = new Date(`${arrivalDate}T13:02:00+02:00`);
          if (sendAt < minTime) sendAt = minTime;
        }

        // If sendAt is already past, send in 2 minutes
        if (sendAt <= now) sendAt = new Date(now.getTime() + 2 * 60 * 1000);

        // Send phase 2 guide immediately
        await sendPhase2GuideMessage({ conversationId, apartment, lang: guestLang, reservationId: effectiveReservationId, checkoutDate });
        console.log(`📅 Guide expiry set to checkout: ${checkoutDate || 'fallback 30d'}`);

        // Schedule phase 3 notification (keys unlock) at check-in time
        const phase3Key = `phase3-${effectiveReservationId}`;
        PENDING_PHASE3.set(phase3Key, { conversationId, apartment, lang: guestLang, sendAt, checkinDate: arrivalDate, sent: false });
        savePhase3State();
        console.log(`Phase 3 scheduled: ${apartment} | sendAt: ${sendAt.toISOString()} | lang: ${guestLang}`);
      } catch (e) {
        console.error('Errore scheduling phase 3:', e.message);
      }
      return;
    }


    // ======================================================
    // ð STEP 2: Check HostAway Token
    // ======================================================
    if (!HOSTAWAY_TOKEN) {
      console.error("â HOSTAWAY_TOKEN is NOT configured!");
      return res.status(500).json({ ok: false });
    }

    console.log("  â Token configured");

   // ======================================================
// 🎯 STEP 3: Match Intent + Language
// ====================================================== 
const match = matchIntent(message); 
console.log("🎯 Matcher result:", match || "NONE");

// Se il matcher ha rilevato una semplice affermazione -> silenzio
if (match?.route === "IGNORE") {
  console.log("🔇 Affermazione rilevata -> SILENZIO");
  return res.json({ ok: true, silent: true, reason: "statement" });
}

const detectedLang = detectLanguage(message);
console.log("🌍 Lingua rilevata:", detectedLang);
const intent = match?.intent || null;

 
    // ======================================================
    // ð  STEP 4: listingId â apartment
    // ======================================================
    const LISTING_TO_APARTMENT = {
      "194166": "arenula",
      "194165": "portico",
      "194163": "leonina",
      "194164": "trastevere",
      "194162": "scala"
    };

    console.log("  ââ listingId ricevuto:", resolvedListingId);

     

    if (!apartment) {
      console.error("â ListingId non mappato:", resolvedListingId);
      return res.json({ ok: true, silent: true });
    }

    console.log("  ââ Appartamento:", apartment);

    // ======================================================
    // ð STEP 5: Language selection (3-LEVEL CASCADE)
    // ======================================================
    const platformLang = normalizeLang(guestLanguage);
    const defaultLang = APT_DEFAULT_LANG[apartment] || "en";

    let answer = null;
    let usedLang = null;

    // LEVEL 1 â Lingua rilevata dal messaggio
    if (
      detectedLang &&
      ANSWERS[apartment]?.[detectedLang]?.[intent]
    ) {
      answer = ANSWERS[apartment][detectedLang][intent];
      usedLang = detectedLang;
      console.log("  â Usata lingua del messaggio:", detectedLang);
    }

    // LEVEL 2 â Lingua da HostAway
    else if (
      platformLang &&
      ANSWERS[apartment]?.[platformLang]?.[intent]
    ) {
      answer = ANSWERS[apartment][platformLang][intent];
      usedLang = platformLang;
      console.log("  â Usata lingua piattaforma:", platformLang);
    }

    // LEVEL 3 â Lingua default appartamento
    else if (
      ANSWERS[apartment]?.[defaultLang]?.[intent]
    ) {
      answer = ANSWERS[apartment][defaultLang][intent];
      usedLang = defaultLang;
      console.log("  â Usata lingua default:", defaultLang);
    }
// ⛔ BLOCCO SENTINELLA: evita __INTERNAL_AI__
if (answer === "__INTERNAL_AI__") {
  console.log("⛔ INTERNAL_AI intercettato → annullato");
  answer = null;
}
   // ======================================================
// 🤖 FALLBACK GEMINI — domande turistiche + ringraziamenti
// ======================================================
if (!answer) {
  // Controlla se è una DOMANDA
  const isQuestion = /\?|where|what|when|who|how|why|which|dove|cosa|quando|come|perch[eé]|quale|où|quand|comment|pourquoi|quel|dónde|cuándo|cómo|por qué|cuál|wo|wann|wie|warum|welche/i.test(message);
  
  // Controlla se è un RINGRAZIAMENTO o FEEDBACK
  const isThanks = /thank|thanks|grazie|merci|danke|muchas gracias|appreciate|grateful|wonderful|amazing|perfect|excellent|great|fantastic|loved|enjoyed|beautiful|best/i.test(message);
  
  // Se non è né domanda né ringraziamento → SILENZIO
  if (!isQuestion && !isThanks) {
    console.log("💬 Messaggio casual → SILENZIO (risposta manuale)");
    return res.json({ ok: true, silent: true, reason: "casual_message" });
  }

  console.log("🤖 Domanda o ringraziamento → Gemini fallback");

  try {
    const geminiReply = await askGemini({
      message,
      apartment: LISTING_TO_APARTMENT[listingId] || "rome",
      lang: detectedLang || "en"
    });

    if (!geminiReply) {
      console.log("🤖 Gemini returned empty → silent");
      return res.json({ ok: true, silent: true });
    }

    answer = geminiReply;
    usedLang = detectedLang || platformLang || defaultLang || "en";

    console.log("🤖 Gemini answer ready");
  } catch (e) {
    console.error("❌ Gemini error:", e.message);
    return res.json({ ok: true, silent: true });
  }
}

// 🛟 SAFE FALLBACK — risposta cortese standard
if (!answer) {
  console.log("🛟 SAFE FALLBACK reply used");
  answer = SAFE_FALLBACK_REPLY;
  usedLang = detectedLang || platformLang || defaultLang || "en";
}

console.log("  ✅ Answer found");
console.log("  ─→ Language used:", usedLang);
console.log("  ─→ Preview:", answer.substring(0, 80) + "...");

// ⛔ FINAL GUARD — niente __INTERNAL_AI__ verso Hostaway
if (
  !answer ||
  answer === "__INTERNAL_AI__" ||
  answer.trim() === ""
) {
  console.log("🛑 Final guard: risposta mancante o INTERNAL_AI → SILENT");

  return res.json({
    ok: true,
    silent: true
  });
}

    // ======================================================
    // ð¤ STEP 6: Send Reply to HostAway
    // ======================================================
    await axios.post(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
      {
        body: answer,
        sendToGuest: true
      },
      {
        headers: {
          Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    console.log("â Reply sent successfully");

    return res.json({
      ok: true,
      replied: true,
      intent,
      lang: usedLang
    });

  } catch (err) {
    console.error("â ERROR IN /hostaway-incoming");
    console.error(err.message);
    return res.status(500).json({ ok: false });
  }
});


 // ========================================================================
// INTEGRAZIONI PAGAMENTI - DA AGGIUNGERE AL SERVER.JS
// ========================================================================

// 1) AGGIUNGI QUESTE VARIABILI AMBIENTE ALL'INIZIO (dopo le altre)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const PAYPAL_WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const GOOGLE_SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

if (!STRIPE_WEBHOOK_SECRET) {
  console.error("⚠️ Missing STRIPE_WEBHOOK_SECRET");
}
if (!PAYPAL_WEBHOOK_ID) {
  console.error("⚠️ Missing PAYPAL_WEBHOOK_ID");
}
if (!GOOGLE_SHEETS_WEBHOOK_URL) {
  console.error("⚠️ Missing GOOGLE_SHEETS_WEBHOOK_URL");
}

// ========================================================================
// FUNZIONE SCRITTURA GOOGLE SHEETS
// ========================================================================

async function writeToGoogleSheets(data) {
  try {
    console.log("📊 Invio dati a Google Sheets:", data);
    
    const response = await axios.post(
      GOOGLE_SHEETS_WEBHOOK_URL,
      data,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 15000
      }
    );
    
    console.log("✅ Dati salvati su Sheets");
    return { ok: true, response: response.data };
  } catch (err) {
    console.error("❌ Errore scrittura Sheets:", err.message);
    return { ok: false, error: err.message };
  }
}
// ========================================================================
// INVIO MESSAGGIO REALE A HOSTAWAY (PRODUZIONE)
// ========================================================================

async function sendHostawayMessage({ conversationId, message }) {
  if (!HOSTAWAY_TOKEN) {
    console.error("❌ HOSTAWAY_TOKEN mancante");
    return;
  }

  try {
    await axios.post(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
      {
        body: message,
        sendToGuest: true
      },
      {
        headers: {
          Authorization: `Bearer ${HOSTAWAY_TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    console.log("📨 Messaggio inviato a HostAway");
  } catch (err) {
    console.error("❌ Errore invio HostAway:", err.message);
  }
}

// Nota interna visibile solo all'host (sendToGuest: false)
async function sendHostawayInternalNote({ conversationId, message }) {
  if (!HOSTAWAY_TOKEN || !conversationId) return;
  try {
    await axios.post(
      `https://api.hostaway.com/v1/conversations/${conversationId}/messages`,
      { body: message, isFromHost: 1, sendToGuest: false },
      {
        headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}`, "Content-Type": "application/json" },
        timeout: 10000
      }
    );
    console.log("🔔 Nota interna inviata a HostAway:", conversationId);
  } catch (err) {
    console.error("❌ Errore nota interna HostAway:", err.message);
  }
}
// ========================================================================
// STRIPE WEBHOOK
// ========================================================================

app.post("/stripe-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  
  console.log("\n" + "=".repeat(60));
  console.log("💳 STRIPE WEBHOOK RECEIVED");
  console.log("=".repeat(60));
  
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("❌ Stripe webhook secret non configurato");
    return res.status(500).send("Configuration error");
  }

  let event;
  
  try {
    // Verifica firma Stripe
    const stripe = (await import("stripe")).default(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    console.log("✅ Firma Stripe verificata");
  } catch (err) {
    console.error("❌ Errore verifica firma:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Eventi Stripe da gestire
  if (event.type === "payment_intent.succeeded" ||
      event.type === "charge.succeeded" ||
      event.type === "checkout.session.completed") {

    const paymentData = event.data.object;

    // checkout.session usa amount_total; payment_intent/charge usano amount_received o amount
    const amountRaw = paymentData.amount_total ?? paymentData.amount_received ?? paymentData.amount ?? 0;
    const amountEur = amountRaw / 100;

    // reservation_id messo nei metadata sia sulla session che sul payment_intent
    const reservationId = paymentData.metadata?.reservation_id || "";

    console.log("📝 Tipo evento:", event.type);
    console.log("💰 Importo:", amountEur, (paymentData.currency || "eur").toUpperCase());
    console.log("🔑 Reservation ID:", reservationId || "(non presente)");

    // Estrai dati pagamento
    const rowData = {
      source: "Stripe",
      timestamp: new Date().toISOString(),
      eventType: event.type,
      paymentId: paymentData.id,
      reservationId,
      amount: amountEur,
      currency: (paymentData.currency || "eur").toUpperCase(),
      status: paymentData.status,
      customerEmail: paymentData.receipt_email || paymentData.customer_email ||
                     paymentData.customer_details?.email || "",
      customerName: paymentData.billing_details?.name ||
                    paymentData.customer_details?.name || "",
      description: paymentData.description || "",
      metadata: JSON.stringify(paymentData.metadata || {})
    };
    
    console.log("📊 Dati estratti:", rowData);
    
    // Scrivi su Google Sheets
    await writeToGoogleSheets(rowData);
  }
  
  res.json({ received: true });
});

// ========================================================================
// PAYPAL WEBHOOK
// ========================================================================

app.post("/paypal-webhook", async (req, res) => {
  console.log("\n" + "=".repeat(60));
  console.log("💙 PAYPAL WEBHOOK RECEIVED");
  console.log("=".repeat(60));
  console.log("📦 Body:", JSON.stringify(req.body, null, 2));
  
  if (!PAYPAL_WEBHOOK_ID) {
    console.error("❌ PayPal webhook ID non configurato");
    return res.status(500).send("Configuration error");
  }

  try {
    // Verifica firma PayPal
    const headers = {
      "auth-algo": req.headers["paypal-auth-algo"],
      "cert-url": req.headers["paypal-cert-url"],
      "transmission-id": req.headers["paypal-transmission-id"],
      "transmission-sig": req.headers["paypal-transmission-sig"],
      "transmission-time": req.headers["paypal-transmission-time"]
    };
    
    // Verifica webhook PayPal (richiede SDK PayPal)
    // Per semplicità, procediamo con i dati
    // In produzione aggiungi verifica firma completa
    
    const event = req.body;
    const eventType = event.event_type;
    
    console.log("📝 Tipo evento:", eventType);
    
    // Eventi PayPal da gestire
    if (eventType === "PAYMENT.CAPTURE.COMPLETED" ||
        eventType === "CHECKOUT.ORDER.APPROVED" ||
        eventType === "PAYMENT.SALE.COMPLETED") {
      
      const resource = event.resource;
      const amount = resource.amount || resource.purchase_units?.[0]?.amount;
      const payer = resource.payer || resource.purchase_units?.[0]?.payee;
      
      console.log("💰 Importo:", amount?.value, amount?.currency_code);
      
      const rowData = {
        source: "PayPal",
        timestamp: new Date().toISOString(),
        eventType: eventType,
        paymentId: resource.id,
        status: resource.status,
        customerEmail: payer?.email_address || "",
        customerName: payer?.name?.given_name + " " + payer?.name?.surname || "",
        description: resource.description || "",
        metadata: JSON.stringify({ paypal_event_id: event.id })
      };
      
      console.log("📊 Dati estratti:", rowData);
      
      // Scrivi su Google Sheets
      await writeToGoogleSheets(rowData);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error("❌ Errore PayPal webhook:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

  // ========================================================================
// HOSTAWAY BOOKING WEBHOOK — FIXED & DEPLOY SAFE
// ========================================================================
 app.post("/hostaway-booking-webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
     const data = req.body;

// ── Skip conversationMessage webhooks: hanno body+conversationId ma NON sono booking events
// (quelle vengono inviate anche a /hostaway-incoming e non vanno processate qui)
if (data?.body !== undefined && data?.conversationId !== undefined) {
  console.log("⏭️ ConversationMessage webhook → ignorato da booking-webhook (gestito da /hostaway-incoming)");
  return;
}

// ✅ GESTISCI ENTRAMBE LE STRUTTURE
const reservation = data?.reservation || data?.result || data?.data || data;


console.log("🏠 HOSTAWAY BOOKING:", JSON.stringify(data, null, 2));

// Priorità: data.reservationId > reservation.reservationId > reservation.id (può essere ID messaggio)
const reservationId = data?.reservationId || reservation?.reservationId || reservation?.id;
const effectiveReservationId = reservationId;
let conversationId = reservation?.conversationId || data?.conversationId;

// ✅ ESTRAI LISTING ID da più posizioni possibili
const listingMapId = reservation?.listingMapId || data?.listingMapId || reservation?.listingId;

    
    // ✅ MAPPA A APPARTAMENTO
    const apartment = (() => {
      switch (listingMapId) {
        case 194164: return "trastevere";
        case 194165: return "portico";
        case 194166: return "arenula";
        case 194162: return "scala";
        case 194163: return "leonina";
        default: return null;
      }
    })();

    let arrivalTime = reservation?.arrivalTime;
    if (!arrivalTime && reservation?.checkInTime) {
      arrivalTime = `${reservation.checkInTime}:00`;
    }

    console.log("✅ DATI ESTRATTI:");
    console.log("   reservationId:", effectiveReservationId);
    console.log("   conversationId:", conversationId);
    console.log("   listingMapId:", listingMapId);
    console.log("   apartment:", apartment);
    console.log("   arrivalTime:", arrivalTime);

    if (!effectiveReservationId) {
      console.log("⚠️ ReservationId mancante → ignorato");
      return;
    }

    if (!apartment) {
      console.log("⚠️ Appartamento sconosciuto → ignorato");
      return;
    }

    // Filtra cancellazioni
    if (
      data.event === "reservation_cancelled" ||
      data.event === "reservation_canceled" ||
      reservation.status === "cancelled" ||
      reservation.status === "canceled"
    ) {
      console.log("🗑️ Cancellazione → ignorata");
      return;
    }

     const EVENTI_VALIDI = [
  "reservation_created",
  "reservation_new",
  "booking_event",
  "reservation.created"
];


    const eventoCorrente = data.event || "booking_event";

    if (!EVENTI_VALIDI.includes(eventoCorrente)) {
      console.log("⏭️ Evento ignorato:", eventoCorrente);
      return;
    }

    // Risolvi l'ID Hostaway interno se il webhook ha passato un channel ID Booking.com (>8 cifre)
    let hostawayRid = reservation?.id || effectiveReservationId;
    if (/^\d{9,}$/.test(String(effectiveReservationId))) {
      try {
        const chResp = await axios.get(
          `https://api.hostaway.com/v1/reservations?channelReservationId=${effectiveReservationId}${listingMapId ? '&listingMapId=' + listingMapId : ''}&limit=1`,
          { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
        );
        const chRes = chResp.data?.result?.[0];
        if (chRes?.id) {
          hostawayRid = chRes.id;
          console.log(`🔄 Channel ID ${effectiveReservationId} → Hostaway ID ${hostawayRid}`);
          if (!arrivalTime) arrivalTime = chRes.arrivalTime || (chRes.checkInTime ? `${chRes.checkInTime}:00` : null);
        }
      } catch (e) {
        console.error("❌ Channel ID lookup:", e.message);
      }
    }

    // Recupera conversationId se mancante (retry: le nuove prenotazioni potrebbero non averla ancora)
    if (!conversationId && hostawayRid) {
      for (let attempt = 0; attempt < 3 && !conversationId; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * attempt));
        try {
          const convResp = await axios.get(
            `https://api.hostaway.com/v1/conversations?reservationId=${hostawayRid}`,
            { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
          );
          conversationId = convResp.data?.result?.[0]?.id;
          if (conversationId) console.log("✅ ConversationId recuperato:", conversationId);
        } catch (e) {
          console.error(`❌ Tentativo ${attempt + 1} conversationId: ${e.message}`);
        }
      }
      if (!conversationId) console.warn("⚠️ ConversationId non trovato per:", hostawayRid);
    }

    // ✅ Recupera arrivalTime se ancora mancante
    if (!arrivalTime && hostawayRid) {
      try {
        const resResp = await axios.get(
          `https://api.hostaway.com/v1/reservations/${hostawayRid}`,
          { headers: { Authorization: `Bearer ${HOSTAWAY_TOKEN}` }, timeout: 10000 }
        );
        const resData = resResp.data?.result;
        arrivalTime = resData?.arrivalTime;
        if (!arrivalTime && resData?.checkInTime) arrivalTime = `${resData.checkInTime}:00`;
        if (arrivalTime) console.log("✅ ArrivalTime recuperato:", arrivalTime);
      } catch (e) {
        console.error("❌ Errore recupero arrivalTime:", e.message);
      }
    }

    const checkInDate = reservation?.arrivalDate || reservation?.checkInDate;
const slots = decideSlots(arrivalTime, checkInDate);


    console.log("⏰ Arrival time:", arrivalTime);
    console.log("📆 Slot calcolati:", slots);

  

} catch (err) {
  console.error("❌ ERRORE hostaway-booking-webhook:", err);
}
 });
app.post("/arrival-time", async (req, res) => {
  res.status(200).json({ ok: true });
});





const PORT = process.env.PORT || 10000;

// ── Operator login (direct, no guest token needed) ───────────────────────
app.get('/op', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Operator</title><style>*{box-sizing:border-box;margin:0;padding:0}body{background:#120d09;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:system-ui,sans-serif}form{background:#1a1208;border:1px solid rgba(214,176,109,.2);border-radius:16px;padding:32px 24px;width:90%;max-width:340px;text-align:center}h2{color:#d6b06d;font-size:18px;margin-bottom:20px;letter-spacing:.05em}input{width:100%;padding:12px 14px;background:#211811;border:1px solid rgba(214,176,109,.25);border-radius:10px;color:#f5ead8;font-size:16px;margin-bottom:14px;outline:none}button{width:100%;padding:13px;background:linear-gradient(135deg,#c9a55a,#e8cb87);border:none;border-radius:10px;color:#1a0e05;font-weight:800;font-size:15px;cursor:pointer}</style></head><body><form method="POST" action="/op"><h2>🔑 Operator Access</h2><input type="password" name="code" placeholder="Access code" autocomplete="off" autofocus><button type="submit">ENTER</button></form></body></html>`);
});
app.post('/op', express.urlencoded({ extended: false }), (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (code !== OPERATOR_CODE) return res.redirect(302, '/op');
  res.cookie('op_sess', signOperatorCookie(), { httpOnly: true, sameSite: 'lax', maxAge: 4 * 60 * 60 * 1000, path: '/' });
  return res.redirect(302, '/operator-panel');
});

// ── Operator panel routes ─────────────────────────────────────────────────
app.get('/operator-panel', (req, res) => {
  const cookies = parseCookies(req);
  if (!verifyOperatorCookie(cookies['op_sess'])) {
    return res.redirect(302, '/guides/portico/premium_rome_concierge.html');
  }
  return res.type('html').send(operatorPanelHtml());
});

app.get('/operator-guide', (req, res) => {
  const cookies = parseCookies(req);
  if (!verifyOperatorCookie(cookies['op_sess'])) {
    return res.redirect(302, '/guides/portico/premium_rome_concierge.html');
  }
  const apt = String(req.query.apt || '').toLowerCase();
  const phase = parseInt(req.query.phase) || 3;
  if (!OPERATOR_APTS.includes(apt) || phase < 1 || phase > 3) {
    return res.redirect(302, '/operator-panel');
  }
  // Issue guide session (operator bypass — no device limit)
  const now = Date.now();
  const sessionExp = now + 4 * 60 * 60 * 1000;
  const guideSess = signGuardCookie({ reservationId: 'OPERATOR', deviceId: 'operator', apartment: apt, exp: sessionExp, operator: true });
  res.cookie('guide_sess', guideSess, { httpOnly: true, sameSite: 'lax', maxAge: 4 * 60 * 60 * 1000, path: '/' });
  // Issue operator JWT for phase endpoint
  const opToken = makeOperatorToken(apt, phase);
  return res.redirect(302, `/guides/${apt}/premium_rome_concierge.html?t=${encodeURIComponent(opToken)}&op=1`);
});
// ── End Operator panel routes ─────────────────────────────────────────────

// ========================================================================
// STRIPE PAYMENT LINK — GET /pay/stripe
// ========================================================================
// Chiamato dal GAS con: /pay/stripe?amount=37.34&res=12345
// `amount` è già lordo (commissione Stripe inclusa) — calcolato dal GAS.
// Crea una Checkout Session e redirige il cliente alla pagina di pagamento.

// Calcola il lordo che il cliente deve pagare perché l'host riceva esattamente `tassa`.
// Formula: lordo = ceil((tassa + 0.25) / (1 - 0.029) * 100) / 100
// Worst-case carte non-EU (2.9% + €0.25). Per carte EU l'host riceve leggermente di più.
function calcolaLordoStripe(tassa) {
  return Math.ceil((tassa + 0.25) / (1 - 0.029) * 100) / 100;
}

// Tariffa per appartamento (€/notte/persona), max 10 notti
const CITY_TAX_RATES = {
  arenula    : 5,
  portico    : 5,
  scala      : 5,
  trastevere : 5,
  leonina    : 6,
};
const CITY_TAX_MAX_NIGHTS = 10;

app.get("/pay/stripe", async (req, res) => {
  const reservationId = String(req.query.res || "").trim();
  if (!reservationId) return res.status(400).send("Parametri non validi.");

  let tassa;

  if (req.query.listing) {
    // Formato Hostaway: ?listing=arenula&guests=2&nights=3&res=...&channel=vrbo (opzionale)
    const listing = String(req.query.listing).toLowerCase().trim();
    const channel = String(req.query.channel || "").toLowerCase().trim();
    let   guests  = Math.max(1, parseInt(req.query.guests) || 1);
    const nights  = Math.min(Math.max(1, parseInt(req.query.nights) || 1), CITY_TAX_MAX_NIGHTS);
    const rate    = CITY_TAX_RATES[listing];
    if (!rate) {
      console.error(`❌ Listing sconosciuto: ${listing}`);
      return res.status(400).send("Appartamento non riconosciuto.");
    }
    // Vrbo via iCal non passa il numero reale di ospiti: arriva sempre 1.
    // Correzione: se canale Vrbo e ospiti = 1, imposta 2.
    if (channel === "vrbo" && guests === 1) {
      console.log(`🔧 Vrbo guest fix: 1 → 2 (res:${reservationId})`);
      guests = 2;
    }
    tassa = nights * guests * rate;
    console.log(`🏠 ${listing} | ch:${channel || "n/a"} | ${nights} notti × ${guests} ospiti × €${rate} = €${tassa}`);
  } else if (req.query.amount) {
    // Formato GAS email: ?amount=36&res=...
    tassa = parseFloat(req.query.amount);
  } else {
    return res.status(400).send("Parametri non validi.");
  }

  if (!tassa || tassa < 1 || tassa > 9999) {
    return res.status(400).send("Importo non valido.");
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("❌ STRIPE_SECRET_KEY mancante");
    return res.status(500).send("Configurazione server non completa.");
  }

  // Importo lordo che il cliente paga (include commissione Stripe)
  const amount      = calcolaLordoStripe(tassa);
  const amountCents = Math.round(amount * 100);
  console.log(`💶 Tassa netta: €${tassa} → lordo cliente: €${amount} (${amountCents} cents)`);

  try {
    const baseUrl = process.env.BASE_URL || `https://${req.hostname}`;

    // Usa axios direttamente — evita problemi di connessione del Stripe SDK
    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("payment_method_types[]", "card");
    params.append("line_items[0][price_data][currency]", "eur");
    params.append("line_items[0][price_data][unit_amount]", String(amountCents));
    params.append("line_items[0][price_data][product_data][name]", "Tassa di soggiorno - Roma");
    params.append("line_items[0][price_data][product_data][description]", `Prenotazione ${reservationId}`);
    params.append("line_items[0][quantity]", "1");
    params.append("metadata[reservation_id]", reservationId);
    params.append("payment_intent_data[metadata][reservation_id]", reservationId);
    params.append("success_url", `${baseUrl}/pay/stripe/success?res=${encodeURIComponent(reservationId)}`);
    params.append("cancel_url",  `${baseUrl}/pay/stripe/cancel?res=${encodeURIComponent(reservationId)}`);

    const { data: session } = await axios.post(
      "https://api.stripe.com/v1/checkout/sessions",
      params.toString(),
      {
        headers: {
          "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000,
      }
    );

    console.log(`💳 Stripe session creata: ${session.id} | res:${reservationId} | EUR ${amount}`);
    return res.redirect(303, session.url);
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error("❌ Errore creazione Stripe session:", detail);
    return res.status(500).send("Errore nella creazione del pagamento. Riprova più tardi.");
  }
});

app.get("/pay/stripe/success", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pagamento ricevuto</title>
  <style>
    body{font-family:-apple-system,sans-serif;display:flex;align-items:center;
         justify-content:center;min-height:100vh;margin:0;background:#f0fdf4}
    .card{background:#fff;border-radius:16px;padding:40px 32px;text-align:center;
          max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .icon{font-size:56px;margin-bottom:16px}
    h1{color:#16a34a;margin:0 0 12px;font-size:1.5rem}
    p{color:#555;margin:0;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Pagamento ricevuto!</h1>
    <p>Grazie per aver pagato la tassa di soggiorno.<br>
       Riceverai una conferma via email.</p>
  </div>
</body>
</html>`);
});

app.get("/pay/stripe/cancel", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Pagamento annullato</title>
  <style>
    body{font-family:-apple-system,sans-serif;display:flex;align-items:center;
         justify-content:center;min-height:100vh;margin:0;background:#fff7f7}
    .card{background:#fff;border-radius:16px;padding:40px 32px;text-align:center;
          max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .icon{font-size:56px;margin-bottom:16px}
    h1{color:#dc2626;margin:0 0 12px;font-size:1.5rem}
    p{color:#555;margin:0;line-height:1.6}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Pagamento annullato</h1>
    <p>Il pagamento non è stato completato.<br>
       Puoi riprovare usando il link ricevuto via email.</p>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log("Server running on", PORT);
}); 
