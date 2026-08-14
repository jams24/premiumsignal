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
    this.setupSettingsPanel();
  }

  setupCommands() {
    this.bot.command('start', (ctx) => {
      ctx.replyWithHTML(
        `<b>🤖 CryptoSignal Bot</b>\n\n` +
        `<b>📡 Signals &amp; Scanning:</b>\n` +
        `/menu — Interactive control panel\n` +
        `/signals — Active signals\n` +
        `/scan — Run market scan now\n` +
        `/review — Past signal performance\n` +
        `/stats — Signal win rate stats\n` +
        `/analyse &lt;days&gt; — Full analysis report\n\n` +
        `<b>📊 Market Intel:</b>\n` +
        `/intel — Market intelligence brief\n` +
        `/trending — Social sentiment scan\n` +
        `/funding — Funding rate extremes\n` +
        `/dex — DEX trending tokens\n` +
        `/whale &lt;token&gt; &lt;chain&gt; &lt;addr&gt; — Whale tracker\n\n` +
        `<b>🤖 Auto-Trading:</b>\n` +
        `/trade — Trading status &amp; config\n` +
        `/settings — Interactive settings panel\n` +
        `/positions — Open positions (DCA, trailing SL)\n` +
        `/pnl — Trade P&amp;L performance\n` +
        `/trademode paper|live — Switch mode\n` +
        `/setsize &lt;USDT&gt; — Set position size\n` +
        `/stop — Kill switch (close all)\n` +
        `/help — Signal types explained\n\n` +
        `Signals auto-posted to channel.`
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
          [Markup.button.callback('💰 P&L', 'action_pnl'), Markup.button.callback('⚙️ Settings', 'cfg_main_new')],
          [Markup.button.callback('🛑 Kill Switch', 'action_stop'), Markup.button.callback('❓ Help', 'action_help')],
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
      const balance = await te.getBalance();
      const sizeDisplay = te.riskPct > 0 ? `${te.riskPct}% ($${(balance * te.riskPct / 100).toFixed(2)})` : `$${te.maxPositionSize}`;
      ctx.replyWithHTML(
        `🤖 <b>AUTO-TRADING</b>\n\nMode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\nBalance: $${balance.toFixed(2)} | Size: ${sizeDisplay} | ${te.defaultLeverage}x${te.dynamicLeverage ? ' dyn' : ''}\nP&L: $${te.dailyPnL.toFixed(2)} / -$${te.maxDailyLoss} limit\n\nUse /risk for full risk panel`
      );
    });

    this.bot.action('action_positions', async (ctx) => {
      await ctx.answerCbQuery();
      const trades = await db.getOpenTrades();
      if (!trades.length) return ctx.reply('No open positions.');
      let msg = `📊 <b>OPEN POSITIONS</b> (${trades.length})\n\n`;
      for (const t of trades) {
        const dir = t.direction === 'long' ? '🟢' : '🔴';
        const dcaStatus = t.dca_filled_3 ? '3/3' : t.dca_filled_2 ? '2/3' : '1/3';
        const slTrailed = t.original_stop_loss && t.stop_loss !== t.original_stop_loss;
        msg += `${t.mode === 'paper' ? '📝' : '💰'} ${dir} <b>$${t.symbol}</b> @ $${t.entry_price} (${t.leverage}x) DCA ${dcaStatus}${slTrailed ? ' 🔒' : ''}\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.action('action_pnl', async (ctx) => {
      await ctx.answerCbQuery();
      const stats = await db.getTradeStats();
      if (!stats.length) return ctx.reply('No trade data yet.');
      let msg = '💰 <b>TRADE P&L</b>\n\n';
      for (const s of stats) {
        const wr = s.closed > 0 ? ((s.wins / s.closed) * 100).toFixed(0) : '0';
        msg += `<b>${s.mode === 'paper' ? '📝 PAPER' : '💰 LIVE'}</b>: ${s.total} trades | P&L: $${parseFloat(s.total_pnl).toFixed(2)} | WR: ${wr}%\n`;
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
      const te = this.tradeExecutor;
      const balance = await te.getBalance();
      const sizeDisplay = te.riskPct > 0
        ? `${te.riskPct}% of balance ($${(balance * te.riskPct / 100).toFixed(2)})`
        : `$${te.maxPositionSize} (fixed)`;
      ctx.replyWithHTML(
        `🤖 <b>AUTO-TRADING STATUS</b>\n\n` +
        `Mode: <b>${te.mode.toUpperCase()}</b> ${te.mode === 'paper' ? '📝' : '💰'}\n` +
        `Status: ${te.enabled ? '✅ ENABLED' : '❌ DISABLED'}\n` +
        `Balance: $${balance.toFixed(2)}\n` +
        `Position Size: ${sizeDisplay}\n` +
        `Leverage: ${te.defaultLeverage}x${te.dynamicLeverage ? ' (dynamic)' : ''}\n` +
        `Max Positions: ${te.maxConcurrentPositions}\n` +
        `Min Confidence: ${te.minConfidence}/5\n` +
        `Daily Loss Limit: $${te.maxDailyLoss}\n` +
        `Per-Trade Loss Cap: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}\n` +
        `Signal Filter: ${te.signalFilter.size > 0 ? [...te.signalFilter].join(', ') : 'All'}\n` +
        `Today P&L: $${te.dailyPnL.toFixed(2)}\n\n` +
        `<b>Commands:</b>\n` +
        `/risk — Risk management panel\n` +
        `/positions — Open positions\n` +
        `/pnl — Performance stats\n` +
        `/balance — View/set balance\n` +
        `/trademode paper|live — Switch mode\n` +
        `/stop — Kill switch`
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
          const dcaStatus = t.dca_filled_3 ? '3/3' : t.dca_filled_2 ? '2/3' : '1/3';
          const slTrailed = t.original_stop_loss && t.stop_loss !== t.original_stop_loss;
          msg += `${modeTag} ${dir} <b>$${t.symbol}</b> (${t.exchange})\n`;
          msg += `   Entry: $${t.entry_price} | Size: $${t.position_size} (${t.leverage}x) | DCA: ${dcaStatus}\n`;
          msg += `   TP1: $${t.tp1}${t.hit_tp1 ? ' ✅' : ''} | TP2: $${t.tp2}${t.hit_tp2 ? ' ✅' : ''} | TP3: $${t.tp3}${t.hit_tp3 ? ' ✅' : ''}${t.tp4 ? ` | TP4: $${t.tp4}` : ''}\n`;
          msg += `   SL: $${t.stop_loss}${slTrailed ? ' 🔒 (trailed)' : ''}${t.invalidation ? ` | Inv: $${t.invalidation}` : ''}\n\n`;
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
          msg += `Wins: ${s.wins} | Full Wins (TP4): ${s.full_wins} | Losses: ${s.losses}\n`;
          msg += `Invalidated: ${s.invalidated || 0} | Expired: ${s.expired || 0}\n`;
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
        this.tradeExecutor.saveConfig();
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
        this.tradeExecutor.saveConfig();
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
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Position size set to <b>$${size}</b> per trade.${this.tradeExecutor.riskPct > 0 ? '\n⚠️ Risk-based sizing is active — fixed size is used as max cap.' : ''}`);
    });

    this.bot.command('setleverage', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const lev = parseInt(args[0]);
      if (!lev || lev < 1 || lev > 50) return ctx.reply('Usage: /setleverage <1-50>\nExample: /setleverage 10');
      this.tradeExecutor.defaultLeverage = lev;
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Default leverage set to <b>${lev}x</b>${this.tradeExecutor.dynamicLeverage ? '\nDynamic leverage is ON — actual leverage scales with confidence.' : ''}`);
    });

    this.bot.command('setloss', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const loss = parseFloat(args[0]);
      if (!loss || loss < 10 || loss > 50000) return ctx.reply('Usage: /setloss <daily limit in USDT>\nExample: /setloss 500');
      this.tradeExecutor.maxDailyLoss = loss;
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Daily loss limit set to <b>$${loss}</b>`);
    });

    this.bot.command('setmaxloss', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const loss = parseFloat(args[0]);
      if (args[0] === '0' || args[0] === 'off') {
        this.tradeExecutor.maxLossPerTrade = 0;
        this.tradeExecutor.saveConfig();
        return ctx.replyWithHTML('✅ Per-trade loss cap <b>disabled</b>.');
      }
      if (!loss || loss < 1 || loss > 10000) return ctx.reply('Usage: /setmaxloss <max USDT loss per trade>\nExample: /setmaxloss 25\nUse /setmaxloss 0 to disable');
      this.tradeExecutor.maxLossPerTrade = loss;
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Max loss per trade capped at <b>$${loss}</b>`);
    });

    this.bot.command('setpositions', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const max = parseInt(args[0]);
      if (!max || max < 1 || max > 20) return ctx.reply('Usage: /setpositions <1-20>\nExample: /setpositions 3');
      this.tradeExecutor.maxConcurrentPositions = max;
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Max concurrent positions set to <b>${max}</b>`);
    });

    this.bot.command('setconfidence', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const conf = parseInt(args[0]);
      if (!conf || conf < 1 || conf > 5) return ctx.reply('Usage: /setconfidence <1-5>\nExample: /setconfidence 4\n\n1 = trade everything\n5 = only highest conviction');
      this.tradeExecutor.minConfidence = conf;
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Minimum confidence set to <b>${conf}/5</b> ${'⭐'.repeat(conf)}`);
    });

    this.bot.command('risk', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) {
        const te = this.tradeExecutor;
        const balance = await te.getBalance();
        return ctx.replyWithHTML(
          `📊 <b>RISK MANAGEMENT</b>\n\n` +
          `<b>Sizing:</b> ${te.riskPct > 0 ? `${te.riskPct}% of balance ($${(balance * te.riskPct / 100).toFixed(2)}/trade)` : `Fixed $${te.maxPositionSize}/trade`}\n` +
          `<b>Balance:</b> $${balance.toFixed(2)} (${te.mode})\n` +
          `<b>Leverage:</b> ${te.defaultLeverage}x${te.dynamicLeverage ? ' (dynamic by confidence)' : ' (fixed)'}\n` +
          `<b>Daily Loss Limit:</b> $${te.maxDailyLoss} (used: $${Math.abs(Math.min(0, te.dailyPnL)).toFixed(2)})\n` +
          `<b>Per-Trade Loss Cap:</b> ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}\n` +
          `<b>Max Positions:</b> ${te.maxConcurrentPositions}\n` +
          `<b>Min Confidence:</b> ${te.minConfidence}/5\n` +
          `<b>Signal Filter:</b> ${te.signalFilter.size > 0 ? [...te.signalFilter].join(', ') : 'All types'}\n\n` +
          `<b>Commands:</b>\n` +
          `/risk <pct> — Set risk % of balance per trade\n` +
          `/risk off — Switch to fixed size mode\n` +
          `/setsize — Fixed position size\n` +
          `/setleverage — Default leverage\n` +
          `/dynlev on|off — Dynamic leverage by confidence\n` +
          `/setloss — Daily loss limit\n` +
          `/setmaxloss — Max loss per single trade\n` +
          `/setpositions — Max concurrent positions\n` +
          `/setconfidence — Min signal confidence\n` +
          `/filter — Signal type filter`
        );
      }
      if (args[0] === 'off') {
        this.tradeExecutor.riskPct = 0;
        this.tradeExecutor.saveConfig();
        return ctx.replyWithHTML(`✅ Risk-based sizing <b>disabled</b>. Using fixed $${this.tradeExecutor.maxPositionSize}/trade.`);
      }
      const pct = parseFloat(args[0]);
      if (!pct || pct < 0.1 || pct > 10) return ctx.reply('Usage: /risk <0.1 - 10>\nExample: /risk 2 (risk 2% of balance per trade)\nUse /risk off for fixed sizing');
      this.tradeExecutor.riskPct = pct;
      this.tradeExecutor.saveConfig();
      const balance = await this.tradeExecutor.getBalance();
      ctx.replyWithHTML(`✅ Risk-based sizing set to <b>${pct}%</b> of balance\nCurrent balance: $${balance.toFixed(2)} → $${(balance * pct / 100).toFixed(2)}/trade`);
    });

    this.bot.command('dynlev', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args[0] === 'on') {
        this.tradeExecutor.dynamicLeverage = true;
        this.tradeExecutor.saveConfig();
        ctx.replyWithHTML('✅ Dynamic leverage <b>ON</b>\n\nConf 5: 2x base | Conf 4: 1x base | Conf 3: 0.6x base');
      } else if (args[0] === 'off') {
        this.tradeExecutor.dynamicLeverage = false;
        this.tradeExecutor.saveConfig();
        ctx.replyWithHTML(`✅ Dynamic leverage <b>OFF</b> — fixed at ${this.tradeExecutor.defaultLeverage}x`);
      } else {
        ctx.reply('Usage: /dynlev on or /dynlev off');
      }
    });

    this.bot.command('filter', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      if (!args.length) {
        const current = this.tradeExecutor.signalFilter.size > 0
          ? [...this.tradeExecutor.signalFilter].join(', ')
          : 'All types (no filter)';
        return ctx.replyWithHTML(
          `🔍 <b>Signal Filter:</b> ${current}\n\n` +
          `<b>Available types:</b>\nBREAKOUT, VOLUME_SPIKE, LISTING, FUNDING_SHORT\n\n` +
          `Usage:\n/filter BREAKOUT,VOLUME_SPIKE — Only trade these\n/filter off — Trade all types`
        );
      }
      if (args[0] === 'off' || args[0] === 'all') {
        this.tradeExecutor.signalFilter.clear();
        this.tradeExecutor.saveConfig();
        return ctx.replyWithHTML('✅ Signal filter <b>cleared</b> — trading all signal types.');
      }
      const types = args[0].toUpperCase().split(',').map(t => t.trim()).filter(Boolean);
      this.tradeExecutor.signalFilter = new Set(types);
      this.tradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Signal filter set: <b>${types.join(', ')}</b>\nOnly these signal types will trigger trades.`);
    });

    this.bot.command('balance', async (ctx) => {
      if (!this.tradeExecutor) return ctx.reply('Trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length && this.tradeExecutor.mode === 'paper') {
        const bal = parseFloat(args[0]);
        if (!bal || bal < 10) return ctx.reply('Usage: /balance <amount>\nExample: /balance 5000\nSets paper trading balance.');
        this.tradeExecutor.paperBalance = bal;
        this.tradeExecutor.saveConfig();
        return ctx.replyWithHTML(`✅ Paper balance set to <b>$${bal}</b>`);
      }
      ctx.reply('Fetching balances...');
      const balances = await this.tradeExecutor.getAllBalances();
      let msg = `💰 <b>ACCOUNT BALANCES</b>\n\n`;
      let totalFree = 0;
      for (const [id, b] of Object.entries(balances)) {
        msg += `${b.error ? '❌' : '✅'} <b>${id}</b>: $${b.free.toFixed(2)} free / $${b.total.toFixed(2)} total\n`;
        totalFree += b.free;
      }
      if (Object.keys(balances).length > 1) msg += `\n<b>Total free:</b> $${totalFree.toFixed(2)}\n`;
      msg += `\n📝 <b>Paper balance:</b> $${this.tradeExecutor.paperBalance.toFixed(2)}`;
      msg += `\n\nActive: <b>${this.tradeExecutor.mode.toUpperCase()}</b>`;
      ctx.replyWithHTML(msg);
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

  // ═══════════════════════════════════════════════
  // INTERACTIVE SETTINGS PANEL (inline buttons)
  // ═══════════════════════════════════════════════
  setupSettingsPanel() {
    const te = () => this.tradeExecutor;
    const check = (val, current) => val === current ? ' ✅' : '';

    // ── MAIN SETTINGS PANEL ──
    this.bot.action('cfg_main', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showSettingsMain(ctx);
    });

    this.bot.command('settings', async (ctx) => {
      if (!te()) return ctx.reply('Trade executor not initialized.');
      await this.showSettingsMain(ctx, true);
    });

    this.bot.action('cfg_main_new', async (ctx) => {
      await ctx.answerCbQuery();
      if (!te()) return ctx.reply('Trade executor not initialized.');
      await this.showSettingsMain(ctx, true);
    });

    // ── TRADE MODE ──
    this.bot.action('cfg_mode', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `⚙️ <b>TRADE MODE</b>\n\n` +
        `Current: <b>${t.mode.toUpperCase()}</b> ${t.mode === 'paper' ? '📝' : '💰'}\n\n` +
        `📝 <b>Paper</b> — Simulated trades, no real funds.\nPerfect for testing strategies risk-free.\n\n` +
        `💰 <b>Live</b> — Real orders on exchange.\nRequires API keys. Real profit and loss.`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`📝 Paper${check('paper', t.mode)}`, 'cfg_mode_paper'),
           Markup.button.callback(`💰 Live${check('live', t.mode)}`, 'cfg_mode_live')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    this.bot.action(/^cfg_mode_(paper|live)$/, async (ctx) => {
      const mode = ctx.match[1];
      te().mode = mode;
      te().enabled = true;
      te().saveConfig();
      await ctx.answerCbQuery(`Mode set to ${mode.toUpperCase()}`);
      await this.showSettingsMain(ctx);
    });

    // ── ENABLE / DISABLE ──
    this.bot.action('cfg_toggle', async (ctx) => {
      const t = te();
      t.enabled = !t.enabled;
      t.saveConfig();
      await ctx.answerCbQuery(t.enabled ? 'Trading ENABLED' : 'Trading DISABLED');
      await this.showSettingsMain(ctx);
    });

    // ── POSITION SIZE ──
    this.bot.action('cfg_size', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `💵 <b>POSITION SIZE</b>\n\n` +
        `Current: <b>$${t.maxPositionSize}</b> per trade\n` +
        `${t.riskPct > 0 ? `⚠️ Risk-based sizing is active (${t.riskPct}%) — this acts as the max cap.\n` : ''}\n` +
        `How much USDT to allocate per trade.\nWith DCA, this is split into 3 entries (1/3 each).`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`$25${check(25, t.maxPositionSize)}`, 'cfg_size_25'),
           Markup.button.callback(`$50${check(50, t.maxPositionSize)}`, 'cfg_size_50'),
           Markup.button.callback(`$100${check(100, t.maxPositionSize)}`, 'cfg_size_100')],
          [Markup.button.callback(`$250${check(250, t.maxPositionSize)}`, 'cfg_size_250'),
           Markup.button.callback(`$500${check(500, t.maxPositionSize)}`, 'cfg_size_500'),
           Markup.button.callback(`$1000${check(1000, t.maxPositionSize)}`, 'cfg_size_1000')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const size of [25, 50, 100, 250, 500, 1000]) {
      this.bot.action(`cfg_size_${size}`, async (ctx) => {
        te().maxPositionSize = size;
        te().saveConfig();
        await ctx.answerCbQuery(`Position size: $${size}`);
        ctx.editMessageText(
          `✅ Position size set to <b>$${size}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('💵 Change Size', 'cfg_size'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── RISK % SIZING ──
    this.bot.action('cfg_risk', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `📊 <b>RISK-BASED SIZING</b>\n\n` +
        `Current: <b>${t.riskPct > 0 ? `${t.riskPct}% of balance` : 'OFF (fixed size)'}</b>\n\n` +
        `Instead of a fixed dollar amount, risk a % of your balance per trade.\n` +
        `Example: 2% of $1000 = $20 per trade.\n\n` +
        `🟢 <b>1%</b> — Conservative. Survives 50+ losing trades.\n` +
        `🟡 <b>2%</b> — Standard. Good balance of growth vs protection.\n` +
        `🟠 <b>3%</b> — Moderate. Faster growth, faster drawdown.\n` +
        `🔴 <b>5%</b> — Aggressive. High risk, high reward.`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`OFF (fixed $)${check(0, t.riskPct)}`, 'cfg_risk_0'),
           Markup.button.callback(`1%${check(1, t.riskPct)}`, 'cfg_risk_1')],
          [Markup.button.callback(`2%${check(2, t.riskPct)}`, 'cfg_risk_2'),
           Markup.button.callback(`3%${check(3, t.riskPct)}`, 'cfg_risk_3')],
          [Markup.button.callback(`5%${check(5, t.riskPct)}`, 'cfg_risk_5'),
           Markup.button.callback(`10%${check(10, t.riskPct)}`, 'cfg_risk_10')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const pct of [0, 1, 2, 3, 5, 10]) {
      this.bot.action(`cfg_risk_${pct}`, async (ctx) => {
        te().riskPct = pct;
        te().saveConfig();
        const label = pct === 0 ? 'OFF — using fixed size' : `${pct}% of balance`;
        await ctx.answerCbQuery(`Risk sizing: ${label}`);
        ctx.editMessageText(
          `✅ Risk-based sizing: <b>${label}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('📊 Change Risk %', 'cfg_risk'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── LEVERAGE ──
    this.bot.action('cfg_lev', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `⚡ <b>LEVERAGE</b>\n\n` +
        `Current: <b>${t.defaultLeverage}x</b>${t.dynamicLeverage ? ' (dynamic)' : ' (fixed)'}\n\n` +
        `Multiplies your position size and both gains and losses.\n\n` +
        `🟢 <b>2-3x</b> — Safe. Small moves, small risk.\n` +
        `🟡 <b>5x</b> — Standard. Balanced risk/reward.\n` +
        `🟠 <b>10x</b> — Aggressive. 10% move = 100% gain or loss.\n` +
        `🔴 <b>20x</b> — Very risky. Liquidation is close.\n\n` +
        `<b>Dynamic leverage</b> adjusts automatically:\n` +
        `Conf ⭐⭐⭐⭐⭐ = 2x base | ⭐⭐⭐⭐ = 1x | ⭐⭐⭐ = 0.6x`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`2x${check(2, t.defaultLeverage)}`, 'cfg_lev_2'),
           Markup.button.callback(`3x${check(3, t.defaultLeverage)}`, 'cfg_lev_3'),
           Markup.button.callback(`5x${check(5, t.defaultLeverage)}`, 'cfg_lev_5')],
          [Markup.button.callback(`10x${check(10, t.defaultLeverage)}`, 'cfg_lev_10'),
           Markup.button.callback(`15x${check(15, t.defaultLeverage)}`, 'cfg_lev_15'),
           Markup.button.callback(`20x${check(20, t.defaultLeverage)}`, 'cfg_lev_20')],
          [Markup.button.callback(`Dynamic: ${t.dynamicLeverage ? '✅ ON' : '❌ OFF'}`, 'cfg_dynlev_toggle')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const lev of [2, 3, 5, 10, 15, 20]) {
      this.bot.action(`cfg_lev_${lev}`, async (ctx) => {
        te().defaultLeverage = lev;
        te().saveConfig();
        await ctx.answerCbQuery(`Leverage: ${lev}x`);
        ctx.editMessageText(
          `✅ Default leverage set to <b>${lev}x</b>${te().dynamicLeverage ? '\nDynamic mode ON — actual leverage scales with confidence.' : ''}`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Change Leverage', 'cfg_lev'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }
    this.bot.action('cfg_dynlev_toggle', async (ctx) => {
      const t = te();
      t.dynamicLeverage = !t.dynamicLeverage;
      t.saveConfig();
      await ctx.answerCbQuery(`Dynamic leverage: ${t.dynamicLeverage ? 'ON' : 'OFF'}`);
      // Re-render leverage panel
      ctx.editMessageText(
        `⚡ <b>LEVERAGE</b>\n\nDynamic leverage: <b>${t.dynamicLeverage ? '✅ ON' : '❌ OFF'}</b>\nBase: <b>${t.defaultLeverage}x</b>`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`2x${check(2, t.defaultLeverage)}`, 'cfg_lev_2'),
           Markup.button.callback(`3x${check(3, t.defaultLeverage)}`, 'cfg_lev_3'),
           Markup.button.callback(`5x${check(5, t.defaultLeverage)}`, 'cfg_lev_5')],
          [Markup.button.callback(`10x${check(10, t.defaultLeverage)}`, 'cfg_lev_10'),
           Markup.button.callback(`15x${check(15, t.defaultLeverage)}`, 'cfg_lev_15'),
           Markup.button.callback(`20x${check(20, t.defaultLeverage)}`, 'cfg_lev_20')],
          [Markup.button.callback(`Dynamic: ${t.dynamicLeverage ? '✅ ON' : '❌ OFF'}`, 'cfg_dynlev_toggle')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });

    // ── DAILY LOSS LIMIT ──
    this.bot.action('cfg_dailyloss', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `🛡️ <b>DAILY LOSS LIMIT</b>\n\n` +
        `Current: <b>$${t.maxDailyLoss}</b>\n` +
        `Today's P&L: $${t.dailyPnL.toFixed(2)}\n\n` +
        `When total daily losses reach this limit, the bot stops opening new trades until midnight UTC.\n` +
        `Existing positions remain open with their own SL.`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`$50${check(50, t.maxDailyLoss)}`, 'cfg_dloss_50'),
           Markup.button.callback(`$100${check(100, t.maxDailyLoss)}`, 'cfg_dloss_100'),
           Markup.button.callback(`$200${check(200, t.maxDailyLoss)}`, 'cfg_dloss_200')],
          [Markup.button.callback(`$500${check(500, t.maxDailyLoss)}`, 'cfg_dloss_500'),
           Markup.button.callback(`$1000${check(1000, t.maxDailyLoss)}`, 'cfg_dloss_1000'),
           Markup.button.callback(`$2500${check(2500, t.maxDailyLoss)}`, 'cfg_dloss_2500')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const loss of [50, 100, 200, 500, 1000, 2500]) {
      this.bot.action(`cfg_dloss_${loss}`, async (ctx) => {
        te().maxDailyLoss = loss;
        te().saveConfig();
        await ctx.answerCbQuery(`Daily loss limit: $${loss}`);
        ctx.editMessageText(
          `✅ Daily loss limit set to <b>$${loss}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🛡️ Change Limit', 'cfg_dailyloss'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── PER-TRADE LOSS CAP ──
    this.bot.action('cfg_tradeloss', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `🔒 <b>PER-TRADE LOSS CAP</b>\n\n` +
        `Current: <b>${t.maxLossPerTrade > 0 ? `$${t.maxLossPerTrade}` : 'OFF'}</b>\n\n` +
        `Caps the maximum USDT you can lose on a single trade.\n` +
        `When risk-based sizing is active, this overrides if the calculated size would exceed the cap.\n\n` +
        `<i>This limits position size, not the stop loss distance.</i>`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`OFF${check(0, t.maxLossPerTrade)}`, 'cfg_tloss_0'),
           Markup.button.callback(`$10${check(10, t.maxLossPerTrade)}`, 'cfg_tloss_10'),
           Markup.button.callback(`$25${check(25, t.maxLossPerTrade)}`, 'cfg_tloss_25')],
          [Markup.button.callback(`$50${check(50, t.maxLossPerTrade)}`, 'cfg_tloss_50'),
           Markup.button.callback(`$100${check(100, t.maxLossPerTrade)}`, 'cfg_tloss_100'),
           Markup.button.callback(`$250${check(250, t.maxLossPerTrade)}`, 'cfg_tloss_250')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const loss of [0, 10, 25, 50, 100, 250]) {
      this.bot.action(`cfg_tloss_${loss}`, async (ctx) => {
        te().maxLossPerTrade = loss;
        te().saveConfig();
        const label = loss === 0 ? 'OFF' : `$${loss}`;
        await ctx.answerCbQuery(`Per-trade loss cap: ${label}`);
        ctx.editMessageText(
          `✅ Per-trade loss cap: <b>${label}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔒 Change Cap', 'cfg_tradeloss'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── MAX POSITIONS ──
    this.bot.action('cfg_maxpos', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `📊 <b>MAX CONCURRENT POSITIONS</b>\n\n` +
        `Current: <b>${t.maxConcurrentPositions}</b>\n\n` +
        `How many trades can be open at the same time.\n` +
        `Lower = more focused, less capital spread.\n` +
        `Higher = more opportunities, but more exposure.\n\n` +
        `🟢 <b>1-2</b> — Very focused. Best for small accounts.\n` +
        `🟡 <b>3-5</b> — Balanced. Standard for most strategies.\n` +
        `🟠 <b>8-10</b> — Wide net. Needs larger capital.`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`1${check(1, t.maxConcurrentPositions)}`, 'cfg_mpos_1'),
           Markup.button.callback(`2${check(2, t.maxConcurrentPositions)}`, 'cfg_mpos_2'),
           Markup.button.callback(`3${check(3, t.maxConcurrentPositions)}`, 'cfg_mpos_3')],
          [Markup.button.callback(`5${check(5, t.maxConcurrentPositions)}`, 'cfg_mpos_5'),
           Markup.button.callback(`8${check(8, t.maxConcurrentPositions)}`, 'cfg_mpos_8'),
           Markup.button.callback(`10${check(10, t.maxConcurrentPositions)}`, 'cfg_mpos_10')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const pos of [1, 2, 3, 5, 8, 10]) {
      this.bot.action(`cfg_mpos_${pos}`, async (ctx) => {
        te().maxConcurrentPositions = pos;
        te().saveConfig();
        await ctx.answerCbQuery(`Max positions: ${pos}`);
        ctx.editMessageText(
          `✅ Max concurrent positions: <b>${pos}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('📊 Change', 'cfg_maxpos'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── MIN CONFIDENCE ──
    this.bot.action('cfg_conf', async (ctx) => {
      await ctx.answerCbQuery();
      const t = te();
      ctx.editMessageText(
        `⭐ <b>MINIMUM CONFIDENCE</b>\n\n` +
        `Current: <b>${t.minConfidence}/5</b> ${'⭐'.repeat(t.minConfidence)}\n\n` +
        `Signals below this confidence level are ignored.\n` +
        `Confidence is based on how many indicators align.\n\n` +
        `⭐ <b>1</b> — Trade everything. Maximum trades, lowest quality.\n` +
        `⭐⭐ <b>2</b> — Very loose. Catches most opportunities.\n` +
        `⭐⭐⭐ <b>3</b> — Moderate. Decent filter.\n` +
        `⭐⭐⭐⭐ <b>4</b> — Strict. Only strong setups. <i>(Recommended)</i>\n` +
        `⭐⭐⭐⭐⭐ <b>5</b> — Maximum. Only the best of the best.`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`⭐ 1${check(1, t.minConfidence)}`, 'cfg_conf_1'),
           Markup.button.callback(`⭐⭐ 2${check(2, t.minConfidence)}`, 'cfg_conf_2')],
          [Markup.button.callback(`⭐⭐⭐ 3${check(3, t.minConfidence)}`, 'cfg_conf_3'),
           Markup.button.callback(`⭐⭐⭐⭐ 4${check(4, t.minConfidence)}`, 'cfg_conf_4')],
          [Markup.button.callback(`⭐⭐⭐⭐⭐ 5${check(5, t.minConfidence)}`, 'cfg_conf_5')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const conf of [1, 2, 3, 4, 5]) {
      this.bot.action(`cfg_conf_${conf}`, async (ctx) => {
        te().minConfidence = conf;
        te().saveConfig();
        await ctx.answerCbQuery(`Min confidence: ${conf}/5`);
        ctx.editMessageText(
          `✅ Minimum confidence: <b>${conf}/5</b> ${'⭐'.repeat(conf)}`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('⭐ Change', 'cfg_conf'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── SIGNAL FILTER ──
    this.bot.action('cfg_filter', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showFilterPanel(ctx);
    });
    const signalTypes = ['BREAKOUT', 'VOLUME_SPIKE', 'LISTING', 'FUNDING_SHORT'];
    for (const type of signalTypes) {
      this.bot.action(`cfg_filt_${type}`, async (ctx) => {
        const t = te();
        if (t.signalFilter.has(type)) {
          t.signalFilter.delete(type);
        } else {
          t.signalFilter.add(type);
        }
        t.saveConfig();
        await ctx.answerCbQuery(`${type}: ${t.signalFilter.has(type) ? 'ON' : 'OFF'}`);
        await this.showFilterPanel(ctx);
      });
    }
    this.bot.action('cfg_filt_all', async (ctx) => {
      te().signalFilter.clear();
      te().saveConfig();
      await ctx.answerCbQuery('All signal types enabled');
      await this.showFilterPanel(ctx);
    });

    // ── BALANCE ──
    this.bot.action('cfg_balance', async (ctx) => {
      await ctx.answerCbQuery('Fetching balances...');
      const t = te();
      const balances = await t.getAllBalances();

      let balText = '';
      let totalFree = 0;
      for (const [id, b] of Object.entries(balances)) {
        const icon = b.error ? '❌' : '✅';
        balText += `${icon} <b>${id}</b>: $${b.free.toFixed(2)} free / $${b.total.toFixed(2)} total${b.used > 0 ? ` ($${b.used.toFixed(2)} in use)` : ''}\n`;
        totalFree += b.free;
      }
      if (!Object.keys(balances).length) balText = '<i>No exchange API keys configured</i>\n';

      const paperBal = t.paperBalance;
      ctx.editMessageText(
        `💰 <b>ACCOUNT BALANCES</b>\n\n` +
        `<b>═══ Exchange Accounts ═══</b>\n${balText}\n` +
        `<b>═══ Paper Account ═══</b>\n` +
        `📝 Paper Balance: <b>$${paperBal.toFixed(2)}</b>\n\n` +
        `Active mode: <b>${t.mode.toUpperCase()}</b> ${t.mode === 'paper' ? `(using $${paperBal.toFixed(2)})` : `(using $${totalFree.toFixed(2)} across exchanges)`}\n` +
        `${t.riskPct > 0 ? `Risk sizing: ${t.riskPct}% = $${((t.mode === 'paper' ? paperBal : totalFree) * t.riskPct / 100).toFixed(2)}/trade` : `Fixed sizing: $${t.maxPositionSize}/trade`}`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh Balances', 'cfg_balance')],
          ...(t.mode === 'paper' ? [
            [Markup.button.callback(`$500${check(500, Math.round(t.paperBalance))}`, 'cfg_bal_500'),
             Markup.button.callback(`$1000${check(1000, Math.round(t.paperBalance))}`, 'cfg_bal_1000'),
             Markup.button.callback(`$2500${check(2500, Math.round(t.paperBalance))}`, 'cfg_bal_2500')],
            [Markup.button.callback(`$5000${check(5000, Math.round(t.paperBalance))}`, 'cfg_bal_5000'),
             Markup.button.callback(`$10000${check(10000, Math.round(t.paperBalance))}`, 'cfg_bal_10000'),
             Markup.button.callback(`$25000${check(25000, Math.round(t.paperBalance))}`, 'cfg_bal_25000')],
          ] : []),
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const bal of [500, 1000, 2500, 5000, 10000, 25000]) {
      this.bot.action(`cfg_bal_${bal}`, async (ctx) => {
        if (te().mode !== 'paper') return ctx.answerCbQuery('Only available in paper mode');
        te().paperBalance = bal;
        te().saveConfig();
        await ctx.answerCbQuery(`Paper balance: $${bal}`);
        ctx.editMessageText(
          `✅ Paper balance set to <b>$${bal}</b>${te().riskPct > 0 ? `\nTrade size: $${(bal * te().riskPct / 100).toFixed(2)} (${te().riskPct}%)` : ''}`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('💰 Change Balance', 'cfg_balance'), Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup }
        );
      });
    }

    // ── ACTIVE TRADES ──
    this.bot.action('cfg_trades', async (ctx) => {
      await ctx.answerCbQuery('Loading trades...');
      try {
        const trades = await db.getOpenTrades();
        if (!trades.length) {
          return ctx.editMessageText(
            `📋 <b>ACTIVE TRADES</b>\n\n<i>No open positions.</i>`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'cfg_trades')],
              [Markup.button.callback('⬅️ Settings', 'cfg_main')],
            ]).reply_markup }
          );
        }

        const te = this.tradeExecutor;
        let msg = `📋 <b>ACTIVE TRADES</b> (${trades.length})\n\n`;
        let totalPnl = 0;

        for (const t of trades) {
          let currentPrice = null;
          try {
            const pairs = [`${t.symbol}/USDT:USDT`, `${t.symbol}/USDT`];
            for (const [, ex] of Object.entries(te.exchanges)) {
              for (const pair of pairs) {
                if (ex.markets?.[pair]) {
                  const ticker = await ex.fetchTicker(pair);
                  currentPrice = ticker.last;
                  break;
                }
              }
              if (currentPrice) break;
            }
          } catch (e) { /* skip */ }

          const isLong = t.direction === 'long';
          const pnlPct = currentPrice
            ? (isLong ? ((currentPrice - t.entry_price) / t.entry_price) * 100
                      : ((t.entry_price - currentPrice) / t.entry_price) * 100)
            : 0;
          const pnlLev = pnlPct * (t.leverage || 1);
          const pnlUsd = (pnlPct / 100) * (t.position_size || 0) * (t.leverage || 1);
          totalPnl += pnlUsd;

          const icon = pnlPct > 0 ? '🟢' : pnlPct < -5 ? '🔴' : '🟡';
          const dir = isLong ? '⬆️' : '⬇️';
          const dca = t.dca_filled_3 ? '3/3' : t.dca_filled_2 ? '2/3' : '1/3';
          const tpHit = [t.hit_tp1 ? 'TP1✅' : '', t.hit_tp2 ? 'TP2✅' : '', t.hit_tp3 ? 'TP3✅' : ''].filter(Boolean).join(' ') || 'none';

          msg += `${icon}${dir} <b>${t.symbol}</b> (${t.exchange})\n`;
          msg += `Entry: $${t.entry_price.toPrecision(6)} → $${currentPrice ? currentPrice.toPrecision(6) : '?'}\n`;
          msg += `PnL: <b>${pnlLev >= 0 ? '+' : ''}${pnlLev.toFixed(1)}%</b> ($${pnlUsd.toFixed(2)}) | ${t.leverage}x\n`;
          msg += `DCA: ${dca} | TP: ${tpHit} | SL: $${t.stop_loss.toPrecision(6)}\n`;
          msg += `Size: $${(t.position_size || 0).toFixed(2)} | ${t.mode}\n\n`;
        }

        msg += `<b>Total unrealized PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</b>`;

        ctx.editMessageText(msg, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'cfg_trades')],
            [Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup,
        });
      } catch (e) {
        logger.error(`Active trades panel error: ${e.message}`);
        ctx.editMessageText('❌ Failed to load trades.', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'cfg_main')]]).reply_markup,
        });
      }
    });
  }

  // Render the main settings panel
  async showSettingsMain(ctx, isNewMessage = false) {
    const t = this.tradeExecutor;
    const balance = await t.getBalance();
    const sizeDisplay = t.riskPct > 0
      ? `${t.riskPct}% ($${(balance * t.riskPct / 100).toFixed(2)})`
      : `$${t.maxPositionSize}`;
    const filterDisplay = t.signalFilter.size > 0 ? [...t.signalFilter].join(', ') : 'All';

    let balLine = '';
    if (t.mode === 'paper') {
      balLine = `📝 Paper Balance: <b>$${t.paperBalance.toFixed(2)}</b>`;
    } else {
      const liveBalances = await t.getAllBalances();
      let totalFree = 0;
      const parts = [];
      for (const [id, b] of Object.entries(liveBalances)) {
        parts.push(`${id}: $${b.free.toFixed(2)}`);
        totalFree += b.free;
      }
      balLine = `💰 Live Balance: <b>$${totalFree.toFixed(2)}</b>${parts.length ? ` (${parts.join(' | ')})` : ''}`;
    }

    const text =
      `⚙️ <b>TRADING SETTINGS</b>\n\n` +
      `${t.mode === 'paper' ? '📝' : '💰'} Mode: <b>${t.mode.toUpperCase()}</b> | ${t.enabled ? '✅ ON' : '❌ OFF'}\n` +
      `${balLine}\n` +
      `💵 Size: <b>${sizeDisplay}</b>/trade\n` +
      `⚡ Leverage: <b>${t.defaultLeverage}x</b>${t.dynamicLeverage ? ' (dynamic)' : ''}\n` +
      `🛡️ Daily Loss: <b>$${t.maxDailyLoss}</b> | Per-Trade: <b>${t.maxLossPerTrade > 0 ? `$${t.maxLossPerTrade}` : 'Off'}</b>\n` +
      `📊 Max Positions: <b>${t.maxConcurrentPositions}</b>\n` +
      `⭐ Min Confidence: <b>${t.minConfidence}/5</b>\n` +
      `🔍 Filter: <b>${filterDisplay}</b>\n` +
      `📈 Today P&L: <b>$${t.dailyPnL.toFixed(2)}</b>\n\n` +
      `Tap any button below to configure:`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`${t.mode === 'paper' ? '📝' : '💰'} Mode: ${t.mode.toUpperCase()}`, 'cfg_mode'),
       Markup.button.callback(`${t.enabled ? '✅ ON' : '❌ OFF'}`, 'cfg_toggle')],
      [Markup.button.callback(`💵 Size: $${t.maxPositionSize}`, 'cfg_size'),
       Markup.button.callback(`📊 Risk: ${t.riskPct > 0 ? `${t.riskPct}%` : 'OFF'}`, 'cfg_risk')],
      [Markup.button.callback(`⚡ Leverage: ${t.defaultLeverage}x`, 'cfg_lev'),
       Markup.button.callback(`💰 Balance`, 'cfg_balance')],
      [Markup.button.callback(`🛡️ Daily Loss: $${t.maxDailyLoss}`, 'cfg_dailyloss'),
       Markup.button.callback(`🔒 Trade Cap: ${t.maxLossPerTrade > 0 ? `$${t.maxLossPerTrade}` : 'Off'}`, 'cfg_tradeloss')],
      [Markup.button.callback(`📊 Positions: ${t.maxConcurrentPositions}`, 'cfg_maxpos'),
       Markup.button.callback(`⭐ Confidence: ${t.minConfidence}/5`, 'cfg_conf')],
      [Markup.button.callback(`🔍 Signal Filter`, 'cfg_filter'),
       Markup.button.callback(`📋 Active Trades`, 'cfg_trades')],
      [Markup.button.callback('🛑 Kill Switch', 'action_stop')],
    ]);

    if (isNewMessage) {
      await ctx.replyWithHTML(text, keyboard);
    } else {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
    }
  }

  // Render the signal filter panel
  async showFilterPanel(ctx) {
    const t = this.tradeExecutor;
    const types = ['BREAKOUT', 'VOLUME_SPIKE', 'LISTING', 'FUNDING_SHORT'];
    const noFilter = t.signalFilter.size === 0;

    const typeDescriptions = {
      BREAKOUT: '🚀 Technical breakout with indicator confluence',
      VOLUME_SPIKE: '📊 Unusual volume spike (3x+ average)',
      LISTING: '🆕 New exchange listing detected',
      FUNDING_SHORT: '📉 Extreme funding rate reversal',
    };

    let desc = `🔍 <b>SIGNAL TYPE FILTER</b>\n\n`;
    desc += `${noFilter ? '✅ Trading <b>ALL</b> signal types' : `Trading only: <b>${[...t.signalFilter].join(', ')}</b>`}\n\n`;
    desc += `Toggle which signal types trigger auto-trades:\n\n`;
    for (const type of types) {
      const active = noFilter || t.signalFilter.has(type);
      desc += `${active ? '✅' : '❌'} ${typeDescriptions[type]}\n`;
    }
    desc += `\n<i>Tap to toggle each type. "All Types" clears the filter.</i>`;

    ctx.editMessageText(desc, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`${noFilter ? '✅' : '☑️'} All Types`, 'cfg_filt_all')],
        ...types.map(type => [
          Markup.button.callback(
            `${(noFilter || t.signalFilter.has(type)) ? '✅' : '❌'} ${type}`,
            `cfg_filt_${type}`
          ),
        ]),
        [Markup.button.callback('⬅️ Back', 'cfg_main')],
      ]).reply_markup,
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
      { command: 'settings', description: 'Interactive settings panel (buttons)' },
      { command: 'risk', description: 'Risk management panel' },
      { command: 'setsize', description: 'Set position size (e.g. /setsize 100)' },
      { command: 'setleverage', description: 'Set leverage (e.g. /setleverage 10)' },
      { command: 'dynlev', description: 'Dynamic leverage on/off' },
      { command: 'setloss', description: 'Set daily loss limit' },
      { command: 'setmaxloss', description: 'Set max loss per trade' },
      { command: 'setpositions', description: 'Set max concurrent positions' },
      { command: 'setconfidence', description: 'Set min signal confidence' },
      { command: 'filter', description: 'Filter signal types to trade' },
      { command: 'balance', description: 'View/set paper balance' },
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
