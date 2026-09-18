const ccxt = require('ccxt');
const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');

class TradeExecutor {
  constructor(exchanges, config = {}) {
    this.exchanges = exchanges;
    this.mode = config.mode || 'paper';
    this.maxPositionSize = config.maxPositionSize || 50;
    this.maxDailyLoss = config.maxDailyLoss || 200;
    this.maxLossPerTrade = config.maxLossPerTrade || 0;
    this.maxConcurrentPositions = config.maxConcurrentPositions || 5;
    this.minConfidence = config.minConfidence || 4;
    this.minOcScore = config.minOcScore || 0;
    this.maxOcScore = config.maxOcScore || 69;
    this.minShortScore = config.minShortScore || 70;
    this.flipScore = config.flipScore || 70;
    this.defaultLeverage = config.defaultLeverage || 5;
    this.enabled = config.enabled !== false;
    this.dailyPnL = 0;
    this.dailyPnLResetDate = new Date().toISOString().slice(0, 10);
    this.callbacks = [];

    // Risk-based sizing: 0 = disabled (use fixed maxPositionSize), >0 = % of balance per trade
    this.riskPct = config.riskPct || 0;
    this.paperBalance = config.paperBalance || 1000;

    // Signal type filter: empty = trade all, otherwise only listed types
    this.signalFilter = new Set(config.signalFilter || []);

    // Dynamic leverage by confidence: maps confidence level → leverage multiplier
    this.dynamicLeverage = config.dynamicLeverage !== false;

    // Excluded symbols: skip signals for these tokens
    this.excludedSymbols = new Set(config.excludedSymbols || ['BTC', 'ETH', 'SOL']);

    // Disabled exchanges: skip signals from these exchanges (admin toggle)
    this.disabledExchanges = new Set(config.disabledExchanges || []);

    // DCA ladder: OFF by default — historically amplified losses (all 10 worst trades
    // reached DCA stage 3 then max_loss). Opt in via config.dcaEnabled = true.
    this.dcaEnabled = config.dcaEnabled === true;

    this.pnlResetDate = config.pnlResetDate || new Date().toISOString();

    // Settings persistence key (default 'main', onchain executor uses 'onchain')
    this.settingsKey = config.settingsKey || 'main';

    // Cooldown: symbol → { until (next 01:00 UTC), entryPrice, lastDir }
    this.cooldowns = new Map();
    this._next1amUTC = () => {
      const n = new Date(); n.setUTCHours(1, 0, 0, 0);
      if (n.getTime() <= Date.now()) n.setUTCDate(n.getUTCDate() + 1);
      return n.getTime();
    };

    // Entry mode: 'market' | 'pullback' | 'hybrid'
    // hybrid = market for fresh moves, pullback for overextended (priceChange > hybridThreshold)
    this.entryMode = config.entryMode || 'pullback';
    this.hybridThreshold = config.hybridThreshold || 30;

    // Pending entries: wait for 5m pullback instead of market entry
    this.pendingEntries = new Map();

    // Parameterized trade management (swing trades override these)
    this.maxTradeAge = config.maxTradeAge || 48 * 60 * 60 * 1000;
    this.timeExitMinutes = config.timeExitMinutes ?? 90;
    this.profitProtectPct = config.profitProtectPct || 1.5;
    this.profitProtectLevPnl = config.profitProtectLevPnl || 5;
    this.trailAtrMultPre = config.trailAtrMultPre || 1.5;
    this.trailAtrMultPost = config.trailAtrMultPost || 3;
    this.trailGivebackPct = config.trailGivebackPct || 0.33;
    this.dcaSpreadMult1 = config.dcaSpreadMult1 || 1.0;
    this.dcaSpreadMult2 = config.dcaSpreadMult2 || 1.5;
    this.tp1ClosePct = config.tp1ClosePct || 0.33;
    this.tp2ClosePct = config.tp2ClosePct || 0.50;
    this.tpMultPreset = config.tpMultPreset || 'default';
    this.tp1Mult = config.tp1Mult || 1.2;
    this.tp2Mult = config.tp2Mult || 2.5;
    this.tp3Mult = config.tp3Mult || 4.0;
    this.tpCapPct1 = config.tpCapPct1 || 3;
    this.tpCapPct2 = config.tpCapPct2 || 6;
    this.tpCapPct3 = config.tpCapPct3 || 10;

    // Circuit breaker: pause after consecutive losses
    this.cbEnabled = config.cbEnabled !== false;
    this.cbStreak = config.cbStreak || 3;
    this.cbPauseMinutes = config.cbPauseMinutes || 120;
    this.cbOverrideUntil = 0; // manual override timestamp — skip CB until this time

    // Volatility filter: skip entries on high-ATR or mid-pump candles
    this.volatilityFilter = config.volatilityFilter !== false;
    this.max4hRange = config.max4hRange || 15;

    // Risk-fit sizing: shrink position so SL hit = maxLossPerTrade
    this.riskFitSizing = config.riskFitSizing !== false;

    // Confidence scaling: reduce position for low-confidence signals (default on)
    this.confidenceScaling = config.confidenceScaling !== false;

    // Loss buffer: close at this % of maxLossPerTrade to avoid overshoot (default 80%)
    this.lossBufferPct = config.lossBufferPct ?? 80;

    // Min 24h quote volume for live trades (skip low-liquidity tokens that slip badly)
    this.minLiveVolume = config.minLiveVolume ?? 5000000;

    // Trading schedule: array of [startHour, endHour] UTC ranges when trading is allowed
    // Empty = 24/7 (no restriction). Example: [[8,12],[13,20]] = trade 08-12 and 13-20 UTC only
    this.tradingHours = config.tradingHours || [];
  }

  onTradeUpdate(callback) {
    this.callbacks.push(callback);
  }

  async notify(message) {
    for (const cb of this.callbacks) {
      try { await cb(message); } catch (e) { logger.error(`Trade notify error: ${e.message}`); }
    }
  }

