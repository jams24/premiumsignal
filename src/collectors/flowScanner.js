const logger = require('../utils/logger');

class FlowScanner {
  constructor(exchanges, onchainTracker) {
    this.exchanges = exchanges;
    this.tracker = onchainTracker;
    this.lastScan = null;
    this.resolvedTokens = new Map(); // symbol → { address, chain } or null
    this.scanHistory = new Map(); // symbol → { timestamp, flow }

    // Cumulative flow memory — tracks signals across scans (24h window)
    // symbol → { firstSeen, lastSeen, scansWithOutflow, scansWithInflow, totalOutflows, totalInflows,
    //            exchanges, peakScore, priceAtFirst, alerted }
    this.flowMemory = new Map();
  }

  async scan() {
    const results = [];

    const allSymbols = new Map();
    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      try {
        const perps = Object.values(exchange.markets)
          .filter(m => m.swap && m.quote === 'USDT' && m.active);

        const tickers = await exchange.fetchTickers(perps.map(m => m.symbol));

        for (const [symbol, ticker] of Object.entries(tickers)) {
          if (!ticker.quoteVolume || ticker.quoteVolume < 1000000) continue;
          const base = symbol.split('/')[0];
          if (/STOCK$/i.test(base) || /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|DOT|AVAX|LINK|MATIC|UNI|AAVE|LTC|BCH)$/i.test(base)) continue;

          const existing = allSymbols.get(base);
          if (!existing || ticker.quoteVolume > existing.volume) {
            allSymbols.set(base, {
              symbol: base,
              pair: symbol,
              exchange: exchangeId,
              volume: ticker.quoteVolume,
              price: ticker.last,
              priceChange: ticker.percentage || 0,
            });
          }
        }
      } catch (err) {
        logger.error(`FlowScanner: failed to load ${exchangeId}: ${err.message}`);
      }
    }

    const tokens = [...allSymbols.values()]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 30);

    logger.info(`FlowScanner: checking ${tokens.length} perp tokens for exchange flows`);

    for (const token of tokens) {
      try {
        const history = this.scanHistory.get(token.symbol);
        if (history && Date.now() - history.timestamp < 15 * 60 * 1000) {
          if (history.flow) results.push({ ...token, flow: history.flow });
          continue;
        }

        let resolved = this.resolvedTokens.get(token.symbol);
        if (resolved === undefined) {
          resolved = await this.tracker.resolveContractAddress(token.symbol);
          this.resolvedTokens.set(token.symbol, resolved || null);
          await new Promise(r => setTimeout(r, 1500));
        }
        if (!resolved) {
          this.scanHistory.set(token.symbol, { timestamp: Date.now(), flow: null });
          continue;
        }

        const chainKey = this.mapChain(resolved.chain);
        if (!chainKey) {
          this.scanHistory.set(token.symbol, { timestamp: Date.now(), flow: null });
          continue;
        }

        const flow = await this.tracker.analyzeExchangeFlows(resolved.address, token.symbol, chainKey);

        this.scanHistory.set(token.symbol, { timestamp: Date.now(), flow });

        // Update cumulative flow memory
        if (flow) {
          this.updateFlowMemory(token.symbol, flow, token.price);
        }

        if (flow && (flow.outflowCount >= 1 || flow.inflowCount >= 1)) {
          results.push({ ...token, flow });
        }

        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        logger.debug(`FlowScanner: ${token.symbol} failed: ${err.message}`);
      }
    }

    // Expire old flow memory entries (>24h since last seen)
    this.expireFlowMemory();

    // Score using cumulative data
    for (const r of results) {
      r.flowScore = this.scoreFlow(r.flow);
      const mem = this.flowMemory.get(r.symbol);
      if (mem) {
        r.cumulativeScore = this.scoreCumulative(mem);
        r.flowScore = Math.max(r.flowScore, r.cumulativeScore);
        r.memory = mem;
      }
    }

    // Also include tokens with strong cumulative signal even if current scan is quiet
    for (const [symbol, mem] of this.flowMemory) {
      if (mem.scansWithOutflow >= 3 && !results.find(r => r.symbol === symbol)) {
        const tokenData = allSymbols.get(symbol);
        if (tokenData) {
          const cScore = this.scoreCumulative(mem);
          if (cScore >= 15) {
            results.push({
              ...tokenData,
              flow: { outflowCount: 0, inflowCount: 0, exchanges: [...mem.exchanges], bias: 'bullish', chain: mem.chain || 'unknown', totalTxs: 0, netFlow: 0 },
              flowScore: cScore,
              cumulativeScore: cScore,
              memory: mem,
              fromMemory: true,
            });
          }
        }
      }
    }

    results.sort((a, b) => b.flowScore - a.flowScore);
    this.lastScan = { timestamp: Date.now(), count: results.length, results: results.slice(0, 10) };
    logger.info(`FlowScanner: ${results.length} tokens with flows, ${this.flowMemory.size} in memory`);

    return results;
  }

  updateFlowMemory(symbol, flow, price) {
    const now = Date.now();
    let mem = this.flowMemory.get(symbol);

    if (!mem) {
      mem = {
        firstSeen: now,
        lastSeen: now,
        scansWithOutflow: 0,
        scansWithInflow: 0,
        totalOutflows: 0,
        totalInflows: 0,
        exchanges: new Set(),
        peakScore: 0,
        priceAtFirst: price,
        currentPrice: price,
        chain: flow.chain,
        alerted: { early: false, notable: false, heavy: false },
      };
      this.flowMemory.set(symbol, mem);
    }

    mem.lastSeen = now;
    mem.currentPrice = price;

    if (flow.outflowCount > 0) {
      mem.scansWithOutflow++;
      mem.totalOutflows += flow.outflowCount;
    }
    if (flow.inflowCount > 0) {
      mem.scansWithInflow++;
      mem.totalInflows += flow.inflowCount;
    }
    for (const ex of (flow.exchanges || [])) {
      mem.exchanges.add(ex);
    }
  }

  expireFlowMemory() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [symbol, mem] of this.flowMemory) {
      if (mem.lastSeen < cutoff) {
        this.flowMemory.delete(symbol);
      }
    }
  }

  scoreCumulative(mem) {
    let score = 0;

    // Sustained outflows across multiple scans = strong accumulation
    if (mem.scansWithOutflow >= 8) score += 40;
    else if (mem.scansWithOutflow >= 5) score += 30;
    else if (mem.scansWithOutflow >= 3) score += 20;
    else if (mem.scansWithOutflow >= 2) score += 10;

    // Total outflow transactions
    if (mem.totalOutflows >= 20) score += 15;
    else if (mem.totalOutflows >= 10) score += 10;
    else if (mem.totalOutflows >= 5) score += 5;

    // Multiple exchanges involved over time
    if (mem.exchanges.size >= 3) score += 10;
    else if (mem.exchanges.size >= 2) score += 5;

    // Net outflow bias (more outflow scans than inflow)
    if (mem.scansWithOutflow > mem.scansWithInflow * 2) score += 10;

    // Duration bonus — sustained over hours is stronger than a spike
    const durationHours = (mem.lastSeen - mem.firstSeen) / (60 * 60 * 1000);
    if (durationHours >= 6 && mem.scansWithOutflow >= 3) score += 10;
    if (durationHours >= 12 && mem.scansWithOutflow >= 5) score += 10;

    // Penalize if inflows dominate
    if (mem.scansWithInflow > mem.scansWithOutflow) score -= 15;

    return Math.max(score, 0);
  }

  scoreFlow(flow) {
    if (!flow) return 0;
    let score = 0;

    if (flow.outflowCount >= 8) score += 30;
    else if (flow.outflowCount >= 5) score += 20;
    else if (flow.outflowCount >= 3) score += 10;

    if (flow.netFlow > 0 && flow.outflowCount > flow.inflowCount) score += 10;

    if (flow.exchanges.length >= 3) score += 10;
    else if (flow.exchanges.length >= 2) score += 5;

    if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 5) score -= 10;

    return score;
  }

  // Returns new alert tier if the token crossed a threshold this scan
  checkAlertEscalation(symbol) {
    const mem = this.flowMemory.get(symbol);
    if (!mem) return null;

    const score = this.scoreCumulative(mem);
    if (score >= 40 && !mem.alerted.heavy) {
      mem.alerted.heavy = true;
      return 'heavy';
    }
    if (score >= 20 && !mem.alerted.notable) {
      mem.alerted.notable = true;
      return 'notable';
    }
    if (score >= 10 && !mem.alerted.early) {
      mem.alerted.early = true;
      return 'early';
    }
    return null;
  }

  formatAlerts(results, limit = 5) {
    const top = results.filter(r => r.flowScore >= 10).slice(0, limit);
    if (!top.length) return null;

    let msg = '🏦 <b>EXCHANGE FLOW SCANNER</b>\n';
    msg += '<i>Detects tokens leaving/entering CEX wallets — exchange outflows signal accumulation before pumps.</i>\n\n';

    for (const r of top) {
      const f = r.flow;
      const mem = r.memory;
      const tier = this.getTier(r.flowScore);
      const arrow = r.flowScore >= 30 ? '🟢' : r.flowScore >= 15 ? '🟡' : '👀';

      msg += `${arrow} <b>${r.symbol}</b> — Score: ${r.flowScore} ${tier.icon}\n`;
      msg += `   <b>${tier.label}</b>\n`;
      msg += `   💰 Price: ${r.priceChange >= 0 ? '+' : ''}${r.priceChange.toFixed(1)}% | Vol: $${(r.volume / 1e6).toFixed(1)}M\n`;

      // Current scan data
      if (f.outflowCount > 0 || f.inflowCount > 0) {
        msg += `   📤 This scan: ${f.outflowCount} outflows, ${f.inflowCount} inflows\n`;
      }

      // Cumulative data (the key differentiator)
      if (mem) {
        const hours = ((mem.lastSeen - mem.firstSeen) / (60 * 60 * 1000)).toFixed(1);
        msg += `   📊 <b>Cumulative (${hours}h):</b>\n`;
        msg += `      Outflow scans: ${mem.scansWithOutflow} | Total withdrawals: ${mem.totalOutflows}\n`;
        msg += `      Inflow scans: ${mem.scansWithInflow} | Total deposits: ${mem.totalInflows}\n`;
        if (mem.exchanges.size > 0) {
          msg += `      Exchanges: ${[...mem.exchanges].join(', ')}\n`;
        }
        if (mem.priceAtFirst && mem.currentPrice) {
          const priceDelta = ((mem.currentPrice - mem.priceAtFirst) / mem.priceAtFirst * 100).toFixed(1);
          msg += `      Price since first signal: ${priceDelta > 0 ? '+' : ''}${priceDelta}%\n`;
        }

        // Interpretation
        if (mem.scansWithOutflow >= 5 && mem.scansWithOutflow > mem.scansWithInflow * 2) {
          msg += `      🔥 <i>Sustained accumulation over ${hours}h — smart money consistently withdrawing. High conviction setup.</i>\n`;
        } else if (mem.scansWithOutflow >= 3) {
          msg += `      ⚡ <i>Repeated outflows detected — accumulation pattern building. Watch for breakout.</i>\n`;
        } else if (mem.scansWithOutflow >= 2) {
          msg += `      👀 <i>Early outflow pattern — needs confirmation from next scans.</i>\n`;
        }
      }

      msg += `   ⛓ ${f.chain || 'unknown'} | ${r.exchange.toUpperCase()}${r.fromMemory ? ' (from memory)' : ''}\n\n`;
    }

    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '<b>How cumulative tracking works:</b>\n';
    msg += 'Scanner runs every 15 min and remembers outflow signals for 24h.\n';
    msg += 'Single outflows can be noise — but repeated outflows across hours = accumulation.\n';
    msg += 'The more scans confirm outflows, the higher the score climbs.\n\n';
    msg += '<b>Score Guide:</b>\n';
    msg += '🔥 40+ = Sustained heavy accumulation (hours of outflows)\n';
    msg += '⚡ 20-39 = Building accumulation pattern\n';
    msg += '👀 10-19 = Early signal — monitoring\n';
    msg += `\n<i>${new Date().toUTCString().slice(0, -4)}</i>`;

    return msg;
  }

  formatEscalationAlert(symbol, tier) {
    const mem = this.flowMemory.get(symbol);
    if (!mem) return null;

    const hours = ((mem.lastSeen - mem.firstSeen) / (60 * 60 * 1000)).toFixed(1);
    const score = this.scoreCumulative(mem);
    const exchanges = [...mem.exchanges].join(', ') || 'unknown';

    if (tier === 'heavy') {
      return `🔥🏦 <b>HEAVY ACCUMULATION ALERT</b>\n\n` +
        `<b>$${symbol}</b> — Cumulative Score: ${score}\n` +
        `Sustained exchange outflows over <b>${hours} hours</b>\n` +
        `📤 ${mem.totalOutflows} withdrawals across ${mem.scansWithOutflow} scans\n` +
        `🏛 Exchanges: ${exchanges}\n\n` +
        `<i>This is the pattern Flams catches — consistent accumulation over hours signals smart money positioning before a major move. ` +
        `Price at first signal: $${mem.priceAtFirst?.toFixed(6) || '?'}</i>`;
    }
    if (tier === 'notable') {
      return `⚡🏦 <b>ACCUMULATION BUILDING</b>\n\n` +
        `<b>$${symbol}</b> — Cumulative Score: ${score}\n` +
        `Exchange outflows repeating over <b>${hours} hours</b>\n` +
        `📤 ${mem.totalOutflows} withdrawals across ${mem.scansWithOutflow} scans\n` +
        `🏛 Exchanges: ${exchanges}\n\n` +
        `<i>Outflow pattern is strengthening. Monitor for continuation — if this keeps building, it's a high-conviction setup.</i>`;
    }
    return `👀🏦 <b>EARLY FLOW SIGNAL</b>\n\n` +
      `<b>$${symbol}</b> — Cumulative Score: ${score}\n` +
      `Exchange outflows detected\n` +
      `📤 ${mem.totalOutflows} withdrawals\n` +
      `🏛 Exchanges: ${exchanges}\n\n` +
      `<i>Initial outflow detected. Needs more scans to confirm accumulation pattern.</i>`;
  }

  getTier(score) {
    if (score >= 40) return { icon: '🔥', label: 'SUSTAINED ACCUMULATION — Hours of consistent exchange outflows detected' };
    if (score >= 30) return { icon: '🔥', label: 'HEAVY ACCUMULATION — Smart money loading up across multiple exchanges' };
    if (score >= 20) return { icon: '⚡', label: 'BUILDING PATTERN — Repeated outflows, accumulation strengthening' };
    if (score >= 15) return { icon: '⚡', label: 'NOTABLE OUTFLOW — Exchange withdrawals increasing' };
    if (score >= 10) return { icon: '👀', label: 'EARLY SIGNAL — Some exchange movement, monitoring' };
    return { icon: '📊', label: 'LOW ACTIVITY' };
  }

  mapChain(cgChain) {
    const map = {
      'ethereum': 'ethereum', 'binance-smart-chain': 'bsc', 'polygon-pos': 'polygon',
      'arbitrum-one': 'arbitrum', 'base': 'base', 'optimism': 'optimism',
      'avalanche': 'avalanche', 'robinhood-chain': 'robinhood',
    };
    return map[cgChain] || null;
  }

  getLastScan() {
    return this.lastScan;
  }

  getFlowMemory() {
    const result = {};
    for (const [symbol, mem] of this.flowMemory) {
      result[symbol] = {
        ...mem,
        exchanges: [...mem.exchanges],
        cumulativeScore: this.scoreCumulative(mem),
        durationHours: ((mem.lastSeen - mem.firstSeen) / (60 * 60 * 1000)).toFixed(1),
      };
    }
    return result;
  }
}

module.exports = FlowScanner;
