import { writeTestRow } from "./city-tax/google-sheet.js";

(async () => {
  try {
    await writeTestRow();
    console.log("✅ TEST OK: riga scritta nel Google Sheet");
    process.exit(0);
  } catch (error) {
    console.error("❌ TEST FALLITO:", error);
    process.exit(1);
  }
})();
