// language.js - Language Detection
export function detectLanguage(text) {
  if (!text || typeof text !== "string") return "en";
  
  const t = text.toLowerCase().trim();
  if (t.length < 5) return "en";
  
  // Sistema di punteggio per lingua
  const scores = { it: 0, en: 0, es: 0, fr: 0, de: 0 };
  
  // ITALIANO - Pattern multipli
  const itPatterns = [
    /[àèéìòù]/g,
    /\b(che|dove|come|quando|perch[eé]|cosa|qual[eè]|sono|ho|hai|abbiamo|grazie|ciao|buongiorno)\b/g,
    /\b(spazzatura|rifiuti|immondizia|riscaldamento|corrente|luce|wifi|password)\b/g,
    /(zione|mento|aggio|ezza)\b/g
  ];
  
  // SPAGNOLO - Pattern multipli
  const esPatterns = [
    /¿|¡/g,
    /\b(qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|cu[aá]l|por|para|el|la|los|las|gracias|hola)\b/g,
    /\b(basura|calefacci[oó]n|electricidad|contrase[ñn]a)\b/g,
    /(ción|amiento|eza)\b/g
  ];
  
  // FRANCESE - Pattern multipli
  const frPatterns = [
    /[àâäæçéèêëïîôùûü]/g,
    /\b(je|tu|il|elle|nous|vous|ils|comment|quand|o[ùu]|quel|quelle|merci|bonjour)\b/g,
    /\b(d[ée]chets|chauffage|[ée]lectricit[ée]|mot de passe)\b/g,
    /(tion|ment|esse|eur)\b/g
  ];
  
  // TEDESCO - Pattern multipli  
  const dePatterns = [
    /[äöüß]/g,
    /\b(der|die|das|ich|du|er|sie|wir|wie|wann|wo|was|danke|hallo|und)\b/g,
    /\b(m[üu]ll|heizung|strom|passwort|wlan)\b/g,
    /(ung|keit|heit|schaft)\b/g
  ];
  
  // INGLESE - Pattern multipli
  const enPatterns = [
    /\b(the|is|are|was|were|have|has|had|where|when|what|how|thank|hello|wifi|password)\b/g,
    /\b(trash|garbage|heating|electricity|light)\b/g,
    /(tion|ment|ness|ship)\b/g
  ];
  
  // Conta match per ogni lingua
  itPatterns.forEach(p => { scores.it += (t.match(p) || []).length; });
  esPatterns.forEach(p => { scores.es += (t.match(p) || []).length; });
  frPatterns.forEach(p => { scores.fr += (t.match(p) || []).length; });
  dePatterns.forEach(p => { scores.de += (t.match(p) || []).length; });
  enPatterns.forEach(p => { scores.en += (t.match(p) || []).length; });
  
  // Trova lingua con punteggio più alto
  let maxLang = "en";
  let maxScore = scores.en;
  
  for (const [lang, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      maxLang = lang;
    }
  }
  
  return maxLang;
}
