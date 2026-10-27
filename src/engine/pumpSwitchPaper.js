const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');

// PAPER test: the "7-day run switch" on no-spot pump coins, bought/sold at the live price the moment the signal goes out.
// 7-day run on CLOSED 1h candles (the replay's way):  12–50% → LONG · 50–shortTo% (80 or 100) → SHORT · else skip.
// Replay with the live bot's ~15–20 min delay ($150, stop −8%, fees in), long 12–50 / short 50–100:
// Jun–Oct +$488 (t 2.5), Dec–May +$591 (t 2.4), 8 of 11 months positive; short 25–50% lost in both (t −2.5) and the
// current runner long was ≈ $0 at that delay. Zones were picked after a wide search → expect less. The live way of
// measuring the run (forming candle included) reads higher and flips coins between zones (Q 57% vs 80%), so this lab
// measures closed candles only. Own table, never through a TradeExecutor: no orders, no channel post, no effect on the
// short, scanner slots, daily P&L or the max-open count.

const SWITCH = {
  longFrom: 12,
  shortFrom: 50,
  shortTos: [100, 80],               // /autopump choice (switchShortTo); default 100
  tpRest: [12, 20, 30],              // TP2–TP4; TP1 = the long's / short's TP1 choice in /autopump
  closeFracs: [0.25, 0.5, 0.5, 1],   // share of what is left, closed at each TP (executor's TP1/TP2 close sizes)
  slPct: 8,
  maxHoldMs: 48 * 3600000,
  feePct: 0.1,
};
const M = 60000, H = 3600000;

// % run over the last 168 closed 1h candles: close of the last closed hour vs open 167 hours before it
async function measureRun7dClosed(exchange, symbol, now = Date.now()) {
  const c = await exchange.fetchOHLCV(`${symbol}/USDT:USDT`, '1h', now - 200 * H, 200);
  const done = (c || []).filter(k => k[0] + H <= now);
  if (done.length < 168 || !(done[done.length - 168][1] > 0)) return null;
  return (done[done.length - 1][4] / done[done.length - 168][1] - 1) * 100;
}

// 'long' | 'short' | null for a 7-day run (closed candles)
function switchSide(run7d, shortTo = SWITCH.shortTos[0]) {
  if (run7d == null || !isFinite(run7d)) return null;
  if (run7d >= SWITCH.longFrom && run7d < SWITCH.shortFrom) return 'long';
  if (run7d >= SWITCH.shortFrom && run7d < shortTo) return 'short';
  return null;
}

// Apply closed 1m candles [ts, o, h, l, c] to a paper trade (either side). Same order as the replay: stop first, then
// TPs (stop → entry at TP1), then the tighter stop (best move before TP1 ≥ beAt → stop −beStop) from the next candle.
function stepSwitch(state, candles, rules = SWITCH) {
  const st = { ...state };
  const events = [];
  const S = st.side === 'short';
  const fav = (c) => S ? (1 - c[3] / st.entry) * 100 : (c[2] / st.entry - 1) * 100;
  const adv = (c) => S ? (1 - c[2] / st.entry) * 100 : (c[3] / st.entry - 1) * 100;
  const at = (pct) => st.entry * (1 + (S ? -pct : pct) / 100);
  let closed = null;
  for (const c of candles) {
    if (st.rem <= 1e-9) break;
    st.lastCandle = c[0];
    if (adv(c) <= st.stopPct) {
      st.realizedPct += st.rem * st.stopPct;
      st.rem = 0;
      closed = { reason: st.stopPct < 0 ? 'stop' : 'entry', price: at(st.stopPct) };
      break;
    }
    const up = fav(c);
    while (st.hit < 4 && up >= st.tpPcts[st.hit]) {
      const q = st.hit === 3 ? st.rem : st.rem * rules.closeFracs[st.hit];
      st.realizedPct += q * st.tpPcts[st.hit];
      st.rem -= q;
      st.hit++;
      events.push(`TP${st.hit} ${S ? '−' : '+'}${st.tpPcts[st.hit - 1]}%`);
      if (st.hit === 1) st.stopPct = Math.max(st.stopPct, 0);
    }
    if (st.rem <= 1e-9) { closed = { reason: 'tp4', price: at(st.tpPcts[3]) }; break; }
    if (st.entryAt != null && c[0] + M - st.entryAt >= rules.maxHoldMs) {
      const move = S ? (1 - c[4] / st.entry) * 100 : (c[4] / st.entry - 1) * 100;
      st.realizedPct += st.rem * move;
      st.rem = 0;
      closed = { reason: 'time', price: c[4] };
      break;
    }
    st.bestPct = Math.max(st.bestPct, up);
    if (st.beAt > 0 && !st.hit && st.bestPct >= st.beAt && st.stopPct < -st.beStop) {
      st.stopPct = -st.beStop;
      events.push(`stop → −${st.beStop}%`);
    }
  }
  return { state: st, events, closed };
}

const pnlUsd = (realizedPct, position, rules = SWITCH) => (realizedPct / 100) * position - position * rules.feePct / 100;
const rowTps = (r) => [Number(r.tp1_pct) > 0 ? Number(r.tp1_pct) : 5, ...SWITCH.tpRest];

