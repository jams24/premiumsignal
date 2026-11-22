// ReplayDesk landing page. Every card carries a small drawn illustration (SVG / HTML, no images), so the page shows
// the product instead of describing it. Illustrations are UI examples, not results.
const { btn, page, navbar, footer, asset, icon } = require('./html');

const LWC = '<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js" ' +
  'integrity="sha384-KkYqTZlM13Zya6fVUF3IGCBOQ1ehFeJVVgxaVvD/0MebineF9EI8Jkd3NnWNChqN" crossorigin="anonymous" defer></script>';

// deterministic little candle series for the illustrations
function candles(n, seed, start = 60, drift = 0.6) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const out = []; let c = start;
  for (let i = 0; i < n; i++) {
    const o = c; c = o + (r() - 0.5 + drift * 0.15) * 9;
    out.push({ o, c, h: Math.max(o, c) + r() * 4, l: Math.min(o, c) - r() * 4 });
  }
  return out;
}
function candleSvg(cs, { w, h, pad = 6, cls = '' }) {
  const hi = Math.max(...cs.map(c => c.h)), lo = Math.min(...cs.map(c => c.l));
  const y = v => pad + (hi - v) / (hi - lo) * (h - pad * 2), step = (w - pad * 2) / cs.length, bw = Math.max(2, step * 0.55);
  return cs.map((c, i) => {
    const x = pad + i * step + step / 2, up = c.c >= c.o, col = up ? 'var(--up)' : 'var(--down)';
    return `<g class="${cls}" style="--i:${i}"><line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${y(c.h).toFixed(1)}" y2="${y(c.l).toFixed(1)}" stroke="${col}" stroke-width="1"/>` +
      `<rect x="${(x - bw / 2).toFixed(1)}" y="${y(Math.max(c.o, c.c)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.2, Math.abs(y(c.o) - y(c.c))).toFixed(1)}" rx="0.8" fill="${col}"/></g>`;
  }).join('');
}

// ---------------------------------------------------------------- card illustrations
const vizReplay = () => `<div class="viz viz-replay" aria-hidden="true">
<svg viewBox="0 0 320 120" preserveAspectRatio="none">${candleSvg(candles(24, 11, 60, 0.3), { w: 320, h: 120, pad: 10 })}</svg>
<div class="curtain"><span class="playhead"></span></div>
<div class="viz-ctrl"><span>${icon('skip-back', 'i-35')}</span><span class="on">${icon('play', 'i-35')}</span><span>${icon('skip-forward', 'i-35')}</span><span class="bar"><i></i></span><span class="mono">2×</span></div></div>`;

const vizTicket = () => `<div class="viz viz-ticket" aria-hidden="true">
<div class="seg2"><span class="on-up">Long</span><span>Short</span></div>
<div class="trow"><span>Entry</span><b class="mono">64,112.0</b></div>
<div class="trow"><span>Stop</span><b class="mono down">63,920.0</b></div>
<div class="trow"><span>Take profit</span><b class="mono up">64,688.0</b></div>
<div class="rr"><i class="r1"></i><i class="r3"></i></div>
<div class="trow small"><span>Risk $100 · 5×</span><span class="mono up">3.0R</span></div>
<span class="tbtn">Place paper long</span></div>`;

const vizSmc = () => `<div class="viz" aria-hidden="true"><svg viewBox="0 0 320 120">
<rect x="96" y="78" width="224" height="16" fill="color-mix(in oklab, var(--up) 16%, transparent)" stroke="color-mix(in oklab, var(--up) 55%, transparent)"/>
<text x="102" y="89" class="svg-t up-f">OB</text>
<rect x="196" y="40" width="124" height="12" fill="color-mix(in oklab, var(--primary) 14%, transparent)"/>
<text x="290" y="49" class="svg-t pri-f">FVG</text>
<polyline points="8,40 40,70 62,52 96,92 128,46 150,60 176,30 204,52 236,18 262,34 312,10" fill="none" stroke="var(--text-2)" stroke-width="1.6" stroke-linejoin="round"/>
<line x1="62" x2="150" y1="52" y2="52" stroke="var(--primary)" stroke-dasharray="4 3"/><text x="118" y="48" class="svg-t pri-f">CHoCH</text>
<line x1="176" x2="262" y1="30" y2="30" stroke="var(--primary)" stroke-dasharray="4 3"/><text x="218" y="26" class="svg-t pri-f">BOS</text>
<circle cx="96" cy="92" r="3" fill="var(--warn)"/><text x="70" y="108" class="svg-t warn-f">sweep</text></svg></div>`;

