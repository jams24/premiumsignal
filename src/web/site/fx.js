'use strict';
/* Interbank FX candles for the desk.
   TradingView's FX charts (FX:USDJPY, OANDA:USDJPY…) show the interbank market. The exchanges' FX perps (Bybit USDJPYUSDT,
   EURUSDUSDT…) are separate, thin contracts: on 21 Nov 2026 Bybit's USDJPY sat ~0.20 yen under interbank on average, wicked
   further, and kept printing flat candles all weekend. So FX pairs get their own feed: Yahoo Finance's chart data (the source
   our FX research used), fetched here because browsers can't (no CORS), cached and shared so many viewers make few calls.
   Yahoo keeps 1m candles for 30 days, 5m / 15m for 60 days, 1h for 730 days, daily for decades. 4H and 1D are built from 1h
   (Yahoo's own daily FX bars close near the day's open price), 1W and 1M from 1D, on the desk's UTC buckets (weeks from
   Monday, months from the 1st);
   days older than 730 days come from Yahoo's daily bars with each close set to the next day's open. FX closes at the
   weekend: no candles then, like TradingView. Known gaps vs TradingView: Yahoo's week starts Monday 00:00 UTC (TradingView
   has ~2 thin hours from Sunday 22:00), and TradingView's FX days end 17:00 New York, ours at 00:00 UTC. */
const https = require('https');

const MIN = 60e3, HOUR = 36e5, DAY = 864e5, WEEK = 7 * DAY, WEEK_OFF = 4 * DAY;
const UA = 'Mozilla/5.0';

// [desk symbol, Yahoo symbol, name]
const LIST = [
  ['EURUSD', 'EURUSD=X', 'Euro / US dollar'], ['GBPUSD', 'GBPUSD=X', 'British pound / US dollar'], ['USDJPY', 'JPY=X', 'US dollar / Japanese yen'],
  ['AUDUSD', 'AUDUSD=X', 'Australian dollar / US dollar'], ['NZDUSD', 'NZDUSD=X', 'New Zealand dollar / US dollar'], ['USDCAD', 'CAD=X', 'US dollar / Canadian dollar'],
  ['USDCHF', 'CHF=X', 'US dollar / Swiss franc'],
  ['EURJPY', 'EURJPY=X', 'Euro / Japanese yen'], ['GBPJPY', 'GBPJPY=X', 'British pound / Japanese yen'], ['AUDJPY', 'AUDJPY=X', 'Australian dollar / Japanese yen'],
  ['CADJPY', 'CADJPY=X', 'Canadian dollar / Japanese yen'], ['CHFJPY', 'CHFJPY=X', 'Swiss franc / Japanese yen'], ['NZDJPY', 'NZDJPY=X', 'New Zealand dollar / Japanese yen'],
  ['EURGBP', 'EURGBP=X', 'Euro / British pound'], ['EURCHF', 'EURCHF=X', 'Euro / Swiss franc'], ['EURAUD', 'EURAUD=X', 'Euro / Australian dollar'],
  ['EURCAD', 'EURCAD=X', 'Euro / Canadian dollar'], ['EURNZD', 'EURNZD=X', 'Euro / New Zealand dollar'], ['GBPCHF', 'GBPCHF=X', 'British pound / Swiss franc'],
  ['GBPAUD', 'GBPAUD=X', 'British pound / Australian dollar'], ['GBPCAD', 'GBPCAD=X', 'British pound / Canadian dollar'], ['GBPNZD', 'GBPNZD=X', 'British pound / New Zealand dollar'],
  ['AUDCAD', 'AUDCAD=X', 'Australian dollar / Canadian dollar'], ['AUDNZD', 'AUDNZD=X', 'Australian dollar / New Zealand dollar'], ['AUDCHF', 'AUDCHF=X', 'Australian dollar / Swiss franc'],
  ['NZDCAD', 'NZDCAD=X', 'New Zealand dollar / Canadian dollar'], ['NZDCHF', 'NZDCHF=X', 'New Zealand dollar / Swiss franc'], ['CADCHF', 'CADCHF=X', 'Canadian dollar / Swiss franc'],
  ['USDMXN', 'MXN=X', 'US dollar / Mexican peso'], ['USDZAR', 'ZAR=X', 'US dollar / South African rand'], ['USDTRY', 'TRY=X', 'US dollar / Turkish lira'],
  ['USDCNH', 'CNH=X', 'US dollar / Chinese yuan (offshore)'], ['USDSGD', 'SGD=X', 'US dollar / Singapore dollar'], ['USDHKD', 'HKD=X', 'US dollar / Hong Kong dollar'],
  ['USDSEK', 'SEK=X', 'US dollar / Swedish krona'], ['USDNOK', 'NOK=X', 'US dollar / Norwegian krone'], ['USDPLN', 'PLN=X', 'US dollar / Polish zloty'],
  ['DXY', 'DX-Y.NYB', 'US dollar index'],
];
const PAIRS = new Map(LIST.map(([s, y, name]) => [s, { s, y, name, d: /JPY$/.test(s) || s === 'DXY' ? 3 : 5 }]));

