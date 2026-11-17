// ReplayDesk pages, as HTML strings. Anything that came from a visitor goes through esc().
const { SITE, esc, logo, LOGO_SVG, btn, page, navbar, footer, themeBtn, asset, icon } = require('./html');

const LWC = '<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js" ' +
  'integrity="sha384-KkYqTZlM13Zya6fVUF3IGCBOQ1ehFeJVVgxaVvD/0MebineF9EI8Jkd3NnWNChqN" crossorigin="anonymous" defer></script>';
const UPDATED = '16 November 2026';
const contact = () => process.env.CONTACT_EMAIL
  ? `email us at <a href="mailto:${esc(process.env.CONTACT_EMAIL)}">${esc(process.env.CONTACT_EMAIL)}</a>`
  : 'reply to any email we have sent you';

const secHead = (eyebrow, title, sub) => `<div class="sec-head"><p class="eyebrow">${eyebrow}</p><h2 class="h2">${title}</h2>${sub ? `<p class="sec-sub">${sub}</p>` : ''}</div>`;

// ---------------------------------------------------------------- landing
const FEATURES = [
  ['rewind', 'Replay any coin, any day', 'Choose a coin and a start time. Press play, step one candle, run at speed, or rewind for a second try. What comes next stays hidden.', true],
  ['target', 'Paper trading that behaves like the real thing', 'Market and limit orders, leverage, a stop and up to four take-profits, breakeven moves and a liquidation price. Drag the lines right on the chart.', true],
  ['brain', 'Smart money concepts, drawn live', 'Swings, BOS and CHoCH, order blocks, liquidity sweeps, equal highs and lows, premium and discount, auto Fibonacci. Only from candles already printed.'],
  ['pen-tool', 'Drawing tools', 'Trend lines, horizontal levels, Fibonacci, pencil and zig-zag. Saved per coin, they stay put as you zoom and change timeframe.'],
  ['notebook-pen', 'Journal and stats', 'Every trade logged with its R multiple. Win rate, average R and your best and worst setups, so practice turns into data.'],
  ['layers', 'Every timeframe', '1-minute precision underneath, viewed as 1m, 5m, 15m, 1H, 4H, 1D or 1W. Compare two coins side by side.', true],
  ['chart-line', 'Real exchange data', "Binance and Bybit USDT perpetual candles, loaded straight from the exchanges' public market data. No made-up prices.", true],
];
const STEPS = [
  ['history', 'Pick a coin and a moment', 'BTC on the day of a crash, a meme coin before its pump, or any random Tuesday. Real exchange candles load in seconds.'],
  ['crosshair', 'Read it and plan the trade', 'Mark your levels. Turn on the SMC overlay to see structure, zones and liquidity — or hide it and test your own eye.'],
  ['chart-column', 'Take it, play it, review it', 'Place the paper trade, then play the candles forward. Your journal keeps the result, the R and the reason.'],
];
const GUIDES = [
  ['Basics', 'Market structure', 'Higher highs, lower lows, and how to tell a trend from a range.'],
  ['Structure', 'BOS vs CHoCH', 'When a break continues the trend and when it warns of a turn.'],
  ['Liquidity', 'Sweeps and stop hunts', 'Why price spikes through obvious highs and lows, then turns.'],
  ['Zones', 'Order blocks and FVGs', 'The candles that start big moves, and the gaps price comes back to.'],
  ['Timing', 'Premium, discount and Fibonacci', 'Buying low in the move, not chasing the top of it.'],
  ['Risk', 'Position size and R', 'Risk the same amount every trade so one loss never hurts.'],
];
const FREE = ['Replay every Binance and Bybit USDT perpetual', 'Paper account with leverage, stops and take-profits', 'SMC overlay, auto Fibonacci and drawing tools', 'Trade journal and stats', 'All learning guides'];
const QA = [
  ['Is any real money involved?', 'No. Every trade on ReplayDesk is on paper with a practice balance. Nothing is sent to an exchange and you never connect an exchange account.'],
  ['Where do the charts come from?', 'Real candles from Binance and Bybit USDT perpetual futures, loaded straight from their public market data. Replays use the same 1-minute candles the exchanges recorded.'],
  ['Can I see what happens next while replaying?', "No. The chart only shows candles up to the replay clock, and the SMC overlay only reads those candles — the same information you'd have had at that moment."],
  ['Is it really free?', "Yes, everything listed is free during the beta. If a paid plan arrives later, it will add extras; we'll announce it well before anything changes."],
  ['Does it work on my phone?', 'Yes. The desk has a phone layout with the chart full width and the order ticket, positions and tools in bottom sheets.'],
  ['Is this financial advice?', "No. ReplayDesk is a practice and education tool. Past charts and paper results don't predict future results, and trading with leverage can lose more than you expect."],
];

