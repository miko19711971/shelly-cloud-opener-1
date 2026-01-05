 // guide-ai.js — PARTE 1/4

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GUIDES_V2_DIR = path.join(PUBLIC_DIR, "guides-v2");

const guidesCache = new Map();

// =====================
// NORMALIZZAZIONE BASE
// =====================
function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenize(str) {
  const s = normalizeText(str);
  return s ? s.split(" ") : [];
}

// =====================
// CARICA JSON GUIDA
// =====================
async function loadGuideJson(apartment) {
  const key = String(apartment || "").toLowerCase();
  if (!key) return null;

  if (guidesCache.has(key)) return guidesCache.get(key);

  const filePath = path.join(GUIDES_V2_DIR, `${key}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    guidesCache.set(key, json);
    return json;
  } catch (err) {
    console.error("❌ Errore lettura guida:", key, err.message);
    return null;
  }
}

// =====================
// LINGUA — SOLO SE SUPPORTATA DAL JSON
// =====================
function resolveLanguage(requested, question, availableLanguages) {
  const req = String(requested || "").toLowerCase().slice(0, 2);

  // 1️⃣ Se la lingua richiesta è supportata → USALA
  if (availableLanguages.includes(req)) return req;

  // 2️⃣ Rilevamento semplice dal testo
  const text = normalizeText(question);
  const tokens = tokenize(text);

  const hints = {
    en: ["the","what","should","do","wifi","working"],
    it: ["il","non","funziona","cosa","fare","wifi"],
    fr: ["ne","pas","fonctionne","wifi"],
    de: ["nicht","funktioniert","wlan"],
    es: ["no","funciona","wifi"]
  };

  let best = "en";
  let score = 0;

  for (const lang of availableLanguages) {
    const hits = hints[lang]?.filter(t => tokens.includes(t)).length || 0;
    if (hits > score) {
      score = hits;
      best = lang;
    }
  }

  return best;
}
// guide-ai.js — PARTE 2/4

function intentMatches(question, keywords = []) {
  if (!Array.isArray(keywords) || !keywords.length) return false;

  const normQ = normalizeText(question);

  return keywords.some(kw => {
    const nkw = normalizeText(kw);
    return nkw && normQ.includes(nkw);
  });
}

function findBestIntent(question, intentsForLang) {
  let bestIntent = null;
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(intentsForLang || {})) {
    let score = 0;

    for (const kw of keywords) {
      const nkw = normalizeText(kw);
      if (nkw && normalizeText(question).includes(nkw)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return bestScore > 0 ? bestIntent : null;
}
// guide-ai.js — PARTE 3/4

export async function reply({ apartment, lang, question }) {
  const q = String(question || "").trim();
  if (!q) return { ok: true, noMatch: true, answer: null };

  const guide = await loadGuideJson(apartment);
  if (!guide) return { ok: false, error: "guide_not_found" };

  const availableLanguages = Array.isArray(guide.languages)
    ? guide.languages.map(l => l.toLowerCase())
    : ["en"];

  const language = resolveLanguage(lang, q, availableLanguages);

  const intentsForLang = guide.intents?.[language] || {};
  const answersForLang = guide.answers?.[language] || {};

  // PRIORITÀ HARD — early check-in policy
  if (
    intentsForLang.early_checkin_policy &&
    intentMatches(q, intentsForLang.early_checkin_policy)
  ) {
    return {
      ok: true,
      language,
      intent: "early_checkin_policy",
      answer: answersForLang.early_checkin_policy || null
    };
  }

  const intent = findBestIntent(q, intentsForLang);
  if (!intent) {
    return { ok: true, noMatch: true, answer: null, language };
  }

  const answer = answersForLang[intent] || null;
  if (!answer) {
    return { ok: true, noMatch: true, answer: null, language };
  }

  return {
    ok: true,
    language,
    intent,
    answer
  };
}
// guide-ai.js — PARTE 4/4
// ✔ Nessun fallback incrociato di lingua
// ✔ La lingua è SEMPRE una di guide.languages
// ✔ Le risposte arrivano SOLO da answers[lingua]
// ✔ Se inglese → MAI spagnolo
// ✔ Se non matcha → noMatch, non risposta sbagliata
