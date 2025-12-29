// guide-ai.js
// Motore “AI” a keyword + gate (guides-v2) con priorità EARLY CHECK-IN

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// cartella public/guides-v2
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GUIDES_V2_DIR = path.join(PUBLIC_DIR, "guides-v2");

// cache in memoria
const guidesCache = new Map();

// =====================
// GATE — PARAMETRI
// =====================
const GATE = {
  MAX_MESSAGE_CHARS: 250,
  MIN_MATCH_SCORE: 1,
  MIN_SCORE_MARGIN: 1,
  MAX_UNKNOWN_RATIO: 0.45,
  MIN_TOKEN_LEN_FOR_UNKNOWN: 3
};

// Stopwords minime
const STOPWORDS = {
  it: new Set(["il","lo","la","i","gli","le","un","uno","una","di","a","da","in","su","per","con","senza","e","o","ma","che","come","dove","quando","quanto","quale","quali","mi","ti","si","ci","vi","non","sono","sei","è","ho","hai","abbiamo","avete","hanno"]),
  en: new Set(["the","a","an","to","of","in","on","at","for","with","without","and","or","but","what","where","when","how","howmuch","i","you","we","they","is","are","am","do","does","did","can","could","please","hi","hello"]),
  fr: new Set(["le","la","les","un","une","des","de","du","dans","sur","à","pour","avec","sans","et","ou","mais","quoi","où","quand","comment","je","tu","il","elle","nous","vous","ils","elles","est","sont","peux","pouvez","svp","bonjour"]),
  de: new Set(["der","die","das","ein","eine","einen","einem","einer","von","in","auf","an","für","mit","ohne","und","oder","aber","was","wo","wann","wie","ich","du","wir","ihr","sie","ist","sind","kann","koennen","können","bitte","hallo"]),
  es: new Set(["el","la","los","las","un","una","unos","unas","de","del","en","sobre","a","para","con","sin","y","o","pero","que","donde","cuando","como","yo","tu","usted","nosotros","vosotros","ellos","ellas","es","son","puedo","puede","porfavor","hola"])
};
// =====================
// NORMALIZZAZIONE / TOKEN
// =====================
function normalizeText(str) {
  // NOTA: "check-in" -> "check in" (trattini/segni diventano spazi)
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
  const m = s.match(/[a-z0-9]+/g);
  return m ? m : [];
}

