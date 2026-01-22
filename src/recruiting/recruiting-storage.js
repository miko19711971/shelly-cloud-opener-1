import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");
const FILE_PATH = path.join(DATA_DIR, "recruiting-candidates.json");

async function readAll() {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeAll(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(rows, null, 2), "utf8");
}

export async function saveCandidate(candidate) {
  const rows = await readAll();
  const idx = rows.findIndex(r => r.caseId === candidate.caseId);
  const now = new Date().toISOString();

  if (idx >= 0) {
    rows[idx] = { ...rows[idx], ...candidate, updatedAt: now };
  } else {
    rows.push({ ...candidate, createdAt: now, updatedAt: now });
  }

  await writeAll(rows);
  return candidate;
}

export async function getCandidate(caseId) {
  const rows = await readAll();
  return rows.find(r => r.caseId === caseId) || null;
}
