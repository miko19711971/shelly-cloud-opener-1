// matcher.js - Intent Matching

const INTENTS = {
  wifi: [
    "wifi", "wi-fi", "internet", "password", "router", "rete",
    "qual è la password", "come mi collego",
    "what is the password", "how do i connect"
  ],
  trash: [
    "spazzatura", "rifiuti", "dove butto", "trash", "garbage"
  ],
  heating: [
    "riscaldamento", "stufa", "caldo", "freddo", "heating"
  ],
  electric_panel: [
    "corrente", "luce", "quadro elettrico", "electric", "power"
  ],
  check_in: [
    "check in", "arrivo", "arrival", "come arrivo"
  ],
  check_out: [
    "check out", "partenza", "departure"
  ],
  city_tax_info: [
    "tassa", "city tax", "quanto costa"
  ],
  laundry: [
    "lavanderia", "lavatrice", "laundry"
  ],
  building: [
    "edificio", "indirizzo", "building", "address"
  ],
  emergency: [
    "emergenza", "aiuto", "problema", "emergency", "help"
  ]
};

function normalize(text) {
  return text.toLowerCase().trim();
}

export function matchIntent(text) {
  if (!text) return null;
  const normalized = normalize(text);
  
  for (const [intent, keywords] of Object.entries(INTENTS)) {
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        return intent;
      }
    }
  }
  return null;
}
```

4. Commit message: `Add matcher.js`
5. Clicca **"Commit new file"**

✅ **Secondo file creato!** 🎉

---

## 🔄 **PASSO 3: Render Aggiorna Automaticamente!**

Dato che il tuo progetto Render è collegato a GitHub:

1. Render **vede** che hai aggiunto file nuovi
2. **Automaticamente** fa il deploy (aggiornamento)
3. Aspetta 1-2 minuti

---

## 📊 **PASSO 4: Controllare se Funziona**

Torna su Render (la scheda che mi hai mostrato):

1. Clicca su **"Logs"** (nella sezione "All logs")
2. Vedrai il server che si riavvia
3. Cerca queste righe:
```
   ✅ Server running on 10000
