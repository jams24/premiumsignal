const { scoreCisd } = require('./onchainScanner');

// Entry rules for the pump-exhaustion channel, from the Oct 5–8 signal review (21 signals):
// - OI still rising >30% in the last hour → never a clean dump (squeezed first or ran away)
// - signal within ~15 min of the 24h high → mostly squeezed first; top 15m+ old → no squeezes
// - 1H CISD >= 1 → 7/8 won vs 2/7 with CISD 0 (8% SL / 10% TP replay)
// - clean dumps went at most ~7% against entry first → 8% SL, so use ≤5x
const PUMP_RULES = {
  maxOi1h: 30,
  minTopAgeMin: 15,
  minCisd: 1,
  slPct: 8,
  tpPcts: [10, 15, 25],
  maxLeverage: 5,
  followUpMin: 20,
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

async function currentCisd(exchange, symbol) {
  return scoreCisd(await exchange.fetchOHLCV(`${symbol}/USDT:USDT`, '1h', undefined, 20));
}

// 'oi_building' | 'top_fresh' | 'enter' | 'no_cisd' (topAgeMin null = unknown → treated as fresh)
function entryVerdict({ oi1h, topAgeMin, cisdScore }) {
  if ((oi1h ?? 0) > PUMP_RULES.maxOi1h) return 'oi_building';
  if (topAgeMin == null || topAgeMin < PUMP_RULES.minTopAgeMin) return 'top_fresh';
  if ((cisdScore ?? 0) >= PUMP_RULES.minCisd) return 'enter';
  return 'no_cisd';
}

module.exports = { PUMP_RULES, channelLevels, measureTop, currentCisd, entryVerdict };