function terminal() {
  const tools = ['mouse-pointer-2', 'crosshair', 'pen-line', 'git-commit-horizontal', 'minus', 'ruler', 'type'];
  return `<div class="term">
<div class="term-top">
  <span class="dots" aria-hidden="true"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></span>
  <span class="sym">BTCUSDT <span>Perp</span> ${icon('chevron-down', 'i-3 muted')}</span>
  <span class="tfs">${['1m', '5m', '15m', '1H', '4H'].map(t => `<span class="${t === '5m' ? 'on' : ''}">${t}</span>`).join('')}</span>
  <span class="ctrl">${icon('skip-back', 'i-35')}${icon('pause', 'i-35 pri')}${icon('skip-forward', 'i-35')}<span class="sep"></span>${icon('fast-forward', 'i-35')}<span class="mono">4×</span></span>
  <span class="badge-replay"><i></i>REPLAY</span>
</div>
<div class="term-body">
  <div class="term-tools" aria-hidden="true">${tools.map(t => `<span>${icon(t, 'i-4')}</span>`).join('')}</div>
  <div class="term-chart"><div class="chart" data-hero-chart></div><span class="stage" data-stage><i></i><span>Loading the replay…</span></span></div>
  <div class="term-side">
    <div><div class="muted">Paper account</div><div class="acct-bal" data-bal>$10,000.00</div></div>
    <div class="bs"><span class="b">Buy / Long</span><span class="s">Sell / Short</span></div>
    <div class="pos"><div class="pos-head"><span>Position</span><span>Risk $100</span></div><div data-pos><div class="muted">No position. Wait for the setup.</div></div></div>
    <div class="side-foot"><div><span>SMC overlay</span><span class="pri">On</span></div><div><span>Structure</span><span class="t2">5m</span></div></div>
  </div>
</div></div>`;
}

