const logger = require('../utils/logger');
const { STOCK_TOKENS } = require('./technicalScanner');

function isStockToken(symbol) {
  if (STOCK_TOKENS.test(symbol)) return true;
  if (/STOCK$/i.test(symbol)) return true;
  if (/^(1000)?[A-Z]{1,6}(LONG|SHORT|BULL|BEAR|UP|DOWN|3L|3S|2L|2S|5L|5S)$/i.test(symbol)) return true;
  return false;
}

class OnchainScanner {
  constructor(exchanges, onchainTracker) {
    this.exchanges = exchanges;
    this.onchainTracker = onchainTracker;
    this.oiCache = new Map();
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

    // Phase 2: Check exchange flows for top tokens via Etherscan
    if (this.onchainTracker) {
      const topForFlows = sorted.filter(r => r.score >= 15).slice(0, 8);
      for (const token of topForFlows) {
        try {
          const contract = await this.onchainTracker.resolveContractAddress(token.symbol);
          if (!contract) continue;

          const chainKey = this.mapCoinGeckoChain(contract.chain);
          if (!chainKey) continue;

          const flow = await this.onchainTracker.analyzeExchangeFlows(contract.address, token.symbol, chainKey);
          if (!flow) continue;

          token.exchangeFlow = flow;
          token.contractAddress = contract.address;
          token.chain = contract.chain;

          // Score exchange flows
          if (flow.outflowCount > flow.inflowCount && flow.outflowCount >= 3) {
            const flowBoost = flow.outflowCount >= 8 ? 20 : flow.outflowCount >= 5 ? 15 : 10;
            token.score += flowBoost;
            token.signals.push(`🏦 Exchange outflow: ${flow.outflowCount} withdrawals from ${flow.exchanges.join(', ')}`);
          }
          if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 5) {
            token.signals.push(`⚠️ Exchange inflow: ${flow.inflowCount} deposits — potential sell pressure`);
          }

          // Rate limit: Etherscan 5 req/sec free tier
          await new Promise(r => setTimeout(r, 1500));
        } catch (e) {
          logger.debug(`Flow check failed for ${token.symbol}: ${e.message}`);
        }
      }
      // Re-sort after flow boosts
      sorted.sort((a, b) => b.score - a.score);
    }

    // Fetch setup data (order book + liquidations) for top tokens
    if (this.liquidationScanner) {
      const topForSetup = sorted.filter(r => r.score >= 20).slice(0, 5);
      for (const token of topForSetup) {
        try {
          token.setupData = await this.liquidationScanner.getSetupData(token.symbol, token.pair, token.exchange);
        } catch (e) {
          logger.debug(`Setup data failed for ${token.symbol}: ${e.message}`);
        }
      }
    }

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

