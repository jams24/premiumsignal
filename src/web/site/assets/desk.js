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
  const TF = {
    '1m': { ms: MIN, b: '1m', y: '1' }, '5m': { ms: 5 * MIN, b: '5m', y: '5' }, '15m': { ms: 15 * MIN, b: '15m', y: '15' },
    '1H': { ms: HOUR, b: '1h', y: '60' }, '4H': { ms: 4 * HOUR, b: '4h', y: '240' }, '1D': { ms: DAY, b: '1d', y: 'D' }, '1W': { ms: WEEK, b: '1w', y: 'W' },
  };
  const RES = { '1m': '1m', '5m': '1m', '15m': '1m', '1H': '1m', '4H': '5m', '1D': '15m', '1W': '1H' };   // replay feed per chart timeframe
  const FEE_T = 0.0005, FEE_M = 0.0002, MMR = 0.005, START_BAL = 10000;
  const bucket = (t, tf) => tf === '1W' ? Math.floor((t - WEEK_OFF) / WEEK) * WEEK + WEEK_OFF : Math.floor(t / TF[tf].ms) * TF[tf].ms;
  const floorTo = (t, ms) => Math.floor(t / ms) * ms, ceilTo = (t, ms) => Math.ceil(t / ms) * ms;
  const phone = () => window.matchMedia('(max-width: 899px)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } },
  };
  const U = Object.assign({ sym: 'BTCUSDT', ex: 'binance', tf: '15m', vol: true, ema20: false, ema50: false, ema200: false, smc: false,
    magnet: false, bmin: false, margin: 100, lev: 10, qt: true, qtk: 'mkt', bh: 0 }, store.get('rd-ui-v1', {}));
  if (!TF[U.tf]) U.tf = '15m';
  if (U.ex !== 'bybit') U.ex = 'binance';
  const saveUI = () => store.set('rd-ui-v1', U);
  // extension points: the admin layer (/assets/deskadmin.js, served to admins only) adds chart lines, markers and bottom tabs
  // and listens to these events: sym (coin changed), mode (live ⇄ replay), tick (prices / clock moved), pane (side tab),
  // load (a new chart is on: coin, timeframe or replay start). menu: sections for the chart's trade menu; quickReal: takes a
  // real order planned on the chart to its review dialog; realActive: true while the Real ticket is the one in use.
  // draw: [(g, W, z)] painted on the chart (z 'bottom' under the candles, 'top' over them) · smcOff: the coach draws the SMC itself
  const X = { lines: [], marks: [], bottom: {}, ev: {}, menu: [], quickReal: null, realActive: null, realSize: null, draw: [], smcOff: false };
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
      if (!r.ok) { let m = 'HTTP ' + r.status; try { const j = await r.json(); if (j && j.msg) m = j.msg; } catch (e) { /* not json */ } const er = new Error(m); er.status = r.status; throw er; }
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
        return d.symbols.filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
          .map(s => ({ s: s.symbol, b: s.baseAsset, k: (s.filters.find(f => f.filterType === 'PRICE_FILTER') || {}).tickSize || '0.01', t0: s.onboardDate || 0 }));
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
            .map(s => ({ s: s.symbol, b: s.baseCoin, k: s.priceFilter.tickSize, t0: +s.launchTime || 0 })));
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
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COL = {};
  const readCol = () => Object.assign(COL, { up: css('--up'), down: css('--down'), pri: css('--primary'), warn: css('--warn'), acc: css('--accent'), text: css('--text'), muted: css('--muted'), bg: css('--dk-bg'), panel: css('--panel') });
  readCol();
  const box = $('[data-chart]');
  const chart = LC.createChart(box, {
    autoSize: true,
    layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted, fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace", fontSize: 11 },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    crosshair: { mode: LC.CrosshairMode.Normal, vertLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') }, horzLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') } },
    rightPriceScale: { borderColor: css('--dk-line'), scaleMargins: { top: 0.08, bottom: 0.18 } },
    timeScale: { borderColor: css('--dk-line'), timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 8, minBarSpacing: 1 },
  });
  const cs = chart.addSeries(LC.CandlestickSeries, { upColor: COL.up, downColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down, borderVisible: false, priceLineStyle: LC.LineStyle.Dashed });
  const vs = chart.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  const EMAS = { ema20: [20, '#f5a524'], ema50: [50, '#4f7cff'], ema200: [200, '#c084fc'] };
  const es = {};
  for (const k in EMAS) es[k] = chart.addSeries(LC.LineSeries, { color: EMAS[k][1], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: !!U[k] });
  const markers = typeof LC.createSeriesMarkers === 'function' ? LC.createSeriesMarkers(cs, []) : null;

  function applyTheme() {
    readCol();
    chart.applyOptions({
      layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      crosshair: { vertLine: { labelBackgroundColor: css('--panel-3') }, horzLine: { labelBackgroundColor: css('--panel-3') } },
      rightPriceScale: { borderColor: css('--dk-line') }, timeScale: { borderColor: css('--dk-line') },
    });
    cs.applyOptions({ upColor: COL.up, downColor: COL.down, wickUpColor: COL.up, wickDownColor: COL.down });
    if (S.bars.length) vs.setData(U.vol ? S.bars.map(toV) : []);
    setMarkers(); syncLines(); prim.req(); emit('theme');
  }
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ------------------------------------------------------------------ state
  const S = { bars: [], gen: 0, lastPx: null, marks: {}, rpx: {}, loadingOld: false, noOld: false, ws: null, wsT: null, fellBack: false };
  const R = { on: false, clock: 0, buf: [], bufEnd: 0, res: '1m', playing: false, timer: null, busy: false, end: false, step: 'bar', speed: 800, gen: 0, fetching: null };
  const toC = b => ({ time: b[0] / 1000, open: b[1], high: b[2], low: b[3], close: b[4] });
  const toV = b => ({ time: b[0] / 1000, value: b[5], color: hexA(b[4] >= b[1] ? COL.up : COL.down, 0.35) });
  const lastBar = () => S.bars[S.bars.length - 1];
  const nowT = () => R.on ? R.clock : Date.now();

  function emaArr(n) {
    const out = [], k = 2 / (n + 1); let e = null, sum = 0;
    for (let i = 0; i < S.bars.length; i++) {
      const c = S.bars[i][4];
      if (i < n - 1) { sum += c; continue; }
      if (e == null) { sum += c; e = sum / n; } else e = c * k + e * (1 - k);
      out.push({ time: S.bars[i][0] / 1000, value: e });
    }
    return out;
  }
  function setEMAs() { for (const k in EMAS) { es[k].applyOptions({ visible: !!U[k] }); es[k].setData(U[k] ? emaArr(EMAS[k][0]) : []); } }
  function setAll() {
    cs.setData(S.bars.map(toC)); vs.setData(U.vol ? S.bars.map(toV) : []); setEMAs();
    smcSchedule(); syncLines(); legend(); prim.req();
  }
  function showRecent() { const n = S.bars.length; chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (phone() ? 90 : 160)), to: n + 10 }); }

  // ------------------------------------------------------------------ live mode
  async function loadLive() {
    const g = ++S.gen; stopStream(); clearPick();
    loading(`Loading ${U.sym} ${U.tf}…`);
    try {
      const bars = await api().klines(U.sym, U.tf, { limit: 1000 });
      if (g !== S.gen) return;
      if (!bars.length) throw new Error(`No candles for ${U.sym} on ${api().name}.`);
      S.bars = bars; S.noOld = false; S.lastPx = bars[bars.length - 1][4]; S.marks[U.sym] = S.lastPx;
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
    cs.update(toC(k)); if (U.vol) vs.update(toV(k)); emaLast();
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
  function saveR() { store.set('rd-replay-v1', R.on ? { sym: U.sym, ex: U.ex, clock: R.clock, step: R.step, speed: R.speed } : null); }
  let saveRT = 0;
  const saveRSoon = () => { if (Date.now() - saveRT > 2000) { saveRT = Date.now(); saveR(); } };

  async function enterReplay(t) {
    const tfms = TF[U.tf].ms;
    if (!isFinite(t) || t > Date.now() - 2 * tfms) { toast('Pick a moment in the past.'); return; }
    closeModals(); pausePlay(); clearPick();
    if (R.on) P.closeMode('replay', 'Replay restarted');
    R.on = true; R.clock = bucket(t, U.tf);
    stopStream(); modeUI(); saveR();
    await rebuildReplay();
  }
  async function rebuildReplay() {
    const g = ++S.gen; R.gen = g; pausePlay();
    R.res = RES[U.tf]; R.buf = []; R.bufEnd = R.clock; R.end = false; R.fetching = null;
    stepLabel();
    loading(`Rewinding ${U.sym} to ${tnice(R.clock)}…`);
    try {
      const b0 = bucket(R.clock, U.tf);
      const hist = await api().klines(U.sym, U.tf, { end: b0 - 1, limit: 1000 });
      if (g !== S.gen) return;
      const span = R.clock > b0 ? await fetchSpan(U.sym, b0, R.clock, R.res) : [];
      if (g !== S.gen) return;
      S.bars = hist.filter(k => k[0] < b0); S.noOld = false;
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
      const target = R.step === 'small' ? (R.buf.length ? R.buf[0][0] + R.buf[0][6] : R.clock + TF[R.res].ms) : bucket(R.clock, U.tf) + TF[U.tf].ms;
      await ensureBuf(target);
      if (g !== R.gen) return;
      const n0 = S.bars.length; let changed = Infinity;
      while (R.buf.length && R.buf[0][0] < target) {
        const k = R.buf.shift();
        if (k[0] < R.clock) continue;
        changed = Math.min(changed, aggInto(k));
        S.lastPx = k[4]; S.rpx[U.sym] = k[4];
        R.clock = k[0] + k[6];
        P.candle(U.sym, k, 'replay');
      }
      if (R.bufEnd >= target) R.clock = Math.max(R.clock, target);
      if (changed !== Infinity) {
        for (let i = changed; i < S.bars.length; i++) { cs.update(toC(S.bars[i])); if (U.vol) vs.update(toV(S.bars[i])); }
        if (S.bars.length !== n0 || R.step !== 'small') smcSchedule(); else smcSchedule();
        emaLast();
      } else if (R.end && !R.buf.length) { pausePlay(); toast("You've reached the present. Exit the replay to trade the live market."); }
      clockUI(); tickUI(); if (R.playing) saveRSoon(); else saveR();
      if (R.buf.length < 300 && !R.end) ensureBuf(R.bufEnd + 1).catch(() => { /* next step retries */ });
    } catch (e) { pausePlay(); toast('Could not load the next candles: ' + e.message, 'down'); } finally { R.busy = false; }
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
    R.on = false; R.gen++; R.buf = []; saveR(); modeUI(); loadLive();
  }

  // ------------------------------------------------------------------ paper account (this browser only)
  const freshAcct = () => ({ v: 1, start: START_BAL, bal: START_BAL, pos: [], ord: [], hist: [], seq: 1, seen: {} });
  let A = store.get('rd-acct-v1', null);
  if (!A || A.v !== 1) A = freshAcct();
  let saveAT = null;
  const saveAcct = () => { clearTimeout(saveAT); saveAT = setTimeout(() => store.set('rd-acct-v1', A), 300); };
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
      A.bal -= fee;
      const p = { id: A.seq++, sym: o.sym, ex: o.ex, side: o.side, qty, entry: px, lev: o.lev, margin: o.margin, sl: o.sl || null, tp: o.tp || null,
        t, mode: o.mode, fee, risk: o.sl ? Math.abs(px - o.sl) * qty + fee : null, liq: liqOf(o.side, px, o.lev) };
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
      A.bal += pnl - fee;
      const net = pnl - fee - p.fee;
      A.hist.unshift({ id: p.id, sym: p.sym, side: p.side, lev: p.lev, qty: p.qty, margin: p.margin, entry: p.entry, exit: px, pnl: net,
        r: p.risk ? net / p.risk : null, why, t0: p.t, t1: t, mode: p.mode });
      if (A.hist.length > 500) A.hist.length = 500;
      const label = `${coin(p.sym)} ${p.side === 1 ? 'long' : 'short'}`;
      toast(`${why === 'Target' ? 'Target hit' : why === 'Stop' ? 'Stop hit' : why === 'Liquidated' ? 'Liquidated' : 'Closed'}: ${label} ${money(net, true)}${p.risk ? ' (' + fr(net / p.risk) + ')' : ''}`, net >= 0 ? 'up' : 'down');
      changed();
    },
    fill(o, px, t) {
      const i = A.ord.indexOf(o); if (i < 0) return;
      A.ord.splice(i, 1);
      P.open(o, px, t, o.kind !== 'stop');   // a stop entry fills as a market order (taker fee)
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
        if (!ev) return;
        ev.run(t); a = ev.px;
      }
    },
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
      <p class="acct-note">Practice money only, saved in this browser. Fees 0.05% market / 0.02% limit.</p>`;
  }

  // ------------------------------------------------------------------ positions / orders / history / stats
  let BTAB = 'pos', bottomAt = 0;
  const sd = s => `<span class="sd ${s === 1 ? 'up' : 'down'}">${s === 1 ? 'LONG' : 'SHORT'}</span>`;
  const rtag = it => (it.mode === 'replay' ? '<span class="tag-r">REPLAY</span>' : '');
  function renderBottom(soft) {
    if (soft && Date.now() - bottomAt < 300) return;
    bottomAt = Date.now();
    const body = $('[data-bbody]');
    if (body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;   // inline edit in progress
    $$('[data-cnt="pos"]').forEach(e => { e.textContent = A.pos.length; });
    $$('[data-cnt="ord"]').forEach(e => { e.textContent = A.ord.length; });
    const pm = $('[data-cnt="pos-m"]'); pm.hidden = !A.pos.length; pm.textContent = A.pos.length;
    $$('[data-btab]').forEach(b => b.classList.toggle('on', b.dataset.btab === BTAB));
    if (X.bottom[BTAB]) { body.innerHTML = X.bottom[BTAB](); return; }
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
      else html = `<table class="pt"><thead><tr><th>Coin</th><th>Opened</th><th>Closed</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Why</th></tr></thead><tbody>${A.hist.slice(0, 200).map(h => `
        <tr data-goto="${esc(h.sym)}"><td>${sd(h.side)}<b>${esc(coin(h.sym))}</b> <span class="muted">${h.lev}×</span>${rtag(h)}</td><td class="muted">${tshort(h.t0)}</td><td class="muted">${tshort(h.t1)}</td>
        <td>${fp(h.entry, Math.max(2, PREC))}</td><td>${fp(h.exit, Math.max(2, PREC))}</td><td class="${h.pnl >= 0 ? 'up' : 'down'}">${money(h.pnl, true)}</td><td class="${(h.r || 0) >= 0 ? 'up' : 'down'}">${fr(h.r)}</td><td class="muted">${esc(h.why)}</td></tr>`).join('')}</tbody></table>
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
  let TOOL = 'cursor', DRAFT = null, MEASURE = null, SEL = null, DRAG = null, PICK = null, SMCR = null;
  const ONE = new Set(['hline', 'ray']), TWO = new Set(['trend', 'rect', 'fib', 'measure']);
  const FIBS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  function t2l(t) {
    const B = S.bars, n = B.length, ms = TF[U.tf].ms; if (!n) return null;
    if (t <= B[0][0]) return (t - B[0][0]) / ms;
    if (t >= B[n - 1][0]) return n - 1 + (t - B[n - 1][0]) / ms;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (B[m][0] <= t) lo = m; else hi = m; }
    return lo + (t - B[lo][0]) / (B[hi][0] - B[lo][0]);
  }
  const t2x = t => { const l = t2l(t); return l == null ? null : chart.timeScale().logicalToCoordinate(l); };
  function x2t(x) {
    const B = S.bars, n = B.length, ms = TF[U.tf].ms;
    let l = chart.timeScale().coordinateToLogical(x); if (l == null || !n) return null;
    l = Math.round(l);
    if (l <= 0) return B[0][0] + l * ms;
    if (l >= n - 1) return B[n - 1][0] + (l - n + 1) * ms;
    return B[l][0];
  }
  const p2y = p => cs.priceToCoordinate(p), y2p = y => cs.coordinateToPrice(y);
  function tp(x, y) {
    const t = x2t(x); let p = y2p(y);
    if (U.magnet && t != null) {
      const b = S.bars[Math.round(t2l(t))];
      if (b) { let best = p, bd = Infinity; for (const v of [b[1], b[2], b[3], b[4]]) { const d = Math.abs(p2y(v) - y); if (d < bd) { bd = d; best = v; } } if (bd < 36) p = best; }
    }
    return { t, p };
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
    if (sel) for (const [x, y] of (d.type === 'hline' ? [] : P)) { g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fillStyle = COL.bg; g.fill(); g.lineWidth = 1.5; g.strokeStyle = COL.pri; g.stroke(); }
  }
  function drawSMC(g, W) {
    const r = SMCR; if (!r) return;
    for (const z of r.zones.filter(z => !z.broken).slice(-6)) {
      const x0 = t2x(z.t), y0 = p2y(z.top), y1 = p2y(z.bot); if (x0 == null || y0 == null || y1 == null) continue;
      const c = z.type === 'demand' ? COL.up : COL.down;
      g.fillStyle = hexA(c, 0.11); g.fillRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      g.strokeStyle = hexA(c, 0.45); g.lineWidth = 1; g.strokeRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      label(g, z.type === 'demand' ? 'Demand' : 'Supply', x0 + 2, Math.min(y0, y1) + 9, c, 'left', 'transparent');
    }
    for (const e of r.eqs.filter(e => !e.taken).slice(-4)) {
      const x0 = t2x(e.t1), y = p2y(e.p); if (x0 == null || y == null) continue;
      g.strokeStyle = hexA(COL.warn, 0.85); g.setLineDash([2, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
      label(g, e.kind, W - 4, y + (e.side === 'H' ? -9 : 9), COL.warn, 'right', 'transparent');
    }
    for (const b of r.breaks.slice(-8)) {
      const x0 = t2x(b.fromT), x1 = t2x(b.t), y = p2y(b.p); if (x0 == null || x1 == null || y == null) continue;
      const c = b.dir === 1 ? COL.up : COL.down;
      g.strokeStyle = c; g.setLineDash([5, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
      label(g, b.kind, (x0 + x1) / 2, y + (b.dir === 1 ? -9 : 9), c, 'center', 'transparent');
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
    { zOrder: () => 'bottom', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => { if (U.smc && !X.smcOff) drawSMC(s.context, s.mediaSize.width); xDraw(s.context, s.mediaSize.width, 'bottom'); }) }) },
    { zOrder: () => 'top', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => {
      const g = s.context, W = s.mediaSize.width;
      for (const d of DRAW[U.sym] || []) drawOne(g, d, W, d === SEL);
      if (DRAFT) drawOne(g, DRAFT, W, true);
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
  function hitDrawing(x, y) {
    const list = DRAW[U.sym] || [];
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i], P = d.pts.map(q => [t2x(q.t), p2y(q.p)]);
      if (P.some(q => q[0] == null || q[1] == null)) continue;
      if (d.type !== 'hline') for (let h = 0; h < P.length; h++) if (Math.hypot(P[h][0] - x, P[h][1] - y) < 10) return { d, h };
      const [x0, y0] = P[0], x1 = P[1] ? P[1][0] : 0, y1 = P[1] ? P[1][1] : 0;
      let hit = false;
      if (d.type === 'hline') hit = Math.abs(y - y0) < 6;
      else if (d.type === 'ray') hit = Math.abs(y - y0) < 6 && x > x0 - 6;
      else if (d.type === 'trend') hit = distSeg(x, y, x0, y0, x1, y1) < 6;
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
    if (TWO.has(TOOL) || ONE.has(TOOL)) {
      e.stopPropagation(); e.preventDefault();
      const pt = tp(x, y); if (pt.t == null || pt.p == null) return;
      if (ONE.has(TOOL)) { addDrawing({ type: TOOL, pts: [pt] }); setTool('cursor'); return; }
      if (!DRAFT) { DRAFT = { type: TOOL, pts: [pt, Object.assign({}, pt)] }; PD = { kind: 'draft', x, y }; if (TOOL === 'measure') MEASURE = null; prim.req(); }
      else { DRAFT.pts[1] = pt; finishDraft(); }
      return;
    }
    const L = hitLine(y);
    if (L) { e.stopPropagation(); e.preventDefault(); lock(true); DRAG = { key: L.key, e: L.e, price: L.e.w.price }; PD = { kind: 'line' }; return; }
    const H = hitDrawing(x, y);
    if (H) {
      e.stopPropagation(); e.preventDefault(); lock(true);
      SEL = H.d; selUI(); prim.req();
      PD = { kind: 'drawing', h: H.h, d: H.d, t0: x2t(x), p0: y2p(y), orig: H.d.pts.map(q => Object.assign({}, q)) };
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
    if (DRAFT) { const pt = tp(x, y); if (pt.t != null && pt.p != null) { DRAFT.pts[1] = pt; prim.req(); } return; }
    if (!PD) { hover(x, y); return; }
    if (PD.kind === 'line' && DRAG) {
      const v = rt(y2p(y)); if (!isFinite(v)) return;
      DRAG.price = v; DRAG.e.line.applyOptions({ price: v, title: DRAG.e.w.dragTitle ? DRAG.e.w.dragTitle(v) : DRAG.e.w.title.split(' ')[0] + ' ' + fp(v) });
      ltip.hidden = true;
    } else if (PD.kind === 'drawing') {
      const d = PD.d;
      if (PD.h >= 0) { const pt = tp(x, y); if (pt.t != null && pt.p != null) d.pts[PD.h] = pt; }
      else {
        const t = x2t(x), p = y2p(y); if (t == null || p == null) return;
        const dt = t - PD.t0, dp = p - PD.p0;
        d.pts = PD.orig.map(q => ({ t: q.t + dt, p: q.p + dp }));
      }
      prim.req();
    }
  });
  window.addEventListener('pointerup', e => {
    const { x, y } = loc(e);
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
      lock(TWO.has(TOOL) || ONE.has(TOOL));
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
      const s = Q.side, k = Q.real ? 'limit' : s === 1 ? (v < px ? 'limit' : 'stop') : (v > px ? 'limit' : 'stop');
      lab = `${s === 1 ? 'BUY' : 'SELL'} ${k.toUpperCase()} ${fp(v)} · ${from(v, px)}`; tone = s === 1 ? 'up' : 'down';
      bad = qEntryBad(v) ? (Q.real ? `must be ${s === 1 ? 'below' : 'above'} the price` : 'at the price') : '';
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
    else if (TWO.has(TOOL) || ONE.has(TOOL)) c = 'c-draw';
    else if (inPane(x, y) && hitLine(y)) c = 'c-ns';
    else if (inPane(x, y) && hitDrawing(x, y)) c = 'c-move';
    else if (TOOL === 'cross') c = 'c-cross';
    box.className = 'dk-canvas' + (c ? ' ' + c : '');
  }
  function finishDraft() {
    const d = DRAFT; DRAFT = null;
    if (d.type === 'measure') { MEASURE = d; setTool('cursor'); prim.req(); return; }
    addDrawing(d); setTool('cursor');
  }
  function addDrawing(d) {
    (DRAW[U.sym] = DRAW[U.sym] || []).push({ id: Date.now() + Math.random(), type: d.type, pts: d.pts.map(q => ({ t: q.t, p: q.p })) });
    if (DRAW[U.sym].length > 200) DRAW[U.sym].shift();
    saveDraw(); prim.req();
  }
  function removeSel() { if (!SEL) return; DRAW[U.sym] = (DRAW[U.sym] || []).filter(d => d !== SEL); SEL = null; saveDraw(); selUI(); prim.req(); }
  function setTool(t) {
    if (t === 'magnet') { U.magnet = !U.magnet; saveUI(); toolUI(); toast(U.magnet ? 'Magnet on: points snap to candle open / high / low / close' : 'Magnet off'); return; }
    if (t === 'clear') { hint(`Remove all ${(DRAW[U.sym] || []).length} drawings on ${esc(U.sym)}?`, [['Remove', () => { DRAW[U.sym] = []; SEL = null; saveDraw(); prim.req(); hint(); }], ['Cancel', () => hint()]]); return; }
    TOOL = t; DRAFT = null; lock(TWO.has(t) || ONE.has(t)); toolUI();
    if (t !== 'cursor' && t !== 'cross') { hint(`${{ trend: 'Trend line', hline: 'Horizontal line', ray: 'Horizontal ray', rect: 'Rectangle', fib: 'Fibonacci', measure: 'Measure' }[t]}: ${ONE.has(t) ? 'tap the chart at the price' : 'drag across the chart, or tap two points'}`, [['Cancel', () => setTool('cursor')]]); }
    else hint();
    if (phone()) root.classList.toggle('tools-open', false);
    prim.req();
  }
  function toolUI() { $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === TOOL || (b.dataset.tool === 'magnet' && U.magnet))); }
  const hintEl = $('[data-hint]');
  function hint(text, btns) {
    if (!text) { hintEl.hidden = true; hintEl.innerHTML = ''; return; }
    hintEl.innerHTML = `<span>${text}</span>${(btns || []).map((b, i) => `<button type="button" data-h="${i}">${esc(b[0])}</button>`).join('')}`;
    hintEl.hidden = false; hintEl._b = btns || [];
  }
  hintEl.addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (b && hintEl._b[+b.dataset.h]) hintEl._b[+b.dataset.h][1](); });
  function selUI() { if (SEL) hint('Drawing selected', [['Delete', removeSel], ['Done', () => { SEL = null; prim.req(); hint(); }]]); else if (!PICK && TOOL === 'cursor') hint(); }

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
  const realOn = () => !!(X.quickReal && X.realActive && X.realActive() && !R.on);
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
      chips('Chart:', [['Line', () => addDrawing({ type: 'hline', pts: [{ t: sp.t != null ? sp.t : lastBar()[0], p: v }] })], ['Copy', () => copyPrice(v)]], { icon: 'minus' }),
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
  // where a limit entry for this side may go: a real one only on the limit side (the bot places limit entries only)
  const qEntryBad = v => { const px = S.lastPx; if (!px || !Q.side) return ''; if (Math.abs(v / px - 1) < 2e-4) return 'That is the price now — click away from it, or use Market now.';
    if (Q.real && (Q.side === 1 ? v >= px : v <= px)) return `A real ${Q.side === 1 ? 'buy' : 'sell'} limit goes ${Q.side === 1 ? 'below' : 'above'} the price now (${fp(px)}) — the bot places limit entries only. Or use Market now.`; return ''; };
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
    const kind = Q.mkt ? 'market' : s && hasE ? qKind() : Q.side ? (Q.real ? 'limit' : 'order') : '';
    const kName = s ? `${s === 1 ? 'Buy' : 'Sell'} ${kind === 'market' ? 'at market' : kind}` : (Q.mkt ? 'Market' : 'Entry');
    const step = (n, lab, val, now) => `<span class="${val != null ? 'done' : now ? 'cur' : ''}">${n} ${lab}${val != null ? ' <b class="mono">' + fp(val) + '</b>' : ''}</span>`;
    const canReal = !!X.quickReal && !R.on;
    const B = s === 1 ? 'buy' : 'sell', below = s === 1 ? 'below' : 'above', above = s === 1 ? 'above' : 'below';
    let h = `<div class="qb-top"><b class="${s === 1 ? 'up' : s === -1 ? 'down' : ''}">${ic('zap')} ${s ? (s === 1 ? 'LONG' : 'SHORT') + ' · ' : ''}${kName} ${hasE && !Q.mkt ? fp(Q.entry) : ''}</b>` +
      (canReal ? `<span class="qb-mode" role="radiogroup"><button type="button" data-q="paper" aria-checked="${!Q.real}"${!Q.real ? ' class="on"' : ''}>Paper</button><button type="button" data-q="real" class="${Q.real ? 'on real' : 'real'}" aria-checked="${Q.real}">Real</button></span>` : '<span class="qb-tag">Paper</span>') +
      `<button type="button" class="qb-x" data-q="x" aria-label="Cancel the plan">${ic('x')}</button></div>` +
      `<div class="qb-steps">${step('①', Q.mkt ? 'Market' : 'Entry', Q.mkt ? null : Q.entry, Q.stage === 'entry')}${step('②', 'Stop', Q.sl, Q.stage === 'sl')}${step('③', 'Target', Q.tp, Q.stage === 'tp')}</div>`;
    if (Q.stage === 'entry') h += `<p class="qb-say">Click your <b>${B} price</b> on the chart — ${Q.real ? `${below} the price now (a limit; the bot places limit entries only)` : `${below} the price for a ${B} limit, ${above} it for a ${B} stop`}.</p><div class="qb-row"><button type="button" class="btn btn-ghost btn-sm" data-q="mktnow">Market now instead</button></div>`;
    else if (Q.stage === 'sl') h += `<p class="qb-say">Click your <b>stop</b> on the chart — ${Q.side ? `${below} the entry` : 'below the entry for a long, above it for a short'}.</p>`;
    else if (Q.stage === 'tp') h += `<p class="qb-say">Click your <b>target</b> on the chart (${s === 1 ? 'above' : 'below'} the entry).</p><div class="qb-row"><button type="button" class="btn btn-ghost btn-sm" data-q="skip">${Q.real ? "Use the bot's TP plan" : 'No target'}</button></div>`;
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
    if (Q.real) { if (o.kind === 'stop') return `The bot places limit entries only: a ${o.side === 1 ? 'long' : 'short'} entry has to be ${o.side === 1 ? 'below' : 'above'} the price now — or use Market now.`; return ''; }
    return paperCheck(o);
  }
  function qRead() {
    if (!Q.el || Q.stage !== 'ask') return;
    const r = Q.el.querySelector('[data-qread]'), go = Q.el.querySelector('[data-q="go"]'); if (!r || !go) return;
    const o = qOrder(), e = o.price, dist = Math.abs(e - o.sl), err = qErr();
    const qty = Q.real ? 0 : (o.margin || 0) * o.lev / e, fee = (o.margin || 0) * o.lev * (o.kind === 'limit' ? FEE_M : FEE_T);
    const loss = Q.real ? null : dist * qty + fee * 2, gain = Q.real || o.tp == null ? null : Math.abs(o.tp - e) * qty - fee * 2;
    const rr = o.tp != null ? Math.abs(o.tp - e) / dist : null;
    r.innerHTML = `<span class="down">Stop ${pct((o.sl / e - 1) * 100)}${loss != null ? ' · −' + money(loss).replace('−', '') : ''}</span>` +
      (o.tp != null ? `<span class="up">Target ${pct((o.tp / e - 1) * 100)}${gain != null ? ' · +' + money(gain).replace('+', '') : ''}</span><span><b>${rr.toFixed(2)}R</b></span>` : `<span class="muted">${Q.real ? "TPs: the bot's plan" : 'no target'}</span>`) +
      (loss != null && A.bal > 0 ? `<span class="muted">${(loss / A.bal * 100).toFixed(2)}% of balance</span>` : '') +
      (!Q.real && o.margin > 0 ? `<span class="muted">liq. ${fp(liqOf(o.side, e, o.lev))}</span>` : '') +
      (Q.real ? `<span class="muted">Next: the bot's exact order (size, max loss) to check, then Place.</span>` : '') +
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
  if (U.qtk !== 'lmt') U.qtk = 'mkt';
  function qtUI() {
    const hide = !U.qt || !S.lastPx; QT.hidden = hide; if (hide) return;
    const real = realOn(), t = readT(), busy = real && X.realBusy ? X.realBusy() : '', lim = U.qtk === 'lmt';
    const armed = Q.on && Q.side ? Q.side : 0;
    const side = s => {
      const nm = real ? `Real ${s === 1 ? 'buy' : 'sell'}${lim ? ' limit' : ''}` : `${s === 1 ? 'Buy' : 'Sell'}${lim ? ' limit' : ''}`;
      const tip = lim ? `Then click your ${s === 1 ? 'buy' : 'sell'} price on the chart, your stop and your target${real ? ' — you review the bot\'s exact order before it is placed' : ''}` : `${s === 1 ? 'Buy' : 'Sell'} at market now${real ? ' — you review the bot\'s exact order before it is placed' : ' (paper)'}`;
      return `<button type="button" class="${s === 1 ? 'qt-b' : 'qt-s'}${armed === s ? ' arm' : ''}" data-qt="${s}" title="${esc(tip)}"><span>${nm}</span><b>${lim ? (armed === s ? 'click the chart' : 'pick a price') : fp(S.lastPx)}</b></button>`;
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
    if (!U.smc) { if (SMCR) { SMCR = null; setMarkers(); prim.req(); legend(); } return; }
    if (smcT) return;
    smcT = setTimeout(() => { smcT = null; smcRun(); }, R.playing ? 200 : 20);
  }
  function smcRun() {
    if (!U.smc || !window.SMC) { SMCR = null; setMarkers(); prim.req(); return; }
    const B = S.bars, ms = TF[U.tf].ms;
    let n = B.length; if (n && B[n - 1][0] + ms > nowT()) n--;   // the forming candle is not closed yet
    const base = B.slice(Math.max(0, n - 500), n).map(b => [b[0], b[1], b[2], b[3], b[4], b[5]]);
    if (base.length < 12) { SMCR = null; setMarkers(); prim.req(); return; }
    const l = base[base.length - 1];
    base.push([l[0] + ms, l[4], l[4], l[4], l[4], 0]);   // closes the last real candle; itself ignored
    try { SMCR = window.SMC.analyze(base, base.length - 1, { tf: ms, off: U.tf === '1W' ? WEEK_OFF : 0 }); } catch (e) { SMCR = null; }
    setMarkers(); prim.req(); legend();
  }
  function setMarkers() {
    if (!markers) return;
    const first = S.bars.length ? S.bars[0][0] : 0, M = [];
    if (SMCR && U.smc && !X.smcOff) {
      for (const s of SMCR.swings.slice(-40)) if (s.t >= first) M.push({ time: s.t / 1000, position: s.side === 'H' ? 'aboveBar' : 'belowBar', color: s.side === 'H' ? COL.down : COL.up, shape: 'circle', size: 0.4, text: s.label });
      for (const w of SMCR.sweeps.slice(-6)) if (w.t >= first) M.push({ time: w.t / 1000, position: w.dir === -1 ? 'aboveBar' : 'belowBar', color: COL.warn, shape: w.dir === -1 ? 'arrowDown' : 'arrowUp', text: 'sweep' });
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
    let l2 = U.vol ? `<span>Vol <b>${fv(b[5])}</b></span>` : '';
    for (const k in EMAS) if (U[k]) { const a = emaArr(EMAS[k][0]); const i = a.findIndex(p => p.time === b[0] / 1000); if (i >= 0) l2 += `<span style="color:${EMAS[k][1]}">EMA ${EMAS[k][0]} ${fp(a[i].value)}</span>`; }
    if (U.smc && SMCR) l2 += `<span>SMC trend <b class="${SMCR.trend === 1 ? 'up' : SMCR.trend === -1 ? 'down' : ''}">${SMCR.trend === 1 ? 'up' : SMCR.trend === -1 ? 'down' : '—'}</b></span>`;
    LG.innerHTML = `<div class="l1"><b>${esc(coin(U.sym))}/USDT · ${U.tf} · ${api().name}</b><span class="ohlc"><span><em>O</em>${fp(b[1])}</span><span><em>H</em>${fp(b[2])}</span><span><em>L</em>${fp(b[3])}</span><span class="${cl}"><em>C</em>${fp(b[4])}</span><span class="${cl}">${up ? '+' : '−'}${fp(Math.abs(ch))} (${pct(ch / b[1] * 100)})</span></span></div>${l2 ? `<div class="l2">${l2}</div>` : ''}`;
  }
  chart.subscribeCrosshairMove(p => {
    if (p && p.time != null) { const t = p.time * 1000, B = S.bars; let lo = 0, hi = B.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m][0] <= t) lo = m; else hi = m - 1; } hoverBar = B[lo] && B[lo][0] === t ? B[lo] : null; }
    else hoverBar = null;
    legend();
  });
  function headUI() {
    $('[data-sym]').textContent = U.sym; $('[data-exname]').textContent = api().name;
    $$('[data-tf]').forEach(b => b.classList.toggle('on', b.dataset.tf === U.tf)); $('[data-tfsel]').value = U.tf;
    $('[data-act="smc"]').setAttribute('aria-pressed', String(!!U.smc));
    $$('[data-ind]').forEach(i => { i.checked = !!U[i.dataset.ind]; });
    document.title = `${coin(U.sym)} ${S.lastPx ? fp(S.lastPx) : ''} · ${R.on ? 'Replay' : 'Desk'} · ReplayDesk`;
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
  function stepLabel() { const o = $('[data-stepsize] option[value="small"]'); if (o) o.textContent = 'Step: ' + (RES[U.tf] === '1H' ? '1 hour' : RES[U.tf]); }
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
    const ph = phone(), steps = ph ? ['p1', 'p2'] : ['t1', 't2', 't3', 't4', 't5'];
    topEl.classList.remove('t1', 't2', 't3', 't4', 't5', 'p1', 'p2');
    for (const c of steps) { if (topEl.scrollWidth <= topEl.clientWidth + 1) break; topEl.classList.add(c); }
  }
  const fitSoon = () => { if (!fitQ) { fitQ = true; requestAnimationFrame(fitTop); } };
  if (topEl && window.ResizeObserver) { const ro = new ResizeObserver(fitSoon); [topEl, $('.dk-right'), $('[data-rp]')].forEach(e => e && ro.observe(e)); }
  window.addEventListener('resize', fitSoon);

  let uiQ = false;
  function tickUI() {
    if (uiQ) return; uiQ = true;
    requestAnimationFrame(() => { uiQ = false; legend(); renderTicket(); renderAcct(); renderBottom(true); syncLines(); qtUI(); if (Q.on) qRead(); document.title = `${coin(U.sym)} ${S.lastPx ? fp(S.lastPx) : ''} · ${R.on ? 'Replay' : 'Desk'} · ReplayDesk`; emit('tick'); });
  }
  function renderAll() { renderTicket(); renderAcct(); renderBottom(false); syncLines(); legend(); qtUI(); }

  // ------------------------------------------------------------------ watchlist & coin search
  let WL = store.get('rd-wl-v1', null) || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT', 'LINKUSDT', 'AVAXUSDT', '1000PEPEUSDT'];
  const WLD = {};
  const saveWL = () => store.set('rd-wl-v1', WL);
  function renderWatch() {
    $('[data-watch]').innerHTML = WL.map(s => { const d = WLD[s]; return `<div class="wl-row${s === U.sym ? ' on' : ''}" data-s="${esc(s)}"><b>${esc(coin(s))}</b><span class="mono">${d ? fp(d.px, d.px >= 100 ? 2 : d.px >= 1 ? 4 : 6) : '…'}</span><span class="chg ${d && d.chg < 0 ? 'down' : 'up'}">${d ? pct(d.chg) : ''}</span></div>`; }).join('') || '<p class="wl-note">Your watchlist is empty.</p>';
  }
  const watchVisible = () => !$('[data-pane="watch"]').hidden && (!phone() || $('.dk-side').classList.contains('open'));
  async function pollWatch(force) {
    if (document.hidden || (!force && !watchVisible())) return;
    await Promise.allSettled(WL.map(s => api().ticker(s).then(d => { WLD[s] = d; })));
    renderWatch();
  }
  const sModal = $('[data-search]'), sList = $('[data-slist]'), sIn = $('[data-q]');
  let sEx = U.ex, sSel = 0, sRows = [];
  async function openSearch() {
    sEx = U.ex; $$('[data-sex]').forEach(b => b.classList.toggle('on', b.dataset.sex === sEx));
    openModal(sModal); sIn.value = ''; sIn.focus(); await renderSearch();
  }
  async function renderSearch() {
    sList.innerHTML = '<div class="pt-empty"><div><div class="spin" style="width:18px;height:18px;margin:0 auto 8px;border:2px solid var(--dk-line);border-top-color:var(--primary);border-radius:99px;animation:spin .8s linear infinite"></div>Loading coins…</div></div>';
    let list, tk = {};
    try { list = await symList(sEx); } catch (e) { sList.innerHTML = `<div class="pt-empty">Could not load the coin list from ${EX[sEx].name}: ${esc(e.message)}</div>`; return; }
    try { tk = await tickers24(sEx); } catch (e) { /* prices optional */ }
    const q = sIn.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    let rows = list.map(s => ({ s, t: tk[s.s] || {} }));
    if (q) {
      rows = rows.filter(r => r.s.s.includes(q));
      const rank = r => (r.s.b === q || r.s.b === '1000' + q ? 0 : r.s.b.startsWith(q) ? 1 : 2);
      rows.sort((a, b) => rank(a) - rank(b) || (b.t.vol || 0) - (a.t.vol || 0));
    } else rows.sort((a, b) => (WL.includes(b.s.s) - WL.includes(a.s.s)) || (b.t.vol || 0) - (a.t.vol || 0));
    sRows = rows.slice(0, 80); sSel = 0;
    sList.innerHTML = sRows.map((r, i) => `<div class="s-row${i === 0 ? ' sel' : ''}" role="option" data-i="${i}"><button type="button" class="s-star${WL.includes(r.s.s) ? ' on' : ''}" data-star="${esc(r.s.s)}" aria-label="Watchlist">${ic('star')}</button>
      <b>${esc(r.s.b)}<span>/USDT</span></b><span class="mono">${r.t.px ? fp(r.t.px, Math.min(8, decs(r.s.k))) : ''}</span><span class="chg ${(r.t.chg || 0) < 0 ? 'down' : 'up'}">${r.t.chg != null ? pct(r.t.chg) : ''}</span></div>`).join('') ||
      `<div class="pt-empty">No USDT perpetual matches “${esc(sIn.value)}” on ${EX[sEx].name}.</div>`;
  }
  function searchMove(d) { const rs = $$('.s-row', sList); if (!rs.length) return; sSel = (sSel + d + rs.length) % rs.length; rs.forEach((r, i) => r.classList.toggle('sel', i === sSel)); rs[sSel].scrollIntoView({ block: 'nearest' }); }
  function chooseRow(i) { const r = sRows[i]; if (!r) return; closeModals(); setSymbol(r.s.s, sEx); }
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
    if (!isFinite(t) || t > Date.now() - 2 * TF[U.tf].ms) { setSymbol(sym, ex); return; }
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
  function rModalInit() { const inp = $('[data-rdate]'); if (!inp.value) inp.value = toLocalInput(Date.now() - 7 * DAY); inp.max = toLocalInput(Date.now() - DAY); }
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

  // ------------------------------------------------------------------ events
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'search') openSearch();
      else if (act === 'retry') { hideMsg(); if (S.retry) S.retry(); }
      else if (act === 'ind') { const p = $('[data-indpop]'); p.hidden = !p.hidden; a.setAttribute('aria-expanded', String(!p.hidden)); }
      else if (act === 'smc') { U.smc = !U.smc; saveUI(); headUI(); smcSchedule(); if (U.smc && !window.SMC) toast('The SMC overlay did not load. Reload the page.', 'down'); }
      else if (act === 'replay') openModal($('[data-rmodal]'));
      else if (act === 'rstart') openModal($('[data-rmodal]'));
      else if (act === 'rpick-chart') { closeModals(); if (!R.on) startPick('replay'); else startPick('replay'); }
      else if (act === 'rrandom') randomStart();
      else if (act === 'rgo') { const t = fromLocalInput($('[data-rdate]').value); if (isNaN(t)) toast('Choose a date and time first.'); else enterReplay(t); }
      else if (act === 'rexit') exitReplay();
      else if (act === 'play') { if (R.playing) pausePlay(); else play(); }
      else if (act === 'step') { pausePlay(); step(); }
      else if (act === 'close-modal') closeModals();
      else if (act === 'close-sheet') closeSheets();
      else if (act === 'collapse') { U.bmin = !U.bmin; saveUI(); root.classList.toggle('b-min', U.bmin); }
      else if (act === 'full') { root.classList.toggle('full'); try { if (root.classList.contains('full') && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen(); } catch (er) { /* not allowed */ } }
      else if (act === 'tools-m') root.classList.toggle('tools-open');
      else if (act === 'reset') {
        if (!A._armed) { A._armed = true; renderAcct(); setTimeout(() => { A._armed = false; renderAcct(); }, 3500); }
        else { A = freshAcct(); store.set('rd-acct-v1', A); toast('Paper account reset to $10,000.'); renderAll(); }
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
    const wl = e.target.closest('.wl-row'); if (wl) { setSymbol(wl.dataset.s); if (phone()) closeSheets(); return; }
    const rq = e.target.closest('[data-rq]'); if (rq) { $('[data-rdate]').value = toLocalInput(Date.now() - parseInt(rq.dataset.rq, 10) * DAY); return; }
    const sx = e.target.closest('[data-sex]'); if (sx) { sEx = sx.dataset.sex; $$('[data-sex]').forEach(b => b.classList.toggle('on', b === sx)); renderSearch(); return; }
    if (!e.target.closest('.dk-ind')) { const p = $('[data-indpop]'); if (!p.hidden) { p.hidden = true; $('[data-act="ind"]').setAttribute('aria-expanded', 'false'); } }
  });
  $('[data-tfsel]').addEventListener('change', e => setTF(e.target.value));
  $$('[data-ind]').forEach(i => i.addEventListener('change', () => {
    U[i.dataset.ind] = i.checked; saveUI(); headUI();
    if (i.dataset.ind === 'vol') { vs.setData(U.vol ? S.bars.map(toV) : []); cs.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: U.vol ? 0.18 : 0.06 } }); }
    else if (i.dataset.ind === 'smc') smcSchedule(); else if (i.dataset.ind === 'qt') qtUI(); else setEMAs();
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
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') { if (Q.on) qEnd(); menuClose(); if (DRAFT || TOOL !== 'cursor') setTool('cursor'); if (PICK) clearPick(); if (MEASURE) { MEASURE = null; prim.req(); } if (SEL) { SEL = null; selUI(); prim.req(); } closeSheets(); }
    else if (k === ' ' && R.on) { e.preventDefault(); if (R.playing) pausePlay(); else play(); }
    else if (k === 'ArrowRight' && R.on) { e.preventDefault(); pausePlay(); step(); }
    else if ((k === 'Delete' || k === 'Backspace') && SEL) { e.preventDefault(); removeSel(); }
    else { const map = { t: 'trend', h: 'hline', r: 'ray', b: 'rect', f: 'fib', m: 'measure' }; if (map[k.toLowerCase()]) setTool(map[k.toLowerCase()]); }
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
  window.addEventListener('pagehide', () => { if (R.on) saveR(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && R.on) saveR(); if (!document.hidden) pollLive(); });   // the live feed checks itself on return

  // ------------------------------------------------------------------ start
  window.__rd = { S, R, U, get A() { return A; }, P, chart, cs, step, enterReplay, exitReplay, setSymbol, setTF, place,   // for tests and the curious
    // the admin layer's handles (deskadmin.js loads after this file)
    ext: X, on: (n, f) => { (X.ev[n] = X.ev[n] || []).push(f); }, openAt, syncLines, setMarkers, openSheet, closeSheets, sideTab, openModal, closeModals,
    startPick, clearPick, hint, toast, COL, LS: LC.LineStyle, get PREC() { return PREC; }, get BTAB() { return BTAB; },
    setBTab: t => { BTAB = t; if (U.bmin) { U.bmin = false; saveUI(); root.classList.remove('b-min'); } renderBottom(false); }, renderBottom: () => renderBottom(false),
    menuOpen: (x, y, p) => menuOpen(x, y, p != null ? { p: rt(p), what: 'chart price', t: null } : snapAt(x, y)), menuClose, qStart, qPlan, qEnd, Q, paperSubmit, readT, store, chartEl, box,
    t2x, p2y, label, req: () => prim.req(), refreshMarkers: () => setMarkers(), get PICK() { return PICK; }, FEE_T,
    pause: () => { if (R.playing) pausePlay(); },
    get lastPx() { return S.lastPx; },
    util: { fp, money, pct, fq, fr, fv, esc, rt, coin, tshort, tnice, dur, num, ic, phone, hexA, nowT, fetchRange, fetchSpan, api, TF, RES, bucket, MIN, HOUR, DAY, WEEK_OFF, liqOf } };
  root.classList.toggle('b-min', !!U.bmin);
  playUI(); toolUI(); headUI(); renderWatch(); renderAll(); stepLabel();
  symList(U.ex).then(() => { if (S.bars.length) applyMeta(); }).catch(() => { /* precision guessed from prices */ });
  const rs = store.get('rd-replay-v1', null);
  if (rs && rs.sym && rs.clock && rs.clock < Date.now()) {
    U.sym = rs.sym; if (rs.ex) U.ex = rs.ex; R.on = true; R.clock = rs.clock; R.step = rs.step === 'small' ? 'small' : 'bar'; R.speed = +rs.speed || 800;
    modeUI(); rebuildReplay();
  } else { modeUI(); loadLive(); }
  pollLive(); setInterval(pollLive, 4000);
  setInterval(() => pollWatch(false), 12000);
})();
