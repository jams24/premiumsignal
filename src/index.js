require('dotenv').config();
const http = require('http');
const cron = require('node-cron');
const logger = require('./utils/logger');
const config = require('./utils/config');
const db = require('./db/database');
const ListingMonitor = require('./collectors/listingMonitor');
const TechnicalScanner = require('./collectors/technicalScanner');
const OnchainTracker = require('./collectors/onchainTracker');
const MarketIntel = require('./collectors/marketIntel');
const SocialScanner = require('./collectors/socialScanner');
const SignalEngine = require('./engine/signalEngine');
const SignalTracker = require('./engine/signalTracker');
const TradeExecutor = require('./engine/tradeExecutor');
const TelegramBot = require('./bot/telegramBot');

let dbReady = false;

async function main() {
  logger.info('=== CryptoSignal Bot Starting ===');

  // Start health check server FIRST so Deployzy doesn't kill the container
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', dbReady, uptime: process.uptime() }));
    } else {
      res.writeHead(200);
      res.end('CryptoSignal Bot Running');
    }
  });
  server.listen(process.env.PORT || 3000, () => {
    logger.info(`Health check server on port ${process.env.PORT || 3000}`);
  });

  // Init database (non-fatal — bot works without it, just no persistence)
  try {
    await db.init();
    dbReady = true;
  } catch (err) {
    logger.warn(`Database unavailable — running without persistence: ${err.message}`);
  }

  // Init collectors
  const listingMonitor = new ListingMonitor();
  await listingMonitor.init();

  const technicalScanner = new TechnicalScanner(listingMonitor.exchanges);
  const onchainTracker = new OnchainTracker();
  const marketIntel = new MarketIntel(listingMonitor.exchanges);
  const socialScanner = new SocialScanner();
  const signalEngine = new SignalEngine();
  const signalTracker = new SignalTracker(listingMonitor.exchanges, signalEngine);

  // Init trade executor (paper mode by default)
  const tradeExecutor = new TradeExecutor(listingMonitor.exchanges, {
    mode: process.env.TRADE_MODE || 'paper',
    maxPositionSize: parseFloat(process.env.TRADE_SIZE) || 50,
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 200,
    maxLossPerTrade: parseFloat(process.env.MAX_LOSS_PER_TRADE) || 0,
    maxConcurrentPositions: parseInt(process.env.MAX_POSITIONS) || 5,
    defaultLeverage: parseInt(process.env.DEFAULT_LEVERAGE) || 5,
    minConfidence: parseInt(process.env.MIN_CONFIDENCE) || 4,
    riskPct: parseFloat(process.env.RISK_PCT) || 0,
    paperBalance: parseFloat(process.env.PAPER_BALANCE) || 1000,
    dynamicLeverage: process.env.DYNAMIC_LEVERAGE !== 'false',
  });

  // Init Telegram bot
  const bot = new TelegramBot({ technicalScanner, socialScanner, onchainTracker, marketIntel, tradeExecutor });

  // Wire trade executor notifications to Telegram
  tradeExecutor.onTradeUpdate(async (msg) => {
    await bot.sendRaw(msg);
  });

  // Wire up listing alerts
  listingMonitor.onNewListing(async (listing) => {
    logger.info(`New listing detected: ${listing.symbol} on ${listing.exchange}`);
    await bot.sendListingAlert(listing);

    setTimeout(async () => {
      try {
        const exchange = listingMonitor.exchanges[listing.exchange];
        if (!exchange) return;
        const ticker = await exchange.fetchTicker(listing.pair);
        const signal = await signalEngine.processListingSignal(listing, { currentPrice: ticker.last });
        if (signal) {
          await bot.sendSignal(signal);
          await tradeExecutor.executeSignal(signal);
        }
      } catch (e) {
        logger.error(`Post-listing signal failed: ${e.message}`);
      }
    }, 60000);
  });

  // Wire up whale alerts
  onchainTracker.onWhaleAlert(async (alert) => {
    await bot.sendWhaleAlert(alert);
  });

  // === Scheduled Jobs ===

  const listingInterval = setInterval(async () => {
    try {
      await listingMonitor.check();
    } catch (err) {
      logger.error(`Listing check error: ${err.message}`);
    }
  }, config.signals.listingCheckInterval);

  cron.schedule('*/5 * * * *', async () => {
    logger.info('Running scheduled technical scan...');
    try {
      const results = await technicalScanner.scanAll();
      let signalCount = 0;

      for (const scan of results.slice(0, 2)) {
        const signal = await signalEngine.processBreakoutSignal(scan);
        if (signal) {
          await bot.sendSignal(signal);
          await tradeExecutor.executeSignal(signal);
          await db.logAlert('SIGNAL', signal.symbol, signal, `${signal.type} ${signal.direction} ${signal.symbol}`).catch(() => {});
          signalCount++;
        }
      }

      for (const [id, exchange] of Object.entries(listingMonitor.exchanges)) {
        const fundingOpps = await technicalScanner.findFundingRateExtremes(exchange, id);
        for (const opp of fundingOpps.slice(0, 3)) {
          const fundingSignal = signalEngine.processFundingSignal(opp);
          if (fundingSignal) {
            await bot.sendRaw(
              `📉 <b>FUNDING ALERT</b>\n\n` +
              `<b>${opp.symbol}</b> on ${opp.exchange}\n` +
              `${opp.reason}\n` +
              `Suggested: ${opp.direction.toUpperCase()}\n\n` +
              `<i>Mean reversion opportunity — DYOR</i>`
            );
          }
        }
      }

      logger.info(`Scan complete: ${results.length} candidates, ${signalCount} signals sent`);
    } catch (err) {
      logger.error(`Scheduled scan error: ${err.message}`);
    }
  });

  // Track signal TP/SL hits every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      const updates = await signalTracker.checkAllSignals();
      for (const update of updates) {
        const msg = signalTracker.formatUpdate(update);
        if (msg) await bot.sendRaw(msg);
      }
      if (updates.length) logger.info(`Tracker: ${updates.length} signal updates`);
    } catch (err) {
      logger.error(`Signal tracker error: ${err.message}`);
    }
  });

  cron.schedule('*/15 * * * *', async () => {
    try {
      const [twitter, gecko] = await Promise.all([
        socialScanner.scanTwitterTrending(),
        socialScanner.getCoingeckoTrending(),
      ]);

      const surging = twitter.filter(t => t.velocity === 'SURGING');
      if (surging.length > 0) {
        const msg = socialScanner.formatTrending(surging, gecko.slice(0, 5));
        await bot.sendRaw(msg);
      }
    } catch (err) {
      logger.error(`Social scan error: ${err.message}`);
    }
  });

  // DEX mover scan every 10 minutes — catch pre-CEX pumps
  cron.schedule('*/10 * * * *', async () => {
    try {
      const movers = await marketIntel.getDexTopMovers();
      // Save all DEX movers to DB
      for (const token of movers.slice(0, 10)) {
        await db.saveDexAlert(token).catch(() => {});
      }
      const hot = movers.filter(m => m.priceChange1h > 50 && m.volume24h > 500000);
      for (const token of hot.slice(0, 3)) {
        await bot.sendRaw(marketIntel.formatDexAlert(token));
        await db.logAlert('DEX_PUMP', token.symbol, token, `${token.symbol} +${token.priceChange1h.toFixed(0)}% 1h on ${token.chain}`).catch(() => {});
      }
    } catch (err) {
      logger.error(`DEX scan error: ${err.message}`);
    }
  });

  // Full market intel brief every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    try {
      logger.info('Running market intel brief...');
      const [overview, stablecoins, dexMovers] = await Promise.all([
        marketIntel.getMarketOverview(),
        marketIntel.getStablecoinFlows(),
        marketIntel.getDexTopMovers(),
      ]);

      let oiData = [];
      let lsRatio = [];
      const firstExchange = Object.entries(listingMonitor.exchanges)[0];
      if (firstExchange) {
        oiData = await marketIntel.getOpenInterest(firstExchange[0]);
        lsRatio = await marketIntel.getLongShortRatio(firstExchange[0]);
      }

      const msg = marketIntel.formatMarketBrief(overview, oiData, stablecoins, dexMovers, lsRatio);
      await bot.sendRaw(msg);

      // Save brief to DB for later analysis
      await db.saveIntelBrief({
        totalMcap: overview?.totalMarketCap,
        totalVolume: overview?.totalVolume,
        btcDominance: overview?.btcDominance,
        mcapChange: overview?.marketCapChange24h,
        stablecoins,
        oiData,
        dexData: dexMovers.slice(0, 10),
        fundingData: lsRatio.slice(0, 10),
      }).catch(() => {});
    } catch (err) {
      logger.error(`Market intel error: ${err.message}`);
    }
  });

  // Check open trades for TP/SL hits every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await tradeExecutor.checkOpenTrades();
    } catch (err) {
      logger.error(`Trade tracker error: ${err.message}`);
    }
  });

  cron.schedule('*/2 * * * *', async () => {
    try {
      await listingMonitor.checkAnnouncementPages();
    } catch (err) {
      logger.error(`Announcement check error: ${err.message}`);
    }
  });

  // Launch bot
  await bot.launch();

  // Startup message
  await bot.sendRaw(
    `🤖 <b>CryptoSignal Bot Online</b>\n\n` +
    `Monitoring: ${Object.keys(listingMonitor.exchanges).join(', ')}\n` +
    `Database: ${dbReady ? '✅ Connected' : '⚠️ Unavailable'}\n` +
    `Auto-Trade: ${tradeExecutor.mode.toUpperCase()} mode | $${tradeExecutor.maxPositionSize}/trade | ${tradeExecutor.defaultLeverage}x\n` +
    `Listing check: every ${config.signals.listingCheckInterval / 1000}s\n` +
    `Technical scan: every 5 min\n` +
    `Social scan: every 15 min\n\n` +
    `<i>${new Date().toUTCString()}</i>`
  );

  logger.info('All systems running');

  const shutdown = () => {
    logger.info('Shutting down...');
    clearInterval(listingInterval);
    bot.stop();
    if (dbReady) db.pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
