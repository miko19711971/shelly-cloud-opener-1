// guide-ai.js
// Motore AI a keyword per guides-v2
// ✔ lingua coerente (Fix parametri invertiti)
// ✔ rilevamento stop-words migliorato
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
function resolveLanguage(question, requested, availableLanguages) {
  // 1. Forza la lingua se passata correttamente via URL/Browser
  if (requested && availableLanguages.includes(requested.toLowerCase())) {
    return requested.toLowerCase();
  }

  // Prepariamo il testo con spazi per un matching esatto delle parole
  const text = " " + question.toLowerCase() + " ";

  // 2. Dizionario di parole "forti" (articoli e verbi comuni)
  const indicators = {
    en: ['is', 'the', 'what', 'to', 'how', 'it', 'working', 'not', 'you', 'where'],
    it: ['il', 'la', 'non', 'come', 'fare', 'funziona', 'dove', 'che', 'per'],
    es: ['el', 'la', 'no', 'como', 'hacer', 'funciona', 'donde', 'esta', 'que'],
    fr: ['le', 'la', 'les', 'pas', 'comment', 'faire', 'est', 'dans', 'pour']
  };

  let scores = {};
  availableLanguages.forEach(lang => {
    scores[lang] = 0;
    if (indicators[lang]) {
      indicators[lang].forEach(word => {
        // Cerca la parola esatta circondata da spazi
        if (text.includes(' ' + word + ' ')) {
          scores[lang]++;
        }
      });
    }
  });

  // 3. Trova la lingua con il punteggio più alto
  let detected = null;
  let maxScore = -1;

  availableLanguages.forEach(lang => {
    if (scores[lang] > maxScore) {
      maxScore = scores[lang];
      detected = lang;
    }
  });

  // 4. Se il punteggio è 0 (nessuna parola trovata), usa l'inglese come fallback 
  // o la prima lingua disponibile nel JSON
  if (maxScore <= 0) {
    return availableLanguages.includes('en') ? 'en' : availableLanguages[0];
  }

  return detected;
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

  // FIX: Invertiti q e lang. Ora q (la domanda) viene analizzata correttamente.
  const language = resolveLanguage(q, lang, availableLanguages);

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
