// matcher.js — STRICT vs SOFT (ROUTING DEFINITIVO)

// =========================
// INTENTI STRICT (MAI GEMINI)
// =========================
const STRICT_INTENTS = {
  wifi: [
    "wifi", "wi fi", "wi-fi",  "Wifi", "internet", "password", "router",
    "qual è la password", "what is the password", "wifi password",
    "mot de passe", "passwort", "wlan"
  ],

  fire: [
    // IT
    "fuoco", "incendio", "fiamme", "brucia", "sta bruciando",
    "odore di bruciato", "fumo", "scintille",
    // EN
    "fire", "flames", "burning", "smoke", "smell of burning",
    // ES
    "fuego", "incendio", "llamas", "humo", "olor a quemado",
    // FR
    "feu", "incendie", "flammes", "fumee", "odeur de brule",
    // DE
    "feuer", "brand", "flammen", "rauch", "brandgeruch"
  ],

  trash: [
    "spazzatura", "rifiuti", "immondizia", "pattumiera",
    "trash", "garbage", "waste", "recycling", "bins", "basura", "déchets", "müll"
  ],

  heating: [
    "riscaldamento", "termostato", "fa freddo",
    "heating", "heater", "calefaccion", "hace frio", "chauffage", "heizung"
  ],

  electric_panel: [
    "corrente", "quadro elettrico", "salvavita",
    "blackout", "no power", "sin luz", "no hay luz", "pas d electricite", "kein strom", "stromausfall"
  ],

  check_in: [
    "check in", "check-in", "arrivo", "come entro",
    "arrival", "llegada", "arrivee", "ankunft", "einchecken"
  ],

  check_out: [
    "check out", "check-out", "partenza",
    "departure", "salida", "depart", "abreise", "auschecken"
  ],

  city_tax_info: [
    "tassa di soggiorno", "city tax", "tourist tax",
    "taxe de séjour", "kurtaxe"
  ],

  laundry: [
    "lavatrice", "lavanderia",
    "washing machine", "laundry", "lavadora", "machine a laver", "waschmaschine"
  ],

  // ✅ SPOSTATO QUI (PRIMA DI building)
  apartment_info: [
    // EN
    "apartment address",
    "address of the apartment",
    "where is the apartment",
    "where is the flat",
    "what is the address",
    "exact address",
    "apartment location",
    "flat location",

    // IT
    "indirizzo dell appartamento",
    "indirizzo dell alloggio",
    "qual è l indirizzo",
    "dove si trova l appartamento",
    "posizione dell appartamento",

    // FR
    "adresse de l appartement",
    "ou se trouve l appartement",
    "adresse exacte",

    // ES
    "direccion del apartamento",
    "donde esta el apartamento",
    "ubicacion del apartamento",

    // DE
    "adresse der wohnung",
    "wo ist die wohnung",
    "standort der wohnung"
  ],

  building: [
    "indirizzo", "citofono", "portone",
    "address", "intercom"
  ],

  emergency: [
    "emergenza", "urgente", "aiuto", "soccorso",
    "emergency", "urgent", "help me", "need help",
    "emergencia", "ayuda", "socorro",
    "urgence", "au secours",
    "notfall", "hilfe"
  ],

  malfunction: [
    "non funziona", "rotto", "guasto",
    "not working", "broken",
    "no funciona", "roto",
    "ne fonctionne pas",
    "funktioniert nicht", "kaputt"
  ],

  air_conditioning: [
    "aria condizionata", "condizionatore",
    "air conditioning", "climatisation", "klimaanlage"
  ],

  gas_leak: [
    // IT
    "fuga di gas", "odore di gas", "perdita di gas", "gas che esce",
    // EN
    "gas leak", "smell of gas", "gas smell", "gas leaking",
    // ES
    "fuga de gas", "olor a gas", "perdida de gas",
    // FR
    "fuite de gaz", "odeur de gaz", "gaz qui fuit",
    // DE
    "gasleck", "gasgeruch", "gasaustritt"
  ],

  water_leak: [
    // IT
    "perdita d acqua", "perdita di acqua", "acqua che perde", "allagamento",
    // EN
    "water leak", "water leaking", "flood", "leak of water",
    // ES
    "fuga de agua", "perdida de agua", "agua que gotea",
    // FR
    "fuite d eau", "eau qui coule",
    // DE
    "wasserleck", "wasseraustritt", "wasser tritt aus"
  ],

  lost_keys: [
    // IT
    "ho perso le chiavi", "chiavi perse", "perso le chiavi",
    // EN
    "lost keys", "i lost the keys", "missing keys",
    // ES
    "perdi las llaves", "llaves perdidas", "he perdido las llaves",
    // FR
    "j ai perdu les cles", "cles perdues", "perdu les cles",
    // DE
    "schlussel verloren", "ich habe die schlussel verloren", "verlorene schlussel"
  ]
};