class PumpSwitchPaper {
  constructor({ exchanges, tell }) {
    this.exchanges = exchanges;   // ccxt instances by id (public candles only)
    this.tell = tell;             // async (html) => void — owner DM
    this.table = 'pump_switch_paper';
    this.checking = false;
  }

  // info: { signalId, symbol, exchangeId, price (scanner's signal price), run7d (bot's live way), run7dClosed?, spot }
  // plan: { position, longTp1, shortTp1, beAt, beStop, shortTo }
  async maybeOpen(info, plan) {
    if (info.signalId == null) return { skipped: 'no signal id' };
    if (!info.spot || info.spot.hasSpot !== false) return { skipped: info.spot ? 'has spot market' : 'spot unknown' };
    const ex = this.exchanges[info.exchangeId] || this.exchanges.binance;
    if (!ex || !(plan.position > 0)) return { skipped: 'no exchange/size' };
    // The signal already measured it (and picked the channel side from it); measure only if called without it
    const run7d = info.run7dClosed !== undefined ? info.run7dClosed : await measureRun7dClosed(ex, info.symbol).catch(() => null);
    const side = switchSide(run7d, plan.shortTo);
    if (!side) {
      logger.info(`Switch lab skip: ${info.symbol} 7d ${run7d == null ? 'unknown' : run7d.toFixed(0) + '%'} (closed candles)`);
      return { skipped: `7d run ${run7d == null ? 'unknown' : run7d.toFixed(0) + '%'} outside the zones` };
    }
    const tk = await ex.fetchTicker(`${info.symbol}/USDT:USDT`).catch(() => null);
    const E = tk?.last > 0 ? tk.last : null;
    if (!E) return { skipped: 'no live price' };
    const tp1 = side === 'long' ? plan.longTp1 : plan.shortTp1;
    const { rows } = await db.query(
      `INSERT INTO ${this.table} (signal_id, symbol, exchange, side, entry_price, entry_at, position_usd, run7d, run7d_live, signal_price,
         stop_pct, tp1_pct, be_at_pct, be_stop_pct)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (signal_id) DO NOTHING RETURNING id`,
      [info.signalId, info.symbol, info.exchangeId, side, E, plan.position, run7d, info.run7d ?? null, info.price,
        -SWITCH.slPct, tp1, plan.beAt || 0, plan.beStop ?? 5]
    );
    if (!rows.length) return { skipped: 'already opened for this signal' };
    const p = (v) => Number(v).toPrecision(6);
    const tps = [tp1, ...SWITCH.tpRest];
    const S = side === 'short';
    await this.tell(
      `🔀 <b>SWITCH LAB ${side.toUpperCase()} — ${escapeHtml(info.symbol)}</b>\n` +
      `<i>Test only, no real order. No spot market · 7-day run <b>+${run7d.toFixed(0)}%</b> (closed candles${info.run7d != null ? `; bot's live reading +${info.run7d.toFixed(0)}%` : ''}) → ` +
      `${S ? `${SWITCH.shortFrom}–${plan.shortTo}% zone = SHORT` : `${SWITCH.longFrom}–${SWITCH.shortFrom}% zone = LONG`}.</i>\n\n` +
      `Signal $${p(info.price)} → ${S ? 'sold' : 'bought'} $${p(E)} · $${plan.position.toFixed(0)} paper\n` +
      `🎯 ${tps.map(t => `${S ? '−' : '+'}${t}% $${p(E * (1 + (S ? -t : t) / 100))}`).join(' · ')}\n` +
      `🛑 ${S ? '+' : '−'}${SWITCH.slPct}% $${p(E * (1 + (S ? SWITCH.slPct : -SWITCH.slPct) / 100))} → entry after TP1 · closes after 48h`
    ).catch(() => {});
    logger.info(`Switch lab ${side} opened: ${info.symbol} @ ${E} (signal ${info.signalId}, 7d closed ${run7d.toFixed(1)}%, live ${info.run7d ?? '?'})`);
    return { opened: rows[0].id, side };
  }

  // Every minute: replay new closed 1m candles on each open paper trade
  async check(now = Date.now()) {
    if (this.checking) return;
    this.checking = true;
    try {
      const { rows } = await db.query(`SELECT * FROM ${this.table} WHERE status = 'open' ORDER BY id`);
      for (const r of rows) {
        try { await this.checkOne(r, now); } catch (e) { logger.warn(`Switch lab ${r.symbol} check failed: ${e.message}`); }
      }
    } finally { this.checking = false; }
  }

