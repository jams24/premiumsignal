const logger = require('../utils/logger');

class FlowScanner {
  constructor(exchanges, onchainTracker) {
    this.exchanges = exchanges;
    this.tracker = onchainTracker;
    this.lastScan = null;
    this.resolvedTokens = new Map(); // symbol → { address, chain } or null (skip)
    this.scanHistory = new Map(); // symbol → { timestamp, flow }
  }

  async scan() {
    const results = [];

    // Collect all perp tokens across exchanges
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

    // Sort by volume, take top 30 (balance coverage vs rate limits)
    const tokens = [...allSymbols.values()]
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 30);

    logger.info(`FlowScanner: checking ${tokens.length} perp tokens for exchange flows`);

    for (const token of tokens) {
      try {
        // Skip if recently scanned (15 min cooldown per token)
        const history = this.scanHistory.get(token.symbol);
        if (history && Date.now() - history.timestamp < 15 * 60 * 1000) {
          if (history.flow) results.push({ ...token, flow: history.flow });
          continue;
        }

        // Resolve contract address (cached 24h in tracker)
        let resolved = this.resolvedTokens.get(token.symbol);
        if (resolved === undefined) {
          resolved = await this.tracker.resolveContractAddress(token.symbol);
          this.resolvedTokens.set(token.symbol, resolved || null);
          // CoinGecko rate limit
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

        if (flow && (flow.outflowCount >= 3 || flow.inflowCount >= 3)) {
          results.push({ ...token, flow });
        }

        // Rate limit between Etherscan/RPC calls
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        logger.debug(`FlowScanner: ${token.symbol} failed: ${err.message}`);
      }
    }

    // Score and sort: outflow-heavy tokens first
    for (const r of results) {
      r.flowScore = this.scoreFlow(r.flow);
    }
    results.sort((a, b) => b.flowScore - a.flowScore);

    this.lastScan = { timestamp: Date.now(), count: results.length, results: results.slice(0, 10) };
    logger.info(`FlowScanner: ${results.length} tokens with significant flows`);

    return results;
  }

  scoreFlow(flow) {
    if (!flow) return 0;
    let score = 0;

    // Outflow scoring (bullish accumulation)
    if (flow.outflowCount >= 8) score += 30;
    else if (flow.outflowCount >= 5) score += 20;
    else if (flow.outflowCount >= 3) score += 10;

    // Net outflow bonus
    if (flow.netFlow > 0 && flow.outflowCount > flow.inflowCount) score += 10;

    // Multiple exchanges = stronger signal
    if (flow.exchanges.length >= 3) score += 10;
    else if (flow.exchanges.length >= 2) score += 5;

    // Inflow warning (bearish)
    if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 5) score -= 10;

    return score;
  }

  formatAlerts(results, limit = 5) {
    const top = results.filter(r => r.flowScore >= 10).slice(0, limit);
    if (!top.length) return null;

    let msg = '🏦 <b>EXCHANGE FLOW SCANNER</b>\n';
    msg += '<i>Detects tokens leaving/entering CEX wallets — exchange outflows signal accumulation before pumps (the Flams edge).</i>\n\n';

    for (const r of top) {
      const f = r.flow;
      const tier = this.getTier(r.flowScore);
      const arrow = f.bias === 'bullish' ? '🟢' : f.bias === 'bearish' ? '🔴' : '🔄';

      msg += `${arrow} <b>${r.symbol}</b> — Flow Score: ${r.flowScore} ${tier.icon}\n`;
      msg += `   <b>${tier.label}</b>\n`;
      msg += `   💰 Price: ${r.priceChange >= 0 ? '+' : ''}${r.priceChange.toFixed(1)}% | Vol: $${(r.volume / 1e6).toFixed(1)}M\n`;

      if (f.outflowCount > 0) {
        msg += `   📤 Withdrawals: ${f.outflowCount} from ${f.exchanges.join(', ') || 'unknown'}\n`;
        if (f.outflowCount >= 5) {
          msg += `      <i>Heavy accumulation — tokens being moved to cold storage. Sell-side supply shrinking. This is the signal Flams catches before big moves.</i>\n`;
        } else {
          msg += `      <i>Moderate accumulation — worth monitoring for continuation.</i>\n`;
        }
      }
      if (f.inflowCount > 0) {
        msg += `   📥 Deposits: ${f.inflowCount} to exchanges\n`;
        if (f.inflowCount > f.outflowCount) {
          msg += `      <i>More tokens entering exchanges than leaving — potential sell pressure. Be cautious on longs.</i>\n`;
        }
      }

      msg += `   📊 Chain: ${f.chain} | ${r.exchange.toUpperCase()}\n\n`;
    }

    msg += '━━━━━━━━━━━━━━━━━━━━\n';
    msg += '<b>How to read this:</b>\n';
    msg += '📤 <b>Outflow</b> = Tokens LEAVING exchanges → Accumulation (bullish)\n';
    msg += '📥 <b>Inflow</b> = Tokens ENTERING exchanges → Sell pressure (bearish)\n';
    msg += '🟢 <b>Net outflow</b> = More leaving than entering → Supply squeeze incoming\n';
    msg += '🔴 <b>Net inflow</b> = More entering than leaving → Dumping risk\n\n';
    msg += '<b>Score Guide:</b>\n';
    msg += '🔥 30+ = Heavy accumulation across multiple exchanges\n';
    msg += '⚡ 15-29 = Notable outflow pattern forming\n';
    msg += '👀 10-14 = Early flow signal — watch for follow-through\n';
    msg += `\n<i>${new Date().toUTCString().slice(0, -4)}</i>`;

    return msg;
  }

  getTier(score) {
    if (score >= 30) return { icon: '🔥', label: 'HEAVY ACCUMULATION — Smart money loading up across multiple exchanges' };
    if (score >= 15) return { icon: '⚡', label: 'NOTABLE OUTFLOW — Exchange withdrawals increasing, accumulation pattern forming' };
    if (score >= 10) return { icon: '👀', label: 'EARLY SIGNAL — Some exchange movement detected, monitor for continuation' };
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
}

module.exports = FlowScanner;
