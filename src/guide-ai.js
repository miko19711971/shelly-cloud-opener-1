// guide-ai.js
// Motore AI a keyword per guides-v2
// ✔ Fix rilevamento lingua (Parametri q/lang)
// ✔ Debug Log integrato per tracciamento errori
// ✔ Fallback inglese forzato

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GUIDES_V2_DIR = path.join(PUBLIC_DIR, "guides-v2");

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
function resolveLanguage(question, requested, availableLanguages) {
  // Se la lingua è passata forzatamente (es. dal browser) e esiste nel JSON, usala
  if (requested && availableLanguages.includes(requested.toLowerCase())) {
    return requested.toLowerCase();
  }

  const text = " " + question.toLowerCase() + " ";
  
  const indicators = {
    en: ['is', 'the', 'what', 'to', 'how', 'it', 'working', 'not', 'wifi', 'internet', 'you', 'where'],
    it: ['il', 'la', 'non', 'come', 'fare', 'funziona', 'dove', 'che', 'per'],
    es: ['el', 'la', 'no', 'como', 'hacer', 'funciona', 'donde', 'esta', 'que'],
    fr: ['le', 'la', 'les', 'pas', 'comment', 'faire', 'est', 'dans', 'pour']
  };

  let scores = {};
  availableLanguages.forEach(lang => {
    scores[lang] = 0;
    if (indicators[lang]) {
      indicators[lang].forEach(word => {
        if (text.includes(' ' + word + ' ')) scores[lang]++;
      });
    }
  });

  // Fallback iniziale: se c'è l'inglese nel JSON, usa quello come base, altrimenti la prima lingua
  let detected = availableLanguages.includes('en') ? 'en' : availableLanguages[0];
  let maxScore = 0;

  availableLanguages.forEach(lang => {
    if (scores[lang] > maxScore) {
      maxScore = scores[lang];
      detected = lang;
    }
  });

  return detected;
}

// =====================
// MATCH INTENT
// =====================
function findBestIntent(question, intentsForLang) {
  let bestIntent = null;
  let maxMatches = 0;

  const normQ = normalizeText(question);
  if (!intentsForLang) return null;

  for (const [intent, keywords] of Object.entries(intentsForLang)) {
    let currentScore = 0;
    for (const kw of keywords) {
      const nkw = normalizeText(kw);
      if (nkw && normQ.includes(nkw)) {
        currentScore++;
        if (normQ.split(" ").includes(nkw)) currentScore += 1;
      }
    }
    if (currentScore > maxMatches) {
      maxMatches = currentScore;
      bestIntent = intent;
    }
  }
  return maxMatches > 0 ? bestIntent : null;
}

function intentMatches(question, keywords = []) {
  if (!Array.isArray(keywords) || !keywords.length) return false;
  const normQ = normalizeText(question);
  return keywords.some(kw => {
    const nkw = normalizeText(kw);
    return nkw && normQ.includes(nkw);
  });
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

  // ESECUZIONE RILEVAMENTO
  const language = resolveLanguage(q, lang, availableLanguages);

  // --- RIGA DI DEBUG (CONTROLLA IL TERMINALE) ---
  console.log(`[DEBUG AI] Domanda: "${q}" | Lingua Scelta: ${language.toUpperCase()}`);

  const intentsForLang = guide.intents?.[language] || {};
  const answersForLang = guide.answers?.[language] || {};

  // PRIORITÀ: early check-in
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
  
  if (!intent || !answersForLang[intent]) {
    return { ok: true, noMatch: true, answer: null, language };
  }

  return {
    ok: true,
    language,
    intent,
    answer: answersForLang[intent]
  };
}
