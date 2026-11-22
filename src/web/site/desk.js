// The replay desk at /app: a TradingView-style trading terminal shell. Everything inside it is run by /assets/desk.js in
// the browser: candles come straight from Binance / Bybit public market data (never through the bot), and every trade is
// paper, kept in the browser for now (server-saved journal comes in phase 3). No order ever leaves the browser.
const { esc, page, LOGO_SVG, themeBtn, asset, icon } = require('./html');

const LWC = '<script src="https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js" ' +
  'integrity="sha384-KkYqTZlM13Zya6fVUF3IGCBOQ1ehFeJVVgxaVvD/0MebineF9EI8Jkd3NnWNChqN" crossorigin="anonymous" defer></script>';

const TFS = ['1m', '5m', '15m', '1H', '4H', '1D', '1W', '1M'];
const TFN = { '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1H': '1 hour', '4H': '4 hours', '1D': '1 day', '1W': '1 week', '1M': '1 month' };
const TOOLS = [
  ['cursor', 'mouse-pointer-2', 'Cursor (Esc)'], ['cross', 'crosshair', 'Crosshair'], null,
  ['pen', 'pencil', 'Pencil: draw freehand (P)'], ['trend', 'move-diagonal', 'Trend line (T)'], ['hline', 'minus', 'Horizontal line (H)'], ['ray', 'move-horizontal', 'Horizontal ray (R)'],
  ['rect', 'rectangle-horizontal', 'Rectangle / zone (B)'], ['fib', 'list', 'Fibonacci retracement (F)'], ['measure', 'ruler', 'Measure (M)'], null,
  ['magnet', 'magnet', 'Magnet: snap to candle high / low / open / close'], ['clear', 'trash-2', 'Remove all drawings on this coin'],
];
// icons the browser code builds rows with
const JS_ICONS = ['x', 'star', 'chevron-right', 'arrow-up-right', 'arrow-down-right', 'shield', 'circle-x', 'play', 'pause', 'trending-up', 'zap', 'minus', 'target', 'crosshair', 'search', 'chevron-left', 'chevron-up', 'chevron-down',
  'bell', 'clock', 'layers', 'users', 'activity', 'info', 'percent', 'newspaper'];
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
${who.admin ? `<a role="menuitem" href="/admin">${icon('shield')} Admin console</a><a role="menuitem" href="/dashboard/classic">${icon('history')} Classic dashboard</a>` : ''}
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
  <div class="tk2-type" role="tablist" aria-label="Entry"><button type="button" class="on" data-rentry="market">Market</button><button type="button" data-rentry="limit">Limit</button><button type="button" data-rentry="stop" title="Enter at market when price reaches your level: a short below the price now, a long above it">Stop</button></div>
  <label class="fld" data-rx-limrow hidden><span><span data-rx-limname>Limit price</span> <em data-rn="limit"></em></span><span class="fld-in"><input inputmode="decimal" autocomplete="off" data-rf="limit" placeholder="0.00">${pickBtn('limit', 'limit price')}</span></label>
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
  <label class="rx-lines" title="The bot's stop and take-profits for this order, drawn before you place it. Levels you type always show."><input type="checkbox" data-rx-lines checked> Plan lines on the chart <em>preview only</em></label>
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
  <div class="dk-tfs" data-tfs role="tablist" aria-label="Timeframe">${TFS.map(t => `<button type="button" data-tf="${t}" title="${TFN[t]}" aria-label="${TFN[t]}">${t}</button>`).join('')}</div>
  <select class="dk-tfsel" data-tfsel aria-label="Timeframe">${TFS.map(t => `<option value="${t}" title="${TFN[t]}">${t}</option>`).join('')}</select>
  <span class="dk-vsep"></span>
  <div class="dk-ind">
    <button type="button" class="dk-pill" data-act="ind" aria-expanded="false" title="Indicators">${icon('activity', 'i-35')}<span>Indicators</span></button>
    <div class="dk-pop" data-indpop hidden>
      <div class="dk-smcall dk-cstyle" role="group" aria-label="Candle colours"><span>Candles</span><button type="button" data-act="candles" data-v="color">Green / red</button><button type="button" data-act="candles" data-v="mono">Black / white</button></div>
      <label><input type="checkbox" data-ind="vol" checked> Volume</label>
      <label><input type="checkbox" data-ind="ema20"> EMA 20</label>
      <label><input type="checkbox" data-ind="ema50"> EMA 50</label>
      <label><input type="checkbox" data-ind="ema200"> EMA 200</label>
      <label title="The highest high and lowest low of the candles on screen, with their price, like TradingView's high / low labels. They move as you scroll or zoom."><input type="checkbox" data-ind="hilo"> High / low of the candles in view</label>
      <label title="Yesterday's high and low (PDH / PDL) from this market's daily candle, days 00:00 to 24:00 UTC (FX: Friday is Monday's previous day). Each line starts at yesterday's open and runs to now. In a replay: the day before the replay clock. Not shown on weekly or monthly charts."><input type="checkbox" data-ind="pdhl"> Previous day high / low (PDH / PDL)</label>
      <label title="A fair value gap: three candles where the first and third don't overlap, so price jumped past a range nobody traded. Green = gap below price left by a jump up, orange = gap above left by a drop. Each box covers the gap for 15 candles, or less when price comes back and fills it. Small gaps (under a quarter of a normal candle) are left out. Works with SMC on or off; Recent / Whole chart below picks how many."><input type="checkbox" data-ind="smcFvg"> Fair value gaps (FVG)</label>
      <label title="Trend lines drawn for you, by the rules in Tori Trades' break-and-retest video: a line joins swing lows (green, support) or swing highs (red, resistance) and no candle wick may cross it. A wick that pokes through without closing redraws the line through that wick; a candle that closes through breaks it. Thick = still holding, with its price now beside the last candle. Faint dashed = broken lately, kept to watch the retest. Dots = touches. Closed candles only. Recent / Whole chart below picks how far back it looks."><input type="checkbox" data-ind="tline"> Trend lines (auto)</label>
      <hr><label title="Swing labels (HH / HL / LH / LL), sweeps, supply / demand zones and equal highs / lows. Turning it on also ticks CHoCH and BOS; turning it off clears all three."><input type="checkbox" data-ind="smc"> SMC: swing points, zones, liquidity</label>
      <label title="Change of character: the first candle that closes past the last swing high or low against the trend, so the trend flips. Dashed line from that swing to the candle that closed through it. Works on its own: tick only this (and BOS) for a clean chart. Closed candles only."><input type="checkbox" data-ind="choch"> CHoCH: change of character</label>
      <label title="Break of structure: a candle that closes past the last swing high or low with the trend, so the trend carries on. Dashed line from that swing to the breaking candle. Works on its own, without the rest of SMC. Closed candles only."><input type="checkbox" data-ind="bos"> BOS: break of structure</label>
      <div class="dk-smcall" role="group" aria-label="How much of the chart SMC labels"><span>SMC labels</span><button type="button" data-act="smcall" data-v="0">Recent</button><button type="button" data-act="smcall" data-v="1">Whole chart</button></div>
      <label class="dk-sub" title="An EQL / EQH line normally disappears once price trades through it. This keeps it, faded, up to the candle that took it: “swept” = wick through and closed back, “broken” = closed through."><input type="checkbox" data-ind="smcTaken"> Keep equal lows / highs after price takes them (faded)</label>
      <label title="The classic simulator's A+ setups: a structure break, the pullback into premium / discount, a sweep, then a 1-minute close past the last 1-minute swing. Practice, not signals: these exact rules lost after fees in our test."><input type="checkbox" data-ind="aplus"> A+ setups: sweep + 1m CHoCH</label>
      <label class="dk-sub"><input type="checkbox" data-ind="aplusPause"> Pause the replay on a new A+</label>
      <label class="dk-sub" title="Off: setups that already hit their stop or target leave the chart; open ones and the idea being built stay. The A+ count in the top-left line still counts them."><input type="checkbox" data-ind="aplusDone"> Show finished A+ setups (target / stop hit)</label>
      <label class="dk-sub" title="A sound and a browser notification when the sweep is done (almost ready) and again when the setup triggers. Watches the coin and timeframe on this chart while this page is open. Not during a replay."><input type="checkbox" data-ind="aplusAlert"> Alert me: sound + browser notification</label>
      <label class="dk-sub" title="Fully ready = all 4 steps done: the 1-minute close past the trigger line came, the entry, stop and target are set. No sound, notification or note when only the sweep is done (almost ready)."><input type="checkbox" data-ind="aplusFull"> Only alert when the setup is fully ready (triggered)</label>
      <label class="dk-sub" title="The alert sound repeats until you press Stop alarm, press Esc or click the notification."><input type="checkbox" data-ind="aplusRing"> Keep ringing until I stop it</label>
      <label class="dk-sub" title="A triggered setup rings until you stop it. Almost ready plays the short sound once and does not ring."><input type="checkbox" data-ind="aplusRingTrig"> Only ring when a setup triggers (almost ready plays one short sound)</label>
      ${A ? `<div class="dk-awbox" data-awbox>
        <label title="The server checks every coin in your Watchlist each minute with the same A+ rules as the chart. Alerts go to your Telegram even with this page closed, and ring here on any chart. Practice setups, not signals: these rules lost after fees in our test."><input type="checkbox" data-aw="on"> Watch my Watchlist for A+ (Telegram + this page)</label>
        <div class="dk-smcall" role="group" aria-label="Timeframes to watch"><span>Timeframes</span>${['5m', '15m', '1H', '4H'].map(t => `<button type="button" data-awpick="${t}">${t}</button>`).join('')}</div>
        <label class="dk-sub" title="Fully ready = all 4 steps done: the 1-minute close past the trigger line came. Off: you also get a message when the sweep is done (almost ready), one close before."><input type="checkbox" data-aw="full"> Only alert when the setup is fully ready (triggered)</label>
        <div class="dk-awstat" data-awstat aria-live="polite"></div>
        <button type="button" class="dk-awsync" data-awsync hidden>Watch this device's Watchlist</button>
      </div>` : ''}
      <label><input type="checkbox" data-ind="qt" checked> Buy / Sell buttons on the chart</label>
      <p>SMC and A+ read closed candles only, so in a replay they never see the future.</p>
    </div>
  </div>
  <button type="button" class="dk-pill dk-smc" data-act="smc" aria-pressed="false">SMC</button>
  <button type="button" class="dk-pill dk-coachb" data-act="coach" aria-pressed="false" title="Walk me through: the SMC coach reads this chart step by step and quizzes you">${icon('graduation-cap', 'i-35')}<span>Walk me</span></button>
  <button type="button" class="dk-pill dk-findb" data-act="find" aria-pressed="false" title="Find setups: check a list of coins for A+ setups, with filters">${icon('search', 'i-35')}<span>Find setups</span></button>
  <button type="button" class="dk-pill dk-cmpb" data-act="cmp" aria-pressed="false" title="Compare: a second coin beside this chart">${icon('layers', 'i-35')}<span>Compare</span></button>
  <div class="dk-more">
    <button type="button" class="dk-pill dk-moreb" data-act="more" aria-expanded="false" aria-label="Tools: SMC, Walk me, Find setups, Compare" title="Tools">${icon('menu', 'i-35')}</button>
    <div class="dk-pop dk-morepop" data-morepop hidden><button type="button" class="mo-i" data-mi="smc">${icon('scan-line', 'i-4')}<span><b>SMC</b><small>Structure, zones and liquidity on the chart</small></span><i class="mo-on">On</i></button><button type="button" class="mo-i" data-mi="coach">${icon('graduation-cap', 'i-4')}<span><b>Walk me through</b><small>The SMC coach reads this chart step by step and quizzes you</small></span><i class="mo-on">On</i></button><button type="button" class="mo-i" data-mi="find">${icon('search', 'i-4')}<span><b>Find setups</b><small>Check a list of coins for A+ setups</small></span><i class="mo-on">On</i></button><button type="button" class="mo-i" data-mi="cmp">${icon('layers', 'i-4')}<span><b>Compare</b><small>A second coin under this chart</small></span><i class="mo-on">On</i></button><button type="button" class="mo-i" data-mi="theme">${icon('sun', 'i-4')}<span><b>Light / dark</b><small>Switch the colour theme</small></span><i class="mo-on">On</i></button><button type="button" class="mo-i" data-mi="full">${icon('maximize', 'i-4')}<span><b>Full screen</b><small>Hide the browser bars</small></span><i class="mo-on">On</i></button></div>
  </div>
  <span class="dk-vsep"></span>
  <button type="button" class="dk-pill dk-rbtn" data-act="replay" title="Replay: trade past candles one by one">${icon('rewind', 'i-35')}<span>Replay</span></button>
  <div class="dk-rp" data-rp hidden>
    ${ib('rstart', 'calendar-clock', 'Choose the start')}
    ${ib('back', 'step-back', 'Back one step (←)')}
    <button type="button" class="dk-ib dk-play" data-act="play" aria-label="Play" title="Play / pause (Space)">${icon('play', 'i-4')}</button>
    ${ib('step', 'step-forward', 'Next candle (→)')}
    <select data-speed aria-label="Speed"><option value="1500">0.5×</option><option value="800" selected>1×</option><option value="400">2×</option><option value="160">5×</option><option value="60">10×</option></select>
    <select data-stepsize aria-label="Step size"><option value="bar">Step: 1 bar</option><option value="1m">Step: 1 minute</option></select>
    <span class="dk-clock mono" data-clock></span>
    <button type="button" class="dk-pill dk-exit" data-act="rexit">${icon('x', 'i-35')}<span>Exit</span></button>
  </div>
  <div class="dk-right">
    <div class="dk-snd" data-snd><button type="button" class="dk-ib dk-bell" data-act="snd" aria-expanded="false" aria-label="Sounds and alarms" title="Sounds and alarms">${icon('bell', 'i-4 b-on')}${icon('bell-off', 'i-4 b-off')}<span class="dk-bell-t">Stop alarm</span></button><div class="dk-pop dk-sndpop" data-sndpop hidden role="dialog" aria-label="Sounds and alarms"></div></div>
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
    <button type="button" data-act="back" aria-label="Back one step">${icon('step-back', 'i-45')}</button>
    <button type="button" class="dk-play" data-act="play" aria-label="Play">${icon('play', 'i-5')}</button>
    <button type="button" data-act="step" aria-label="Next candle">${icon('step-forward', 'i-45')}</button>
    <span class="mono" data-clock></span>
    <button type="button" data-act="rexit" aria-label="Exit replay">${icon('x', 'i-45')}</button>
  </div>
