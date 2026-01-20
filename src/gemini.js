// src/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askGemini({ message, apartment, lang }) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-pro"
    });

    const prompt = `
You are a guest assistant for a vacation rental in Rome.

Apartment: ${apartment}
Language: ${lang}

Guest message:
"${message}"

Reply clearly, politely, and concisely in the SAME language as the guest.
Do NOT mention AI.
`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();

  } catch (err) {
    console.error("❌ Gemini error:", err.message);
    return null;
  }
}
