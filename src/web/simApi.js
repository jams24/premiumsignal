// Read-only data for the dashboard's Trade Simulator tab: exchange candles (public endpoints), recent pump signals
// and our own live trades to replay. It never places, changes or cancels orders.
const db = require('../db/database');

const STEP = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3 };
const BYBIT_IV = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240' };
const MAX_CANDLES = 3000;

// everyday names for the TradFi perps (Binance/Bybit list gold as XAUUSDT, WTI oil as CLUSDT, …).
// Not SPX (SPXUSDT is the SPX6900 crypto coin; the S&P 500 ETF is SPYUSDT) and not GAS (GASUSDT is NEO's Gas token).
// None of these names is a listed crypto ticker on Binance or Bybit (checked 13 Nov 2026).
const ALIAS = { GOLD: 'XAU', XAUUSD: 'XAU', SILVER: 'XAG', XAGUSD: 'XAG', PLATINUM: 'XPT', PALLADIUM: 'XPD',
  OIL: 'CL', WTI: 'CL', USOIL: 'CL', CRUDE: 'CL', BRENT: 'BZ', UKOIL: 'BZ', NASDAQ: 'QQQ', NAS100: 'QQQ', NDX: 'QQQ',
  SP500: 'SPY', SPX500: 'SPY', US500: 'SPY', TESLA: 'TSLA', NVIDIA: 'NVDA', APPLE: 'AAPL' };
function cleanSymbol(s) {
  s = String(s || '').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 30);   // letters in any script: Binance lists e.g. 龙虾USDT
  if (!s) return null;
  s = ALIAS[s] || ALIAS[s.replace(/USDT$/, '')] || s;
  return s.endsWith('USDT') ? s : s + 'USDT';
}

async function getJson(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.msg || j.retMsg)) || `HTTP ${r.status}`);
  return j;
}

async function binanceKlines(sym, iv, start, end) {
  const out = [];
  for (let t = start; t < end && out.length < MAX_CANDLES;) {
    // ask only for the candles needed: Binance charts weight by limit (≤99 → 1, ≤499 → 2, ≤1000 → 5, more → 10), and the
    // bot shares this IP's budget — a 4 s chart update or an alert check then costs 1, not 10
    const lim = Math.max(1, Math.min(1500, Math.floor((end - t) / STEP[iv]) + 1));
    const j = await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${iv}&startTime=${t}&endTime=${end}&limit=${lim}`);
    if (!Array.isArray(j) || !j.length) break;
    for (const k of j) out.push([k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
    if (j.length < lim) break;
    t = j[j.length - 1][0] + STEP[iv];
  }
  return out;
}

async function bybitKlines(sym, iv, start, end) {
  const out = [];
  for (let t = start; t < end && out.length < MAX_CANDLES;) {
    const e = Math.min(end, t + 999 * STEP[iv]);
    const j = await getJson(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${encodeURIComponent(sym)}&interval=${BYBIT_IV[iv]}&start=${t}&end=${e}&limit=1000`);
    if (j.retCode) throw new Error(j.retMsg || `Bybit error ${j.retCode}`);
    const list = (j.result?.list || []).map(k => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]).reverse();
    for (const k of list) if (!out.length || k[0] > out[out.length - 1][0]) out.push(k);
    t = list.length ? list[list.length - 1][0] + STEP[iv] : e + STEP[iv];
  }
  return out;
}

// ---------- forex pairs (practice only) ----------
// Binance/Bybit list no GBPJPY, and Bybit's EURUSD/GBPUSD/USDJPY perps traded in ~6% of minutes (13 Nov 2026), so
// currency pairs come from Yahoo Finance's public chart feed instead: about 1–2 min behind, no volume, and nothing can be
// traded on it. Yahoo keeps 1m candles for 30 days (≤ 8 days a request), 5m/15m for 60 days, hourly for 2 years.
const FX_CCY = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'MXN', 'ZAR', 'TRY', 'PLN', 'CNH', 'HUF', 'CZK']);
function fxPair(s) {   // 'GBPJPY', 'gbp/jpy', 'GBPJPY=X' → 'GBPJPY'; anything else → null (no crypto perp base looks like this but Bybit's dead FX perps)
  s = String(s || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.length === 7 && s.endsWith('X')) s = s.slice(0, 6);
  if (s.length === 10 && s.endsWith('USDT')) s = s.slice(0, 6);
  return s.length === 6 && s.slice(0, 3) !== s.slice(3) && FX_CCY.has(s.slice(0, 3)) && FX_CCY.has(s.slice(3)) ? s : null;
}
const FX_IV = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '60m', '4h': '60m' };
const FX_KEEP_DAYS = { '1m': 30, '5m': 60, '15m': 60, '1h': 729, '4h': 729 };
const fxCache = new Map();   // pair|interval → { at, from, candles }: a live chart asks every 4 s, Yahoo's candle moves once a minute

