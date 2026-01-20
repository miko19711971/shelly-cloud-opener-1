// src/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * FALLBACK SICURO
 * (non usare modelli "latest" o "exp")
 */
let CURRENT_GEMINI_MODEL = "gemini-1.5-pro";

/**
 * Rileva i modelli Gemini REALMENTE disponibili
 * sull'API Generative Language
 */
async function detectGeminiModel() {
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?key=" +
        process.env.GEMINI_API_KEY
    );

    const json = await res.json();

    if (!json?.models) {
      console.log("⚠️ Gemini: nessun modello restituito, uso fallback");
      return;
    }

    /**
     * Filtriamo SOLO modelli:
     * - Gemini
     * - supportano generateContent
     * - NON preview / exp / latest
     */
    const validGeminiModels = json.models
      .filter(m =>
        m.name?.includes("gemini") &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent")
      )
      .map(m => m.name)
      .filter(name =>
        !name.includes("latest") &&
        !name.includes("exp") &&
        !name.includes("preview")
      );

    if (validGeminiModels.length > 0) {
      CURRENT_GEMINI_MODEL = validGeminiModels[0];
      console.log("🔮 Gemini attivo (API):", CURRENT_GEMINI_MODEL);
    } else {
      console.log("⚠️ Gemini: nessun modello compatibile trovato, fallback:", CURRENT_GEMINI_MODEL);
    }
  } catch (err) {
    console.log("⚠️ Gemini detect error → fallback:", CURRENT_GEMINI_MODEL);
  }
}

/**
 * ESEGUITO UNA SOLA VOLTA ALL’AVVIO SERVER
 */
await detectGeminiModel();

/**
 * Inizializzazione SDK
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Funzione chiamata dal server
 */
export async function askGemini({ message, apartment, lang }) {
  try {
    const model = genAI.getGenerativeModel({
      model: CURRENT_GEMINI_MODEL
    });

    const prompt = `
Sei l'assistente di un appartamento turistico a Roma.
Appartamento: ${apartment}
Lingua richiesta: ${lang}

Rispondi in modo:
- chiaro
- concreto
- utile per un ospite
- senza emoji
- senza marketing

Domanda ospite:
${message}
`;

    const result = await model.generateContent(prompt);

    const text = result?.response?.text?.();

    if (!text || !text.trim()) {
      console.log("⚠️ Gemini risposta vuota");
      return null;
    }

    return text.trim();
  } catch (err) {
    console.error("❌ Gemini HTTP error:", err?.response?.data || err?.message || err);
    return null;
  }
}
