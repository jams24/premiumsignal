const axios = require('axios');
const logger = require('../utils/logger');

class SocialScanner {
  constructor() {
    this.trendCache = new Map();
    this.lastScan = 0;
    this.cacheTTL = 10 * 60 * 1000; // 10 min
    this.cachedResult = null;
  }

  async scanTrending() {
    if (this.cachedResult && Date.now() - this.lastScan < this.cacheTTL) {
      return this.cachedResult;
    }

    const [geckoTrending, geckoGainers] = await Promise.all([
      this.getCoingeckoTrending(),
      this.getCoingeckoTopMovers(),
    ]);

    const combined = this.mergeSources(geckoTrending, geckoGainers);
    this.cachedResult = combined;
    this.lastScan = Date.now();
    return combined;
  }

  async getCoingeckoTrending() {
    try {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/search/trending', { timeout: 10000 });
      return (data.coins || []).map(c => ({
        symbol: c.item.symbol.toUpperCase(),
        name: c.item.name,
        rank: c.item.market_cap_rank,
        priceChange24h: c.item.data?.price_change_percentage_24h?.usd,
        marketCap: c.item.data?.market_cap,
        source: 'coingecko_trending',
        score: 100 - (c.item.score || 0),
      }));
    } catch (err) {
      logger.error(`CoinGecko trending failed: ${err.message}`);
      return [];
    }
  }

  async getCoingeckoTopMovers() {
    try {
      const { data } = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
        params: {
          vs_currency: 'usd',
          order: 'volume_desc',
          per_page: 50,
          page: 1,
          sparkline: false,
          price_change_percentage: '1h,24h',
        },
        timeout: 10000,
      });
      return (data || [])
        .filter(c => Math.abs(c.price_change_percentage_24h_in_currency || 0) > 5)
        .map(c => ({
          symbol: c.symbol.toUpperCase(),
          name: c.name,
          rank: c.market_cap_rank,
          priceChange24h: c.price_change_percentage_24h_in_currency,
          priceChange1h: c.price_change_percentage_1h_in_currency,
          volume24h: c.total_volume,
          marketCap: c.market_cap,
          source: 'coingecko_movers',
          score: Math.abs(c.price_change_percentage_24h_in_currency || 0),
        }));
    } catch (err) {
      logger.error(`CoinGecko movers failed: ${err.message}`);
      return [];
    }
  }

  mergeSources(trending, movers) {
    const merged = new Map();

    for (const t of trending) {
      merged.set(t.symbol, { ...t, sources: ['trending'] });
    }

    for (const m of movers) {
      if (merged.has(m.symbol)) {
        const existing = merged.get(m.symbol);
        existing.sources.push('movers');
        existing.score += m.score;
        existing.priceChange24h = m.priceChange24h || existing.priceChange24h;
        existing.volume24h = m.volume24h;
      } else {
        merged.set(m.symbol, { ...m, sources: ['movers'] });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
  }

  formatTrending(tokens) {
    if (!tokens.length) return '📊 <b>SOCIAL SCAN</b>\n\nNo trending data available.';

    let msg = '📊 <b>TRENDING TOKENS</b>\n\n';

    for (const t of tokens.slice(0, 15)) {
      const change = t.priceChange24h
        ? `${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}%`
        : 'N/A';
      const srcTag = t.sources.length > 1 ? '🔥' : t.sources[0] === 'trending' ? '📈' : '💹';
      const vol = t.volume24h ? ` | Vol $${(t.volume24h / 1e6).toFixed(0)}M` : '';
      msg += `${srcTag} <b>${t.symbol}</b> (${t.name}) — 24h: ${change}${vol}\n`;
    }

    msg += '\n<i>📈 = CoinGecko trending | 💹 = Top mover | 🔥 = Both</i>';
    return msg;
  }
}

module.exports = SocialScanner;
