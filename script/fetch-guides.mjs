// script/fetch-guides.mjs
import fs from "fs";
import path from "path";
import https from "https";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ""; // -> aggiungilo su Render (Settings > Environment)
const OUT_BASE = path.join(process.cwd(), "public", "guest-assistant");

// Mappa: cartella destinazione -> URL RAW dell'index.html (branch main)
// Se i nomi/branch differiscono, aggiorna solo questi URL.
const SOURCES = {
  scala:      "https://raw.githubusercontent.com/miko19711971/guest-assistant-scala/main/index.html",
  leonina:    "https://raw.githubusercontent.com/miko19711971/guest-assistant-leonina/main/index.html",
  arenula:    "https://raw.githubusercontent.com/miko19711971/guest-assistant-arenula/main/index.html",
  trastevere: "https://raw.githubusercontent.com/miko19711971/guest-assistant-viale-trastevere_virtual_guide/main/index.html",
  portico:    "https://raw.githubusercontent.com/miko19711971/guest-assistant-portico/main/index.html"
};

function fetchToFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const opts = new URL(url);
    const headers = { "User-Agent": "render-fetch-guides" };
    if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;

    https.get({ ...opts, headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${url} -> ${res.statusCode}`));
        res.resume();
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    }).on("error", reject);
  });
}

(async () => {
  try {
    // pulizia base
    fs.rmSync(OUT_BASE, { recursive: true, force: true });

    for (const [folder, url] of Object.entries(SOURCES)) {
      const dest = path.join(OUT_BASE, folder, "index.html");
      console.log(`→ downloading ${folder} ...`);
      await fetchToFile(url, dest);
      console.log(`✓ saved ${dest}`);
    }

    console.log("✅ All guides fetched to /public/guest-assistant");
  } catch (e) {
    console.error("❌ Fetch guides failed:", e?.message || e);
    process.exit(1);
  }
})();