function landing(who, nonce) {
  const body = `${navbar(who)}
<main data-landing${who ? ' data-signed-in' : ''}>
<section id="top" class="hero">
  <div class="bg-grid"></div>
  <div class="glow" style="left:50%;top:0;width:900px;height:520px;transform:translateX(-50%);z-index:-1"></div>
  <div class="wrap">
    <div class="hero-top rise">
      <span class="pill"><span class="ping"></span>Free during beta · paper money only</span>
      <h1><span class="text-gradient">Rewind the market.</span><br><span class="text-brand">Trade it like it's live.</span></h1>
      <p class="lead">Pick any crypto coin and any moment. The future is hidden: play the chart candle by candle, take paper trades with
        real stops and targets, and see smart money concepts drawn as they form.</p>
      <div class="cta-row">${btn('/signup', `${icon('play')} Start replaying — free`, 'btn-primary btn-lg')}${btn('/learn', `${icon('book-open')} Read the free SMC guide`, 'btn-secondary btn-lg')}</div>
      <ul class="trust"><li>${icon('chart-line')} Real Binance &amp; Bybit candles</li><li>${icon('shield-check')} No card, no exchange account</li><li>${icon('smartphone')} Works on your phone</li></ul>
    </div>
    <div class="hero-shot rise rise-2">
      <div class="glow"></div>
      ${terminal()}
      <p class="caption">Illustration: a scripted replay. Results on paper are not a promise of real results.</p>
    </div>
  </div>
</section>

<section id="features" class="section"><div class="wrap">
  ${secHead('Features', 'A full trading desk, <span class="text-brand">with a rewind button</span>', 'Practice the exact decisions you face live — when to enter, where the stop goes, when to take profit — hundreds of times faster than waiting for the market.')}
  <div class="bento">${FEATURES.map(([ic, t, b, big], k) => `<div class="card reveal${big ? ' big' : ''}" style="transition-delay:${k * 50}ms"><div class="glow"></div><span class="card-icon">${icon(ic, 'i-5')}</span><h3>${t}</h3><p>${b}</p></div>`).join('')}</div>
</div></section>

<section id="how" class="section section-alt"><div class="wrap">
  ${secHead('How it works', 'Three steps, as many reps as you want')}
  <ol class="grid-3">${STEPS.map(([ic, t, b], k) => `<li class="card reveal" style="transition-delay:${k * 80}ms"><div class="step-head"><b>0${k + 1}</b><span></span>${icon(ic, 'i-5')}</div><h3>${t}</h3><p>${b}</p></li>`).join('')}</ol>
</div></section>

<section id="learn" class="section"><div class="wrap">
  <div class="learn-head"><div><p class="eyebrow">Learn — free</p><h2 class="h2">Smart money concepts, explained on real charts</h2>
    <p class="sec-sub">Short guides in plain words. Each one ends with a replay you can open and practise in one click.</p></div>
    ${btn('/learn', `${icon('book-open')} All guides`, 'btn-secondary')}</div>
  <div class="guides">${GUIDES.map(([tag, t, b], k) => `<a href="/learn" class="guide reveal" style="transition-delay:${k * 40}ms"><span class="tag">${tag}</span><h3>${t}</h3><p>${b}</p></a>`).join('')}</div>
</div></section>

<section id="pricing" class="section section-alt"><div class="wrap">
  ${secHead('Pricing', "Free while we're in beta", "No card, no trial clock. A paid plan with extras may come later; we'll say so well before anything changes.")}
  <div class="plans">
    <div class="plan featured reveal"><div class="plan-head"><h3>Free</h3><span class="chip chip-pri">Beta</span></div>
      <p class="price"><b>$0</b><span>/ month</span></p>
      <ul class="checks">${FREE.map(f => `<li>${icon('check')}${f}</li>`).join('')}</ul>
      <div style="margin-top:32px">${btn('/signup', 'Create a free account', 'btn-primary btn-block')}</div></div>
    <div class="plan later reveal" style="transition-delay:80ms"><div class="plan-head"><h3 class="t2">Pro</h3><span class="chip chip-line">Later</span></div>
      <p class="t2" style="margin-top:16px;font-size:15px;line-height:1.65">Extras for heavy users, such as more layouts and alerts. Not available yet.</p>
      <p class="muted" style="margin-top:32px;display:flex;align-items:center;gap:8px;font-size:13px">${icon('sparkles')} We'll announce it here first.</p></div>
  </div>
</div></section>

<section id="faq" class="section"><div class="wrap wrap-md">
  ${secHead('FAQ', 'Questions')}
  <div class="faq">${QA.map(([q, a], k) => `<details${k === 0 ? ' open' : ''}><summary>${q}${icon('chevron-down')}</summary><p>${a}</p></details>`).join('')}</div>
</div></section>

<section style="padding:0 16px 96px"><div class="cta-box reveal">
  <div class="bg-grid"></div><div class="glow"></div>
  ${icon('circle-dollar-sign', 'i-8')}
  <h2 class="h2" style="margin-top:16px">Your next 100 trades, before you risk a dollar</h2>
  <p class="t2" style="max-width:576px;margin:16px auto 0">Make the mistakes on paper. Keep the lessons.</p>
  <div style="margin-top:32px">${btn('/signup', `${icon('play')} Start replaying — free`, 'btn-primary btn-lg')}</div>
</div></section>
</main>
${footer()}`;
  return page({ body, nonce, scripts: [LWC, `<script src="${asset('hero.js')}" defer></script>`] });
}

// ---------------------------------------------------------------- long-form pages
function contentPage(who, nonce, { eyebrow, title, intro, updated, html, description }) {
  const body = `${navbar(who)}
<main class="content"><div class="bg-grid"></div>
<article class="wrap wrap-md">
  ${eyebrow ? `<p class="eyebrow" style="margin:0">${eyebrow}</p>` : ''}
  <h1>${title}</h1>
  ${intro ? `<p class="intro">${intro}</p>` : ''}
  ${updated ? `<p class="updated">Last updated ${updated}</p>` : ''}
  <div class="prose">${html}</div>
</article></main>
${footer()}`;
  return page({ title, description, body, nonce });
}