</main>

<aside class="dk-side" data-sheet="trade">
  <div class="dk-tabs" role="tablist">${A
    ? `<button type="button" class="on" data-ptab="trade">Paper</button><button type="button" class="tab-real" data-ptab="real"><i class="rdot"></i>Real</button><button type="button" data-ptab="sig">Signals</button><button type="button" data-ptab="mkt">Market</button><button type="button" data-ptab="watch">Watchlist</button>`
    : `<button type="button" class="on" data-ptab="trade">${icon('target', 'i-35')} Trade</button><button type="button" data-ptab="mkt">${icon('activity', 'i-35')} Market</button><button type="button" data-ptab="watch">${icon('star', 'i-35')} Watchlist</button>`}
    <button type="button" class="dk-close" data-act="close-sheet" aria-label="Close">${icon('x', 'i-4')}</button></div>
  <section class="dk-pane" data-pane="trade">${ticket()}</section>
  ${A ? `<section class="dk-pane" data-pane="real" hidden>${realTicket()}</section><section class="dk-pane dk-sigpane" data-pane="sig" hidden><div class="sg-wrap" data-sigs></div></section>` : ''}
  <section class="dk-pane dk-mkpane" data-pane="mkt" hidden><div data-mkt></div></section>
  <section class="dk-pane" data-pane="find" hidden><div data-find></div></section>
  <section class="dk-pane" data-pane="watch" hidden><div class="wl" data-watch></div><p class="wl-note">Tap ☆ in the coin search to add coins.</p></section>
