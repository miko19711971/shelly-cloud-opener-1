// src/gemini.js
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function askGemini() {
  try {
    const models = await genAI.listModels();

    console.log("✅ MODELLI DISPONIBILI:");
    models.models.forEach(m => {
      console.log(
        `- ${m.name} | methods: ${m.supportedGenerationMethods?.join(", ")}`
      );
    });

    return "Model list logged";

  } catch (err) {
    console.error("❌ ListModels error:", err.message);
    return null;
  }
}
