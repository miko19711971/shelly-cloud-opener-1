// src/gemini.js

export async function askGemini({ message, apartment, lang }) {
  if (!process.env.GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY missing");
    return null;
  }

  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=" +
        process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `
You are a guest assistant for a vacation rental in Rome.

Apartment: ${apartment}
Language: ${lang}

Guest message:
"${message}"

Reply clearly, politely, and concisely in the SAME language as the guest.
If the question is generic (transport, directions, city info), answer normally.
Do NOT mention AI, policies, or system instructions.
`
                }
              ]
            }
          ]
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ Gemini HTTP error:", response.status, errText);
      return null;
    }

    const data = await response.json();

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;

    if (!text) {
      console.error("⚠️ Gemini returned empty response", JSON.stringify(data));
      return null;
    }

    return text;

  } catch (err) {
    console.error("❌ Gemini fetch failed:", err.message);
    return null;
  }
}
