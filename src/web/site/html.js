// ReplayDesk page shell: escaping, the <head>, logo, navbar, footer and buttons. Server-rendered HTML strings;
// behaviour comes from /assets/site.js (no inline scripts except the nonce'd theme line).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { icon } = require('./icons');

const SITE = {
  name: 'ReplayDesk',
  tagline: "Rewind the market. Trade it like it's live.",
  description: 'Replay any crypto chart candle by candle, paper trade it with real exchange data, and learn smart money concepts step by step. Free.',
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// assets: read once, served with a content hash in the URL so browsers can cache them for a year
const ASSET_DIR = path.join(__dirname, 'assets');
const ASSETS = {};
for (const f of fs.readdirSync(ASSET_DIR)) {
  const body = fs.readFileSync(path.join(ASSET_DIR, f));
  ASSETS[f] = { body, hash: crypto.createHash('sha256').update(body).digest('hex').slice(0, 10) };
}
// the simulator's SMC engine (src/web/smcEngine.js): the desk's SMC overlay runs the same code, served as /assets/smc.js
try {
  const body = fs.readFileSync(path.join(__dirname, '..', 'smcEngine.js'));
  ASSETS['smc.js'] = { body, hash: crypto.createHash('sha256').update(body).digest('hex').slice(0, 10) };
} catch (e) { /* no overlay; the desk still works */ }
const asset = f => `/assets/${f}?v=${ASSETS[f] ? ASSETS[f].hash : '0'}`;

const LOGO_SVG = (size = 32, id = 'g') => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" class="logo-mark" aria-hidden="true">
<defs><linearGradient id="rd-${id}" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4f7cff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
<rect width="32" height="32" rx="8.5" fill="url(#rd-${id})"/>
<path d="M7.07 19.25 A9.5 9.5 0 1 0 7.07 12.75" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round"/>
<path d="M4.3 11.2 L9.9 11.5 L6.8 15.6 Z" fill="#fff"/>
<g stroke="#fff" stroke-width="1.15" stroke-linecap="round"><line x1="12.2" y1="13.4" x2="12.2" y2="21.6" opacity="0.75"/><line x1="16" y1="10.4" x2="16" y2="19.6"/><line x1="19.8" y1="8.9" x2="19.8" y2="16.8"/></g>
<g fill="#fff"><rect x="11" y="15.4" width="2.4" height="4.4" rx="0.6" opacity="0.75"/><rect x="14.8" y="12.2" width="2.4" height="5.4" rx="0.6"/><rect x="18.6" y="10.4" width="2.4" height="4.4" rx="0.6"/></g></svg>`;
let logoN = 0;
const logo = (size = 30) => `<span class="logo">${LOGO_SVG(size, 'l' + (++logoN))}<span class="logo-word">Replay<span class="text-brand">Desk</span></span></span>`;
const FAVICON = LOGO_SVG(32, 'fav').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');

const btn = (href, label, cls = 'btn-primary') => `<a href="${esc(href)}" class="btn ${cls}">${label}</a>`;

/** The whole document. nonce: per-request CSP nonce for the theme line. */
function page({ title, description, body, nonce, scripts = [], bodyClass = '', noindex = false, head = '', bodyData = {} }) {
  const full = title ? `${title} · ${SITE.name}` : `${SITE.name} — ${SITE.tagline}`;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(full)}</title><meta name="description" content="${esc(description || SITE.description)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${SITE.name}"><meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description || SITE.description)}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#07090d"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f7f8fb">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<script nonce="${nonce}">try{var t=localStorage.getItem('rd-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap">
<link rel="stylesheet" href="${asset('site.css')}">${head}
</head><body class="${bodyClass}"${Object.entries(bodyData).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}>
${body}
<script src="${asset('site.js')}" defer></script>
${scripts.join('\n')}
</body></html>`;
}

const themeBtn = () => `<button type="button" class="icon-btn" data-theme-toggle aria-label="Switch theme"><span class="only-dark">${icon('sun', 'i-45')}</span><span class="only-light">${icon('moon', 'i-45')}</span></button>`;

const NAV = [['/#features', 'Features'], ['/#how', 'How it works'], ['/learn', 'Learn'], ['/#pricing', 'Pricing'], ['/#faq', 'FAQ']];
/** Public navbar. who: null | { admin, keyOnly } */
function navbar(who) {
  const right = who
    ? (who.keyOnly ? btn('/dashboard', 'Open the dashboard', 'btn-primary btn-sm') : btn('/app', 'Open the desk', 'btn-primary btn-sm'))
    : `${btn('/signin', 'Sign in', 'btn-ghost btn-sm')}${btn('/signup', 'Start free', 'btn-primary btn-sm')}`;
  const mobile = who
    ? (who.keyOnly ? btn('/dashboard', 'Open the dashboard', 'btn-primary span-2') : btn('/app', 'Open the desk', 'btn-primary span-2'))
    : `${btn('/signin', 'Sign in', 'btn-secondary')}${btn('/signup', 'Start free', 'btn-primary')}`;
  return `<header class="nav" data-nav>
<nav class="wrap nav-inner" aria-label="Main">
  <a href="/" aria-label="${SITE.name} home">${logo()}</a>
  <div class="nav-links">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>
  <div class="nav-right">${themeBtn()}${right}</div>
  <div class="nav-right-m">${themeBtn()}<button type="button" class="icon-btn" data-menu-toggle aria-expanded="false" aria-label="Open menu"><span class="when-closed">${icon('menu', 'i-5')}</span><span class="when-open">${icon('x', 'i-5')}</span></button></div>
</nav>
<div class="nav-mobile" data-menu hidden>
  <div class="nav-mobile-links">${NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>
  <div class="nav-mobile-cta">${mobile}</div>
</div>
</header>`;
}

const FOOT = [
  ['Product', [['/#features', 'Features'], ['/#pricing', 'Pricing'], ['/app', 'Open the desk']]],
  ['Learn', [['/learn', 'All guides'], ['/learn', 'Smart money concepts'], ['/#faq', 'FAQ']]],
  ['Legal', [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/risk', 'Risk disclosure']]],
];
function footer() {
  return `<footer class="footer"><div class="wrap">
<div class="foot-grid">
  <div>${logo()}<p class="foot-blurb">Replay the crypto market candle by candle, paper trade it and learn smart money concepts. Free.</p></div>
  ${FOOT.map(([t, ls]) => `<div><h3>${t}</h3><ul>${ls.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div>`).join('')}
</div>
<div class="foot-legal">
  <p>ReplayDesk is an education and practice tool. Nothing on this site is financial advice. Paper results and past charts do not
  predict future results. Trading crypto, especially with leverage, carries a high risk of loss.</p>
  <p>© ${new Date().getFullYear()} ReplayDesk. Charts by <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a>.</p>
</div></div></footer>`;
}

/** Same-site paths only after sign-in (no open redirects). */
function safeNext(n, fallback = '/app') {
  const s = Array.isArray(n) ? n[0] : n;
  return typeof s === 'string' && s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && s.length < 300 ? s : fallback;
}

module.exports = { SITE, esc, ASSETS, asset, logo, LOGO_SVG, FAVICON, btn, page, navbar, footer, themeBtn, safeNext, icon };
