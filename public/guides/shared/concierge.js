(function () {
  const LANGS = ['it', 'en', 'fr', 'es', 'de'];
  const FLAG_LABELS = { it: 'IT', en: 'EN', fr: 'FR', es: 'ES', de: 'DE' };
  // Inline SVG flags — no external dependency
  const FLAG_SVGS = {
    it: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 2'><rect width='1' height='2' fill='%23009246'/><rect x='1' width='1' height='2' fill='%23fff'/><rect x='2' width='1' height='2' fill='%23CE2B37'/></svg>`,
    en: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 30'><rect width='60' height='30' fill='%23012169'/><path d='M0,0 L60,30 M60,0 L0,30' stroke='%23fff' stroke-width='6'/><path d='M0,0 L60,30 M60,0 L0,30' stroke='%23C8102E' stroke-width='4'/><path d='M30,0 V30 M0,15 H60' stroke='%23fff' stroke-width='10'/><path d='M30,0 V30 M0,15 H60' stroke='%23C8102E' stroke-width='6'/></svg>`,
    fr: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 2'><rect width='1' height='2' fill='%230055A4'/><rect x='1' width='1' height='2' fill='%23fff'/><rect x='2' width='1' height='2' fill='%23EF4135'/></svg>`,
    es: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 2'><rect width='3' height='2' fill='%23c60b1e'/><rect y='0.5' width='3' height='1' fill='%23ffc400'/></svg>`,
    de: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 5 3'><rect width='5' height='3' fill='%23000'/><rect y='1' width='5' height='2' fill='%23D00'/><rect y='2' width='5' height='1' fill='%23FFCE00'/></svg>`,
  };
  function flagSrc(l) { return `data:image/svg+xml,${FLAG_SVGS[l]}`; }
  let currentLang = 'it';
  let currentSection = 'home';

  function init() {
    const data = window.CONCIERGE;
    const stored = localStorage.getItem('concierge-lang');
    const browserLang = (navigator.language || '').slice(0, 2);
    currentLang = stored && data.langs[stored] ? stored
                : data.langs[browserLang] ? browserLang
                : 'it';
    render();
  }

  function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('concierge-lang', lang);
    render();
  }

  function navigate(section) {
    currentSection = section;
    render();
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderTopbar(data, activeLang) {
    const flags = LANGS.map(l =>
      `<a class="flag${l === activeLang ? ' active' : ''}" href="#" data-lang="${l}" aria-label="${FLAG_LABELS[l]}" title="${FLAG_LABELS[l]}">
        <img src="${flagSrc(l)}" alt="${FLAG_LABELS[l]}" width="22" height="15"/>
      </a>`
    ).join('');
    return `<header class="topbar"><div class="brand">${esc(data.brand)}</div><div class="flags" aria-label="Language selector">${flags}</div></header>`;
  }

  function renderHeroSvg(data) {
    const apt = data.apartment;
    const name = data.heroTitle;
    const c = data.heroColors;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="hg-${apt}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${c.from}"/>
          <stop offset="50%" stop-color="${c.mid}"/>
          <stop offset="100%" stop-color="#090604"/>
        </linearGradient>
        <radialGradient id="hr-${apt}" cx="72%" cy="18%" r="64%">
          <stop offset="0%" stop-color="#c9a45c" stop-opacity="0.40"/>
          <stop offset="56%" stop-color="#c9a45c" stop-opacity="0.11"/>
          <stop offset="100%" stop-color="#c9a45c" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#hg-${apt})"/>
      <rect width="1600" height="900" fill="url(#hr-${apt})"/>
      <circle cx="1270" cy="170" r="245" fill="#f2d58a" opacity=".09"/>
      <circle cx="240" cy="720" r="310" fill="#ffffff" opacity=".032"/>
      <path d="M120 675 C360 505,555 755,820 610 S1210 430,1490 560" fill="none" stroke="#c9a45c" stroke-width="3" opacity=".24"/>
      <path d="M120 210 H1480" stroke="#c9a45c" stroke-width="1.5" opacity=".19"/>
      <path d="M120 735 H1480" stroke="#c9a45c" stroke-width="1.5" opacity=".15"/>
      <rect x="115" y="95" width="1370" height="710" rx="58" fill="#000000" opacity=".13" stroke="#c9a45c" stroke-opacity=".32"/>
      <g transform="translate(735,255)" fill="#eee7dc" opacity=".72">
        <path d="M65 0 L0 28 H130 Z"/>
        <rect x="13" y="39" width="14" height="72" rx="3"/>
        <rect x="41" y="39" width="14" height="72" rx="3"/>
        <rect x="75" y="39" width="14" height="72" rx="3"/>
        <rect x="103" y="39" width="14" height="72" rx="3"/>
        <rect x="-4" y="116" width="138" height="11" rx="3"/>
        <rect x="-14" y="134" width="158" height="9" rx="3"/>
      </g>
      <text x="800" y="505" text-anchor="middle" font-family="Georgia,Times New Roman,serif" font-size="104" font-weight="500" fill="#eee7dc" opacity=".72" letter-spacing="1">${esc(name)}</text>
      <text x="800" y="607" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="34" font-weight="800" fill="#ddbe77" opacity=".72" letter-spacing="10">ROMA HOME CONCIERGE</text>
    </svg>`;
  }

  function renderCard(card, sectionKey) {
    const buttons = (card.buttons || []).map((b, i) =>
      `<a class="btn${i === 0 ? ' primary' : ''}" href="${esc(b.href)}" rel="noopener" target="${b.href.startsWith('tel:') || b.href.startsWith('mailto:') ? '_self' : '_blank'}">${esc(b.label)}</a>`
    ).join('');
    return `<article class="place-card">
      <div class="place-img cat-${sectionKey}"></div>
      <div class="place-body">
        <div class="tagline">${esc(card.tagline || '')}</div>
        <h3>${esc(card.name || '')}</h3>
        <p>${esc(card.desc || '')}</p>
        <div class="address">${esc(card.address || '')}</div>
        <div class="actions">${buttons}</div>
      </div>
    </article>`;
  }

  function renderHome(data, lang) {
    const tiles = (lang.tiles || []).map(t =>
      `<div class="tile" data-nav="${esc(t.section)}" role="button" tabindex="0">
        <div><div class="icon">${t.icon}</div><h3>${esc(t.title)}</h3><p>${esc(t.desc)}</p></div>
        <div class="arrow">${esc(t.arrow)}</div>
      </div>`
    ).join('');
    const qa = (lang.quickActions || []).map(a =>
      `<a class="quick" href="${esc(a.href)}" rel="noopener" target="${a.href.startsWith('tel:') ? '_self' : '_blank'}">${esc(a.label)}</a>`
    ).join('');
    return `<div class="screen active screen-home">
      <div class="page">
        ${renderTopbar(data, currentLang)}
        <div class="hero home-empty-hero">
          ${renderHeroSvg(data)}
        </div>
        <section id="menu">
          <div class="section-title"><h2>${esc(lang.menuTitle || 'Concierge')}</h2><span>${esc(lang.menuSub || '')}</span></div>
          <div class="menu-grid">${tiles}</div>
          <div class="quick-actions">${qa}</div>
        </section>
        <footer class="footer">${esc(lang.footer || '')}</footer>
      </div>
    </div>`;
  }

  function renderSection(data, lang, sectionKey) {
    const sec = lang.sections[sectionKey];
    if (!sec) return '';
    const cards = (sec.cards || []).map(c => renderCard(c, sectionKey)).join('');
    return `<div class="screen active screen-${sectionKey}">
      <div class="page">
        ${renderTopbar(data, currentLang)}
        <div class="content-block-single">
          <div class="content-head">
            <h2>${esc(sec.header.title)}</h2>
            <button class="back" data-home="1">${esc(sec.header.back)}</button>
          </div>
          <div class="cards">${cards}</div>
        </div>
      </div>
    </div>`;
  }

  function render() {
    const data = window.CONCIERGE;
    const lang = data.langs[currentLang] || data.langs['it'];
    const app = document.getElementById('app');

    if (currentSection === 'home') {
      app.innerHTML = renderHome(data, lang);
    } else {
      app.innerHTML = renderSection(data, lang, currentSection);
    }

    app.querySelectorAll('[data-lang]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); setLang(el.dataset.lang); });
    });
    app.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.nav); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(el.dataset.nav); } });
    });
    app.querySelectorAll('[data-home]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); navigate('home'); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
