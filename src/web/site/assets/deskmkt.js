/* ReplayDesk · Market panel (side tab "Market", every user). Collapsible sections, each with a one-line summary in its
   header so they read at a glance while closed:
     Overview   24h change, where price sits in the 24h range, volume vs its 7-day average, mark / index
     Funding    rate now, who pays, countdown, yearly rate, the last 12 rates, what it costs your size
     Open int.  value and 1h / 4h / 24h change, the last 24 hours
     Long/short whales vs retail as the classic's 🐋 line: Binance top traders by position and by accounts, every account on
                Binance and on Bybit (now, 1 h and 4 h before), takers' buy / sell in the last hour, funding, OI and price over the
                last hour, and the plain readings ("No strong split between whales and retail", squeeze-up / flush-down risk, crowded)
     News       this week's economic calendar (a warning 15 min before red news) and the newest crypto headlines
     Alerts     price alerts: a line on the chart, a toast + sound + browser notification when price gets there
     Trend      4H / 1H / 15m structure (SMC on closed candles)
     Hours      the coin's average 1-hour range by UTC hour over 30 days, the hour now highlighted
     Price act. the last 24h / 48h on closed 15m candles: range, structure, sweeps, nearest zones — read for a long and a short
     Zones      how this coin's SMC demand / supply zones did on their first touch (held vs went through), next to the same
                trade at random times (zonestats.js), recent touches, where price is now; touches can be marked on the chart
   Market data comes straight from Binance / Bybit in this browser (never through our server); news from /api/site/news.
   Alerts and which sections are open are kept in this browser only. In a replay the panel still shows the market now. */
