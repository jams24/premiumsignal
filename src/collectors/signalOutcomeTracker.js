const logger = require('../utils/logger');
const db = require('../db/database');

// Measures each spot/pump signal's real outcome from 5m exchange candles over the 24h after it fired:
// exact price at 1h/4h/12h/24h, best/worst move, and (when the signal has levels) which of TP1/TP2/SL hit first.
// Every run recomputes from the candles, so missed runs or restarts can't corrupt results.

const H = 3600000;
const CANDLE_MS = 5 * 60000;
const CHECKPOINTS = [1, 4, 12, 24];
const NO_DATA_AFTER_H = 30;

const round = (v, dp = 3) => (v == null || !isFinite(v) ? null : Number(v.toFixed(dp)));
const directionalPct = (direction, entry, price) =>
  (direction === 'short' ? (entry - price) / entry : (price - entry) / entry) * 100;

// Pure: turns a signal plus its post-signal candles into the DB fields to store.
// Candles must start strictly after the signal so a pre-signal wick can't count.
function evaluateSignal(sig, candles, now = Date.now()) {
  const t0 = new Date(sig.created_at).getTime();
  const entry = Number(sig.price);
  const dir = sig.direction;
  const window = candles.filter(c => c[0] >= t0 && c[0] < t0 + 24 * H);
  const fields = {};
  if (!window.length || !(entry > 0)) {
    if (now - t0 > NO_DATA_AFTER_H * H) fields.outcome = 'no_data';
    return fields;
  }

  for (const h of CHECKPOINTS) {
    const mark = t0 + h * H;
    if (now < mark) continue;
    const closed = window.filter(c => c[0] + CANDLE_MS <= mark);
    const last = closed[closed.length - 1];
    // Only record when we have a candle closing within 10 min of the checkpoint
    if (!last || last[0] + CANDLE_MS < mark - 10 * 60000) continue;
    fields[`price_${h}h`] = last[4];
    fields[`pnl_${h}h`] = round(directionalPct(dir, entry, last[4]), 2);
  }

  let maxGain = -Infinity;
  let maxGainAt = 0;
  let maxDrawdown = Infinity;
  let drawdownBeforePeak = Infinity;
  for (const c of window) {
    const fav = directionalPct(dir, entry, dir === 'short' ? c[3] : c[2]);
    const adv = directionalPct(dir, entry, dir === 'short' ? c[2] : c[3]);
    if (adv < maxDrawdown) maxDrawdown = adv;
    if (fav > maxGain) {
      maxGain = fav;
      maxGainAt = (c[0] + CANDLE_MS - t0) / H;
      drawdownBeforePeak = maxDrawdown;
    }
  }
  fields.max_gain_pct = round(maxGain, 2);
  fields.max_gain_hours = round(maxGainAt, 2);
  fields.max_drawdown_pct = round(maxDrawdown, 2);
  fields.drawdown_before_peak_pct = round(drawdownBeforePeak, 2);

  // First-touch on the signal's own levels; a candle touching both TP and SL counts as SL (conservative)
  if (sig.tp1 && sig.stop_loss) {
    const tp1 = directionalPct(dir, entry, Number(sig.tp1));
    const tp2 = sig.tp2 ? directionalPct(dir, entry, Number(sig.tp2)) : null;
    const sl = directionalPct(dir, entry, Number(sig.stop_loss));
    let result = 'none';
    let at = null;
    for (const c of window) {
      const fav = directionalPct(dir, entry, dir === 'short' ? c[3] : c[2]);
      const adv = directionalPct(dir, entry, dir === 'short' ? c[2] : c[3]);
      const hours = (c[0] + CANDLE_MS - t0) / H;
      if (adv <= sl) { result = result === 'tp1' ? 'tp1_then_sl' : 'sl'; at = hours; break; }
      if (tp2 != null && fav >= tp2) { result = 'tp2'; at = hours; break; }
      if (result === 'none' && fav >= tp1) { result = 'tp1'; at = hours; }
    }
    fields.tp_sl_result = result;
    fields.tp_sl_hours = round(at, 2);
  }

  if (fields.pnl_24h != null) fields.outcome = fields.pnl_24h > 0 ? 'win' : 'loss';
  else if (now - t0 > NO_DATA_AFTER_H * H) fields.outcome = 'no_data';
  return fields;
}

async function fetchPostSignalCandles(exchanges, sig) {
  const pair = `${sig.symbol}/USDT:USDT`;
  const order = [sig.exchange, 'binance', 'bybit', ...Object.keys(exchanges)]
    .filter((id, i, a) => id && exchanges[id] && a.indexOf(id) === i);
  const t0 = new Date(sig.created_at).getTime();
  // First candle that starts after the signal; 300 × 5m covers the full 24h
  const since = Math.ceil(t0 / CANDLE_MS) * CANDLE_MS;
  for (const id of order) {
    const ex = exchanges[id];
    if (!ex.markets?.[pair]) continue;
    try {
      const candles = await ex.fetchOHLCV(pair, '5m', since, 300);
      if (candles?.length) return { candles, exchangeId: id };
    } catch (e) {
      logger.debug(`Signal outcome tracker: ${id} candles failed for ${sig.symbol}: ${e.message}`);
    }
  }
  return { candles: [], exchangeId: null };
}

async function trackTable(table, exchanges) {
  const signals = await db.getSignalsToTrack(table);
  let updated = 0;
  let finished = 0;
  for (const sig of signals) {
    try {
      const { candles, exchangeId } = await fetchPostSignalCandles(exchanges, sig);
      const fields = evaluateSignal(sig, candles);
      if (!Object.keys(fields).length) continue;
      fields.tracking_exchange = exchangeId;
      fields.tracked_at = new Date();
      await db.saveSignalTracking(table, sig.id, fields);
      updated++;
      if (fields.outcome) finished++;
    } catch (e) {
      logger.warn(`Signal outcome tracker: ${table} #${sig.id} ${sig.symbol} failed: ${e.message}`);
    }
  }
  return { pending: signals.length, updated, finished };
}

async function trackSignalOutcomes(exchanges) {
  for (const table of ['spot_signals', 'pump_signals']) {
    const r = await trackTable(table, exchanges);
    if (r.pending) logger.info(`Signal outcome tracker ${table}: ${r.updated}/${r.pending} updated, ${r.finished} finalised`);
  }
}

module.exports = { trackSignalOutcomes, evaluateSignal };
