// scripts/fetch-guides.mjs
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// Directory di destinazione sul progetto
const targetDir = path.join(process.cwd(), "public", "guest-assistant");

// Lista delle tue guide con repo e cartelle
const guides = {
  scala:    "https://github.com/miko19711971/guest-assistant-scala.git",
  leonina:  "https://github.com/miko19711971/guest-assistant-leonina.git",
  arenula:  "https://github.com/miko19711971/guest-assistant-arenula.git",
  portico:  "https://github.com/miko19711971/guest-assistant-portico.git",
  trastevere: "https://github.com/miko19711971/guest-assistant-viale-trastevere.git"
};

// Cancella e ricrea la cartella target
fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

// Clona e copia i contenuti di ogni guida
for (const [name, repo] of Object.entries(guides)) {
  const tmpDir = path.join("/tmp", `guide-${name}`);
  console.log(`Fetching ${name}...`);
  execSync(`git clone --depth=1 ${repo} ${tmpDir}`, { stdio: "inherit" });
  fs.cpSync(tmpDir, path.join(targetDir, name), { recursive: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log("✅ All guides copied into /public/guest-assistant/");
