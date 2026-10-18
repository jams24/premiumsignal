const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');
const { PUMP_RULES, channelLevels, runType } = require('../collectors/pumpSignalCheck');
const { marginSaverLeverage, liquidationPct } = require('../utils/marginSaver');
const { measureSpotShare, spotVerdict, measureBtcChange, DEFAULT_MAX_SPOT_SHARE } = require('../collectors/spotShare');

// Auto-trades pump-exhaustion shorts when the channel says ✅ ENTER (at signal time or from the
// follow-up watcher). Size comes from the owner's /trade panel settings; levels and exits follow the
// channel plan. Off and paper by default; live must be switched on explicitly.

const PLAN_TP_PCTS = [...PUMP_RULES.tpPcts, 30];
// TP1 choices for auto-trades. 219-trade replay ($150): 7% +$464 / 83 full stop-outs, 6% +$509 / 73, 5% +$500 / 62,
// 4% +$264 (SL reaches entry too early and bounces close the rest).
const AUTO_TP1_PCTS = [7, 6];
// BTC 7-day pause choices (pause when BTC's last 7 days are below −N%; 0 = off). 4.5-month replay (Jun–Oct, 961 trades,
// $150): no pause +$468; pause at −2% +$769 on 665 trades — the idea came from Sep–Oct and held on Jun–Aug.
const AUTO_BTC_PAUSE_PCTS = [2, 3, 5, 0];
const DEFAULTS = {
  enabled: false,
  mode: 'paper',
  ownerId: null,       // admin whose /trade panel settings are used and who receives notifications
  maxOpen: 2,
  dailyLossUsd: 60,    // stop opening new auto trades after this realised loss today (UTC); 0 = no limit
  halfOnFresh: true,
  maxSpotSharePct: DEFAULT_MAX_SPOT_SHARE, // skip spot-led pumps (spot volume above this % of futures volume); 0 = off
  tp1Pct: PLAN_TP_PCTS[0],
  btcPausePct: 2,      // pause new auto trades while BTC's 7-day change is below −btcPausePct %; 0 = off
  // Skip coins with no spot market on Binance or Bybit. 4.5-month replay: no-spot shorts −$135 on 514 (only Sep
  // positive, −$212 when BTC 7d < −2%); spot share ≤ 13% with a spot market +$603 on 447, positive every month.
  skipNoSpot: false,
  // PAPER-only long on no-spot coins already up ≥ runnerMinRun7d % in 7 days at ENTER (see engine/pumpRunnerPaper.js)
  runnerLongs: true,
  runnerMinRun7d: 20,
};

class PumpAutoTrader {
  constructor({ executor, notify, adminIds = [], measureSpot = measureSpotShare, measureBtc = measureBtcChange, runner = null }) {
    this.executor = executor;       // onchain TradeExecutor (same engine as manual trades)
    this.runner = runner;           // PumpRunnerPaper — paper longs on no-spot runners, never real orders
    this.notify = notify;           // async (chatId, html) => void
    this.measureSpot = measureSpot; // async (symbol) => spot share, used when the caller didn't measure it
    this.measureBtc = measureBtc;   // async (hours) => BTC % change
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
    const result = await this.enterShort(info);
    await this.runnerLong(info);
    return result;
  }

  // Paper runner long — after the short so it never delays it, and nothing here can affect the short
  async runnerLong(info) {
    if (!this.runner) return null;
    try {
      const c = this.config;
      if (c.runnerLongs === false || !(info.run7d >= (c.runnerMinRun7d ?? 20))) return null;
      if (info.spot === undefined) info.spot = await this.measureSpot(info.symbol).catch(() => null);
      // Always full panel size (never "half on fresh") so every test trade is comparable
      const size = await this.sizing(PUMP_RULES.extendedRunPct).catch(() => null);
      return await this.runner.maybeOpen(info, c, size?.position || 150);
    } catch (e) {
      logger.warn(`Paper runner long ${info.symbol} failed: ${e.message}`);
      return null;
    }
  }

