// src/guide-ai.js

// Funzione di test per il Guest Assistant usata dal bridge HostAway
export default async function guideAI({ apartment, language, message }) {
  return {
    ok: true,
    apartment,
    language,
    answer: `TEST OK: Ricevuto il messaggio "${message}" per l'appartamento ${apartment} in lingua ${language}.`
  };
}
