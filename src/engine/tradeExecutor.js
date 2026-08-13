const ccxt = require('ccxt');
const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');

class TradeExecutor {
  constructor(exchanges, config = {}) {
    this.exchanges = exchanges;
    this.mode = config.mode || 'paper'; // 'paper' or 'live'
    this.maxPositionSize = config.maxPositionSize || 50; // USDT per trade
    this.maxDailyLoss = config.maxDailyLoss || 200;
    this.maxConcurrentPositions = config.maxConcurrentPositions || 5;
    this.minConfidence = config.minConfidence || 4;
    this.defaultLeverage = config.defaultLeverage || 5;
    this.enabled = config.enabled !== false;
    this.dailyPnL = 0;
    this.dailyPnLResetDate = new Date().toDateString();
    this.callbacks = [];
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

  async canTrade(signal) {
    if (!this.enabled) return { ok: false, reason: 'Trading disabled' };

    this.resetDailyPnL();

    // Daily loss limit
    if (this.dailyPnL <= -this.maxDailyLoss) {
      return { ok: false, reason: `Daily loss limit reached ($${this.dailyPnL.toFixed(2)}/$${this.maxDailyLoss})` };
    }

    // Confidence filter
    if (signal.confidence < this.minConfidence) {
      return { ok: false, reason: `Confidence ${signal.confidence} < minimum ${this.minConfidence}` };
    }

    // Max concurrent positions
    const openPositions = await db.getOpenTrades();
    if (openPositions.length >= this.maxConcurrentPositions) {
      return { ok: false, reason: `Max concurrent positions reached (${openPositions.length}/${this.maxConcurrentPositions})` };
    }

    // Don't double-enter same symbol
    const existing = openPositions.find(p => p.symbol === signal.symbol && p.exchange === signal.exchange);
    if (existing) {
      return { ok: false, reason: `Already in position on ${signal.symbol}` };
    }

    return { ok: true };
  }

  async executeSignal(signal) {
    const check = await this.canTrade(signal);
    if (!check.ok) {
      logger.info(`Trade skipped for ${signal.symbol}: ${check.reason}`);
      return null;
    }

    if (this.mode === 'paper') {
      return this.executePaperTrade(signal);
    } else {
      return this.executeLiveTrade(signal);
    }
  }

  async executePaperTrade(signal) {
    const entryPrice = signal.currentPrice;
    const positionSize = this.maxPositionSize;
    const quantity = positionSize / entryPrice;
    const leverage = signal.suggestedLeverage || this.defaultLeverage;

    const trade = {
      signalId: signal.id || null,
      symbol: signal.symbol,
      exchange: signal.exchange,
      direction: signal.direction,
      mode: 'paper',
      entryPrice,
      quantity,
      positionSize,
      leverage,
      tp1: signal.tp1,
      tp2: signal.tp2,
      tp3: signal.tp3,
      stopLoss: signal.stopLoss,
      status: 'open',
    };

    await db.saveTrade(trade);

    const msg = `📝 <b>PAPER TRADE OPENED</b>\n\n` +
      `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} <b>$${escapeHtml(signal.symbol)}</b>\n` +
      `Exchange: ${signal.exchange}\n` +
      `Entry: $${entryPrice}\n` +
      `Size: $${positionSize} (${leverage}x leverage)\n` +
      `TP1: $${signal.tp1} | TP2: $${signal.tp2} | TP3: $${signal.tp3}\n` +
      `SL: $${signal.stopLoss}\n\n` +
      `<i>Paper mode — no real funds used</i>`;

    await this.notify(msg);
    logger.info(`Paper trade opened: ${signal.direction} ${signal.symbol} @ $${entryPrice}`);
    return trade;
  }

  async executeLiveTrade(signal) {
    const exchange = this.exchanges[signal.exchange];
    if (!exchange) {
      logger.error(`Exchange ${signal.exchange} not available for live trading`);
      return null;
    }

    // Check if exchange has API credentials
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

      // Set leverage
      const leverage = signal.suggestedLeverage || this.defaultLeverage;
      try {
        await exchange.setLeverage(leverage, pair);
      } catch (e) {
        logger.warn(`Could not set leverage for ${pair}: ${e.message}`);
      }

      // Set margin mode to cross
      try {
        await exchange.setMarginMode('cross', pair);
      } catch (e) { /* may already be set */ }

      // Calculate quantity
      const positionSize = this.maxPositionSize;
      const ticker = await exchange.fetchTicker(pair);
      const entryPrice = ticker.last;
      const quantity = positionSize / entryPrice;

      // Round to market precision
      const market = exchange.markets[pair];
      const roundedQty = exchange.amountToPrecision(pair, quantity);

      // Place market order
      const side = signal.direction === 'long' ? 'buy' : 'sell';
      const order = await exchange.createOrder(pair, 'market', side, roundedQty);

      logger.info(`Live order placed: ${side} ${roundedQty} ${pair} on ${signal.exchange}`);

      // Place TP and SL orders
      const closeSide = signal.direction === 'long' ? 'sell' : 'buy';

      // Stop Loss
      try {
        await exchange.createOrder(pair, 'stop_market', closeSide, roundedQty, undefined, {
          stopPrice: exchange.priceToPrecision(pair, signal.stopLoss),
          reduceOnly: true,
        });
      } catch (e) {
        logger.warn(`SL order failed for ${pair}: ${e.message}`);
      }

      // Take Profit 1 (close 50%)
      try {
        const tp1Qty = exchange.amountToPrecision(pair, quantity * 0.5);
        await exchange.createOrder(pair, 'take_profit_market', closeSide, tp1Qty, undefined, {
          stopPrice: exchange.priceToPrecision(pair, signal.tp1),
          reduceOnly: true,
        });
      } catch (e) {
        logger.warn(`TP1 order failed for ${pair}: ${e.message}`);
      }

      const trade = {
        signalId: signal.id || null,
        symbol: signal.symbol,
        exchange: signal.exchange,
        direction: signal.direction,
        mode: 'live',
        entryPrice: order.average || entryPrice,
        quantity: parseFloat(roundedQty),
        positionSize,
        leverage,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        stopLoss: signal.stopLoss,
        orderId: order.id,
        status: 'open',
      };

      await db.saveTrade(trade);

      const msg = `🔴 <b>LIVE TRADE EXECUTED</b> 🔴\n\n` +
        `${signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} <b>$${escapeHtml(signal.symbol)}</b>\n` +
        `Exchange: ${signal.exchange}\n` +
        `Entry: $${trade.entryPrice}\n` +
        `Size: $${positionSize} (${leverage}x)\n` +
        `Qty: ${roundedQty}\n` +
        `Order ID: <code>${order.id}</code>\n` +
        `TP1: $${signal.tp1} | SL: $${signal.stopLoss}\n\n` +
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
        for (const pair of pairs) {
          if (exchange.markets?.[pair]) {
            const ticker = await exchange.fetchTicker(pair);
            currentPrice = ticker.last;
            break;
          }
        }
        if (!currentPrice) continue;

        const isLong = trade.direction === 'long';
        const pnlPct = isLong
          ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - currentPrice) / trade.entry_price) * 100;
        const pnlUsd = (pnlPct / 100) * trade.position_size * trade.leverage;

