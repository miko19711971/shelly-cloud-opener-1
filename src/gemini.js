export async function askGemini({ message, apartment, lang }) {
  const models = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002', 
    'gemini-1.5-pro-latest',
    'gemini-pro'
  ];
  
  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.log(`✅ Working model: ${model}`);
        return data.candidates[0].content.parts[0].text.trim();
      }
    } catch (err) {
      continue;
    }
  }
  console.error("❌ All models failed");
  return null;
}
