// The replay desk at /app: a TradingView-style trading terminal shell. Everything inside it is run by /assets/desk.js in
// the browser: candles come straight from Binance / Bybit public market data (never through the bot), and every trade is
// paper, kept in the browser for now (server-saved journal comes in phase 3). No order ever leaves the browser.
const { esc, page, LOGO_SVG, themeBtn, asset, icon } = require('./html');

const LWC = '<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js" ' +
  'integrity="sha384-KkYqTZlM13Zya6fVUF3IGCBOQ1ehFeJVVgxaVvD/0MebineF9EI8Jkd3NnWNChqN" crossorigin="anonymous" defer></script>';

const TFS = ['1m', '5m', '15m', '1H', '4H', '1D', '1W'];
const TOOLS = [
  ['cursor', 'mouse-pointer-2', 'Cursor (Esc)'], ['cross', 'crosshair', 'Crosshair'], null,
  ['trend', 'move-diagonal', 'Trend line (T)'], ['hline', 'minus', 'Horizontal line (H)'], ['ray', 'move-horizontal', 'Horizontal ray (R)'],
  ['rect', 'rectangle-horizontal', 'Rectangle / zone (B)'], ['fib', 'list', 'Fibonacci retracement (F)'], ['measure', 'ruler', 'Measure (M)'], null,
  ['magnet', 'magnet', 'Magnet: snap to candle high / low / open / close'], ['clear', 'trash-2', 'Remove all drawings on this coin'],
];
// icons the browser code builds rows with
const JS_ICONS = ['x', 'star', 'chevron-right', 'arrow-up-right', 'arrow-down-right', 'shield', 'circle-x', 'play', 'pause', 'trending-up'];
// the admin layer's extra icons (only sent to admins)
const ADMIN_ICONS = ['rewind', 'refresh-cw', 'send', 'zap', 'triangle-alert', 'circle-check', 'external-link', 'chart-candlestick', 'bot', 'radio', 'users', 'activity', 'crosshair', 'info', 'trending-down'];

const initials = s => String(s || '').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'RD';

function userMenu(who) {
  const u = who.user;
  const name = u ? (u.name || 'Trader') : 'Admin';
  const sub = u ? u.email : 'Signed in with the dashboard key';
  const av = u && u.image ? `<img src="${esc(u.image)}" alt="" referrerpolicy="no-referrer">` : esc(initials(u ? u.name || u.email : 'A D'));
  return `<div class="umenu" data-umenu><button type="button" class="avatar dk-av" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">${av}</button>
<div class="menu" role="menu" hidden><div class="menu-who"><b>${esc(name)}</b><span>${esc(sub)}</span></div>
<div class="menu-items"><a role="menuitem" href="/learn">${icon('graduation-cap')} Learn</a>${u ? `<a role="menuitem" href="/account">${icon('settings')} Account</a>` : ''}
${who.admin ? `<a role="menuitem" href="/admin">${icon('shield')} Admin console</a><a role="menuitem" href="/dashboard">${icon('layout-dashboard')} Classic dashboard</a>` : ''}
<button type="button" role="menuitem" data-signout>${icon('log-out')} Sign out</button></div></div></div>`;
}

const ib = (act, ic, label, extra = '') => `<button type="button" class="dk-ib" data-act="${act}" aria-label="${esc(label)}" title="${esc(label)}"${extra}>${icon(ic, 'i-4')}</button>`;

