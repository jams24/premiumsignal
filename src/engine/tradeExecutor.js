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
    this.defaultLeverage = config.defaultLeverage || 5;
    this.enabled = config.enabled !== false;
    this.dailyPnL = 0;
    this.dailyPnLResetDate = new Date().toDateString();
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

    this.pnlResetDate = config.pnlResetDate || new Date().toISOString();

    // Cooldown: symbol → timestamp, prevents re-entry after invalidation/SL
    this.cooldowns = new Map();
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
    const today = new Date().toDateString();
    if (this.dailyPnLResetDate !== today) {
      this.dailyPnL = 0;
      this.dailyPnLResetDate = today;
    }
  }

  async recalcDailyPnL() {
    try {
      const result = await db.getTodayPnL();
      this.dailyPnL = result || 0;
      this.dailyPnLResetDate = new Date().toDateString();
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

    if (this.signalFilter.size > 0 && !this.signalFilter.has(signal.type)) {
      return { ok: false, reason: `Signal type ${signal.type} not in filter [${[...this.signalFilter].join(', ')}]` };
    }

    if (this.excludedSymbols.size > 0 && this.excludedSymbols.has(signal.symbol?.toUpperCase())) {
      return { ok: false, reason: `${signal.symbol} is in excluded list` };
    }

    const cooldownUntil = this.cooldowns.get(signal.symbol?.toUpperCase());
    if (cooldownUntil && Date.now() < cooldownUntil) {
      const minsLeft = Math.ceil((cooldownUntil - Date.now()) / 60000);
      return { ok: false, reason: `${signal.symbol} on cooldown (${minsLeft}m remaining after invalidation)` };
    }

    const openPositions = await db.getOpenTrades();
    if (openPositions.length >= this.maxConcurrentPositions) {
      return { ok: false, reason: `Max concurrent positions reached (${openPositions.length}/${this.maxConcurrentPositions})` };
    }

    const existing = openPositions.find(p => p.symbol === signal.symbol);
    if (existing) {
      return { ok: false, reason: `Already in position on ${signal.symbol} (${existing.exchange})` };
    }

    return { ok: true };
  }

  // Get available balance for sizing
  async getBalance() {
    if (this.mode === 'paper') return this.paperBalance;
    const balances = await this.getAllBalances();
    let total = 0;
    for (const b of Object.values(balances)) total += b.free;
    return total || this.paperBalance;
  }

  // Get balances from all exchanges with API keys
  async getAllBalances() {
    const results = {};
    for (const [id, exchange] of Object.entries(this.exchanges)) {
      if (!exchange.apiKey || !exchange.secret) continue;
      try {
        const params = id === 'bybit' ? { type: 'unified' } : id === 'binance' ? { type: 'future' } : {};
        const balance = await exchange.fetchBalance(params);
        results[id] = {
          free: balance.free?.USDT || 0,
          total: balance.total?.USDT || 0,
          used: balance.used?.USDT || 0,
        };
      } catch (e) {
        logger.warn(`${id} balance fetch failed: ${e.message}`);
        results[id] = { free: 0, total: 0, used: 0, error: e.message };
      }
    }
    return results;
  }

  // Calculate position size based on risk % or fixed amount
  async calcPositionSize(signal) {
    if (this.riskPct > 0) {
      const balance = await this.getBalance();
      let size = balance * (this.riskPct / 100);
      if (this.maxLossPerTrade > 0) size = Math.min(size, this.maxLossPerTrade);
      return Math.min(size, balance * 0.2);
    }
    return this.maxPositionSize;
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
    // Respect exchange max leverage limits if available
    const maxLev = market?.limits?.leverage?.max || 125;
    let lev = Math.min(desiredLeverage, maxLev);

    while (lev >= 1) {
      try {
        await exchange.setLeverage(lev, pair);
        if (lev !== desiredLeverage) logger.info(`${pair}: leverage fallback ${desiredLeverage}x → ${lev}x`);
        return lev;
      } catch (e) {
        const msg = e.message || '';
        if (msg.includes('leverage') || msg.includes('Leverage') || msg.includes('max')) {
          // Try to parse max from error (e.g. "maxLeverage is 5")
          const match = msg.match(/(\d+)/);
          if (match) {
            const parsed = parseInt(match[1]);
            if (parsed > 0 && parsed < lev) { lev = parsed; continue; }
          }
          lev = Math.floor(lev / 2);
          if (lev < 1) lev = 1;
          if (lev === Math.floor(desiredLeverage / 2) || lev === 1) {
            // Last attempt at 1x
            try {
              await exchange.setLeverage(1, pair);
              logger.warn(`${pair}: leverage fallback to 1x`);
              return 1;
            } catch (e2) {
              logger.warn(`${pair}: could not set any leverage, using exchange default`);
              return desiredLeverage;
            }
          }
        } else {
          logger.warn(`${pair}: setLeverage error (non-leverage): ${msg}`);
          return desiredLeverage;
        }
      }
    }
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
      defaultLeverage: this.defaultLeverage,
      dynamicLeverage: this.dynamicLeverage,
      signalFilter: [...this.signalFilter],
      excludedSymbols: [...this.excludedSymbols],
      pnlResetDate: this.pnlResetDate || null,
      dailyPnL: this.dailyPnL,
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
    if (cfg.defaultLeverage != null) this.defaultLeverage = cfg.defaultLeverage;
    if (cfg.dynamicLeverage != null) this.dynamicLeverage = cfg.dynamicLeverage;
    if (cfg.signalFilter != null) this.signalFilter = new Set(cfg.signalFilter);
    if (cfg.excludedSymbols != null) this.excludedSymbols = new Set(cfg.excludedSymbols);
    if (cfg.pnlResetDate != null) this.pnlResetDate = cfg.pnlResetDate;
  }

  async saveConfig() {
    try { await db.saveSettings(this.getConfig()); } catch (e) { logger.warn(`Failed to save settings: ${e.message}`); }
  }

  async loadConfig() {
    try {
      const cfg = await db.loadSettings();
      if (cfg) { this.applyConfig(cfg); logger.info('Settings loaded from database'); }
    } catch (e) { logger.warn(`Failed to load settings: ${e.message}`); }
  }

  // Calculate invalidation level: nearest structure level where thesis breaks
  calcInvalidation(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr || Math.abs(signal.stopLoss - price);
    const isLong = signal.direction === 'long';
    // Invalidation = ATR * 4 beyond entry (wider than SL, structure-level break)
    return isLong ? price - atr * 1.3 : price + atr * 1.3;
  }

  // Calculate DCA levels: 3-part scaling
  calcDCALevels(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr || Math.abs(signal.stopLoss - price) / 3.5;
    const isLong = signal.direction === 'long';
    return {
      dcaPrice2: isLong ? price - atr * 1.0 : price + atr * 1.0,
      dcaPrice3: isLong ? price - atr * 1.5 : price + atr * 1.5,
    };
  }

  // Calculate TP4 (extended target)
  calcTP4(signal) {
    const price = signal.currentPrice;
    const atr = signal.atr || Math.abs(signal.tp1 - price) / 2;
    const isLong = signal.direction === 'long';
    return isLong ? price + atr * 8 : price - atr * 8;
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

  async executeSignal(signal) {
    const check = await this.canTrade(signal);
    if (!check.ok) {
      logger.info(`Trade skipped for ${signal.symbol}: ${check.reason}`);
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
    const positionSize = await this.calcPositionSize(signal);
    const leverage = this.calcLeverage(signal);

    // DCA: enter 1/3 at market, set limits for 2/3 and 3/3
    const dcaQty1 = (positionSize / 3) / entryPrice;
    const dcaQty2 = (positionSize / 3) / entryPrice;
    const dcaQty3 = (positionSize / 3) / entryPrice;
    const { dcaPrice2, dcaPrice3 } = this.calcDCALevels(signal);
    const invalidation = this.calcInvalidation(signal);
    const tp4 = this.calcTP4(signal);

    const trade = {
      signalId: signal.id || null,
      symbol: signal.symbol,
      exchange: signal.exchange,
      direction: signal.direction,
      mode: 'paper',
      entryPrice,
      quantity: dcaQty1,
      positionSize: positionSize / 3,
      leverage,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      tp4,
      stopLoss: signal.stopLoss,
      originalStopLoss: signal.stopLoss,
      invalidation,
      dcaQty2,
      dcaQty3,
      dcaPrice2,
      dcaPrice3,
      dcaStage: 1,
      status: 'open',
    };

    await db.saveTrade(trade);
    this.paperBalance -= (positionSize / 3);
    this.saveConfig();

    const msg = `📝 <b>PAPER TRADE OPENED</b>\n\n` +
      `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} <b>$${escapeHtml(signal.symbol)}</b>\n` +
      `Exchange: ${signal.exchange}\n` +
      `Entry: $${entryPrice} (1/3 DCA)\n` +
      `Size: $${(positionSize / 3).toFixed(2)} of $${positionSize} (${leverage}x)\n` +
      `DCA 2: $${dcaPrice2.toPrecision(6)} | DCA 3: $${dcaPrice3.toPrecision(6)}\n` +
      `TP1: $${signal.tp1} | TP2: $${signal.tp2} | TP3: $${signal.tp3} | TP4: $${tp4.toPrecision(6)}\n` +
      `SL: $${signal.stopLoss} | Invalidation: $${invalidation.toPrecision(6)}\n\n` +
      `${signal.smc ? `SMC: ${signal.smc.structureBias} structure` + (signal.smc.orderBlocks?.length ? ` | ${signal.smc.orderBlocks.length} OB` : '') + (signal.smc.fvgs?.length ? ` | ${signal.smc.fvgs.length} FVG` : '') + '\n' : ''}` +
      `${this.riskPct > 0 ? `Risk: ${this.riskPct}% of balance\n` : ''}` +
      `<i>Paper mode — trailing SL + DCA active</i>`;

    await this.notify(msg);
    logger.info(`Paper trade opened: ${signal.direction} ${signal.symbol} @ $${entryPrice} (1/3 DCA)`);
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

      const desiredLeverage = this.calcLeverage(signal);
      const leverage = await this.setLeverageWithFallback(exchange, pair, desiredLeverage);
      try { await exchange.setMarginMode('cross', pair); } catch (e) { /* may already be set */ }

      const positionSize = await this.calcPositionSize(signal);
      const ticker = await exchange.fetchTicker(pair);
      const entryPrice = ticker.last;

      // DCA: only enter 1/3 of position at market
      const fullQty = positionSize / entryPrice;
      let dcaQty1 = fullQty / 3;

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

      // Place SL order on full expected position
      const closeSide = signal.direction === 'long' ? 'sell' : 'buy';
      try {
        await exchange.createOrder(pair, 'stop_market', closeSide, roundedQty, undefined, {
          stopPrice: exchange.priceToPrecision(pair, signal.stopLoss),
          reduceOnly: true,
        });
      } catch (e) { logger.warn(`SL order failed for ${pair}: ${e.message}`); }

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
      const tp4 = this.calcTP4(signal);

      const trade = {
        signalId: signal.id || null,
        symbol: signal.symbol,
        exchange: signal.exchange,
        direction: signal.direction,
        mode: 'live',
        entryPrice: order.average || entryPrice,
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
        dcaQty2: usedFullEntry ? 0 : parseFloat(dcaQty2Rounded),
        dcaQty3: usedFullEntry ? 0 : parseFloat(dcaQty3Rounded),
        dcaPrice2: usedFullEntry ? null : dcaPrice2,
        dcaPrice3: usedFullEntry ? null : dcaPrice3,
        dcaStage: usedFullEntry ? 3 : 1,
        orderId: order.id,
        status: 'open',
      };

      await db.saveTrade(trade);

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
      const errMsg = `❌ <b>TRADE EXECUTION FAILED</b>\n\n$${escapeHtml(signal.symbol)} on ${signal.exchange}\nError: ${escapeHtml(err.message)}`;
      await this.notify(errMsg);
      logger.error(`Live trade failed for ${signal.symbol}: ${err.message}`);
      return null;
    }
  }

  async checkOpenTrades() {
    const trades = await db.getOpenTrades();
    const updates = [];

    for (const trade of trades) {
      try {
        const exchange = this.exchanges[trade.exchange];
        if (!exchange) continue;

        const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
        let currentPrice = null;
        let ohlcv = null;
        for (const pair of pairs) {
          if (exchange.markets?.[pair]) {
            const ticker = await exchange.fetchTicker(pair);
            currentPrice = ticker.last;
            // Fetch 4H candle for invalidation check
            try {
              ohlcv = await exchange.fetchOHLCV(pair, '4h', undefined, 2);
            } catch (e) { /* ok — invalidation check will be skipped */ }
            break;
          }
        }
        if (!currentPrice) continue;

        const isLong = trade.direction === 'long';

        // --- DCA CHECK: fill DCA 2 and DCA 3 if price reaches levels ---
        await this.checkDCAFills(trade, currentPrice, isLong);

        // Recalculate P&L based on current avg entry (may have changed from DCA)
        const pnlPct = isLong
          ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - currentPrice) / trade.entry_price) * 100;
        const pnlUsd = (pnlPct / 100) * trade.position_size * trade.leverage;

        let action = null;

        // --- INVALIDATION CHECK: 4H candle close below invalidation level ---
        if (trade.invalidation && ohlcv && ohlcv.length >= 2) {
          const prevCandle = ohlcv[ohlcv.length - 2];
          const prevClose = prevCandle[4];
          const invalidated = isLong
            ? prevClose < trade.invalidation
            : prevClose > trade.invalidation;
          if (invalidated) {
            action = 'invalidated';
            await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'invalidated');
            this.dailyPnL += pnlUsd;
            if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
            this.cooldowns.set(trade.symbol.toUpperCase(), Date.now() + 4 * 60 * 60 * 1000);
          }
        }

        // --- TP4 CHECK ---
        if (!action && trade.tp4 && (isLong ? currentPrice >= trade.tp4 : currentPrice <= trade.tp4)) {
          action = 'tp4';
          await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'tp4');
          this.dailyPnL += pnlUsd;
          if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
        }
        // --- TP3 CHECK + TRAILING SL ---
        else if (!action && !trade.hit_tp3 && trade.tp3 && (isLong ? currentPrice >= trade.tp3 : currentPrice <= trade.tp3)) {
          action = 'tp3';
          await db.updateTradeHit(trade.id, 'hit_tp3');
          // Trail SL to TP2 level
          const newSL = trade.tp2;
          await db.updateTradeStopLoss(trade.id, newSL);
          logger.info(`${trade.symbol}: TP3 hit, SL trailed to TP2 ($${newSL})`);
        }
        // --- TP2 CHECK + TRAILING SL ---
        else if (!action && !trade.hit_tp2 && trade.tp2 && (isLong ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2)) {
          action = 'tp2';
          await db.updateTradeHit(trade.id, 'hit_tp2');
          // Trail SL to TP1 level
          const newSL = trade.tp1;
          await db.updateTradeStopLoss(trade.id, newSL);
          logger.info(`${trade.symbol}: TP2 hit, SL trailed to TP1 ($${newSL})`);
        }
        // --- TP1 CHECK + TRAILING SL TO BREAKEVEN ---
        else if (!action && !trade.hit_tp1 && trade.tp1 && (isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1)) {
          action = 'tp1';
          await db.updateTradeHit(trade.id, 'hit_tp1');
          // Trail SL to breakeven (entry price)
          const newSL = trade.entry_price;
          await db.updateTradeStopLoss(trade.id, newSL);
          logger.info(`${trade.symbol}: TP1 hit, SL moved to breakeven ($${newSL})`);
        }
        // --- SL CHECK ---
        else if (!action && trade.stop_loss && (isLong ? currentPrice <= trade.stop_loss : currentPrice >= trade.stop_loss)) {
          action = 'sl';
          await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'sl');
          this.dailyPnL += pnlUsd;
          if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
          this.cooldowns.set(trade.symbol.toUpperCase(), Date.now() + 4 * 60 * 60 * 1000);
        }
        // --- AUTO-CLOSE AFTER 48h ---
        else if (!action && Date.now() - new Date(trade.created_at).getTime() > 48 * 60 * 60 * 1000) {
          action = 'expired';
          await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'expired');
          this.dailyPnL += pnlUsd;
          if (trade.mode === 'paper') this.paperBalance += (trade.position_size || 0) + pnlUsd;
        }

        if (action) {
          if (trade.mode === 'live' && ['tp4', 'sl', 'invalidated', 'expired'].includes(action)) {
            await this.closeExchangePosition(trade);
          }
          if (trade.mode === 'paper' && ['tp4', 'sl', 'invalidated', 'expired'].includes(action)) {
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

  async closeExchangePosition(trade) {
    const exchange = this.exchanges[trade.exchange];
    if (!exchange || !exchange.apiKey) return;

    try {
      const pair = `${trade.symbol}/USDT:USDT`;
      const side = trade.direction === 'long' ? 'sell' : 'buy';
      await exchange.createOrder(pair, 'market', side, trade.quantity, undefined, { reduceOnly: true });
      logger.info(`Closed live position: ${pair} on ${trade.exchange}`);
    } catch (err) {
      logger.error(`Failed to close position ${trade.symbol}: ${err.message}`);
    }
  }

  async closeSingleTrade(tradeId) {
    const trades = await db.getOpenTrades();
    const trade = trades.find(t => t.id === tradeId);
    if (!trade) return null;

    const exchange = this.exchanges[trade.exchange];
    if (!exchange) throw new Error(`Exchange ${trade.exchange} not available`);

    const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
    let currentPrice = null;
    for (const pair of pairs) {
      if (exchange.markets?.[pair]) {
        const ticker = await exchange.fetchTicker(pair);
        currentPrice = ticker.last;
        break;
      }
    }

    const isLong = trade.direction === 'long';
    const pnlPct = currentPrice ? (isLong
      ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
      : ((trade.entry_price - currentPrice) / trade.entry_price) * 100) : 0;
    const pnlUsd = (pnlPct / 100) * trade.position_size * trade.leverage;

    if (trade.mode === 'live') await this.closeExchangePosition(trade);
    if (trade.mode === 'paper') { this.paperBalance += (trade.position_size || 0) + pnlUsd; this.saveConfig(); }
    this.dailyPnL += pnlUsd;
    await db.closeTrade(trade.id, currentPrice || trade.entry_price, pnlPct, pnlUsd, 'manual_close');

    return { trade, currentPrice, pnlPct, pnlUsd };
  }

  async closeAllPositions() {
    const trades = await db.getOpenTrades();
    for (const trade of trades) {
      try {
        const exchange = this.exchanges[trade.exchange];
        if (!exchange) continue;

        const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
        let currentPrice = null;
        for (const pair of pairs) {
          if (exchange.markets?.[pair]) {
            const ticker = await exchange.fetchTicker(pair);
            currentPrice = ticker.last;
            break;
          }
        }

        const isLong = trade.direction === 'long';
        const pnlPct = currentPrice ? (isLong
          ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - currentPrice) / trade.entry_price) * 100) : 0;
        const pnlUsd = (pnlPct / 100) * trade.position_size * trade.leverage;

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
      return `${modeTag} ✅ <b>TP1 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n🔒 <b>SL moved to breakeven ($${trade.entry_price})</b>\n🎯 Running for TP2/TP3/TP4.`;
    }
    if (action === 'tp2') {
      return `${modeTag} ✅✅ <b>TP2 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n🔒 <b>SL trailed to TP1 ($${trade.tp1})</b>\n🚀 Riding to TP3/TP4...`;
    }
    if (action === 'tp3') {
      return `${modeTag} ✅✅✅ <b>TP3 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n🔒 <b>SL trailed to TP2 ($${trade.tp2})</b>\n🚀 Extended target TP4 active...`;
    }
    if (action === 'tp4') {
      return `${modeTag} 🏆 <b>TP4 FULL TARGET!</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n💰 Extended target hit. Maximum profit captured.`;
    }
    if (action === 'sl') {
      const wasTrailed = trade.original_stop_loss && trade.stop_loss !== trade.original_stop_loss;
      const slNote = wasTrailed ? `\n🔒 SL was trailed from $${trade.original_stop_loss} to $${trade.stop_loss}` : '';
      return `${modeTag} 🔴 <b>STOP LOSS</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}${slNote}\n\nTrade closed. Risk managed.`;
    }
    if (action === 'invalidated') {
      return `${modeTag} ⛔ <b>INVALIDATED</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n4H candle closed below invalidation ($${trade.invalidation})\nThesis broken — trade closed before SL.`;
    }
    if (action === 'expired') {
      return `${modeTag} ⏰ <b>EXPIRED</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\nAuto-closed after 48 hours.`;
    }
    return '';
  }
}

module.exports = TradeExecutor;
