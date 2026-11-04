const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');

// Channel trade updates: once a pump channel post says "enter" (the ✅ ENTER reply of an exhaust short, or a posted
// switch long/short, which enters at the signal), this follows the levels the CHANNEL showed — not the bot's own trade,
// which can be skipped, sized differently or closed by hand — and replies under that message on each step:
// TP hit, stop hit, back to entry after TP1, all targets hit, 48h limit. Plan: stop moves to entry at TP1 (the bot's
// own rule), stop checked before targets inside a candle, closed 1m candles from the minute after entry (as the
// switch lab). State lives on pump_signals.channel_track, so a redeploy resumes it. Nothing here places orders.
const M = 60000, H = 60 * M;
const MAX_HOLD_MS = 48 * H;       // the executor's max trade age
const GIVE_UP_MS = MAX_HOLD_MS + 2 * H; // no candles at all by then (delisted / renamed) → end without a reply

// Walk closed 1m candles [t, o, h, l, c] through one tracked trade → { state, events }
function stepTrack(s, candles) {
  const st = { ...s }, events = [];
  const S = st.side === 'short';
  let last = st.lastClose ?? st.entry;
  const first = Math.floor(st.entryAt / M) * M + M; // the entry minute itself is partly before the entry
  for (const [t, , hi, lo, cl] of candles) {
    if (st.status !== 'open') break;
    if (t < first || (st.lastCandle != null && t <= st.lastCandle)) continue;
    if (t >= st.entryAt + MAX_HOLD_MS) {
      st.status = 'done'; st.outcome = 'time';
      events.push({ type: 'time', price: last, t });
      break;
    }
    st.lastCandle = t;
    if (S ? hi >= st.stop : lo <= st.stop) {
      st.status = 'done'; st.outcome = st.hit ? 'entry' : 'stop';
      events.push({ type: st.outcome, price: st.stop, t });
      break;
    }
    while (st.hit < st.tps.length && (S ? lo <= st.tps[st.hit] : hi >= st.tps[st.hit])) {
      st.hit++;
      events.push({ type: 'tp', n: st.hit, price: st.tps[st.hit - 1], t });
      if (st.hit === 1) st.stop = st.entry;
    }
    last = cl;
    if (st.hit >= st.tps.length) { st.status = 'done'; st.outcome = 'tp_all'; }
  }
  st.lastClose = last;
  return { state: st, events };
}

