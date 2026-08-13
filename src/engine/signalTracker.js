const logger = require('../utils/logger');
const db = require('../db/database');

class SignalTracker {
  constructor(exchanges, signalEngine) {
    this.exchanges = exchanges;
    this.signalEngine = signalEngine;
  }

  async checkAllSignals() {
    const signals = await db.getActiveSignals();
    if (!signals.length) return [];

    const updates = [];

    for (const signal of signals) {
      try {
        const currentPrice = await this.getCurrentPrice(signal.symbol, signal.exchange);
        if (!currentPrice) continue;

        const isLong = signal.direction === 'long';
        let update = null;

        // Check TP hits
        if (!signal.hit_tp3 && signal.tp3 && (isLong ? currentPrice >= signal.tp3 : currentPrice <= signal.tp3)) {
          update = { id: signal.id, hit: 'tp3', price: currentPrice, symbol: signal.symbol };
          await db.updateSignalHit(signal.id, 'hit_tp3');
          await db.closeSignal(signal.id);
        } else if (!signal.hit_tp2 && signal.tp2 && (isLong ? currentPrice >= signal.tp2 : currentPrice <= signal.tp2)) {
          update = { id: signal.id, hit: 'tp2', price: currentPrice, symbol: signal.symbol };
          await db.updateSignalHit(signal.id, 'hit_tp2');
        } else if (!signal.hit_tp1 && signal.tp1 && (isLong ? currentPrice >= signal.tp1 : currentPrice <= signal.tp1)) {
          update = { id: signal.id, hit: 'tp1', price: currentPrice, symbol: signal.symbol };
          await db.updateSignalHit(signal.id, 'hit_tp1');
        }

        // Check SL hit
        if (!signal.hit_sl && signal.stop_loss && (isLong ? currentPrice <= signal.stop_loss : currentPrice >= signal.stop_loss)) {
          update = { id: signal.id, hit: 'sl', price: currentPrice, symbol: signal.symbol };
          await db.updateSignalHit(signal.id, 'hit_sl');
          await db.closeSignal(signal.id);
          if (this.signalEngine) this.signalEngine.markSLHit(signal.symbol);
        }

        // Auto-close signals older than 48 hours
        const age = Date.now() - new Date(signal.created_at).getTime();
        if (age > 48 * 60 * 60 * 1000) {
          await db.closeSignal(signal.id);
          update = update || { id: signal.id, hit: 'expired', price: currentPrice, symbol: signal.symbol };
        }

        if (update) {
          update.signal = signal;
          updates.push(update);
        }
      } catch (err) {
        logger.error(`Tracker error for ${signal.symbol}: ${err.message}`);
      }
    }

    return updates;
  }

  async getCurrentPrice(symbol, exchangeId) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) return null;

    try {
      // Try perp first, then spot
      const pairs = [`${symbol}/USDT:USDT`, `${symbol}/USDT`];
      for (const pair of pairs) {
        if (exchange.markets[pair]) {
          const ticker = await exchange.fetchTicker(pair);
          return ticker.last;
        }
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  formatUpdate(update) {
    const s = update.signal;
    const pnl = s.direction === 'long'
      ? ((update.price - s.current_price) / s.current_price * 100).toFixed(2)
      : ((s.current_price - update.price) / s.current_price * 100).toFixed(2);

    if (update.hit === 'tp1') {
      return `✅ <b>TP1 HIT!</b> $${s.symbol}\n\nEntry: $${s.current_price}\nTP1: $${s.tp1}\nCurrent: $${update.price}\nPnL: <b>+${pnl}%</b>\n\n🎯 Partial profits secured. TP2 & TP3 still active.`;
    }
    if (update.hit === 'tp2') {
      return `✅✅ <b>TP2 HIT!</b> $${s.symbol}\n\nEntry: $${s.current_price}\nTP2: $${s.tp2}\nCurrent: $${update.price}\nPnL: <b>+${pnl}%</b>\n\n🚀 Riding to TP3...`;
    }
    if (update.hit === 'tp3') {
      return `🏆 <b>TP3 HIT — FULL TARGET!</b> $${s.symbol}\n\nEntry: $${s.current_price}\nTP3: $${s.tp3}\nCurrent: $${update.price}\nPnL: <b>+${pnl}%</b>\n\n💰 Signal closed. Maximum extraction achieved.`;
    }
    if (update.hit === 'sl') {
      return `🔴 <b>STOP LOSS HIT</b> $${s.symbol}\n\nEntry: $${s.current_price}\nSL: $${s.stop_loss}\nCurrent: $${update.price}\nPnL: <b>${pnl}%</b>\n\nSignal closed. Risk managed.`;
    }
    if (update.hit === 'expired') {
      return `⏰ <b>SIGNAL EXPIRED</b> $${s.symbol}\n\nEntry: $${s.current_price}\nCurrent: $${update.price}\nPnL: <b>${pnl > 0 ? '+' : ''}${pnl}%</b>\n\nAuto-closed after 48 hours.`;
    }
    return '';
  }
}

module.exports = SignalTracker;
