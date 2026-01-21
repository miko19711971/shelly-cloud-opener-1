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
    "trash", "garbage", "basura", "déchets", "müll"
  ],

  heating: [
    "riscaldamento", "termostato", "fa freddo",
    "heating", "heater", "chauffage", "heizung"
  ],

  electric_panel: [
    "corrente", "quadro elettrico", "salvavita",
    "blackout", "no power", "kein strom"
  ],

  check_in: [
    "check in", "check-in", "arrivo", "come entro",
    "arrival", "llegada", "arrivée"
  ],

  check_out: [
    "check out", "check-out", "partenza",
    "departure", "salida", "départ"
  ],

  city_tax_info: [
    "tassa di soggiorno", "city tax", "tourist tax",
    "taxe de séjour", "kurtaxe"
  ],

  laundry: [
    "lavatrice", "lavanderia",
    "washing machine", "laundry"
  ],

  building: [
    "indirizzo", "citofono", "portone",
    "address", "intercom"
  ],

  emergency: [
    "emergenza", "urgente", "rotto", "non funziona",
    "emergency", "urgent", "not working"
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
  "fuite d eau", "fuite d eau", "eau qui coule",
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
    "parcheggio", "garage", "parking"
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
    "biglietti", "prenotare",
    "tickets", "book tickets"
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
  fr: ["que", "comment", "ou"],
  es: ["que", "como", "donde"],
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
// MATCH INTENT (DECISIVO)
// =========================
export function matchIntent(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = normalize(text);
  const words = normalized.split(" ");
  const language = detectLanguage(text);

  // 🔒 STRICT: priorità assoluta
  for (const [intent, keywords] of Object.entries(STRICT_INTENTS)) {
    if (matchKeywords(normalized, words, keywords) >= 1) {
      return {
        intent,
        language,
        type: "STRICT",
        route: "INTERNAL_AI"
      };
    }
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
