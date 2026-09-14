const logger = require('../utils/logger');
const { RSI, EMA, ATR } = require('technicalindicators');
const https = require('https');
const { STOCK_TOKENS } = require('./technicalScanner');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function isStockToken(symbol) {
  if (STOCK_TOKENS.test(symbol)) return true;
  if (/STOCK$/i.test(symbol)) return true;
  if (/^(1000)?[A-Z]{1,6}(LONG|SHORT|BULL|BEAR|UP|DOWN|3L|3S|2L|2S|5L|5S)$/i.test(symbol)) return true;
  return false;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class SwingScanner {
  constructor(exchanges, flowScanner, onchainScanner) {
    this.exchanges = exchanges;
    this.flowScanner = flowScanner;
    this.onchainScanner = onchainScanner;
    this.scanResults = new Map();
    this.watchlist = new Map();
  }

  async scan() {
    const results = [];

    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      try {
        const perpMarkets = Object.values(exchange.markets)
          .filter(m => m.swap && m.quote === 'USDT' && m.active);
        const tickers = await exchange.fetchTickers(perpMarkets.map(m => m.symbol));

        const candidates = Object.entries(tickers)
          .filter(([, t]) => t.quoteVolume > 2000000)
          .filter(([s]) => !s.includes('STOCK') && !isStockToken(s.split('/')[0]))
          .sort((a, b) => (b[1].quoteVolume || 0) - (a[1].quoteVolume || 0))
          .slice(0, 75);

        for (const [symbol, ticker] of candidates) {
          try {
            const result = await this.analyzeSwingCandidate(exchange, exchangeId, symbol, ticker);
            if (result && result.score >= 35) results.push(result);
          } catch (e) {
            logger.debug(`Swing scan failed for ${symbol}: ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (e) {
        logger.error(`Swing scan exchange ${exchangeId} error: ${e.message}`);
      }
    }

    const best = new Map();
    for (const r of results) {
      const existing = best.get(r.symbol);
      if (!existing || r.score > existing.score) best.set(r.symbol, r);
    }

    const sorted = [...best.values()].sort((a, b) => b.score - a.score);
    logger.info(`Swing scan: ${sorted.length} candidates scored 35+`);
    return sorted;
  }

  async analyzeSwingCandidate(exchange, exchangeId, symbol, ticker) {
    const ohlcvDaily = await exchange.fetchOHLCV(symbol, '1d', undefined, 180);
    if (!ohlcvDaily || ohlcvDaily.length < 60) return null;

    const closes = ohlcvDaily.map(c => c[4]);
    const highs = ohlcvDaily.map(c => c[2]);
    const lows = ohlcvDaily.map(c => c[3]);
    const volumes = ohlcvDaily.map(c => c[5]);

    const currentPrice = closes[closes.length - 1];
    const rsi14 = RSI.calculate({ values: closes, period: 14 });
    const ema20 = EMA.calculate({ values: closes, period: 20 });
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const atr14 = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

    if (!rsi14.length || !ema20.length || !atr14.length) return null;

    const currentRSI = rsi14[rsi14.length - 1];
    const currentEma20 = ema20[ema20.length - 1];
    const currentATR = atr14[atr14.length - 1];

    const last90Highs = highs.slice(-90);
    const last90Lows = lows.slice(-90);
    const ninetyDayHigh = Math.max(...last90Highs);
    const ninetyDayLow = Math.min(...last90Lows);

    let score = 0;
    const signals = [];
    const sym = symbol.split('/')[0];

    // === AXIS 1: Setup Detection (up to 25 pts) ===
    // Path A: Accumulation (near lows) — price within striking distance of 90d low
    // Path B: Breakout Continuation (after a move) — pulled back from breakout, onchain confirms

    const distFromLow = ((currentPrice - ninetyDayLow) / ninetyDayLow) * 100;
    const totalDecline = ((ninetyDayHigh - ninetyDayLow) / ninetyDayHigh) * 100;

    if (totalDecline < 15) return null;
    if (distFromLow > 200) return null;

    let setupType = 'accumulation';

    if (distFromLow <= 15) {
      score += 10; signals.push(`Near 90d low (${distFromLow.toFixed(0)}% above)`);
    } else if (distFromLow <= 30) {
      score += 5; signals.push(`Within 30% of 90d low`);
    } else if (distFromLow <= 60) {
      score += 3; signals.push(`Moderate distance from lows (${distFromLow.toFixed(0)}%)`);
    } else {
      setupType = 'continuation';
    }

    if (totalDecline >= 70) { score += 8; signals.push(`Major range -${totalDecline.toFixed(0)}%`); }
    else if (totalDecline >= 50) { score += 5; signals.push(`Extended range -${totalDecline.toFixed(0)}%`); }
    else if (totalDecline >= 30) { score += 3; signals.push(`Significant range -${totalDecline.toFixed(0)}%`); }

    if (setupType === 'continuation') {
      const last14Highs = highs.slice(-14);
      const recentHigh = Math.max(...last14Highs);
      const pullbackPct = ((recentHigh - currentPrice) / recentHigh) * 100;

      if (pullbackPct >= 25) {
        score += 8; signals.push(`Pullback -${pullbackPct.toFixed(0)}% from recent high — deep re-entry`);
      } else if (pullbackPct >= 15) {
        score += 6; signals.push(`Pullback -${pullbackPct.toFixed(0)}% from recent high`);
      } else if (pullbackPct >= 5) {
        score += 4; signals.push(`Shallow dip -${pullbackPct.toFixed(0)}% from recent high`);
      } else {
        score += 2; signals.push('Near highs — momentum');
      }

      const last14Changes = ohlcvDaily.slice(-14).map(c => Math.abs((c[4] - c[1]) / c[1]) * 100);
      const maxDailyMove = Math.max(...last14Changes);
      if (maxDailyMove > 30) { score += 5; signals.push(`${maxDailyMove.toFixed(0)}% daily candle in 14d — proven momentum`); }
      else if (maxDailyMove > 15) { score += 3; signals.push(`${maxDailyMove.toFixed(0)}% daily move recently`); }
    } else {
      const recentATRs = atr14.slice(-14);
      const allATRs = atr14.slice(-Math.min(90, atr14.length));
      const recentAvgATR = recentATRs.reduce((a, b) => a + b, 0) / recentATRs.length;
      const fullAvgATR = allATRs.reduce((a, b) => a + b, 0) / allATRs.length;
      if (recentAvgATR < fullAvgATR * 0.5) {
        score += 7; signals.push('Low volatility consolidation at lows');
      } else if (recentAvgATR < fullAvgATR * 0.7) {
        score += 3; signals.push('Narrowing range');
      }
    }

    // === AXIS 2: Trend / Momentum Signals (up to 25 pts) ===

    const rsiWindow = rsi14.slice(-14);
    const wasOversold = rsiWindow.some(v => v < 30);
    if (wasOversold && currentRSI > 35 && currentRSI < 55) {
      score += 7; signals.push(`RSI recovering from oversold (${currentRSI.toFixed(0)})`);
    } else if (setupType === 'continuation' && currentRSI > 50 && currentRSI < 70) {
      score += 3; signals.push(`RSI healthy momentum (${currentRSI.toFixed(0)})`);
    }

    const prevClose = closes[closes.length - 2];
    const prevEma20 = ema20[ema20.length - 2];
    if (prevEma20 && currentPrice > currentEma20 && prevClose <= prevEma20) {
      score += 8; signals.push('Fresh daily EMA20 reclaim');
    } else if (currentPrice > currentEma20) {
      score += 3; signals.push('Trading above daily EMA20');
    }

    const last30 = ohlcvDaily.slice(-30);
    const recentLows30 = [];
    for (let i = 2; i < last30.length - 2; i++) {
      if (last30[i][3] < last30[i - 1][3] && last30[i][3] < last30[i - 2][3] &&
          last30[i][3] < last30[i + 1][3] && last30[i][3] < last30[i + 2][3]) {
        recentLows30.push(last30[i][3]);
      }
    }
    if (recentLows30.length >= 2 && recentLows30[recentLows30.length - 1] > recentLows30[recentLows30.length - 2]) {
      score += 7; signals.push('Higher lows forming on daily');
    }

    const last14 = ohlcvDaily.slice(-14);
    let upVol = 0, downVol = 0;
    for (const c of last14) {
      if (c[4] >= c[1]) upVol += c[5]; else downVol += c[5];
    }
    if (downVol > 0 && upVol > downVol * 1.5) {
      score += 3; signals.push(`Volume accumulating (up ${(upVol / downVol).toFixed(1)}x vs down)`);
    }

    // Liquidity sweep detection — V-shape recovery after stop hunt below support
    const last21 = ohlcvDaily.slice(-21);
    for (let i = Math.max(2, last21.length - 10); i < last21.length - 1; i++) {
      const candle = last21[i];
      const body = Math.abs(candle[4] - candle[1]);
      const lowerWick = Math.min(candle[1], candle[4]) - candle[3];
      const totalRange = candle[2] - candle[3];
      if (totalRange <= 0 || body <= 0) continue;

      // Sweep candle: long lower wick (>60% of range) dipping below prior lows
      if (lowerWick / totalRange < 0.6) continue;
      const priorLow = Math.min(...last21.slice(Math.max(0, i - 5), i).map(c => c[3]));
      if (candle[3] >= priorLow) continue; // Didn't sweep below support

      // V-recovery: closed back above support
      if (candle[4] <= priorLow) continue;

      // Higher low forming after sweep
      const postSweepCandles = last21.slice(i + 1);
      if (postSweepCandles.length && Math.min(...postSweepCandles.map(c => c[3])) > candle[3]) {
        const sweepDepth = ((priorLow - candle[3]) / priorLow * 100).toFixed(1);
        score += 7; signals.push(`🔻 Liquidity sweep -${sweepDepth}% below support + V-recovery — weak hands flushed`);
        break;
      }
    }

    // === AXIS 3: Onchain Confirmation (up to 35 pts) ===

    const flowMem = this.flowScanner?.flowMemory?.get(sym);
    if (flowMem) {
      if (flowMem.scansWithOutflow >= 5) { score += 12; signals.push(`Sustained outflows (${flowMem.scansWithOutflow} scans)`); }
      else if (flowMem.scansWithOutflow >= 3) { score += 7; signals.push('Multiple outflow signals'); }
      else if (flowMem.scansWithOutflow >= 1) { score += 3; signals.push('Exchange outflows detected'); }
    }

    const pair = sym.replace('/', '').replace(':USDT', '');
    try {
      const fundingData = await fetchJSON(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}USDT&limit=1`);
      const rate = fundingData?.[0]?.fundingRate ? parseFloat(fundingData[0].fundingRate) : null;
      if (rate !== null && rate < -0.0001) { score += 6; signals.push(`Funding negative (${(rate * 100).toFixed(4)}%) — shorts paying`); }
      else if (rate !== null && rate < 0.0002) { score += 3; signals.push('Funding neutral'); }
    } catch (e) { /* skip */ }

    try {
      const lsData = await this.onchainScanner?.fetchLongShortRatio(symbol);
      if (lsData && lsData.topTraderPosRatio != null) {
        const topHeavy = lsData.topTraderPosRatio > 1.5;
        const topLeaning = lsData.topTraderPosRatio > 1.2;
        const retailShort = lsData.globalRatio < 0.9;
        if (topHeavy && retailShort) {
          score += 10; signals.push(`Strong divergence — top ${lsData.topTraderPosRatio.toFixed(2)} vs retail ${lsData.globalRatio.toFixed(2)}`);
        } else if (topLeaning && retailShort) {
          score += 7; signals.push(`Smart money divergence (top ${lsData.topTraderPosRatio.toFixed(2)} vs retail ${lsData.globalRatio.toFixed(2)})`);
        } else if (topHeavy) {
          score += 5; signals.push(`Top traders heavily long (${lsData.topTraderPosRatio.toFixed(2)})`);
        } else if (topLeaning) {
          score += 3; signals.push('Top traders accumulating');
        }
      }
    } catch (e) { /* skip */ }

    try {
      const acctData = await fetchJSON(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${pair}USDT&period=1d&limit=1`);
      if (acctData?.length) {
        const acctRatio = parseFloat(acctData[0].longShortRatio);
        if (acctRatio < 0.85) {
          score += 4; signals.push(`Retail accounts shorting (${acctRatio.toFixed(2)} L/S)`);
        } else if (acctRatio < 0.95) {
          score += 2; signals.push(`Retail slightly short (${acctRatio.toFixed(2)} L/S)`);
        }
      }
    } catch (e) { /* skip */ }

    try {
      const takerData = await fetchJSON(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${pair}USDT&period=1d&limit=3`);
      if (takerData?.length) {
        const avgRatio = takerData.reduce((s, d) => s + parseFloat(d.buyVol || 0) / parseFloat(d.sellVol || 1), 0) / takerData.length;
        if (avgRatio > 1.1) { score += 4; signals.push(`Taker buy pressure ${avgRatio.toFixed(2)}x`); }
      }
    } catch (e) { /* skip */ }

    // === AXIS 4: Volume / Momentum (up to 25 pts) ===

    const currentVol = volumes[volumes.length - 1];
    const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avgVol20 > 0 && currentVol > avgVol20 * 3) { score += 7; signals.push(`Volume explosion ${(currentVol / avgVol20).toFixed(1)}x avg`); }
    else if (avgVol20 > 0 && currentVol > avgVol20 * 2) { score += 5; signals.push(`Volume ${(currentVol / avgVol20).toFixed(1)}x avg`); }
    else if (avgVol20 > 0 && currentVol > avgVol20 * 1.5) { score += 3; signals.push('Above-avg volume'); }

    if (volumes.length >= 30) {
      const avg7d = volumes.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const avg30d = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30;
      if (avg30d > 0 && avg7d > avg30d * 3) {
        score += 5; signals.push(`7d volume ${(avg7d / avg30d).toFixed(1)}x 30d avg — sustained expansion`);
      } else if (avg30d > 0 && avg7d > avg30d * 2) {
        score += 3; signals.push(`7d volume ${(avg7d / avg30d).toFixed(1)}x 30d avg — expanding`);
      }
    }
    // Peak daily volume in last 3 days vs average — catches explosive breakouts
    if (volumes.length >= 21) {
      const peakRecent = Math.max(...volumes.slice(-3));
      const avgPrior = volumes.slice(-21, -3).reduce((a, b) => a + b, 0) / 18;
      if (avgPrior > 0 && peakRecent > avgPrior * 5) {
        score += 5; signals.push(`Peak day ${(peakRecent / avgPrior).toFixed(0)}x avg — breakout volume`);
      }
    }

    if (ohlcvDaily.length >= 35) {
      const weeklyCandles = [];
      for (let i = ohlcvDaily.length - 35; i < ohlcvDaily.length; i += 7) {
        const week = ohlcvDaily.slice(i, i + 7);
        if (week.length < 5) continue;
        weeklyCandles.push({
          open: week[0][1],
          close: week[week.length - 1][4],
          green: week[week.length - 1][4] >= week[0][1],
        });
      }
      if (weeklyCandles.length >= 4) {
        const last = weeklyCandles[weeklyCandles.length - 1];
        const prev3 = weeklyCandles.slice(-4, -1);
        if (last.green && prev3.every(w => !w.green)) {
          score += 5; signals.push('First green weekly after 3+ red weeks');
        }
      }
    }

    try {
      const oiHist = await exchange.fetchOpenInterestHistory(symbol, '1d', undefined, 7);
      if (oiHist && oiHist.length >= 3) {
        const firstOI = oiHist[0].openInterestValue || oiHist[0].openInterest;
        const lastOI = oiHist[oiHist.length - 1].openInterestValue || oiHist[oiHist.length - 1].openInterest;
        const oiChange = ((lastOI - firstOI) / firstOI) * 100;
        const priceChange7d = ticker.percentage || 0;

        // OI rising while price flat = accumulation (best signal, unaffected by volume check)
        if (oiChange > 10 && Math.abs(priceChange7d) < 5) {
          score += 8; signals.push(`OI rising +${oiChange.toFixed(0)}% while price flat — accumulation`);
        } else if (oiChange > 20) {
          // Arslan: OI surge without spot volume = leverage trap, vulnerable to wipeout
          const spotBacked = avgVol20 > 0 && currentVol > avgVol20 * 1.3;
          if (oiChange > 50 && spotBacked) {
            score += 7; signals.push(`OI surge +${oiChange.toFixed(0)}% backed by spot volume — real expansion`);
          } else if (oiChange > 50) {
            score += 2; signals.push(`⚠️ OI surge +${oiChange.toFixed(0)}% but spot volume flat — leverage-driven, wipeout risk`);
          } else if (spotBacked) {
            score += 5; signals.push(`OI expanding +${oiChange.toFixed(0)}% with spot confirmation`);
          } else {
            score += 2; signals.push(`OI expanding +${oiChange.toFixed(0)}% — no spot volume backing`);
          }
        } else if (oiChange > 5) {
          score += 3; signals.push(`OI building +${oiChange.toFixed(0)}%`);
        }
      }
    } catch (e) { /* skip — not all exchanges support this */ }

    if (score < 20) return null;

    return {
      type: 'SWING_CANDIDATE',
      setupType,
      symbol: sym,
      pair: symbol,
      exchange: exchangeId,
      currentPrice,
      score,
      signals,
      rsi: currentRSI,
      ema20: currentEma20,
      atr: currentATR,
      ninetyDayHigh,
      ninetyDayLow,
      distFromLow,
      totalDecline,
      flowMemory: flowMem || null,
      ticker,
    };
  }

  async buildSwingSetup(candidate) {
    try {
      const { currentPrice, ninetyDayHigh, ninetyDayLow, atr, pair, exchange: exchangeId, setupType } = candidate;

      const entryHigh = currentPrice;
      const entryLow = setupType === 'continuation' ? currentPrice * 0.97 : currentPrice * 0.95;

      const exchange = this.exchanges[exchangeId];
      const ohlcvDaily = await exchange.fetchOHLCV(pair, '1d', undefined, 180);

      let stopLoss;
      if (setupType === 'continuation') {
        const last14Lows = ohlcvDaily.slice(-14).map(c => c[3]);
        const recentSwingLow = Math.min(...last14Lows);
        stopLoss = recentSwingLow * 0.97;
        // Cap continuation SL at 15% — beyond that, 5x leverage wipes the position
        const maxSLDist = currentPrice * 0.85;
        if (stopLoss < maxSLDist) {
          stopLoss = maxSLDist;
          logger.info(`Swing ${candidate.symbol}: SL capped at 15% ($${stopLoss.toPrecision(4)}) — structural low too far for leveraged entry`);
        }
      } else {
        stopLoss = ninetyDayLow * 0.97;
        // Cap accumulation SL at 25% — 3x leverage max for these
        const maxSLDist = currentPrice * 0.75;
        if (stopLoss < maxSLDist) {
          stopLoss = maxSLDist;
          logger.info(`Swing ${candidate.symbol}: SL capped at 25% ($${stopLoss.toPrecision(4)}) — 90d low too far`);
        }
      }

      const swingHighs = [];
      for (let i = 5; i < ohlcvDaily.length - 5; i++) {
        const h = ohlcvDaily[i][2];
        const isSwingHigh = ohlcvDaily.slice(i - 5, i).every(c => c[2] <= h) &&
                            ohlcvDaily.slice(i + 1, i + 6).every(c => c[2] <= h);
        if (isSwingHigh && h > currentPrice * 1.1) swingHighs.push(h);
      }
      swingHighs.sort((a, b) => a - b);

      let tp1, tp2, tp3;
      if (setupType === 'continuation') {
        const range = currentPrice - stopLoss;
        tp1 = currentPrice + range * 1.618;
        tp2 = currentPrice + range * 2.618;
        tp3 = currentPrice + range * 4.236;
        if (swingHighs.length) tp1 = Math.max(tp1, swingHighs[0]);
      } else {
        tp1 = swingHighs[0] || currentPrice + (currentPrice - ninetyDayLow) * 1.5;
        const tp1Move = tp1 - currentPrice;
        tp2 = swingHighs[1] || currentPrice + tp1Move * 2;
        tp3 = Math.max(ninetyDayHigh, currentPrice + tp1Move * 3);
      }

      const slDistPct = Math.abs((currentPrice - stopLoss) / currentPrice) * 100;
      const tp1DistPct = ((tp1 - currentPrice) / currentPrice) * 100;
      const rr = tp1DistPct / slDistPct;

      const minRR = setupType === 'continuation' ? 1.5 : 2.0;
      if (rr < minRR) {
        logger.info(`Swing skip ${candidate.symbol}: R:R ${rr.toFixed(1)} < ${minRR}`);
        return null;
      }

      return {
        type: 'SWING_SETUP',
        setupType,
        symbol: candidate.symbol,
        pair,
        exchange: exchangeId,
        direction: 'long',
        currentPrice,
        entryLow,
        entryHigh,
        tp1, tp2, tp3,
        stopLoss,
        atr,
        confidence: candidate.score >= 55 ? 5 : candidate.score >= 45 ? 4 : 3,
        score: candidate.score,
        signals: candidate.signals,
        rr: parseFloat(rr.toFixed(1)),
        suggestedLeverage: setupType === 'continuation' ? 5 : 3,
        volumeInfo: `Vol $${((candidate.ticker?.quoteVolume || 0) / 1e6).toFixed(1)}M`,
        onchainContext: {
          score: candidate.score,
          signals: candidate.signals,
          setupType,
          swingData: {
            ninetyDayHigh, ninetyDayLow,
            distFromLow: candidate.distFromLow,
            totalDecline: candidate.totalDecline,
            rsi: candidate.rsi,
            flowMemory: candidate.flowMemory ? {
              scansWithOutflow: candidate.flowMemory.scansWithOutflow,
              totalOutflows: candidate.flowMemory.totalOutflows,
            } : null,
          },
        },
      };
    } catch (err) {
      logger.debug(`buildSwingSetup failed for ${candidate.symbol}: ${err.message}`);
      return null;
    }
  }

  formatSwingAlert(setup, candidate) {
    const scoreBar = '█'.repeat(Math.floor(setup.score / 10)) + '░'.repeat(10 - Math.floor(setup.score / 10));
    const slPct = ((setup.currentPrice - setup.stopLoss) / setup.currentPrice * 100).toFixed(1);
    const tp1Pct = ((setup.tp1 - setup.currentPrice) / setup.currentPrice * 100).toFixed(0);
    const tp2Pct = ((setup.tp2 - setup.currentPrice) / setup.currentPrice * 100).toFixed(0);
    const tp3Pct = ((setup.tp3 - setup.currentPrice) / setup.currentPrice * 100).toFixed(0);

    const typeLabel = setup.setupType === 'continuation' ? 'BREAKOUT CONTINUATION' : 'ACCUMULATION REVERSAL';
    let msg = `🌊 <b>SWING ${typeLabel}</b> — $${escapeHtml(setup.symbol)}\n\n`;
    msg += `<b>Score:</b> ${scoreBar} ${setup.score}/100\n`;
    msg += `<b>Direction:</b> 🟢 LONG\n`;
    msg += `<b>Leverage:</b> ${setup.suggestedLeverage}x\n`;
    msg += `<b>Entry Zone:</b> $${setup.entryLow.toPrecision(4)} — $${setup.entryHigh.toPrecision(4)}\n`;
    msg += `<b>Stop Loss:</b> $${setup.stopLoss.toPrecision(4)} (${slPct}% below)\n`;
    msg += `<b>TP1:</b> $${setup.tp1.toPrecision(4)} (+${tp1Pct}%)\n`;
    msg += `<b>TP2:</b> $${setup.tp2.toPrecision(4)} (+${tp2Pct}%)\n`;
    msg += `<b>TP3:</b> $${setup.tp3.toPrecision(4)} (+${tp3Pct}%)\n`;
    msg += `<b>R:R:</b> ${setup.rr}:1\n\n`;
    msg += `<b>Signals:</b>\n${candidate.signals.map(s => `  • ${s}`).join('\n')}\n`;

    if (setup._alertTracking) {
      const t = setup._alertTracking;
      const ageMs = Date.now() - new Date(t.firstAlertedAt).getTime();
      const ageHrs = ageMs / 3600000;
      const ageStr = ageHrs >= 24 ? `${Math.floor(ageHrs / 24)}d ${Math.floor(ageHrs % 24)}h` : ageHrs >= 1 ? `${Math.floor(ageHrs)}h ${Math.floor((ageHrs % 1) * 60)}m` : `${Math.floor(ageHrs * 60)}m`;
      const pnlIcon = t.pnl > 0 ? '🟢' : '🔴';
      const pnlStr = `${t.pnl > 0 ? '+' : ''}${t.pnl.toFixed(2)}%`;
      const entryStr = t.entryPrice >= 1 ? `$${t.entryPrice.toFixed(2)}` : `$${t.entryPrice.toPrecision(4)}`;
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📍 <b>ALERT TRACKING</b> (${t.direction.toUpperCase()})\n`;
      msg += `First alerted ${ageStr} ago at ${entryStr}\n`;
      msg += `${pnlIcon} Current PnL: <b>${pnlStr}</b>`;
      if (t.bestPnl > 0) msg += ` | Peak: +${t.bestPnl.toFixed(1)}%`;
      if (t.worstPnl < 0) msg += ` | Dip: ${t.worstPnl.toFixed(1)}%`;
      msg += '\n';
      if (t.tp1Hit) msg += `✅ TP1 hit`;
      if (t.tp2Hit) msg += ` | ✅ TP2 hit`;
      if (t.slHit) msg += ` | ❌ SL hit`;
      if (t.tp1Hit || t.tp2Hit || t.slHit) msg += '\n';
    }

    msg += `\n`;
    const holdLabel = setup.setupType === 'continuation' ? 'days to weeks' : 'weeks to months';
    msg += `<i>Swing trade — hold for ${holdLabel}.</i>\n`;
    msg += `<i>${new Date().toUTCString().slice(0, -4)}</i>`;
    return msg;
  }

  addToWatchlist(setup) {
    this.watchlist.set(setup.symbol, {
      setup,
      addedAt: Date.now(),
      lastChecked: Date.now(),
      enteredZone: false,
    });
    logger.info(`Swing watchlist: added ${setup.symbol} (zone $${setup.entryLow.toPrecision(4)}-$${setup.entryHigh.toPrecision(4)})`);
  }

  async checkWatchlist() {
    const entered = [];
    for (const [symbol, item] of this.watchlist) {
      try {
        const ageHours = (Date.now() - item.addedAt) / (60 * 60 * 1000);
        if (ageHours > 168) { this.watchlist.delete(symbol); continue; }

        const exchangeId = item.setup.exchange;
        const exchange = this.exchanges[exchangeId];
        if (!exchange) continue;

        const ticker = await exchange.fetchTicker(item.setup.pair);
        if (!ticker?.last) continue;

        const price = ticker.last;
        if (price <= item.setup.entryHigh && price >= item.setup.entryLow) {
          if (!item.enteredZone) {
            item.enteredZone = true;
            item.setup.currentPrice = price;
            entered.push(item.setup);
            logger.info(`Swing watchlist: ${symbol} entered buy zone at $${price}`);
          }
        }
        if (price < item.setup.stopLoss) {
          logger.info(`Swing watchlist: ${symbol} invalidated (below SL at $${price})`);
          this.watchlist.delete(symbol);
        }
        item.lastChecked = Date.now();
      } catch (e) {
        logger.debug(`Watchlist check failed for ${symbol}: ${e.message}`);
      }
    }
    return entered;
  }

  getWatchlistStatus() {
    const items = [];
    for (const [symbol, item] of this.watchlist) {
      items.push({
        symbol,
        entryZone: `$${item.setup.entryLow.toPrecision(4)}-$${item.setup.entryHigh.toPrecision(4)}`,
        sl: `$${item.setup.stopLoss.toPrecision(4)}`,
        score: item.setup.score,
        age: `${((Date.now() - item.addedAt) / (60 * 60 * 1000)).toFixed(0)}h`,
        inZone: item.enteredZone,
      });
    }
    return items;
  }
}

module.exports = SwingScanner;
