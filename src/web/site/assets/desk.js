/* ReplayDesk trading desk (/app). TradingView Lightweight Charts 5 (window.LightweightCharts) and the simulator's SMC
   engine (window.SMC). Candles come straight from Binance / Bybit public market data in this browser. Every trade is paper:
   nothing is ever sent to an exchange or to our server; the paper account lives in this browser's localStorage.
   Replay: the chart stops at a past moment; stepping feeds finer candles (1m up to 1H charts, 5m for 4H, 15m for 1D,
   1H for 1W) into the chart and into the paper engine, so stops and targets fill in the order the market reached them. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = $('[data-desk]');
  if (!root) return;
  const LC = window.LightweightCharts;
  const msgEl = $('[data-msg]');
  if (!LC) { msgEl.hidden = false; msgEl.textContent = 'The chart library did not load. Check your connection and reload the page.'; return; }

  let ICONS = {};
  try { ICONS = JSON.parse($('#dk-icons').textContent); } catch (e) { /* plain text buttons */ }
  const ic = n => ICONS[n] || '';

  // ------------------------------------------------------------------ constants & helpers
  const MIN = 60e3, HOUR = 36e5, DAY = 864e5, WEEK = 7 * DAY, WEEK_OFF = 4 * DAY;   // weeks start Monday 00:00 UTC
  const MONTH = 30.44 * DAY;   // 1M: months run 28–31 days (calendar months, from the 1st 00:00 UTC). This average only sizes
                               // requests and places drawings past the last candle; candle edges come from bucket() / nextB()
  const TF = {
    '1m': { ms: MIN, b: '1m', y: '1' }, '5m': { ms: 5 * MIN, b: '5m', y: '5' }, '15m': { ms: 15 * MIN, b: '15m', y: '15' },
    '1H': { ms: HOUR, b: '1h', y: '60' }, '4H': { ms: 4 * HOUR, b: '4h', y: '240' }, '1D': { ms: DAY, b: '1d', y: 'D' }, '1W': { ms: WEEK, b: '1w', y: 'W' },
    '1M': { ms: MONTH, b: '1M', y: 'M' },
  };
  const RES = { '1m': '1m', '5m': '1m', '15m': '1m', '1H': '1m', '4H': '5m', '1D': '15m', '1W': '1H', '1M': '4H' };   // replay feed per chart timeframe
  const FXRES = { '1m': '1m', '5m': '5m', '15m': '15m', '1H': '1H', '4H': '1H', '1D': '1H', '1W': '1D', '1M': '1D' };   // FX: 1m kept 30 days, 5m / 15m 60, 1H 2 years
  const resOf = (tf, ex) => ((ex || U.ex) === 'fx' ? FXRES : RES)[tf];
  const FEE_T = 0.0005, FEE_M = 0.0002, MMR = 0.005, START_BAL = 10000;
  const monthOf = (t, add) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1); };
  const bucket = (t, tf) => tf === '1M' ? monthOf(t, 0) : tf === '1W' ? Math.floor((t - WEEK_OFF) / WEEK) * WEEK + WEEK_OFF : Math.floor(t / TF[tf].ms) * TF[tf].ms;
  const nextB = (t, tf) => tf === '1M' ? monthOf(t, 1) : bucket(t, tf) + TF[tf].ms;   // when the candle holding t closes
  // the SMC engine's candle grid for a chart timeframe (weeks from Monday, months from the 1st)
  const smcOpt = tf => tf === '1M' ? { tf: TF[tf].ms, bk: t => monthOf(t, 0), next: t => monthOf(t, 1) } : { tf: TF[tf].ms, off: tf === '1W' ? WEEK_OFF : 0 };
  const floorTo = (t, ms) => Math.floor(t / ms) * ms, ceilTo = (t, ms) => Math.ceil(t / ms) * ms;
  const phone = () => window.matchMedia('(max-width: 899px)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } },
  };
  const U = Object.assign({ sym: 'BTCUSDT', ex: 'binance', tf: '15m', vol: true, volMa: true, volHi: true, ema20: false, ema50: false, ema200: false, smc: false, smcAll: false, smcTaken: true, smcFvg: false, tline: false, tlineHtf: true, choch: false, bos: false, eq: false, liq: false, pdhl: false, hilo: true, aplus: false, aplusPause: true, aplusDone: true, aplusAlert: false, aplusRing: false, aplusRingTrig: false, aplusFull: false, poi: false, poiAll: false, poiPause: true, candles: 'color',
    magnet: false, bmin: false, margin: 100, lev: 10, qt: true, qtk: 'mkt', bh: 0 }, store.get('rd-ui-v1', {}));
  if (!TF[U.tf]) U.tf = '15m';
  // frozen trend lines, per exchange | coin | timeframe: { at (when drawn: the clock), tf, last (newest candle used), atr, lines }
  const TLF = { live: store.get('rd-tl-v1', {}), replay: {} };
  const tlSave = () => { const k = Object.keys(TLF.live); if (k.length > 40) k.sort((a, b) => TLF.live[a].at - TLF.live[b].at).slice(0, k.length - 40).forEach(x => delete TLF.live[x]); store.set('rd-tl-v1', TLF.live); };
  { const s0 = store.get('rd-ui-v1', {}); if (U.smc && !('choch' in s0) && !('bos' in s0)) { U.choch = true; U.bos = true; } if (U.smc && !('eq' in s0)) U.eq = true; }   // SMC users keep what SMC drew
  if (!['binance', 'bybit', 'fx'].includes(U.ex)) U.ex = 'binance';
  const saveUI = () => store.set('rd-ui-v1', U);
  // extension points: the admin layer (/assets/deskadmin.js, served to admins only) adds chart lines, markers and bottom tabs
  // and listens to these events: sym (coin changed), mode (live ⇄ replay), tick (prices / clock moved), pane (side tab),
  // load (a new chart is on: coin, timeframe or replay start). menu: sections for the chart's trade menu; quickReal: takes a
  // real order planned on the chart to its review dialog; realActive: true while the Real ticket is the one in use.
  // draw: [(g, W, z)] painted on the chart (z 'bottom' under the candles, 'top' over them) · smcOff: the coach draws the SMC itself
  // legend: [() => html] more on the legend's second line · chartChips: [(price) => [label, run]] more "Chart:" chips in the menu
  const X = { lines: [], marks: [], bottom: {}, ev: {}, menu: [], quickReal: null, realActive: null, realSize: null, draw: [], smcOff: false, legend: [], chartChips: [] };
  const emit = (n, a) => { for (const f of X.ev[n] || []) { try { f(a); } catch (e) { console.error(e); } } };
  // ⚡ plan on the chart: entry → stop → target, then confirm (paper, or the admin's real review)
  const Q = { on: false, stage: '', side: 0, entry: null, sl: null, tp: null, mkt: false, real: false, margin: null, lev: null, el: null };

  let PREC = 2, TICK = 0.01;
  const fp = (p, d = PREC) => p == null || !isFinite(p) ? '—' : (+p).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, sign) => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(2) + '%';
  const fq = q => q >= 1000 ? q.toLocaleString('en-US', { maximumFractionDigits: 0 }) : q >= 1 ? q.toFixed(3) : q.toPrecision(3);
  const fr = r => r == null || !isFinite(r) ? '—' : (r < 0 ? '−' : r > 0 ? '+' : '') + Math.abs(r).toFixed(2) + 'R';
  const fv = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : (+v).toFixed(0);
  const rt = p => +(Math.round(p / TICK) * TICK).toFixed(PREC);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const coin = s => s.replace(/USDT$/, '');
  const mktName = (s, ex) => ((ex || U.ex) === 'fx' ? (/^[A-Z]{6}$/.test(s) ? s.slice(0, 3) + '/' + s.slice(3) : s) : coin(s) + '/USDT');
  const tnice = t => new Date(t).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
  const tshort = t => new Date(t).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const dur = ms => { const m = Math.round(ms / MIN); return m < 60 ? m + 'm' : m < 1440 ? Math.floor(m / 60) + 'h ' + (m % 60 ? (m % 60) + 'm' : '') : Math.floor(m / 1440) + 'd ' + (Math.floor(m / 60) % 24) + 'h'; };
  const decs = s => { s = String(s); if (/e-/.test(s)) return +s.split('e-')[1]; const i = s.indexOf('.'); return i < 0 ? 0 : s.replace(/0+$/, '').length - i - 1; };
  const num = v => { v = String(v == null ? '' : v).replace(/,/g, '').trim(); if (!v) return null; const n = +v; return isFinite(n) && n > 0 ? n : NaN; };
  const hexA = (hex, a) => { const h = hex.replace('#', ''); if (h.length !== 6) return hex; return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; };

  const toastEl = $('[data-toast]');
  let toastT = null;
  function toast(text, tone) {
    toastEl.textContent = text; toastEl.className = 'dk-toast' + (tone ? ' ' + tone : ''); toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 4200);
  }
  function showMsg(html) { msgEl.innerHTML = html; msgEl.hidden = false; }
  const loading = text => showMsg(`<div><div class="spin"></div>${esc(text)}</div>`);
  const hideMsg = () => { msgEl.hidden = true; };

  // ------------------------------------------------------------------ exchanges (public market data, from this browser)
  async function getJSON(url, ms = 15000) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j && (j.msg || j.message)) m = j.msg || j.message; } catch (e) { /* not json */ } const er = new Error(m); er.status = r.status; throw er; }
      return await r.json();
    } catch (e) { if (e.name === 'AbortError') throw new Error('the exchange did not answer in time'); throw e; } finally { clearTimeout(to); }
  }
  const EX = {
    binance: {
      name: 'Binance', cap: 1500,
      async klines(sym, iv, o) {
        const q = new URLSearchParams({ symbol: sym, interval: TF[iv].b, limit: String(Math.min(o.limit || 1000, 1500)) });
        if (o.start != null) q.set('startTime', String(o.start));
        if (o.end != null) q.set('endTime', String(o.end));
        const d = await getJSON('https://fapi.binance.com/fapi/v1/klines?' + q);
        return d.map(k => [k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
      },
      async symbols() {
        const d = await getJSON('https://fapi.binance.com/fapi/v1/exchangeInfo', 25000);
        const CAT = { COMMODITY: 'Commodity', EQUITY: 'Stock', KR_EQUITY: 'Stock', HK_EQUITY: 'Stock', CN_EQUITY: 'Stock', FX: 'Forex', PREMARKET: 'Pre-IPO', INDEX: 'Index' };
        return d.symbols.filter(s => (s.contractType === 'PERPETUAL' || s.contractType === 'TRADIFI_PERPETUAL') && s.quoteAsset === 'USDT' && s.status === 'TRADING')
          .map(s => ({ s: s.symbol, b: s.baseAsset, k: (s.filters.find(f => f.filterType === 'PRICE_FILTER') || {}).tickSize || '0.01', t0: s.onboardDate || 0,
            cat: s.contractType === 'TRADIFI_PERPETUAL' ? CAT[s.underlyingType] || 'TradFi' : '' }));
      },
      async tickers() {
        const d = await getJSON('https://fapi.binance.com/fapi/v1/ticker/24hr');
        const m = {}; for (const t of d) m[t.symbol] = { px: +t.lastPrice, chg: +t.priceChangePercent, vol: +t.quoteVolume }; return m;
      },
      async ticker(sym) { const t = await getJSON('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + sym); return { px: +t.lastPrice, chg: +t.priceChangePercent, vol: +t.quoteVolume }; },
      // Binance moved its futures market streams under /market: the old /ws/ address still connects but never sends
      socket(sym, iv, onK) {
        const ws = new WebSocket('wss://fstream.binance.com/market/ws/' + sym.toLowerCase() + '@kline_' + TF[iv].b);
        ws.onmessage = m => { try { const k = JSON.parse(m.data).k; if (k) onK([k.t, +k.o, +k.h, +k.l, +k.c, +k.v]); } catch (e) { /* skip */ } };
        return { ws, close() { ws.onclose = null; try { ws.close(); } catch (e) { /* closed */ } } };
      },
    },
    bybit: {
      name: 'Bybit', cap: 1000,
      async klines(sym, iv, o) {
        const lim = Math.min(o.limit || 1000, 1000);
        const q = new URLSearchParams({ category: 'linear', symbol: sym, interval: TF[iv].y, limit: String(lim) });
        if (o.start != null) { q.set('start', String(o.start)); q.set('end', String(o.end != null ? o.end : o.start + lim * TF[iv].ms - 1)); }
        else if (o.end != null) q.set('end', String(o.end));
        const d = await getJSON('https://api.bybit.com/v5/market/kline?' + q);
        if (d.retCode !== 0) throw new Error(d.retMsg || 'Bybit error');
        return d.result.list.map(k => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]).reverse();
      },
      async symbols() {
        let out = [], cursor = '';
        for (let i = 0; i < 6; i++) {
          const d = await getJSON('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), 25000);
          if (d.retCode !== 0) throw new Error(d.retMsg || 'Bybit error');
          out = out.concat(d.result.list.filter(s => s.quoteCoin === 'USDT' && s.status === 'Trading' && s.contractType === 'LinearPerpetual')
            .map(s => ({ s: s.symbol, b: s.baseCoin, k: s.priceFilter.tickSize, t0: +s.launchTime || 0, cat: { forex: 'Forex', stock: 'Stock', commodity: 'Commodity', ETF: 'ETF' }[s.symbolType] || '' })));
          cursor = d.result.nextPageCursor; if (!cursor) break;
        }
        return out;
      },
      async tickers() {
        const d = await getJSON('https://api.bybit.com/v5/market/tickers?category=linear');
        const m = {}; for (const t of d.result.list) m[t.symbol] = { px: +t.lastPrice, chg: +t.price24hPcnt * 100, vol: +t.turnover24h }; return m;
      },
      async ticker(sym) {
        const d = await getJSON('https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + sym); const t = d.result.list[0];
        return { px: +t.lastPrice, chg: +t.price24hPcnt * 100, vol: +t.turnover24h };
      },
      socket(sym, iv, onK) {
        const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
        let ping = null;
        ws.onopen = () => { ws.send(JSON.stringify({ op: 'subscribe', args: ['kline.' + TF[iv].y + '.' + sym] })); ping = setInterval(() => { try { ws.send('{"op":"ping"}'); } catch (e) { /* closed */ } }, 20000); };
        ws.onmessage = m => { try { const d = JSON.parse(m.data); if (d.topic && d.data) for (const k of d.data) onK([+k.start, +k.open, +k.high, +k.low, +k.close, +k.volume]); } catch (e) { /* skip */ } };
        ws.addEventListener('close', () => clearInterval(ping));
        return { ws, close() { clearInterval(ping); ws.onclose = null; try { ws.close(); } catch (e) { /* closed */ } } };
      },
    },
    // interbank FX (EURUSD, USDJPY… the prices TradingView's FX charts show) through our server, which reads Yahoo's FX
    // feed (site/fx.js; browsers can't call it). No socket: the live check below polls every ~10 s. Price only: no volume,
    // funding or open interest, and no real orders (the exchanges' FX perps are other, thinner markets).
    fx: {
      name: 'FX', cap: 1000, fx: true,
      async klines(sym, iv, o) {
        const q = new URLSearchParams({ s: sym, tf: iv, limit: String(Math.min(o.limit || 1000, 1000)) });
        if (o.start != null) q.set('start', String(o.start));
        if (o.end != null) q.set('end', String(o.end));
        return (await getJSON('/api/site/fx/klines?' + q, 25000)).k;
      },
      async symbols() { return (await getJSON('/api/site/fx/pairs')).pairs.map(p => ({ s: p.s, b: p.s, k: p.k, t0: 0, cat: 'Forex', name: p.name })); },
      async tickers() { return (await getJSON('/api/site/fx/tickers', 25000)).t; },
      async ticker(sym) { const t = (await tickers24('fx'))[sym]; if (!t) throw new Error('no price for ' + sym); return t; },
      socket() { throw new Error('FX has no live socket'); },
    },
  };
  for (const ex in EX) EX[ex].stream = (sym, iv, onK, o) => liveFeed(ex, sym, iv, onK, o || {});
  const api = ex => EX[ex || U.ex] || EX.binance;

  // Live candles: the exchange's socket with a REST check behind it. When the socket has been quiet for 10 s the newest
  // candles are fetched over REST — that keeps the chart moving and fills the hole a sleeping laptop, a lost connection
  // or a background tab leaves — and if REST had news the socket never sent, the socket is reopened. So a socket that
  // connects but never sends (what Binance's old stream address does since the move to /market) can't freeze the chart.
  // o.last = the chart's newest candle · o.gap() = too far behind for one REST call (reload the chart)
  function liveFeed(ex, sym, iv, onK, o) {
    const E = EX[ex], ms = TF[iv].ms;
    let sock = null, dead = false, heard = Date.now(), got = 0, opened = 0, busy = false, top = o.last || null;   // heard: last message or (re)open · got: last message
    const take = k => { if (!top || k[0] >= top[0]) top = k; onK(k); };
    function open() {
      if (dead) return;
      if (sock) sock.close();
      opened = heard = Date.now();
      let me = null;
      try { me = E.socket(sym, iv, k => { if (sock === me) { heard = got = Date.now(); take(k); } }); } catch (e) { sock = null; return; }
      sock = me;
      me.ws.addEventListener('close', () => { if (sock === me) sock = null; });
    }
    async function check(now) {
      if (dead || busy || document.hidden) return;
      if (!now && Date.now() - heard < 10000) return;
      busy = true;
      try {
        const behind = top ? Math.ceil((Date.now() - top[0]) / ms) + 1 : 1;
        if (behind > E.cap - 5 && o.gap) { o.gap(); return; }
        const ks = await E.klines(sym, iv, { limit: Math.max(2, Math.min(E.cap, behind + 1)) });
        if (dead) return;
        const was = top ? top.join() : '';
        for (const k of ks) if (!top || k[0] >= top[0]) take(k);
        const news = (top ? top.join() : '') !== was;
        if (!sock || (news && Date.now() - heard > 10000 && Date.now() - opened > 20000)) open();
      } catch (e) { /* tried again in 5 s */ } finally { busy = false; }
    }
    const vis = () => { if (!document.hidden) check(true); }, onl = () => check(true);
    document.addEventListener('visibilitychange', vis); window.addEventListener('online', onl);
    const timer = setInterval(() => check(false), 5000);
    open();
    return {
      close() { dead = true; clearInterval(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', onl); if (sock) sock.close(); sock = null; },
      check: () => check(true),
      get live() { return !!sock && Date.now() - got < 15000; },   // the socket itself is sending
    };
  }

  // candles with open time in [from, to), paged forward
  async function fetchRange(sym, iv, from, to, ex) {
    const ms = TF[iv].ms, A = api(ex), out = [];
    let t = from, guard = 0;
    while (t < to && guard++ < 80) {
      const lim = Math.max(1, Math.min(A.cap, Math.ceil((to - t) / ms)));
      const end = Math.min(to - 1, t + lim * ms - 1);
      const cs = await A.klines(sym, iv, { start: t, end, limit: lim });
      for (const c of cs) if (c[0] >= t && c[0] < to) out.push(c);
      t = end + 1;
    }
    return out;
  }
  // closed feed candles covering [from, to): res candles where aligned, 1m at the ragged ends. Each gets its length as [6].
  async function fetchSpan(sym, from, to, res, ex) {
    const rms = TF[res].ms, now = Date.now();
    to = Math.min(to, floorTo(now, MIN));
    if (to <= from) return [];
    const a = Math.min(to, ceilTo(from, rms)), b = Math.max(a, floorTo(to, rms)), out = [];
    if (from < a) for (const k of await fetchRange(sym, '1m', from, a, ex)) out.push(k.concat(MIN));
    if (a < b) for (const k of await fetchRange(sym, res, a, b, ex)) out.push(k.concat(rms));
    if (b < to) for (const k of await fetchRange(sym, '1m', b, to, ex)) out.push(k.concat(MIN));
    return out.filter(k => k[0] + k[6] <= now);
  }

  // coin lists, cached for the session
  const SYMS = {}, T24 = {};
  async function symList(ex) {
    if (SYMS[ex]) return SYMS[ex];
    const key = 'rd-syms-' + ex;
    try { const c = JSON.parse(sessionStorage.getItem(key)); if (c && Date.now() - c.at < 6 * HOUR && c.list.length) return (SYMS[ex] = c.list); } catch (e) { /* none */ }
    const list = await EX[ex].symbols();
    try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), list })); } catch (e) { /* too big or private */ }
    return (SYMS[ex] = list);
  }
  async function tickers24(ex) {
    if (T24[ex] && Date.now() - T24[ex].at < 60e3) return T24[ex].m;
    const m = await EX[ex].tickers(); T24[ex] = { at: Date.now(), m }; return m;
  }
  function applyMeta() {
    const m = (SYMS[U.ex] || []).find(s => s.s === U.sym);
    if (m) { TICK = +m.k || TICK; PREC = Math.min(10, decs(m.k)); } else if (S.bars.length) guessPrec(S.bars[S.bars.length - 1][4]);
    cs.applyOptions({ priceFormat: { type: 'price', precision: PREC, minMove: TICK } });
  }
  function guessPrec(px) { const d = Math.max(0, Math.min(8, 5 - Math.floor(Math.log10(Math.max(px, 1e-9))))); PREC = d; TICK = +Math.pow(10, -d).toFixed(d); }

  // ------------------------------------------------------------------ chart
  // a colour the stylesheets have not given yet (desk.css still loading) falls back to the theme's own value: an empty
  // background paints the canvas black, which on the light theme stayed until the theme button was pressed
  const FALL = { '--dk-bg': ['#0b0e14', '#ffffff'], '--up': ['#16c784', '#0d9f6e'], '--down': ['#f0475b', '#dc2f45'], '--muted': ['#727b8f', '#6b7486'], '--primary': ['#4f7cff', '#3461f5'], '--warn': ['#f5a524', '#c27c0e'], '--panel-3': ['#1a2130', '#eceff5'], '--grid': ['rgba(255,255,255,.045)', 'rgba(15,23,42,.05)'], '--dk-line': ['rgba(255,255,255,.075)', 'rgba(15,23,42,.1)'] };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || (FALL[n] ? FALL[n][document.documentElement.dataset.theme === 'light' ? 1 : 0] : '');
  const COL = {};
  const readCol = () => Object.assign(COL, { up: css('--up'), down: css('--down'), pri: css('--primary'), warn: css('--warn'), fvgDn: '#f97316', acc: css('--accent'), text: css('--text'), muted: css('--muted'), bg: css('--dk-bg'), panel: css('--panel') });
  readCol();
  // candle style (Indicators → Candles). Black / white: light bodies up, dark bodies down, with one ink for wicks and outlines
  const isLight = () => document.documentElement.dataset.theme === 'light';
  const candleOpts = () => {
    if (U.candles !== 'mono') return { upColor: COL.up, downColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down, borderVisible: false, priceLineColor: '' };
    const ink = isLight() ? '#131722' : '#d7dbe3';
    return { upColor: isLight() ? '#d9dce1' : '#eef0f4', downColor: isLight() ? '#131722' : '#2a2f3a', wickUpColor: ink, wickDownColor: ink, borderVisible: true, borderUpColor: ink, borderDownColor: ink, priceLineColor: ink };
  };
  // hi: a volume spike (Indicators → Volume → brighter bars), drawn strong
  const volColor = (up, hi) => hi ? (U.candles === 'mono' ? (isLight() ? 'rgba(19,23,34,.72)' : 'rgba(238,240,244,.62)') : hexA(up ? COL.up : COL.down, 0.8)) : (U.candles === 'mono' ? (isLight() ? (up ? 'rgba(19,23,34,.2)' : 'rgba(19,23,34,.42)') : (up ? 'rgba(238,240,244,.32)' : 'rgba(238,240,244,.14)')) : hexA(up ? COL.up : COL.down, 0.35));
  const box = $('[data-chart]');
  const chart = LC.createChart(box, {
    autoSize: true,
    layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted, fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace", fontSize: 11 },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    crosshair: { mode: LC.CrosshairMode.Normal, vertLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') }, horzLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') } },
    rightPriceScale: { borderColor: css('--dk-line'), scaleMargins: { top: 0.08, bottom: 0.18 } },
    timeScale: { borderColor: css('--dk-line'), timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 8, minBarSpacing: 1 },
  });
  const cs = chart.addSeries(LC.CandlestickSeries, Object.assign(candleOpts(), { priceLineStyle: LC.LineStyle.Dashed }));
  const vs = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  // the average volume of the last VMA candles, as a line over the bars (Indicators → Volume → average line)
  const VMA = 20, vma = chart.addSeries(LC.LineSeries, { priceScaleId: 'vol', color: 'rgba(160,168,184,.85)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  const EMAS = { ema20: [20, '#f5a524'], ema50: [50, '#4f7cff'], ema200: [200, '#c084fc'] };
  const es = {};
  for (const k in EMAS) es[k] = chart.addSeries(LC.LineSeries, { color: EMAS[k][1], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: !!U[k] });
  const markers = typeof LC.createSeriesMarkers === 'function' ? LC.createSeriesMarkers(cs, []) : null;

  function applyTheme() {
    colSeen = colKey();
    readCol();
    chart.applyOptions({
      layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      crosshair: { vertLine: { labelBackgroundColor: css('--panel-3') }, horzLine: { labelBackgroundColor: css('--panel-3') } },
      rightPriceScale: { borderColor: css('--dk-line') }, timeScale: { borderColor: css('--dk-line') },
    });
    cs.applyOptions(candleOpts());
    if (S.bars.length) volSet();
    setMarkers(); syncLines(); prim.req(); emit('theme');
  }
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // the colours come from the stylesheets: one that lands after this script (a fresh deploy, a slow network) re-colours
  // the chart when it arrives, not only when the theme button is pressed
  function colKey() { return ['--dk-bg', '--up', '--down', '--muted', '--grid', '--dk-line', '--panel-3', '--primary', '--warn'].map(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim()).join('|'); }
  let colSeen = colKey();
  function themeCheck() { if (colKey() !== colSeen) applyTheme(); }
  document.addEventListener('load', e => { if (e.target && e.target.tagName === 'LINK') themeCheck(); }, true);
  window.addEventListener('load', themeCheck); window.addEventListener('pageshow', themeCheck);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) themeCheck(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(themeCheck, () => {});
  for (const ms of [300, 1200, 3000, 8000]) setTimeout(themeCheck, ms);

  // ------------------------------------------------------------------ state
  const S = { bars: [], key: '', gen: 0,   // key: exchange | coin | timeframe of the candles in bars (U changes first, the candles after they load)
    lastPx: null, marks: {}, rpx: {}, loadingOld: false, noOld: false, ws: null, wsT: null, fellBack: false };
  const R = { on: false, clock: 0, buf: [], bufEnd: 0, res: '1m', playing: false, timer: null, busy: false, end: false, step: 'bar', speed: 800, gen: 0, fetching: null, back: [] };
  const toC = b => ({ time: b[0] / 1000, open: b[1], high: b[2], low: b[3], close: b[4] });
  // average volume of the VMA candles ending at i (incl) or just before it (a spike is judged against the candles before it)
  const volAvg = (i, incl) => { const e = incl ? i : i - 1, s = e - VMA + 1; if (s < 0 || e >= S.bars.length) return null; let t = 0; for (let j = s; j <= e; j++) t += S.bars[j][5]; return t / VMA; };
  const toV = (b, i) => { const a = U.volHi && i != null ? volAvg(i, false) : null; return { time: b[0] / 1000, value: b[5], color: volColor(b[4] >= b[1], a != null && a > 0 && b[5] >= 2 * a) }; };
  function volSet() {
    vs.setData(U.vol ? S.bars.map(toV) : []);
    const on = U.vol && U.volMa && U.ex !== 'fx', L = [];
    if (on) for (let i = VMA - 1; i < S.bars.length; i++) L.push({ time: S.bars[i][0] / 1000, value: volAvg(i, true) });
    vma.setData(L);
  }
  function volUpd(i) {
    if (!U.vol) return;
    vs.update(toV(S.bars[i], i));
    if (U.volMa && U.ex !== 'fx' && i >= VMA - 1) vma.update({ time: S.bars[i][0] / 1000, value: volAvg(i, true) });
  }
  const lastBar = () => S.bars[S.bars.length - 1];
  const nowT = () => R.on ? R.clock : Date.now();

  function emaArr(n) { return emaOf(S.bars, n); }
  function emaOf(B, n) {   // also the Compare chart's
    const out = [], k = 2 / (n + 1); let e = null, sum = 0;
    for (let i = 0; i < B.length; i++) {
      const c = B[i][4];
      if (i < n - 1) { sum += c; continue; }
      if (e == null) { sum += c; e = sum / n; } else e = c * k + e * (1 - k);
      out.push({ time: B[i][0] / 1000, value: e });
    }
    return out;
  }
  function setEMAs() { for (const k in EMAS) { es[k].applyOptions({ visible: !!U[k] }); es[k].setData(U[k] ? emaArr(EMAS[k][0]) : []); } }
  function setAll() {
    cs.setData(S.bars.map(toC)); volSet(); setEMAs();
    smcSchedule(); syncLines(); legend(); prim.req();
  }
  // a fresh coin / timeframe always re-fits the price axis: dragging the chart up or down switches the axis's auto-fit off,
  // and a new coin at another price would then sit outside the old range (a blank chart until a reload)
  function showRecent() { const n = S.bars.length; cs.priceScale().applyOptions({ autoScale: true }); chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (phone() ? 90 : 160)), to: n + 10 }); fitUI(); }
  // "Auto" on the price axis while the auto-fit is off (after a drag up / down or a squeeze of the axis): one click re-fits
  const fitBtn = document.createElement('button');
  fitBtn.type = 'button'; fitBtn.className = 'dk-autofit'; fitBtn.hidden = true; fitBtn.textContent = 'Auto';
  fitBtn.title = 'Fit the price axis to the candles again'; fitBtn.setAttribute('aria-label', 'Fit the price axis to the candles');
  box.appendChild(fitBtn);
  function fitUI() { let off = false; try { off = cs.priceScale().options().autoScale === false; } catch (e) { /* older chart */ } fitBtn.hidden = !off; }
  fitBtn.addEventListener('click', e => { e.stopPropagation(); cs.priceScale().applyOptions({ autoScale: true }); fitUI(); });
  for (const ev of ['pointerup', 'wheel', 'touchend', 'dblclick']) box.addEventListener(ev, () => setTimeout(fitUI, 30), { passive: true });

  // ------------------------------------------------------------------ live mode
  async function loadLive() {
    const g = ++S.gen; stopStream(); clearPick();
    loading(`Loading ${U.sym} ${U.tf}…`);
    try {
      const bars = await api().klines(U.sym, U.tf, { limit: 1000 });
      if (g !== S.gen) return;
      if (!bars.length) throw new Error(`No candles for ${U.sym} on ${api().name}.`);
      S.bars = bars; S.key = U.ex + '|' + U.sym + '|' + U.tf; S.noOld = false; S.lastPx = bars[bars.length - 1][4]; S.marks[U.sym] = S.lastPx;
      applyMeta(); setAll(); showRecent(); hideMsg(); headUI(); tickUI();
      startStream(g); emit('load');
    } catch (e) { if (g === S.gen) loadFailed(e, loadLive); }
  }
  function loadFailed(e, retry) {
    if (!S.fellBack && U.ex === 'binance' && (!e.status || e.status === 451 || e.status === 403)) {
      S.fellBack = true; U.ex = 'bybit'; saveUI(); headUI(); toast('Binance did not answer from here, so the desk is using Bybit data.'); retry(); return;
    }
    showMsg(`<div><b>Could not load the chart</b><br><span>${esc(e.message)}</span><br><button type="button" class="btn btn-secondary btn-sm" data-act="retry">Try again</button> <button type="button" class="btn btn-ghost btn-sm" data-act="search">Pick another coin</button></div>`);
    S.retry = retry;
  }
  function startStream(g) {
    stopStream();
    let h;
    try { h = api().stream(U.sym, U.tf, onLiveK, { last: lastBar(), gap: () => { if (g === S.gen && !R.on) loadLive(); } }); } catch (e) { return; }
    S.ws = h;
  }
  function stopStream() { if (S.ws) { S.ws.close(); S.ws = null; } }
  function onLiveK(k) {
    if (R.on) return;
    const last = lastBar(); if (!last) return;
    const prev = S.lastPx;
    if (k[0] === last[0]) S.bars[S.bars.length - 1] = k;
    else if (k[0] > last[0]) { S.bars.push(k); smcSchedule(); }
    else return;
    S.lastPx = k[4]; S.marks[U.sym] = k[4];
    cs.update(toC(k)); volUpd(S.bars.length - 1); emaLast();
    if (prev != null && prev !== k[4]) P.seg(U.sym, prev, k[4], Date.now(), 'live', true);
    tickUI();
  }
  function emaLast() { for (const k in EMAS) if (U[k]) { const a = emaArr(EMAS[k][0]); if (a.length) es[k].update(a[a.length - 1]); } }

  // older candles when the chart is scrolled to the left edge
  chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r && r.from < 30) loadOlder(); });
  async function loadOlder() {
    if (S.loadingOld || S.noOld || !S.bars.length || (R.on && R.busy)) return;
    S.loadingOld = true; const g = S.gen;
    try {
      const first = S.bars[0][0];
      const older = await api().klines(U.sym, U.tf, { end: first - 1, limit: 1000 });
      if (g !== S.gen) return;
      const add = older.filter(k => k[0] < first);
      if (!add.length) { S.noOld = true; return; }
      const r = chart.timeScale().getVisibleLogicalRange();
      S.bars = add.concat(S.bars);
      setAll();
      if (r) chart.timeScale().setVisibleLogicalRange({ from: r.from + add.length, to: r.to + add.length });
    } catch (e) { /* tried again on the next scroll */ } finally { S.loadingOld = false; }
  }

  // ------------------------------------------------------------------ replay
  function aggInto(k) {
    const b = bucket(k[0], U.tf), last = lastBar();
    if (last && last[0] === b) { last[2] = Math.max(last[2], k[2]); last[3] = Math.min(last[3], k[3]); last[4] = k[4]; last[5] += k[5]; return S.bars.length - 1; }
    S.bars.push([b, k[1], k[2], k[3], k[4], k[5]]); return S.bars.length - 1;
  }
  function saveR() { store.set('rd-replay-v1', R.on ? { sym: U.sym, ex: U.ex, clock: R.clock, step: R.step, speed: R.speed, sid: R.sid } : null); }
  // a replay session = one replay start (a new start is a new session); its trades carry its id (the journal groups them)
  function newSession() {
    R.sid = newId();
    A.sess.unshift({ id: R.sid, wt: Date.now(), at: R.clock, sym: U.sym, ex: U.ex, tf: U.tf });
    if (A.sess.length > 300) A.sess.length = 300;
    saveAcctNow(); emit('session', R.sid);
  }
  let saveRT = 0;
  const saveRSoon = () => { if (Date.now() - saveRT > 2000) { saveRT = Date.now(); saveR(); } };

  // the latest replay start: 2 candles of the replay feed ago (1D plays 15m candles into the forming day, so today works)
  const rpMin = () => 2 * TF[resOf(U.tf)].ms;
  async function enterReplay(t) {
    if (!isFinite(t) || t > Date.now() - rpMin()) { toast('Pick a moment in the past.'); return; }
    closeModals(); pausePlay(); clearPick();
    if (R.on) P.closeMode('replay', 'Replay restarted');
    R.on = true; R.clock = bucket(t, U.tf); TLF.replay = {}; newSession();
    stopStream(); modeUI(); saveR();
    await rebuildReplay();
  }
  async function rebuildReplay() {
    const g = ++S.gen; R.gen = g; pausePlay();
    R.res = resOf(U.tf); R.buf = []; R.bufEnd = R.clock; R.end = false; R.fetching = null; R.back = [];
    stepLabel();
    loading(`Rewinding ${U.sym} to ${tnice(R.clock)}…`);
    try {
      const b0 = bucket(R.clock, U.tf);
      const hist = await api().klines(U.sym, U.tf, { end: b0 - 1, limit: 1000 });
      if (g !== S.gen) return;
      const span = R.clock > b0 ? await fetchSpan(U.sym, b0, R.clock, R.res) : [];
      if (g !== S.gen) return;
      S.bars = hist.filter(k => k[0] < b0); S.key = U.ex + '|' + U.sym + '|' + U.tf; S.noOld = false;
      for (const k of span) aggInto(k);
      if (!S.bars.length) throw new Error(`No candles for ${U.sym} before ${tnice(R.clock)} — it was probably not listed yet. Pick a later start.`);
      S.lastPx = lastBar()[4]; S.rpx[U.sym] = S.lastPx;
      applyMeta(); setAll(); showRecent(); hideMsg(); clockUI(); headUI(); tickUI(); saveR(); emit('load');
      ensureBuf(R.clock + 60 * TF[U.tf].ms).catch(() => { /* step retries */ });
    } catch (e) { if (g === S.gen) loadFailed(e, rebuildReplay); }
  }
  function ensureBuf(until) {
    if (R.fetching) return R.fetching.then(() => (R.on && R.bufEnd < until && !R.end ? ensureBuf(until) : null));
    const g = R.gen;
    R.fetching = (async () => {
      while (R.on && g === R.gen && R.bufEnd < until && !R.end) {
        const rms = TF[R.res].ms, lim = floorTo(Date.now(), MIN);
        const to = Math.min(ceilTo(R.bufEnd + 1, rms) + 700 * rms, lim);
        if (to <= R.bufEnd) { R.end = true; break; }
        const ks = await fetchSpan(U.sym, R.bufEnd, to, R.res);
        if (g !== R.gen) return;
        for (const k of ks) if (k[0] >= R.bufEnd) R.buf.push(k);
        R.bufEnd = to;
        if (to >= lim) R.end = true;
      }
    })().finally(() => { R.fetching = null; });
    return R.fetching;
  }
  async function step() {
    if (!R.on || R.busy) return;
    R.busy = true;
    const g = R.gen;
    try {
      if (!R.buf.length && !R.end) await ensureBuf(R.clock + TF[R.res].ms);
      if (g !== R.gen) return;
      const target = R.step === 'small' ? (R.buf.length ? R.buf[0][0] + R.buf[0][6] : R.clock + TF[R.res].ms) : nextB(R.clock, U.tf);
      await ensureBuf(target);
      if (g !== R.gen) return;
      const n0 = S.bars.length; let changed = Infinity;
      const lb = lastBar(), snap = { clock: R.clock, last: lb ? lb.slice() : null, took: [], lastPx: S.lastPx, paper: paperSnap() };
      while (R.buf.length && R.buf[0][0] < target) {
        const k = R.buf.shift(); snap.took.push(k);
        if (k[0] < R.clock) continue;
        changed = Math.min(changed, aggInto(k));
        S.lastPx = k[4]; S.rpx[U.sym] = k[4];
        R.clock = k[0] + k[6];
        P.candle(U.sym, k, 'replay');
      }
      if (R.bufEnd >= target) R.clock = Math.max(R.clock, target);
      if (R.clock !== snap.clock) { R.back.push(snap); if (R.back.length > 3000) R.back.shift(); }
      if (changed !== Infinity) {
        for (let i = changed; i < S.bars.length; i++) { cs.update(toC(S.bars[i])); volUpd(i); }
        if (S.bars.length !== n0 || R.step !== 'small') smcSchedule(); else smcSchedule();
        emaLast();
      } else if (R.end && !R.buf.length) { pausePlay(); toast("You've reached the present. Exit the replay to trade the live market."); }
      clockUI(); tickUI(); if (R.playing) saveRSoon(); else saveR();
      if (R.buf.length < 300 && !R.end) ensureBuf(R.bufEnd + 1).catch(() => { /* next step retries */ });
    } catch (e) { pausePlay(); toast('Could not load the next candles: ' + e.message, 'down'); } finally { R.busy = false; }
  }
  // ---- one step back. Each forward step remembered what it changed (the feed candles it took, the candle it grew,
  // the open replay trades), so the chart goes back exactly as it was. Replay trades: a CLOSED trade is final — it stays
  // in the journal with its result, a step back never opens it again or takes its result away (you rewind to look at
  // it). Open ones go back as they were: a trade opened after that moment is taken back (its fee too) and its order, if
  // it came from one, is working again; stops / targets moved since go back. With nothing remembered (the replay's
  // first candle, or after a reload) the chart goes back one candle by loading it again — only while no replay trade
  // is open, since there is nothing to put those back to.
  function paperSnap() {
    const cp = a => JSON.parse(JSON.stringify(a.filter(x => x.mode === 'replay')));
    return { pos: cp(A.pos), ord: cp(A.ord) };
  }
  function paperBack(s) {
    const key = () => JSON.stringify([A.pos.filter(x => x.mode === 'replay').map(p => [p.id, p.sl, p.tp]), A.ord.filter(x => x.mode === 'replay').map(o => [o.id, o.price, o.sl, o.tp])]);
    const was = key(), then = new Map(s.pos.map(p => [p.id, p]));
    const pos = [];
    for (const p of A.pos) {
      if (p.mode !== 'replay') { pos.push(p); continue; }
      const old = then.get(p.id);
      if (!old) { A.bal += p.fee || 0; continue; }   // opened after that moment: taken back, fee back
      pos.push(JSON.parse(JSON.stringify(old)));
    }
    // an order comes back unless it became a trade that is still here or already closed
    const used = new Set(pos.map(p => p.oid).concat(A.hist.map(h => h.oid)).filter(Boolean));
    A.ord = A.ord.filter(o => o.mode !== 'replay').concat(JSON.parse(JSON.stringify(s.ord.filter(o => !used.has(o.id)))));
    A.pos = pos;
    const moved = was !== key();
    changed();
    return moved;
  }
  async function stepBack() {
    if (!R.on) return;
    if (R.playing) pausePlay();
    if (R.busy) { if (!R.backWait) { R.backWait = true; setTimeout(() => { R.backWait = false; stepBack(); }, 60); } return; }
    const s = R.back.pop();
    if (s) {
      R.buf = s.took.concat(R.buf);
      if (s.last) {   // drop the candles the step added, put back the one it grew (found by time: older candles may have loaded in front)
        let j = S.bars.length - 1; while (j >= 0 && S.bars[j][0] > s.last[0]) j--;
        S.bars.length = j + 1; if (j >= 0 && S.bars[j][0] === s.last[0]) S.bars[j] = s.last;
      }
      R.clock = s.clock; S.lastPx = s.lastPx; S.rpx[U.sym] = s.lastPx;
      const undid = paperBack(s.paper);
      setAll(); clockUI(); tickUI(); saveR();
      if (undid) toast(`Back to ${tnice(R.clock)} · open replay trades are as they were then (closed ones stay in your journal)`);
      return;
    }
    if (A.pos.some(p => p.mode === 'replay') || A.ord.some(o => o.mode === 'replay')) { toast('Can\'t go further back with a replay trade open. Close it, or choose an earlier start.', 'down'); return; }
    const t = bucket(R.clock - 1, U.tf);
    if (!S.bars.length || t <= S.bars[0][0]) { toast('No older candles here. Choose an earlier start.', 'down'); return; }
    R.busy = true; const g = R.gen;
    try {
      const ks = await fetchSpan(U.sym, t, R.clock, R.res);
      if (g !== R.gen) return;
      R.buf = ks.filter(k => k[0] >= t && k[0] < R.clock).concat(R.buf);
      while (S.bars.length && S.bars[S.bars.length - 1][0] >= t) S.bars.pop();
      R.clock = t; S.lastPx = lastBar()[4]; S.rpx[U.sym] = S.lastPx; R.end = false;
      setAll(); clockUI(); tickUI(); saveR();
    } catch (e) { toast('Could not load the earlier candles: ' + e.message, 'down'); } finally { R.busy = false; }
  }
  function play() { if (!R.on) return; R.playing = true; playUI(); loop(); }
  async function loop() {
    if (!R.playing) return;
    const t0 = performance.now();
    await step();
    if (!R.playing) return;
    R.timer = setTimeout(loop, Math.max(0, R.speed - (performance.now() - t0)));
  }
  function pausePlay() { R.playing = false; clearTimeout(R.timer); playUI(); if (R.on) saveR(); }
  function exitReplay() {
    pausePlay(); P.closeMode('replay', 'Replay ended');
    R.on = false; R.gen++; R.buf = []; saveR(); modeUI(); R.sid = null; loadLive();
  }

  // ------------------------------------------------------------------ paper account (this browser only)
  // hist: closed trades, newest first (the journal; the newest HIST_MAX are kept here — trim holds the P&L of older ones
  // so the balance stays right). sess: replay sessions, newest first. epoch: which journal on the server this is (null =
  // never synced; a reset starts a new one).
  const HIST_MAX = 2000;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const freshAcct = () => ({ v: 1, start: START_BAL, bal: START_BAL, pos: [], ord: [], hist: [], seq: 1, seen: {}, sess: [], epoch: null, trim: 0, unsent: [] });
  // the balance from the journal: start + every closed trade's net P&L − the entry fees of the open ones
  const acctBal = (a, trim = a.trim || 0) => a.start + trim + a.hist.reduce((x, h) => x + (+h.pnl || 0), 0) - a.pos.reduce((x, p) => x + (p.fee || 0), 0);
  function acctFix(a) {   // accounts saved before the journal
    if (!Array.isArray(a.sess)) a.sess = [];
    if (!Array.isArray(a.unsent)) a.unsent = [];
    if (a.epoch === undefined) a.epoch = null;
    for (const h of a.hist) if (!h.uid) h.uid = 'h' + h.id + '-' + (h.t1 || 0);
    a.hist.forEach((h, i) => { if (!Number.isFinite(h.wt)) h.wt = a.hist.length - i; });   // no wall-clock time: kept in order, counted as old
    for (const p of a.pos) if (!p.uid) p.uid = newId();
    if (typeof a.trim !== 'number' || !isFinite(a.trim)) a.trim = a.bal - acctBal(a, 0);   // what the old 500-trade cap left out
    return a;
  }
  let A = store.get('rd-acct-v1', null);
  if (!A || A.v !== 1) A = freshAcct();
  acctFix(A);
  let saveAT = null;
  const saveAcct = () => { clearTimeout(saveAT); saveAT = setTimeout(() => store.set('rd-acct-v1', A), 300); };
  const saveAcctNow = () => { clearTimeout(saveAT); saveAT = null; store.set('rd-acct-v1', A); };
  const mode = () => (R.on ? 'replay' : 'live');
  const markOf = it => (it.mode === 'replay' ? S.rpx[it.sym] : S.marks[it.sym]);
  const liqOf = (side, entry, lev) => (side === 1 ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR));
  const upnl = p => { const m = markOf(p); return m == null ? 0 : p.side * (m - p.entry) * p.qty; };
  const used = () => A.pos.reduce((s, p) => s + p.margin, 0) + A.ord.reduce((s, o) => s + o.margin, 0);
  const equity = () => A.bal + A.pos.reduce((s, p) => s + upnl(p), 0);
  const avail = () => Math.max(0, A.bal - used());

  const P = {
    open(o, px, t, maker) {
      const notional = o.margin * o.lev, qty = notional / px, fee = notional * (maker ? FEE_M : FEE_T);
      A.bal -= fee; if (o.mode === 'replay') A.rbal = (A.rbal || 0) - fee;
      const p = { id: A.seq++, uid: newId(), sym: o.sym, ex: o.ex, side: o.side, qty, entry: px, lev: o.lev, margin: o.margin, sl: o.sl || null, tp: o.tp || null,
        t, mode: o.mode, fee, risk: o.sl ? Math.abs(px - o.sl) * qty + fee : null, liq: liqOf(o.side, px, o.lev),
        tf: o.tf || U.tf, sid: o.mode === 'replay' ? R.sid || null : null, wt0: Date.now(), sl0: o.sl || null, tp0: o.tp || null, hi: px, lo: px, oid: o.oid || null };
      A.pos.push(p);
      if (o.mode === 'live') { const key = p.sym + '|' + p.ex; if (!A.seen[key]) A.seen[key] = floorTo(Date.now(), MIN); }
      changed();
      return p;
    },
    close(p, px, t, why) {
      const i = A.pos.indexOf(p); if (i < 0) return;
      A.pos.splice(i, 1);
      let pnl = p.side * (px - p.entry) * p.qty, fee = 0;
      if (why === 'Liquidated') pnl = -p.margin; else fee = px * p.qty * (why === 'Target' ? FEE_M : FEE_T);
      A.bal += pnl - fee; if (p.mode === 'replay') A.rbal = (A.rbal || 0) + pnl - fee;
      const net = pnl - fee - p.fee;
      P.ext1(p, px, px);
      const h = { id: p.id, uid: p.uid || newId(), sym: p.sym, ex: p.ex, side: p.side, lev: p.lev, qty: p.qty, margin: p.margin, entry: p.entry, exit: px, pnl: net,
        r: p.risk ? net / p.risk : null, why, t0: p.t, t1: t, mode: p.mode, tf: p.tf || null, sid: p.sid || null, wt0: p.wt0 || null, wt: Date.now(),
        sl: p.sl, tp: p.tp, sl0: p.sl0 !== undefined ? p.sl0 : p.sl, tp0: p.tp0 !== undefined ? p.tp0 : p.tp, hi: p.hi, lo: p.lo, risk: p.risk || null, fee: p.fee + fee, oid: p.oid || null };
      A.hist.unshift(h); A.unsent.push(h.uid);
      if (A.hist.length > HIST_MAX) for (const x of A.hist.splice(HIST_MAX)) A.trim += +x.pnl || 0;
      if (A.unsent.length > HIST_MAX) A.unsent.splice(0, A.unsent.length - HIST_MAX);
      const label = `${coin(p.sym)} ${p.side === 1 ? 'long' : 'short'}`;
      if (!(X.ev.closed && X.ev.closed.length)) toast(`${why === 'Target' ? 'Target hit' : why === 'Stop' ? 'Stop hit' : why === 'Liquidated' ? 'Liquidated' : 'Closed'}: ${label} ${money(net, true)}${p.risk ? ' (' + fr(net / p.risk) + ')' : ''}`, net >= 0 ? 'up' : 'down');
      changed(); saveAcctNow(); emit('closed', h);
    },
    fill(o, px, t) {
      const i = A.ord.indexOf(o); if (i < 0) return;
      A.ord.splice(i, 1);
      P.open(Object.assign({}, o, { oid: o.id }), px, t, o.kind !== 'stop');   // a stop entry fills as a market order (taker fee)
      toast(`${o.kind === 'stop' ? 'Stop entry' : 'Limit'} filled: ${coin(o.sym)} ${o.side === 1 ? 'long' : 'short'} at ${fp(px)}`);
    },
    // a price path inside one candle: up candles dip first (o→l→h→c), down candles spike first (o→h→l→c)
    candle(sym, k, md) {
      const pts = k[4] >= k[1] ? [k[1], k[3], k[2], k[4]] : [k[1], k[2], k[3], k[4]];
      for (let i = 1; i < pts.length; i++) P.seg(sym, pts[i - 1], pts[i], k[0], md, false);
    },
    // walk price from a to b; fire whatever the path reaches first, then carry on from that price
    seg(sym, a, b, t, md, tick) {
      for (let guard = 0; guard < 40; guard++) {
        const ev = P.next(sym, a, b, t, md, tick);
        for (const p of A.pos) if (p.sym === sym && p.mode === md && (tick || p.t <= t)) P.ext1(p, a, ev ? ev.px : b);   // best / worst price while open
        if (!ev) return;
        ev.run(t); a = ev.px;
      }
    },
    ext1(p, a, b) { const h = Math.max(a, b), l = Math.min(a, b); if (!(p.hi >= h)) p.hi = h; if (!(p.lo <= l)) p.lo = l; },
    next(sym, a, b, t, md, tick) {
      const lo = Math.min(a, b), hi = Math.max(a, b), up = b >= a;
      let best = null;
      const take = (at, px, run) => { const d = Math.max(0, up ? at - a : a - at); if (!best || d < best.d) best = { d, px, run }; };
      for (const o of A.ord) {
        if (o.sym !== sym || o.mode !== md || (!tick && o.t > t)) continue;
        if (o.kind === 'stop') {   // buy stop: price rises to it · sell stop: price falls to it
          if (o.side === 1 ? hi >= o.price : lo <= o.price) { const px = o.side === 1 ? Math.max(a, o.price) : Math.min(a, o.price); take(o.price, px, tt => P.fill(o, px, tt)); }
        } else if (o.side === 1 ? lo <= o.price : hi >= o.price) { const px = o.side === 1 ? Math.min(a, o.price) : Math.max(a, o.price); take(o.price, px, tt => P.fill(o, px, tt)); }
      }
      for (const p of A.pos) {
        if (p.sym !== sym || p.mode !== md || (!tick && p.t > t)) continue;
        const L = p.side === 1;
        if (L ? lo <= p.liq : hi >= p.liq) take(p.liq, p.liq, tt => P.close(p, p.liq, tt, 'Liquidated'));
        if (p.sl != null && (L ? lo <= p.sl : hi >= p.sl)) { const px = L ? Math.min(a, p.sl) : Math.max(a, p.sl); take(p.sl, px, tt => P.close(p, px, tt, 'Stop')); }
        if (p.tp != null && (L ? hi >= p.tp : lo <= p.tp)) { const px = L ? Math.max(a, p.tp) : Math.min(a, p.tp); take(p.tp, px, tt => P.close(p, px, tt, 'Target')); }
      }
      return best;
    },
    closeMode(md, why) {
      for (const p of A.pos.filter(x => x.mode === md)) { const m = markOf(p); P.close(p, m != null ? m : p.entry, md === 'replay' ? R.clock : Date.now(), why); }
      const n = A.ord.length; A.ord = A.ord.filter(o => o.mode !== md); if (A.ord.length !== n) changed();
    },
  };
  let chQ = false;
  function changed() { saveAcct(); if (!chQ) { chQ = true; requestAnimationFrame(() => { chQ = false; renderAll(); }); } }

  // live paper trades: catch up on 1-minute candles for every coin with live positions / orders (also covers time away)
  let polling = false;
  async function pollLive() {
    if (polling || document.hidden) return;
    const keys = new Set();
    for (const p of A.pos) if (p.mode === 'live') keys.add(p.sym + '|' + (p.ex || 'binance'));
    for (const o of A.ord) if (o.mode === 'live') keys.add(o.sym + '|' + (o.ex || 'binance'));
    if (!keys.size) return;
    polling = true;
    try {
      for (const key of keys) {
        const [sym, ex] = key.split('|'), now = Date.now();
        const from = Math.max(A.seen[key] || floorTo(now, MIN), now - 3 * DAY);
        let ks;
        try { ks = await fetchRange(sym, '1m', floorTo(from, MIN), now + MIN, ex); } catch (e) { continue; }
        for (const k of ks) {
          P.candle(sym, k.concat(MIN), 'live');
          if (k[0] + MIN <= Date.now()) A.seen[key] = k[0] + MIN;
        }
        if (ks.length && (sym !== U.sym || R.on)) S.marks[sym] = ks[ks.length - 1][4];
      }
      saveAcct(); tickUI();
    } finally { polling = false; }
  }

  // ------------------------------------------------------------------ order ticket
  const T = { side: 1, type: 'market' };
  const tk = $('[data-ticket]');
  const fld = n => tk.querySelector(`[data-f="${n}"]`);
  fld('margin').value = U.margin; fld('lev').value = U.lev;
  const readT = () => ({ side: T.side, type: T.type, price: num(fld('price').value), margin: num(fld('margin').value), lev: Math.max(1, Math.min(50, +fld('lev').value || 1)), sl: num(fld('sl').value), tp: num(fld('tp').value) });
  function ticketCheck() {
    const o = readT(), px = S.lastPx;
    const entry = o.type === 'limit' ? o.price : px;
    const errs = {};
    if (o.type === 'limit' && (o.price == null || isNaN(o.price))) errs.price = 'Enter the limit price';
    if (o.margin == null || isNaN(o.margin)) errs.margin = 'Enter the margin';
    else if (o.margin > avail() + 1e-9) errs.margin = `Only ${money(avail())} is free`;
    if (entry && o.sl != null && !isNaN(o.sl) && (o.side === 1 ? o.sl >= entry : o.sl <= entry)) errs.sl = o.side === 1 ? 'A long needs its stop below the entry' : 'A short needs its stop above the entry';
    if (entry && o.tp != null && !isNaN(o.tp) && (o.side === 1 ? o.tp <= entry : o.tp >= entry)) errs.tp = o.side === 1 ? 'A long needs its target above the entry' : 'A short needs its target below the entry';
    if (isNaN(o.sl)) errs.sl = 'Not a price'; if (isNaN(o.tp)) errs.tp = 'Not a price';
    if (entry && o.lev && o.sl && !errs.sl) { const lq = liqOf(o.side, entry, o.lev); if (o.side === 1 ? o.sl <= lq : o.sl >= lq) errs.sl = `Liquidation (${fp(lq)}) comes before this stop — lower the leverage`; }
    return { o, entry, errs };
  }
  function renderTicket() {
    const { o, entry, errs } = ticketCheck();
    $('[data-lev-v]').textContent = o.lev + '×';
    $$('[data-side]', tk).forEach(b => b.classList.toggle('on', +b.dataset.side === T.side));
    $$('[data-otype]', tk).forEach(b => b.classList.toggle('on', b.dataset.otype === T.type));
    $('[data-limit-row]', tk).hidden = T.type !== 'limit';
    for (const f of ['price', 'margin', 'sl', 'tp']) fld(f).classList.toggle('bad', !!errs[f] && fld(f).value !== '');
    const notional = (o.margin || 0) * o.lev, qty = entry ? notional / entry : 0, fee = notional * (T.type === 'limit' ? FEE_M : FEE_T);
    const riskD = entry && o.sl && !errs.sl ? Math.abs(entry - o.sl) * qty + fee * 2 : null;
    const rewD = entry && o.tp && !errs.tp ? Math.abs(o.tp - entry) * qty - fee * 2 : null;
    const nsl = $('[data-n="sl"]', tk), ntp = $('[data-n="tp"]', tk);
    nsl.textContent = errs.sl || (entry && o.sl ? `${pct((o.sl / entry - 1) * 100)} from entry · lose ${money(riskD)} (${(riskD / Math.max(1, A.bal) * 100).toFixed(2)}% of balance)` : '');
    nsl.style.color = errs.sl ? 'var(--down)' : '';
    ntp.textContent = errs.tp || (entry && o.tp ? `${pct((o.tp / entry - 1) * 100)} from entry · make ${money(rewD)}${riskD ? ` · ${(rewD / riskD).toFixed(2)}R` : ''}` : '');
    ntp.style.color = errs.tp ? 'var(--down)' : '';
    const sum = $('[data-sum]', tk);
    sum.innerHTML = `<dt>${T.type === 'limit' ? 'Limit price' : 'Price now'}</dt><dd>${fp(entry)}</dd>
      <dt>Position</dt><dd>${entry ? fq(qty) + ' ' + esc(coin(U.sym)) : '—'}</dd><dt>Value</dt><dd>${money(notional)}</dd>
      <dt>Liquidation</dt><dd class="warn">${entry ? fp(liqOf(o.side, entry, o.lev)) : '—'}</dd><dt>Fee <span style="font-size:10px">(${T.type === 'limit' ? '0.02' : '0.05'}%)</span></dt><dd>${money(fee)}</dd>`;
    const go = $('[data-place]', tk);
    go.className = 'tk2-go ' + (T.side === 1 ? 'up' : 'down');
    go.textContent = `${T.type === 'limit' ? (T.side === 1 ? 'Place buy limit' : 'Place sell limit') : (T.side === 1 ? 'Buy / Long' : 'Sell / Short')} ${coin(U.sym)}${R.on ? ' · replay' : ''}`;
  }
  function place() {
    const { o, errs } = ticketCheck(), px = S.lastPx, err = $('[data-tkerr]');
    const first = Object.values(errs)[0];
    if (!px) { err.textContent = 'Wait for the chart to load.'; err.hidden = false; return; }
    if (first) { err.textContent = first; err.hidden = false; return; }
    err.hidden = true;
    U.margin = o.margin; U.lev = o.lev; saveUI();
    const base = { sym: U.sym, ex: U.ex, side: o.side, margin: o.margin, lev: o.lev, sl: o.sl || null, tp: o.tp || null, mode: mode() };
    const t = nowT();
    const marketable = o.type === 'limit' && (o.side === 1 ? o.price >= px : o.price <= px);
    if (o.type === 'market' || marketable) {
      const p = P.open(base, px, t, false);
      toast(`Paper ${o.side === 1 ? 'long' : 'short'} opened: ${fq(p.qty)} ${coin(U.sym)} at ${fp(px)}${marketable ? ' (the limit was through the price, so it filled now)' : ''}`, 'up');
    } else {
      A.ord.push(Object.assign(base, { id: A.seq++, price: o.price, t }));
      if (base.mode === 'live') { const key = U.sym + '|' + U.ex; if (!A.seen[key]) A.seen[key] = floorTo(Date.now(), MIN); }
      changed(); toast(`Limit ${o.side === 1 ? 'buy' : 'sell'} placed at ${fp(o.price)}`);
    }
    fld('sl').value = ''; fld('tp').value = ''; if (o.type === 'limit') fld('price').value = '';
    renderTicket(); syncLines();
    if (phone()) closeSheets();
  }

  function renderAcct() {
    const eq = equity(), u = A.pos.reduce((s, p) => s + upnl(p), 0), chg = eq - A.start;
    $('[data-acct]').innerHTML = `<h3><span>Paper account</span><button type="button" data-act="reset">${A._armed ? 'Click again to reset' : 'Reset'}</button></h3>
      <div class="acct-eq">${money(eq)}</div>
      <dl><dt>Since start</dt><dd class="${chg >= 0 ? 'up' : 'down'}">${money(chg, true)} (${pct(chg / A.start * 100)})</dd>
      <dt>Open P&amp;L</dt><dd class="${u >= 0 ? 'up' : 'down'}">${money(u, true)}</dd><dt>Balance</dt><dd>${money(A.bal)}</dd>
      <dt>Margin in use</dt><dd>${money(used())}</dd><dt>Free</dt><dd>${money(avail())}</dd></dl>
      <p class="acct-note">${X.acctNote ? X.acctNote() : 'Practice money only, saved in this browser.'} Fees 0.05% market / 0.02% limit.</p>`;
  }

  // ------------------------------------------------------------------ positions / orders / history / stats
  let BTAB = 'pos', bottomAt = 0;
  const sd = s => `<span class="sd ${s === 1 ? 'up' : 'down'}">${s === 1 ? 'LONG' : 'SHORT'}</span>`;
  const rtag = it => (it.mode === 'replay' ? '<span class="tag-r">REPLAY</span>' : '');
  // the furthest a closed trade went its way while open: in R when it had a stop, else in %
  const bestMove = h => (h.hi == null || h.lo == null ? null : h.side === 1 ? h.hi - h.entry : h.entry - h.lo);
  const bestOf = h => { const m = bestMove(h); if (m == null) return '—'; return h.risk ? fr(m * h.qty / h.risk) : pct(m / h.entry * 100); };
  function renderBottom(soft) {
    if (soft && Date.now() - bottomAt < 300) return;
    bottomAt = Date.now();
    const body = $('[data-bbody]');
    if (body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // inline edit in progress
    $$('[data-cnt="pos"]').forEach(e => { e.textContent = A.pos.length; });
    $$('[data-cnt="ord"]').forEach(e => { e.textContent = A.ord.length; });
    const pm = $('[data-cnt="pos-m"]'); pm.hidden = !A.pos.length; pm.textContent = A.pos.length;
    $$('[data-btab]').forEach(b => b.classList.toggle('on', b.dataset.btab === BTAB));
    if (X.bottom[BTAB]) { const h = X.bottom[BTAB](soft); if (h != null) body.innerHTML = h; return; }
    let html = '';
    if (BTAB === 'pos') {
      if (!A.pos.length) html = `<div class="pt-empty">No open positions.${R.on ? ' Place a trade from the panel — it plays out as the replay moves.' : ' Place one from the Trade panel, or start a replay.'}</div>`;
      else {
        const rows = A.pos.map(p => {
          const m = markOf(p), u = upnl(p), roe = u / p.margin * 100, r = p.risk ? u / p.risk : null, d = Math.max(2, Math.min(10, decs(String(rt(p.entry))) || PREC));
          return { p, m, u, roe, r, d };
        });
        html = `<table class="pt"><thead><tr><th>Coin</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>Stop</th><th>Target</th><th>P&amp;L</th><th>R</th><th></th></tr></thead><tbody>${rows.map(({ p, m, u, roe, r }) => `
          <tr data-goto="${esc(p.sym)}"><td>${sd(p.side)}<b>${esc(coin(p.sym))}</b> <span class="muted">${p.lev}×</span>${rtag(p)}</td><td>${fq(p.qty)} <span class="muted">${money(p.qty * (m || p.entry))}</span></td>
          <td>${fp(p.entry)}</td><td>${fp(m)}</td><td class="muted">${fp(p.liq)}</td>
          <td class="down" data-edit="sl" data-id="${p.id}" title="Click to change">${p.sl ? fp(p.sl) : '<span class="muted">add</span>'}</td>
          <td class="up" data-edit="tp" data-id="${p.id}" title="Click to change">${p.tp ? fp(p.tp) : '<span class="muted">add</span>'}</td>
          <td class="${u >= 0 ? 'up' : 'down'}">${money(u, true)} <span class="muted">${pct(roe)}</span></td><td class="${(r || 0) >= 0 ? 'up' : 'down'}">${fr(r)}</td>
          <td><span class="acts"><button type="button" data-be="${p.id}" title="Move the stop to the entry price">Stop to BE</button><button type="button" class="x" data-close="${p.id}">Close</button></span></td></tr>`).join('')}</tbody></table>
          <div class="p-cards">${rows.map(({ p, m, u, roe, r }) => `<div class="pc"><div class="pc-h"><span>${sd(p.side)}<b>${esc(coin(p.sym))}</b> <span class="muted">${p.lev}×</span>${rtag(p)}</span><span class="pc-pnl ${u >= 0 ? 'up' : 'down'}">${money(u, true)}</span></div>
            <dl><div><dt>Entry</dt><dd>${fp(p.entry)}</dd></div><div><dt>Mark</dt><dd>${fp(m)}</dd></div><div><dt>ROE</dt><dd class="${roe >= 0 ? 'up' : 'down'}">${pct(roe)}</dd></div>
            <div><dt>Stop</dt><dd class="down" data-edit="sl" data-id="${p.id}">${p.sl ? fp(p.sl) : 'add'}</dd></div><div><dt>Target</dt><dd class="up" data-edit="tp" data-id="${p.id}">${p.tp ? fp(p.tp) : 'add'}</dd></div><div><dt>R</dt><dd>${fr(r)}</dd></div></dl>
            <div class="acts"><button type="button" data-be="${p.id}">Stop to BE</button><button type="button" data-close="${p.id}">Close</button></div></div>`).join('')}</div>`;
      }
    } else if (BTAB === 'ord') {
      if (!A.ord.length) html = '<div class="pt-empty">No working orders. Choose Limit in the Trade panel to place one.</div>';
      else html = `<table class="pt"><thead><tr><th>Coin</th><th>Type</th><th>Price</th><th>Margin</th><th>Stop</th><th>Target</th><th>Placed</th><th></th></tr></thead><tbody>${A.ord.map(o => `
        <tr data-goto="${esc(o.sym)}"><td>${sd(o.side)}<b>${esc(coin(o.sym))}</b> <span class="muted">${o.lev}×</span>${rtag(o)}</td><td>${o.kind === 'stop' ? 'Stop entry' : 'Limit'}</td><td>${fp(o.price)}</td><td>${money(o.margin)}</td>
        <td class="down">${o.sl ? fp(o.sl) : '—'}</td><td class="up">${o.tp ? fp(o.tp) : '—'}</td><td class="muted">${tshort(o.t)}</td>
        <td><span class="acts"><button type="button" class="x" data-cancel="${o.id}">Cancel</button></span></td></tr>`).join('')}</tbody></table>
        <div class="p-cards">${A.ord.map(o => `<div class="pc"><div class="pc-h"><span>${sd(o.side)}<b>${esc(coin(o.sym))}</b> ${o.kind === 'stop' ? 'stop entry' : 'limit'} ${rtag(o)}</span><b class="mono">${fp(o.price)}</b></div>
          <div class="acts"><button type="button" data-cancel="${o.id}">Cancel</button></div></div>`).join('')}</div>`;
    } else if (BTAB === 'hist') {
      if (!A.hist.length) html = '<div class="pt-empty">Closed trades land here with their result and R.</div>';
      else html = `<table class="pt"><thead><tr><th>Coin</th><th>Opened</th><th>Closed</th><th>Held</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th title="The furthest the trade went your way while it was open">Best</th><th>Why</th></tr></thead><tbody>${A.hist.slice(0, 200).map(h => `
        <tr data-goto="${esc(h.sym)}"><td>${sd(h.side)}<b>${esc(coin(h.sym))}</b> <span class="muted">${h.lev}× ${h.tf ? esc(h.tf) : ''}</span>${rtag(h)}</td><td class="muted">${tshort(h.t0)}</td><td class="muted">${tshort(h.t1)}</td><td class="muted">${h.t1 > h.t0 ? dur(h.t1 - h.t0) : '—'}</td>
        <td>${fp(h.entry, Math.max(2, PREC))}</td><td>${fp(h.exit, Math.max(2, PREC))}</td><td class="${h.pnl >= 0 ? 'up' : 'down'}">${money(h.pnl, true)}</td><td class="${(h.r || 0) >= 0 ? 'up' : 'down'}">${fr(h.r)}</td><td class="muted">${bestOf(h)}</td><td class="muted">${esc(h.why)}</td></tr>`).join('')}</tbody></table>
        <div class="p-cards">${A.hist.slice(0, 60).map(h => `<div class="pc"><div class="pc-h"><span>${sd(h.side)}<b>${esc(coin(h.sym))}</b> ${rtag(h)}</span><span class="pc-pnl ${h.pnl >= 0 ? 'up' : 'down'}">${money(h.pnl, true)}</span></div>
          <dl><div><dt>R</dt><dd>${fr(h.r)}</dd></div><div><dt>Why</dt><dd>${esc(h.why)}</dd></div><div><dt>Closed</dt><dd>${tshort(h.t1)}</dd></div></dl></div>`).join('')}</div>`;
    } else {
      const H = A.hist, n = H.length, w = H.filter(h => h.pnl > 0), l = H.filter(h => h.pnl <= 0), net = H.reduce((s, h) => s + h.pnl, 0);
      const rs = H.filter(h => h.r != null), avgR = rs.length ? rs.reduce((s, h) => s + h.r, 0) / rs.length : null;
      const gw = w.reduce((s, h) => s + h.pnl, 0), gl = -l.reduce((s, h) => s + h.pnl, 0);
      const hold = n ? H.reduce((s, h) => s + (h.t1 - h.t0), 0) / n : 0;
      const st = [['Trades', n, ''], ['Win rate', n ? (w.length / n * 100).toFixed(1) + '%' : '—', ''], ['Net P&L', money(net, true), net >= 0 ? 'up' : 'down'],
        ['Average R', fr(avgR), (avgR || 0) >= 0 ? 'up' : 'down'], ['Profit factor', gl > 0 ? (gw / gl).toFixed(2) : (gw > 0 ? '∞' : '—'), ''],
        ['Best', n ? money(Math.max(...H.map(h => h.pnl)), true) : '—', n && Math.max(...H.map(h => h.pnl)) < 0 ? 'down' : 'up'], ['Worst', n ? money(Math.min(...H.map(h => h.pnl)), true) : '—', n && Math.min(...H.map(h => h.pnl)) >= 0 ? 'up' : 'down'],
        ['Average hold', n ? dur(hold) : '—', ''], ['Replay / live', `${H.filter(h => h.mode === 'replay').length} / ${H.filter(h => h.mode === 'live').length}`, '']];
      html = `<div class="stats2">${st.map(([k, v, c]) => `<div><span>${k}</span><b class="${c}">${v}</b></div>`).join('')}</div>` +
        (n < 30 ? '<p class="pt-empty" style="min-height:0;padding-top:0">Fewer than 30 trades says little — keep practising before you trust these numbers.</p>' : '');
    }
    body.innerHTML = html;
  }

  // ------------------------------------------------------------------ chart price lines (positions, orders, ticket preview), draggable
  const PL = new Map();
  function wantLines() {
    const W = [], md = mode(), LS = LC.LineStyle;
    for (const p of A.pos) {
      if (p.sym !== U.sym || p.mode !== md) continue;
      const u = upnl(p), L = p.side === 1, at = v => p.side * (v - p.entry) * p.qty, rr = v => (p.risk ? ` (${fr(at(v) / p.risk)})` : '');
      const head = `<b>Paper ${L ? 'long' : 'short'} ${esc(coin(p.sym))}</b> · ${fq(p.qty)} at ${fp(p.entry)}`;
      W.push({ key: 'pe' + p.id, price: p.entry, color: COL.pri, style: LS.Solid, w: 1, title: `${L ? 'LONG' : 'SHORT'} ${money(u, true)}`,
        tip: () => `${head}<br>Open P&amp;L ${money(upnl(p), true)} · margin ${money(p.margin)} × ${p.lev}×` });
      W.push({ key: 'pq' + p.id, price: p.liq, color: COL.warn, style: LS.Dotted, w: 1, title: 'Liq.', tip: () => `${head}<br><b>Liquidation ${fp(p.liq)}</b> · the whole ${money(p.margin)} margin is lost here` });
      if (p.sl != null) W.push({ key: 'ps' + p.id, price: p.sl, color: COL.down, style: LS.Dashed, w: 1, title: `SL ${money(at(p.sl), true)}`,
        tip: () => `${head}<br><b>Stop ${fp(p.sl)}</b> · ${pct((p.sl / p.entry - 1) * 100)} from entry<br>If it fills: ${money(at(p.sl), true)}${rr(p.sl)} before the exit fee<br><small>Drag the line to move it.</small>`,
        drag: { set: v => { p.sl = v; }, ok: v => (L ? v < markOf(p) : v > markOf(p)) && (L ? v > p.liq : v < p.liq), bad: L ? "A long's stop has to sit between the liquidation price and the price now" : "A short's stop has to sit between the price now and the liquidation price", undo: p.sl } });
      if (p.tp != null) W.push({ key: 'pt' + p.id, price: p.tp, color: COL.up, style: LS.Dashed, w: 1, title: `TP ${money(at(p.tp), true)}`,
        tip: () => `${head}<br><b>Target ${fp(p.tp)}</b> · ${pct((p.tp / p.entry - 1) * 100)} from entry<br>If it fills: ${money(at(p.tp), true)}${rr(p.tp)} before the exit fee<br><small>Drag the line to move it.</small>`,
        drag: { set: v => { p.tp = v; }, ok: v => (L ? v > markOf(p) : v < markOf(p)), bad: L ? "A long's target has to be above the price now" : "A short's target has to be below the price now", undo: p.tp } });
    }
    for (const o of A.ord) {
      if (o.sym !== U.sym || o.mode !== md) continue;
      const L = o.side === 1, stp = o.kind === 'stop', what = `${L ? 'Buy' : 'Sell'} ${stp ? 'stop' : 'limit'}`;
      const oq = () => o.margin * o.lev / o.price, at = v => o.side * (v - o.price) * oq();
      const ohead = `<b>Paper ${what.toLowerCase()} ${esc(coin(o.sym))}</b> · ${money(o.margin)} × ${o.lev}× at ${fp(o.price)}`;
      W.push({ key: 'oo' + o.id, price: o.price, color: COL.pri, style: LS.Dashed, w: 1, title: `${L ? 'BUY' : 'SELL'} ${stp ? 'STOP' : 'LIMIT'}`,
        tip: () => `${ohead}<br>${stp ? (L ? 'Fills when the price rises to it' : 'Fills when the price falls to it') : (L ? 'Fills when the price dips to it' : 'Fills when the price rises to it')}<br><small>Drag the line to move it.</small>`,
        drag: { set: v => { o.price = v; }, ok: v => (stp ? (L ? v > S.lastPx : v < S.lastPx) : (L ? v < S.lastPx : v > S.lastPx)) && (o.sl == null || (L ? o.sl < v : o.sl > v)) && (o.tp == null || (L ? o.tp > v : o.tp < v)),
          bad: `A ${what.toLowerCase()} has to be ${(stp ? L : !L) ? 'above' : 'below'} the price now, between its stop and target`, undo: o.price } });
      if (o.sl) W.push({ key: 'os' + o.id, price: o.sl, color: hexA(COL.down, 0.7), style: LS.Dotted, w: 1, title: `SL ${money(at(o.sl), true)}`,
        tip: () => `${ohead}<br><b>Stop ${fp(o.sl)}</b> · ${pct((o.sl / o.price - 1) * 100)} from the entry · ${money(at(o.sl), true)} if it fills`,
        drag: { set: v => { o.sl = v; }, ok: v => (L ? v < o.price : v > o.price) && (L ? v > liqOf(1, o.price, o.lev) : v < liqOf(-1, o.price, o.lev)), bad: L ? "A long's stop goes below its entry (and above liquidation)" : "A short's stop goes above its entry (and below liquidation)", undo: o.sl } });
      if (o.tp) W.push({ key: 'ot' + o.id, price: o.tp, color: hexA(COL.up, 0.7), style: LS.Dotted, w: 1, title: `TP ${money(at(o.tp), true)}`,
        tip: () => `${ohead}<br><b>Target ${fp(o.tp)}</b> · ${pct((o.tp / o.price - 1) * 100)} from the entry · ${money(at(o.tp), true)} if it fills`,
        drag: { set: v => { o.tp = v; }, ok: v => (L ? v > o.price : v < o.price), bad: L ? "A long's target goes above its entry" : "A short's target goes below its entry", undo: o.tp } });
    }
    if (Q.on) {   // the ⚡ plan being set up on the chart: drag any of its lines to adjust
      const qd = (k, f, v, color, title) => W.push({ key: 'q' + k, price: v, color, style: LS.Solid, w: 2, title, drag: { set: x => { Q[f] = x; qRender(); }, ok: () => true, ticket: true } });
      if (!Q.mkt && Q.entry != null) qd('e', 'entry', Q.entry, COL.warn, Q.side ? `⚡ ${Q.side === 1 ? 'BUY' : 'SELL'} ${qKind().toUpperCase()}` : '⚡ ENTRY');
      if (Q.sl != null) qd('s', 'sl', Q.sl, COL.down, '⚡ STOP');
      if (Q.tp != null) qd('t', 'tp', Q.tp, COL.up, '⚡ TARGET');
    }
    const t = readT();
    const tf = (f, v, color, title) => { if (v && !isNaN(v)) W.push({ key: 'tk' + f, price: v, color, style: LS.LargeDashed, w: 1, title, drag: { set: x => { fld(f).value = x; }, ok: () => true, ticket: true } }); };
    if (T.type === 'limit') tf('price', t.price, COL.pri, 'Limit');
    tf('sl', t.sl, COL.down, 'Stop'); tf('tp', t.tp, COL.up, 'Target');
    for (const f of X.lines) { try { for (const w of f()) W.push(w); } catch (e) { console.error(e); } }
    return W;
  }
  function syncLines() {
    const W = new Map(); for (const w of wantLines()) W.set(w.key, w);
    for (const [k, v] of PL) if (!W.has(k)) { cs.removePriceLine(v.line); PL.delete(k); }
    for (const [k, w] of W) {
      if (DRAG && DRAG.key === k) continue;
      const opt = { price: w.price, color: w.color, lineWidth: w.w, lineStyle: w.style, axisLabelVisible: true, title: w.title, axisLabelTextColor: '#fff' };
      const e = PL.get(k);
      if (e) { e.line.applyOptions(opt); e.w = w; } else PL.set(k, { line: cs.createPriceLine(opt), w });
    }
  }

  // ------------------------------------------------------------------ drawings + SMC overlay (a series primitive)
  let DRAW = store.get('rd-draw-v1', {});
  const saveDraw = () => store.set('rd-draw-v1', DRAW);
  let TOOL = 'cursor', DRAFT = null, MEASURE = null, SEL = null, DRAG = null, PICK = null, SMCR = null, FVGS = null, TLS = null;
  const ONE = new Set(['hline', 'ray']), TWO = new Set(['trend', 'rect', 'fib', 'measure']);
  const drawTool = t => ONE.has(t) || TWO.has(t) || t === 'pen';
  let PENS = [];   // strokes of this pencil session, newest last (Undo)
  const FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  function t2l(t) { return t2lOf(S.bars, TF[U.tf].ms, t); }
  function t2lOf(B, ms, t) {   // any chart's candles (the Compare chart too)
    const n = B.length; if (!n) return null;
    if (t <= B[0][0]) return (t - B[0][0]) / ms;
    if (t >= B[n - 1][0]) return n - 1 + (t - B[n - 1][0]) / ms;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m][0] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo][0]) / (B[hi][0] - B[lo][0]);
  }
  // the chart library answers 0 for a position between two candles (a 1m time on a 5m chart), so interpolate between them
  const t2x = t => l2xOf(chart.timeScale(), t2l(t));
  function l2xOf(ts, l) {
    if (l == null) return null;
    const i = Math.floor(l), x0 = ts.logicalToCoordinate(i);
    if (x0 == null || l === i) return x0;
    const x1 = ts.logicalToCoordinate(i + 1);
    return x1 == null ? x0 : x0 + (x1 - x0) * (l - i);
  }
  function x2t(x) {
    const B = S.bars, n = B.length, ms = TF[U.tf].ms;
    let l = chart.timeScale().coordinateToLogical(x); if (l == null || !n) return null;
    l = Math.round(l);
    if (l <= 0) return B[0][0] + l * ms;
    if (l >= n - 1) return B[n - 1][0] + (l - n + 1) * ms;
    return B[l][0];
  }
  // the exact time under x, between candles too (x2t snaps to a candle): the pencil has to follow the hand
  function x2tExact(x) {
    const B = S.bars, n = B.length, ms = TF[U.tf].ms, ts = chart.timeScale(), near = ts.coordinateToLogical(x);
    if (near == null || !n) return null;
    const i = Math.round(near), a = ts.logicalToCoordinate(i), b = ts.logicalToCoordinate(i + 1);
    if (a == null || b == null || a === b) return null;
    const l = i + (x - a) / (b - a);
    if (l <= 0) return B[0][0] + l * ms;
    if (l >= n - 1) return B[n - 1][0] + (l - n + 1) * ms;
    const k = Math.floor(l); return B[k][0] + (B[k + 1][0] - B[k][0]) * (l - k);
  }
  const p2y = p => cs.priceToCoordinate(p), y2p = y => cs.coordinateToPrice(y);
  // a drawing point: the candle under x, the price exactly under y. Magnet: a candle's open / high / low / close close to
  // the pointer (a few px, both ways) wins; anywhere else the point stays where the pointer is, so a line can sit between
  // wicks. (It used to take the nearest candle's nearest price within 36 px up or down — zoomed out, that is a different
  // candle every 2–3 px, so an end hopped from wick to wick.) o.flip (⌘ / Ctrl held) turns the magnet the other way for a moment.
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  const MODK = IS_MAC ? '⌘' : 'Ctrl';
  const ptOpts = e => ({ flip: !!(IS_MAC ? e.metaKey : e.ctrlKey), touch: e.pointerType && e.pointerType !== 'mouse' });
  function tp(x, y, o = {}) {
    let t = x2t(x), p = y2p(y);
    if (U.magnet !== !!o.flip && t != null && p != null) {
      const ts = chart.timeScale(), l0 = Math.round(t2l(t)), rad = o.touch ? 22 : 12;
      const a = ts.logicalToCoordinate(l0), b = ts.logicalToCoordinate(l0 + 1), gap = a != null && b != null ? Math.abs(b - a) : 0;
      const k = Math.min(40, Math.ceil(rad / Math.max(gap, 0.5)) + 1);
      let best = null, bd = rad;
      for (let i = l0 - k; i <= l0 + k; i++) {
        const c = S.bars[i]; if (!c) continue;
        const cx = ts.logicalToCoordinate(i); if (cx == null || Math.abs(cx - x) > rad) continue;
        for (const v of [c[1], c[2], c[3], c[4]]) { const cy = p2y(v); if (cy == null) continue; const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = [c[0], v]; } }
      }
      if (best) { t = best[0]; p = best[1]; }
    }
    return { t, p };
  }
  // logical index → time, between candles too (the inverse of t2l)
  function l2t(l) {
    const B = S.bars, n = B.length, ms = TF[U.tf].ms; if (!n) return null;
    if (l <= 0) return B[0][0] + l * ms;
    if (l >= n - 1) return B[n - 1][0] + (l - n + 1) * ms;
    const i = Math.floor(l); return B[i][0] + (B[i + 1][0] - B[i][0]) * (l - i);
  }
  const paneW = () => chart.timeScale().width();
  const paneH = () => box.clientHeight - chart.timeScale().height();

  function label(g, text, x, y, color, align, bg) {
    g.font = '600 10.5px "Geist Mono", ui-monospace, monospace';
    const w = g.measureText(text).width + 8, h = 16;
    let lx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    g.fillStyle = bg || hexA(COL.bg.length === 7 ? COL.bg : '#0b0e14', 0.85); g.fillRect(lx, y - h / 2, w, h);
    g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, lx + 4, y + 0.5);
  }
  function drawOne(g, d, W, sel) {
    const P = d.pts.map(q => [t2x(q.t), p2y(q.p)]);
    if (P.some(q => q[0] == null || q[1] == null)) return;
    const c = d.type === 'measure' ? (d.pts[1].p >= d.pts[0].p ? COL.up : COL.down) : COL.pri;
    g.strokeStyle = c; g.lineWidth = sel ? 2 : 1.5; g.setLineDash([]);
    const [x0, y0] = P[0];
    if (d.type === 'hline') { g.beginPath(); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke(); label(g, fp(d.pts[0].p), W - 4, y0 - 10, c, 'right'); }
    else if (d.type === 'ray') { g.beginPath(); g.moveTo(x0, y0); g.lineTo(W, y0); g.stroke(); label(g, fp(d.pts[0].p), W - 4, y0 - 10, c, 'right'); }
    else if (d.type === 'pen') {   // smooth through the middle of each pair of points
      g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = sel ? 3 : 2; g.beginPath(); g.moveTo(x0, y0);
      for (let i = 1; i < P.length - 1; i++) g.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
      g.lineTo(P[P.length - 1][0], P[P.length - 1][1]); g.stroke(); g.lineCap = 'butt'; g.lineJoin = 'miter';
    }
    else {
      const [x1, y1] = P[1];
      if (d.type === 'trend') { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      else if (d.type === 'rect') { g.fillStyle = hexA(c, 0.12); g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); }
      else if (d.type === 'fib') {
        const a = d.pts[0].p, b = d.pts[1].p, xl = Math.min(x0, x1), xr = Math.max(x0, x1);
        for (let i = 0; i < FIBS.length; i++) {
          const k = FIBS[i], pr = b + (a - b) * k, y = p2y(pr); if (y == null) continue;
          if (i) { const pp = b + (a - b) * FIBS[i - 1], yp = p2y(pp); g.fillStyle = hexA(k === 0.618 || k === 0.5 ? COL.acc : COL.pri, k === 0.618 ? 0.14 : 0.06); g.fillRect(xl, Math.min(y, yp), xr - xl, Math.abs(y - yp)); }
          g.strokeStyle = hexA(k === 0.5 || k === 0.618 ? COL.acc : COL.pri, 0.9); g.lineWidth = 1; g.beginPath(); g.moveTo(xl, y); g.lineTo(xr, y); g.stroke();
          label(g, `${k} (${fp(pr)})`, xl + 2, y - 9, k === 0.5 || k === 0.618 ? COL.acc : COL.pri, 'left', 'transparent');
        }
        g.strokeStyle = hexA(COL.pri, 0.5); g.setLineDash([4, 4]); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.setLineDash([]);
      } else if (d.type === 'measure') {
        g.fillStyle = hexA(c, 0.14); g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        const ch = (d.pts[1].p / d.pts[0].p - 1) * 100, bars = Math.round(t2l(d.pts[1].t) - t2l(d.pts[0].t));
        label(g, `${pct(ch)} · ${fp(d.pts[1].p - d.pts[0].p)} · ${Math.abs(bars)} bars · ${dur(Math.abs(d.pts[1].t - d.pts[0].t))}`, (x0 + x1) / 2, Math.min(y0, y1) - 12, c, 'center', COL.panel);
      }
    }
    if (sel) for (const [x, y] of (d.type === 'hline' ? [] : d.type === 'pen' ? [P[0], P[P.length - 1]] : P)) { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fillStyle = COL.bg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = COL.pri; g.stroke(); }
  }
  // fair value gaps: their own indicator, drawn with SMC on or off. Like TradingView's SMC script: a pale box over the gap from
  // its middle candle, FVG_LEN candles long (shorter when price fills the gap first), "FVG" at its right end.
  // Recent: the newest 8 not filled yet · Whole chart: every gap, filled ones fainter
  const FVG_LEN = 15;
  let FVGBOX = [];   // what was drawn last, for tests
  function drawFVG(g, W) { FVGBOX = paintFVG(g, W, { ms: TF[U.tf].ms, list: U.smcAll ? FVGS : FVGS.filter(f => !f.filled).slice(-8), t2x, p2y }); }
  // the painters below draw on any chart: o carries that chart's candles / time → x / price → y (main or Compare)
  function paintFVG(g, W, o) {
    const ms = o.ms, list = o.list, out = [], t2x = o.t2x, p2y = o.p2y;
    g.font = '600 9px "Geist Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
    for (const f of list) {
      const x0 = t2x(f.t), xl = t2x(f.t + FVG_LEN * ms), xf = f.filled ? t2x(f.filled) : null;
      if (x0 == null || xl == null) continue;
      const xe = xf != null ? Math.min(xf, xl) : xl, y0 = p2y(f.top0), y1 = p2y(f.bot0);
      if (y0 == null || y1 == null || xe < 0 || x0 > W) continue;
      const c = f.dir === 1 ? COL.up : COL.fvgDn, faint = !!f.filled, y = Math.min(y0, y1), h = Math.max(1.5, Math.abs(y1 - y0)), w = Math.max(2, xe - x0);
      g.fillStyle = hexA(c, faint ? 0.08 : 0.22); g.fillRect(x0, y, w, h);
      out.push({ x0, xe: x0 + w, y, h, dir: f.dir, filled: faint });
      if (faint) continue;
      g.fillStyle = hexA(c, 0.85);
      const xr = Math.min(x0 + w, W);   // the box can run past the last candle: keep the label on screen
      if (h >= 9 && xr - x0 >= 28) { g.textAlign = 'right'; g.fillText('FVG', xr - 3, y + h / 2 + 0.5); }   // inside, right end
      else if (x0 + w + 24 < W) { g.textAlign = 'left'; g.fillText('FVG', x0 + w + 3, y + h / 2 + 0.5); }   // thin gap: just after the box
    }
    return out;
  }
  let TLBOX = [];   // what was drawn last, for tests
  function drawTL(g, W) { TLBOX = paintTL(g, W, { ts: chart.timeScale(), bars: S.bars, lines: TLS, t2l, p2y, fp }); }
  function paintTL(g, W, o) {
    const ts = o.ts, B = o.bars, t2l = o.t2l, p2y = o.p2y, fp = o.fp; if (!B.length) return [];
    const xr = ts.coordinateToLogical(W), Lr = xr == null ? B.length + 5 : Math.ceil(xr) + 1, Ln = B.length - 1, out = [];
    g.font = '600 10px "Geist Mono", ui-monospace, monospace';
    const seg = (La, Lb, at, dash) => { const xa = ts.logicalToCoordinate(La), xb = ts.logicalToCoordinate(Lb), ya = p2y(at(La)), yb = p2y(at(Lb));
      if (xa == null || xb == null || ya == null || yb == null) return null; g.setLineDash(dash); g.beginPath(); g.moveTo(xa, ya); g.lineTo(xb, yb); g.stroke(); g.setLineDash([]); return [xa, ya, xb, yb]; };
    for (const l of o.lines) {
      const L1 = t2l(l.t1), L2 = t2l(l.t2); if (L1 == null || L2 == null || L2 === L1) continue;
      const at = L => l.p1 + (l.p2 - l.p1) * (L - L1) / (L2 - L1), c = l.side === 'L' ? COL.up : COL.down, htf = !!l.htf;
      const pre = l.brkT != null, Lb = l.liveBrk != null ? t2l(l.liveBrk) : null, holding = !pre && Lb == null;
      const wid = htf ? 2 : 3;
      let box;
      if (pre) { g.strokeStyle = hexA(c, 0.5); g.lineWidth = 1.5; box = seg(L1, Lr, at, [6, 5]); }
      else if (Lb != null) {   // broken after it was drawn: solid up to the candle that closed through, then faint
        g.strokeStyle = hexA(c, htf ? 0.7 : 0.95); g.lineWidth = wid; box = seg(L1, Lb, at, []);
        g.strokeStyle = hexA(c, 0.45); g.lineWidth = 1.5; seg(Lb, Lr, at, [6, 5]);
        const xb = ts.logicalToCoordinate(Lb), yb = p2y(at(Lb));
        if (xb != null && yb != null) { g.strokeStyle = COL.warn; g.lineWidth = 2; g.beginPath(); g.moveTo(xb - 4, yb - 4); g.lineTo(xb + 4, yb + 4); g.moveTo(xb + 4, yb - 4); g.lineTo(xb - 4, yb + 4); g.stroke(); }
      } else { g.strokeStyle = hexA(c, htf ? 0.7 : 0.95); g.lineWidth = wid; box = seg(L1, Lr, at, []); }
      if (!box) continue;
      for (const [list, ring] of [[l.touches || [], false], [l.liveTouches || [], true]]) for (const t of list) {
        const L = t2l(t); if (L == null) continue;
        const x = ts.logicalToCoordinate(L), y = p2y(at(L)); if (x == null || y == null) continue;
        g.beginPath(); g.arc(x, y, pre || htf ? 2.5 : 3.5, 0, Math.PI * 2);
        if (ring) { g.fillStyle = COL.bg; g.fill(); g.lineWidth = 2; g.strokeStyle = c; g.stroke(); }   // touched after the line was drawn: hollow
        else { g.fillStyle = hexA(c, pre ? 0.55 : 1); g.fill(); g.lineWidth = 1.5; g.strokeStyle = COL.bg; g.stroke(); }
      }
      const vn = at(Ln), xn = ts.logicalToCoordinate(Ln), yn = p2y(vn);
      if (holding && xn != null && yn != null && xn > 0 && xn < W - 60) label(g, (htf ? l.htf + ' ' : '') + fp(vn), xn + 8, yn + (l.side === 'L' ? 11 : -11), c, 'left', COL.panel);
      out.push({ side: l.side, broken: !holding, pre, liveBrk: l.liveBrk, htf: l.htf || null, x0: box[0], y0: box[1], x1: box[2], y1: box[3], now: vn, nT: l.nT });
    }
    return out;
  }
  let SMCDRAWN = null;   // what drawSMC painted last, for tests
  function smcAny() { return !!(U.smc || U.choch || U.bos || U.eq || U.liq); }   // anything that needs the SMC engine
  function drawSMC(g, W) { const d = paintSMC(g, W, { r: SMCR, all: U.smcAll, smc: U.smc, taken: U.smcTaken, choch: U.choch, bos: U.bos, eq: U.eq, liq: U.liq, t2x, p2y }); if (d) SMCDRAWN = d; }
  function paintSMC(g, W, o) {
    const r = o.r, t2x = o.t2x, p2y = o.p2y; if (!r) return null;
    const all = !!o.all, done = { zones: 0, eqs: 0, breaks: [], liq: 0, sweeps: 0 };
    if (o.smc) {
    // Whole chart: past zones too, faint, from the order block to the candle that closed through them
    if (all) for (const z of r.zones) {
      if (!z.broken) continue;
      const x0 = t2x(z.t), x1 = t2x(z.broken), y0 = p2y(z.top), y1 = p2y(z.bot); if (x0 == null || y0 == null || y1 == null) continue;
      const xe = x1 == null ? W : x1; if (xe < 0 || x0 > W) continue;
      const c = z.type === 'demand' ? COL.up : COL.down;
      g.fillStyle = hexA(c, 0.05); g.fillRect(x0, Math.min(y0, y1), Math.max(1, xe - x0), Math.abs(y1 - y0));
      g.strokeStyle = hexA(c, 0.22); g.setLineDash([3, 3]); g.lineWidth = 1; g.strokeRect(x0, Math.min(y0, y1), Math.max(1, xe - x0), Math.abs(y1 - y0)); g.setLineDash([]);
    }
    for (const z of (all ? r.zones.filter(z => !z.broken) : r.zones.filter(z => !z.broken).slice(-6))) {
      const x0 = t2x(z.t), y0 = p2y(z.top), y1 = p2y(z.bot); if (x0 == null || y0 == null || y1 == null) continue;
      const c = z.type === 'demand' ? COL.up : COL.down;
      g.fillStyle = hexA(c, 0.11); g.fillRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      g.strokeStyle = hexA(c, 0.45); g.lineWidth = 1; g.strokeRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      label(g, z.type === 'demand' ? 'Demand' : 'Supply', x0 + 2, Math.min(y0, y1) + 9, c, 'left', 'transparent'); done.zones++;
    }
    }
    // equal highs / lows (their own tick, Indicators → EQH / EQL; on with SMC): two swing highs (lows) at about the same
    // price = stops resting there (liquidity). Dotted line from the first one to the right edge while untaken.
    if (o.eq) {
    // equal lows / highs price has already taken (Indicators → keep them): faded, from the first low to the candle that took
    // it, "swept" = wick through and closed back, "broken" = closed through. Recent: the newest 6 · Whole chart: all
    // two pairs at one price (lows 1+2 and 1+3) are one level: drawn once, so they don't use up the newest-N slots
    const uniq = a => { const s = new Set(); return a.filter(e => { const k = e.kind + e.p + '|' + (e.taken || 0); if (s.has(k)) return false; s.add(k); return true; }); };
    if (o.taken) for (const e of (all ? uniq(r.eqs.filter(e => e.taken)) : uniq(r.eqs.filter(e => e.taken)).slice(-6))) {
      const x0 = t2x(e.t1), x1 = t2x(e.taken - r.tf), y = p2y(e.p); if (x0 == null || y == null) continue;
      const xe = x1 == null ? W : x1; if (xe < 0 || x0 > W) continue;
      g.strokeStyle = hexA(COL.warn, 0.38); g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(xe, y); g.stroke(); g.setLineDash([]);
      label(g, e.kind + (e.swept ? ' swept' : ' broken'), xe + 3, y + (e.side === 'H' ? -9 : 9), hexA(COL.warn, 0.6), 'left', 'transparent');
    }
    for (const e of (all ? uniq(r.eqs.filter(e => !e.taken)) : uniq(r.eqs.filter(e => !e.taken)).slice(-4))) {
      const x0 = t2x(e.t1), y = p2y(e.p); if (x0 == null || y == null) continue;
      g.strokeStyle = hexA(COL.warn, 0.85); g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
      label(g, e.kind, W - 4, y + (e.side === 'H' ? -9 : 9), COL.warn, 'right', 'transparent'); done.eqs++;
    }
    }
    // liquidity (Indicators → Liquidity; on with SMC): stops rest above swing highs (buy-side, BSL) and below swing lows
    // (sell-side, SSL). Untaken ones: a dotted line from the swing to the right edge (Recent: the nearest 3 above and 3 below
    // the price · Whole chart: all). Taken by a wick that closed back = a sweep: a short line from the level to that candle.
    if (o.liq) {
      const LQ = '#8b5cf6', px = r.forming ? r.forming.c : null, lv = (r.liq || []).filter(l => l.kind === 'swing');
      const side = s => { const a = lv.filter(l => l.side === s); if (all || px == null) return all ? a : a.slice(-3); return a.sort((p, q) => Math.abs(p.p - px) - Math.abs(q.p - px)).slice(0, 3); };
      for (const l of side('H').concat(side('L'))) {
        const x0 = t2x(l.t), y = p2y(l.p); if (x0 == null || y == null || x0 > W) continue;
        g.strokeStyle = hexA(LQ, 0.8); g.setLineDash([1, 3]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(Math.max(0, x0), y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
        label(g, l.side === 'H' ? 'BSL' : 'SSL', W - 4, y + (l.side === 'H' ? -9 : 9), LQ, 'right', 'transparent'); done.liq++;
      }
      for (const w of (all ? r.sweeps : r.sweeps.slice(-6))) {
        const x0 = t2x(w.levelT), x1 = t2x(w.t), y = p2y(w.p); if (x1 == null || y == null || x1 < 0 || x1 > W) continue;
        const xa = x0 == null ? 0 : Math.max(0, x0), hi = w.dir === -1;
        g.strokeStyle = hexA(LQ, 0.5); g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(xa, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
        g.strokeStyle = LQ; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x1 - 3, y - 3); g.lineTo(x1 + 3, y + 3); g.moveTo(x1 + 3, y - 3); g.lineTo(x1 - 3, y + 3); g.stroke();
        label(g, (w.kind === 'swing' ? (hi ? 'BSL' : 'SSL') : w.kind) + ' swept', x1 + 5, y + (hi ? -9 : 9), LQ, 'left', 'transparent'); done.sweeps++;
      }
    }
    const BR = r.breaks.filter(b => b.kind === 'CHoCH' ? o.choch : o.bos);   // CHoCH and BOS each by their own tick
    for (const b of (all ? BR : BR.slice(-8))) {
      const x0 = t2x(b.fromT), x1 = t2x(b.t), y = p2y(b.p); if (x0 == null || x1 == null || y == null) continue;
      done.breaks.push(b.kind);
      const c = b.dir === 1 ? COL.up : COL.down;
      g.strokeStyle = c; g.setLineDash([5, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
      label(g, b.kind, (x0 + x1) / 2, y + (b.dir === 1 ? -9 : 9), c, 'center', 'transparent');
    }
    return done;
  }
  // previous day high / low: yesterday's daily candle of this market (UTC days; FX skips the weekend), fetched once a day
  // per market. In a replay "yesterday" is the day before the replay clock, a day that has fully closed: no peeking.
  let PDAY = null, PDK = '', PDBUSY = '', PDFAIL = { key: '', at: 0 };
  function pdCheck() {
    if (!U.pdhl || TF[U.tf].ms >= WEEK || U.tf === '1M') { if (PDAY || PDK) { PDAY = null; PDK = ''; prim.req(); legend(); } return; }
    const d0 = bucket(nowT(), '1D'), key = U.ex + '|' + U.sym + '|' + d0;
    if (key === PDK || key === PDBUSY || (PDFAIL.key === key && Date.now() - PDFAIL.at < 30e3)) return;
    if (PDAY && PDAY.key !== key) { PDAY = null; prim.req(); legend(); }
    PDBUSY = key;
    api().klines(U.sym, '1D', { end: d0 - 1, limit: 3 }).then(k => {
      if (PDBUSY !== key) return; PDBUSY = '';
      const p = (k || []).filter(c => c[0] < d0).pop();
      const now = U.ex + '|' + U.sym + '|' + bucket(nowT(), '1D');
      if (now !== key) return pdCheck();   // the market or the day changed while this was loading
      PDK = key; PDAY = p ? { key, t: p[0], h: p[2], l: p[3] } : null; prim.req(); legend();
    }).catch(() => { if (PDBUSY === key) { PDBUSY = ''; PDFAIL = { key, at: Date.now() }; } });
  }
  function drawPD(g, W) { paintPD(g, W, { pd: PDAY, t2x, p2y, fp }); }
  function paintPD(g, W, o) {
    const pd = o.pd, t2x = o.t2x, p2y = o.p2y, fp = o.fp;
    const xa = t2x(pd.t), x0 = xa == null ? 0 : Math.max(0, xa); if (x0 >= W) return;
    g.font = '600 10px "Geist Mono", ui-monospace, monospace';
    for (const [p, name] of [[pd.h, 'PDH'], [pd.l, 'PDL']]) {
      const y = p2y(p); if (y == null) continue;
      g.strokeStyle = hexA(COL.pri, 0.85); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(W, y); g.stroke();
      label(g, name + ' ' + fp(p), W - 4, y + (name === 'PDH' ? -9 : 9), COL.pri, 'right', COL.bg);   // solid: readable over the newest candles
    }
  }
  // the highest high and lowest low of the candles on screen, like TradingView's high / low labels: a faint line from
  // that candle to the price axis and its price. Follows scrolling and zooming; in a replay only candles up to the clock exist.
  function drawHiLo(g, W) { paintHiLo(g, W, { bars: S.bars, ts: chart.timeScale(), p2y, fp, covers: () => coversOf(box, [document.querySelector('.dk-qt'), document.querySelector('.tt')], [document.querySelector('[data-legend]')]) }); }
  // what sits on a chart (Buy / Sell box, a table, the legend's text lines), in that chart's px, for labels to step around
  function coversOf(host, els, texts) {
    const cr = host.getBoundingClientRect(), covers = [];
    const add = r => { if (r.width > 0 && r.height > 0) covers.push({ l: r.left - cr.left - 2, r: r.right - cr.left + 2, t: r.top - cr.top - 1, b: r.bottom - cr.top + 1 }); };
    for (const el of els) if (el && !el.hidden && el.offsetParent) add(el.getBoundingClientRect());
    for (const lg of texts) if (lg && lg.offsetParent) { const rg = document.createRange(); rg.selectNodeContents(lg); for (const r of rg.getClientRects()) add(r); }
    return covers;
  }
  function paintHiLo(g, W, o) {
    const B = o.bars, ts = o.ts, p2y = o.p2y, fp = o.fp, n = B.length, r = ts.getVisibleLogicalRange(); if (!n || !r) return;
    const i0 = Math.max(0, Math.ceil(r.from)), i1 = Math.min(n - 1, Math.floor(r.to)); if (i1 - i0 < 2) return;
    const covers = o.covers();
    let hi = i0, lo = i0;
    for (let i = i0; i <= i1; i++) { if (B[i][2] > B[hi][2]) hi = i; if (B[i][3] < B[lo][3]) lo = i; }
    for (const [i, p, tag, dy] of [[hi, B[hi][2], 'High', -1], [lo, B[lo][3], 'Low', 1]]) {
      const x = ts.logicalToCoordinate(i), y = p2y(p); if (x == null || y == null) continue;
      const txt = `${tag} ${fp(p)}`;
      g.font = '600 10.5px "Geist Mono", ui-monospace, monospace';
      const w = g.measureText(txt).width + 10; let ly = y + dy * 11;
      let lx = x + 7; if (lx + w > W - 4) lx = x - 7 - w; lx = Math.max(2, lx);   // right of the candle, or left of it at the chart's edge
      // step around what sits on the chart (Buy / Sell box, Trend table, the legend's text): beside it, or under it
      const hit = (x, y) => covers.find(r => x < r.r && x + w > r.l && y + 8 > r.t && y - 8 < r.b);
      for (let k = 0, r; k < 6 && (r = hit(lx, ly)); k++) {
        if (r.r + 6 + w <= W - 4 && !hit(r.r + 6, ly)) lx = r.r + 6;
        else if (r.l - 6 - w >= 2 && !hit(r.l - 6 - w, ly)) lx = r.l - 6 - w;
        else ly = r.b + 9;   // no room beside it: just under it
      }
      g.strokeStyle = hexA(COL.muted, 0.45); g.lineWidth = 1; g.setLineDash([1, 3]); g.beginPath(); g.moveTo(Math.max(x + 4, lx + w), y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = hexA(COL.panel, 0.9); g.fillRect(lx, ly - 8, w, 16);
      g.strokeStyle = hexA(COL.muted, 0.4); g.strokeRect(lx + 0.5, ly - 7.5, w - 1, 15);
      g.fillStyle = COL.text; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(txt, lx + 5, ly + 0.5);
    }
  }
  const prim = {
    _p: null,
    attached(p) { this._p = p; }, detached() { this._p = null; },
    req() { if (this._p) this._p.requestUpdate(); },
    updateAllViews() { /* drawn from state */ },
    paneViews() { return VIEWS; },
  };
  const VIEWS = [
    { zOrder: () => 'bottom', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => { if (U.smcFvg && FVGS && !X.smcOff) { s.context.save(); drawFVG(s.context, s.mediaSize.width); s.context.restore(); } if (smcAny() && !X.smcOff) drawSMC(s.context, s.mediaSize.width); xDraw(s.context, s.mediaSize.width, 'bottom'); }) }) },
    { zOrder: () => 'top', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => {
      const g = s.context, W = s.mediaSize.width;
      if (U.hilo) { g.save(); drawHiLo(g, W); g.restore(); }
      if (U.tline && TLS) { g.save(); drawTL(g, W); g.restore(); }
      if (U.pdhl && PDAY) { g.save(); drawPD(g, W); g.restore(); }
      for (const d of DRAW[U.sym] || []) drawOne(g, d, W, d === SEL);
      if (DRAFT) drawOne(g, DRAFT, W, DRAFT.type !== 'pen');
      if (MEASURE) drawOne(g, MEASURE, W, false);
      xDraw(g, W, 'top');
    }) }) },
  ];
  function xDraw(g, W, z) { for (const f of X.draw) { g.save(); try { f(g, W, z); } catch (e) { console.error(e); } g.restore(); } }
  cs.attachPrimitive(prim);

  function distSeg(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    const k = L ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L)) : 0;
    return Math.hypot(px - (x0 + k * dx), py - (y0 + k * dy));
  }
  function hitDrawing(x, y, touch) {
    const list = DRAW[U.sym] || [], hr = touch ? 18 : 10, lr = touch ? 12 : 6;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i], P = d.pts.map(q => [t2x(q.t), p2y(q.p)]);
      if (P.some(q => q[0] == null || q[1] == null)) continue;
      if (d.type !== 'hline' && d.type !== 'pen') { let bh = -1, bd = hr; for (let h = 0; h < P.length; h++) { const dd = Math.hypot(P[h][0] - x, P[h][1] - y); if (dd < bd) { bd = dd; bh = h; } } if (bh >= 0) return { d, h: bh }; }
      const [x0, y0] = P[0], x1 = P[1] ? P[1][0] : 0, y1 = P[1] ? P[1][1] : 0;
      let hit = false;
      if (d.type === 'hline') hit = Math.abs(y - y0) < lr;
      else if (d.type === 'ray') hit = Math.abs(y - y0) < lr && x > x0 - lr;
      else if (d.type === 'trend') hit = distSeg(x, y, x0, y0, x1, y1) < lr;
      else if (d.type === 'pen') { for (let s = 1; s < P.length && !hit; s++) hit = distSeg(x, y, P[s - 1][0], P[s - 1][1], P[s][0], P[s][1]) < 7; }
      else if (d.type === 'rect') hit = x >= Math.min(x0, x1) - 4 && x <= Math.max(x0, x1) + 4 && y >= Math.min(y0, y1) - 4 && y <= Math.max(y0, y1) + 4;
      else if (d.type === 'fib') hit = x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && FIBS.some(k => { const yy = p2y(d.pts[1].p + (d.pts[0].p - d.pts[1].p) * k); return yy != null && Math.abs(y - yy) < 6; });
      if (hit) return { d, h: -1 };
    }
    return null;
  }
  function hitLine(y) {
    let best = null;
    for (const [k, e] of PL) {
      if (!e.w.drag) continue;
      const yy = p2y(e.w.price); if (yy == null) continue;
      const d = Math.abs(yy - y); if (d < 7 && (!best || d < best.d)) best = { d, key: k, e };
    }
    return best;
  }

  // ---- pointer handling: draw, drag lines / drawings, pick a price or a replay start
  const lock = on => chart.applyOptions({ handleScroll: !on, handleScale: !on });
  const loc = e => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const inPane = (x, y) => x >= 0 && y >= 0 && x < paneW() && y < paneH();
  let PD = null;   // pointer down state
  box.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { x, y } = loc(e);
    if (!inPane(x, y)) return;
    const hadMeasure = !!MEASURE && TOOL !== 'measure';
    if (hadMeasure) { MEASURE = null; prim.req(); }
    if (PICK) { PD = { kind: 'pick', x, y }; return; }
    if (TOOL === 'pen') {
      e.stopPropagation(); e.preventDefault();
      const q = penPt(x, y); if (q) { DRAFT = { type: 'pen', pts: [q] }; PD = { kind: 'pen' }; prim.req(); }
      return;
    }
    if (TWO.has(TOOL) || ONE.has(TOOL)) {
      e.stopPropagation(); e.preventDefault();
      const pt = tp(x, y, ptOpts(e)); if (pt.t == null || pt.p == null) return;
      if (ONE.has(TOOL)) { addDrawing({ type: TOOL, pts: [pt] }); setTool('cursor'); return; }
      if (!DRAFT) { DRAFT = { type: TOOL, pts: [pt, Object.assign({}, pt)] }; PD = { kind: 'draft', x, y }; if (TOOL === 'measure') MEASURE = null; prim.req(); }
      else { DRAFT.pts[1] = pt; finishDraft(); }
      return;
    }
    const L = hitLine(y);
    if (L) { e.stopPropagation(); e.preventDefault(); lock(true); DRAG = { key: L.key, e: L.e, price: L.e.w.price }; PD = { kind: 'line' }; return; }
    const H = hitDrawing(x, y, e.pointerType !== 'mouse');
    if (H) {
      e.stopPropagation(); e.preventDefault(); lock(true);
      SEL = H.d; selUI(); prim.req();
      // grabbing an end: keep the gap between the pointer and the end, so the end doesn't jump to the pointer on the first move
      const g = H.h >= 0 ? [t2x(H.d.pts[H.h].t), p2y(H.d.pts[H.h].p)] : null;
      PD = { kind: 'drawing', h: H.h, d: H.d, t0: x2t(x), p0: y2p(y), off: g && g[0] != null && g[1] != null ? [g[0] - x, g[1] - y] : [0, 0], orig: H.d.pts.map(q => Object.assign({}, q)) };
      return;
    }
    const desel = !!SEL;
    if (SEL) { SEL = null; selUI(); prim.req(); }
    // a plain click / tap on the candles opens the trade menu at that price (on release, if the pointer stayed put) —
    // not when the click only closed a menu, dropped a selection or cleared a measurement
    if (TOOL === 'cursor' || TOOL === 'cross') PD = { kind: 'tap', x, y, at: Date.now(), skip: desel || hadMeasure || Date.now() - MN.closed < 400 };
  }, true);
  window.addEventListener('pointermove', e => {
    const { x, y } = loc(e);
    if (DRAFT && DRAFT.type === 'pen') {
      if (e.pointerType === 'mouse' && !e.buttons) { penEnd(); return; }   // released outside the window
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of evs.length ? evs : [e]) {
        const m = loc(c), L = DRAFT.pts[DRAFT.pts.length - 1];
        if (!inPane(m.x, m.y) || DRAFT.pts.length >= 4000 || Math.hypot(m.x - L.x, m.y - L.y) < 2) continue;
        const q = penPt(m.x, m.y); if (q) DRAFT.pts.push(q);
      }
      prim.req(); return;
    }
    if (DRAFT) { const pt = tp(x, y, ptOpts(e)); if (pt.t != null && pt.p != null) { DRAFT.pts[1] = pt; prim.req(); } return; }
    if (!PD) { hover(x, y); return; }
    if (PD.kind === 'line' && DRAG) {
      const v = rt(y2p(y)); if (!isFinite(v)) return;
      DRAG.price = v; DRAG.e.line.applyOptions({ price: v, title: DRAG.e.w.dragTitle ? DRAG.e.w.dragTitle(v) : DRAG.e.w.title.split(' ')[0] + ' ' + fp(v) });
      ltip.hidden = true;
    } else if (PD.kind === 'drawing') {
      const d = PD.d;
      if (PD.h >= 0) { const pt = tp(x + PD.off[0], y + PD.off[1], ptOpts(e)); if (pt.t != null && pt.p != null) d.pts[PD.h] = pt; }
      else {
        const t = x2t(x), p = y2p(y); if (t == null || p == null) return;
        const dt = t - PD.t0, dp = p - PD.p0;
        d.pts = PD.orig.map(q => ({ t: q.t + dt, p: q.p + dp }));
      }
      prim.req();
    }
  });
  window.addEventListener('pointercancel', () => { if (DRAFT && DRAFT.type === 'pen') penEnd(); });
  window.addEventListener('pointerup', e => {
    const { x, y } = loc(e);
    if (DRAFT && DRAFT.type === 'pen') { penEnd(); return; }
    // press-drag-release draws in one go; a plain click leaves the draft open for a second click
    if (DRAFT && PD && PD.kind === 'draft') { const d0 = PD; PD = null; if (Math.hypot(x - d0.x, y - d0.y) > 8) finishDraft(); return; }
    if (!PD) return;
    const pd = PD; PD = null;
    if (pd.kind === 'pick') { if (Math.hypot(x - pd.x, y - pd.y) < 6) doPick(x, y); return; }
    if (pd.kind === 'tap') {
      if (!pd.skip && Math.hypot(x - pd.x, y - pd.y) < 5 && Date.now() - pd.at < 600 && Date.now() - LP.at > 900 && !PICK && !DRAFT && !MN.el && inPane(x, y)) menuOpen(x, y, snapAt(x, y));
      return;
    }
    if (pd.kind === 'line' && DRAG) {
      lock(drawTool(TOOL));
      const w = DRAG.e.w, v = DRAG.price; DRAG = null;
      if (w.drag.ticket) { w.drag.set(v); renderTicket(); }
      else if (w.drag.commit) w.drag.commit(v);   // the admin layer asks before it changes a real order
      else if (w.drag.ok(v)) { w.drag.set(v); changed(); }
      else { toast(w.drag.bad, 'down'); }
      syncLines();
      return;
    }
    if (pd.kind === 'drawing') { lock(false); saveDraw(); prim.req(); }
  });
  // hovering a trade line (or its price label) shows what it means in dollars
  const ltip = document.createElement('div');
  ltip.className = 'dk-ltip'; ltip.hidden = true; ltip.setAttribute('role', 'tooltip');
  $('.dk-chart').appendChild(ltip);
  function lineTip(x, y) {
    let best = null, bd = 7;
    if (!PD && !PICK && !DRAFT && x >= 0 && y >= 0 && x < box.clientWidth && y < paneH()) {
      for (const [, e] of PL) { if (!e.w.tip) continue; const yy = p2y(e.w.price); if (yy == null) continue; const d = Math.abs(yy - y); if (d < bd) { bd = d; best = e; } }
    }
    if (!best) { ltip.hidden = true; return; }
    const html = typeof best.w.tip === 'function' ? best.w.tip() : best.w.tip;
    if (ltip._h !== html) { ltip.innerHTML = html; ltip._h = html; }
    ltip.hidden = false;
    const W = box.clientWidth, w = ltip.offsetWidth, h = ltip.offsetHeight, yy = p2y(best.w.price);
    ltip.style.left = Math.max(6, Math.min(W - w - 6, x + 18 + w > W - 70 ? x - w - 18 : x + 18)) + 'px';
    ltip.style.top = Math.max(6, yy - h - 10 < 6 ? yy + 12 : yy - h - 10) + 'px';
  }
  // while you pick a price on the chart: a line follows the pointer and says what it will be (BUY LIMIT 0.7254 −1.6%),
  // greyed out with the reason when that price can't be used
  const GH = document.createElement('div');
  GH.className = 'dk-ghost'; GH.hidden = true; GH.setAttribute('aria-hidden', 'true'); GH.innerHTML = '<span></span>';
  $('.dk-chart').appendChild(GH);
  function ghostAt(x, y) {
    if (!PICK || PICK.kind === 'replay' || x == null || !inPane(x, y) || !S.lastPx) { GH.hidden = true; return; }
    const sp = snapAt(x, y); if (!sp) { GH.hidden = true; return; }
    const v = sp.p, yy = p2y(v); if (yy == null) { GH.hidden = true; return; }
    const px = S.lastPx, f = PICK.field, from = (a, b) => pct((a / b - 1) * 100);
    let lab, tone = '', bad = '';
    if (f === 'q-entry') {
      const s = Q.side, k = s === 1 ? (v < px ? 'limit' : 'stop') : (v > px ? 'limit' : 'stop');
      lab = `${s === 1 ? 'BUY' : 'SELL'} ${k.toUpperCase()} ${fp(v)} · ${from(v, px)}`; tone = s === 1 ? 'up' : 'down';
      bad = qEntryBad(v) ? 'at the price' : '';
    } else if (f === 'q-sl') {
      const e = qEntry(), s = Q.side || (v < e ? 1 : -1);
      lab = `STOP ${fp(v)} · ${from(v, e)}${Q.side ? '' : s === 1 ? ' · long' : ' · short'}`; tone = 'down';
      if (Q.side && !okFor(Q.side, e, v, true)) bad = `${Q.side === 1 ? 'below' : 'above'} the entry`;
    } else if (f === 'q-tp') {
      const e = qEntry(), r = Q.sl != null ? Math.abs(v - e) / Math.abs(e - Q.sl) : null;
      lab = `TARGET ${fp(v)} · ${from(v, e)}${r ? ' · ' + r.toFixed(2) + 'R' : ''}`; tone = 'up';
      if (!okFor(qSide(), e, v, false)) bad = `${qSide() === 1 ? 'above' : 'below'} the entry`;
    } else lab = `${String(PICK.label || { price: 'limit price', sl: 'stop', tp: 'target' }[f] || 'price').toUpperCase()} ${fp(v)} · ${from(v, px)}`;
    GH.className = 'dk-ghost' + (tone ? ' ' + tone : '') + (bad ? ' bad' : '');
    GH.firstChild.textContent = bad ? `${lab} — ${bad}` : lab;
    GH.style.left = box.offsetLeft + 'px'; GH.style.width = paneW() + 'px'; GH.style.top = (box.offsetTop + yy) + 'px';
    GH.hidden = false;
  }
  box.addEventListener('pointerleave', () => { ltip.hidden = true; GH.hidden = true; });
  function hover(x, y) {
    lineTip(x, y); plusAt(x, y); ghostAt(x, y);
    let c = '';
    if (PICK) c = 'c-pick';
    else if (drawTool(TOOL)) c = 'c-draw';
    else if (inPane(x, y) && hitLine(y)) c = 'c-ns';
    else if (inPane(x, y) && hitDrawing(x, y, false)) c = 'c-move';
    else if (TOOL === 'cross') c = 'c-cross';
    box.className = 'dk-canvas' + (c ? ' ' + c : '');
  }
  function finishDraft() {
    const d = DRAFT; DRAFT = null;
    if (d.type === 'measure') { MEASURE = d; setTool('cursor'); prim.req(); return; }
    addDrawing(d); setTool('cursor');
  }
  function addDrawing(d) {
    const o = { id: Date.now() + Math.random(), type: d.type, pts: d.pts.map(q => ({ t: q.t, p: q.p })) };
    (DRAW[U.sym] = DRAW[U.sym] || []).push(o);
    if (DRAW[U.sym].length > 200) DRAW[U.sym].shift();
    saveDraw(); prim.req();
    return o;
  }
  // ---- pencil: one stroke per press. Stored as time + price, so it stays on its candles when the chart moves
  function penPt(x, y) { const t = x2tExact(x), p = y2p(y); return t == null || p == null ? null : { t: Math.round(t), p: +p.toPrecision(8), x, y }; }
  function penThin(P, eps) {   // keeps the points that shape the line (Ramer–Douglas–Peucker, in screen pixels)
    const keep = new Uint8Array(P.length), todo = [[0, P.length - 1]]; keep[0] = keep[P.length - 1] = 1;
    while (todo.length) {
      const [a, b] = todo.pop(); let m = -1, far = eps;
      for (let i = a + 1; i < b; i++) { const d = distSeg(P[i].x, P[i].y, P[a].x, P[a].y, P[b].x, P[b].y); if (d > far) { far = d; m = i; } }
      if (m >= 0) { keep[m] = 1; todo.push([a, m], [m, b]); }
    }
    return P.filter((q, i) => keep[i]);
  }
  function penEnd() {
    const d = DRAFT; DRAFT = null; PD = null;
    if (d && d.pts.length >= 2) { let eps = 0.6, pts = penThin(d.pts, eps); while (pts.length > 240) { eps *= 1.5; pts = penThin(d.pts, eps); } PENS.push(addDrawing({ type: 'pen', pts }).id); }
    prim.req();
  }
  function penUndo() { const id = PENS.pop(); if (id == null) return; DRAW[U.sym] = (DRAW[U.sym] || []).filter(d => d.id !== id); saveDraw(); prim.req(); }
  // arrow keys on a selected drawing: ← → one candle, ↑ ↓ one pixel of price (Shift: 10)
  function nudgeSel(k, big) {
    const d = SEL; if (!d) return; const n = big ? 10 : 1;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const s = (k === 'ArrowRight' ? 1 : -1) * n;
      d.pts = d.pts.map(q => { const l = t2l(q.t), t = l == null ? null : l2t(l + s); return { t: t == null ? q.t : Math.round(t), p: q.p }; });
    } else {
      const dy = (k === 'ArrowUp' ? -1 : 1) * n;
      d.pts = d.pts.map(q => { const y = p2y(q.p), p = y == null ? null : y2p(y + dy); return { t: q.t, p: p == null || !isFinite(p) ? q.p : +p.toPrecision(10) }; });
    }
    saveDraw(); prim.req();
  }
  function removeSel() { if (!SEL) return; DRAW[U.sym] = (DRAW[U.sym] || []).filter(d => d !== SEL); SEL = null; saveDraw(); selUI(); prim.req(); }
  function setTool(t) {
    if (t === 'magnet') { U.magnet = !U.magnet; saveUI(); toolUI(); toast(U.magnet ? `Magnet on: a point near a candle's open / high / low / close snaps to it${phone() ? '' : ` · hold ${MODK} to place it freely`}` : `Magnet off${phone() ? '' : ` · hold ${MODK} to snap for a moment`}`); return; }
    if (t === 'clear') { hint(`Remove all ${(DRAW[U.sym] || []).length} drawings on ${esc(U.sym)}?`, [['Remove', () => { DRAW[U.sym] = []; SEL = null; saveDraw(); prim.req(); hint(); }], ['Cancel', () => hint()]]); return; }
    TOOL = t; DRAFT = null; PENS = []; lock(drawTool(t)); toolUI();
    if (t === 'pen') hint('Pencil: drag on the chart to draw', [['Undo', penUndo], ['Done', () => setTool('cursor')]]);
    else if (t !== 'cursor' && t !== 'cross') { hint(`${{ trend: 'Trend line', hline: 'Horizontal line', ray: 'Horizontal ray', rect: 'Rectangle', fib: 'Fibonacci', measure: 'Measure' }[t]}: ${ONE.has(t) ? 'tap the chart at the price' : 'drag across the chart, or tap two points'}`, [['Cancel', () => setTool('cursor')]]); }
    else hint();
    if (phone()) root.classList.toggle('tools-open', false);
    prim.req();
  }
  // phones: otherwise the browser takes a finger drag for scrolling and cancels the stroke after a few points
  const touchUI = () => { box.style.touchAction = drawTool(TOOL) || SEL ? 'none' : ''; };
  function toolUI() { $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === TOOL || (b.dataset.tool === 'magnet' && U.magnet))); touchUI(); }
  const hintEl = $('[data-hint]');
  function hint(text, btns) {
    if (!text) { hintEl.hidden = true; hintEl.innerHTML = ''; return; }
    hintEl.innerHTML = `<span>${text}</span>${(btns || []).map((b, i) => `<button type="button" data-h="${i}">${esc(b[0])}</button>`).join('')}`;
    hintEl.hidden = false; hintEl._b = btns || [];
  }
  hintEl.addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (b && hintEl._b[+b.dataset.h]) hintEl._b[+b.dataset.h][1](); });
  function selUI() { touchUI(); if (SEL) hint(phone() ? 'Drawing selected' : 'Drawing selected · arrow keys nudge it', [['Delete', removeSel], ['Done', () => { SEL = null; touchUI(); prim.req(); hint(); }]]); else if (!PICK && TOOL === 'cursor') hint(); }

  // pick a price for the ticket, or a candle to start the replay from
  // cb (admin layer): the picked price goes to cb instead of the paper ticket; field names the button that lights up
  function startPick(kind, field, cb, label, quiet) {
    PICK = { kind, field, cb, label };
    if (phone()) closeSheets();
    if (!quiet) hint(kind === 'replay' ? 'Scroll back and click the candle where the replay should start' : `Click the chart to set the ${label || { price: 'limit price', sl: 'stop', tp: 'target' }[field]}`, [['Cancel', clearPick]]);
    $$('.pick').forEach(b => b.classList.toggle('on', (b.dataset.pickF || b.dataset.pickX) === field));
  }
  function clearPick() { PICK = null; $$('.pick').forEach(b => b.classList.remove('on')); hint(); box.className = 'dk-canvas'; GH.hidden = true; }
  function doPick(x, y) {
    const pk = PICK; clearPick();
    if (pk.kind === 'replay') { const t = x2t(x); if (t != null) enterReplay(t); return; }
    const sp = snapAt(x, y), v = sp ? sp.p : rt(y2p(y)); if (!isFinite(v)) return;
    if (pk.cb) { pk.cb(v); return; }
    fld(pk.field).value = v; renderTicket(); syncLines();
    if (phone()) openSheet('trade');
  }

  // ------------------------------------------------------------------ trading on the chart
  // + beside the price axis, right-click (long-press on a phone) anywhere on the candles: a menu for that price — paper buy /
  // sell limit or stop entry, move this coin's stop / target / order there, close, fill the ticket, a level. ⚡ Plan: entry →
  // stop → target picked on the chart, then one confirm. Buy / Sell buttons on the chart: a paper market order with the
  // ticket's size. The admin layer adds its real-money section to the menu (X.menu) and takes a real plan or a real Buy /
  // Sell to its review dialog (X.quickReal) — no real order is ever placed from here without that dialog.
  const chartEl = $('.dk-chart');
  const okFor = (side, entry, v, isSl) => v != null && !isNaN(v) && entry > 0 && (isSl ? (side === 1 ? v < entry : v > entry) : (side === 1 ? v > entry : v < entry));
  const realOn = () => !!(X.quickReal && X.realActive && X.realActive() && !R.on && U.ex !== 'fx');
  function paperCheck(o) {
    const px = S.lastPx;
    if (!px) return 'Wait for the chart to load.';
    const entry = o.kind === 'market' ? px : o.price;
    if (!(o.margin > 0)) return 'Set the margin in the Trade panel first.';
    if (o.margin > avail() + 1e-9) return `Only ${money(avail())} of the paper balance is free.`;
    if (o.kind === 'limit' && (o.side === 1 ? o.price >= px : o.price <= px)) return o.side === 1 ? 'A buy limit goes below the price now.' : 'A sell limit goes above the price now.';
    if (o.kind === 'stop' && (o.side === 1 ? o.price <= px : o.price >= px)) return o.side === 1 ? 'A buy stop goes above the price now.' : 'A sell stop goes below the price now.';
    if (o.sl != null && !okFor(o.side, entry, o.sl, true)) return o.side === 1 ? 'A long needs its stop below the entry.' : 'A short needs its stop above the entry.';
    if (o.tp != null && !okFor(o.side, entry, o.tp, false)) return o.side === 1 ? 'A long needs its target above the entry.' : 'A short needs its target below the entry.';
    if (o.sl != null) { const lq = liqOf(o.side, entry, o.lev); if (o.side === 1 ? o.sl <= lq : o.sl >= lq) return `Liquidation (${fp(lq)}) comes before this stop — lower the leverage.`; }
    return '';
  }
  function paperSubmit(o) {
    const err = paperCheck(o); if (err) { toast(err, 'down'); return false; }
    U.margin = o.margin; U.lev = o.lev; saveUI();
    const base = { sym: U.sym, ex: U.ex, side: o.side, margin: o.margin, lev: o.lev, sl: o.sl || null, tp: o.tp || null, mode: mode() };
    const nm = o.side === 1 ? 'long' : 'short', extra = `${o.sl ? ' · stop ' + fp(o.sl) : ''}${o.tp ? ' · target ' + fp(o.tp) : ''}`;
    if (o.kind === 'market') { const p = P.open(base, S.lastPx, nowT(), false); toast(`Paper ${nm} opened: ${fq(p.qty)} ${coin(U.sym)} at ${fp(S.lastPx)}${extra}`, 'up'); }
    else {
      A.ord.push(Object.assign(base, { id: A.seq++, price: o.price, kind: o.kind === 'stop' ? 'stop' : undefined, t: nowT() }));
      if (base.mode === 'live') { const key = U.sym + '|' + U.ex; if (!A.seen[key]) A.seen[key] = floorTo(Date.now(), MIN); }
      changed(); toast(`Paper ${o.side === 1 ? 'buy' : 'sell'} ${o.kind} placed at ${fp(o.price)}${extra}`);
    }
    syncLines(); return true;
  }
  // the price under the pointer, snapped to the candle's high / low / close / open within 9 px
  function snapAt(x, y) {
    let p = y2p(y); if (p == null || !isFinite(p)) return null;
    let what = 'chart price';
    const t = x2t(x), b = t != null ? S.bars[Math.round(t2l(t))] : null;
    if (b && b[0] === t) { let best = 9; for (const [i, lab] of [[2, 'candle high'], [3, 'candle low'], [4, 'candle close'], [1, 'candle open']]) { const yy = p2y(b[i]); if (yy == null) continue; const d = Math.abs(yy - y); if (d < best) { best = d; p = b[i]; what = lab; } } }
    return { p: rt(p), what, t };
  }
  async function copyPrice(v) {
    try { await navigator.clipboard.writeText(String(v)); toast(`Copied ${v}`); } catch (e) { toast(`Price ${v} — the browser blocked copying.`, 'down'); }
  }

  // ---- the menu
  const MN = { el: null, acts: [], at: 0, closed: 0 };
  function menuClose() { if (MN.el) { MN.el.remove(); MN.el = null; MN.acts = []; } }
  function menuOpen(x, y, sp) {
    menuClose(); plus.hidden = true; ltip.hidden = true;
    if (!sp || !S.lastPx) return;
    const v = sp.p, px = S.lastPx, below = v < px, md = mode(), t = readT(), acts = [];
    const sz = t.margin > 0 ? `${money(t.margin)} × ${t.lev}×` : 'set a margin';
    const item = (label, sub, run, o = {}) => { acts.push(run); return `<button type="button" role="menuitem" class="mi${o.tone ? ' ' + o.tone : ''}${o.cls ? ' ' + o.cls : ''}" data-mi="${acts.length - 1}"${o.dis ? ' disabled' : ''}>${o.icon ? ic(o.icon) : '<i class="mi-i"></i>'}<span>${label}</span>${sub ? `<em>${sub}</em>` : ''}</button>`; };
    const chips = (label, list, o = {}) => `<div class="mi-chips${o.tone ? ' ' + o.tone : ''}">${o.icon ? ic(o.icon) : '<i class="mi-i"></i>'}<span>${label}</span><span class="mi-cr">${list.map(([t, run]) => { acts.push(run); return `<button type="button" class="mi-c" data-mi="${acts.length - 1}"${o.dis ? ' disabled' : ''}>${t}</button>`; }).join('')}</span></div>`;
    const sec = (head, items, cls) => (items.filter(Boolean).length ? `<div class="tm-sec${cls ? ' ' + cls : ''}">${head ? `<p class="tm-h2">${head}</p>` : ''}${items.filter(Boolean).join('')}</div>` : '');
    const withTk = side => ({ sl: okFor(side, v, t.sl, true) ? t.sl : null, tp: okFor(side, v, t.tp, false) ? t.tp : null });
    const tkNote = side => { const w = withTk(side); return [w.sl && 'stop ' + fp(w.sl), w.tp && 'target ' + fp(w.tp)].filter(Boolean).join(' · '); };
    const order = (side, kind) => () => paperSubmit(Object.assign({ side, kind, price: v, margin: t.margin, lev: t.lev }, withTk(side)));
    // what is open or waiting on this coin first
    const mine = [];
    for (const p of A.pos.filter(q => q.sym === U.sym && q.mode === md).slice(0, 2)) {
      const L = p.side === 1, m = markOf(p), at = w => p.side * (w - p.entry) * p.qty, nm = `${L ? 'long' : 'short'}`;
      mine.push(`<p class="tm-h2">Paper ${nm} · ${fq(p.qty)} at ${fp(p.entry)} · <span class="${upnl(p) >= 0 ? 'up' : 'down'}">${money(upnl(p), true)}</span></p>`);
      if ((L ? v < m : v > m) && (L ? v > p.liq : v < p.liq)) mine.push(item(`Move stop to ${fp(v)}`, `if hit ${money(at(v), true)}`, () => { p.sl = v; changed(); toast(`Stop moved to ${fp(v)}.`); }, { icon: 'shield', tone: 'warn' }));
      if (L ? v > m : v < m) mine.push(item(`Move target to ${fp(v)}`, `if hit ${money(at(v), true)}`, () => { p.tp = v; changed(); toast(`Target moved to ${fp(v)}.`); }, { icon: 'target', tone: 'up' }));
      mine.push(item(`Close the ${nm} at market`, money(upnl(p), true), () => { const mk = markOf(p); if (mk != null) P.close(p, mk, p.mode === 'replay' ? R.clock : Date.now(), 'Closed by you'); }, { icon: 'circle-x', tone: 'down' }));
    }
    for (const o of A.ord.filter(q => q.sym === U.sym && q.mode === md).slice(0, 2)) {
      const L = o.side === 1, stp = o.kind === 'stop', nm = `${L ? 'buy' : 'sell'} ${stp ? 'stop' : 'limit'}`;
      const ok = (stp ? (L ? v > px : v < px) : (L ? v < px : v > px)) && (o.sl == null || (L ? o.sl < v : o.sl > v)) && (o.tp == null || (L ? o.tp > v : o.tp < v));
      mine.push(`<p class="tm-h2">Paper ${nm} at ${fp(o.price)}</p>`);
      if (ok) mine.push(item(`Move the ${nm} to ${fp(v)}`, '', () => { o.price = v; changed(); toast(`Order moved to ${fp(v)}.`); }, { icon: 'crosshair' }));
      mine.push(item('Cancel the order', '', () => { A.ord = A.ord.filter(q => q !== o); changed(); toast('Order cancelled.'); }, { icon: 'circle-x', tone: 'down' }));
    }
    // ⚡ first, like the classic chart: entry here → click the stop → click the target. Real when the Real ticket is the
    // one in use (you review the bot's exact order before anything is placed), paper otherwise.
    const realFirst = realOn(), busy = realFirst && X.realBusy ? X.realBusy() : '';
    const plan = sec(`New order at ${fp(v)}${realFirst ? ' · <span class="down">real money</span>' : R.on ? ' · replay' : ''}<span class="tm-sz">${realFirst ? 'size: Real ticket' : sz}</span>`, [
      item('⚡ Entry here → stop → target', busy ? `${busy} — one real trade per coin` : realFirst ? `then click your stop (${below ? 'below = long' : 'above = short'}) and target · you review the bot's order, then Place`
        : 'then click your stop and target on the chart: below the entry = long, above = short', () => qStart(v, realFirst), { icon: 'zap', tone: 'warn', cls: 'mi-main', dis: !!busy }),
    ], 'tm-new');
    const paper = sec(`Paper${R.on ? ' · replay' : ''} · one click${realFirst ? ` <span class="tm-sz">${sz}</span>` : ''}`, [
      below ? item(`Buy limit ${fp(v)}`, tkNote(1) || 'long when price dips here', order(1, 'limit'), { icon: 'arrow-up-right', tone: 'up' })
        : item(`Sell limit ${fp(v)}`, tkNote(-1) || 'short when price rises here', order(-1, 'limit'), { icon: 'arrow-down-right', tone: 'down' }),
      below ? item(`Sell stop ${fp(v)}`, tkNote(-1) || 'short if price falls to here', order(-1, 'stop'), { icon: 'arrow-down-right', tone: 'down' })
        : item(`Buy stop ${fp(v)}`, tkNote(1) || 'long if price breaks up to here', order(1, 'stop'), { icon: 'arrow-up-right', tone: 'up' }),
    ]);
    const ctx = { price: v, px, below, sym: U.sym, ex: U.ex, replay: R.on, realFirst, item, chips, sec };
    const ext = [];
    for (const f of X.menu) { try { const s = f(ctx); if (s) ext.push(s); } catch (e) { console.error(e); } }
    const tools = sec('', [
      chips('Paper ticket:', [['Limit', () => { T.type = 'limit'; fld('price').value = v; renderTicket(); syncLines(); showTicket(); }],
        ['Stop', () => { fld('sl').value = v; renderTicket(); syncLines(); showTicket(); }], ['Target', () => { fld('tp').value = v; renderTicket(); syncLines(); showTicket(); }]], { icon: 'crosshair' }),
      chips('Chart:', [['Line', () => addDrawing({ type: 'hline', pts: [{ t: sp.t != null ? sp.t : lastBar()[0], p: v }] })], ['Copy', () => copyPrice(v)]]
        .concat(X.chartChips.map(f => { try { return f(v); } catch (e) { console.error(e); return null; } }).filter(Boolean)), { icon: 'minus' }),
    ], 'tm-tools');
    const el = document.createElement('div');
    el.className = 'dk-tmenu'; el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'Trade at ' + fp(v));
    el.innerHTML = `<div class="tm-head"><b class="mono">${fp(v)}</b><span>${pct((v / px - 1) * 100)} from the price · ${esc(sp.what)}</span><button type="button" class="tm-x" data-mx aria-label="Close">${ic('x')}</button></div>` +
      (mine.length ? `<div class="tm-sec">${mine.join('')}</div>` : '') + plan + (realFirst ? ext.join('') + paper : paper + ext.join('')) + tools;
    MN.acts = acts; MN.el = el; MN.at = Date.now();
    chartEl.appendChild(el);
    const W = chartEl.clientWidth, H = chartEl.clientHeight, w = el.offsetWidth, h = el.offsetHeight, ox = box.offsetLeft, oy = box.offsetTop;
    let lx = ox + x + 10, ly = oy + y + 10;
    if (lx + w > W - 6) lx = Math.max(6, ox + x - w - 10);
    if (ly + h > H - 6) ly = Math.max(6, H - h - 6);
    el.style.left = lx + 'px'; el.style.top = ly + 'px';
    const first = el.querySelector('.mi:not([disabled]), .mi-c:not([disabled])'); if (first) first.focus({ preventScroll: true });
    el.addEventListener('click', e => { if (e.target.closest('[data-mx]')) { menuClose(); return; } const b = e.target.closest('[data-mi]'); if (!b || b.disabled) return; const f = MN.acts[+b.dataset.mi]; menuClose(); if (f) f(); });
    el.addEventListener('keydown', e => {
      const items = $$('.mi:not([disabled]), .mi-c:not([disabled])', el), i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); menuClose(); }
    });
  }
  function showTicket() { if (phone()) openSheet('trade'); else sideTab('trade'); }
  document.addEventListener('pointerdown', e => { if (MN.el && !MN.el.contains(e.target)) { menuClose(); MN.closed = Date.now(); } }, true);
  box.addEventListener('contextmenu', e => {
    const { x, y } = loc(e); if (!inPane(x, y)) return;
    e.preventDefault();
    if (Date.now() - LP.at < 900 || (Q.on && Q.stage !== 'ask')) return;   // a long-press already opened it · a plan is waiting for a click
    if (DRAFT || (TOOL !== 'cursor' && TOOL !== 'cross')) setTool('cursor');
    if (PICK) clearPick();
    menuOpen(x, y, snapAt(x, y));
  });
  // a long press on a touch screen (iOS has no contextmenu)
  const LP = { t: null, x: 0, y: 0, at: 0 };
  function lpStart(x, y) { lpStop(); Object.assign(LP, { x, y, t: setTimeout(() => { LP.t = null; if (PD && PD.kind && PD.kind !== 'tap') return; LP.at = Date.now(); menuOpen(LP.x, LP.y, snapAt(LP.x, LP.y)); try { navigator.vibrate && navigator.vibrate(10); } catch (e) { /* none */ } }, 550) }); }
  function lpStop() { if (LP.t) { clearTimeout(LP.t); LP.t = null; } }
  box.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse' && !PICK && !DRAFT && (TOOL === 'cursor' || TOOL === 'cross')) { const { x, y } = loc(e); if (inPane(x, y)) lpStart(x, y); } });
  window.addEventListener('pointermove', e => { if (LP.t) { const { x, y } = loc(e); if (Math.hypot(x - LP.x, y - LP.y) > 8) lpStop(); } }, true);
  window.addEventListener('pointerup', lpStop, true); window.addEventListener('pointercancel', lpStop, true);

  // ---- + beside the price axis, at the pointer's price (like TradingView)
  const plus = document.createElement('button');
  plus.type = 'button'; plus.className = 'dk-plus'; plus.hidden = true; plus.textContent = '+';
  plus.setAttribute('aria-label', 'Trade at this price'); plus.title = 'Trade at this price (or right-click the chart)';
  chartEl.appendChild(plus);
  let plusY = null;
  function plusAt(x, y) {
    const ok = x != null && inPane(x, y) && !PICK && !DRAFT && !DRAG && (TOOL === 'cursor' || TOOL === 'cross') && !MN.el && !phone() && S.lastPx;
    if (!ok) { if (!plus.matches(':hover')) plus.hidden = true; return; }
    if (plus.matches(':hover')) return;   // stays put while you aim at it
    plusY = y; plus.hidden = false;
    plus.style.top = (box.offsetTop + y - 9) + 'px'; plus.style.left = (box.offsetLeft + paneW() - 22) + 'px';
  }
  plus.addEventListener('pointerdown', e => e.stopPropagation());
  plus.addEventListener('click', e => { e.stopPropagation(); if (plusY == null) return; const p = y2p(plusY); if (p == null) return; menuOpen(paneW() - 30, plusY, { p: rt(p), what: 'chart price', t: null }); });
  chartEl.addEventListener('pointerleave', () => { plus.hidden = true; });

  // ---- ⚡ plan: entry → stop → target, then confirm
  // Started from a price (the menu): the side follows the stop — below the entry = long. Started from the chart's Buy / Sell
  // in Limit mode (qStartSide): the side is fixed and the first click on the chart is the entry.
  const qEntry = () => (Q.mkt ? S.lastPx : Q.entry);
  const qSide = () => Q.side || (Q.sl != null && Q.sl < qEntry() ? 1 : -1);
  const qKind = () => { if (Q.mkt) return 'market'; const px = S.lastPx, s = qSide(); return s === 1 ? (Q.entry < px ? 'limit' : 'stop') : (Q.entry > px ? 'limit' : 'stop'); };
  function qStart(v, real) {
    qEnd(); menuClose();
    if (!S.lastPx) return;
    const t = readT();
    Object.assign(Q, { on: true, stage: 'sl', side: 0, entry: v, sl: null, tp: null, mkt: false, real: !!real && !!X.quickReal && !R.on, margin: t.margin > 0 ? t.margin : U.margin, lev: t.lev || U.lev });
    if (Q.real) qRealSize();
    qPick(); qRender(); syncLines();
    if (phone()) closeSheets();
  }
  function qPlan(o) {
    qEnd(); menuClose();
    if (!S.lastPx) return;
    const t = readT();
    Object.assign(Q, { on: true, stage: 'ask', side: o.side, entry: o.entry, sl: o.sl, tp: o.tp, mkt: !!o.mkt, real: false, margin: t.margin > 0 ? t.margin : U.margin, lev: t.lev || U.lev });
    qPick(); qRender(); syncLines(); qtUI();
    if (phone()) closeSheets();
  }
  // a real plan starts from the Real ticket's margin × leverage (blank = the saved /long · /short size)
  function qRealSize() { const rs = X.realSize ? X.realSize() : {}; Q.margin = rs.margin || null; Q.lev = rs.lev || null; }
  function qStartSide(side, real) {
    qEnd(); menuClose();
    if (!S.lastPx) return;
    const t = readT();
    Object.assign(Q, { on: true, stage: 'entry', side, entry: null, sl: null, tp: null, mkt: false, real: !!real && !!X.quickReal && !R.on, margin: t.margin > 0 ? t.margin : U.margin, lev: t.lev || U.lev });
    if (Q.real) qRealSize();
    qPick(); qRender(); syncLines(); qtUI();
    if (phone()) closeSheets();
  }
  // an entry has to be away from the price now: on the far side it is a limit, on the near side a stop entry (paper and real)
  const qEntryBad = v => { const px = S.lastPx; if (!px || !Q.side) return ''; if (Math.abs(v / px - 1) < 2e-4) return 'That is the price now — click away from it, or use Market now.'; return ''; };
  function qPick() {
    if (Q.stage === 'entry') startPick('field', 'q-entry', w => qSet('entry', w), 'entry', true);
    else if (Q.stage === 'sl') startPick('field', 'q-sl', w => qSet('sl', w), 'stop', true);
    else if (Q.stage === 'tp') startPick('field', 'q-tp', w => qSet('tp', w), 'target', true);
    else if (PICK && /^q-/.test(PICK.field || '')) clearPick();
  }
  function qSet(k, v) {
    if (!Q.on) return;
    if (k === 'entry') {
      const bad = qEntryBad(v); if (bad) { toast(bad, 'down'); return qPick(); }
      Q.entry = v; Q.stage = 'sl';
    } else if (k === 'sl') {
      if (Math.abs(v / qEntry() - 1) < 1e-4) { toast(Q.side ? `That is the entry itself: the stop goes ${Q.side === 1 ? 'below' : 'above'} it.` : 'That is the entry itself: click below it for a long, above it for a short.', 'down'); return qPick(); }
      if (Q.side && !okFor(Q.side, qEntry(), v, true)) { toast(`The stop of a ${Q.side === 1 ? 'long' : 'short'} goes ${Q.side === 1 ? 'below' : 'above'} the entry (${fp(qEntry())}).`, 'down'); return qPick(); }
      Q.sl = v;
      if (Q.tp != null && !okFor(qSide(), qEntry(), Q.tp, false)) Q.tp = null;
      Q.stage = Q.tp != null ? 'ask' : 'tp';
    } else {
      if (!okFor(qSide(), qEntry(), v, false)) { toast(`The target goes ${qSide() === 1 ? 'above' : 'below'} the entry for a ${qSide() === 1 ? 'long' : 'short'}.`, 'down'); return qPick(); }
      Q.tp = v; Q.stage = 'ask';
    }
    qPick(); qRender(); syncLines();
  }
  function qEnd() {
    if (!Q.on) return;
    Q.on = false; Q.stage = ''; Q.side = 0;
    if (Q.el) { Q.el.remove(); Q.el = null; }
    if (PICK && /^q-/.test(PICK.field || '')) clearPick();
    syncLines(); qtUI();
  }
  function qOrder() { return { side: qSide(), kind: qKind(), price: qEntry(), sl: Q.sl, tp: Q.tp, margin: Q.margin, lev: Q.lev }; }
  function qRender() {
    if (!Q.on) return;
    if (!Q.el) {
      Q.el = document.createElement('div'); Q.el.className = 'dk-qbar'; Q.el.setAttribute('role', 'dialog'); Q.el.setAttribute('aria-label', 'Plan a trade');
      chartEl.appendChild(Q.el);
      Q.el.addEventListener('click', qClick);
      Q.el.addEventListener('input', e => { const f = e.target.dataset.qf; if (!f) return; const n = num(e.target.value); Q[f] = n == null && Q.real ? null : f === 'lev' ? Math.max(1, Math.min(125, Math.round(n) || 1)) : n; qRead(); });
      Q.el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.qf) { e.preventDefault(); const b = Q.el.querySelector('[data-q="go"]'); if (b && !b.disabled) b.click(); } });
    }
    const s = Q.side || (Q.sl != null ? qSide() : 0), hasE = Q.mkt || Q.entry != null;
    const kind = Q.mkt ? 'market' : s && hasE ? qKind() : Q.side ? 'order' : '';
    const kName = s ? `${s === 1 ? 'Buy' : 'Sell'} ${kind === 'market' ? 'at market' : kind}` : (Q.mkt ? 'Market' : 'Entry');
    const step = (n, lab, val, now) => `<span class="${val != null ? 'done' : now ? 'cur' : ''}">${n} ${lab}${val != null ? ' <b class="mono">' + fp(val) + '</b>' : ''}</span>`;
    const canReal = !!X.quickReal && !R.on;
    const B = s === 1 ? 'buy' : 'sell', below = s === 1 ? 'below' : 'above', above = s === 1 ? 'above' : 'below';
    let h = `<div class="qb-top"><b class="${s === 1 ? 'up' : s === -1 ? 'down' : ''}">${ic('zap')} ${s ? (s === 1 ? 'LONG' : 'SHORT') + ' · ' : ''}${kName} ${hasE && !Q.mkt ? fp(Q.entry) : ''}</b>` +
      (canReal ? `<span class="qb-mode" role="radiogroup"><button type="button" data-q="paper" aria-checked="${!Q.real}"${!Q.real ? ' class="on"' : ''}>Paper</button><button type="button" data-q="real" class="${Q.real ? 'on real' : 'real'}" aria-checked="${Q.real}">Real</button></span>` : '<span class="qb-tag">Paper</span>') +
      `<button type="button" class="qb-x" data-q="x" aria-label="Cancel the plan">${ic('x')}</button></div>` +
      `<div class="qb-steps">${step('①', Q.mkt ? 'Market' : 'Entry', Q.mkt ? null : Q.entry, Q.stage === 'entry')}${step('②', 'Stop', Q.sl, Q.stage === 'sl')}${step('③', 'Target', Q.tp, Q.stage === 'tp')}</div>`;
    if (Q.stage === 'entry') h += `<p class="qb-say">${phone() ? 'Tap' : 'Click'} your <b>${B} price</b> on the chart — ${below} the price for a ${B} limit, ${above} it for a ${B} stop.</p><div class="qb-row"><button type="button" class="btn btn-ghost btn-sm" data-q="mktnow">Market now instead</button></div>`;
    else if (Q.stage === 'sl') h += `<p class="qb-say">${phone() ? 'Tap' : 'Click'} your <b>stop</b> on the chart — ${Q.side ? `${below} the entry` : 'below the entry for a long, above it for a short'}.</p>`;
    else if (Q.stage === 'tp') h += `<p class="qb-say">${phone() ? 'Tap' : 'Click'} your <b>target</b> on the chart (${s === 1 ? 'above' : 'below'} the entry).</p><div class="qb-row"><button type="button" class="btn btn-ghost btn-sm" data-q="skip">${Q.real ? "Use the bot's TP plan" : 'No target'}</button></div>`;
    else {
      h += Q.real ? `<div class="qb-size"><label>Margin <input inputmode="decimal" data-qf="margin" placeholder="saved" value="${Q.margin > 0 ? Q.margin : ''}"></label><label>× <input inputmode="numeric" data-qf="lev" placeholder="saved" value="${Q.lev > 0 ? Q.lev : ''}"></label><span class="qb-sn">blank = your saved size · you can change it again in the review</span></div>` : `<div class="qb-size"><label>Margin <input inputmode="decimal" data-qf="margin" value="${Q.margin || ''}"></label><label>× <input inputmode="numeric" data-qf="lev" value="${Q.lev}"></label>
        <span class="qb-risk">${[0.5, 1, 2].map(r => `<button type="button" data-qr="${r}" title="Margin so the stop costs ${r}% of the paper balance">${r}%</button>`).join('')}</span></div>`;
      h += `<div class="qb-read" data-qread></div><div class="qb-row"><button type="button" class="tk2-go ${s === 1 ? 'up' : 'down'}" data-q="go"></button>${Q.mkt ? (Q.entry != null ? `<button type="button" class="btn btn-ghost btn-sm" data-q="lim">Back to ${fp(Q.entry)}</button>` : '') : `<button type="button" class="btn btn-ghost btn-sm" data-q="mkt">Market now</button>`}</div>`;
    }
    const focused = Q.el.contains(document.activeElement) && document.activeElement.dataset.qf;
    if (!focused) Q.el.innerHTML = h;
    Q.el.classList.toggle('picking', Q.stage !== 'ask');   // while you click the stop / target, the bar never blocks the chart
    qRead();
  }
  function qErr() {
    if (Q.stage !== 'ask') return '';
    const o = qOrder();
    if (Q.real) return '';   // the bot checks the real order again in the review, against the price at that moment
    return paperCheck(o);
  }
  function qRead() {
    if (!Q.el || Q.stage !== 'ask') return;
    const r = Q.el.querySelector('[data-qread]'), go = Q.el.querySelector('[data-q="go"]'); if (!r || !go) return;
    const o = qOrder(), e = o.price, dist = Math.abs(e - o.sl), err = qErr();
    // $ at the stop / target as you type the margin and leverage (fees in). Paper: the paper engine's fees (the entry's rate
    // both ways). Real: an estimate before the review — the entry's fee + a market exit; the review shows the bot's exact order.
    // a real plan's blank margin / leverage = your saved size: the bot's last preview of it (Real tab), when there is one
    const sv = Q.real && !(o.margin > 0 && o.lev > 0) && X.realSaved ? X.realSaved(o.side) : null;
    if (sv) { if (!(o.margin > 0) && sv.margin) o.margin = sv.margin; if (!(o.lev > 0) && sv.lev) o.lev = sv.lev; }
    const sized = o.margin > 0 && o.lev > 0, notional = sized ? o.margin * o.lev : 0, qty = notional / e, fIn = o.kind === 'limit' ? FEE_M : FEE_T;
    const fees = Q.real ? notional * (fIn + FEE_T) : notional * fIn * 2;
    const loss = sized ? dist * qty + fees : null, gain = sized && o.tp != null ? Math.abs(o.tp - e) * qty - fees : null;
    const rr = o.tp != null ? Math.abs(o.tp - e) / dist : null, liq = sized ? liqOf(o.side, e, o.lev) : null;
    const liqFirst = liq != null && (o.side === 1 ? o.sl <= liq : o.sl >= liq);
    const pre = Q.real ? '≈ ' : '';
    r.innerHTML = `<span class="down">Stop ${pct((o.sl / e - 1) * 100)}${loss != null ? ` · ${pre}−${money(loss).replace('−', '')}` : ''}</span>` +
      (o.tp != null ? `<span class="up">Target ${pct((o.tp / e - 1) * 100)}${gain != null ? ` · ${pre}${money(gain, true)}` : ''}</span><span><b>${rr.toFixed(2)}R</b></span>` : `<span class="muted">${Q.real ? "TPs: the bot's plan" : 'no target'}</span>`) +
      (!Q.real && loss != null && A.bal > 0 ? `<span class="muted">${(loss / A.bal * 100).toFixed(2)}% of balance</span>` : '') +
      (sized ? `<span class="muted">${money(notional)} position${sv && (!(Q.margin > 0) || !(Q.lev > 0)) ? ` (saved size ${money(o.margin)} × ${o.lev}×)` : ''} · liq. ≈ ${fp(liq)}</span>` : '') +
      (liqFirst && Q.real ? `<p class="xbad">At ${o.lev}× the liquidation (≈ ${fp(liq)}) comes before your stop — lower the leverage.</p>` : '') +
      (Q.real ? `<span class="muted">${sized ? 'Fees in, estimated. Next: the bot\'s exact order to check, then Place.' : 'Type a margin and leverage to see the $ at the stop and target (blank = your saved size, shown in the review).'}</span>` : '') +
      (err ? `<p class="xbad">${esc(err)}</p>` : '');
    go.disabled = !!err;
    go.className = 'tk2-go ' + (o.side === 1 ? 'up' : 'down');
    go.textContent = Q.real ? `Review the real ${o.side === 1 ? 'long' : 'short'} →` : `Place paper ${o.side === 1 ? 'buy' : 'sell'} ${o.kind === 'market' ? 'at market' : o.kind} · ${coin(U.sym)}`;
  }
  function qClick(e) {
    const b = e.target.closest('[data-q],[data-qr]'); if (!b || b.disabled) return;
    if (b.dataset.qr) {   // margin from the risk: the stop costs r% of the paper balance (fees in)
      const o = qOrder(), dist = Math.abs(o.price - o.sl) / o.price; if (!(dist > 0)) return;
      Q.margin = Math.floor(A.bal * (+b.dataset.qr / 100) / ((dist + 2 * FEE_T) * o.lev) * 100) / 100; qRender(); return;
    }
    const k = b.dataset.q;
    if (k === 'x') return qEnd();
    if (k === 'paper' || k === 'real') { Q.real = k === 'real'; if (Q.real) qRealSize(); else { const t = readT(); Q.margin = t.margin > 0 ? t.margin : U.margin; Q.lev = t.lev || U.lev; } return qRender(); }
    if (k === 'skip') { Q.tp = null; Q.stage = 'ask'; qPick(); qRender(); syncLines(); return; }
    if (k === 'mktnow') { Q.mkt = true; Q.stage = 'sl'; qPick(); qRender(); syncLines(); return; }
    if (k === 'mkt' || k === 'lim') { Q.mkt = k === 'mkt'; if (Q.sl != null && !okFor(qSide(), qEntry(), Q.sl, true)) { Q.sl = null; Q.tp = null; Q.stage = 'sl'; qPick(); } qRender(); syncLines(); return; }
    if (k === 'go') {
      if (qErr()) return qRead();
      const o = qOrder();
      if (Q.real) { const r = { side: o.side === 1 ? 'long' : 'short', kind: o.kind, entry: o.kind === 'market' ? null : o.price, sl: o.sl, tp: o.tp, margin: Q.margin > 0 ? Q.margin : null, lev: Q.lev > 0 ? Math.round(Q.lev) : null }; qEnd(); X.quickReal(r); return; }
      if (paperSubmit(o)) qEnd();
    }
  }

  // ---- Buy / Sell on the chart, Market or Limit
  // Market: a paper market order with the Trade panel's size (the admin's Real ticket: straight to its review).
  // Limit: Buy / Sell arms the ⚡ plan with that side — click the entry price on the chart, then the stop, then the target,
  // then Place (paper) or the review of the bot's exact order (real).
  const QT = document.createElement('div');
  QT.className = 'dk-qt'; QT.hidden = true; QT.setAttribute('role', 'group'); QT.setAttribute('aria-label', 'Buy or sell');
  chartEl.appendChild(QT);
  // the box sits under the top-left text (54px in desk.css); when that text runs longer (news, sessions, the A+ idea) it moves down with it
  { const lg = $('[data-legend]'), below = () => { const need = lg.offsetTop + lg.offsetHeight + 6; QT.style.top = need > 54 ? need + 'px' : ''; if (U.hilo) prim.req(); };
    if (window.ResizeObserver) new ResizeObserver(below).observe(lg); }
  if (U.qtk !== 'lmt') U.qtk = 'mkt';
  function qtUI() {
    const hide = !U.qt || !S.lastPx; QT.hidden = hide; if (hide) return;
    const real = realOn(), t = readT(), busy = real && X.realBusy ? X.realBusy() : '', lim = U.qtk === 'lmt';
    const armed = Q.on && Q.side ? Q.side : 0;
    const side = s => {
      const nm = real ? `Real ${s === 1 ? 'buy' : 'sell'}${lim ? ' limit' : ''}` : `${s === 1 ? 'Buy' : 'Sell'}${lim ? ' limit' : ''}`;
      const tip = lim ? `Then click your ${s === 1 ? 'buy' : 'sell'} price on the chart, your stop and your target${real ? ' — you review the bot\'s exact order before it is placed' : ''}` : `${s === 1 ? 'Buy' : 'Sell'} at market now${real ? ' — you review the bot\'s exact order before it is placed' : ' (paper)'}`;
      return `<button type="button" class="${s === 1 ? 'qt-b' : 'qt-s'}${armed === s ? ' arm' : ''}" data-qt="${s}" title="${esc(tip)}"><span>${nm}</span><b>${lim ? (armed === s ? (phone() ? 'tap the chart' : 'click the chart') : 'pick a price') : fp(S.lastPx)}</b></button>`;
    };
    const sz = busy ? 'Real trade open' : real ? 'Real ticket' : t.margin > 0 ? `${money(t.margin)} × ${t.lev}×` : 'Set size';
    const h = side(-1) +
      `<div class="qt-m"><span class="qt-k" role="radiogroup" aria-label="Order type">${[['mkt', 'Market'], ['lmt', 'Limit']].map(([k, l]) => `<button type="button" role="radio" data-qk="${k}" aria-checked="${U.qtk === k}"${U.qtk === k ? ' class="on"' : ''}>${l}</button>`).join('')}</span>` +
      `<button type="button" class="qt-sz" data-qt="0" title="${busy ? esc(busy) + ' — one real trade per coin' : real ? 'The Real ticket sets the size' : 'Size from the Trade panel — click to change it'}">${sz}</button></div>` + side(1);
    if (QT._h !== h) { QT.innerHTML = h; QT._h = h; }
    QT.classList.toggle('real', real); QT.classList.toggle('busy', !!busy); QT.classList.toggle('lim', lim);
  }
  QT.addEventListener('click', e => {
    const k = e.target.closest('[data-qk]');
    if (k) { U.qtk = k.dataset.qk; saveUI(); if (Q.on && Q.side && Q.stage === 'entry' && U.qtk === 'mkt') qEnd(); qtUI(); return; }
    const b = e.target.closest('[data-qt]'); if (!b) return;
    const side = +b.dataset.qt, real = realOn(), busy = real && X.realBusy ? X.realBusy() : '';
    if (busy && side) { toast(`${busy} — one real trade per coin. Manage it in the Real tab.`, 'down'); return; }
    if (!side) { if (real) { if (phone()) openSheet('real'); else sideTab('real'); } else showTicket(); return; }
    if (U.qtk === 'lmt') { if (Q.on && Q.side === side && Q.stage === 'entry') { qEnd(); return; } qStartSide(side, real); return; }   // pressed again: cancel
    if (real) { X.quickReal({ side: side === 1 ? 'long' : 'short', kind: 'market', entry: null, sl: null, tp: null, keep: true }); return; }
    const t = readT();
    paperSubmit({ side, kind: 'market', margin: t.margin, lev: t.lev, sl: okFor(side, S.lastPx, t.sl, true) ? t.sl : null, tp: okFor(side, S.lastPx, t.tp, false) ? t.tp : null });
  });

  // ------------------------------------------------------------------ SMC overlay (closed candles only)
  let smcT = null;
  function smcSchedule() {
    emit('bars'); pdCheck();   // the candles changed (new candle, replay step, load): add-ons like the A+ layer read again
    if (!smcAny() && !U.smcFvg && !U.tline) { if (SMCR || FVGS || TLS) { SMCR = null; FVGS = null; TLS = null; setMarkers(); prim.req(); legend(); } return; }
    if (smcT) return;
    smcT = setTimeout(() => { smcT = null; smcRun(); }, R.playing ? 200 : 20);
  }
  function smcRun() {
    const B = S.bars;
    let n = B.length; if (n && nextB(B[n - 1][0], U.tf) > nowT()) n--;   // the forming candle is not closed yet
    const base = B.slice(Math.max(0, n - (U.smcAll ? 6000 : 500)), n).map(b => [b[0], b[1], b[2], b[3], b[4], b[5]]);   // Recent: last 500 · Whole chart: all loaded
    FVGS = U.smcFvg && base.length >= 3 ? fvgScan(base, U.tf) : null;   // closed candles only
    TLS = null;
    if (U.tline && base.length >= 12 && S.key === U.ex + '|' + U.sym + '|' + U.tf) {   // never freeze lines from the last chart's candles while the new ones load
      const mode = R.on ? 'replay' : 'live', key = S.key, tfMs = TF[U.tf].ms;
      let sn = TLF[mode][key];
      if (!sn || sn.at > nowT()) { sn = tlSnap(base, U.tf); TLF[mode][key] = sn; if (mode === 'live') tlSave(); }
      TLS = tlAfter(sn); TLS.at = sn.at;
      if (U.tlineHtf) TLS.push(...tlTop(mode, key, S.bars, tfMs, t2l));   // top-down: the lines drawn on this coin's higher timeframes
    }
    if (!smcAny() || !window.SMC) { SMCR = null; setMarkers(); prim.req(); legend(); return; }
    if (base.length < 12) { SMCR = null; setMarkers(); prim.req(); legend(); return; }
    const l = base[base.length - 1];
    base.push([nextB(l[0], U.tf), l[4], l[4], l[4], l[4], 0]);   // closes the last real candle; itself ignored
    try { SMCR = window.SMC.analyze(base, base.length - 1, smcOpt(U.tf)); } catch (e) { SMCR = null; }
    setMarkers(); prim.req(); legend();
  }
  // fair value gaps: candle 1's high below candle 3's low (bullish) or its low above candle 3's high (bearish), at least a
  // quarter of the average candle range (ATR 14) so 1-minute noise stays off. Known when candle 3 closes. Later candles
  // fill it from the near side: the box shrinks to the part not traded yet and ends when a wick reaches the far side.
  // auto trend lines, the way Tori Trades draws them: a line joins swing lows (support) or swing highs (resistance) and no
  // candle may poke through it. From each swing point (fractal: 2 candles each side on 1D and up, 3 below) the line swings
  // to the first later candle that keeps every candle on one side. A wick through without a close redraws the line through
  // that wick ("incorporate that wick"); a close through breaks it — kept, to watch the retest — and the next line from the
  // same point starts at that candle (the fan of lines from one high or low). Touches = candles within 0.1 ATR of the line,
  // a run of touching candles counted once. Shown: per side the nearest line still holding and the one with the most
  // touches, plus the broken line with the most touches among those broken in the last 40 candles.
  function tlineScan(B, tf) {
    const n = B.length, k = TF[tf].ms >= 864e5 ? 2 : 3, out = [], atr = new Array(n).fill(0);
    { let s = 0; const tr = i => i ? Math.max(B[i][2] - B[i][3], Math.abs(B[i][2] - B[i - 1][4]), Math.abs(B[i][3] - B[i - 1][4])) : B[i][2] - B[i][3];
      for (let i = 0; i < n; i++) { s += tr(i); if (i >= 14) s -= tr(i - 14); atr[i] = s / Math.min(i + 1, 14); } }
    const mk = (side, p, q, s, brk) => {
      const v = side === 'L' ? i => B[i][3] : i => B[i][2], end = brk == null ? n : brk, touches = [];
      let last = -9;
      for (let i = p; i < end; i++) if (Math.abs(v(i) - (v(p) + s * (i - p))) <= 0.1 * atr[i]) { if (i - last > 1) touches.push(B[i][0]); last = i; }
      return { side, tp: B[p][0], tq: B[q][0], v0: v(p), s, brkT: brk == null ? null : B[brk][0], touches, nT: touches.length, i0: p, iq: q, ib: brk };
    };
    for (const side of ['L', 'H']) {
      const lo = side === 'L', v = lo ? i => B[i][3] : i => B[i][2], sg = lo ? 1 : -1;   // sg 1: candles stay above the line
      for (let p = k; p < n - k; p++) {
        let piv = true; for (let j = 1; j <= k && piv; j++) piv = lo ? v(p) < v(p - j) && v(p) <= v(p + j) : v(p) > v(p - j) && v(p) >= v(p + j);
        if (!piv) continue;
        let q = -1, s = 0;
        for (let t = p + 1; t < n; t++) {
          const st = (v(t) - v(p)) / (t - p);
          if (q < 0) { q = t; s = st; continue; }
          if (sg * (st - s) >= 0) continue;                                    // this candle stays on its side
          const closed = sg * (B[t][4] - (v(p) + s * (t - p))) < 0;            // past the line: closed through = broken
          if (closed && q - p >= 3) out.push(mk(side, p, q, s, t));
          q = t; s = st;                                                       // redraw through this candle
        }
        if (q > 0 && q - p >= 3) out.push(mk(side, p, q, s, null));
      }
    }
    const px = B[n - 1][4], keep = [], now = l => l.v0 + l.s * (n - 1 - l.i0), tol = 0.25 * atr[n - 1];
    for (const side of ['H', 'L']) {
      const act = out.filter(l => l.side === side && l.brkT == null && l.nT >= 2 && now(l) > 0);
      const near = act.slice().sort((a, b) => Math.abs(now(a) - px) - Math.abs(now(b) - px))[0];
      const most = act.slice().sort((a, b) => b.nT - a.nT || Math.abs(now(a) - px) - Math.abs(now(b) - px))[0];
      for (const l of [near, most]) if (l && !keep.some(m => m.brkT == null && m.side === side && Math.abs(now(m) - now(l)) < tol)) keep.push(l);
      const br = out.filter(l => l.side === side && l.brkT != null && l.nT >= 2 && n - l.ib <= 40).sort((a, b) => b.nT - a.nT || b.ib - a.ib)[0];
      if (br) keep.push(br);
    }
    keep.atr = atr[n - 1];
    return keep;
  }
  // freeze a scan: each line by its two anchors (time, price), drawn straight between them on any timeframe
  function tlSnap(base, tf) {
    const L = tlineScan(base, tf);
    return { at: nowT(), tf, last: base[base.length - 1][0], atr: L.atr, lines: L.map(l => ({ side: l.side, t1: l.tp, p1: l.v0, t2: l.tq, p2: l.v0 + l.s * (l.iq - l.i0), brkT: l.brkT, touches: l.touches, nT: l.nT })) };
  }
  // what price did at a frozen line after it was drawn (closed candles on this chart): the first close through it, new touches
  function tlAfter(sn) { return tlAfterOn(sn, S.bars, U.tf, t2l); }
  function tlAfterOn(sn, B, tf, t2l) {   // also the Compare chart's (its candles and timeframe)
    const now = nowT(), tol = 0.1 * (sn.atr || 0);
    return sn.lines.map(l => {
      const o = Object.assign({}, l, { liveBrk: null, liveTouches: [] }); if (l.brkT != null) return o;
      const L1 = t2l(l.t1), L2 = t2l(l.t2); if (L1 == null || L2 == null || L2 === L1) return o;
      let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] <= sn.last) lo = m + 1; else hi = m; }
      let lastT = -9;
      for (let i = lo; i < B.length && nextB(B[i][0], tf) <= now; i++) {
        const v = l.p1 + (l.p2 - l.p1) * (i - L1) / (L2 - L1), b = B[i];
        if (l.side === 'L' ? b[4] < v : b[4] > v) { o.liveBrk = b[0]; break; }
        if (Math.abs((l.side === 'L' ? b[3] : b[2]) - v) <= tol) { if (i - lastT > 1) o.liveTouches.push(b[0]); lastT = i; }
      }
      return o;
    });
  }
  // top-down: lines drawn on the higher timeframes of the coin in key (ex|sym|tf), on the main chart or the Compare chart —
  // the holding line nearest to price on each side per timeframe, so a few timeframes stay readable
  function tlTop(mode, key, B, tfMs, t2l) {
    const out = [], pre = key.split('|').slice(0, 2).join('|') + '|'; if (!B.length) return out;
    const Ln = B.length - 1, px = B[Ln][4], val = l => { const L1 = t2l(l.t1), L2 = t2l(l.t2); return L1 == null || L2 == null || L2 === L1 ? null : l.p1 + (l.p2 - l.p1) * (Ln - L1) / (L2 - L1); };
    for (const k in TLF[mode]) {
      const h = TLF[mode][k]; if (k === key || !k.startsWith(pre) || !TF[h.tf] || TF[h.tf].ms <= tfMs || h.at > nowT()) continue;
      for (const side of ['L', 'H']) {
        const c = h.lines.filter(l => l.side === side && l.brkT == null).map(l => [l, val(l)]).filter(x => x[1] != null && x[1] > 0).sort((a, b) => Math.abs(a[1] - px) - Math.abs(b[1] - px))[0];
        if (c) out.push(Object.assign({}, c[0], { htf: h.tf, liveBrk: null, liveTouches: [] }));
      }
    }
    return out;
  }
  function fvgScan(B, tf) {
    const out = []; let atr = null, open = [];
    for (let i = 1; i < B.length; i++) {
      const c = B[i], p = B[i - 1];
      const tr = Math.max(c[2] - c[3], Math.abs(c[2] - p[4]), Math.abs(c[3] - p[4]));
      atr = atr == null ? tr : atr + (tr - atr) / 14;
      if (open.length) {
        for (const f of open) {
          if (f.dir === 1) { if (c[3] <= f.bot) f.filled = c[0]; else if (c[3] < f.top) f.top = c[3]; }
          else if (c[2] >= f.top) f.filled = c[0]; else if (c[2] > f.bot) f.bot = c[2];
        }
        open = open.filter(f => !f.filled);
      }
      if (i < 2) continue;
      const a = B[i - 2], min = 0.25 * atr;
      let f = null;
      if (c[3] > a[2] && c[3] - a[2] >= min) f = { dir: 1, top: c[3], bot: a[2], top0: c[3], bot0: a[2], t: B[i - 1][0], conf: nextB(c[0], tf), filled: null };
      else if (c[2] < a[3] && a[3] - c[2] >= min) f = { dir: -1, top: a[3], bot: c[2], top0: a[3], bot0: c[2], t: B[i - 1][0], conf: nextB(c[0], tf), filled: null };
      if (f) { out.push(f); open.push(f); }
    }
    return out;
  }
  function setMarkers() {
    if (!markers) return;
    const first = S.bars.length ? S.bars[0][0] : 0, M = [];
    if (SMCR && U.smc && !X.smcOff) {
      const keep = (a, k) => (U.smcAll ? a : a.slice(-k));   // Recent: the newest only · Whole chart: all
      for (const s of keep(SMCR.swings, 40)) if (s.t >= first) M.push({ time: s.t / 1000, position: s.side === 'H' ? 'aboveBar' : 'belowBar', color: s.side === 'H' ? COL.down : COL.up, shape: 'circle', size: 0.4, text: s.label });
      for (const w of keep(SMCR.sweeps, 6)) if (w.t >= first) M.push({ time: w.t / 1000, position: w.dir === -1 ? 'aboveBar' : 'belowBar', color: COL.warn, shape: w.dir === -1 ? 'arrowDown' : 'arrowUp', text: 'sweep' });
    }
    // extension marks: { t (ms), position, color, shape, text } — snapped to the chart's candle, never past the replay clock
    const last = S.bars.length ? S.bars[S.bars.length - 1][0] : 0, now = nowT();
    for (const f of X.marks) { try { for (const m of f()) if (m.t >= first && m.t <= now && bucket(m.t, U.tf) <= last) M.push({ time: bucket(m.t, U.tf) / 1000, position: m.position, color: m.color, shape: m.shape, text: m.text }); } catch (e) { console.error(e); } }
    M.sort((a, b) => a.time - b.time);
    markers.setMarkers(M);
  }

  // ------------------------------------------------------------------ legend, header, replay controls
  const LG = $('[data-legend]');
  let hoverBar = null;
  function legend() {
    const b = hoverBar || lastBar(); if (!b) { LG.innerHTML = ''; return; }
    const ch = b[4] - b[1], up = ch >= 0, cl = up ? 'up' : 'down';
    let l2 = '';
    if (U.vol && U.ex !== 'fx') {   // FX has no shared volume
      const bi = S.bars.indexOf(b), av = bi >= 0 ? volAvg(bi, false) : null, x = av > 0 ? b[5] / av : null;
      l2 = `<span title="Volume of this candle${x != null ? ` and how it compares with the average of the ${VMA} candles before it` : ''}">Vol <b>${fv(b[5])}</b>${x != null ? ` · <b class="${x >= 2 ? 'warn' : ''}">${x.toFixed(1)}×</b> avg` : ''}</span>`;
    }
    for (const k in EMAS) if (U[k]) { const a = emaArr(EMAS[k][0]); const i = a.findIndex(p => p.time === b[0] / 1000); if (i >= 0) l2 += `<span style="color:${EMAS[k][1]}">EMA ${EMAS[k][0]} ${fp(a[i].value)}</span>`; }
    for (const f of X.legend) { try { const h = f(); if (h) l2 += h; } catch (e) { console.error(e); } }
    if (U.tline && TLS) { const Ln = S.bars.length - 1, hold = TLS.filter(l => !l.htf && l.brkT == null && l.liveBrk == null).map(l => { const L1 = t2l(l.t1), L2 = t2l(l.t2); if (L1 == null || L2 == null || L2 === L1) return '';
        const v = l.p1 + (l.p2 - l.p1) * (Ln - L1) / (L2 - L1); return `<b class="${l.side === 'L' ? 'up' : 'down'}" title="${l.htf ? l.htf + ' ' : ''}${l.side === 'L' ? 'support' : 'resistance'} line, ${l.nT} touches when drawn">${l.htf ? l.htf + ' ' : ''}${l.p2 < l.p1 ? '↘' : '↗'} ${fp(v)}</b>`; }).filter(Boolean);
      const nb = TLS.filter(l => l.liveBrk != null).length, ht = {}; for (const l of TLS) if (l.htf) ht[l.htf] = (ht[l.htf] || 0) + 1;
      const htx = Object.keys(ht).sort((a, b) => TF[b].ms - TF[a].ms).map(k => '+' + ht[k] + ' ' + k).join(' ');
      l2 += `<span>Trend lines <em title="Drawn from the candles closed by then and kept there as price moves">drawn ${tshort(TLS.at)}</em>${hold.length ? ' ' + hold.join(' · ') : ''}${htx ? ` · <em title="Lines from your higher-timeframe charts of this coin (top-down), the nearest one each side. Their prices are on the chart.">${htx}</em>` : ''}${nb ? ` · <b class="m">${nb} broken since</b>` : ''}</span><button type="button" class="lg-btn" data-act="tlredraw" title="Draw the trend lines again from the latest closed candles (this coin and timeframe)">Redraw now</button>`; }
    if (U.pdhl && PDAY) l2 += `<span>PDH <b>${fp(PDAY.h)}</b> · PDL <b>${fp(PDAY.l)}</b></span>`;
    if (U.liq && SMCR && SMCR.liq) {
      const px = S.lastPx, lv = SMCR.liq.filter(l => l.kind === 'swing');
      const up = lv.filter(l => l.side === 'H' && l.p >= px).sort((a, b) => a.p - b.p)[0], dn = lv.filter(l => l.side === 'L' && l.p <= px).sort((a, b) => b.p - a.p)[0];
      if (up || dn) l2 += `<span title="Liquidity: the nearest swing high above the price (buy-side, BSL) and swing low below it (sell-side, SSL) that price has not taken yet: stop orders rest just past them">${up ? `BSL <b class="down">${fp(up.p)}</b>` : ''}${up && dn ? ' · ' : ''}${dn ? `SSL <b class="up">${fp(dn.p)}</b>` : ''}</span>`;
    }
    if (U.eq && SMCR && SMCR.eqs) {
      const px = S.lastPx, open = SMCR.eqs.filter(e => !e.taken);
      const up = open.filter(e => e.side === 'H' && e.p >= px).sort((a, b) => a.p - b.p)[0], dn = open.filter(e => e.side === 'L' && e.p <= px).sort((a, b) => b.p - a.p)[0];
      if (up || dn) l2 += `<span title="The nearest equal highs above the price and equal lows below it that price has not taken yet: stops rest there">${up ? `EQH <b class="down">${fp(up.p)}</b>` : ''}${up && dn ? ' · ' : ''}${dn ? `EQL <b class="up">${fp(dn.p)}</b>` : ''}</span>`;
    }
    if (smcAny() && SMCR) l2 += `<span>SMC trend <b class="${SMCR.trend === 1 ? 'up' : SMCR.trend === -1 ? 'down' : ''}">${SMCR.trend === 1 ? 'up' : SMCR.trend === -1 ? 'down' : '—'}</b></span>` +
      `<button type="button" class="lg-btn" data-act="smcall" data-v="${U.smcAll ? 0 : 1}" title="${U.smcAll ? 'SMC is labelling every loaded candle. Click to show only the newest structure.' : 'SMC is labelling the newest structure only. Click to label the whole chart.'}">${U.smcAll ? 'All · show recent' : 'Recent · show all'}</button>`;
    LG.innerHTML = `<div class="l1"><b>${esc(mktName(U.sym))} · ${U.tf} · ${api().name}${U.ex === 'fx' ? ' <em class="lg-fx" title="Interbank prices (the market TradingView’s FX charts show), via our server, ~10 s refresh. Chart and paper trades only.">interbank</em>' : ''}</b><span class="ohlc"><span><em>O</em>${fp(b[1])}</span><span><em>H</em>${fp(b[2])}</span><span><em>L</em>${fp(b[3])}</span><span class="${cl}"><em>C</em>${fp(b[4])}</span><span class="${cl}">${up ? '+' : '−'}${fp(Math.abs(ch))} (${pct(ch / b[1] * 100)})</span></span></div>${l2 ? `<div class="l2">${l2}</div>` : ''}`;
  }
  chart.subscribeCrosshairMove(p => {
    if (p && p.time != null) { const t = p.time * 1000, B = S.bars; let lo = 0, hi = B.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m][0] <= t) lo = m; else hi = m - 1; } hoverBar = B[lo] && B[lo][0] === t ? B[lo] : null; }
    else hoverBar = null;
    legend();
  });
  function headUI() {
    $('[data-sym]').textContent = U.sym; $('[data-exname]').textContent = api().name;
    $$('[data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === U.tf)); $('[data-tfsel]').value = U.tf;
    $('[data-act="smc"]').setAttribute('aria-pressed', String(smcAny()));
    $$('[data-act="smcall"]').forEach(b => { if (!b.closest('[data-legend]')) b.classList.toggle('on', (b.dataset.v === '1') === !!U.smcAll); });
    $$('[data-ind]').forEach(i => { i.checked = !!U[i.dataset.ind]; });
    $$('[data-act="candles"]').forEach(b => { const on = b.dataset.v === (U.candles === 'mono' ? 'mono' : 'color'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.title = (X.titlePre || '') + `${coin(U.sym)} ${S.lastPx ? fp(S.lastPx) : ''} · ${R.on ? 'Replay' : 'Desk'} · ReplayDesk`;
    $$('.wl-row').forEach(r => r.classList.toggle('on', r.dataset.s === U.sym));
  }
  function modeUI() {
    root.classList.toggle('replay', R.on);
    $('[data-rp]').hidden = !R.on; $('[data-rpm]').hidden = !R.on;
    $('[data-mode] span').textContent = R.on ? 'REPLAY' : 'LIVE';
    $('[data-speed]').value = String(R.speed); $('[data-stepsize]').value = R.step;
    clockUI(); headUI(); renderAll(); emit('mode'); ltip.hidden = true; qEnd(); menuClose();
  }
  function clockUI() { $$('[data-clock]').forEach(e => { e.textContent = R.on ? tnice(R.clock) : ''; }); }
  function playUI() { $$('[data-act="play"]').forEach(b => { b.innerHTML = ic(R.playing ? 'pause' : 'play'); b.setAttribute('aria-label', R.playing ? 'Pause' : 'Play'); }); }
  function stepLabel() { const o = $('[data-stepsize] option[value="small"]'); if (o) o.textContent = 'Step: ' + ({ '1H': '1 hour', '4H': '4 hours', '1D': '1 day' }[resOf(U.tf)] || resOf(U.tf)); }
  $('[data-stepsize]').innerHTML = '<option value="bar">Step: 1 bar</option><option value="small">Step: 1m</option>';

  // The top bar never runs under the right-hand buttons: when it doesn't fit (a narrower screen, the replay controls, the
  // admin's web-trading chip) it folds step by step — t1 pill labels → icons, t2 the chips go compact, t3 the step-size
  // select hides, t4 the timeframe buttons become a dropdown, t5 the exchange tag and the fullscreen button hide.
  // Re-checked whenever the bar, the replay controls or the right-hand group resize.
  const topEl = $('.dk-top');
  let fitQ = false;
  // On a phone: p1 hides the logo, p2 the LIVE / REPLAY dot (a 390px screen with the admin's web-trading chip needs p1).
  function fitTop() {
    fitQ = false;
    if (!topEl) return;
    const ph = phone(), steps = ph ? ['p1', 'p2', 'p3', 'p4', 'p5'] : ['t1', 't2', 't3', 't4', 't5'];
    topEl.classList.remove('t1', 't2', 't3', 't4', 't5', 'p1', 'p2', 'p3', 'p4', 'p5');
    for (const c of steps) { if (topEl.scrollWidth <= topEl.clientWidth + 1) break; topEl.classList.add(c); }
  }
  const fitSoon = () => { if (!fitQ) { fitQ = true; requestAnimationFrame(fitTop); } };
  if (topEl && window.ResizeObserver) { const ro = new ResizeObserver(fitSoon); [topEl, $('.dk-right'), $('[data-rp]')].forEach(e => e && ro.observe(e)); }
  window.addEventListener('resize', fitSoon);

  let uiQ = false;
  function tickUI() {
    if (uiQ) return; uiQ = true;
    requestAnimationFrame(() => { uiQ = false; legend(); renderTicket(); renderAcct(); renderBottom(true); syncLines(); qtUI(); if (Q.on) qRead(); document.title = (X.titlePre || '') + `${coin(U.sym)} ${S.lastPx ? fp(S.lastPx) : ''} · ${R.on ? 'Replay' : 'Desk'} · ReplayDesk`; emit('tick'); });
  }
  function renderAll() { renderTicket(); renderAcct(); renderBottom(false); syncLines(); legend(); qtUI(); }

  // ------------------------------------------------------------------ watchlist & coin search
  let WL = store.get('rd-wl-v1', null) || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT', 'LINKUSDT', 'AVAXUSDT', '1000PEPEUSDT'];
  const WLD = {};
  const saveWL = () => { store.set('rd-wl-v1', WL); emit('watchlist', WL); };
  const exFor = s => { for (const ex of [U.ex, 'binance', 'bybit', 'fx']) if (SYMS[ex] && SYMS[ex].some(x => x.s === s)) return ex; return /USDT$/.test(s) ? (U.ex === 'fx' ? 'binance' : U.ex) : 'fx'; };
  const wlDec = (s, px) => (exFor(s) === 'fx' ? (/JPY$|^DXY$/.test(s) ? 3 : 5) : px >= 100 ? 2 : px >= 1 ? 4 : 6);
  function renderWatch() {
    $('[data-watch]').innerHTML = WL.map(s => { const d = WLD[s]; return `<div class="wl-row${s === U.sym ? ' on' : ''}" data-s="${esc(s)}"><b>${esc(coin(s))}${X.wlMark ? X.wlMark(s) : ''}</b><span class="mono">${d ? fp(d.px, wlDec(s, d.px)) : '…'}</span><span class="chg ${d && d.chg < 0 ? 'down' : 'up'}">${d ? pct(d.chg) : ''}</span></div>`; }).join('') || '<p class="wl-note">Your watchlist is empty.</p>';
  }
  const watchVisible = () => !$('[data-pane="watch"]').hidden && (!phone() || $('.dk-side').classList.contains('open'));
  async function pollWatch(force) {
    if (document.hidden || (!force && !watchVisible())) return;
    if (WL.some(s => !/USDT$/.test(s))) await symList('fx').catch(() => null);
    await Promise.allSettled(WL.map(s => api(exFor(s)).ticker(s).then(d => { WLD[s] = d; })));
    renderWatch();
  }
  const sModal = $('[data-search]'), sList = $('[data-slist]'), sIn = $('[data-q]');
  let sEx = 'all', sSel = 0, sRows = [];
  const SEXS = ['binance', 'bybit', 'fx'];
  const ALIAS = { XAU: 'GOLD', XAUT: 'GOLD', PAXG: 'GOLD', XAG: 'SILVER', XPT: 'PLATINUM', XPD: 'PALLADIUM' };
  async function openSearch() {
    $$('[data-sex]').forEach(b => b.classList.toggle('on', b.dataset.sex === sEx));
    openModal(sModal); sIn.value = ''; sIn.focus(); await renderSearch();
  }
  async function renderSearch() {
    sList.innerHTML = '<div class="pt-empty"><div><div class="spin" style="width:18px;height:18px;margin:0 auto 8px;border:2px solid var(--dk-line);border-top-color:var(--primary);border-radius:99px;animation:spin .8s linear infinite"></div>Loading coins…</div></div>';
    const want = sEx === 'all' ? SEXS : [sEx], fail = [];
    const [ls, ts] = await Promise.all([Promise.allSettled(want.map(ex => symList(ex))), Promise.allSettled(want.map(ex => tickers24(ex)))]);
    let rows = [];
    want.forEach((ex, i) => {
      if (ls[i].status !== 'fulfilled') { fail.push(EX[ex].name); return; }
      const tk = ts[i].status === 'fulfilled' ? ts[i].value : {};
      for (const s of ls[i].value) rows.push({ s, ex, t: tk[s.s] || {} });
    });
    if (!rows.length) { sList.innerHTML = `<div class="pt-empty">Could not load the markets from ${esc(fail.join(' or ') || 'the exchanges')}. Check the connection and try again.</div>`; return; }
    const q = sIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (q) {
      const words = r => (r.s.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '') + (ALIAS[r.s.b] || '');
      rows = rows.filter(r => r.s.s.includes(q) || words(r).includes(q));
      const rank = r => (r.s.b === q || r.s.b === '1000' + q ? 0 : r.s.b.startsWith(q) ? 1 : r.s.s.includes(q) ? 2 : 3);
      rows.sort((a, b) => rank(a) - rank(b) || (b.ex === 'fx') - (a.ex === 'fx') || (b.t.vol || 0) - (a.t.vol || 0));
    } else rows.sort((a, b) => (WL.includes(b.s.s) - WL.includes(a.s.s)) || (b.t.vol || 0) - (a.t.vol || 0));
    sRows = rows.slice(0, 80); sSel = 0;
    sList.innerHTML = sRows.map((r, i) => `<div class="s-row${i === 0 ? ' sel' : ''}" role="option" data-i="${i}"><button type="button" class="s-star${WL.includes(r.s.s) ? ' on' : ''}" data-star="${esc(r.s.s)}" aria-label="Watchlist">${ic('star')}</button>
      <b>${r.ex === 'fx' ? esc(mktName(r.s.s, 'fx')) : `${esc(r.s.b)}<span>/USDT</span>`}${r.s.cat ? `<em class="s-cat">${esc(r.s.cat)}</em>` : ''}</b><span class="s-ex ${r.ex}" title="${r.ex === 'fx' ? 'Interbank FX prices (TradingView’s FX charts): chart and paper only' : esc(EX[r.ex].name) + ' USDT perpetual'}">${r.ex === 'fx' ? 'FX' : esc(EX[r.ex].name)}</span><span class="mono">${r.t.px ? fp(r.t.px, Math.min(8, decs(r.s.k))) : ''}</span><span class="chg ${(r.t.chg || 0) < 0 ? 'down' : 'up'}">${r.t.chg != null ? pct(r.t.chg) : ''}</span></div>`).join('') ||
      `<div class="pt-empty">Nothing matches “${esc(sIn.value)}”${sEx === 'all' ? '' : ' on ' + EX[sEx].name}.</div>`;
    if (fail.length && sRows.length) sList.insertAdjacentHTML('beforeend', `<div class="pt-empty">${esc(fail.join(' and '))} did not answer, so ${fail.length > 1 ? 'they are' : 'it is'} missing here.</div>`);
  }
  function searchMove(d) { const rs = $$('.s-row', sList); if (!rs.length) return; sSel = (sSel + d + rs.length) % rs.length; rs.forEach((r, i) => r.classList.toggle('sel', i === sSel)); rs[sSel].scrollIntoView({ block: 'nearest' }); }
  function chooseRow(i) { const r = sRows[i]; if (!r) return; closeModals(); setSymbol(r.s.s, r.ex); }
  let sT = null;
  sIn.addEventListener('input', () => { clearTimeout(sT); sT = setTimeout(renderSearch, 120); });
  sIn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); searchMove(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); searchMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseRow(sSel); } else if (e.key === 'Escape') closeModals();
  });
  sList.addEventListener('click', e => {
    const st = e.target.closest('[data-star]');
    if (st) { const s = st.dataset.star; WL = WL.includes(s) ? WL.filter(x => x !== s) : WL.concat(s); saveWL(); st.classList.toggle('on', WL.includes(s)); renderWatch(); pollWatch(true); return; }
    const r = e.target.closest('.s-row'); if (r) chooseRow(+r.dataset.i);
  });

  function setSymbol(sym, ex) {
    if (sym === U.sym && (!ex || ex === U.ex)) return;
    U.sym = sym; if (ex) U.ex = ex; saveUI();
    SEL = null; DRAFT = null; MEASURE = null; hoverBar = null; S.lastPx = null; hint();
    symList(U.ex).catch(() => null);
    headUI(); emit('sym'); ltip.hidden = true; qEnd(); menuClose();
    if (R.on) rebuildReplay(); else loadLive();
  }
  // open a coin at a past moment (admin signal list): straight into a replay there, or the live chart if it is too recent
  function openAt(sym, ex, t) {
    if (!isFinite(t) || t > Date.now() - rpMin()) { setSymbol(sym, ex); return; }
    if (sym !== U.sym || (ex && ex !== U.ex)) {
      U.sym = sym; if (ex) U.ex = ex; saveUI();
      SEL = null; DRAFT = null; MEASURE = null; hoverBar = null; S.lastPx = null; hint();
      symList(U.ex).catch(() => null); headUI(); emit('sym');
    }
    enterReplay(t);
  }
  function setTF(tf) {
    if (!TF[tf] || tf === U.tf) return;
    U.tf = tf; saveUI(); hoverBar = null; headUI();
    if (R.on) rebuildReplay(); else loadLive();
  }

  // ------------------------------------------------------------------ sheets, modals, panels
  const side = $('.dk-side'), bottom = $('.dk-bottom'), scrim = $('[data-scrim]');
  function sideTab(t) { $$('[data-ptab]').forEach(b => b.classList.toggle('on', b.dataset.ptab === t)); $$('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; }); if (t === 'watch') { renderWatch(); pollWatch(true); } emit('pane', t); qtUI(); }
  function openSheet(name) {
    closeSheets(true);
    if ($(`[data-pane="${name}"]`)) { sideTab(name); side.classList.add('open'); }
    else if (name === 'pos') { bottom.classList.add('open'); renderBottom(false); }
    scrim.hidden = false;
    $$('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === name));
  }
  function closeSheets(keepTab) {
    side.classList.remove('open'); bottom.classList.remove('open'); scrim.hidden = true;
    if (!keepTab) $$('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === 'chart'));
  }
  let lastFocus = null;
  function openModal(m) { lastFocus = document.activeElement; closeModals(); m.hidden = false; if (m === $('[data-rmodal]')) rModalInit(); }
  function closeModals() { $$('.dk-modal').forEach(m => { m.hidden = true; }); if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) { /* gone */ } lastFocus = null; }
  const anyModal = () => $$('.dk-modal').some(m => !m.hidden);
  $$('.dk-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) closeModals(); }));

  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const fromLocalInput = v => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN; };
  // a replay can start up to 2 feed candles ago (enterReplay); the box opens on today 00:00 UTC
  const rLatest = () => Math.floor((Date.now() - rpMin()) / MIN) * MIN;
  const rToday = () => Math.min(Math.floor(Date.now() / DAY) * DAY, rLatest());
  function rModalInit() { const inp = $('[data-rdate]'); inp.max = toLocalInput(rLatest()); inp.value = toLocalInput(rToday()); }
  async function randomStart() {
    let t0 = Date.now() - 730 * DAY;
    try { const m = (await symList(U.ex)).find(s => s.s === U.sym); if (m && m.t0) t0 = Math.max(t0, m.t0 + 14 * DAY); } catch (e) { /* default range */ }
    const t1 = Date.now() - 2 * DAY;
    enterReplay(t0 >= t1 ? t1 - DAY : t0 + Math.random() * (t1 - t0));
  }

  // ------------------------------------------------------------------ inline stop / target edit in the positions table
  function editCell(td) {
    const p = A.pos.find(x => x.id === +td.dataset.id); if (!p) return;
    const f = td.dataset.edit, L = p.side === 1;
    td.innerHTML = `<input class="mono" style="width:96px;height:24px;padding:0 6px;border:1px solid var(--primary);border-radius:6px;background:var(--dk-bg);color:var(--text);font-size:12px" value="${p[f] ? rt(p[f]) : ''}" placeholder="none">`;
    const inp = td.querySelector('input'); inp.focus(); inp.select();
    let done = false;
    const commit = save => {
      if (done) return; done = true;
      if (save) {
        const v = num(inp.value), m = markOf(p);
        if (v === null) p[f] = null;
        else if (isNaN(v)) toast('Not a price', 'down');
        else if (f === 'sl' && !((L ? v < m : v > m) && (L ? v > p.liq : v < p.liq))) toast(L ? "A long's stop has to sit between the liquidation price and the price now" : "A short's stop has to sit between the price now and the liquidation price", 'down');
        else if (f === 'tp' && !(L ? v > m : v < m)) toast(L ? "A long's target has to be above the price now" : "A short's target has to be below the price now", 'down');
        else p[f] = rt(v);
      }
      inp.blur(); changed();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(true); else if (e.key === 'Escape') commit(false); e.stopPropagation(); });
    inp.addEventListener('blur', () => commit(true));
  }

  // ------------------------------------------------------------------ phone Tools menu
  // A phone's top bar has room for the coin, timeframe and Indicators only; the rest of the desktop pills live here.
  // Each item clicks the real (hidden) pill, so SMC, the coach, Find setups and Compare keep one code path.
  const MORE_OF = { smc: '.dk-top .dk-smc', coach: '.dk-top .dk-coachb', find: '.dk-top .dk-findb', cmp: '.dk-top .dk-cmpb', theme: '.dk-right [data-theme-toggle]', full: '.dk-right [data-act="full"]' };
  function moreUI() {
    for (const b of $$('[data-mi]')) {
      const k = b.dataset.mi, o = $(MORE_OF[k]);
      b.hidden = !o || (k === 'full' && !document.fullscreenEnabled);   // iPhone Safari has no page full screen
      b.classList.toggle('on', !!o && k !== 'theme' && k !== 'full' && (o.getAttribute('aria-pressed') === 'true' || o.classList.contains('on')));
    }
  }
  function moreClose() { const p = $('[data-morepop]'); if (p && !p.hidden) { p.hidden = true; $('[data-act="more"]').setAttribute('aria-expanded', 'false'); } }

  // ------------------------------------------------------------------ events
  document.addEventListener('click', e => {
    const mi = e.target.closest('[data-mi]');
    if (mi) { moreClose(); const o = $(MORE_OF[mi.dataset.mi]); if (o) o.click(); return; }
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'search') openSearch();
      else if (act === 'retry') { hideMsg(); if (S.retry) S.retry(); }
      else if (act === 'ind') { const p = $('[data-indpop]'); p.hidden = !p.hidden; a.setAttribute('aria-expanded', String(!p.hidden)); }
      else if (act === 'more') { const p = $('[data-morepop]'); p.hidden = !p.hidden; a.setAttribute('aria-expanded', String(!p.hidden)); if (!p.hidden) moreUI(); }
      else if (act === 'candles') { U.candles = a.dataset.v === 'mono' ? 'mono' : 'color'; saveUI(); headUI(); applyTheme(); }
      else if (act === 'tlredraw') { delete TLF[R.on ? 'replay' : 'live'][U.ex + '|' + U.sym + '|' + U.tf]; if (!R.on) tlSave(); smcSchedule(); }
      else if (act === 'smcall') { if (U.tline) { delete TLF[R.on ? 'replay' : 'live'][U.ex + '|' + U.sym + '|' + U.tf]; if (!R.on) tlSave(); } U.smcAll = a.dataset.v === '1'; if (!smcAny() && !U.smcFvg && !U.tline) { U.smc = true; U.choch = true; U.bos = true; U.eq = true; U.liq = true; }   // FVG / trend lines / CHoCH / BOS alone use it too: don't switch SMC on for them
      saveUI(); headUI(); smcSchedule(); legend(); if (!window.SMC) toast('The SMC overlay did not load. Reload the page.', 'down'); }
      else if (act === 'smc') { const on = !smcAny(); U.smc = on; U.choch = on; U.bos = on; U.eq = on; U.liq = on; saveUI(); headUI(); smcSchedule(); if (U.smc && !window.SMC) toast('The SMC overlay did not load. Reload the page.', 'down'); }
      else if (act === 'replay') openModal($('[data-rmodal]'));
      else if (act === 'rstart') openModal($('[data-rmodal]'));
      else if (act === 'rpick-chart') { closeModals(); if (!R.on) startPick('replay'); else startPick('replay'); }
      else if (act === 'rrandom') randomStart();
      else if (act === 'rgo') { const t = fromLocalInput($('[data-rdate]').value); if (isNaN(t)) toast('Choose a date and time first.'); else enterReplay(t); }
      else if (act === 'rexit') exitReplay();
      else if (act === 'play') { if (R.playing) pausePlay(); else play(); }
      else if (act === 'step') { pausePlay(); step(); }
      else if (act === 'back') stepBack();
      else if (act === 'close-modal') closeModals();
      else if (act === 'close-sheet') closeSheets();
      else if (act === 'collapse') { U.bmin = !U.bmin; saveUI(); root.classList.toggle('b-min', U.bmin); }
      else if (act === 'full') { root.classList.toggle('full'); try { if (root.classList.contains('full') && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen(); } catch (er) { /* not allowed */ } }
      else if (act === 'tools-m') root.classList.toggle('tools-open');
      else if (act === 'reset') {
        if (!A._armed) { A._armed = true; renderAcct(); setTimeout(() => { A._armed = false; renderAcct(); }, 3500); }
        else { A = freshAcct(); A.epoch = newId(); A.resetPending = true; R.back = []; if (R.on) newSession(); saveAcctNow(); toast('Paper account reset to $10,000 — journal cleared.'); renderAll(); emit('reset'); }
      }
      return;
    }
    if (e.target.closest('[data-tf]')) return setTF(e.target.closest('[data-tf]').dataset.tf);
    const tool = e.target.closest('[data-tool]'); if (tool) return setTool(tool.dataset.tool);
    const sideB = e.target.closest('[data-side]'); if (sideB) { T.side = +sideB.dataset.side; renderTicket(); syncLines(); return; }
    const ot = e.target.closest('[data-otype]'); if (ot) { T.type = ot.dataset.otype; if (T.type === 'limit' && !fld('price').value && S.lastPx) fld('price').value = rt(S.lastPx); renderTicket(); syncLines(); return; }
    const pc = e.target.closest('[data-pct]'); if (pc) { fld('margin').value = Math.floor(avail() * +pc.dataset.pct / 100 * 100) / 100; renderTicket(); return; }
    const pk = e.target.closest('[data-pick-f]'); if (pk) { e.preventDefault(); if (PICK && PICK.field === pk.dataset.pickF) clearPick(); else startPick('field', pk.dataset.pickF); return; }
    if (e.target.closest('[data-place]')) return place();
    const pt = e.target.closest('[data-ptab]'); if (pt) return sideTab(pt.dataset.ptab);
    const bt = e.target.closest('[data-btab]'); if (bt) { BTAB = bt.dataset.btab; if (U.bmin) { U.bmin = false; saveUI(); root.classList.remove('b-min'); } return renderBottom(false); }
    const m = e.target.closest('[data-m]');
    if (m) { const k = m.dataset.m; if (k === 'chart') closeSheets(); else if (k === 'replay') openModal($('[data-rmodal]')); else openSheet(k); return; }
    if (e.target === scrim) return closeSheets();
    const cl = e.target.closest('[data-close]'); if (cl) { const p = A.pos.find(x => x.id === +cl.dataset.close); if (p) { const mk = markOf(p); if (mk == null) toast('No price for this coin yet — try again in a moment.'); else P.close(p, mk, p.mode === 'replay' ? R.clock : Date.now(), 'Closed by you'); } return; }
    const be = e.target.closest('[data-be]'); if (be) { const p = A.pos.find(x => x.id === +be.dataset.be); if (p) { const mk = markOf(p); if (p.side === 1 ? mk > p.entry : mk < p.entry) { p.sl = p.entry; changed(); toast('Stop moved to the entry price.'); } else toast('The trade has to be in profit before the stop can go to the entry.', 'down'); } return; }
    const cn = e.target.closest('[data-cancel]'); if (cn) { A.ord = A.ord.filter(o => o.id !== +cn.dataset.cancel); changed(); toast('Order cancelled.'); return; }
    const ed = e.target.closest('[data-edit]'); if (ed && !ed.querySelector('input')) return editCell(ed);
    const go = e.target.closest('[data-goto]'); if (go && !e.target.closest('button')) { if (go.dataset.goto !== U.sym) setSymbol(go.dataset.goto); return; }
    const wl = e.target.closest('.wl-row'); if (wl) { setSymbol(wl.dataset.s, exFor(wl.dataset.s)); if (phone()) closeSheets(); return; }
    const rq = e.target.closest('[data-rq]'); if (rq) { $('[data-rdate]').value = toLocalInput(rq.dataset.rq === 'today' ? rToday() : Date.now() - parseInt(rq.dataset.rq, 10) * DAY); return; }
    const sx = e.target.closest('[data-sex]'); if (sx) { sEx = sx.dataset.sex; $$('[data-sex]').forEach(b => b.classList.toggle('on', b === sx)); renderSearch(); return; }
    if (!e.target.closest('.dk-ind')) { const p = $('[data-indpop]'); if (!p.hidden) { p.hidden = true; $('[data-act="ind"]').setAttribute('aria-expanded', 'false'); } }
    if (!e.target.closest('.dk-more')) moreClose();
  });
  $('[data-tfsel]').addEventListener('change', e => setTF(e.target.value));
  $$('[data-ind]').forEach(i => i.addEventListener('change', () => {
    U[i.dataset.ind] = i.checked; saveUI(); headUI();
    if (i.dataset.ind === 'volMa' || i.dataset.ind === 'volHi') volSet();
    else if (i.dataset.ind === 'vol') { volSet(); cs.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: U.vol ? 0.18 : 0.06 } }); }
    else if (i.dataset.ind === 'smc') { U.choch = U.smc; U.bos = U.smc; U.eq = U.smc; U.liq = U.smc; saveUI(); headUI(); smcSchedule(); }
    else if (i.dataset.ind === 'choch' || i.dataset.ind === 'bos' || i.dataset.ind === 'eq' || i.dataset.ind === 'liq') smcSchedule();
    else if (i.dataset.ind === 'pdhl') { pdCheck(); prim.req(); } else if (i.dataset.ind === 'smcTaken' || i.dataset.ind === 'aplusDone' || i.dataset.ind === 'hilo') prim.req(); else if (i.dataset.ind === 'smcFvg' || i.dataset.ind === 'tline' || i.dataset.ind === 'tlineHtf') { if (i.dataset.ind === 'tline' && !U.tline) { TLF.live = {}; TLF.replay = {}; tlSave(); } smcSchedule(); } else if (i.dataset.ind === 'qt') qtUI(); else if (i.dataset.ind === 'aplus' || i.dataset.ind === 'aplusPause' || i.dataset.ind === 'aplusAlert' || i.dataset.ind === 'aplusRing' || i.dataset.ind === 'aplusRingTrig' || i.dataset.ind === 'aplusFull') emit('aplus'); else if (i.dataset.ind === 'poi' || i.dataset.ind === 'poiAll' || i.dataset.ind === 'poiPause') emit('poi'); else setEMAs();
    legend();
  }));
  $('[data-speed]').addEventListener('change', e => { R.speed = +e.target.value; saveR(); });
  $('[data-stepsize]').addEventListener('change', e => { R.step = e.target.value; saveR(); });
  tk.addEventListener('input', e => {
    if (e.target.dataset.f === 'lev') { U.lev = +e.target.value; saveUI(); }
    renderTicket(); syncLines(); qtUI(); $('[data-tkerr]').hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (anyModal()) { if (e.key === 'Escape') closeModals(); return; }
    if (e.target.closest && e.target.closest('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && TOOL === 'pen') { e.preventDefault(); penUndo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') { if (Q.on) qEnd(); menuClose(); if (DRAFT || TOOL !== 'cursor') setTool('cursor'); if (PICK) clearPick(); if (MEASURE) { MEASURE = null; prim.req(); } if (SEL) { SEL = null; selUI(); prim.req(); } closeSheets(); }
    else if (SEL && /^Arrow(Up|Down|Left|Right)$/.test(k)) { e.preventDefault(); nudgeSel(k, e.shiftKey); }
    else if (k === ' ' && R.on) { e.preventDefault(); if (R.playing) pausePlay(); else play(); }
    else if (k === 'ArrowRight' && R.on) { e.preventDefault(); pausePlay(); step(); }
    else if (k === 'ArrowLeft' && R.on) { e.preventDefault(); stepBack(); }
    else if ((k === 'Delete' || k === 'Backspace') && SEL) { e.preventDefault(); removeSel(); }
    else { const map = { p: 'pen', t: 'trend', h: 'hline', r: 'ray', b: 'rect', f: 'fib', m: 'measure' }; if (map[k.toLowerCase()]) setTool(map[k.toLowerCase()]); }
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) root.classList.remove('full'); });
  // drag the top edge of the positions panel to make it taller or shorter (remembered)
  const bres = $('[data-bres]');
  const setBH = h => { if (h) root.style.setProperty('--bhu', h + 'px'); else root.style.removeProperty('--bhu'); };
  setBH(U.bh);
  if (bres) {
    bres.addEventListener('pointerdown', e => {
      if (phone() || U.bmin || e.button !== 0) return;
      e.preventDefault();
      const y0 = e.clientY, h0 = bottom.getBoundingClientRect().height;
      try { bres.setPointerCapture(e.pointerId); } catch (er) { /* gone */ }
      root.classList.add('b-drag');
      const mv = ev => { U.bh = Math.round(Math.max(110, Math.min(window.innerHeight * 0.62, h0 + (y0 - ev.clientY)))); setBH(U.bh); };
      const up = () => { bres.removeEventListener('pointermove', mv); bres.removeEventListener('pointerup', up); bres.removeEventListener('pointercancel', up); root.classList.remove('b-drag'); saveUI(); };
      bres.addEventListener('pointermove', mv); bres.addEventListener('pointerup', up); bres.addEventListener('pointercancel', up);
    });
    bres.addEventListener('dblclick', () => { U.bh = 0; setBH(0); saveUI(); });
  }
  window.addEventListener('pagehide', () => { if (R.on) saveR(); saveAcctNow(); emit('hide'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (R.on) saveR(); saveAcctNow(); emit('hide'); } if (!document.hidden) pollLive(); });   // the live feed checks itself on return

  // ------------------------------------------------------------------ start
  window.__rd = { S, R, U, EX, exFor, resOf, mktName, get A() { return A; }, P, acct: { fresh: freshAcct, fix: acctFix, bal: acctBal, saveNow: saveAcctNow, set: a => { A = acctFix(a); R.back = []; saveAcctNow(); renderAll(); setMarkers(); prim.req(); }, changed: () => changed(), newId, HIST_MAX }, chart, cs, step, stepBack, get SEL() { return SEL; }, drawings: () => DRAW[U.sym] || [], enterReplay, exitReplay, setSymbol, setTF, place,   // for tests and the curious
    // the admin layer's handles (deskadmin.js loads after this file)
    ext: X, watchlist: () => WL.slice(), renderWatch, on: (n, f) => { (X.ev[n] = X.ev[n] || []).push(f); }, openAt, syncLines, setMarkers, openSheet, closeSheets, sideTab, openModal, closeModals,
    startPick, clearPick, hint, toast, COL, candleOpts, volColor, LS: LC.LineStyle, get PREC() { return PREC; }, get SMCR() { return SMCR; }, get FVGS() { return FVGS; }, get FVGBOX() { return FVGBOX; }, get TLS() { return TLS; }, TLF, get PDAY() { return PDAY; }, get SMCDRAWN() { return SMCDRAWN; }, get TLBOX() { return TLBOX; }, FVG_LEN, marksNow: () => (markers && markers.markers ? markers.markers() : []), get BTAB() { return BTAB; },
    setBTab: t => { BTAB = t; if (U.bmin) { U.bmin = false; saveUI(); root.classList.remove('b-min'); } renderBottom(false); }, renderBottom: () => renderBottom(false),
    menuOpen: (x, y, p) => menuOpen(x, y, p != null ? { p: rt(p), what: 'chart price', t: null } : snapAt(x, y)), menuClose, qStart, qPlan, qEnd, Q, paperSubmit, readT, store, chartEl, box,
    t2x, p2y, label, req: () => prim.req(), tlSave, paint: { fvg: paintFVG, tl: paintTL, smc: paintSMC, pd: paintPD, hilo: paintHiLo, covers: coversOf }, legend: () => legend(), refreshMarkers: () => setMarkers(), get PICK() { return PICK; }, FEE_T,
    pause: () => { if (R.playing) pausePlay(); },
    get lastPx() { return S.lastPx; },
    util: { fp, money, pct, fq, fr, fv, esc, rt, coin, tshort, tnice, dur, num, ic, phone, hexA, nowT, fetchRange, fetchSpan, api, TF, RES, resOf, mktName, bucket, nextB, smcOpt, MIN, HOUR, DAY, WEEK, WEEK_OFF, liqOf, fvgScan, tlSnap, tlAfterOn, tlTop, t2lOf, l2xOf, emaOf, EMAS } };
  root.classList.toggle('b-min', !!U.bmin);
  playUI(); toolUI(); headUI(); renderWatch(); renderAll(); stepLabel();
  symList(U.ex).then(() => { if (S.bars.length) applyMeta(); }).catch(() => { /* precision guessed from prices */ });
  const rs = store.get('rd-replay-v1', null);
  if (rs && rs.sym && rs.clock && rs.clock < Date.now()) {
    U.sym = rs.sym; if (rs.ex) U.ex = rs.ex; R.on = true; R.clock = rs.clock; R.step = rs.step === 'small' ? 'small' : 'bar'; R.speed = +rs.speed || 800;
    if (rs.sid && A.sess.some(x => x.id === rs.sid)) R.sid = rs.sid; else newSession();
    modeUI(); rebuildReplay();
  } else { modeUI(); loadLive(); }
  pollLive(); setInterval(pollLive, 4000);
  setInterval(() => pollWatch(false), 12000);
})();
