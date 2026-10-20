const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');

// PAPER test: LONG no-spot coins that already ran ≥ +20% over 7 days, at the pump signal's ✅ ENTER.
// 4.5-month replay (Jun–Oct, $150): long +$532 on 271 (65% win) where the short lost −$369, but $487 of it came
// from June; Jul −$124, Aug–Oct ≈ +$170. Live 14–18 Oct: 7 cases, long +$40 vs short −$38. Not proven → paper only.
// Kept in its own table, never through a TradeExecutor: no exchange orders, no effect on scanner slots,
// daily P&L, paper balance or the signal channel. Plan mirrors the short: stop −8%, TP +6/12/20/30, stop to entry at TP1.

const RUNNER = {
  tpPcts: [6, 12, 20, 30],
  closeFracs: [0.25, 0.5, 0.5, 1], // share of what is left, closed at each TP
  slPct: 8,
  maxHoldMs: 48 * 3600000,          // replay horizon: whatever is left closes at market after 48h
  feePct: 0.1,                      // entry + exit taker fees, % of position
};
const M = 60000;

// Apply closed 1m candles [ts, o, h, l, c] to a paper long. Stop is checked before targets inside a candle
// (same pessimistic order as the replay). Returns the new state and what happened.
function stepRunner(state, candles, rules = RUNNER) {
  const st = { ...state };
  const events = [];
  const fav = (p) => (p / st.entry - 1) * 100;
  let lastClose = null;
  let closed = null;
  for (const c of candles) {
    if (st.rem <= 1e-9) break;
    lastClose = c[4];
    st.lastCandle = c[0];
    if (fav(c[3]) <= st.stopPct) {
      st.realizedPct += st.rem * st.stopPct;
      st.rem = 0;
      closed = { reason: st.stopPct < 0 ? 'stop' : 'entry', price: st.entry * (1 + st.stopPct / 100) };
      break;
    }
    const up = fav(c[2]);
    while (st.hit < 4 && up >= rules.tpPcts[st.hit]) {
      const q = st.hit === 3 ? st.rem : st.rem * rules.closeFracs[st.hit];
      st.realizedPct += q * rules.tpPcts[st.hit];
      st.rem -= q;
      st.hit++;
      events.push(`TP${st.hit} +${rules.tpPcts[st.hit - 1]}%`);
      if (st.hit === 1) st.stopPct = 0;
    }
    if (st.rem <= 1e-9) { closed = { reason: 'tp4', price: st.entry * (1 + rules.tpPcts[3] / 100) }; break; }
    if (st.entryAt != null && c[0] + M - st.entryAt >= rules.maxHoldMs) {
      st.realizedPct += st.rem * fav(c[4]);
      st.rem = 0;
      closed = { reason: 'time', price: c[4] };
      break;
    }
  }
  return { state: st, events, closed, lastClose };
}

const pnlUsd = (realizedPct, position, rules = RUNNER) => (realizedPct / 100) * position - position * rules.feePct / 100;

class PumpRunnerPaper {
  constructor({ exchanges, tell }) {
    this.exchanges = exchanges;   // ccxt instances by id (public candles only)
    this.tell = tell;             // async (html) => void — owner DM
    this.checking = false;
  }