// Plain-English starting text. Have it reviewed before a wide public launch.
const LEGAL = {
  terms: () => ({ eyebrow: 'Legal', title: 'Terms of use', updated: UPDATED, intro: 'These terms cover your use of ReplayDesk. By creating an account you agree to them.', html: `
<h2>What ReplayDesk is</h2><p>ReplayDesk is an education and practice tool: chart replay, paper (simulated) trading and learning guides. It does not place real orders,
hold your money, or connect to your exchange account. See the <a href="/risk">risk disclosure</a>.</p>
<h2>Your account</h2><ul><li>Give a real email address and keep your password to yourself. You are responsible for what happens under your account.</li>
<li>One person per account. You must be old enough to agree to these terms where you live.</li><li>You can stop using ReplayDesk at any time and ask us to delete your account.</li></ul>
<h2>Fair use</h2><ul><li>Don't try to break, overload, scrape or reverse-engineer the service, or get around its limits.</li>
<li>Don't use it to mislead others, for example by showing paper results as real trading results.</li></ul><p>We can suspend accounts that break these rules.</p>
<h2>Free plan and changes</h2><p>ReplayDesk is free during the beta. We may add paid plans later and will say so before anything you use today changes. Features can change or be removed as the product grows.</p>
<h2>No warranty</h2><p>The service is provided as it is. We work to keep it running and the data correct, but we can't promise it will always be available or error-free.
To the extent the law allows, we are not liable for losses from using ReplayDesk, including trading decisions you make elsewhere.</p>
<h2>Changes to these terms</h2><p>If we change these terms we will update the date above, and tell you by email for important changes.</p>
<h2>Contact</h2><p>Questions? ${contact()}.</p>` }),
  privacy: () => ({ eyebrow: 'Legal', title: 'Privacy', updated: UPDATED, intro: 'We keep as little about you as we can, and we never sell it.', html: `
<h2>What we store</h2><ul>
<li><strong>Account:</strong> your name, email address, whether it is confirmed, and a hashed password (we never see the password itself).
If you sign in with Google: your Google account id, name, email and profile picture link.</li>
<li><strong>Sessions:</strong> a sign-in record with the time, your IP address and browser type, so you can stay signed in and we can spot abuse.</li>
<li><strong>Practice data:</strong> your paper trades, drawings and settings, once those features are live.</li></ul>
<h2>What we don't store</h2><p>No exchange API keys, no card details, no wallet addresses. Chart candles load in your browser straight from the exchanges' public market data.</p>
<h2>Cookies</h2><p>One sign-in cookie, needed for your account to work. Your light/dark choice is saved in your browser. No advertising or tracking cookies.</p>
<h2>Services we use</h2><ul><li>Hosting and database providers, to run the site and store the data above.</li><li>An email provider, to send confirmation and password-reset emails.</li>
<li>Google, only if you choose “Continue with Google”.</li></ul>
<h2>Keeping and deleting</h2><p>We keep your data while your account is open. To delete your account and its data, ${contact()}.</p>` }),
  risk: () => ({ eyebrow: 'Legal', title: 'Risk disclosure', updated: UPDATED, intro: 'ReplayDesk is a place to practise. Please read this before you treat anything you see here as a reason to trade real money.', html: `
<h2>Not financial advice</h2><p>Nothing on ReplayDesk is financial, investment, tax or legal advice, and nothing here is a recommendation to buy or sell anything.
The guides explain how traders describe price action; they do not say any method makes money. We are not licensed advisers.</p>
<h2>Paper results are not real results</h2><ul>
<li>Paper trades have no real slippage, partial fills, outages, exchange fees beyond what we model, or emotions. Real results are usually worse.</li>
<li>Replaying the past is not the same as trading the future. A setup that worked on old charts can stop working.</li>
<li>Practising many trades quickly can make a method look better than it is. Small samples are noisy.</li></ul>
<h2>Crypto and leverage</h2><p>Crypto prices can move very fast, and perpetual futures with leverage can lose your whole margin in minutes. Liquidation, funding
payments and exchange failures are real risks. Only trade money you can afford to lose.</p>
<h2>Market data</h2><p>Candles come from the exchanges' public market data. They can contain gaps or errors, and we cannot promise they are complete or exact.</p>` }),
  learn: () => ({ eyebrow: 'Learn', title: 'Free trading guides', description: 'Free guides to smart money concepts and price action, written to practise on the replay desk.',
    intro: "Short, plain-English guides to smart money concepts and price action, each with a replay drill so you practise the idea on real charts. They're being written now.",
    html: `<div class="guide-list">${GUIDES.map(([tag, t, b]) => `<div class="guide"><div class="row"><span class="tag-u">${tag}</span><span class="soon">Coming soon</span></div>
<h3 style="margin-top:12px">${t}</h3><p>${b}</p></div>`).join('')}</div>` }),
};

