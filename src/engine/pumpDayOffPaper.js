const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');
const { PumpSwitchPaper, SWITCH } = require('./pumpSwitchPaper');

// PAPER record of the real trades a 📅 day off skipped (/autopump → Trading days): 🔥 pump shorts at their ✅ ENTER and
// 🔀 switch trades at their signal, each at the live price with the real trade's size, TPs, −8% stop (→ entry at TP1),
// tighter stop and 48h limit — the switch lab's engine on its own table. Only trades that passed every other rule are
// recorded, so the totals show what the day off saved or cost. No orders, no channel post, not in max open or the
// daily loss stop.
class PumpDayOffPaper extends PumpSwitchPaper {
  constructor({ exchanges, tell }) {
    super({ exchanges, tell, table: 'pump_dayoff_paper', name: 'Day-off lab', icon: '📅' });
  }

  // info: { signalId, symbol, exchangeId, price }; what: { kind: 'exhaust' | 'switch', side, day: 'Tue' };
  // plan: { position, tp1, beAt, beStop }
  async record(info, what, plan) {
    if (info.signalId == null) return { skipped: 'no signal id' };
    const ex = this.exchanges[info.exchangeId] || this.exchanges.binance;
    if (!ex || !(plan.position > 0)) return { skipped: 'no exchange/size' };
    const tk = await ex.fetchTicker(`${info.symbol}/USDT:USDT`).catch(() => null);
    const E = tk?.last > 0 ? tk.last : null;
    if (!E) return { skipped: 'no live price' };
    const { kind, side, day } = what;
    const { rows } = await db.query(
      `INSERT INTO ${this.table} (signal_id, kind, day, symbol, exchange, side, entry_price, entry_at, position_usd, signal_price,
         stop_pct, tp1_pct, be_at_pct, be_stop_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13) ON CONFLICT (signal_id) DO NOTHING RETURNING id`,
      [info.signalId, kind, day, info.symbol, info.exchangeId, side, E, plan.position, info.price ?? null,
        -SWITCH.slPct, plan.tp1, plan.beAt || 0, plan.beStop ?? 5]
    );
    if (!rows.length) return { skipped: 'already recorded' };
    const p = (v) => Number(v).toPrecision(6), S = side === 'short';
    const tps = [plan.tp1, ...SWITCH.tpRest];
    const what1 = kind === 'switch' ? `🔀 switch ${side}s` : '🔥 pump shorts';
    await this.tell(
      `📅 <b>DAY-OFF LAB ${side.toUpperCase()} — ${escapeHtml(info.symbol)}</b> (${kind === 'switch' ? 'switch' : 'pump short'})\n` +
      `<i>Paper only: ${day} (UTC) is a day off for ${what1}, so no real order. Tracked like the real trade to show what the day off saves or costs.</i>\n\n` +
      `${info.price ? `${kind === 'switch' ? 'Signal' : 'ENTER'} $${p(info.price)} → ` : ''}${S ? 'sold' : 'bought'} $${p(E)} · $${Number(plan.position).toFixed(0)} paper\n` +
      `🎯 ${tps.map(t => `${S ? '−' : '+'}${t}% $${p(E * (1 + (S ? -t : t) / 100))}`).join(' · ')}\n` +
      `🛑 ${S ? '+' : '−'}${SWITCH.slPct}% $${p(E * (1 + (S ? SWITCH.slPct : -SWITCH.slPct) / 100))} → entry after TP1 · closes after 48h\n` +
      `<i>Change days in /autopump → 📅 Trading days.</i>`
    ).catch(() => {});
    logger.info(`Day-off lab ${kind} ${side} opened: ${info.symbol} @ ${E} (signal ${info.signalId}, ${day} off)`);
    return { opened: rows[0].id, side };
  }

  // Closed / open counts and P&L per kind (pump shorts, switch trades)
  async stats() {
    const { rows } = await db.query(`SELECT status, kind, pnl_usd, realized_pct, entry_at FROM ${this.table}`);
    const closed = rows.filter(r => r.status === 'closed');
    const by = (kind) => {
      const all = rows.filter(r => r.kind === kind), v = closed.filter(r => r.kind === kind);
      return {
        n: v.length, open: all.length - v.length,
        wins: v.filter(r => Number(r.pnl_usd) > 0).length,
        stops: v.filter(r => Number(r.realized_pct) <= -7.5).length,
        pnl: v.reduce((s, r) => s + Number(r.pnl_usd || 0), 0),
      };
    };
    const first = rows.reduce((m, r) => Math.min(m, new Date(r.entry_at).getTime()), Infinity);
    return {
      closed: closed.length,
      wins: closed.filter(r => Number(r.pnl_usd) > 0).length,
      pnl: closed.reduce((s, r) => s + Number(r.pnl_usd || 0), 0),
      open: rows.length - closed.length,
      first: isFinite(first) ? first : null,
      exhaust: by('exhaust'),
      switch: by('switch'),
    };
  }

  summaryLine(s) {
    const m = (v) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;
    return `Day-off lab so far: ${s.closed} closed · ${s.wins} won · <b>${m(s.pnl)}</b> ` +
      `(🔥 pump shorts ${s.exhaust.n}: ${m(s.exhaust.pnl)} · 🔀 switch ${s.switch.n}: ${m(s.switch.pnl)}) · ${s.open} open\n` +
      `<i>Above zero = the day off cost you that much; below zero = it saved it.</i>`;
  }
}

module.exports = { PumpDayOffPaper };