    // Check for exchange flow boost from last scan
    const lastScan = this.lastScan?.topAlerts?.find(t => t.symbol === symbol || t.pair?.startsWith(symbol));
    if (lastScan?.exchangeFlow?.outflowCount > lastScan?.exchangeFlow?.inflowCount && lastScan?.exchangeFlow?.outflowCount >= 3) {
      boost += 10;
      signals.push(`Exchange outflows detected (${lastScan.exchangeFlow.exchanges.join(', ')})`);
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
      msg += `${arrow} <b><code>${r.symbol}</code></b> — Score: ${r.score}/100 ${tier.icon}\n`;
      msg += `   <b>${tier.label}</b> — ${tier.meaning}\n`;
      const priceStr = r.price ? `$${r.price >= 1 ? r.price.toFixed(2) : r.price.toPrecision(4)}` : '—';
      const changeStr = `${r.priceChange >= 0 ? '+' : ''}${r.priceChange.toFixed(1)}%`;
      const changeIcon = r.priceChange > 5 ? ' 🚀' : r.priceChange < -5 ? ' 📉' : '';
      msg += `   💰 Price: ${priceStr} (${changeStr}${changeIcon}) | Vol: $${(r.volume / 1e6).toFixed(1)}M\n`;
      if (r.contractAddress) {
        msg += `   📋 <code>${r.contractAddress}</code>  ·  ⛓ ${r.chain || 'unknown'}\n`;
      }

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

      // Exchange flow explanation
      if (r.exchangeFlow) {
        const f = r.exchangeFlow;
        if (f.outflowCount > f.inflowCount && f.outflowCount >= 3) {
          msg += `   🏦 <b>EXCHANGE OUTFLOW</b>: ${f.outflowCount} withdrawals vs ${f.inflowCount} deposits\n`;
          msg += `      Exchanges: ${f.exchanges.join(', ') || 'Unknown'}\n`;
          msg += `      <i>Tokens leaving exchanges = accumulation. Smart money moving to cold storage, reducing sell-side supply. This is the leading indicator — outflows often precede pumps.</i>\n`;
        } else if (f.inflowCount > f.outflowCount && f.inflowCount >= 3) {
          msg += `   ⚠️ <b>EXCHANGE INFLOW</b>: ${f.inflowCount} deposits vs ${f.outflowCount} withdrawals\n`;
          msg += `      <i>Tokens entering exchanges = potential sell pressure. Holders may be preparing to dump.</i>\n`;
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

      // Liquidation data
      if (r.setupData?.liquidations) {
        const liq = r.setupData.liquidations;
        if (liq.totalLiqs > 0) {
          const longPct = liq.totalLiqs > 0 ? ((liq.longLiqs / liq.totalLiqs) * 100).toFixed(0) : 50;
          msg += `   💥 Liquidations 24h: $${(liq.totalLiqs / 1e6).toFixed(1)}M (${longPct}% longs, ${100 - longPct}% shorts)\n`;
          if (liq.longLiqs > liq.shortLiqs * 2) {
            msg += `      <i>Longs getting wiped — potential bottom forming as weak hands flushed</i>\n`;
          } else if (liq.shortLiqs > liq.longLiqs * 2) {
            msg += `      <i>Shorts getting squeezed — forced buying pushing price up</i>\n`;
          }
        }
      }

      // Order book depth
      if (r.setupData?.orderBook) {
        const ob = r.setupData.orderBook;
        const imbalanceLabel = ob.imbalance === 'buy_heavy' ? '🟢 Buy-heavy' : ob.imbalance === 'sell_heavy' ? '🔴 Sell-heavy' : '🟡 Balanced';
        msg += `   📖 Order Book: ${imbalanceLabel} (Bid $${(ob.bidDepth / 1e6).toFixed(1)}M / Ask $${(ob.askDepth / 1e6).toFixed(1)}M)\n`;
      }

      // Whale orders + large trades + liq levels
      if (this.liquidationScanner && r.setupData) {
        msg += this.liquidationScanner.formatWhaleOrders(r.setupData, r.symbol);
        msg += this.liquidationScanner.formatLiqLevels(r.setupData);
      }

      // Setup snapshot
      if (this.liquidationScanner && r.score >= 20) {
        const snap = this.liquidationScanner.generateSetupSnapshot(r);
        msg += this.liquidationScanner.formatSnapshot(snap, r.symbol);
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
    msg += '🏦 <b>OUTFLOW</b> = Tokens leaving exchanges (accumulation)\n';
    msg += '⚠️ <b>INFLOW</b> = Tokens entering exchanges (sell pressure)\n';
    msg += '📸 <b>SNAPSHOT</b> = AI-generated trade setup based on all signals\n';
    msg += `\n<i>${new Date().toUTCString().slice(0, -4)}</i>`;
    return msg;
  }

  getScoreTier(score) {
    if (score >= 50) return { icon: '🔥', label: 'HIGH CONVICTION', meaning: 'Multiple onchain signals aligned — strong positioning detected' };
    if (score >= 35) return { icon: '⚡', label: 'NOTABLE ACTIVITY', meaning: 'Significant positioning shift — monitor closely for entry' };
    if (score >= 20) return { icon: '👀', label: 'EARLY SIGNAL', meaning: 'One indicator flagged — keep on watchlist' };
    return { icon: '📊', label: 'LOW ACTIVITY', meaning: 'Minor signal — not actionable yet' };
  }

  mapCoinGeckoChain(cgChain) {
    const map = {
      'ethereum': 'ethereum', 'binance-smart-chain': 'bsc', 'polygon-pos': 'polygon',
      'arbitrum-one': 'arbitrum', 'base': 'base', 'optimism': 'optimism', 'avalanche': 'avalanche',
      'robinhood-chain': 'robinhood', 'solana': 'solana',
    };
    return map[cgChain] || null;
  }

  getLastScan() {
    return this.lastScan;
  }
}

module.exports = OnchainScanner;
