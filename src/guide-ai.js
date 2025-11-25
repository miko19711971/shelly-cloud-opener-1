// src/guide-ai.js
// Modulo di placeholder per il Guest Assistant.
// Qui mettiamo la funzione reply() che viene chiamata da /hostaway-incoming

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// 📌 CARTELLA DOVE SONO I JSON
const GUIDES_DIR = path.join(__dirname, "..", "public", "guides-v2");

// 🚀 FUNZIONE REPLY — VERRA' CHIAMATA DAL SERVER
export async function reply({ apartment, language, message }) {
  try {
    // normalize lingua: en / it / fr / de / es
    const lang = (language || "en").toLowerCase();

    // scegli file JSON giusto (arenula.json, scala.json, ecc.)
    const fileName = apartment
      .toLowerCase()
      .replace("via ", "")
      .replace(/\s+/g, "");
    const jsonPath = path.join(GUIDES_DIR, `${fileName}.json`);

    // leggi JSON
    const data = await fs.readFile(jsonPath, "utf8");
    const guide = JSON.parse(data);

    // prendi i testi per quella lingua
    const texts = guide[lang] || guide["en"] || null;
    if (!texts) {
      return `Spiacente, non ho informazioni per questo appartamento (${apartment}) in questa lingua.`;
    }

    // cerca il termine nel messaggio dell’ospite
    const search = message.toLowerCase();
    for (const [key, value] of Object.entries(texts)) {
      if (search.includes(key)) {
        return value;
      }
    }

    // se non trova nulla:
    return `Grazie per il messaggio. Ti risponderò appena possibile.`;
  } catch (err) {
    console.error("❌ ERRORE guide-ai:", err);
    return `Errore interno. Posso risponderti a breve.`;
  }
}