(function () {
  'use strict';
  const RD = window.__rd;
  const pane = document.querySelector('[data-mkt]');
  if (!RD || !pane) return;
  const { U, R, S } = RD, u = RD.util, X = RD.ext, store = RD.store;
  const { fp, esc, pct, MIN, HOUR, DAY } = u;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // ---------------------------------------------------------------- helpers
  async function getJSON(url, ms = 12000) {
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { signal: ac.signal, cache: 'no-store', credentials: url.startsWith('/') ? 'same-origin' : 'omit' });
      if (!r.ok) { const e = new Error(r.status === 400 ? 'not available for this coin' : 'HTTP ' + r.status); e.status = r.status; throw e; }
      return await r.json();
    } catch (e) { if (e.name === 'AbortError') throw new Error('no answer in time'); throw e; } finally { clearTimeout(to); }
  }
  const BN = 'https://fapi.binance.com', BY = 'https://api.bybit.com/v5/market';
  const by = async (path) => { const d = await getJSON(BY + path); if (d.retCode !== 0) throw new Error(d.retMsg || 'Bybit error'); return d.result; };
  const big = v => v == null || !isFinite(v) ? '—' : '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0));
  const fr4 = r => r == null || !isFinite(r) ? '—' : (r < 0 ? '−' : r > 0 ? '+' : '') + Math.abs(r * 100).toFixed(4) + '%';
  const pc1 = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : v > 0 ? '+' : '') + Math.abs(v).toFixed(1) + '%';
  const tone = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const ago = t => { const s = Math.round((Date.now() - t) / 1000); if (s < 0) return inT(t); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
  const inT = t => { let s = Math.max(0, Math.round((t - Date.now()) / 1000)); const d = Math.floor(s / 86400); s -= d * 86400; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(x).padStart(2, '0')}s` : `${x}s`; };
  const hhmm = t => new Date(t).toISOString().slice(11, 16);
  const day = t => new Date(t).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const coin = () => u.coin(U.sym);
  const live = () => !R.on;
  // the same plain readings as the bot's /flow and the classic's 🐋 line (src/collectors/coinFlow.js), not a signal.
  // w = whales' long / short ratio (Binance top traders by position), r = retail's (Binance accounts, else Bybit)
  function flowReading(w, r) {
    if (w == null || r == null) return null;
    if (w >= 1.2 && r <= 0.9) return { text: '🐋 long vs 👥 short — squeeze-up risk for shorts', warn: true };
    if (w <= 0.83 && r >= 1.1) return { text: '🐋 short vs 👥 long — flush-down risk for longs', warn: true };
    if (w >= 1.4 && r >= 1.4) return { text: 'Everyone long — crowded long ⚠️ (October: shorts here lost)', warn: true };
    if (w >= 1.2 && r >= 1.2) return { text: 'Everyone long — crowded long', warn: true };
    if (w <= 0.83 && r <= 0.83) return { text: 'Everyone short — crowded short', warn: true };
    return { text: 'No strong split between whales and retail', warn: false };
  }
  function flowOiReading(oiCh, priceCh) {   // last hour, in %
    if (oiCh == null || priceCh == null) return null;
    const up = priceCh > 0.5, down = priceCh < -0.5, oiUp = oiCh > 2, oiDown = oiCh < -2;
    if (up && oiUp) return 'price up + OI up → new positions piling in on the move';
    if (up && oiDown) return 'price up + OI down → shorts closing (short squeeze / covering)';
    if (down && oiUp) return 'price down + OI up → new shorts opening';
    if (down && oiDown) return 'price down + OI down → longs closing / liquidations';
    return 'OI and price flat-ish';
  }

  // ---------------------------------------------------------------- state
  const OPEN0 = { ov: true, fu: true, oi: false, ls: false, nw: true, al: true, tr: false, hr: false, pa: false, zr: false, eq: false };
  const M = { open: Object.assign({}, OPEN0, store.get('rd-mk-v1', null) || {}), d: {}, err: {}, at: {}, busy: {}, key: '', nwTab: store.get('rd-mk-nwtab', 'cal'),
    imp: store.get('rd-mk-imp', 'hm'), zrTf: store.get('rd-mk-zrtf', '15m'), zrDays: [1, 2, 7, 30, 90].includes(+store.get('rd-mk-zrdays', 30)) ? +store.get('rd-mk-zrdays', 30) : 30, zrMarks: !!store.get('rd-mk-zrmk', false), again: {}, hlCoin: !!store.get('rd-mk-hlcoin', false), warn: !!store.get('rd-mk-warn', false), warned: new Set(), news: null, newsAt: 0, newsErr: '' };
  const saveOpen = () => store.set('rd-mk-v1', M.open);
  M.calCur = Array.isArray(store.get('rd-mk-calcur', [])) ? store.get('rd-mk-calcur', []) : [];   // [] = every currency
  M.calTz = store.get('rd-mk-caltz', 'utc') === 'local' ? 'local' : 'utc';
  const zrDays = () => (M.zrTf === '5m' ? Math.min(M.zrDays, 30) : M.zrDays);   // 5m: 30 days at most (8,640 candles)
  // Equal lows / highs section: its own timeframe and period (1m: 7 days at most, 5m: 30)
  M.eqTf = ['1m', '5m', '15m', '1H'].includes(store.get('rd-mk-eqtf', '5m')) ? store.get('rd-mk-eqtf', '5m') : '5m';
  M.eqDays = [1, 2, 7, 30, 90].includes(+store.get('rd-mk-eqdays', 7)) ? +store.get('rd-mk-eqdays', 7) : 7;
  M.eqMarks = !!store.get('rd-mk-eqmk', false);
  const eqCap = tf => (tf === '1m' ? 7 : tf === '5m' ? 30 : 90);
  const eqDays = () => Math.min(M.eqDays, eqCap(M.eqTf));
  // closed candles for the zone and equal-level sections: one download when both ask for the same timeframe and period
  const KC = new Map();
  function candles(tf, from, to) {
    const k = [keyNow(), tf, from, to].join('|');
    if (!KC.has(k)) {
      const p = u.fetchRange(U.sym, tf, from, to, U.ex);
      KC.set(k, p); p.catch(() => KC.delete(k));
      while (KC.size > 4) KC.delete(KC.keys().next().value);
    }
    return KC.get(k);
  }
  const nearZones = (zs, px) => { let dem = null, sup = null;
    for (const z of zs) { if (z.type === 'demand' && z.bot <= px && (!dem || z.top > dem.top)) dem = z; if (z.type === 'supply' && z.top >= px && (!sup || z.bot < sup.bot)) sup = z; }
    return { dem, sup }; };
  const visible = () => !pane.closest('[data-pane]').hidden && (!u.phone() || document.querySelector('.dk-side').classList.contains('open')) && !document.hidden;
  const keyNow = () => U.ex + '|' + U.sym;

  // ---------------------------------------------------------------- loaders (each one exchange-aware, each fails on its own)
  const L = {
    async ov() {
      if (U.ex === 'fx') throw new Error("Interbank FX has no funding, open interest or long / short data. Search the pair and pick its Bybit row (a USDT perpetual) to see those.");
      if (U.ex === 'bybit') {
        const [t, k] = await Promise.all([by(`/tickers?category=linear&symbol=${U.sym}`), by(`/kline?category=linear&symbol=${U.sym}&interval=D&limit=8`)]);
        const x = t.list[0]; if (!x) throw new Error('not listed on Bybit');
        const days = k.list.map(r => +r[6]).reverse();
        return { px: +x.lastPrice, chg: +x.price24hPcnt * 100, hi: +x.highPrice24h, lo: +x.lowPrice24h, qv: +x.turnover24h, mark: +x.markPrice, index: +x.indexPrice, days,
          fund: { rate: +x.fundingRate, next: +x.nextFundingTime }, oi: { coins: +x.openInterest, val: +x.openInterestValue } };
      }
      const [t, p, k] = await Promise.all([getJSON(`${BN}/fapi/v1/ticker/24hr?symbol=${U.sym}`), getJSON(`${BN}/fapi/v1/premiumIndex?symbol=${U.sym}`), getJSON(`${BN}/fapi/v1/klines?symbol=${U.sym}&interval=1d&limit=8`)]);
      return { px: +t.lastPrice, chg: +t.priceChangePercent, hi: +t.highPrice, lo: +t.lowPrice, qv: +t.quoteVolume, mark: +p.markPrice, index: +p.indexPrice, days: k.map(r => +r[7]),
        fund: { rate: +p.lastFundingRate, next: +p.nextFundingTime } };
    },
    async fu() {
      if (U.ex === 'fx') throw new Error("Interbank FX has no funding, open interest or long / short data. Search the pair and pick its Bybit row (a USDT perpetual) to see those.");
      let hist;
      if (U.ex === 'bybit') hist = (await by(`/funding/history?category=linear&symbol=${U.sym}&limit=12`)).list.map(r => ({ t: +r.fundingRateTimestamp, r: +r.fundingRate })).reverse();
      else hist = (await getJSON(`${BN}/fapi/v1/fundingRate?symbol=${U.sym}&limit=12`)).map(r => ({ t: +r.fundingTime, r: +r.fundingRate }));
      const ov = await ovNow();
      const gaps = hist.slice(1).map((h, i) => h.t - hist[i].t).filter(g => g > 0).sort((a, b) => a - b);
      const iv = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] / HOUR) * HOUR || 8 * HOUR : 8 * HOUR;
      return { rate: ov.fund.rate, next: ov.fund.next, iv, hist };
    },
    async oi() {
      if (U.ex === 'fx') throw new Error("Interbank FX has no funding, open interest or long / short data. Search the pair and pick its Bybit row (a USDT perpetual) to see those.");
      if (U.ex === 'bybit') {
        const h = (await by(`/open-interest?category=linear&symbol=${U.sym}&intervalTime=1h&limit=25`)).list.map(r => ({ t: +r.timestamp, v: +r.openInterest })).reverse();
        const ov = await ovNow();
        return { coins: ov.oi.coins, val: ov.oi.val, hist: h };
      }
      const [h, c] = await Promise.all([getJSON(`${BN}/futures/data/openInterestHist?symbol=${U.sym}&period=1h&limit=25`), getJSON(`${BN}/fapi/v1/openInterest?symbol=${U.sym}`)]);
      const px = (M.d.ov && M.d.ov.key === keyNow() && M.d.ov.mark) || S.lastPx || 0;
      return { coins: +c.openInterest, val: +c.openInterest * px, hist: h.map(r => ({ t: +r.timestamp, v: +r.sumOpenInterest })) };
    },
    // whales vs retail, as the classic's 🐋 line: Binance top traders by position and by accounts, every account on Binance
    // and on Bybit (whichever exchange the chart is on), each now / 1 h / 4 h before (5-minute points), takers' buy / sell
    // over the last hour (Binance), open interest 1h / 4h and the price over the last hour (the chart's exchange)
    async ls() {
      if (U.ex === 'fx') throw new Error("Interbank FX has no funding, open interest or long / short data. Search the pair and pick its Bybit row (a USDT perpetual) to see those.");
      const sym = U.sym, ex = U.ex, now = Date.now();
      const bn = p => getJSON(`${BN}/futures/data/${p}?symbol=${sym}&period=5m&limit=60`);
      const [tp, ta, gl, byr, tk, oi, kl, ov] = await Promise.allSettled([
        bn('topLongShortPositionRatio'), bn('topLongShortAccountRatio'), bn('globalLongShortAccountRatio'),
        by(`/account-ratio?category=linear&symbol=${sym}&period=5min&limit=60`),
        getJSON(`${BN}/futures/data/takerlongshortRatio?symbol=${sym}&period=5m&limit=12`),
        ex === 'bybit' ? by(`/open-interest?category=linear&symbol=${sym}&intervalTime=5min&limit=60`) : bn('openInterestHist'),
        u.api(ex).klines(sym, '5m', { limit: 13 }), ovNow()]);
      const got = s => s.status === 'fulfilled' ? s.value : null;
      // a series of { t, l: long share, r: long / short } oldest first → now, 1 h and 4 h before (nothing in the last 30 min = no data)
      const side = a => {
        if (!a || !a.length) return null;
        const p = a[a.length - 1]; if (now - p.t > 30 * MIN) return null;
        const back = ms => { let j = a.length - 1; while (j > 0 && a[j].t > p.t - ms) j--; return Math.abs(a[j].t - (p.t - ms)) <= 3 * MIN ? a[j].l : null; };
        return { now: p.l, ratio: p.r != null ? p.r : p.l < 1 ? p.l / (1 - p.l) : null, h1: back(HOUR), h4: back(4 * HOUR), at: p.t };
      };
      const bnSer = s => { const v = got(s); return Array.isArray(v) ? v.map(x => ({ t: +x.timestamp, l: +x.longAccount, r: +x.longShortRatio })).sort((a, b) => a.t - b.t) : null; };
      const byv = got(byr), bySer = byv && byv.list ? byv.list.map(x => ({ t: +x.timestamp, l: +x.buyRatio, r: +x.sellRatio > 0 ? +x.buyRatio / +x.sellRatio : null })).sort((a, b) => a.t - b.t) : null;
      const whales = side(bnSer(tp)), whalesAcc = side(bnSer(ta)), retail = side(bnSer(gl)), retailBybit = side(bySer);
      let taker = null; const tkv = got(tk);
      if (Array.isArray(tkv) && tkv.length && now - +tkv[tkv.length - 1].timestamp <= 30 * MIN) {
        const b = tkv.reduce((a, r) => a + +r.buyVol, 0), s = tkv.reduce((a, r) => a + +r.sellVol, 0); if (s > 0) taker = { buy: b, sell: s, ratio: b / s };
      }
      const oiv = got(oi), ois = !oiv ? [] : ex === 'bybit' ? (oiv.list || []).map(x => ({ t: +x.timestamp, v: +x.openInterest })).sort((a, b) => a.t - b.t)
        : oiv.map(x => ({ t: +x.timestamp, v: +x.sumOpenInterest, usd: +x.sumOpenInterestValue }));
      const oiAt = ms => { if (!ois.length) return null; const last = ois[ois.length - 1]; let j = ois.length - 1; while (j > 0 && ois[j].t > last.t - ms) j--; return Math.abs(ois[j].t - (last.t - ms)) <= 3 * MIN ? ois[j] : null; };
      const oiNow = ois.length && now - ois[ois.length - 1].t <= 30 * MIN ? ois[ois.length - 1] : null, o1 = oiNow && oiAt(HOUR), o4 = oiNow && oiAt(4 * HOUR);
      const pc = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null);
      const ks = got(kl), ch1h = ks && ks.length >= 13 ? pc(ks[ks.length - 1][4], ks[ks.length - 13][4]) : null;
      const ovd = got(ov);
      if (!whales && !whalesAcc && !retail && !retailBybit && !taker) throw (tp.reason || byr.reason || new Error('no long / short data for this coin'));
      return {
        whales, whalesAcc, retail, retailBybit, taker, ch1h,
        oi1: oiNow && o1 ? pc(oiNow.v, o1.v) : null, oi4: oiNow && o4 ? pc(oiNow.v, o4.v) : null,
        oiUsd: oiNow ? oiNow.usd || (ovd && ovd.oi && ovd.oi.val) || (ks && ks.length ? oiNow.v * ks[ks.length - 1][4] : null) : null,
        funding: ovd && ovd.fund && isFinite(ovd.fund.rate) ? ovd.fund.rate * 100 : null,
        at: Math.max(0, ...[whales, retail, retailBybit].filter(Boolean).map(s => s.at), oiNow ? oiNow.t : 0),
        bnMissing: !got(tp) && !got(gl), byMissing: !byv,
      };
    },
    async tr() {
      if (!window.SMC) throw new Error('the SMC engine did not load');
      const out = {};
      await Promise.all([['4H', 300], ['1H', 300], ['15m', 300]].map(async ([tf, n]) => {
        const ms = u.TF[tf].ms, now = Date.now();
        const ks = (await u.api(U.ex).klines(U.sym, tf, { limit: n })).filter(k => k[0] + ms <= now);   // closed candles only
        if (ks.length < 12) { out[tf] = null; return; }
        const l = ks[ks.length - 1], base = ks.concat([[l[0] + ms, l[4], l[4], l[4], l[4], 0]]);
        const A = window.SMC.analyze(base, base.length - 1, { tf: ms });
        let H = null, Lo = null;
        for (let q = A.swings.length - 1; q >= 0 && (H == null || Lo == null); q--) { const w = A.swings[q]; if (w.side === 'H' && H == null) H = w.p; if (w.side === 'L' && Lo == null) Lo = w.p; }
        const px = l[4];
        out[tf] = { trend: A.trend, brk: A.breaks[A.breaks.length - 1] || null, pos: H != null && Lo != null && H > Lo ? (px - Lo) / (H - Lo) : null, H, L: Lo };
      }));
      return out;
    },
    async pa() {
      if (!window.SMC) throw new Error('the SMC engine did not load');
      const ms = 15 * MIN, now = Date.now();
      const ks = (await u.api(U.ex).klines(U.sym, '15m', { limit: 400 })).filter(k => k[0] + ms <= now);   // closed candles only
      if (ks.length < 200) throw new Error('not enough candles yet (a new listing?)');
      const l = ks[ks.length - 1], px = l[4], end = l[0] + ms, since = end - 48 * HOUR;
      const A = window.SMC.analyze(ks.concat([[end, px, px, px, px, 0]]), ks.length, { tf: ms });
      const win = h => { const k = ks.filter(x => x[0] >= end - h * HOUR); let hi = -Infinity, lo = Infinity, hiT = 0, loT = 0;
        for (const x of k) { if (x[2] > hi) { hi = x[2]; hiT = x[0]; } if (x[3] < lo) { lo = x[3]; loT = x[0]; } }
        return { hi, lo, hiT, loT, chg: (px / k[0][1] - 1) * 100, pos: hi > lo ? (px - lo) / (hi - lo) : 0.5 }; };
      const lastLab = side => { for (let q = A.swings.length - 1; q >= 0; q--) { const w = A.swings[q]; if (w.side === side && w.label.length === 2) return w; } return null; };
      // equal highs / lows nothing has traded through since they formed (checked on the candles, not only the engine's list)
      const clean = e => !ks.some(x => x[0] >= e.conf && (e.side === 'H' ? x[2] > e.p : x[3] < e.p));
      let eqh = null, eql = null;
      for (const e of A.eqs) { if (e.side === 'H' && e.p > px && (!eqh || e.p < eqh.p) && clean(e)) eqh = e; if (e.side === 'L' && e.p < px && (!eql || e.p > eql.p) && clean(e)) eql = e; }
      return { px, end, d24: win(24), d48: win(48), trend: A.trend, brk: A.breaks[A.breaks.length - 1] || null,
        brks: A.breaks.filter(b => b.conf >= since), sweeps: A.sweeps.filter(w => w.conf >= since).slice(-3).reverse(),
        hiLab: lastLab('H'), loLab: lastLab('L'), zones: A.zones.filter(z => !z.broken), eqh, eql };
    },
    async zr() {
      if (!window.SMC || !window.ZoneStats) throw new Error('the SMC engine did not load');
      const tf = M.zrTf, days = zrDays(), ms = u.TF[tf].ms, to = Math.floor(Date.now() / ms) * ms;
      // 300 candles before the period as warm-up: the engine knows the zones when the period starts; only touches inside it count
      const from = to - days * DAY, K = await candles(tf, from - 300 * ms, to);   // closed candles only
      if (K.length < 60 || !K.some(k => k[0] >= from)) throw new Error('not enough candles yet (a new listing?)');
      const z = window.ZoneStats.zoneStats(window.SMC, K, ms, { seed: U.ex + U.sym + tf + days, from });
      z.tf = tf; z.days = days;
      return z;
    },
    async eq() {
      if (!window.SMC || !window.ZoneStats || !window.ZoneStats.eqStats) throw new Error('the SMC engine did not load');
      const tf = M.eqTf, days = eqDays(), ms = u.TF[tf].ms, to = Math.floor(Date.now() / ms) * ms;
      const from = to - days * DAY, K = await candles(tf, from - 300 * ms, to);   // the same warm-up as the zones
      if (K.length < 60 || !K.some(k => k[0] >= from)) throw new Error('not enough candles yet (a new listing?)');
      const z = window.ZoneStats.eqStats(window.SMC, K, ms, { seed: U.ex + U.sym + tf + days, from });
      z.tf = tf; z.days = days;
      return z;
    },
    async hr() {
      const ks = await u.api(U.ex).klines(U.sym, '1H', { limit: 720 });
      const sum = new Array(24).fill(0), n = new Array(24).fill(0);
      for (const k of ks) { if (!(k[1] > 0)) continue; const h = new Date(k[0]).getUTCHours(); sum[h] += (k[2] - k[3]) / k[1] * 100; n[h]++; }
      const avg = sum.map((s, i) => (n[i] ? s / n[i] : 0));
      return { avg, days: Math.round(ks.length / 24) };
    },
  };
  // the overview for the coin on screen now: an answer that lands after a coin / exchange switch is never stored
  async function ovNow() {
    const k = keyNow();
    if (M.d.ov && M.d.ov.key === k) return M.d.ov;
    const d = await L.ov(); d.key = k;
    if (k === keyNow()) M.d.ov = d;
    return d;
  }
  // how often each section refreshes while the panel is open (ms)
  const EVERY = { ov: 15e3, fu: 15e3, oi: 60e3, ls: 60e3, tr: 120e3, hr: 30 * 60e3, pa: 60e3, zr: 5 * 60e3,
    get eq() { return M.eqTf === '1m' ? 60e3 : M.eqTf === '5m' ? 2 * 60e3 : 5 * 60e3; } };

  async function loadSec(k, force) {
    if (M.busy[k]) { if (force) M.again[k] = true; return; }
    if (!force && M.at[k] && Date.now() - M.at[k] < EVERY[k]) return;
    const key = keyNow(); M.busy[k] = true;
    try { const d = await L[k](); if (key !== keyNow()) return; d.key = key; M.d[k] = d; M.err[k] = ''; M.at[k] = Date.now(); }
    catch (e) { if (key !== keyNow()) return; M.err[k] = e.message || String(e); M.at[k] = Date.now(); }
    finally { M.busy[k] = false; if (M.again[k]) { M.again[k] = false; setTimeout(() => loadSec(k, true), 0); } }
    if (key === keyNow()) { paintSec(k); if (k === 'ov') { paintSec('fu'); legendSoon(); } if (((k === 'zr' && M.zrMarks) || (k === 'eq' && M.eqMarks)) && RD.setMarkers) RD.setMarkers(); }
  }
  async function loadNews(force) {
    if (M.newsBusy || (!force && Date.now() - M.newsAt < 5 * 60e3)) return;
    M.newsBusy = true;
    try { M.news = await getJSON('/api/site/news', 20000); M.newsErr = ''; }
    catch (e) { M.newsErr = e.status === 401 ? 'Sign in to see the news.' : e.status === 429 ? 'Too many requests — try again in a few minutes.' : 'News did not load: ' + e.message; }
    finally { M.newsBusy = false; M.newsAt = Date.now(); }
    paintSec('nw'); legendSoon(); if (calM && !calM.hidden) calPaint();
  }
  // ---------------------------------------------------------------- the full-week economic calendar (a window over the desk)
  let calM = null, calSel = '';
  function calOpen() {
    if (!calM) {
      calM = document.createElement('div'); calM.className = 'dk-modal cal-modal'; calM.hidden = true; calM.dataset.calm = '';
      calM.setAttribute('role', 'dialog'); calM.setAttribute('aria-modal', 'true'); calM.setAttribute('aria-label', 'Economic calendar');
      calM.innerHTML = '<div class="dk-mbox cal-box" data-calbox></div>';
      const host = document.querySelector('.dk-modal'); (host ? host.parentNode : document.body).appendChild(calM);
      calM.addEventListener('click', calClick);
      calM.addEventListener('change', e => { if (e.target.matches('[data-mk-warn]')) setWarn(e.target.checked); });
    }
    calSel = ''; RD.openModal(calM); calPaint(true);
    loadNews(false);
  }
  function calPaint(scroll) {
    const box = calM.querySelector('[data-calbox]'), n = M.news, now = Date.now();
    const head = `<div class="cal-hdr"><div><h2>Economic calendar</h2><p>This week · times in ${tzLabel()}</p></div><button type="button" class="cal-x" data-cal-x aria-label="Close" title="Close (Esc)">×</button></div>`;
    if (!n) { box.innerHTML = head + (M.newsErr ? errBox('nw', M.newsErr) : spin); return; }
    const all = n.events.slice().sort((a, b) => a.t - b.t);
    const curs = [...new Set(all.map(e => e.cur))].sort((a, b) => ((CUR_ORDER.indexOf(a) + 1) || 99) - ((CUR_ORDER.indexOf(b) + 1) || 99) || (a < b ? -1 : 1));
    // the week strip: every day from the feed's first to its last event (later FOMC dates are listed in the table only)
    const w0 = n.week && n.week[0] ? n.week[0] : all.length ? all[0].t : now, w1 = n.week && n.week[1] ? n.week[1] : all.length ? all[all.length - 1].t : now;
    const days = []; for (let k = cKey(w0), i = 0; k <= cKey(w1) && i < 10; i++, k = new Date(keyNoon(k) + DAY).toISOString().slice(0, 10)) days.push(k);
    const today = cKey(now), byCur = all.filter(e => !M.calCur.length || M.calCur.includes(e.cur));
    const cards = days.map(k => { const d = byCur.filter(e => cKey(e.t) === k), c = x => d.filter(e => e.impact === x).length;
      return `<button type="button" class="cal-card${k === today ? ' today' : ''}${k === calSel ? ' on' : ''}" data-cal-go="${k}" title="Go to ${cLong(k)}"><b>${cShort(k).replace(/ \w+$/, '')}</b>
        <span class="cnt"><span title="High impact"><i class="h"></i>${c('High')}</span><span title="Medium impact"><i class="m"></i>${c('Medium')}</span><span title="Low impact"><i class="l"></i>${c('Low')}</span></span></button>`; }).join('');
    const tools = `<div class="cal-tools">
        <div class="mk-seg sm" role="group" aria-label="Impact">${[['h', 'Red'], ['hm', 'Red + orange'], ['all', 'All']].map(([k, t]) => `<button type="button" data-cal-imp="${k}" class="${M.imp === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="cal-chips" role="group" aria-label="Currencies"><button type="button" data-cal-cur="" class="${M.calCur.length ? '' : 'on'}">All</button>${curs.map(c => `<button type="button" data-cal-cur="${esc(c)}" class="${M.calCur.includes(c) ? 'on' : ''}">${flag(c)}${esc(c)}</button>`).join('')}</div>
        <div class="mk-seg sm" role="group" aria-label="Time zone"><button type="button" data-cal-tz="utc" class="${M.calTz === 'utc' ? 'on' : ''}">UTC</button><button type="button" data-cal-tz="local" class="${M.calTz === 'local' ? 'on' : ''}" title="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}">My time</button></div>
        <label class="mk-sw" title="A toast, a sound and a browser notification 15 minutes before each red (high impact) event"><input type="checkbox" data-mk-warn${M.warn ? ' checked' : ''}><span></span>Warn me 15 min before</label>
      </div>`;
    const shown = all.filter(calPass);
    let rows = '', lastK = '', nowDone = false;
    for (const e of shown) {
      const k = cKey(e.t);
      if (k !== lastK) { rows += (lastK ? '</section>' : '') + `<section class="cal-grp"><div class="cal-day" data-cal-day="${k}">${cLong(k)}${k === today ? '<em>today</em>' : ''}</div>`; lastK = k; }   // a group per day: its header sticks only while its rows show
      if (!nowDone && e.t > now && k === today) { rows += `<div class="cal-now" data-cal-now><span>now · ${cT(now)}</span></div>`; nowDone = true; }
      if (!nowDone && e.t > now) nowDone = true;   // the next event is on a later day: no line inside today
      const past = e.t <= now, soon = !past && e.t - now < DAY, fp3 = afpLine(e);
      rows += `<div class="cal-row${past ? ' past' : ''}${e.impact === 'High' ? ' hi' : ''}"${e.note ? ` title="${esc(e.note)}"` : ''}>
        <span class="cal-t">${cT(e.t)}${soon ? `<em>in <span data-cd="${e.t}"></span></em>` : ''}</span><span class="cal-cur">${flag(e.cur)}${esc(e.cur)}</span>${impBars(e.impact)}
        <span class="cal-ev">${esc(e.title)}${fp3 ? `<em class="cal-afp">${fp3}</em>` : ''}</span>
        <span class="n a">${e.actual ? esc(e.actual) + calArrow(e) : past && (e.forecast || e.previous) ? '<span class="cal-wait" title="Not matched yet: actual figures come from a second calendar a few minutes after the release, when the event can be matched">…</span>' : ''}</span><span class="n">${esc(e.forecast || '')}</span><span class="n">${esc(e.previous || '')}</span></div>`;
    }
    if (lastK) rows += '</section>';
    if (!shown.length) rows = `<p class="cal-empty">Nothing at this impact level${M.calCur.length ? ' for ' + esc(M.calCur.join(', ')) : ''} this week.</p>`;
    const src = n.sources || {};
    box.innerHTML = head + `<div class="cal-week" role="group" aria-label="Days">${cards}</div>` + tools +
      `<div class="cal-scroll" data-cal-scroll><div class="cal-th"><span>Time</span><span>Cur.</span><span title="Impact: 3 bars high, 2 medium, 1 low"></span><span>Event</span><span>Actual</span><span>Forecast</span><span>Prior</span></div>${rows}</div>` +
      `<p class="cal-foot">Events, impact, forecast and prior: ${esc(src.calendar || 'economic calendar')}. Actual: ${esc(src.actual || '—')}, filled in after the release when the event can be matched (… = not yet)${n.actualErr ? ' · ' + esc(n.actualErr) : ''}. FOMC dates: ${esc(src.fomc || '—')}.${n.calErrors && n.calErrors.length ? ' ' + esc(n.calErrors[0]) + '.' : ''} ▲ / ▼ = actual above / below the forecast.</p>`;
    if (scroll) {   // open on today: its header at the top (or the next day with events)
      const sc = box.querySelector('[data-cal-scroll]'), hd = [...box.querySelectorAll('[data-cal-day]')].find(d => d.dataset.calDay >= today), th = box.querySelector('.cal-th');
      if (sc && hd) sc.scrollTop = Math.max(0, hd.offsetTop - ((th && th.offsetHeight) || 0)); }
  }
  function calClick(e) {
    if (e.target === calM || e.target.closest('[data-cal-x]')) { RD.closeModals(); return; }
    const im = e.target.closest('[data-cal-imp]'); if (im) { M.imp = im.dataset.calImp; store.set('rd-mk-imp', M.imp); calPaint(); paintSec('nw'); return; }
    const cu = e.target.closest('[data-cal-cur]'); if (cu) { const c = cu.dataset.calCur; M.calCur = !c ? [] : M.calCur.includes(c) ? M.calCur.filter(x => x !== c) : M.calCur.concat(c); store.set('rd-mk-calcur', M.calCur); calPaint(); paintSec('nw'); return; }
    const tz = e.target.closest('[data-cal-tz]'); if (tz) { M.calTz = tz.dataset.calTz; store.set('rd-mk-caltz', M.calTz); calPaint(true); paintSec('nw'); return; }
    const go = e.target.closest('[data-cal-go]'); if (go) { calSel = go.dataset.calGo; calM.querySelectorAll('.cal-card').forEach(c => c.classList.toggle('on', c === go));
      const sc = calM.querySelector('[data-cal-scroll]'), d = calM.querySelector(`[data-cal-day="${calSel}"]`); if (sc && d) sc.scrollTop = d.offsetTop - ((calM.querySelector('.cal-th') || {}).offsetHeight || 0); else RD.toast('Nothing on that day at this impact level / currency.'); return; }
    const rt = e.target.closest('[data-mk-retry]'); if (rt) loadNews(true);
  }
  function refresh(force) {
    if (!visible()) return;
    for (const k of Object.keys(L)) if (M.open[k] || (k === 'ov' && (M.open.fu || M.open.oi))) loadSec(k, force);
    if (M.zrMarks && !M.open.zr) loadSec('zr', force);
    if (M.eqMarks && !M.open.eq) loadSec('eq', force);
    if (M.open.nw) loadNews(force);
  }

  // ---------------------------------------------------------------- sections
  const SECS = [
    ['ov', 'Overview', 'activity'], ['fu', 'Funding', 'percent'], ['oi', 'Open interest', 'layers'], ['ls', 'Long / short', 'users'],
    ['nw', 'News', 'newspaper'], ['al', 'Alerts', 'bell'], ['tr', 'Trend · 4H 1H 15m', 'trending-up'], ['hr', 'When the coin moves', 'clock'],
    ['pa', 'Price action · 24h / 48h', 'activity'], ['zr', 'SMC zones · how this coin reacts', 'target'],
    ['eq', 'EQL / EQH · how this coin reacts', 'minus'],
  ];
  pane.innerHTML = `<div class="mk-note" data-mk-rp hidden>${u.ic('info')}<span>Replay: this panel shows the market <b>now</b>, not at the replay time.</span></div>` +
    SECS.map(([k, t, i]) => `<section class="mk-sec" data-mk="${k}">
      <button type="button" class="mk-h" data-mk-h="${k}" aria-expanded="false" aria-controls="mk-b-${k}"><span class="mk-chev">${u.ic('chevron-right')}</span><span class="mk-ic">${u.ic(i)}</span><b>${t}</b><span class="mk-sum" data-mk-sum="${k}"></span></button>
      <div class="mk-b" id="mk-b-${k}" data-mk-b="${k}" hidden></div></section>`).join('');
  const body = k => $(`[data-mk-b="${k}"]`, pane), sumEl = k => $(`[data-mk-sum="${k}"]`, pane);
  function openUI() {
    for (const [k] of SECS) {
      const on = !!M.open[k], h = $(`[data-mk-h="${k}"]`, pane);
      h.setAttribute('aria-expanded', String(on)); h.parentElement.classList.toggle('on', on); body(k).hidden = !on;
    }
    $('[data-mk-rp]', pane).hidden = !R.on;
  }
  const spin = '<div class="mk-load"><span class="mk-spin"></span>Loading…</div>';
  // ---------------------------------------------------------------- economic calendar helpers (panel + full week)
  const LVL = { High: 3, Medium: 2, Low: 1 }, CUR_ORDER = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'AUD', 'NZD', 'CHF'];
  const FLAG = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CNY: '🇨🇳', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭' };
  const noFlags = /Windows/.test(navigator.userAgent);   // Windows shows flag emoji as two letters
  const flag = c => (noFlags ? '' : (FLAG[c] || '🌐') + ' ');
  const impBars = imp => `<span class="mk-imp cal-imp ${imp === 'High' ? 'h' : imp === 'Medium' ? 'm' : 'l'}" title="${esc(imp || 'Low')} impact" role="img" aria-label="${esc(imp || 'Low')} impact"><i></i><i></i><i></i></span>`;
  const tzName = () => (M.calTz === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
  const tzLabel = () => { if (M.calTz !== 'local') return 'UTC'; const o = -new Date().getTimezoneOffset(), h = Math.floor(Math.abs(o) / 60), m = Math.abs(o) % 60; return 'your time (UTC' + (o < 0 ? '−' : '+') + h + (m ? ':' + String(m).padStart(2, '0') : '') + ')'; };
  const cT = t => new Date(t).toLocaleTimeString('en-GB', { timeZone: tzName(), hour: '2-digit', minute: '2-digit', hour12: false });
  const cKey = t => new Date(t).toLocaleDateString('en-CA', { timeZone: tzName() });   // YYYY-MM-DD in the chosen zone
  const keyNoon = k => Date.parse(k + 'T12:00:00Z');
  const cLong = k => new Date(keyNoon(k)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  const cShort = k => new Date(keyNoon(k)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  // "0.80%" "1,763K" "-30.9" → a number in one unit, for the above / below forecast arrow
  const calNum = s => { const m = /^([-+−]?)\s*([\d,]*\.?\d+)\s*([KMBT%]?)/i.exec(String(s || '').trim()); if (!m) return null;
    return parseFloat(m[2].replace(/,/g, '')) * (m[1] === '-' || m[1] === '−' ? -1 : 1) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[3].toUpperCase()] || 1); };
  const calArrow = e => { const a = calNum(e.actual), f = calNum(e.forecast); if (a == null || f == null || a === f) return '';
    return a > f ? '<i class="cal-ar" title="Above the forecast (not good or bad by itself: higher unemployment is worse, higher GDP better)">▲</i>' : '<i class="cal-ar" title="Below the forecast (not good or bad by itself)">▼</i>'; };
  const calPass = e => (LVL[e.impact] || 0) >= (M.imp === 'h' ? 3 : M.imp === 'hm' ? 2 : 0) && (!M.calCur.length || M.calCur.includes(e.cur));
  const afpLine = e => (e.actual || e.forecast || e.previous ? `${e.actual ? `<b>A ${esc(e.actual)}</b>${calArrow(e)}` : ''}${e.actual && (e.forecast || e.previous) ? ' · ' : ''}${e.forecast ? 'F ' + esc(e.forecast) : ''}${e.forecast && e.previous ? ' · ' : ''}${e.previous ? 'P ' + esc(e.previous) : ''}` : '');
  const errBox = (k, m) => `<div class="mk-err">${esc(m)} <button type="button" class="mk-a" data-mk-retry="${k}">Try again</button></div>`;
  const row = (label, val, cls, title) => `<div class="mk-row"${title ? ` title="${esc(title)}"` : ''}><span>${label}</span><b class="${cls || ''}">${val}</b></div>`;

  function paintSec(k) {
    const b = body(k), s = sumEl(k); if (!b) return;
    // countdowns are filled by the 1-second timer, so a section's HTML only changes when its data does (hover / scroll stay put)
    try { const r = P[k](); if (s.dataset.html !== (r.sum || '')) { s.innerHTML = r.sum || ''; s.dataset.html = r.sum || ''; cdTick(s); } s.className = 'mk-sum ' + (r.cls || '');
      if (!b.hidden) { if (b.dataset.html !== r.html) { b.innerHTML = r.html; b.dataset.html = r.html; cdTick(b); } if (r.after) r.after(b); } }
    catch (e) { console.error(e); }
  }
  function paintAll() { for (const [k] of SECS) paintSec(k); }

  // a first-touch trade in words (SMC zones and equal levels): the plan, how it ended in R, the best run before the stop
  const sp = (a, b) => { const v = (b / a - 1) * 100; return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + '%'; };
  const when = (x, t0) => (day(x) === day(t0) ? '' : day(x) + ' ') + hhmm(x) + ' UTC';
  const lag = ms => { const q = Math.round(ms / MIN); return q <= 0 ? 'the touch candle itself' : q < 60 ? q + 'm after the touch' : q < 1440 ? Math.floor(q / 60) + 'h ' + String(q % 60).padStart(2, '0') + 'm after the touch' : Math.floor(q / 1440) + 'd ' + Math.floor((q % 1440) / 60) + 'h after the touch'; };
  function rLines(t, L) {
    const plan = `${L ? 'Long' : 'Short'} ${fp(t.entry)} · stop ${fp(t.stop)} (${sp(t.entry, t.stop)}) · target ${fp(t.target)} (${sp(t.entry, t.target)})`;
    const end = t.res === 1 ? `✓ Target hit first: +1R · ${when(t.hitT, t.t)} candle, ${lag(t.hitT - t.t)}` : t.res === 0 ? `✗ Stop hit first: −1R · ${when(t.hitT, t.t)} candle, ${lag(t.hitT - t.t)}` : '· Neither hit yet (or not within 96 candles)';
    const b = t.best != null ? t.best : null, bR = b == null ? '' : '+' + b.toFixed(1) + 'R';
    const run = b == null ? '' : t.res === 0 ? (b >= 0.1 ? `Best run before the stop: ${bR} (${fp(t.entry + (L ? 1 : -1) * b * Math.abs(t.entry - t.stop))})` : 'It never moved in your favour before the stop')
      : t.res === 1 ? `Best run before the stop (or 96 candles): ${bR} · ${b >= 3 ? 'a 3R target would have hit' : b >= 2 ? 'a 2R target would have hit' : 'a 2R target would have missed'}`
      : `Best run so far: ${bR}`;
    return plan + '\n' + end + (run ? '\n' + run : '');
  }
  const P = {
    ov() {
      const d = M.d.ov;
      if (!d) return { html: M.err.ov ? errBox('ov', M.err.ov) : spin };
      const pos = d.hi > d.lo ? Math.max(0, Math.min(1, (d.px - d.lo) / (d.hi - d.lo))) : 0.5;
      const prev = d.days.slice(0, -1).filter(v => v > 0), avg = prev.length ? prev.reduce((a, v) => a + v, 0) / prev.length : null, rel = avg ? d.qv / avg : null;
      const basis = d.index > 0 ? (d.mark / d.index - 1) * 100 : null;
      return {
        sum: `<span class="${tone(d.chg)}">${pct(d.chg)}</span> · ${big(d.qv)}`,
        html: `<div class="mk-big"><b class="mono">${fp(d.px)}</b><span class="${tone(d.chg)}">${pct(d.chg)} <em>24h</em></span></div>
          <div class="mk-range" title="Where price sits in the last 24 hours"><div class="mk-rbar"><i style="left:${(pos * 100).toFixed(1)}%"></i></div>
            <div class="mk-rl"><span>L ${fp(d.lo)}</span><span>${Math.round(pos * 100)}% of the 24h range</span><span>H ${fp(d.hi)}</span></div></div>
          ${row('24h volume', big(d.qv))}
          ${rel != null ? row('vs its 7-day average', `${rel.toFixed(2)}×`, rel >= 1.5 ? 'warn' : '', 'This 24h volume divided by the average daily volume of the 7 days before today') : ''}
          ${row('Mark · index', `${fp(d.mark)} · ${fp(d.index)}`)}
          ${basis != null ? row('Futures over spot (basis)', `${basis >= 0 ? '+' : '−'}${Math.abs(basis).toFixed(3)}%`, tone(basis), 'Mark price vs the spot index: positive = futures trade above spot') : ''}`,
      };
    },
    fu() {
      const d = M.d.fu, ov = M.d.ov;
      const rate = d ? d.rate : ov ? ov.fund.rate : null, next = d ? d.next : ov ? ov.fund.next : null;
      if (rate == null) return { html: M.err.fu ? errBox('fu', M.err.fu) : spin };
      const iv = d ? d.iv : 8 * HOUR, apr = rate * (DAY / iv) * 365 * 100;
      const sum = `<span class="${tone(rate)}">${fr4(rate)}</span>${next ? ` · <span data-cd="${next}"></span>` : ''}`;
      if (!d) return { sum, html: M.err.fu ? errBox('fu', M.err.fu) : spin };
      // what it means for a size: your open paper position on this coin, else the ticket's margin × leverage
      const pos = (RD.A.pos || []).find(p => p.sym === U.sym && p.mode === 'live');
      let you = '';
      if (pos) { const notional = pos.qty * (S.lastPx || pos.entry), pay = pos.side * notional * rate; you = `Your paper ${pos.side === 1 ? 'long' : 'short'} (${big(notional)}) ${pay >= 0 ? 'pays' : 'receives'} <b>${u.money(Math.abs(pay))}</b> at the next funding.`; }
      else { const t = RD.readT(), n = (t.margin || 0) * (t.lev || 0); if (n > 0) { const pay = n * rate; you = `On ${big(n)} (the ticket's size) a long ${pay >= 0 ? 'pays' : 'gets'} <b>${u.money(Math.abs(pay))}</b> and a short ${pay >= 0 ? 'gets' : 'pays'} it, each funding.`; } }
      const mx = Math.max(1e-6, ...d.hist.map(h => Math.abs(h.r)));
      const bars = d.hist.map(h => `<i class="${h.r >= 0 ? 'pos' : 'neg'}" style="height:${Math.max(2, Math.abs(h.r) / mx * 22).toFixed(1)}px" data-tip="${esc(day(h.t) + ' ' + hhmm(h.t) + ' UTC · ' + fr4(h.r))}"></i>`).join('');
      return {
        sum,
        html: `<div class="mk-big"><b class="mono ${tone(rate)}">${fr4(rate)}</b><span class="mk-pill">${rate >= 0 ? 'Longs pay shorts' : 'Shorts pay longs'}</span></div>
          ${row('Next funding', next ? `<span data-cd="${next}"></span> · ${hhmm(next)} UTC` : '—')}
          ${row('Every', `${Math.round(iv / HOUR)} h`)}
          ${row('Per year at this rate', `${apr >= 0 ? '+' : '−'}${Math.abs(apr).toFixed(1)}%`, tone(apr), 'The rate × payments a day × 365, as a % of the position')}
          ${d.hist.length ? `<div class="mk-fh"><div class="mk-fh-h"><span>Last ${d.hist.length} fundings</span><span class="mk-read" data-mk-read="fu">hover a bar</span></div><div class="mk-fbars" data-mk-tips="fu">${bars}</div></div>` : ''}
          ${you ? `<p class="mk-p">${you}</p>` : ''}`,
        after: b => tips(b, 'fu'),
      };
    },
    oi() {
      const d = M.d.oi;
      if (!d) return { html: M.err.oi ? errBox('oi', M.err.oi) : spin };
      const now = Date.now(), at = h => { let best = null; for (const x of d.hist) if (x.t <= now - h * HOUR + 5 * MIN) best = x; return best; };
      const ch = h => { const x = at(h); return x && x.v > 0 ? (d.coins / x.v - 1) * 100 : null; };
      const c1 = ch(1), c4 = ch(4), c24 = ch(24);
      const pts = d.hist.map(x => ({ t: x.t, v: x.v })).concat([{ t: now, v: d.coins }]);
      return {
        sum: `${big(d.val)}${c24 != null ? ` · <span class="${tone(c24)}">${pc1(c24)}</span>` : ''}`,
        html: `<div class="mk-big"><b class="mono">${big(d.val)}</b><span>${fq(d.coins)} ${esc(coin())}</span></div>
          <div class="mk-chips3">${[['1h', c1], ['4h', c4], ['24h', c24]].map(([l, v]) => `<span><em>${l}</em><b class="${tone(v)}">${pc1(v)}</b></span>`).join('')}</div>
          ${spark('oi', pts, v => fq(v) + ' ' + coin())}
          <p class="mk-p m">Open interest = all open futures positions on ${u.api(U.ex).name}. Rising with price: new money joining the move; rising while price falls: new shorts.</p>`,
        after: b => sparkHover(b, 'oi'),
      };
    },
    ls() {
      const d = M.d.ls;
      if (!d) return { html: M.err.ls ? errBox('ls', M.err.ls) : spin };
      const p0 = v => (v == null || !isFinite(v) ? '?' : Math.round(v * 100) + '%');
      const mv = s => (s.h1 == null ? '' : s.now - s.h1 >= 0.02 ? ' <span class="up" title="2 points or more above 1 h ago">↑</span>' : s.h1 - s.now >= 0.02 ? ' <span class="down" title="2 points or more below 1 h ago">↓</span>' : '');
      const bar = l => `<div class="mk-sb"><i class="l" style="width:${(l * 100).toFixed(1)}%"></i><i class="s" style="width:${((1 - l) * 100).toFixed(1)}%"></i></div>`;
      const side = (label, s, title, none) => !s ? `<div class="mk-split mk-none"><div class="mk-sh"><span>${label}</span><b class="m">${none}</b></div></div>`
        : `<div class="mk-split" title="${esc(title)}"><div class="mk-sh"><span>${label}</span><b>${p0(s.now)} long${mv(s)}</b></div>${bar(s.now)}
          <div class="mk-sl"><span>ratio ${s.ratio != null ? s.ratio.toFixed(2) : '?'}</span><span>1 h ago ${p0(s.h1)} · 4 h ago ${p0(s.h4)}</span></div></div>`;
      const bnNone = d.bnMissing ? 'not on Binance' : 'no data', byNone = d.byMissing ? 'not on Bybit' : 'no data';
      const w = d.whales, r = d.retail || d.retailBybit, rd = flowReading(w && w.ratio, r && r.ratio), od = flowOiReading(d.oi1, d.ch1h);
      const tk = d.taker, f = d.funding;
      const fu = f == null ? '' : `funding <b class="${tone(f)}">${f >= 0 ? '+' : '−'}${Math.abs(f).toFixed(4)}%</b> ${f >= 0.05 ? 'longs paying a lot' : f > 0.0101 ? 'longs pay more than usual' : f >= 0 ? 'longs pay shorts (normal)' : f > -0.05 ? 'shorts pay longs' : 'shorts paying a lot'}`;
      const sg = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%';
      const facts = [fu,
        d.oi1 != null ? `open interest${U.ex === 'bybit' ? ' (Bybit)' : ' (Binance)'} 1h <b>${sg(d.oi1)}</b>, 4h ${d.oi4 != null ? sg(d.oi4) : '?'}${d.oiUsd ? ` (${big(d.oiUsd)} open)` : ''}` : '',
        tk ? `taker buy/sell 1h <b>${tk.ratio.toFixed(2)}</b> ${tk.ratio >= 1.1 ? '(buyers hitting harder)' : tk.ratio <= 0.9 ? '(sellers hitting harder)' : '(even)'}` : '',
        od ? `last hour: ${esc(od)}` : '', d.at ? `5-minute data of ${hhmm(d.at)} UTC` : ''].filter(Boolean);
      return {
        sum: w || r ? `${w ? `🐋 <span class="${w.now >= 0.5 ? 'up' : 'down'}">${p0(w.now)}</span>` : ''}${w && r ? ' · ' : ''}${r ? `👥 <span class="${r.now >= 0.5 ? 'up' : 'down'}">${p0(r.now)}</span>` : ''}` : '—',
        html: (rd ? `<p class="mk-flow${rd.warn ? ' warn' : ''}">${esc(rd.text)}</p>` : '') +
          side('🐋 Whales · by position (Binance top traders)', w, 'Binance\'s top traders (the 20% of accounts with the most margin): share of their position size that is long', bnNone) +
          side('🐋 Whales · by accounts', d.whalesAcc, 'Binance\'s top traders: share of those accounts that are long, one vote each', bnNone) +
          side('👥 Retail · Binance (all accounts)', d.retail, 'Every Binance account with a position, one vote each', bnNone) +
          side('👥 Retail · Bybit (all accounts)', d.retailBybit, 'Every Bybit account with a position, one vote each', byNone) +
          (tk ? `<div class="mk-split" title="Market buys vs market sells over the last hour (who crossed the spread), Binance"><div class="mk-sh"><span>Takers · last hour (Binance)</span><b>${p0(tk.buy / (tk.buy + tk.sell))} buys</b></div>${bar(tk.buy / (tk.buy + tk.sell))}</div>` : '') +
          (facts.length ? `<p class="mk-p">${facts.join(' · ')}</p>` : '') +
          '<p class="mk-p m">Whales = Binance\'s top traders (the 20% of accounts with the most margin), counted by position size; retail = every account, one vote each. ' +
          'Funding above 0 = longs pay shorts each funding period (more people want to be long); below 0 = shorts pay longs.</p>' +
          '<p class="mk-p m"><b>Positioning, not a signal:</b> in our tests long/short ratios on their own showed no edge. October (one month — Binance keeps 30 days): shorts taken while whales and retail were both ≥ 1.4 lost <span class="mk-nw">−$2.58/trade</span> over 22 trades; WEAK pump shorts with funding above +0.005% lost in both replay periods.</p>',
      };
    },
    nw() {
      const n = M.news;
      if (!n) return { html: M.newsErr ? errBox('nw', M.newsErr) : spin };
      const now = Date.now(), lvl = { High: 3, Medium: 2, Low: 1 };
      const minL = M.imp === 'h' ? 3 : M.imp === 'hm' ? 2 : 0;
      const evs = n.events.filter(e => (lvl[e.impact] || 0) >= minL).sort((a, b) => a.t - b.t);
      const nextRed = n.events.find(e => e.impact === 'High' && e.t > now - 2 * MIN);
      const sum = nextRed ? `<span class="down">●</span> ${esc(nextRed.cur)} ${esc(short(nextRed.title))} · <span data-cd="${nextRed.t}"></span>` : 'No red news ahead';
      const tabs = `<div class="mk-seg" role="tablist"><button type="button" role="tab" data-mk-nt="cal" class="${M.nwTab === 'cal' ? 'on' : ''}">Calendar</button><button type="button" role="tab" data-mk-nt="hl" class="${M.nwTab === 'hl' ? 'on' : ''}">Headlines</button></div>`;
      let html = tabs;
      if (M.nwTab === 'cal') {
        html += `<div class="mk-tools"><div class="mk-seg sm">${[['h', 'Red'], ['hm', 'Red + orange'], ['all', 'All']].map(([k, t]) => `<button type="button" data-mk-imp="${k}" class="${M.imp === k ? 'on' : ''}">${t}</button>`).join('')}</div>
          <label class="mk-sw" title="A toast, a sound and a browser notification 15 minutes before each red (high impact) event"><input type="checkbox" data-mk-warn${M.warn ? ' checked' : ''}><span></span>Warn me 15 min before</label></div>
          <button type="button" class="mk-calopen" data-mk-calopen title="The whole week: day by day, with actual, forecast and prior figures, currency filter and your time zone">📅 Full week calendar${M.calCur.length ? ' · ' + esc(M.calCur.join(', ')) : ''}<span aria-hidden="true">↗</span></button>`;
        if (nextRed) html += `<div class="mk-next"><span class="mk-imp h"></span><div><b>${esc(nextRed.cur)} · ${esc(nextRed.title)}</b><em>${cShort(cKey(nextRed.t))} · ${cT(nextRed.t)} ${M.calTz === 'local' ? '' : 'UTC'}</em></div><b class="mono" data-cd="${nextRed.t}"></b></div>`;
        let lastDay = '';
        const list = evs.filter(e => e.t > now - 36 * HOUR && calPass(e)), today = cKey(now);
        html += '<div class="mk-cal">' + (list.length ? list.map(e => {
          const k = cKey(e.t), past = e.t < now - 5 * MIN, hd = k !== lastDay ? `<p class="mk-day">${cShort(k)}${k === today ? ' · today' : ''}</p>` : ''; lastDay = k;
          const fp3 = afpLine(e);
          return hd + `<div class="mk-ev${past ? ' past' : ''}"${e.note ? ` title="${esc(e.note)}"` : ''}>${impBars(e.impact)}<span class="mono mk-t">${cT(e.t)}</span><span class="mk-cur">${flag(e.cur)}${esc(e.cur)}</span>
            <span class="mk-ti">${esc(e.title)}${fp3 ? `<em>${fp3}</em>` : ''}</span>
            <span class="mk-when">${past ? ago(e.t) : e.t - now < DAY ? `in <span data-cd="${e.t}"></span>` : ''}</span></div>`;
        }).join('') : '<p class="mk-p m">Nothing at this level' + (M.calCur.length ? ' for ' + esc(M.calCur.join(', ')) : '') + ' from yesterday on.</p>') + '</div>';
        html += `<p class="mk-p m">Times in ${tzLabel()}. A = actual, F = forecast, P = prior. ${esc((n.sources && n.sources.calendar) || 'Economic calendar')}${n.calErrors && n.calErrors.length ? ' · ' + esc(n.calErrors[0]) : ''}. Red = high impact: price can jump either way on the minute.</p>`;
      } else {
        const re = coinRe(), list = (n.headlines || []).filter(h => !M.hlCoin || re.test(h.title));
        html += `<div class="mk-tools"><label class="mk-sw"><input type="checkbox" data-mk-hlcoin${M.hlCoin ? ' checked' : ''}><span></span>Only ${esc(coin())}</label><span class="mk-p m">${list.length} headline${list.length === 1 ? '' : 's'}</span></div>`;
        html += '<div class="mk-hl">' + (list.length ? list.slice(0, 40).map(h => `<a class="mk-hli" href="${esc(h.link)}" target="_blank" rel="noopener noreferrer"><span>${esc(h.title)}</span><em>${esc(h.src)} · ${ago(h.t)}</em></a>`).join('')
          : `<p class="mk-p m">${M.hlCoin ? `No headline mentions ${esc(coin())} right now.` : 'No headlines right now.'}</p>`) + '</div>';
        html += '<p class="mk-p m">Headlines link to the publisher. Sources: CoinDesk, Cointelegraph, Decrypt, The Block.</p>';
      }
      return { sum, cls: nextRed && nextRed.t - now < HOUR ? 'hot' : '', html };
    },
    al() {
      const mine = AL.list.filter(a => !a.fired && a.sym === U.sym && a.ex === U.ex), other = AL.list.filter(a => !a.fired && !(a.sym === U.sym && a.ex === U.ex)), fired = AL.list.filter(a => a.fired).slice(-8).reverse();
      const px = S.lastPx;
      const sum = mine.length || other.length ? `${mine.length + other.length} active` : 'None';
      const item = a => `<div class="mk-al"><span class="mk-aldir ${a.dir === 1 ? 'up' : 'down'}">${a.dir === 1 ? '▲' : '▼'}</span><div><b class="mono">${fp(a.p)}</b><em>${a.sym === U.sym && a.ex === U.ex ? (px ? pct((a.p / px - 1) * 100) + ' from now' : '') : esc(u.coin(a.sym)) + ' · ' + esc(u.api(a.ex).name)}${a.note ? ' · ' + esc(a.note) : ''}</em></div>
        ${a.sym === U.sym && a.ex === U.ex ? '' : `<button type="button" class="mk-a" data-mk-algo="${a.id}">Open</button>`}<button type="button" class="mk-x" data-mk-aldel="${a.id}" aria-label="Delete the alert">${u.ic('x')}</button></div>`;
      return {
        sum, cls: mine.length || other.length ? 'warnt' : '',
        html: `<form class="mk-add" data-mk-add><input class="mono" data-mk-alp inputmode="decimal" autocomplete="off" placeholder="${px ? fp(px) : 'price'}" aria-label="Alert price"><input data-mk-aln maxlength="40" placeholder="note (optional)" aria-label="Note"><button type="submit" class="mk-btn">${u.ic('bell')} Add</button></form>
          <p class="mk-p m">Or right-click / long-press the chart → Chart: <b>Alert</b>. Drag an alert line to move it. Alerts watch the live price${R.on ? ' (not the replay)' : ''} while this page is open.</p>
          ${mine.length ? `<p class="mk-day">${esc(coin())}</p>` + mine.map(item).join('') : ''}
          ${other.length ? `<p class="mk-day">Other coins</p>` + other.map(item).join('') : ''}
          ${!mine.length && !other.length ? '<p class="mk-p m">No alerts yet.</p>' : ''}
          ${fired.length ? `<p class="mk-day">Triggered <button type="button" class="mk-a" data-mk-alclear>Clear</button></p>` + fired.map(a => `<div class="mk-al done"><span class="mk-aldir">✓</span><div><b class="mono">${fp(a.p)}</b><em>${esc(u.coin(a.sym))} · ${ago(a.fired)}${a.note ? ' · ' + esc(a.note) : ''}</em></div></div>`).join('') : ''}
          <div class="mk-tools"><label class="mk-sw"><input type="checkbox" data-mk-snd${AL.sound ? ' checked' : ''}><span></span>Sound</label>
          <label class="mk-sw"><input type="checkbox" data-mk-ntf${AL.notify && notifyOK() ? ' checked' : ''}><span></span>Browser notification</label></div>`,
      };
    },
    tr() {
      const d = M.d.tr;
      if (!d) return { html: M.err.tr ? errBox('tr', M.err.tr) : spin };
      const arrow = t => (t === 1 ? '<b class="up">▲ up</b>' : t === -1 ? '<b class="down">▼ down</b>' : '<b>– no break</b>');
      const tfs = ['4H', '1H', '15m'], ts = tfs.map(t => (d[t] ? d[t].trend : 0));
      const all = ts.every(t => t === ts[0] && t !== 0);
      const sum = tfs.map((t, i) => `${t} <span class="${ts[i] === 1 ? 'up' : ts[i] === -1 ? 'down' : ''}">${ts[i] === 1 ? '▲' : ts[i] === -1 ? '▼' : '–'}</span>`).join(' ');
      return {
        sum,
        html: tfs.map(t => { const x = d[t]; if (!x) return `<div class="mk-tr"><span class="mk-tf">${t}</span><span class="m">not enough candles</span></div>`;
          const p = x.pos, where = p == null ? '' : p > 1 ? 'above its last swing high' : p < 0 ? 'below its last swing low' : `${Math.round(p * 100)}% up its range · <b class="${p >= 0.5 ? 'down' : 'up'}">${p >= 0.5 ? 'premium' : 'discount'}</b>`;
          return `<div class="mk-tr"><span class="mk-tf">${t}</span><div>${arrow(x.trend)}${x.brk ? ` <em>since the ${x.brk.kind} ${ago(x.brk.conf || x.brk.t)}</em>` : ''}${where ? `<em class="mk-w">${where}</em>` : ''}</div></div>`; }).join('') +
          `<p class="mk-p">${all ? `All three ${ts[0] === 1 ? 'up' : 'down'}: the timeframes agree.` : 'Mixed: the timeframes disagree, so the bigger one usually sets the bias.'}</p>` +
          '<p class="mk-p m">Closed candles only. Practice read, not a signal: in our tests A+ setups with the 4H trend did no better than against it.</p>',
      };
    },
    hr() {
      const d = M.d.hr;
      if (!d) return { html: M.err.hr ? errBox('hr', M.err.hr) : spin };
      const h0 = new Date().getUTCHours(), mx = Math.max(1e-9, ...d.avg), mean = d.avg.reduce((a, v) => a + v, 0) / 24;
      const top = d.avg.map((v, h) => [v, h]).sort((a, b) => b[0] - a[0]).slice(0, 3).map(x => x[1]).sort((a, b) => a - b);
      const now = d.avg[h0], rel = mean ? now / mean : 1;
      const bars = d.avg.map((v, h) => `<i class="${h === h0 ? 'now' : ''}" style="height:${Math.max(2, v / mx * 46).toFixed(1)}px" data-tip="${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 UTC · average range ${v.toFixed(2)}%"></i>`).join('');
      return {
        sum: rel >= 1.25 ? '<span class="warn">Busy hour now</span>' : rel <= 0.8 ? 'Quiet hour now' : 'Normal hour now',
        html: `<div class="mk-fh-h"><span>Average 1h range by UTC hour · ${d.days} days</span><span class="mk-read" data-mk-read="hr">hover a bar</span></div>
          <div class="mk-hbars" data-mk-tips="hr">${bars}</div><div class="mk-hax"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
          <p class="mk-p">Now (${String(h0).padStart(2, '0')}:00 UTC): <b>${now.toFixed(2)}%</b> on average, ${rel.toFixed(1)}× a typical hour. Busiest: ${top.map(h => String(h).padStart(2, '0') + ':00').join(', ')} UTC.</p>`,
        after: b => tips(b, 'hr'),
      };
    },
    pa() {
      const d = M.d.pa;
      if (!d) return { html: M.err.pa ? errBox('pa', M.err.pa) : spin };
      const px = live() && S.lastPx ? S.lastPx : d.px;
      const dist = p => pc1((p / px - 1) * 100);
      const zr = (z) => `${fp(z.bot)}–${fp(z.top)}`;
      const rng = (h, w) => `<div class="pa-r"><div class="mk-fh-h"><span>${h} <b class="${tone(w.chg)}">${pc1(w.chg)}</b></span><span class="mono">L ${fp(w.lo)} · H ${fp(w.hi)}</span></div>
        <div class="mk-rbar" title="Where price sits in the ${h} range"><i style="left:${(Math.max(0, Math.min(1, w.pos)) * 100).toFixed(1)}%"></i></div>
        <div class="mk-rl"><span>low ${ago(w.loT)}</span><span>${Math.round(w.pos * 100)}% up the range</span><span>high ${ago(w.hiT)}</span></div></div>`;
      const H = d.hiLab && d.hiLab.label, Lb = d.loLab && d.loLab.label;
      const st = H === 'HH' && Lb === 'HL' ? ['up', 'Higher highs and higher lows'] : H === 'LH' && Lb === 'LL' ? ['down', 'Lower highs and lower lows']
        : H === 'LH' && Lb === 'HL' ? ['', 'A lower high and a higher low: squeezing into a range'] : H === 'HH' && Lb === 'LL' ? ['', 'A higher high and a lower low: swinging wider both ways'] : ['', 'Not enough swings yet'];
      const up = d.brks.filter(b => b.dir === 1).length, dn = d.brks.length - up, ch = d.brks.filter(b => b.kind === 'CHoCH').length;
      const { dem, sup } = nearZones(d.zones, px);
      const inD = dem && px <= dem.top, inS = sup && px >= sup.bot;
      const touch = z => (z.touched ? 'touched before' : 'not touched yet');
      const sw = d.sweeps.map(w => `<div class="pa-sw"><span>${ago(w.conf)}</span><b class="${w.dir === 1 ? 'up' : 'down'}">${w.dir === 1 ? 'Swept a low' : 'Swept a high'} ${fp(w.p)}${/EQ/.test(w.kind) ? ' (' + w.kind + ')' : ''}, closed back ${w.dir === 1 ? 'above' : 'below'}</b></div>`).join('');
      const li = (cls, word, txt) => `<li><span class="pa-t ${cls}">${word}</span>${txt}</li>`;
      const p48 = d.d48.pos;
      const longs = [
        inD ? li('w', 'zone', `Price is in a demand zone ${zr(dem)} · ${touch(dem)}`) : dem ? li('', 'zone', `Demand ${zr(dem)}, ${dist(dem.top)} away · ${touch(dem)}`) : li('a', 'zone', 'No unbroken demand below in the last 4 days'),
        d.eql ? li('', 'stops', `Equal lows ${fp(d.eql.p)} (${dist(d.eql.p)}): stops resting below, untaken`) : '',
        d.trend === 1 ? li('w', 'with', '15m structure is up') : d.trend === -1 ? li('a', 'against', '15m structure is down') : '',
        p48 <= 0.33 ? li('w', 'with', `Bottom third of the 48h range (discount)`) : p48 >= 0.67 ? li('a', 'against', `Top third of the 48h range (premium)`) : '',
        d.sweeps.some(w => w.dir === 1) ? li('w', 'with', 'A low was swept and price closed back above') : '',
      ].join('');
      const shorts = [
        inS ? li('w', 'zone', `Price is in a supply zone ${zr(sup)} · ${touch(sup)}`) : sup ? li('', 'zone', `Supply ${zr(sup)}, ${dist(sup.bot)} away · ${touch(sup)}`) : li('a', 'zone', 'No unbroken supply above in the last 4 days'),
        d.eqh ? li('', 'stops', `Equal highs ${fp(d.eqh.p)} (${dist(d.eqh.p)}): stops resting above, untaken`) : '',
        d.trend === -1 ? li('w', 'with', '15m structure is down') : d.trend === 1 ? li('a', 'against', '15m structure is up') : '',
        p48 >= 0.67 ? li('w', 'with', `Top third of the 48h range (premium)`) : p48 <= 0.33 ? li('a', 'against', `Bottom third of the 48h range (discount)`) : '',
        d.sweeps.some(w => w.dir === -1) ? li('w', 'with', 'A high was swept and price closed back below') : '',
      ].join('');
      return {
        sum: `<span class="${tone(d.d24.chg)}">${pc1(d.d24.chg)}</span> / <span class="${tone(d.d48.chg)}">${pc1(d.d48.chg)}</span>`,
        html: rng('24h', d.d24) + rng('48h', d.d48) +
          `<p class="mk-day">Structure · 15m</p>
          <p class="mk-p" style="margin-top:0"><b class="${st[0]}">${st[1]}.</b> ${d.brks.length ? `Last 48h: ${up} break${up === 1 ? '' : 's'} up, ${dn} down${ch ? ` (${ch} CHoCH)` : ''}.` : 'No structure break in the last 48h.'}${d.brk ? ` Last: ${d.brk.kind} ${d.brk.dir === 1 ? 'up' : 'down'} at ${fp(d.brk.p)}, ${ago(d.brk.conf)}.` : ''}</p>
          ${sw ? `<p class="mk-day">Sweeps · last 48h</p>${sw}` : ''}
          <div class="pa-two"><div class="pa-col l"><b>▲ For a long</b><ul>${longs}</ul></div><div class="pa-col s"><b>▼ For a short</b><ul>${shorts}</ul></div></div>
          <p class="mk-p m">What the chart did, on closed 15m candles. Each line is a fact, not a vote: in our tests zones, trend agreement and premium / discount did not pick winners on their own. See <b>SMC zones</b> below for how this coin's zones did.</p>`,
      };
    },
    zr() {
      const d = M.d.zr, Z = window.ZoneStats, tf = M.zrTf, days = zrDays();
      const ctl = `<div class="mk-tools"><div class="mk-seg sm" aria-label="Zone timeframe">${['5m', '15m', '1H'].map(t => `<button type="button" data-mk-zrtf="${t}" class="${tf === t ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="mk-seg sm" aria-label="How far back">${[1, 2, 7, 30, 90].map(n => `<button type="button" data-mk-zrd="${n}" class="${days === n ? 'on' : ''}"${tf === '5m' && n === 90 ? ' disabled title="5m: 30 days at most"' : ''}>${n}d</button>`).join('')}</div></div>`;
      if (!d || d.tf !== tf || d.days !== days || !Z) return { html: ctl + (M.err.zr ? errBox('zr', M.err.zr) : spin) };
      const V = { demand: Z.verdict(d.demand, d.rnd.demand), supply: Z.verdict(d.supply, d.rnd.supply) };
      const say = (v) => (v.n < 20 ? ['', 'too few touches to tell'] : v.base == null ? ['', 'no random comparison'] : !v.beyond ? ['', 'same as random'] : v.diff > 0 ? ['up', 'held more often than random'] : ['down', 'went through more often than random']);
      const stopMed = k => { const v = d.touches.filter(t => t.type === k && t.target != null).map(t => Math.abs(t.stop / t.entry - 1) * 100).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)].toFixed(2) + '%' : '—'; };
      const side = (k, name) => {
        const S = d[k], v = V[k], n = S.held + S.against;
        if (!n) return `<div class="zr-side"><div class="zr-h"><b>${name}</b><em>no finished first touches</em></div></div>`;
        const hp = S.held / n * 100, w = say(v);
        return `<div class="zr-side" data-zr-side="${k}"><div class="zr-h"><b>${name}</b><em>${n} first touches${S.open ? ` · ${S.open} still open` : ''}</em></div>
          <div class="zr-bar" title="Held ${hp.toFixed(0)}% · the same trade at random times ${v.base == null ? '—' : v.base.toFixed(0) + '%'} (the white tick)"><i class="up" style="width:${hp.toFixed(1)}%"></i><i class="down" style="width:${(100 - hp).toFixed(1)}%"></i>${v.base == null ? '' : `<s style="left:${v.base.toFixed(1)}%"></s>`}</div>
          <div class="zr-num"><span class="up" title="Target hit before the stop">Held ${S.held} · ${hp.toFixed(0)}%</span><span class="down" title="Stop hit before the target">Went through ${S.against} · ${(100 - hp).toFixed(0)}%</span></div>
          <p class="zr-v">Stop size: median <b>${stopMed(k)}</b> from entry (target the same distance the other way).</p>
          <p class="zr-v">Same trade at random times: <b>${v.base == null ? '—' : v.base.toFixed(0) + '%'}</b> held${v.luck == null ? '' : ` · luck ±${v.luck.toFixed(0)}`} → <b class="${w[0]}" data-zr-say="${k}">${w[1]}</b></p>
          ${d.r2 && d.r2[k].n ? `<p class="zr-v" data-zr-r2="${k}" title="How far price ran in the trade's favour before the stop (or 96 candles), before fees. 2R = twice the stop distance.">Ran <b>2R or more</b> before the stop: <b>${(d.r2[k].hit / d.r2[k].n * 100).toFixed(0)}%</b> (${d.r2[k].hit} of ${d.r2[k].n})${d.rnd2 && d.rnd2[k].n ? ` · random ${(d.rnd2[k].hit / d.rnd2[k].n * 100).toFixed(0)}%` : ''}</p>` : ''}</div>`;
      };
      const px = live() && S.lastPx ? S.lastPx : d.price;
      const { dem, sup } = nearZones(d.active, px);
      const pc = v => (v.pct == null ? '—' : v.pct.toFixed(0) + '%'), bs = v => (v.base == null ? '—' : v.base.toFixed(0) + '%');
      const first = z => (z.touched ? ' It was touched before, so this would not be a first touch.' : '');
      const now = dem && px <= dem.top ? `Price is <b>in a demand zone</b> ${fp(dem.bot)}–${fp(dem.top)}: a long here is the trade above, held <b>${pc(V.demand)}</b> on ${esc(coin())} vs ${bs(V.demand)} at random.${first(dem)}`
        : sup && px >= sup.bot ? `Price is <b>in a supply zone</b> ${fp(sup.bot)}–${fp(sup.top)}: a short here is the trade above, held <b>${pc(V.supply)}</b> on ${esc(coin())} vs ${bs(V.supply)} at random.${first(sup)}`
        : `Not in a zone. ${dem ? `Demand ${fp(dem.bot)}–${fp(dem.top)} is ${pc1((dem.top / px - 1) * 100)} away` : 'No unbroken demand below'}; ${sup ? `supply ${fp(sup.bot)}–${fp(sup.top)} is ${pc1((sup.bot / px - 1) * 100)} away` : 'no unbroken supply above'}.`;
      const last = d.touches.slice(-30);
      const tip = t => {
        const L = t.type === 'demand', head = `${L ? 'Demand' : 'Supply'} ${fp(t.bot)}–${fp(t.top)} · touched ${day(t.t)} ${hhmm(t.t)} UTC`;
        if (t.target == null) return head + `\n${L ? 'Long' : 'Short'}: the candle opened past the stop ${fp(t.stop)}, so it counts as went through (a loss of more than 1R)`;
        return head + '\n' + rLines(t, L);
      };
      const dots = last.map(t => `<i class="${t.res === 1 ? 'up' : t.res === 0 ? 'down' : 'op'}" data-tip="${esc(tip(t))}">${t.type === 'demand' ? '▲' : '▼'}</i>`).join('');
      const any = ['demand', 'supply'].some(k => V[k].n >= 20 && V[k].beyond);
      return {
        sum: `D ${pc(V.demand)} · S ${pc(V.supply)}${any ? '' : ' <em>≈ random</em>'}`,
        html: ctl + side('demand', '▲ Demand · longs') + side('supply', '▼ Supply · shorts') +
          `<div class="zr-now" data-zr-now>${now}</div>
          ${dots ? `<p class="mk-day">Last ${last.length} touches · oldest → newest</p><div class="zr-dots" data-mk-tips="zr">${dots}</div><div class="mk-read zr-read" data-mk-read="zr" data-def="▲ demand · ▼ supply · green: target hit first, red: stop hit first. Hover or tap one for its entry, stop and target.">▲ demand · ▼ supply · green: target hit first, red: stop hit first. Hover or tap one for its entry, stop and target.</div>` : ''}
          <div class="mk-tools" style="margin-top:8px"><label class="mk-sw"><input type="checkbox" data-mk-zrmk${M.zrMarks ? ' checked' : ''}><span></span>Mark the touches on the chart <em class="m">(squares)</em></label></div>
          <p class="mk-p m">${d.candles.toLocaleString('en')} closed ${tf} candles, ${days} day${days === 1 ? '' : 's'}${days <= 2 ? ' (+300 earlier candles so the zones are known from the start; only touches inside the period count — a day or two has few touches, so read it as what happened, not a pattern)' : ''}, fetched live from ${esc(u.api(U.ex).name)}. Each zone's first touch: entry at its edge, stop 0.1% past the far edge, target the same distance (1R). Random = the same stop and target from 20 random candles of this coin per touch. In our tests (207 coins, 3 months) a coin's score did not carry into the next month and zones overall held about as often as random, so read this as how ${esc(coin())} behaved, not a forecast.</p>`,
        after: b => tips(b, 'zr'),
      };
    },
    eq() {
      const d = M.d.eq, Z = window.ZoneStats, tf = M.eqTf, days = eqDays();
      const capT = n => (n > eqCap(tf) ? `${tf}: ${eqCap(tf)} days at most` : '');
      const ctl = `<div class="mk-tools"><div class="mk-seg sm" aria-label="Timeframe">${['1m', '5m', '15m', '1H'].map(t => `<button type="button" data-mk-eqtf="${t}" class="${tf === t ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="mk-seg sm" aria-label="How far back">${[1, 2, 7, 30, 90].map(n => `<button type="button" data-mk-eqd="${n}" class="${days === n ? 'on' : ''}"${capT(n) ? ` disabled title="${capT(n)}"` : ''}>${n}d</button>`).join('')}</div></div>`;
      if (!d || d.tf !== tf || d.days !== days || !Z) return { html: ctl + (M.err.eq ? errBox('eq', M.err.eq) : spin) };
      const V = { L: Z.verdict(d.L, d.L.rnd), H: Z.verdict(d.H, d.H.rnd) };
      const say = (v) => (v.n < 20 ? ['', 'too few touches to tell'] : v.base == null ? ['', 'no random comparison'] : !v.beyond ? ['', 'same as random'] : v.diff > 0 ? ['up', 'held more often than random'] : ['down', 'went through more often than random']);
      const pp = (a, b) => (b ? (a / b * 100).toFixed(0) + '%' : '—');
      const stopMed = k => { const v = d.touches.filter(t => t.side === k && t.res != null).map(t => Math.abs(t.stop / t.entry - 1) * 100).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)].toFixed(2) + '%' : '—'; };
      const side = k => {
        const S = d[k], v = V[k], n = S.held + S.against, Lo = k === 'L', name = Lo ? '▲ Equal lows · longs' : '▼ Equal highs · shorts';
        if (!n) return `<div class="zr-side"><div class="zr-h"><b>${name}</b><em>no finished first touches${S.open ? ` · ${S.open} still open` : ''}</em></div></div>`;
        const hp = S.held / n * 100, w = say(v), fR = S.feeR / n, net = (2 * S.held - n) / n - fR;
        return `<div class="zr-side" data-eq-side="${k}"><div class="zr-h"><b>${name}</b><em>${n} first touches${S.open ? ` · ${S.open} still open` : ''}</em></div>
          <div class="zr-bar" title="Held ${hp.toFixed(0)}% · the same trade at random levels ${v.base == null ? '—' : v.base.toFixed(0) + '%'} (the white tick)"><i class="up" style="width:${hp.toFixed(1)}%"></i><i class="down" style="width:${(100 - hp).toFixed(1)}%"></i>${v.base == null ? '' : `<s style="left:${v.base.toFixed(1)}%"></s>`}</div>
          <div class="zr-num"><span class="up" title="Target hit before the stop">Held ${S.held} · ${hp.toFixed(0)}%</span><span class="down" title="Stop hit before the target">Went through ${S.against} · ${(100 - hp).toFixed(0)}%</span></div>
          <p class="zr-v">Stop 1 ATR: median <b>${stopMed(k)}</b> from entry (target the same distance the other way).</p>
          <p class="zr-v">Same trade at random levels: <b>${v.base == null ? '—' : v.base.toFixed(0) + '%'}</b> held${v.luck == null ? '' : ` · luck ±${v.luck.toFixed(0)}`} → <b class="${w[0]}" data-eq-say="${k}">${w[1]}</b></p>
          <p class="zr-v" data-eq-zone="${k}">At a ${Lo ? 'demand' : 'supply'} zone: <b>${pp(S.zone.held, S.zone.n)}</b> held (${S.zone.n} touches) · random ${pp(S.rndZone.held, S.rndZone.n)}</p>
          <p class="zr-v" data-eq-old="${k}" title="The same trade at single swing ${Lo ? 'lows' : 'highs'} that are not part of an equal pair: is “equal” any better than an ordinary old ${Lo ? 'low' : 'high'}?">Any single old ${Lo ? 'low' : 'high'}: <b>${pp(S.old.held, S.old.n)}</b> held (${S.old.n})</p>
          <p class="zr-v" title="The touch candle's own close: ${Lo ? 'back above' : 'back below'} the level (a wick through, or just a tap) vs closed through it">Touch candle closed back ${Lo ? 'above' : 'below'} the level: <b>${pp(S.back, n)}</b> · random ${pp(S.rnd.back, S.rnd.all)}</p>
          <p class="zr-v" title="How far price ran in the trade's favour before the stop (or 96 candles), before fees">Ran <b>2R or more</b> before the stop: <b>${pp(S.r2, S.n2)}</b> · random ${pp(S.rnd.r2, S.rnd.n2)}</p>
          <p class="zr-v" data-eq-fee="${k}" title="+1R at the target, −1R at the stop, minus 0.07% fees a trade (limit in, market out) as a share of the stop">After fees: <b class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(2)}R</b> a trade · break-even needs ${(50 + fR * 50).toFixed(0)}% held</p></div>`;
      };
      const px = live() && S.lastPx ? S.lastPx : d.price;
      const act = d.active || [];
      const eql = act.filter(e => e.side === 'L' && e.p < px).sort((a, b) => b.p - a.p)[0], eqh = act.filter(e => e.side === 'H' && e.p > px).sort((a, b) => a.p - b.p)[0];
      const pc = v => (v.pct == null ? '—' : v.pct.toFixed(0) + '%'), bs = v => (v.base == null ? '—' : v.base.toFixed(0) + '%');
      const now = (eql ? `Equal lows <b>${fp(eql.p)}</b> (${pc1((eql.p / px - 1) * 100)})${eql.zone ? ' at a demand zone' : ''}: a long on the first touch is the trade above, held <b>${pc(V.L)}</b> on ${esc(coin())} vs ${bs(V.L)} at random.`
        : `No equal lows below that price has not traded through.`) + '<br>' +
        (eqh ? `Equal highs <b>${fp(eqh.p)}</b> (${pc1((eqh.p / px - 1) * 100)})${eqh.zone ? ' at a supply zone' : ''}: a short on the first touch held <b>${pc(V.H)}</b> vs ${bs(V.H)} at random.`
        : `No equal highs above that price has not traded through.`);
      const last = d.touches.slice(-30);
      const tip = t => {
        const L = t.side === 'L', pair = `${when(t.first, t.t)} and ${when(t.second, t.t)}`;
        const head = `Equal ${L ? 'lows' : 'highs'} ${fp(t.p)} (the ${L ? 'lows' : 'highs'} of the ${pair} candles)${t.zone ? ` · at a ${L ? 'demand' : 'supply'} zone` : ''}\nTouched ${day(t.t)} ${hhmm(t.t)} UTC · ${t.back ? (L ? 'that candle closed back above' : 'that candle closed back below') : 'that candle closed through it'}`;
        return head + '\n' + rLines(t, L);
      };
      const dots = last.map(t => `<i class="${t.res === 1 ? 'up' : t.res === 0 ? 'down' : 'op'}" data-tip="${esc(tip(t))}">${t.side === 'L' ? '▲' : '▼'}</i>`).join('');
      const any = ['L', 'H'].some(k => V[k].n >= 20 && V[k].beyond);
      const def = '▲ equal lows (long) · ▼ equal highs (short) · green: target hit first, red: stop hit first. Hover or tap one for the level, entry, stop and target.';
      return {
        sum: `L ${pc(V.L)} · H ${pc(V.H)}${any ? '' : ' <em>≈ random</em>'}`,
        html: ctl + side('L') + side('H') +
          `<div class="zr-now" data-eq-now>${now}</div>
          ${dots ? `<p class="mk-day">Last ${last.length} touches · oldest → newest</p><div class="zr-dots" data-mk-tips="eq">${dots}</div><div class="mk-read zr-read" data-mk-read="eq" data-def="${def}">${def}</div>` : ''}
          <div class="mk-tools" style="margin-top:8px"><label class="mk-sw"><input type="checkbox" data-mk-eqmk${M.eqMarks ? ' checked' : ''}><span></span>Mark the touches on the chart <em class="m">(arrows)</em></label></div>
          <p class="mk-p m">${d.candles.toLocaleString('en')} closed ${tf} candles, ${days} day${days === 1 ? '' : 's'} (+300 earlier candles so the levels are known from the start; only touches inside the period count${days <= 2 ? ' — a day or two has few touches, so read it as what happened, not a pattern' : ''}), fetched live from ${esc(u.api(U.ex).name)}.
          Equal lows = two swing lows within 0.1% (or 0.2 ATR), at most 48 candles apart; the lower one is the level (equal highs the same way up). First touch after the second low (high) is confirmed: entry at the level, stop 1 ATR past it, target 1 ATR the other way (1R), 96 candles at most. Random = a level the same distance from price at 20 random candles of this coin and period, same stop and target.
          With SMC on, the chart draws only the equal lows / highs price has not traded through yet, so the lines you see are the ones that held so far.
          Our test (18 Nov, 65 coins): they hold 2–9 points more often than random levels on 1m / 5m, not on 1h / 4h, about as often as any old swing low on big coins, and lose after fees — a reaction, not an edge.</p>`,
        after: b => tips(b, 'eq'),
      };
    },
  };
  const fq = v => (v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : (+v).toFixed(v >= 1 ? 0 : 2));
  const short = t => (t.length > 26 ? t.slice(0, 25) + '…' : t);
  const NAMES = { BTC: 'bitcoin', ETH: 'ethereum|ether', SOL: 'solana', BNB: 'binance coin|bnb chain', XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', AVAX: 'avalanche', LINK: 'chainlink', DOT: 'polkadot',
    SUI: 'sui network', TON: 'toncoin', TRX: 'tron', LTC: 'litecoin', SHIB: 'shiba', PEPE: 'pepe', ARB: 'arbitrum', OP: 'optimism', NEAR: 'near protocol', APT: 'aptos', HYPE: 'hyperliquid', UNI: 'uniswap', AAVE: 'aave' };
  function coinRe() {
    const c = coin().replace(/^1000+/, ''), alt = NAMES[c];
    return new RegExp(`\\b(${c}${alt ? '|' + alt : ''})\\b`, 'i');
  }
  // bar charts: hovering (or tapping) a bar shows its value in the section's read-out
  function tips(b, k) {
    const box = $(`[data-mk-tips="${k}"]`, b), out = $(`[data-mk-read="${k}"]`, b); if (!box || !out || box._on) return; box._on = true;
    const show = e => { const i = e.target.closest('i[data-tip]'); if (!i) return; $$('i.hov', box).forEach(x => x.classList.remove('hov')); i.classList.add('hov'); out.textContent = i.dataset.tip; };
    box.addEventListener('pointerover', show); box.addEventListener('pointerdown', show);
    box.addEventListener('pointerleave', () => { $$('i.hov', box).forEach(x => x.classList.remove('hov')); out.textContent = out.dataset.def || 'hover a bar'; });
  }
  // a small line chart (SVG); hovering shows the value at that time
  function spark(k, pts, fmt) {
    if (pts.length < 2) return '';
    const W = 280, H = 52, t0 = pts[0].t, t1 = pts[pts.length - 1].t, lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v)), r = hi - lo || hi * 0.01 || 1;
    const x = t => ((t - t0) / (t1 - t0 || 1)) * W, y = v => H - 4 - ((v - lo) / r) * (H - 10);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    return `<div class="mk-spark" data-mk-spark="${k}" data-pts='${esc(JSON.stringify(pts.map(p => [p.t, p.v])))}' data-lo="${lo}" data-r="${r}">
      <div class="mk-fh-h"><span>Last 24 hours</span><span class="mk-read" data-mk-read="${k}">${esc(fmt(pts[pts.length - 1].v))} now</span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path class="ar" d="${d}L${W},${H}L0,${H}Z"/><path class="ln" d="${d}"/><line class="cx" x1="-9" x2="-9" y1="0" y2="${H}"/><circle class="dot" r="3" cx="-9" cy="-9"/></svg></div>`;
  }
  const sparkFmt = { oi: v => fq(v) + ' ' + coin() };
  function sparkHover(b, k) {
    const el = $(`[data-mk-spark="${k}"]`, b); if (!el || el._on) return; el._on = true;
    const svg = $('svg', el), out = $(`[data-mk-read="${k}"]`, el), pts = JSON.parse(el.dataset.pts), lo = +el.dataset.lo, r = +el.dataset.r, W = 280, H = 52;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    const mv = e => {
      const bx = svg.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - bx.left) / bx.width)), t = t0 + f * (t1 - t0);
      let best = pts[0]; for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
      const X0 = ((best[0] - t0) / (t1 - t0 || 1)) * W, Y0 = H - 4 - ((best[1] - lo) / r) * (H - 10);
      $('.cx', svg).setAttribute('x1', X0); $('.cx', svg).setAttribute('x2', X0); $('.dot', svg).setAttribute('cx', X0); $('.dot', svg).setAttribute('cy', Y0);
      out.textContent = `${sparkFmt[k](best[1])} · ${best === pts[pts.length - 1] ? 'now' : day(best[0]) + ' ' + hhmm(best[0])}`;
    };
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerdown', mv);
    svg.addEventListener('pointerleave', () => { $('.cx', svg).setAttribute('x1', -9); $('.cx', svg).setAttribute('x2', -9); $('.dot', svg).setAttribute('cx', -9); out.textContent = sparkFmt[k](pts[pts.length - 1][1]) + ' now'; });
  }

  // ---------------------------------------------------------------- alerts (this browser)
  const AL = { list: store.get('rd-alerts-v1', null) || [], sound: store.get('rd-al-sound', true) !== false, notify: !!store.get('rd-al-notify', false), polling: false };
  const saveAl = () => { AL.list = AL.list.slice(-60); store.set('rd-alerts-v1', AL.list); };
  const notifyOK = () => 'Notification' in window && Notification.permission === 'granted';
  let actx = null;
  const quiet = () => !!(RD.sound && RD.sound.muted());   // the bell in the top bar: every sound on this site muted
  function beep(kind, what) {
    if (!AL.sound || quiet()) return;
    if (what && RD.sound) RD.sound.played(what);
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state !== 'running') actx.resume().catch(() => {});   // switched off while nothing could sound (desksound.js)
      const t = actx.currentTime, tones = kind === 'news' ? [660, 880, 660] : [880, 1320];
      tones.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.14);
        o.connect(g).connect(actx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.15); });
    } catch (e) { /* no audio */ }
  }
  function notify(title, text) {
    if (!AL.notify || !notifyOK() || !document.hidden) return;   // the page shows a toast when you are looking at it
    try { const n = new Notification(title, { body: text, tag: 'rd-' + title, icon: '/icon.svg', silent: quiet() }); n.onclick = () => { window.focus(); n.close(); }; } catch (e) { /* not allowed */ }
  }
  function addAlert(p, note) {
    const px = S.lastPx; if (!(p > 0) || !px) return false;
    if (Math.abs(p / px - 1) < 1e-4) { RD.toast('That is the price now — pick a level above or below it.', 'down'); return false; }
    AL.list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), sym: U.sym, ex: U.ex, p, dir: p > px ? 1 : -1, note: String(note || '').slice(0, 40), at: Date.now(), fired: 0 });
    saveAl(); RD.syncLines(); paintSec('al');
    RD.toast(`🔔 Alert set: ${coin()} ${p > px ? 'rises to' : 'falls to'} ${fp(p)}.`, 'up');
    return true;
  }
  function fire(a, px) {
    a.fired = Date.now(); saveAl(); RD.syncLines(); paintSec('al');
    const msg = `${u.coin(a.sym)} ${a.dir === 1 ? 'rose to' : 'fell to'} ${fp(a.p)} (now ${fp(px)})${a.note ? ' · ' + a.note : ''}`;
    RD.toast('🔔 ' + msg, a.dir === 1 ? 'up' : 'down'); beep('alert', '🔔 Price alert: ' + msg); notify('Price alert', msg);
  }
  function checkAt(sym, ex, px) {
    if (!(px > 0)) return;
    for (const a of AL.list) if (!a.fired && a.sym === sym && a.ex === ex && (a.dir === 1 ? px >= a.p : px <= a.p)) fire(a, px);
  }
  async function pollAlerts() {   // coins other than the live chart's (and the chart's own during a replay): their ticker
    if (AL.polling || document.hidden) return;
    const want = new Set(AL.list.filter(a => !a.fired && (R.on || a.sym !== U.sym || a.ex !== U.ex)).map(a => a.ex + '|' + a.sym));
    if (!want.size) return;
    AL.polling = true;
    try { await Promise.allSettled([...want].map(async k => { const [ex, sym] = k.split('|'); const t = await u.api(ex).ticker(sym); checkAt(sym, ex, t.px); })); }
    finally { AL.polling = false; }
  }
  X.lines.push(() => AL.list.filter(a => !a.fired && a.sym === U.sym && a.ex === U.ex).map(a => ({
    key: 'al' + a.id, price: a.p, color: '#f5b301', style: RD.LS.Dashed, w: 1, title: '🔔 ' + fp(a.p),
    tip: () => `<b>🔔 Alert</b> when ${coin()} ${a.dir === 1 ? 'rises to' : 'falls to'} ${fp(a.p)}${a.note ? '<br>' + esc(a.note) : ''}<br><small>Drag to move it · delete it in Market → Alerts</small>`,
    drag: { commit: v => { a.p = v; a.dir = S.lastPx && v < S.lastPx ? -1 : 1; saveAl(); paintSec('al'); RD.syncLines(); RD.toast(`🔔 Alert moved to ${fp(v)}.`); } },
  })));
  if (X.chartChips) X.chartChips.push(v => ['🔔 Alert', () => addAlert(v)]);

  if (RD.sound) {   // listed once for every desk tab (a setting of this browser); "off" reaches each open tab
    RD.sound.source('price', { all: true, btn: 'Sound off', label: () => { const n = AL.list.filter(a => !a.fired).length; return AL.sound && n ? `Price alerts: ${n} waiting, with a sound` : ''; },
      off: () => { AL.sound = false; store.set('rd-al-sound', false); const b = document.querySelector('[data-mk-snd]'); if (b) b.checked = false; } });
    RD.sound.source('news', { all: true, label: () => (M.warn ? 'Red news warning, 15 minutes before each red event' : ''),
      off: () => { M.warn = false; store.set('rd-mk-warn', false); const b = document.querySelector('[data-mk-warn]'); if (b) b.checked = false; } });
  }

  // ---------------------------------------------------------------- news warning (15 min before red news), runs with the panel closed too
  function newsWarn() {
    if (!M.warn || !M.news) return;
    const now = Date.now();
    for (const e of M.news.events) {
      if (e.impact !== 'High' || e.t < now || e.t - now > 15 * MIN) continue;
      const id = e.t + '|' + e.title; if (M.warned.has(id)) continue;
      M.warned.add(id);
      const msg = `${e.cur} ${e.title} in ${Math.max(1, Math.round((e.t - now) / MIN))} min (${hhmm(e.t)} UTC) — price can jump either way.`;
      RD.toast('📰 Red news: ' + msg, 'down'); beep('news', '📰 Red news: ' + msg); notify('Red news soon', msg);
    }
  }

  // ---------------------------------------------------------------- chart legend: funding + the next red news at a glance
  let lgT = 0;
  function legendSoon() { if (!lgT) lgT = setTimeout(() => { lgT = 0; if (RD.legend) RD.legend(); }, 50); }
  if (X.legend) X.legend.push(() => {
    if (R.on) return '';   // a replay chart is in the past: today's funding / news would mislead
    const parts = [], ov = M.d.ov, now = Date.now();
    if (ov && ov.key === keyNow() && ov.fund && isFinite(ov.fund.rate)) parts.push(`<span>Funding <b class="${tone(ov.fund.rate)}">${fr4(ov.fund.rate)}</b>${ov.fund.next ? ' · ' + inT(ov.fund.next) : ''}</span>`);
    const nr = M.news && M.news.events.find(e => e.impact === 'High' && e.t > now && e.t - now < 6 * HOUR);
    if (nr) parts.push(`<span class="${nr.t - now < HOUR ? 'down' : ''}">📰 ${esc(nr.cur)} ${esc(short(nr.title))} in ${inT(nr.t)}</span>`);
    return parts.join('');
  });

  // zone touches on the chart (Zones → "Mark the touches"): squares D / S with ✓ held, ✗ went through, · still open. Not in a replay: the mark
  // would show how a touch ended before the replay clock gets there.
  if (X.marks) X.marks.push(() => {
    const d = M.d.zr;
    if (!M.zrMarks || !d || d.key !== keyNow() || R.on) return [];
    const C = RD.COL || {};
    return d.touches.map(t => ({ t: t.t, position: t.type === 'demand' ? 'belowBar' : 'aboveBar', shape: 'square',   // square: the SMC overlay's swing points are circles
      color: t.res === 1 ? C.up || '#22c55e' : t.res === 0 ? C.down || '#ef4444' : '#8b93a1',
      text: (t.type === 'demand' ? 'D' : 'S') + (t.res === 1 ? ' ✓' : t.res === 0 ? ' ✗' : ' ·') }));
  });
  // equal-level touches on the chart (Equal lows / highs → "Mark the touches"): arrows EQL / EQH, the same ✓ ✗ ·
  if (X.marks) X.marks.push(() => {
    const d = M.d.eq;
    if (!M.eqMarks || !d || d.key !== keyNow() || R.on) return [];
    const C = RD.COL || {};
    return d.touches.map(t => ({ t: t.t, position: t.side === 'L' ? 'belowBar' : 'aboveBar', shape: t.side === 'L' ? 'arrowUp' : 'arrowDown',
      color: t.res === 1 ? C.up || '#22c55e' : t.res === 0 ? C.down || '#ef4444' : '#8b93a1',
      text: (t.side === 'L' ? 'EQL' : 'EQH') + (t.res === 1 ? ' ✓' : t.res === 0 ? ' ✗' : ' ·') }));
  });

  // ---------------------------------------------------------------- events
  pane.addEventListener('click', e => {
    const h = e.target.closest('[data-mk-h]');
    if (h) { const k = h.dataset.mkH; M.open[k] = !M.open[k]; saveOpen(); openUI(); delete body(k).dataset.html; paintSec(k); if (M.open[k]) { if (k === 'nw') loadNews(); else if (L[k]) loadSec(k); if (k === 'fu' || k === 'oi') loadSec('ov'); } return; }
    const rt = e.target.closest('[data-mk-retry]'); if (rt) { const k = rt.dataset.mkRetry; if (k === 'nw') loadNews(true); else { M.d[k] = null; M.err[k] = ''; paintSec(k); loadSec(k, true); } return; }
    const nt = e.target.closest('[data-mk-nt]'); if (nt) { M.nwTab = nt.dataset.mkNt; store.set('rd-mk-nwtab', M.nwTab); paintSec('nw'); return; }
    const zt = e.target.closest('[data-mk-zrtf]'); if (zt) { M.zrTf = zt.dataset.mkZrtf; store.set('rd-mk-zrtf', M.zrTf); M.err.zr = ''; paintSec('zr'); loadSec('zr', true); return; }
    const zd = e.target.closest('[data-mk-zrd]'); if (zd && !zd.disabled) { M.zrDays = +zd.dataset.mkZrd; store.set('rd-mk-zrdays', M.zrDays); M.err.zr = ''; paintSec('zr'); loadSec('zr', true); return; }
    const et = e.target.closest('[data-mk-eqtf]'); if (et) { M.eqTf = et.dataset.mkEqtf; store.set('rd-mk-eqtf', M.eqTf); M.err.eq = ''; paintSec('eq'); loadSec('eq', true); return; }
    const ed = e.target.closest('[data-mk-eqd]'); if (ed && !ed.disabled) { M.eqDays = +ed.dataset.mkEqd; store.set('rd-mk-eqdays', M.eqDays); M.err.eq = ''; paintSec('eq'); loadSec('eq', true); return; }
    if (e.target.closest('[data-mk-calopen]')) { calOpen(); return; }
    const im = e.target.closest('[data-mk-imp]'); if (im) { M.imp = im.dataset.mkImp; store.set('rd-mk-imp', M.imp); paintSec('nw'); return; }
    const del = e.target.closest('[data-mk-aldel]'); if (del) { AL.list = AL.list.filter(a => a.id !== del.dataset.mkAldel); saveAl(); RD.syncLines(); paintSec('al'); return; }
    const go = e.target.closest('[data-mk-algo]'); if (go) { const a = AL.list.find(x => x.id === go.dataset.mkAlgo); if (a) RD.setSymbol(a.sym, a.ex); return; }
    if (e.target.closest('[data-mk-alclear]')) { AL.list = AL.list.filter(a => !a.fired); saveAl(); paintSec('al'); }
  });
  pane.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-mk-warn]')) setWarn(t.checked);
    else if (t.matches('[data-mk-hlcoin]')) { M.hlCoin = t.checked; store.set('rd-mk-hlcoin', M.hlCoin); paintSec('nw'); }
    else if (t.matches('[data-mk-zrmk]')) { M.zrMarks = t.checked; store.set('rd-mk-zrmk', M.zrMarks); if (M.zrMarks && !M.d.zr) loadSec('zr', true); if (RD.setMarkers) RD.setMarkers(); }
    else if (t.matches('[data-mk-eqmk]')) { M.eqMarks = t.checked; store.set('rd-mk-eqmk', M.eqMarks); if (M.eqMarks && !M.d.eq) loadSec('eq', true); if (RD.setMarkers) RD.setMarkers(); }
    else if (t.matches('[data-mk-snd]')) { AL.sound = t.checked; store.set('rd-al-sound', AL.sound); if (AL.sound) beep('alert'); }
    else if (t.matches('[data-mk-ntf]')) { AL.notify = t.checked; store.set('rd-al-notify', AL.notify); if (AL.notify) { const ok = await askNotify(); if (!ok) { AL.notify = false; store.set('rd-al-notify', false); t.checked = false; RD.toast('The browser blocked notifications for this site. Allow them in the site settings to use this.', 'down'); } } }
  });
  function setWarn(on) {
    M.warn = on; store.set('rd-mk-warn', M.warn);
    if (M.warn) { beep('news'); askNotify(); RD.toast('You will get a warning 15 minutes before each red news event while this page is open.'); }
    paintSec('nw'); if (calM && !calM.hidden) calPaint();
  }
  async function askNotify() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') { AL.notify = true; store.set('rd-al-notify', true); return true; }
    if (Notification.permission === 'denied') return false;
    try { const p = await Notification.requestPermission(); if (p === 'granted') { AL.notify = true; store.set('rd-al-notify', true); } return p === 'granted'; } catch (e) { return false; }
  }
  pane.addEventListener('submit', e => {
    if (!e.target.matches('[data-mk-add]')) return;
    e.preventDefault();
    const pi = $('[data-mk-alp]', e.target), ni = $('[data-mk-aln]', e.target), v = u.num(pi.value || '') ;
    const p = v == null ? S.lastPx : v;
    if (!(p > 0)) { RD.toast('Type a price for the alert.', 'down'); pi.focus(); return; }
    if (addAlert(u.rt ? u.rt(p) : p, ni.value)) { pi.value = ''; ni.value = ''; }
  });

  function reset() {
    M.key = keyNow(); M.d = {}; M.err = {}; M.at = {};
    for (const [k] of SECS) { const b = body(k); if (b) delete b.dataset.html; }
    openUI(); paintAll(); refresh(true);
    if (M.zrMarks && !visible()) loadSec('zr', true);   // the chart marks need the zone data even with the panel closed
    if (M.eqMarks && !visible()) loadSec('eq', true);
  }
  RD.on('sym', () => { reset(); RD.syncLines(); });
  RD.on('load', () => { if (M.key !== keyNow()) reset(); openUI(); });
  RD.on('mode', () => { openUI(); paintSec('al'); });
  RD.on('pane', t => { if (t === 'mkt') { openUI(); paintAll(); refresh(); } });
  RD.on('tick', () => { if (!R.on && S.lastPx) checkAt(U.sym, U.ex, S.lastPx); });

  function cdTick(root) { for (const el of root.querySelectorAll('[data-cd]')) { const t = +el.dataset.cd; el.textContent = t > Date.now() ? inT(t) : 'now'; } }
  // countdowns tick every second (only the ones on screen)
  setInterval(() => {
    if (document.hidden) return;
    cdTick(document);
    newsWarn();
  }, 1000);
  setInterval(() => refresh(false), 5000);
  // the legend's funding glance: Overview once a minute while the panel is closed (live chart only)
  const glance = () => { if (!document.hidden && !visible() && !R.on && (!M.at.ov || Date.now() - M.at.ov > 60e3)) loadSec('ov', true); };
  setInterval(glance, 10000);
  setInterval(pollAlerts, 15000);
  setInterval(() => { if (M.warn || (X.legend && !visible())) loadNews(false); }, 60000);
  M.key = keyNow(); openUI(); paintAll(); setTimeout(glance, 1500);
  if (M.zrMarks) setTimeout(() => loadSec('zr'), 2000);
  if (M.eqMarks) setTimeout(() => loadSec('eq'), 2500);
  if (M.warn) loadNews(false); else setTimeout(() => loadNews(false), 4000);   // the legend's red-news glance
  window.__rdMkt = { M, AL, refresh, loadSec, loadNews, calOpen, calPaint, addAlert, checkAt, pollAlerts, P };   // for tests
})();