async function yahooChart(pair, yiv, start, end) {
  const q = `interval=${yiv}&period1=${Math.floor(start / 1000)}&period2=${Math.ceil(end / 1000)}&includePrePost=false`;
  let lastErr;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${pair}%3DX?${q}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => null);
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (res) return res;
      const why = (j && j.chart && j.chart.error && j.chart.error.description) || '';
      if (/data doesn.t exist/i.test(why)) return null;   // a window with no trading (weekend): Yahoo says so instead of sending nothing
      lastErr = new Error(why || `Yahoo HTTP ${r.status}`);
      if (r.status === 404 || r.status === 422) break;   // unknown pair / outside Yahoo's range: the other host says the same
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function fxKlines(pair, iv, start, end) {
  const now = Date.now(), live = now - end < 120e3, key = `${pair}|${iv}`;
  const hit = fxCache.get(key);
  if (live && hit && now - hit.at < 10e3 && start >= hit.from) return hit.candles.filter(k => k[0] >= start && k[0] <= end);
  const keepFrom = now - FX_KEEP_DAYS[iv] * 86400e3 + 3600e3;
  if (end < keepFrom) throw new Error(`Yahoo keeps ${iv} forex candles for the last ${FX_KEEP_DAYS[iv]} days only — pick a later time`);
  const from = Math.max(start, keepFrom);
  const res = await yahooChart(pair, FX_IV[iv], from, end);
  const ts = (res && res.timestamp) || [], q = (res && res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const step = iv === '4h' ? STEP['1h'] : STEP[iv], out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    const t = Math.floor(ts[i] * 1000 / step) * step;   // Yahoo's newest entry is the latest quote (e.g. 22:29:33): file it under its minute
    const last = out[out.length - 1];
    if (last && last[0] === t) { last[2] = Math.max(last[2], h); last[3] = Math.min(last[3], l); last[4] = c; }
    else if (!last || t > last[0]) out.push([t, o, h, l, c, 0]);
  }
  let candles = out;
  if (iv === '4h') {   // 4H candles from the hours: 00/04/08… UTC
    candles = [];
    for (const k of out) {
      const t = Math.floor(k[0] / STEP['4h']) * STEP['4h'], b = candles[candles.length - 1];
      if (b && b[0] === t) { b[2] = Math.max(b[2], k[2]); b[3] = Math.min(b[3], k[3]); b[4] = k[4]; } else candles.push([t, k[1], k[2], k[3], k[4], 0]);
    }
  }
  candles = candles.filter(k => k[0] >= start && k[0] <= end);
  if (live) fxCache.set(key, { at: now, from: start, candles });
  return candles;
}

const iso = d => (d ? new Date(d).getTime() : null);

