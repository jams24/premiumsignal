require('dotenv').config();
const cron = require('node-cron');
const logger = require('./utils/logger');
const config = require('./utils/config');
const db = require('./db/database');
const ListingMonitor = require('./collectors/listingMonitor');
const TechnicalScanner = require('./collectors/technicalScanner');
const OnchainTracker = require('./collectors/onchainTracker');
const SocialScanner = require('./collectors/socialScanner');
const SignalEngine = require('./engine/signalEngine');
const TelegramBot = require('./bot/telegramBot');

async function main() {
  logger.info('=== CryptoSignal Bot Starting ===');

  // Init database
  await db.init();

  // Init collectors
  const listingMonitor = new ListingMonitor();
  await listingMonitor.init();

  const technicalScanner = new TechnicalScanner(listingMonitor.exchanges);
  const onchainTracker = new OnchainTracker();
  const socialScanner = new SocialScanner();
  const signalEngine = new SignalEngine();

  // Init Telegram bot
  const bot = new TelegramBot({ technicalScanner, socialScanner, onchainTracker });

  // Wire up listing alerts
  listingMonitor.onNewListing(async (listing) => {
    logger.info(`🆕 New listing detected: ${listing.symbol} on ${listing.exchange}`);
    await bot.sendListingAlert(listing);

    // Try to generate a full signal after a short delay (let price settle)
    setTimeout(async () => {
      try {
        const exchange = listingMonitor.exchanges[listing.exchange];
        if (!exchange) return;
        const ticker = await exchange.fetchTicker(listing.pair);
        const signal = await signalEngine.processListingSignal(listing, { currentPrice: ticker.last });
        if (signal) await bot.sendSignal(signal);
      } catch (e) {
        logger.error(`Post-listing signal failed: ${e.message}`);
      }
    }, 60000); // wait 1 min for price data
  });

  // Wire up whale alerts
  onchainTracker.onWhaleAlert(async (alert) => {
    await bot.sendWhaleAlert(alert);
  });

  // === Scheduled Jobs ===

  // Check for new listings every 60 seconds
  const listingInterval = setInterval(async () => {
    try {
      await listingMonitor.check();
    } catch (err) {
      logger.error(`Listing check error: ${err.message}`);
    }
  }, config.signals.listingCheckInterval);

  // Full technical scan every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    logger.info('Running scheduled technical scan...');
    try {
      const results = await technicalScanner.scanAll();
      let signalCount = 0;

      for (const scan of results.slice(0, 5)) { // top 5 candidates
        const signal = await signalEngine.processBreakoutSignal(scan);
        if (signal) {
          await bot.sendSignal(signal);
          signalCount++;
        }
      }

      // Check funding rate extremes
      for (const [id, exchange] of Object.entries(listingMonitor.exchanges)) {
        const fundingOpps = await technicalScanner.findFundingRateExtremes(exchange, id);
        for (const opp of fundingOpps.slice(0, 3)) {
          const fundingSignal = signalEngine.processFundingSignal(opp);
          if (fundingSignal) {
            // Funding signals are info-only, post as raw message
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

  // Social sentiment scan every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      const [twitter, gecko] = await Promise.all([
        socialScanner.scanTwitterTrending(),
        socialScanner.getCoingeckoTrending(),
      ]);

      // Only post if there are surging tokens
      const surging = twitter.filter(t => t.velocity === 'SURGING');
      if (surging.length > 0) {
        const msg = socialScanner.formatTrending(surging, gecko.slice(0, 5));
        await bot.sendRaw(msg);
      }
    } catch (err) {
      logger.error(`Social scan error: ${err.message}`);
    }
  });

  // Announcement page scrape every 2 minutes
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
    `Listing check: every ${config.signals.listingCheckInterval / 1000}s\n` +
    `Technical scan: every 5 min\n` +
    `Social scan: every 15 min\n\n` +
    `<i>${new Date().toUTCString()}</i>`
  );

  logger.info('All systems running');

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    clearInterval(listingInterval);
    bot.stop();
    db.pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
