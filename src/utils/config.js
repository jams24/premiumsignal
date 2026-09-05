require('dotenv').config();

module.exports = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    channelId: process.env.TELEGRAM_CHANNEL_ID,
    // Comma-separated Telegram user IDs that are auto-promoted to admin
    adminIds: (process.env.ADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0),
  },
  exchanges: {
    binance: { apiKey: process.env.BINANCE_API_KEY, secret: process.env.BINANCE_SECRET },
    mexc: { apiKey: process.env.MEXC_API_KEY, secret: process.env.MEXC_SECRET },
    bybit: { apiKey: process.env.BYBIT_API_KEY, secret: process.env.BYBIT_SECRET },
  },
  onchain: {
    etherscanKey: process.env.ETHERSCAN_API_KEY,
    bscscanKey: process.env.BSCSCAN_API_KEY,
    solscanKey: process.env.SOLSCAN_API_KEY,
    alchemyKey: process.env.ALCHEMY_API_KEY,
    moralisKey: process.env.MORALIS_API_KEY,
    arkhamKey: process.env.ARKHAM_API_KEY,
  },
  twitter: {
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
  },
  signals: {
    volumeSpikeMultiplier: parseFloat(process.env.MIN_VOLUME_SPIKE_MULTIPLIER || '3'),
    minPriceChange: parseFloat(process.env.MIN_PRICE_CHANGE_PERCENT || '5'),
    scanInterval: parseInt(process.env.SCAN_INTERVAL_SECONDS || '30') * 1000,
    listingCheckInterval: parseInt(process.env.LISTING_CHECK_INTERVAL_SECONDS || '60') * 1000,
  },
};
