const logger = require('../utils/logger');
const db = require('../db/database');
const { ATR } = require('technicalindicators');
const { escapeHtml } = require('../utils/formatting');

class UserPaperEngine {
  constructor(exchanges, bot) {
    this.exchanges = exchanges;
    this.bot = bot;
  }

  async notify(telegramId, msg) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendMessage(telegramId, msg, { parse_mode: 'HTML' });
    } catch (e) {
      logger.debug(`User notify ${telegramId}: ${e.message}`);
    }
  }

  async openForFollowers(signal) {
    try {
      const followers = await db.getFollowers();
      for (const user of followers) {
        try {
          const size = parseFloat(user.paper_size) || 100;
          const leverage = parseInt(user.paper_leverage) || 20;
          const notional = size * leverage;
          const quantity = notional / signal.currentPrice;
          const atr = signal.atr || Math.abs(signal.stopLoss - signal.currentPrice) / 3;
          const isLong = signal.direction === 'long';
          const tp4 = isLong ? signal.currentPrice + atr * 8 : signal.currentPrice - atr * 8;
          const invalidation = isLong ? signal.currentPrice - atr * 3 : signal.currentPrice + atr * 3;

          await db.saveUserPaperTrade({
            telegramId: user.telegram_id,
            signalId: signal.id || null,
            symbol: signal.symbol,
            exchange: signal.exchange,
            direction: signal.direction,
            entryPrice: signal.currentPrice,
            positionSize: notional,
            tp1: signal.tp1,
            tp2: signal.tp2,
            tp3: signal.tp3,
            tp4,
            stopLoss: signal.stopLoss,
            leverage,
            quantity,
            atr,
            invalidation,
            source: 'signal',
          });

          await this.notify(user.telegram_id,
            `📝 <b>Paper trade opened</b>\n\n` +
            `${isLong ? '🟢 LONG' : '🔴 SHORT'} $${escapeHtml(signal.symbol)}\n` +
            `Entry: $${signal.currentPrice.toPrecision(6)}\n` +
            `Size: $${notional.toFixed(0)} (${leverage}x)\n` +
            `TP1: $${signal.tp1} | TP2: $${signal.tp2}\n` +
            `TP3: $${signal.tp3} | TP4: $${tp4.toPrecision(6)}\n` +
            `SL: $${signal.stopLoss}`
          );
        } catch (e) {
          logger.warn(`User paper trade open failed for ${user.telegram_id}: ${e.message}`);
        }
      }
      if (followers.length) logger.info(`User paper trades opened for ${followers.length} follower(s): ${signal.symbol}`);
    } catch (e) {
      logger.error(`openForFollowers failed: ${e.message}`);
    }
  }

  async openManualTrade(telegramId, symbol, direction) {
    const user = await db.getUser(telegramId);
    if (!user) throw new Error('User not found');

    const size = parseFloat(user.paper_size) || 100;
    const leverage = parseInt(user.paper_leverage) || 20;

    // Find the symbol on an exchange
    let exchange = null;
    let exchangeId = null;
    let pair = null;
    for (const [id, ex] of Object.entries(this.exchanges)) {
      const p = `${symbol}/USDT:USDT`;
      if (ex.markets?.[p]) {
        exchange = ex;
        exchangeId = id;
        pair = p;
        break;
      }
    }
    if (!exchange) throw new Error(`${symbol} not found on any exchange`);

    // Check for existing open position
    const openTrades = await db.getOpenUserTrades(telegramId);
    if (openTrades.some(t => t.symbol.toUpperCase() === symbol.toUpperCase())) {
      throw new Error(`Already have an open position in ${symbol}`);
    }

    const ticker = await exchange.fetchTicker(pair);
    const currentPrice = ticker.last;

    // Calculate ATR from recent OHLCV
    let atr;
    try {
      const ohlcv = await exchange.fetchOHLCV(pair, '1h', undefined, 20);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const closes = ohlcv.map(c => c[4]);
      const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
      atr = atrValues[atrValues.length - 1] || currentPrice * 0.02;
    } catch (e) {
      atr = currentPrice * 0.02;
    }

    const isLong = direction === 'long';
    const notional = size * leverage;
    const quantity = notional / currentPrice;
    const stopLoss = isLong ? currentPrice - atr * 3 : currentPrice + atr * 3;
    const tp1 = isLong ? currentPrice + atr * 3 : currentPrice - atr * 3;
    const tp2 = isLong ? currentPrice + atr * 6 : currentPrice - atr * 6;
    const tp3 = isLong ? currentPrice + atr * 10 : currentPrice - atr * 10;
    const tp4 = isLong ? currentPrice + atr * 8 : currentPrice - atr * 8;
    const invalidation = stopLoss;

    const result = await db.saveUserPaperTrade({
      telegramId,
      symbol,
      exchange: exchangeId,
      direction,
      entryPrice: currentPrice,
      positionSize: notional,
      tp1, tp2, tp3, tp4,
      stopLoss,
      leverage,
      quantity,
      atr,
      invalidation,
      source: 'manual',
    });

    return { id: result.id, symbol, direction, currentPrice, notional, leverage, tp1, tp2, tp3, tp4, stopLoss, atr };
  }

  async closeManualTrade(telegramId, symbol) {
    const openTrades = await db.getOpenUserTrades(telegramId);
    const trade = openTrades.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (!trade) throw new Error(`No open position in ${symbol}`);

    let exchange = this.exchanges[trade.exchange];
    if (!exchange) exchange = Object.values(this.exchanges)[0];

    const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
    let currentPrice = null;
    for (const p of pairs) {
      if (exchange.markets?.[p]) {
        const ticker = await exchange.fetchTicker(p);
        currentPrice = ticker.last;
        break;
      }
    }
    if (!currentPrice) throw new Error(`Cannot fetch price for ${symbol}`);

    const entry = parseFloat(trade.entry_price);
    const isLong = trade.direction === 'long';
    const pnlPct = isLong
      ? ((currentPrice - entry) / entry) * 100
      : ((entry - currentPrice) / entry) * 100;
    const pnlUsd = (pnlPct / 100) * parseFloat(trade.position_size) + parseFloat(trade.realized_pnl_usd || 0);

    await db.closeUserPaperTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'manual_close');
    return { symbol, direction: trade.direction, entry, exit: currentPrice, pnlPct, pnlUsd };
  }

  async checkAllTrades() {
    let open = [];
    try {
      open = await db.getOpenUserTrades();
    } catch (e) {
      logger.warn(`user paper check: ${e.message}`);
      return;
    }
    if (!open.length) return;

    // Fetch tickers + 4H OHLCV per symbol/exchange
    const priceData = new Map();
    for (const t of open) {
      const key = `${t.exchange}:${t.symbol}`;
      if (priceData.has(key)) continue;
      priceData.set(key, { price: null, ohlcv: null });
    }

    for (const key of priceData.keys()) {
      const [exId, sym] = key.split(':');
      const exchange = this.exchanges[exId];
      if (!exchange) continue;
      const pairs = [`${sym}/USDT:USDT`, `${sym}/USDT`];
      for (const pair of pairs) {
        if (exchange.markets?.[pair]) {
          try {
            const ticker = await exchange.fetchTicker(pair);
            const data = { price: ticker.last, ohlcv: null };
            try { data.ohlcv = await exchange.fetchOHLCV(pair, '4h', undefined, 2); } catch (e) { /* ok */ }
            priceData.set(key, data);
          } catch (e) {
            logger.debug(`user paper ticker ${key}: ${e.message}`);
          }
          break;
        }
      }
    }

    for (const t of open) {
      const data = priceData.get(`${t.exchange}:${t.symbol}`);
      if (!data?.price) continue;
      try {
        await this.evaluateTrade(t, data.price, data.ohlcv);
      } catch (e) {
        logger.warn(`user paper evaluate #${t.id}: ${e.message}`);
      }
    }
  }

  async evaluateTrade(t, price, ohlcv) {
    const isLong = t.direction === 'long';
    const entry = parseFloat(t.entry_price);
    const posSize = parseFloat(t.position_size);
    const atr = parseFloat(t.atr) || 0;
    const leverage = parseInt(t.leverage) || 1;
    const tradeAgeMs = Date.now() - new Date(t.created_at).getTime();

    const pnlPct = isLong
      ? ((price - entry) / entry) * 100
      : ((entry - price) / entry) * 100;
    const pnlUsd = (pnlPct / 100) * posSize;

    let action = null;

    // --- INVALIDATION CHECK: 4H candle close below invalidation level ---
    if (!action && t.invalidation && ohlcv && ohlcv.length >= 2 && tradeAgeMs > 4 * 60 * 60 * 1000) {
      const prevClose = ohlcv[ohlcv.length - 2][4];
      const invalidated = isLong ? prevClose < t.invalidation : prevClose > t.invalidation;
      if (invalidated) {
        action = 'invalidated';
        await db.closeUserPaperTrade(t.id, price, pnlPct, pnlUsd + parseFloat(t.realized_pnl_usd || 0), 'invalidated');
      }
    }

    // --- TP4: close full remaining ---
    if (!action && t.tp4 && (isLong ? price >= t.tp4 : price <= t.tp4)) {
      action = 'tp4';
      const totalPnl = (pnlPct / 100) * posSize + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, price, pnlPct, totalPnl, 'tp4');
    }

    // --- TP3: close 50% remaining, keep runner, SL to TP2 ---
    if (!action && !t.hit_tp3 && t.tp3 && (isLong ? price >= t.tp3 : price <= t.tp3)) {
      action = 'tp3';
      const partialPnl = await this.partialClose(t, 0.5, price);
      await db.updateUserPaperTrade(t.id, { hit_tp3: true, stop_loss: t.tp2 });
      await this.notify(t.telegram_id,
        `🎯 <b>TP3 HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed 50% (+$${partialPnl.toFixed(2)})\n` +
        `🏃 Runner riding with wide trail (3x ATR)\nSL → $${parseFloat(t.tp2).toPrecision(6)}`);
    }

    // --- TP2: close 50% remaining, SL to TP1 ---
    if (!action && !t.hit_tp2 && t.tp2 && (isLong ? price >= t.tp2 : price <= t.tp2)) {
      action = 'tp2';
      const partialPnl = await this.partialClose(t, 0.5, price);
      await db.updateUserPaperTrade(t.id, { hit_tp2: true, stop_loss: t.tp1 });
      await this.notify(t.telegram_id,
        `🎯 <b>TP2 HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed 50% (+$${partialPnl.toFixed(2)})\nSL → $${parseFloat(t.tp1).toPrecision(6)}`);
    }

    // --- TP1: close 33%, SL to breakeven ---
    if (!action && !t.hit_tp1 && t.tp1 && (isLong ? price >= t.tp1 : price <= t.tp1)) {
      action = 'tp1';
      const partialPnl = await this.partialClose(t, 0.33, price);
      await db.updateUserPaperTrade(t.id, { hit_tp1: true, stop_loss: entry });
      await this.notify(t.telegram_id,
        `🎯 <b>TP1 HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed 33% (+$${partialPnl.toFixed(2)})\nSL → breakeven ($${entry.toPrecision(6)})`);
    }

    // --- TRAILING SL (after TP1) ---
    if (!action && t.hit_tp1 && atr) {
      const trailDist = t.hit_tp3 ? atr * 3 : atr * 1.5;
      const peak = parseFloat(t.peak_price) || entry;
      const newPeak = isLong ? Math.max(peak, price) : Math.min(peak, price);

      if (newPeak !== peak) {
        await db.updateUserPaperTrade(t.id, { peak_price: newPeak });
        t.peak_price = newPeak;
      }

      const trailSL = isLong ? newPeak - trailDist : newPeak + trailDist;
      const currentSL = parseFloat(t.stop_loss);
      const shouldUpdate = isLong ? trailSL > currentSL : trailSL < currentSL;
      if (shouldUpdate) {
        await db.updateUserPaperTrade(t.id, { stop_loss: trailSL });
        t.stop_loss = trailSL;
        action = 'trail';
      }
    }

    // --- PROFIT PROTECTION (pre-TP1) ---
    const leveragedPnl = pnlPct * leverage;
    if (!action && !t.hit_tp1 && (pnlPct > 5 || leveragedPnl > 25)) {
      const currentSL = parseFloat(t.stop_loss);
      const atBreakeven = isLong ? currentSL >= entry : currentSL <= entry;
      if (!atBreakeven) {
        await db.updateUserPaperTrade(t.id, { stop_loss: entry });
        action = 'profit_protect';
      } else if (atr) {
        const peak = parseFloat(t.peak_price) || entry;
        const newPeak = isLong ? Math.max(peak, price) : Math.min(peak, price);
        if (newPeak !== peak) {
          await db.updateUserPaperTrade(t.id, { peak_price: newPeak });
          t.peak_price = newPeak;
        }
        const profitDist = Math.abs(newPeak - entry);
        const trailDist = Math.min(atr * 1.5, profitDist * 0.33 || atr * 1.5);
        const trailSL = isLong ? newPeak - trailDist : newPeak + trailDist;
        const aboveBreakeven = isLong ? trailSL > entry : trailSL < entry;
        const shouldUpdate = isLong ? trailSL > currentSL : trailSL < currentSL;
        if (shouldUpdate && aboveBreakeven) {
          await db.updateUserPaperTrade(t.id, { stop_loss: trailSL });
          t.stop_loss = trailSL;
          action = 'trail';
        }
      }
    }

    // --- MAX LOSS CAP (scaled to user's size) ---
    const maxLoss = 6 * (posSize / 800);
    if (!action && pnlUsd < 0 && Math.abs(pnlUsd) >= maxLoss) {
      action = 'max_loss';
      await db.closeUserPaperTrade(t.id, price, pnlPct, pnlUsd + parseFloat(t.realized_pnl_usd || 0), 'max_loss');
      await this.notify(t.telegram_id,
        `❌ <b>MAX LOSS</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed at $${price.toPrecision(6)}\nP&L: $${pnlUsd.toFixed(2)}`);
    }

    // --- SL CHECK ---
    if (!action && t.stop_loss && (isLong ? price <= parseFloat(t.stop_loss) : price >= parseFloat(t.stop_loss))) {
      action = 'sl';
      const slPrice = parseFloat(t.stop_loss);
      const slPnlPct = isLong
        ? ((slPrice - entry) / entry) * 100
        : ((entry - slPrice) / entry) * 100;
      const slPnlUsd = (slPnlPct / 100) * posSize + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, slPrice, slPnlPct, slPnlUsd, t.hit_tp1 ? 'sl_trailed' : 'sl');
      const emoji = slPnlUsd >= 0 ? '✅' : '❌';
      await this.notify(t.telegram_id,
        `${emoji} <b>SL HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed at $${slPrice.toPrecision(6)}\nP&L: $${slPnlUsd.toFixed(2)}`);
    }

    // --- 48h EXPIRY ---
    if (!action && tradeAgeMs > 48 * 60 * 60 * 1000) {
      action = 'expired';
      const totalPnl = pnlUsd + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, price, pnlPct, totalPnl, 'expired');
      await this.notify(t.telegram_id,
        `⏰ <b>EXPIRED</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed after 48h at $${price.toPrecision(6)}\nP&L: $${totalPnl.toFixed(2)}`);
    }

    // Notify on close actions
    if (action && ['tp4', 'invalidated'].includes(action)) {
      const totalPnl = (pnlPct / 100) * posSize + parseFloat(t.realized_pnl_usd || 0);
      const emoji = totalPnl >= 0 ? '🎯' : '❌';
      await this.notify(t.telegram_id,
        `${emoji} <b>${action.toUpperCase()}</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed at $${price.toPrecision(6)}\nP&L: $${totalPnl.toFixed(2)}`);
    }
  }

  async partialClose(trade, fraction, currentPrice) {
    const entry = parseFloat(trade.entry_price);
    const posSize = parseFloat(trade.position_size);
    const qty = parseFloat(trade.quantity) || posSize / entry;
    const isLong = trade.direction === 'long';

    const closePct = isLong
      ? ((currentPrice - entry) / entry) * 100
      : ((entry - currentPrice) / entry) * 100;

    const closeQty = qty * fraction;
    const closeSize = posSize * fraction;
    const partialPnl = (closePct / 100) * closeSize;

    const newQty = qty - closeQty;
    const newSize = posSize - closeSize;
    const newRealized = parseFloat(trade.realized_pnl_usd || 0) + partialPnl;

    await db.updateUserPaperTrade(trade.id, {
      quantity: newQty,
      position_size: newSize,
      realized_pnl_usd: newRealized,
    });

    trade.quantity = newQty;
    trade.position_size = newSize;
    trade.realized_pnl_usd = newRealized;

    return partialPnl;
  }

  async getOpen(telegramId) {
    return db.getOpenUserTrades(telegramId);
  }

  async getStats(telegramId) {
    return db.getUserTradeStats(telegramId);
  }
}

module.exports = UserPaperEngine;
