const logger = require('../utils/logger');
const { STOCK_TOKENS } = require('./technicalScanner');

function isStockToken(symbol) {
  if (STOCK_TOKENS.test(symbol)) return true;
  if (/STOCK$/i.test(symbol)) return true;
  if (/^(1000)?[A-Z]{1,6}(LONG|SHORT|BULL|BEAR|UP|DOWN|3L|3S|2L|2S|5L|5S)$/i.test(symbol)) return true;
  return false;
}

class OnchainScanner {
  constructor(exchanges) {
    this.exchanges = exchanges;
    this.oiCache = new Map(); // symbol → { timestamp, data[] }
    this.alerts = [];
    this.lastScan = null;
  }

  async scan() {
    const results = [];
    this.alerts = [];

    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      if (!exchange.has.fetchOpenInterestHistory && !exchange.has.fetchFundingRates) continue;

      try {
        const perpMarkets = Object.values(exchange.markets)
          .filter(m => m.swap && m.quote === 'USDT' && m.active);
        const tickers = await exchange.fetchTickers(perpMarkets.map(m => m.symbol));

        const filtered = Object.entries(tickers)
          .filter(([, t]) => t.quoteVolume > 3000000)
          .filter(([s]) => !s.includes('STOCK') && !isStockToken(s.split('/')[0]))
          .sort((a, b) => (b[1].quoteVolume || 0) - (a[1].quoteVolume || 0))
          .slice(0, 60);

        // Batch fetch funding rates if available
        let fundingMap = {};
        if (exchange.has.fetchFundingRates) {
          try {
            const rates = await exchange.fetchFundingRates(filtered.map(([s]) => s));
            fundingMap = rates;
          } catch (e) {
            logger.debug(`Batch funding fetch failed on ${exchangeId}: ${e.message}`);
          }
        }

        for (const [symbol, ticker] of filtered) {
          try {
            const analysis = await this.analyzeSymbol(exchange, exchangeId, symbol, ticker, fundingMap[symbol]);
            if (analysis && analysis.score > 0) {
              results.push(analysis);
            }
          } catch (e) {
            // skip individual failures silently
          }
        }
      } catch (err) {
        logger.error(`Onchain scan failed for ${exchangeId}: ${err.message}`);
      }
    }

    // Dedup by symbol, keep best score
    const best = new Map();
    for (const r of results) {
      const existing = best.get(r.symbol);
      if (!existing || r.score > existing.score) {
        best.set(r.symbol, r);
      }
    }

    const sorted = [...best.values()].sort((a, b) => b.score - a.score);
    this.lastScan = { timestamp: Date.now(), count: sorted.length, topAlerts: sorted.slice(0, 5) };

