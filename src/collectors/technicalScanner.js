const ccxt = require('ccxt');
const { RSI, EMA, BollingerBands, MACD, ATR } = require('technicalindicators');
const logger = require('../utils/logger');
const db = require('../db/database');
const SMCAnalyzer = require('./smcAnalyzer');

class TechnicalScanner {
  constructor(exchanges) {
    this.exchanges = exchanges;
    this.smc = new SMCAnalyzer();
  }

  async scanAll() {
    const candidates = [];

    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      try {
        const perpMarkets = Object.values(exchange.markets).filter(m => m.swap && m.quote === 'USDT' && m.active);
        const tickers = await exchange.fetchTickers(perpMarkets.map(m => m.symbol));

        const sorted = Object.entries(tickers)
          .filter(([, t]) => t.quoteVolume > 500000)
          .sort((a, b) => Math.abs(b[1].percentage || 0) - Math.abs(a[1].percentage || 0))
          .slice(0, 100);

        for (const [symbol, ticker] of sorted) {
          try {
            const score = this.quickScore(ticker);
            if (score >= 40) {
              const analysis = await this.deepAnalyze(exchange, exchangeId, symbol, ticker);
              if (analysis) {
                analysis.quoteVolume = ticker.quoteVolume || 0;
                analysis.hasApiKey = !!(exchange.apiKey && exchange.secret);
                candidates.push(analysis);
              }
            }
          } catch (e) { /* skip individual failures */ }
        }
      } catch (err) {
        logger.error(`Scan failed for ${exchangeId}: ${err.message}`);
      }
    }

    // Deduplicate: keep best exchange per symbol
    const bestBySymbol = new Map();
    for (const c of candidates) {
      const existing = bestBySymbol.get(c.symbol);
      if (!existing || this.preferExchange(c, existing)) {
        bestBySymbol.set(c.symbol, c);
      }
    }

