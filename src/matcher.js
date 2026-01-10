 // matcher.js - Intent Matching con Word Boundaries

const INTENTS = {
  wifi: [
    "wifi", "wi-fi", "wi fi", "internet", "password", "router", "rete",
    "connessione", "connettermi", "collegarmi", "connesso", "collegato",
    "qual è la password", "qual'è la password", "quale password",
    "come mi collego", "codice wifi", "nome rete", "ssid",
    "what is the password", "wifi password", "how do i connect",
    "contraseña", "cual es la contraseña", "clave wifi",
    "mot de passe", "quel est le mot de passe",
    "passwort", "wlan", "wie verbinde ich"
  ],

  trash: [
    "spazzatura", "rifiuti", "immondizia", "pattumiera", "cestino",
    "dove butto", "dove metto", "dove posso buttare", "dove si butta",
    "raccolta", "differenziata", "cassonetti", "bidoni", "sacchetti",
    "isola ecologica", "buttare via", "gettare",
    "trash", "garbage", "rubbish", "waste", "bin", "bins",
    "where do i throw", "where can i throw", "where do i put",
    "basura", "donde tiro", "donde pongo",
    "déchets", "poubelle", "où jeter",
    "müll", "abfall", "wo werfe ich"
  ],

  heating: [
    "riscaldamento", "stufa", "caldo", "temperatura",
    "come scaldo", "come riscaldo", "accendere", "spegnere",
    "termostato", "fa freddo", "ho freddo",
    "heating", "heater", "heat", "warm", "temperature",
    "thermostat", "it's cold", "i am cold",
    "calefacción", "calor", "tengo frío", "hace frío",
    "chauffage", "chaud", "j'ai froid", "il fait froid",
    "heizung", "warm", "kalt", "mir ist kalt"
  ],

  electric_panel: [
    "corrente", "elettricità", "luce", "luci", "interruttore",
    "quadro elettrico", "salvavita", "contatore",
    "è saltata la corrente", "non c'è corrente", "blackout",
    "manca corrente", "non funziona la luce", "salta corrente",
    "dove è il quadro", "dov'è il quadro",
    "electric", "electricity", "power", "circuit breaker",
    "fuse box", "no power", "power is out",
    "electricidad", "luz", "no hay luz",
    "électricité", "courant", "lumière",
    "strom", "licht", "kein strom"
  ],

  check_in: [
    "check in", "check-in", "checkin", "arrivo", "arrivare",
    "entrare", "entrata", "come arrivo", "quando arrivo",
    "accesso", "come entro", "apertura", "orario arrivo",
    "ingresso", "come si entra", "a che ora posso arrivare",
    "arrival", "arrive", "arriving", "access", "entry",
    "how do i get in", "how do i enter", "what time can i arrive",
    "llegada", "llegar", "como entro",
    "arrivée", "arriver", "comment entrer",
    "ankunft", "ankommen", "wie komme ich rein"
  ],

  check_out: [
    "check out", "check-out", "checkout", "partenza", "partire",
    "uscita", "quando devo lasciare", "quando esco",
    "dove lascio le chiavi", "dove metto le chiavi",
    "orario partenza", "a che ora devo lasciare",
    "departure", "leave", "leaving", "what time do i leave",
    "where do i leave keys", "where do i put keys",
    "salida", "salir", "donde dejo llaves",
    "départ", "partir", "où laisser clés",
    "abreise", "wo lasse ich schlüssel"
  ],

  city_tax_info: [
    "tassa", "tassa di soggiorno", "city tax", "tourist tax",
    "quanto costa", "quanto devo pagare", "devo pagare",
    "costo", "prezzo", "imposta", "quanto è",
    "how much", "cost", "do i have to pay", "price",
    "tasa turística", "cuanto cuesta", "tengo que pagar",
    "taxe de séjour", "combien coûte",
    "kurtaxe", "wie viel kostet"
  ],

  laundry: [
    "lavanderia", "lavatrice", "lavare", "lavare i vestiti",
    "dove posso lavare", "dove lavo", "bucato", "panni",
    "come si usa lavatrice", "dove è lavatrice",
    "laundry", "washing machine", "wash", "clothes",
    "where can i wash", "laundromat",
    "lavandería", "lavadora", "lavar", "donde lavo",
    "laverie", "machine à laver", "laver",
    "waschsalon", "waschmaschine", "waschen"
  ],

  building: [
    "edificio", "palazzo", "indirizzo", "dove si trova",
    "dove è", "come si chiama via", "citofono", "campanello",
    "portone", "ingresso principale", "numero civico", "via",
    "building", "address", "where is", "location",
    "intercom", "doorbell", "entrance", "street number",
    "dirección", "donde esta", "calle",
    "immeuble", "adresse", "où est", "rue",
    "gebäude", "adresse", "wo ist", "straße"
  ],

  emergency: [
    "emergenza", "aiuto", "problema", "urgente", "subito",
    "non funziona", "rotto", "guasto", "numero di emergenza",
    "chiamare", "contattare", "sos", "help", "c'è un problema",
    "ho un problema", "è rotto", "si è rotto", "non va",
    "emergency", "urgent", "broken", "not working",
    "there is a problem", "i have a problem",
    "emergencia", "ayuda", "problema", "urgente", "roto",
    "urgence", "aide", "problème", "cassé",
    "notfall", "hilfe", "problem", "kaputt"
  ],

  air_conditioning: [
    "aria condizionata", "condizionatore", "climatizzatore", "aria",
    "accendere aria", "spegnere aria", "ac", "a/c", "clima",
    "air conditioning", "air conditioner", "ac unit", "cooling",
    "turn on ac", "turn off ac",
    "aire acondicionado", "encender aire", "apagar aire",
    "climatisation", "clim", "allumer clim", "éteindre clim",
    "klimaanlage", "klima", "klimaanlage einschalten"
  ],

  parking: [
    "parcheggio", "parcheggiare", "auto", "macchina", "dove parcheggio",
    "posso parcheggiare", "parcheggio auto", "posto auto", "garage",
    "dove metto l'auto", "dove metto la macchina", "ztl",
    "parking", "park", "car", "where can i park", "where to park",
    "parking spot", "parking space", "can i park", "where do i park",
    "aparcamiento", "aparcar", "coche", "donde aparcar", "donde puedo aparcar",
    "estacionamiento", "estacionar", "garaje",
    "où garer", "où puis-je garer", "voiture", "stationnement",
    "stationner", "garage", "où se garer",
    "parkplatz", "parken", "wo parken", "wo kann ich parken",
    "parkhaus", "wo parkieren"
  ]
};

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ") // Sostituisce punteggiatura con spazi
    .trim();
}

export function matchIntent(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = normalize(text);
  const words = normalized.split(/\s+/); // Split in parole

  for (const [intent, keywords] of Object.entries(INTENTS)) {
    for (const keyword of keywords) {
      const keywordNormalized = normalize(keyword);
      const keywordWords = keywordNormalized.split(/\s+/);

      // Match esatto di frasi multi-parola
      if (keywordWords.length > 1) {
        if (normalized.includes(keywordNormalized)) {
          return intent;
        }
      } 
      // Match esatto di singole parole (evita substring match)
      else {
        if (words.includes(keywordWords[0])) {
          return intent;
        }
      }
    }
  }

  return null;
}