const vizFib = () => {
  const lv = [[0, 14], [0.382, 47], [0.5, 57], [0.618, 67], [1, 100]];
  return `<div class="viz" aria-hidden="true"><svg viewBox="0 0 320 120">
<rect x="20" y="57" width="290" height="10" fill="color-mix(in oklab, var(--accent) 14%, transparent)"/>
${lv.map(([k, yy]) => `<line x1="20" x2="310" y1="${yy}" y2="${yy}" stroke="color-mix(in oklab, var(--accent) ${k === 0.618 || k === 0.5 ? 80 : 45}%, transparent)" stroke-width="1"/><text x="24" y="${yy - 3}" class="svg-t acc-f">${k}</text>`).join('')}
<line x1="40" y1="100" x2="290" y2="14" stroke="var(--primary)" stroke-width="1.6"/><circle cx="40" cy="100" r="3.2" fill="var(--primary)"/><circle cx="290" cy="14" r="3.2" fill="var(--primary)"/></svg></div>`;
};

const vizJournal = () => {
  const r = [2.1, -1, 3, -1, 0.8, -1, 2.5, -1, 1.6, -0.4, 3, -1];
  const bars = r.map((v, i) => { const x = 14 + i * 25, h = Math.abs(v) * 15, up = v > 0;
    return `<rect x="${x}" y="${up ? 60 - h : 60}" width="14" height="${h}" rx="2" fill="var(--${up ? 'up' : 'down'})" opacity=".85"/>`; }).join('');
  return `<div class="viz" aria-hidden="true"><svg viewBox="0 0 320 120"><line x1="8" x2="312" y1="60" y2="60" stroke="var(--line-strong)"/>${bars}</svg>
<div class="viz-stats"><span>Win rate<b class="mono">58%</b></span><span>Avg R<b class="mono up">+0.89</b></span><span>Trades<b class="mono">12</b></span></div></div>`;
};

const vizTf = () => `<div class="viz viz-tf" aria-hidden="true">${['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'].map((t, i) => `<span style="--i:${i}">${t}</span>`).join('')}</div>`;

const vizData = () => `<div class="viz viz-data" aria-hidden="true"><span class="ex"><i></i>Binance</span><span class="ex"><i></i>Bybit</span>
<span class="ex-note mono">USDT perpetuals · 1-minute candles · public market data</span></div>`;