  resetDailyPnL() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyPnLResetDate !== today) {
      this.dailyPnL = 0;
      this.dailyPnLResetDate = today;
      logger.info(`Daily PnL reset for ${today}`);
    }
  }

  async recalcDailyPnL() {
    try {
      const result = await db.getTodayPnL(null, this.settingsKey);
      this.dailyPnL = result || 0;
      this.dailyPnLResetDate = new Date().toISOString().slice(0, 10);
    } catch (e) { logger.warn(`Failed to recalc daily PnL: ${e.message}`); }
  }

  async canTrade(signal) {
    if (!this.enabled) return { ok: false, reason: 'Trading disabled' };

    this.resetDailyPnL();

    if (this.dailyPnL <= -this.maxDailyLoss) {
      return { ok: false, reason: `Daily loss limit reached ($${this.dailyPnL.toFixed(2)}/$${this.maxDailyLoss})` };
    }

    if (signal.confidence < this.minConfidence) {
      return { ok: false, reason: `Confidence ${signal.confidence} < minimum ${this.minConfidence}` };
    }

    const ocScore = signal.onchainScore || 0;
    if (this.minOcScore > 0 && ocScore > 0 && ocScore < this.minOcScore) {
      return { ok: false, reason: `Score ${ocScore} < minimum ${this.minOcScore}` };
    }
    if (this.maxOcScore && this.maxOcScore < 99 && ocScore > this.maxOcScore) {
      const isShort = signal.direction === 'short';
      if (!isShort) {
        return { ok: false, reason: `Long score ${ocScore} > max ${this.maxOcScore} (use short for high scores)` };
      }
    }
    if (signal.direction === 'short' && this.minShortScore > 0 && ocScore < this.minShortScore) {
      return { ok: false, reason: `Short score ${ocScore} < minimum ${this.minShortScore}` };
    }

    if (this.signalFilter.size > 0 && !this.signalFilter.has(signal.type)) {
      return { ok: false, reason: `Signal type ${signal.type} not in filter [${[...this.signalFilter].join(', ')}]` };
    }

    if (this.excludedSymbols.size > 0 && this.excludedSymbols.has(signal.symbol?.toUpperCase())) {
      return { ok: false, reason: `${signal.symbol} is in excluded list` };
    }

    if (this.disabledExchanges.size > 0 && this.disabledExchanges.has(signal.exchange?.toLowerCase())) {
      return { ok: false, reason: `Exchange ${signal.exchange} is disabled` };
    }

    // Trading schedule check
    if (this.tradingHours.length > 0) {
      const h = new Date().getUTCHours();
      const inWindow = this.tradingHours.some(([start, end]) =>
        start <= end ? (h >= start && h < end) : (h >= start || h < end)
      );
      if (!inWindow) {
        return { ok: false, reason: `Outside trading hours (${h}:00 UTC)` };
      }
    }

    // Losing streak circuit breaker
    if (this.cbEnabled && Date.now() > this.cbOverrideUntil) {
      try {
        const recentTrades = await db.query(
          `SELECT pnl_usd, close_reason, closed_at FROM trades WHERE status = 'closed' AND source = $1 ORDER BY closed_at DESC LIMIT 5`,
          [this.settingsKey]
        );
        let streak = 0;
        for (const t of recentTrades.rows) {
          if (parseFloat(t.pnl_usd) < -0.01) streak++;
          else break;
        }
        if (streak >= this.cbStreak) {
          const lastClose = new Date(recentTrades.rows[0].closed_at).getTime();
          const cooldownEnd = lastClose + this.cbPauseMinutes * 60 * 1000;
          if (Date.now() < cooldownEnd) {
            const minsLeft = Math.ceil((cooldownEnd - Date.now()) / 60000);
            return { ok: false, reason: `Losing streak (${streak} losses) — paused ${minsLeft}m` };
          }
        }
      } catch (e) { /* DB error, skip check */ }
    }

    // Re-entry rules: allow if price near original entry (fresh thesis at similar level)
    // Block if chasing (price drifted >10% in trade direction from last entry)
    const cooldownData = this.cooldowns.get(signal.symbol?.toUpperCase());
    if (cooldownData && Date.now() < cooldownData.until) {
      const minsLeft = Math.ceil((cooldownData.until - Date.now()) / 60000);
      const isFlip = cooldownData.lastDir && cooldownData.lastDir !== signal.direction;
      const hoursSinceClose = cooldownData.closedAt ? (Date.now() - cooldownData.closedAt) / 3600000 : 999;
      if (isFlip && (signal.onchainScore || 0) >= this.flipScore) {
        logger.info(`${signal.symbol}: cooldown bypassed — direction flip with strong thesis (score ${signal.onchainScore})`);
      } else if (hoursSinceClose < 2) {
        return { ok: false, reason: `${signal.symbol} blocked — 2h cooldown after close (${(hoursSinceClose * 60).toFixed(0)}m elapsed)` };
      } else if (cooldownData.entryPrice && !isFlip) {
        const drift = (signal.currentPrice - cooldownData.entryPrice) / cooldownData.entryPrice * 100;
        const chasingUp = signal.direction === 'long' && drift > 10;
        const chasingDown = signal.direction === 'short' && drift < -10;
        if (chasingUp || chasingDown) {
          return { ok: false, reason: `${signal.symbol} blocked — re-entry price drifted ${drift.toFixed(1)}% from last entry (chasing)` };
        }
        logger.info(`${signal.symbol}: re-entry allowed — price within ${drift.toFixed(1)}% of last entry $${cooldownData.entryPrice} (fresh thesis at similar level)`);
      } else if (isFlip) {
        return { ok: false, reason: `${signal.symbol} blocked — flip needs score >= ${this.flipScore}, got ${signal.onchainScore || 0}` };
      }
    }

    // DB-based re-entry check (survives restarts)
    try {
      const { rows: lastTrades } = await db.query(
        `SELECT direction, closed_at, close_reason, pnl_usd, entry_price FROM trades WHERE symbol = $1 AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
        [signal.symbol]
      );
      if (lastTrades.length) {
        const closedAt = new Date(lastTrades[0].closed_at).getTime();
        const isFlip = lastTrades[0].direction !== signal.direction;
        const hoursSinceClose = (Date.now() - closedAt) / 3600000;
        const lastEntry = parseFloat(lastTrades[0].entry_price);
        const closeDate = new Date(closedAt);
        const next1am = new Date(closeDate);
        next1am.setUTCHours(1, 0, 0, 0);
        if (next1am.getTime() <= closedAt) next1am.setUTCDate(next1am.getUTCDate() + 1);
        if (Date.now() < next1am.getTime()) {
          if (isFlip && (signal.onchainScore || 0) >= this.flipScore) {
            logger.info(`${signal.symbol}: daily cooldown bypassed — direction flip (score ${signal.onchainScore})`);
          } else if (hoursSinceClose < 2) {
            return { ok: false, reason: `${signal.symbol} blocked — 2h cooldown after close (${(hoursSinceClose * 60).toFixed(0)}m elapsed)` };
          } else if (!isFlip && lastEntry > 0) {
            const drift = (signal.currentPrice - lastEntry) / lastEntry * 100;
            const chasingUp = signal.direction === 'long' && drift > 10;
            const chasingDown = signal.direction === 'short' && drift < -10;
            if (chasingUp || chasingDown) {
              return { ok: false, reason: `${signal.symbol} blocked — re-entry price ${drift.toFixed(1)}% from last entry (chasing)` };
            }
            logger.info(`${signal.symbol}: re-entry allowed — price ${drift.toFixed(1)}% from last entry $${lastEntry.toPrecision(5)}`);
          } else if (isFlip) {
            return { ok: false, reason: `${signal.symbol} blocked — flip needs score >= ${this.flipScore}, got ${signal.onchainScore || 0}` };
          }
        }
      }
    } catch (e) { /* DB error, skip check */ }

    const openPositions = await db.getOpenTrades(this.settingsKey);
    if (openPositions.length >= this.maxConcurrentPositions) {
      return { ok: false, reason: `Max concurrent positions reached (${openPositions.length}/${this.maxConcurrentPositions})` };
    }

    const existing = openPositions.find(p => p.symbol === signal.symbol);
    if (existing) {
      return { ok: false, reason: `Already in position on ${signal.symbol} (${existing.exchange})` };
    }

    if (this.mode === 'live') {
      try {
        const allOpen = await db.getOpenTrades();
        const liveConflict = allOpen.find(p => p.symbol === signal.symbol && p.source !== this.settingsKey);
        if (liveConflict) {
          return { ok: false, reason: `${signal.symbol} already open in ${liveConflict.source} — skipping to avoid exchange conflict` };
        }
      } catch (e) { /* skip cross-check */ }
    }

    // Cross-exchange duplicate: same token listed under different names (e.g. PUMP vs PUMPFUN)
    // Check if any open position has a very similar entry price on the same direction
    const priceTolerance = 0.02; // 2%
    const priceMatch = openPositions.find(p =>
      p.direction === signal.direction &&
      Math.abs(p.entry_price - signal.currentPrice) / signal.currentPrice < priceTolerance
    );
    if (priceMatch) {
      return { ok: false, reason: `Likely duplicate: ${signal.symbol} ≈ ${priceMatch.symbol} (same price $${signal.currentPrice.toPrecision(4)})` };
    }

    return { ok: true };
  }

  // Get available balance for sizing
  async getBalance() {
    if (this.mode === 'paper') return this.paperBalance;
    const balances = await this.getAllBalances();
    let total = 0;
    for (const b of Object.values(balances)) total += (b.total > 0 ? b.total : b.free);
    return total || this.paperBalance;
  }

  // Get balances from all exchanges with API keys
  async getAllBalances() {
    if (!this._balanceCache) this._balanceCache = {};

    const entries = Object.entries(this.exchanges).filter(([, ex]) => ex.apiKey && ex.secret);
    const fetches = entries.map(async ([id, exchange]) => {
      try {
        const params = id === 'bybit' ? { type: 'unified' } : id === 'binance' ? { type: 'future' } : {};
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000));
        const balance = await Promise.race([exchange.fetchBalance(params), timeout]);
        const result = {
          free: balance.free?.USDT || 0,
          total: balance.total?.USDT || 0,
          used: balance.used?.USDT || 0,
        };
        this._balanceCache[id] = result;
        return [id, result];
      } catch (e) {
        logger.warn(`${id} balance fetch failed: ${e.message}`);
        if (this._balanceCache[id]) return [id, this._balanceCache[id]];
        return [id, { free: 0, total: 0, used: 0, error: e.message }];
      }
    });

    const settled = await Promise.all(fetches);
    const results = {};
    for (const [id, bal] of settled) results[id] = bal;
    return results;
  }

  // Calculate position size so ATR-based SL = max loss cap
  // This ensures the stop loss has room to breathe instead of max_loss killing trades early
  async calcPositionSize(signal) {
    if (this.riskPct > 0) {
      const balance = await this.getBalance();
      let size = balance * (this.riskPct / 100);
      if (this.maxLossPerTrade > 0) size = Math.min(size, this.maxLossPerTrade);
      return Math.min(size, balance * 0.2);
    }

    // Risk-fit sizing: size position so hitting SL = losing exactly maxLossPerTrade
    // Only applies when riskFitSizing is enabled and maxLossPerTrade would produce a meaningful size
    // When disabled, uses flat maxPositionSize and relies on checkOpenTrades max_loss enforcement
    if (this.riskFitSizing && this.maxLossPerTrade > 0 && signal.stopLoss && signal.currentPrice) {
      const slDistPct = Math.abs((signal.currentPrice - signal.stopLoss) / signal.currentPrice) * 100;
      if (slDistPct > 0) {
        const riskFitSize = this.maxLossPerTrade / (slDistPct / 100);
        if (riskFitSize >= this.maxPositionSize * 0.1) {
          const capped = Math.min(riskFitSize, this.maxPositionSize);
          if (capped < this.maxPositionSize) {
            logger.info(`Risk-fit sizing: $${capped.toFixed(0)} (SL ${slDistPct.toFixed(1)}% → $${this.maxLossPerTrade} max loss) vs max $${this.maxPositionSize}`);
          }
          return capped;
        }
        logger.info(`Risk-fit too small ($${riskFitSize.toFixed(0)} vs $${this.maxPositionSize} max) — using flat size, max_loss enforced by trade checker`);
      }
    }

    return this.maxPositionSize;
  }

  // Scale size by confidence — low-confidence signals get smaller positions
  applyConfidenceScale(size, signal) {
    if (!this.confidenceScaling) return size;
    const conf = signal.confidence || 3;
    if (conf >= 5) return size;
    if (conf >= 4) return size * 0.75;
    return size * 0.5;
  }

  // Dynamic leverage based on confidence level
  calcLeverage(signal) {
    if (!this.dynamicLeverage) return signal.suggestedLeverage || this.defaultLeverage;
    const conf = signal.confidence || 3;
    if (conf >= 5) return Math.min(this.defaultLeverage * 2, 20);
    if (conf >= 4) return this.defaultLeverage;
    return Math.max(Math.floor(this.defaultLeverage * 0.6), 2);
  }

  // Set leverage with fallback — tries requested, then halves until it works
  async setLeverageWithFallback(exchange, pair, desiredLeverage) {
    const market = exchange.markets[pair];
    const maxLev = market?.limits?.leverage?.max || 125;
    const attempts = [...new Set([Math.min(desiredLeverage, maxLev), 10, 5, 3, 2, 1])].filter(v => v >= 1).sort((a, b) => b - a);

    // Ensure margin mode is set first
    try { await exchange.setMarginMode('cross', pair); } catch (e) { /* may already be set */ }

    for (const lev of attempts) {
      try {
        await exchange.setLeverage(lev, pair);
        if (lev !== desiredLeverage) logger.info(`${pair}: leverage fallback ${desiredLeverage}x → ${lev}x`);
        return lev;
      } catch (e) {
        const msg = e.message || '';
        // Parse max leverage from error if available
        const match = msg.match(/max.*?(\d+)/i) || msg.match(/(\d+)x?.*max/i);
        if (match) {
          const parsed = parseInt(match[1]);
          if (parsed > 0 && parsed < lev) {
            try {
              await exchange.setLeverage(parsed, pair);
              logger.info(`${pair}: leverage set to exchange max ${parsed}x (wanted ${desiredLeverage}x)`);
              return parsed;
            } catch (e2) { /* continue to next attempt */ }
          }
        }
        logger.debug(`${pair}: setLeverage ${lev}x failed: ${msg.slice(0, 100)}`);
      }
    }
    logger.warn(`${pair}: all leverage attempts failed, using exchange default (assuming ${desiredLeverage}x)`);
    return desiredLeverage;
  }

  // Check if notional meets exchange minimum, adjust if needed
  calcMinNotional(exchange, pair, qty, price) {
    const market = exchange.markets[pair];
    const notional = qty * price;
    // Binance futures minimum is $5 per order (was $20, lowered), most exchanges $1-5
    const minNotional = market?.limits?.cost?.min || 5;
    if (notional < minNotional) {
      const minQty = (minNotional * 1.05) / price; // 5% buffer
      return { ok: false, minQty, minNotional, currentNotional: notional };
    }
    return { ok: true, minQty: qty, minNotional, currentNotional: notional };
  }

  getConfig() {
    return {
      mode: this.mode,
      enabled: this.enabled,
      maxPositionSize: this.maxPositionSize,
      riskPct: this.riskPct,
      paperBalance: this.paperBalance,
      maxDailyLoss: this.maxDailyLoss,
      maxLossPerTrade: this.maxLossPerTrade,
      maxConcurrentPositions: this.maxConcurrentPositions,
      minConfidence: this.minConfidence,
      minOcScore: this.minOcScore,
      maxOcScore: this.maxOcScore,
      minShortScore: this.minShortScore,
      flipScore: this.flipScore,      defaultLeverage: this.defaultLeverage,
      dynamicLeverage: this.dynamicLeverage,
      dcaEnabled: this.dcaEnabled,
      signalFilter: [...this.signalFilter],
      excludedSymbols: [...this.excludedSymbols],
      disabledExchanges: [...this.disabledExchanges],
      pnlResetDate: this.pnlResetDate || null,
      dailyPnL: this.dailyPnL,
      maxTradeAge: this.maxTradeAge,
      timeExitMinutes: this.timeExitMinutes,
      profitProtectPct: this.profitProtectPct,
      profitProtectLevPnl: this.profitProtectLevPnl,
      trailAtrMultPre: this.trailAtrMultPre,
      trailAtrMultPost: this.trailAtrMultPost,
      trailGivebackPct: this.trailGivebackPct,
      dcaSpreadMult1: this.dcaSpreadMult1,
      dcaSpreadMult2: this.dcaSpreadMult2,
      tp1ClosePct: this.tp1ClosePct,
      tp2ClosePct: this.tp2ClosePct,
      tpMultPreset: this.tpMultPreset,
      tp1Mult: this.tp1Mult,
      tp2Mult: this.tp2Mult,
      tp3Mult: this.tp3Mult,
      tpCapPct1: this.tpCapPct1,
      tpCapPct2: this.tpCapPct2,
      tpCapPct3: this.tpCapPct3,
      cbEnabled: this.cbEnabled,
      cbStreak: this.cbStreak,
      cbPauseMinutes: this.cbPauseMinutes,
      volatilityFilter: this.volatilityFilter,
      max4hRange: this.max4hRange,
      riskFitSizing: this.riskFitSizing,
      confidenceScaling: this.confidenceScaling,
      lossBufferPct: this.lossBufferPct,
      minLiveVolume: this.minLiveVolume,
      tradingHours: this.tradingHours,
      entryMode: this.entryMode,
      hybridThreshold: this.hybridThreshold,
    };
  }

  applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.mode != null) this.mode = cfg.mode;
    if (cfg.enabled != null) this.enabled = cfg.enabled;
    if (cfg.maxPositionSize != null) this.maxPositionSize = cfg.maxPositionSize;
    if (cfg.riskPct != null) this.riskPct = cfg.riskPct;
    if (cfg.paperBalance != null) this.paperBalance = cfg.paperBalance;
    if (cfg.maxDailyLoss != null) this.maxDailyLoss = cfg.maxDailyLoss;
    if (cfg.maxLossPerTrade != null) this.maxLossPerTrade = cfg.maxLossPerTrade;
    if (cfg.maxConcurrentPositions != null) this.maxConcurrentPositions = cfg.maxConcurrentPositions;
    if (cfg.minConfidence != null) this.minConfidence = cfg.minConfidence;
    if (cfg.minOcScore != null) this.minOcScore = cfg.minOcScore;
    if (cfg.maxOcScore != null) this.maxOcScore = cfg.maxOcScore;
    if (cfg.minShortScore != null) this.minShortScore = cfg.minShortScore;
    if (cfg.flipScore != null) this.flipScore = cfg.flipScore;    if (cfg.defaultLeverage != null) this.defaultLeverage = cfg.defaultLeverage;
    if (cfg.dynamicLeverage != null) this.dynamicLeverage = cfg.dynamicLeverage;
    if (cfg.dcaEnabled != null) this.dcaEnabled = cfg.dcaEnabled;
    if (cfg.signalFilter != null) this.signalFilter = new Set(cfg.signalFilter);
    if (cfg.excludedSymbols != null) this.excludedSymbols = new Set(cfg.excludedSymbols);
    if (cfg.disabledExchanges != null) this.disabledExchanges = new Set(cfg.disabledExchanges);
    if (cfg.pnlResetDate != null) this.pnlResetDate = cfg.pnlResetDate;
    if (cfg.maxTradeAge != null) this.maxTradeAge = cfg.maxTradeAge;
    if (cfg.timeExitMinutes != null) this.timeExitMinutes = cfg.timeExitMinutes;
    if (cfg.profitProtectPct != null) this.profitProtectPct = cfg.profitProtectPct;
    if (cfg.profitProtectLevPnl != null) this.profitProtectLevPnl = cfg.profitProtectLevPnl;
    if (cfg.trailAtrMultPre != null) this.trailAtrMultPre = cfg.trailAtrMultPre;
    if (cfg.trailAtrMultPost != null) this.trailAtrMultPost = cfg.trailAtrMultPost;
    if (cfg.trailGivebackPct != null) this.trailGivebackPct = cfg.trailGivebackPct;
    if (cfg.dcaSpreadMult1 != null) this.dcaSpreadMult1 = cfg.dcaSpreadMult1;
    if (cfg.dcaSpreadMult2 != null) this.dcaSpreadMult2 = cfg.dcaSpreadMult2;
    if (cfg.tp1ClosePct != null) this.tp1ClosePct = cfg.tp1ClosePct;
    if (cfg.tp2ClosePct != null) this.tp2ClosePct = cfg.tp2ClosePct;
    if (cfg.tpMultPreset != null) this.tpMultPreset = cfg.tpMultPreset;
    if (cfg.tp1Mult != null) this.tp1Mult = cfg.tp1Mult;
    if (cfg.tp2Mult != null) this.tp2Mult = cfg.tp2Mult;
    if (cfg.tp3Mult != null) this.tp3Mult = cfg.tp3Mult;
    if (cfg.tpCapPct1 != null) this.tpCapPct1 = cfg.tpCapPct1;
    if (cfg.tpCapPct2 != null) this.tpCapPct2 = cfg.tpCapPct2;
    if (cfg.tpCapPct3 != null) this.tpCapPct3 = cfg.tpCapPct3;
    if (cfg.cbEnabled != null) this.cbEnabled = cfg.cbEnabled;
    if (cfg.cbStreak != null) this.cbStreak = cfg.cbStreak;
    if (cfg.cbPauseMinutes != null) this.cbPauseMinutes = cfg.cbPauseMinutes;
    if (cfg.volatilityFilter != null) this.volatilityFilter = cfg.volatilityFilter;
    if (cfg.max4hRange != null) this.max4hRange = cfg.max4hRange;
    if (cfg.riskFitSizing != null) this.riskFitSizing = cfg.riskFitSizing;
    if (cfg.confidenceScaling != null) this.confidenceScaling = cfg.confidenceScaling;
    if (cfg.lossBufferPct != null) this.lossBufferPct = cfg.lossBufferPct;
    if (cfg.minLiveVolume != null) this.minLiveVolume = cfg.minLiveVolume;
    if (cfg.tradingHours != null) this.tradingHours = cfg.tradingHours;
    if (cfg.entryMode != null) this.entryMode = cfg.entryMode;
    if (cfg.hybridThreshold != null) this.hybridThreshold = cfg.hybridThreshold;
  }

  async getCircuitBreakerStatus() {
    if (!this.cbEnabled) return { active: false, enabled: false };
    if (Date.now() < this.cbOverrideUntil) return { active: false, enabled: true, overrideUntil: this.cbOverrideUntil };
    try {
      const recentTrades = await db.query(
        `SELECT pnl_usd, closed_at FROM trades WHERE status = 'closed' AND source = $1 ORDER BY closed_at DESC LIMIT 5`,
        [this.settingsKey]
      );
      let streak = 0;
      for (const t of recentTrades.rows) {
        if (parseFloat(t.pnl_usd) < -0.01) streak++;
        else break;
      }
      if (streak >= this.cbStreak) {
        const lastClose = new Date(recentTrades.rows[0].closed_at).getTime();
        const cooldownEnd = lastClose + this.cbPauseMinutes * 60 * 1000;
        if (Date.now() < cooldownEnd) {
          const minsLeft = Math.ceil((cooldownEnd - Date.now()) / 60000);
          return { active: true, enabled: true, streak, minsLeft, cooldownEnd };
        }
      }
      return { active: false, enabled: true, streak };
    } catch (e) { return { active: false, enabled: true }; }
  }

  async saveConfig() {
    try { await db.saveSettings(this.getConfig(), this.settingsKey); } catch (e) { logger.warn(`Failed to save settings: ${e.message}`); }
  }

  async loadConfig() {
    try {
      const cfg = await db.loadSettings(this.settingsKey);
      if (cfg) { this.applyConfig(cfg); logger.info(`Settings loaded from database (${this.settingsKey})`); }
    } catch (e) { logger.warn(`Failed to load settings: ${e.message}`); }
  }

  // Calculate invalidation level: nearest structure level where thesis breaks
  calcInvalidation(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr || Math.abs(signal.stopLoss - price);
    const isLong = signal.direction === 'long';
    // Invalidation = same as SL level (3x ATR); checked only after first 4H candle closes
    return isLong ? price - atr * 3 : price + atr * 3;
  }

  // Calculate DCA levels: 3-part scaling
  calcDCALevels(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr || Math.abs(signal.stopLoss - price) / 3.5;
    const isLong = signal.direction === 'long';
    return {
      dcaPrice2: isLong ? price - atr * this.dcaSpreadMult1 : price + atr * this.dcaSpreadMult1,
      dcaPrice3: isLong ? price - atr * this.dcaSpreadMult2 : price + atr * this.dcaSpreadMult2,
    };
  }

  // Calculate TP4 (extended target)
  calcTP4(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr || Math.abs(signal.tp1 - price) / 2;
    const isLong = signal.direction === 'long';
    return isLong ? price + atr * 8 : price - atr * 8;
  }

  recalcTPs(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr;
    if (!atr || atr <= 0) return;
    const mult = signal.direction === 'long' ? 1 : -1;
    const tp1Raw = price + mult * atr * this.tp1Mult;
    const tp2Raw = price + mult * atr * this.tp2Mult;
    const tp3Raw = price + mult * atr * this.tp3Mult;
    const tp1Cap = price * (1 + mult * this.tpCapPct1 / 100);
    const tp2Cap = price * (1 + mult * this.tpCapPct2 / 100);
    const tp3Cap = price * (1 + mult * this.tpCapPct3 / 100);
    const minP = price * 0.05;
    const pick = signal.direction === 'long' ? Math.min : Math.max;
    signal.tp1 = Math.max(pick(tp1Raw, tp1Cap), minP);
    signal.tp2 = Math.max(pick(tp2Raw, tp2Cap), minP);
    signal.tp3 = Math.max(pick(tp3Raw, tp3Cap), minP);
  }

  // Refine TP/SL using SMC order blocks and FVGs
  refineWithSMC(signal) {
    if (!signal.smc) return;
    const isLong = signal.direction === 'long';
    const price = signal.currentPrice;

    // Use nearby order block as refined SL (demand zone for longs, supply zone for shorts)
    for (const ob of signal.smc.orderBlocks || []) {
      if (isLong && ob.type === 'OB_BULLISH' && ob.low < price && ob.low > signal.stopLoss) {
        signal.stopLoss = ob.low;
        logger.info(`SMC: Tightened SL to bullish OB at $${ob.low.toPrecision(6)}`);
      }
      if (!isLong && ob.type === 'OB_BEARISH' && ob.high > price && ob.high < signal.stopLoss) {
        signal.stopLoss = ob.high;
        logger.info(`SMC: Tightened SL to bearish OB at $${ob.high.toPrecision(6)}`);
      }
    }

    // Use unfilled FVGs as TP targets if they align
    for (const fvg of signal.smc.fvgs || []) {
      if (isLong && fvg.type === 'FVG_BEARISH' && fvg.midpoint > price) {
        // Bearish FVG above = liquidity target for longs
        if (fvg.midpoint < signal.tp2 && fvg.midpoint > signal.tp1) {
          signal.tp1 = fvg.midpoint;
          logger.info(`SMC: Adjusted TP1 to bearish FVG midpoint $${fvg.midpoint.toPrecision(6)}`);
        }
      }
      if (!isLong && fvg.type === 'FVG_BULLISH' && fvg.midpoint < price) {
        if (fvg.midpoint > signal.tp2 && fvg.midpoint < signal.tp1) {
          signal.tp1 = fvg.midpoint;
          logger.info(`SMC: Adjusted TP1 to bullish FVG midpoint $${fvg.midpoint.toPrecision(6)}`);
        }
      }
    }
  }

  async queueSignal(signal) {
    const key = `${signal.symbol}_${signal.exchange}`;
    if (this.pendingEntries.has(key)) return;

    // Check DB for existing position on same symbol
    try {
      const openPositions = await db.getOpenTrades(this.settingsKey);
      const existing = openPositions.find(p => p.symbol === signal.symbol);
      if (existing) {
        logger.info(`Queue skip ${signal.symbol}: already in position (${existing.exchange})`);
        return;
      }
      if (this.mode === 'live') {
        const allOpen = await db.getOpenTrades();
        const crossConflict = allOpen.find(p => p.symbol === signal.symbol && p.source !== this.settingsKey);
        if (crossConflict) {
          logger.info(`Queue skip ${signal.symbol}: open in ${crossConflict.source} — avoiding exchange conflict`);
          return;
        }
      }
    } catch (e) { logger.debug(`Queue DB check failed: ${e.message}`); }

    // Smart re-entry: allow if price near original entry, block if chasing
    try {
      const { rows: lastTrades } = await db.query(
        `SELECT direction, closed_at, entry_price FROM trades WHERE symbol = $1 AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
        [signal.symbol]
      );
      if (lastTrades.length) {
        const closedAt = new Date(lastTrades[0].closed_at).getTime();
        const isFlip = lastTrades[0].direction !== signal.direction;
        const hoursSinceClose = (Date.now() - closedAt) / 3600000;
        const lastEntry = parseFloat(lastTrades[0].entry_price);
        const closeDate = new Date(closedAt);
        const next1am = new Date(closeDate);
        next1am.setUTCHours(1, 0, 0, 0);
        if (next1am.getTime() <= closedAt) next1am.setUTCDate(next1am.getUTCDate() + 1);
        if (Date.now() < next1am.getTime()) {
          if (isFlip && (signal.onchainScore || 0) >= this.flipScore) {
            logger.info(`Queue ${signal.symbol}: cooldown bypassed — direction flip (score ${signal.onchainScore})`);
          } else if (hoursSinceClose < 2) {
            logger.info(`Queue skip ${signal.symbol}: 2h cooldown (${(hoursSinceClose * 60).toFixed(0)}m elapsed)`);
            return;
          } else if (!isFlip && lastEntry > 0) {
            const drift = (signal.currentPrice - lastEntry) / lastEntry * 100;
            const chasingUp = signal.direction === 'long' && drift > 10;
            const chasingDown = signal.direction === 'short' && drift < -10;
            if (chasingUp || chasingDown) {
              logger.info(`Queue skip ${signal.symbol}: re-entry price drifted ${drift.toFixed(1)}% from last entry (chasing)`);
              return;
            }
            logger.info(`Queue ${signal.symbol}: re-entry allowed — price ${drift.toFixed(1)}% from last entry $${lastEntry.toPrecision(5)}`);
          } else if (isFlip) {
            logger.info(`Queue skip ${signal.symbol}: flip needs score >= ${this.flipScore}, got ${signal.onchainScore || 0}`);
            return;
          }
        }
      }
    } catch (e) { /* proceed */ }

    // Resolve effective entry mode for this signal
    let effectiveEntry = this.entryMode;
    const priceChg = Math.abs(signal.priceChange || signal.onchainContext?.priceChange || 0);
    if (this.entryMode === 'hybrid') {
      effectiveEntry = priceChg >= this.hybridThreshold ? 'pullback' : 'market';
      // Falling edge detection: if price retraced >5% from 24h high, force pullback
      // Prevents market entry on falling knives (coin pumped then dumping)
      const high24h = signal.onchainContext?.high24h;
      if (effectiveEntry === 'market' && high24h && high24h > 0) {
        const retraceFromHigh = ((high24h - signal.currentPrice) / high24h) * 100;
        if (retraceFromHigh >= 5) {
          effectiveEntry = 'pullback';
          logger.info(`Hybrid entry ${signal.symbol}: FALLING EDGE — price ${retraceFromHigh.toFixed(1)}% below 24h high $${high24h.toPrecision(5)} → forced PULLBACK`);
        }
      }
      if (effectiveEntry === 'pullback') {
        logger.info(`Hybrid entry ${signal.symbol}: priceChange ${priceChg.toFixed(1)}% → PULLBACK`);
      } else {
        logger.info(`Hybrid entry ${signal.symbol}: priceChange ${priceChg.toFixed(1)}% < ${this.hybridThreshold}%, near 24h high → MARKET`);
      }
    }

    // Market mode: enter immediately at signal price — no pullback queue
    if (effectiveEntry === 'market') {
      logger.info(`Market entry ${signal.direction} ${signal.symbol} at $${signal.currentPrice}`);
      const result = await this.executeSignal(signal);
      if (result) {
        this.notify(
          `⚡ <b>MARKET ENTRY</b> $${escapeHtml(signal.symbol)}\n\n` +
          `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} — entered at signal\n` +
          `Entry: $${signal.currentPrice}\n` +
          `SL: $${signal.stopLoss?.toPrecision(6) || '?'}`
        ).catch(() => {});
      }
      return;
    }

    // Pullback mode: find demand/supply zone for structural entry
    // Overextended coins use 1h candles to find the pre-pump consolidation base
    // Normal entries use 5m candles for nearby swing structure
    let demandZone = null;
    try {
      const exchange = this.exchanges[signal.exchange];
      if (exchange) {
        const isLong = signal.direction === 'long';
        const price = signal.currentPrice;
        const sl = signal.stopLoss;
        const isOverext = priceChg >= (this.hybridThreshold || 30);

        if (isOverext) {
          // Overextended: use 1h candles to find the breakout/consolidation zone
          const candles1h = await exchange.fetchOHLCV(signal.pair, '1h', undefined, 48);
          if (candles1h?.length >= 10) {
            const completed = candles1h.slice(0, -1);
            const closes = completed.map(c => c[4]);
            const lows = completed.map(c => c[3]);
            const highs = completed.map(c => c[2]);

            const low48h = Math.min(...lows);
            const high48h = Math.max(...highs);
            const range48h = high48h - low48h;

            if (isLong) {
              // 50% retracement of the 48h range — the most traded pullback level
              // Also look for a 1h swing low near that level for confluence
              const fib50 = low48h + range48h * 0.50;
              const swingLows1h = [];
              for (let i = 1; i < completed.length - 1; i++) {
                if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1] && lows[i] < price) {
                  swingLows1h.push(lows[i]);
                }
              }
              // Use swing low nearest to fib50 for confluence, or fib50 alone
              const nearFib = swingLows1h.filter(l => Math.abs(l - fib50) / fib50 < 0.10);
              if (nearFib.length) {
                demandZone = Math.max(...nearFib);
                logger.info(`${signal.symbol}: 1h swing + fib50 confluence at $${demandZone.toPrecision(6)} (fib50 $${fib50.toPrecision(6)}, range $${low48h.toPrecision(4)}-$${high48h.toPrecision(4)})`);
              } else {
                demandZone = fib50;
                logger.info(`${signal.symbol}: fib50 retrace at $${demandZone.toPrecision(6)} (range $${low48h.toPrecision(4)}-$${high48h.toPrecision(4)})`);
              }
            } else {
              // Short: 50% retracement from top + swing high confluence
              const fib50 = high48h - range48h * 0.50;
              const swingHighs1h = [];
              for (let i = 1; i < completed.length - 1; i++) {
                if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1] && highs[i] > price) {
                  swingHighs1h.push(highs[i]);
                }
              }
              const nearFib = swingHighs1h.filter(h => Math.abs(h - fib50) / fib50 < 0.10);
              if (nearFib.length) {
                demandZone = Math.min(...nearFib);
                logger.info(`${signal.symbol}: 1h swing + fib50 confluence at $${demandZone.toPrecision(6)}`);
              } else {
                demandZone = fib50;
                logger.info(`${signal.symbol}: fib50 retrace at $${demandZone.toPrecision(6)}`);
              }
            }
          }
        }

        // Normal entries (or fallback): use 5m candles for nearby swing structure
        if (!demandZone) {
          const candles = await exchange.fetchOHLCV(signal.pair, '5m', undefined, 30);
          if (candles?.length >= 5) {
            const completed = candles.slice(0, -1);

            if (isLong) {
              const swingLows = [];
              for (let i = 1; i < completed.length - 1; i++) {
                if (completed[i][3] < completed[i - 1][3] && completed[i][3] < completed[i + 1][3]) {
                  const lvl = completed[i][3];
                  if (lvl < price && lvl > sl) swingLows.push(lvl);
                }
              }
              if (swingLows.length) {
                demandZone = Math.max(...swingLows);
              } else {
                demandZone = price - (price - sl) * 0.4;
              }
            } else {
              const swingHighs = [];
              for (let i = 1; i < completed.length - 1; i++) {
                if (completed[i][2] > completed[i - 1][2] && completed[i][2] > completed[i + 1][2]) {
                  const lvl = completed[i][2];
                  if (lvl > price && lvl < sl) swingHighs.push(lvl);
                }
              }
              if (swingHighs.length) {
                demandZone = Math.min(...swingHighs);
              } else {
                demandZone = price + (sl - price) * 0.4;
              }
            }
          }
        }

        if (demandZone) {
          logger.info(`${signal.symbol}: demand zone at $${demandZone.toPrecision(6)} (SL $${sl?.toPrecision(6)})`);
        }
      }
    } catch (e) { logger.debug(`Demand zone scan failed for ${signal.symbol}: ${e.message}`); }

    const isOverextended = priceChg >= (this.hybridThreshold || 30);
    this.pendingEntries.set(key, {
      signal,
      queuedAt: Date.now(),
      signalPrice: signal.currentPrice,
      demandZone,
      overextended: isOverextended,
      peakPrice: signal.currentPrice,
    });

    const timeoutMin = isOverextended ? 90 : 30;
    const dzInfo = demandZone ? `\nEntry zone: $${demandZone.toPrecision(6)}` : '';
    logger.info(`Queued ${signal.direction} ${signal.symbol} for ${isOverextended ? 'extended ' : ''}pullback entry at $${signal.currentPrice} (timeout ${timeoutMin}m)`);
    this.notify(
      `⏳ <b>ENTRY QUEUED</b> $${escapeHtml(signal.symbol)}\n\n` +
      `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} — waiting for pullback entry\n` +
      `Signal: $${signal.currentPrice}${dzInfo}\n` +
      `SL: $${signal.stopLoss?.toPrecision(6) || '?'}\n` +
      `Will enter at structure or expire after ${timeoutMin} min` +
      (isOverextended ? `\n⚠️ Extended pullback — price already moved ${priceChg.toFixed(0)}%` : '')
    ).catch(() => {});
  }

  async checkPendingEntries() {
    for (const [key, entry] of this.pendingEntries) {
      try {
        const { signal, queuedAt, signalPrice, overextended } = entry;
        const ageMin = (Date.now() - queuedAt) / 60000;
        const isLong = signal.direction === 'long';
        const timeoutMin = overextended ? 90 : 30;
        const runawayPct = overextended ? 0.20 : 0.05;

        // Re-check: if a position opened since queuing, cancel
        try {
          const openPositions = await db.getOpenTrades(this.settingsKey);
          if (openPositions.find(p => p.symbol === signal.symbol)) {
            logger.info(`Pending ${signal.symbol}: position already open, cancelling queue`);
            this.pendingEntries.delete(key);
            continue;
          }
        } catch (e) { /* proceed with other checks */ }

        const exchange = this.exchanges[signal.exchange];
        if (!exchange) { this.pendingEntries.delete(key); continue; }

        const candles = await exchange.fetchOHLCV(signal.pair, '5m', undefined, 8);
        if (!candles || candles.length < 3) continue;

        const latest = candles[candles.length - 1];
        const [, , , , close] = latest;

        // Price ran away from signal → cancel (wider threshold for overextended)
        const ranAwayWithTrend = isLong ? close > signalPrice * (1 + runawayPct) : close < signalPrice * (1 - runawayPct);
        const ranAgainstTrend = isLong ? close < signalPrice * (1 - runawayPct) : close > signalPrice * (1 + runawayPct);
        if (ranAwayWithTrend || ranAgainstTrend) {
          const reason = ranAgainstTrend ? 'moved against signal' : 'chasing risk too high';
          logger.info(`Pending ${signal.symbol}: price ${reason} ($${signalPrice} → $${close}), cancelling`);
          this.pendingEntries.delete(key);
          await this.notify(
            `⏭ <b>ENTRY CANCELLED</b> $${escapeHtml(signal.symbol)}\n\n` +
            `Price: $${signalPrice} → $${close}\n${ranAgainstTrend ? 'Signal invalidated — price moved against bias.' : 'Skipped — chasing risk too high.'}`
          );
          continue;
        }

        // SL would be at or above current price → instant stop-out, cancel
        if (signal.stopLoss) {
          const slInvalid = isLong ? close <= signal.stopLoss : close >= signal.stopLoss;
          if (slInvalid) {
            logger.info(`Pending ${signal.symbol}: price $${close} already past SL $${signal.stopLoss}, cancelling`);
            this.pendingEntries.delete(key);
            await this.notify(
              `⏭ <b>ENTRY CANCELLED</b> $${escapeHtml(signal.symbol)}\n\n` +
              `Price $${close} already past SL $${signal.stopLoss}\nWould trigger instant stop-out.`
            );
            continue;
          }
        }

        // Track peak price for pullback bounce detection
        if (isLong && close > (entry.peakPrice || 0)) entry.peakPrice = close;
        if (!isLong && (entry.peakPrice === 0 || close < entry.peakPrice)) entry.peakPrice = close;

        // Zone sweep + strong confirmation on COMPLETED candles
        const dz = entry.demandZone;
        const completed = candles.slice(0, -1);
        let confirmed = false;
        let sweepLow = null;

        for (let i = completed.length - 1; i >= Math.max(0, completed.length - 4); i--) {
          const [, cO, cH, cL, cC] = completed[i];
          const touchedZone = dz
            ? (isLong ? cL <= dz * 1.003 : cH >= dz * 0.997)
            : (isLong ? cL < signalPrice * 0.99 : cH > signalPrice * 1.01);
          if (!touchedZone) continue;

          const body = Math.abs(cC - cO);
          const range = cH - cL;
          if (range <= 0) continue;
          const bodyRatio = body / range;
          const lowerWick = Math.min(cO, cC) - cL;
          const upperWick = cH - Math.max(cO, cC);

          if (isLong) {
            const greenClose = cC > cO;
            const zoneReclaim = dz ? cC > dz : true;
            const strongBody = bodyRatio >= 0.3;
            const hammerWick = lowerWick >= body * 1.5 && body > 0;
            if (greenClose && zoneReclaim && (strongBody || hammerWick)) {
              confirmed = true;
              sweepLow = cL;
              break;
            }
          } else {
            const redClose = cC < cO;
            const zoneReclaim = dz ? cC < dz : true;
            const strongBody = bodyRatio >= 0.3;
            const hammerWick = upperWick >= body * 1.5 && body > 0;
            if (redClose && zoneReclaim && (strongBody || hammerWick)) {
              confirmed = true;
              sweepLow = cH;
              break;
            }
          }
        }

        if (confirmed) {
          signal.currentPrice = close;
          if (sweepLow && signal.stopLoss) {
            const tightSL = isLong ? sweepLow * 0.998 : sweepLow * 1.002;
            const tighter = isLong ? tightSL > signal.stopLoss : tightSL < signal.stopLoss;
            if (tighter) signal.stopLoss = tightSL;
          }
          this.pendingEntries.delete(key);
          const result = await this.executeSignal(signal);
          if (result) {
            const saved = Math.abs(((close - signalPrice) / signalPrice) * 100).toFixed(1);
            logger.info(`Pending ${signal.symbol}: demand zone entry at $${close} (signal $${signalPrice}, zone $${dz?.toPrecision(6)}, saved ${saved}%)`);
            await this.notify(
              `🎯 <b>PULLBACK ENTRY</b> $${escapeHtml(signal.symbol)}\n\n` +
              `Signal: $${signalPrice} → Entry: $${close}\n` +
              `${dz ? `Zone: $${dz.toPrecision(6)} | ` : ''}Saved ${saved}% on entry\n` +
              `SL below structure — invalidation = trade dead`
            );
          }
          continue;
        }

        // Overextended pullback bounce: must pull back to near demand zone, not just any dip
        if (!confirmed && overextended && ageMin >= 30 && entry.peakPrice && dz) {
          const prev = completed[completed.length - 1];
          const [, pO, pH, pL, pC] = prev;
          const pullbackFromPeak = isLong
            ? (entry.peakPrice - pL) / entry.peakPrice * 100
            : (pH - entry.peakPrice) / entry.peakPrice * 100;
          const bounced = isLong ? pC > pO && pC > pL + (pH - pL) * 0.5 : pC < pO && pC < pH - (pH - pL) * 0.5;
          // Must be within 5% of demand zone — not just any bounce from a small dip
          const nearZone = isLong ? pL <= dz * 1.05 : pH >= dz * 0.95;
          if (pullbackFromPeak >= 15 && bounced && nearZone) {
            confirmed = true;
            sweepLow = isLong ? pL : pH;
            logger.info(`Pending ${signal.symbol}: pullback bounce near zone $${dz.toPrecision(6)} — pulled back ${pullbackFromPeak.toFixed(0)}% from peak, entering at $${close}`);
          }
        }

        // Timeout — only enter if last candle confirms and price is near demand zone
        if (!confirmed && ageMin >= timeoutMin) {
          this.pendingEntries.delete(key);
          const prev = completed[completed.length - 1];
          const [, pO, , , pC] = prev;
          const lastGreen = isLong ? pC > pO : pC < pO;
          const cheaper = isLong ? close < signalPrice : close > signalPrice;
          // Overextended timeout: must be near demand zone, not just cheaper than signal
          const nearZoneOnTimeout = !overextended || !dz ||
            (isLong ? close <= dz * 1.05 : close >= dz * 0.95);
          if (lastGreen && (cheaper || !overextended) && nearZoneOnTimeout) {
            signal.currentPrice = close;
            logger.info(`Pending ${signal.symbol}: timeout entry at $${close} (candle confirms direction)`);
            await this.executeSignal(signal);
          } else {
            logger.info(`Pending ${signal.symbol}: timeout cancelled — ${!lastGreen ? 'no confirmation' : 'price worse than signal'} after ${ageMin.toFixed(0)}m`);
            await this.notify(
              `⏭ <b>ENTRY EXPIRED</b> $${escapeHtml(signal.symbol)}\n\n` +
              `No ${overextended ? 'pullback' : 'zone sweep'} + confirmation after ${timeoutMin}m\n` +
              (overextended ? 'Price still overextended — skipping.' : 'Price still moving against — skipping.')
            );
          }
          continue;
        }
      } catch (e) {
        logger.debug(`Pending entry check failed for ${key}: ${e.message}`);
      }
    }
  }

  async executeSignal(signal) {
    const check = await this.canTrade(signal);
    if (!check.ok) {
      logger.info(`Trade skipped for ${signal.symbol}: ${check.reason}`);
      if (check.reason.includes('Daily loss limit')) {
        await this.notify(
          `🛑 <b>DAILY LOSS LIMIT</b>\n\n` +
          `Trade skipped: <b>$${signal.symbol}</b> (${signal.direction})\n` +
          `Today's P&L: <b>$${this.dailyPnL.toFixed(2)}</b> / -$${this.maxDailyLoss}\n\n` +
          `<i>Trading paused until daily reset (midnight UTC).</i>`
        );
      }
      return null;
    }

    this.refineWithSMC(signal);

    if (this.mode === 'paper') {
      return this.executePaperTrade(signal);
    } else {
      return this.executeLiveTrade(signal);
    }
  }

  async executePaperTrade(signal) {
    const entryPrice = signal.currentPrice;
    let positionSize = await this.calcPositionSize(signal);
    positionSize = this.applyConfidenceScale(positionSize, signal);
    const leverage = this.calcLeverage(signal);

    // DCA: enter 1/3 at market, set limits for 2/3 and 3/3 (when enabled)
    const entryQty = this.dcaEnabled ? positionSize / 3 : positionSize;
    const dcaQty1 = entryQty / entryPrice;
    const dcaQty2 = this.dcaEnabled ? (positionSize / 3) / entryPrice : 0;
    const dcaQty3 = this.dcaEnabled ? (positionSize / 3) / entryPrice : 0;
    const { dcaPrice2, dcaPrice3 } = this.calcDCALevels(signal);
    const invalidation = this.calcInvalidation(signal);
    this.recalcTPs(signal);
    const tp4 = this.calcTP4(signal);

    const trade = {
      signalId: signal.id || null,
      symbol: signal.symbol,
      exchange: signal.exchange,
      direction: signal.direction,
      mode: 'paper',
      entryPrice,
      quantity: dcaQty1,
      positionSize: entryQty,
      leverage,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      tp4,
      stopLoss: signal.stopLoss,
      originalStopLoss: signal.stopLoss,
      invalidation,
      atr: signal.atr || null,
      dcaQty2,
      dcaQty3,
      dcaPrice2: this.dcaEnabled ? dcaPrice2 : null,
      dcaPrice3: this.dcaEnabled ? dcaPrice3 : null,
      dcaStage: 1,
      status: 'open',
      source: this.settingsKey,
      onchainContext: signal.onchainContext || null,
    };

    await db.saveTrade(trade);
    this.paperBalance -= entryQty;
    this.saveConfig();

    const dcaLabel = this.dcaEnabled ? '(1/3 DCA)' : '(full entry — DCA off)';
    const msg = `📝 <b>PAPER TRADE OPENED</b>\n\n` +
      `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} <b>$${escapeHtml(signal.symbol)}</b>\n` +
      `Exchange: ${signal.exchange}\n` +
      `Entry: $${entryPrice} ${dcaLabel}\n` +
      `Size: $${entryQty.toFixed(2)} (${leverage}x)\n` +
      `${this.dcaEnabled ? `DCA 2: $${dcaPrice2.toPrecision(6)} | DCA 3: $${dcaPrice3.toPrecision(6)}\n` : ''}` +
      `TP1: $${signal.tp1} | TP2: $${signal.tp2} | TP3: $${signal.tp3} | TP4: $${tp4.toPrecision(6)}\n` +
      `SL: $${signal.stopLoss} | Invalidation: $${invalidation.toPrecision(6)}\n\n` +
      `${signal.smc ? `SMC: ${signal.smc.structureBias} structure` + (signal.smc.orderBlocks?.length ? ` | ${signal.smc.orderBlocks.length} OB` : '') + (signal.smc.fvgs?.length ? ` | ${signal.smc.fvgs.length} FVG` : '') + '\n' : ''}` +
      `${this.riskPct > 0 ? `Risk: ${this.riskPct}% of balance\n` : ''}` +
      `<i>Paper mode — trailing SL active</i>`;

    await this.notify(msg);
    logger.info(`Paper trade opened: ${signal.direction} ${signal.symbol} @ $${entryPrice} ${dcaLabel}`);
    return trade;
  }

  async executeLiveTrade(signal) {
    const exchange = this.exchanges[signal.exchange];
    if (!exchange) {
      logger.error(`Exchange ${signal.exchange} not available for live trading`);
      return null;
    }

    if (!exchange.apiKey || !exchange.secret) {
      logger.error(`No API credentials for ${signal.exchange} — falling back to paper`);
      return this.executePaperTrade(signal);
    }

    try {
      const pair = `${signal.symbol}/USDT:USDT`;
      if (!exchange.markets[pair]) {
        logger.error(`Market ${pair} not found on ${signal.exchange}`);
        return null;
      }

      try { await exchange.setMarginMode('cross', pair); } catch (e) { /* may already be set */ }
      const desiredLeverage = this.calcLeverage(signal);
      const leverage = await this.setLeverageWithFallback(exchange, pair, desiredLeverage);

      let positionSize = await this.calcPositionSize(signal);
      positionSize = this.applyConfidenceScale(positionSize, signal);
      const ticker = await exchange.fetchTicker(pair);
      const entryPrice = ticker.last;

      // Check margin: scale down position if balance can't cover it
      try {
        const balances = await this.getAllBalances();
        const bal = balances[signal.exchange];
        const available = bal?.free || bal?.total || 0;
        const requiredMargin = positionSize / leverage;
        if (requiredMargin > available * 0.9) {
          const maxSize = available * 0.9 * leverage;
          if (maxSize < 5) {
            const msg = `⚠️ <b>TRADE SKIPPED</b> $${signal.symbol}\n\nInsufficient margin: $${available.toFixed(2)} available, need $${requiredMargin.toFixed(2)} at ${leverage}x.`;
            await this.notify(msg);
            return null;
          }
          logger.info(`${pair}: margin cap — $${positionSize} → $${maxSize.toFixed(2)} (balance $${available.toFixed(2)} at ${leverage}x)`);
          positionSize = maxSize;
        }
      } catch (e) { logger.warn(`Margin check failed: ${e.message}`); }

      // Stale entry check: reject if price moved >2% from signal price
      const drift = Math.abs(entryPrice - signal.currentPrice) / signal.currentPrice * 100;
      if (drift > 2) {
        const msg = `⚠️ <b>TRADE SKIPPED</b> $${signal.symbol}\n\nPrice drifted ${drift.toFixed(1)}% from signal ($${signal.currentPrice} → $${entryPrice}).\nEntry too late — skipping.`;
        await this.notify(msg);
        logger.info(`${pair}: price drifted ${drift.toFixed(1)}% from signal, skipping`);
        return null;
      }

      // Liquidity check: skip low-volume tokens that cause massive slippage
      if (this.minLiveVolume > 0) {
        const vol24h = ticker.quoteVolume || 0;
        if (vol24h < this.minLiveVolume) {
          const volM = (vol24h / 1e6).toFixed(1);
          const minM = (this.minLiveVolume / 1e6).toFixed(0);
          const msg = `⚠️ <b>TRADE SKIPPED</b> $${escapeHtml(signal.symbol)}\n\n24h volume $${volM}M < $${minM}M minimum.\nLow liquidity = high slippage risk on live orders.`;
          await this.notify(msg);
          logger.info(`${pair}: 24h volume $${volM}M below live min $${minM}M, skipping`);
          return null;
        }
      }

      // DCA: enter 1/3 of position at market when enabled, otherwise full position
      const fullQty = positionSize / entryPrice;
      let dcaQty1 = this.dcaEnabled ? fullQty / 3 : fullQty;

      // Check minimum notional
      const notionalCheck = this.calcMinNotional(exchange, pair, dcaQty1, entryPrice);
      if (!notionalCheck.ok) {
        // Try full position instead of 1/3 DCA
        const fullCheck = this.calcMinNotional(exchange, pair, fullQty, entryPrice);
        if (!fullCheck.ok) {
          const msg = `⚠️ <b>TRADE SKIPPED</b> ${signal.symbol}\n\nPosition too small: $${notionalCheck.currentNotional.toFixed(2)} < $${notionalCheck.minNotional} minimum.\nIncrease trade size or use paper mode.`;
          await this.notify(msg);
          logger.warn(`${pair}: notional $${notionalCheck.currentNotional.toFixed(2)} below min $${notionalCheck.minNotional}, skipping`);
          return null;
        }
        // Use full position (no DCA split) if 1/3 is too small
        dcaQty1 = fullQty;
        logger.info(`${pair}: 1/3 DCA too small, entering full position at once`);
      }

      const market = exchange.markets[pair];
      const roundedQty = exchange.amountToPrecision(pair, dcaQty1);

      const side = signal.direction === 'long' ? 'buy' : 'sell';
      const order = await exchange.createOrder(pair, 'market', side, roundedQty);

      logger.info(`Live order placed: ${side} ${roundedQty} ${pair} (1/3 DCA)`);

      // Place SL at the signal's structural level — derived from swing lows, OB walls,
      // liq zones in buildTradeSetup. Max loss cap enforced by checkOpenTrades every minute.
      const closeSide = signal.direction === 'long' ? 'sell' : 'buy';
      let effectiveSL = signal.stopLoss;
      try {
        const slPrice = exchange.priceToPrecision(pair, effectiveSL);
        await this.placeStopOrder(exchange, signal.exchange, pair, closeSide, roundedQty, slPrice);
      } catch (e) {
        logger.error(`SL order failed for ${pair}: ${e.message} — closing position for safety`);
        try {
          await exchange.createOrder(pair, 'market', closeSide, roundedQty, undefined, { reduceOnly: true });
          await this.notify(`⚠️ <b>SL ORDER FAILED</b> — $${escapeHtml(signal.symbol)}\n\nClosed position immediately for safety.\nError: ${escapeHtml(e.message)}`);
          return null;
        } catch (closeErr) {
          await this.notify(`🚨 <b>CRITICAL</b> — $${escapeHtml(signal.symbol)}\n\nSL order failed AND close failed!\nPosition is UNPROTECTED on ${signal.exchange}.\nClose manually NOW!\nError: ${escapeHtml(closeErr.message)}`);
        }
      }

      // Place DCA limit orders for parts 2 and 3 (skip if we used full position above)
      const { dcaPrice2, dcaPrice3 } = this.calcDCALevels(signal);
      const usedFullEntry = dcaQty1 >= fullQty * 0.9;
      let dcaQty2Rounded, dcaQty3Rounded;

      if (!usedFullEntry) {
        dcaQty2Rounded = exchange.amountToPrecision(pair, fullQty / 3);
        dcaQty3Rounded = exchange.amountToPrecision(pair, fullQty / 3);

        const dca2Check = this.calcMinNotional(exchange, pair, fullQty / 3, dcaPrice2);
        if (dca2Check.ok) {
          try {
            await exchange.createOrder(pair, 'limit', side, dcaQty2Rounded, exchange.priceToPrecision(pair, dcaPrice2));
            logger.info(`DCA2 limit order placed at $${dcaPrice2.toPrecision(6)}`);
          } catch (e) { logger.warn(`DCA2 order failed: ${e.message}`); }
        } else { logger.info(`DCA2 skipped: below min notional`); }

        const dca3Check = this.calcMinNotional(exchange, pair, fullQty / 3, dcaPrice3);
        if (dca3Check.ok) {
          try {
            await exchange.createOrder(pair, 'limit', side, dcaQty3Rounded, exchange.priceToPrecision(pair, dcaPrice3));
            logger.info(`DCA3 limit order placed at $${dcaPrice3.toPrecision(6)}`);
          } catch (e) { logger.warn(`DCA3 order failed: ${e.message}`); }
        } else { logger.info(`DCA3 skipped: below min notional`); }
      } else {
        dcaQty2Rounded = '0';
        dcaQty3Rounded = '0';
        logger.info(`DCA orders skipped — entered full position at once`);
      }

      const invalidation = this.calcInvalidation(signal);
      this.recalcTPs(signal);
      const tp4 = this.calcTP4(signal);

      const trade = {
        signalId: signal.id || null,
        symbol: signal.symbol,
        exchange: signal.exchange,
        direction: signal.direction,
        mode: 'live',
        entryPrice: order.average || order.price || entryPrice,
        quantity: parseFloat(roundedQty),
        positionSize: usedFullEntry ? positionSize : positionSize / 3,
        leverage,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        tp4,
        stopLoss: signal.stopLoss,
        originalStopLoss: signal.stopLoss,
        invalidation,
        atr: signal.atr || null,
        dcaQty2: usedFullEntry ? 0 : parseFloat(dcaQty2Rounded),
        dcaQty3: usedFullEntry ? 0 : parseFloat(dcaQty3Rounded),
        dcaPrice2: usedFullEntry ? null : dcaPrice2,
        dcaPrice3: usedFullEntry ? null : dcaPrice3,
        dcaStage: usedFullEntry ? 3 : 1,
        orderId: order.id,
        status: 'open',
        source: this.settingsKey,
        onchainContext: signal.onchainContext || null,
      };

      await db.saveTrade(trade);

      // Place exchange-level TP limit orders for reliability
      await this.placeTPOrders(trade);

      const entryLabel = usedFullEntry ? 'full entry (size too small for DCA)' : '1/3 DCA';
      const sizeLabel = usedFullEntry ? `$${positionSize.toFixed(2)}` : `$${(positionSize / 3).toFixed(2)} of $${positionSize.toFixed(2)}`;
      const dcaLine = usedFullEntry ? 'DCA: disabled (min notional)' : `DCA 2: $${dcaPrice2.toPrecision(6)} | DCA 3: $${dcaPrice3.toPrecision(6)}`;
      const levNote = leverage !== desiredLeverage ? ` (wanted ${desiredLeverage}x)` : '';
      const msg = `🔴 <b>LIVE TRADE EXECUTED</b> 🔴\n\n` +
        `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} <b>$${escapeHtml(signal.symbol)}</b>\n` +
        `Exchange: ${signal.exchange}\n` +
        `Entry: $${trade.entryPrice} (${entryLabel})\n` +
        `Size: ${sizeLabel} (${leverage}x${levNote})\n` +
        `${dcaLine}\n` +
        `TP1-4: $${signal.tp1} / $${signal.tp2} / $${signal.tp3} / $${tp4.toPrecision(6)}\n` +
        `SL: $${signal.stopLoss} | Invalidation: $${invalidation.toPrecision(6)}\n` +
        `Order ID: <code>${order.id}</code>\n\n` +
        `⚠️ <b>LIVE TRADE — Real funds at risk</b>`;

      await this.notify(msg);
      return trade;

    } catch (err) {
      // Bybit lists contracts before they're tradeable — retry after delay
      if (err.message && err.message.includes('110074') && (!signal._listingRetries || signal._listingRetries < 3)) {
        signal._listingRetries = (signal._listingRetries || 0) + 1;
        const delaySec = signal._listingRetries * 30;
        logger.info(`${signal.symbol}: contract not live yet, retry ${signal._listingRetries}/3 in ${delaySec}s`);
        await new Promise(r => setTimeout(r, delaySec * 1000));
        return this.executeLiveTrade(signal);
      }
      const errMsg = `❌ <b>TRADE EXECUTION FAILED</b>\n\n$${escapeHtml(signal.symbol)} on ${signal.exchange}\nError: ${escapeHtml(err.message)}`;
      await this.notify(errMsg);
      logger.error(`Live trade failed for ${signal.symbol}: ${err.message}`);
      return null;
    }
  }

  async checkOpenTrades() {
    this.resetDailyPnL();
    const trades = await db.getOpenTrades(this.settingsKey);
    const updates = [];

    for (const trade of trades) {
      try {
        let exchange = this.exchanges[trade.exchange];
        if (!exchange) exchange = Object.values(this.exchanges)[0];
        if (!exchange) continue;

        const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
        let currentPrice = null;
        let exitPrice = null;
        let ohlcv = null;
        for (const pair of pairs) {
          if (exchange.markets?.[pair]) {
            const ticker = await exchange.fetchTicker(pair);
            currentPrice = ticker.last;
            // For live trades, use bid/ask for realistic exit pricing
            // Long sells at bid, short covers at ask
            if (trade.mode === 'live') {
              exitPrice = trade.direction === 'long'
                ? (ticker.bid || ticker.last)
                : (ticker.ask || ticker.last);
            } else {
              exitPrice = currentPrice;
            }
            try {
              ohlcv = await exchange.fetchOHLCV(pair, '4h', undefined, 2);
            } catch (e) { /* ok — invalidation check will be skipped */ }
            // Fetch recent 1m candles to catch intra-minute spikes/dips for TP/SL
            try {
              const ohlcv1m = await exchange.fetchOHLCV(pair, '1m', undefined, 3);
              if (ohlcv1m && ohlcv1m.length > 0) {
                trade._recentHigh = Math.max(...ohlcv1m.map(c => c[2]));
                trade._recentLow = Math.min(...ohlcv1m.map(c => c[3]));
              }
            } catch (e) { /* ok — falls back to currentPrice only */ }
            break;
          }
        }
        // If pair not found, try reloading markets (may have been added/suspended)
        if (!currentPrice) {
          try {
            await exchange.loadMarkets(true);
            for (const pair of pairs) {
              if (exchange.markets?.[pair]) {
                const ticker = await exchange.fetchTicker(pair);
                currentPrice = ticker.last;
                exitPrice = trade.mode === 'live'
                  ? (trade.direction === 'long' ? (ticker.bid || ticker.last) : (ticker.ask || ticker.last))
                  : currentPrice;
                break;
              }
            }
          } catch (e) { /* reload failed */ }
        }
        if (!currentPrice) {
          // Orphan trade: can't find market — warn once per hour
          const orphanKey = `orphan:${trade.symbol}:${trade.exchange}`;
          const lastWarn = this._orphanWarnings?.get(orphanKey) || 0;
          if (Date.now() - lastWarn > 60 * 60 * 1000) {
            if (!this._orphanWarnings) this._orphanWarnings = new Map();
            this._orphanWarnings.set(orphanKey, Date.now());
            const ageH = ((Date.now() - new Date(trade.created_at).getTime()) / 3600000).toFixed(1);
            await this.notify(
              `⚠️ <b>ORPHAN TRADE</b>\n\n` +
              `$${escapeHtml(trade.symbol)} on ${trade.exchange} — can't fetch price.\n` +
              `Trade open for ${ageH}h, mode: ${trade.mode}\n` +
              `Entry: $${trade.entry_price} | Direction: ${trade.direction}\n\n` +
              `<i>Market may be delisted or suspended. Check manually!</i>`
            );
            logger.warn(`Orphan trade: ${trade.symbol} on ${trade.exchange} — market not found`);
          }
          continue;
        }

        const isLong = trade.direction === 'long';

        // --- DCA CHECK: fill DCA 2 and DCA 3 if price reaches levels ---
        await this.checkDCAFills(trade, currentPrice, isLong);

        // P&L uses exitPrice (bid/ask for live, last for paper) for realistic tracking
        const pnlPct = isLong
          ? ((exitPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - exitPrice) / trade.entry_price) * 100;
        const pnlUsd = (pnlPct / 100) * trade.position_size;

        // Always track peak price — use candle high/low to catch intra-minute spikes
        const prevPeak = trade.peak_price || trade.entry_price;
        const bestPrice = isLong
          ? Math.max(currentPrice, trade._recentHigh || currentPrice)
          : Math.min(currentPrice, trade._recentLow || currentPrice);
        const curPeak = isLong
          ? Math.max(prevPeak, bestPrice)
          : Math.min(prevPeak, bestPrice);
        // Use candle extremes for TP/SL checks to never miss a spike
        const tpCheckPrice = isLong ? (trade._recentHigh || currentPrice) : (trade._recentLow || currentPrice);
        const slCheckPrice = isLong ? (trade._recentLow || currentPrice) : (trade._recentHigh || currentPrice);
        if (curPeak !== prevPeak) {
          await db.updateTradePeakPrice(trade.id, curPeak);
          trade.peak_price = curPeak;
        }

        let action = null;

        const tradeAgeMs = Date.now() - new Date(trade.created_at).getTime();

        // --- TIME-BASED EXIT: edge decays after 30-60 min ---
        if (this.timeExitMinutes > 0 && !action && !trade.hit_tp1 && tradeAgeMs > this.timeExitMinutes * 0.5 * 60 * 1000) {
          if (pnlUsd > 0 && tradeAgeMs < this.timeExitMinutes * 60 * 1000) {
            // Half-time in profit, no TP1: trail SL to breakeven + 1%
            const beTrail = isLong ? trade.entry_price * 1.01 : trade.entry_price * 0.99;
            const currentSL = trade.stop_loss;
            const priceAboveTrail = isLong ? currentPrice > beTrail : currentPrice < beTrail;
            const shouldMove = priceAboveTrail && (isLong ? beTrail > currentSL : beTrail < currentSL);
            if (shouldMove) {
              await db.updateTradeStopLoss(trade.id, beTrail);
              await this.updateExchangeSL(trade, beTrail);
              trade.stop_loss = beTrail;
              action = 'time_trail';
              logger.info(`${trade.symbol}: ${this.timeExitMinutes / 2}min+ in profit, no TP1 — SL trailed to breakeven+1% ($${beTrail.toPrecision(6)})`);
            }
          } else if (tradeAgeMs > this.timeExitMinutes * 60 * 1000) {
            // Full time, no TP1: close the trade — edge is gone
            action = 'time_exit';
            await db.closeTrade(trade.id, exitPrice, pnlPct, pnlUsd, 'time_exit');
            this.dailyPnL += pnlUsd;
            if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
            this.cooldowns.set(trade.symbol.toUpperCase(), pnlUsd > 0
              ? { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() }
              : { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
            logger.info(`${trade.symbol}: ${this.timeExitMinutes}min+ no TP1 — time exit at $${currentPrice} (${pnlPct.toFixed(2)}%, $${pnlUsd.toFixed(2)})`);
          }
        }

        // --- SMC THESIS RE-CHECK: every 15 min, re-run SMC to detect structure flip ---
        if (!action && tradeAgeMs > 30 * 60 * 1000 && !trade.hit_tp1) {
          const lastRecheck = trade._lastSmcRecheck || 0;
          if (Date.now() - lastRecheck > 15 * 60 * 1000) {
            trade._lastSmcRecheck = Date.now();
            try {
              const pair = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`].find(p => exchange.markets?.[p]);
              if (pair) {
                const ohlcv1h = await exchange.fetchOHLCV(pair, '1h', undefined, 100);
                if (ohlcv1h && ohlcv1h.length >= 20) {
                  const SMCAnalyzer = require('../collectors/smcAnalyzer');
                  const smc = new SMCAnalyzer();
                  const result = smc.analyze(ohlcv1h);
                  if (result && result.structureBias !== 'neutral') {
                    const structureConflict = (isLong && result.structureBias === 'bearish') ||
                      (!isLong && result.structureBias === 'bullish');
                    const hasChoch = isLong
                      ? result.chochEvents.some(e => e.type === 'CHOCH_BEARISH')
                      : result.chochEvents.some(e => e.type === 'CHOCH_BULLISH');
                    if (structureConflict && hasChoch && pnlUsd < 0) {
                      action = 'thesis_broken';
                      await db.closeTrade(trade.id, exitPrice, pnlPct, pnlUsd, 'thesis_broken');
                      this.dailyPnL += pnlUsd;
                      if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
                      this.cooldowns.set(trade.symbol.toUpperCase(), { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
                      logger.info(`${trade.symbol}: SMC structure flipped ${result.structureBias} with ChoCH — thesis broken, closing`);
                    }
                  }
                }
              }
            } catch (e) { /* SMC recheck failed, skip */ }
          }
        }

        // --- INVALIDATION CHECK: 4H candle close below invalidation level ---
        // Skip if trade opened less than 4h ago (previous candle is pre-breakout)
        if (trade.invalidation && ohlcv && ohlcv.length >= 2 && tradeAgeMs > 4 * 60 * 60 * 1000) {
          const prevCandle = ohlcv[ohlcv.length - 2];
          const prevClose = prevCandle[4];
          const invalidated = isLong
            ? prevClose < trade.invalidation
            : prevClose > trade.invalidation;
          if (invalidated) {
            action = 'invalidated';
            await db.closeTrade(trade.id, exitPrice, pnlPct, pnlUsd, 'invalidated');
            this.dailyPnL += pnlUsd;
            if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
            this.cooldowns.set(trade.symbol.toUpperCase(), { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
          }
        }

        // --- TP4 CHECK: close remaining runner ---
        if (!action && trade.tp4 && (isLong ? tpCheckPrice >= trade.tp4 : tpCheckPrice <= trade.tp4)) {
          action = 'tp4';
          const tpExit = trade.mode === 'paper' ? (isLong ? Math.max(exitPrice, trade.tp4) : Math.min(exitPrice, trade.tp4)) : exitPrice;
          const tpPnlPct = isLong ? ((tpExit - trade.entry_price) / trade.entry_price) * 100 : ((trade.entry_price - tpExit) / trade.entry_price) * 100;
          const tpPnlUsd = (tpPnlPct / 100) * trade.position_size;
          await db.closeTrade(trade.id, tpExit, tpPnlPct, tpPnlUsd, 'tp4');
          this.dailyPnL += tpPnlUsd;
          if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + tpPnlUsd;
          this.cooldowns.set(trade.symbol.toUpperCase(), { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
        }
        // --- TP3 CHECK: close 50% remaining, keep ~25% original as runner, SL to TP2 ---
        else if (!action && !trade.hit_tp3 && trade.tp3 && (isLong ? tpCheckPrice >= trade.tp3 : tpCheckPrice <= trade.tp3)) {
          action = 'tp3';
          await db.updateTradeHit(trade.id, 'hit_tp3');
          const tpExit = trade.mode === 'paper' ? (isLong ? Math.max(exitPrice, trade.tp3) : Math.min(exitPrice, trade.tp3)) : exitPrice;
          const partialPnl = await this.partialClosePosition(trade, 0.5, tpExit);
          const newSL = trade.tp2;
          await db.updateTradeStopLoss(trade.id, newSL);
          await this.updateExchangeSL(trade, newSL);
          logger.info(`${trade.symbol}: TP3 hit, closed 50% (+$${partialPnl.toFixed(2)}), runner remains — SL to TP2`);
        }
        // --- TP2 CHECK: close tp2ClosePct of remaining, trail SL to TP1 ---
        else if (!action && !trade.hit_tp2 && trade.tp2 && (isLong ? tpCheckPrice >= trade.tp2 : tpCheckPrice <= trade.tp2)) {
          action = 'tp2';
          await db.updateTradeHit(trade.id, 'hit_tp2');
          const tpExit = trade.mode === 'paper' ? (isLong ? Math.max(exitPrice, trade.tp2) : Math.min(exitPrice, trade.tp2)) : exitPrice;
          if (this.tp2ClosePct >= 1.0) {
            const partialPnl = await this.partialClosePosition(trade, 1.0, tpExit);
            const tpPnlPct = isLong ? ((tpExit - trade.entry_price) / trade.entry_price) * 100 : ((trade.entry_price - tpExit) / trade.entry_price) * 100;
            const tpPnlUsd = (tpPnlPct / 100) * trade.position_size;
            await db.closeTrade(trade.id, tpExit, tpPnlPct, tpPnlUsd, 'tp2');
            this.dailyPnL += tpPnlUsd;
            if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + tpPnlUsd;
            logger.info(`${trade.symbol}: TP2 hit, closed ALL remaining (+$${partialPnl.toFixed(2)}) — trade done`);
          } else {
            const partialPnl = await this.partialClosePosition(trade, this.tp2ClosePct, tpExit);
            const newSL = trade.tp1;
            await db.updateTradeStopLoss(trade.id, newSL);
            await this.updateExchangeSL(trade, newSL);
            logger.info(`${trade.symbol}: TP2 hit, closed ${(this.tp2ClosePct * 100).toFixed(0)}% (+$${partialPnl.toFixed(2)}), SL to TP1`);
          }
        }
        // --- TP1 CHECK: close tp1ClosePct of position, trail SL to breakeven ---
        else if (!action && !trade.hit_tp1 && trade.tp1 && (isLong ? tpCheckPrice >= trade.tp1 : tpCheckPrice <= trade.tp1)) {
          action = 'tp1';
          await db.updateTradeHit(trade.id, 'hit_tp1');
          const tpExit = trade.mode === 'paper' ? (isLong ? Math.max(exitPrice, trade.tp1) : Math.min(exitPrice, trade.tp1)) : exitPrice;
          const partialPnl = await this.partialClosePosition(trade, this.tp1ClosePct, tpExit);
          const newSL = trade.entry_price;
          await db.updateTradeStopLoss(trade.id, newSL);
          await this.updateExchangeSL(trade, newSL);
          logger.info(`${trade.symbol}: TP1 hit, closed ${(this.tp1ClosePct * 100).toFixed(0)}% (+$${partialPnl.toFixed(2)}), SL to breakeven`);
        }
        // --- TRAILING STOP: after TP1, trail tightens proportionally to profit ---
        if (!action && trade.hit_tp1 && trade.atr) {
          const peak = trade.peak_price || trade.entry_price;
          const newPeak = isLong
            ? Math.max(peak, bestPrice)
            : Math.min(peak, bestPrice);

          if (newPeak !== peak) {
            await db.updateTradePeakPrice(trade.id, newPeak);
            trade.peak_price = newPeak;
          }

          const profitDist = Math.abs(newPeak - trade.entry_price);
          let trailDist;
          if (trade.hit_tp3) {
            trailDist = Math.min(trade.atr * this.trailAtrMultPost, profitDist * 0.25);
          } else if (trade.hit_tp2) {
            trailDist = Math.min(trade.atr * this.trailAtrMultPre, profitDist * 0.3);
          } else {
            trailDist = Math.min(trade.atr * this.trailAtrMultPre, profitDist * 0.4);
          }

          const trailSL = isLong ? newPeak - trailDist : newPeak + trailDist;
          const currentSL = trade.stop_loss;
          const aboveBE = isLong ? trailSL > trade.entry_price : trailSL < trade.entry_price;
          const shouldUpdate = (isLong ? trailSL > currentSL : trailSL < currentSL) && aboveBE;
          if (shouldUpdate) {
            await db.updateTradeStopLoss(trade.id, trailSL);
            await this.updateExchangeSL(trade, trailSL);
            trade.stop_loss = trailSL;
            action = 'trail';
            logger.info(`${trade.symbol}: trailing SL → $${trailSL.toPrecision(6)} (peak $${newPeak.toPrecision(6)}, protects ${((1 - trailDist / profitDist) * 100).toFixed(0)}%)`);
          }
        }

        // --- PROFIT PROTECTION + PRE-TP1 TRAIL: lock in gains before TP1 ---
        // Trigger at 2.5% price move OR 12% leveraged ROI (whichever comes first)
        const leveragedPnl = pnlPct * (trade.leverage || 1);
        if (!action && !trade.hit_tp1 && (pnlPct > this.profitProtectPct || leveragedPnl > this.profitProtectLevPnl)) {
          const currentSL = trade.stop_loss;
          const atBreakeven = isLong ? currentSL >= trade.entry_price : currentSL <= trade.entry_price;
          if (!atBreakeven) {
            // First trigger: move SL to breakeven
            const newSL = trade.entry_price;
            await db.updateTradeStopLoss(trade.id, newSL);
            await this.updateExchangeSL(trade, newSL);
            action = 'profit_protect';
            logger.info(`${trade.symbol}: +${pnlPct.toFixed(1)}% — SL moved to breakeven for profit protection`);
          } else if (trade.atr) {
            const profitDist = Math.abs((trade.peak_price || currentPrice) - trade.entry_price);
            const trailDist = Math.min(trade.atr * this.trailAtrMultPre, profitDist * this.trailGivebackPct || trade.atr * this.trailAtrMultPre);
            const peak = trade.peak_price || trade.entry_price;
            const newPeak = isLong ? Math.max(peak, bestPrice) : Math.min(peak, bestPrice);
            if (newPeak !== peak) {
              await db.updateTradePeakPrice(trade.id, newPeak);
              trade.peak_price = newPeak;
            }
            const trailSL = isLong ? newPeak - trailDist : newPeak + trailDist;
            // Only move SL up (never down), and only if above breakeven
            const aboveBreakeven = isLong ? trailSL > trade.entry_price : trailSL < trade.entry_price;
            const shouldUpdate = isLong ? trailSL > currentSL : trailSL < currentSL;
            if (shouldUpdate && aboveBreakeven) {
              await db.updateTradeStopLoss(trade.id, trailSL);
              await this.updateExchangeSL(trade, trailSL);
              trade.stop_loss = trailSL;
              action = 'trail';
              logger.info(`${trade.symbol}: pre-TP1 trail SL → $${trailSL.toPrecision(6)} (peak $${newPeak.toPrecision(6)})`);
            }
          }
        }
        // --- PER-TRADE LOSS CAP (with buffer to avoid overshoot) ---
        if (!action && this.maxLossPerTrade > 0 && pnlUsd < 0) {
          const effectiveCap = this.maxLossPerTrade * (this.lossBufferPct / 100);
          if (Math.abs(pnlUsd) >= effectiveCap) {
            action = 'max_loss';
            await db.closeTrade(trade.id, exitPrice, pnlPct, pnlUsd, 'max_loss');
            this.dailyPnL += pnlUsd;
            if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
            if (trade.mode === 'live') await this.closeExchangePosition(trade);
            this.cooldowns.set(trade.symbol.toUpperCase(), { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
            logger.info(`${trade.symbol}: Per-trade loss cap hit ($${pnlUsd.toFixed(2)} >= -$${effectiveCap.toFixed(2)}, cap $${this.maxLossPerTrade} × ${this.lossBufferPct}%)`);
          }
        }
        // --- SL CHECK: use candle low/high to catch intra-minute wicks ---
        else if (!action && trade.stop_loss && (isLong ? slCheckPrice <= trade.stop_loss : slCheckPrice >= trade.stop_loss)) {
          action = 'sl';
          // Paper: SL price as exit; Live: bid/ask for realistic fill
          const slExitPrice = trade.mode === 'paper' ? trade.stop_loss : exitPrice;
          const slPnlPct = isLong
            ? ((slExitPrice - trade.entry_price) / trade.entry_price) * 100
            : ((trade.entry_price - slExitPrice) / trade.entry_price) * 100;
          const slPnlUsd = (slPnlPct / 100) * (trade.position_size || 0);
          await db.closeTrade(trade.id, slExitPrice, slPnlPct, slPnlUsd, 'sl');
          this.dailyPnL += slPnlUsd;
          if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + slPnlUsd;
          this.cooldowns.set(trade.symbol.toUpperCase(), { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
        }
        // --- AUTO-CLOSE AFTER maxTradeAge ---
        else if (!action && Date.now() - new Date(trade.created_at).getTime() > this.maxTradeAge) {
          action = 'expired';
          await db.closeTrade(trade.id, exitPrice, pnlPct, pnlUsd, 'expired');
          this.dailyPnL += pnlUsd;
          if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
          this.cooldowns.set(trade.symbol.toUpperCase(), pnlUsd > 0
            ? { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() }
            : { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });
        }

        if (action) {
          if (trade.mode === 'live' && ['tp4', 'sl', 'max_loss', 'invalidated', 'expired', 'thesis_broken', 'time_exit'].includes(action)) {
            await this.closeExchangePosition(trade);
          }
          if (['tp4', 'sl', 'invalidated', 'expired', 'max_loss', 'thesis_broken', 'time_exit'].includes(action)) {
            this.saveConfig();
          }

          const msg = this.formatTradeUpdate(trade, action, currentPrice, pnlPct, pnlUsd);
          updates.push({ trade, action, msg });
          await this.notify(msg);
        }
      } catch (err) {
        logger.error(`Trade check error for ${trade.symbol}: ${err.message}`);
      }
    }

    return updates;
  }

  async reconcileExchangePositions() {
    if (this.mode !== 'live') return;
    const now = Date.now();
    if (this._lastReconcile && now - this._lastReconcile < 5 * 60 * 1000) return;
    this._lastReconcile = now;

    try {
      const openTrades = await db.getOpenTrades(this.settingsKey);
      const trackedSymbols = new Set(openTrades.map(t => `${t.symbol}:${t.exchange}`));

      for (const [exchId, exchange] of Object.entries(this.exchanges)) {
        if (!exchange.apiKey) continue;
        try {
          const positions = await exchange.fetchPositions();
          for (const pos of positions) {
            if (!pos.contracts || Math.abs(pos.contracts) === 0) continue;
            const base = pos.symbol?.split('/')[0];
            if (!base) continue;
            const key = `${base}:${exchId}`;
            if (!trackedSymbols.has(key)) {
              const warnKey = `reconcile:${key}`;
              const lastWarn = this._orphanWarnings?.get(warnKey) || 0;
              if (now - lastWarn > 30 * 60 * 1000) {
                if (!this._orphanWarnings) this._orphanWarnings = new Map();
                this._orphanWarnings.set(warnKey, now);
                const side = pos.side || (pos.contracts > 0 ? 'long' : 'short');
                const size = Math.abs(pos.notional || pos.contracts * (pos.markPrice || 0));
                const pnl = pos.unrealizedPnl || 0;
                await this.notify(
                  `⚠️ <b>ORPHAN POSITION</b>\n\n` +
                  `${base}/USDT on ${exchId}\n` +
                  `Side: ${side} | Size: $${size.toFixed(2)} | uPnL: $${Number(pnl).toFixed(2)}\n` +
                  `Entry: $${pos.entryPrice || '?'} | Mark: $${pos.markPrice || '?'}\n\n` +
                  `<i>Not tracked by bot — close manually or investigate</i>`
                );
                logger.warn(`Orphan position: ${base} on ${exchId} — not in DB`);
              }
            }
          }
        } catch (e) { logger.debug(`Reconcile fetch failed for ${exchId}: ${e.message}`); }
      }
    } catch (e) { logger.error(`Reconcile error: ${e.message}`); }
  }

  async checkDCAFills(trade, currentPrice, isLong) {
    // DCA 2: price reached DCA level 2 and not yet filled
    if (trade.dca_price_2 && !trade.dca_filled_2) {
      const dcaHit = isLong ? currentPrice <= trade.dca_price_2 : currentPrice >= trade.dca_price_2;
      if (dcaHit) {
        const newQty = trade.quantity + (trade.dca_qty_2 || trade.quantity);
        const newEntry = ((trade.entry_price * trade.quantity) + (trade.dca_price_2 * (trade.dca_qty_2 || trade.quantity))) / newQty;
        const newSize = trade.position_size + (trade.position_size); // add another 1/3

        await db.updateTradeDCA(trade.id, 2, newEntry, newQty);
        // Update local trade object for subsequent checks this cycle
        trade.entry_price = newEntry;
        trade.quantity = newQty;
        trade.position_size = newSize;
        trade.dca_filled_2 = true;

        const msg = `📝 <b>DCA 2/3 FILLED</b> $${escapeHtml(trade.symbol)}\n\n` +
          `Added at $${trade.dca_price_2.toPrecision(6)}\n` +
          `New avg entry: $${newEntry.toPrecision(6)}\n` +
          `Position now 2/3 filled`;
        if (trade.mode === 'paper') { this.paperBalance -= trade.position_size / 2; this.saveConfig(); }
        await this.notify(msg);
        logger.info(`${trade.symbol}: DCA 2/3 filled at $${trade.dca_price_2}`);
      }
    }

    // DCA 3: price reached DCA level 3 and not yet filled
    if (trade.dca_price_3 && !trade.dca_filled_3 && trade.dca_filled_2) {
      const dcaHit = isLong ? currentPrice <= trade.dca_price_3 : currentPrice >= trade.dca_price_3;
      if (dcaHit) {
        const newQty = trade.quantity + (trade.dca_qty_3 || trade.quantity / 2);
        const newEntry = ((trade.entry_price * trade.quantity) + (trade.dca_price_3 * (trade.dca_qty_3 || trade.quantity / 2))) / newQty;
        const newSize = trade.position_size + (trade.position_size / 2);

        await db.updateTradeDCA(trade.id, 3, newEntry, newQty);
        trade.entry_price = newEntry;
        trade.quantity = newQty;
        trade.position_size = newSize;
        trade.dca_filled_3 = true;

        const msg = `📝 <b>DCA 3/3 FILLED</b> $${escapeHtml(trade.symbol)}\n\n` +
          `Added at $${trade.dca_price_3.toPrecision(6)}\n` +
          `New avg entry: $${newEntry.toPrecision(6)}\n` +
          `Full position now open`;
        if (trade.mode === 'paper') { this.paperBalance -= trade.position_size / 3; this.saveConfig(); }
        await this.notify(msg);
        logger.info(`${trade.symbol}: DCA 3/3 filled at $${trade.dca_price_3}`);
      }
    }
  }

  async partialClosePosition(trade, fraction) {
    const closeQty = trade.quantity * fraction;
    const remainQty = trade.quantity - closeQty;
    const remainSize = trade.position_size * (1 - fraction);
    const isLong = trade.direction === 'long';
    const pnlPct = isLong
      ? ((trade.stop_loss - trade.entry_price) / trade.entry_price) * 100
      : ((trade.entry_price - trade.stop_loss) / trade.entry_price) * 100;

    if (trade.mode === 'live') {
      const exchange = this.exchanges[trade.exchange];
      if (exchange?.apiKey) {
        try {
          const pair = `${trade.symbol}/USDT:USDT`;
          // Cancel exchange TP limit orders first — avoid double execution
          await this.cancelTPOrders(trade);
          const side = isLong ? 'sell' : 'buy';
          const roundedQty = exchange.amountToPrecision(pair, closeQty);
          await exchange.createOrder(pair, 'market', side, roundedQty, undefined, { reduceOnly: true });
          logger.info(`Partial close ${(fraction * 100).toFixed(0)}% of ${pair}: ${roundedQty}`);
          // Re-place TP orders for remaining position after partial exit
          if (fraction < 1.0) {
            await this.placeTPOrders(trade);
          }
        } catch (e) { logger.error(`Partial close failed for ${trade.symbol}: ${e.message}`); }
      }
    }

    const currentPrice = arguments[2] || trade.entry_price;
    const partialPnlPct = isLong
      ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
      : ((trade.entry_price - currentPrice) / trade.entry_price) * 100;
    const partialPnlUsd = (partialPnlPct / 100) * (trade.position_size * fraction);

    await db.updateTradePartialClose(trade.id, remainQty, remainSize, partialPnlUsd);
    this.dailyPnL += partialPnlUsd;
    if (trade.mode === 'paper') this.paperBalance += (trade.position_size * fraction) + partialPnlUsd;

    trade.quantity = remainQty;
    trade.position_size = remainSize;
    return partialPnlUsd;
  }

  async closeExchangePosition(trade) {
    const exchange = this.exchanges[trade.exchange];
    if (!exchange || !exchange.apiKey) return null;

    try {
      const pair = `${trade.symbol}/USDT:USDT`;
      try {
        await exchange.cancelAllOrders(pair);
        logger.info(`Cancelled open orders for ${pair}`);
      } catch (e) { logger.warn(`Cancel orders failed for ${pair}: ${e.message}`); }

      // Fetch actual position size from exchange (may differ after partial closes)
      let qty = trade.quantity;
      try {
        const positions = await exchange.fetchPositions([pair]);
        const pos = positions.find(p => p.symbol === pair && Math.abs(p.contracts || 0) > 0);
        if (pos && Math.abs(pos.contracts) > 0) {
          qty = Math.abs(pos.contracts);
          logger.info(`Actual position size for ${pair}: ${qty} (trade.quantity was ${trade.quantity})`);
        } else if (pos && pos.contractSize && pos.notional) {
          qty = Math.abs(pos.notional / pos.contractSize);
        } else if (!pos) {
          logger.info(`No open position found for ${pair} — already closed on exchange`);
          return null;
        }
      } catch (e) { logger.warn(`Could not fetch position for ${pair}, using trade.quantity: ${e.message}`); }

      const side = trade.direction === 'long' ? 'sell' : 'buy';
      let fillPrice = null;

      // Try limit order first (0.3% tolerance) to avoid slippage on thin books
      try {
        const ticker = await exchange.fetchTicker(pair);
        const slipTol = 0.003;
        const limitPrice = side === 'sell'
          ? ticker.last * (1 - slipTol)
          : ticker.last * (1 + slipTol);
        const precisePrice = exchange.priceToPrecision(pair, limitPrice);
        const order = await exchange.createOrder(pair, 'limit', side, qty, precisePrice, { reduceOnly: true, timeInForce: 'IOC' });
        fillPrice = order.average || order.price || parseFloat(precisePrice);
        logger.info(`Closed live position with IOC limit: ${pair} at $${precisePrice} (fill: $${fillPrice}) on ${trade.exchange}`);

        // Verify fully closed — fetch position again
        try {
          const remaining = await exchange.fetchPositions([pair]);
          const rem = remaining.find(p => p.symbol === pair && Math.abs(p.contracts || 0) > 0);
          if (rem && Math.abs(rem.contracts) > 0) {
            const remQty = Math.abs(rem.contracts);
            logger.warn(`${pair}: ${remQty} remaining after IOC limit — sending market order for residual`);
            const mktOrder = await exchange.createOrder(pair, 'market', side, remQty, undefined, { reduceOnly: true });
            if (mktOrder.average) fillPrice = mktOrder.average;
          }
        } catch (e) { logger.warn(`Residual position check failed for ${pair}: ${e.message}`); }
      } catch (limitErr) {
        logger.warn(`Limit close failed for ${pair}: ${limitErr.message} — falling back to market`);
        const mktOrder = await exchange.createOrder(pair, 'market', side, qty, undefined, { reduceOnly: true });
        fillPrice = mktOrder.average || mktOrder.price || null;
      }

      logger.info(`Closed live position: ${pair} on ${trade.exchange} (fillPrice: $${fillPrice})`);

      // Update DB with actual fill price if available
      if (fillPrice && trade.id) {
        const isLong = trade.direction === 'long';
        const realPnlPct = isLong
          ? ((fillPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - fillPrice) / trade.entry_price) * 100;
        const realPnlUsd = (realPnlPct / 100) * (trade.position_size || 0);
        try {
          await db.query(
            `UPDATE trades SET close_price = $1, pnl_pct = $2, pnl_usd = $3 WHERE id = $4`,
            [fillPrice, realPnlPct, realPnlUsd, trade.id]
          );
          logger.info(`${pair}: DB updated with actual fill — close $${fillPrice}, P&L $${realPnlUsd.toFixed(2)} (${realPnlPct.toFixed(2)}%)`);
        } catch (e) { logger.warn(`Failed to update trade ${trade.id} with fill price: ${e.message}`); }
      }

      return fillPrice;
    } catch (err) {
      logger.error(`Failed to close position ${trade.symbol}: ${err.message}`);
      return null;
    }
  }

  async updateExchangeSL(trade, newSLPrice) {
    const exchange = this.exchanges[trade.exchange];
    if (!exchange || !exchange.apiKey || trade.mode !== 'live') return;

    try {
      const pair = `${trade.symbol}/USDT:USDT`;
      const closeSide = trade.direction === 'long' ? 'sell' : 'buy';

      // Cancel existing SL orders
      try {
        const openOrders = await exchange.fetchOpenOrders(pair);
        for (const order of openOrders) {
          if (order.type === 'stop_market' || order.type === 'stop' || order.stopPrice) {
            await exchange.cancelOrder(order.id, pair);
            logger.info(`Cancelled old SL order ${order.id}`);
          }
        }
      } catch (e) { logger.warn(`Failed to cancel old SL: ${e.message}`); }

      // Place new SL at updated price
      const qty = trade.quantity || exchange.amountToPrecision(pair, trade.position_size / newSLPrice);
      const slPrice = exchange.priceToPrecision(pair, newSLPrice);
      await this.placeStopOrder(exchange, trade.exchange, pair, closeSide, qty, slPrice);
      logger.info(`Updated SL for ${pair} to $${newSLPrice}`);
    } catch (err) {
      logger.error(`Failed to update SL for ${trade.symbol}: ${err.message}`);
    }
  }

  async placeStopOrder(exchange, exchangeId, pair, side, qty, stopPrice) {
    const params = { reduceOnly: true };
    if (exchangeId === 'bybit') {
      params.triggerPrice = stopPrice;
      params.triggerBy = 'LastPrice';
      // triggerDirection: 1 = rising (buy stop), 2 = falling (sell stop)
      params.triggerDirection = side === 'sell' ? 2 : 1;
      return exchange.createOrder(pair, 'market', side, qty, undefined, params);
    }
    if (exchangeId === 'binance') {
      // Binance moved stop orders to Algo API (ccxt doesn't support yet)
      // SL is enforced by checkOpenTrades every minute instead
      logger.info(`${pair}: Binance SL at $${stopPrice} managed by trade checker (algo API not supported)`);
      return null;
    }
    // Default fallback
    params.stopPrice = stopPrice;
    return exchange.createOrder(pair, 'stop_market', side, qty, undefined, params);
  }

  async placeTPOrders(trade) {
    if (trade.mode !== 'live') return;
    const exchange = this.exchanges[trade.exchange];
    if (!exchange?.apiKey) return;

    try {
      const pair = `${trade.symbol}/USDT:USDT`;
      const isLong = trade.direction === 'long';
      const closeSide = isLong ? 'sell' : 'buy';
      const totalQty = trade.quantity;

      const tpLevels = [
        { price: trade.tp1, fraction: this.tp1ClosePct, label: 'TP1' },
        { price: trade.tp2, fraction: this.tp2ClosePct, label: 'TP2' },
        { price: trade.tp3, fraction: 0.5, label: 'TP3' },
      ];

      let remaining = totalQty;
      for (const tp of tpLevels) {
        if (!tp.price || remaining <= 0) continue;
        const qty = tp.fraction >= 1.0 ? remaining : totalQty * tp.fraction;
        const closeQty = Math.min(qty, remaining);

        const check = this.calcMinNotional(exchange, pair, closeQty, tp.price);
        if (!check.ok) {
          logger.info(`${pair}: ${tp.label} limit order skipped — qty below min notional ($${check.currentNotional.toFixed(2)} < $${check.minNotional})`);
          continue;
        }

        try {
          const roundedQty = exchange.amountToPrecision(pair, closeQty);
          const roundedPrice = exchange.priceToPrecision(pair, tp.price);
          await exchange.createOrder(pair, 'limit', closeSide, roundedQty, roundedPrice, { reduceOnly: true });
          logger.info(`${pair}: ${tp.label} limit order placed — ${closeSide} ${roundedQty} @ $${roundedPrice}`);
          remaining -= closeQty;
        } catch (e) {
          logger.warn(`${pair}: ${tp.label} limit order failed — ${e.message}`);
        }

        if (tp.fraction >= 1.0) break;
      }
    } catch (err) {
      logger.error(`placeTPOrders failed for ${trade.symbol}: ${err.message}`);
    }
  }

  async cancelTPOrders(trade) {
    if (trade.mode !== 'live') return;
    const exchange = this.exchanges[trade.exchange];
    if (!exchange?.apiKey) return;

    try {
      const pair = `${trade.symbol}/USDT:USDT`;
      const isLong = trade.direction === 'long';
      const closeSide = isLong ? 'sell' : 'buy';
      const openOrders = await exchange.fetchOpenOrders(pair);
      for (const order of openOrders) {
        const isTPOrder = order.type === 'limit' && order.side === closeSide
          && !order.stopPrice && !order.triggerPrice;
        if (isTPOrder) {
          try {
            await exchange.cancelOrder(order.id, pair);
            logger.info(`Cancelled TP limit order ${order.id} for ${pair}`);
          } catch (e) { logger.warn(`Cancel TP order failed: ${e.message}`); }
        }
      }
    } catch (err) {
      logger.error(`cancelTPOrders failed for ${trade.symbol}: ${err.message}`);
    }
  }

  async closeSingleTrade(tradeId) {
    const trades = await db.getOpenTrades();
    const trade = trades.find(t => t.id === parseInt(tradeId));
    if (!trade) return null;

    let exchange = this.exchanges[trade.exchange];
    if (!exchange) {
      if (trade.mode === 'live') throw new Error(`Exchange ${trade.exchange} not available for live close`);
      exchange = Object.values(this.exchanges)[0];
    }

    const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
    let currentPrice = null;
    if (exchange) {
      for (const pair of pairs) {
        try {
          if (exchange.markets?.[pair]) {
            const ticker = await exchange.fetchTicker(pair);
            currentPrice = ticker.last;
            break;
          }
        } catch (e) { /* fallback to entry price */ }
      }
    }

    const isLong = trade.direction === 'long';
    const pnlPct = currentPrice ? (isLong
      ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
      : ((trade.entry_price - currentPrice) / trade.entry_price) * 100) : 0;
    const pnlUsd = (pnlPct / 100) * trade.position_size;

    if (trade.mode === 'live') await this.closeExchangePosition(trade);
    if (trade.mode === 'paper') { this.paperBalance += (trade.position_size || 0) + pnlUsd; this.saveConfig(); }
    this.dailyPnL += pnlUsd;
    await db.closeTrade(trade.id, currentPrice || trade.entry_price, pnlPct, pnlUsd, 'manual_close');
    this.cooldowns.set(trade.symbol.toUpperCase(), pnlUsd > 0
      ? { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() }
      : { until: this._next1amUTC(), entryPrice: trade.entry_price, lastDir: trade.direction, closedAt: Date.now() });

    return { trade, currentPrice, pnlPct, pnlUsd };
  }

  async closeBySymbol(symbol) {
    const trades = await db.getOpenTrades(this.settingsKey);
    const trade = trades.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (!trade) return null;
    return this.closeSingleTrade(trade.id);
  }

  async closeAllPositions() {
    const trades = await db.getOpenTrades(this.settingsKey);
    for (const trade of trades) {
      try {
        let exchange = this.exchanges[trade.exchange];
        if (!exchange) {
          if (trade.mode === 'live') { logger.error(`Cannot close live ${trade.symbol} — exchange ${trade.exchange} unavailable`); continue; }
          exchange = Object.values(this.exchanges)[0];
        }

        const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
        let currentPrice = null;
        if (exchange) {
          for (const pair of pairs) {
            try {
              if (exchange.markets?.[pair]) {
                const ticker = await exchange.fetchTicker(pair);
                currentPrice = ticker.last;
                break;
              }
            } catch (e) { /* fallback to entry price */ }
          }
        }

        const isLong = trade.direction === 'long';
        const pnlPct = currentPrice ? (isLong
          ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - currentPrice) / trade.entry_price) * 100) : 0;
        const pnlUsd = (pnlPct / 100) * trade.position_size;

        if (trade.mode === 'live') await this.closeExchangePosition(trade);
        if (trade.mode === 'paper') { this.paperBalance += pnlUsd; this.saveConfig(); }
        this.dailyPnL += pnlUsd;
        await db.closeTrade(trade.id, currentPrice || trade.entry_price, pnlPct, pnlUsd, 'manual_close');
      } catch (err) {
        logger.error(`Failed to close ${trade.symbol}: ${err.message}`);
      }
    }
    return trades.length;
  }

  async getTradeStats() {
    return db.getTradeStats();
  }

  formatTradeUpdate(trade, action, currentPrice, pnlPct, pnlUsd) {
    const modeTag = trade.mode === 'paper' ? '📝 PAPER' : '💰 LIVE';
    const pnlEmoji = pnlUsd >= 0 ? '🟢' : '🔴';
    const pnlSign = pnlUsd >= 0 ? '+' : '';

    if (action === 'tp1') {
      return `${modeTag} ✅ <b>TP1 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n💰 <b>Closed 33% — profit locked</b>\n🔒 SL moved to breakeven ($${trade.entry_price})\n🎯 67% running for TP2/TP3/TP4.`;
    }
    if (action === 'tp2') {
      return `${modeTag} ✅✅ <b>TP2 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n💰 <b>Closed another 50% — more profit locked</b>\n🔒 SL trailed to TP1 ($${trade.tp1})\n🚀 34% riding to TP3/TP4...`;
    }
    if (action === 'tp3') {
      return `${modeTag} ✅✅✅ <b>TP3 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n💰 <b>Closed 50% — runner stays open</b>\n🔒 SL trailed to TP2 ($${trade.tp2})\n🏃 Runner riding with wide trail (3x ATR)`;
    }
    if (action === 'tp4') {
      return `${modeTag} 🏆 <b>TP4 FULL TARGET!</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n💰 Extended target hit. Maximum profit captured.`;
    }
    if (action === 'sl') {
      const wasTrailed = trade.original_stop_loss && trade.stop_loss !== trade.original_stop_loss;
      const slNote = wasTrailed ? `\n🔒 SL was trailed from $${parseFloat(trade.original_stop_loss).toPrecision(6)} to $${parseFloat(trade.stop_loss).toPrecision(6)}` : '';
      return `${modeTag} 🔴 <b>STOP LOSS</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}${slNote}\n\nTrade closed. Risk managed.`;
    }
    if (action === 'invalidated') {
      return `${modeTag} ⛔ <b>INVALIDATED</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n4H candle closed below invalidation ($${trade.invalidation})\nThesis broken — trade closed before SL.`;
    }
    if (action === 'thesis_broken') {
      return `${modeTag} 🔄 <b>THESIS BROKEN</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\nSMC structure flipped against ${trade.direction} with ChoCH.\nEarly exit — thesis no longer valid.`;
    }
    if (action === 'max_loss') {
      return `${modeTag} 🛑 <b>MAX LOSS CAP</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n⚠️ Per-trade loss limit ($${this.maxLossPerTrade}) reached.\nPosition closed to protect capital.`;
    }
    if (action === 'time_exit') {
      return `${modeTag} ⏱️ <b>TIME EXIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n90min+ without TP1 — edge expired.\nCapital freed for better setups.`;
    }
    if (action === 'time_trail') {
      return `${modeTag} ⏱️ <b>TIME TRAIL</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n🔒 45min+ in profit, no TP1 — SL trailed to breakeven+1%\nWill auto-close at 90min if no TP1.`;
    }
    if (action === 'expired') {
      return `${modeTag} ⏰ <b>EXPIRED</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\nAuto-closed after 48 hours.`;
    }
    if (action === 'profit_protect') {
      return `${modeTag} 🛡️ <b>PROFIT PROTECTED</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n🔒 <b>SL moved to breakeven ($${trade.entry_price})</b>\nUp ${pnlPct.toFixed(1)}% — protecting gains before TP1.`;
    }
    if (action === 'trail') {
      return `${modeTag} 📈 <b>TRAILING SL</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n🔒 SL trailed to <b>$${trade.stop_loss.toPrecision(6)}</b>\nPeak: $${(trade.peak_price || currentPrice).toPrecision(6)}`;
    }
    return '';
  }
}

module.exports = TradeExecutor;
