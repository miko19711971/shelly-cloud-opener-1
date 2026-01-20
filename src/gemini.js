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
If the question is about transport, directions, or city information, answer normally.
Do NOT mention AI, systems, or internal instructions.
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
    console.error("❌ Gemini error:", err.message || err);
    return null;
  }
}
