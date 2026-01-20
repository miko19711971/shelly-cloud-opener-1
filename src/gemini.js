export async function askGemini({ message, apartment, lang }) {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a guest assistant for a vacation rental in Rome.
Apartment: ${apartment}
Language: ${lang}
Guest message: "${message}"
Reply clearly, politely, and concisely in the same language.
If the question is generic (transport, city info, directions), answer normally.
Do not mention AI.`
            }]
          }]
        })
      }
    );
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("❌ GEMINI FAILED:", err.message);
    return null;
  }
}
