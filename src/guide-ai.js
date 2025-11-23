// src/guide-ai.js
// Modulo di supporto per il Guest Assistant.
// ATTENZIONE: non modifica l'endpoint principale /api/guest-assistant
// che continua a vivere in server.js ed è quello usato dalle tue Guide.
//
// Qui leggiamo i JSON in public/guides-v2 e offriamo funzioni di utilità
// + un endpoint di DEBUG separato: /api/guest-assistant-debug

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ====== PATH JSON guide-v2 ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GUIDES_V2_DIR = path.join(__dirname, "..", "public", "guides-v2");

// Mappa nome appartamento -> file JSON
const APT_JSON_MAP = {
  arenula: "arenula.json",
  leonina: "leonina.json",
  ottavia: "ottavia.json",   // Portico d’Ottavia
  portico: "ottavia.json",   // alias di sicurezza
  scala: "scala.json",
  trastevere: "trastevere.json"
};

// Cache in memoria dei JSON già letti
const guideCache = new Map();

// ====== HELPERS TESTO / LINGUA ======
function norm(str = "") {
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")   // togli accenti
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLang(lang) {
  if (!lang) return "en";
  return String(lang).slice(0, 2).toLowerCase();
}

// ====== CARICAMENTO JSON ======
async function loadGuide(aptKeyRaw) {
  const aptKey = String(aptKeyRaw || "").toLowerCase().trim();
  const fileName = APT_JSON_MAP[aptKey];

  if (!fileName) {
    throw new Error(`Guida non configurata per appartamento: ${aptKey}`);
  }

  if (guideCache.has(fileName)) {
    return guideCache.get(fileName);
  }

  const fullPath = path.join(GUIDES_V2_DIR, fileName);
  const raw = await fs.readFile(fullPath, "utf8");
  const json = JSON.parse(raw);

  guideCache.set(fileName, json);
  return json;
}

// ====== RICERCA INTENT + RISPOSTA ======
function findIntent(guide, lang, question) {
  if (!guide?.intents) return { intentKey: null, languageUsed: lang };

  const normQ = norm(question);
  if (!normQ) return { intentKey: null, languageUsed: lang };

  // se non abbiamo quella lingua, fallback a EN o IT
  let languageUsed = lang;
  if (!guide.intents[languageUsed]) {
    if (guide.intents["en"]) languageUsed = "en";
    else if (guide.intents["it"]) languageUsed = "it";
  }

  const intentsForLang = guide.intents[languageUsed] || {};
  let foundKey = null;

  outer: for (const [intentKey, keywords] of Object.entries(intentsForLang)) {
    for (const kw of keywords) {
      if (!kw) continue;
      const normKw = norm(kw);
      if (!normKw) continue;
      if (normQ.includes(normKw)) {
        foundKey = intentKey;
        break outer;
      }
    }
  }

  return { intentKey: foundKey, languageUsed };
}

function pickAnswer(guide, requestedLang, languageUsed, intentKey) {
  if (!intentKey) return null;
  if (!guide?.answers) return null;

  const answers = guide.answers;

  const langsToTry = [
    normalizeLang(requestedLang),
    languageUsed,
    "en",
    "it"
  ].filter(Boolean);

  for (const l of langsToTry) {
    const group = answers[l];
    if (group && group[intentKey]) {
      return { answerText: group[intentKey], finalLang: l };
    }
  }

  return null;
}

// ====== FUNZIONE PRINCIPALE RIUTILIZZABILE ======
export async function getGuideAnswer({ apartment, language, question }) {
  const aptKey = String(apartment || "").toLowerCase().trim();
  const lang = normalizeLang(language);
  const q = question || "";

  const guide = await loadGuide(aptKey);
  const { intentKey, languageUsed } = findIntent(guide, lang, q);
  const answerInfo = pickAnswer(guide, lang, languageUsed, intentKey);

  if (!intentKey || !answerInfo) {
    return {
      ok: false,
      apartment: guide?.apartment || aptKey,
      language: lang,
      intent: null,
      answer: null
    };
  }

  return {
    ok: true,
    apartment: guide.apartment || aptKey,
    language: answerInfo.finalLang,
    intent: intentKey,
    answer: answerInfo.answerText
  };
}

// ====== INTEGRAZIONE CON EXPRESS (solo DEBUG) ======
export default function guideAI(app) {
  // Endpoint SOLO DI TEST:
  // POST /api/guest-assistant-debug
  //
  // body JSON:
  //   {
  //     "apartment": "arenula" | "leonina" | "ottavia" | "scala" | "trastevere",
  //     "language": "it" | "en" | ...,
  //     "question": "dove è il wifi?"
  //   }
  //
  // Risposta:
  //   { ok, apartment, language, intent, answer }
  //
  // Non interferisce con /api/guest-assistant che è definito in server.js.
  app.post("/api/guest-assistant-debug", async (req, res) => {
    try {
      const { apartment, language, question } = req.body || {};
      const result = await getGuideAnswer({ apartment, language, question });
      return res.json(result);
    } catch (err) {
      console.error("❌ Errore /api/guest-assistant-debug:", err);
      return res.status(500).json({
        ok: false,
        error: "server_error",
        message: "Errore interno nel guest assistant (debug)."
      });
    }
  });
}
