import express from "express";
import crypto from "crypto";
import { sendEmail } from "./recruiting-mailer.js";
import {
  extractCaseId,
  parseCandidateReply,
  evaluateRequirements
} from "./recruiting-parser.js";
import { saveCandidate } from "./recruiting-storage.js";

const router = express.Router();

function newCaseId() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// INVIO RICHIESTA DI COLLABORAZIONE
router.post("/recruiting/request", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    const caseId = newCaseId();

    await saveCandidate({
      caseId,
      email,
      name,
      status: "requested"
    });

    const text = `
Ciao ${name || ""},

grazie per l'interesse.

Per proseguire, rispondi a questa email copiando e compilando:

[CASE-ID: ${caseId}]

1. Partita IVA:
2. Breve presentazione:
3. Esperienza con persone anziane:
4. Referenze (minimo 2, con telefono):
5. Mezzo proprio (auto/motorino):
6. Zona di lavoro:

Grazie.
`;

    await sendEmail({
      to: email,
      subject: "Richiesta collaborazione",
      text
    });

    res.json({ ok: true, caseId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RICEZIONE RISPOSTA CANDIDATO
router.post("/recruiting/reply", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const caseId = extractCaseId(text);
    if (!caseId) {
      return res.status(400).json({ error: "Case ID not found" });
    }

    const fields = parseCandidateReply(text);
    const evaluation = evaluateRequirements(fields);

    await saveCandidate({
      caseId,
      ...fields,
      status: evaluation.ok ? "preapproved" : "rejected",
      reasons: evaluation.reasons
    });

    res.json({ ok: true, evaluation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
