import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PUBLIC_DIR     = path.join(__dirname, "..", "public");
const GUIDES_V2_DIR  = path.join(PUBLIC_DIR, "guides-v2");

const guidesCache = new Map();

function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

async function loadGuideJson(apartment) {
  const aptKey = String(apartment || "").toLowerCase().trim();
  if (!aptKey) return null;
  if (guidesCache.has(aptKey)) return guidesCache.get(aptKey);

  const filePath = path.join(GUIDES_V2_DIR, `${aptKey}.json`);
  try {
    const raw  = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    guidesCache.set(aptKey, json);
    return json;
  } catch (err) {
    console.error("❌ Errore lettura JSON:", aptKey, err.message);
    return null;
  }
}

// --- LOGICA LINGUE BLINDATA ---
function normalizeLang(lang, availableLangs) {
  const fallback = "en";
  // Puliamo la lingua in ingresso (es. "en-GB" -> "en")
  let requested = String(lang || "").toLowerCase().trim().slice(0, 2);

  // Se la lingua chiesta c'è nel JSON, usala
  if (availableLangs.includes(requested)) return requested;
  
  // Se la lingua chiesta NON c'è, forza l'INGLESE invece di andare a caso
  if (availableLangs.includes(fallback)) return fallback;
  
  // Se manca pure l'inglese, prendi la prima disponibile
  return availableLangs[0];
}

const KEYWORDS = {
  it: {
    wifi: ["wifi", "wi-fi", "internet", "password", "rete"],
    check_in: ["check in", "arrivo", "citofono", "entrare", "chiavi", "ingresso", "codice"],
    check_out: ["check out", "partenza", "uscire", "lasciare"],
    heating: ["riscaldamento", "termosifoni", "caldo", "freddo", "termostato"],
    trash: ["spazzatura", "rifiuti", "immondizia", "differenziata", "sacchetti"],
    electric_panel: ["luce", "corrente", "quadro elettrico", "interruttore", "blackout", "salta"],
    water: ["acqua", "potabile", "calda", "rubinetto"],
    ac: ["aria condizionata", "condizionatore", "ac", "clima"],
    gas: ["gas", "fornelli", "cucina", "fiamma"],
    eat: ["mangiare", "ristorante", "cena", "pranzo", "cibo"],
    drink: ["bere", "bar", "vino", "cocktail", "aperitivo"],
    id_documents: ["documenti", "passaporto", "registrazione", "identita"],
    city_tax_info: ["tassa", "soggiorno", "city tax", "pagare", "comune"],
    house_rules: ["regole", "fumare", "feste", "rumore"],
    transport: ["trasporti", "bus", "tram", "metro", "taxi", "stazione", "aeroporto"]
  },
  en: {
    wifi: ["wifi", "wi-fi", "internet", "password", "network"],
    check_in: ["check in", "arrival", "intercom", "door", "keys", "entry", "code"],
    check_out: ["check out", "departure", "leave", "leaving", "exit"],
    heating: ["heating", "radiators", "warm", "cold", "thermostat"],
    trash: ["trash", "garbage", "rubbish", "recycling", "waste", "bins"],
    electric_panel: ["electricity", "power", "electric panel", "breaker", "blackout", "no light"],
    water: ["water", "drinkable", "hot water", "tap"],
    ac: ["air conditioning", "ac", "aircon", "cooling"],
    gas: ["gas", "stove", "cook", "burner"],
    eat: ["eat", "food", "restaurant", "dinner", "lunch"],
    drink: ["drink", "bar", "wine", "cocktail", "pub"],
    id_documents: ["documents", "passport", "id card", "registration"],
    city_tax_info: ["tax", "city tax", "tourist tax", "payment", "pay"],
    house_rules: ["rules", "smoking", "parties", "noise"],
    transport: ["transport", "bus", "tram", "metro", "taxi", "train", "airport"]
  },
  fr: {
    wifi: ["wifi", "wi-fi", "internet", "mot de passe"],
    check_in: ["check in", "arrivée", "interphone", "porte", "clés"],
    check_out: ["check out", "départ", "clés"],
    heating: ["chauffage", "radiateur", "thermostat"],
    trash: ["poubelle", "déchets", "tri"],
    electric_panel: ["électricité", "tableau électrique"],
    water: ["eau", "potable", "eau chaude"],
    ac: ["climatisation", "clim"],
    gas: ["gaz", "cuisinière"],
    eat: ["manger", "restaurant"],
    id_documents: ["documents", "passeport", "identité"],
    city_tax_info: ["taxe", "taxe de séjour", "payer"],
    transport: ["transport", "bus", "tram", "métro", "taxi"]
  },
  de: {
    wifi: ["wlan", "wifi", "internet", "passwort"],
    check_in: ["check in", "ankunft", "schlüssel"],
    check_out: ["check out", "abreise", "schlüssel"],
    heating: ["heizung", "warm", "kalt"],
    trash: ["müll", "abfall"],
    electric_panel: ["strom", "sicherung"],
    water: ["wasser", "warmwasser"],
    ac: ["klimaanlage", "ac"],
    id_documents: ["dokumente", "reisepass"],
    city_tax_info: ["steuer", "kurtaxe", "city tax"],
    transport: ["verkehr", "bus", "tram", "taxi"]
  },
  es: {
    wifi: ["wifi", "wi-fi", "internet", "contraseña"],
    check_in: ["check in", "llegada", "portero", "llaves"],
    check_out: ["check out", "salida", "llaves"],
    heating: ["calefacción", "calor", "frío"],
    trash: ["basura", "residuos", "bolsas"],
    electric_panel: ["luz", "corriente", "cuadro eléctrico"],
    water: ["agua", "agua caliente"],
    ac: ["aire acondicionado", "clima"],
    id_documents: ["documentos", "pasaporte", "identidad"],
    city_tax_info: ["tasa", "tasa turística", "pagar"],
    transport: ["transporte", "bus", "metro", "taxi"]
  }
};

function findBestIntentForQuestion(language, question, answersForLang) {
  const text = normalizeText(question);
  if (!text.trim()) return null;

  const langKeywords = KEYWORDS[language] || KEYWORDS.en;
  let bestRealKey = null;
  let bestScore = 0;

  for (const [intent, synonyms] of Object.entries(langKeywords)) {
    let score = 0;
    for (const syn of synonyms) {
      if (text.includes(normalizeText(syn))) score++;
    }
    if (score > bestScore && answersForLang[intent]) {
      bestScore = score;
      bestRealKey = intent;
    }
  }
  return bestRealKey;
}

export async function reply({ apartment, language, message }) {
  const guide = await loadGuideJson(apartment);
  if (!guide) return "Guide not found.";

  // Punto critico: cerchiamo in 'answers' o nel corpo del JSON
  const targetData = guide.answers ? guide.answers : guide;
  
  // Prendiamo le lingue effettivamente scritte nel JSON
  const availableLangs = Object.keys(targetData).filter(k => 
    ["en", "it", "fr", "de", "es"].includes(k.toLowerCase())
  );

  // Scegliamo la lingua con la logica "English Fallback"
  const lang = normalizeLang(language, availableLangs);
  const answersForLang = targetData[lang];

  if (!answersForLang) return "Language not supported.";

  const intentKey = findBestIntentForQuestion(lang, message, answersForLang);

  // Se non trova l'intento, dà il check_in o il wifi come benvenuto
  let answer = intentKey ? answersForLang[intentKey] : (answersForLang.check_in || answersForLang.wifi || Object.values(answersForLang)[0]);

  return answer;
}
