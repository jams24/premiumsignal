const logger = require('../utils/logger');
const db = require('../db/database');

class SignalEngine {
  constructor() {
    this.recentSignals = new Map(); // dedup: symbol -> timestamp
    this.cooldownMs = 30 * 60 * 1000; // 30 min cooldown per symbol
  }

  async processListingSignal(listing, technicalData) {
    if (this.isOnCooldown(listing.symbol)) return null;

    const signal = {
      type: 'LISTING',
      symbol: listing.symbol,
      exchange: listing.exchange,
      direction: 'long',
      confidence: 4,
      catalyst: `New ${listing.type} listing on ${listing.exchange.toUpperCase()}`,
      suggestedLeverage: 5,
      volumeInfo: 'New listing — monitor volume in first 30min',
    };

    // If we have price data already, add entry/TP/SL
    if (technicalData) {
      Object.assign(signal, {
        currentPrice: technicalData.currentPrice,
        entryLow: technicalData.currentPrice * 0.95,
        entryHigh: technicalData.currentPrice * 1.02,
        tp1: technicalData.currentPrice * 1.20,
        tp2: technicalData.currentPrice * 1.50,
        tp3: technicalData.currentPrice * 2.00,
        stopLoss: technicalData.currentPrice * 0.85,
        tp1Pct: '20.0', tp2Pct: '50.0', tp3Pct: '100.0', slPct: '15.0',
      });
    }

    this.markSent(listing.symbol);
    await db.saveSignal(signal);
    return signal;
  }

  async processBreakoutSignal(scan) {
    if (this.isOnCooldown(scan.symbol)) return null;
    if (scan.score < 50) return null;

    const confidence = scan.score >= 80 ? 5 : scan.score >= 65 ? 4 : 3;

    const signal = {
      type: scan.volumeRatio > 3 ? 'VOLUME_SPIKE' : 'BREAKOUT',
      symbol: scan.symbol,
      exchange: scan.exchange,
      direction: scan.direction,
      currentPrice: scan.currentPrice,
      entryLow: scan.entryLow,
      entryHigh: scan.entryHigh,
      tp1: scan.tp1, tp2: scan.tp2, tp3: scan.tp3,
      stopLoss: scan.stopLoss,
      tp1Pct: scan.tp1Pct, tp2Pct: scan.tp2Pct, tp3Pct: scan.tp3Pct, slPct: scan.slPct,
      confidence,
      catalyst: scan.signals.join(' | '),
      suggestedLeverage: confidence >= 4 ? 10 : 5,
      volumeInfo: `${scan.volumeRatio.toFixed(1)}x average volume`,
    };

    this.markSent(scan.symbol);
    await db.saveSignal(signal);
    return signal;
  }

  processFundingSignal(funding) {
    if (this.isOnCooldown(funding.symbol)) return null;

    const symbol = funding.symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    const signal = {
      type: 'FUNDING_SHORT',
      symbol,
      exchange: funding.exchange,
      direction: funding.direction,
      confidence: 3,
      catalyst: funding.reason,
      suggestedLeverage: 5,
    };

    this.markSent(symbol);
    return signal;
  }

  isOnCooldown(symbol) {
    const lastSent = this.recentSignals.get(symbol);
    if (!lastSent) return false;
    return Date.now() - lastSent < this.cooldownMs;
  }

  markSent(symbol) {
    this.recentSignals.set(symbol, Date.now());
  }
}

module.exports = SignalEngine;
