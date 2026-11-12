// Read-only data for the dashboard's Trade Simulator tab: exchange candles (public endpoints), recent pump signals
// and our own live trades to replay. It never places, changes or cancels orders.
const db = require('../db/database');

const STEP = { '1m': 60e3, '5m': 300e3, '15m': 900e3, '1h': 3600e3, '4h': 14400e3 };
const BYBIT_IV = { '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240' };
const MAX_CANDLES = 3000;

function cleanSymbol(s) {
  s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
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
    const j = await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${iv}&startTime=${t}&endTime=${end}&limit=1500`);
    if (!Array.isArray(j) || !j.length) break;
    for (const k of j) out.push([k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
    if (j.length < 1500) break;
    t = j[j.length - 1][0] + STEP[iv];
  }
  return out;
}

async function bybitKlines(sym, iv, start, end) {
  const out = [];
  for (let t = start; t < end && out.length < MAX_CANDLES;) {
    const e = Math.min(end, t + 999 * STEP[iv]);
    const j = await getJson(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${sym}&interval=${BYBIT_IV[iv]}&start=${t}&end=${e}&limit=1000`);
    if (j.retCode) throw new Error(j.retMsg || `Bybit error ${j.retCode}`);
    const list = (j.result?.list || []).map(k => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]).reverse();
    for (const k of list) if (!out.length || k[0] > out[out.length - 1][0]) out.push(k);
    t = list.length ? list[list.length - 1][0] + STEP[iv] : e + STEP[iv];
  }
  return out;
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
      const order = want === 'bybit' ? ['bybit'] : want === 'binance' ? ['binance'] : ['binance', 'bybit'];
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