</aside>

<section class="dk-bottom" data-sheet="pos">
  <div class="dk-bres" data-bres title="Drag to resize · double-click to reset" aria-hidden="true"></div>
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
    <div class="dk-sin">${icon('search', 'i-45')}<input data-q placeholder="Search — BTC, SOL, EURUSD, gold…" autocomplete="off" spellcheck="false" aria-label="Market">
      <div class="dk-exsw" role="tablist" aria-label="Where"><button type="button" data-sex="all" class="on">All</button><button type="button" data-sex="binance">Binance</button><button type="button" data-sex="bybit">Bybit</button><button type="button" data-sex="fx" title="Interbank FX prices, the ones TradingView's FX charts show">FX</button></div>
      <button type="button" class="dk-ib" data-act="close-modal" aria-label="Close">${icon('x', 'i-4')}</button></div>
    <div class="dk-slist" data-slist role="listbox"></div>
    <p class="dk-sfoot">Binance and Bybit USDT perpetuals · FX = interbank prices (chart and paper only) · ↑ ↓ to move, Enter to open, ☆ adds to the watchlist</p>
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
    <div class="dk-rquick">${[['today', 'Today 00:00'], ['1d', '1 day ago'], ['7d', '1 week ago'], ['30d', '1 month ago'], ['180d', '6 months ago']].map(([v, l]) => `<button type="button" data-rq="${v}">${l}</button>`).join('')}</div>
    <button type="button" class="btn btn-primary btn-block" data-act="rgo" style="margin-top:16px">${icon('play')} Start replay</button>
  </div>
