    import { google } from "googleapis";

const SPREADSHEET_ID = "1-5umuvZHgqzcDiYKwmYhZJTYSAKXkd2qemNiuiiCyJg";
const SHEET_NAME = "Foglio1";

function getAuth() {
  return new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
}

export async function writeTestRow() {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  
  const values = [[
    "TEST",
    "TEST",
    "TEST Apartment",
    "Test Guest",
    1,
    1,
    5,
    "NO",
    "—",
    "",
    "Test automatico"
  ]];
  
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
  
  console.log("City-tax: riga di test scritta");
}
