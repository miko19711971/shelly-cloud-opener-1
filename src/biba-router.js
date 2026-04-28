import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../data/biba-tokens.json');
const PUBLIC_DIR = path.join(__dirname, '../public');
const BIBA_SHEETS_URL = process.env.BIBA_SHEETS_URL;
const BIBA_PIN = process.env.BIBA_PIN || '6793';
const router = express.Router();

// ─── Google Sheet "Biba Scansioni" ────────────────────────────────────────────

async function logBibaSheet(data) {
  if (!BIBA_SHEETS_URL) return;
  try {
    const { default: axios } = await import('axios');
    await axios.post(BIBA_SHEETS_URL, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
  } catch (err) {
    console.error('❌ Biba Sheets log error:', err.message);
  }
}

// ─── Token storage ────────────────────────────────────────────────────────────

async function loadTokens() {
  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveTokens(tokens) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(tokens, null, 2));
}

function newToken() {
  return 'BIBA-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Vetrina QR → chiamato da biba_vetrina.html al caricamento
// Genera token, logga "vetrina" su Sheet, restituisce il token
router.get('/new-token', async (req, res) => {
  const tokens = await loadTokens();
  const token = newToken();
  const now = new Date().toISOString();
  tokens[token] = { created: now, uses: 0, history: [], source: 'vetrina' };
  await saveTokens(tokens);

  logBibaSheet({
    token,
    tipo: 'vetrina',
    timestamp: now,
    userAgent: req.headers['user-agent'] || ''
  });

  res.json({ token });
});

// Cassa QR → chiamato da biba_cassa.html al caricamento
// Logga "cassa" su Sheet
router.post('/log-scan', async (req, res) => {
  const { token, tipo } = req.body;
  const now = new Date().toISOString();

  logBibaSheet({
    token: token || '',
    tipo: tipo || 'cassa',
    timestamp: now,
    userAgent: req.headers['user-agent'] || ''
  });

  res.json({ ok: true });
});

// Compatibilità vecchio flusso QR vitasemper.com
router.get('/scan', async (req, res) => {
  const tokens = await loadTokens();
  const token = newToken();
  const now = new Date().toISOString();
  tokens[token] = { created: now, uses: 0, history: [], source: 'scan' };
  await saveTokens(tokens);
  logBibaSheet({ token, tipo: 'scan', timestamp: now, userAgent: req.headers['user-agent'] || '' });
  res.redirect(`/biba/unlock?t=${token}`);
});

router.get('/unlock', (req, res) => {
  res.sendFile('biba_vetrina.html', { root: PUBLIC_DIR });
});

router.get('/combo', (req, res) => {
  res.sendFile('biba_cassa.html', { root: PUBLIC_DIR });
});

router.get('/referral', (req, res) => {
  res.redirect('/biba/unlock');
});

// Cassa: attiva token (richiede PIN cassiera)
router.post('/activate/:token', async (req, res) => {
  const { token } = req.params;
  const { pin } = req.body;

  if (pin !== BIBA_PIN) return res.json({ status: 'wrong_pin' });

  const tokens = await loadTokens();
  if (!tokens[token]) return res.json({ status: 'invalid' });
  const t = tokens[token];
  if (t.uses >= 2) return res.json({ status: 'blocked' });
  t.uses++;
  t.history.push(new Date().toISOString());
  await saveTokens(tokens);
  return res.json({ status: t.uses === 1 ? 'first' : 'referral' });
});

// Statistiche admin
router.get('/stats', async (req, res) => {
  const tokens = await loadTokens();
  const all = Object.entries(tokens);
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total: all.length,
    unused: all.filter(([, t]) => t.uses === 0).length,
    used_once: all.filter(([, t]) => t.uses === 1).length,
    used_twice: all.filter(([, t]) => t.uses >= 2).length,
    today: all.filter(([, t]) => t.created.startsWith(today)).length,
    recent: all.slice(-30).reverse().map(([k, t]) => ({ token: k, uses: t.uses, created: t.created }))
  };
  res.send(statsHTML(stats));
});

export default router;

// ─── HTML Pages ───────────────────────────────────────────────────────────────

function statsHTML(stats) {
  const rows = stats.recent.map(t =>
    `<tr><td>${t.token}</td><td>${t.uses}/2</td><td>${t.created.replace('T',' ').slice(0,16)}</td></tr>`
  ).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Biba Stats</title>
<style>
  body{background:#0d0d0d;color:#f0e6cc;font-family:monospace;padding:40px;max-width:800px;margin:0 auto}
  h1{color:#c9a84c;letter-spacing:4px;margin-bottom:30px}
  .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:40px}
  .card{background:#111;border:1px solid #222;padding:20px;text-align:center}
  .card .num{font-size:36px;font-weight:700;color:#c9a84c}
  .card .label{font-size:11px;color:#666;margin-top:6px;text-transform:uppercase;letter-spacing:2px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #1a1a1a;font-size:13px}
  th{color:#c9a84c;font-size:11px;letter-spacing:2px;text-transform:uppercase}
  tr:hover td{background:#111}
</style></head>
<body>
<h1>BIBA · STATISTICHE</h1>
<div class="grid">
  <div class="card"><div class="num">${stats.today}</div><div class="label">Oggi</div></div>
  <div class="card"><div class="num">${stats.total}</div><div class="label">Totale scan</div></div>
  <div class="card"><div class="num">${stats.unused}</div><div class="label">Non usati</div></div>
  <div class="card"><div class="num">${stats.used_once}</div><div class="label">Usati 1x</div></div>
  <div class="card"><div class="num">${stats.used_twice}</div><div class="label">Referral</div></div>
</div>
<table>
  <thead><tr><th>Token</th><th>Usi</th><th>Data</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}
