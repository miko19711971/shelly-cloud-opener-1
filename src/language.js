 export function detectLanguage(text) {
  const t = text.toLowerCase();

  if (t.match(/[àèéìòù]/) || t.includes(" che ")) return "it";
  if (t.includes("¿") || t.includes(" qué ")) return "es";
  if (t.includes(" le ") || t.includes(" bonjour")) return "fr";
  if (t.includes(" der ") || t.includes(" und ")) return "de";

  return "en";
}
