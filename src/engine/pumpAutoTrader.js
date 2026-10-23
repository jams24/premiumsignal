const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');
const { PUMP_RULES, channelLevels, runType } = require('../collectors/pumpSignalCheck');
const { marginSaverLeverage, liquidationPct } = require('../utils/marginSaver');
const { isTradFiMarket } = require('../utils/tradfi');
const { measureSpotShare, spotVerdict, measureBtcChange, DEFAULT_MAX_SPOT_SHARE, KOREA_GROUP_PCT } = require('../collectors/spotShare');
const { RUNNER } = require('./pumpRunnerPaper');

// Owner-DM line for the Korean share at entry (info only — size and filters never use it)
function koreaNote(k) {
  if (k === undefined) return '';
  if (!k) return `🇰🇷 Korean volume: n/a\n`;
  if (!k.listed) return `🇰🇷 Korean volume: not listed on Upbit/Bithumb\n`;
  return `🇰🇷 Korean volume: ${k.pct.toFixed(1)}% of futures (${k.pct >= KOREA_GROUP_PCT ? '≥' : '&lt;'} ${KOREA_GROUP_PCT}% group · tracking only, size unchanged)\n`;
}
const koreaPct = (k) => (k ? +k.pct.toFixed(2) : null);

// Owner-DM line for the "buyers still in control" signs at entry (info only — see measureBuyerSigns)
function buyersNote(b) {
  if (b === undefined) return '';
  if (!b) return `🐂 Buyers in control: n/a\n`;
  if (!b.listed) return `🐂 Buyers in control: n/a (not on Binance futures)\n`;
  const sign = (v) => (v >= 0 ? '+' : '−') + Math.abs(v);
  return `🐂 Buyers in control: <b>${b.signs}/3</b> (buy/sell ${b.taker.toFixed(2)} · premium ${sign(+b.premiumPct.toFixed(3))}% · funding ${sign(+b.fundingPct.toFixed(4))}%` +
    `${b.signs === 3 ? ' · 3/3 lost in both backtests' : ''} · tracking only, size unchanged)\n`;
}
const buyersData = (b) => (b?.listed ? { signs: b.signs, taker: +b.taker.toFixed(4), premiumPct: +b.premiumPct.toFixed(4), fundingPct: +b.fundingPct.toFixed(5) } : null);

// Auto-trades pump-exhaustion shorts when the channel says ✅ ENTER (at signal time or from the
// follow-up watcher). Size comes from the owner's /trade panel settings; levels and exits follow the
// channel plan. Off and paper by default; live must be switched on explicitly.

const PLAN_TP_PCTS = [...PUMP_RULES.tpPcts, 30];
// TP1 choices for auto-trades. 219-trade replay ($150): 7% +$464 / 83 full stop-outs, 6% +$509 / 73, 5% +$500 / 62,
// 4% +$264 (SL reaches entry too early and bounces close the rest). Live-rule shorts, 21 Oct 2026: 6% +$869 / 106 stops /
// worst drop $129 (Jun–Oct) and +$911 / 134 / $253 (Dec–May); 5% +$777 / 95 / $104 and +$887 / 113 / $160 — less profit,
// smoother ride. The runner long has its own choice from the same list (runnerTp1Pct): 5% made $94–117 less than 6%
// in both periods (Jun–Oct +$426 vs +$543, Dec–May +$119 vs +$213); the owner chose to have it anyway.
const AUTO_TP1_PCTS = [7, 6, 5];
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
  // Also place the runner long as a real auto trade (in the auto-trade's mode, normally LIVE). Off by default.
  // Same plan as the paper test: stop −8%, TP +6/12/20/30 (TP1 = runnerTp1Pct), stop to entry at TP1. Stop sweep on the 4.5-month replay
  // (271 longs, $150): 3–7% +$294–419, 8% +$532 (best second half +$160), 10–12% +$590–602 but weaker second half.
  // Not paused by the BTC rule: longs did +$296 on 88 trades with BTC 7d < −2%.
  runnerLive: false,
  // TP1 of new runner longs (real and both paper labs), one of AUTO_TP1_PCTS; TP2–TP4 stay +12/20/30
  runnerTp1Pct: RUNNER.tpPcts[0],
  // Tighter stop once an auto trade has been beAtPct % in profit before TP1: the stop moves from −8% to −beStopPct %
  // (0 = entry). Nothing is closed. beAtPct 0 = off. Backtest ($1000, TP1 5%) vs never moving:
  // +4.5% → −5%: Jun–Oct +$372, Dec–May +$357, October −$153, the 47 live auto trades −$62 (the best tested).
  // +4% → entry: +$217, −$966, −$296 — 65–70% of trades that touch +2–4% and fall back to entry still reach TP1.
  // A +3% trigger lost on Dec–May at every stop (−5/−6%: −$314/−$620). A safety option, off by default.
  beAtPct: 0,
  beStopPct: 5,
};
const BE_AT_PCTS = [4.5, 4, 3.5, 3];  // trigger choices (0 = off is the toggle)
const BE_STOP_PCTS = [5, 4, 6, 3, 0]; // new stop choices, % from entry (0 = entry)

