const { Telegraf, Markup } = require('telegraf');
const logger = require('../utils/logger');
const config = require('../utils/config');
const db = require('../db/database');
const { formatSignalMessage, formatListingAlert, formatWhaleAlert, formatScanResult, escapeHtml } = require('../utils/formatting');

class TelegramBot {
  constructor({ technicalScanner, socialScanner, onchainTracker }) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.channelId = config.telegram.channelId;
    this.technicalScanner = technicalScanner;
    this.socialScanner = socialScanner;
    this.onchainTracker = onchainTracker;
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
          [Markup.button.callback('🐋 Whale Tracker', 'action_whale_info'), Markup.button.callback('📊 Stats', 'action_stats')],
          [Markup.button.callback('📋 Review Signals', 'action_review')],
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
      { command: 'whale', description: 'Track on-chain whale activity' },
      { command: 'stats', description: 'Signal performance & win rate' },
      { command: 'review', description: 'Review past signal performance' },
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