        let action = null;

        // Check TP3
        if (trade.tp3 && (isLong ? currentPrice >= trade.tp3 : currentPrice <= trade.tp3)) {
          action = 'tp3';
          await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'tp3');
          this.dailyPnL += pnlUsd;
        }
        // Check TP2
        else if (!trade.hit_tp2 && trade.tp2 && (isLong ? currentPrice >= trade.tp2 : currentPrice <= trade.tp2)) {
          action = 'tp2';
          await db.updateTradeHit(trade.id, 'hit_tp2');
        }
        // Check TP1
        else if (!trade.hit_tp1 && trade.tp1 && (isLong ? currentPrice >= trade.tp1 : currentPrice <= trade.tp1)) {
          action = 'tp1';
          await db.updateTradeHit(trade.id, 'hit_tp1');
        }
        // Check SL
        else if (trade.stop_loss && (isLong ? currentPrice <= trade.stop_loss : currentPrice >= trade.stop_loss)) {
          action = 'sl';
          await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'sl');
          this.dailyPnL += pnlUsd;
        }
        // Auto-close after 48h
        else if (Date.now() - new Date(trade.created_at).getTime() > 48 * 60 * 60 * 1000) {
          action = 'expired';
          await db.closeTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'expired');
          this.dailyPnL += pnlUsd;
        }

        if (action) {
          // Close live position on exchange if live mode
          if (trade.mode === 'live' && (action === 'tp3' || action === 'sl' || action === 'expired')) {
            await this.closeExchangePosition(trade);
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
      return `${modeTag} ✅ <b>TP1 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n🎯 Partial target hit. Running for TP2/TP3.`;
    }
    if (action === 'tp2') {
      return `${modeTag} ✅✅ <b>TP2 HIT</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\n🚀 Riding to TP3...`;
    }
    if (action === 'tp3') {
      return `${modeTag} 🏆 <b>TP3 FULL TARGET</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\n💰 Trade closed. Maximum profit captured.`;
    }
    if (action === 'sl') {
      return `${modeTag} 🔴 <b>STOP LOSS</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\nEntry: $${trade.entry_price} → $${currentPrice}\n\nTrade closed. Risk managed.`;
    }
    if (action === 'expired') {
      return `${modeTag} ⏰ <b>EXPIRED</b> $${escapeHtml(trade.symbol)}\n\nPnL: ${pnlEmoji} ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)\n\nAuto-closed after 48 hours.`;
    }
    return '';
  }
}

module.exports = TradeExecutor;