</div>

${A ? `<div class="dk-modal" data-xmodal hidden role="dialog" aria-modal="true" aria-label="Confirm"><div class="dk-mbox dk-xbox" data-xbox></div></div>` : ''}
<div class="dk-toast" data-toast hidden></div>
<script type="application/json" id="dk-icons">${JSON.stringify(Object.fromEntries((A ? JS_ICONS.concat(ADMIN_ICONS) : JS_ICONS).map(n => [n, icon(n, 'i-35')]))).replace(/</g, '\\u003c')}</script>`;
  const scripts = [LWC, `<script src="${asset('smc.js')}" defer></script>`, `<script src="${asset('desk.js')}" defer></script>`, `<script src="${asset('desksound.js')}" defer></script>`, `<script src="${asset('deskcmp.js')}" defer></script>`, `<script src="${asset('deskcoach.js')}" defer></script>`, `<script src="${asset('zonestats.js')}" defer></script>`, `<script src="${asset('deskmkt.js')}" defer></script>`, `<script src="${asset('desksess.js')}" defer></script>`, `<script src="${asset('desktrend.js')}" defer></script>`, `<script src="${asset('deskaplus.js')}" defer></script>`, `<script src="${asset('deskfind.js')}" defer></script>`];
  if (A) scripts.push(`<script src="${asset('deskadmin.js')}" defer></script>`, `<script src="${asset('deskwatch.js')}" defer></script>`);
  return page({
    title: 'Desk', nonce, noindex: true, bodyClass: 'desk-body', body,
    head: `<link rel="stylesheet" href="${asset('desk.css')}">`, scripts,
  });
}

module.exports = { desk };