function ticket() {
  return `<div class="tk2" data-ticket>
  <div class="tk2-side" role="radiogroup" aria-label="Side"><button type="button" class="on" data-side="1">Buy / Long</button><button type="button" data-side="-1">Sell / Short</button></div>
  <div class="tk2-type" role="tablist" aria-label="Order type"><button type="button" class="on" data-otype="market">Market</button><button type="button" data-otype="limit">Limit</button></div>
  <label class="fld" data-limit-row hidden><span>Limit price</span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-f="price" placeholder="0.00">
    <button type="button" class="pick" data-pick-f="price" title="Pick the price on the chart" aria-label="Pick the limit price on the chart">${icon('crosshair', 'i-35')}</button></span></label>
  <label class="fld"><span>Margin <em>USDT</em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-f="margin" value="100"></span></label>
  <div class="tk2-pcts">${[10, 25, 50, 100].map(p => `<button type="button" data-pct="${p}">${p}%</button>`).join('')}</div>
  <div class="fld"><span>Leverage <b class="mono" data-lev-v>10×</b></span><input type="range" min="1" max="50" step="1" value="10" data-f="lev" aria-label="Leverage"></div>
  <label class="fld"><span>Stop loss</span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-f="sl" placeholder="optional">
    <button type="button" class="pick" data-pick-f="sl" title="Pick the stop on the chart" aria-label="Pick the stop on the chart">${icon('crosshair', 'i-35')}</button></span><i class="fld-note" data-n="sl"></i></label>
  <label class="fld"><span>Take profit</span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-f="tp" placeholder="optional">
    <button type="button" class="pick" data-pick-f="tp" title="Pick the target on the chart" aria-label="Pick the target on the chart">${icon('crosshair', 'i-35')}</button></span><i class="fld-note" data-n="tp"></i></label>
  <dl class="tk2-sum" data-sum></dl>
  <button type="button" class="tk2-go up" data-place>Buy / Long</button>
  <p class="tk2-err" data-tkerr hidden></p>
</div>
<div class="acct" data-acct></div>`;
}

// ---- admin only: the real-money ticket (through the bot, like /long · /short in Telegram) and the bot's signals
const seg = (attr, opts, on) => `<div class="rx-seg" role="radiogroup">${opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${v === on}" data-${attr}="${v}"${v === on ? ' class="on"' : ''}>${l}</button>`).join('')}</div>`;
const pickBtn = (f, what) => `<button type="button" class="pick" data-pick-x="${f}" title="Pick the ${what} on the chart" aria-label="Pick the ${what} on the chart">${icon('crosshair', 'i-35')}</button>`;
const chips = (attr, vals, fmt) => `<div class="rx-chips">${vals.map(v => `<button type="button" data-${attr}="${v}">${fmt(v)}</button>`).join('')}</div>`;

function realTicket() {
  return `<div class="rx" data-rx>
  <div class="rx-head"><span class="rx-badge"><i></i>Real money</span><span class="rx-wt" data-rx-wt>Checking the bot…</span></div>
  <div class="rx-block" data-rx-replay hidden>${icon('info', 'i-4')}<div><b>Real trading is on the live chart.</b><span>You're in a replay. Exit it to place or manage real trades.</span>
    <button type="button" class="btn btn-secondary btn-sm" data-act="rexit">Exit replay</button></div></div>
  <fieldset class="rx-form" data-rx-form>
  <div class="tk2-side" role="radiogroup" aria-label="Side"><button type="button" class="on" data-rside="long">Long</button><button type="button" data-rside="short">Short</button></div>
  <div class="tk2-type" role="tablist" aria-label="Entry"><button type="button" class="on" data-rentry="market">Market</button><button type="button" data-rentry="limit">Limit</button></div>
  <label class="fld" data-rx-limrow hidden><span>Limit price <em data-rn="limit"></em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-rf="limit" placeholder="0.00">${pickBtn('limit', 'limit price')}</span></label>
  <div class="rx-two">
    <label class="fld"><span>Margin <em>USDT</em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-rf="margin" placeholder="saved"></span></label>
    <label class="fld"><span>Leverage <em>×</em></span><span class="fld-in"><input inputmode="numeric" autocomplete="off" data-rf="lev" placeholder="saved"></span></label>
  </div>
  ${chips('rlev', [3, 5, 10, 20], v => v + '×')}
  <label class="fld"><span>Stop loss <em data-rn="stop"></em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-rf="stop" placeholder="saved stop">${pickBtn('stop', 'stop')}</span></label>
  ${chips('rstop', [2, 4, 6, 8], v => v + '%')}
  <div class="fld"><span>Take profit</span>${seg('rtp', [['plan', "Bot's TP plan"], ['price', 'Set TP1']], 'plan')}</div>
  <div data-rx-tprow hidden>
    <label class="fld"><span>TP1 price <em data-rn="tp"></em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-rf="tp" placeholder="0.00">${pickBtn('tp', 'TP1')}</span></label>
    ${chips('rtpp', [5, 7, 12, 20], v => v + '%')}
  </div>
  <details class="rx-more" data-rx-more><summary>${icon('settings-2', 'i-35')} Account, exchange, size by risk</summary>
    <div class="fld"><span>Account</span>${seg('rmode', [['live', 'Live money'], ['paper', "Bot's paper"]], 'live')}</div>
    <div class="fld"><span>Exchange</span>${seg('rex', [['', 'Saved'], ['binance', 'Binance'], ['bybit', 'Bybit']], '')}</div>
    <div class="fld"><span>Size by max loss <em>margin fits the stop</em></span><span class="rx-fit"><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-rf="risk" placeholder="$ you accept to lose"></span>
      <button type="button" class="btn btn-secondary btn-sm" data-act="rx-fit">Fit margin</button></span></div>
  </details>
  </fieldset>
  <div class="rx-pv" data-rx-pv aria-live="polite"></div>
  <button type="button" class="tk2-go up" data-act="rx-review">Review order</button>
  <div class="rx-alt"><button type="button" data-act="rx-tg">${icon('send', 'i-35')} Send to Telegram</button><button type="button" data-act="rx-clear">${icon('rotate-ccw', 'i-35')} Clear</button></div>
  <p class="rx-note">Blank fields use your saved <code>/long</code> · <code>/short</code> settings. Nothing is placed until you confirm, and the bot reports every action in Telegram.</p>
