// guide-ai.js
// Motore AI semplice che legge i JSON delle guide-v2
// e sceglie la risposta migliore in base alle parole chiave.

// 🔧 Import base per leggere i file JSON
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// cartella public/guides-v2
const PUBLIC_DIR     = path.join(__dirname, "..", "public");
const GUIDES_V2_DIR  = path.join(PUBLIC_DIR, "guides-v2");

// cache in memoria per non rileggere ogni volta
const guidesCache = new Map();

/**
 * Normalizza testo: minuscolo + senza accenti
 */
function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Carica il JSON della guida per un appartamento.
 * Es: arenula.json, scala.json, portico.json, trastevere.json, leonina.json
 */
async function loadGuideJson(apartment) {
  const aptKey = String(apartment || "").toLowerCase().trim();
  if (!aptKey) return null;

  if (guidesCache.has(aptKey)) {
    return guidesCache.get(aptKey);
  }

  const filePath = path.join(GUIDES_V2_DIR, `${aptKey}.json`);
  try {
    const raw  = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    guidesCache.set(aptKey, json);
    return json;
  } catch (err) {
    console.error("❌ Impossibile leggere guida JSON:", aptKey, filePath, err.message);
    return null;
  }
}

/**
 * Sceglie la lingua migliore.
 * availableLangs = ["en","it","fr","de","es"] (derivate dalle chiavi del JSON)
 */
function normalizeLang(lang, availableLangs) {
  const fallback = "en";
  if (!Array.isArray(availableLangs) || availableLangs.length === 0) {
    return fallback;
  }

  const requested = String(lang || "").toLowerCase().slice(0, 2);

  if (availableLangs.includes(requested)) return requested;
  if (availableLangs.includes(fallback))  return fallback;
  return availableLangs[0];
}

/**
 * Dizionario di parole chiave per intent (per lingua).
 * Le chiavi sono “canoniche”: wifi, check_in, check_out, water, bathroom,
 * ac, gas, eat, drink, shopping, visit, experiences, day_trips,
 * tickets, museums, exhibitions, transport, services, emergency.
 *
 * Poi sotto c'è una piccola mappa di alias per collegare:
 *   shopping → shop
 *   experiences → experience
 *   tickets → tickets_events
 *   museums → museums_sites
 *
 * Così funziona anche se nei JSON usi "shop", "experience",
 * "tickets_events", "museums_sites" come hai fatto in Arenula.
 */
