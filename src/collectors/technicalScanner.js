const ccxt = require('ccxt');
const { RSI, EMA, BollingerBands, MACD, ATR } = require('technicalindicators');
const logger = require('../utils/logger');
const db = require('../db/database');
const SMCAnalyzer = require('./smcAnalyzer');

const STOCK_TOKENS = /^(AAPL|MSFT|GOOG|GOOGL|AMZN|TSLA|META|NVDA|AMD|INTC|NFLX|DIS|BA|JPM|GS|WMT|PDD|JD|BABA|NIO|XPEV|LI|MRK|PFE|JNJ|ABBV|UNH|CVS|COIN|MSTR|GME|AMC|PLTR|SNOW|UBER|LYFT|ABNB|CVNA|RIVN|LCID)$/;

class TechnicalScanner {
  constructor(exchanges) {
    this.exchanges = exchanges;
    this.smc = new SMCAnalyzer();
    this.rejects = new Map();
    this.zoneSignalHistory = new Map(); // symbol → timestamp of last zone signal
  }

  reject(reason) {
    this.rejects.set(reason, (this.rejects.get(reason) || 0) + 1);
    return null;
  }

  rejectSummary() {
    if (!this.rejects.size) return '';
    return [...this.rejects.entries()].sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`).join(' | ');
  }

  async scanAll() {
    const candidates = [];
    this.rejects = new Map();

    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      try {
        const perpMarkets = Object.values(exchange.markets).filter(m => m.swap && m.quote === 'USDT' && m.active);
        const tickers = await exchange.fetchTickers(perpMarkets.map(m => m.symbol));

        const sorted = Object.entries(tickers)
          .filter(([, t]) => t.quoteVolume > 1500000)
          .filter(([s]) => !s.includes('STOCK') && !STOCK_TOKENS.test(s.split('/')[0]))
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

  async analyzeSymbol(baseSymbol, exchangeId) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) return null;
    const pair = `${baseSymbol}/USDT:USDT`;
    if (!exchange.markets[pair]) return null;
    try {
      const ticker = await exchange.fetchTicker(pair);
      const deep = await this.deepAnalyze(exchange, exchangeId, pair, ticker);
      if (deep) return deep;
      // Momentum/breakout scan found nothing — check for a V-reversal setup
      // (capitulation dump → oversold → reclaim). Catches early reversal moves
      // that breakout-only logic structurally misses.
      return await this.detectVReversal(exchange, exchangeId, pair, ticker);
    } catch (e) {
      logger.error(`analyzeSymbol ${baseSymbol}: ${e.message}`);
      return null;
    }
  }

  // V-Reversal detector: capitulation low + oversold RSI + fresh EMA20 reclaim
  // on expanding volume. This is the "BLESS-style" early reversal catch.
  async detectVReversal(exchange, exchangeId, symbol, ticker) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 100);
      if (ohlcv.length < 40) return null;

      const closes = ohlcv.map(c => c[4]);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const volumes = ohlcv.map(c => c[5]);

      const rsi = RSI.calculate({ values: closes, period: 14 });
      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

      const currentPrice = closes[closes.length - 1];
      const currentRSI = rsi[rsi.length - 1];
      const currentEma20 = ema20[ema20.length - 1];
      const currentATR = atr[atr.length - 1];
      if (!currentRSI || !currentEma20 || !currentATR) return null;

      // 1) Capitulation: meaningful decline from the highest high of the last
      //    28 candles to the lowest low AFTER that high (true top-to-trough)
      const win = ohlcv.slice(-28);
      let hi = -Infinity, hiIdx = -1;
      win.forEach((cd, i) => { if (cd[2] > hi) { hi = cd[2]; hiIdx = i; } });
      const recentLow = Math.min(...win.slice(hiIdx).map(cd => cd[3]));
      const decline = ((hi - recentLow) / hi) * 100;
      if (decline < 12) return null;

      // 2) Oversold print within the last 8 candles
      if (!rsi.slice(-8, -1).some(v => v < 32)) return null;

      // 3) Fresh reclaim: last candle green AND closes above EMA20, with the
      //    cross happening no earlier than 3 candles ago (older = stale, chasing)
      const last = ohlcv[ohlcv.length - 1];
      const recentCloses = closes.slice(-4);          // last 4 incl. current
      const recentEmas = ema20.slice(-4);
      let candlesAbove = 0;
      for (let i = 0; i < 3; i++) {                   // the 3 closed candles before current
        if (recentCloses[i] > recentEmas[i]) candlesAbove++;
      }
      if (last[4] <= last[1]) return null;            // must be a green candle
      if (last[4] <= currentEma20) return null;       // must close above EMA20
      if (candlesAbove === 3) return null;            // cross is stale (>3 candles old)

      // 4) Volume confirmation: reclaim volume ≥1.5x the average of the prior 10 candles
      const priorVols = volumes.slice(-11, -1);
      const avgPriorVol = priorVols.reduce((a, b) => a + b, 0) / priorVols.length;
      const volumeRatio = last[5] / avgPriorVol;
      if (volumeRatio < 1.5) return null;

      // Scoring — base 60 means it must earn confluence to clear the 70 gate
      let score = 60;
      const signals = ['V-Reversal: reclaim of EMA20 after capitulation'];
      if (decline > 20) { score += 5; signals.push(`Deep capitulation -${decline.toFixed(0)}%`); }
      if (currentRSI > 45 && currentRSI < 62) { score += 5; signals.push(`RSI recovering (${currentRSI.toFixed(0)})`); }
      if (volumeRatio >= 2.5) { score += 5; signals.push(`Volume ${volumeRatio.toFixed(1)}x on reclaim`); }
      // Bonus: reclaim also breaks the prior candle's high (strength confirmation)
      if (last[4] > highs[highs.length - 2]) { score += 5; signals.push('Broke prior candle high'); }

      const isLong = true; // V-reversals are long-only by design (fade-the-dump)
      const entryLow = currentPrice * 0.995;
      const entryHigh = currentPrice * 1.005;
      // SL goes below the capitulation low — structural stop beats arbitrary ATR distance
      const stopLoss = Math.min(recentLow * 0.997, currentPrice - currentATR * 2);
      // Targets scale off SL distance so R:R stays >= 1.25 even when the
      // structural stop is wide (deep capitulation low far below)
      const slDist = Math.abs(currentPrice - stopLoss);
      const tp1 = currentPrice + Math.max(currentATR * 2.5, slDist * 1.25);
      const tp2 = currentPrice + Math.max(currentATR * 4.5, slDist * 2.25);
      const tp3 = currentPrice + Math.max(currentATR * 7, slDist * 3.5);

      return {
        type: 'VREVERSAL',
        symbol: symbol.replace('/USDT:USDT', '').replace('/USDT', ''),
        pair: symbol,
        exchange: exchangeId,
        direction: 'long',
        currentPrice,
        change24h: ticker.percentage || 0,
        volumeRatio,
        rsi: currentRSI,
        score,
        signals,
        atr: currentATR,
        smc: null,
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
      logger.error(`detectVReversal ${symbol}: ${err.message}`);
      return null;
    }
  }

  async deepAnalyze(exchange, exchangeId, symbol, ticker) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 100);
      if (ohlcv.length < 30) return this.reject('insufficient_candles');

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

      // RSI — block extremes, lock direction on overbought/oversold
      let rsiLockedDirection = null;
      if (currentRSI > 90) { return this.reject('rsi_extreme_high'); }
      if (currentRSI > 80) { score += 10; direction = 'short'; rsiLockedDirection = 'short'; signals.push(`RSI overbought ${currentRSI.toFixed(0)}`); }
      else if (currentRSI > 70) { score += 15; direction = 'short'; rsiLockedDirection = 'short'; signals.push(`RSI overbought ${currentRSI.toFixed(0)}`); }
      else if (currentRSI < 10) { return this.reject('rsi_extreme_low'); }
      else if (currentRSI < 20) { score += 10; direction = 'long'; rsiLockedDirection = 'long'; signals.push(`RSI oversold ${currentRSI.toFixed(0)}`); }
      else if (currentRSI < 30) { score += 15; signals.push(`RSI oversold ${currentRSI.toFixed(0)}`); }
      else if (currentRSI > 50 && currentRSI < 70) { score += 10; signals.push(`RSI bullish ${currentRSI.toFixed(0)}`); }
      const rsiExtreme = currentRSI > 75 || currentRSI < 25;

      // Bollinger Band breakout
      if (currentBB && currentPrice > currentBB.upper) { score += 15; signals.push('BB upper breakout'); }
      else if (currentBB && currentPrice < currentBB.lower) { score += 15; signals.push('BB lower touch'); }

      // MACD — set direction only if RSI didn't lock it (prevents longing into overbought)
      if (currentMACD && currentMACD.histogram > 0 && macd[macd.length - 2]?.histogram < 0) {
        score += 15;
        if (!rsiLockedDirection) direction = 'long';
        signals.push('MACD bullish cross');
      } else if (currentMACD && currentMACD.histogram < 0 && macd[macd.length - 2]?.histogram > 0) {
        score += 10;
        if (!rsiLockedDirection) direction = 'short';
        signals.push('MACD bearish cross');
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
        return this.reject('overextended_6candle');
      }
      if (recentMove > 15) {
        score -= 15;
        signals.push(`Overextended ${recentMove.toFixed(0)}% in 6 candles`);
      }

      // Pullback filter: symmetric chase protection for BOTH directions
      // (previously longs-only, so the bot would short into capitulation lows)
      const distFromEma20 = ((currentPrice - currentEma20) / currentEma20) * 100;
      if (direction === 'long' && distFromEma20 > 8) {
        return this.reject('chasing_long_ema20');
      }
      if (direction === 'long' && distFromEma20 > 4) {
        score -= 15;
        signals.push(`Extended ${distFromEma20.toFixed(1)}% above EMA20`);
      }
      const distBelowEma20 = ((currentEma20 - currentPrice) / currentEma20) * 100;
      if (direction === 'short' && distBelowEma20 > 8) {
        return this.reject('chasing_short_ema20');
      }
      if (direction === 'short' && distBelowEma20 > 3) {
        score -= 10;
        signals.push(`Extended ${distBelowEma20.toFixed(1)}% below EMA20`);
      }

      // SMC Analysis
      const smcResult = this.smc.analyze(ohlcv);
      let smcData = null;
      if (smcResult) {
        score += smcResult.score;
        for (const s of smcResult.signals) signals.push(s);

        // SMC can override direction: ChoCH or BOS with structure bias
        // BUT not when RSI locked direction (>70 overbought or <20 oversold)
        if (!rsiLockedDirection) {
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
          signals.push(`RSI ${rsiLockedDirection === 'short' ? 'overbought' : 'oversold'} (${currentRSI.toFixed(0)}) — direction locked`);
        }

        // SMC structure confirmation bonus
        if ((smcResult.structureBias === 'bullish' && direction === 'long') ||
            (smcResult.structureBias === 'bearish' && direction === 'short')) {
          score += 10;
          signals.push('SMC confirms direction');
        }

        // Heavy penalty if SMC structure conflicts with direction
        if ((smcResult.structureBias === 'bullish' && direction === 'short') ||
            (smcResult.structureBias === 'bearish' && direction === 'long')) {
          score -= 25;
          signals.push(`SMC ${smcResult.structureBias} conflicts with ${direction}`);
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

      // Anti-chase / fade logic: overbought longs in a downtrend become SHORT
      // candidates instead of blocked signals (fixes "shorts spotted as longs").
      // A long above the upper BB with RSI>70 is a mean-reversion zone: only allow
      // it as a long if the underlying trend is genuinely bullish, else fade it.
      if (direction === 'long' && currentRSI > 70 && currentBB && currentPrice > currentBB.upper) {
        const downtrend = currentEma20 < currentEma50 ||
          (smcData && smcData.structureBias === 'bearish');
        if (!downtrend) return this.reject('overbought_uptrend_late');
        direction = 'short';
        score -= 10; // fading strength costs conviction
        signals.push('Fade: overbought rally in bearish structure → short');
      }
      if (direction === 'short' && currentRSI < 30 && currentBB && currentPrice < currentBB.lower) {
        const uptrend = currentEma20 > currentEma50 ||
          (smcData && smcData.structureBias === 'bullish');
        if (!uptrend) return this.reject('oversold_downtrend_late');
        direction = 'long';
        score -= 10;
        signals.push('Fade: oversold dump in bullish structure → long');
      }

      if (score < 40) return this.reject('score_below_40');

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
            if (trendGap > 5) return this.reject('counter_trend_4h_down');
            score -= 20;
            signals.push(`4H below EMA20 by ${trendGap.toFixed(1)}% (counter-trend)`);
          } else if (direction === 'short' && price4h > currentEma4h) {
            if (trendGap > 5) return this.reject('counter_trend_4h_up');
            score -= 20;
            signals.push(`4H above EMA20 by ${trendGap.toFixed(1)}% (counter-trend)`);
          } else {
            score += 10;
            signals.push('4H trend aligned');
          }
        }
      } catch (e) { /* 4H data unavailable, skip filter */ }

      if (score < 40) return this.reject('score_below_40');

      // Require candle confirmation matching direction
      const lastOpen = ohlcv[ohlcv.length - 1][1];
      const lastClose = ohlcv[ohlcv.length - 1][4];
      if (direction === 'short' && lastClose >= lastOpen) return this.reject('no_red_candle_confirm');
      if (direction === 'long' && lastClose <= lastOpen) return this.reject('no_green_candle_confirm');
      signals.push(direction === 'long' ? 'Bullish candle confirmed' : 'Bearish candle confirmed');

      // Suppress signals during low-liquidity hours (04:00-06:00 UTC)
      const currentHourUTC = new Date().getUTCHours();
      if (currentHourUTC >= 4 && currentHourUTC <= 5) return this.reject('dead_hours');

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

  // Pre-breakout zone scanner: find coins accumulating near demand zones
  // before the breakout happens. This is the "Flams-style" entry.
  async scanZoneAccumulation() {
    const candidates = [];
    this.rejects = new Map();

    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      try {
        const perpMarkets = Object.values(exchange.markets).filter(m => m.swap && m.quote === 'USDT' && m.active);
        const tickers = await exchange.fetchTickers(perpMarkets.map(m => m.symbol));

        // Filter: decent volume, NOT already pumping hard (that's the breakout scanner's job)
        const filtered = Object.entries(tickers)
          .filter(([, t]) => t.quoteVolume > 1500000)
          .filter(([s]) => !s.includes('STOCK') && !STOCK_TOKENS.test(s.split('/')[0]))
          .filter(([, t]) => {
            const chg = Math.abs(t.percentage || 0);
            return chg < 15; // skip coins already pumped/dumped >15%
          })
          .sort((a, b) => (b[1].quoteVolume || 0) - (a[1].quoteVolume || 0))
          .slice(0, 80);

        for (const [symbol, ticker] of filtered) {
          try {
            const sym = symbol.split('/')[0];
            const lastSignal = this.zoneSignalHistory.get(sym);
            if (lastSignal && Date.now() - lastSignal < 4 * 60 * 60 * 1000) {
              this.reject('cooldown');
              continue;
            }
            const result = await this.analyzeZoneEntry(exchange, exchangeId, symbol, ticker);
            if (result) {
              result.quoteVolume = ticker.quoteVolume || 0;
              result.hasApiKey = !!(exchange.apiKey && exchange.secret);
              candidates.push(result);
              this.zoneSignalHistory.set(sym, Date.now());
            }
          } catch (e) { /* skip individual failures */ }
        }
      } catch (err) {
        logger.error(`Zone scan failed for ${exchangeId}: ${err.message}`);
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

  // Analyze a single coin for zone accumulation entry
  async analyzeZoneEntry(exchange, exchangeId, symbol, ticker) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, '1h', undefined, 100);
      if (ohlcv.length < 40) return null;

      const closes = ohlcv.map(c => c[4]);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const volumes = ohlcv.map(c => c[5]);
      const currentPrice = closes[closes.length - 1];

      // Run SMC analysis to find zones
      const smcResult = this.smc.analyze(ohlcv);
      if (!smcResult) return null;

      // Calculate indicators
      const rsi = RSI.calculate({ values: closes, period: 14 });
      const ema20 = EMA.calculate({ values: closes, period: 20 });
      const ema50 = EMA.calculate({ values: closes, period: 50 });
      const bb = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

      const currentRSI = rsi[rsi.length - 1];
      const currentEma20 = ema20[ema20.length - 1];
      const currentEma50 = ema50[ema50.length - 1];
      const currentBB = bb[bb.length - 1];
      const currentATR = atr[atr.length - 1];

      if (!currentRSI || !currentATR || !currentBB) return null;

      let score = 0;
      const signals = [];
      let direction = null;
      let zonePrice = null; // the demand/supply zone price for SL placement

      // === ZONE PROXIMITY CHECK ===
      // Find bullish OBs (demand zones) near current price
      const bullishOBs = smcResult.orderBlocks.filter(ob => ob.type === 'OB_BULLISH');
      const bearishOBs = smcResult.orderBlocks.filter(ob => ob.type === 'OB_BEARISH');

      let nearDemandZone = false;
      let nearSupplyZone = false;
      let bestDemandOB = null;
      let bestSupplyOB = null;

      for (const ob of bullishOBs) {
        // Price is at or slightly above the demand zone (within 1.5% of OB high)
        const distAboveOB = ((currentPrice - ob.high) / currentPrice) * 100;
        if (distAboveOB >= -0.5 && distAboveOB <= 1.5) {
          nearDemandZone = true;
          if (!bestDemandOB || distAboveOB < ((currentPrice - bestDemandOB.high) / currentPrice) * 100) {
            bestDemandOB = ob;
          }
        }
      }

      for (const ob of bearishOBs) {
        // Price is at or slightly below the supply zone (within 1.5% of OB low)
        const distBelowOB = ((ob.low - currentPrice) / currentPrice) * 100;
        if (distBelowOB >= -0.5 && distBelowOB <= 1.5) {
          nearSupplyZone = true;
          if (!bestSupplyOB || distBelowOB < ((bestSupplyOB.low - currentPrice) / currentPrice) * 100) {
            bestSupplyOB = ob;
          }
        }
      }

      // Also check unfilled FVGs as zones
      const bullishFVGs = smcResult.fvgs.filter(f => f.type === 'FVG_BULLISH');
      const bearishFVGs = smcResult.fvgs.filter(f => f.type === 'FVG_BEARISH');

      for (const fvg of bullishFVGs) {
        const distToFVG = ((currentPrice - fvg.bottom) / currentPrice) * 100;
        if (distToFVG >= 0 && distToFVG <= 1.5) {
          nearDemandZone = true;
          if (!bestDemandOB) {
            bestDemandOB = { high: fvg.top, low: fvg.bottom, type: 'FVG_BULLISH' };
          }
        }
      }

      for (const fvg of bearishFVGs) {
        const distToFVG = ((fvg.top - currentPrice) / currentPrice) * 100;
        if (distToFVG >= 0 && distToFVG <= 1.5) {
          nearSupplyZone = true;
          if (!bestSupplyOB) {
            bestSupplyOB = { high: fvg.top, low: fvg.bottom, type: 'FVG_BEARISH' };
          }
        }
      }

      // Must be near at least one zone
      if (!nearDemandZone && !nearSupplyZone) return null;

      // === DETERMINE DIRECTION FROM STRUCTURE ===
      if (nearDemandZone && smcResult.structureBias === 'bullish') {
        direction = 'long';
        zonePrice = bestDemandOB.low;
        score += 30;
        signals.push(`At demand zone $${bestDemandOB.low.toPrecision(5)}–$${bestDemandOB.high.toPrecision(5)}`);
        signals.push('Bullish market structure');
      } else if (nearSupplyZone && smcResult.structureBias === 'bearish') {
        direction = 'short';
        zonePrice = bestSupplyOB.high;
        score += 30;
        signals.push(`At supply zone $${bestSupplyOB.low.toPrecision(5)}–$${bestSupplyOB.high.toPrecision(5)}`);
        signals.push('Bearish market structure');
      } else {
        return null; // require clear bullish/bearish structure — no neutral entries
      }

      // === SHORT QUALITY FILTERS ===
      const atrPct = (currentATR / currentPrice) * 100;
      if (direction === 'short') {
        if (atrPct < 1.5) return null; // skip low-volatility assets (stocks, majors)
        const tp1Dist = (currentATR * 3 / currentPrice) * 100;
        if (tp1Dist < 3) return null; // TP1 too close — not worth the risk
      }

      // === BOUNCE CANDLE CONFIRMATION ===
      const lastCandle = ohlcv[ohlcv.length - 1];
      const prevCandle = ohlcv[ohlcv.length - 2];
      const lastOpen = lastCandle[1], lastClose = lastCandle[4];
      const lastHigh = lastCandle[2], lastLow = lastCandle[3];
      const lastBody = Math.abs(lastClose - lastOpen);
      const lastRange = lastHigh - lastLow;
      if (direction === 'long') {
        const isBullishCandle = lastClose > lastOpen;
        const hasLowerWick = (Math.min(lastOpen, lastClose) - lastLow) > lastBody * 0.5;
        if (!isBullishCandle && !hasLowerWick) return null;
      } else {
        const isBearishCandle = lastClose < lastOpen;
        const hasUpperWick = (lastHigh - Math.max(lastOpen, lastClose)) > lastBody * 0.5;
        if (!isBearishCandle && !hasUpperWick) return null;
      }

      // === VOLUME ACCUMULATION CHECK (mandatory) ===
      const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
      const priorVol = volumes.slice(-25, -5).reduce((a, b) => a + b, 0) / 20;
      const volAccumRatio = recentVol / priorVol;

      if (volAccumRatio < 1.5) return null; // hard filter: must have volume building

      if (volAccumRatio > 2) {
        score += 20;
        signals.push(`Volume accumulation ${volAccumRatio.toFixed(1)}x vs avg`);
      } else {
        score += 10;
        signals.push(`Volume building ${volAccumRatio.toFixed(1)}x vs avg`);
      }

      // === BOLLINGER BAND SQUEEZE ===
      // Tightening BBs = compression = energy building for breakout
      if (bb.length >= 10) {
        const recentBBWidth = bb.slice(-3).reduce((s, b) => s + (b.upper - b.lower) / b.middle, 0) / 3;
        const priorBBWidth = bb.slice(-10, -3).reduce((s, b) => s + (b.upper - b.lower) / b.middle, 0) / 7;
        if (recentBBWidth < priorBBWidth * 0.7) {
          score += 15;
          signals.push('BB squeeze — compression before breakout');
        }
      }

      // === RSI ALIGNMENT ===
      if (direction === 'long') {
        if (currentRSI > 70) return null; // overbought, not accumulating
        if (currentRSI >= 40 && currentRSI <= 60) {
          score += 10;
          signals.push(`RSI neutral ${currentRSI.toFixed(0)} — room to run`);
        } else if (currentRSI < 40) {
          score += 5;
          signals.push(`RSI low ${currentRSI.toFixed(0)} — potential reversal`);
        }
      } else {
        if (currentRSI < 30) return null; // oversold, not distributing
        if (currentRSI >= 40 && currentRSI <= 60) {
          score += 10;
          signals.push(`RSI neutral ${currentRSI.toFixed(0)} — room to fall`);
        } else if (currentRSI > 60) {
          score += 5;
          signals.push(`RSI high ${currentRSI.toFixed(0)} — potential rejection`);
        }
      }

      // === HIGHER LOWS / LOWER HIGHS (mandatory — confirms trending structure) ===
      let hasStructureTrend = false;
      if (smcResult.swingLows.length >= 3 && direction === 'long') {
        const lastThreeLows = smcResult.swingLows.slice(-3);
        if (lastThreeLows[2].price > lastThreeLows[1].price && lastThreeLows[1].price > lastThreeLows[0].price) {
          hasStructureTrend = true;
          score += 15;
          signals.push('Higher lows forming — ascending support');
        }
      }
      if (smcResult.swingHighs.length >= 3 && direction === 'short') {
        const lastThreeHighs = smcResult.swingHighs.slice(-3);
        if (lastThreeHighs[2].price < lastThreeHighs[1].price && lastThreeHighs[1].price < lastThreeHighs[0].price) {
          hasStructureTrend = true;
          score += 15;
          signals.push('Lower highs forming — descending resistance');
        }
      }
      if (!hasStructureTrend) return null;

      // === EMA ALIGNMENT ===
      if (direction === 'long' && currentEma20 > currentEma50) {
        score += 10;
        signals.push('EMA20 > EMA50 trend aligned');
      } else if (direction === 'short' && currentEma20 < currentEma50) {
        score += 10;
        signals.push('EMA20 < EMA50 trend aligned');
      }

      // === 4H TREND CONFIRMATION (mandatory) ===
      let has4hTrend = false;
      try {
        const ohlcv4h = await exchange.fetchOHLCV(symbol, '4h', undefined, 30);
        if (ohlcv4h.length >= 25) {
          const closes4h = ohlcv4h.map(c => c[4]);
          const ema20_4h = EMA.calculate({ values: closes4h, period: 20 });
          const currentEma4h = ema20_4h[ema20_4h.length - 1];
          const price4h = closes4h[closes4h.length - 1];
          if (direction === 'long' && price4h > currentEma4h) {
            has4hTrend = true;
            score += 10;
            signals.push('4H trend aligned');
          } else if (direction === 'short' && price4h < currentEma4h) {
            has4hTrend = true;
            score += 10;
            signals.push('4H trend aligned');
          }
        }
      } catch (e) { /* skip — let it pass without 4H data */ has4hTrend = true; }

      if (!has4hTrend) return null; // hard filter: must align with 4H trend

      // === MINIMUM SCORE GATE ===
      if (score < 75) return null;

      // Suppress during dead/losing hours (03-05 UTC, 16-22 UTC consistently negative)
      const currentHourUTC = new Date().getUTCHours();
      if (currentHourUTC >= 3 && currentHourUTC <= 5) return null;
      if (currentHourUTC >= 16 && currentHourUTC <= 22) return null;

      // === CALCULATE TP/SL ===
      // SL placed just below the zone (tight, like Flams)
      const isLong = direction === 'long';
      const zoneDist = Math.abs(currentPrice - zonePrice);
      // SL = below zone by 0.5x ATR (tight, zone-based)
      const slBuffer = currentATR * 0.5;
      const stopLoss = isLong
        ? zonePrice - slBuffer
        : zonePrice + slBuffer;

      // TPs wider than breakout scanner — zone entries have better R:R
      const tp1 = isLong ? currentPrice + currentATR * 3 : currentPrice - currentATR * 3;
      const tp2 = isLong ? currentPrice + currentATR * 6 : currentPrice - currentATR * 6;
      const tp3 = isLong ? currentPrice + currentATR * 10 : currentPrice - currentATR * 10;

      const entryLow = isLong ? currentPrice * 0.998 : currentPrice * 1.002;
      const entryHigh = isLong ? currentPrice * 1.002 : currentPrice * 0.998;

      return {
        type: 'ZONE_ENTRY',
        symbol: symbol.replace('/USDT:USDT', '').replace('/USDT', ''),
        pair: symbol,
        exchange: exchangeId,
        direction,
        currentPrice,
        change24h: ticker.percentage || 0,
        volumeRatio: volAccumRatio,
        rsi: currentRSI,
        score,
        signals,
        atr: currentATR,
        smc: {
          structureBias: smcResult.structureBias,
          orderBlocks: smcResult.orderBlocks,
          fvgs: smcResult.fvgs,
          bosEvents: smcResult.bosEvents,
          chochEvents: smcResult.chochEvents,
        },
        zonePrice,
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
module.exports.STOCK_TOKENS = STOCK_TOKENS;
