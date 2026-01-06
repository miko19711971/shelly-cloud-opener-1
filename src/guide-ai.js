 import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const GUIDES_DIR = path.join(__dirname, "..", "public", "guides-v2");

// 1. Rilevatore universale di lingua (parole neutre che definiscono la lingua)
const LANG_MARKERS = {
  en: ["the", "is", "where", "how", "thanks", "please", "my", "to"],
  it: ["il", "la", "dove", "come", "grazie", "per", "sono", "nel"],
  fr: ["le", "la", "est", "ou", "merci", "pour", "dans", "avez"],
  es: ["el", "la", "donde", "como", "gracias", "para", "esta", "hay"],
  de: ["der", "die", "das", "ist", "wo", "danke", "bitte", "fur"]
};

export async function reply({ apartment, message }) {
  try {
    // Carica il JSON dell'appartamento
    const filePath = path.join(GUIDES_DIR, `${apartment.toLowerCase()}.json`);
    const fileContent = await fs.readFile(filePath, "utf8");
    const guide = JSON.parse(fileContent);

    const text = message.toLowerCase();

    // 2. DETERMINA LA LINGUA DALLA FRASE
    let detectedLang = "en"; // Default
    let topScore = 0;

    for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
      let score = markers.filter(m => text.includes(m)).length;
      if (score > topScore) {
        topScore = score;
        detectedLang = lang;
      }
    }

    // 3. TROVA L'INTENT (Sfrutta gli "intents" che hai già nel tuo JSON)
    const langIntents = guide.intents[detectedLang] || guide.intents.en;
    const langAnswers = guide.answers[detectedLang] || guide.answers.en;
    
    let foundIntent = null;

    for (const [intentName, keywords] of Object.entries(langIntents)) {
      if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
        foundIntent = intentName;
        break; 
      }
    }

    // 4. RESTITUISCI LA RISPOSTA
    if (foundIntent && langAnswers[foundIntent]) {
      return langAnswers[foundIntent];
    }

    // Fallback se non capisce il tema: Wi-Fi o la prima risposta disponibile
    return langAnswers.wifi || langAnswers.check_in || Object.values(langAnswers)[0];

  } catch (error) {
    console.error("Errore nel motore AI:", error);
    return "I'm sorry, I'm having trouble accessing the guide. Please try again later.";
  }
}