const KEYWORDS = {
  it: {
    wifi: ["wifi", "wi-fi", "wi fi", "rete", "password", "internet"],
    check_in: ["check in", "check-in", "arrivo", "ingresso", "entrare", "citofono", "portone", "codice", "chiavi"],
    check_out: ["check out", "check-out", "partenza", "uscita", "uscire", "lasciare le chiavi", "orario check out"],
    water: ["acqua", "acqua calda", "doccia", "rubinetto", "potabile", "bere"],
    bathroom: ["bagno", "wc", "toilette", "toilet", "asciugamani", "phon", "asciugacapelli", "sapone", "carta igienica", "doccia"],
    ac: ["aria condizionata", "condizionatore", "ac", "riscaldamento", "caldo", "freddo", "temperatura"],
    gas: ["gas", "fornello", "cucina", "fiamma", "piano cottura", "accendere i fuochi"],
    eat: ["mangiare", "ristorante", "trattoria", "pizzeria", "cena", "pranzo", "dove mangiare"],
    drink: ["bere", "bar", "vino", "cocktail", "birra", "aperitivo"],
    shopping: ["shopping", "negozi", "supermercato", "market", "spesa", "alimentari"],
    visit: ["visitare", "cosa vedere", "monumenti", "siti", "chiese", "passeggiata", "centro"],
    experiences: ["esperienze", "romantico", "passeggiata", "foto", "tramonto", "panorama", "vista"],
    day_trips: ["gite", "gita", "escursione", "escursioni", "fuori roma", "tivoli", "ostia", "castelli"],
    tickets: ["biglietti", "ticket", "eventi", "concerto", "concerti", "partita", "calcio", "roma", "lazio"],
    museums: ["musei", "museo", "colosseo", "vaticano", "borghese", "galleria", "siti archeologici"],
    exhibitions: ["mostre", "mostra", "esposizioni", "maxxi", "scuderie", "palazzo"],
    transport: ["trasporti", "bus", "autobus", "tram", "metro", "aeroporto", "treno", "taxi", "come arrivare"],
    services: ["servizi", "farmacia", "ospedale", "medico", "bancomat", "atm", "lavanderia", "sim"],
    emergency: ["emergenza", "emergenze", "polizia", "ambulanza", "vigili del fuoco", "vigili", "aiuto"]
  },
  en: {
    wifi: ["wifi", "wi-fi", "wi fi", "internet", "password", "network"],
    check_in: ["check in", "check-in", "arrival", "arrive", "intercom", "door code", "code", "access", "building door", "gate"],
    check_out: ["check out", "check-out", "departure", "leave", "leaving", "exit", "keys", "where do we leave the keys"],
    water: ["water", "hot water", "cold water", "shower", "tap", "drinking water", "drinkable"],
    bathroom: ["bathroom", "toilet", "wc", "towels", "hairdryer", "soap", "toilet paper", "shower"],
    ac: ["air conditioning", "ac", "aircon", "heating", "heat", "cold", "hot", "temperature"],
    gas: ["gas", "stove", "cook", "cooking", "hob", "burner", "oven", "flame"],
    eat: ["eat", "food", "restaurant", "dinner", "lunch", "pizza", "trattoria", "where to eat"],
    drink: ["drink", "bar", "wine", "cocktail", "beer", "aperitivo", "aperitif"],
    shopping: ["shopping", "shops", "supermarket", "grocery", "market", "bakery", "store"],
    visit: ["visit", "see", "sights", "monuments", "what to see", "things to do", "walk", "tourist"],
    experiences: ["experiences", "experience", "romantic", "walk", "photos", "photo", "sunset", "view", "panoramic"],
    day_trips: ["day trip", "day trips", "excursion", "excursions", "out of rome", "tivoli", "ostia", "bracciano", "castelli"],
    tickets: ["ticket", "tickets", "events", "event", "concert", "concerts", "football", "match", "game", "roma", "lazio"],
    museums: ["museum", "museums", "sites", "site", "colosseum", "vatican", "borghese", "gallery"],
    exhibitions: ["exhibition", "exhibitions", "show", "art show", "art gallery", "maxxi", "scuderie", "palazzo"],
    transport: ["transport", "bus", "tram", "metro", "subway", "underground", "airport", "train", "taxi", "public transport"],
    services: ["services", "pharmacy", "hospital", "doctor", "atm", "cash machine", "laundry", "sim"],
    emergency: ["emergency", "police", "ambulance", "fire", "fire brigade", "help", "urgent"]
  },
  fr: {
    wifi: ["wifi", "wi-fi", "wi fi", "réseau", "mot de passe", "internet"],
    check_in: ["check in", "arrivée", "interphone", "code", "porte", "entrée"],
    check_out: ["check out", "départ", "partir", "sortir", "clés"],
    water: ["eau", "eau chaude", "robinet", "potable"],
    bathroom: ["salle de bain", "toilettes", "wc", "serviettes", "sèche-cheveux", "savon", "papier toilette"],
    ac: ["climatisation", "clim", "chauffage"],
    gas: ["gaz", "plaque", "cuisinière", "flamme", "cuisiner"],
    eat: ["manger", "restaurant", "trattoria", "pizzeria", "dîner", "déjeuner"],
    drink: ["boire", "bar", "vin", "cocktail", "bière", "apéritif"],
    shopping: ["shopping", "boutiques", "supermarché", "épicerie", "magasins"],
    visit: ["visiter", "sites", "monuments", "que voir", "balade"],
    experiences: ["expériences", "romantique", "balade", "photos", "coucher de soleil"],
    day_trips: ["excursion", "excursions", "ostia", "tivoli", "castelli"],
    tickets: ["billets", "tickets", "événements", "concert", "foot", "football"],
    museums: ["musées", "musée", "colisée", "vatican", "borghese"],
    exhibitions: ["expositions", "exposition", "maxxi", "scuderie"],
    transport: ["transports", "bus", "tram", "métro", "aéroport", "taxi"],
    services: ["services", "pharmacie", "hôpital", "médecin", "distributeur", "banque", "sim", "laverie"],
    emergency: ["urgence", "urgences", "police", "ambulance", "pompiers"]
  },
  de: {
    wifi: ["wlan", "wifi", "wi-fi", "netz", "passwort", "internet"],
    check_in: ["check in", "ankunft", "einchecken", "sprechanlage", "tür", "code", "eingang"],
    check_out: ["check out", "auschecken", "abreise", "schlüssel abgeben", "schlüssel"],
    water: ["wasser", "warmwasser", "heißes wasser", "trinkwasser", "dusche", "hahn"],
    bathroom: ["bad", "badezimmer", "toilette", "wc", "handtücher", "föhn", "seife", "toilettenpapier"],
    ac: ["klimaanlage", "ac", "heizung"],
    gas: ["gas", "herd", "flamme", "kochen"],
    eat: ["essen", "restaurant", "pizzeria", "trattoria", "mittagessen", "abendessen"],
    drink: ["trinken", "bar", "wein", "cocktail", "bier", "aperitivo"],
    shopping: ["shopping", "geschäfte", "supermarkt", "markt", "einkaufen"],
    visit: ["besuchen", "sehenswürdigkeiten", "monumente", "was sehen", "spaziergang"],
    experiences: ["erlebnisse", "romantisch", "spaziergang", "fotos", "sonnenuntergang"],
    day_trips: ["tagesausflug", "tagesausflüge", "ausflug", "ostia", "tivoli", "castelli"],
    tickets: ["tickets", "karten", "eintrittskarten", "events", "konzerte", "fußball"],
    museums: ["museen", "museum", "kolosseum", "vatikan", "borghese"],
    exhibitions: ["ausstellungen", "ausstellung", "maxxi", "scuderie"],
    transport: ["verkehr", "transport", "bus", "tram", "straßenbahn", "metro", "u-bahn", "flughafen", "taxi"],
    services: ["apotheke", "krankenhaus", "arzt", "geldautomat", "atm", "waschsalon", "sim"],
    emergency: ["notfall", "notruf", "polizei", "rettung", "rettungsdienst", "feuerwehr"]
  },
  es: {
    wifi: ["wifi", "wi-fi", "wi fi", "red", "contraseña", "internet"],
    check_in: ["check in", "llegada", "entrada", "portero", "código", "puerta"],
    check_out: ["check out", "salida", "dejar el piso", "llaves"],
    water: ["agua", "agua caliente", "ducha", "grifo", "potable"],
    bathroom: ["baño", "aseo", "wc", "toallas", "secador", "jabón", "papel higiénico"],
    ac: ["aire acondicionado", "ac", "calefacción"],
    gas: ["gas", "cocina", "hornilla", "llama"],
    eat: ["comer", "restaurante", "trattoria", "pizzería", "cenar", "almorzar"],
    drink: ["beber", "bar", "vino", "cóctel", "cerveza", "aperitivo"],
    shopping: ["compras", "tiendas", "supermercado", "mercado"],
    visit: ["visitar", "sitios", "monumentos", "qué ver", "paseo"],
    experiences: ["experiencias", "romántico", "paseo", "fotos", "atardecer"],
    day_trips: ["excursiones", "excursión", "ostia", "tivoli", "castelli"],
    tickets: ["entradas", "tickets", "eventos", "conciertos", "fútbol", "partido"],
    museums: ["museos", "museo", "coliseo", "vaticano", "borghese"],
    exhibitions: ["exposiciones", "exposición", "maxxi", "scuderie"],
    transport: ["transporte", "bus", "autobús", "tranvía", "metro", "aeropuerto", "taxi"],
    services: ["servicios", "farmacia", "hospital", "médico", "cajero", "atm", "lavandería", "sim"],
    emergency: ["emergencia", "emergencias", "policía", "ambulancia", "bomberos"]
  }
};

