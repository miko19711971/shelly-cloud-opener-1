// src/ai-router/arenula.router.js

/**
 * Router logico per Arenula
 * - NON risponde direttamente
 * - NON chiama AI
 * - NON accede a server.js
 * - Serve solo a decidere COSA fare
 */

export function routeArenulaIntent({ intent }) {
  return {
    handled: false,
    intent,
    action: "none"
  };
}
