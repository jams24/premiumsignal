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
          .filter(([, t]) => t.quoteVolume > 5000000)
          .filter(([s]) => !s.includes('STOCK') && !isStockToken(s.split('/')[0]))
          .sort((a, b) => (b[1].quoteVolume || 0) - (a[1].quoteVolume || 0))
          .slice(0, 50);

        for (const [symbol, ticker] of candidates) {
          try {
            const result = await this.analyzeSwingCandidate(exchange, exchangeId, symbol, ticker);
            if (result && result.score >= 40) results.push(result);
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
    logger.info(`Swing scan: ${sorted.length} candidates scored 40+`);
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

    // === AXIS 1: Accumulation Zone Detection (up to 25 pts) ===

    const distFromLow = ((currentPrice - ninetyDayLow) / ninetyDayLow) * 100;
    if (distFromLow <= 10) { score += 10; signals.push(`Near 90d low (${distFromLow.toFixed(0)}% above)`); }
    else if (distFromLow <= 20) { score += 5; signals.push(`Within 20% of 90d low`); }
    else if (distFromLow > 50) return null;

    const totalDecline = ((ninetyDayHigh - ninetyDayLow) / ninetyDayHigh) * 100;
    if (totalDecline >= 70) { score += 8; signals.push(`Major decline -${totalDecline.toFixed(0)}%`); }
    else if (totalDecline >= 50) { score += 5; signals.push(`Extended downtrend -${totalDecline.toFixed(0)}%`); }
    else if (totalDecline < 30) return null;

    const recentATRs = atr14.slice(-14);
    const allATRs = atr14.slice(-Math.min(90, atr14.length));
    const recentAvgATR = recentATRs.reduce((a, b) => a + b, 0) / recentATRs.length;
    const fullAvgATR = allATRs.reduce((a, b) => a + b, 0) / allATRs.length;
    if (recentAvgATR < fullAvgATR * 0.5) {
      score += 7; signals.push('Low volatility consolidation at lows');
    } else if (recentAvgATR < fullAvgATR * 0.7) {
      score += 3; signals.push('Narrowing range');
    }

    // === AXIS 2: Trend Reversal Signals (up to 25 pts) ===

    const rsiWindow = rsi14.slice(-14);
    const wasOversold = rsiWindow.some(v => v < 30);
    if (wasOversold && currentRSI > 35 && currentRSI < 55) {
      score += 7; signals.push(`RSI recovering from oversold (${currentRSI.toFixed(0)})`);
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

    // === AXIS 3: Onchain Confirmation (up to 30 pts) ===

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
        const topLong = lsData.topTraderPosRatio > 1.2;
        const retailShort = lsData.globalRatio < 0.9;
        if (topLong && retailShort) {
          score += 8; signals.push(`Smart money divergence (top ${lsData.topTraderPosRatio.toFixed(2)} vs retail ${lsData.globalRatio.toFixed(2)})`);
        } else if (topLong) {
          score += 4; signals.push('Top traders accumulating');
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

    // === AXIS 4: Volume/Momentum (up to 20 pts) ===

    const currentVol = volumes[volumes.length - 1];
    const avgVol20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avgVol20 > 0 && currentVol > avgVol20 * 2) { score += 7; signals.push(`Volume ${(currentVol / avgVol20).toFixed(1)}x avg`); }
    else if (avgVol20 > 0 && currentVol > avgVol20 * 1.5) { score += 4; signals.push('Above-avg volume'); }

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

    // OI rising while price flat = accumulation
    try {
      const oiHist = await exchange.fetchOpenInterestHistory(symbol, '1d', undefined, 7);
      if (oiHist && oiHist.length >= 3) {
        const firstOI = oiHist[0].openInterestValue || oiHist[0].openInterest;
        const lastOI = oiHist[oiHist.length - 1].openInterestValue || oiHist[oiHist.length - 1].openInterest;
        const oiChange = ((lastOI - firstOI) / firstOI) * 100;
        const priceChange7d = ticker.percentage || 0;
        if (oiChange > 10 && Math.abs(priceChange7d) < 5) {
          score += 8; signals.push(`OI rising +${oiChange.toFixed(0)}% while price flat`);
        } else if (oiChange > 5) {
          score += 3; signals.push(`OI building +${oiChange.toFixed(0)}%`);
        }
      }
    } catch (e) { /* skip — not all exchanges support this */ }

    if (score < 30) return null;

    return {
      type: 'SWING_CANDIDATE',
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
      const { currentPrice, ninetyDayHigh, ninetyDayLow, atr, pair, exchange: exchangeId } = candidate;

      const entryHigh = currentPrice;
      const entryLow = currentPrice * 0.95;

      const stopLoss = ninetyDayLow * 0.97;

      const exchange = this.exchanges[exchangeId];
      const ohlcvDaily = await exchange.fetchOHLCV(pair, '1d', undefined, 180);

      const swingHighs = [];
      for (let i = 5; i < ohlcvDaily.length - 5; i++) {
        const h = ohlcvDaily[i][2];
        const isSwingHigh = ohlcvDaily.slice(i - 5, i).every(c => c[2] <= h) &&
                            ohlcvDaily.slice(i + 1, i + 6).every(c => c[2] <= h);
        if (isSwingHigh && h > currentPrice * 1.1) swingHighs.push(h);
      }
      swingHighs.sort((a, b) => a - b);

      const tp1 = swingHighs[0] || currentPrice + (currentPrice - ninetyDayLow) * 1.5;
      const tp1Move = tp1 - currentPrice;
      const tp2 = swingHighs[1] || currentPrice + tp1Move * 2;
      const tp3 = Math.max(ninetyDayHigh, currentPrice + tp1Move * 3);

      const slDistPct = Math.abs((currentPrice - stopLoss) / currentPrice) * 100;
      const tp1DistPct = ((tp1 - currentPrice) / currentPrice) * 100;
      const rr = tp1DistPct / slDistPct;

      if (rr < 2) {
        logger.info(`Swing skip ${candidate.symbol}: R:R ${rr.toFixed(1)} < 2.0`);
        return null;
      }

      return {
        type: 'SWING_SETUP',
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
        confidence: candidate.score >= 60 ? 5 : candidate.score >= 50 ? 4 : 3,
        score: candidate.score,
        signals: candidate.signals,
        rr: parseFloat(rr.toFixed(1)),
        suggestedLeverage: 3,
        volumeInfo: `Vol $${((candidate.ticker?.quoteVolume || 0) / 1e6).toFixed(1)}M`,
        onchainContext: {
          score: candidate.score,
          signals: candidate.signals,
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

    let msg = `🌊 <b>SWING SETUP</b> — $${escapeHtml(setup.symbol)}\n\n`;
    msg += `<b>Score:</b> ${scoreBar} ${setup.score}/100\n`;
    msg += `<b>Direction:</b> 🟢 LONG\n`;
    msg += `<b>Entry Zone:</b> $${setup.entryLow.toPrecision(4)} — $${setup.entryHigh.toPrecision(4)}\n`;
    msg += `<b>Stop Loss:</b> $${setup.stopLoss.toPrecision(4)} (${slPct}% below)\n`;
    msg += `<b>TP1:</b> $${setup.tp1.toPrecision(4)} (+${tp1Pct}%)\n`;
    msg += `<b>TP2:</b> $${setup.tp2.toPrecision(4)} (+${tp2Pct}%)\n`;
    msg += `<b>TP3:</b> $${setup.tp3.toPrecision(4)} (+${tp3Pct}%)\n`;
    msg += `<b>R:R:</b> ${setup.rr}:1\n\n`;
    msg += `<b>Signals:</b>\n${candidate.signals.map(s => `  • ${s}`).join('\n')}\n\n`;
    msg += `<i>Swing trade — hold for days/weeks. SL below accumulation zone.</i>\n`;
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