// desk timeframe → Yahoo interval, how far back Yahoo keeps it, and how candles are bucketed
const IV = {
  '1m': { y: '1m', ms: MIN, keep: 29.5 * DAY, span: 7 * DAY },
  '5m': { y: '5m', ms: 5 * MIN, keep: 59 * DAY, span: 59 * DAY },
  '15m': { y: '15m', ms: 15 * MIN, keep: 59 * DAY, span: 59 * DAY },
  '30m': { y: '15m', ms: 30 * MIN, keep: 59 * DAY, span: 59 * DAY },   // two 15m candles each (shares their cache), the way 4H is built from 1h
  '1H': { y: '60m', ms: HOUR, keep: 729 * DAY, span: 729 * DAY },
  '4H': { y: '60m', ms: 4 * HOUR, keep: 729 * DAY, span: 729 * DAY },
  '1D': { y: '60m', ms: DAY, keep: Infinity, span: Infinity },
  '1W': { y: '60m', ms: WEEK, keep: Infinity, span: Infinity },
  '1M': { y: '60m', ms: 31 * DAY, keep: 40 * 365 * DAY, span: Infinity },   // Yahoo's daily FX goes back to ~2003 (DXY 1971)
};

// ---------------------------------------------------------------- upstream: one queue, a small cache
const cache = new Map();   // key → { at, ttl, v } or { p } while in flight
function remember(key, ttl, fn) {
  const c = cache.get(key), now = Date.now();
  if (c && c.p) return c.p;
  if (c && now - c.at < c.ttl) { cache.delete(key); cache.set(key, c); return Promise.resolve(c.v); }
  const p = fn().then(v => { cache.set(key, { at: Date.now(), ttl, v }); trim(); return v; }, e => { cache.delete(key); throw e; });
  cache.set(key, { p });
  return p;
}
function trim() { while (cache.size > 400) cache.delete(cache.keys().next().value); }

let running = 0; const waiting = [];
function queued(fn) {
  return new Promise((ok, no) => {
    const go = () => { running++; fn().then(ok, no).finally(() => { running--; const n = waiting.shift(); if (n) n(); }); };
    if (running < 3) go(); else waiting.push(go);
  });
}
function getJSON(url) {
  return queued(() => new Promise((ok, no) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 15000 }, res => {
      let body = '', size = 0;
      res.setEncoding('utf8');
      res.on('data', d => { size += d.length; if (size > 12e6) { req.destroy(new Error('FX feed answer too big')); return; } body += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(body); } catch (e) { /* not json */ }
        if (res.statusCode === 429) return no(new Error('The FX feed is busy. Try again in a minute.'));
        const err = j && j.chart && j.chart.error;
        if (err) return no(new Error(err.description || err.code || 'FX feed error'));
        if (res.statusCode !== 200 || !j) return no(new Error('FX feed answered HTTP ' + res.statusCode));
        ok(j);
      });
    });
    req.on('timeout', () => req.destroy(new Error('The FX feed did not answer in time')));
    req.on('error', no);
  }));
}

