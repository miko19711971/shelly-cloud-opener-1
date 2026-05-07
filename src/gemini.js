// src/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Ordine di preferenza modelli: dal migliore al fallback.
 */
const PREFERRED_MODELS = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"];
let CURRENT_GEMINI_MODEL = "gemini-1.5-pro";

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

    const available = json.models
      .filter(m =>
        m.name?.includes("gemini") &&
        Array.isArray(m.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes("generateContent") &&
        !m.name.includes("latest") &&
        !m.name.includes("exp") &&
        !m.name.includes("preview")
      )
      .map(m => m.name);

    const best = PREFERRED_MODELS.find(p => available.some(name => name.includes(p)));
    if (best) {
      CURRENT_GEMINI_MODEL = available.find(name => name.includes(best)) || best;
      console.log("🔮 Gemini attivo:", CURRENT_GEMINI_MODEL);
    } else if (available.length > 0) {
      CURRENT_GEMINI_MODEL = available[0];
      console.log("🔮 Gemini attivo (primo disponibile):", CURRENT_GEMINI_MODEL);
    } else {
      console.log("⚠️ Gemini: nessun modello trovato, fallback:", CURRENT_GEMINI_MODEL);
    }
  } catch (err) {
    console.log("⚠️ Gemini detect error, fallback:", CURRENT_GEMINI_MODEL);
  }
}

await detectGeminiModel();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Funzione dedicata alla guida ospiti premium.
 * Usa un system prompt fornito dall'esterno (con tutti i dati dell'appartamento)
 * e risponde senza filtri interni.
 */
export async function askGeminiGuide({ message, systemPrompt, history = [] }) {
  try {
    const model = genAI.getGenerativeModel({
      model: CURRENT_GEMINI_MODEL,
      systemInstruction: systemPrompt
    });

    const chat = model.startChat({
      history: history.length > 0 ? history : undefined,
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    });

    const result = await chat.sendMessage(message);
    const text = result?.response?.text?.();

    if (!text || !text.trim()) {
      console.log("⚠️ Gemini Guide risposta vuota");
      return null;
    }

    return text.trim();
  } catch (err) {
    console.error("❌ Gemini Guide error:", err?.message || err);
    return null;
  }
}

export async function askGemini({ message, apartment, lang }) {
  try {
    const systemParts = [
      "Sei l'assistente di un appartamento turistico a Roma.",
      "Appartamento: " + apartment + ". Lingua richiesta: " + lang + ".",
      "REGOLA OBBLIGATORIA: se la domanda riguarda informazioni specifiche dell'appartamento,",
      "sicurezza, emergenze, indirizzo, citofono, accessi, istruzioni tecniche o problemi interni,",
      "rispondi SOLO con la stringa __INTERNAL_AI__ senza aggiungere nient'altro.",
      "Per tutte le altre domande rispondi in modo chiaro e concreto, senza emoji, senza marketing."
    ].join(" ");

    const model = genAI.getGenerativeModel({
      model: CURRENT_GEMINI_MODEL,
      systemInstruction: systemParts
    });

    const result = await model.generateContent(message);
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
