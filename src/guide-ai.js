// guide-ai.js
// Motore AI a keyword per guides-v2
// ✔ lingua coerente
// ✔ nessun fallback incrociato
// ✔ deploy-safe

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GUIDES_V2_DIR = path.join(PUBLIC_DIR, "guides-v2");

// cache in memoria
const guidesCache = new Map();

// =====================
// NORMALIZZAZIONE TESTO
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
// CARICAMENTO GUIDA
// =====================
async function loadGuideJson(apartment) {
  const key = String(apartment || "").toLowerCase().trim();
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
// RISOLUZIONE LINGUA
// =====================
 function resolveLanguage(requested, question, availableLanguages) {
  const req = String(requested || "").toLowerCase().slice(0, 2);

  // 1️⃣ Priorità assoluta: se la lingua è già passata correttamente, usala subito
  if (availableLanguages.includes(req)) return req;

  // 2️⃣ Rilevamento testuale migliorato con stop-words univoche
  const tokens = tokenize(question);

  const hints = {
    it: ["il", "lo", "la", "i", "gli", "le", "per", "con", "e", "non"],
    en: ["the", "and", "with", "is", "for", "to", "what", "should"],
    fr: ["le", "la", "les", "des", "pour", "dans", "est", "une", "avez"],
    de: ["der", "die", "das", "ein", "eine", "und", "mit", "nicht"],
    es: ["el", "los", "las", "un", "una", "por", "con", "y", "del"]
  };

  let best = availableLanguages[0] || "en"; // Fallback sulla prima lingua del JSON
  let maxHits = 0;

  for (const lang of availableLanguages) {
    if (hints[lang]) {
      // Conta quante parole della lingua corrente sono presenti nella domanda
      const hits = hints[lang].filter(t => tokens.includes(t)).length;
      if (hits > maxHits) {
        maxHits = hits;
        best = lang;
      }
    }
  }

  return best;
}

// =====================
// MATCH INTENT
// =====================
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

  const normQ = normalizeText(question);

  for (const [intent, keywords] of Object.entries(intentsForLang || {})) {
    let score = 0;
    for (const kw of keywords) {
      const nkw = normalizeText(kw);
      if (nkw && normQ.includes(nkw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return bestScore > 0 ? bestIntent : null;
}

// =====================
// MAIN REPLY
// =====================
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

  // PRIORITÀ HARD: early check-in
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
