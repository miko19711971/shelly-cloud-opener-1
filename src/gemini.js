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
Reply clearly, politely, and concisely in the same language.
If the question is generic (transport, city info, directions), answer normally.
Do not mention AI.
`;
    const result = await model.generateContent(prompt);
    const response = result.response.text();
    return response?.trim() || null;
  } catch (err) {
    console.error("❌ GEMINI FAILED:", err.message);
    return null;
  }
}
