export async function askGemini({ message, apartment, lang }) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY missing");
    return null;
  }

  const model = "gemini-1.5-flash-latest"; // ✅ UNICO MODELLO OK

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
Guest message: "${message}"

Reply clearly, politely, and concisely in the same language.
Do not mention AI.
                  `.trim(),
                },
              ],
            },
          ],
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("❌ Gemini HTTP error:", data);
      return null;
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) {
      console.warn("⚠️ Gemini returned empty response");
      return null;
    }

    console.log("✅ Gemini reply OK");
    return text;
  } catch (err) {
    console.error("❌ Gemini fetch error:", err);
    return null;
  }
}
