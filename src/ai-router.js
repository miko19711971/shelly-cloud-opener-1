// src/ai-router/arenula.router.js

/**
 * Router logico per Arenula
 * Decide se:
 * - rimandare alla guida
 * - oppure lasciare la gestione all’AI
 */

// INTENTS GIÀ COPERTI DALLA GUIDA DI ARENULA
const GUIDE_INTENTS = // allineati con STRICT_INTENTS di matcher.js
new Set([
  "wifi",
  "fire",
  "trash",
  "heating",
  "electric_panel",
  "check_in",
  "check_out",
  "city_tax_info",
  "laundry",
  "apartment_info",
  "building",
  "emergency",
  "malfunction",
  "air_conditioning",
  "gas_leak",
  "water_leak",
  "lost_keys"
]);

/**
 * Decide come gestire l’intent per Arenula
 */
export function routeArenulaIntent({ intent }) {
  if (!intent) {
    return {
      handled: false,
      action: "delegate_to_ai"
    };
  }

  // Se l’intent è coperto dalla guida → rimando alla guida
  if (GUIDE_INTENTS.has(intent)) {
    return {
      handled: true,
      action: "redirect_to_guide",
      guide: "arenula",
      intent
    };
  }

  // Altrimenti → lascia lavorare l’AI
  return {
    handled: false,
    action: "delegate_to_ai",
    intent
  };
}