const p = (v) => Number(v).toPrecision(6);
// Price change from entry, signed like the posts (short TP −7%, short stop +8%)
function chg(st, price) {
  const v = (price / st.entry - 1) * 100;
  return `${v >= 0 ? '+' : '−'}${Number(Math.abs(v).toFixed(1))}%`;
}
function took(ms) {
  const m = Math.max(1, Math.round(ms / M));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const tpList = (n) => Array.from({ length: n }, (_, i) => `TP${i + 1} ✅`).join(' ');

// One reply for the events of a single check (several TPs in one candle → one message)
function formatEvents(st, events) {
  const head = `${escapeHtml(st.symbol)} ${st.side.toUpperCase()}`;
  const end = events[events.length - 1];
  const after = `${took(end.t + M - st.entryAt)} after entry`;
  const tps = events.filter(e => e.type === 'tp');
  const top = tps.length ? tps[tps.length - 1].n : 0;
  if (end.type === 'stop') {
    return `🛑 <b>${head} — STOPPED OUT</b> (${chg(st, end.price)})\nStop $${p(end.price)} hit ${after}, before TP1.`;
  }
  if (end.type === 'entry') {
    return `⚖️ <b>${head} — CLOSED AT ENTRY</b>\n${tpList(st.hit)} then price came back to entry $${p(st.entry)} ${after}.\n` +
      `TP profit kept · no loss on the rest.`;
  }
  if (end.type === 'time') {
    return `⌛ <b>${head} — 48H UP, CLOSE THE REST</b>\nPrice $${p(end.price)} (${chg(st, end.price)} from entry) · ` +
      `${st.hit ? tpList(st.hit) : 'no TP hit'} · tracking ended.`;
  }
  // TP event(s)
  const names = tps.map(e => `TP${e.n}`).join(' + ');
  if (st.outcome === 'tp_all') {
    return `🏆 <b>${head} — ALL ${st.tps.length} TARGETS HIT ✅</b>\n${names} $${p(st.tps[top - 1])} (${chg(st, st.tps[top - 1])}) reached ${after} · trade complete.`;
  }
  let msg = `🎯 <b>${head} — ${names} HIT ✅</b> (${chg(st, st.tps[top - 1])})\n$${p(st.tps[top - 1])} reached ${after}.`;
  if (tps.some(e => e.n === 1)) msg += `\n🛡️ Move the stop to entry ($${p(st.entry)}) — the rest of the trade is risk-free now.`;
  msg += `\nNext: TP${top + 1} $${p(st.tps[top])} (${chg(st, st.tps[top])}) · stop at entry`;
  return msg;
}

class PumpChannelTracker {
  // reply: async (replyToMessageId, html) => message id | null (posts in the pump channel)
  constructor({ exchanges, reply }) {
    this.exchanges = exchanges;
    this.reply = reply;
    this.tracks = new Map(); // pump_signals.id → state
    this.checking = false;
  }

  async restore() {
    const rows = await db.getOpenChannelTracks(72);
    for (const r of rows) this.tracks.set(r.id, r.channel_track);
    if (rows.length) logger.info(`Restored ${rows.length} channel trade tracker(s): ${rows.map(r => r.symbol).join(', ')}`);
  }

  // Start following a posted entry. levels: { tps: [...], stopLoss } as shown in the channel; replyTo = the message
  // that told subscribers to enter. Needs a pump_signals row to keep the state.
  async start(signalId, { symbol, exchangeId, side, entry, tps, stopLoss, replyTo }, now = Date.now()) {
    if (signalId == null || !replyTo || !(entry > 0) || !(stopLoss > 0) || !tps?.length) return null;
    const st = {
      status: 'open', symbol, exchangeId, side, entry, entryAt: now, tps: tps.map(Number), stopLoss, stop: stopLoss,
      hit: 0, lastCandle: null, replyTo,
    };
    this.tracks.set(signalId, st);
    await db.saveChannelTrack(signalId, st).catch(e => logger.warn(`Saving channel tracker ${symbol} failed: ${e.message}`));
    logger.info(`Channel tracker started: ${symbol} ${side} @ ${entry} (signal ${signalId}, reply to ${replyTo})`);
    return st;
  }

  // Every minute
  async check(now = Date.now()) {
    if (this.checking || !this.tracks.size) return;
    this.checking = true;
    try {
      for (const [id, st] of [...this.tracks]) {
        try { await this.checkOne(id, st, now); } catch (e) { logger.warn(`Channel tracker ${st.symbol} failed: ${e.message}`); }
      }
    } finally { this.checking = false; }
  }

  async checkOne(id, st, now) {
    const ex = this.exchanges[st.exchangeId];
    const giveUp = async (outcome) => {
      this.tracks.delete(id);
      await db.saveChannelTrack(id, { ...st, status: 'done', outcome });
      logger.info(`Channel tracker ${st.symbol}: ended without a reply (${outcome})`);
    };
    if (!ex) return giveUp('no_exchange');
    let since = st.lastCandle != null ? st.lastCandle + M : Math.floor(st.entryAt / M) * M + M;
    const candles = [];
    for (let i = 0; i < 5 && since + M <= now; i++) {
      const batch = await ex.fetchOHLCV(`${st.symbol}/USDT:USDT`, '1m', since, 1000);
      const done = (batch || []).filter(c => c[0] >= since && c[0] + M <= now);
      if (!done.length) break;
      candles.push(...done);
      since = done[done.length - 1][0] + M;
      if (batch.length < 1000) break;
    }
    if (!candles.length) {
      if (now > st.entryAt + GIVE_UP_MS) await giveUp('no_data');
      return;
    }
    const { state, events } = stepTrack(st, candles);
    if (state.status === 'open') this.tracks.set(id, state); else this.tracks.delete(id);
    // Saved before replying: a crash mid-send loses one reply rather than repeating it after a restart
    await db.saveChannelTrack(id, state);
    if (!events.length) return;
    // A stop/exit after TPs in the same check: the TP reply first, then the exit
    const tpEvents = events.filter(e => e.type === 'tp');
    const exit = events.find(e => e.type !== 'tp');
    const groups = exit && tpEvents.length ? [tpEvents, [exit]] : [events];
    for (const g of groups) {
      const view = g === tpEvents && exit ? { ...state, outcome: null } : state;
      await this.reply(state.replyTo, formatEvents(view, g));
    }
    logger.info(`Channel tracker ${state.symbol} ${state.side}: ${events.map(e => e.type === 'tp' ? `TP${e.n}` : e.type).join(', ')}${state.status === 'done' ? ` → done (${state.outcome})` : ''}`);
  }
}

module.exports = { PumpChannelTracker, stepTrack, formatEvents, MAX_HOLD_MS };