    return [...bestBySymbol.values()].sort((a, b) => b.score - a.score);
  }

  // Pick the better exchange for a symbol
  preferExchange(candidate, existing) {
    // 1. Prefer exchange with API keys configured (can actually trade)
    if (candidate.hasApiKey && !existing.hasApiKey) return true;
    if (!candidate.hasApiKey && existing.hasApiKey) return false;
    // 2. Prefer higher score
    if (candidate.score !== existing.score) return candidate.score > existing.score;
    // 3. Prefer higher volume (better liquidity/tighter spreads)
    return candidate.quoteVolume > existing.quoteVolume;
  }

  quickScore(ticker) {
    let score = 0;
    const change = ticker.percentage || 0;
    const volume = ticker.quoteVolume || 0;

    // Price momentum
    if (change > 10) score += 20;
    else if (change > 5) score += 10;
    else if (change < -10) score += 15; // potential short or bounce

    // Volume (absolute threshold for liquidity)
    if (volume > 50_000_000) score += 15;
    else if (volume > 10_000_000) score += 10;
    else if (volume > 1_000_000) score += 5;

    // Volatility (high - low range)
    if (ticker.high && ticker.low && ticker.low > 0) {
      const range = ((ticker.high - ticker.low) / ticker.low) * 100;
      if (range > 20) score += 15;
      else if (range > 10) score += 10;
    }

    return score;
  }

  async deepAnalyze(exchange, exchangeId, symbol, ticker) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 100);
      if (ohlcv.length < 30) return null;

      const closes = ohlcv.map(c => c[4]);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const volumes = ohlcv.map(c => c[5]);

      // Calculate indicators
      const rsi = RSI.calculate({ values: closes, period: 14 });
      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      const macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
      const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

      const currentRSI = rsi[rsi.length - 1];
      const currentPrice = closes[closes.length - 1];
      const currentEma20 = ema20[ema20.length - 1];
      const currentEma50 = ema50[ema50.length - 1];
      const currentBB = bb[bb.length - 1];
      const currentMACD = macd[macd.length - 1];
      const currentATR = atr[atr.length - 1];

      // Volume analysis
      const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentVolume = volumes[volumes.length - 1];
      const volumeRatio = currentVolume / avgVolume;

      // Scoring
      let score = 0;
      let direction = 'long';
      const signals = [];

      // Trend: EMA cross
      if (currentEma20 > currentEma50) { score += 10; signals.push('EMA20>EMA50'); }
      else { score += 5; signals.push('EMA20<EMA50'); }

      // RSI — block 90+ (82% SL rate), sweet spot is 70-80
      if (currentRSI > 90) { return null; }
      if (currentRSI > 70) { score += currentRSI <= 80 ? 15 : 10; direction = 'short'; signals.push(`RSI overbought ${currentRSI.toFixed(0)}`); }
      else if (currentRSI < 30) { score += 15; signals.push(`RSI oversold ${currentRSI.toFixed(0)}`); }
      else if (currentRSI > 50 && currentRSI < 70) { score += 5; signals.push(`RSI bullish ${currentRSI.toFixed(0)}`); }

      // Bollinger Band breakout
      if (currentBB && currentPrice > currentBB.upper) { score += 15; signals.push('BB upper breakout'); }
      else if (currentBB && currentPrice < currentBB.lower) { score += 15; signals.push('BB lower touch'); }

      // MACD
      if (currentMACD && currentMACD.histogram > 0 && macd[macd.length - 2]?.histogram < 0) {
        score += 15; signals.push('MACD bullish cross');
      } else if (currentMACD && currentMACD.histogram < 0 && macd[macd.length - 2]?.histogram > 0) {
        score += 10; direction = 'short'; signals.push('MACD bearish cross');
      }

      // Volume spike
      if (volumeRatio > 3) { score += 20; signals.push(`Volume ${volumeRatio.toFixed(1)}x avg`); }
      else if (volumeRatio > 2) { score += 10; signals.push(`Volume ${volumeRatio.toFixed(1)}x avg`); }

      // Price change momentum
      const change24h = ticker.percentage || 0;
      if (Math.abs(change24h) > 15) score += 10;

      // SMC Analysis
      const smcResult = this.smc.analyze(ohlcv);
      let smcData = null;
      if (smcResult) {
        score += smcResult.score;
        for (const s of smcResult.signals) signals.push(s);

        // SMC can override direction: ChoCH or BOS with structure bias
        const bullishChoch = smcResult.chochEvents.find(e => e.type === 'CHOCH_BULLISH');
        const bearishChoch = smcResult.chochEvents.find(e => e.type === 'CHOCH_BEARISH');
        if (bullishChoch && direction === 'short') direction = 'long';
        if (bearishChoch && direction === 'long') direction = 'short';

        // BOS with structure bias also overrides direction
        const hasBos = smcResult.bosEvents?.length > 0;
        if (hasBos && smcResult.structureBias === 'bullish' && direction === 'short') {
          direction = 'long';
          signals.push('SMC bullish BOS overrides short');
        } else if (hasBos && smcResult.structureBias === 'bearish' && direction === 'long') {
          direction = 'short';
          signals.push('SMC bearish BOS overrides long');
        }

        // SMC structure confirmation bonus
        if ((smcResult.structureBias === 'bullish' && direction === 'long') ||
            (smcResult.structureBias === 'bearish' && direction === 'short')) {
          score += 10;
          signals.push('SMC confirms direction');
        }

        // Penalize if SMC structure still conflicts with direction after overrides
        if ((smcResult.structureBias === 'bullish' && direction === 'short') ||
            (smcResult.structureBias === 'bearish' && direction === 'long')) {
          score -= 20;
          signals.push('SMC conflicts with direction');
        }

        smcData = {
          structureBias: smcResult.structureBias,
          orderBlocks: smcResult.orderBlocks,
          fvgs: smcResult.fvgs,
          bosEvents: smcResult.bosEvents,
          chochEvents: smcResult.chochEvents,
        };
      }

      if (score < 40) return null;

      // Require bearish candle confirmation for shorts
      if (direction === 'short') {
        const lastOpen = ohlcv[ohlcv.length - 1][1];
        const lastClose = ohlcv[ohlcv.length - 1][4];
        if (lastClose >= lastOpen) return null; // skip if latest candle is green
        signals.push('Bearish candle confirmed');
      }

      // Suppress signals during low-liquidity hours (06:00 and 15:00 UTC)
      const currentHourUTC = new Date().getUTCHours();
      if (currentHourUTC === 6 || currentHourUTC === 15) return null;

      // Calculate TP/SL using ATR
      const atrValue = currentATR || currentPrice * 0.02;
      const isLong = direction === 'long';

      const entryLow = isLong ? currentPrice * 0.995 : currentPrice * 1.005;
      const entryHigh = isLong ? currentPrice * 1.005 : currentPrice * 0.995;
      const tp1 = isLong ? currentPrice + atrValue * 2 : currentPrice - atrValue * 2;
      const tp2 = isLong ? currentPrice + atrValue * 4 : currentPrice - atrValue * 4;
      const tp3 = isLong ? currentPrice + atrValue * 6 : currentPrice - atrValue * 6;
      const stopLoss = isLong ? currentPrice - atrValue * 3.5 : currentPrice + atrValue * 3.5;

      return {
        symbol: symbol.replace('/USDT:USDT', '').replace('/USDT', ''),
        pair: symbol,
        exchange: exchangeId,
        direction,
        currentPrice,
        change24h,
        volumeRatio,
        rsi: currentRSI,
        score,
        signals,
        atr: atrValue,
        smc: smcData,
        entryLow: parseFloat(entryLow.toPrecision(6)),
        entryHigh: parseFloat(entryHigh.toPrecision(6)),
        tp1: parseFloat(tp1.toPrecision(6)),
        tp2: parseFloat(tp2.toPrecision(6)),
        tp3: parseFloat(tp3.toPrecision(6)),
        stopLoss: parseFloat(stopLoss.toPrecision(6)),
        tp1Pct: ((Math.abs(tp1 - currentPrice) / currentPrice) * 100).toFixed(1),
        tp2Pct: ((Math.abs(tp2 - currentPrice) / currentPrice) * 100).toFixed(1),
        tp3Pct: ((Math.abs(tp3 - currentPrice) / currentPrice) * 100).toFixed(1),
        slPct: ((Math.abs(stopLoss - currentPrice) / currentPrice) * 100).toFixed(1),
      };
    } catch (err) {
      return null;
    }
  }

  async findFundingRateExtremes(exchange, exchangeId) {
    const opportunities = [];
    try {
      if (!exchange.has.fetchFundingRates) return opportunities;
      const rates = await exchange.fetchFundingRates();

      for (const [symbol, info] of Object.entries(rates)) {
        const rate = info.fundingRate;
        if (rate === null || rate === undefined) continue;

        // Extreme positive funding = crowded longs, potential short opportunity
        if (rate > 0.001) {
          opportunities.push({ symbol, exchange: exchangeId, fundingRate: rate, direction: 'short', reason: `High funding rate ${(rate * 100).toFixed(3)}% — crowded longs` });
        }
        // Extreme negative funding = crowded shorts, potential long opportunity
        else if (rate < -0.001) {
          opportunities.push({ symbol, exchange: exchangeId, fundingRate: rate, direction: 'long', reason: `Negative funding ${(rate * 100).toFixed(3)}% — crowded shorts` });
        }
      }
    } catch (err) {
      logger.error(`Funding rate fetch failed for ${exchangeId}: ${err.message}`);
    }

    return opportunities.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  }
}

module.exports = TechnicalScanner;
