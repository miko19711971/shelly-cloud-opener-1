 import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const GUIDES_V2_DIR = path.join(__dirname, "..", "public", "guides-v2");
const guidesCache = new Map();

function normalizeText(str) {
  return String(str || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// Dizionario globale per DETERMINARE la lingua dalla domanda
const LANGUAGE_DETECTOR = {
  it: ["riscaldamento", "spazzatura", "chiavi", "dove", "mangiare", "grazie", "buongiorno", "caldo", "freddo", "funziona", "pagare", "tassa"],
  en: ["heating", "trash", "keys", "where", "eat", "thanks", "working", "how", "cold", "warm", "pay", "tax", "is", "the"],
  fr: ["chauffage", "poubelle", "cles", "manger", "merci", "chaud", "froid", "marche", "payer", "taxe"],
  es: ["calefaccion", "basura", "llaves", "donde", "comer", "gracias", "funciona", "pagar", "tasa", "calor", "frio"],
  de: ["heizung", "mull", "schlussel", "wo", "essen", "danke", "warm", "kalt", "funktioniert", "bezahlen", "steuer"]
};

// Parole chiave per trovare la RISPOSTA (Intents)
const KEYWORDS = {
  it: { wifi: ["wifi", "internet", "password"], heating: ["riscaldamento", "termostato", "caldo"], trash: ["spazzatura", "rifiuti", "sacchetti"], check_in: ["arrivo", "codice", "citofono"], city_tax_info: ["tassa", "pagamento"] },
  en: { wifi: ["wifi", "internet", "password"], heating: ["heating", "thermostat", "warm"], trash: ["trash", "garbage", "bins"], check_in: ["arrival", "code", "intercom"], city_tax_info: ["tax", "payment"] },
  fr: { wifi: ["wifi", "internet", "passe"], heating: ["chauffage", "chaud"], trash: ["poubelle", "dechets"], check_in: ["arrivee", "code"], city_tax_info: ["taxe", "payer"] },
  de: { wifi: ["wlan", "wifi", "passwort"], heating: ["heizung", "warm"], trash: ["mull", "abfall"], check_in: ["ankunft", "code"], city_tax_info: ["steuer", "bezahlen"] },
  es: { wifi: ["wifi", "internet", "contrasena"], heating: ["calefaccion", "calor"], trash: ["basura", "residuos"], check_in: ["llegada", "codigo"], city_tax_info: ["tasa", "pagar"] }
};

export async function reply({ apartment, message }) {
  const aptKey = String(apartment || "").toLowerCase().trim();
  let guide = guidesCache.get(aptKey);
  if (!guide) {
    try {
      const raw = await fs.readFile(path.join(GUIDES_V2_DIR, `${aptKey}.json`), "utf8");
      guide = JSON.parse(raw);
      guidesCache.set(aptKey, guide);
    } catch { return "Guide not found."; }
  }

  const text = normalizeText(message);
  const targetData = guide.answers || guide;

  // 1. DETERMINAZIONE LINGUA: Scansiona il testo per capire la lingua
  let detectedLang = "en"; // Default
  let maxLangScore = 0;

  for (const [lang, signs] of Object.entries(LANGUAGE_DETECTOR)) {
    let score = 0;
    signs.forEach(word => { if (text.includes(word)) score++; });
    if (score > maxLangScore) {
      maxLangScore = score;
      detectedLang = lang;
    }
  }

  // 2. SCELTA RISPOSTA: Usa la lingua rilevata per trovare l'intent
  const answersForLang = targetData[detectedLang] || targetData.en;
  const langKeywords = KEYWORDS[detectedLang] || KEYWORDS.en;
  
  let bestIntent = null;
  let maxIntentScore = 0;

  for (const [intent, synonyms] of Object.entries(langKeywords)) {
    let score = 0;
    synonyms.forEach(syn => { if (text.includes(normalizeText(syn))) score++; });
    if (score > maxIntentScore) {
      maxIntentScore = score;
      bestIntent = intent;
    }
  }

  // 3. RESTITUZIONE: Ritorna la risposta specifica o un fallback
  return bestIntent ? answersForLang[bestIntent] : (answersForLang.wifi || Object.values(answersForLang)[0]);
}
