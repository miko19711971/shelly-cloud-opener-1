import { franc } from "franc";

// mappa ISO-639-3 → lingua che usiamo noi
const LANG_MAP = {
  ita: "it",
  eng: "en",
  fra: "fr",
  deu: "de",
  spa: "es"
};

export function detectLanguage(text) {
  if (!text || typeof text !== "string") return null;

  // franc analizza TUTTO il testo
  const lang3 = franc(text);

  if (!LANG_MAP[lang3]) return null;

  return LANG_MAP[lang3];
}
