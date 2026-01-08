// Intent whitelist + parole chiave essenziali
const INTENTS = {
  wifi: [
    "wifi", "wi fi", "internet", "password", "router"
  ],
  trash: [
    "trash", "garbage", "rubbish", "spazzatura", "rifiuti",
    "déchets", "müll", "basura"
  ],
  heating: [
    "heating", "heater", "heat", "riscaldamento",
    "chauffage", "heizung", "calefacción"
  ],
  electric_panel: [
    "electric", "electricity", "power", "quadro", "corrente",
    "électricité", "strom"
  ],
  check_in: [
    "check in", "check-in", "arrival", "arrivo",
    "arrivée", "llegada"
  ],
  check_out: [
    "check out", "check-out", "departure", "checkout",
    "partenza", "départ", "salida"
  ],
  city_tax_info: [
    "city tax", "tourist tax", "tassa di soggiorno",
    "taxe de séjour", "kurtaxe"
  ],
  laundry: [
    "laundry", "lavanderia", "laverie",
    "wasch", "lavandería"
  ],
  building: [
    "building", "edificio", "immeuble",
    "gebäude", "portal"
  ],
  emergency: [
    "emergency", "emergenza", "urgence",
    "notfall", "emergencia"
  ]
};

export function matchIntent(text) {
  if (!text || typeof text !== "string") return null;

  const t = text.toLowerCase();

  for (const [intent, keywords] of Object.entries(INTENTS)) {
    if (keywords.some(k => t.includes(k))) {
      return intent;
    }
  }
  return null;
}
