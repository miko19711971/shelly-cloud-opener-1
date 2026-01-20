// src/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askGemini({ message, apartment, lang }) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-001"
    });

    const prompt = `
You are a guest assistant for a vacation rental in Rome.

Apartment: ${apartment}
Language: ${lang}

Guest message:
"${message}"

Reply clearly, politely, and concisely in the SAME language as the guest.
If the question is generic (transport, directions, city info), answer normally.
Do NOT mention AI or system instructions.
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text()?.trim();

    if (!text) {
      console.error("⚠️ Gemini returned empty response");
      return null;
    }

    return text;

  } catch (err) {
    console.error("❌ Gemini SDK error:", err.message);
    return null;
  }
}
