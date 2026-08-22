const logger = require('../utils/logger');
const db = require('../db/database');

class SignalEngine {
  constructor() {
    this.recentSignals = new Map(); // dedup: symbol -> timestamp (cross-exchange)
    this.rejects = new Map();
    this.cooldownMs = 4 * 60 * 60 * 1000;
    this.slBackoffMs = 12 * 60 * 60 * 1000; // 12hr cooldown after SL hit
    this.slSymbols = new Map(); // symbol -> timestamp of last SL
  }

  rejectSummary() {
    if (!this.rejects.size) return '';
    const s = [...this.rejects.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`).join(' | ');
    this.rejects = new Map();
    return s;
  }

  markSLHit(symbol) {
    const base = symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    this.slSymbols.set(base, Date.now());
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

    if (!technicalData?.currentPrice) return null;
    // ATR-based targets (same as breakouts — old 20%/50%/100% were unrealistic)
    const atr = technicalData.atr || technicalData.currentPrice * 0.03;
    const price = technicalData.currentPrice;
    Object.assign(signal, {
      currentPrice: price,
      entryLow: price * 0.995,
      entryHigh: price * 1.005,
      tp1: price + atr * 2,
      tp2: price + atr * 4,
      tp3: price + atr * 6,
      stopLoss: price - atr * 3.5,
      tp1Pct: ((atr * 2 / price) * 100).toFixed(1),
      tp2Pct: ((atr * 4 / price) * 100).toFixed(1),
      tp3Pct: ((atr * 6 / price) * 100).toFixed(1),
      slPct: ((atr * 3.5 / price) * 100).toFixed(1),
    });

    this.markSent(listing.symbol);
    const saved = await db.saveSignal(signal);
    signal.id = saved?.id ?? null;
    return signal;
  }

  async processBreakoutSignal(scan) {
    const reject = (reason) => {
      this.rejects.set(reason, (this.rejects.get(reason) || 0) + 1);
      return null;
    };
    if (this.isOnCooldown(scan.symbol)) return reject('cooldown');
    if (scan.score < 70) return reject('score_below_70');

    // Volume filter: spikes need 5x+, breakouts need 2x+, V-reversals need 1.5x
    if (scan.type === 'VREVERSAL') {
      if (scan.volumeRatio < 1.5) return reject('vreversal_volume');
    } else {
      const minVol = scan.volumeRatio > 3 ? 5 : 2;
      if (scan.volumeRatio < minVol) return reject('volume_below_min');
    }

    let confidence = scan.score >= 80 ? 5 : scan.score >= 65 ? 4 : 3;

    // SMC confirmation boost: ChoCH or BOS + OB alignment = +1 confidence
    if (scan.smc) {
      const hasChoch = scan.smc.chochEvents?.length > 0;
      const hasBos = scan.smc.bosEvents?.length > 0;
      const hasOB = scan.smc.orderBlocks?.length > 0;
      if ((hasChoch || (hasBos && hasOB)) && confidence < 5) confidence++;
    }

    const signal = {
      type: scan.type || (scan.volumeRatio > 3 ? 'VOLUME_SPIKE' : 'BREAKOUT'),
      symbol: scan.symbol,
      exchange: scan.exchange,
      direction: scan.direction,
      currentPrice: scan.currentPrice,
      entryLow: scan.entryLow,
      entryHigh: scan.entryHigh,
      tp1: scan.tp1, tp2: scan.tp2, tp3: scan.tp3,
      stopLoss: scan.stopLoss,
      tp1Pct: scan.tp1Pct, tp2Pct: scan.tp2Pct, tp3Pct: scan.tp3Pct, slPct: scan.slPct,
      atr: scan.atr || null,
      smc: scan.smc || null,
      confidence,
      catalyst: scan.signals.join(' | '),
      suggestedLeverage: confidence >= 4 ? 10 : 5,
      volumeInfo: `${scan.volumeRatio.toFixed(1)}x average volume`,
    };

    this.markSent(scan.symbol);
    const saved = await db.saveSignal(signal);
    signal.id = saved?.id ?? null;
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
    const base = symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    // Check SL backoff first (12hr after SL hit)
    const lastSL = this.slSymbols.get(base);
    if (lastSL && Date.now() - lastSL < this.slBackoffMs) return true;
    // Normal cooldown (cross-exchange — uses base symbol only)
    const lastSent = this.recentSignals.get(base);
    if (!lastSent) return false;
    return Date.now() - lastSent < this.cooldownMs;
  }

  markSent(symbol) {
    const base = symbol.replace('/USDT:USDT', '').replace('/USDT', '');
    this.recentSignals.set(base, Date.now());
  }
}

module.exports = SignalEngine;
