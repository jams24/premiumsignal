const { scoreCisd } = require('./onchainScanner');

// Entry rules for the pump-exhaustion channel, from the Oct 5–8 signal review (21 signals):
// - OI still rising >30% in the last hour → never a clean dump (squeezed first or ran away)
// - signal within ~15 min of the 24h high → mostly squeezed first; top 15m+ old → no squeezes
// - 1H CISD >= 1 → 7/8 won vs 2/7 with CISD 0 (8% SL / 10% TP replay)
// - clean dumps went at most ~7% against entry first → 8% SL, so use ≤5x
// Follow-ups (replay of 22 signals): watching non-ENTER signals for 2h found more entries than a single
// 20m check; 5/10/20m intervals scored the same. 1H CISD lags fast pumps (RLC 10-08: hour candle still
// green when the top had already held), so follow-ups also accept 15m CISD.
const PUMP_RULES = {
  maxOi1h: 30,
  minTopAgeMin: 15,
  minCisd: 1,
  slPct: 8,
  tpPcts: [10, 15, 25],
  maxLeverage: 5,
  followUpEveryMin: 5,
  followUpMaxMin: 120,
  maxBelowHighPct: 10, // dumped this far from the top before entry → too late
};

const H = 3600000;

// Short levels from an entry price
function channelLevels(entry) {
  return {
    stopLoss: entry * (1 + PUMP_RULES.slPct / 100),
    tps: PUMP_RULES.tpPcts.map(p => entry * (1 - p / 100)),
  };
}

// 24h high and how long ago it printed, from 5m candles
async function measureTop(exchange, symbol, now = Date.now()) {
  const candles = await exchange.fetchOHLCV(`${symbol}/USDT:USDT`, '5m', now - 24 * H, 300);
  let high = -Infinity;
  let highAt = now;
  for (const c of candles) if (c[2] >= high) { high = c[2]; highAt = c[0]; }
  if (!isFinite(high)) return null;
  // A 5m candle's high could be anywhere inside it; count from its close so age is never overstated
  return { high24: high, topAgeMin: Math.max(0, (now - (highAt + 5 * 60000)) / 60000) };
}

// Best of 1H and 15m CISD (the faster timeframe confirms reversals the hour candle hasn't shown yet)
async function currentCisd(exchange, symbol) {
  const pair = `${symbol}/USDT:USDT`;
  const [h1, m15] = await Promise.all([
    exchange.fetchOHLCV(pair, '1h', undefined, 20).then(scoreCisd),
    exchange.fetchOHLCV(pair, '15m', undefined, 20).then(scoreCisd).catch(() => ({ score: 0, flags: [] })),
  ]);
  const best = m15.score > h1.score ? { ...m15, tf: '15m' } : { ...h1, tf: '1H' };
  return { ...best, h1, m15 };
}

// OI change over the last hour from 5m open-interest history (same field at both ends)
async function currentOi1h(exchange, symbol, now = Date.now()) {
  if (!exchange.has?.fetchOpenInterestHistory) return null;
  const hist = await exchange.fetchOpenInterestHistory(`${symbol}/USDT:USDT`, '5m', now - 75 * 60000, 20);
  const last = hist?.[hist.length - 1];
  const base = last && hist.filter(h => h.timestamp <= last.timestamp - H).pop();
  if (!base) return null;
  const key = last.openInterestValue && base.openInterestValue ? 'openInterestValue' : 'openInterestAmount';
  return base[key] ? ((last[key] - base[key]) / base[key]) * 100 : null;
}

// 'oi_building' | 'top_fresh' | 'enter' | 'no_cisd' (topAgeMin null = unknown → treated as fresh)
function entryVerdict({ oi1h, topAgeMin, cisdScore }) {
  if ((oi1h ?? 0) > PUMP_RULES.maxOi1h) return 'oi_building';
  if (topAgeMin == null || topAgeMin < PUMP_RULES.minTopAgeMin) return 'top_fresh';
  if ((cisdScore ?? 0) >= PUMP_RULES.minCisd) return 'enter';
  return 'no_cisd';
}

// One follow-up step for a watched signal → kind: 'enter' | 'missed' | 'new_high' | 'waiting'
async function followUpCheck(exchange, watch, now = Date.now()) {
  const pair = `${watch.symbol}/USDT:USDT`;
  const [top, cisd, oi1h, ticker] = await Promise.all([
    measureTop(exchange, watch.symbol, now),
    currentCisd(exchange, watch.symbol),
    currentOi1h(exchange, watch.symbol, now).catch(() => null),
    exchange.fetchTicker(pair),
  ]);
  const price = ticker.last;
  const r = { price, top, cisd, oi1h, levels: channelLevels(price) };
  if (!top) return { kind: 'waiting', ...r };
  r.belowHigh = ((top.high24 - price) / top.high24) * 100;
  if (r.belowHigh >= PUMP_RULES.maxBelowHighPct) return { kind: 'missed', ...r };
  // OI unknown must not clear a signal that was blocked for OI
  if (oi1h == null && watch.verdict === 'oi_building') return { kind: 'waiting', ...r };
  r.verdict = entryVerdict({ oi1h, topAgeMin: top.topAgeMin, cisdScore: cisd.score });
  if (r.verdict === 'enter') return { kind: 'enter', ...r };
  return { kind: watch.high && top.high24 > watch.high * 1.001 ? 'new_high' : 'waiting', ...r };
}

module.exports = { PUMP_RULES, channelLevels, measureTop, currentCisd, currentOi1h, entryVerdict, followUpCheck };
