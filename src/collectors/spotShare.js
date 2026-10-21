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

// Korean share of a pump: Upbit + Bithumb spot volume (KRW → USD at Upbit's KRW-USDT price) as a % of USDT-perp
// volume on Binance + Bybit + OKX over the last hour. Backtest of the live-rule shorts ($150): Korean share ≥ 8% at
// entry earned $4.38/trade vs $1.51 (Jun–Oct 2026) and $4.62 vs $0.68 on unseen Dec 2025 – May 2026, but 1–21 Oct
// 2026 went the other way. Info only: shown on signals and recorded with each signal/trade for review, never traded on.
const KOREA_GROUP_PCT = 8;

// Upbit / Bithumb 5m candles (newest first) → [[openTime, krwVolume, price]] | 'none' (not listed) | null (couldn't tell)
async function koreaVolume(host, market) {
  try {
    const j = await getJson(`https://${host}/v1/candles/minutes/5?market=${encodeURIComponent(market)}&count=${CANDLES + 2}`);
    if (Array.isArray(j)) return j.map(c => [Date.parse(`${c.candle_date_time_utc}Z`), +c.candle_acc_trade_price, +c.trade_price]);
    return String(j?.error?.name) === '404' ? 'none' : null;
  } catch (e) { return null; }
}

async function okxSwapVolume(base) {
  try {
    const j = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${encodeURIComponent(base)}-USDT-SWAP&bar=5m&limit=${CANDLES + 2}`);
    if (j?.code === '0') return j.data?.length ? j.data.map(c => [+c[0], +c[7]]) : 'none';
    return j?.code === '51001' ? 'none' : null;   // 51001 = instrument doesn't exist
  } catch (e) { return null; }
}

// Sum of the last hour's closed 5m candles by time, for venues that skip candles with no trades
const hourByTime = (series, now) => {
  const open = Math.floor(now / M5) * M5;   // the forming candle
  return series.filter(c => c[0] >= open - CANDLES * M5 && c[0] < open).reduce((sum, c) => sum + c[1], 0);
};

// → { listed, pct, krUsd, perpUsd } — listed false with pct 0 when neither Upbit nor Bithumb has a KRW market.
// → null when any venue couldn't be read (a missing perp venue would overstate the share).
async function measureKoreaShare(symbol, now = Date.now()) {
  const id = `${symbol}USDT`;
  const base = symbol.replace(/^(1000000|10000|1000|1M)(?=[A-Z])/, '');
  const [bnPerp, byPerp, okxPerp, upbit, bithumb, usdt] = await Promise.all([
    binanceVolume('https://fapi.binance.com/fapi/v1/klines', id),
    bybitVolume('linear', id),
    okxSwapVolume(base),
    koreaVolume('api.upbit.com', `KRW-${base}`),
    koreaVolume('api.bithumb.com', `KRW-${base}`),
    koreaVolume('api.upbit.com', 'KRW-USDT'),
  ]);
  const venues = [bnPerp, byPerp, okxPerp, upbit, bithumb];
  if (venues.includes(null)) {
    logger.warn(`Korean share ${symbol}: a venue couldn't be read`);
    return null;
  }
  const perpUsd = [bnPerp, byPerp, okxPerp].filter(Array.isArray).reduce((sum, s) => sum + hourByTime(s, now), 0);
  if (!(perpUsd > 0)) return null;
  if (upbit === 'none' && bithumb === 'none') return { listed: false, pct: 0, krUsd: 0, perpUsd };
  const rate = Array.isArray(usdt) ? usdt[0]?.[2] : null;
  if (!(rate > 0)) return null;
  const krUsd = [upbit, bithumb].filter(Array.isArray).reduce((sum, s) => sum + hourByTime(s, now), 0) / rate;
  return { listed: true, pct: (krUsd / perpUsd) * 100, krUsd, perpUsd };
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

// BTC % change over the last `hours` (Binance USDT perp, last closed 1h candle) → number | null. Cached 5 min.
let btcCache = null;
async function measureBtcChange(hours = 168) {
  if (btcCache && btcCache.hours === hours && Date.now() - btcCache.at < 5 * 60000) return btcCache.value;
  try {
    const k = await getJson(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=${hours + 2}`);
    if (!Array.isArray(k) || k.length < hours + 2) return null;
    const closed = k.slice(0, -1);                      // drop the forming candle
    const now = +closed.at(-1)[4], then = +closed.at(-1 - hours)[4];
    if (!(now > 0 && then > 0)) return null;
    const value = (now / then - 1) * 100;
    btcCache = { hours, at: Date.now(), value };
    return value;
  } catch (e) { return null; }
}

module.exports = { measureSpotShare, measureKoreaShare, spotVerdict, measureAltMarket, measureBtcChange, DEFAULT_MAX_SPOT_SHARE, HOT_ALT_MARKET_PCT, KOREA_GROUP_PCT };
