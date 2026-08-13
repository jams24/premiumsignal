const { Telegraf, Markup } = require('telegraf');
const logger = require('../utils/logger');
const config = require('../utils/config');
const db = require('../db/database');
const { formatSignalMessage, formatListingAlert, formatWhaleAlert, formatScanResult, escapeHtml } = require('../utils/formatting');

class TelegramBot {
  constructor({ technicalScanner, socialScanner, onchainTracker, marketIntel, tradeExecutor }) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.channelId = config.telegram.channelId;
    this.technicalScanner = technicalScanner;
    this.socialScanner = socialScanner;
    this.onchainTracker = onchainTracker;
    this.marketIntel = marketIntel;
    this.tradeExecutor = tradeExecutor;
    this.setupCommands();
  }

  setupCommands() {
    this.bot.command('start', (ctx) => {
      ctx.replyWithHTML(
        `<b>🤖 CryptoSignal Bot</b>\n\n` +
        `<b>Commands:</b>\n` +
        `/signals — Active signals\n` +
        `/scan — Run market scan now\n` +
        `/trending — Social sentiment scan\n` +
        `/funding — Funding rate extremes\n` +
        `/stats — Signal performance stats\n` +
        `/whale &lt;token&gt; &lt;chain&gt; &lt;address&gt; — Check whale activity\n` +
        `/help — Show this menu\n\n` +
        `Signals are auto-posted to the channel.`
      );
    });

    this.bot.command('menu', (ctx) => {
      ctx.replyWithHTML(
        `📡 <b>CryptoSignal Control Panel</b>\n\nSelect an option below:`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📡 Active Signals', 'action_signals'), Markup.button.callback('🔍 Market Scan', 'action_scan')],
          [Markup.button.callback('🔥 Trending', 'action_trending'), Markup.button.callback('📉 Funding Rates', 'action_funding')],
          [Markup.button.callback('🧠 Market Intel', 'action_intel'), Markup.button.callback('🔥 DEX Movers', 'action_dex')],
          [Markup.button.callback('🐋 Whale Tracker', 'action_whale_info'), Markup.button.callback('📊 Stats', 'action_stats')],
          [Markup.button.callback('📋 Review Signals', 'action_review')],
          [Markup.button.callback('🤖 Auto-Trade', 'action_trade'), Markup.button.callback('📊 Positions', 'action_positions')],
          [Markup.button.callback('💰 P&L', 'action_pnl'), Markup.button.callback('🛑 Kill Switch', 'action_stop')],
          [Markup.button.callback('❓ Help', 'action_help')],
        ])
      );
    });

    this.bot.action('action_signals', async (ctx) => {
      await ctx.answerCbQuery();
      const signals = await db.getActiveSignals();
      if (!signals.length) return ctx.replyWithHTML('No active signals right now. Stay patient.');
      let msg = '📡 <b>ACTIVE SIGNALS</b>\n\n';
      for (const s of signals.slice(0, 5)) {
        const dir = s.direction === 'long' ? '🟢' : '🔴';
        msg += `${dir} <b>$${s.symbol}</b> (${s.exchange}) — ${s.type}\nEntry: $${s.entry_low} - $${s.entry_high} | TP1: $${s.tp1} | SL: $${s.stop_loss}\n${escapeHtml(s.catalyst)}\n\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.action('action_scan', async (ctx) => {
      await ctx.answerCbQuery('Scanning markets...');
      ctx.reply('🔍 Scanning markets... this may take 30-60 seconds.');
      const results = await this.technicalScanner.scanAll();
      ctx.replyWithHTML(formatScanResult(results));
    });

    this.bot.action('action_trending', async (ctx) => {
      await ctx.answerCbQuery('Checking sentiment...');
      const [twitter, gecko] = await Promise.all([
        this.socialScanner.scanTwitterTrending(),
        this.socialScanner.getCoingeckoTrending(),
      ]);
      ctx.replyWithHTML(this.socialScanner.formatTrending(twitter, gecko));
    });

    this.bot.action('action_funding', async (ctx) => {
      await ctx.answerCbQuery('Checking funding rates...');
      let allOpps = [];
      for (const [id, ex] of Object.entries(this.technicalScanner.exchanges)) {
        const opps = await this.technicalScanner.findFundingRateExtremes(ex, id);
        allOpps = allOpps.concat(opps);
      }
      if (!allOpps.length) return ctx.reply('No extreme funding rates found.');
      let msg = '📉 <b>FUNDING RATE EXTREMES</b>\n\n';
      for (const o of allOpps.slice(0, 15)) {
        const sym = o.symbol.replace('/USDT:USDT', '');
        const dir = o.direction === 'long' ? '🟢' : '🔴';
        msg += `${dir} <b>${sym}</b> (${o.exchange}) — ${o.reason}\n`;
      }
      msg += '\n<i>Extreme funding = potential mean reversion opportunity</i>';
      ctx.replyWithHTML(msg);
    });

    this.bot.action('action_whale_info', async (ctx) => {
      await ctx.answerCbQuery();
      ctx.replyWithHTML('🐋 <b>Whale Tracker</b>\n\nUsage:\n<code>/whale TOKEN chain contract_address</code>\n\nExample:\n<code>/whale TUT ethereum 0x123...</code>\n\nSupported chains: ethereum, bsc, solana');
    });

    this.bot.action('action_stats', async (ctx) => {
      await ctx.answerCbQuery();
      const stats = await db.getSignalStats();
      ctx.replyWithHTML(
        `📊 <b>SIGNAL PERFORMANCE</b>\n\nTotal Signals: ${stats.total}\nTP1 Hit: ${stats.tp1Hit} (${stats.winRate}%)\nTP2 Hit: ${stats.tp2Hit}\nSL Hit: ${stats.slHit}\nWin Rate: ${stats.winRate}%`
      );
    });

    this.bot.action('action_intel', async (ctx) => {
      await ctx.answerCbQuery('Gathering intel...');
      try {
        const [overview, stablecoins, dexMovers] = await Promise.all([
          this.marketIntel.getMarketOverview(),
          this.marketIntel.getStablecoinFlows(),
          this.marketIntel.getDexTopMovers(),
        ]);
        const msg = this.marketIntel.formatMarketBrief(overview, [], stablecoins, dexMovers, []);
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Intel failed.');
      }
    });

    this.bot.action('action_dex', async (ctx) => {
      await ctx.answerCbQuery('Scanning DEX...');
      try {
        const movers = await this.marketIntel.getDexTopMovers();
        if (!movers.length) return ctx.reply('No significant DEX movers.');
        let msg = '🔥 <b>DEX TOP MOVERS</b>\n\n';
        for (const d of movers.slice(0, 7)) {
          const vol = d.volume24h > 1e6 ? `$${(d.volume24h / 1e6).toFixed(1)}M` : `$${(d.volume24h / 1e3).toFixed(0)}K`;
          msg += `🔥 <b>${escapeHtml(d.symbol)}</b> (${d.chain}) +${d.priceChange24h.toFixed(0)}% | Vol: ${vol}\n`;
        }
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('DEX scan failed.');
      }
    });

    this.bot.action('action_review', async (ctx) => {
      await ctx.answerCbQuery();
      const all = await db.getAllSignals(15);
      if (!all.length) return ctx.reply('No signals recorded yet.');
      const stats = await db.getSignalStats();
      let msg = `📋 <b>SIGNAL REVIEW</b>\n\nTotal: ${stats.total} | Win Rate: ${stats.winRate}%\nTP1: ${stats.tp1Hit} | TP2: ${stats.tp2Hit} | SL: ${stats.slHit}\n\n`;
      for (const s of all.slice(0, 10)) {
        const dir = s.direction === 'long' ? '🟢' : '🔴';
        let status = '⏳';
        if (s.hit_sl) status = '🔴 SL';
        else if (s.hit_tp3) status = '🏆 TP3';
        else if (s.hit_tp2) status = '✅✅';
        else if (s.hit_tp1) status = '✅ TP1';
        else if (s.closed_at) status = '⏰';
        msg += `${dir} <b>$${s.symbol}</b> ${status} | $${s.current_price}\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.action('action_trade', async (ctx) => {
      await ctx.answerCbQuery();
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const te = this.tradeExecutor;
      ctx.replyWithHTML(
        `🤖 <b>AUTO-TRADING</b>\n\nMode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\nSize: $${te.maxPositionSize} | Leverage: ${te.defaultLeverage}x\nToday P&L: $${te.dailyPnL.toFixed(2)} / -$${te.maxDailyLoss} limit`
      );
    });

    this.bot.action('action_positions', async (ctx) => {
      await ctx.answerCbQuery();
      const trades = await db.getOpenTrades();
      if (!trades.length) return ctx.reply('No open positions.');
      let msg = `📊 <b>OPEN POSITIONS</b> (${trades.length})\n\n`;
      for (const t of trades) {
        const dir = t.direction === 'long' ? '🟢' : '🔴';
        msg += `${t.mode === 'paper' ? '📝' : '💰'} ${dir} <b>$${t.symbol}</b> @ $${t.entry_price} (${t.leverage}x)\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.action('action_pnl', async (ctx) => {
      await ctx.answerCbQuery();
      const stats = await db.getTradeStats();
      if (!stats.length) return ctx.reply('No trade data yet.');
      let msg = '💰 <b>TRADE P&L</b>\n\n';
      for (const s of stats) {
        msg += `<b>${s.mode.toUpperCase()}</b>: ${s.total} trades | P&L: $${parseFloat(s.total_pnl).toFixed(2)} | WR: ${s.closed > 0 ? ((s.wins / s.closed) * 100).toFixed(0) : '0'}%\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.action('action_stop', async (ctx) => {
      await ctx.answerCbQuery('Closing all positions...');
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const count = await this.tradeExecutor.closeAllPositions();
      this.tradeExecutor.enabled = false;
      ctx.replyWithHTML(`🛑 <b>KILL SWITCH</b>\n\n${count} position(s) closed. Auto-trading disabled.`);
    });

    this.bot.action('action_help', async (ctx) => {
      await ctx.answerCbQuery();
      ctx.replyWithHTML(
        `<b>Signal Types:</b>\n🆕 LISTING — New exchange listing\n🚀 BREAKOUT — Technical breakout\n📊 VOLUME_SPIKE — Unusual volume\n🐋 WHALE — On-chain whale movement\n📉 FUNDING — Extreme funding rate\n\n⭐ Confidence: 1-5 stars (higher = more confluence)`
      );
    });

    this.bot.command('help', (ctx) => ctx.replyWithHTML(
      `<b>Signal Types:</b>\n` +
      `🆕 LISTING — New exchange listing detected\n` +
      `🚀 BREAKOUT — Technical breakout with volume\n` +
      `📊 VOLUME_SPIKE — Unusual volume detected\n` +
      `🐋 WHALE — Large on-chain movement\n` +
      `📉 FUNDING_SHORT — Extreme funding rate\n\n` +
      `<b>Confidence:</b> ⭐⭐⭐⭐⭐ (1-5 stars)\n` +
      `Higher confidence = stronger confluence of signals`
    ));

    this.bot.command('signals', async (ctx) => {
      try {
        const signals = await db.getActiveSignals();
        if (!signals.length) return ctx.reply('No active signals right now. Stay patient.');

        let msg = '📡 <b>ACTIVE SIGNALS</b>\n\n';
        for (const s of signals.slice(0, 5)) {
          const dir = s.direction === 'long' ? '🟢' : '🔴';
          msg += `${dir} <b>$${s.symbol}</b> (${s.exchange}) — ${s.type}\n`;
          msg += `   Entry: $${s.entry_low} - $${s.entry_high}\n`;
          msg += `   TP1: $${s.tp1} | SL: $${s.stop_loss}\n`;
          msg += `   ${escapeHtml(s.catalyst)}\n\n`;
        }
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Error fetching signals.');
        logger.error(`/signals error: ${err.message}`);
      }
    });

    this.bot.command('scan', async (ctx) => {
      ctx.reply('🔍 Scanning markets... this may take 30-60 seconds.');
      try {
        const results = await this.technicalScanner.scanAll();
        const msg = formatScanResult(results);
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Scan failed. Check logs.');
        logger.error(`/scan error: ${err.message}`);
      }
    });

    this.bot.command('trending', async (ctx) => {
      ctx.reply('🔍 Checking social sentiment...');
      try {
        const [twitter, gecko] = await Promise.all([
          this.socialScanner.scanTwitterTrending(),
          this.socialScanner.getCoingeckoTrending(),
        ]);
        const msg = this.socialScanner.formatTrending(twitter, gecko);
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Social scan failed.');
        logger.error(`/trending error: ${err.message}`);
      }
    });

    this.bot.command('funding', async (ctx) => {
      ctx.reply('🔍 Checking funding rates...');
      try {
        let allOpps = [];
        for (const [id, ex] of Object.entries(this.technicalScanner.exchanges)) {
          const opps = await this.technicalScanner.findFundingRateExtremes(ex, id);
          allOpps = allOpps.concat(opps);
        }

        if (!allOpps.length) return ctx.reply('No extreme funding rates found.');

        let msg = '📉 <b>FUNDING RATE EXTREMES</b>\n\n';
        for (const o of allOpps.slice(0, 15)) {
          const sym = o.symbol.replace('/USDT:USDT', '');
          const dir = o.direction === 'long' ? '🟢' : '🔴';
          msg += `${dir} <b>${sym}</b> (${o.exchange}) — ${o.reason}\n`;
        }
        msg += '\n<i>Extreme funding = potential mean reversion opportunity</i>';
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Funding check failed.');
        logger.error(`/funding error: ${err.message}`);
      }
    });

    this.bot.command('stats', async (ctx) => {
      try {
        const stats = await db.getSignalStats();
        ctx.replyWithHTML(
          `📊 <b>SIGNAL PERFORMANCE</b>\n\n` +
          `Total Signals: ${stats.total}\n` +
          `TP1 Hit: ${stats.tp1Hit} (${stats.winRate}%)\n` +
          `TP2 Hit: ${stats.tp2Hit}\n` +
          `SL Hit: ${stats.slHit}\n` +
          `Win Rate: ${stats.winRate}%`
        );
      } catch (err) {
        ctx.reply('Error fetching stats.');
      }
    });

    this.bot.command('intel', async (ctx) => {
      ctx.reply('🔍 Gathering market intelligence... this takes 15-30 seconds.');
      try {
        const [overview, stablecoins, dexMovers] = await Promise.all([
          this.marketIntel.getMarketOverview(),
          this.marketIntel.getStablecoinFlows(),
          this.marketIntel.getDexTopMovers(),
        ]);

        let oiData = [];
        let lsRatio = [];
        // Get OI from first available exchange, funding from all
        const exchangeEntries = Object.entries(this.technicalScanner.exchanges);
        if (exchangeEntries.length) {
          const [firstId] = exchangeEntries[0];
          oiData = await this.marketIntel.getOpenInterest(firstId);

          for (const [id] of exchangeEntries) {
            const ls = await this.marketIntel.getLongShortRatio(id);
            lsRatio = lsRatio.concat(ls);
          }
        }

        const msg = this.marketIntel.formatMarketBrief(overview, oiData, stablecoins, dexMovers, lsRatio);
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Intel report failed. Check logs.');
        logger.error(`/intel error: ${err.message}`);
      }
    });

    this.bot.command('dex', async (ctx) => {
      ctx.reply('🔍 Scanning DEX for trending tokens...');
      try {
        const movers = await this.marketIntel.getDexTopMovers();
        if (!movers.length) return ctx.reply('No significant DEX movers found right now.');

        let msg = '🔥 <b>DEX TOP MOVERS</b>\n<i>Tokens pumping on-chain before CEX listings</i>\n\n';
        for (const d of movers.slice(0, 10)) {
          const vol = d.volume24h > 1e6 ? `$${(d.volume24h / 1e6).toFixed(1)}M` : `$${(d.volume24h / 1e3).toFixed(0)}K`;
          const buy = d.buyRatio ? ` | ${d.buyRatio}% buys` : '';
          msg += `🔥 <b>${escapeHtml(d.symbol)}</b> (${d.chain})\n`;
          msg += `   +${d.priceChange24h.toFixed(0)}% (1h: ${d.priceChange1h > 0 ? '+' : ''}${d.priceChange1h.toFixed(0)}%) | Vol: ${vol}${buy}\n\n`;
        }
        msg += '⚡ <i>DEX pumps often precede CEX listings — watch for announcements</i>';
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('DEX scan failed.');
        logger.error(`/dex error: ${err.message}`);
      }
    });

    this.bot.command('review', async (ctx) => {
      try {
        const all = await db.getAllSignals(30);
        if (!all.length) return ctx.reply('No signals recorded yet.');

        const stats = await db.getSignalStats();
        let msg = `📋 <b>SIGNAL REVIEW</b>\n\n`;
        msg += `<b>Overall:</b> ${stats.total} signals | Win Rate: ${stats.winRate}%\n`;
        msg += `TP1: ${stats.tp1Hit} | TP2: ${stats.tp2Hit} | SL: ${stats.slHit}\n\n`;
        msg += `<b>Recent Signals:</b>\n`;

        for (const s of all.slice(0, 15)) {
          const dir = s.direction === 'long' ? '🟢' : '🔴';
          let status = '⏳ Active';
          if (s.hit_sl) status = '🔴 SL Hit';
          else if (s.hit_tp3) status = '🏆 TP3';
          else if (s.hit_tp2) status = '✅✅ TP2';
          else if (s.hit_tp1) status = '✅ TP1';
          else if (s.closed_at) status = '⏰ Expired';

          const date = new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          msg += `${dir} <b>$${s.symbol}</b> ${s.type} | ${status} | ${date}\n`;
          msg += `   Entry: $${s.current_price} → TP1: $${s.tp1}\n`;
        }

        msg += `\n<i>Use /stats for detailed performance metrics</i>`;
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Error fetching review data.');
        logger.error(`/review error: ${err.message}`);
      }
    });

    this.bot.command('analyse', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const days = parseInt(args[0]) || 7;
      ctx.reply(`📊 Analysing ${days} days of data... this may take a moment.`);

      try {
        const data = await db.getAnalysisData(days);

        let msg = `📊 <b>FULL ANALYSIS REPORT (${data.period})</b>\n\n`;

        // Signal Performance
        msg += `<b>═══ SIGNAL PERFORMANCE ═══</b>\n`;
        msg += `Total Signals: ${data.signals.total}\n`;
        for (const [type, stats] of Object.entries(data.signals.byType)) {
          const wr = stats.total > 0 ? ((stats.tp1 / stats.total) * 100).toFixed(0) : '0';
          msg += `\n<b>${type}:</b> ${stats.total} signals\n`;
          msg += `  TP1: ${stats.tp1} | TP2: ${stats.tp2} | TP3: ${stats.tp3} | SL: ${stats.sl}\n`;
          msg += `  Win Rate: ${wr}%\n`;
        }

        // OI Analysis
        msg += `\n<b>═══ OPEN INTEREST DATA ═══</b>\n`;
        msg += `OI Snapshots: ${data.oi.total}\n`;
        if (data.oi.snapshots.length) {
          const topOI = {};
          for (const snap of data.oi.snapshots) {
            if (!topOI[snap.symbol]) topOI[snap.symbol] = [];
            topOI[snap.symbol].push(snap);
          }
          const sorted = Object.entries(topOI).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
          for (const [sym, snaps] of sorted) {
            const avgChange = (snaps.reduce((a, s) => a + s.oi_change, 0) / snaps.length).toFixed(1);
            msg += `  ${escapeHtml(sym)}: ${snaps.length} shifts, avg ${avgChange}% OI change\n`;
          }
        }

        // DEX Analysis
        msg += `\n<b>═══ DEX ACTIVITY ═══</b>\n`;
        msg += `DEX Alerts: ${data.dex.total}\n`;
        if (data.dex.convertedToCex.length) {
          msg += `DEX→CEX Conversions: ${data.dex.convertedToCex.join(', ')}\n`;
          msg += `<i>(Tokens spotted on DEX that later appeared in our signals)</i>\n`;
        }

        // Most Active Tokens
        if (data.alertLog.length) {
          msg += `\n<b>═══ MOST ACTIVE TOKENS ═══</b>\n`;
          for (const t of data.alertLog.slice(0, 8)) {
            msg += `  ${escapeHtml(t.symbol || 'N/A')}: ${t.count} alerts (${t.alert_type})\n`;
          }
        }

        // Market Trend
        if (data.briefs.mcapTrend) {
          msg += `\n<b>═══ MARKET TREND ═══</b>\n`;
          msg += `Total Mcap Change: ${data.briefs.mcapTrend > 0 ? '+' : ''}${data.briefs.mcapTrend}%\n`;
          msg += `Intel Briefs Collected: ${data.briefs.count}\n`;
        }

        // Recommendations
        msg += `\n<b>═══ INSIGHTS ═══</b>\n`;
        const totalSignals = data.signals.total;
        if (totalSignals > 0) {
          const bestType = Object.entries(data.signals.byType)
            .map(([type, s]) => ({ type, wr: s.total > 0 ? s.tp1 / s.total : 0 }))
            .sort((a, b) => b.wr - a.wr)[0];
          const worstType = Object.entries(data.signals.byType)
            .map(([type, s]) => ({ type, wr: s.total > 0 ? s.tp1 / s.total : 0, sl: s.sl }))
            .sort((a, b) => a.wr - b.wr)[0];

          if (bestType) msg += `Best performing: <b>${bestType.type}</b> (${(bestType.wr * 100).toFixed(0)}% win rate)\n`;
          if (worstType && worstType.type !== bestType?.type) msg += `Needs improvement: <b>${worstType.type}</b> (${(worstType.wr * 100).toFixed(0)}% win rate)\n`;
        }
        if (data.dex.convertedToCex.length) {
          msg += `DEX scanner is catching pre-CEX movers ✅\n`;
        }

        msg += `\n<i>Run /analyse 14 for 14-day analysis, /analyse 30 for monthly</i>`;
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Analysis failed. Make sure there is enough data collected.');
        logger.error(`/analyse error: ${err.message}`);
      }
    });

    // === TRADE COMMANDS ===

    this.bot.command('trade', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const mode = this.tradeExecutor.mode;
      const enabled = this.tradeExecutor.enabled;
      ctx.replyWithHTML(
        `🤖 <b>AUTO-TRADING STATUS</b>\n\n` +
        `Mode: <b>${mode.toUpperCase()}</b> ${mode === 'paper' ? '📝' : '💰'}\n` +
        `Status: ${enabled ? '✅ ENABLED' : '❌ DISABLED'}\n` +
        `Position Size: $${this.tradeExecutor.maxPositionSize}\n` +
        `Max Concurrent: ${this.tradeExecutor.maxConcurrentPositions}\n` +
        `Leverage: ${this.tradeExecutor.defaultLeverage}x\n` +
        `Daily Loss Limit: $${this.tradeExecutor.maxDailyLoss}\n` +
        `Today P&L: $${this.tradeExecutor.dailyPnL.toFixed(2)}\n\n` +
        `<b>Commands:</b>\n` +
        `/positions — View open positions\n` +
        `/pnl — Trade performance stats\n` +
        `/stop — Kill switch (close all)\n` +
        `/trademode paper|live — Switch mode`
      );
    });

    this.bot.command('positions', async (ctx) => {
      try {
        const trades = await db.getOpenTrades();
        if (!trades.length) return ctx.reply('No open positions.');
        let msg = `📊 <b>OPEN POSITIONS</b> (${trades.length})\n\n`;
        for (const t of trades) {
          const dir = t.direction === 'long' ? '🟢' : '🔴';
          const modeTag = t.mode === 'paper' ? '📝' : '💰';
          msg += `${modeTag} ${dir} <b>$${t.symbol}</b> (${t.exchange})\n`;
          msg += `   Entry: $${t.entry_price} | Size: $${t.position_size} (${t.leverage}x)\n`;
          msg += `   TP1: $${t.tp1}${t.hit_tp1 ? ' ✅' : ''} | TP2: $${t.tp2}${t.hit_tp2 ? ' ✅' : ''} | TP3: $${t.tp3}\n`;
          msg += `   SL: $${t.stop_loss}\n\n`;
        }
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Error fetching positions.');
      }
    });

    this.bot.command('pnl', async (ctx) => {
      try {
        const stats = await db.getTradeStats();
        if (!stats.length) return ctx.reply('No trade data yet.');
        let msg = `💰 <b>TRADE PERFORMANCE</b>\n\n`;
        for (const s of stats) {
          const modeTag = s.mode === 'paper' ? '📝 PAPER' : '💰 LIVE';
          msg += `<b>${modeTag}</b>\n`;
          msg += `Total: ${s.total} | Open: ${s.open} | Closed: ${s.closed}\n`;
          msg += `Wins: ${s.wins} | Full Wins (TP3): ${s.full_wins} | Losses: ${s.losses}\n`;
          msg += `Win Rate: ${s.closed > 0 ? ((s.wins / s.closed) * 100).toFixed(1) : '0'}%\n`;
          msg += `Total P&L: $${parseFloat(s.total_pnl).toFixed(2)}\n`;
          msg += `Avg P&L: ${parseFloat(s.avg_pnl_pct).toFixed(2)}%\n`;
          msg += `Best: $${parseFloat(s.best_trade || 0).toFixed(2)} | Worst: $${parseFloat(s.worst_trade || 0).toFixed(2)}\n\n`;
        }
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Error fetching trade stats.');
      }
    });

    this.bot.command('stop', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      ctx.reply('🛑 KILL SWITCH — closing all positions...');
      try {
        const count = await this.tradeExecutor.closeAllPositions();
        this.tradeExecutor.enabled = false;
        ctx.replyWithHTML(`🛑 <b>ALL POSITIONS CLOSED</b>\n\n${count} position(s) closed.\nAuto-trading DISABLED.\n\nUse /trademode paper or /trademode live to re-enable.`);
      } catch (err) {
        ctx.reply('Error closing positions.');
      }
    });

    this.bot.command('trademode', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const mode = args[0]?.toLowerCase();
      if (mode === 'paper' || mode === 'live') {
        this.tradeExecutor.mode = mode;
        this.tradeExecutor.enabled = true;
        ctx.replyWithHTML(`✅ Trading mode set to <b>${mode.toUpperCase()}</b>\nAuto-trading ENABLED.${mode === 'live' ? '\n\n⚠️ <b>WARNING: Real funds will be used!</b>' : ''}`);
      } else {
        ctx.reply('Usage: /trademode paper or /trademode live');
      }
    });

    this.bot.command('setsize', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const size = parseFloat(args[0]);
      if (!size || size < 5 || size > 10000) return ctx.reply('Usage: /setsize <amount in USDT>\nExample: /setsize 100\nRange: $5 - $10,000');
      this.tradeExecutor.maxPositionSize = size;
      ctx.replyWithHTML(`✅ Position size set to <b>$${size}</b> per trade.`);
    });

    this.bot.command('whale', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 3) return ctx.reply('Usage: /whale <TOKEN> <chain> <contract_address>\nExample: /whale TUT ethereum 0x123...');

      const [symbol, chain, address] = args;
      ctx.reply(`🐋 Checking whale activity for $${symbol.toUpperCase()} on ${chain}...`);

      try {
        let alerts = [];
        if (chain.toLowerCase() === 'ethereum' || chain.toLowerCase() === 'eth') {
          alerts = await this.onchainTracker.checkEthWhales(address, symbol.toUpperCase());
        } else if (chain.toLowerCase() === 'bsc' || chain.toLowerCase() === 'bnb') {
          alerts = await this.onchainTracker.checkBscWhales(address, symbol.toUpperCase());
        } else if (chain.toLowerCase() === 'solana' || chain.toLowerCase() === 'sol') {
          alerts = await this.onchainTracker.checkSolanaWhales(address, symbol.toUpperCase());
        } else {
          return ctx.reply('Supported chains: ethereum, bsc, solana');
        }

        if (!alerts.length) return ctx.reply('No recent whale transactions found.');

        for (const alert of alerts.slice(0, 5)) {
          ctx.replyWithHTML(formatWhaleAlert(alert));
        }
      } catch (err) {
        ctx.reply('Whale check failed.');
        logger.error(`/whale error: ${err.message}`);
      }
    });
  }

  async sendSignal(signal) {
    if (!this.channelId) return;
    try {
      await this.bot.telegram.sendMessage(this.channelId, formatSignalMessage(signal), { parse_mode: 'HTML' });
      logger.info(`Signal sent to channel: ${signal.type} ${signal.symbol}`);
    } catch (err) {
      logger.error(`Failed to send signal: ${err.message}`);
    }
  }

  async sendListingAlert(listing) {
    if (!this.channelId) return;
    try {
      await this.bot.telegram.sendMessage(this.channelId, formatListingAlert(listing), { parse_mode: 'HTML' });
      logger.info(`Listing alert sent: ${listing.symbol} on ${listing.exchange}`);
    } catch (err) {
      logger.error(`Failed to send listing alert: ${err.message}`);
    }
  }

  async sendWhaleAlert(alert) {
    if (!this.channelId) return;
    try {
      await this.bot.telegram.sendMessage(this.channelId, formatWhaleAlert(alert), { parse_mode: 'HTML' });
    } catch (err) {
      logger.error(`Failed to send whale alert: ${err.message}`);
    }
  }

  async sendRaw(message) {
    if (!this.channelId) return;
    try {
      await this.bot.telegram.sendMessage(this.channelId, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error(`Failed to send message: ${err.message}`);
    }
  }

  async launch() {
    // Register command menu (shows in Telegram UI)
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Start the bot' },
      { command: 'menu', description: 'Open the control panel' },
      { command: 'signals', description: 'View active trading signals' },
      { command: 'scan', description: 'Run a live market scan' },
      { command: 'trending', description: 'Social sentiment & trending coins' },
      { command: 'funding', description: 'Funding rate extremes' },
      { command: 'intel', description: 'Full market intelligence brief' },
      { command: 'dex', description: 'DEX trending tokens (pre-CEX alpha)' },
      { command: 'whale', description: 'Track on-chain whale activity' },
      { command: 'stats', description: 'Signal performance & win rate' },
      { command: 'review', description: 'Review past signal performance' },
      { command: 'analyse', description: 'Full analysis report (usage: /analyse 7)' },
      { command: 'trade', description: 'Auto-trading status & config' },
      { command: 'positions', description: 'View open trade positions' },
      { command: 'pnl', description: 'Trade P&L and performance' },
      { command: 'stop', description: 'Kill switch — close all & disable' },
      { command: 'trademode', description: 'Switch paper/live mode' },
      { command: 'setsize', description: 'Set position size (e.g. /setsize 100)' },
      { command: 'help', description: 'Show all commands & signal types' },
    ]);

    await this.bot.launch();
    logger.info('Telegram bot launched');
  }

  stop() {
    this.bot.stop('SIGTERM');
  }
}

module.exports = TelegramBot;
