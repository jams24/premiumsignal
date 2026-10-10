const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');
const { PUMP_RULES, channelLevels, runType } = require('../collectors/pumpSignalCheck');
const { marginSaverLeverage, liquidationPct } = require('../utils/marginSaver');

// Auto-trades pump-exhaustion shorts when the channel says ✅ ENTER (at signal time or from the
// follow-up watcher). Size comes from the owner's /trade panel settings; levels and exits follow the
// channel plan. Off and paper by default; live must be switched on explicitly.

const PLAN_TP_PCTS = [...PUMP_RULES.tpPcts, 30];
const DEFAULTS = {
  enabled: false,
  mode: 'paper',
  ownerId: null,       // admin whose /trade panel settings are used and who receives notifications
  maxOpen: 2,
  dailyLossUsd: 60,    // stop opening new auto trades after this realised loss today (UTC); 0 = no limit
  halfOnFresh: true,
};

class PumpAutoTrader {
  constructor({ executor, notify, adminIds = [] }) {
    this.executor = executor;       // onchain TradeExecutor (same engine as manual trades)
    this.notify = notify;           // async (chatId, html) => void
    this.adminIds = adminIds;       // told about ENTERs missed while auto-trade is off and no owner is set
    this.config = { ...DEFAULTS };
    this.busy = new Set();          // signal ids being processed
    this.dailyStopNotified = null;  // UTC date we already warned about the daily stop
  }

  async load() {
    const saved = await db.getPumpAutoConfig().catch(() => null);
    this.config = { ...DEFAULTS, ...(saved || {}) };
    return this.config;
  }

  // Merge only `changes` into the DB row, then adopt the stored result — never writes back stale keys
  async update(changes) {
    const merged = await db.mergePumpAutoConfig(changes, DEFAULTS);
    this.config = { ...DEFAULTS, ...(merged || { ...this.config, ...changes }) };
    return this.config;
  }

  // Size the owner would trade: panel margin × leverage, leverage capped so the plan SL fits before liquidation
  async sizing(run7d, ownerId = this.config.ownerId) {
    const prefs = (ownerId && await db.getManualPrefs(ownerId).catch(() => null)) || {};
    const te = this.executor;
    const panelMargin = prefs.margin || te.maxPositionSize || 12;
    const panelLev = prefs.leverage || te.defaultLeverage || 3;
    const leverage = Math.min(panelLev, PUMP_RULES.maxLeverage);
    const fresh = runType(run7d) === 'fresh';
    const margin = this.config.halfOnFresh && fresh ? Math.round((panelMargin / 2) * 100) / 100 : panelMargin;
    // Margin saver (panel setting, default on): same position, exchange leverage raised as far as the plan SL allows
    const marginSaver = prefs.marginSaver !== false;
    const exchangeLev = marginSaver ? marginSaverLeverage(PUMP_RULES.slPct, { chosen: leverage }) : leverage;
    const position = margin * leverage;
    return { panelMargin, panelLev, margin, leverage, position, fresh, levCapped: leverage < panelLev, marginSaver, exchangeLev, locked: position / exchangeLev };
  }

  async stats() {
    const source = this.executor.settingsKey;
    const { rows } = await db.query(
      `SELECT status, pnl_usd, realized_pnl, closed_at, symbol FROM trades
       WHERE source = $1 AND onchain_context->>'autoPump' = 'true'`,
      [source]
    );
    const today = new Date().toISOString().slice(0, 10);
    const closed = rows.filter(r => r.status === 'closed');
    const closedToday = closed.filter(r => r.closed_at && new Date(r.closed_at).toISOString().slice(0, 10) === today);
    const pnl = (list) => list.reduce((s, r) => s + parseFloat(r.pnl_usd || 0), 0);
    return {
      open: rows.filter(r => r.status === 'open'),
      todayCount: closedToday.length,
      todayPnl: pnl(closedToday),
      allCount: closed.length,
      allWins: closed.filter(r => parseFloat(r.pnl_usd || 0) > 0).length,
      allPnl: pnl(closed),
    };
  }

  // Called when a pump signal reaches ✅ ENTER. info: { signalId, symbol, exchangeId, price, run7d, via }
  async onEnter(info) {
    // Always decide on the stored config, not this process's memory (another instance or a restart may have changed it)
    await this.load().catch(e => logger.warn(`Auto-trade config reload failed, using memory: ${e.message}`));
    const c = this.config;
    if (!c.enabled) {
      logger.info(`Pump auto-trade OFF — ${info.symbol} ENTER (${info.via}) not traded`);
      const to = c.ownerId ? [c.ownerId] : this.adminIds;
      const html = `🤖 ⚠️ <b>${escapeHtml(info.symbol)} said ✅ ENTER — NOT auto-traded</b>\n` +
        `Auto-trade is <b>OFF</b>. Send /autopump → ✅ Turn ON` +
        `${c.mode === 'live' ? ' → ✅ Yes, confirm (LIVE needs the confirm tap)' : ''}.`;
      for (const id of to) await this.notify(id, html).catch(e => logger.warn(`Auto-trade notify failed: ${e.message}`));
      return { skipped: 'disabled' };
    }
    const key = info.signalId ?? `${info.symbol}:${new Date().toISOString().slice(0, 10)}`;
    if (this.busy.has(key)) return { skipped: 'in progress' };
    this.busy.add(key);
    try {
      const block = await this.blockReason(info);
      if (block) {
        const reason = typeof block === 'string' ? block : block.reason;
        if (!block.silent) await this.tell(`🤖 <b>Auto-trade skipped — ${escapeHtml(info.symbol)}</b>\n${escapeHtml(reason)}`);
        return { skipped: reason };
      }
      return await this.open(info);
    } catch (e) {
      logger.error(`Pump auto-trade ${info.symbol} failed: ${e.message}`);
      await this.tell(`🤖 ⚠️ <b>Auto-trade failed — ${escapeHtml(info.symbol)}</b>\n${escapeHtml(e.message)}`);
      return { error: e.message };
    } finally {
      this.busy.delete(key);
    }
  }