// ---------------------------------------------------------------- learn diagrams
const LEARN_SVG = {
  structure: '<polyline points="6,52 26,34 38,42 60,20 72,30 94,8" fill="none" stroke="var(--text-2)" stroke-width="1.6"/><text x="56" y="16" class="svg-t up-f">HH</text><text x="66" y="42" class="svg-t up-f">HL</text>',
  bos: '<polyline points="6,48 26,26 40,38 62,14 76,30 96,6" fill="none" stroke="var(--text-2)" stroke-width="1.6"/><line x1="26" x2="70" y1="26" y2="26" stroke="var(--primary)" stroke-dasharray="3 2"/><text x="40" y="22" class="svg-t pri-f">BOS</text>',
  sweep: '<line x1="4" x2="96" y1="40" y2="40" stroke="var(--warn)" stroke-dasharray="3 2"/><polyline points="6,20 22,40 36,24 52,40 64,52 70,30 96,10" fill="none" stroke="var(--text-2)" stroke-width="1.6"/><circle cx="64" cy="52" r="2.6" fill="var(--warn)"/>',
  zones: '<rect x="30" y="34" width="66" height="12" fill="color-mix(in oklab, var(--up) 18%, transparent)" stroke="color-mix(in oklab, var(--up) 55%, transparent)"/><rect x="50" y="14" width="46" height="8" fill="color-mix(in oklab, var(--primary) 18%, transparent)"/><polyline points="6,24 30,44 50,18 66,26 80,38 96,8" fill="none" stroke="var(--text-2)" stroke-width="1.6"/>',
  fib: '<rect x="6" y="6" width="90" height="23" fill="color-mix(in oklab, var(--down) 12%, transparent)"/><rect x="6" y="29" width="90" height="23" fill="color-mix(in oklab, var(--up) 12%, transparent)"/><line x1="6" x2="96" y1="29" y2="29" stroke="var(--accent)" stroke-dasharray="3 2"/><text x="10" y="16" class="svg-t down-f">premium</text><text x="10" y="46" class="svg-t up-f">discount</text>',
  risk: '<rect x="14" y="30" width="20" height="10" rx="2" fill="var(--down)" opacity=".8"/><rect x="40" y="6" width="20" height="24" rx="2" fill="var(--up)" opacity=".8"/><line x1="8" x2="96" y1="30" y2="30" stroke="var(--line-strong)"/><text x="66" y="22" class="svg-t up-f">3R</text><text x="66" y="40" class="svg-t down-f">1R</text>',
};
const GUIDE_LINK = { structure: 'market-structure', bos: 'bos-choch', sweep: 'liquidity-sweeps', zones: 'order-blocks-fvg', fib: 'premium-discount', risk: 'position-size' };
const GUIDES = [
  ['structure', 'Basics', 'Market structure', 'Higher highs, lower lows, and how to tell a trend from a range.'],
  ['bos', 'Structure', 'BOS vs CHoCH', 'When a break continues the trend and when it warns of a turn.'],
  ['sweep', 'Liquidity', 'Sweeps and stop hunts', 'Why price spikes through obvious highs and lows, then turns.'],
  ['zones', 'Zones', 'Order blocks and FVGs', 'The candles that start big moves, and the gaps price comes back to.'],
  ['fib', 'Timing', 'Premium, discount and Fibonacci', 'Buying low in the move, not chasing the top of it.'],
  ['risk', 'Risk', 'Position size and R', 'Risk the same amount every trade so one loss never hurts.'],
];

