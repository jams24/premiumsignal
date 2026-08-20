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
          .filter(([, t]) => t.quoteVolume > 1500000)
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

      // RSI — block extremes, penalize overbought longs / oversold shorts
      if (currentRSI > 90) { return null; }
      if (currentRSI > 80) { score += 10; direction = 'short'; signals.push(`RSI overbought ${currentRSI.toFixed(0)}`); }
      else if (currentRSI > 70) { score += 15; direction = 'short'; signals.push(`RSI overbought ${currentRSI.toFixed(0)}`); }
      else if (currentRSI < 10) { return null; }
      else if (currentRSI < 20) { score += 10; direction = 'long'; signals.push(`RSI oversold ${currentRSI.toFixed(0)}`); }
      else if (currentRSI < 30) { score += 15; signals.push(`RSI oversold ${currentRSI.toFixed(0)}`); }
      else if (currentRSI > 50 && currentRSI < 70) { score += 10; signals.push(`RSI bullish ${currentRSI.toFixed(0)}`); }
      const rsiExtreme = currentRSI > 75 || currentRSI < 25;

      // Bollinger Band breakout
      if (currentBB && currentPrice > currentBB.upper) { score += 15; signals.push('BB upper breakout'); }
      else if (currentBB && currentPrice < currentBB.lower) { score += 15; signals.push('BB lower touch'); }

      // MACD
      if (currentMACD && currentMACD.histogram > 0 && macd[macd.length - 2]?.histogram < 0) {
        score += 15; signals.push('MACD bullish cross');
      } else if (currentMACD && currentMACD.histogram < 0 && macd[macd.length - 2]?.histogram > 0) {
        score += 10; direction = 'short'; signals.push('MACD bearish cross');
      }

      // Volume spike — confirms interest but high spikes mean move already happened
      if (volumeRatio > 5) { score += 5; signals.push(`Volume ${volumeRatio.toFixed(1)}x avg (spike)`); }
      else if (volumeRatio > 3) { score += 10; signals.push(`Volume ${volumeRatio.toFixed(1)}x avg`); }
      else if (volumeRatio > 2) { score += 10; signals.push(`Volume ${volumeRatio.toFixed(1)}x avg`); }

      // Price change momentum
      const change24h = ticker.percentage || 0;
      if (Math.abs(change24h) > 15) score += 10;

      // Overextension filter: skip if price moved too much in recent candles
      const recentCloses = closes.slice(-6);
      const recentLow = Math.min(...recentCloses);
      const recentHigh = Math.max(...recentCloses);
      const recentMove = ((recentHigh - recentLow) / recentLow) * 100;
      if (recentMove > 30) {
        return null;
      }
      if (recentMove > 15) {
        score -= 15;
        signals.push(`Overextended ${recentMove.toFixed(0)}% in 6 candles`);
      }

      // Pullback filter: for longs, reject if price is too far above EMA20 (chasing)
      const distFromEma20 = ((currentPrice - currentEma20) / currentEma20) * 100;
      if (direction === 'long' && distFromEma20 > 5) {
        return null;
      }
      if (direction === 'long' && distFromEma20 > 3) {
        score -= 10;
        signals.push(`Extended ${distFromEma20.toFixed(1)}% above EMA20`);
      }

      // SMC Analysis
      const smcResult = this.smc.analyze(ohlcv);
      let smcData = null;
      if (smcResult) {
        score += smcResult.score;
        for (const s of smcResult.signals) signals.push(s);

        // SMC can override direction: ChoCH or BOS with structure bias
        // BUT not when RSI is at extreme levels (>75 or <25) — RSI exhaustion takes priority
        if (!rsiExtreme) {
          const bullishChoch = smcResult.chochEvents.find(e => e.type === 'CHOCH_BULLISH');
          const bearishChoch = smcResult.chochEvents.find(e => e.type === 'CHOCH_BEARISH');
          if (bullishChoch && direction === 'short') direction = 'long';
          if (bearishChoch && direction === 'long') direction = 'short';

          const latestBos = smcResult.bosEvents?.length > 0 ? smcResult.bosEvents[smcResult.bosEvents.length - 1] : null;
          if (latestBos && smcResult.structureBias === 'bullish' && latestBos.type === 'BOS_BULLISH' && direction === 'short') {
            direction = 'long';
            signals.push('SMC bullish BOS overrides short');
          } else if (latestBos && smcResult.structureBias === 'bearish' && latestBos.type === 'BOS_BEARISH' && direction === 'long') {
            direction = 'short';
            signals.push('SMC bearish BOS overrides long');
          }
        } else {
          signals.push(`RSI extreme (${currentRSI.toFixed(0)}) — SMC override blocked`);
        }

        // SMC structure confirmation bonus
        if ((smcResult.structureBias === 'bullish' && direction === 'long') ||
            (smcResult.structureBias === 'bearish' && direction === 'short')) {
          score += 10;
          signals.push('SMC confirms direction');
        }

        // Hard block if SMC structure conflicts with direction (0% historical win rate)
        if ((smcResult.structureBias === 'bullish' && direction === 'short') ||
            (smcResult.structureBias === 'bearish' && direction === 'long')) {
          return null;
        }

        // Resistance/support zone filter: block entries heading into nearby S/R
        if (smcResult.swingHighs && smcResult.swingLows) {
          if (direction === 'long') {
            // Check if there's a recent swing high or bearish OB just above entry (within 2% = resistance ceiling)
            const nearResistance = smcResult.swingHighs.some(sh => {
              const dist = ((sh.price - currentPrice) / currentPrice) * 100;
              return dist > 0 && dist < 2;
            });
            const nearBearishOB = smcResult.orderBlocks.some(ob => {
              if (ob.type !== 'OB_BEARISH') return false;
              const dist = ((ob.low - currentPrice) / currentPrice) * 100;
              return dist > 0 && dist < 2;
            });
            if (nearResistance || nearBearishOB) {
              score -= 15;
              signals.push(`Near resistance ${nearBearishOB ? '(supply zone)' : '(swing high)'} — risky long`);
            }
          }
          if (direction === 'short') {
            const nearSupport = smcResult.swingLows.some(sl => {
              const dist = ((currentPrice - sl.price) / currentPrice) * 100;
              return dist > 0 && dist < 2;
            });
            const nearBullishOB = smcResult.orderBlocks.some(ob => {
              if (ob.type !== 'OB_BULLISH') return false;
              const dist = ((currentPrice - ob.high) / currentPrice) * 100;
              return dist > 0 && dist < 2;
            });
            if (nearSupport || nearBullishOB) {
              score -= 15;
              signals.push(`Near support ${nearBullishOB ? '(demand zone)' : '(swing low)'} — risky short`);
            }
          }
        }

        // Extended move filter: penalize entries after price already ran hard from recent base
        if (smcResult.swingHighs && smcResult.swingLows) {
          if (direction === 'long' && smcResult.swingLows.length > 0) {
            const recentLow = Math.max(...smcResult.swingLows.slice(-3).map(sl => sl.price));
            const moveFromBase = ((currentPrice - recentLow) / recentLow) * 100;
            if (moveFromBase > 15) {
              score -= 20;
              signals.push(`Extended move +${moveFromBase.toFixed(1)}% from base — chasing`);
            }
          }
          if (direction === 'short' && smcResult.swingHighs.length > 0) {
            const recentHigh = Math.min(...smcResult.swingHighs.slice(-3).map(sh => sh.price));
            const moveFromTop = ((recentHigh - currentPrice) / recentHigh) * 100;
            if (moveFromTop > 15) {
              score -= 20;
              signals.push(`Extended move -${moveFromTop.toFixed(1)}% from top — chasing`);
            }
          }
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

      // 4H trend filter: reject counter-trend entries
      try {
        const ohlcv4h = await exchange.fetchOHLCV(symbol, '4h', undefined, 30);
        if (ohlcv4h.length >= 25) {
          const closes4h = ohlcv4h.map(c => c[4]);
          const ema20_4h = EMA.calculate({ values: closes4h, period: 20 });
          const currentEma4h = ema20_4h[ema20_4h.length - 1];
          const price4h = closes4h[closes4h.length - 1];
          const trendGap = Math.abs((price4h - currentEma4h) / currentEma4h) * 100;
          if (direction === 'long' && price4h < currentEma4h) {
            if (trendGap > 5) return null; // hard block: strong downtrend
            score -= 20;
            signals.push(`4H below EMA20 by ${trendGap.toFixed(1)}% (counter-trend)`);
          } else if (direction === 'short' && price4h > currentEma4h) {
            if (trendGap > 5) return null; // hard block: strong uptrend
            score -= 20;
            signals.push(`4H above EMA20 by ${trendGap.toFixed(1)}% (counter-trend)`);
          } else {
            score += 10;
            signals.push('4H trend aligned');
          }
        }
      } catch (e) { /* 4H data unavailable, skip filter */ }

      if (score < 40) return null;

      // Require candle confirmation matching direction
      const lastOpen = ohlcv[ohlcv.length - 1][1];
      const lastClose = ohlcv[ohlcv.length - 1][4];
      if (direction === 'short' && lastClose >= lastOpen) return null;
      if (direction === 'long' && lastClose <= lastOpen) return null;
      signals.push(direction === 'long' ? 'Bullish candle confirmed' : 'Bearish candle confirmed');

      // Suppress signals during low-liquidity hours (04:00-06:00 UTC)
      const currentHourUTC = new Date().getUTCHours();
      if (currentHourUTC >= 4 && currentHourUTC <= 5) return null;

      // Calculate TP/SL using ATR
      const atrValue = currentATR || currentPrice * 0.02;
      const isLong = direction === 'long';

      const entryLow = isLong ? currentPrice * 0.995 : currentPrice * 1.005;
      const entryHigh = isLong ? currentPrice * 1.005 : currentPrice * 0.995;
      const tp1 = isLong ? currentPrice + atrValue * 2.5 : currentPrice - atrValue * 2.5;
      const tp2 = isLong ? currentPrice + atrValue * 4.5 : currentPrice - atrValue * 4.5;
      const tp3 = isLong ? currentPrice + atrValue * 7 : currentPrice - atrValue * 7;
      const stopLoss = isLong ? currentPrice - atrValue * 3 : currentPrice + atrValue * 3;

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