  async blockReason(info) {
    const c = this.config, te = this.executor;
    if (!c.ownerId) return 'No owner set — turn auto-trade on from /autopump.';
    const ex = te.exchanges[info.exchangeId];
    if (!ex?.markets?.[`${info.symbol}/USDT:USDT`]) return `${info.exchangeId} has no ${info.symbol}/USDT perpetual.`;
    if (c.mode === 'live' && (!ex.apiKey || !ex.secret)) return `LIVE mode but no API keys for ${info.exchangeId} — not falling back to paper.`;

    const open = await db.getOpenTrades(te.settingsKey);
    if (open.some(t => t.symbol === info.symbol)) return `Already have an open ${info.symbol} position.`;
    if (info.signalId != null) {
      const { rows } = await db.query(
        `SELECT 1 FROM trades WHERE source = $1 AND onchain_context->>'pumpSignalId' = $2 LIMIT 1`,
        [te.settingsKey, String(info.signalId)]
      );
      if (rows.length) return 'This signal was already auto-traded.';
    }
    const autoOpen = open.filter(t => t.onchain_context?.autoPump === true).length;
    if (autoOpen >= c.maxOpen) return `Max open auto trades reached (${autoOpen}/${c.maxOpen}).`;

    if (c.dailyLossUsd > 0) {
      const s = await this.stats();
      if (s.todayPnl <= -c.dailyLossUsd) {
        const today = new Date().toISOString().slice(0, 10);
        // Announce the daily stop once; later skips that day stay silent
        if (this.dailyStopNotified === today) return { reason: 'Daily loss stop already hit.', silent: true };
        this.dailyStopNotified = today;
        return `Daily loss stop hit: $${s.todayPnl.toFixed(2)} today (limit -$${c.dailyLossUsd}). No more auto trades until 00:00 UTC.`;
      }
    }
    const size = await this.sizing(info.run7d);
    if (!(size.margin >= 1)) return `Margin $${size.margin} is below the $1 minimum.`;
    return null;
  }

  async open(info) {
    const c = this.config, te = this.executor;
    const size = await this.sizing(info.run7d);
    const entry = info.price;
    const L = channelLevels(entry);
    const tps = PLAN_TP_PCTS.map(p => entry * (1 - p / 100));
    const trade = await te.openManualTrade({
      symbol: info.symbol, exchangeId: info.exchangeId, direction: 'short', mode: c.mode,
      entryPrice: entry, positionSize: size.position, leverage: size.leverage, marginSaver: size.marginSaver,
      tp1: tps[0], tp2: tps[1], tp3: tps[2], tp4: tps[3], stopLoss: L.stopLoss, atr: null,
      context: { margin: size.margin, exitStyle: 'tponly', autoPump: true, pumpSignalId: info.signalId ?? null, run7d: info.run7d ?? null, via: info.via },
    });
    if (!trade) {
      await this.tell(`🤖 ⚠️ <b>Auto-trade NOT placed — ${escapeHtml(info.symbol)}</b>\nThe executor skipped it (existing exchange position, minimum size, liquidity or price drift). Check the bot notification for the reason.`);
      return { skipped: 'executor declined' };
    }
    const p = (v) => Number(v).toPrecision(6);
    const fill = trade.entryPrice || entry;
    const lev = trade.leverage || size.leverage;
    const pos = trade.positionSize || size.position;
    await this.tell(
      `🤖 <b>AUTO-TRADE OPENED — ${escapeHtml(info.symbol)} SHORT</b>\n` +
      `${c.mode === 'live' ? '💰 LIVE' : '📝 PAPER'} · ${info.exchangeId.toUpperCase()} · from ${info.via === 'follow-up' ? 'follow-up ✅ ENTER' : 'signal ✅ ENTER'}\n\n` +
      `💰 Entry: <b>$${p(fill)}</b>\n` +
      `💵 $${size.margin} × ${size.leverage}x = <b>$${pos.toFixed(2)}</b> position${size.fresh && c.halfOnFresh ? ' · 🟠 half size (fresh breakout)' : ''}${size.levCapped ? ` · leverage capped ${size.panelLev}x → ${size.leverage}x` : ''}\n` +
      `🏦 Exchange: <b>${lev}x</b> → locks <b>$${(pos / lev).toFixed(2)}</b>${lev > size.leverage ? ` (margin saver · liq ≈ ${liquidationPct(lev).toFixed(1)}%)` : ''}\n` +
      `🎯 TP1 $${p(tps[0])} · TP2 $${p(tps[1])} · TP3 $${p(tps[2])} · TP4 $${p(tps[3])}\n` +
      `🛑 SL $${p(L.stopLoss)} (+${PUMP_RULES.slPct}%) → max loss ≈ -$${(pos * PUMP_RULES.slPct / 100).toFixed(2)}\n` +
      `🛡️ Exit: TPs only · manage or close in /mpositions`
    );
    logger.info(`Pump auto-trade opened: ${info.symbol} ${c.mode} $${size.margin} × ${lev}x via ${info.via}`);
    return { opened: trade };
  }

  async tell(html) {
    if (!this.config.ownerId) return;
    try { await this.notify(this.config.ownerId, html); } catch (e) { logger.warn(`Auto-trade notify failed: ${e.message}`); }
  }
}

module.exports = { PumpAutoTrader, PLAN_TP_PCTS };
