// matcher.js — Intent Matching FULL PHRASE + SCORING (NO SILENT BUG)

const INTENTS = {
  wifi: [
    "wifi", "wi fi", "wi-fi", "internet", "password", "router", "rete",
    "connessione", "connettermi", "collegarmi",
    "qual è la password", "qual'è la password", "quale password",
    "what is the password", "wifi password", "how do i connect",
    "contraseña wifi", "clave wifi",
    "mot de passe", "mot de passe wifi",
    "passwort", "wlan"
  ],

  trash: [
    "spazzatura", "rifiuti", "immondizia", "pattumiera",
    "dove butto", "dove si butta", "raccolta differenziata",
    "trash", "garbage", "rubbish", "waste",
    "basura",
    "déchets", "poubelle",
    "müll", "abfall"
  ],

  heating: [
    "riscaldamento", "termostato", "fa freddo", "ho freddo",
    "heating", "heater", "it's cold", "i am cold",
    "calefacción", "hace frío",
    "chauffage", "j'ai froid",
    "heizung", "mir ist kalt"
  ],

  electric_panel: [
    "corrente", "è saltata la corrente", "quadro elettrico", "salvavita",
    "blackout", "no power", "power is out",
    "no hay luz",
    "coupure de courant",
    "kein strom"
  ],

  check_in: [
    "check in", "check-in", "arrivo", "come entro",
    "arrival", "how do i get in",
    "llegada",
    "arrivée",
    "ankunft"
  ],

  check_out: [
    "check out", "check-out", "partenza",
    "where do i leave the keys",
    "salida",
    "départ",
    "abreise"
  ],

  city_tax_info: [
    "tassa di soggiorno", "city tax", "tourist tax",
    "quanto devo pagare", "how much is the city tax",
    "tasa turística",
    "taxe de séjour",
    "kurtaxe"
  ],

  laundry: [
    "lavatrice", "lavanderia", "lavare i vestiti",
    "washing machine", "laundry",
    "lavadora",
    "machine à laver",
    "waschmaschine"
  ],

  building: [
    "indirizzo", "citofono", "portone", "numero civico",
    "address", "intercom",
    "dirección",
    "adresse",
    "adresse gebäude"
  ],

  emergency: [
    "emergenza", "urgente", "non funziona", "è rotto",
    "emergency", "urgent", "broken", "not working",
    "emergencia",
    "urgence",
    "notfall"
  ],

  air_conditioning: [
    "aria condizionata", "condizionatore", "climatizzatore",
    "air conditioning", "air conditioner", "ac",
    "aire acondicionado",
    "climatisation",
    "klimaanlage"
  ],

  parking: [
    "parcheggio", "dove parcheggio", "garage",
    "parking", "where can i park",
    "aparcamiento",
    "stationnement",
    "parkplatz"
  ],

  restaurants: [
    "ristorante", "dove mangiare", "pizzeria",
    "restaurant", "where to eat",
    "restaurante",
    "où manger",
    "wo essen"
  ],

  shopping: [
    "shopping", "negozi", "supermercato",
    "store", "shop",
    "tienda",
    "magasin",
    "geschäft"
  ],

  attractions: [
    "cosa visitare", "cosa vedere", "musei", "monumenti",
    "what to see", "attractions",
    "que ver",
    "quoi voir",
    "sehenswürdigkeiten"
  ],

  tickets: [
    "biglietti", "prenotare", "colosseo", "vaticano",
    "tickets", "book tickets",
    "entradas",
    "billets",
    "karten"
  ]
};

// =========================
// NORMALIZZAZIONE TESTO
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
// MATCH INTENT CON SCORING
// =========================
export function matchIntent(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = normalize(text);
  const words = normalized.split(" ");

  let bestIntent = null;
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENTS)) {
    let score = 0;

    for (const keyword of keywords) {
      const kw = normalize(keyword);
      const kwWords = kw.split(" ");

      // Frase intera → segnale forte
      if (kwWords.length > 1) {
        if (normalized.includes(kw)) {
          score += 3;
        }
      }
      // Parola singola → segnale debole
      else {
        if (words.includes(kwWords[0])) {
          score += 1;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  // soglia minima per evitare rumore
  if (bestScore < 2) return null;

  return bestIntent;
}
