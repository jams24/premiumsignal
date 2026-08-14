const logger = require('../utils/logger');

class SMCAnalyzer {
  // Detect swing highs and swing lows from OHLCV candles
  // A swing high = candle whose high is higher than N candles on each side
  // A swing low = candle whose low is lower than N candles on each side
  findSwingPoints(ohlcv, lookback = 3) {
    const swingHighs = [];
    const swingLows = [];

    for (let i = lookback; i < ohlcv.length - lookback; i++) {
      const high = ohlcv[i][2];
      const low = ohlcv[i][3];
      let isSwingHigh = true;
      let isSwingLow = true;

      for (let j = 1; j <= lookback; j++) {
        if (ohlcv[i - j][2] >= high || ohlcv[i + j][2] >= high) isSwingHigh = false;
        if (ohlcv[i - j][3] <= low || ohlcv[i + j][3] <= low) isSwingLow = false;
      }

      if (isSwingHigh) swingHighs.push({ index: i, price: high, time: ohlcv[i][0] });
      if (isSwingLow) swingLows.push({ index: i, price: low, time: ohlcv[i][0] });
    }

    return { swingHighs, swingLows };
  }

  // BOS = Break of Structure
  // Bullish BOS: price breaks above the most recent swing high (trend continuation)
  // Bearish BOS: price breaks below the most recent swing low
  detectBOS(ohlcv, swingHighs, swingLows) {
    const events = [];
    if (ohlcv.length < 5) return events;

    const currentPrice = ohlcv[ohlcv.length - 1][4];
    const recentCandles = ohlcv.slice(-5);

    // Check bullish BOS: did any of the last 5 candles break above the most recent swing high?
    if (swingHighs.length >= 1) {
      const lastSH = swingHighs[swingHighs.length - 1];
      for (const candle of recentCandles) {
        if (candle[2] > lastSH.price && candle[0] > lastSH.time) {
          events.push({
            type: 'BOS_BULLISH',
            level: lastSH.price,
            breakPrice: candle[2],
            description: `Bullish BOS — broke above swing high $${lastSH.price.toPrecision(6)}`,
          });
          break;
        }
      }
    }

    // Check bearish BOS
    if (swingLows.length >= 1) {
      const lastSL = swingLows[swingLows.length - 1];
      for (const candle of recentCandles) {
        if (candle[3] < lastSL.price && candle[0] > lastSL.time) {
          events.push({
            type: 'BOS_BEARISH',
            level: lastSL.price,
            breakPrice: candle[3],
            description: `Bearish BOS — broke below swing low $${lastSL.price.toPrecision(6)}`,
          });
          break;
        }
      }
    }

    return events;
  }

  // ChoCH = Change of Character (trend reversal signal)
  // Bullish ChoCH: in a downtrend (lower lows), price breaks above the last swing high → reversal
  // Bearish ChoCH: in an uptrend (higher highs), price breaks below the last swing low → reversal
  detectChoCH(ohlcv, swingHighs, swingLows) {
    const events = [];

    // Need at least 2 swing points to determine trend
    if (swingHighs.length < 2 || swingLows.length < 2) return events;

    const currentPrice = ohlcv[ohlcv.length - 1][4];

    // Check for downtrend: last 2 swing lows making lower lows
    const lastTwoSL = swingLows.slice(-2);
    const isDowntrend = lastTwoSL[1].price < lastTwoSL[0].price;

    // Check for uptrend: last 2 swing highs making higher highs
    const lastTwoSH = swingHighs.slice(-2);
    const isUptrend = lastTwoSH[1].price > lastTwoSH[0].price;

    // Bullish ChoCH: was in downtrend, now breaking above last swing high
    if (isDowntrend) {
      const lastSH = swingHighs[swingHighs.length - 1];
      if (currentPrice > lastSH.price) {
        events.push({
          type: 'CHOCH_BULLISH',
          level: lastSH.price,
          description: `Bullish ChoCH — downtrend broken, price above swing high $${lastSH.price.toPrecision(6)}`,
        });
      }
    }

    // Bearish ChoCH: was in uptrend, now breaking below last swing low
    if (isUptrend) {
      const lastSL = swingLows[swingLows.length - 1];
      if (currentPrice < lastSL.price) {
        events.push({
          type: 'CHOCH_BEARISH',
          level: lastSL.price,
          description: `Bearish ChoCH — uptrend broken, price below swing low $${lastSL.price.toPrecision(6)}`,
        });
      }
    }

    return events;
  }

