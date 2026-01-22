function clean(value) {
  return (value || "")
    .toString()
    .replace(/\r/g, "")
    .trim();
}

export function extractCaseId(text) {
  const match = (text || "").match(/\[CASE-ID:\s*([A-Z0-9\-]{6,})\s*\]/i);
  return match ? match[1].toUpperCase() : null;
}

export function parseCandidateReply(text) {
  const t = clean(text);

  const get = (label) => {
    const regex = new RegExp(
      `${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\d+\\.|\\n\\s*[A-Za-zÀ-ÿ].*?:|$)`,
      "i"
    );
    const match = t.match(regex);
    return match ? clean(match[1]) : "";
  };

  return {
    partitaIva: get("Partita IVA"),
    presentazione: get("Breve presentazione"),
    esperienza: get("Esperienza"),
    referenze: get("Referenze"),
    mezzo: get("Mezzo proprio"),
    zona: get("Zona")
  };
}

export function evaluateRequirements(fields) {
  const reasons = [];

  const piva = (fields.partitaIva || "").toLowerCase();
  if (!piva.includes("attiva") && !piva.includes("apertura")) {
    reasons.push("Partita IVA non attiva o non in apertura");
  }

  if (!fields.presentazione || fields.presentazione.length < 10) {
    reasons.push("Presentazione insufficiente");
  }

  if (!fields.esperienza || fields.esperienza.length < 10) {
    reasons.push("Esperienza non indicata");
  }

  const phones = (fields.referenze || "").match(/(\+?\d[\d\s\-]{7,}\d)/g) || [];
  if (phones.length < 2) {
    reasons.push("Meno di due referenze contattabili");
  }

  const mezzo = (fields.mezzo || "").toLowerCase();
  if (!mezzo.includes("auto") && !mezzo.includes("motorino")) {
    reasons.push("Mezzo proprio non disponibile");
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}
