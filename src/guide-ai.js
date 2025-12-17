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

// =====================
// GATE — PARAMETRI
// =====================
const GATE = {
  // Lunghezza massima messaggio che può essere gestito qui (oltre → SILENZIO / lascia gestire altrove)
  MAX_MESSAGE_CHARS: 250,

  // Se non troviamo almeno questo score, SILENZIO
  MIN_MATCH_SCORE: 1,

  // Margine minimo tra best e second-best per evitare multi-intent (best-second < margin → SILENZIO)
  MIN_SCORE_MARGIN: 1,

  // Se troppi token "fuori lista" (dopo stopwords), SILENZIO
  MAX_UNKNOWN_RATIO: 0.45,

  // Ignora token troppo corti nel conteggio unknown
  MIN_TOKEN_LEN_FOR_UNKNOWN: 3
};

// Stopwords minime (non perfette, ma sufficienti per ridurre falsi “unknown”)
const STOPWORDS = {
  it: new Set(["il","lo","la","i","gli","le","un","uno","una","di","a","da","in","su","per","con","senza","e","o","ma","che","come","dove","quando","quanto","quale","quali","mi","ti","si","ci","vi","non","sono","sei","è","ho","hai","abbiamo","avete","hanno"]),
  en: new Set(["the","a","an","to","of","in","on","at","for","with","without","and","or","but","what","where","when","how","howmuch","i","you","we","they","is","are","am","do","does","did","can","could","please","hi","hello"]),
  fr: new Set(["le","la","les","un","une","des","de","du","dans","sur","à","pour","avec","sans","et","ou","mais","quoi","où","quand","comment","je","tu","il","elle","nous","vous","ils","elles","est","sont","peux","pouvez","svp","bonjour"]),
  de: new Set(["der","die","das","ein","eine","einen","einem","einer","von","in","auf","an","für","mit","ohne","und","oder","aber","was","wo","wann","wie","ich","du","wir","ihr","sie","ist","sind","kann","können","bitte","hallo"]),
  es: new Set(["el","la","los","las","un","una","unos","unas","de","del","en","sobre","a","para","con","sin","y","o","pero","que","donde","cuando","como","yo","tu","usted","nosotros","vosotros","ellos","ellas","es","son","puedo","puede","porfavor","hola"])
};

// =====================
// NORMALIZZAZIONE / TOKEN
// =====================
function normalizeText(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function tokenize(str) {
  const s = normalizeText(str);
  // prende parole/numeri “semplici”
  const m = s.match(/[a-z0-9]+/g);
  return m ? m : [];
}

// =====================
// CARICAMENTO GUIDA
// =====================
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

// =====================
// LINGUA
// =====================
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

// =====================
// KEYWORDS BASE (fallback se nel JSON non esiste guide.intents)
// =====================
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

// =====================
// ESTRAZIONE INTENTS/ANSWERS (supporta entrambi i formati JSON)
// =====================
function getAvailableLangsFromGuide(guide) {
  // Formato A: { it: {...answers...}, en: {...} }
  const topKeys = Object.keys(guide || {}).map((k) => String(k).toLowerCase());
  const langKeys = topKeys.filter((k) => ["it","en","fr","de","es"].includes(k));
  if (langKeys.length > 0) return langKeys;

  // Formato B: { languages: [...], answers: {...}, intents: {...} }
  if (Array.isArray(guide?.languages)) {
    return guide.languages.map((x) => String(x).toLowerCase().slice(0,2));
  }
  if (guide?.answers && typeof guide.answers === "object") {
    return Object.keys(guide.answers).map((k) => String(k).toLowerCase());
  }
  return [];
}

function getAnswersForLang(guide, lang, availableLangs) {
  // Formato B
  if (guide?.answers && typeof guide.answers === "object") {
    return (
      guide.answers?.[lang] ||
      guide.answers?.[lang?.toLowerCase?.()] ||
      guide.answers?.en ||
      guide.answers?.it ||
      guide.answers?.[availableLangs?.[0]] ||
      {}
    );
  }

  // Formato A
  return (
    guide?.[lang] ||
    guide?.[lang?.toLowerCase?.()] ||
    guide?.en ||
    guide?.it ||
    guide?.[availableLangs?.[0]] ||
    {}
  );
}

function getIntentsForLang(guide, lang) {
  // Se il JSON contiene intents, usa quelli (è la lista “ufficiale” per il gate)
  if (guide?.intents && typeof guide.intents === "object") {
    const map = guide.intents?.[lang] || guide.intents?.en || null;
    if (map && typeof map === "object") return map;
  }
  // fallback: KEYWORDS base
  return KEYWORDS[lang] || KEYWORDS.en;
}

// =====================
// GATE: costruzione vocabolario “ammesso” + check unknown ratio
// =====================
function buildKnownWords(lang, intentsMap, answersForLang) {
  const known = new Set();
  const sw = STOPWORDS[lang] || STOPWORDS.en;

  // 1) token da sinonimi intents
  for (const [intentKey, synonyms] of Object.entries(intentsMap || {})) {
    // intentKey stesso
    for (const t of tokenize(intentKey)) {
      if (!sw.has(t)) known.add(t);
    }

    if (!Array.isArray(synonyms)) continue;
    for (const s of synonyms) {
      for (const t of tokenize(s)) {
        if (!sw.has(t)) known.add(t);
      }
    }
  }

  // 2) token dalle chiavi risposta (utile se intentKey ≈ answerKey)
  for (const k of Object.keys(answersForLang || {})) {
    for (const t of tokenize(k)) {
      if (!sw.has(t)) known.add(t);
    }
  }

  return known;
}

function passesGate(lang, message, knownWords) {
  const raw = String(message || "");
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.length > GATE.MAX_MESSAGE_CHARS) return { ok: false, reason: "too_long" };

  const sw = STOPWORDS[lang] || STOPWORDS.en;
  const tokens = tokenize(trimmed).filter((t) => t && !sw.has(t));

  if (tokens.length === 0) return { ok: false, reason: "no_tokens" };

  let unknown = 0;
  let total   = 0;

  for (const t of tokens) {
    if (t.length < GATE.MIN_TOKEN_LEN_FOR_UNKNOWN) continue;
    total++;
    if (!knownWords.has(t)) unknown++;
  }

  // Se total è 0 (solo token corti), consideriamo “ok” (evita falsi negativi su “hi”, “ok”, ecc.)
  if (total === 0) return { ok: true, reason: "ok_short_tokens" };

  const ratio = unknown / total;
  if (ratio > GATE.MAX_UNKNOWN_RATIO) {
    return { ok: false, reason: "too_many_unknown", unknown_ratio: ratio };
  }

  return { ok: true, reason: "ok", unknown_ratio: ratio };
}

