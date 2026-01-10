// matcher.js - Intent Matching (EXPANDED)

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
air_conditioning: [
  "aria condizionata", "condizionatore", "climatizzatore", "raffreddamento",
  "fa caldo", "ho caldo", "rinfrescare", "raffreddare",
  "accendere aria", "spegnere aria", "telecomando aria",
  "air conditioning", "ac", "a/c", "cooling", "cool", "it's hot", "i am hot",
  "aire acondicionado", "acondicionado", "hace calor", "tengo calor",
  "climatisation", "il fait chaud", "j'ai chaud",
  "klimaanlage", "es ist heiß", "mir ist heiß"
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
] ,

  electric_panel: [
    "corrente", "elettricità", "luce", "luci", "interruttore",
    "quadro elettrico", "salvavita", "contatore",
    "è saltata la corrente", "non c'è corrente", "blackout",
    "manca corrente", "non funziona la luce", "salta corrente",
    "dove è il quadro", "dov'è il quadro",
    "electric", "electricity", "power", "lights", "light",
    "circuit breaker", "fuse box", "no power", "power is out",
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
  hot_water: [
    "acqua calda", "non c'è acqua calda", "doccia fredda",
    "boiler", "scaldabagno", "acqua fredda",
    "hot water", "no hot water", "cold shower",
    "water heater",
    "agua caliente", "no hay agua caliente", "ducha fría",
    "calentador", "termo",
    "eau chaude", "pas d'eau chaude", "douche froide",
    "chauffe-eau",
    "warmes wasser", "kein warmes wasser", "kalte dusche",
    "wasserheizer"
  ],

  gas_cooking: [
    "gas", "fornelli", "piano cottura",
    "fornello non si accende", "non esce gas",
    "stove", "cooktop", "burner not working", "no gas",
    "fogones", "placa", "no funciona el gas",
    "gaz", "cuisinière", "plaque",
    "herd", "kochfeld", "gas funktioniert nicht"
  ],

  water_supply: [
    "acqua", "non c'è acqua", "manca acqua",
    "pressione bassa", "poca acqua",
    "water", "no water", "low pressure",
    "agua", "no hay agua", "poca presión",
    "eau", "pas d'eau", "pression basse",
    "wasser", "kein wasser", "niedriger druck"
  ],

  front_door: [
    "porta di casa", "porta ingresso",
    "non si apre", "non si chiude",
    "chiave", "serratura",
    "front door", "entrance door",
    "won't open", "won't close", "key", "lock",
    "puerta", "puerta de entrada",
    "no se abre", "no se cierra", "llave", "cerradura",
    "porte", "porte d'entrée",
    "ne s'ouvre pas", "ne se ferme pas", "clé", "serrure",
    "tür", "eingangstür",
    "öffnet nicht", "schließt nicht", "schlüssel", "schloss"
  ],

  appliances: [
    "elettrodomestici", "frigo", "forno", "microonde",
    "non funziona", "rotto", "non si accende",
    "appliances", "fridge", "oven", "microwave",
    "not working", "broken", "won't turn on",
    "electrodomésticos", "nevera", "horno", "microondas",
    "no funciona", "roto", "no enciende",
    "électroménagers", "frigo", "four", "micro-ondes",
    "ne fonctionne pas", "cassé", "ne s'allume pas",
    "haushaltsgeräte", "kühlschrank", "ofen", "mikrowelle",
    "funktioniert nicht", "kaputt", "geht nicht an"
  ],

  tv: [
    "televisione", "tv",
    "non si accende", "telecomando", "schermo nero",
    "television", "remote control", "black screen",
    "televisión", "mando", "pantalla negra",
    "télévision", "télécommande", "écran noir",
    "fernseher", "fernbedienung", "schwarzer bildschirm"
  ]
};

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function matchIntent(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = normalize(text);

  for (const [intent, keywords] of Object.entries(INTENTS)) {
    for (const keyword of keywords) {
      const keywordNormalized = normalize(keyword);
      if (normalized.includes(keywordNormalized)) {
        return intent;
      }
    }
  }

  return null;
}