// =====================
// CARICAMENTO GUIDA
// =====================
async function loadGuideJson(apartment) {
  const aptKey = String(apartment || "").toLowerCase().trim();
  if (!aptKey) return null;

  if (guidesCache.has(aptKey)) return guidesCache.get(aptKey);

  const filePath = path.join(GUIDES_V2_DIR, `${aptKey}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    guidesCache.set(aptKey, json);
    return json;
  } catch (err) {
    console.error("❌ Impossibile leggere guida JSON:", aptKey, filePath, err.message);
    return null;
  }
}
 // =====================
// LINGUA (fallback)
// =====================
function pickLang(requested, question) {
  const lang = String(requested || "").toLowerCase().trim();
  if (["it","en","fr","de","es"].includes(lang)) return lang;

  // fallback “soft” via stopwords
  const toks = tokenize(question);
  const score = { it: 0, en: 0, fr: 0, de: 0, es: 0 };
  for (const t of toks) {
    for (const k of Object.keys(score)) {
      if (STOPWORDS[k]?.has(t)) score[k] += 1;
    }
  }
  let best = "en";
  let bestScore = -1;
  for (const k of Object.keys(score)) {
    if (score[k] > bestScore) {
      bestScore = score[k];
      best = k;
    }
  }
  return best;
}

function buildKnownTokens(intentsLang) {
  const known = new Set();
  for (const kws of Object.values(intentsLang || {})) {
    if (!Array.isArray(kws)) continue;
    for (const kw of kws) {
      const nkw = normalizeText(kw);
      if (!nkw) continue;
      for (const tok of tokenize(nkw)) known.add(tok);
      // anche la frase intera (utile per includes)
      known.add(nkw);
    }
  }
  return known;
}

function unknownRatio(question, lang, known) {
  const toks = tokenize(question).filter(t => (t.length >= GATE.MIN_TOKEN_LEN_FOR_UNKNOWN));
  if (toks.length === 0) return 0;

  const sw = STOPWORDS[lang] || new Set();
  let considered = 0;
  let unknown = 0;

  for (const t of toks) {
    if (sw.has(t)) continue;
    considered += 1;
    if (!known.has(t)) unknown += 1;
  }
  if (considered === 0) return 0;
  return unknown / considered;
}

// helper: match “boolean” su un intent (keyword singola o frase)
function intentMatches(question, intentsLang, intentKey) {
  const kws = intentsLang?.[intentKey];
  if (!Array.isArray(kws) || kws.length === 0) return false;

  const normMsg = normalizeText(question);
  const msgTokens = new Set(tokenize(question));

  return kws.some((kw) => {
    const nkw = normalizeText(kw);
    if (!nkw) return false;

    if (nkw.includes(" ")) {
      return normMsg.includes(nkw); // match frase
    }
    return msgTokens.has(nkw) || normMsg.includes(nkw); // match token o substring
  });
}
// =====================
// MATCH + RISPOSTA
// =====================
export async function reply({ apartment, lang, question }) {
  const q = String(question || "").trim();
  if (!q) return { ok: true, noMatch: true, answer: null };

  if (q.length > GATE.MAX_MESSAGE_CHARS) {
    return { ok: true, noMatch: true, answer: null };
  }

  const guide = await loadGuideJson(apartment);
  if (!guide) {
    return { ok: false, error: "guide_not_found", answer: null };
  }

  const L = pickLang(lang, q);

  const intentsLang = guide?.intents?.[L] || guide?.intents?.en || {};
  const answersLang = guide?.answers?.[L] || guide?.answers?.en || {};
// ✅ JSON legacy (solo risposte)
if (!guide.intents && guide[L]) {
  return {
    ok: true,
    lang: L,
    intent: "direct",
    answer: guide[L].services || Object.values(guide[L])[0]
  };
}
  // gate unknown ratio
  const known = buildKnownTokens(intentsLang);
  const ur = unknownRatio(q, L, known);
  if (ur > GATE.MAX_UNKNOWN_RATIO) {
    return { ok: true, noMatch: true, answer: null };
  }

  // ===== PRIORITÀ HARD: EARLY CHECK-IN =====
  // Se matcha early_checkin -> ritorna subito early_checkin (NON deve finire su check_in)
  if (intentMatches(q, intentsLang, "early_checkin") && answersLang.early_checkin) {
    return {
      ok: true,
      lang: L,
      intent: "early_checkin",
      answer: answersLang.early_checkin
    };
  }

  // ===== LOOP NORMALE SU INTENTS =====
  const normMsg = normalizeText(q);
  const msgTokens = new Set(tokenize(q));

  let bestIntent = null;
  let bestScore = -1;
  let secondScore = -1;

  for (const [intent, kws] of Object.entries(intentsLang)) {
    if (!Array.isArray(kws) || kws.length === 0) continue;

    let score = 0;

    for (const kw of kws) {
      const nkw = normalizeText(kw);
      if (!nkw) continue;

      // frase (più peso)
      if (nkw.includes(" ")) {
        if (normMsg.includes(nkw)) score += 5;
        continue;
      }

      // token singolo
      if (msgTokens.has(nkw)) score += 2;
      else if (normMsg.includes(nkw)) score += 1;
    }

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestIntent = intent;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  // gate score
  if (!bestIntent || bestScore < GATE.MIN_MATCH_SCORE) {
    return { ok: true, noMatch: true, answer: null };
  }

  // gate margin
  if (bestScore - secondScore < GATE.MIN_SCORE_MARGIN) {
    return { ok: true, noMatch: true, answer: null };
  }

  const answer = answersLang?.[bestIntent] || null;
  if (!answer) {
    return { ok: true, noMatch: true, answer: null };
  }

  return {
    ok: true,
    lang: L,
    intent: bestIntent,
    answer
  };
}
