const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../utils/config');

class SocialScanner {
  constructor() {
    this.trendCache = new Map();
  }

  async scanTwitterTrending() {
    if (!config.twitter.bearerToken) {
      logger.warn('Twitter bearer token not set — social scanning disabled');
      return [];
    }

    try {
      // Search for crypto cashtags with high engagement
      const { data } = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
        params: {
          query: '($BTC OR $ETH OR $SOL OR crypto) has:cashtags -is:retweet lang:en',
          max_results: 100,
          'tweet.fields': 'public_metrics,created_at,entities',
        },
        headers: { Authorization: `Bearer ${config.twitter.bearerToken}` },
        timeout: 15000,
      });

      const cashtagCounts = {};
      for (const tweet of data.data || []) {
        const cashtags = tweet.entities?.cashtags || [];
        const engagement = (tweet.public_metrics?.like_count || 0) +
          (tweet.public_metrics?.retweet_count || 0) * 3 +
          (tweet.public_metrics?.reply_count || 0) * 2;

        for (const ct of cashtags) {
          const tag = ct.tag.toUpperCase();
          if (['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'USDT', 'USDC'].includes(tag)) continue; // skip majors
          if (!cashtagCounts[tag]) cashtagCounts[tag] = { mentions: 0, engagement: 0, tweets: [] };
          cashtagCounts[tag].mentions++;
          cashtagCounts[tag].engagement += engagement;
          cashtagCounts[tag].tweets.push(tweet.text.substring(0, 100));
        }
      }

      // Score and rank
      const trending = Object.entries(cashtagCounts)
        .map(([tag, data]) => ({
          symbol: tag,
          mentions: data.mentions,
          engagement: data.engagement,
          score: data.mentions * 10 + data.engagement,
          sampleTweet: data.tweets[0],
          velocity: this.getVelocity(tag, data.mentions),
        }))
        .filter(t => t.mentions >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);

      // Update cache for velocity tracking
      for (const t of trending) {
        this.trendCache.set(t.symbol, { mentions: t.mentions, timestamp: Date.now() });
      }

      return trending;
    } catch (err) {
      logger.error(`Twitter scan failed: ${err.message}`);
      return [];
    }
  }

  getVelocity(symbol, currentMentions) {
    const prev = this.trendCache.get(symbol);
    if (!prev) return 'NEW';
    const timeDelta = (Date.now() - prev.timestamp) / 60000; // minutes
    if (timeDelta < 1) return 'STABLE';
    const rate = (currentMentions - prev.mentions) / timeDelta;
    if (rate > 2) return 'SURGING';
    if (rate > 0.5) return 'RISING';
    if (rate < -0.5) return 'FADING';
    return 'STABLE';
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
      }));
    } catch (err) {
      logger.error(`CoinGecko trending failed: ${err.message}`);
      return [];
    }
  }

  formatTrending(twitterTrending, geckoTrending) {
    let msg = '🔥 <b>SOCIAL SENTIMENT SCAN</b>\n\n';

    if (twitterTrending.length) {
      msg += '<b>Twitter/X Trending Cashtags:</b>\n';
      for (const t of twitterTrending.slice(0, 10)) {
        const vel = { SURGING: '🚀', RISING: '📈', NEW: '🆕', FADING: '📉', STABLE: '➡️' }[t.velocity] || '';
        msg += `${vel} <b>$${t.symbol}</b> — ${t.mentions} mentions, ${t.engagement} engagement\n`;
      }
    }

    if (geckoTrending.length) {
      msg += '\n<b>CoinGecko Trending:</b>\n';
      for (const t of geckoTrending.slice(0, 7)) {
        const change = t.priceChange24h ? `${t.priceChange24h > 0 ? '+' : ''}${t.priceChange24h.toFixed(1)}%` : 'N/A';
        msg += `• <b>${t.symbol}</b> (${t.name}) — 24h: ${change}\n`;
      }
    }

    msg += '\n⚠️ <i>Social sentiment is a lagging indicator — confirm with price action & volume</i>';
    return msg;
  }
}

module.exports = SocialScanner;