const FEATURES = [
  { viz: vizReplay, ic: 'rewind', t: 'Replay any coin, any day', b: 'Pick a coin and a start time. Play, step one candle, run at speed or rewind for another try. What comes next stays hidden.', size: 'w2' },
  { viz: vizTicket, ic: 'target', t: 'Paper trading that behaves like the real thing', b: 'Market and limit orders, leverage, stop, up to four take-profits, breakeven and liquidation. Drag the lines on the chart.', size: '' },
  { viz: vizSmc, ic: 'brain', t: 'Smart money concepts, drawn live', b: 'Swings, BOS and CHoCH, order blocks, fair value gaps, sweeps — only from candles already printed.', size: '' },
  { viz: vizFib, ic: 'pen-tool', t: 'Drawing tools that stay put', b: 'Trend lines, levels, Fibonacci, pencil and zig-zag, saved per coin across zoom and timeframes.', size: '' },
  { viz: vizJournal, ic: 'notebook-pen', t: 'A journal that keeps score', b: 'Every trade logged with its R. Win rate, average R and your best and worst setups.', size: '' },
  { viz: vizTf, ic: 'layers', t: 'Every timeframe', b: '1-minute precision underneath, viewed from 1m to 1M. Compare two coins side by side.', size: '' },
  { viz: vizData, ic: 'chart-line', t: 'Real exchange data', b: 'Binance and Bybit perpetual candles, straight from public market data. No made-up prices.', size: 'w2' },
];
const STEPS = [
  ['history', 'Pick a coin and a moment', 'BTC on the day of a crash, a meme coin before its pump, or any random Tuesday.'],
  ['crosshair', 'Read it and plan the trade', 'Mark your levels, or turn on the SMC overlay and see structure, zones and liquidity.'],
  ['chart-column', 'Take it, play it, review it', 'Place the paper trade, play the candles forward. The journal keeps the result and the R.'],
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

const num = (n, label) => `<p class="secnum"><span class="mono">[${String(n).padStart(2, '0')}]</span>${label}</p>`;

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
<main class="lp" data-landing${who ? ' data-signed-in' : ''}>

<section id="top" class="hero2">
  <div class="aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>
  <div class="dots-bg" aria-hidden="true"></div>
  <div class="wrap">
    <div class="hero-top rise">
      <a class="announce" href="/signup"><span class="ping"></span><span>Replay beta is open — free, paper money only</span>${icon('arrow-right', 'i-35')}</a>
      <h1 class="display"><span class="text-gradient">Rewind the market.</span><br><span class="text-shine">Trade it like it's live.</span></h1>
      <p class="lead">Pick any crypto coin and any moment. The future stays hidden: play the chart candle by candle, take paper trades with
        real stops and targets, and watch smart money concepts draw themselves as they form.</p>
      <div class="cta-row">${btn('/signup', `${icon('play')} Start replaying — free <span class="arr">${icon('arrow-right', 'i-35')}</span>`, 'btn-primary btn-lg btn-pill glow-btn')}${btn('/learn', `${icon('book-open')} Read the free SMC guide`, 'btn-glass btn-lg btn-pill')}</div>
      <ul class="trust"><li>${icon('chart-line')} Real Binance &amp; Bybit candles</li><li>${icon('shield-check')} No card, no exchange account</li><li>${icon('smartphone')} Works on your phone</li></ul>
    </div>

    <div class="ticker" aria-label="Live prices"><div class="tk-track" data-ticker></div></div>

    <div class="shot-wrap rise rise-2">
      <div class="shot" data-tilt>
        <div class="shot-glow" aria-hidden="true"></div>
        <div class="shot-border">${terminal()}</div>
        <div class="float f1" aria-hidden="true"><span class="fi pri-bg">${icon('git-commit-horizontal', 'i-4')}</span><div><b>Change of character</b><span>BTCUSDT · 5m · demand zone marked</span></div></div>
        <div class="float f2" aria-hidden="true"><span class="fi up-bg">${icon('check', 'i-4')}</span><div><b class="up">Paper trade closed +3.00R</b><span>Target hit · journal updated</span></div></div>
        <div class="float f3" aria-hidden="true"><span class="fi acc-bg">${icon('rewind', 'i-4')}</span><div><b>Rewind 40 candles</b><span>Try the same setup again</span></div></div>
      </div>
      <p class="caption">Illustration: a scripted replay. Results on paper are not a promise of real results.</p>
    </div>

    <div class="stats">
      <div><b data-count="500" data-suf="+">500+</b><span>USDT perpetuals</span></div>
      <div><b data-count="8">8</b><span>timeframes, 1 minute to 1 month</span></div>
      <div><b data-count="1" data-suf="-min">1-min</b><span>replay precision</span></div>
      <div><b data-count="0" data-pre="$">$0</b><span>during the beta</span></div>
    </div>
  </div>
</section>

<section id="features" class="section"><div class="wrap">
  <div class="sec-head">${num(1, 'Features')}<h2 class="h2 display">A full trading desk, <span class="text-brand">with a rewind button</span></h2>
    <p class="sec-sub">Practise the decisions you face live — when to enter, where the stop goes, when to take profit — hundreds of times faster than waiting for the market.</p></div>
  <div class="bento2">${FEATURES.map((f, k) => `<article class="fcard spot reveal ${f.size}" style="transition-delay:${(k % 3) * 70}ms">
    ${f.viz()}<div class="fcard-txt"><span class="fcard-ic">${icon(f.ic, 'i-4')}</span><h3>${f.t}</h3><p>${f.b}</p></div></article>`).join('')}</div>
</div></section>

<section id="how" class="section section-alt"><div class="wrap">
  <div class="sec-head">${num(2, 'How it works')}<h2 class="h2 display">Three steps, as many reps as you want</h2></div>
  <ol class="steps2">${STEPS.map(([ic, t, b], k) => `<li class="reveal" style="transition-delay:${k * 90}ms"><span class="node">${icon(ic, 'i-5')}<b class="mono">0${k + 1}</b></span><h3>${t}</h3><p>${b}</p></li>`).join('')}</ol>
</div></section>

<section id="learn" class="section"><div class="wrap">
  <div class="learn-head"><div>${num(3, 'Learn — free')}<h2 class="h2 display">Smart money concepts, explained on real charts</h2>
    <p class="sec-sub">Short guides in plain words. Each one ends with a replay you can open and practise in one click.</p></div>
    ${btn('/learn', `${icon('book-open')} All guides`, 'btn-glass btn-pill')}</div>
  <div class="guides">${GUIDES.map(([k, tag, t, b], i) => `<a href="/learn/${GUIDE_LINK[k] || ''}" class="guide2 spot reveal" style="transition-delay:${(i % 3) * 60}ms">
    <svg class="g-svg" viewBox="0 0 100 58" aria-hidden="true">${LEARN_SVG[k]}</svg><span class="tag">${tag}</span><h3>${t}</h3><p>${b}</p>
    <span class="g-more">Read the guide ${icon('arrow-right', 'i-35')}</span></a>`).join('')}</div>
</div></section>

<section id="pricing" class="section section-alt"><div class="wrap">
  <div class="sec-head">${num(4, 'Pricing')}<h2 class="h2 display">Free while we're in beta</h2>
    <p class="sec-sub">No card, no trial clock. A paid plan with extras may come later; we'll say so well before anything changes.</p></div>
  <div class="plans">
    <div class="plan2 featured reveal"><div class="plan-in">
      <div class="plan-head"><h3>Free</h3><span class="chip chip-pri">Beta</span></div>
      <p class="price"><b>$0</b><span>/ month</span></p>
      <ul class="checks">${FREE.map(f => `<li>${icon('check')}${f}</li>`).join('')}</ul>
      <div style="margin-top:32px">${btn('/signup', `Create a free account ${icon('arrow-right', 'i-35')}`, 'btn-primary btn-lg btn-pill glow-btn btn-block')}</div></div></div>
    <div class="plan later reveal" style="transition-delay:80ms"><div class="plan-head"><h3 class="t2">Pro</h3><span class="chip chip-line">Later</span></div>
      <p class="t2" style="margin-top:16px;font-size:15px;line-height:1.65">Extras for heavy users, such as more layouts and alerts. Not available yet.</p>
      <p class="muted" style="margin-top:32px;display:flex;align-items:center;gap:8px;font-size:13px">${icon('sparkles')} We'll announce it here first.</p></div>
  </div>
</div></section>

<section id="faq" class="section"><div class="wrap wrap-md">
  <div class="sec-head">${num(5, 'FAQ')}<h2 class="h2 display">Questions</h2></div>
  <div class="faq">${QA.map(([q, a], k) => `<details${k === 0 ? ' open' : ''}><summary>${q}${icon('chevron-down')}</summary><p>${a}</p></details>`).join('')}</div>
</div></section>

<section class="cta-sec"><div class="wrap"><div class="cta2 reveal">
  <div class="aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i></div><div class="dots-bg" aria-hidden="true"></div>
  <div class="cta2-in">
    <h2 class="display">Your next 100 trades,<br><span class="text-shine">before you risk a dollar.</span></h2>
    <p>Make the mistakes on paper. Keep the lessons.</p>
    <div class="cta-row">${btn('/signup', `${icon('play')} Start replaying — free <span class="arr">${icon('arrow-right', 'i-35')}</span>`, 'btn-primary btn-lg btn-pill glow-btn')}</div>
  </div>
</div></div></section>
</main>
${footer()}`;
  return page({ body, nonce, scripts: [LWC, `<script src="${asset('hero.js')}" defer></script>`, `<script src="${asset('landing.js')}" defer></script>`] });
}

module.exports = { landing, GUIDES, LEARN_SVG };