</div>
<section class="rx-flow" data-rx-flow aria-label="Positioning"></section>`;
}

function desk(who, nonce) {
  const A = !!who.admin;
  const body = `<div class="dk${A ? ' dk-admin' : ''}" data-desk>
<header class="dk-top">
  <a href="/" class="dk-logo" aria-label="ReplayDesk home">${LOGO_SVG(26, 'dk')}</a>
  <button type="button" class="dk-sym" data-act="search" aria-label="Change coin">${icon('search', 'i-35')}<b data-sym>BTCUSDT</b><span data-exname>Binance</span></button>
  <div class="dk-tfs" data-tfs role="tablist" aria-label="Timeframe">${TFS.map(t => `<button type="button" data-tf="${t}">${t}</button>`).join('')}</div>
  <select class="dk-tfsel" data-tfsel aria-label="Timeframe">${TFS.map(t => `<option>${t}</option>`).join('')}</select>
  <span class="dk-vsep"></span>
  <div class="dk-ind">
    <button type="button" class="dk-pill" data-act="ind" aria-expanded="false">${icon('activity', 'i-35')}<span>Indicators</span></button>
    <div class="dk-pop" data-indpop hidden>
      <label><input type="checkbox" data-ind="vol" checked> Volume</label>
      <label><input type="checkbox" data-ind="ema20"> EMA 20</label>
      <label><input type="checkbox" data-ind="ema50"> EMA 50</label>
      <label><input type="checkbox" data-ind="ema200"> EMA 200</label>
      <hr><label><input type="checkbox" data-ind="smc"> SMC: structure, zones, liquidity</label>
      <p>SMC reads closed candles only, so in a replay it never sees the future.</p>
    </div>
  </div>
  <button type="button" class="dk-pill dk-smc" data-act="smc" aria-pressed="false">SMC</button>
  <span class="dk-vsep"></span>
  <button type="button" class="dk-pill dk-rbtn" data-act="replay">${icon('rewind', 'i-35')}<span>Replay</span></button>
  <div class="dk-rp" data-rp hidden>
    ${ib('rstart', 'calendar-clock', 'Choose the start')}
    <button type="button" class="dk-ib dk-play" data-act="play" aria-label="Play" title="Play / pause (Space)">${icon('play', 'i-4')}</button>
    ${ib('step', 'step-forward', 'Next candle (→)')}
    <select data-speed aria-label="Speed"><option value="1500">0.5×</option><option value="800" selected>1×</option><option value="400">2×</option><option value="160">5×</option><option value="60">10×</option></select>
    <select data-stepsize aria-label="Step size"><option value="bar">Step: 1 bar</option><option value="1m">Step: 1 minute</option></select>
    <span class="dk-clock mono" data-clock></span>
    <button type="button" class="dk-pill dk-exit" data-act="rexit">${icon('x', 'i-35')}<span>Exit</span></button>
  </div>
  <div class="dk-right">
    ${A ? `<button type="button" class="dk-wt" data-wt hidden aria-label="Web trading status"><i></i><span>Web trading</span></button>` : ''}
    <span class="dk-mode" data-mode><i></i><span>LIVE</span></span>
    ${ib('full', 'maximize', 'Full screen')}
    ${themeBtn()}
    ${userMenu(who)}
  </div>
