const axios = require('axios');
const logger = require('../utils/logger');

class LiquidationScanner {
  constructor(exchanges) {
    this.exchanges = exchanges;
    this.coinglassKey = process.env.COINGLASS_API_KEY || null;
    this.cache = new Map(); // symbol → { timestamp, data }
    this.cacheTTL = 5 * 60 * 1000;
  }

  async getSetupData(symbol, pair, exchange) {
    const cacheKey = `${pair}:${exchange}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) return cached.data;

    const [orderBook, liqData] = await Promise.all([
      this.getOrderBookDepth(pair, exchange),
      this.getLiquidationLevels(symbol),
    ]);

    const data = { orderBook, liquidations: liqData };
    this.cache.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  }

  async getOrderBookDepth(pair, exchangeId) {
    const ex = this.exchanges[exchangeId];
    if (!ex) return null;

    try {
      const ob = await ex.fetchOrderBook(pair, 50);
      if (!ob || !ob.bids?.length || !ob.asks?.length) return null;

      const midPrice = (ob.bids[0][0] + ob.asks[0][0]) / 2;

      const bidWalls = this.findWalls(ob.bids, midPrice, 'bid');
      const askWalls = this.findWalls(ob.asks, midPrice, 'ask');

      const bidDepth = ob.bids.reduce((sum, [, size]) => sum + size, 0);
      const askDepth = ob.asks.reduce((sum, [, size]) => sum + size, 0);
      const depthRatio = bidDepth / (askDepth || 1);

      return {
        midPrice,
        bidWalls,
        askWalls,
        bidDepth: bidDepth * midPrice,
        askDepth: askDepth * midPrice,
        depthRatio,
        imbalance: depthRatio > 1.5 ? 'buy_heavy' : depthRatio < 0.67 ? 'sell_heavy' : 'balanced',
      };
    } catch (err) {
      logger.debug(`Order book fetch failed for ${pair}: ${err.message}`);
      return null;
    }
  }

  findWalls(orders, midPrice, side) {
    if (!orders.length) return [];

    const totalSize = orders.reduce((sum, [, size]) => sum + size, 0);
    const avgSize = totalSize / orders.length;
    const threshold = avgSize * 4;

    const walls = [];
    for (const [price, size] of orders) {
      const distPct = Math.abs((price - midPrice) / midPrice) * 100;
      if (distPct > 10) break;

      if (size >= threshold) {
        walls.push({
          price,
          size,
          usdValue: price * size,
          distPct: distPct.toFixed(2),
          side,
          multiple: (size / avgSize).toFixed(1),
        });
      }
    }

    return walls.sort((a, b) => b.usdValue - a.usdValue).slice(0, 3);
  }

  async getLiquidationLevels(symbol) {
    // Coinglass paid API for liquidation heatmap
    if (this.coinglassKey) {
      try {
        const { data } = await axios.get('https://open-api-v3.coinglass.com/api/futures/liquidation/info', {
          params: { symbol: symbol.replace('USDT', ''), interval: 'h4' },
          headers: { 'coinglassSecret': this.coinglassKey },
          timeout: 8000,
        });

        if (data?.data) {
          return {
            source: 'coinglass',
            longLiqs: data.data.longVolUsd || 0,
            shortLiqs: data.data.shortVolUsd || 0,
            totalLiqs: (data.data.longVolUsd || 0) + (data.data.shortVolUsd || 0),
            ratio: data.data.longRate || 0.5,
          };
        }
      } catch (err) {
        logger.debug(`Coinglass liquidation fetch failed for ${symbol}: ${err.message}`);
      }
    }

    // Free Coinglass fallback — aggregate data
    try {
      const { data } = await axios.get('https://open-api.coinglass.com/public/v2/liquidation/info', {
        params: { time_type: 1, symbol: symbol.replace('USDT', '') },
        headers: { accept: 'application/json' },
        timeout: 8000,
      });

      if (data?.data?.length) {
        const item = data.data[0];
        return {
          source: 'coinglass_free',
          longLiqs: item.longVolUsd || 0,
          shortLiqs: item.shortVolUsd || 0,
          totalLiqs: (item.longVolUsd || 0) + (item.shortVolUsd || 0),
          ratio: item.longRate || 0.5,
        };
      }
    } catch (err) {
      logger.debug(`Coinglass free liquidation failed: ${err.message}`);
    }

    return null;
  }

  generateSetupSnapshot(tokenData) {
    const { symbol, score, signals, oiChange4h, fundingRate, fundingBias, priceChange, price, exchangeFlow, setupData } = tokenData;

    const snap = { direction: 'neutral', confidence: 'low', levels: [], thesis: [], risks: [] };

    // Determine direction from combined signals
    let bullPoints = 0;
    let bearPoints = 0;

    if (oiChange4h > 15) bullPoints += 2;
    if (oiChange4h > 25) bullPoints += 1;
    if (oiChange4h < -15) bearPoints += 2;

    if (fundingRate > 0.0003) bullPoints += 1;
    if (fundingRate > 0.001) bullPoints += 1;
    if (fundingRate < -0.0003) bearPoints += 1;
    if (fundingRate < -0.001) bearPoints += 1;

    if (priceChange > 3) bullPoints += 1;
    if (priceChange < -3) bearPoints += 1;

    if (exchangeFlow) {
      if (exchangeFlow.outflowCount > exchangeFlow.inflowCount) bullPoints += 2;
      if (exchangeFlow.inflowCount > exchangeFlow.outflowCount) bearPoints += 2;
    }

    if (bullPoints > bearPoints + 1) snap.direction = 'long';
    else if (bearPoints > bullPoints + 1) snap.direction = 'short';
    else snap.direction = 'neutral';

    // Confidence
    const totalPoints = bullPoints + bearPoints;
    const dominance = Math.max(bullPoints, bearPoints) / (totalPoints || 1);
    if (score >= 50 && dominance > 0.7) snap.confidence = 'high';
    else if (score >= 30 && dominance > 0.6) snap.confidence = 'medium';
    else snap.confidence = 'low';

    // Key levels from order book
    if (setupData?.orderBook) {
      const ob = setupData.orderBook;
      for (const w of ob.bidWalls || []) {
        snap.levels.push({ type: 'support', price: w.price, usd: w.usdValue, dist: w.distPct });
      }
      for (const w of ob.askWalls || []) {
        snap.levels.push({ type: 'resistance', price: w.price, usd: w.usdValue, dist: w.distPct });
      }
    }

    // Thesis
    if (oiChange4h > 20 && Math.abs(priceChange) < 3) {
      snap.thesis.push('OI building without price move → accumulation before breakout');
    }
    if (oiChange4h > 15 && priceChange > 3 && fundingRate > 0) {
      snap.thesis.push('OI + price + funding aligned → strong momentum continuation');
    }
    if (oiChange4h > 15 && priceChange < -3 && fundingRate < 0) {
      snap.thesis.push('Shorts piling in with rising OI → squeeze setup');
    }
    if (exchangeFlow?.outflowCount >= 3) {
      snap.thesis.push('Exchange outflows → smart money accumulating off-exchange');
    }
    if (exchangeFlow?.inflowCount >= 5) {
      snap.thesis.push('Heavy exchange inflows → potential sell pressure incoming');
    }

    // Liquidation data
    if (setupData?.liquidations) {
      const liq = setupData.liquidations;
      if (liq.longLiqs > liq.shortLiqs * 2) {
        snap.thesis.push(`Long liquidations dominating ($${(liq.longLiqs / 1e6).toFixed(1)}M) → flush could be near bottom`);
      } else if (liq.shortLiqs > liq.longLiqs * 2) {
        snap.thesis.push(`Short liquidations dominating ($${(liq.shortLiqs / 1e6).toFixed(1)}M) → squeeze in progress`);
      }
    }

    // Risks
    if (fundingRate > 0.001) snap.risks.push('Extreme positive funding — crowded long, squeeze risk');
    if (fundingRate < -0.001) snap.risks.push('Extreme negative funding — crowded short');
    if (setupData?.orderBook?.imbalance === 'sell_heavy') snap.risks.push('Heavy sell-side order book — resistance overhead');
    if (setupData?.orderBook?.imbalance === 'buy_heavy') snap.risks.push('Thin sell side — could move fast but also reverse fast');

    if (!snap.thesis.length) {
      snap.thesis.push('Mixed signals — no clear directional bias yet');
    }

    return snap;
  }

  formatSnapshot(snap, symbol) {
    const dirEmoji = snap.direction === 'long' ? '🟢 LONG BIAS' : snap.direction === 'short' ? '🔴 SHORT BIAS' : '🟡 NEUTRAL';
    const confEmoji = snap.confidence === 'high' ? '🔥' : snap.confidence === 'medium' ? '⚡' : '👀';

    let msg = `\n   📸 <b>SETUP SNAPSHOT</b>\n`;
    msg += `   ${dirEmoji} | Confidence: ${confEmoji} ${snap.confidence.toUpperCase()}\n`;

    // Key levels
    const supports = snap.levels.filter(l => l.type === 'support');
    const resistances = snap.levels.filter(l => l.type === 'resistance');
    if (supports.length || resistances.length) {
      msg += `   📍 <b>Key Levels:</b>\n`;
      for (const s of supports.slice(0, 2)) {
        const usd = s.usd >= 1e6 ? `$${(s.usd / 1e6).toFixed(1)}M` : `$${(s.usd / 1e3).toFixed(0)}K`;
        msg += `      🟢 Support: $${s.price >= 1 ? s.price.toFixed(2) : s.price.toPrecision(4)} (${usd} wall, ${s.dist}% below)\n`;
      }
      for (const r of resistances.slice(0, 2)) {
        const usd = r.usd >= 1e6 ? `$${(r.usd / 1e6).toFixed(1)}M` : `$${(r.usd / 1e3).toFixed(0)}K`;
        msg += `      🔴 Resistance: $${r.price >= 1 ? r.price.toFixed(2) : r.price.toPrecision(4)} (${usd} wall, ${r.dist}% above)\n`;
      }
    }

    // Thesis
    msg += `   📝 <b>Thesis:</b>\n`;
    for (const t of snap.thesis.slice(0, 3)) {
      msg += `      • ${t}\n`;
    }

    // Risks
    if (snap.risks.length) {
      msg += `   ⚠️ <b>Risks:</b>\n`;
      for (const r of snap.risks.slice(0, 2)) {
        msg += `      • ${r}\n`;
      }
    }

    return msg;
  }

  formatFlowSnapshot(tokenData) {
    const { symbol, flow, memory, priceChange, flowScore } = tokenData;

    const snap = { direction: 'neutral', confidence: 'low', thesis: [], risks: [] };

    if (flow.outflowCount > flow.inflowCount && flow.outflowCount >= 3) {
      snap.direction = 'long';
      snap.thesis.push(`${flow.outflowCount} exchange withdrawals vs ${flow.inflowCount} deposits → accumulation`);
    } else if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 3) {
      snap.direction = 'short';
      snap.thesis.push(`${flow.inflowCount} deposits vs ${flow.outflowCount} withdrawals → sell pressure incoming`);
    }

    if (memory) {
      if (memory.scansWithOutflow >= 5) {
        snap.confidence = 'high';
        snap.thesis.push(`Sustained outflows over ${((memory.lastSeen - memory.firstSeen) / 3600000).toFixed(1)}h — high conviction accumulation`);
      } else if (memory.scansWithOutflow >= 3) {
        snap.confidence = 'medium';
        snap.thesis.push('Repeated outflows building — pattern strengthening');
      } else {
        snap.confidence = 'low';
      }

      if (memory.exchanges?.size >= 3) {
        snap.thesis.push(`Outflows from ${memory.exchanges.size} exchanges — broad-based accumulation`);
      }

      if (memory.priceAtFirst && memory.currentPrice) {
        const priceDelta = ((memory.currentPrice - memory.priceAtFirst) / memory.priceAtFirst * 100);
        if (priceDelta < -5 && snap.direction === 'long') {
          snap.thesis.push(`Price down ${priceDelta.toFixed(1)}% since first signal — accumulation at lower prices`);
        } else if (priceDelta > 10 && snap.direction === 'long') {
          snap.risks.push(`Price already up ${priceDelta.toFixed(1)}% since first signal — late entry risk`);
        }
      }
    }

    if (flow.inflowCount > 0 && flow.outflowCount > 0) {
      snap.risks.push('Mixed flow — both inflows and outflows detected');
    }

    if (!snap.thesis.length) {
      snap.thesis.push('Monitoring flow pattern — needs more data');
    }

    const dirEmoji = snap.direction === 'long' ? '🟢 LONG BIAS' : snap.direction === 'short' ? '🔴 SHORT BIAS' : '🟡 NEUTRAL';
    const confEmoji = snap.confidence === 'high' ? '🔥' : snap.confidence === 'medium' ? '⚡' : '👀';

    let msg = `\n   📸 <b>SETUP SNAPSHOT</b>\n`;
    msg += `   ${dirEmoji} | Confidence: ${confEmoji} ${snap.confidence.toUpperCase()}\n`;
    msg += `   📝 <b>Thesis:</b>\n`;
    for (const t of snap.thesis.slice(0, 3)) {
      msg += `      • ${t}\n`;
    }
    if (snap.risks.length) {
      msg += `   ⚠️ <b>Risks:</b>\n`;
      for (const r of snap.risks.slice(0, 2)) {
        msg += `      • ${r}\n`;
      }
    }

    return msg;
  }
}

module.exports = LiquidationScanner;
