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

function normalizeLang(lang, availableLangs) {
  const fallback = "en";
  const requested = String(lang || "").toLowerCase().slice(0, 2);
  if (availableLangs.includes(requested)) return requested;
  if (availableLangs.includes(fallback)) return fallback;
  return availableLangs[0];
}

const KEYWORDS = {
  it: {
    wifi: ["wifi", "wi-fi", "internet", "password", "rete"],
    check_in: ["check in", "arrivo", "citofono", "entrare", "chiavi", "ingresso", "codice"],
    check_out: ["check out", "partenza", "uscire", "lasciare"],
    heating: ["riscaldamento", "termosifoni", "caldo", "freddo", "termostato", "caloriferi"],
    trash: ["spazzatura", "rifiuti", "immondizia", "differenziata", "sacchetti", "pattumiera"],
    electric_panel: ["luce", "corrente", "quadro elettrico", "interruttore", "blackout", "salta"],
    water: ["acqua", "potabile", "calda", "rubinetto", "bere"],
    ac: ["aria condizionata", "condizionatore", "ac", "clima", "telecomando"],
    gas: ["gas", "fornelli", "cucina", "fiamma", "fuochi"],
    eat: ["mangiare", "ristorante", "cena", "pranzo", "cibo", "dove mangiare"],
    drink: ["bere", "bar", "vino", "cocktail", "aperitivo"],
    id_documents: ["documenti", "passaporto", "registrazione", "identita", "carta"],
    city_tax_info: ["tassa", "soggiorno", "city tax", "pagare", "comune", "soldi"],
    house_rules: ["regole", "fumare", "feste", "rumore", "fumo"],
    transport: ["trasporti", "bus", "tram", "metro", "taxi", "stazione", "aeroporto"]
  },
  en: {
    wifi: ["wifi", "wi-fi", "internet", "password", "network"],
    check_in: ["check in", "arrival", "intercom", "door", "keys", "entry", "code"],
    check_out: ["check out", "departure", "leave", "leaving", "exit"],
    heating: ["heating", "radiators", "warm", "cold", "thermostat", "heaters"],
    trash: ["trash", "garbage", "rubbish", "recycling", "waste", "bins"],
    electric_panel: ["electricity", "power", "electric panel", "breaker", "blackout", "no light"],
    water: ["water", "drinkable", "hot water", "tap", "drinking"],
    ac: ["air conditioning", "ac", "aircon", "cooling", "remote"],
    gas: ["gas", "stove", "cook", "burner", "flame"],
    eat: ["eat", "food", "restaurant", "dinner", "lunch", "where to eat"],
    drink: ["drink", "bar", "wine", "cocktail", "pub", "aperitivo"],
    id_documents: ["documents", "passport", "id card", "registration", "id"],
    city_tax_info: ["tax", "city tax", "tourist tax", "payment", "pay"],
    house_rules: ["rules", "smoking", "parties", "noise", "smoke"],
    transport: ["transport", "bus", "tram", "metro", "taxi", "train", "airport"]
  },
  fr: {
    wifi: ["wifi", "wi-fi", "internet", "mot de passe", "réseau"],
    check_in: ["check in", "arrivée", "interphone", "porte", "clés", "code"],
    check_out: ["check out", "départ", "partir", "sortir", "clés"],
    heating: ["chauffage", "radiateur", "chaud", "froid", "thermostat"],
    trash: ["poubelle", "déchets", "ordures", "tri", "sacs"],
    electric_panel: ["électricité", "courant", "tableau électrique", "disjoncteur", "coupure"],
    water: ["eau", "potable", "eau chaude", "robinet"],
    ac: ["climatisation", "clim", "ac"],
    gas: ["gaz", "cuisinière", "feu", "cuisiner"],
    eat: ["manger", "restaurant", "nourriture", "dîner", "déjeuner"],
    drink: ["boire", "bar", "vin", "cocktail", "aperitif"],
    id_documents: ["documents", "passeport", "identité", "enregistrement"],
    city_tax_info: ["taxe", "taxe de séjour", "payer", "argent"],
    house_rules: ["règles", "fumer", "fêtes", "bruit"],
    transport: ["transport", "bus", "tram", "métro", "taxi", "aéroport"]
  },
  de: {
    wifi: ["wlan", "wifi", "internet", "passwort", "netzwerk"],
    check_in: ["check in", "ankunft", "tür", "schlüssel", "code", "eingang"],
    check_out: ["check out", "abreise", "verlassen", "schlüssel"],
    heating: ["heizung", "heizkörper", "warm", "kalt", "thermostat"],
    trash: ["müll", "abfall", "mülleimer", "tüte", "recycling"],
    electric_panel: ["strom", "sicherung", "sicherungskasten", "stromausfall"],
    water: ["wasser", "trinkwasser", "warmwasser", "leitung"],
    ac: ["klimaanlage", "ac", "kühlen"],
    gas: ["gas", "herd", "kochen", "flamme"],
    eat: ["essen", "restaurant", "küche", "mittagessen", "abendessen"],
    drink: ["trinken", "bar", "wein", "cocktail", "bier"],
    id_documents: ["dokumente", "reisepass", "ausweis", "registrierung"],
    city_tax_info: ["steuer", "kurtaxe", "bezahlen", "city tax"],
    house_rules: ["regeln", "rauchen", "partys", "lärm"],
    transport: ["verkehr", "bus", "tram", "u-bahn", "taxi", "flughafen"]
  },
  es: {
    wifi: ["wifi", "wi-fi", "internet", "contraseña", "red"],
    check_in: ["check in", "llegada", "portero", "puerta", "llaves", "código"],
    check_out: ["check out", "salida", "dejar", "llaves"],
    heating: ["calefacción", "radiadores", "calor", "frío", "termostato"],
    trash: ["basura", "residuos", "bolsas", "reciclaje", "cubo"],
    electric_panel: ["luz", "corriente", "cuadro eléctrico", "interruptor", "apagón"],
    water: ["agua", "potable", "agua caliente", "grifo"],
    ac: ["aire acondicionado", "ac", "clima"],
    gas: ["gas", "cocina", "fuego", "hornilla"],
    eat: ["comer", "restaurante", "comida", "cena", "almuerzo"],
    drink: ["beber", "bar", "vino", "cóctel", "aperitivo"],
    id_documents: ["documentos", "pasaporte", "identidad", "registro"],
    city_tax_info: ["tasa", "tasa turística", "pagar", "dinero", "city tax"],
    house_rules: ["reglas", "fumar", "fiestas", "ruido"],
    transport: ["transporte", "bus", "tranvía", "metro", "taxi", "aeropuerto"]
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

  const availableLangs = guide.languages || Object.keys(guide.answers || {});
  const lang = normalizeLang(language, availableLangs);
  
  const answersForLang = guide.answers ? guide.answers[lang] : guide[lang];
  if (!answersForLang) return "Language not supported.";

  const intentKey = findBestIntentForQuestion(lang, message, answersForLang);

  let answer = intentKey ? answersForLang[intentKey] : null;

  if (!answer) {
    answer = answersForLang.check_in || answersForLang.wifi || Object.values(answersForLang)[0];
  }

  return answer;
}