// =========================
// INTENTI SOFT (SOLO GEMINI)
// =========================
const SOFT_INTENTS = {
  parking: [
    "parcheggio", "dove parcheggio",
    "parking", "where to park",
    "stationnement",
    "estacionamiento", "donde aparcar"
  ],
  restaurants: [
    "ristorante", "dove mangiare", "pizzeria",
    "restaurant", "where to eat"
  ],
  shopping: [
    "shopping", "negozi", "supermercato",
    "store", "shop"
  ],
  attractions: [
    "cosa visitare", "cosa vedere", "musei",
    "what to see", "attractions"
  ],
  tickets: [
    "biglietti", "prenotare visita",
    "tickets", "book tickets",
    "billets", "entradas"
  ],
  transport: [
    "autobus", "metro", "taxi", "come ci arrivo",
    "bus", "subway", "how to get there",
    "transporte publico",
    "wie komme ich hin"
  ],
  nightlife: [
    "bar", "aperitivo", "discoteca",
    "nightlife", "night out",
    "nachtleben"
  ]
};

// =========================
// NORMALIZZAZIONE
// =========================
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =========================
// LINGUA (SEMPLICE, STABILE)
// =========================
const LANG = {
  it: ["come", "dove", "quando", "quanto"],
  en: ["what", "how", "where", "when"],
  fr: ["comment", "merci", "pourquoi", "bonjour"],
  es: ["que", "como", "donde", "gracias", "hola"],
  de: ["was", "wie", "wo"]
};

function detectLanguage(text) {
  const words = normalize(text).split(" ");
  let best = "en";
  let score = 0;

  for (const [lang, keys] of Object.entries(LANG)) {
    let s = keys.filter(k => words.includes(k)).length;
    if (s > score) {
      score = s;
      best = lang;
    }
  }
  return best;
}

// =========================
// MATCHING
// =========================
function matchKeywords(normalized, words, keywords) {
  let score = 0;

  for (const k of keywords) {
    const kw = normalize(k);
    if (kw.includes(" ")) {
      if (normalized.includes(kw)) score += 3;
    } else {
      if (words.includes(kw)) score += 2;
    }
  }
  return score;
}

// =========================
// RILEVAMENTO TIPO MESSAGGIO
// Restituisce false se il testo e una semplice affermazione
// senza domanda ne richiesta — in quel caso il sistema non risponde
// =========================

// Intent STRICT che vanno gestiti SEMPRE (anche senza domanda esplicita)
const ALWAYS_RESPOND = new Set([
  "fire", "gas_leak", "water_leak", "emergency", "malfunction",
  "lost_keys", "electric_panel"
]);

// isActionable: restituisce true se il messaggio e una domanda, richiesta o ringraziamento
// restituisce false per semplici affermazioni (es: "sono arrivato", "vado al ristorante")
function isActionable(text) {
  if (!text) return false;

  // 1. Ha il punto interrogativo
  if (text.includes("?")) return true;

  const normalized = normalize(text);
  const words = normalized.split(" ");
  const first = words[0];

  // 2. Inizia con parola interrogativa (5 lingue)
  const QUESTION_STARTS = [
    "come", "dove", "quando", "quanto", "cosa", "chi", "qual", "quale", "perche",
    "how", "where", "when", "what", "who", "which", "why", "can", "could",
    "is", "are", "do", "does", "will", "would", "have", "has",
    "como", "donde", "cuando", "que", "quien", "puede", "cuanto",
    "comment", "ou", "quand", "quoi", "pourquoi", "pouvez", "est",
    "wie", "wo", "wann", "was", "wer", "kann", "gibt", "haben"
  ];
  if (QUESTION_STARTS.includes(first)) return true;

  // 3. Contiene pattern di richiesta
  const REQUEST_PHRASES = [
    "ho bisogno", "mi serve", "mi servirebbe", "come faccio", "come si fa",
    "c e", "ci sono", "avete", "potresti", "potete", "vorrei",
    "i need", "i want", "can you", "could you", "do you have",
    "is there", "are there", "would you", "help me",
    "necesito", "quiero", "tienen", "podria",
    "je voudrais", "j ai besoin", "est ce que", "y a t il", "pouvez vous",
    "ich brauche", "ich mochte", "konnen sie", "gibt es", "haben sie"
  ];
  for (const phrase of REQUEST_PHRASES) {
    const p = normalize(phrase);
    if (p.includes(" ") ? normalized.includes(p) : words.includes(p)) return true;
  }

  // 4. Ringraziamento o feedback positivo -> risponde con cortesia
  const THANKS_WORDS = [
    "grazie", "perfetto", "ottimo", "benissimo", "fantastico", "meraviglioso",
    "thank", "thanks", "perfect", "wonderful", "amazing", "great", "excellent",
    "merci", "parfait",
    "gracias", "perfecto",
    "danke", "perfekt"
  ];
  if (THANKS_WORDS.some(w => words.includes(normalize(w)))) return true;

  // 5. Nessun indicatore -> affermazione semplice, non rispondere
  return false;
}