// raw candles [t, o, h, l, c] from Yahoo for [from, to] (ms), cleaned and put on whole buckets
async function chart(P, yiv, from, to, ttl) {
  const p1 = Math.floor(from / 1000), p2 = Math.ceil(to / 1000);
  return remember(`c|${P.y}|${yiv}|${p1}|${p2}`, ttl, async () => {
    const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(P.y)}?interval=${yiv}&period1=${p1}&period2=${p2}&includePrePost=false`);
    const r = j.chart && j.chart.result && j.chart.result[0];
    if (!r || !r.timestamp) return [];
    const q = r.indicators.quote[0], f = 10 ** P.d, rd = v => Math.round(v * f) / f, out = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      if (o == null || h == null || l == null || c == null || !(c > 0)) continue;
      let t = r.timestamp[i] * 1000;
      if (yiv === '1d') {   // Yahoo dates days at London midnight (23:00 UTC in summer): the UTC weekday it belongs to
        t = Math.floor((t + 3 * HOUR) / DAY) * DAY;
        const wd = new Date(t).getUTCDay(); if (wd === 6) t -= DAY; else if (wd === 0) t += DAY;
      } else t = Math.floor(t / IVMS[yiv]) * IVMS[yiv];
      if (t < from - (IVMS[yiv] || DAY) || t > to) continue;
      out.push([t, rd(o), rd(Math.max(o, h, c)), rd(Math.min(o, l, c)), rd(c)]);
    }
    return merge(out, t => t);
  });
}
const IVMS = { '1m': MIN, '5m': 5 * MIN, '15m': 15 * MIN, '60m': HOUR };
// candles into buckets: first open, highest high, lowest low, last close
const dayKey = t => { let d = Math.floor(t / DAY) * DAY; const wd = new Date(d).getUTCDay(); if (wd === 0) d += DAY; else if (wd === 6) d -= DAY; return d; };   // weekend hours join Monday / Friday
const weekKey = t => Math.floor((t - WEEK_OFF) / WEEK) * WEEK + WEEK_OFF;
const monthKey = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
// a window of raw candles. Live windows are two calls: the history (cached for hours, on whole days so viewers share it)
// and the last two days (cached for seconds), so a live 1D chart doesn't fetch two years of 1h every 20 s
async function rawRange(P, yiv, from, to, live, ttl, keep) {
  const now = Date.now(), ms = IVMS[yiv] || DAY;
  if (!live) return chart(P, yiv, Math.floor(from / ms) * ms, Math.ceil(to / ms) * ms, 6 * HOUR);
  const cut = Math.floor((now - 2 * DAY) / DAY) * DAY, end = Math.ceil(now / ttl) * ttl;
  if (from >= cut) return chart(P, yiv, Math.floor(from / Math.max(ms, MIN)) * Math.max(ms, MIN), end, ttl);
  const hFrom = Math.max(Math.floor(from / DAY) * DAY, Math.ceil((now - keep) / HOUR) * HOUR);
  const [a, b] = await Promise.all([chart(P, yiv, hFrom, cut, 6 * HOUR), chart(P, yiv, cut, end, ttl)]);
  return merge(a.concat(b), t => t);
}
function merge(rows, key) {
  const out = [];
  for (const r of rows.sort((a, b) => a[0] - b[0])) {
    const t = key(r[0]), l = out[out.length - 1];
    if (l && l[0] === t) { l[2] = Math.max(l[2], r[2]); l[3] = Math.min(l[3], r[3]); l[4] = r[4]; } else out.push([t, r[1], r[2], r[3], r[4]]);
  }
  return out;
}

// the desk's klines call: up to `limit` candles, either from `start` forward or ending at `end` (default: now)
async function klines(sym, tf, o = {}) {
  const P = PAIRS.get(sym), I = IV[tf];
  if (!P) throw Object.assign(new Error('Unknown FX pair'), { status: 400 });
  if (!I) throw Object.assign(new Error('Unknown timeframe'), { status: 400 });
  const now = Date.now(), limit = Math.max(1, Math.min(1000, o.limit | 0 || 1000));
  const fwd = o.start != null;
  let to = fwd ? (o.end != null ? o.end : o.start + limit * I.ms) : (o.end != null ? o.end : now);
  to = Math.min(to, now);
  // the markets are shut ~2 days a week: ask for 1.45× the time plus a weekend so `limit` candles come back
  let from = fwd ? o.start : to - limit * I.ms * 1.45 - 3 * DAY;
  from = Math.max(from, now - I.keep, to - I.span);
  if (!(from < to)) return [];
  const live = now - to < 2 * HOUR;
  const ttl = live ? (I.ms <= MIN ? 6e3 : I.ms <= 15 * MIN ? 10e3 : 20e3) : 6 * HOUR;
  // round the window so viewers share cache entries: live ones to the TTL, older ones to the candle
  const q = live ? Math.max(I.ms, MIN) : I.ms;
  const qFrom = Math.floor(from / q) * q, qTo = live ? Math.ceil(now / ttl) * ttl : Math.ceil(to / q) * q;
  let rows;
  if (tf === '1D' || tf === '1W' || tf === '1M') {
    const hKeep = IV['1H'].keep, hFrom = Math.max(from, now - hKeep + DAY);
    rows = hFrom < to ? merge(await rawRange(P, '60m', hFrom, to, live, ttl, hKeep), dayKey) : [];
    if (from < hFrom) {   // older than Yahoo's 1h history: its daily bars, each close = the next day's open
      const old = await chart(P, '1d', Math.floor(from / DAY) * DAY, Math.ceil(Math.min(to, hFrom) / DAY) * DAY, 6 * HOUR);
      const first = rows.length ? rows[0][0] : Infinity;
      const fixed = old.map((r, i) => { const n = old[i + 1]; const c = n ? n[1] : r[4]; return [r[0], r[1], Math.max(r[2], c), Math.min(r[3], c), c]; });
      rows = fixed.filter(r => r[0] < first).concat(rows);
    }
    if (tf === '1W') rows = merge(rows, weekKey);
    if (tf === '1M') rows = merge(rows, monthKey);
  } else {
    rows = await rawRange(P, I.y, qFrom, live ? now : qTo, live, ttl, I.keep);
    if (tf === '4H') rows = merge(rows, t => Math.floor(t / (4 * HOUR)) * 4 * HOUR);
    if (tf === '30m') rows = merge(rows, t => Math.floor(t / (30 * MIN)) * 30 * MIN);
  }
  rows = rows.filter(r => r[0] >= (fwd ? o.start : -Infinity) && r[0] <= to);
  rows = fwd ? rows.slice(0, limit) : rows.slice(-limit);
  return rows.map(r => [r[0], r[1], r[2], r[3], r[4], 0]);   // FX has no shared volume
}

// last price + change on the day for every pair (Yahoo's spark call, 20 symbols a request)
async function tickers() {
  return remember('tickers', 30e3, async () => {
    const all = [...PAIRS.values()], out = {};
    for (let i = 0; i < all.length; i += 20) {
      const part = all.slice(i, i + 20);
      const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/spark?symbols=${part.map(p => encodeURIComponent(p.y)).join(',')}&range=1d&interval=15m`);
      for (const P of part) {
        const v = j[P.y]; if (!v || !v.close) continue;
        const c = v.close.filter(x => x != null); if (!c.length) continue;
        const px = c[c.length - 1], prev = +v.chartPreviousClose, f = 10 ** P.d;
        out[P.s] = { px: Math.round(px * f) / f, chg: prev > 0 ? (px / prev - 1) * 100 : null, vol: 0 };
      }
    }
    return out;
  });
}

const pairs = () => [...PAIRS.values()].map(P => ({ s: P.s, k: (1 / 10 ** P.d).toFixed(P.d), name: P.name }));

// GET /api/site/fx/pairs · /api/site/fx/tickers · /api/site/fx/klines?s=USDJPY&tf=15m&limit=1000[&start=ms][&end=ms]
async function route(res, url, json) {
  const p = url.pathname.slice('/api/site/fx/'.length), q = url.searchParams;
  try {
    if (p === 'pairs') return json(res, 200, { pairs: pairs() });
    if (p === 'tickers') return json(res, 200, { t: await tickers() });
    if (p === 'klines') {
      const n = k => { const v = q.get(k); if (v == null || v === '') return null; const x = +v; return isFinite(x) ? x : NaN; };
      const start = n('start'), end = n('end'), limit = n('limit');
      if ([start, end, limit].some(v => Number.isNaN(v))) return json(res, 400, { error: 'bad', message: 'Bad number' });
      return json(res, 200, { k: await klines(String(q.get('s') || ''), String(q.get('tf') || ''), { start, end, limit }) });
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, e.status || 502, { error: 'fx', message: e.message });
  }
}

module.exports = { route, klines, tickers, pairs, PAIRS, IV };
