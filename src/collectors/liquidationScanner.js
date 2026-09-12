const axios = require('axios');
const logger = require('../utils/logger');

class LiquidationScanner {
  constructor(exchanges) {
    this.exchanges = exchanges;
    this.coinglassKey = process.env.COINGLASS_API_KEY || null;
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000;
    // Order book memory — tracks walls across scans to detect persistent vs spoofed
    // key: "pair:exchange" → Map<price → { firstSeen, lastSeen, size, hitCount }>
    this.wallMemory = new Map();
    this.wallMemoryTTL = 2 * 60 * 60 * 1000; // 2h
  }

  async getSetupData(symbol, pair, exchange) {
    const cacheKey = `${pair}:${exchange}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) return cached.data;

    const [orderBook, liqData, largeTrades, liqLevels] = await Promise.all([
      this.getDeepOrderBook(pair, exchange),
      this.getLiquidationData(symbol),
      this.getLargeTrades(pair, exchange),
      this.estimateLiquidationLevels(pair, exchange),
    ]);

    const data = { orderBook, liquidations: liqData, largeTrades, liqLevels };
    this.cache.set(cacheKey, { timestamp: Date.now(), data });
    return data;
  }

  // === DEEP ORDER BOOK — 200 levels, whale order detection ===
  async getDeepOrderBook(pair, exchangeId) {
    const ex = this.exchanges[exchangeId];
    if (!ex) return null;

    try {
      const ob = await ex.fetchOrderBook(pair, 200);
      if (!ob || !ob.bids?.length || !ob.asks?.length) return null;

      const midPrice = (ob.bids[0][0] + ob.asks[0][0]) / 2;

      // Find whale orders (large individual orders)
      const whaleOrders = this.findWhaleOrders(ob, midPrice);

      // Track walls in memory for persistence detection
      this.updateWallMemory(`${pair}:${exchangeId}`, whaleOrders, midPrice);

      // Get persistent walls (seen across multiple scans)
      const persistentWalls = this.getPersistentWalls(`${pair}:${exchangeId}`);

      // Depth analysis
      const bidDepthRaw = ob.bids.reduce((sum, [, size]) => sum + size, 0);
      const askDepthRaw = ob.asks.reduce((sum, [, size]) => sum + size, 0);
      const bidDepth = bidDepthRaw * midPrice;
      const askDepth = askDepthRaw * midPrice;
      const depthRatio = bidDepth / (askDepth || 1);

      // Depth at specific ranges (5%, 10%)
      const bid5pct = ob.bids.filter(([p]) => (midPrice - p) / midPrice <= 0.05)
        .reduce((sum, [p, s]) => sum + p * s, 0);
      const ask5pct = ob.asks.filter(([p]) => (p - midPrice) / midPrice <= 0.05)
        .reduce((sum, [p, s]) => sum + p * s, 0);

      return {
        midPrice,
        whaleOrders,
        persistentWalls,
        bidWalls: whaleOrders.filter(w => w.side === 'bid').slice(0, 3),
        askWalls: whaleOrders.filter(w => w.side === 'ask').slice(0, 3),
        bidDepth,
        askDepth,
        depthRatio,
        bid5pct,
        ask5pct,
        imbalance: depthRatio > 1.5 ? 'buy_heavy' : depthRatio < 0.67 ? 'sell_heavy' : 'balanced',
        imbalance5pct: bid5pct > ask5pct * 1.5 ? 'buy_heavy' : ask5pct > bid5pct * 1.5 ? 'sell_heavy' : 'balanced',
      };
    } catch (err) {
      logger.debug(`Deep order book failed for ${pair}: ${err.message}`);
      return null;
    }
  }

  findWhaleOrders(ob, midPrice) {
    const allOrders = [
      ...ob.bids.map(([price, size]) => ({ price, size, side: 'bid' })),
      ...ob.asks.map(([price, size]) => ({ price, size, side: 'ask' })),
    ];

    // Calculate average order size (excluding outliers)
    const sizes = allOrders.map(o => o.size).sort((a, b) => a - b);
    const p75 = sizes[Math.floor(sizes.length * 0.75)] || 1;
    const normalOrders = allOrders.filter(o => o.size <= p75 * 3);
    const avgSize = normalOrders.reduce((s, o) => s + o.size, 0) / (normalOrders.length || 1);

    const whaleThreshold = Math.max(avgSize * 4, 1);
    const whales = [];

    for (const o of allOrders) {
      const distPct = Math.abs((o.price - midPrice) / midPrice) * 100;
      if (distPct > 15) continue;

      if (o.size >= whaleThreshold) {
        whales.push({
          price: o.price,
          size: o.size,
          usdValue: o.price * o.size,
          distPct: distPct.toFixed(2),
          side: o.side,
          multiple: (o.size / avgSize).toFixed(1),
        });
      }
    }

    return whales.sort((a, b) => b.usdValue - a.usdValue).slice(0, 12);
  }

  // === ORDER BOOK MEMORY — track wall persistence ===
  updateWallMemory(key, whaleOrders, midPrice) {
    if (!this.wallMemory.has(key)) this.wallMemory.set(key, new Map());
    const mem = this.wallMemory.get(key);
    const now = Date.now();

    // Round prices to reduce noise (0.1% buckets)
    const bucket = (price) => {
      const pct = 0.001;
      return Math.round(price / (midPrice * pct)) * (midPrice * pct);
    };

    // Mark current walls as seen
    const currentBuckets = new Set();
    for (const w of whaleOrders) {
      const b = bucket(w.price);
      currentBuckets.add(b);

      const existing = mem.get(b);
      if (existing) {
        existing.lastSeen = now;
        existing.hitCount++;
        existing.latestSize = w.usdValue;
        existing.side = w.side;
      } else {
        mem.set(b, {
          firstSeen: now,
          lastSeen: now,
          hitCount: 1,
          latestSize: w.usdValue,
          side: w.side,
          price: w.price,
        });
      }
    }

    // Expire old entries
    for (const [b, entry] of mem) {
      if (now - entry.lastSeen > this.wallMemoryTTL) {
        mem.delete(b);
      }
    }
  }

  getPersistentWalls(key) {
    const mem = this.wallMemory.get(key);
    if (!mem) return [];

    const persistent = [];
    for (const [, entry] of mem) {
      if (entry.hitCount >= 2) {
        const age = ((Date.now() - entry.firstSeen) / 60000).toFixed(0);
        persistent.push({
          price: entry.price,
          usdValue: entry.latestSize,
          side: entry.side,
          hitCount: entry.hitCount,
          ageMinutes: parseInt(age),
          ageLabel: parseInt(age) >= 60 ? `${(parseInt(age) / 60).toFixed(1)}h` : `${age}m`,
          persistent: true,
        });
      }
    }

    return persistent.sort((a, b) => b.usdValue - a.usdValue).slice(0, 8);
  }

  // === LARGE TRADE DETECTION — spot big market orders ===
  async getLargeTrades(pair, exchangeId) {
    const ex = this.exchanges[exchangeId];
    if (!ex || !ex.has.fetchTrades) return [];

    try {
      const trades = await ex.fetchTrades(pair, undefined, 500);
      if (!trades?.length) return [];

      // Calculate average trade size
      const sizes = trades.map(t => t.cost || t.price * t.amount);
      const avgSize = sizes.reduce((s, v) => s + v, 0) / sizes.length;
      const largeThreshold = Math.max(avgSize * 5, 2000); // 5x avg or $2K minimum

      const largeTrades = [];
      for (const t of trades) {
        const usd = t.cost || t.price * t.amount;
        if (usd >= largeThreshold) {
          largeTrades.push({
            price: t.price,
            amount: t.amount,
            usdValue: usd,
            side: t.side,
            timestamp: t.timestamp,
            ago: this.timeAgo(t.timestamp),
            multiple: (usd / avgSize).toFixed(1),
          });
        }
      }

      return largeTrades.sort((a, b) => b.usdValue - a.usdValue).slice(0, 10);
    } catch (err) {
      logger.debug(`Large trades fetch failed for ${pair}: ${err.message}`);
      return [];
    }
  }

  // === ESTIMATED LIQUIDATION LEVELS ===
  // Calculate where leveraged positions would get liquidated
  async estimateLiquidationLevels(pair, exchangeId) {
    const ex = this.exchanges[exchangeId];
    if (!ex) return null;

    try {
      const ticker = await ex.fetchTicker(pair);
      if (!ticker?.last) return null;

      const price = ticker.last;
      const leverages = [5, 10, 20, 25, 50, 100];
      const levels = [];

      for (const lev of leverages) {
        // Liquidation price ≈ entry * (1 - 1/leverage) for longs
        // Liquidation price ≈ entry * (1 + 1/leverage) for shorts
        const maintenanceMargin = 0.005; // ~0.5% typical
        const longLiqPrice = price * (1 - (1 / lev) + maintenanceMargin);
        const shortLiqPrice = price * (1 + (1 / lev) - maintenanceMargin);

        levels.push({
          leverage: lev,
          longLiqPrice,
          longLiqDist: ((price - longLiqPrice) / price * 100).toFixed(1),
          shortLiqPrice,
          shortLiqDist: ((shortLiqPrice - price) / price * 100).toFixed(1),
        });
      }

      return { price, levels };
    } catch (err) {
      logger.debug(`Liq level estimation failed for ${pair}: ${err.message}`);
      return null;
    }
  }

  // === COINGLASS LIQUIDATION DATA ===
  async getLiquidationData(symbol) {
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
        logger.debug(`Coinglass paid failed for ${symbol}: ${err.message}`);
      }
    }

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
      logger.debug(`Coinglass free failed: ${err.message}`);
    }

    return null;
  }

  // === SETUP SNAPSHOT GENERATION ===
  generateSetupSnapshot(tokenData) {
    const { symbol, score, signals, oiChange4h, fundingRate, fundingBias, priceChange, price, exchangeFlow, setupData } = tokenData;
    const snap = { direction: 'neutral', confidence: 'low', levels: [], thesis: [], risks: [] };

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

    // Order book imbalance affects direction
    if (setupData?.orderBook?.imbalance5pct === 'buy_heavy') bullPoints += 1;
    if (setupData?.orderBook?.imbalance5pct === 'sell_heavy') bearPoints += 1;

    // Large trade bias — only count if whale volume is significant vs market volume
    if (setupData?.largeTrades?.length) {
      const buys = setupData.largeTrades.filter(t => t.side === 'buy');
      const sells = setupData.largeTrades.filter(t => t.side === 'sell');
      const buyVol = buys.reduce((s, t) => s + t.usdValue, 0);
      const sellVol = sells.reduce((s, t) => s + t.usdValue, 0);
      const totalWhaleVol = buyVol + sellVol;
      const marketVol = tokenData.volume || tokenData.quoteVolume || 0;
      // Whale trades must be >0.1% of market volume to influence direction
      const significant = marketVol === 0 || totalWhaleVol > marketVol * 0.001;
      if (significant) {
        if (buyVol > sellVol * 1.5) bullPoints += 2;
        if (buyVol > sellVol * 3) bullPoints += 1;
        if (sellVol > buyVol * 1.5) bearPoints += 2;
        if (sellVol > buyVol * 3) bearPoints += 1;
        if (sells.length >= 5 && buys.length === 0 && totalWhaleVol > 50000) bearPoints += 2;
        if (buys.length >= 5 && sells.length === 0 && totalWhaleVol > 50000) bullPoints += 2;
      }
    }

    if (bullPoints > bearPoints + 1) snap.direction = 'long';
    else if (bearPoints > bullPoints + 1) snap.direction = 'short';

    const totalPoints = bullPoints + bearPoints;
    const dominance = Math.max(bullPoints, bearPoints) / (totalPoints || 1);
    if (score >= 50 && dominance > 0.7) snap.confidence = 'high';
    else if (score >= 30 && dominance > 0.6) snap.confidence = 'medium';
    else snap.confidence = 'low';

    // Key levels
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

    // Large trades thesis
    if (setupData?.largeTrades?.length >= 3) {
      const buys = setupData.largeTrades.filter(t => t.side === 'buy');
      const sells = setupData.largeTrades.filter(t => t.side === 'sell');
      if (buys.length > sells.length * 2) {
        snap.thesis.push(`${buys.length} large whale buys detected → institutional accumulation`);
      } else if (sells.length > buys.length * 2) {
        snap.thesis.push(`${sells.length} large whale sells detected → distribution/dumping`);
      }
    }

    // Persistent walls thesis
    if (setupData?.orderBook?.persistentWalls?.length) {
      const pw = setupData.orderBook.persistentWalls;
      const bidWalls = pw.filter(w => w.side === 'bid');
      const askWalls = pw.filter(w => w.side === 'ask');
      if (bidWalls.length >= 2) {
        snap.thesis.push(`${bidWalls.length} persistent support walls (held ${bidWalls[0].ageLabel}+) → strong floor`);
      }
      if (askWalls.length >= 2) {
        snap.thesis.push(`${askWalls.length} persistent sell walls (held ${askWalls[0].ageLabel}+) → heavy resistance`);
      }
    }

    // Liquidation data
    if (setupData?.liquidations) {
      const liq = setupData.liquidations;
      if (liq.longLiqs > liq.shortLiqs * 2) {
        snap.thesis.push(`Long liquidations dominating ($${(liq.longLiqs / 1e6).toFixed(1)}M) → flush near bottom`);
      } else if (liq.shortLiqs > liq.longLiqs * 2) {
        snap.thesis.push(`Short liquidations dominating ($${(liq.shortLiqs / 1e6).toFixed(1)}M) → squeeze in progress`);
      }
    }

    // Risks
    if (fundingRate > 0.001) snap.risks.push('Extreme positive funding — crowded long, squeeze risk');
    if (fundingRate < -0.001) snap.risks.push('Extreme negative funding — crowded short');
    if (setupData?.orderBook?.imbalance === 'sell_heavy') snap.risks.push('Heavy sell-side order book — resistance overhead');
    if (setupData?.orderBook?.imbalance === 'buy_heavy') snap.risks.push('Thin sell side — fast moves but reversals likely');

    if (!snap.thesis.length) {
      snap.thesis.push('Mixed signals — no clear directional bias yet');
    }

    return snap;
  }

  // === TEXT FORMATTING ===
  formatSnapshot(snap, symbol) {
    const dirEmoji = snap.direction === 'long' ? '🟢 LONG BIAS' : snap.direction === 'short' ? '🔴 SHORT BIAS' : '🟡 NEUTRAL';
    const confEmoji = snap.confidence === 'high' ? '🔥' : snap.confidence === 'medium' ? '⚡' : '👀';

    let msg = `\n   📸 <b>SETUP SNAPSHOT</b>\n`;
    msg += `   ${dirEmoji} | Confidence: ${confEmoji} ${snap.confidence.toUpperCase()}\n`;

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

  formatFlowSnapshot(tokenData) {
    const { symbol, flow, memory, priceChange, flowScore, setupData } = tokenData;
    const snap = { direction: 'neutral', confidence: 'low', thesis: [], risks: [] };

    if (flow.outflowCount > flow.inflowCount && flow.outflowCount >= 3) {
      snap.direction = 'long';
      snap.thesis.push(`${flow.outflowCount} withdrawals vs ${flow.inflowCount} deposits → accumulation`);
    } else if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 3) {
      snap.direction = 'short';
      snap.thesis.push(`${flow.inflowCount} deposits vs ${flow.outflowCount} withdrawals → sell pressure`);
    }

    if (memory) {
      if (memory.scansWithOutflow >= 5) {
        snap.confidence = 'high';
        snap.thesis.push(`Sustained outflows over ${((memory.lastSeen - memory.firstSeen) / 3600000).toFixed(1)}h — high conviction`);
      } else if (memory.scansWithOutflow >= 3) {
        snap.confidence = 'medium';
        snap.thesis.push('Repeated outflows building — pattern strengthening');
      }
      if (memory.exchanges?.size >= 3) {
        snap.thesis.push(`Outflows from ${memory.exchanges.size} exchanges — broad-based`);
      }
      if (memory.priceAtFirst && memory.currentPrice) {
        const priceDelta = ((memory.currentPrice - memory.priceAtFirst) / memory.priceAtFirst * 100);
        if (priceDelta < -5 && snap.direction === 'long') {
          snap.thesis.push(`Price down ${priceDelta.toFixed(1)}% since first signal — buying the dip`);
        } else if (priceDelta > 10 && snap.direction === 'long') {
          snap.risks.push(`Price already up ${priceDelta.toFixed(1)}% — late entry risk`);
        }
      }
    }

    // Large trades from setup data
    if (setupData?.largeTrades?.length >= 2) {
      const buys = setupData.largeTrades.filter(t => t.side === 'buy');
      const sells = setupData.largeTrades.filter(t => t.side === 'sell');
      if (buys.length > sells.length) {
        snap.thesis.push(`${buys.length} large whale buys confirming accumulation`);
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

  // === WHALE ORDER TEXT FORMAT (like Arslan's panel) ===
  formatWhaleOrders(setupData, symbol) {
    if (!setupData?.orderBook?.whaleOrders?.length && !setupData?.largeTrades?.length) return '';

    let msg = `\n   🐋 <b>WHALE ACTIVITY</b>\n`;

    // Whale orders (resting limit orders)
    const whales = setupData.orderBook?.whaleOrders || [];
    if (whales.length) {
      const bids = whales.filter(w => w.side === 'bid').slice(0, 4);
      const asks = whales.filter(w => w.side === 'ask').slice(0, 4);

      if (asks.length) {
        msg += `   <b>Sell walls (resistance):</b>\n`;
        for (const w of asks) {
          const usd = w.usdValue >= 1e6 ? `$${(w.usdValue / 1e6).toFixed(1)}M` : `$${(w.usdValue / 1e3).toFixed(0)}K`;
          msg += `      🔴 $${w.price >= 1 ? w.price.toFixed(2) : w.price.toPrecision(4)} — ${usd} (${w.multiple}x avg)\n`;
        }
      }
      if (bids.length) {
        msg += `   <b>Buy walls (support):</b>\n`;
        for (const w of bids) {
          const usd = w.usdValue >= 1e6 ? `$${(w.usdValue / 1e6).toFixed(1)}M` : `$${(w.usdValue / 1e3).toFixed(0)}K`;
          msg += `      🟢 $${w.price >= 1 ? w.price.toFixed(2) : w.price.toPrecision(4)} — ${usd} (${w.multiple}x avg)\n`;
        }
      }
    }

    // Persistent walls
    const persistent = setupData.orderBook?.persistentWalls || [];
    if (persistent.length) {
      msg += `   <b>Persistent walls (held across scans):</b>\n`;
      for (const w of persistent.slice(0, 4)) {
        const icon = w.side === 'bid' ? '🟢' : '🔴';
        const usd = w.usdValue >= 1e6 ? `$${(w.usdValue / 1e6).toFixed(1)}M` : `$${(w.usdValue / 1e3).toFixed(0)}K`;
        msg += `      ${icon} $${w.price >= 1 ? w.price.toFixed(2) : w.price.toPrecision(4)} — ${usd} | Seen ${w.hitCount}x over ${w.ageLabel}\n`;
      }
    }

    // Large trades
    const trades = setupData.largeTrades || [];
    if (trades.length) {
      msg += `   <b>Large trades (recent):</b>\n`;
      for (const t of trades.slice(0, 4)) {
        const icon = t.side === 'buy' ? '🟢 BUY' : '🔴 SELL';
        const usd = t.usdValue >= 1e6 ? `$${(t.usdValue / 1e6).toFixed(1)}M` : `$${(t.usdValue / 1e3).toFixed(0)}K`;
        msg += `      ${icon} ${usd} @ $${t.price >= 1 ? t.price.toFixed(2) : t.price.toPrecision(4)} (${t.multiple}x avg) ${t.ago}\n`;
      }
    }

    return msg;
  }

  // === LIQUIDATION LEVELS TEXT FORMAT ===
  formatLiqLevels(setupData) {
    if (!setupData?.liqLevels) return '';

    const ll = setupData.liqLevels;
    let msg = `   ⚡ <b>Estimated Liquidation Zones:</b>\n`;

    // Show key leverage levels
    const keyLevels = ll.levels.filter(l => [10, 25, 50].includes(l.leverage));
    for (const l of keyLevels) {
      msg += `      ${l.leverage}x: Longs liq @ $${formatP(l.longLiqPrice)} (-${l.longLiqDist}%) | Shorts liq @ $${formatP(l.shortLiqPrice)} (+${l.shortLiqDist}%)\n`;
    }

    return msg;
  }

  timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${(diff / 3600000).toFixed(1)}h ago`;
  }
}

function formatP(p) {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toPrecision(4);
}

module.exports = LiquidationScanner;
