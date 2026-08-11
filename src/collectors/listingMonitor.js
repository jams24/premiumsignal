const ccxt = require('ccxt');
const axios = require('axios');
const logger = require('../utils/logger');
const db = require('../db/database');
const config = require('../utils/config');

class ListingMonitor {
  constructor() {
    this.exchanges = {};
    this.previousMarkets = {};
    this.callbacks = [];
  }

  async init() {
    const exchangeConfigs = [
      { id: 'mexc', class: ccxt.mexc },
      { id: 'binance', class: ccxt.binance },
      { id: 'bybit', class: ccxt.bybit },
      { id: 'bitget', class: ccxt.bitget },
    ];

    for (const cfg of exchangeConfigs) {
      try {
        const creds = config.exchanges[cfg.id] || {};
        this.exchanges[cfg.id] = new cfg.class({
          apiKey: creds.apiKey,
          secret: creds.secret,
          enableRateLimit: true,
        });
        const markets = await this.exchanges[cfg.id].loadMarkets();
        this.previousMarkets[cfg.id] = new Set(Object.keys(markets));

        // Seed known listings into DB
        for (const symbol of this.previousMarkets[cfg.id]) {
          const market = markets[symbol];
          const marketType = market.swap ? 'perp' : 'spot';
          await db.addListing(cfg.id, symbol, marketType);
        }

        logger.info(`${cfg.id}: loaded ${this.previousMarkets[cfg.id].size} markets`);
      } catch (err) {
        logger.warn(`Failed to init ${cfg.id}: ${err.message}`);
      }
    }
  }

  onNewListing(callback) {
    this.callbacks.push(callback);
  }

  async check() {
    for (const [exchangeId, exchange] of Object.entries(this.exchanges)) {
      try {
        await exchange.loadMarkets(true); // reload
        const currentMarkets = new Set(Object.keys(exchange.markets));
        const previous = this.previousMarkets[exchangeId];

        for (const symbol of currentMarkets) {
          if (!previous.has(symbol)) {
            const market = exchange.markets[symbol];
            const marketType = market.swap ? 'perp' : 'spot';

            if (!(await db.isKnownListing(exchangeId, symbol, marketType))) {
              const listing = {
                exchange: exchangeId,
                symbol: market.base,
                pair: symbol,
                type: market.swap ? 'PERPETUAL' : 'SPOT',
                marketType,
                details: `New ${marketType} market: ${symbol} on ${exchangeId.toUpperCase()}`,
              };

              await db.addListing(exchangeId, symbol, marketType);
              logger.info(`NEW LISTING: ${symbol} on ${exchangeId} (${marketType})`);

              for (const cb of this.callbacks) {
                try { await cb(listing); } catch (e) { logger.error(`Listing callback error: ${e.message}`); }
              }
            }
          }
        }

        this.previousMarkets[exchangeId] = currentMarkets;
      } catch (err) {
        logger.error(`Listing check failed for ${exchangeId}: ${err.message}`);
      }
    }
  }

  async checkAnnouncementPages() {
    const sources = [
      {
        name: 'binance',
        url: 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=5',
        parse: (data) => (data?.data?.catalogs?.[0]?.articles || []).map(a => ({ title: a.title, url: `https://www.binance.com/en/support/announcement/${a.code}` })),
      },
    ];

    for (const source of sources) {
      try {
        const { data } = await axios.get(source.url, { timeout: 10000 });
        const articles = source.parse(data);
        for (const article of articles) {
          const listingMatch = article.title.match(/(?:will list|lists?)\s+(\w+)/i);
          if (listingMatch) {
            logger.info(`Announcement: ${article.title} — ${article.url}`);
          }
        }
      } catch (err) {
        // Announcement pages often block scrapers, this is best-effort
      }
    }
  }
}

module.exports = ListingMonitor;
