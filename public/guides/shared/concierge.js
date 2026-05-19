(function () {
  const LANGS = ['it', 'en', 'fr', 'es', 'de'];
  const FLAGS = { it: '🇮🇹', en: '🇬🇧', fr: '🇫🇷', es: '🇪🇸', de: '🇩🇪' };
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
      `<a class="flag${l === activeLang ? ' active' : ''}" href="#" data-lang="${l}" aria-label="${l}">${FLAGS[l]}</a>`
    ).join('');
    return `<header class="topbar"><div class="brand">${esc(data.brand)}</div><div class="flags" aria-label="Language selector">${flags}</div></header>`;
  }

  function renderHeroSvg(data) {
    const apt = data.apartment;
    const name = data.heroTitle;
    const emoji = data.heroEmoji;
    const c = data.heroColors;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 900 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="hg-${apt}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${c.from}"/>
          <stop offset="55%" stop-color="${c.mid}"/>
          <stop offset="100%" stop-color="#090604"/>
        </linearGradient>
        <radialGradient id="hr-${apt}" cx="70%" cy="20%" r="65%">
          <stop offset="0%" stop-color="#c9a45c" stop-opacity="0.55"/>
          <stop offset="55%" stop-color="#c9a45c" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#c9a45c" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="900" height="600" fill="url(#hg-${apt})"/>
      <rect width="900" height="600" fill="url(#hr-${apt})"/>
      <circle cx="735" cy="120" r="132" fill="#c9a45c" opacity=".10"/>
      <circle cx="120" cy="480" r="190" fill="#ffffff" opacity=".035"/>
      <path d="M60 470 C220 360,330 530,480 430 S720 300,840 385" fill="none" stroke="#c9a45c" stroke-width="2" opacity=".24"/>
      <path d="M70 120 H830" stroke="#c9a45c" stroke-width="1" opacity=".20"/>
      <path d="M70 480 H830" stroke="#c9a45c" stroke-width="1" opacity=".16"/>
      <g transform="translate(70 82)">
        <rect x="0" y="0" width="760" height="436" rx="36" fill="#000000" opacity=".18" stroke="#c9a45c" stroke-opacity=".32"/>
        <text x="380" y="170" text-anchor="middle" font-size="94" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">${emoji}</text>
        <text x="380" y="270" text-anchor="middle" fill="#fff6e8" font-size="54" font-family="Georgia,Times New Roman,serif">${name}</text>
        <text x="380" y="324" text-anchor="middle" fill="#c9a45c" font-size="24" font-weight="700" letter-spacing="3" font-family="Arial,Helvetica,sans-serif">Roma Home Concierge</text>
      </g>
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
