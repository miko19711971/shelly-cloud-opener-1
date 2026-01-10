 import { google } from "googleapis";

const SPREADSHEET_ID = "1-5umuvZHgqzcDiYKwmYhZJTYSAKXkd2qemNiuiiCyJg";
const SHEET_NAME = "Foglio1";

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export async function writeTestRow() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const values = [[
    "2026-01-10",              // Check-in date
    "2026-01-13",              // Check-out date
    "Via Arenula 16",          // Apartment
    "John Doe",                // Guest full name
    2,                         // Guests
    3,                         // Nights
    30,                        // City tax due €
    "YES",                     // Paid
    "Stripe",                  // Payment method
    "2026-01-10",              // Payment date
    "TEST COMPLETO AUTOMATICO" // Notes
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  console.log("TEST city-tax: riga completa scritta correttamente");
}