// Answers every /api/sim/* request (the caller has already checked the dashboard key).
async function handle(url, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  try {
    if (url.pathname === '/api/sim/klines') {
      const sym = cleanSymbol(url.searchParams.get('symbol'));
      const iv = url.searchParams.get('interval') || '1m';
      if (!sym) return send(400, { error: 'symbol required' });
      if (!STEP[iv]) return send(400, { error: 'interval must be 1m, 5m, 15m, 1h or 4h' });
      const now = Date.now();
      const end = Math.min(Number(url.searchParams.get('end')) || now, now);
      let start = Number(url.searchParams.get('start')) || end - 300 * STEP[iv];
      if (end - start > MAX_CANDLES * STEP[iv]) start = end - MAX_CANDLES * STEP[iv];
      const want = String(url.searchParams.get('exchange') || 'auto').toLowerCase();
      const fx = fxPair(url.searchParams.get('symbol'));
      if (fx) {   // currency pair → Yahoo (whatever exchange the menu says)
        try {
          let candles = await fxKlines(fx, iv, start, end), closed = false;
          // weekend: a chart load (it sends an end; the 4 s update doesn't) shows the last session, not an empty chart
          if (!candles.length && url.searchParams.has('end') && now - end < 120e3 && end - start >= 6 * 3600e3) {
            const back = await fxKlines(fx, iv, Math.max(end - 4 * 86400e3, start - 4 * 86400e3), start);
            if (back.length) { const L = back[back.length - 1][0]; candles = back.filter(k => k[0] > L - (end - start)); closed = true; }
          }
          return send(200, { exchange: 'fx', symbol: fx, interval: iv, candles, closed, source: 'Yahoo Finance' });
        } catch (e) {
          return send(404, { error: `No ${fx} forex candles from Yahoo: ${e.message}` });
        }
      }
      if (want === 'fx') return send(404, { error: `${sym.replace(/USDT$/, '')} is not a forex pair` });
      // 'bybit-first' is for the simulator's many-coin scan: it keeps the Binance request budget for the live bot
      const order = want === 'bybit' ? ['bybit'] : want === 'binance' ? ['binance'] : want === 'bybit-first' ? ['bybit', 'binance'] : ['binance', 'bybit'];
      const errors = [];
      let emptyAt = null;
      for (const ex of order) {
        try {
          const candles = ex === 'binance' ? await binanceKlines(sym, iv, start, end) : await bybitKlines(sym, iv, start, end);
          if (candles.length) return send(200, { exchange: ex, symbol: sym, interval: iv, candles });
          errors.push(`${ex}: no candles`); if (!emptyAt) emptyAt = ex;
        } catch (e) {
          errors.push(`${ex}: ${e.message}`);
        }
      }
      // a live poll asks from the newest candle on; right at a new minute the exchange can briefly return nothing — that is "no news", not an error
      if (emptyAt && now - start <= 3 * STEP[iv]) return send(200, { exchange: emptyAt, symbol: sym, interval: iv, candles: [] });
      return send(404, { error: `No ${sym} perpetual candles for that time (${errors.join('; ')})` });
    }

    if (url.pathname === '/api/sim/signals') {
      const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 14));
      const r = await db.query(
        `SELECT id, symbol, direction, score, pump_pct, funding_rate, price, created_at
           FROM pump_signals WHERE created_at > NOW() - INTERVAL '1 day' * $1 ORDER BY created_at DESC LIMIT 300`, [days]);
      return send(200, {
        signals: r.rows.map(s => ({ id: s.id, symbol: s.symbol, direction: s.direction, score: s.score, pumpPct: s.pump_pct,
          funding: s.funding_rate, price: s.price, t: iso(s.created_at) })),
      });
    }

    if (url.pathname === '/api/sim/coins') {   // every coin we have traded live, newest first (for the setup scan)
      const r = await db.query(
        `SELECT symbol, (ARRAY_AGG(exchange ORDER BY created_at DESC))[1] AS exchange, COUNT(*)::int AS n, MAX(created_at) AS last
           FROM trades WHERE mode = 'live' GROUP BY symbol ORDER BY MAX(created_at) DESC LIMIT 400`);
      return send(200, { coins: r.rows.map(c => ({ symbol: c.symbol, exchange: c.exchange, trades: c.n, t: iso(c.last) })) });
    }

    if (url.pathname === '/api/sim/trades') {
      const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get('days'), 10) || 14));
      const r = await db.query(
        `SELECT id, symbol, exchange, direction, entry_price, exit_price, original_stop_loss, pnl_usd, close_reason, status, created_at, closed_at
           FROM trades WHERE mode = 'live' AND created_at > NOW() - INTERVAL '1 day' * $1 ORDER BY id DESC LIMIT 200`, [days]);
      return send(200, {
        trades: r.rows.map(t => ({ id: t.id, symbol: t.symbol, exchange: t.exchange, direction: t.direction, entry: t.entry_price,
          exit: t.exit_price, stop: t.original_stop_loss, pnl: t.pnl_usd, reason: t.close_reason, status: t.status,
          t: iso(t.created_at), t1: iso(t.closed_at) })),
      });
    }

    return send(404, { error: 'unknown simulator endpoint' });
  } catch (e) {
    return send(500, { error: e.message });
  }
}

module.exports = { handle, cleanSymbol };
