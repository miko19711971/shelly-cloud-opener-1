import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import cors from 'cors';

const bibaCors = cors({
  origin: ['https://biba-boutique.onrender.com', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS']
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE  = path.join(__dirname, '../data/biba-tokens.json');
const SCANS_FILE = path.join(__dirname, '../data/biba-scans.json');
const PUBLIC_DIR = path.join(__dirname, '../public');
const BIBA_SHEETS_URL = process.env.BIBA_SHEETS_URL ||
  'https://script.google.com/macros/s/AKfycbwyIsEPFP2jQ_cDGDyudUjDHZG6Vs1L36O2qeDttejWFQk6415HlC3NL5_vTblYA72lTQ/exec';
const BIBA_PIN = process.env.BIBA_PIN || '6793';
const router = express.Router();

// ─── Scansioni storage ────────────────────────────────────────────────────────

async function loadScans() {
  try {
    const raw = await fs.readFile(SCANS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function logScan(data) {
  await fs.mkdir(path.dirname(SCANS_FILE), { recursive: true });
  const scans = await loadScans();
  scans.push(data);
  await fs.writeFile(SCANS_FILE, JSON.stringify(scans, null, 2));

  // Opzionale: invia anche a Google Sheets se configurato
  if (BIBA_SHEETS_URL) {
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
router.options('/new-token', bibaCors);
router.get('/new-token', bibaCors, async (req, res) => {
  const tokens = await loadTokens();
  const token = newToken();
  const now = new Date().toISOString();
  tokens[token] = { created: now, uses: 0, history: [], source: 'vetrina' };
  await saveTokens(tokens);

  logScan({
    token,
    tipo: 'vetrina',
    timestamp: now,
    userAgent: req.headers['user-agent'] || ''
  });

  res.json({ token });
});

// Cassa QR → chiamato da biba_cassa.html al caricamento
// Logga "cassa" su Sheet
router.options('/log-scan', bibaCors);
router.post('/log-scan', bibaCors, async (req, res) => {
  const { token, tipo } = req.body;
  const now = new Date().toISOString();

  logScan({
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
  logScan({ token, tipo: 'scan', timestamp: now, userAgent: req.headers['user-agent'] || '' });
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
router.options('/activate/:token', bibaCors);
router.post('/activate/:token', bibaCors, async (req, res) => {
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

// Scansioni admin — tabella HTML
router.get('/scansioni', async (req, res) => {
  const scans = await loadScans();
  res.send(scansHTML(scans));
});

// Scansioni admin — export CSV
router.get('/scansioni.csv', async (req, res) => {
  const scans = await loadScans();
  const rows = scans.map(s => [
    s.token || '',
    s.tipo  || '',
    s.timestamp ? s.timestamp.replace('T',' ').slice(0,19) : '',
    (s.userAgent || '').replace(/,/g,' ')
  ].join(','));
  const csv = 'Token,Tipo,Timestamp,UserAgent\n' + rows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="biba-scansioni.csv"');
  res.send(csv);
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

function scansHTML(scans) {
  const rows = [...scans].reverse().slice(0, 200).map(s => {
    const ts = s.timestamp ? s.timestamp.replace('T',' ').slice(0,19) : '';
    const tipo = s.tipo === 'vetrina'
      ? '<span style="color:#c9a84c">VETRINA</span>'
      : '<span style="color:#4caf50">CASSA</span>';
    return `<tr><td>${ts}</td><td>${tipo}</td><td style="font-family:monospace">${s.token||'—'}</td></tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Biba Scansioni</title>
<style>
  body{background:#0d0d0d;color:#f0e6cc;font-family:monospace;padding:30px;max-width:900px;margin:0 auto}
  h1{color:#c9a84c;letter-spacing:4px;margin-bottom:8px}
  .sub{font-size:12px;color:#444;margin-bottom:24px}
  .btn{display:inline-block;background:#c9a84c;color:#000;font-size:11px;font-weight:700;
    letter-spacing:2px;text-transform:uppercase;padding:8px 18px;text-decoration:none;
    border-radius:2px;margin-bottom:28px}
  .tot{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px}
  .card{background:#111;border:1px solid #222;padding:16px;text-align:center}
  .num{font-size:30px;font-weight:700;color:#c9a84c}
  .lbl{font-size:10px;color:#555;margin-top:4px;letter-spacing:2px;text-transform:uppercase}
  table{width:100%;border-collapse:collapse}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #1a1a1a;font-size:12px}
  th{color:#c9a84c;font-size:10px;letter-spacing:2px;text-transform:uppercase}
</style></head>
<body>
<h1>BIBA · SCANSIONI</h1>
<div class="sub">Ultime 200 — aggiornato in tempo reale</div>
<a class="btn" href="/biba/scansioni.csv">⬇ Esporta CSV</a>
<div class="tot">
  <div class="card"><div class="num">${scans.length}</div><div class="lbl">Totale</div></div>
  <div class="card"><div class="num">${scans.filter(s=>s.tipo==='vetrina').length}</div><div class="lbl">Vetrina</div></div>
  <div class="card"><div class="num">${scans.filter(s=>s.tipo==='cassa').length}</div><div class="lbl">Cassa</div></div>
</div>
<table>
  <thead><tr><th>Timestamp</th><th>Tipo</th><th>Token</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

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
