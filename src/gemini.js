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
 * Concierge per la guida premium ospiti.
 * Usa system prompt esterno, nessun filtro __INTERNAL_AI__.
 */
export async function askGeminiGuide({ message, systemPrompt, history = [] }) {
  try {
    const model = genAI.getGenerativeModel({
      model: CURRENT_GEMINI_MODEL,
      systemInstruction: systemPrompt
    });
    const chat = model.startChat({
      history: history.length > 0 ? history : undefined,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
    });
    const result = await chat.sendMessage(message);
    const text = result?.response?.text?.();
    if (!text || !text.trim()) { console.log("⚠️ Gemini Guide risposta vuota"); return null; }
    return text.trim();
  } catch (err) {
    console.error("❌ Gemini Guide error:", err?.message || err);
    return null;
  }
}

export async function askGemini({ message, apartment, lang }) {
  try {
    const systemParts = [
      "Sei un concierge turistico di Roma. Rispondi nella lingua: " + lang + ".",
      "Il tuo UNICO compito e' aiutare i turisti con domande su Roma:",
      "ristoranti, bar, cosa visitare, trasporti, biglietti, musei, shopping, mercati,",
      "gite fuori Roma, eventi, vita notturna, farmacie, ospedali, consigli pratici.",
      "Rispondi in modo chiaro, concreto, breve. No emoji, no marketing.",
      "",
      "REGOLA ASSOLUTA: rispondi SOLO con __INTERNAL_AI__ (senza altro) se la domanda riguarda:",
      "- l'appartamento, la casa, le chiavi, il check-in, il check-out, il wifi, la lavatrice,",
      "  il riscaldamento, l'aria condizionata, il quadro elettrico, l'indirizzo, il citofono,",
      "  il portone, l'ascensore, la spazzatura, le istruzioni della casa, guasti, emergenze",
      "- pagamenti, rimborsi, fatture, tassa di soggiorno, bonifici, PayPal",
      "- se sei un bot, un'AI, un chatbot, o se l'ospite vuole parlare con una persona reale",
      "Non inventare MAI informazioni sull'appartamento. Non hai queste informazioni."
    ].join(" ");

    const model = genAI.getGenerativeModel({
      model: CURRENT_GEMINI_MODEL,
      systemInstruction: systemParts
    });

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout 8s")), 8000));
    const result = await Promise.race([model.generateContent(message), timeout]);
    const text = result?.response?.text?.();

    if (!text || !text.trim()) {
      console.log("⚠️ Gemini risposta vuota");
      return null;
    }

    return text.trim();
  } catch (err) {
    console.error("❌ Gemini error:", err?.message || err);
    return null;
  }
}
