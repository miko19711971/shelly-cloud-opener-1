import fetch from "node-fetch";

export async function askGemini({ message, apartment, lang }) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

  try {
    const response = await fetch(`${url}?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are a guest assistant for a vacation rental in Rome.

Apartment: ${apartment}
Language: ${lang}
Guest message: "${message}"

Reply clearly, politely, and concisely in the same language.
If the question is generic (transport, city info, directions), answer normally.
Do not mention AI.`
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("❌ Gemini HTTP error:", err);
      return null;
    }

    const data = await response.json();

    return (
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
    );
  } catch (err) {
    console.error("❌ Gemini fetch error:", err);
    return null;
  }
}