// Alias intent → nome chiave reale nel JSON (come in Arenula)
const INTENT_ALIASES = {
  shopping: ["shopping", "shop"],
  experiences: ["experiences", "experience"],
  tickets: ["tickets", "tickets_events", "tickets-events"],
  museums: ["museums", "museums_sites", "museums-sites"]
};

/**
 * Trova il miglior intent (cioè la miglior chiave del JSON)
 * usando KEYWORDS + alias + chiavi realmente presenti nel file.
 */
function findBestIntentForQuestion(language, question, answersForLang) {
  const text = normalizeText(question);
  if (!text.trim()) return null;

  const langKeywords = KEYWORDS[language] || KEYWORDS.en;

  const realKeys = Object.keys(answersForLang);
  if (realKeys.length === 0) return null;

  // mappa: chiave lowercase reale → chiave reale
  const lowerToReal = {};
  for (const k of realKeys) {
    lowerToReal[k.toLowerCase()] = k;
  }

  let bestRealKey = null;
  let bestScore   = 0;

  for (const [canonicalIntent, synonyms] of Object.entries(langKeywords)) {
    if (!Array.isArray(synonyms) || synonyms.length === 0) continue;

    // calcola score in base alle parole chiave trovate nella domanda
    let score = 0;
    for (const raw of synonyms) {
      const w = normalizeText(raw);
      if (!w) continue;
      if (text.includes(w)) score++;
    }
    if (score === 0) continue;

    // canonicalIntent → chiave reale esistente nel JSON
    const canLower = canonicalIntent.toLowerCase();

    // 1) stessa chiave
    let realKey = lowerToReal[canLower];

    // 2) prova alias (shopping → shop, tickets → tickets_events, ecc.)
    if (!realKey && INTENT_ALIASES[canLower]) {
      for (const candidate of INTENT_ALIASES[canLower]) {
        const cLow = candidate.toLowerCase();
        if (lowerToReal[cLow]) {
          realKey = lowerToReal[cLow];
          break;
        }
      }
    }

    if (!realKey) continue; // nessuna chiave reale compatibile in questo JSON

    if (score > bestScore) {
      bestScore   = score;
      bestRealKey = realKey;
    }
  }

  if (!bestRealKey || bestScore === 0) return null;
  return bestRealKey;
}