  // info: { signalId, symbol, exchangeId, price, run7d, spot }, cfg: auto-trade config, position: $ size
  async maybeOpen(info, cfg, position) {
    if (cfg.runnerLongs === false) return { skipped: 'off' };
    if (info.signalId == null) return { skipped: 'no signal id' };
    const minRun = cfg.runnerMinRun7d ?? 20;
    if (!(info.run7d >= minRun)) return { skipped: `7d run ${info.run7d == null ? 'unknown' : info.run7d.toFixed(0) + '%'} < ${minRun}%` };
    if (!info.spot || info.spot.hasSpot !== false) return { skipped: info.spot ? 'has spot market' : 'spot unknown' };
    if (!(info.price > 0) || !(position > 0)) return { skipped: 'no price/size' };

    const { rows } = await db.query(
      `INSERT INTO pump_runner_paper (signal_id, symbol, exchange, entry_price, entry_at, position_usd, run7d, stop_pct)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7) ON CONFLICT (signal_id) DO NOTHING RETURNING id`,
      [info.signalId, info.symbol, info.exchangeId, info.price, position, info.run7d, -RUNNER.slPct]
    );
    if (!rows.length) return { skipped: 'already opened for this signal' };
    const p = (v) => Number(v).toPrecision(6);
    const E = info.price;
    await this.tell(
      `🧪 <b>PAPER runner LONG — ${escapeHtml(info.symbol)}</b>\n` +
      `<i>Test only, no real order. No spot market and already +${info.run7d.toFixed(0)}% in 7 days, so the short is risky — tracking a long instead.</i>\n\n` +
      `Entry $${p(E)} · $${position.toFixed(0)} paper\n` +
      `🎯 ${RUNNER.tpPcts.map(t => `+${t}% $${p(E * (1 + t / 100))}`).join(' · ')}\n` +
      `🛑 −${RUNNER.slPct}% $${p(E * (1 - RUNNER.slPct / 100))} → entry after TP1 · closes after 48h`
    ).catch(() => {});
    logger.info(`Paper runner long opened: ${info.symbol} @ ${E} (signal ${info.signalId}, 7d +${info.run7d.toFixed(0)}%)`);
    return { opened: rows[0].id };
  }

  // The minute check and manual actions both rewrite the same rows, so they run one at a time
  locked(fn) {
    const run = (this.lock || Promise.resolve()).then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  // Every minute: replay new closed 1m candles on each open paper long
  async check(now = Date.now()) {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.locked(async () => {
        const { rows } = await db.query(`SELECT * FROM pump_runner_paper WHERE status = 'open' ORDER BY id`);
        for (const r of rows) {
          try { await this.checkOne(r, now); } catch (e) { logger.warn(`Paper runner ${r.symbol} check failed: ${e.message}`); }
        }
      });
    } finally { this.checking = false; }
  }

