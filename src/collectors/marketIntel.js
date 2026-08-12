const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../db/database');
const { escapeHtml } = require('../utils/formatting');

class MarketIntel {
  constructor(exchanges) {
    this.exchanges = exchanges;
    this.previousOI = new Map();
    this.previousFlow = {};
  }

  // ============================================================
  // 1. OPEN INTEREST + LIQUIDATIONS (via exchange APIs + CoinGlass)
  // ============================================================

  async getOpenInterest(exchangeId) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) return [];

    const results = [];
    try {
      // Get top perp markets by volume
      const tickers = await exchange.fetchTickers();
      const perps = Object.entries(tickers)
        .filter(([s]) => s.includes(':USDT'))
        .sort((a, b) => (b[1].quoteVolume || 0) - (a[1].quoteVolume || 0))
        .slice(0, 50);

      for (const [symbol, ticker] of perps) {
        try {
          if (!exchange.has.fetchOpenInterest) continue;
          const oi = await exchange.fetchOpenInterest(symbol);
          if (!oi || !oi.openInterestAmount) continue;

          const key = `${exchangeId}:${symbol}`;
          const prevOI = this.previousOI.get(key);
          const currentOI = oi.openInterestAmount;

          if (prevOI) {
            const change = ((currentOI - prevOI) / prevOI) * 100;
            if (Math.abs(change) > 10) {
              const oiEntry = {
                symbol: symbol.replace('/USDT:USDT', ''),
                exchange: exchangeId,
                openInterest: currentOI,
                oiChange: change.toFixed(1),
                price: ticker.last,
                priceChange: ticker.percentage || 0,
                signal: change > 15 ? 'OI_SURGE' : change < -15 ? 'OI_DROP' : 'OI_SHIFT',
                interpretation: this.interpretOI(change, ticker.percentage || 0),
              };
              results.push(oiEntry);
              await db.saveOISnapshot(oiEntry).catch(() => {});
            }
          }
          this.previousOI.set(key, currentOI);
        } catch (e) { /* skip individual failures */ }
      }
    } catch (err) {
      logger.error(`OI fetch failed for ${exchangeId}: ${err.message}`);
    }

    return results.sort((a, b) => Math.abs(b.oiChange) - Math.abs(a.oiChange));
  }

  interpretOI(oiChange, priceChange) {
    // OI up + Price up = new longs opening (bullish trend)
    // OI up + Price down = new shorts opening (bearish pressure)
    // OI down + Price up = shorts closing (short squeeze)
    // OI down + Price down = longs closing (capitulation)
    if (oiChange > 0 && priceChange > 0) return '🟢 New longs entering — bullish trend confirmation';
    if (oiChange > 0 && priceChange < 0) return '🔴 New shorts piling in — bearish pressure building';
    if (oiChange < 0 && priceChange > 0) return '🟡 Short squeeze — shorts getting liquidated';
    if (oiChange < 0 && priceChange < 0) return '🔴 Long capitulation — longs exiting/liquidated';
    return '➡️ Neutral';
  }

  async getLiquidations() {
    // CoinGlass free endpoint for recent liquidations
    try {
      const { data } = await axios.get('https://open-api.coinglass.com/public/v2/liquidation/info', {
        params: { time_type: 1 }, // 1 = 24h
        headers: { accept: 'application/json' },
        timeout: 10000,
      });

      if (!data?.data) return [];

      return data.data.slice(0, 20).map(item => ({
        symbol: item.symbol,
        longLiquidations: item.longVolUsd || 0,
        shortLiquidations: item.shortVolUsd || 0,
        totalLiquidations: (item.longVolUsd || 0) + (item.shortVolUsd || 0),
        longRatio: item.longRate || 0,
        shortRatio: item.shortRate || 0,
      }));
    } catch (err) {
      // Fallback: calculate from funding rates as proxy
      logger.warn(`CoinGlass liquidation fetch failed: ${err.message}`);
      return [];
    }
  }

  async getLongShortRatio(exchangeId) {
    const exchange = this.exchanges[exchangeId];
    if (!exchange) return [];

    const results = [];
    try {
      // Use funding rates as proxy for long/short sentiment
      if (!exchange.has.fetchFundingRates) return [];
      const rates = await exchange.fetchFundingRates();

      for (const [symbol, info] of Object.entries(rates)) {
        if (!info.fundingRate) continue;
        const rate = info.fundingRate;
        const base = symbol.replace('/USDT:USDT', '');

        // Extreme funding = overcrowded positioning
        if (Math.abs(rate) > 0.0005) {
          results.push({
            symbol: base,
            fundingRate: rate,
            annualized: (rate * 3 * 365 * 100).toFixed(1),
            sentiment: rate > 0 ? 'LONGS_DOMINANT' : 'SHORTS_DOMINANT',
            opportunity: rate > 0.001 ? 'Potential short squeeze setup' :
                        rate < -0.001 ? 'Potential long squeeze setup' :
                        rate > 0 ? 'Moderate long bias' : 'Moderate short bias',
          });
        }
      }
    } catch (err) {
      logger.error(`Long/short ratio failed: ${err.message}`);
    }

    return results.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  }

  // ============================================================
  // 2. EXCHANGE FLOW + STABLECOIN TRACKING (via DeFiLlama)
  // ============================================================

  async getExchangeNetFlow() {
    try {
      // DeFiLlama CEX volumes as proxy for flow
      const { data } = await axios.get('https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume', {
        timeout: 15000,
      });

      // Also get stablecoin data
      const stableData = await this.getStablecoinFlows();

      return {
        dexVolume: data?.totalDataChart?.[0] || null,
        stablecoins: stableData,
      };
    } catch (err) {
      logger.error(`Exchange flow fetch failed: ${err.message}`);
      return { dexVolume: null, stablecoins: [] };
    }
  }

  async getStablecoinFlows() {
    try {
      const { data } = await axios.get('https://stablecoins.llama.fi/stablecoins?includePrices=true', {
        timeout: 10000,
      });

      if (!data?.peggedAssets) return [];

      return data.peggedAssets
        .filter(s => s.circulating?.peggedUSD > 1_000_000_000) // >$1B mcap stables only
        .map(s => ({
          name: s.name,
          symbol: s.symbol,
          circulating: s.circulating?.peggedUSD || 0,
          change7d: s.circulatingPrevWeek?.peggedUSD
            ? ((s.circulating.peggedUSD - s.circulatingPrevWeek.peggedUSD) / s.circulatingPrevWeek.peggedUSD * 100).toFixed(2)
            : null,
        }))
        .sort((a, b) => b.circulating - a.circulating);
    } catch (err) {
      logger.error(`Stablecoin flow failed: ${err.message}`);
      return [];
    }
  }

  // ============================================================
  // 3. DEX VOLUME SCANNER (tokens pumping on DEX before CEX)
  // ============================================================

  async getDexTopMovers() {
    try {
      // Use DexScreener search for high-volume trending tokens
      const searches = ['trending', 'pump', 'moon'];
      let allPairs = [];

      for (const q of searches) {
        try {
          const { data } = await axios.get(`https://api.dexscreener.com/latest/dex/search?q=${q}`, { timeout: 10000 });
          if (data?.pairs) allPairs = allPairs.concat(data.pairs);
        } catch (e) { /* skip */ }
      }

      // Also get boosted tokens
      try {
        const { data: boosts } = await axios.get('https://api.dexscreener.com/token-boosts/top/v1', { timeout: 10000 });
        if (Array.isArray(boosts)) {
          for (const b of boosts.slice(0, 10)) {
            try {
              const { data: tokenData } = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${b.tokenAddress}`, { timeout: 8000 });
              if (tokenData?.pairs) allPairs = allPairs.concat(tokenData.pairs.slice(0, 2));
            } catch (e) { /* skip */ }
          }
        }
      } catch (e) { /* skip */ }

      // Deduplicate by base token address
      const seen = new Set();
      const tokens = allPairs
        .filter(p => {
          if (!p?.baseToken?.address || seen.has(p.baseToken.address)) return false;
          seen.add(p.baseToken.address);
          return true;
        })
        .map(p => ({
          symbol: p.baseToken.symbol,
          name: p.baseToken.name,
          address: p.baseToken.address,
          chain: p.chainId,
          dex: p.dexId,
          priceUsd: parseFloat(p.priceUsd || 0),
          volume24h: parseFloat(p.volume?.h24 || 0),
          priceChange24h: parseFloat(p.priceChange?.h24 || 0),
          priceChange1h: parseFloat(p.priceChange?.h1 || 0),
          liquidity: parseFloat(p.liquidity?.usd || 0),
          txns24h: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
          buyRatio: p.txns?.h24?.buys && p.txns?.h24?.sells
            ? (p.txns.h24.buys / (p.txns.h24.buys + p.txns.h24.sells) * 100).toFixed(0)
            : null,
        }))
        .filter(t => t.volume24h > 100000 && t.liquidity > 50000)
        .sort((a, b) => b.priceChange24h - a.priceChange24h)
        .slice(0, 20);

      return tokens;
    } catch (err) {
      logger.error(`DEX scanner failed: ${err.message}`);
      return [];
    }
  }

  async getDexVolumeSpikes() {
    try {
      // DexScreener recently boosted / trending
      const { data } = await axios.get('https://api.dexscreener.com/token-boosts/top/v1', {
        timeout: 10000,
      });

      if (!Array.isArray(data)) return [];

      return data.slice(0, 15).map(t => ({
        symbol: t.tokenAddress,
        chain: t.chainId,
        description: t.description || '',
        url: t.url || '',
        amount: t.amount || 0,
      }));
    } catch (err) {
      logger.error(`DEX volume spikes failed: ${err.message}`);
      return [];
    }
  }

  // ============================================================
  // 4. TOKEN UNLOCKS
  // ============================================================

  async getUpcomingUnlocks() {
    try {
      const { data } = await axios.get('https://token.unlocks.app/api/v1/token-unlocks?limit=10', {
        timeout: 10000,
      });

      if (!Array.isArray(data)) return [];

      return data.map(u => ({
        symbol: u.symbol,
        name: u.name,
        unlockDate: u.unlock_date,
        unlockValue: u.unlock_value_usd,
        unlockPercent: u.unlock_percent,
        type: u.unlock_type,
      }));
    } catch (err) {
      // Token unlocks API may require key
      return [];
    }
  }

  // ============================================================
  // 5. MARKET STRUCTURE OVERVIEW
  // ============================================================

  async getMarketOverview() {
    try {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 10000 });
      const g = data.data;

      return {
        totalMarketCap: g.total_market_cap?.usd,
        totalVolume: g.total_volume?.usd,
        btcDominance: g.market_cap_percentage?.btc?.toFixed(1),
        ethDominance: g.market_cap_percentage?.eth?.toFixed(1),
        marketCapChange24h: g.market_cap_change_percentage_24h_usd?.toFixed(2),
        activeCryptos: g.active_cryptocurrencies,
      };
    } catch (err) {
      logger.error(`Market overview failed: ${err.message}`);
      return null;
    }
  }

  // ============================================================
  // FORMATTING
  // ============================================================

  formatMarketBrief(overview, oiData, stablecoins, dexMovers, lsRatio) {
    let msg = '📊 <b>MARKET INTELLIGENCE BRIEF</b>\n\n';

    // Market overview
    if (overview) {
      const mcap = (overview.totalMarketCap / 1e12).toFixed(2);
      const vol = (overview.totalVolume / 1e9).toFixed(1);
      const change = overview.marketCapChange24h;
      msg += `<b>Market:</b> $${mcap}T | Vol: $${vol}B | 24h: ${change > 0 ? '+' : ''}${change}%\n`;
      msg += `BTC Dom: ${overview.btcDominance}% | ETH Dom: ${overview.ethDominance}%\n\n`;
    }

    // Stablecoin flows
    if (stablecoins.length) {
      msg += '<b>Stablecoin Supply (7d change):</b>\n';
      for (const s of stablecoins.slice(0, 4)) {
        const circ = (s.circulating / 1e9).toFixed(1);
        const change = s.change7d ? `${s.change7d > 0 ? '+' : ''}${s.change7d}%` : 'N/A';
        const emoji = s.change7d > 0 ? '🟢' : s.change7d < 0 ? '🔴' : '➡️';
        msg += `${emoji} ${s.symbol}: $${circ}B (${change})\n`;
      }
      msg += '\n';
    }

    // OI changes
    if (oiData.length) {
      msg += '<b>Open Interest Shifts:</b>\n';
      for (const oi of oiData.slice(0, 5)) {
        msg += `${oi.oiChange > 0 ? '📈' : '📉'} <b>${escapeHtml(oi.symbol)}</b> OI: ${oi.oiChange > 0 ? '+' : ''}${oi.oiChange}% | ${oi.interpretation}\n`;
      }
      msg += '\n';
    }

    // DEX movers
    if (dexMovers.length) {
      msg += '<b>DEX Top Movers (pre-CEX alpha):</b>\n';
      for (const d of dexMovers.slice(0, 5)) {
        const vol = d.volume24h > 1e6 ? `$${(d.volume24h / 1e6).toFixed(1)}M` : `$${(d.volume24h / 1e3).toFixed(0)}K`;
        const buyPct = d.buyRatio ? ` | ${d.buyRatio}% buys` : '';
        msg += `🔥 <b>${escapeHtml(d.symbol)}</b> (${d.chain}) +${d.priceChange24h.toFixed(0)}% | Vol: ${vol}${buyPct}\n`;
      }
      msg += '\n';
    }

    // Top funding extremes
    if (lsRatio.length) {
      msg += '<b>Positioning Extremes:</b>\n';
      for (const ls of lsRatio.slice(0, 5)) {
        const emoji = ls.fundingRate > 0 ? '🟢' : '🔴';
        msg += `${emoji} <b>${escapeHtml(ls.symbol)}</b> Funding: ${(ls.fundingRate * 100).toFixed(3)}% (${ls.annualized}% APR) — ${ls.opportunity}\n`;
      }
      msg += '\n';
    }

    // MARKET DIRECTION PREDICTION
    const direction = this.predictDirection(overview, stablecoins, oiData, lsRatio, dexMovers);
    msg += `<b>═══ MARKET DIRECTION ═══</b>\n`;
    msg += `${direction.emoji} <b>${direction.bias}</b> (${direction.confidence}% confidence)\n\n`;
    for (const reason of direction.reasons) {
      msg += `${reason}\n`;
    }
    msg += `\n<b>Suggested approach:</b> ${direction.strategy}\n\n`;

    msg += '⚠️ <i>On-chain data is directional, not predictive — always confirm with price action. DYOR.</i>';
    return msg;
  }

  predictDirection(overview, stablecoins, oiData, lsRatio, dexMovers) {
    let bullScore = 0;
    let bearScore = 0;
    const reasons = [];

    // 1. Market cap momentum
    if (overview) {
      const change = parseFloat(overview.marketCapChange24h);
      if (change > 2) { bullScore += 20; reasons.push('🟢 Market cap up ' + change + '% in 24h'); }
      else if (change > 0) { bullScore += 10; reasons.push('🟢 Market cap slightly positive'); }
      else if (change < -2) { bearScore += 20; reasons.push('🔴 Market cap down ' + change + '% in 24h'); }
      else if (change < 0) { bearScore += 10; reasons.push('🔴 Market cap slightly negative'); }

      // BTC dominance rising = risk-off (bearish for alts)
      if (parseFloat(overview.btcDominance) > 58) { bearScore += 10; reasons.push('🔴 High BTC dominance (' + overview.btcDominance + '%) — risk-off environment for alts'); }
      else if (parseFloat(overview.btcDominance) < 50) { bullScore += 10; reasons.push('🟢 Low BTC dominance (' + overview.btcDominance + '%) — alt season potential'); }
    }

    // 2. Stablecoin flows — most important macro signal
    if (stablecoins.length) {
      const usdtChange = stablecoins.find(s => s.symbol === 'USDT');
      const usdcChange = stablecoins.find(s => s.symbol === 'USDC');

      if (usdtChange?.change7d) {
        const change = parseFloat(usdtChange.change7d);
        if (change > 0.5) { bullScore += 25; reasons.push('🟢 USDT supply growing (+' + change + '%) — new money entering'); }
        else if (change < -0.5) { bearScore += 25; reasons.push('🔴 USDT supply shrinking (' + change + '%) — money leaving crypto'); }
        else if (change < 0) { bearScore += 10; reasons.push('🟡 USDT supply flat/slightly declining'); }
        else { bullScore += 5; reasons.push('🟡 USDT supply stable'); }
      }

      if (usdcChange?.change7d) {
        const change = parseFloat(usdcChange.change7d);
        if (change > 1) { bullScore += 15; reasons.push('🟢 USDC supply growing — institutional inflows'); }
        else if (change < -1) { bearScore += 15; reasons.push('🔴 USDC supply shrinking — institutional outflows'); }
      }
    }

    // 3. Open Interest analysis
    if (oiData.length) {
      const oiUp = oiData.filter(o => parseFloat(o.oiChange) > 0).length;
      const oiDown = oiData.filter(o => parseFloat(o.oiChange) < 0).length;
      if (oiUp > oiDown * 2) { bullScore += 15; reasons.push('🟢 OI expanding across ' + oiUp + ' tokens — new positions opening'); }
      else if (oiDown > oiUp * 2) { bearScore += 15; reasons.push('🔴 OI contracting across ' + oiDown + ' tokens — positions closing'); }
    }

    // 4. Funding rates (crowd positioning)
    if (lsRatio.length) {
      const extremeLongs = lsRatio.filter(l => l.fundingRate > 0.001).length;
      const extremeShorts = lsRatio.filter(l => l.fundingRate < -0.001).length;
      if (extremeLongs > 10) { bearScore += 10; reasons.push('🟡 Many tokens with extreme positive funding — crowded longs (contrarian bearish)'); }
      else if (extremeShorts > 10) { bullScore += 10; reasons.push('🟡 Many tokens with extreme negative funding — crowded shorts (contrarian bullish)'); }
    }

    // 5. DEX activity
    if (dexMovers.length) {
      const pumping = dexMovers.filter(d => d.priceChange24h > 20).length;
      const dumping = dexMovers.filter(d => d.priceChange24h < -20).length;
      if (pumping > 10) { bullScore += 10; reasons.push('🟢 ' + pumping + ' tokens pumping on DEX — strong speculative appetite'); }
      if (dumping > pumping) { bearScore += 10; reasons.push('🔴 More DEX tokens dumping than pumping'); }
      if (pumping > 5) { bullScore += 5; reasons.push('🟢 Active DEX market with ' + dexMovers.length + ' notable movers'); }
    }

    // Calculate final bias
    const total = bullScore + bearScore;
    const bullPct = total > 0 ? Math.round((bullScore / total) * 100) : 50;

    let bias, emoji, strategy;
    if (bullPct >= 70) {
      bias = 'STRONGLY BULLISH'; emoji = '🟢🟢🟢';
      strategy = 'Favor long positions, look for dips to enter. Ride momentum but set trailing stops.';
    } else if (bullPct >= 58) {
      bias = 'BULLISH'; emoji = '🟢🟢';
      strategy = 'Lean long on breakouts with confirmed volume. Be selective with entries.';
    } else if (bullPct >= 42) {
      bias = 'NEUTRAL / CHOPPY'; emoji = '🟡🟡';
      strategy = 'Range-trade, avoid heavy leverage. Wait for clear direction before committing.';
    } else if (bullPct >= 30) {
      bias = 'BEARISH'; emoji = '🔴🔴';
      strategy = 'Favor shorts on resistance rejections. Reduce position sizes. Look for funding rate shorts.';
    } else {
      bias = 'STRONGLY BEARISH'; emoji = '🔴🔴🔴';
      strategy = 'Stay mostly in stablecoins. Short overextended pumps. Wait for capitulation signals to buy.';
    }

    return { bias, emoji, confidence: Math.abs(bullPct - 50) + 50, reasons, strategy, bullScore, bearScore };
  }

  formatOIAlert(oi) {
    return `📊 <b>OI ALERT: $${escapeHtml(oi.symbol)}</b>\n\nOpen Interest: ${oi.oiChange > 0 ? '+' : ''}${oi.oiChange}%\nPrice: ${oi.priceChange > 0 ? '+' : ''}${oi.priceChange.toFixed(1)}%\n${oi.interpretation}\n\n<i>Large OI shifts signal incoming volatility</i>`;
  }

  formatDexAlert(token) {
    const vol = token.volume24h > 1e6 ? `$${(token.volume24h / 1e6).toFixed(1)}M` : `$${(token.volume24h / 1e3).toFixed(0)}K`;
    return `🔥 <b>DEX MOVER: $${escapeHtml(token.symbol)}</b>\n\n<b>${escapeHtml(token.name)}</b> on ${token.chain}/${token.dex}\nPrice: $${token.priceUsd}\n24h: +${token.priceChange24h.toFixed(0)}% | 1h: +${token.priceChange1h.toFixed(0)}%\nVolume: ${vol} | Liquidity: $${(token.liquidity / 1e3).toFixed(0)}K\n${token.buyRatio ? `Buy Ratio: ${token.buyRatio}%` : ''}\n\n⚡ <i>Token pumping on DEX — watch for CEX listing announcement</i>`;
  }
}

module.exports = MarketIntel;
