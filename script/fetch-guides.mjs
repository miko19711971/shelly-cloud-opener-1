// script/fetch-guides.mjs
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
if (!GITHUB_TOKEN) {
  console.error("❌ Missing GITHUB_TOKEN env var");
  process.exit(1);
}

const OUT_BASE = path.join(process.cwd(), "public", "guest-assistant");

// Mappa cartella -> URL RAW dell'index.html (branch main)
const SOURCES = {
  scala:      "https://raw.githubusercontent.com/miko19711971/guest-assistant-scala/main/index.html",
  leonina:    "https://raw.githubusercontent.com/miko19711971/guest-assistant-leonina/main/index.html",
  arenula:    "https://raw.githubusercontent.com/miko19711971/guest-assistant-arenula/main/index.html",
  trastevere: "https://raw.githubusercontent.com/miko19711971/guest-assistant-viale-trastevere_virtual_guide/main/index.html",
  portico:    "https://raw.githubusercontent.com/miko19711971/guest-assistant-portico/main/index.html"
};

function curlToFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // -L segue i redirect; -f fallisce su HTTP≠200; -sS silenzioso ma mostra errori
  const cmd = `curl -fLsS -H "Authorization: token ${GITHUB_TOKEN}" -H "User-Agent: render-fetch-guides" "${url}" -o "${dest}"`;
  execSync(cmd, { stdio: "inherit" });
}

try {
  fs.rmSync(OUT_BASE, { recursive: true, force: true });
  fs.mkdirSync(OUT_BASE, { recursive: true });

  for (const [folder, url] of Object.entries(SOURCES)) {
    const dest = path.join(OUT_BASE, folder, "index.html");
    console.log(`→ downloading ${folder} ...`);
    curlToFile(url, dest);
    console.log(`✓ saved ${dest}`);
  }

  console.log("✅ All guides fetched to /public/guest-assistant");
  process.exit(0);
} catch (e) {
  console.error("❌ Fetch guides failed:", e?.message || e);
  process.exit(1);
}