  // Order Blocks: the last opposing candle before a strong move (BOS)
  // Bullish OB = last bearish (red) candle before a bullish BOS → demand zone
  // Bearish OB = last bullish (green) candle before a bearish BOS → supply zone
  findOrderBlocks(ohlcv, bosEvents) {
    const orderBlocks = [];

    for (const bos of bosEvents) {
      // Find the candle index where BOS occurred
      let bosIndex = -1;
      for (let i = ohlcv.length - 1; i >= 0; i--) {
        if (bos.type === 'BOS_BULLISH' && ohlcv[i][2] >= bos.breakPrice) {
          bosIndex = i;
          break;
        }
        if (bos.type === 'BOS_BEARISH' && ohlcv[i][3] <= bos.breakPrice) {
          bosIndex = i;
          break;
        }
      }

      if (bosIndex < 1) continue;

      if (bos.type === 'BOS_BULLISH') {
        // Find last bearish candle before the BOS move
        for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 10); i--) {
          const open = ohlcv[i][1];
          const close = ohlcv[i][4];
          if (close < open) {
            orderBlocks.push({
              type: 'OB_BULLISH',
              high: ohlcv[i][2],
              low: ohlcv[i][3],
              open,
              close,
              time: ohlcv[i][0],
              description: `Bullish OB (demand) zone: $${ohlcv[i][3].toPrecision(6)} — $${ohlcv[i][2].toPrecision(6)}`,
            });
            break;
          }
        }
      }