// =====================
// MATCH INTENT (1 intent max, con margin)
// =====================
function resolveRealAnswerKey(canonicalIntent, answersForLang) {
  const realKeys = Object.keys(answersForLang || {});
  if (realKeys.length === 0) return null;

  const lowerToReal = {};
  for (const k of realKeys) lowerToReal[k.toLowerCase()] = k;

  const canLower = String(canonicalIntent || "").toLowerCase();

  // 1) stessa chiave
  if (lowerToReal[canLower]) return lowerToReal[canLower];

  // 2) alias
  if (INTENT_ALIASES[canLower]) {
    for (const candidate of INTENT_ALIASES[canLower]) {
      const cLow = String(candidate).toLowerCase();
      if (lowerToReal[cLow]) return lowerToReal[cLow];
    }
  }

  return null;
}

function findBestIntent(language, question, intentsMap, answersForLang) {
  const text = normalizeText(question);
  if (!text.trim()) return null;

  let best = { key: null, score: 0 };
  let second = { key: null, score: 0 };

  for (const [canonicalIntent, synonyms] of Object.entries(intentsMap || {})) {
    if (!Array.isArray(synonyms) || synonyms.length === 0) continue;

    let score = 0;

    for (const raw of synonyms) {
      const w = normalizeText(raw);
      if (!w) continue;

      // peso leggermente maggiore per frasi multi-parola
      const isPhrase = w.includes(" ");
      if (text.includes(w)) score += isPhrase ? 2 : 1;
    }

    if (score <= 0) continue;

    const realKey = resolveRealAnswerKey(canonicalIntent, answersForLang) || canonicalIntent;
    // accetta solo se esiste davvero una risposta (evita “intent orfani”)
    if (!answersForLang || typeof answersForLang[realKey] !== "string") continue;

    if (score > best.score) {
      second = best;
      best = { key: realKey, score };
    } else if (score > second.score) {
      second = { key: realKey, score };
    }
  }

  if (!best.key || best.score < GATE.MIN_MATCH_SCORE) return null;

  // max 1 intent: se troppo vicino al secondo, SILENZIO
  if (best.score - second.score < GATE.MIN_SCORE_MARGIN) return null;

  return best.key;
}

/**
 * FUNZIONE PRINCIPALE
 *   apartment: "arenula" | "scala" | "portico" | "trastevere" | "leonina"
 *   language:  "it" | "en" | "fr" | "de" | "es"  (anche "en-GB" ecc → "en")
 *   message:   testo libero dell'ospite
 *
 * Ritorna:
 *   - stringa (risposta)
 *   - null (SILENZIO: non rispondere)
 */
export async function reply({ apartment, language, message }) {
  // 1) Carica la guida giusta
  const guide = await loadGuideJson(apartment);
  if (!guide) {
    // se guida assente, SILENZIO (evita risposte generiche sbagliate)
    return null;
  }

  // 2) lingue disponibili
  const availableLangs = getAvailableLangsFromGuide(guide);
  const lang = normalizeLang(language, availableLangs.length ? availableLangs : ["en"]);

  // 3) risposte + intents (se presenti nel JSON, altrimenti fallback KEYWORDS)
  const answersForLang = getAnswersForLang(guide, lang, availableLangs);
  const intentsMap     = getIntentsForLang(guide, lang);

  // Se non ci sono risposte, SILENZIO
  if (!answersForLang || Object.keys(answersForLang).length === 0) return null;

  // 4) GATE: se testo troppo lungo o troppo “fuori lista”, SILENZIO
  const known = buildKnownWords(lang, intentsMap, answersForLang);
  const gate  = passesGate(lang, message, known);
  if (!gate.ok) return null;

  // 5) 1 intent max: scegliamo SOLO se match forte + margin
  const intentKey = findBestIntent(lang, message, intentsMap, answersForLang);
  if (!intentKey) return null;

  const answer = answersForLang[intentKey];
  if (!answer || typeof answer !== "string" || !answer.trim()) return null;

  return answer;
}