  async checkOne(r, now) {
    const ex = this.exchanges[r.exchange] || this.exchanges.binance;
    if (!ex) return;
    const entryAt = new Date(r.entry_at).getTime();
    // first candle = the minute after entry (as in the replay); only fully closed candles
    let since = r.last_candle != null ? Number(r.last_candle) + M : Math.floor(entryAt / M) * M + M;
    const candles = [];
    for (let i = 0; i < 5 && since + M <= now; i++) {
      const batch = await ex.fetchOHLCV(`${r.symbol}/USDT:USDT`, '1m', since, 1000);
      const done = (batch || []).filter(c => c[0] >= since && c[0] + M <= now);
      if (!done.length) break;
      candles.push(...done);
      since = done[done.length - 1][0] + M;
      if (batch.length < 1000) break;
    }
    if (!candles.length) return;

    const before = {
      side: r.side, entry: Number(r.entry_price), entryAt, hit: r.hit, rem: Number(r.rem), realizedPct: Number(r.realized_pct),
      stopPct: Number(r.stop_pct), bestPct: r.best_pct == null ? -Infinity : Number(r.best_pct), lastCandle: r.last_candle,
      tpPcts: rowTps(r), beAt: Number(r.be_at_pct) || 0, beStop: Number(r.be_stop_pct ?? 5),
    };
    const { state, closed } = stepSwitch(before, candles);
    const best = isFinite(state.bestPct) ? state.bestPct : null;
    if (closed) {
      const pos = Number(r.position_usd);
      const pnl = pnlUsd(state.realizedPct, pos);
      await db.query(
        `UPDATE ${this.table} SET status = 'closed', hit = $2, rem = 0, realized_pct = $3, stop_pct = $4, best_pct = $5, last_candle = $6,
           close_reason = $7, exit_price = $8, pnl_usd = $9, closed_at = NOW() WHERE id = $1`,
        [r.id, state.hit, state.realizedPct, state.stopPct, best, state.lastCandle, closed.reason, closed.price, pnl]
      );
      const s = await this.stats().catch(() => null);
      const why = { stop: `stopped ${r.side === 'short' ? '+' : '−'}${SWITCH.slPct}%`, entry: state.hit ? 'TP1, rest closed at entry' : 'tighter stop hit',
        tp4: 'all targets hit', time: '48h limit, closed at market' }[closed.reason];
      await this.tell(
        `🔀 <b>Switch lab ${r.side.toUpperCase()} closed — ${escapeHtml(r.symbol)}</b>\n` +
        `${why} · <b>${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}</b> on $${pos.toFixed(0)} paper` +
        (s ? `\nSwitch lab so far: ${s.closed} closed · ${s.wins} won · <b>${s.pnl >= 0 ? '+' : '-'}$${Math.abs(s.pnl).toFixed(2)}</b> ` +
          `(long ${s.long.n}: ${s.long.pnl >= 0 ? '+' : '-'}$${Math.abs(s.long.pnl).toFixed(2)} · short ${s.short.n}: ${s.short.pnl >= 0 ? '+' : '-'}$${Math.abs(s.short.pnl).toFixed(2)}) · ${s.open} open` : '')
      ).catch(() => {});
      logger.info(`Switch lab ${r.side} closed: ${r.symbol} ${closed.reason} ${pnl.toFixed(2)}`);
      return;
    }
    await db.query(
      `UPDATE ${this.table} SET hit = $2, rem = $3, realized_pct = $4, stop_pct = $5, best_pct = $6, last_candle = $7 WHERE id = $1`,
      [r.id, state.hit, state.rem, state.realizedPct, state.stopPct, best, state.lastCandle]
    );
  }

  async price(r) {
    const ex = this.exchanges[r.exchange] || this.exchanges.binance;
    const tk = ex ? await ex.fetchTicker(`${r.symbol}/USDT:USDT`).catch(() => null) : null;
    return tk?.last > 0 ? tk.last : null;
  }

  // Live numbers for one row at `price` (banked part + what is still open), in $
  view(r, price) {
    const entry = Number(r.entry_price), pos = Number(r.position_usd), rem = Number(r.rem), S = r.side === 'short';
    if (r.status !== 'open') return { entry, pos, rem: 0, movePct: null, pnl: Number(r.pnl_usd || 0) };
    const movePct = price ? (S ? (1 - price / entry) : (price / entry - 1)) * 100 : null;
    return { entry, pos, rem, movePct, pnl: pnlUsd(Number(r.realized_pct) + (movePct == null ? 0 : rem * movePct), pos) };
  }

  async stats() {
    const { rows } = await db.query(`SELECT status, side, pnl_usd FROM ${this.table}`);
    const closed = rows.filter(r => r.status === 'closed');
    const by = (side) => { const v = closed.filter(r => r.side === side); return { n: v.length, pnl: v.reduce((s, r) => s + Number(r.pnl_usd || 0), 0) }; };
    return {
      closed: closed.length,
      wins: closed.filter(r => Number(r.pnl_usd) > 0).length,
      pnl: closed.reduce((s, r) => s + Number(r.pnl_usd || 0), 0),
      open: rows.length - closed.length,
      long: by('long'),
      short: by('short'),
    };
  }

  async recent(limit = 15, status = null) {
    const { rows } = status
      ? await db.query(`SELECT * FROM ${this.table} WHERE status = $2 ORDER BY id DESC LIMIT $1`, [limit, status])
      : await db.query(`SELECT * FROM ${this.table} ORDER BY id DESC LIMIT $1`, [limit]);
    return rows;
  }
}

module.exports = { PumpSwitchPaper, stepSwitch, switchSide, measureRun7dClosed, pnlUsd, SWITCH };
