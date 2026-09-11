require('dotenv').config();
const http = require('http');
const cron = require('node-cron');
const logger = require('./utils/logger');
const config = require('./utils/config');
const db = require('./db/database');
const ListingMonitor = require('./collectors/listingMonitor');
const TechnicalScanner = require('./collectors/technicalScanner');
const { STOCK_TOKENS } = require('./collectors/technicalScanner');
const OnchainTracker = require('./collectors/onchainTracker');
const OnchainScanner = require('./collectors/onchainScanner');
const FlowScanner = require('./collectors/flowScanner');
const LiquidationScanner = require('./collectors/liquidationScanner');
const MarketIntel = require('./collectors/marketIntel');
const SocialScanner = require('./collectors/socialScanner');
const SignalEngine = require('./engine/signalEngine');
const SignalTracker = require('./engine/signalTracker');
const TradeExecutor = require('./engine/tradeExecutor');
const UserPaperEngine = require('./engine/userPaperEngine');
const TelegramBot = require('./bot/telegramBot');
const { generateSetupChart } = require('./utils/chartGenerator');

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
  const onchainScanner = new OnchainScanner(listingMonitor.exchanges, onchainTracker);
  const flowScanner = new FlowScanner(listingMonitor.exchanges, onchainTracker);
  const liquidationScanner = new LiquidationScanner(listingMonitor.exchanges);
  technicalScanner.onchainScanner = onchainScanner;
  onchainScanner.liquidationScanner = liquidationScanner;
  flowScanner.liquidationScanner = liquidationScanner;
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
    dcaEnabled: process.env.DCA_ENABLED === 'true',
  });

  // Load persisted settings and today's PnL from DB
  if (dbReady) {
    await tradeExecutor.loadConfig();
    await tradeExecutor.recalcDailyPnL();
  }

  // Init Telegram bot
  const bot = new TelegramBot({ technicalScanner, socialScanner, onchainTracker, onchainScanner, flowScanner, marketIntel, tradeExecutor });

  // Per-user virtual paper accounts (pass bot for user notifications)
  const userPaperEngine = new UserPaperEngine(listingMonitor.exchanges, bot.bot);
  bot.userPaperEngine = userPaperEngine;

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
        // Skip stock-based tokens — gap risk, limited hours
        const sym = listing.symbol.toUpperCase();
        if (sym.includes('STOCK') || STOCK_TOKENS.test(sym)) {
          logger.info(`Skipping stock token listing: ${sym}`);
          return;
        }
        const exchange = listingMonitor.exchanges[listing.exchange];
        if (!exchange) return;
        // Run full technical analysis — don't blindly trade listings
        const scan = await technicalScanner.analyzeSymbol(listing.symbol, listing.exchange);
        if (scan && scan.score >= 70) {
          const signal = await signalEngine.processBreakoutSignal(scan);
          if (signal) {
            signal.catalyst = `New ${listing.type} listing on ${listing.exchange.toUpperCase()} + technical confirmation`;
            await bot.sendSignal(signal);
            await tradeExecutor.executeSignal(signal);
          }
        } else {
          logger.info(`Listing ${listing.symbol}: no technical confirmation (score: ${scan?.score || 0})`);
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
    logger.info('Running scheduled zone scan...');
    try {
      let signalCount = 0;

      // Funding rate alerts (info only, no trades)
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

      // === Zone accumulation scanner (Flams-style pre-breakout entries) ===
      try {
        const zoneResults = await technicalScanner.scanZoneAccumulation();
        for (const scan of zoneResults.slice(0, 3)) {
          const signal = await signalEngine.processBreakoutSignal(scan);
          if (signal) {
            signal.type = 'ZONE_ENTRY';
            await bot.sendSignal(signal);
            await tradeExecutor.executeSignal(signal);
            await db.logAlert('SIGNAL', signal.symbol, signal, `ZONE ${signal.direction} ${signal.symbol}`).catch(() => {});
            signalCount++;
          }
        }
      } catch (err) {
        logger.error(`Zone scan error: ${err.message}`);
      }

      const rejSummary = [technicalScanner.rejectSummary(), signalEngine.rejectSummary?.() || '']
        .filter(Boolean).join(' || ');
      logger.info(`Zone scan complete: ${signalCount} signals sent${signalCount === 0 ? ` [rejections: ${rejSummary || 'none recorded'}]` : ''}`);
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

  // Evaluate per-user virtual paper trades every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await userPaperEngine.checkAllTrades();
    } catch (err) {
      logger.error(`User paper engine error: ${err.message}`);
    }
  });

  cron.schedule('*/15 * * * *', async () => {
    try {
      const tokens = await socialScanner.scanTrending();
      const notable = tokens.filter(t => t.sources.length > 1 || t.score > 80);
      if (notable.length > 0) {
        const msg = socialScanner.formatTrending(notable.slice(0, 10));
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


  // === Onchain Scanner — OI + Funding rate analysis every 10 min ===
  cron.schedule('*/10 * * * *', async () => {
    try {
      const results = await onchainScanner.scan();
      const hotTokens = results.filter(r => r.score >= 40);
      if (hotTokens.length > 0) {
        const msg = onchainScanner.formatAlerts(hotTokens, 5);
        if (msg) await bot.sendRaw(msg);

        for (const token of hotTokens) {
          const dir = (token.fundingBias === 'bullish' || token.priceChange > 0) ? 'long' : 'short';
          await db.logAlert('ONCHAIN', token.symbol, {
            score: token.score, price: token.price, direction: dir,
            exchange: token.exchange, pair: token.pair,
            oiChange1h: token.oiChange1h, oiChange4h: token.oiChange4h,
            fundingRate: token.fundingRate, fundingBias: token.fundingBias,
            priceChange: token.priceChange, volume: token.volume,
            signals: token.signals,
          }, `ONCHAIN ${dir} ${token.symbol} score=${token.score}`).catch(() => {});
        }

        // Send setup chart images for top tokens
        for (const token of hotTokens.slice(0, 3)) {
          try {
            const exchange = listingMonitor.exchanges[token.exchange];
            if (!exchange) continue;
            const ohlcv = await exchange.fetchOHLCV(token.pair, '1h', undefined, 60);
            if (!ohlcv || ohlcv.length < 10) continue;
            const snap = liquidationScanner.generateSetupSnapshot(token);
            const chartInfo = {
              symbol: token.symbol,
              exchange: token.exchange,
              direction: snap.direction,
              confidence: snap.confidence,
              bidWalls: token.setupData?.orderBook?.bidWalls || [],
              askWalls: token.setupData?.orderBook?.askWalls || [],
              bidDepth: token.setupData?.orderBook?.bidDepth,
              askDepth: token.setupData?.orderBook?.askDepth,
              liquidations: token.setupData?.liquidations,
              whaleOrders: token.setupData?.orderBook?.whaleOrders || [],
              persistentWalls: token.setupData?.orderBook?.persistentWalls || [],
              largeTrades: token.setupData?.largeTrades || [],
              liqLevels: token.setupData?.liqLevels,
            };
            const chartBuf = generateSetupChart(ohlcv, chartInfo);
            if (chartBuf) {
              await bot.sendRawPhoto(chartBuf, `📸 <b>${token.symbol}</b> Setup Snapshot — Score: ${token.score}/100`);
            }
          } catch (e) {
            logger.debug(`Setup chart failed for ${token.symbol}: ${e.message}`);
          }
        }
      }
      if (results.length) {
        logger.info(`Onchain: top=${results[0]?.symbol} score=${results[0]?.score}, ${hotTokens.length} hot tokens`);
      }
    } catch (err) {
      logger.error(`Onchain scan error: ${err.message}`);
    }
  });
  // === Flow Scanner — standalone exchange flow detection every 15 min (Flams edge) ===
  cron.schedule('*/15 * * * *', async () => {
    try {
      const results = await flowScanner.scan();
      const significant = results.filter(r => r.flowScore >= 15);
      if (significant.length > 0) {
        const msg = flowScanner.formatAlerts(significant, 5);
        if (msg) await bot.sendRaw(msg);

        for (const token of significant) {
          const dir = token.flow?.outflowCount > token.flow?.inflowCount ? 'long' : 'short';
          await db.logAlert('FLOW', token.symbol, {
            flowScore: token.flowScore, price: token.price, direction: dir,
            exchange: token.exchange, pair: token.pair,
            priceChange: token.priceChange,
            outflowCount: token.flow?.outflowCount, inflowCount: token.flow?.inflowCount,
            netFlow: token.flow?.netFlow,
          }, `FLOW ${dir} ${token.symbol} score=${token.flowScore}`).catch(() => {});
        }

        // Send setup chart images for top flow tokens
        for (const token of significant.slice(0, 3)) {
          try {
            const exchange = listingMonitor.exchanges[token.exchange];
            if (!exchange) continue;
            const ohlcv = await exchange.fetchOHLCV(token.pair, '1h', undefined, 60);
            if (!ohlcv || ohlcv.length < 10) continue;
            const snap = liquidationScanner.formatFlowSnapshot(token);
            const dir = token.flow.outflowCount > token.flow.inflowCount ? 'long' : token.flow.inflowCount > token.flow.outflowCount ? 'short' : 'neutral';
            const chartInfo = {
              symbol: token.symbol,
              exchange: token.exchange,
              direction: dir,
              confidence: token.flowScore >= 40 ? 'high' : token.flowScore >= 20 ? 'medium' : 'low',
              bidWalls: token.setupData?.orderBook?.bidWalls || [],
              askWalls: token.setupData?.orderBook?.askWalls || [],
              bidDepth: token.setupData?.orderBook?.bidDepth,
              askDepth: token.setupData?.orderBook?.askDepth,
              liquidations: token.setupData?.liquidations,
              whaleOrders: token.setupData?.orderBook?.whaleOrders || [],
              persistentWalls: token.setupData?.orderBook?.persistentWalls || [],
              largeTrades: token.setupData?.largeTrades || [],
              liqLevels: token.setupData?.liqLevels,
            };
            const chartBuf = generateSetupChart(ohlcv, chartInfo);
            if (chartBuf) {
              await bot.sendRawPhoto(chartBuf, `📸 <b>${token.symbol}</b> Flow Snapshot — Score: ${token.flowScore}`);
            }
          } catch (e) {
            logger.debug(`Flow chart failed for ${token.symbol}: ${e.message}`);
          }
        }
      }
      // Send escalation alerts when tokens cross new cumulative tiers
      for (const r of results) {
        const tier = flowScanner.checkAlertEscalation(r.symbol);
        if (tier) {
          const escMsg = flowScanner.formatEscalationAlert(r.symbol, tier);
          if (escMsg) await bot.sendRaw(escMsg);
        }
      }
      if (results.length) {
        logger.info(`FlowScanner: top=${results[0]?.symbol} score=${results[0]?.flowScore}, ${significant.length} significant`);
      }
    } catch (err) {
      logger.error(`Flow scanner error: ${err.message}`);
    }
  });

  // === Alert Performance Tracker — check prices for past alerts every 10 min ===
  cron.schedule('*/10 * * * *', async () => {
    try {
      const unchecked = await db.getUncheckedAlerts(['ONCHAIN', 'FLOW'], 65);
      if (!unchecked.length) return;

      for (const alert of unchecked) {
        try {
          const pair = alert.data?.pair;
          const exchangeId = alert.data?.exchange;
          const alertPrice = parseFloat(alert.data?.price);
          const direction = alert.data?.direction || 'long';
          if (!pair || !exchangeId || !alertPrice) continue;

          const exchange = listingMonitor.exchanges[exchangeId];
          if (!exchange) continue;
          const ticker = await exchange.fetchTicker(pair);
          if (!ticker?.last) continue;

          const currentPrice = ticker.last;
          const ageMs = Date.now() - new Date(alert.created_at).getTime();
          const ageHours = ageMs / 3600000;

          const rawPnl = ((currentPrice - alertPrice) / alertPrice) * 100;
          const pnl = direction === 'short' ? -rawPnl : rawPnl;

          const updates = {};
          if (!alert.data.checked_1h && ageHours >= 1) {
            updates.checked_1h = true;
            updates.price_1h = currentPrice;
            updates.pnl_1h = parseFloat(pnl.toFixed(2));
          }
          if (!alert.data.checked_4h && ageHours >= 4) {
            updates.checked_4h = true;
            updates.price_4h = currentPrice;
            updates.pnl_4h = parseFloat(pnl.toFixed(2));
          }
          if (!alert.data.checked_24h && ageHours >= 24) {
            updates.checked_24h = true;
            updates.price_24h = currentPrice;
            updates.pnl_24h = parseFloat(pnl.toFixed(2));
          }

          if (Object.keys(updates).length > 0) {
            await db.updateAlertPerformance(alert.id, updates);
          }
        } catch (e) {
          logger.debug(`Alert perf check failed for ${alert.symbol}: ${e.message}`);
        }
      }
    } catch (err) {
      logger.error(`Alert performance tracker error: ${err.message}`);
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

  // Check open trades for TP/SL hits every minute (tighter loss cap enforcement)
  cron.schedule('* * * * *', async () => {
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
    `Onchain scan: every 10 min\n` +
    `Flow scanner: every 15 min\n` +
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

process.on('unhandledRejection', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('message is not modified') || msg.includes('query is too old') || msg.includes('bot was blocked')) {
    logger.warn(`Telegram API (non-fatal): ${msg}`);
    return;
  }
  logger.error(`Unhandled rejection: ${msg}`);
});

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('message is not modified') || msg.includes('query is too old')) {
    logger.warn(`Telegram API (non-fatal): ${msg}`);
    return;
  }
  logger.error(`Uncaught exception: ${msg}`);
  process.exit(1);
});

main().catch(err => {
  logger.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
