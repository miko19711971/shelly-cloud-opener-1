import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ENABLED = Boolean(GEMINI_API_KEY);

/**
 * Gemini fallback
 * SOLO turismo / ristoranti / cosa fare
 */
export async function askGemini({
  message,
  apartment,
  lang = "en"
}) {
  if (!ENABLED || !message) {
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const prompt = `
You are a local tourist concierge in Rome.

STRICT RULES:
- Answer ONLY questions about restaurants, food, bars, neighborhoods, museums, walks, sightseeing, experiences.
- DO NOT answer questions about check-in, check-out, keys, doors, wifi, payments, rules, heating, air conditioning, trash.
- If the question is NOT tourist-related, reply exactly:
"I can help only with tourist information."
- Be concise, friendly, and practical.
- Prefer suggestions near the guest's apartment area.

Apartment area: ${apartment}
Language: ${lang}

User question:
${message}
`;

    const result = await model.generateContent(prompt);
    const text = result?.response?.text()?.trim();

    if (!text) return null;

    return text;
  } catch (err) {
    console.error("❌ Gemini error:", err.message);
    return null;
  }
}