class PumpAutoTrader {
  constructor({ executor, notify, adminIds = [], measureSpot = measureSpotShare, measureBtc = measureBtcChange, runner = null, signalLab = null }) {
    this.executor = executor;       // onchain TradeExecutor (same engine as manual trades)
    this.runner = runner;           // PumpRunnerPaper — paper longs on no-spot runners, never real orders
    this.signalLab = signalLab;     // PumpRunnerPaper('signal') — the same long bought at the signal, paper only
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

  // Every minute: open auto trades (short or runner long) whose best move since entry reached beAtPct before TP1 get
  // their stop tightened to −beStopPct % (0 = entry). Only the stop moves — nothing closes, TPs stay. Live: the new stop
  // is placed on the exchange before the old one is cancelled (updateExchangeSL), and the DB follows only if the exchange took it.
  async checkBreakeven() {
    if (this.beRunning) return;
    this.beRunning = true;
    try {
      await this.load().catch(() => {});
      const at = this.config.beAtPct;
      if (!(at > 0)) return;
      const stopPct = Math.max(0, Number(this.config.beStopPct ?? 5));
      const open = (await db.getOpenTrades(this.executor.settingsKey)).filter(t => t.onchain_context?.autoPump === true);
      for (const t of open) {
        try { await this.breakevenOne(t, at, stopPct); } catch (e) { logger.warn(`Tighter-stop check ${t.symbol} #${t.id} failed: ${e.message}`); }
      }
    } finally {
      this.beRunning = false;
    }
  }

  async breakevenOne(t, at, stopPct = 0) {
    const entry = Number(t.entry_price), sl = Number(t.stop_loss), long = t.direction === 'long';
    if (!(entry > 0) || !(sl > 0) || t.hit_tp1) return;
    const target = long ? entry * (1 - stopPct / 100) : entry * (1 + stopPct / 100);
    if (long ? sl >= target : sl <= target) return; // already at or tighter than the new stop (moved by hand, etc.)
    const ex = this.executor.exchanges[t.exchange];
    if (!ex) return;
    const pair = `${t.symbol}/USDT:USDT`;
    // Best move since entry from 1m candles that start after the entry (so no pre-entry wick counts); kept per trade
    this.bePeak = this.bePeak || new Map();
    const seen = this.bePeak.get(t.id) || { best: -Infinity, next: Math.ceil(new Date(t.created_at).getTime() / 60000) * 60000 };
    for (let page = 0; page < 5 && seen.next < Date.now(); page++) {
      const candles = await ex.fetchOHLCV(pair, '1m', seen.next, 1000);
      if (!candles?.length) break;
      for (const c of candles) {
        if (c[0] < seen.next) continue;
        seen.best = Math.max(seen.best, long ? (c[2] / entry - 1) * 100 : (1 - c[3] / entry) * 100);
      }
      // The last candle is still forming: read it again next minute
      seen.next = candles[candles.length - 1][0];
      if (candles.length < 1000) break;
      seen.next += 60000;
    }
    this.bePeak.set(t.id, seen);
    if (seen.best < at) return;
    // Price must still be clear of the new stop, or it would fill straight away; the plan stop stays until then
    const price = (await ex.fetchTicker(pair)).last;
    const room = long ? (price / target - 1) * 100 : (1 - price / target) * 100;
    if (!(room >= 0.3)) return;
    const label = stopPct > 0 ? `−${stopPct}%` : 'entry';
    if (t.mode === 'live') {
      const ok = await this.executor.updateExchangeSL(t, target);
      if (ok !== true) {
        if (!seen.rejected) await this.tell(`🛡️ ⚠️ <b>${escapeHtml(t.symbol)}: stop → ${label} rejected by the exchange</b>\nThe old stop $${Number(sl).toPrecision(6)} is still in place. I'll try again next minute.`);
        seen.rejected = true;
        return;
      }
    }
    await db.updateTradeStopLoss(t.id, target);
    this.bePeak.delete(t.id);
    logger.info(`Tighter stop: ${t.symbol} #${t.id} ${t.direction} best +${seen.best.toFixed(2)}% → SL ${sl} → ${target} (${label}, ${t.mode})`);
    const p = (v) => Number(v).toPrecision(6);
    await this.tell(
      `🛡️ <b>${escapeHtml(t.symbol)} ${t.direction.toUpperCase()} — stop moved to ${label}</b>\n` +
      `It was +${seen.best.toFixed(1)}% in profit before TP1 → SL $${p(sl)} → <b>$${p(target)}</b> (${stopPct > 0 ? label + ' from entry' : 'entry'}).\n` +
      `<i>Nothing closed and the TPs are unchanged. If price comes back, it exits at ${stopPct > 0 ? label : 'entry (≈ fees only)'} instead of −${PUMP_RULES.slPct}%.</i>`
    );
  }

  // Runner coin (no spot market, 7-day run ≥ runnerMinRun7d): the channel posts a LONG for it instead of the short.
  // Same test the runner long applies (runnerLong → maybeOpen); the short skips these coins while skipNoSpot is on.
  isRunnerSignal({ run7d, spot }) {
    const c = this.config;
    return c.runnerLongs !== false && run7d >= (c.runnerMinRun7d ?? 20) && spot?.hasSpot === false;
  }

  // Channel levels for a runner long from an entry price (the plan the real and paper longs use)
  runnerLevels(entry) {
    const tpPcts = this.runnerTpPcts();
    return { side: 'long', tpPcts, slPct: RUNNER.slPct, tps: tpPcts.map(p => entry * (1 + p / 100)), stopLoss: entry * (1 - RUNNER.slPct / 100) };
  }

  // Signal-time ENTER: the short waits for the watch's re-check, the runner long opens now. When the re-check's
  // ENTER later reaches onEnter, the paper row (unique per signal) already exists, so no second long opens.
  // Runner longs are no-spot coins, which the short skips while skipNoSpot is on, so the two don't compete.
  // Also the ✅ ENTER of a signal the channel posted as a long: long only, the short isn't tried.
  async runnerLongNow(info) {
    await this.load().catch(e => logger.warn(`Auto-trade config reload failed, using memory: ${e.message}`));
    return this.runnerLong(info);
  }

  // At-signal lab: every runner signal (any verdict) gets a paper long at the live price right away.
  // Paper only and separate from runnerLong, so it never opens or blocks a real trade.
  async runnerAtSignal(info) {
    if (!this.signalLab) return null;
    try {
      await this.load().catch(e => logger.warn(`Auto-trade config reload failed, using memory: ${e.message}`));
      const c = this.config;
      if (c.runnerLongs === false || !(info.run7d >= (c.runnerMinRun7d ?? 20))) return null;
      const size = await this.sizing(PUMP_RULES.extendedRunPct).catch(() => null);
      return await this.signalLab.maybeOpen(info, c, size?.position || 150, this.runnerTpPcts());
    } catch (e) {
      logger.warn(`At-signal lab ${info.symbol} failed: ${e.message}`);
      return null;
    }
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
      const res = await this.runner.maybeOpen(info, c, size?.position || 150, this.runnerTpPcts());
      // Real long only for a qualifying signal the paper test just took (once per signal)
      if (res?.opened && c.runnerLive === true) res.live = await this.enterRunnerLong(info);
      return res;
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
    const common = await this.commonBlock(info);
    if (common) return common;
    const c = this.config;

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

  // Guards shared by the short and the runner long: owner, market, keys, existing position, signal already traded
  // (so a long never opens against a short on the same signal), max open, daily loss stop, minimum margin
  async commonBlock(info) {
    const c = this.config, te = this.executor;
    if (!c.ownerId) return 'No owner set — turn auto-trade on from /autopump.';
    const ex = te.exchanges[info.exchangeId];
    if (!ex?.markets?.[`${info.symbol}/USDT:USDT`]) return `${info.exchangeId} has no ${info.symbol}/USDT perpetual.`;
    // The scanner already leaves these out; this also covers signals logged before that, or another exchange's label
    if (isTradFiMarket(ex.markets[`${info.symbol}/USDT:USDT`])) return `${info.symbol} is a stock/ETF/commodity/FX perp on ${info.exchangeId}, not a coin — the pump rules were only tested on crypto.`;
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
    return null;
  }

  // Runner long as a real auto trade. Called only after the paper test opened it, so the signal already passed
  // the runner filter (no spot market, 7-day run ≥ min). Uses the auto-trade's ON switch, mode and guards.
  async enterRunnerLong(info) {
    const c = this.config;
    if (!c.enabled) return { skipped: 'auto-trade off' };
    const key = `L:${info.signalId}`;
    if (this.busy.has(key)) return { skipped: 'in progress' };
    this.busy.add(key);
    try {
      const block = await this.commonBlock(info);
      if (block) {
        const reason = typeof block === 'string' ? block : block.reason;
        if (!block.silent) await this.tell(`🚀 <b>Runner long not placed — ${escapeHtml(info.symbol)}</b>\n${escapeHtml(reason)}\n<i>Still tracked as a paper long.</i>`);
        return { skipped: reason };
      }
      return await this.openRunnerLong(info);
    } catch (e) {
      logger.error(`Runner long ${info.symbol} failed: ${e.message}`);
      await this.tell(`🚀 ⚠️ <b>Runner long failed — ${escapeHtml(info.symbol)}</b>\n${escapeHtml(e.message)}`);
      return { error: e.message };
    } finally {
      this.busy.delete(key);
    }
  }

  async openRunnerLong(info) {
    const c = this.config, te = this.executor;
    // Full size, like the paper test (never "half on fresh")
    const size = await this.sizing(PUMP_RULES.extendedRunPct);
    const entry = info.price;
    const tpPcts = this.runnerTpPcts();
    const tps = tpPcts.map(p => entry * (1 + p / 100));
    const stopLoss = entry * (1 - RUNNER.slPct / 100);
    const trade = await te.openManualTrade({
      symbol: info.symbol, exchangeId: info.exchangeId, direction: 'long', mode: c.mode,
      entryPrice: entry, positionSize: size.position, leverage: size.leverage, marginSaver: size.marginSaver,
      tp1: tps[0], tp2: tps[1], tp3: tps[2], tp4: tps[3], stopLoss, atr: null, rebaseOnFill: true,
      context: { margin: size.margin, exitStyle: 'tponly', autoPump: true, runnerLong: true, pumpSignalId: info.signalId ?? null, run7d: info.run7d ?? null, via: info.via, koreaShare: koreaPct(info.korea) },
    });
    if (!trade) {
      await this.tell(`🚀 ⚠️ <b>Runner long NOT placed — ${escapeHtml(info.symbol)}</b>\nThe executor skipped it (existing exchange position, minimum size, liquidity or price drift). Still tracked as a paper long.`);
      return { skipped: 'executor declined' };
    }
    const p = (v) => Number(v).toPrecision(6);
    const fill = trade.entryPrice || entry;
    const lev = trade.leverage || size.leverage;
    const pos = trade.positionSize || size.position;
    // Live levels follow the real fill (rebaseOnFill)
    if (trade.stopLoss > 0) tps.splice(0, 4, ...[trade.tp1, trade.tp2, trade.tp3, trade.tp4].map((v, i) => v || tps[i]));
    const sl = trade.stopLoss || stopLoss;
    await this.tell(
      `🚀 <b>AUTO-TRADE OPENED — ${escapeHtml(info.symbol)} LONG (runner)</b>\n` +
      `${c.mode === 'live' ? '💰 LIVE' : '📝 PAPER'} · ${info.exchangeId.toUpperCase()} · no spot market, already +${(info.run7d ?? 0).toFixed(0)}% in 7 days\n\n` +
      `💰 Entry: <b>$${p(fill)}</b>\n` +
      `💵 $${size.margin} × ${size.leverage}x = <b>$${pos.toFixed(2)}</b> position\n` +
      `🏦 Exchange: <b>${lev}x</b> → locks <b>$${(pos / lev).toFixed(2)}</b>${lev > size.leverage ? ` (margin saver · liq ≈ ${liquidationPct(lev).toFixed(1)}%)` : ''}\n` +
      `🎯 ${tpPcts.map((t, i) => `TP${i + 1} $${p(tps[i])} (+${t}%)`).join(' · ')}\n` +
      `🛑 SL $${p(sl)} (−${RUNNER.slPct}%) → max loss ≈ -$${(pos * RUNNER.slPct / 100).toFixed(2)} · to entry at TP1\n` +
      koreaNote(info.korea) +
      `🛡️ Exit: TPs only · manage or close in /mpositions`
    );
    logger.info(`Runner long auto-trade opened: ${info.symbol} ${c.mode} $${size.margin} × ${lev}x`);
    return { opened: trade };
  }

  // Targets for auto-trades: the plan with the chosen TP1 (anything not on the list falls back to the plan)
  tpPcts() {
    const tp1 = AUTO_TP1_PCTS.includes(this.config.tp1Pct) ? this.config.tp1Pct : PLAN_TP_PCTS[0];
    return [tp1, ...PLAN_TP_PCTS.slice(1)];
  }

  // Targets for runner longs: the runner plan with the long's own TP1 choice
  runnerTpPcts() {
    const tp1 = AUTO_TP1_PCTS.includes(this.config.runnerTp1Pct) ? this.config.runnerTp1Pct : RUNNER.tpPcts[0];
    return [tp1, ...RUNNER.tpPcts.slice(1)];
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
      tp1: tps[0], tp2: tps[1], tp3: tps[2], tp4: tps[3], stopLoss: L.stopLoss, atr: null, rebaseOnFill: true,
      context: { margin: size.margin, exitStyle: 'tponly', autoPump: true, pumpSignalId: info.signalId ?? null, run7d: info.run7d ?? null, via: info.via, koreaShare: koreaPct(info.korea), buyers: buyersData(info.buyers) },
    });
    if (!trade) {
      await this.tell(`🤖 ⚠️ <b>Auto-trade NOT placed — ${escapeHtml(info.symbol)}</b>\nThe executor skipped it (existing exchange position, minimum size, liquidity or price drift). Check the bot notification for the reason.`);
      return { skipped: 'executor declined' };
    }
    const p = (v) => Number(v).toPrecision(6);
    const fill = trade.entryPrice || entry;
    const lev = trade.leverage || size.leverage;
    const pos = trade.positionSize || size.position;
    // Live levels follow the real fill (rebaseOnFill)
    if (trade.stopLoss > 0) tps.splice(0, 4, ...[trade.tp1, trade.tp2, trade.tp3, trade.tp4].map((v, i) => v || tps[i]));
    const sl = trade.stopLoss || L.stopLoss;
    await this.tell(
      `🤖 <b>AUTO-TRADE OPENED — ${escapeHtml(info.symbol)} SHORT</b>\n` +
      `${c.mode === 'live' ? '💰 LIVE' : '📝 PAPER'} · ${info.exchangeId.toUpperCase()} · from ${info.via === 'follow-up' ? 'follow-up ✅ ENTER' : 'signal ✅ ENTER'}\n\n` +
      `💰 Entry: <b>$${p(fill)}</b>\n` +
      `💵 $${size.margin} × ${size.leverage}x = <b>$${pos.toFixed(2)}</b> position${size.fresh && c.halfOnFresh ? ' · 🟠 half size (fresh breakout)' : ''}${size.levCapped ? ` · leverage capped ${size.panelLev}x → ${size.leverage}x` : ''}\n` +
      `🏦 Exchange: <b>${lev}x</b> → locks <b>$${(pos / lev).toFixed(2)}</b>${lev > size.leverage ? ` (margin saver · liq ≈ ${liquidationPct(lev).toFixed(1)}%)` : ''}\n` +
      `🎯 TP1 $${p(tps[0])} (−${tpPcts[0]}%) · TP2 $${p(tps[1])} · TP3 $${p(tps[2])} · TP4 $${p(tps[3])}\n` +
      `🛑 SL $${p(sl)} (+${PUMP_RULES.slPct}%) → max loss ≈ -$${(pos * PUMP_RULES.slPct / 100).toFixed(2)}\n` +
      `${c.maxSpotSharePct > 0 && info.spot ? `🧪 Spot share: ${info.spot.hasSpot ? `${info.spot.pct.toFixed(1)}%` : 'no spot market'} (limit ${c.maxSpotSharePct}%)\n` : ''}` +
      `${info.btc7d != null ? `₿ BTC 7d: ${info.btc7d >= 0 ? '+' : ''}${info.btc7d.toFixed(1)}% (pause below −${c.btcPausePct}%)\n` : ''}` +
      koreaNote(info.korea) +
      buyersNote(info.buyers) +
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

module.exports = { PumpAutoTrader, PLAN_TP_PCTS, AUTO_TP1_PCTS, AUTO_BTC_PAUSE_PCTS, BE_AT_PCTS, BE_STOP_PCTS };