// =========================
// RILEVAMENTO TIPO MESSAGGIO
// Restituisce false se il testo e una semplice affermazione
// senza domanda ne richiesta — in quel caso il sistema non risponde
// =========================

// Intent STRICT che vanno gestiti SEMPRE (anche senza domanda esplicita)
const ALWAYS_RESPOND = new Set([
  "fire", "gas_leak", "water_leak", "emergency", "malfunction",
  "lost_keys", "electric_panel"
]);

// isActionable: restituisce true se il messaggio e una domanda, richiesta o ringraziamento
// restituisce false per semplici affermazioni (es: "sono arrivato", "vado al ristorante")
function isActionable(text) {
  if (!text) return false;

  // 1. Ha il punto interrogativo
  if (text.includes("?")) return true;

  const normalized = normalize(text);
  const words = normalized.split(" ");
  const first = words[0];

  // 2. Inizia con parola interrogativa (5 lingue)
  const QUESTION_STARTS = [
    "come", "dove", "quando", "quanto", "cosa", "chi", "qual", "quale", "perche",
    "how", "where", "when", "what", "who", "which", "why", "can", "could",
    "is", "are", "do", "does", "will", "would", "have", "has",
    "como", "donde", "cuando", "que", "quien", "puede", "cuanto",
    "comment", "ou", "quand", "quoi", "pourquoi", "pouvez", "est",
    "wie", "wo", "wann", "was", "wer", "kann", "gibt", "haben"
  ];
  if (QUESTION_STARTS.includes(first)) return true;

  // 3. Contiene pattern di richiesta
  const REQUEST_PHRASES = [
    "ho bisogno", "mi serve", "mi servirebbe", "come faccio", "come si fa",
    "c e", "ci sono", "avete", "potresti", "potete", "vorrei",
    "i need", "i want", "can you", "could you", "do you have",
    "is there", "are there", "would you", "help me",
    "necesito", "quiero", "tienen", "podria",
    "je voudrais", "j ai besoin", "est ce que", "y a t il", "pouvez vous",
    "ich brauche", "ich mochte", "konnen sie", "gibt es", "haben sie"
  ];
  for (const phrase of REQUEST_PHRASES) {
    const p = normalize(phrase);
    if (p.includes(" ") ? normalized.includes(p) : words.includes(p)) return true;
  }

  // 4. Ringraziamento o feedback positivo -> risponde con cortesia
  const THANKS_WORDS = [
    "grazie", "perfetto", "ottimo", "benissimo", "fantastico", "meraviglioso",
    "thank", "thanks", "perfect", "wonderful", "amazing", "great", "excellent",
    "merci", "parfait",
    "gracias", "perfecto",
    "danke", "perfekt"
  ];
  if (THANKS_WORDS.some(w => words.includes(normalize(w)))) return true;

  // 5. Nessun indicatore -> affermazione semplice, non rispondere
  return false;
}

// =========================
// MATCH INTENT (DECISIVO)
// =========================
export function matchIntent(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = normalize(text);
  const words = normalized.split(" ");
  const language = detectLanguage(text);

  // 🔒 STRICT: priorita assoluta — risponde sempre (anche senza domanda)
  for (const [intent, keywords] of Object.entries(STRICT_INTENTS)) {
    if (matchKeywords(normalized, words, keywords) >= 2) {
      return {
        intent,
        language,
        type: "STRICT",
        route: ALWAYS_RESPOND.has(intent) ? "INTERNAL_AI" : "INTERNAL_AI"
      };
    }
  }

  // 🔇 STATEMENT: affermazione senza domanda ne richiesta -> silenzio
  if (!isActionable(text)) {
    return {
      intent: null,
      language,
      type: "STATEMENT",
      route: "IGNORE"
    };
  }

  // 🌐 SOFT: delegati a Gemini
  let bestIntent = null;
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(SOFT_INTENTS)) {
    const score = matchKeywords(normalized, words, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  if (bestScore >= 2) {
    return {
      intent: bestIntent,
      language,
      type: "SOFT",
      route: "GEMINI"
    };
  }

  // fallback totale → Gemini
  return {
    intent: null,
    language,
    type: "NONE",
    route: "GEMINI"
  };
}