</header>

<aside class="dk-tools" data-tools aria-label="Drawing tools">${TOOLS.map(t => t ? `<button type="button" class="dk-tool${t[0] === 'cursor' ? ' on' : ''}" data-tool="${t[0]}" title="${esc(t[2])}" aria-label="${esc(t[2])}">${icon(t[1], 'i-45')}</button>` : '<span class="dk-tsep"></span>').join('')}</aside>

<main class="dk-chart">
  <div class="dk-legend" data-legend></div>
  <div class="dk-canvas" data-chart></div>
  <div class="dk-hint" data-hint hidden></div>
  <div class="dk-msg" data-msg hidden></div>
  <div class="dk-fab" data-fab><button type="button" data-act="tools-m" aria-label="Drawing tools">${icon('pen-line', 'i-45')}</button></div>
  <div class="dk-rpm" data-rpm hidden>
    <button type="button" data-act="rstart" aria-label="Choose the start">${icon('calendar-clock', 'i-45')}</button>
    <button type="button" class="dk-play" data-act="play" aria-label="Play">${icon('play', 'i-5')}</button>
    <button type="button" data-act="step" aria-label="Next candle">${icon('step-forward', 'i-45')}</button>
    <span class="mono" data-clock></span>
    <button type="button" data-act="rexit" aria-label="Exit replay">${icon('x', 'i-45')}</button>
  </div>
</main>

<aside class="dk-side" data-sheet="trade">
  <div class="dk-tabs" role="tablist">${A
    ? `<button type="button" class="on" data-ptab="trade">Paper</button><button type="button" class="tab-real" data-ptab="real"><i class="rdot"></i>Real</button><button type="button" data-ptab="sig">Signals</button><button type="button" data-ptab="watch">Watchlist</button>`
    : `<button type="button" class="on" data-ptab="trade">${icon('target', 'i-35')} Trade</button><button type="button" data-ptab="watch">${icon('star', 'i-35')} Watchlist</button>`}
    <button type="button" class="dk-close" data-act="close-sheet" aria-label="Close">${icon('x', 'i-4')}</button></div>
  <section class="dk-pane" data-pane="trade">${ticket()}</section>
  ${A ? `<section class="dk-pane" data-pane="real" hidden>${realTicket()}</section><section class="dk-pane dk-sigpane" data-pane="sig" hidden><div class="sg-wrap" data-sigs></div></section>` : ''}
  <section class="dk-pane" data-pane="watch" hidden><div class="wl" data-watch></div><p class="wl-note">Tap ☆ in the coin search to add coins.</p></section>
</aside>

<section class="dk-bottom" data-sheet="pos">
  <div class="dk-tabs" role="tablist">
    <button type="button" class="on" data-btab="pos">Positions <b data-cnt="pos">0</b></button><button type="button" data-btab="ord">Orders <b data-cnt="ord">0</b></button>
    <button type="button" data-btab="hist">History</button><button type="button" data-btab="stats">Stats</button>
    ${A ? `<span class="dk-tsep2" aria-hidden="true"></span><button type="button" class="tab-real" data-btab="real"><i class="rdot"></i>Real <b data-cnt="real">0</b></button>` : ''}
    <span class="dk-tabs-r"><button type="button" class="dk-ib" data-act="collapse" aria-label="Collapse the panel" title="Collapse">${icon('chevron-down', 'i-4')}</button>
    <button type="button" class="dk-close" data-act="close-sheet" aria-label="Close">${icon('x', 'i-4')}</button></span>
  </div>
  <div class="dk-bbody" data-bbody></div>