    logger.info(`Onchain scan: ${sorted.length} tokens scored, ${this.alerts.length} alerts`);
    return sorted;
  }

  async analyzeSymbol(exchange, exchangeId, symbol, ticker, fundingData) {
    const base = symbol.split('/')[0];
    let score = 0;
    const signals = [];

    // === 1. Open Interest Change ===
    let oiChange4h = null;
    let oiChange1h = null;
    if (exchange.has.fetchOpenInterestHistory) {
      try {
        const oiHist = await exchange.fetchOpenInterestHistory(symbol, '1h', undefined, 6);
        if (oiHist && oiHist.length >= 2) {
          const latest = oiHist[oiHist.length - 1];
          const prev1h = oiHist[oiHist.length - 2];
          const oiVal = latest.openInterestValue || (latest.openInterestAmount * (ticker.last || 1));
          const oiVal1h = prev1h.openInterestValue || (prev1h.openInterestAmount * (ticker.last || 1));

          oiChange1h = oiVal1h > 0 ? ((oiVal - oiVal1h) / oiVal1h) * 100 : 0;

          if (oiHist.length >= 5) {
            const prev4h = oiHist[oiHist.length - 5];
            const oiVal4h = prev4h.openInterestValue || (prev4h.openInterestAmount * (ticker.last || 1));
            oiChange4h = oiVal4h > 0 ? ((oiVal - oiVal4h) / oiVal4h) * 100 : 0;
          }

          // Score OI surge
          if (oiChange4h !== null) {
            if (oiChange4h > 30) { score += 25; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h 🔥`); }
            else if (oiChange4h > 20) { score += 20; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h`); }
            else if (oiChange4h > 15) { score += 15; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h`); }
            else if (oiChange4h > 10) { score += 10; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h`); }
            else if (oiChange4h < -20) { score += 10; signals.push(`OI ${oiChange4h.toFixed(1)}% 4h (flush)`); }
          }

          // 1h OI spike is also notable
          if (oiChange1h !== null && oiChange1h > 15) {
            score += 10;
            signals.push(`OI +${oiChange1h.toFixed(1)}% 1h spike`);
          }

          this.oiCache.set(symbol, { timestamp: Date.now(), oiVal, oiChange1h, oiChange4h });
        }
      } catch (e) {
        // OI not available for this symbol
      }
    }

    // === 2. Funding Rate Analysis ===
    let fundingRate = null;
    let fundingBias = null;
    try {
      const fr = fundingData || await exchange.fetchFundingRate(symbol);
      if (fr && fr.fundingRate !== undefined && fr.fundingRate !== null) {
        fundingRate = fr.fundingRate;

        // Extreme positive funding → longs paying, crowded long (potential squeeze risk, but bullish bias)
        // Extreme negative funding → shorts paying, bearish bias (potential short squeeze)
        if (fundingRate > 0.001) {
          score += 10;
          fundingBias = 'long';
          signals.push(`Funding +${(fundingRate * 100).toFixed(4)}% (longs dominant)`);
        } else if (fundingRate > 0.0003) {
          score += 5;
          fundingBias = 'long';
          signals.push(`Funding +${(fundingRate * 100).toFixed(4)}%`);
        } else if (fundingRate < -0.001) {
          score += 10;
          fundingBias = 'short';
          signals.push(`Funding ${(fundingRate * 100).toFixed(4)}% (shorts dominant)`);
        } else if (fundingRate < -0.0003) {
          score += 5;
          fundingBias = 'short';
          signals.push(`Funding ${(fundingRate * 100).toFixed(4)}%`);
        }
      }
    } catch (e) {
      // Funding not available
    }

    // === 3. Combined Signals (Flams-style) ===
    const priceChange = ticker.percentage || 0;

    // OI rising + price rising + positive funding = strong bullish setup
    if (oiChange4h > 15 && priceChange > 3 && fundingRate > 0.0001) {
      score += 15;
      signals.push('⚡ OI+Price+Funding aligned LONG');
    }
    // OI rising + price dropping + negative funding = short squeeze setup
    if (oiChange4h > 15 && priceChange < -3 && fundingRate < -0.0001) {
      score += 15;
      signals.push('⚡ OI+Price+Funding aligned SHORT squeeze');
    }
    // OI rising + price flat = accumulation (pre-move)
    if (oiChange4h > 20 && Math.abs(priceChange) < 3) {
      score += 10;
      signals.push('🔍 OI rising, price flat — accumulation');
    }

    if (score === 0) return null;

    return {
      symbol: base,
      pair: symbol,
      exchange: exchangeId,
      score,
      signals,
      oiChange1h,
      oiChange4h,
      fundingRate,
      fundingBias,
      priceChange,
      price: ticker.last,
      volume: ticker.quoteVolume,
    };
  }

  // Get onchain boost for a symbol being evaluated by the zone scanner
  getOnchainBoost(symbol) {
    const cached = this.oiCache.get(symbol);
    if (!cached || Date.now() - cached.timestamp > 10 * 60 * 1000) return { boost: 0, signals: [] };

    let boost = 0;
    const signals = [];

    if (cached.oiChange4h > 20) {
      boost += 15;
      signals.push(`OI +${cached.oiChange4h.toFixed(1)}% 4h`);
    } else if (cached.oiChange4h > 10) {
      boost += 8;
      signals.push(`OI +${cached.oiChange4h.toFixed(1)}% 4h`);
    }

    return { boost, signals };
  }

  // Format top alerts for Telegram
  formatAlerts(results, limit = 5) {
    if (!results.length) return null;

    const top = results.slice(0, limit);
    let msg = '🔗 <b>ONCHAIN SCANNER</b>\n';
    msg += '<i>Tracks Open Interest surges, funding rate shifts, and combined signals to detect smart money positioning before major moves.</i>\n\n';

    for (const r of top) {
      const arrow = r.priceChange >= 0 ? '🟢' : '🔴';
      const tier = this.getScoreTier(r.score);
      msg += `${arrow} <b>${r.symbol}</b> — Score: ${r.score}/100 ${tier.icon}\n`;
      msg += `   <b>${tier.label}</b> — ${tier.meaning}\n`;
      msg += `   💰 Price: ${r.priceChange >= 0 ? '+' : ''}${r.priceChange.toFixed(1)}% | Vol: $${(r.volume / 1e6).toFixed(1)}M\n`;

      // OI explanation
      if (r.oiChange4h !== null && r.oiChange4h !== undefined) {
        const oiDir = r.oiChange4h > 0 ? '📈' : '📉';
        msg += `   ${oiDir} OI 4h: ${r.oiChange4h > 0 ? '+' : ''}${r.oiChange4h.toFixed(1)}%`;
        if (r.oiChange4h > 25) msg += ' — <b>Heavy new positions opening, big move likely incoming</b>';
        else if (r.oiChange4h > 15) msg += ' — Fresh money entering, momentum building';
        else if (r.oiChange4h > 10) msg += ' — Moderate interest increase';
        else if (r.oiChange4h < -20) msg += ' — <b>Mass liquidations/closures, potential reversal zone</b>';
        msg += '\n';
      }
      if (r.oiChange1h !== null && r.oiChange1h > 10) {
        msg += `   ⚡ OI 1h spike: +${r.oiChange1h.toFixed(1)}% — Sudden rush of new positions in last hour\n`;
      }

      // Funding explanation
      if (r.fundingRate !== null && r.fundingRate !== undefined) {
        const fAbs = Math.abs(r.fundingRate * 100);
        if (fAbs > 0.03) {
          const fDir = r.fundingRate > 0 ? '🟢' : '🔴';
          msg += `   ${fDir} Funding: ${r.fundingRate > 0 ? '+' : ''}${(r.fundingRate * 100).toFixed(4)}%`;
          if (r.fundingRate > 0.001) msg += ' — <b>Longs paying shorts heavily, crowded long but bullish bias</b>';
          else if (r.fundingRate > 0.0003) msg += ' — Longs dominant, bulls in control';
          else if (r.fundingRate < -0.001) msg += ' — <b>Shorts paying longs, crowded short — squeeze risk</b>';
          else if (r.fundingRate < -0.0003) msg += ' — Shorts dominant, bears in control';
          msg += '\n';
        }
      }

      // Combined signal explanation
      for (const sig of r.signals) {
        if (sig.includes('aligned LONG')) {
          msg += `   🎯 <b>COMBO:</b> OI rising + price up + positive funding = Strong bullish momentum. New money is entering AND price is confirming direction. Watch for pullback entries.\n`;
        } else if (sig.includes('SHORT squeeze')) {
          msg += `   🎯 <b>COMBO:</b> OI rising + price falling + negative funding = Short squeeze setup. Shorts are piling in but OI is rising — forced liquidations could send price sharply higher.\n`;
        } else if (sig.includes('accumulation')) {
          msg += `   🎯 <b>COMBO:</b> OI rising but price flat = Smart money accumulating. Positions being built quietly before a move — watch for breakout direction.\n`;
        }
      }

      msg += `   📊 ${r.exchange.toUpperCase()}\n\n`;
    }

    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '<b>Score Guide:</b>\n';
    msg += '🔥 50+ = High conviction — multiple signals aligned\n';
    msg += '⚡ 30-49 = Notable activity — worth monitoring\n';
    msg += '👀 15-29 = Early signal — one indicator flagged\n';
    msg += '\n<b>What the signals mean:</b>\n';
    msg += '📈 <b>OI Rising</b> = New positions opening (fresh money)\n';
    msg += '💰 <b>Funding +</b> = Longs paying to hold (bullish bias)\n';
    msg += '💰 <b>Funding -</b> = Shorts paying to hold (bearish/squeeze)\n';
    msg += '🎯 <b>COMBO</b> = Multiple signals confirm same direction\n';
    msg += `\n<i>${new Date().toUTCString().slice(0, -4)}</i>`;
    return msg;
  }

  getScoreTier(score) {
    if (score >= 50) return { icon: '🔥', label: 'HIGH CONVICTION', meaning: 'Multiple onchain signals aligned — strong positioning detected' };
    if (score >= 35) return { icon: '⚡', label: 'NOTABLE ACTIVITY', meaning: 'Significant positioning shift — monitor closely for entry' };
    if (score >= 20) return { icon: '👀', label: 'EARLY SIGNAL', meaning: 'One indicator flagged — keep on watchlist' };
    return { icon: '📊', label: 'LOW ACTIVITY', meaning: 'Minor signal — not actionable yet' };
  }

  getLastScan() {
    return this.lastScan;
  }
}

module.exports = OnchainScanner;