// ---------------------------------------------------------------- auth pages
const POINTS = ['Replay any Binance or Bybit perpetual from any date', 'Paper trades with stops, take-profits and leverage', 'Smart money concepts drawn as the candles print', 'Free guides, from market structure to risk'];
function miniCandles() {
  const c = [[40, 62, 46, 58], [58, 70, 52, 66], [66, 74, 60, 62], [62, 66, 48, 50], [50, 58, 40, 55], [55, 78, 54, 76], [76, 90, 72, 86], [86, 92, 74, 78], [78, 96, 77, 94], [94, 108, 90, 104], [104, 110, 92, 96], [96, 118, 95, 116]];
  return `<svg viewBox="0 0 300 130" class="mini-candles" aria-hidden="true">${c.map(([o, h, l, cl], i) => {
    const x = 12 + i * 24, y = v => 125 - v, col = cl >= o ? 'var(--up)' : 'var(--down)';
    return `<line x1="${x}" x2="${x}" y1="${y(h)}" y2="${y(l)}" stroke="${col}" stroke-width="1.5"/><rect x="${x - 6}" width="12" y="${y(Math.max(o, cl))}" height="${Math.max(2, Math.abs(cl - o))}" rx="2" fill="${col}"/>`;
  }).join('')}</svg>`;
}
function authShell(nonce, { title, sub, inner, foot, pageTitle }) {
  const body = `<div class="auth">
<div class="auth-col">
  <div class="auth-top"><a href="/" aria-label="${SITE.name} home">${logo()}</a>${themeBtn()}</div>
  <main class="auth-main"><h1>${title}</h1>${sub ? `<p class="auth-sub">${sub}</p>` : ''}<div class="auth-body">${inner}</div>${foot ? `<div class="auth-foot">${foot}</div>` : ''}</main>
  <p class="auth-note">Paper trading and education only. Not financial advice.</p>
</div>
<aside class="auth-aside"><div class="bg-grid"></div><div class="glow"></div><div class="auth-aside-in">
  <p class="eyebrow" style="margin:0">ReplayDesk</p>
  <h2><span class="text-gradient">Practice on the past.</span><br><span class="text-brand">Trade the future better.</span></h2>
  <ul class="auth-points">${POINTS.map(p => `<li>${icon('circle-check', 'i-5')}${p}</li>`).join('')}</ul>
  ${miniCandles()}
</div></aside></div>`;
  return page({ title: pageTitle || title, body, nonce, noindex: false });
}
const field = ({ label, name, type = 'text', auto, placeholder = '', aside = '', hint = '', minlen, value = '', max }) => `<div class="field">
<div class="field-top"><label for="f-${name}">${label}</label>${aside}</div>
<div class="input-wrap"><input class="input${type === 'password' ? ' has-eye' : ''}" id="f-${name}" name="${name}" type="${type}"${auto ? ` autocomplete="${auto}"` : ''}
 placeholder="${esc(placeholder)}" value="${esc(value)}"${minlen ? ` data-minlen="${minlen}"` : ''}${max ? ` maxlength="${max}"` : ''}${type === 'email' || type === 'password' ? ' required' : ''} autocapitalize="off" spellcheck="false">
${type === 'password' ? `<button type="button" class="eye" data-eye aria-label="Show password">${icon('eye')}</button>` : ''}</div>
${hint ? `<p class="hint" data-text="${esc(hint)}">${esc(hint)}</p>` : ''}</div>`;
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
const google = (next, label) => `<a class="btn btn-secondary btn-lg btn-block" href="/auth/google?next=${encodeURIComponent(next)}">
<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.95l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z"/></svg>
${label}</a><div class="divider">or</div>`;
const alertSlot = (tone, html) => `<div data-alert${html ? ` class="alert alert-${tone}"` : ' hidden'}>${html || ''}</div>`;

