// language.js - Language Detection

export function detectLanguage(text) {
  if (!text || typeof text !== "string") return "en";
  
  const t = text.toLowerCase();
  
  // ITALIAN
  if (
    t.match(/[àèéìòù]/) || 
    t.includes(" che ") ||
    t.includes(" dove ") ||
    t.includes(" come ") ||
    t.includes(" quando ")
  ) {
    return "it";
  }
  
  // SPANISH
  if (t.includes("¿") || t.includes(" qué ")) {
    return "es";
  }
  
  // FRENCH
  if (t.includes(" je ") || t.includes("bonjour")) {
    return "fr";
  }
  
  // GERMAN
  if (t.includes(" der ") || t.includes(" und ")) {
    return "de";
  }
  
  return "en";
}
