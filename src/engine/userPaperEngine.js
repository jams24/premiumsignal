const logger = require('../utils/logger');
const db = require('../db/database');

// Per-user virtual paper accounts. Each follower gets an isolated simulated
// portfolio: $100 notional per signal, 1x (spot-style) so P&L is honest.
// TP1 closes 50% and moves SL to breakeven; TP2 closes the rest; SL closes all.

const USER_TRADE_SIZE = 100;

class UserPaperEngine {
  constructor(exchanges) {
    this.exchanges = exchanges;
  }

  async openForFollowers(signal) {
    try {
      const followers = await db.getFollowers();
      for (const user of followers) {
        try {
          const pair = `${signal.symbol}/USDT:${signal.exchange === 'bybit' ? 'USDT' : 'USDT'}`;
          await db.saveUserPaperTrade({
            telegramId: user.telegram_id,
            signalId: signal.id || null,
            symbol: signal.symbol,
            exchange: signal.exchange,
            direction: signal.direction,
            entryPrice: signal.currentPrice,
            positionSize: USER_TRADE_SIZE,
            tp1: signal.tp1,
            tp2: signal.tp2,
            tp3: signal.tp3,
            stopLoss: signal.stopLoss,
          });
        } catch (e) {
          logger.warn(`User paper trade open failed for ${user.telegram_id}: ${e.message}`);
        }
      }
      if (followers.length) logger.info(`User paper trades opened for ${followers.length} follower(s): ${signal.symbol}`);
    } catch (e) {
      logger.error(`openForFollowers failed: ${e.message}`);
    }
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

    // One ticker fetch per symbol/exchange pair
    const tickers = new Map();
    for (const t of open) {
      const key = `${t.exchange}:${t.symbol}`;
      if (tickers.has(key)) continue;
      tickers.set(key, null);
    }
    for (const key of tickers.keys()) {
      const [exId, sym] = key.split(':');
      const exchange = this.exchanges[exId];
      if (!exchange) continue;
      try {
        const ticker = await exchange.fetchTicker(`${sym}/USDT:USDT`);
        tickers.set(key, ticker.last);
      } catch (e) {
        logger.debug(`user paper ticker ${key}: ${e.message}`);
      }
    }

    for (const t of open) {
      const price = tickers.get(`${t.exchange}:${t.symbol}`);
      if (price == null) continue;
      try {
        await this.evaluateTrade(t, price);
      } catch (e) {
        logger.warn(`user paper evaluate #${t.id}: ${e.message}`);
      }
    }
  }

  async evaluateTrade(t, price) {
    const isLong = t.direction === 'long';
    const entry = parseFloat(t.entry_price);
    const size = parseFloat(t.position_size) || USER_TRADE_SIZE;
    const tp1 = parseFloat(t.tp1);
    const tp2 = parseFloat(t.tp2);
    const stopLoss = parseFloat(t.stop_loss);

    const hitTarget = isLong ? price >= tp1 : price <= tp1;
    const hitTP2 = isLong ? price >= tp2 : price <= tp2;
    const hitStop = isLong ? price <= stopLoss : price >= stopLoss;

    // Stage 1: first target — bank half the position, SL moves to breakeven
    if (!t.hit_tp1 && hitTarget && !hitStop) {
      const move = isLong ? (tp1 - entry) / entry : (entry - tp1) / entry;
      const realizedUsd = move * 0.5 * size;
      await db.updateUserPaperTrade(t.id, {
        hit_tp1: true,
        stop_loss: entry,
        realized_pnl_usd: parseFloat(parseFloat(t.realized_pnl_usd || 0) + realizedUsd),
      });
      return;
    }

    // Stage 2a: second target — close remainder as win (plus banked TP1 half)
    if (t.hit_tp1 && hitTP2 && !hitStop) {
      const move = isLong ? (tp2 - entry) / entry : (entry - tp2) / entry;
      const remainingUsd = move * 0.5 * size;
      const totalUsd = remainingUsd + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, tp2, move * 100, totalUsd, 'tp2');
      return;
    }

    // Stage 2b: stopped out — at original SL (no TP yet) or breakeven (after TP1)
    if (hitStop) {
      const afterTP1 = !!t.hit_tp1;
      const exit = stopLoss;
      const move = isLong ? (exit - entry) / entry : (entry - exit) / entry;
      const portion = afterTP1 ? 0.5 : 1;
      const finalUsd = move * portion * size + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, exit, move * 100, finalUsd, afterTP1 ? 'sl_breakeven' : 'sl');
    }
  }

  async getOpen(telegramId) {
    return db.getOpenUserTrades(telegramId);
  }

  async getStats(telegramId) {
    return db.getUserTradeStats(telegramId);
  }
}

module.exports = UserPaperEngine;