  async enterShort(info) {
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
    // Only a real conflict blocks: a live position, or an auto/manual trade on the coin. The onchain scanner's own
    // paper trades share this executor but are separate rows with no exchange order (ERA 18 Oct was missed this way).
    // A live entry still checks the exchange for an existing position before ordering.
    const clash = open.find(t => t.symbol === info.symbol && (t.mode === 'live' || t.onchain_context?.manual === true));
    if (clash) return `Already have an open ${info.symbol} ${clash.mode} position.`;
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

    // Falling BTC: pump shorts lost money (June crash), squeezes keep running
    if (c.btcPausePct > 0) {
      const btc7d = await this.measureBtc(168).catch(() => null);
      if (btc7d == null) return `BTC 7-day change could not be measured, so the BTC pause can't be checked — skipped to be safe.`;
      info.btc7d = btc7d;
      if (btc7d < -c.btcPausePct) return `BTC pause: BTC is ${btc7d.toFixed(1)}% over 7 days (pause below −${c.btcPausePct}%, change it in /autopump).`;
    }

    // Spot-led pumps (real spot buying behind the move) kept running in the 30-day replay — skip them
    if (c.maxSpotSharePct > 0) {
      if (info.spot === undefined) info.spot = await this.measureSpot(info.symbol).catch(() => null);
      const verdict = spotVerdict(info.spot, c.maxSpotSharePct);
      if (verdict === 'spot_led') return `Spot-led pump: spot share ${info.spot.pct.toFixed(1)}% is above your ${c.maxSpotSharePct}% limit (change it in /autopump).`;
      if (verdict === 'unknown') return `Spot share could not be measured, so the ${c.maxSpotSharePct}% spot-share rule can't be checked — skipped to be safe.`;
    }
    if (c.skipNoSpot) {
      if (info.spot === undefined) info.spot = await this.measureSpot(info.symbol).catch(() => null);
      if (!info.spot) return `Spot market could not be checked, so the no-spot rule can't be applied — skipped to be safe.`;
      if (!info.spot.hasSpot) return `No spot market on Binance or Bybit — no-spot coins are set to skip (change it in /autopump).`;
    }
    return null;
  }

  // Targets for auto-trades: the plan with the chosen TP1 (anything not on the list falls back to the plan)
  tpPcts() {
    const tp1 = AUTO_TP1_PCTS.includes(this.config.tp1Pct) ? this.config.tp1Pct : PLAN_TP_PCTS[0];
    return [tp1, ...PLAN_TP_PCTS.slice(1)];
  }

  async open(info) {
    const c = this.config, te = this.executor;
    const size = await this.sizing(info.run7d);
    const entry = info.price;
    const L = channelLevels(entry);
    const tpPcts = this.tpPcts();
    const tps = tpPcts.map(p => entry * (1 - p / 100));
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
      `🎯 TP1 $${p(tps[0])} (−${tpPcts[0]}%) · TP2 $${p(tps[1])} · TP3 $${p(tps[2])} · TP4 $${p(tps[3])}\n` +
      `🛑 SL $${p(L.stopLoss)} (+${PUMP_RULES.slPct}%) → max loss ≈ -$${(pos * PUMP_RULES.slPct / 100).toFixed(2)}\n` +
      `${c.maxSpotSharePct > 0 && info.spot ? `🧪 Spot share: ${info.spot.hasSpot ? `${info.spot.pct.toFixed(1)}%` : 'no spot market'} (limit ${c.maxSpotSharePct}%)\n` : ''}` +
      `${info.btc7d != null ? `₿ BTC 7d: ${info.btc7d >= 0 ? '+' : ''}${info.btc7d.toFixed(1)}% (pause below −${c.btcPausePct}%)\n` : ''}` +
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

module.exports = { PumpAutoTrader, PLAN_TP_PCTS, AUTO_TP1_PCTS, AUTO_BTC_PAUSE_PCTS };