const ERRORS = {
  google: 'Google sign-in didn’t finish. Try again, or use your email.',
  verify: 'That confirmation link has expired or was already used. Sign in to get a new one.',
  banned: 'This account is suspended.',
};
function signin(nonce, { next, googleOn, error, reset, verified }) {
  const msg = reset ? alertSlot('up', 'Password changed. Sign in with the new one.') : verified ? alertSlot('up', 'Email confirmed. Sign in to continue.')
    : error && ERRORS[error] ? alertSlot('down', ERRORS[error]) : alertSlot();
  return authShell(nonce, {
    title: 'Welcome back', sub: 'Sign in to your desk.',
    inner: `${msg}${googleOn ? google(next, 'Continue with Google') : ''}
<form data-form="signin" novalidate>${hidden('next', next)}
${field({ label: 'Email', name: 'email', type: 'email', auto: 'email', placeholder: 'you@example.com' })}
${field({ label: 'Password', name: 'password', type: 'password', auto: 'current-password', aside: '<a href="/forgot">Forgot?</a>' })}
<div class="form-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Sign in ${icon('arrow-right')}</button></div></form>`,
    foot: `New here? <a class="link" href="/signup${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}">Create a free account</a>`,
    pageTitle: 'Sign in',
  });
}
function signup(nonce, { next, googleOn, open }) {
  if (!open) return authShell(nonce, { title: 'Sign-ups open soon', sub: 'ReplayDesk is getting ready for its first traders.',
    inner: `<div class="center-card"><span class="badge-ico">${icon('sparkles', 'i-6')}</span><p class="t2" style="margin-top:16px">New accounts aren't open yet. Meanwhile, the free guides are being written.</p>
<div style="margin-top:16px">${btn('/learn', 'See the guides', 'btn-secondary')}</div></div>`, foot: `Already have an account? <a class="link" href="/signin">Sign in</a>`, pageTitle: 'Sign up' });
  return authShell(nonce, {
    title: 'Create your free account', sub: 'Replay, paper trade and learn. No card needed.',
    inner: `${alertSlot()}${googleOn ? google(next, 'Sign up with Google') : ''}
<form data-form="signup" novalidate>${hidden('next', next)}
${field({ label: 'Name', name: 'name', auto: 'name', placeholder: 'What should we call you?', max: 60 })}
${field({ label: 'Email', name: 'email', type: 'email', auto: 'email', placeholder: 'you@example.com' })}
${field({ label: 'Password', name: 'password', type: 'password', auto: 'new-password', hint: 'At least 8 characters. A short sentence works well.', minlen: 8 })}
<div class="form-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Create free account ${icon('arrow-right')}</button></div>
<p class="fine">By creating an account you agree to the <a href="/terms">Terms</a> and the <a href="/risk">Risk disclosure</a>. Paper trading only.</p></form>`,
    foot: `Already have an account? <a class="link" href="/signin${next !== '/app' ? `?next=${encodeURIComponent(next)}` : ''}">Sign in</a>`,
    pageTitle: 'Sign up',
  });
}
function checkEmail(nonce, { email, next }) {
  return authShell(nonce, {
    title: 'Check your inbox', sub: 'One click and you’re in.',
    inner: `<div class="center-card"><span class="badge-ico">${icon('mail-check', 'i-6')}</span>
<p class="t2" style="margin-top:16px;font-size:15px">We sent a confirmation link to</p><p style="margin-top:4px;font-weight:500;overflow-wrap:anywhere">${esc(email || 'your email')}</p>
<p class="muted" style="margin-top:16px;font-size:13.5px">Open it on this device to land straight in the desk. Nothing in the inbox? Check spam, or:</p>
<button type="button" class="btn btn-secondary" style="margin-top:16px" data-resend data-email="${esc(email)}" data-next="${esc(next)}"${email ? '' : ' disabled'}>Send it again</button></div>`,
    foot: `Wrong address? <a class="link" href="/signup">Start again</a>`, pageTitle: 'Check your email',
  });
}
function forgot(nonce, { open }) {
  return authShell(nonce, {
    title: 'Reset your password', sub: 'We’ll email you a link to choose a new one.',
    inner: open ? `${alertSlot()}<form data-form="forgot" novalidate>${field({ label: 'Email', name: 'email', type: 'email', auto: 'email', placeholder: 'you@example.com' })}
<div class="form-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Send reset link</button></div></form>`
      : alertSlot('pri', 'Password reset by email isn’t switched on yet.'),
    foot: `Remembered it? <a class="link" href="/signin">Sign in</a>`, pageTitle: 'Forgot password',
  });
}
function reset(nonce, { token }) {
  return authShell(nonce, {
    title: 'Choose a new password', sub: 'You’ll sign in with it next.',
    inner: token ? `${alertSlot()}<form data-form="reset" novalidate>${hidden('token', token)}
${field({ label: 'New password', name: 'password', type: 'password', auto: 'new-password', hint: 'At least 8 characters.', minlen: 8 })}
${field({ label: 'Repeat it', name: 'password2', type: 'password', auto: 'new-password' })}
<div class="form-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Set new password</button></div></form>`
      : `${alertSlot('down', 'This reset link is missing its token.')}<a class="link" href="/forgot">Ask for a new link</a>`,
    pageTitle: 'Reset password',
  });
}

