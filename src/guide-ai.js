 // src/guide-ai.js
// Legge automaticamente i JSON in /public/guides-v2/
// e risponde all’endpoint /api/guest-assistant

import path from "path";
import fs from "fs/promises";

export default function guideAI(app) {
  app.post("/api/guest-assistant", async (req, res) => {
    try {
      const { apartment, language, query } = req.body || {};

      if (!apartment || !language || !query) {
        return res.status(400).json({
          ok: false,
          error: "missing_data",
          message: "Apartment, language e query sono obbligatori."
        });
      }

      // Percorso file JSON corrispondente
      const filePath = path.join(
        process.cwd(),
        "public",
        "guides-v2",
        `${apartment}.json`
      );

      // Carico il file JSON
      const raw = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(raw);

      const langData = data[language];
      if (!langData) {
        return res.json({
          ok: false,
          answer: `Nessuna traduzione trovata per la lingua ${language}.`
        });
      }

      // Cerco una chiave che assomiglia alla query
      const found = Object.entries(langData).find(([key, value]) => {
        const q = query.toLowerCase();
        return key.toLowerCase().includes(q) || value.toLowerCase().includes(q);
      });

      if (found) {
        return res.json({
          ok: true,
          answer: found[1],
          key: found[0],
        });
      } else {
        return res.json({
          ok: false,
          answer: "Mi dispiace, non ho trovato nulla nei dati."
        });
      }

    } catch (err) {
      console.error("Errore nel guest assistant AI:", err);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });
}