      if (bos.type === 'BOS_BEARISH') {
        // Find last bullish candle before the BOS move
        for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 10); i--) {
          const open = ohlcv[i][1];
          const close = ohlcv[i][4];
          if (close > open) {
            orderBlocks.push({
              type: 'OB_BEARISH',
              high: ohlcv[i][2],
              low: ohlcv[i][3],
              open,
              close,
              time: ohlcv[i][0],
              description: `Bearish OB (supply) zone: $${ohlcv[i][3].toPrecision(6)} — $${ohlcv[i][2].toPrecision(6)}`,
            });
            break;
          }
        }
      }
    }

    return orderBlocks;
  }

  // FVG = Fair Value Gap (imbalance in price)
  // Bullish FVG: candle[i-1].high < candle[i+1].low → gap up (price should return to fill)
  // Bearish FVG: candle[i-1].low > candle[i+1].high → gap down
  findFVGs(ohlcv) {
    const fvgs = [];
    const currentPrice = ohlcv[ohlcv.length - 1][4];

    // Only look at recent candles (last 30) for relevance
    const start = Math.max(1, ohlcv.length - 30);

    for (let i = start; i < ohlcv.length - 1; i++) {
      const prevHigh = ohlcv[i - 1][2];
      const prevLow = ohlcv[i - 1][3];
      const nextHigh = ohlcv[i + 1][2];
      const nextLow = ohlcv[i + 1][3];

      // Bullish FVG: gap between prev candle high and next candle low
      if (nextLow > prevHigh) {
        const gapSize = nextLow - prevHigh;
        const gapPct = (gapSize / prevHigh) * 100;
        if (gapPct > 0.2) {
          fvgs.push({
            type: 'FVG_BULLISH',
            top: nextLow,
            bottom: prevHigh,
            midpoint: (nextLow + prevHigh) / 2,
            gapPct,
            time: ohlcv[i][0],
            filled: currentPrice <= prevHigh,
            description: `Bullish FVG: $${prevHigh.toPrecision(6)} — $${nextLow.toPrecision(6)} (${gapPct.toFixed(2)}%)`,
          });
        }
      }

      // Bearish FVG: gap between prev candle low and next candle high
      if (prevLow > nextHigh) {
        const gapSize = prevLow - nextHigh;
        const gapPct = (gapSize / nextHigh) * 100;
        if (gapPct > 0.2) {
          fvgs.push({
            type: 'FVG_BEARISH',
            top: prevLow,
            bottom: nextHigh,
            midpoint: (prevLow + nextHigh) / 2,
            gapPct,
            time: ohlcv[i][0],
            filled: currentPrice >= prevLow,
            description: `Bearish FVG: $${nextHigh.toPrecision(6)} — $${prevLow.toPrecision(6)} (${gapPct.toFixed(2)}%)`,
          });
        }
      }
    }

    // Return unfilled FVGs sorted by recency, most recent first
    return fvgs.filter(f => !f.filled).slice(-5);
  }

  // Determine market structure bias from swing points
  getStructureBias(swingHighs, swingLows) {
    if (swingHighs.length < 2 || swingLows.length < 2) return 'neutral';

    const lastTwoSH = swingHighs.slice(-2);
    const lastTwoSL = swingLows.slice(-2);
    const higherHighs = lastTwoSH[1].price > lastTwoSH[0].price;
    const higherLows = lastTwoSL[1].price > lastTwoSL[0].price;
    const lowerHighs = lastTwoSH[1].price < lastTwoSH[0].price;
    const lowerLows = lastTwoSL[1].price < lastTwoSL[0].price;

    if (higherHighs && higherLows) return 'bullish';
    if (lowerHighs && lowerLows) return 'bearish';
    return 'neutral';
  }

  // Full SMC analysis on OHLCV data
  analyze(ohlcv) {
    if (!ohlcv || ohlcv.length < 20) return null;

    try {
      const { swingHighs, swingLows } = this.findSwingPoints(ohlcv);
      const bosEvents = this.detectBOS(ohlcv, swingHighs, swingLows);
      const chochEvents = this.detectChoCH(ohlcv, swingHighs, swingLows);
      const orderBlocks = this.findOrderBlocks(ohlcv, bosEvents);
      const fvgs = this.findFVGs(ohlcv);
      const structureBias = this.getStructureBias(swingHighs, swingLows);

      const signals = [];
      let score = 0;

      // BOS adds confidence to trend continuation
      for (const bos of bosEvents) {
        signals.push(bos.description);
        score += 10;
      }

      // ChoCH is a strong reversal signal
      for (const choch of chochEvents) {
        signals.push(choch.description);
        score += 15;
      }

      // Order blocks near current price are high-value zones
      const currentPrice = ohlcv[ohlcv.length - 1][4];
      for (const ob of orderBlocks) {
        const distPct = Math.abs(currentPrice - ob.low) / currentPrice * 100;
        if (distPct < 5) {
          signals.push(ob.description);
          score += 10;
        }
      }

      // Unfilled FVGs near current price
      for (const fvg of fvgs) {
        const distPct = Math.abs(currentPrice - fvg.midpoint) / currentPrice * 100;
        if (distPct < 3) {
          signals.push(fvg.description);
          score += 5;
        }
      }

      if (structureBias !== 'neutral') {
        signals.push(`SMC structure: ${structureBias}`);
        score += 5;
      }

      return {
        structureBias,
        swingHighs,
        swingLows,
        bosEvents,
        chochEvents,
        orderBlocks,
        fvgs,
        signals,
        score,
      };
    } catch (err) {
      logger.error(`SMC analysis error: ${err.message}`);
      return null;
    }
  }
}

module.exports = SMCAnalyzer;