// ---------------------------------------------------------------- signed-in pages
function initials(s) { return String(s || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join('') || '?'; }
function appbar(who, section) {
  const u = who.user;
  const name = u ? (u.name || 'Trader') : 'Admin';
  const sub = u ? u.email : 'Signed in with the dashboard key';
  const av = u && u.image ? `<img src="${esc(u.image)}" alt="" referrerpolicy="no-referrer">` : esc(initials(u ? u.name || u.email : 'A D'));
  return `<header class="appbar">
<a href="/" aria-label="${SITE.name} home">${LOGO_SVG(28, 'ab')}</a>
<nav class="crumbs">${section === 'Desk' ? '<b>Desk</b>' : `<a href="/app">Desk</a><i>/</i><b>${esc(section)}</b>`}</nav>
<div class="appbar-right">${themeBtn()}
<div class="umenu" data-umenu><button type="button" class="avatar" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">${av}</button>
<div class="menu" role="menu" hidden><div class="menu-who"><b>${esc(name)}</b><span>${esc(sub)}</span></div>
<div class="menu-items">${u ? `<a role="menuitem" href="/account">${icon('settings')} Account</a>` : ''}
${who.admin ? `<a role="menuitem" href="/admin">${icon('shield')} Admin</a><a role="menuitem" href="/dashboard">${icon('layout-dashboard')} Live dashboard</a>` : ''}
<button type="button" role="menuitem" data-signout>${icon('log-out')} Sign out</button></div></div></div>
</div></header>`;
}
const appPage = (who, nonce, section, main, title) => page({ title: title || section, nonce, noindex: true, body: `<div class="app">${appbar(who, section)}${main}</div>` });

function desk(who, nonce) {
  const first = who.user && who.user.name ? who.user.name.split(' ')[0] : '';
  return appPage(who, nonce, 'Desk', `<main class="center"><div style="max-width:448px">
<h1 style="font-size:24px;font-weight:600;letter-spacing:-.025em">Welcome${first ? `, ${esc(first)}` : ''} 👋</h1>
<p class="t2" style="margin-top:12px">Your account is ready. The replay terminal is being built and will appear here.</p></div></main>`);
}

const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtTime = d => new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
function account(who, nonce) {
  const u = who.user;
  const methods = [u.hasPassword && 'Email and password', u.google && 'Google'].filter(Boolean).join(' · ') || '—';
  const rows = [
    ['Name', esc(u.name || '—')],
    ['Email', `${esc(u.email)} ${u.emailVerified ? '<span class="chip chip-up" style="margin-left:6px;font-size:11px">Confirmed</span>' : '<span class="chip chip-warn" style="margin-left:6px;font-size:11px">Not confirmed</span>'}`],
    ['Sign-in', methods],
    ['Plan', `<span style="text-transform:capitalize">${esc(u.plan)}</span>${u.plan === 'free' ? ' (beta)' : ''}`],
    ['Member since', fmtDate(u.createdAt)],
  ];
  return appPage(who, nonce, 'Account', `<main class="app-main narrow"><h1>Account</h1>
<dl class="dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
${u.hasPassword ? '<p class="t2" style="margin-top:20px;font-size:14px">Want a new password? <a class="link" href="/forgot">Send a reset link</a>.</p>' : ''}
<p class="muted" style="margin-top:8px;font-size:13px">More settings (name, password, delete account) are on the way.</p></main>`);
}

function admin(who, nonce, { counts, latest, accountsOpen }) {
  const tiles = [['Users', counts.users], ['Confirmed email', counts.verified], ['New in 7 days', counts.week], ['Google sign-ins', counts.google]];
  return appPage(who, nonce, 'Admin', `<main class="app-main"><h1>Admin</h1>
<p class="sub">Overview. Controls for plans, signals and branding arrive in a later phase.</p>
<div class="admin-links">${btn('/dashboard', `${icon('layout-dashboard')} Live dashboard`, 'btn-primary btn-sm')}
${accountsOpen ? '<span class="chip chip-up" style="align-self:center">Sign-ups open</span>' : '<span class="chip chip-warn" style="align-self:center">Sign-ups closed — set RESEND_API_KEY, EMAIL_FROM and PUBLIC_URL</span>'}</div>
<div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${Number(v).toLocaleString('en-US')}</b></div>`).join('')}</div>
<h2 class="h3">Newest sign-ups</h2>
<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Plan</th><th>Joined</th></tr></thead><tbody>
${latest.length ? latest.map(u => `<tr><td>${esc(u.name || '—')}</td><td>${esc(u.email)}</td><td>${u.banned ? '<span class="down">Banned</span>' : u.email_verified ? '<span class="up">Confirmed</span>' : '<span class="warn">Unconfirmed</span>'}</td>
<td style="text-transform:capitalize">${esc(u.plan)}</td><td class="mono muted" style="font-size:12px">${fmtTime(u.created_at)}</td></tr>`).join('') : '<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No users yet.</td></tr>'}
</tbody></table></div></main>`);
}

/** /dashboard without an admin session: sign in as admin, or use the dashboard key (a saved key signs in by itself). */
function dashboardGate(nonce, { who, googleOn }) {
  const signedInNotAdmin = who && !who.admin;
  return authShell(nonce, {
    title: 'Live dashboard', sub: 'Admin only. Sign in with the admin account, or use the dashboard key.',
    inner: `${signedInNotAdmin ? alertSlot('pri', 'You’re signed in, but this account isn’t an admin. <a class="link" href="/app">Go to your desk</a>.') : alertSlot()}
<p data-autokey hidden class="alert alert-pri">Signing you in with the dashboard key saved on this device…</p>
${signedInNotAdmin ? '' : `${googleOn ? google('/dashboard', 'Continue with Google') : ''}
<form data-form="signin" novalidate>${hidden('next', '/dashboard')}
${field({ label: 'Admin email', name: 'email', type: 'email', auto: 'email', placeholder: 'you@example.com' })}
${field({ label: 'Password', name: 'password', type: 'password', auto: 'current-password' })}
<div class="form-actions"><button type="submit" class="btn btn-primary btn-lg btn-block">Sign in ${icon('arrow-right')}</button></div></form>
<div class="divider">or</div>`}
<form data-form="key" novalidate>${field({ label: 'Dashboard key', name: 'key', type: 'password', auto: 'off', placeholder: 'DASHBOARD_KEY' })}
<div class="form-actions"><button type="submit" class="btn btn-secondary btn-lg btn-block">${icon('key-round')} Use the dashboard key</button></div></form>`,
    pageTitle: 'Dashboard sign-in',
  });
}

const notFound = (who, nonce) => contentPage(who, nonce, { title: 'Page not found', intro: 'That page doesn’t exist (yet).', html: `<p><a href="/">Back to the home page</a></p>` });

module.exports = { landing, contentPage, LEGAL, signin, signup, checkEmail, forgot, reset, desk, account, admin, dashboardGate, notFound };
