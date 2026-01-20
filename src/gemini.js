import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-exp";

// Se manca la chiave, Gemini è disattivato e NON rompe nulla
const ENABLED = Boolean(GEMINI_API_KEY);

let genAI = null;
let model = null;

if (ENABLED) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getModel({
    model: GEMINI_MODEL,
    tools: [{ googleSearch: {} }]
  });
}

/**
 * Gemini fallback
 * Usato SOLO per turismo / ristoranti / cosa fare
 */
export async function askGemini({
  message,
  apartment,
  lang = "en"
}) {
  if (!ENABLED || !model || !message) {
    return null;
  }

  const systemPrompt = `
You are a local tourist concierge in Rome.

STRICT RULES:
- Answer ONLY questions about: restaurants, food, bars, neighborhoods, museums, walks, sightseeing, experiences.
- DO NOT answer questions about: check-in, check-out, keys, doors, wifi, payments, rules, heating, air conditioning, trash, building access.
- If the question is NOT tourist-related, reply exactly with:
"I can help only with tourist information."
- Be concise, friendly, and practical.
- Do NOT invent prices or opening hours if you are not sure.
- Prefer suggestions near the guest's apartment area.

Apartment area: ${apartment}
Language: ${lang}
`;

  try {
    const result = await model.generateContent([
      { role: "system", parts: [{ text: systemPrompt }] },
      { role: "user", parts: [{ text: message }] }
    ]);

    const text =
      result?.response?.candidates?.[0]?.content?.parts
        ?.map(p => p.text)
        ?.join("")
        ?.trim();

    if (!text) return null;

    // Filtro di sicurezza finale
    const forbidden = [
      "check-in",
      "check in",
      "wifi",
      "password",
      "door",
      "key",
      "payment",
      "pay",
      "heating",
      "air conditioning",
      "trash",
      "rules"
    ];

    const lower = text.toLowerCase();
    if (forbidden.some(f => lower.includes(f))) {
      return "I can help only with tourist information.";
    }

    return text;
  } catch (err) {
    console.error("❌ Gemini error:", err.message);
    return null;
  }
}