  async get(id) {
    const { rows } = await db.query(`SELECT * FROM pump_runner_paper WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async price(r) {
    const ex = this.exchanges[r.exchange] || this.exchanges.binance;
    const tk = ex ? await ex.fetchTicker(`${r.symbol}/USDT:USDT`).catch(() => null) : null;
    return tk?.last > 0 ? tk.last : null;
  }

  // Live numbers for one row at `price`: banked part + what is still open, in % of the position and in $
  view(r, price) {
    const entry = Number(r.entry_price), pos = Number(r.position_usd), rem = Number(r.rem);
    const realizedPct = Number(r.realized_pct);
    if (r.status !== 'open') return { entry, pos, rem: 0, realizedPct, openPct: 0, pnl: Number(r.pnl_usd || 0), movePct: null };
    const movePct = price ? (price / entry - 1) * 100 : null;
    const openPct = movePct == null ? 0 : rem * movePct;
    return { entry, pos, rem, realizedPct, openPct, movePct, pnl: pnlUsd(realizedPct + openPct, pos) };
  }

  // Manual actions on an open paper long ('close' | 'half' | 'be'). Candles up to now are applied first,
  // so a TP or stop that already happened counts before the hand action.
  async manual(id, action) {
    return this.locked(async () => {
      let r = await this.get(id);
      if (!r || r.status !== 'open') return { error: 'Already closed' };
      await this.checkOne(r, Date.now()).catch(e => logger.warn(`Paper runner ${r.symbol} catch-up failed: ${e.message}`));
      r = await this.get(id);
      if (!r || r.status !== 'open') return { error: 'It closed on its own (TP or stop) just now' };
      const price = await this.price(r);
      if (!price) return { error: 'No live price right now — try again' };
      const entry = Number(r.entry_price), pos = Number(r.position_usd), rem = Number(r.rem);
      const movePct = (price / entry - 1) * 100;

      if (action === 'be') {
        if (!(movePct > 0.3)) return { error: 'Only while the long is in profit (the stop would fire at once)' };
        if (Number(r.stop_pct) >= 0) return { error: 'Stop is already at entry' };
        await db.query(`UPDATE pump_runner_paper SET stop_pct = 0 WHERE id = $1`, [id]);
        return { done: 'Stop moved to entry', price };
      }
      if (action === 'half') {
        const q = rem / 2;
        await db.query(`UPDATE pump_runner_paper SET rem = $2, realized_pct = $3 WHERE id = $1`, [id, rem - q, Number(r.realized_pct) + q * movePct]);
        return { done: `Closed half at $${Number(price).toPrecision(6)} (${movePct >= 0 ? '+' : ''}${movePct.toFixed(2)}%)`, price };
      }
      if (action === 'close') {
        const realizedPct = Number(r.realized_pct) + rem * movePct;
        const pnl = pnlUsd(realizedPct, pos);
        await db.query(
          `UPDATE pump_runner_paper SET status = 'closed', rem = 0, realized_pct = $2, close_reason = 'manual', exit_price = $3,
             pnl_usd = $4, closed_at = NOW() WHERE id = $1`,
          [id, realizedPct, price, pnl]
        );
        logger.info(`Paper runner long closed by hand: ${r.symbol} ${pnl.toFixed(2)}`);
        return { done: `Closed at $${Number(price).toPrecision(6)} · ${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}`, price };
      }
      return { error: 'Unknown action' };
    });
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

    const before = { entry: Number(r.entry_price), entryAt, hit: r.hit, rem: Number(r.rem), realizedPct: Number(r.realized_pct), stopPct: Number(r.stop_pct), lastCandle: r.last_candle };
    const { state, events, closed } = stepRunner(before, candles);
    const pos = Number(r.position_usd);
    if (closed) {
      const pnl = pnlUsd(state.realizedPct, pos);
      await db.query(
        `UPDATE pump_runner_paper SET status = 'closed', hit = $2, rem = 0, realized_pct = $3, stop_pct = $4, last_candle = $5,
           close_reason = $6, exit_price = $7, pnl_usd = $8, closed_at = NOW() WHERE id = $1`,
        [r.id, state.hit, state.realizedPct, state.stopPct, state.lastCandle, closed.reason, closed.price, pnl]
      );
      const s = await this.stats().catch(() => null);
      const why = { stop: `stopped −${RUNNER.slPct}%`, entry: 'rest closed at entry', tp4: 'all targets hit', time: '48h limit, closed at market' }[closed.reason];
      await this.tell(
        `🧪 <b>PAPER runner LONG closed — ${escapeHtml(r.symbol)}</b>\n` +
        `${events.length ? events.join(' · ') + ' · ' : ''}${why}\n` +
        `Result: <b>${pnl >= 0 ? '+' : '-'}$${Math.abs(pnl).toFixed(2)}</b> on $${pos.toFixed(0)} paper` +
        (s ? `\nRunner test so far: ${s.closed} closed · ${s.wins} won · <b>${s.pnl >= 0 ? '+' : '-'}$${Math.abs(s.pnl).toFixed(2)}</b> · ${s.open} open` : '')
      ).catch(() => {});
      logger.info(`Paper runner long closed: ${r.symbol} ${closed.reason} ${pnl.toFixed(2)}`);
      return;
    }
    await db.query(
      `UPDATE pump_runner_paper SET hit = $2, rem = $3, realized_pct = $4, stop_pct = $5, last_candle = $6 WHERE id = $1`,
      [r.id, state.hit, state.rem, state.realizedPct, state.stopPct, state.lastCandle]
    );
    if (events.length) {
      await this.tell(`🧪 Paper runner LONG ${escapeHtml(r.symbol)}: ${events.join(' · ')}${state.hit >= 1 ? ' · stop now at entry' : ''}`).catch(() => {});
    }
  }

  async stats() {
    const { rows } = await db.query(`SELECT status, pnl_usd FROM pump_runner_paper`);
    const closed = rows.filter(r => r.status === 'closed');
    return {
      closed: closed.length,
      wins: closed.filter(r => Number(r.pnl_usd) > 0).length,
      pnl: closed.reduce((s, r) => s + Number(r.pnl_usd || 0), 0),
      open: rows.length - closed.length,
    };
  }

  async recent(limit = 15, status = null) {
    const { rows } = status
      ? await db.query(`SELECT * FROM pump_runner_paper WHERE status = $2 ORDER BY id DESC LIMIT $1`, [limit, status])
      : await db.query(`SELECT * FROM pump_runner_paper ORDER BY id DESC LIMIT $1`, [limit]);
    return rows;
  }
}

module.exports = { PumpRunnerPaper, stepRunner, pnlUsd, RUNNER };
