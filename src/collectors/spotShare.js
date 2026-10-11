const logger = require('../utils/logger');

// Spot share of a pump: spot quote volume as a % of USDT-perp quote volume over the last hour (12 closed 5m
// candles), Binance + Bybit combined. 30-day replay of the pump-exhaustion detector (Sep 12 – Oct 10 2026,
// 424 trades, $75 each): no spot market or share ≤ 10% → 104W/66L +$198; share > 10% → 117W/137L −$210.
// Held on the unseen last third, in 5 of 6 time blocks and across pump size / volume / OI buckets.
// Spot-led pumps are real demand and keep running; futures-only pumps are leverage and unwind.

const M5 = 5 * 60000;
const CANDLES = 12;
const DEFAULT_MAX_SPOT_SHARE = 13;
// Median 24h move of all USDT perps above this = hot alt market; shorts did worse there (info only)
const HOT_ALT_MARKET_PCT = 0.85;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  return res.json();
}

// → [[openTime, quoteVolume]] | 'none' (market doesn't exist) | null (couldn't tell)
async function binanceVolume(base, id) {
  try {
    const j = await getJson(`${base}?symbol=${encodeURIComponent(id)}&interval=5m&limit=${CANDLES + 2}`);
    if (Array.isArray(j)) return j.length ? j.map(k => [+k[0], +k[7]]) : 'none';
    return j?.code === -1121 ? 'none' : null;   // -1121 = invalid symbol
  } catch (e) { return null; }
}

async function bybitVolume(category, id) {
  try {
    const j = await getJson(`https://api.bybit.com/v5/market/kline?category=${category}&symbol=${encodeURIComponent(id)}&interval=5&limit=${CANDLES + 2}`);
    if (j?.retCode === 0) {
      const list = j.result?.list || [];
      return list.length ? list.map(k => [+k[0], +k[6]]) : 'none';
    }
    return j?.retCode === 10001 ? 'none' : null;  // 10001 = symbol not supported
  } catch (e) { return null; }
}

const lastHour = (series, now) => series
  .filter(c => c[0] + M5 <= now)
  .sort((a, b) => a[0] - b[0])
  .slice(-CANDLES)
  .reduce((sum, c) => sum + c[1], 0);

// → { hasSpot, pct, spotUsd, perpUsd } — pct is null when there is no spot market on either exchange.
// → null when it could not be measured (API down); callers treat that as unknown, not as "no spot".
async function measureSpotShare(symbol, now = Date.now()) {
  const id = `${symbol}USDT`;
  const [bnSpot, bnPerp, bySpot, byPerp] = await Promise.all([
    binanceVolume('https://api.binance.com/api/v3/klines', id),
    binanceVolume('https://fapi.binance.com/fapi/v1/klines', id),
    bybitVolume('spot', id),
    bybitVolume('linear', id),
  ]);
  const perps = [bnPerp, byPerp].filter(Array.isArray);
  const spots = [bnSpot, bySpot].filter(Array.isArray);
  const perpUsd = perps.reduce((sum, s) => sum + lastHour(s, now), 0);
  if (!perps.length || !(perpUsd > 0)) {
    logger.warn(`Spot share ${symbol}: no futures volume readable`);
    return null;
  }
  if (!spots.length) {
    // Only "no spot market" when both exchanges positively said so
    if (bnSpot === 'none' && bySpot === 'none') return { hasSpot: false, pct: null, spotUsd: 0, perpUsd };
    logger.warn(`Spot share ${symbol}: spot volume unreadable`);
    return null;
  }
  const spotUsd = spots.reduce((sum, s) => sum + lastHour(s, now), 0);
  return { hasSpot: true, pct: (spotUsd / perpUsd) * 100, spotUsd, perpUsd };
}

// 'ok' | 'spot_led' | 'unknown' against a max share (0 = rule off)
function spotVerdict(spot, maxPct = DEFAULT_MAX_SPOT_SHARE) {
  if (!(maxPct > 0)) return 'ok';
  if (!spot) return 'unknown';
  if (!spot.hasSpot) return 'ok';
  return spot.pct > maxPct ? 'spot_led' : 'ok';
}

// Median 24h change of all Binance USDT perps (info line on signals) → number | null
async function measureAltMarket() {
  try {
    const j = await getJson('https://fapi.binance.com/fapi/v1/ticker/24hr');
    if (!Array.isArray(j)) return null;
    const moves = j.filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume > 0).map(t => +t.priceChangePercent).sort((a, b) => a - b);
    return moves.length > 50 ? moves[Math.floor(moves.length / 2)] : null;
  } catch (e) { return null; }
}

module.exports = { measureSpotShare, spotVerdict, measureAltMarket, DEFAULT_MAX_SPOT_SHARE, HOT_ALT_MARKET_PCT };
