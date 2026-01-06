// src/ai-router/arenula.router.js

/**
 * Router logico per Arenula
 * Decide se:
 * - rimandare alla guida
 * - oppure lasciare la gestione all’AI
 */

// INTENTS GIÀ COPERTI DALLA GUIDA DI ARENULA
const GUIDE_INTENTS = new Set([
  "wifi",
  "wifi_troubleshooting",
  "trash",
  "heating",
  "AC",
  "electric_panel",
  "water",
  "bathroom",
  "linens_towels",
  "kitchen",
  "check_in",
  "early_checkin",
  "check_out",
  "late_checkout",
  "building",
  "transport",
  "luggage_storage",
  "eat",
  "drink",
  "visit",
  "experiences",
  "day_trips",
  "tickets",
  "museums",
  "exhibitions",
  "city_tax_info",
  "city_tax_payment_issue",
  "payment_methods",
  "id_documents",
  "receipt_rental",
  "receipt_city_tax",
  "house_rules",
  "laundry",
  "emergency",
  "services"
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