</section>

<nav class="dk-tabbar" aria-label="Desk">
  <button type="button" class="on" data-m="chart">${icon('chart-candlestick', 'i-5')}<span>Chart</span></button>
  <button type="button" data-m="trade">${icon('target', 'i-5')}<span>Trade</span></button>
  <button type="button" data-m="pos">${icon('wallet', 'i-5')}<span>Positions</span><b data-cnt="pos-m" hidden></b></button>
  <button type="button" data-m="watch">${icon('star', 'i-5')}<span>Watchlist</span></button>
  <button type="button" data-m="replay">${icon('rewind', 'i-5')}<span>Replay</span></button>
</nav>
<div class="dk-scrim" data-scrim hidden></div>
</div>

<div class="dk-modal" data-search hidden role="dialog" aria-modal="true" aria-label="Find a coin">
  <div class="dk-mbox dk-sbox">
    <div class="dk-sin">${icon('search', 'i-45')}<input data-q placeholder="Search coin — BTC, SOL, PEPE…" autocomplete="off" spellcheck="false" aria-label="Coin">
      <div class="dk-exsw" role="tablist"><button type="button" data-sex="binance" class="on">Binance</button><button type="button" data-sex="bybit">Bybit</button></div>
      <button type="button" class="dk-ib" data-act="close-modal" aria-label="Close">${icon('x', 'i-4')}</button></div>
    <div class="dk-slist" data-slist role="listbox"></div>
    <p class="dk-sfoot">USDT perpetual futures · ↑ ↓ to move, Enter to open, ☆ adds to the watchlist</p>
  </div>
</div>

<div class="dk-modal" data-rmodal hidden role="dialog" aria-modal="true" aria-label="Start a replay">
  <div class="dk-mbox dk-rbox">
    <div class="dk-mhead"><h2>${icon('rewind', 'i-45')} Start a replay</h2><button type="button" class="dk-ib" data-act="close-modal" aria-label="Close">${icon('x', 'i-4')}</button></div>
    <p class="t2">The chart goes back to the moment you pick. Everything after it stays hidden until you play or step forward.</p>
    <div class="dk-rpick">
      <button type="button" class="dk-bigopt" data-act="rpick-chart">${icon('mouse-pointer-click', 'i-5')}<b>Pick a candle on the chart</b><span>Scroll back, then click where the replay should start</span></button>
      <button type="button" class="dk-bigopt" data-act="rrandom">${icon('shuffle', 'i-5')}<b>Random moment</b><span>A random day in the last two years — no peeking</span></button>
    </div>
    <label class="fld"><span>Or a date and time <em>UTC</em></span><span class="fld-in"><input type="datetime-local" data-rdate></span></label>
    <div class="dk-rquick">${[['1d', '1 day ago'], ['7d', '1 week ago'], ['30d', '1 month ago'], ['180d', '6 months ago']].map(([v, l]) => `<button type="button" data-rq="${v}">${l}</button>`).join('')}</div>
    <button type="button" class="btn btn-primary btn-block" data-act="rgo" style="margin-top:16px">${icon('play')} Start replay</button>
  </div>
</div>

${A ? `<div class="dk-modal" data-xmodal hidden role="dialog" aria-modal="true" aria-label="Confirm"><div class="dk-mbox dk-xbox" data-xbox></div></div>` : ''}
<div class="dk-toast" data-toast hidden></div>
<script type="application/json" id="dk-icons">${JSON.stringify(Object.fromEntries((A ? JS_ICONS.concat(ADMIN_ICONS) : JS_ICONS).map(n => [n, icon(n, 'i-35')]))).replace(/</g, '\\u003c')}</script>`;
  const scripts = [LWC, `<script src="${asset('smc.js')}" defer></script>`, `<script src="${asset('desk.js')}" defer></script>`];
  if (A) scripts.push(`<script src="${asset('deskadmin.js')}" defer></script>`);
  return page({
    title: 'Desk', nonce, noindex: true, bodyClass: 'desk-body', body,
    head: `<link rel="stylesheet" href="${asset('desk.css')}">`, scripts,
  });
}

module.exports = { desk };
