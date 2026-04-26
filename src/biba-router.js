import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '../data/biba-tokens.json');
const router = express.Router();

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

// QR punta qui → genera token → redirect unlock
router.get('/scan', async (req, res) => {
  const tokens = await loadTokens();
  const token = newToken();
  tokens[token] = { created: new Date().toISOString(), uses: 0, history: [] };
  await saveTokens(tokens);
  res.redirect(`/biba/unlock?t=${token}`);
});

// Pagina unlock
router.get('/unlock', (req, res) => {
  const token = req.query.t || '';
  res.send(unlockHTML(token));
});

// Pagina combinazioni
router.get('/combo', (req, res) => {
  res.send(comboHTML());
});

// Pagina referral
router.get('/referral', (req, res) => {
  res.send(referralHTML());
});

// Cassa: attiva token
router.post('/activate/:token', async (req, res) => {
  const { token } = req.params;
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

function unlockHTML(token) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Biba – Unlock</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d0d0d;color:#fff;font-family:'Montserrat',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:30px 20px;text-align:center}
  .brand{font-size:42px;font-weight:900;letter-spacing:10px;color:#c9a84c;text-transform:uppercase;margin-bottom:6px}
  .brand-sub{font-size:11px;letter-spacing:6px;color:#c9a84c;text-transform:uppercase;margin-bottom:30px}
  .congrats{font-size:28px;font-weight:900;color:#e63946;text-transform:uppercase;letter-spacing:3px;margin-bottom:24px}
  .gift{font-size:110px;animation:pulse 1.5s ease-in-out infinite}
  @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
  .promo{font-size:20px;font-weight:700;color:#f9c74f;text-transform:uppercase;letter-spacing:2px;margin:24px 0 10px}
  .token-box{border:1px solid #c9a84c;padding:10px 24px;margin:20px auto;display:inline-block;font-size:22px;font-weight:700;color:#c9a84c;letter-spacing:4px}
  .token-label{font-size:10px;letter-spacing:3px;color:#666;text-transform:uppercase;margin-bottom:4px}
  .show{font-size:13px;color:#888;margin:10px 0 28px;letter-spacing:1px}
  .btn-combo{display:block;background:#e63946;color:#000;font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:18px 32px;text-decoration:none;margin:0 auto 16px;max-width:340px}
  .btn-referral{display:block;background:#f9c74f;color:#000;font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:2px;padding:14px 24px;text-decoration:none;margin:0 auto 30px;max-width:340px;animation:blink 1s step-start infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
  .cashier-section{margin-top:40px;border-top:1px solid #222;padding-top:24px;width:100%;max-width:340px}
  .cashier-label{font-size:9px;letter-spacing:3px;color:#444;text-transform:uppercase;margin-bottom:12px}
  .btn-activate{background:transparent;border:1px solid #333;color:#555;font-size:12px;letter-spacing:2px;text-transform:uppercase;padding:10px 20px;cursor:pointer;width:100%}
  .btn-activate:hover{border-color:#c9a84c;color:#c9a84c}
  .activate-result{margin-top:12px;font-size:14px;font-weight:700;letter-spacing:1px;display:none}
</style>
</head>
<body>
  <div class="brand">BIBA</div>
  <div class="brand-sub">BOUTIQUE · ROMA</div>

  <div class="congrats">CONGRATULAZIONI!</div>
  <div class="gift">🎁</div>
  <div class="promo">PAGA 2 → IL 3° È TUO</div>
  <div class="show">Mostra questo schermo alla cassa</div>

  <div class="token-label">Il tuo codice</div>
  <div class="token-box">${token}</div>

  <a class="btn-combo" href="/biba/combo">COMBINA GLI ARTICOLI</a>
  <a class="btn-referral" href="/biba/referral">✨ ADDITIONAL FREE ITEMS ✨</a>

  <!-- SEZIONE CASSA (per uso interno) -->
  <div class="cashier-section">
    <div class="cashier-label">Solo per il personale di cassa</div>
    <button class="btn-activate" onclick="activate()">▸ ATTIVA CODICE ALLA CASSA</button>
    <div class="activate-result" id="result"></div>
  </div>

<script>
async function activate() {
  const btn = document.querySelector('.btn-activate');
  btn.disabled = true;
  btn.textContent = 'Attivazione in corso...';
  try {
    const res = await fetch('/biba/activate/${token}', { method: 'POST' });
    const data = await res.json();
    const el = document.getElementById('result');
    el.style.display = 'block';
    if (data.status === 'first') {
      el.style.color = '#4caf50';
      el.textContent = '✅ Attivazione OK — applica 2+1 gratis';
    } else if (data.status === 'referral') {
      el.style.color = '#f9c74f';
      el.textContent = '🎁 Referral OK — spilla gratis per il cliente';
    } else if (data.status === 'blocked') {
      el.style.color = '#e63946';
      el.textContent = '❌ Codice già utilizzato 2 volte';
      btn.textContent = 'CODICE BLOCCATO';
    } else {
      el.style.color = '#e63946';
      el.textContent = '❌ Codice non valido';
    }
  } catch {
    document.getElementById('result').textContent = 'Errore di rete';
    document.getElementById('result').style.display = 'block';
  }
}
</script>
</body>
</html>`;
}

function comboHTML() {
  const langs = {
    it: { label: '🇮🇹 Italiano', title: 'La nostra offerta di oggi', promo: 'Compra 2 articoli → il 3° è GRATIS', combos: [
      { name: 'Foulard + Cappello → Spilla GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Foulard', p2: 'Cappello', p3: 'Spilla' },
      { name: 'Foulard + Foulard → Spilla GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Foulard', p2: 'Foulard', p3: 'Spilla' },
      { name: 'Cappello + Foulard → Cappello GRATIS', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Cappello', p2: 'Foulard', p3: 'Cappello' }
    ]},
    en: { label: '🇬🇧 English', title: "Today's special offer", promo: 'Buy 2 items → get the 3rd FREE', combos: [
      { name: 'Scarf + Hat → Pin FREE', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Scarf', p2: 'Hat', p3: 'Pin' },
      { name: 'Scarf + Scarf → Pin FREE', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Scarf', p2: 'Scarf', p3: 'Pin' },
      { name: 'Hat + Scarf → Hat FREE', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Hat', p2: 'Scarf', p3: 'Hat' }
    ]},
    fr: { label: '🇫🇷 Français', title: 'Notre offre du jour', promo: 'Achetez 2 articles → le 3ème est GRATUIT', combos: [
      { name: 'Foulard + Chapeau → Épingle GRATUITE', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Foulard', p2: 'Chapeau', p3: 'Épingle' },
      { name: 'Foulard + Foulard → Épingle GRATUITE', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Foulard', p2: 'Foulard', p3: 'Épingle' },
      { name: 'Chapeau + Foulard → Chapeau GRATUIT', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Chapeau', p2: 'Foulard', p3: 'Chapeau' }
    ]},
    de: { label: '🇩🇪 Deutsch', title: 'Unser heutiges Angebot', promo: '2 Artikel kaufen → das 3. ist GRATIS', combos: [
      { name: 'Tuch + Hut → Nadel GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Tuch', p2: 'Hut', p3: 'Nadel' },
      { name: 'Tuch + Tuch → Nadel GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Tuch', p2: 'Tuch', p3: 'Nadel' },
      { name: 'Hut + Tuch → Hut GRATIS', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Hut', p2: 'Tuch', p3: 'Hut' }
    ]},
    es: { label: '🇪🇸 Español', title: 'Nuestra oferta de hoy', promo: 'Compra 2 artículos → el 3° es GRATIS', combos: [
      { name: 'Pañuelo + Sombrero → Broche GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Pañuelo', p2: 'Sombrero', p3: 'Broche' },
      { name: 'Pañuelo + Pañuelo → Broche GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Pañuelo', p2: 'Pañuelo', p3: 'Broche' },
      { name: 'Sombrero + Pañuelo → Sombrero GRATIS', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Sombrero', p2: 'Pañuelo', p3: 'Sombrero' }
    ]},
    zh: { label: '🇨🇳 中文', title: '今日特别优惠', promo: '购买2件 → 第3件免费', combos: [
      { name: '丝巾 + 帽子 → 胸针免费', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: '丝巾', p2: '帽子', p3: '胸针' },
      { name: '丝巾 + 丝巾 → 胸针免费', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: '丝巾', p2: '丝巾', p3: '胸针' },
      { name: '帽子 + 丝巾 → 帽子免费', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: '帽子', p2: '丝巾', p3: '帽子' }
    ]},
    ru: { label: '🇷🇺 Русский', title: 'Специальное предложение дня', promo: 'Купи 2 → получи 3-й БЕСПЛАТНО', combos: [
      { name: 'Платок + Шляпа → Брошь БЕСПЛАТНО', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Платок', p2: 'Шляпа', p3: 'Брошь' },
      { name: 'Платок + Платок → Брошь БЕСПЛАТНО', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Платок', p2: 'Платок', p3: 'Брошь' },
      { name: 'Шляпа + Платок → Шляпа БЕСПЛАТНО', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Шляпа', p2: 'Платок', p3: 'Шляпа' }
    ]},
    ja: { label: '🇯🇵 日本語', title: '本日の特別オファー', promo: '2点ご購入 → 3点目は無料', combos: [
      { name: 'スカーフ＋帽子→ブローチ無料', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'スカーフ', p2: '帽子', p3: 'ブローチ' },
      { name: 'スカーフ＋スカーフ→ブローチ無料', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'スカーフ', p2: 'スカーフ', p3: 'ブローチ' },
      { name: '帽子＋スカーフ→帽子無料', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: '帽子', p2: 'スカーフ', p3: '帽子' }
    ]},
    pl: { label: '🇵🇱 Polski', title: 'Nasza dzisiejsza oferta', promo: 'Kup 2 artykuły → 3. jest GRATIS', combos: [
      { name: 'Fular + Kapelusz → Broszka GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Fular', p2: 'Kapelusz', p3: 'Broszka' },
      { name: 'Fular + Fular → Broszka GRATIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Fular', p2: 'Fular', p3: 'Broszka' },
      { name: 'Kapelusz + Fular → Kapelusz GRATIS', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Kapelusz', p2: 'Fular', p3: 'Kapelusz' }
    ]},
    pt: { label: '🇧🇷 Português', title: 'Nossa oferta de hoje', promo: 'Compre 2 artigos → o 3° é GRÁTIS', combos: [
      { name: 'Lenço + Chapéu → Broche GRÁTIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'Lenço', p2: 'Chapéu', p3: 'Broche' },
      { name: 'Lenço + Lenço → Broche GRÁTIS', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'Lenço', p2: 'Lenço', p3: 'Broche' },
      { name: 'Chapéu + Lenço → Chapéu GRÁTIS', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'Chapéu', p2: 'Lenço', p3: 'Chapéu' }
    ]},
    ar: { label: '🇸🇦 العربية', title: 'عرض اليوم الخاص', promo: 'اشترِ 2 → الثالث مجاناً', combos: [
      { name: 'وشاح + قبعة → دبوس مجاناً', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: 'وشاح', p2: 'قبعة', p3: 'دبوس' },
      { name: 'وشاح + وشاح → دبوس مجاناً', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: 'وشاح', p2: 'وشاح', p3: 'دبوس' },
      { name: 'قبعة + وشاح → قبعة مجاناً', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: 'قبعة', p2: 'وشاح', p3: 'قبعة' }
    ]},
    ko: { label: '🇰🇷 한국어', title: '오늘의 특별 혜택', promo: '2개 구매 → 3번째 무료', combos: [
      { name: '스카프 + 모자 → 브로치 무료', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img3: '/brooch.png', p1: '스카프', p2: '모자', p3: '브로치' },
      { name: '스카프 + 스카프 → 브로치 무료', img1: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: '/brooch.png', p1: '스카프', p2: '스카프', p3: '브로치' },
      { name: '모자 + 스카프 → 모자 무료', img1: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', img2: 'https://bjoux.it/wp-content/uploads/2024/04/F484-1.jpg', img3: 'https://www.bagsoftheworld.com/cdn/shop/files/BagsoftheWorldCurveBrimHatLargeBrimMadagascanEmerald1_580x.png?v=1771997314', p1: '모자', p2: '스카프', p3: '모자' }
    ]}
  };

  const buttonsHTML = Object.entries(langs).map(([code, l]) =>
    `<button class="lang-btn" onclick="showLang('${code}')">${l.label}</button>`
  ).join('');

  const langsJSON = JSON.stringify(langs);

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Biba – Combinazioni</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Montserrat:wght@300;400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d0d0d;color:#f0e6cc;font-family:'Montserrat',sans-serif;min-height:100vh}
  #landing{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center}
  .brand{font-family:'Cormorant Garamond',serif;font-size:72px;font-weight:300;letter-spacing:16px;color:#c9a84c;text-transform:uppercase}
  .brand-sub{font-size:11px;letter-spacing:6px;color:#c9a84c;margin:6px 0 30px}
  .gold-line{height:1px;background:linear-gradient(to right,transparent,#c9a84c,transparent);margin:0 auto 30px;width:200px}
  .offer-title{font-family:'Cormorant Garamond',serif;font-size:22px;font-style:italic;color:#f0e6cc;letter-spacing:2px;margin-bottom:36px}
  .lang-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;max-width:500px}
  .lang-btn{border:1px solid #c9a84c;background:transparent;color:#c9a84c;font-family:'Montserrat',sans-serif;font-size:13px;letter-spacing:2px;padding:10px 18px;cursor:pointer;text-transform:uppercase;transition:all .3s}
  .lang-btn:hover{background:#c9a84c;color:#000}
  #offer-page{display:none;min-height:100vh;padding:40px 20px}
  .offer-header{text-align:center;padding:30px 0 20px}
  .offer-brand{font-family:'Cormorant Garamond',serif;font-size:52px;font-weight:300;letter-spacing:12px;color:#c9a84c;text-transform:uppercase}
  .offer-day{font-family:'Cormorant Garamond',serif;font-size:20px;font-style:italic;color:#f0e6cc;margin-top:8px}
  .promo-text{text-align:center;font-size:18px;font-weight:700;color:#f9c74f;letter-spacing:2px;text-transform:uppercase;padding:24px 20px;margin-bottom:10px}
  .combo-tabs{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:30px}
  .combo-tab{border:1px solid #333;background:transparent;color:#666;font-size:11px;letter-spacing:2px;padding:8px 14px;cursor:pointer;text-transform:uppercase;transition:all .3s}
  .combo-tab.active{border-color:#c9a84c;color:#c9a84c}
  .combo-view{display:none}
  .combo-view.active{display:flex;justify-content:center;align-items:flex-start;flex-wrap:wrap;gap:0 16px;max-width:900px;margin:0 auto}
  .prod{text-align:center;flex:1;min-width:200px;max-width:260px}
  .prod img{width:100%;height:240px;object-fit:cover;border:1px solid #1a1a1a;display:block}
  .prod-name{font-size:14px;letter-spacing:2px;color:#f0e6cc;margin-top:12px;text-transform:uppercase}
  .math{display:flex;align-items:center;justify-content:center;font-size:50px;color:#c9a84c;font-weight:300;height:240px;margin-bottom:46px;padding:0 8px;flex-shrink:0}
  .free-label{font-family:'Cormorant Garamond',serif;font-size:38px;font-weight:700;color:#c9a84c;text-align:center;margin-bottom:14px}
  .back-btn{display:block;margin:40px auto 0;background:transparent;border:1px solid #333;color:#666;font-size:11px;letter-spacing:3px;text-transform:uppercase;padding:10px 24px;cursor:pointer;transition:all .3s}
  .back-btn:hover{border-color:#c9a84c;color:#c9a84c}
</style>
</head>
<body>
<div id="landing">
  <div class="brand">BIBA</div>
  <div class="brand-sub">BOUTIQUE · ROMA</div>
  <div class="gold-line"></div>
  <div class="offer-title">La nostra offerta di oggi</div>
  <div class="lang-grid">${buttonsHTML}</div>
</div>

<div id="offer-page">
  <div class="offer-header">
    <div class="gold-line"></div>
    <div class="offer-brand">BIBA</div>
    <div class="offer-day" id="offer-day-text"></div>
    <div class="gold-line" style="margin-top:20px"></div>
  </div>
  <div class="promo-text" id="promo-text"></div>
  <div class="combo-tabs" id="combo-tabs"></div>
  <div id="combo-views"></div>
  <button class="back-btn" onclick="goBack()">← Scegli un'altra lingua</button>
</div>

<script>
const langs = ${langsJSON};
function showLang(code) {
  const l = langs[code];
  document.getElementById('landing').style.display = 'none';
  const op = document.getElementById('offer-page');
  op.style.display = 'block';
  document.getElementById('offer-day-text').textContent = l.title;
  document.getElementById('promo-text').textContent = l.promo;
  const tabs = document.getElementById('combo-tabs');
  const views = document.getElementById('combo-views');
  tabs.innerHTML = '';
  views.innerHTML = '';
  l.combos.forEach((c, i) => {
    const tab = document.createElement('button');
    tab.className = 'combo-tab' + (i===0?' active':'');
    tab.textContent = i===0?'①':i===1?'②':'③';
    tab.onclick = () => switchCombo(i);
    tabs.appendChild(tab);
    const view = document.createElement('div');
    view.className = 'combo-view' + (i===0?' active':'');
    view.id = 'combo-' + i;
    view.innerHTML = \`
      <div class="prod"><img src="\${c.img1}" alt="\${c.p1}"/><div class="prod-name">\${c.p1}</div></div>
      <div class="math">+</div>
      <div class="prod"><img src="\${c.img2}" alt="\${c.p2}"/><div class="prod-name">\${c.p2}</div></div>
      <div class="math">=</div>
      <div class="prod">
        <div class="free-label">GRATIS</div>
        <img src="\${c.img3}" alt="\${c.p3}"/>
        <div class="prod-name">\${c.p3}</div>
      </div>\`;
    views.appendChild(view);
  });
  window.scrollTo(0,0);
}
function switchCombo(idx) {
  document.querySelectorAll('.combo-tab').forEach((t,i) => t.classList.toggle('active', i===idx));
  document.querySelectorAll('.combo-view').forEach((v,i) => v.classList.toggle('active', i===idx));
}
function goBack() {
  document.getElementById('offer-page').style.display = 'none';
  document.getElementById('landing').style.display = 'flex';
  window.scrollTo(0,0);
}
</script>
</body>
</html>`;
}

function referralHTML() {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Biba – Referral</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#0d0d0d;color:#fff;font-family:'Montserrat',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center}
  .brand{font-size:36px;font-weight:900;letter-spacing:8px;color:#c9a84c;text-transform:uppercase;margin-bottom:4px}
  .brand-sub{font-size:10px;letter-spacing:5px;color:#c9a84c;margin-bottom:32px}
  h1{font-size:28px;font-weight:900;color:#e63946;text-transform:uppercase;letter-spacing:3px;margin-bottom:24px}
  .subtitle{font-size:18px;font-weight:700;color:#f9c74f;text-transform:uppercase;letter-spacing:2px;margin-bottom:28px}
  .brooch-img{width:220px;height:220px;object-fit:cover;border-radius:50%;margin:0 auto 28px;display:block;transform:rotate(90deg)}
  .message{font-size:14px;color:#888;letter-spacing:1px;line-height:1.6;max-width:300px;margin:0 auto 32px}
  .back-btn{background:transparent;border:1px solid #333;color:#666;font-size:11px;letter-spacing:3px;text-transform:uppercase;padding:10px 24px;cursor:pointer}
  .back-btn:hover{border-color:#c9a84c;color:#c9a84c}
</style>
</head>
<body>
  <div class="brand">BIBA</div>
  <div class="brand-sub">BOUTIQUE · ROMA</div>
  <h1>PORTA UN AMICO</h1>
  <div class="subtitle">TU RICEVI UNA SPILLA GRATIS</div>
  <img class="brooch-img" src="/brooch.png" alt="Spilla"/>
  <div class="message">Se il tuo amico usa l'offerta 2+1, alla tua prossima visita ricevi questa spilla in omaggio. Mostra questo schermo alla cassa.</div>
  <button class="back-btn" onclick="history.back()">← Torna indietro</button>
</body>
</html>`;
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
