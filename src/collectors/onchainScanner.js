const logger = require('../utils/logger');
const { EMA } = require('technicalindicators');
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

class OnchainScanner {
  constructor(exchanges, onchainTracker) {
    this.exchanges = exchanges;
    this.onchainTracker = onchainTracker;
    this.oiCache = new Map();
    this.lsCache = new Map();
    this.alerts = [];
    this.lastScan = null;
  }

  async fetchLongShortRatio(symbol) {
    const cacheKey = symbol;
    const cached = this.lsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) return cached;

    const pair = symbol.replace('/', '').replace(':USDT', '');
    try {
      const [topAcct, topPos, global] = await Promise.all([
        fetchJSON(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${pair}&period=1h&limit=1`),
        fetchJSON(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${pair}&period=1h&limit=1`),
        fetchJSON(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${pair}&period=1h&limit=1`),
      ]);
      const result = {
        timestamp: Date.now(),
        topTraderAcctRatio: topAcct?.[0] ? parseFloat(topAcct[0].longShortRatio) : null,
        topTraderPosRatio: topPos?.[0] ? parseFloat(topPos[0].longShortRatio) : null,
        globalRatio: global?.[0] ? parseFloat(global[0].longShortRatio) : null,
      };
      this.lsCache.set(cacheKey, result);
      return result;
    } catch (e) {
      logger.debug(`L/S ratio fetch failed for ${pair}: ${e.message}`);
      return null;
    }
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
          .filter(([, t]) => t.quoteVolume > 2000000)
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

          // Score exchange flows — real on-chain data, weight heavily
          if (flow.outflowCount > flow.inflowCount && flow.outflowCount >= 3) {
            const flowBoost = flow.outflowCount >= 8 ? 25 : flow.outflowCount >= 5 ? 20 : 15;
            token.score += flowBoost;
            token.signals.push(`🏦 Exchange outflow: ${flow.outflowCount} withdrawals from ${flow.exchanges.join(', ')}`);
          }
          // Penalize inflows — tokens entering exchanges = sell pressure
          if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 3) {
            const penalty = flow.inflowCount >= 8 ? 15 : flow.inflowCount >= 5 ? 10 : 5;
            token.score -= penalty;
            token.signals.push(`⚠️ Exchange inflow: ${flow.inflowCount} deposits — sell pressure (-${penalty}pts)`);
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

    // Phase 3: Fetch L/S ratios from Binance for top tokens
    const topForLS = sorted.filter(r => r.score >= 20).slice(0, 10);
    for (const token of topForLS) {
      try {
        const ls = await this.fetchLongShortRatio(token.pair);
        if (ls && ls.topTraderAcctRatio != null) {
          token.lsData = ls;
          const topLS = ls.topTraderAcctRatio;
          const retailLS = ls.globalRatio;

          if (topLS < 0.85 && retailLS > 1.1) {
            token.score += 10;
            token.signals.push(`📊 Top traders SHORT (${topLS.toFixed(2)}) vs retail LONG (${retailLS.toFixed(2)}) — squeeze or dump`);
          } else if (topLS > 1.15 && retailLS < 0.9) {
            token.score += 10;
            token.signals.push(`📊 Top traders LONG (${topLS.toFixed(2)}) vs retail SHORT (${retailLS.toFixed(2)}) — smart money accumulating`);
          }
          if (topLS < 0.7) {
            token.signals.push(`⚠️ Top traders extremely short (${topLS.toFixed(2)}) — squeeze setup`);
          } else if (topLS > 1.3) {
            token.signals.push(`⚠️ Top traders extremely long (${topLS.toFixed(2)}) — conviction play`);
          }
        }
      } catch (e) { logger.debug(`L/S ratio failed for ${token.symbol}: ${e.message}`); }
    }
    sorted.sort((a, b) => b.score - a.score);

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

          // Score OI surge — capped at 15pts (OI >30% is crowded, not bullish)
          if (oiChange4h !== null) {
            if (oiChange4h > 40) { score += 10; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h ⚠️ crowded`); }
            else if (oiChange4h > 30) { score += 15; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h 🔥`); }
            else if (oiChange4h > 20) { score += 15; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h`); }
            else if (oiChange4h > 15) { score += 15; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h`); }
            else if (oiChange4h > 10) { score += 10; signals.push(`OI +${oiChange4h.toFixed(1)}% 4h`); }
            else if (oiChange4h < -20) { score += 10; signals.push(`OI ${oiChange4h.toFixed(1)}% 4h (flush)`); }
          }

          // 1h OI spike — moderate is good, extreme is crowded
          if (oiChange1h !== null && oiChange1h > 15) {
            const oiBoost = oiChange1h > 40 ? 5 : 10;
            score += oiBoost;
            signals.push(`OI +${oiChange1h.toFixed(1)}% 1h spike${oiChange1h > 40 ? ' ⚠️' : ''}`);
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
      lsData: null,
    };
  }

  /**
   * Fast OI spike check — runs every 2 min, only looks at 1h OI change
   * on top volume tokens. Returns tokens with extreme OI spikes that
   * haven't been alerted in the last 30 min.
   */
  async quickOIScan() {
    const spikes = [];
    if (!this._spikeAlerted) this._spikeAlerted = new Map();

    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      if (!exchange.has.fetchOpenInterestHistory) continue;
      try {
        const perpMarkets = Object.values(exchange.markets)
          .filter(m => m.swap && m.quote === 'USDT' && m.active);
        const tickers = await exchange.fetchTickers(perpMarkets.map(m => m.symbol));

        const top = Object.entries(tickers)
          .filter(([, t]) => t.quoteVolume > 2000000)
          .filter(([s]) => !s.includes('STOCK') && !isStockToken(s.split('/')[0]))
          .sort((a, b) => (b[1].quoteVolume || 0) - (a[1].quoteVolume || 0))
          .slice(0, 50);

        for (const [symbol, ticker] of top) {
          try {
            const lastAlerted = this._spikeAlerted.get(symbol);
            if (lastAlerted && Date.now() - lastAlerted < 30 * 60 * 1000) continue;

            const oiHist = await exchange.fetchOpenInterestHistory(symbol, '1h', undefined, 3);
            if (!oiHist || oiHist.length < 2) continue;

            const latest = oiHist[oiHist.length - 1];
            const prev = oiHist[oiHist.length - 2];
            const oiNow = latest.openInterestValue || (latest.openInterestAmount * (ticker.last || 1));
            const oiPrev = prev.openInterestValue || (prev.openInterestAmount * (ticker.last || 1));
            if (!oiPrev) continue;

            const change1h = ((oiNow - oiPrev) / oiPrev) * 100;
            if (change1h < 20) continue;

            const base = symbol.split('/')[0];
            const priceChange = ticker.percentage || 0;
            const dir = priceChange > 0 ? 'LONG' : priceChange < -1 ? 'SHORT' : 'NEUTRAL';

            spikes.push({
              symbol: base, pair: symbol, exchange: exchangeId,
              oiChange1h: change1h, price: ticker.last, priceChange,
              volume: ticker.quoteVolume, direction: dir,
            });
            this._spikeAlerted.set(symbol, Date.now());
          } catch {}
        }
      } catch (err) {
        logger.debug(`Quick OI scan failed for ${exchangeId}: ${err.message}`);
      }
    }

    // Clean old entries
    for (const [k, v] of this._spikeAlerted) {
      if (Date.now() - v > 60 * 60 * 1000) this._spikeAlerted.delete(k);
    }

    return spikes;
  }

  formatOISpike(spike) {
    const arrow = spike.priceChange > 0 ? '🟢' : spike.priceChange < -1 ? '🔴' : '⚪';
    const priceStr = spike.price >= 1 ? spike.price.toFixed(4) : spike.price.toPrecision(4);
    return `⚡ <b>OI SPIKE DETECTED</b>\n\n` +
      `${arrow} <b><code>${spike.symbol}</code></b> — OI +${spike.oiChange1h.toFixed(1)}% in 1h\n` +
      `💰 Price: $${priceStr} (${spike.priceChange >= 0 ? '+' : ''}${spike.priceChange.toFixed(1)}%)\n` +
      `📊 Vol: $${(spike.volume / 1e6).toFixed(1)}M\n` +
      `🎯 Bias: ${spike.direction}\n\n` +
      `<i>Massive new positions opening — big move incoming. Full scan in next cycle.</i>`;
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

      // L/S Ratio — positioning analysis
      if (r.lsData && r.lsData.topTraderAcctRatio != null) {
        const topLS = r.lsData.topTraderAcctRatio;
        const topPosLS = r.lsData.topTraderPosRatio;
        const retailLS = r.lsData.globalRatio;
        msg += `   📊 Top Trader L/S: ${topLS?.toFixed(2) || '—'}`;
        if (topPosLS != null) msg += ` (pos: ${topPosLS.toFixed(2)})`;
        msg += ` | Retail L/S: ${retailLS?.toFixed(2) || '—'}\n`;
        if (topLS < 0.85 && retailLS > 1.05) {
          msg += `      <i>Smart money short, retail long — classic dump or squeeze setup</i>\n`;
        } else if (topLS > 1.15 && retailLS < 0.95) {
          msg += `      <i>Smart money long, retail short — big players accumulating while crowd fades</i>\n`;
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

      // Trade setup with entry/TP/SL for score 45+
      if (r._tradeSetup) {
        msg += this.formatTradeSetup(r._tradeSetup);
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

  async buildTradeSetup(token, exchanges, type = 'ONCHAIN_SETUP') {
    try {
      const exchange = exchanges[token.exchange];
      if (!exchange) return null;

      const ohlcv = await exchange.fetchOHLCV(token.pair, '1h', undefined, 20);
      if (!ohlcv || ohlcv.length < 14) return null;

      // ATR(14)
      let atrSum = 0;
      for (let i = ohlcv.length - 14; i < ohlcv.length; i++) {
        const [, , h, l] = ohlcv[i];
        atrSum += h - l;
      }
      const atr = atrSum / 14;
      if (!atr || atr <= 0) return null;

      const snap = this.liquidationScanner
        ? this.liquidationScanner.generateSetupSnapshot(token)
        : { direction: token.priceChange > 0 ? 'long' : 'short' };

      const direction = snap.direction === 'long' || snap.direction === 'short' ? snap.direction : null;
      if (!direction) return null;
      const price = token.price;

      // Candle confirmation on 5m — reject if last 3 completed 5m candles contradict direction
      try {
        const ohlcv5m = await exchange.fetchOHLCV(token.pair, '5m', undefined, 6);
        if (ohlcv5m && ohlcv5m.length >= 4) {
          const c1 = ohlcv5m[ohlcv5m.length - 2]; // last completed
          const c2 = ohlcv5m[ohlcv5m.length - 3];
          const c3 = ohlcv5m[ohlcv5m.length - 4];
          const g1 = c1[4] >= c1[1], g2 = c2[4] >= c2[1], g3 = c3[4] >= c3[1];
          if (direction === 'long' && !g1 && !g2 && !g3) {
            logger.info(`${token.symbol}: Skipping LONG — last 3 5m candles red (falling knife)`);
            return null;
          }
          if (direction === 'short' && g1 && g2 && g3) {
            logger.info(`${token.symbol}: Skipping SHORT — last 3 5m candles green (chasing strength)`);
            return null;
          }
        }
      } catch (e) { logger.debug(`${token.symbol}: 5m candle check failed: ${e.message}`); }

      // 5m volatility filter — reject if candles are swinging too wildly for reliable entries
      try {
        const vol5m = await exchange.fetchOHLCV(token.pair, '5m', undefined, 14);
        if (vol5m && vol5m.length >= 10) {
          let atr5mSum = 0;
          for (let i = vol5m.length - 10; i < vol5m.length; i++) {
            atr5mSum += vol5m[i][2] - vol5m[i][3]; // high - low
          }
          const atr5m = atr5mSum / 10;
          const atr5mPct = (atr5m / price) * 100;
          if (atr5mPct > 2.5) {
            logger.info(`${token.symbol}: Reject — 5m ATR ${atr5mPct.toFixed(1)}% of price (too volatile for reliable entry)`);
            return null;
          }
        }
      } catch (e) { logger.debug(`${token.symbol}: 5m volatility check failed: ${e.message}`); }

      // 4H macro trend filter — reject counter-trend entries and post-pump dumps
      try {
        const ohlcv4h = await exchange.fetchOHLCV(token.pair, '4h', undefined, 30);
        if (ohlcv4h.length >= 20) {
          const closes4h = ohlcv4h.map(c => c[4]);
          const highs4h = ohlcv4h.map(c => c[2]);

          // EMA20 trend: reject if price is >5% against the 4H trend
          const ema20_4h = EMA.calculate({ values: closes4h, period: 20 });
          if (ema20_4h.length) {
            const currentEma4h = ema20_4h[ema20_4h.length - 1];
            const trendGap = ((price - currentEma4h) / currentEma4h) * 100;
            if (direction === 'long' && trendGap < -5) {
              logger.info(`${token.symbol}: Reject LONG — price ${trendGap.toFixed(1)}% below 4H EMA20 (downtrend)`);
              return null;
            }
            if (direction === 'short' && trendGap > 5) {
              logger.info(`${token.symbol}: Reject SHORT — price ${trendGap.toFixed(1)}% above 4H EMA20 (uptrend)`);
              return null;
            }
          }

          // Post-pump dump: if coin dropped >30% from its recent 4H high, it's bleeding — don't long
          const recentHigh = Math.max(...highs4h.slice(-20));
          const drawdown = ((recentHigh - price) / recentHigh) * 100;
          if (direction === 'long' && drawdown > 30) {
            logger.info(`${token.symbol}: Reject LONG — ${drawdown.toFixed(1)}% below 4H high $${recentHigh.toPrecision(4)} (post-pump dump)`);
            return null;
          }
          if (direction === 'short' && drawdown < 5) {
            logger.info(`${token.symbol}: Reject SHORT — only ${drawdown.toFixed(1)}% from highs (still near peak)`);
            return null;
          }

          // Pump not settled: if latest 4H candle has >8% body, the move is still in progress
          const last4h = ohlcv4h[ohlcv4h.length - 1];
          const bodyPct = Math.abs((last4h[4] - last4h[1]) / last4h[1]) * 100;
          const rangePct = ((last4h[2] - last4h[3]) / last4h[3]) * 100;
          if (rangePct > 10) {
            logger.info(`${token.symbol}: Reject — current 4H candle range ${rangePct.toFixed(1)}% (pump not settled, wait for consolidation)`);
            return null;
          }
        }
      } catch (e) { logger.debug(`${token.symbol}: 4H trend check failed: ${e.message}`); }

      // L/S positioning filter — reject trades where smart money disagrees
      try {
        const ls = token.lsData || await this.fetchLongShortRatio(token.pair);
        if (ls && ls.topTraderAcctRatio != null) {
          const topLS = ls.topTraderAcctRatio;
          if (direction === 'long' && topLS < 0.75) {
            logger.info(`${token.symbol}: Reject LONG — top traders heavily short (L/S ${topLS.toFixed(2)})`);
            return null;
          }
          if (direction === 'short' && topLS > 1.25) {
            logger.info(`${token.symbol}: Reject SHORT — top traders heavily long (L/S ${topLS.toFixed(2)})`);
            return null;
          }
        }
      } catch (e) { /* L/S data unavailable, skip filter */ }

      const mult = direction === 'long' ? 1 : -1;

      const minPrice = price * 0.05;
      const tp1Raw = price + mult * atr * 1.2;
      const tp2Raw = price + mult * atr * 2.5;
      const tp3Raw = price + mult * atr * 4.0;
      // Cap TPs by absolute % — inflated ATR from pumps makes ATR-based targets unreachable
      const tp1Cap = price * (1 + mult * 0.03);  // max 3%
      const tp2Cap = price * (1 + mult * 0.06);  // max 6%
      const tp3Cap = price * (1 + mult * 0.10);  // max 10%
      const tp1 = Math.max(direction === 'long' ? Math.min(tp1Raw, tp1Cap) : Math.max(tp1Raw, tp1Cap), minPrice);
      const tp2 = Math.max(direction === 'long' ? Math.min(tp2Raw, tp2Cap) : Math.max(tp2Raw, tp2Cap), minPrice);
      const tp3 = Math.max(direction === 'long' ? Math.min(tp3Raw, tp3Cap) : Math.max(tp3Raw, tp3Cap), minPrice);

      // SL: find real support/resistance from chart structure, not blind ATR
      const atrSL = price - mult * atr * 2.0;
      let sl = atrSL;

      // 1) Swing structure from 1H candles — find swing lows (LONG) or highs (SHORT)
      const swingLevels = [];
      for (let i = 2; i < ohlcv.length - 1; i++) {
        const prev = ohlcv[i - 1], curr = ohlcv[i], next = ohlcv[i + 1];
        if (direction === 'long') {
          if (curr[3] <= prev[3] && curr[3] <= next[3] && curr[3] < price)
            swingLevels.push(curr[3]);
        } else {
          if (curr[2] >= prev[2] && curr[2] >= next[2] && curr[2] > price)
            swingLevels.push(curr[2]);
        }
      }
      // Sort: nearest swing to price first
      if (direction === 'long') swingLevels.sort((a, b) => b - a);
      else swingLevels.sort((a, b) => a - b);

      if (swingLevels.length) {
        const bestSwing = swingLevels[0];
        const buffer = direction === 'long' ? 0.99 : 1.01;
        const swingSL = bestSwing * buffer;
        const swingDistPct = Math.abs((price - swingSL) / price) * 100;
        if (swingDistPct >= 3 && swingDistPct <= 15) {
          sl = swingSL;
          logger.info(`${token.symbol}: SL below swing ${direction === 'long' ? 'low' : 'high'} $${bestSwing.toPrecision(6)} → SL $${swingSL.toPrecision(6)} (${swingDistPct.toFixed(1)}%)`);
        }
      }

      // 2) Order book walls — upgrade SL if a wall sits closer and confirms support
      if (snap.levels?.length) {
        const structureLevels = snap.levels
          .filter(l => direction === 'long' ? l.type === 'support' && l.price < price : l.type === 'resistance' && l.price > price)
          .sort((a, b) => direction === 'long' ? b.price - a.price : a.price - b.price);
        if (structureLevels.length) {
          const wallBuffer = direction === 'long' ? 0.995 : 1.005;
          const wallSL = structureLevels[0].price * wallBuffer;
          const wallDistPct = Math.abs((price - wallSL) / price) * 100;
          if (wallDistPct >= 3 && wallDistPct <= 15) {
            if (direction === 'long' ? wallSL > sl : wallSL < sl) {
              sl = wallSL;
              logger.info(`${token.symbol}: SL upgraded to order book wall $${wallSL.toPrecision(6)} (${wallDistPct.toFixed(1)}%)`);
            }
          }
        }
      }

      // 3) Liq zones — 25x liq as SL floor
      if (token.setupData?.liqLevels?.levels) {
        const lev25 = token.setupData.liqLevels.levels.find(l => l.leverage === 25);
        if (lev25) {
          const liqSL = direction === 'long' ? lev25.longLiqPrice : lev25.shortLiqPrice;
          const liqDistPct = Math.abs((price - liqSL) / price) * 100;
          if (liqDistPct >= 3 && liqDistPct <= 10) {
            const liqBeyond = direction === 'long' ? liqSL * 0.995 : liqSL * 1.005;
            if (direction === 'long' ? liqBeyond > sl : liqBeyond < sl) {
              sl = liqBeyond;
              logger.info(`${token.symbol}: SL tightened to liq zone $${liqBeyond.toPrecision(6)} (${liqDistPct.toFixed(1)}%)`);
            }
          }
        }
      }

      // Floor: SL must be at least 3% from entry AND on correct side
      const slOnWrongSide = direction === 'long' ? sl >= price : sl <= price;
      const slDistPct = Math.abs((price - sl) / price) * 100;
      if (slOnWrongSide || slDistPct < 3) {
        const hardFloor = direction === 'long' ? price * 0.97 : price * 1.03;
        const atrOk = direction === 'long' ? atrSL < price * 0.97 : atrSL > price * 1.03;
        sl = atrOk ? atrSL : hardFloor;
        logger.info(`${token.symbol}: SL ${slOnWrongSide ? 'on wrong side' : 'too tight'} (${slDistPct.toFixed(1)}%) → $${sl.toPrecision(6)} (${Math.abs((price - sl) / price * 100).toFixed(1)}%)`);
      }

      const confidence = token.score >= 60 ? 5 : token.score >= 45 ? 4 : 3;

      const catalystParts = [];
      if (token.oiChange4h) catalystParts.push(`OI ${token.oiChange4h > 0 ? '+' : ''}${token.oiChange4h.toFixed(1)}% 4h`);
      if (token.exchangeFlow?.outflowCount >= 3) catalystParts.push(`${token.exchangeFlow.outflowCount} outflows`);
      if (token.exchangeFlow?.inflowCount >= 3) catalystParts.push(`${token.exchangeFlow.inflowCount} inflows`);
      if (token.fundingRate) catalystParts.push(`funding ${(token.fundingRate * 100).toFixed(4)}%`);

      return {
        type,
        symbol: token.symbol,
        exchange: token.exchange,
        pair: token.pair,
        direction,
        currentPrice: price,
        entryLow: price,
        entryHigh: price,
        tp1, tp2, tp3,
        stopLoss: sl,
        atr,
        confidence,
        catalyst: `${type}: ${catalystParts.join(', ')}`,
        suggestedLeverage: null,
        volumeInfo: `Vol $${(token.volume / 1e6).toFixed(1)}M`,
        onchainScore: token.score,
        onchainContext: {
          score: token.score,
          signals: token.signals,
          oiChange1h: token.oiChange1h,
          oiChange4h: token.oiChange4h,
          fundingRate: token.fundingRate,
          fundingBias: token.fundingBias,
          priceChange: token.priceChange,
          volume: token.volume,
          lsData: token.lsData || null,
          exchangeFlow: token.exchangeFlow || null,
          setupData: token.setupData ? {
            liquidations: token.setupData.liquidations || null,
            orderBook: token.setupData.orderBook || null,
          } : null,
        },
      };
    } catch (err) {
      logger.debug(`buildTradeSetup failed for ${token.symbol}: ${err.message}`);
      return null;
    }
  }

  formatTradeSetup(setup) {
    if (!setup) return '';
    const fmt = (p) => p >= 1 ? `$${p.toFixed(4)}` : `$${p.toPrecision(4)}`;
    const pct = (from, to) => (((to - from) / from) * 100).toFixed(1);
    const dir = setup.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
    let msg = `\n   🎯 <b>Trade Setup (${dir})</b>\n`;
    msg += `   Entry: ${fmt(setup.currentPrice)}\n`;
    msg += `   📈 TP1: ${fmt(setup.tp1)} (${setup.direction === 'long' ? '+' : ''}${pct(setup.currentPrice, setup.tp1)}%)\n`;
    msg += `   📈 TP2: ${fmt(setup.tp2)} (${setup.direction === 'long' ? '+' : ''}${pct(setup.currentPrice, setup.tp2)}%)\n`;
    msg += `   📈 TP3: ${fmt(setup.tp3)} (${setup.direction === 'long' ? '+' : ''}${pct(setup.currentPrice, setup.tp3)}%)\n`;
    msg += `   🛑 SL: ${fmt(setup.stopLoss)} (${pct(setup.currentPrice, setup.stopLoss)}%)\n`;
    return msg;
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