/**
 * FUNZIONE PRINCIPALE
 *   apartment: "arenula" | "scala" | "portico" | "trastevere" | "leonina"
 *   language:  "it" | "en" | "fr" | "de" | "es"  (anche "en-GB" ecc → "en")
 *   message:   testo libero dell'ospite
 *
 * Ritorna SOLO una stringa con la risposta da mandare al cliente.
 */
export async function reply({ apartment, language, message }) {
  // 1) Carica la guida giusta
  const guide = await loadGuideJson(apartment);
  if (!guide) {
    return "I’m sorry, I couldn’t find the guide for this apartment.";
  }

  // 2) lingue disponibili = chiavi di primo livello del JSON (en,it,fr,de,es)
  const availableLangs = Object.keys(guide).map((k) => k.toLowerCase());
  const lang = normalizeLang(language, availableLangs);

  // 3) blocco di risposte per la lingua scelta
  const answersForLang =
    guide[lang] ||
    guide[lang.toLowerCase()] ||
    guide.en ||
    guide.it ||
    guide[availableLangs[0]] ||
    {};

  // 4) cerco il "miglior intent" in base alle parole chiave
  const intentKey = findBestIntentForQuestion(lang, message, answersForLang);

  // 5) se non trovo nulla, provo "services", altrimenti la prima chiave
  let answer =
    (intentKey && answersForLang[intentKey]) ||
    answersForLang.services ||
    answersForLang.service;

  if (!answer) {
    const keys = Object.keys(answersForLang);
    if (keys.length > 0) {
      answer = answersForLang[keys[0]];
    }
  }

  // 6) fallback finale se proprio non c'è nulla
  if (!answer) {
    if (lang === "it") {
      answer =
        "Non ho trovato una risposta diretta. Prova uno dei pulsanti rapidi nella guida (Wi-Fi, trasporti, cosa visitare…).";
    } else {
      answer =
        "I didn’t find a direct answer. Please try one of the quick buttons in the guide (Wi-Fi, transport, what to visit…).";
    }
  }

  return answer;
}
