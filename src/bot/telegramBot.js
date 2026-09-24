const { Telegraf, Markup } = require('telegraf');
const logger = require('../utils/logger');
const config = require('../utils/config');
const db = require('../db/database');
const { formatSignalMessage, formatListingAlert, formatWhaleAlert, formatScanResult, escapeHtml } = require('../utils/formatting');
const { generateSignalChart, generateSetupChart } = require('../utils/chartGenerator');

class TelegramBot {
  constructor({ technicalScanner, socialScanner, onchainTracker, onchainScanner, flowScanner, marketIntel, tradeExecutor, onchainTradeExecutor, swingTradeExecutor, swingScanner, dzTradeExecutor }) {
    this.bot = new Telegraf(config.telegram.botToken);
    this.bot.catch((err) => {
      const msg = err?.message || String(err);
      if (msg.includes('message is not modified') || msg.includes('query is too old') || msg.includes('bot was blocked')) {
        return;
      }
      logger.error(`Telegraf error: ${msg}`);
    });
    this.channelId = config.telegram.channelId;
    this.technicalScanner = technicalScanner;
    this.socialScanner = socialScanner;
    this.onchainTracker = onchainTracker;
    this.onchainScanner = onchainScanner;
    this.flowScanner = flowScanner;
    this.marketIntel = marketIntel;
    this.tradeExecutor = tradeExecutor;
    this.onchainTradeExecutor = onchainTradeExecutor;
    this.swingTradeExecutor = swingTradeExecutor;
    this.swingScanner = swingScanner;
    this.dzTradeExecutor = dzTradeExecutor;
    this.userPaperEngine = null; // wired from index.js
    // Access control MUST be registered before any command handlers
    this.setupAccess();
    this.setupCommands();
    this.setupSettingsPanel();
  }

  setupAccess() {
    // Commands/actions reserved for the admin (trading control, settings, user mgmt)
    const ADMIN_COMMANDS = new Set([
      'trade', 'stop', 'trademode', 'setsize', 'setleverage', 'setloss', 'setmaxloss',
      'onchaintrade', 'onchainsize', 'onchainlev', 'onchainloss', 'onchainmaxloss',
      'onchainpositions', 'onchainminscore', 'onchainstats', 'onchainopen', 'onchainclose', 'onchainstop', 'onchainsettings',
      'swingtrade', 'swingsize', 'swinglev', 'swingopen', 'swingclose', 'swingstats', 'swingperf', 'swingwatchlist',
      'dzopen', 'dzclose', 'dzstats', 'dzperf', 'dzsettings', 'dzmaxloss', 'swingmaxloss',
      'panel', 'swingsettings',
      'setpositions', 'setconfidence', 'risk', 'dynlev', 'filter', 'balance',
      'settings', 'users', 'grant', 'revoke', 'testchart',
    ]);
    const ADMIN_ACTIONS = /^(cfg_|oc_|sw_|dz_|panel_)/;
    const PUBLIC_COMMANDS = new Set([
      'start', 'menu', 'help', 'guide', 'signals', 'scan', 'trending', 'funding', 'stats',
      'intel', 'dex', 'whale', 'review', 'analyse', 'positions', 'pnl',
      'follow', 'unfollow', 'mypaper', 'myaccess',
      'setmysize', 'setmyleverage', 'buy', 'sell', 'closetrade', 'mypositions', 'mypnl',
      'onchainfollow', 'onchainunfollow', 'setmyscore', 'setmyloss', 'setmymaxloss',
      'setmypositions', 'myonchainstats', 'myonchain', 'mysettings', 'alertperf', 'flows',
      'swingfollow', 'swingunfollow',
    ]);

    this.bot.use(async (ctx, next) => {
      try {
        const from = ctx.from;
        if (!from || !from.id) return next(); // channel posts / no user context

        let user = await db.getUser(from.id);

        // Bootstrap: env-declared admins are created/promoted on every contact
        // (also rescues an existing pending/revoked row created before the env var was set)
        if (config.telegram.adminIds.includes(from.id) && (!user || user.role !== 'admin' || user.status !== 'active')) {
          user = (await db.grantUser(from.id, from.id, 'admin'))
            || (await db.createUser(from.id, from.username, 'admin', 'active'));
          logger.info(`Bootstrap admin registered/promoted: ${from.id}`);
        }

        if (!user) {
          // First contact — register as pending and alert admins
          user = await db.createUser(from.id, from.username, 'trader', 'pending');
          logger.info(`New access request from ${from.id} (@${from.username || '?'})`);
          await ctx.replyWithHTML(
            `🔒 <b>Access Request Submitted</b>\n\n` +
            `Your Telegram ID: <code>${from.id}</code>\n\n` +
            `An administrator has been notified. You'll be able to use the bot once your access is approved.`
          );
          const admins = (await db.listUsers()).filter(u => u.role === 'admin' && u.status === 'active');
          for (const admin of admins) {
            try {
              await this.bot.telegram.sendMessage(
                admin.telegram_id,
                `🔔 <b>New Access Request</b>\n\n` +
                `User: @${escapeHtml(from.username || String(from.id))}\n` +
                `ID: <code>${from.id}</code>\n\n` +
                `Approve with: <code>/grant ${from.id}</code>`
              );
            } catch (e) { logger.warn(`Admin notify failed (${admin.telegram_id}): ${e.message}`); }
          }
          return;
        }

        if (user.status !== 'active') {
          if (ctx.updateType === 'message' && ctx.message?.text?.startsWith('/start')) {
            await ctx.replyWithHTML(user.status === 'pending'
              ? `⏳ Your access is still <b>pending approval</b>. You'll be notified once approved.`
              : `🚫 Your access has been <b>revoked</b>. Contact an administrator.`);
          }
          return;
        }

        // Admin gating on commands and settings-panel callbacks
        const isAdmin = user.role === 'admin';
        if (!isAdmin) {
          if (ctx.updateType === 'message' && ctx.message?.text?.startsWith('/')) {
            const cmd = ctx.message.text.slice(1).split(/[\s@]/)[0];
            if (ADMIN_COMMANDS.has(cmd)) {
              await ctx.replyWithHTML(`🚫 <b>Admin only.</b> This command controls live trading and is restricted.`);
              return;
            }
            if (cmd && !PUBLIC_COMMANDS.has(cmd)) {
              await ctx.replyWithHTML(`❓ Unknown command. Try /help or /menu.`);
              return;
            }
          }
          if (ctx.updateType === 'callback_query' && ADMIN_ACTIONS.test(ctx.callbackQuery?.data || '')) {
            await ctx.answerCbQuery('Admin only');
            return;
          }
          // Block non-cfg inline actions that mutate trading state
          const traderAllowedActions = new Set(['action_signals', 'action_scan', 'action_trending', 'action_funding', 'action_whale_info', 'action_stats', 'action_intel', 'action_dex', 'action_review', 'action_help']);
          if (ctx.updateType === 'callback_query' && ctx.callbackQuery?.data?.startsWith('action_')) {
            if (!traderAllowedActions.has(ctx.callbackQuery.data)) {
              await ctx.answerCbQuery('Admin only');
              return;
            }
          }
        }

        ctx.state.user = user;
        return next();
      } catch (e) {
        logger.error(`Access control error: ${e.message}`);
        // Fail closed on DB errors — never let an unknown user through
        try { await ctx.replyWithHTML('⚠️ Temporary error verifying access. Try again shortly.'); } catch (_) {}
      }
    });
  }

  setupCommands() {
    this.bot.command('start', (ctx) => {
      const isAdmin = ctx.state.user?.role === 'admin';
      ctx.replyWithHTML(
        `<b>🤖 CryptoSignal Bot</b>\n\n` +
        `<b>📡 Signals &amp; Scanning:</b>\n` +
        `/menu — Interactive control panel\n` +
        `/signals — Active signals\n` +
        `/scan — Run market scan now\n` +
        `/stats — Signal win rate stats\n` +
        `/alertperf — Onchain/flow alert P&L tracker\n` +
        `/review — Past signal performance\n\n` +
        `<b>📝 Your Paper Portfolio:</b>\n` +
        `/guide — How to start paper trading\n` +
        `/follow — Auto-paper every new signal\n` +
        `/unfollow — Stop auto-papering\n` +
        `/buy &lt;SYMBOL&gt; — Open manual paper long\n` +
        `/sell &lt;SYMBOL&gt; — Open manual paper short\n` +
        `/closetrade &lt;SYMBOL&gt; — Close a position\n` +
        `/mypositions — View open positions\n` +
        `/mypaper — Your portfolio overview\n` +
        `/mypnl — Your P&amp;L history\n` +
        `/setmysize &lt;$&gt; — Set margin per trade\n` +
        `/setmyleverage &lt;x&gt; — Set leverage\n\n` +
        `<b>🔗 Onchain Paper Trading:</b>\n` +
        `/onchainfollow — Auto-paper onchain signals\n` +
        `/onchainunfollow — Stop onchain auto-paper\n` +
        `/setmyscore &lt;30-100&gt; — Min score filter\n` +
        `/setmyloss &lt;$&gt; — Daily loss limit\n` +
        `/setmymaxloss &lt;$&gt; — Per-trade max loss\n` +
        `/setmypositions &lt;1-10&gt; — Max concurrent\n` +
        `/myonchain — Open onchain positions\n` +
        `/myonchainstats — Onchain P&amp;L stats\n` +
        `/mysettings — All your settings\n\n` +
        (isAdmin
          ? `<b>👑 Admin — Trading Control:</b>\n` +
            `/trade — Trading status &amp; config\n` +
            `/settings — Interactive settings panel\n` +
            `/positions — Open positions\n` +
            `/pnl — Trade P&amp;L\n` +
            `/trademode paper|live — Switch mode\n` +
            `/stop — Kill switch (close all)\n` +
            `/users /grant &lt;id&gt; /revoke &lt;id&gt; — Access control\n\n` +
            `<b>🔗 Onchain Auto-Trade:</b>\n` +
            `/onchaintrade — Status &amp; control\n` +
            `/onchainstats — Onchain P&amp;L\n\n`
          : `<i>Paper trading only — live trading is admin-managed.</i>\n\n`) +
        `Signals are delivered automatically.`
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
      const tokens = await this.socialScanner.scanTrending();
      ctx.replyWithHTML(this.socialScanner.formatTrending(tokens));
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
      `📈 VREVERSAL — Capitulation reversal reclaim\n` +
      `🐋 WHALE — Large on-chain movement\n` +
      `📉 FUNDING_SHORT — Extreme funding rate\n\n` +
      `<b>Confidence:</b> ⭐⭐⭐⭐⭐ (1-5 stars)\n` +
      `Higher confidence = stronger confluence of signals`
    ));

    this.bot.command('guide', (ctx) => ctx.replyWithHTML(
      `<b>Welcome to Paper Trading!</b>\n` +
      `Practice trading with virtual money using the same pro setup as our bot. Zero risk, real market data.\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>STEP 1 — Set Up Your Account</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `By default you start with $100 margin and 20x leverage. You can change this anytime:\n\n` +
      `  /setmysize 200\n` +
      `  Sets your margin (how much you risk per trade).\n` +
      `  Range: $10 to $10,000\n\n` +
      `  /setmyleverage 10\n` +
      `  Sets your leverage multiplier.\n` +
      `  Range: 1x to 50x\n\n` +
      `  Example: $100 margin at 20x = $2,000 position size.\n` +
      `  Higher leverage = bigger gains AND bigger losses.\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>STEP 2 — Start Trading</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `<b>Option A: Auto-Follow (hands-free)</b>\n` +
      `Send /follow and the bot will automatically open a paper trade every time it finds a signal. You'll get notified on every entry, TP hit, and exit.\n\n` +
      `Send /unfollow to stop (open trades still run to completion).\n\n` +

      `<b>Option B: Manual Trading</b>\n` +
      `You pick the coin and direction:\n\n` +
      `  /buy BTC — Open a long (betting price goes up)\n` +
      `  /sell ETH — Open a short (betting price goes down)\n\n` +
      `The bot calculates your TP targets, stop loss, and position size automatically based on market conditions.\n\n` +
      `To close a trade early:\n` +
      `  /closetrade BTC\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>STEP 3 — Track Your Performance</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `  /mypositions — See all your open trades\n` +
      `  /mypaper — Portfolio overview (wins, losses, total P&amp;L)\n` +
      `  /mypnl — Full history of your last 20 trades\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>HOW YOUR TRADES ARE MANAGED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `Your trades run on autopilot with smart exits:\n\n` +

      `<b>Taking Profit (4 stages):</b>\n` +
      `  TP1 hit — 33% of your position is closed for profit.\n` +
      `  Your stop loss moves to your entry price (breakeven).\n` +
      `  You can't lose money on this trade anymore.\n\n` +

      `  TP2 hit — Another 50% closed. SL moves up to TP1.\n` +
      `  TP3 hit — Another 50% closed. A small "runner"\n` +
      `  stays open with a wide trailing stop to ride big moves.\n` +
      `  TP4 hit — Everything closed. Maximum profit taken.\n\n` +

      `<b>Protection Features:</b>\n` +
      `  Profit Protection — If your trade is up +5% before\n` +
      `  hitting TP1, stop loss moves to breakeven early.\n\n` +

      `  Trailing Stop — After each TP, your stop loss\n` +
      `  follows the price up, locking in more profit.\n\n` +

      `  Max Loss Cap — If a trade drops too fast, it's\n` +
      `  auto-closed to limit your loss.\n\n` +

      `  48h Expiry — Trades that go nowhere for 2 days\n` +
      `  are auto-closed.\n\n` +

      `<b>Notifications:</b>\n` +
      `You'll receive a message for every trade event — entry, each TP hit, stop loss moves, and final close with your P&amp;L.\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>QUICK START</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `1. Send /follow to start auto-trading\n` +
      `2. Or send /buy BTC to open your first trade\n` +
      `3. Check /mypositions to see how it's going\n\n` +

      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>ONCHAIN SIGNALS</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +

      `The bot also scans on-chain data (OI, funding, exchange flows).\n` +
      `To auto-paper these signals:\n\n` +
      `  /onchainfollow — Enable onchain auto-trading\n` +
      `  /setmyscore 50 — Only trade score ≥ 50\n` +
      `  /setmyloss 50 — Stop trading at -$50/day\n` +
      `  /setmymaxloss 10 — Max $10 loss per trade\n` +
      `  /setmypositions 3 — Max 3 trades at once\n` +
      `  /myonchain — View onchain positions\n` +
      `  /myonchainstats — Onchain P&amp;L breakdown\n` +
      `  /mysettings — See all your settings\n\n` +

      `<i>This is 100% virtual — no real money, no real risk. Practice until you're confident!</i>`
    ));

    // ---------- User paper trading commands ----------

    this.bot.command('follow', async (ctx) => {
      await db.setPaperFollow(ctx.state.user.telegram_id, true);
      const user = await db.getUser(ctx.state.user.telegram_id);
      const size = parseFloat(user.paper_size) || 100;
      const lev = parseInt(user.paper_leverage) || 20;
      ctx.replyWithHTML(
        `✅ <b>Paper-follow enabled</b>\n\n` +
        `Every new signal is auto-traded: $${size} margin × ${lev}x = $${(size * lev).toFixed(0)} notional\n` +
        `Full TP1-4 partials, trailing SL, profit protection.\n\n` +
        `Config: /setmysize, /setmyleverage\nTrack: /mypositions, /mypaper, /mypnl`
      );
    });

    this.bot.command('unfollow', async (ctx) => {
      await db.setPaperFollow(ctx.state.user.telegram_id, false);
      ctx.replyWithHTML(`✅ <b>Paper-follow disabled.</b> Open virtual trades still run to completion.`);
    });

    this.bot.command('mypaper', async (ctx) => {
      try {
        const uid = ctx.state.user.telegram_id;
        const user = await db.getUser(uid);
        const stats = await db.getUserTradeStats(uid);
        const ocStats = await db.getUserTradeStatsBySource(uid, 'onchain');
        const sigStats = await db.getUserTradeStatsBySource(uid, 'signal');
        const open = await db.getOpenUserTrades(uid);
        const dailyPnl = await db.getUserDailyPnL(uid);
        const size = parseFloat(user.paper_size) || 100;
        const lev = parseInt(user.paper_leverage) || 20;
        const wr = stats.closed > 0 ? ((parseInt(stats.wins) / parseInt(stats.closed)) * 100).toFixed(0) : 0;

        let msg = `📊 <b>Your Paper Portfolio</b>\n\n` +
          `⚙️ $${size} × ${lev}x = $${(size * lev).toFixed(0)} notional\n` +
          `📡 Signals: ${user.paper_follow ? '✅' : '❌'} | 🔗 Onchain: ${user.onchain_follow ? '✅' : '❌'}\n\n`;

        msg += `<b>Overall:</b> ${stats.closed} trades | WR: ${wr}% | P&L: <b>$${parseFloat(stats.total_pnl).toFixed(2)}</b>\n`;
        msg += `Today: $${dailyPnl.toFixed(2)}\n\n`;

        if (parseInt(sigStats.closed) > 0) {
          const sigWr = ((parseInt(sigStats.wins) / parseInt(sigStats.closed)) * 100).toFixed(0);
          msg += `📡 <b>Signals:</b> ${sigStats.closed} trades | WR: ${sigWr}% | $${parseFloat(sigStats.total_pnl).toFixed(2)}\n`;
        }
        if (parseInt(ocStats.closed) > 0) {
          const ocWr = ((parseInt(ocStats.wins) / parseInt(ocStats.closed)) * 100).toFixed(0);
          msg += `🔗 <b>Onchain:</b> ${ocStats.closed} trades | WR: ${ocWr}% | $${parseFloat(ocStats.total_pnl).toFixed(2)}\n`;
        }

        if (open.length) {
          const exchanges = this.userPaperEngine?.exchanges || this.technicalScanner?.exchanges || {};
          const { msg: posMsg, totalPnl } = await formatPositions(open, exchanges);
          const pnlColor = totalPnl >= 0 ? '🟩' : '🟥';
          msg += `\n<b>Open (${open.length})</b> ${pnlColor} $${totalPnl.toFixed(2)}\n\n`;
          msg += posMsg;
        } else {
          msg += `\nNo open trades. Use /follow or /buy <SYMBOL>`;
        }
        await ctx.replyWithHTML(msg);
      } catch (e) {
        logger.error(`/mypaper: ${e.message}`);
        ctx.replyWithHTML('⚠️ Could not load your portfolio.');
      }
    });

    // --- Per-user paper config ---
    this.bot.command('setmysize', async (ctx) => {
      try {
        const amount = parseFloat(ctx.message.text.split(' ')[1]);
        if (!amount || amount < 10 || amount > 10000) {
          return ctx.replyWithHTML('Usage: <code>/setmysize 200</code>\nRange: $10 — $10,000 (this is your margin per trade)');
        }
        await db.setUserPaperConfig(ctx.state.user.telegram_id, { paperSize: amount });
        const lev = parseInt((await db.getUser(ctx.state.user.telegram_id)).paper_leverage) || 20;
        ctx.replyWithHTML(`✅ Paper size set to <b>$${amount}</b>\nNotional per trade: $${(amount * lev).toFixed(0)} (${lev}x leverage)`);
      } catch (e) {
        logger.error(`/setmysize: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to update size.');
      }
    });

    this.bot.command('setmyleverage', async (ctx) => {
      try {
        const lev = parseInt(ctx.message.text.split(' ')[1]);
        if (!lev || lev < 1 || lev > 50) {
          return ctx.replyWithHTML('Usage: <code>/setmyleverage 10</code>\nRange: 1x — 50x');
        }
        await db.setUserPaperConfig(ctx.state.user.telegram_id, { paperLeverage: lev });
        const size = parseFloat((await db.getUser(ctx.state.user.telegram_id)).paper_size) || 100;
        ctx.replyWithHTML(`✅ Paper leverage set to <b>${lev}x</b>\nNotional per trade: $${(size * lev).toFixed(0)} ($${size} margin)`);
      } catch (e) {
        logger.error(`/setmyleverage: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to update leverage.');
      }
    });

    // --- Manual paper trading ---
    this.bot.command('buy', async (ctx) => {
      try {
        const symbol = (ctx.message.text.split(' ')[1] || '').toUpperCase();
        if (!symbol) return ctx.replyWithHTML('Usage: <code>/buy BTC</code>');
        if (!this.userPaperEngine) return ctx.replyWithHTML('⚠️ Paper engine not ready.');
        const result = await this.userPaperEngine.openManualTrade(ctx.state.user.telegram_id, symbol, 'long');
        ctx.replyWithHTML(
          `🟢 <b>LONG opened</b> — $${escapeHtml(symbol)}\n\n` +
          `Entry: $${result.currentPrice.toPrecision(6)}\n` +
          `Size: $${result.notional.toFixed(0)} (${result.leverage}x)\n` +
          `TP1: $${result.tp1.toPrecision(6)} | TP2: $${result.tp2.toPrecision(6)}\n` +
          `TP3: $${result.tp3.toPrecision(6)} | TP4: $${result.tp4.toPrecision(6)}\n` +
          `SL: $${result.stopLoss.toPrecision(6)}`
        );
      } catch (e) {
        ctx.replyWithHTML(`⚠️ ${escapeHtml(e.message)}`);
      }
    });

    this.bot.command('sell', async (ctx) => {
      try {
        const symbol = (ctx.message.text.split(' ')[1] || '').toUpperCase();
        if (!symbol) return ctx.replyWithHTML('Usage: <code>/sell BTC</code>');
        if (!this.userPaperEngine) return ctx.replyWithHTML('⚠️ Paper engine not ready.');
        const result = await this.userPaperEngine.openManualTrade(ctx.state.user.telegram_id, symbol, 'short');
        ctx.replyWithHTML(
          `🔴 <b>SHORT opened</b> — $${escapeHtml(symbol)}\n\n` +
          `Entry: $${result.currentPrice.toPrecision(6)}\n` +
          `Size: $${result.notional.toFixed(0)} (${result.leverage}x)\n` +
          `TP1: $${result.tp1.toPrecision(6)} | TP2: $${result.tp2.toPrecision(6)}\n` +
          `TP3: $${result.tp3.toPrecision(6)} | TP4: $${result.tp4.toPrecision(6)}\n` +
          `SL: $${result.stopLoss.toPrecision(6)}`
        );
      } catch (e) {
        ctx.replyWithHTML(`⚠️ ${escapeHtml(e.message)}`);
      }
    });

    this.bot.command('closetrade', async (ctx) => {
      try {
        const symbol = (ctx.message.text.split(' ')[1] || '').toUpperCase();
        if (!symbol) return ctx.replyWithHTML('Usage: <code>/closetrade BTC</code>');
        if (!this.userPaperEngine) return ctx.replyWithHTML('⚠️ Paper engine not ready.');
        const uid = ctx.state.user.telegram_id;
        const result = await this.userPaperEngine.closeManualTrade(uid, symbol);
        const bal = await this.userPaperEngine.getBalance(uid);
        const emoji = result.pnlUsd >= 0 ? '✅' : '❌';
        const balLine = bal != null ? `\n${bal >= 500 ? '💰' : bal >= 100 ? '⚠️' : '🔴'} Balance: <b>$${bal.toFixed(2)}</b>` : '';
        ctx.replyWithHTML(
          `${emoji} <b>Position closed</b> — $${escapeHtml(symbol)}\n\n` +
          `${result.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'}\n` +
          `Entry: $${result.entry.toPrecision(6)} → Exit: $${result.exit.toPrecision(6)}\n` +
          `P&L: <b>$${result.pnlUsd.toFixed(2)}</b> (${result.pnlPct.toFixed(2)}%)${balLine}`
        );
      } catch (e) {
        ctx.replyWithHTML(`⚠️ ${escapeHtml(e.message)}`);
      }
    });

    const formatPositions = async (trades, exchanges) => {
      const prices = new Map();
      for (const t of trades) {
        const key = `${t.exchange}:${t.symbol}`;
        if (prices.has(key)) continue;
        const ex = exchanges?.[t.exchange];
        if (!ex) continue;
        for (const pair of [`${t.symbol}/USDT:USDT`, `${t.symbol}/USDT`]) {
          if (ex.markets?.[pair]) {
            try { const tk = await ex.fetchTicker(pair); prices.set(key, tk.last); } catch (e) {}
            break;
          }
        }
      }

      let totalUnrealized = 0;
      let totalRealized = 0;
      let msg = '';
      for (const t of trades.slice(0, 10)) {
        const entry = parseFloat(t.entry_price);
        const posSize = parseFloat(t.position_size);
        const qty = parseFloat(t.quantity);
        const realized = parseFloat(t.realized_pnl_usd || 0);
        const isLong = t.direction === 'long';
        const src = t.source === 'onchain' ? '🔗' : t.source === 'manual' ? '🔧' : '📡';
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
        const ageStr = age < 60 ? `${age}m` : age < 1440 ? `${Math.round(age / 60)}h` : `${Math.round(age / 1440)}d`;
        const _d = new Date(t.created_at);
        const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;

        const curPrice = prices.get(`${t.exchange}:${t.symbol}`);
        let unrealizedPct = 0, unrealizedUsd = 0;
        if (curPrice) {
          unrealizedPct = isLong
            ? ((curPrice - entry) / entry) * 100
            : ((entry - curPrice) / entry) * 100;
          unrealizedUsd = (unrealizedPct / 100) * posSize;
        }
        const combinedPnl = unrealizedUsd + realized;
        totalUnrealized += unrealizedUsd;
        totalRealized += realized;

        const pnlEmoji = combinedPnl >= 0 ? '🟩' : '🟥';
        const tpHits = [t.hit_tp1 ? '✅1' : '⬜1', t.hit_tp2 ? '✅2' : '⬜2', t.hit_tp3 ? '✅3' : '⬜3'].join(' ');

        msg += `${isLong ? '🟢' : '🔴'} <b>$${escapeHtml(t.symbol)}</b> ${src} · ${ageStr} · ${openTime}\n`;
        msg += `  Entry: $${entry.toPrecision(6)}`;
        if (curPrice) msg += ` → Now: $${curPrice.toPrecision(6)}`;
        msg += `\n`;
        msg += `  ${pnlEmoji} P&L: <b>$${combinedPnl.toFixed(2)}</b> (${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(2)}%)`;
        if (realized > 0) msg += ` · Banked: $${realized.toFixed(2)}`;
        msg += `\n`;
        msg += `  SL: $${parseFloat(t.stop_loss).toPrecision(6)} · Size: $${posSize.toFixed(0)}\n`;
        msg += `  TP: ${tpHits}\n\n`;
      }
      return { msg, totalUnrealized, totalRealized, totalPnl: totalUnrealized + totalRealized };
    };

    this.bot.command('mypositions', async (ctx) => {
      try {
        if (!this.userPaperEngine) return ctx.replyWithHTML('⚠️ Paper engine not ready.');
        const uid = ctx.state.user.telegram_id;
        const open = await db.getOpenUserTrades(uid);
        if (!open.length) return ctx.replyWithHTML('📭 No open positions.\n\nUse /buy <SYMBOL> or /follow to start trading.');

        const { msg: posMsg, totalPnl } = await formatPositions(open, this.userPaperEngine.exchanges);
        const pnlColor = totalPnl >= 0 ? '🟩' : '🟥';
        let msg = `📈 <b>Your Open Positions (${open.length})</b>\n`;
        msg += `${pnlColor} Total unrealized: <b>$${totalPnl.toFixed(2)}</b>\n\n`;
        msg += posMsg;
        msg += `Close: <code>/closetrade SYMBOL</code>`;
        await ctx.replyWithHTML(msg);
      } catch (e) {
        logger.error(`/mypositions: ${e.message}`);
        ctx.replyWithHTML('⚠️ Could not load positions.');
      }
    });

    this.bot.command('mypnl', async (ctx) => {
      try {
        const uid = ctx.state.user.telegram_id;
        const trades = await db.getUserClosedTrades(uid, 20);
        if (!trades.length) return ctx.replyWithHTML('📭 No closed trades yet.');

        const stats = await db.getUserTradeStats(uid);
        let msg = `📊 <b>Your P&L History</b>\n\n` +
          `Total: <b>$${parseFloat(stats.total_pnl).toFixed(2)}</b> | ` +
          `WR: ${stats.closed > 0 ? ((stats.wins / stats.closed) * 100).toFixed(0) : 0}%\n\n`;

        for (const t of trades) {
          const pnl = parseFloat(t.pnl_usd || 0);
          const emoji = pnl > 0 ? '✅' : pnl < 0 ? '❌' : '➖';
          const date = new Date(t.closed_at).toISOString().slice(5, 16).replace('T', ' ');
          msg += `${emoji} ${t.direction === 'long' ? '🟢' : '🔴'} $${escapeHtml(t.symbol)} | $${pnl.toFixed(2)} | ${t.close_reason} | ${date}\n`;
        }
        await ctx.replyWithHTML(msg);
      } catch (e) {
        logger.error(`/mypnl: ${e.message}`);
        ctx.replyWithHTML('⚠️ Could not load P&L.');
      }
    });

    // --- Onchain paper trading (user) ---
    this.bot.command('onchainfollow', async (ctx) => {
      try {
        const uid = ctx.state.user.telegram_id;
        await db.setUserPaperConfig(uid, { onchainFollow: true });
        const user = await db.getUser(uid);
        const score = parseInt(user.onchain_min_score) || 45;
        const size = parseFloat(user.paper_size) || 100;
        const lev = parseInt(user.paper_leverage) || 20;
        ctx.replyWithHTML(
          `✅ <b>Onchain auto-paper enabled</b>\n\n` +
          `Onchain signals with score ≥ ${score} will auto-open paper trades.\n` +
          `Size: $${size} × ${lev}x = $${(size * lev).toFixed(0)} notional\n\n` +
          `Use /mysettings for full config panel\n` +
          `Track: /myonchain, /myonchainstats`
        );
      } catch (e) {
        logger.error(`/onchainfollow: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to enable onchain follow.');
      }
    });

    this.bot.command('onchainunfollow', async (ctx) => {
      await db.setUserPaperConfig(ctx.state.user.telegram_id, { onchainFollow: false });
      ctx.replyWithHTML(`✅ <b>Onchain auto-paper disabled.</b> Open onchain trades still run to completion.`);
    });

    this.bot.command('setmyscore', async (ctx) => {
      try {
        const score = parseInt(ctx.message.text.split(' ')[1]);
        if (!score || score < 30 || score > 100) {
          return ctx.replyWithHTML('Usage: <code>/setmyscore 50</code>\nRange: 30 — 100 (higher = fewer but higher confidence trades)');
        }
        await db.setUserPaperConfig(ctx.state.user.telegram_id, { onchainMinScore: score });
        ctx.replyWithHTML(`✅ Min onchain score set to <b>${score}</b>`);
      } catch (e) {
        logger.error(`/setmyscore: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to update score.');
      }
    });

    this.bot.command('setmyloss', async (ctx) => {
      try {
        const limit = parseFloat(ctx.message.text.split(' ')[1]);
        if (!limit || limit < 5 || limit > 10000) {
          return ctx.replyWithHTML('Usage: <code>/setmyloss 50</code>\nRange: $5 — $10,000 (daily paper loss limit)');
        }
        await db.setUserPaperConfig(ctx.state.user.telegram_id, { dailyLossLimit: limit });
        ctx.replyWithHTML(`✅ Daily loss limit set to <b>$${limit}</b>\nTrading stops when you hit this.`);
      } catch (e) {
        logger.error(`/setmyloss: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to update loss limit.');
      }
    });

    this.bot.command('setmymaxloss', async (ctx) => {
      try {
        const limit = parseFloat(ctx.message.text.split(' ')[1]);
        if (!limit || limit < 1 || limit > 1000) {
          return ctx.replyWithHTML('Usage: <code>/setmymaxloss 10</code>\nRange: $1 — $1,000 (max loss per trade before auto-close)');
        }
        await db.setUserPaperConfig(ctx.state.user.telegram_id, { perTradeLoss: limit });
        ctx.replyWithHTML(`✅ Per-trade max loss set to <b>$${limit}</b>\nTrades auto-close when they lose this much.`);
      } catch (e) {
        logger.error(`/setmymaxloss: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to update max loss.');
      }
    });

    this.bot.command('setmypositions', async (ctx) => {
      try {
        const max = parseInt(ctx.message.text.split(' ')[1]);
        if (!max || max < 1 || max > 10) {
          return ctx.replyWithHTML('Usage: <code>/setmypositions 3</code>\nRange: 1 — 10 (max concurrent paper positions)');
        }
        await db.setUserPaperConfig(ctx.state.user.telegram_id, { maxPositions: max });
        ctx.replyWithHTML(`✅ Max concurrent positions set to <b>${max}</b>`);
      } catch (e) {
        logger.error(`/setmypositions: ${e.message}`);
        ctx.replyWithHTML('⚠️ Failed to update positions limit.');
      }
    });

    this.bot.command('myonchain', async (ctx) => {
      try {
        const uid = ctx.state.user.telegram_id;
        const open = await db.getOpenUserTrades(uid);
        const onchain = open.filter(t => t.source === 'onchain');
        if (!onchain.length) return ctx.replyWithHTML('📭 No open onchain positions.\n\nEnable with /onchainfollow');

        const exchanges = this.userPaperEngine?.exchanges || this.technicalScanner?.exchanges || {};
        const { msg: posMsg, totalPnl } = await formatPositions(onchain, exchanges);
        const pnlColor = totalPnl >= 0 ? '🟩' : '🟥';
        let msg = `🔗 <b>Onchain Positions (${onchain.length})</b>\n`;
        msg += `${pnlColor} Total: <b>$${totalPnl.toFixed(2)}</b>\n\n`;
        msg += posMsg;
        msg += `Close: <code>/closetrade SYMBOL</code>`;
        await ctx.replyWithHTML(msg);
      } catch (e) {
        logger.error(`/myonchain: ${e.message}`);
        ctx.replyWithHTML('⚠️ Could not load onchain positions.');
      }
    });

    this.bot.command('myonchainstats', async (ctx) => {
      try {
        const uid = ctx.state.user.telegram_id;
        const stats = await db.getUserTradeStatsBySource(uid, 'onchain');
        const dailyPnl = await db.getUserDailyPnL(uid);
        const user = await db.getUser(uid);
        const dailyLimit = parseFloat(user.daily_loss_limit) || 100;

        let msg = `🔗 <b>Onchain Paper Stats</b>\n\n`;
        msg += `Trades: ${stats.closed} closed | ${stats.open_count} open\n`;
        msg += `Wins: ${stats.wins} | Losses: ${stats.losses}\n`;
        msg += `Win Rate: ${stats.closed > 0 ? ((parseInt(stats.wins) / parseInt(stats.closed)) * 100).toFixed(0) : 0}%\n`;
        msg += `Total P&L: <b>$${parseFloat(stats.total_pnl).toFixed(2)}</b>\n`;
        msg += `Avg: ${parseFloat(stats.avg_pnl_pct).toFixed(2)}%\n`;
        if (stats.best_trade) msg += `Best: $${parseFloat(stats.best_trade).toFixed(2)}`;
        if (stats.worst_trade) msg += ` | Worst: $${parseFloat(stats.worst_trade).toFixed(2)}`;
        msg += `\n\nToday: $${dailyPnl.toFixed(2)} / -$${dailyLimit} limit`;
        await ctx.replyWithHTML(msg);
      } catch (e) {
        logger.error(`/myonchainstats: ${e.message}`);
        ctx.replyWithHTML('⚠️ Could not load stats.');
      }
    });

    // --- User settings panel (inline buttons) ---
    const myCheck = (val, cur) => val === cur ? ' ✓' : '';

    const showMySettings = async (ctx, isNew = false) => {
      const uid = ctx.state?.user?.telegram_id || ctx.from?.id;
      const user = await db.getUser(uid);
      const open = await db.getOpenUserTrades(uid);
      const dailyPnl = await db.getUserDailyPnL(uid);

      const size = parseFloat(user.paper_size) || 100;
      const lev = parseInt(user.paper_leverage) || 20;
      const score = parseInt(user.onchain_min_score) || 45;
      const maxPos = parseInt(user.max_positions) || 5;
      const dailyLimit = parseFloat(user.daily_loss_limit) || 100;
      const perTrade = parseFloat(user.per_trade_loss) || 20;
      const balance = parseFloat(user.paper_balance) || 1000;
      const balEmoji = balance >= 500 ? '💰' : balance >= 100 ? '⚠️' : '🔴';
      let userDisabled;
      try {
        const raw = user.disabled_exchanges;
        const arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
        userDisabled = new Set(Array.isArray(arr) ? arr : []);
      } catch { userDisabled = new Set(); }

      const text =
        `⚙️ <b>YOUR SETTINGS</b>\n\n` +
        `${balEmoji} <b>Balance: $${balance.toFixed(2)}</b>${balance < 100 ? ' — Low balance!' : ''}\n` +
        `📡 Signal follow: ${user.paper_follow ? '<b>✅ ON</b>' : '<b>❌ OFF</b>'} | ` +
        `🔗 Onchain: ${user.onchain_follow ? '<b>✅ ON</b>' : '<b>❌ OFF</b>'}\n` +
        `💵 Margin: <b>$${size}</b> | ⚡ Leverage: <b>${lev}x</b> | Notional: $${(size * lev).toFixed(0)}\n` +
        `🎯 Min score: <b>${score}</b> | 📊 Max pos: <b>${maxPos}</b>\n` +
        `🛡️ Daily limit: <b>$${dailyLimit}</b> | 🔒 Per-trade: <b>$${perTrade}</b>\n` +
        `🏦 Exchanges: <b>${userDisabled.size ? `${userDisabled.size} off` : 'All ON'}</b>\n` +
        `📈 Today: <b>$${dailyPnl.toFixed(2)}</b> | Open: <b>${open.length}/${maxPos}</b>\n\n` +
        `Tap any button to configure:`;

      const buttons = [
        [Markup.button.callback(`${user.paper_follow ? '✅' : '❌'} Signals`, 'my_cfg_follow'),
         Markup.button.callback(`${user.onchain_follow ? '✅' : '❌'} Onchain`, 'my_cfg_onchain')],
        [Markup.button.callback(`💵 Size: $${size}`, 'my_cfg_size'),
         Markup.button.callback(`⚡ Lev: ${lev}x`, 'my_cfg_lev')],
        [Markup.button.callback(`🛡️ Daily: $${dailyLimit}`, 'my_cfg_dailyloss'),
         Markup.button.callback(`🔒 Trade: $${perTrade}`, 'my_cfg_tradeloss')],
        [Markup.button.callback(`📊 Pos: ${maxPos}`, 'my_cfg_maxpos'),
         Markup.button.callback(`🎯 Score: ${score}`, 'my_cfg_score')],
        [Markup.button.callback(`🏦 Exchanges${userDisabled.size ? ` (${userDisabled.size} off)` : ''}`, 'my_cfg_exchanges')],
        [Markup.button.callback(`📈 Positions (${open.length})`, 'my_cfg_positions'),
         Markup.button.callback('🔄 Refresh', 'my_settings')],
      ];
      if (balance < 500) {
        buttons.push([Markup.button.callback('💳 Top Up Balance → $1,000', 'my_cfg_topup')]);
      }
      const keyboard = Markup.inlineKeyboard(buttons);

      if (isNew) {
        await ctx.replyWithHTML(text, keyboard);
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      }
    };

    this.bot.command('mysettings', async (ctx) => {
      try { await showMySettings(ctx, true); } catch (e) {
        logger.error(`/mysettings: ${e.message}`);
        ctx.replyWithHTML('⚠️ Could not load settings.');
      }
    });

    this.bot.action('my_settings', async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showMySettings(ctx); } catch (e) { logger.error(`my_settings: ${e.message}`); }
    });

    // ── SIGNAL FOLLOW TOGGLE ──
    this.bot.action('my_cfg_follow', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const uid = ctx.from.id;
        const user = await db.getUser(uid);
        const newVal = !user.paper_follow;
        await db.setPaperFollow(uid, newVal);
        await ctx.answerCbQuery(newVal ? 'Signal follow ON' : 'Signal follow OFF').catch(() => {});
        await showMySettings(ctx);
      } catch (e) { logger.error(`my_cfg_follow: ${e.message}`); }
    });

    // ── ONCHAIN FOLLOW TOGGLE ──
    this.bot.action('my_cfg_onchain', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const uid = ctx.from.id;
        const user = await db.getUser(uid);
        const newVal = !user.onchain_follow;
        await db.setUserPaperConfig(uid, { onchainFollow: newVal });
        await showMySettings(ctx);
      } catch (e) { logger.error(`my_cfg_onchain: ${e.message}`); }
    });

    // ── SIZE ──
    this.bot.action('my_cfg_size', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const cur = parseFloat(user.paper_size) || 100;
        await ctx.editMessageText(
          `💵 <b>MARGIN PER TRADE</b>\n\n` +
          `Current: <b>$${cur}</b>\n\n` +
          `This is how much margin you risk on each trade.\nUse /setmysize for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$25${myCheck(25, cur)}`, 'my_size_25'),
             Markup.button.callback(`$50${myCheck(50, cur)}`, 'my_size_50'),
             Markup.button.callback(`$100${myCheck(100, cur)}`, 'my_size_100')],
            [Markup.button.callback(`$200${myCheck(200, cur)}`, 'my_size_200'),
             Markup.button.callback(`$500${myCheck(500, cur)}`, 'my_size_500'),
             Markup.button.callback(`$1000${myCheck(1000, cur)}`, 'my_size_1000')],
            [Markup.button.callback(`$2000${myCheck(2000, cur)}`, 'my_size_2000'),
             Markup.button.callback(`$5000${myCheck(5000, cur)}`, 'my_size_5000')],
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`my_cfg_size: ${e.message}`); }
    });
    for (const size of [25, 50, 100, 200, 500, 1000, 2000, 5000]) {
      this.bot.action(`my_size_${size}`, async (ctx) => {
        try {
          await db.setUserPaperConfig(ctx.from.id, { paperSize: size });
          await ctx.answerCbQuery(`Size: $${size}`);
          await showMySettings(ctx);
        } catch (e) { logger.error(`my_size: ${e.message}`); }
      });
    }

    // ── LEVERAGE ──
    this.bot.action('my_cfg_lev', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const cur = parseInt(user.paper_leverage) || 20;
        await ctx.editMessageText(
          `⚡ <b>LEVERAGE</b>\n\n` +
          `Current: <b>${cur}x</b>\n\n` +
          `Higher leverage = bigger gains AND bigger losses.\nUse /setmyleverage for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3x${myCheck(3, cur)}`, 'my_lev_3'),
             Markup.button.callback(`5x${myCheck(5, cur)}`, 'my_lev_5'),
             Markup.button.callback(`10x${myCheck(10, cur)}`, 'my_lev_10')],
            [Markup.button.callback(`15x${myCheck(15, cur)}`, 'my_lev_15'),
             Markup.button.callback(`20x${myCheck(20, cur)}`, 'my_lev_20'),
             Markup.button.callback(`25x${myCheck(25, cur)}`, 'my_lev_25')],
            [Markup.button.callback(`30x${myCheck(30, cur)}`, 'my_lev_30'),
             Markup.button.callback(`50x${myCheck(50, cur)}`, 'my_lev_50')],
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`my_cfg_lev: ${e.message}`); }
    });
    for (const lev of [3, 5, 10, 15, 20, 25, 30, 50]) {
      this.bot.action(`my_lev_${lev}`, async (ctx) => {
        try {
          await db.setUserPaperConfig(ctx.from.id, { paperLeverage: lev });
          await ctx.answerCbQuery(`Leverage: ${lev}x`);
          await showMySettings(ctx);
        } catch (e) { logger.error(`my_lev: ${e.message}`); }
      });
    }

    // ── DAILY LOSS LIMIT ──
    this.bot.action('my_cfg_dailyloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const cur = parseFloat(user.daily_loss_limit) || 100;
        await ctx.editMessageText(
          `🛡️ <b>DAILY LOSS LIMIT</b>\n\n` +
          `Current: <b>$${cur}</b>\n\n` +
          `Auto-trading stops for the day when your total paper losses hit this limit.\nUse /setmyloss for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$10${myCheck(10, cur)}`, 'my_dloss_10'),
             Markup.button.callback(`$25${myCheck(25, cur)}`, 'my_dloss_25'),
             Markup.button.callback(`$50${myCheck(50, cur)}`, 'my_dloss_50')],
            [Markup.button.callback(`$100${myCheck(100, cur)}`, 'my_dloss_100'),
             Markup.button.callback(`$200${myCheck(200, cur)}`, 'my_dloss_200'),
             Markup.button.callback(`$500${myCheck(500, cur)}`, 'my_dloss_500')],
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`my_cfg_dailyloss: ${e.message}`); }
    });
    for (const loss of [10, 25, 50, 100, 200, 500]) {
      this.bot.action(`my_dloss_${loss}`, async (ctx) => {
        try {
          await db.setUserPaperConfig(ctx.from.id, { dailyLossLimit: loss });
          await ctx.answerCbQuery(`Daily limit: $${loss}`);
          await showMySettings(ctx);
        } catch (e) { logger.error(`my_dloss: ${e.message}`); }
      });
    }

    // ── PER-TRADE MAX LOSS ──
    this.bot.action('my_cfg_tradeloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const cur = parseFloat(user.per_trade_loss) || 20;
        await ctx.editMessageText(
          `🔒 <b>PER-TRADE MAX LOSS</b>\n\n` +
          `Current: <b>$${cur}</b>\n\n` +
          `Each trade is auto-closed if its unrealized loss reaches this amount.\nUse /setmymaxloss for any custom value.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$5${myCheck(5, cur)}`, 'my_tloss_5'),
             Markup.button.callback(`$10${myCheck(10, cur)}`, 'my_tloss_10'),
             Markup.button.callback(`$15${myCheck(15, cur)}`, 'my_tloss_15')],
            [Markup.button.callback(`$20${myCheck(20, cur)}`, 'my_tloss_20'),
             Markup.button.callback(`$30${myCheck(30, cur)}`, 'my_tloss_30'),
             Markup.button.callback(`$50${myCheck(50, cur)}`, 'my_tloss_50')],
            [Markup.button.callback(`$75${myCheck(75, cur)}`, 'my_tloss_75'),
             Markup.button.callback(`$100${myCheck(100, cur)}`, 'my_tloss_100')],
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`my_cfg_tradeloss: ${e.message}`); }
    });
    for (const loss of [5, 10, 15, 20, 30, 50, 75, 100]) {
      this.bot.action(`my_tloss_${loss}`, async (ctx) => {
        try {
          await db.setUserPaperConfig(ctx.from.id, { perTradeLoss: loss });
          await ctx.answerCbQuery(`Max loss/trade: $${loss}`);
          await showMySettings(ctx);
        } catch (e) { logger.error(`my_tloss: ${e.message}`); }
      });
    }

    // ── MAX POSITIONS ──
    this.bot.action('my_cfg_maxpos', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const cur = parseInt(user.max_positions) || 5;
        await ctx.editMessageText(
          `📊 <b>MAX CONCURRENT POSITIONS</b>\n\n` +
          `Current: <b>${cur}</b>\n\n` +
          `Maximum number of paper trades open at the same time.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`1${myCheck(1, cur)}`, 'my_pos_1'),
             Markup.button.callback(`2${myCheck(2, cur)}`, 'my_pos_2'),
             Markup.button.callback(`3${myCheck(3, cur)}`, 'my_pos_3')],
            [Markup.button.callback(`5${myCheck(5, cur)}`, 'my_pos_5'),
             Markup.button.callback(`7${myCheck(7, cur)}`, 'my_pos_7'),
             Markup.button.callback(`10${myCheck(10, cur)}`, 'my_pos_10')],
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`my_cfg_maxpos: ${e.message}`); }
    });
    for (const pos of [1, 2, 3, 5, 7, 10]) {
      this.bot.action(`my_pos_${pos}`, async (ctx) => {
        try {
          await db.setUserPaperConfig(ctx.from.id, { maxPositions: pos });
          await ctx.answerCbQuery(`Max positions: ${pos}`);
          await showMySettings(ctx);
        } catch (e) { logger.error(`my_pos: ${e.message}`); }
      });
    }

    // ── USER EXCHANGES ──
    this.bot.action('my_cfg_exchanges', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const exchanges = ['binance', 'bybit'];
        let disabled;
        try {
          const raw = user.disabled_exchanges;
          const arr = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
          disabled = new Set(Array.isArray(arr) ? arr : []);
        } catch { disabled = new Set(); }
        let desc = `🏦 <b>EXCHANGE TOGGLE</b>\n\n`;
        desc += `Enable/disable exchanges for your paper trades.\nDisabled exchanges won't open new trades.\n\n`;
        for (const ex of exchanges) {
          desc += `${disabled.has(ex) ? '❌' : '✅'} <b>${ex}</b>\n`;
        }
        await ctx.editMessageText(desc, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            exchanges.map(ex =>
              Markup.button.callback(`${disabled.has(ex) ? '❌' : '✅'} ${ex}`, `my_ex_${ex}`)
            ),
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup,
        });
      } catch (e) { logger.error(`my_cfg_exchanges: ${e.message}`); }
    });
    for (const exId of ['binance', 'bybit']) {
      this.bot.action(`my_ex_${exId}`, async (ctx) => {
        try {
          const user = await db.getUser(ctx.from.id);
          let arr;
          try { arr = user.disabled_exchanges ? JSON.parse(user.disabled_exchanges) : []; } catch { arr = []; }
          const disabled = new Set(Array.isArray(arr) ? arr : []);
          if (disabled.has(exId)) { disabled.delete(exId); }
          else { disabled.add(exId); }
          await db.setUserPaperConfig(ctx.from.id, { disabledExchanges: JSON.stringify([...disabled]) });
          await ctx.answerCbQuery(`${exId}: ${disabled.has(exId) ? 'disabled' : 'enabled'}`);
          await ctx.deleteMessage().catch(() => {});
          await showMySettings(ctx, true);
        } catch (e) { logger.error(`my_ex toggle: ${e.message}`); }
      });
    }

    // ── MIN ONCHAIN SCORE ──
    this.bot.action('my_cfg_score', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const user = await db.getUser(ctx.from.id);
        const cur = parseInt(user.onchain_min_score) || 45;
        await ctx.editMessageText(
          `🎯 <b>MIN ONCHAIN SCORE</b>\n\n` +
          `Current: <b>${cur}</b>\n\n` +
          `🎯 <b>30</b> — All signals (early + notable + high)\n` +
          `⚡ <b>45</b> — Notable + high conviction only\n` +
          `🔥 <b>60</b> — High conviction only (safest)\n` +
          `💎 <b>75</b> — Ultra selective\n\n` +
          `Lower = more trades, higher = fewer but stronger.\nUse /setmyscore for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`🎯 30 (all)${myCheck(30, cur)}`, 'my_score_30'),
             Markup.button.callback(`⚡ 45 (notable)${myCheck(45, cur)}`, 'my_score_45')],
            [Markup.button.callback(`🔥 60 (high)${myCheck(60, cur)}`, 'my_score_60'),
             Markup.button.callback(`💎 75 (ultra)${myCheck(75, cur)}`, 'my_score_75')],
            [Markup.button.callback('⬅️ Back', 'my_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`my_cfg_score: ${e.message}`); }
    });
    for (const score of [30, 45, 60, 75]) {
      this.bot.action(`my_score_${score}`, async (ctx) => {
        try {
          await db.setUserPaperConfig(ctx.from.id, { onchainMinScore: score });
          await ctx.answerCbQuery(`Min score: ${score}`);
          await showMySettings(ctx);
        } catch (e) { logger.error(`my_score: ${e.message}`); }
      });
    }

    // ── POSITIONS QUICK VIEW ──
    this.bot.action('my_cfg_positions', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const uid = ctx.from.id;
        const open = await db.getOpenUserTrades(uid);
        if (!open.length) {
          await ctx.editMessageText(
            `📭 <b>No open positions</b>\n\nUse /follow or /buy <SYMBOL> to start trading.`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back', 'my_settings')],
            ]).reply_markup }
          );
          return;
        }
        const exchanges = this.userPaperEngine?.exchanges || this.technicalScanner?.exchanges || {};
        const { msg: posMsg, totalPnl } = await formatPositions(open, exchanges);
        const pnlColor = totalPnl >= 0 ? '🟩' : '🟥';
        let msg = `📈 <b>Open Positions (${open.length})</b>\n`;
        msg += `${pnlColor} Total: <b>$${totalPnl.toFixed(2)}</b>\n\n`;
        msg += posMsg;
        msg += `Tap ❌ to close a trade:`;

        const closeButtons = [];
        for (let i = 0; i < open.length && i < 8; i += 2) {
          const row = [];
          const t1 = open[i];
          row.push(Markup.button.callback(`❌ ${t1.symbol}`, `my_close_${t1.id}`));
          if (open[i + 1]) {
            const t2 = open[i + 1];
            row.push(Markup.button.callback(`❌ ${t2.symbol}`, `my_close_${t2.id}`));
          }
          closeButtons.push(row);
        }
        closeButtons.push([
          Markup.button.callback('🔄 Refresh', 'my_cfg_positions'),
          Markup.button.callback('⬅️ Back', 'my_settings'),
        ]);

        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(closeButtons).reply_markup });
      } catch (e) { logger.error(`my_cfg_positions: ${e.message}`); }
    });

    this.bot.action(/^my_close_(\d+)$/, async (ctx) => {
      try {
        const tradeId = parseInt(ctx.match[1]);
        const uid = ctx.from.id;
        const open = await db.getOpenUserTrades(uid);
        const trade = open.find(t => t.id === tradeId);
        if (!trade) {
          await ctx.answerCbQuery('Trade not found or already closed');
          return;
        }
        if (!this.userPaperEngine) {
          await ctx.answerCbQuery('Paper engine not ready');
          return;
        }
        const result = await this.userPaperEngine.closeManualTrade(uid, trade.symbol);
        const closeBal = await this.userPaperEngine.getBalance(uid);
        const balStr = closeBal != null ? ` | Bal: $${closeBal.toFixed(0)}` : '';
        const emoji = result.pnlUsd >= 0 ? '✅' : '❌';
        await ctx.answerCbQuery(`${emoji} ${trade.symbol}: $${result.pnlUsd.toFixed(2)}${balStr}`);
        // Refresh the positions panel
        const remaining = await db.getOpenUserTrades(uid);
        if (!remaining.length) {
          const balLine = closeBal != null ? `\n${closeBal >= 500 ? '💰' : closeBal >= 100 ? '⚠️' : '🔴'} Balance: <b>$${closeBal.toFixed(2)}</b>` : '';
          await ctx.editMessageText(
            `${emoji} <b>Closed $${escapeHtml(trade.symbol)}</b> — P&L: $${result.pnlUsd.toFixed(2)}${balLine}\n\n📭 No more open positions.`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back', 'my_settings')],
            ]).reply_markup }
          );
        } else {
          // Re-trigger the positions view with updated data
          const exchanges = this.userPaperEngine?.exchanges || this.technicalScanner?.exchanges || {};
          const { msg: posMsg, totalPnl } = await formatPositions(remaining, exchanges);
          const pnlColor = totalPnl >= 0 ? '🟩' : '🟥';
          let msg = `${emoji} Closed $${escapeHtml(trade.symbol)}: <b>$${result.pnlUsd.toFixed(2)}</b>\n\n`;
          msg += `📈 <b>Remaining (${remaining.length})</b>\n`;
          msg += `${pnlColor} Total: <b>$${totalPnl.toFixed(2)}</b>\n\n`;
          msg += posMsg;
          msg += `Tap ❌ to close a trade:`;

          const closeButtons = [];
          for (let i = 0; i < remaining.length && i < 8; i += 2) {
            const row = [];
            row.push(Markup.button.callback(`❌ ${remaining[i].symbol}`, `my_close_${remaining[i].id}`));
            if (remaining[i + 1]) row.push(Markup.button.callback(`❌ ${remaining[i + 1].symbol}`, `my_close_${remaining[i + 1].id}`));
            closeButtons.push(row);
          }
          closeButtons.push([
            Markup.button.callback('🔄 Refresh', 'my_cfg_positions'),
            Markup.button.callback('⬅️ Back', 'my_settings'),
          ]);
          await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(closeButtons).reply_markup });
        }
      } catch (e) {
        logger.error(`my_close: ${e.message}`);
        await ctx.answerCbQuery(`Error: ${e.message}`).catch(() => {});
      }
    });

    this.bot.action('my_cfg_topup', async (ctx) => {
      try {
        const uid = ctx.from.id;
        await db.setUserPaperConfig(uid, { paperBalance: 1000 });
        await ctx.answerCbQuery('Balance topped up to $1,000!', { show_alert: true });
        await showMySettings(ctx);
      } catch (e) {
        logger.error(`my_cfg_topup: ${e.message}`);
        await ctx.answerCbQuery(`Error: ${e.message}`).catch(() => {});
      }
    });

    // ---------- Admin: user management ----------

    this.bot.command('users', async (ctx) => {
      const users = await db.listUsers();
      let msg = `<b>👥 Bot Users</b>\n\n`;
      for (const u of users.slice(0, 25)) {
        const badge = u.role === 'admin' ? '👑' : u.status === 'active' ? '✅' : u.status === 'pending' ? '⏳' : '🚫';
        msg += `${badge} @${escapeHtml(u.username || String(u.telegram_id))} <code>${u.telegram_id}</code> [${u.status}]${u.paper_follow ? ' 📝' : ''}\n`;
      }
      msg += `\nGrant: <code>/grant &lt;id&gt;</code> | Revoke: <code>/revoke &lt;id&gt;</code>`;
      ctx.replyWithHTML(msg);
    });

    this.bot.command('grant', async (ctx) => {
      const parts = ctx.message.text.split(/\s+/);
      const id = parseInt(parts[1]);
      if (isNaN(id)) return ctx.replyWithHTML(`Usage: <code>/grant &lt;telegram_id&gt;</code>`);
      const user = await db.grantUser(id, ctx.state.user.telegram_id);
      if (!user) return ctx.replyWithHTML(`❌ No user <code>${id}</code> found. They must message the bot first.`);
      try {
        await this.bot.telegram.sendMessage(id,
          `✅ <b>Access Approved!</b>\n\n` +
          `You can now paper trade with the same setup as the bot!\n\n` +
          `/guide — How to get started\n` +
          `/follow — Auto-trade every signal\n` +
          `/buy BTC — Manual paper long\n` +
          `/setmysize — Set your margin\n` +
          `/setmyleverage — Set your leverage\n` +
          `/mypositions — View open trades\n` +
          `/mypnl — Your P&L history`);
      } catch (e) { logger.warn(`Grant notify failed for ${id}: ${e.message}`); }
      ctx.replyWithHTML(`✅ Granted access to <code>${id}</code>.`);
    });

    this.bot.command('revoke', async (ctx) => {
      const parts = ctx.message.text.split(/\s+/);
      const id = parseInt(parts[1]);
      if (isNaN(id)) return ctx.replyWithHTML(`Usage: <code>/revoke &lt;telegram_id&gt;</code>`);
      if (id === ctx.state.user.telegram_id) return ctx.replyWithHTML(`🚫 You can't revoke yourself.`);
      await db.revokeUser(id);
      ctx.replyWithHTML(`🚫 Revoked access for <code>${id}</code>.`);
    });

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
        const tokens = await this.socialScanner.scanTrending();
        const msg = this.socialScanner.formatTrending(tokens);
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

    this.bot.command('alertperf', async (ctx) => {
      try {
        const days = parseInt(ctx.message.text.split(' ')[1]) || 7;
        const [overall, bySymbol] = await Promise.all([
          db.getAlertPerformance(['ONCHAIN', 'FLOW', 'OI_SPIKE', 'SUPPLY_MOVE'], days),
          db.getAlertPerformanceBySymbol(['ONCHAIN', 'FLOW', 'OI_SPIKE', 'SUPPLY_MOVE'], days, 10),
        ]);

        if (!overall.length) {
          return ctx.replyWithHTML('No alert performance data yet. Check back in a few hours.');
        }

        let msg = `<b>ALERT PERFORMANCE</b> (last ${days}d)\n\n`;
        for (const r of overall) {
          msg += `<b>${r.alert_type}</b> (${r.total} alerts, avg score ${r.avg_score || '—'})\n`;
          msg += `  15m: ${r.avg_pnl_15m ?? '—'}% (${r.win_15m_pct ?? '—'}% win)\n`;
          msg += `  30m: ${r.avg_pnl_30m ?? '—'}% (${r.win_30m_pct ?? '—'}% win)\n`;
          msg += `  1h: ${r.avg_pnl_1h ?? '—'}% (${r.win_1h_pct ?? '—'}% win)\n`;
          msg += `  4h: ${r.avg_pnl_4h ?? '—'}% (${r.win_4h_pct ?? '—'}% win)\n`;
          msg += `  24h: ${r.avg_pnl_24h ?? '—'}% (${r.win_24h_pct ?? '—'}% win)\n`;
          msg += `  Peak: best ${r.avg_best_pnl ?? '—'}% / worst ${r.avg_worst_pnl ?? '—'}%\n`;
          if (r.tp1_hits > 0 || r.sl_hits > 0) {
            msg += `  TP1: ${r.tp1_hits} | TP2: ${r.tp2_hits} | TP3: ${r.tp3_hits} | SL: ${r.sl_hits}\n`;
          }
          if (r.with_flow > 0) {
            msg += `  Flow alerts: ${r.with_flow} (4h: ${r.flow_avg_4h ?? '—'}%) vs no-flow (4h: ${r.noflow_avg_4h ?? '—'}%)\n`;
          }
          msg += `  Invalidated: ${r.invalidated}\n\n`;
        }

        if (bySymbol.length) {
          msg += `<b>BY SYMBOL (4h)</b>\n`;
          for (const r of bySymbol) {
            const icon = (r.avg_4h ?? 0) > 0 ? '+' : '';
            const flow = r.with_flow > 0 ? ' [F]' : '';
            const tp = r.tp1_hits > 0 ? ` TP1:${r.tp1_hits}` : '';
            const sl = r.sl_hits > 0 ? ` SL:${r.sl_hits}` : '';
            msg += `${(r.avg_4h ?? 0) > 0 ? '🟢' : '🔴'} <code>${r.symbol}</code> 15m:${r.avg_15m ?? '—'}% 30m:${r.avg_30m ?? '—'}% 4h:${icon}${r.avg_4h ?? '—'}%${flow}${tp}${sl} (${r.alerts})\n`;
          }
        }

        ctx.replyWithHTML(msg);
      } catch (err) {
        logger.error(`alertperf error: ${err.message}`);
        ctx.reply('Error fetching alert performance.');
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
          `<b>Available types:</b>\nBREAKOUT, VOLUME_SPIKE, LISTING, FUNDING_SHORT, ZONE_ENTRY\n\n` +
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



    // === ONCHAIN AUTO-TRADE COMMANDS ===

    this.bot.command('onchaintrade', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Onchain trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const mode = args[0]?.toLowerCase();
      if (mode === 'on' || mode === 'paper' || mode === 'live') {
        if (mode === 'on') {
          this.onchainTradeExecutor.enabled = true;
        } else {
          this.onchainTradeExecutor.mode = mode;
          this.onchainTradeExecutor.enabled = true;
        }
        this.onchainTradeExecutor.saveConfig();
        ctx.replyWithHTML(`✅ Onchain trading: <b>${this.onchainTradeExecutor.mode.toUpperCase()}</b> | ${this.onchainTradeExecutor.enabled ? 'ON' : 'OFF'}${mode === 'live' ? '\n\n⚠️ Real funds will be used!' : ''}`);
      } else if (mode === 'off') {
        this.onchainTradeExecutor.enabled = false;
        this.onchainTradeExecutor.saveConfig();
        ctx.replyWithHTML('❌ Onchain auto-trading <b>disabled</b>.');
      } else {
        // Show full inline settings panel
        const te = this.onchainTradeExecutor;
        await te.recalcDailyPnL?.();
        const openTrades = await db.getOpenTrades('onchain').catch(() => []);
        const text =
          `🔗 <b>ONCHAIN SETTINGS</b>\n\n` +
          `${te.mode === 'paper' ? '📝' : '💰'} Mode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\n` +
          `💵 Size: <b>$${te.maxPositionSize}</b>/trade\n` +
          `⚡ Leverage: <b>${te.defaultLeverage}x</b>\n` +
          `🛡️ Daily Loss: <b>$${te.maxDailyLoss}</b> | Per-Trade: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n` +
          `📊 Max Positions: <b>${te.maxConcurrentPositions}</b>\n` +
          `🎯 Score: <b>L:${ocScoreLabel(te)}-${te.maxOcScore || 69} | S:${te.minShortScore || 70}+</b>\n` +
          `📈 Today P&L: <b>$${te.dailyPnL.toFixed(2)}</b>\n` +
          `📋 Open: <b>${openTrades.length}/${te.maxConcurrentPositions}</b>\n\n` +
          `Tap any button to configure:`;

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback(`${te.mode === 'paper' ? '📝' : '🔴'} Mode: ${te.mode.toUpperCase()}`, 'oc_cfg_mode'),
           Markup.button.callback(`${te.enabled ? '✅ ON' : '⛔ OFF'}`, 'oc_cfg_toggle')],
          [Markup.button.callback(`💵 Size: $${te.maxPositionSize}`, 'oc_cfg_size'),
           Markup.button.callback(`⚡ Lev: ${te.defaultLeverage}x`, 'oc_cfg_lev')],
          [Markup.button.callback(`🛡️ Daily: $${te.maxDailyLoss}`, 'oc_cfg_dailyloss'),
           Markup.button.callback(`🔒 Trade: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}`, 'oc_cfg_tradeloss')],
          [Markup.button.callback(`📊 Pos: ${te.maxConcurrentPositions}`, 'oc_cfg_maxpos'),
           Markup.button.callback(`🎯 L:${ocScoreLabel(te)}-${te.maxOcScore || 69} S:${te.minShortScore || 70}+`, 'oc_cfg_minscore')],
          [Markup.button.callback(`📋 Positions (${openTrades.length})`, 'oc_refresh'),
           Markup.button.callback(`⏳ Queued (${te.pendingEntries?.size || 0})`, 'oc_queued')],
          [Markup.button.callback('🔄 Refresh', 'oc_settings')],
          [Markup.button.callback('🛑 Close All & Stop', 'oc_closeall')],
        ]);
        ctx.replyWithHTML(text, keyboard);
      }
    });

    this.bot.command('onchainsize', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      const size = parseFloat(ctx.message.text.split(' ')[1]);
      if (!size || size < 5 || size > 10000) return ctx.reply('Usage: /onchainsize <5-10000>');
      this.onchainTradeExecutor.maxPositionSize = size;
      this.onchainTradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Onchain position size: <b>$${size}</b>`);
    });

    this.bot.command('onchainlev', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      const lev = parseInt(ctx.message.text.split(' ')[1]);
      if (!lev || lev < 1 || lev > 50) return ctx.reply('Usage: /onchainlev <1-50>');
      this.onchainTradeExecutor.defaultLeverage = lev;
      this.onchainTradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Onchain leverage: <b>${lev}x</b>`);
    });

    this.bot.command('onchainloss', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      const loss = parseFloat(ctx.message.text.split(' ')[1]);
      if (!loss || loss < 5 || loss > 50000) return ctx.reply('Usage: /onchainloss <daily limit $>');
      this.onchainTradeExecutor.maxDailyLoss = loss;
      this.onchainTradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Onchain daily loss limit: <b>$${loss}</b>`);
    });

    this.bot.command('onchainmaxloss', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      if (args[0] === '0' || args[0] === 'off') {
        this.onchainTradeExecutor.maxLossPerTrade = 0;
        this.onchainTradeExecutor.saveConfig();
        return ctx.replyWithHTML('✅ Onchain per-trade loss cap <b>disabled</b>.');
      }
      const loss = parseFloat(args[0]);
      if (!loss || loss < 1 || loss > 10000) return ctx.reply('Usage: /onchainmaxloss <$ per trade> or off');
      this.onchainTradeExecutor.maxLossPerTrade = loss;
      this.onchainTradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Onchain max loss per trade: <b>$${loss}</b>`);
    });

    this.bot.command('onchainpositions', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      const max = parseInt(ctx.message.text.split(' ')[1]);
      if (!max || max < 1 || max > 10) return ctx.reply('Usage: /onchainpositions <1-10>');
      this.onchainTradeExecutor.maxConcurrentPositions = max;
      this.onchainTradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Onchain max positions: <b>${max}</b>`);
    });

    this.bot.command('onchainminscore', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      const score = parseInt(ctx.message.text.split(' ')[1]);
      if (!score || score < 30 || score > 100) return ctx.reply('Usage: /onchainminscore <30-100>\n45 = most signals, 60 = high conviction only');
      const conf = score >= 60 ? 5 : score >= 45 ? 4 : 3;
      this.onchainTradeExecutor.minConfidence = conf;
      this.onchainTradeExecutor.saveConfig();
      ctx.replyWithHTML(`✅ Onchain min score: <b>${score}+</b> (confidence ${conf}/5)`);
    });

    this.bot.command('onchainstats', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      try {
        const te = this.onchainTradeExecutor;
        const balance = await te.getBalance();
        const openTrades = await db.getOpenTrades('onchain');
        let msg = `🔗 <b>ONCHAIN TRADING STATS</b>\n\n`;
        msg += `Mode: ${te.mode.toUpperCase()} | ${te.enabled ? 'ON' : 'OFF'}\n`;
        msg += `Balance: $${balance.toFixed(2)} | Size: $${te.maxPositionSize} | ${te.defaultLeverage}x\n`;
        msg += `Today P&L: $${te.dailyPnL.toFixed(2)} / -$${te.maxDailyLoss} limit\n`;
        msg += `Open positions: ${openTrades.length}/${te.maxConcurrentPositions}\n\n`;
        if (openTrades.length) {
          for (const t of openTrades) {
            const dir = t.direction === 'long' ? '🟢' : '🔴';
            msg += `${dir} <b>$${t.symbol}</b> @ $${t.entry_price} (${t.leverage}x)\n`;
          }
          msg += `\nView: /onchainopen | Close: /onchainclose SYMBOL`;
        }
        ctx.replyWithHTML(msg);
      } catch (err) {
        ctx.reply('Error fetching onchain stats.');
      }
    });

    // Helper to build onchain positions message + buttons
    const buildOnchainPositionsMsg = async (exchanges) => {
      const trades = await db.getOpenTrades('onchain');
      const te = this.onchainTradeExecutor;
      if (!trades.length) {
        return {
          msg: `🔗 <b>ONCHAIN POSITIONS</b>\n\n📭 No open positions.\n\nMode: ${te.mode.toUpperCase()} | ${te.enabled ? '✅ ON' : '❌ OFF'}\nSize: $${te.maxPositionSize} | ${te.defaultLeverage}x | Max Loss: $${te.maxLossPerTrade}\nToday P&L: $${te.dailyPnL.toFixed(2)}`,
          buttons: [[Markup.button.callback('🔄 Refresh', 'oc_refresh')], [Markup.button.callback('⚙️ Settings', 'oc_settings')]],
        };
      }
      let msg = `🔗 <b>ONCHAIN POSITIONS</b> (${trades.length}/${te.maxConcurrentPositions})\n`;
      msg += `Mode: ${te.mode.toUpperCase()} | Size: $${te.maxPositionSize} | ${te.defaultLeverage}x\n`;
      msg += `Today P&L: $${te.dailyPnL.toFixed(2)}\n\n`;
      const closeButtons = [];
      for (const t of trades) {
        const dir = t.direction === 'long' ? '🟢' : '🔴';
        const modeTag = t.mode === 'paper' ? '📝' : '💰';
        const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
        const ageStr = age < 60 ? `${age}m` : `${Math.round(age / 60)}h`;
        const _d = new Date(t.created_at);
        const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;
        const slTrailed = t.original_stop_loss && t.stop_loss !== t.original_stop_loss;
        // Fetch current price for live PnL
        let pnlStr = '';
        try {
          const ex = exchanges?.[t.exchange];
          if (ex) {
            const pair = `${t.symbol}/USDT:USDT`;
            if (ex.markets?.[pair]) {
              const ticker = await ex.fetchTicker(pair);
              const cp = ticker.last;
              const isLong = t.direction === 'long';
              const pnlPct = isLong ? ((cp - t.entry_price) / t.entry_price) * 100 : ((t.entry_price - cp) / t.entry_price) * 100;
              const pnlUsd = (pnlPct / 100) * t.position_size;
              const pnlEmoji = pnlUsd >= 0 ? '🟢' : '🔴';
              pnlStr = `   ${pnlEmoji} Now: $${cp.toPrecision(6)} | P&L: $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%)\n`;
            }
          }
        } catch (e) { /* skip live price */ }
        msg += `${modeTag} ${dir} <b>$${t.symbol}</b> (${t.exchange}) — ${ageStr} · ${openTime}\n`;
        msg += `   Entry: $${t.entry_price} | Size: $${t.position_size} (${t.leverage}x)\n`;
        msg += pnlStr;
        msg += `   TP1: $${t.tp1}${t.hit_tp1 ? ' ✅' : ''} | TP2: $${t.tp2}${t.hit_tp2 ? ' ✅' : ''} | TP3: $${t.tp3}${t.hit_tp3 ? ' ✅' : ''}\n`;
        msg += `   SL: $${t.stop_loss}${slTrailed ? ' 🔒 (trailed)' : ''}\n`;
        if (t.peak_price) msg += `   Peak: $${t.peak_price}\n`;
        msg += `\n`;
        closeButtons.push(Markup.button.callback(`❌ Close ${t.symbol}`, `oc_close_${t.symbol}`));
      }
      const buttons = [];
      // Put close buttons in rows of 2
      for (let i = 0; i < closeButtons.length; i += 2) {
        buttons.push(closeButtons.slice(i, i + 2));
      }
      buttons.push([Markup.button.callback('🔄 Refresh', 'oc_refresh'), Markup.button.callback('🛑 Close All', 'oc_closeall')]);
      buttons.push([Markup.button.callback('⚙️ Settings', 'oc_settings')]);
      return { msg, buttons };
    };

    this.bot.command('onchainopen', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      try {
        const { msg, buttons } = await buildOnchainPositionsMsg(this.onchainTradeExecutor.exchanges);
        ctx.replyWithHTML(msg, Markup.inlineKeyboard(buttons));
      } catch (err) {
        ctx.reply('Error fetching onchain positions.');
      }
    });

    this.bot.action('oc_refresh', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.answerCbQuery('Not initialized.');
      try {
        await ctx.answerCbQuery('Refreshing...');
        const { msg, buttons } = await buildOnchainPositionsMsg(this.onchainTradeExecutor.exchanges);
        await ctx.editMessageText(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
      } catch (e) {
        ctx.answerCbQuery('Error refreshing.').catch(() => {});
      }
    });

    this.bot.action(/^oc_close_(.+)$/, async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.answerCbQuery('Not initialized.');
      const symbol = ctx.match[1];
      try {
        await ctx.answerCbQuery(`Closing ${symbol}...`);
        const result = await this.onchainTradeExecutor.closeBySymbol(symbol);
        if (!result) return ctx.answerCbQuery(`No open position for ${symbol}`);
        const emoji = result.pnlUsd >= 0 ? '✅' : '❌';
        await ctx.reply(
          `${emoji} <b>[ONCHAIN] Closed $${symbol}</b>\n${result.trade.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} | Entry: $${result.trade.entry_price} → $${(result.currentPrice || 0).toPrecision(6)}\nP&L: <b>$${result.pnlUsd.toFixed(2)}</b> (${result.pnlPct.toFixed(2)}%)`,
          { parse_mode: 'HTML' }
        );
        // Refresh the positions message
        const { msg, buttons } = await buildOnchainPositionsMsg(this.onchainTradeExecutor.exchanges);
        await ctx.editMessageText(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
      } catch (e) {
        ctx.reply(`⚠️ ${e.message}`);
      }
    });

    this.bot.action('oc_closeall', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.answerCbQuery('Not initialized.');
      try {
        await ctx.answerCbQuery('Closing all...');
        const count = await this.onchainTradeExecutor.closeAllPositions();
        this.onchainTradeExecutor.enabled = false;
        this.onchainTradeExecutor.saveConfig();
        await ctx.editMessageText(
          `🛑 <b>[ONCHAIN] ALL POSITIONS CLOSED</b>\n\n${count} position(s) closed.\nOnchain auto-trading DISABLED.\n\nUse /onchaintrade on to re-enable.`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        ctx.reply('Error closing positions.');
      }
    });

    // ── QUEUED PULLBACK ENTRIES ──
    this.bot.action('oc_queued', async (ctx) => {
      const te = this.onchainTradeExecutor;
      if (!te) return ctx.answerCbQuery('Not initialized.');
      try {
        await ctx.answerCbQuery();
        const entries = [...te.pendingEntries.entries()];
        if (!entries.length) {
          return ctx.editMessageText(
            `⏳ <b>QUEUED ENTRIES</b>\n\nNo pending pullback entries.\n\nTokens queue here when the scanner finds a signal but waits for price to pull back to the demand zone before entering.`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'oc_queued')],
              [Markup.button.callback('⬅️ Settings', 'oc_settings')],
            ]).reply_markup }
          );
        }
        let text = `⏳ <b>QUEUED ENTRIES</b> (${entries.length})\n\n`;
        const buttons = [];
        for (const [key, entry] of entries) {
          const { signal, queuedAt, signalPrice, demandZone, overextended } = entry;
          const ageMin = (Date.now() - queuedAt) / 60000;
          let timeoutMin = overextended ? 90 : 30;
          if (overextended && demandZone && signalPrice) {
            const dzDistPct = Math.abs(signalPrice - demandZone) / signalPrice * 100;
            if (dzDistPct > 15) timeoutMin = 180;
            else if (dzDistPct > 10) timeoutMin = 150;
            else if (dzDistPct > 5) timeoutMin = 120;
          }
          const remainMin = Math.max(0, timeoutMin - ageMin);
          const dir = signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
          const dzLine = demandZone ? `\n   Zone: $${demandZone.toPrecision(6)}` : '';
          const priceLine = signal.currentPrice ? `\n   Now: ~$${signal.currentPrice.toPrecision(6)}` : '';
          text += `${dir} <b>${escapeHtml(signal.symbol)}</b>${overextended ? ' 🔥' : ''}\n` +
            `   Signal: $${signalPrice?.toPrecision(6) || '?'}${dzLine}${priceLine}\n` +
            `   SL: $${signal.stopLoss?.toPrecision(6) || '?'}\n` +
            `   ⏱ ${ageMin.toFixed(0)}m elapsed / ${timeoutMin}m timeout (${remainMin.toFixed(0)}m left)\n\n`;
          const sym = signal.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
          buttons.push([Markup.button.callback(`❌ Cancel ${signal.symbol}`, `oc_cancel_q_${sym}`)]);
        }
        buttons.push([Markup.button.callback('❌ Cancel All', 'oc_cancel_q_all')]);
        buttons.push([Markup.button.callback('🔄 Refresh', 'oc_queued'), Markup.button.callback('⬅️ Settings', 'oc_settings')]);
        await ctx.editMessageText(text.trim(), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
      } catch (e) {
        logger.error(`oc_queued error: ${e.message}`);
        ctx.answerCbQuery('Error loading queue').catch(() => {});
      }
    });

    this.bot.action('oc_cancel_q_all', async (ctx) => {
      const te = this.onchainTradeExecutor;
      if (!te) return ctx.answerCbQuery('Not initialized.');
      try {
        const count = te.pendingEntries.size;
        te.pendingEntries.clear();
        await ctx.answerCbQuery(`Cancelled ${count} queued entries`);
        await ctx.editMessageText(
          `⏳ <b>QUEUED ENTRIES</b>\n\n✅ Cancelled all ${count} queued entries.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'oc_queued')],
            [Markup.button.callback('⬅️ Settings', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cancel_q_all error: ${e.message}`); }
    });

    this.bot.action(/^oc_cancel_q_(?!all)(.+)$/, async (ctx) => {
      const te = this.onchainTradeExecutor;
      if (!te) return ctx.answerCbQuery('Not initialized.');
      try {
        const slug = ctx.match[1];
        let cancelled = null;
        for (const [key, entry] of te.pendingEntries) {
          const sym = entry.signal.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
          if (sym === slug) {
            cancelled = entry.signal.symbol;
            te.pendingEntries.delete(key);
            break;
          }
        }
        await ctx.answerCbQuery(cancelled ? `Cancelled ${cancelled}` : `${slug} not in queue`);
        // Re-render queue view inline
        const entries = [...te.pendingEntries.entries()];
        if (!entries.length) {
          return ctx.editMessageText(
            `⏳ <b>QUEUED ENTRIES</b>\n\n${cancelled ? `✅ Cancelled <b>${escapeHtml(cancelled)}</b>\n\n` : ''}No pending pullback entries.`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'oc_queued')],
              [Markup.button.callback('⬅️ Settings', 'oc_settings')],
            ]).reply_markup }
          );
        }
        let text = `⏳ <b>QUEUED ENTRIES</b> (${entries.length})${cancelled ? `\n✅ Cancelled <b>${escapeHtml(cancelled)}</b>` : ''}\n\n`;
        const buttons = [];
        for (const [k, e] of entries) {
          const { signal, queuedAt, signalPrice, demandZone, overextended } = e;
          const ageMin = (Date.now() - queuedAt) / 60000;
          let timeoutMin = overextended ? 90 : 30;
          if (overextended && demandZone && signalPrice) {
            const dzDistPct = Math.abs(signalPrice - demandZone) / signalPrice * 100;
            if (dzDistPct > 15) timeoutMin = 180;
            else if (dzDistPct > 10) timeoutMin = 150;
            else if (dzDistPct > 5) timeoutMin = 120;
          }
          const remainMin = Math.max(0, timeoutMin - ageMin);
          const dir = signal.direction === 'long' ? '🟢 LONG' : '🔴 SHORT';
          const dzLine = demandZone ? `\n   Zone: $${demandZone.toPrecision(6)}` : '';
          text += `${dir} <b>${escapeHtml(signal.symbol)}</b>${overextended ? ' 🔥' : ''}\n` +
            `   Signal: $${signalPrice?.toPrecision(6) || '?'}${dzLine}\n` +
            `   ⏱ ${ageMin.toFixed(0)}m / ${timeoutMin}m (${remainMin.toFixed(0)}m left)\n\n`;
          const sym = signal.symbol.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
          buttons.push([Markup.button.callback(`❌ Cancel ${signal.symbol}`, `oc_cancel_q_${sym}`)]);
        }
        buttons.push([Markup.button.callback('❌ Cancel All', 'oc_cancel_q_all')]);
        buttons.push([Markup.button.callback('🔄 Refresh', 'oc_queued'), Markup.button.callback('⬅️ Settings', 'oc_settings')]);
        await ctx.editMessageText(text.trim(), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
      } catch (e) {
        logger.error(`oc_cancel_q error: ${e.message}`);
        ctx.answerCbQuery('Error cancelling').catch(() => {});
      }
    });

    // ── ONCHAIN SETTINGS PANEL (full inline buttons) ──
    const octe = () => this.onchainTradeExecutor;
    const ocCheck = (val, cur) => val === cur ? ' ✓' : '';
    const ocScoreLabel = (te) => {
      if (te && te.minOcScore) return te.minOcScore + '+';
      if (!te) return '45+';
      return te.minConfidence >= 5 ? '60+' : te.minConfidence >= 4 ? '45+' : '30+';
    };

    // Health check: generate warnings/cautions based on current settings
    const getSettingsHealth = (te) => {
      const warnings = []; // critical risks
      const cautions = []; // suboptimal but not dangerous

      // Volatility filter OFF — most dangerous
      if (!te.volatilityFilter) {
        warnings.push('⚡ <b>Volatility Filter OFF</b> — extremely volatile coins (60%+ pumps) will enter freely. High risk of max_loss on pump-and-dump entries.');
      }

      // Max OC score too high — lets exhausted pumps in
      if ((te.maxOcScore || 69) >= 78) {
        warnings.push(`📊 <b>Max Score ${te.maxOcScore}</b> — allowing entries on exhausted pumps (score 75+ = late stage). Consider lowering to 70-75.`);
      }

      // Max loss per trade OFF
      if (!te.maxLossPerTrade || te.maxLossPerTrade <= 0) {
        warnings.push('🔒 <b>Per-Trade Loss Cap OFF</b> — no safety net on individual trades. A single bad entry can wipe daily profit.');
      }

      // Max loss per trade very high relative to position size
      if (te.maxLossPerTrade > te.maxPositionSize * 0.5) {
        warnings.push(`🔒 <b>Loss Cap $${te.maxLossPerTrade} > 50% of $${te.maxPositionSize} size</b> — each losing trade risks more than half the position.`);
      }

      // Circuit breaker OFF
      if (te.cbEnabled === false) {
        cautions.push('🔓 Circuit Breaker OFF — consecutive losses won\'t pause trading. Can compound losses in choppy markets.');
      }

      // High leverage
      if (te.defaultLeverage >= 15) {
        warnings.push(`⚡ <b>Leverage ${te.defaultLeverage}x</b> — very high leverage amplifies both gains and losses. Small moves trigger max_loss.`);
      } else if (te.defaultLeverage >= 10) {
        cautions.push(`⚡ Leverage ${te.defaultLeverage}x — moderate-high. A 1% move = ${te.defaultLeverage}% P&L.`);
      }

      // Risk-fit sizing OFF with high max loss
      if (!te.riskFitSizing && te.maxLossPerTrade > 10) {
        cautions.push(`📐 Risk-Fit OFF — position size doesn\'t adjust to SL distance. Tight SL coins get same size as wide SL.`);
      }

      // Breakeven too tight (leveraged ROI < 10%)
      if (te.profitProtectLevPnl < 10) {
        cautions.push(`🔄 BE trigger at ${te.profitProtectLevPnl}% ROI — very tight. At ${te.defaultLeverage}x, that\'s only ${(te.profitProtectLevPnl / te.defaultLeverage).toFixed(1)}% price move before trailing starts.`);
      }

      // Too many concurrent positions
      if (te.maxConcurrentPositions > 5) {
        cautions.push(`📊 ${te.maxConcurrentPositions} max positions — high exposure. Correlated crypto drops hit all positions at once.`);
      }

      // Market entry mode on volatile coins
      if (te.entryMode === 'market') {
        cautions.push('🚀 Market entry — enters instantly at signal price. No pullback savings, but avoids missing moves.');
      }

      // Confidence scaling OFF
      if (!te.confidenceScaling && !te.riskFitSizing) {
        cautions.push('🎚️ Both Conf-Scale and Risk-Fit OFF — every trade uses full $' + te.maxPositionSize + ' regardless of signal quality or SL distance.');
      }

      // 4H range too wide
      if ((te.max4hRange || 15) > 20) {
        cautions.push(`📏 4H Range ${te.max4hRange}% — wide threshold allows entries on coins with large 4H candles (still pumping hard).`);
      }

      // Build health summary
      if (warnings.length === 0 && cautions.length === 0) {
        return '\n✅ <b>Settings Health: GOOD</b> — all filters active, parameters look balanced.\n';
      }

      let health = '\n';
      if (warnings.length > 0) {
        health += '🚨 <b>WARNINGS:</b>\n';
        for (const w of warnings) health += `  ${w}\n`;
      }
      if (cautions.length > 0) {
        health += '⚠️ <b>Cautions:</b>\n';
        for (const c of cautions) health += `  ${c}\n`;
      }
      if (warnings.length === 0) {
        health += '✅ No critical issues\n';
      }
      return health;
    };

    const showOcSettings = async (ctx, isNew = false) => {
      const te = octe();
      if (!te) return;
      await te.recalcDailyPnL?.();
      const openTrades = await db.getOpenTrades('onchain').catch(() => []);
      const cbStatus = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
      const cbLine = !cbStatus.enabled ? '🔓 Circuit Breaker: <b>OFF</b>'
        : cbStatus.active ? `🚨 Circuit Breaker: <b>PAUSED ${cbStatus.minsLeft}m</b> (${cbStatus.streak} losses)`
        : cbStatus.overrideUntil ? '⏭️ Circuit Breaker: <b>OVERRIDDEN</b>'
        : `🛡️ Circuit Breaker: <b>ON</b> (${te.cbStreak} losses → ${te.cbPauseMinutes}m pause)`;
      const cbBtnLabel = cbStatus.active ? `🚨 CB: PAUSED ${cbStatus.minsLeft}m`
        : !cbStatus.enabled ? '🔓 CB: OFF' : '🛡️ CB: ON';

      const text =
        `🔗 <b>ONCHAIN SETTINGS</b>\n\n` +
        `${te.mode === 'paper' ? '📝' : '💰'} Mode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\n` +
        `💵 Size: <b>$${te.maxPositionSize}</b>/trade\n` +
        `⚡ Leverage: <b>${te.defaultLeverage}x</b>\n` +
        `🛡️ Daily Loss: <b>$${te.maxDailyLoss}</b> | Per-Trade: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n` +
        `🔰 Loss Buffer: <b>${te.lossBufferPct}%</b> (closes at $${te.maxLossPerTrade > 0 ? (te.maxLossPerTrade * te.lossBufferPct / 100).toFixed(1) : '—'})\n` +
        `🔄 Breakeven: <b>${te.profitProtectLevPnl}% ROI</b> (${(te.profitProtectLevPnl / te.defaultLeverage).toFixed(2)}% price @ ${te.defaultLeverage}x)\n` +
        `🎯 TP Exit: <b>TP1 ${(te.tp1ClosePct * 100).toFixed(0)}%</b> close, <b>TP2 ${te.tp2ClosePct >= 1 ? 'ALL' : (te.tp2ClosePct * 100).toFixed(0) + '%'}</b> close\n` +
        `🚀 Entry: <b>${te.entryMode === 'market' ? 'MARKET' : 'PULLBACK'}</b>${te.entryMode === 'market' ? ' (instant at signal)' : ' (waits for zone sweep)'}\n` +
        `📐 Risk-Fit: <b>${te.riskFitSizing ? 'ON' : 'OFF'}</b>${te.riskFitSizing ? ' (shrinks size to cap loss)' : ' (full size)'}\n` +
        `🎚️ Conf-Scale: <b>${te.confidenceScaling ? 'ON' : 'OFF'}</b>${te.confidenceScaling ? ' (low score = smaller size)' : ' (always full size)'}\n` +
        `📏 4H Range: <b>${te.max4hRange || 15}%</b> (rejects pumps above this)\n` +
        `📊 OI Gate: <b>${te.minOiLong ?? 10}%</b> (min OI 4h for longs + direction scoring)\n` +
        `📊 Max Positions: <b>${te.maxConcurrentPositions}</b>\n` +
        `🎯 Score: <b>L:${ocScoreLabel(te)}-${te.maxOcScore || 69} | S:${te.minShortScore || 70}+</b>\n` +
        `🏦 Exchanges: <b>${te.disabledExchanges?.size ? `${te.disabledExchanges.size} off` : 'All ON'}</b>\n` +
        `🔁 Re-entry Drift: <b>${te.maxDriftPct > 0 ? te.maxDriftPct + '%' : 'OFF'}</b>${te.maxDriftPct > 0 ? ' (blocks chasing above this)' : ' (no drift limit)'}\n` +
        `📊 L/S Filter: <b>${te.minTopLS > 0 ? te.minTopLS.toFixed(2) : 'OFF'}</b>${te.minTopLS > 0 ? ' (rejects longs below this)' : ' (no L/S filtering)'}\n` +
        `📉 Trend Filter: <b>${te.trendFilter ? 'ON' : 'OFF'}</b>${te.trendFilter ? ' (blocks longs in 1H downtrends — lower highs/lows)' : ' (no trend structure check)'}\n` +
        `🔥 Exhaustion: <b>${te.exhaustionFilter ? 'ON' : 'OFF'}</b>${te.exhaustionFilter ? ` (detect≥${te.minExhScore ?? 5}, RSI&gt;${te.minExhRsi ?? 80}, score≥${te.minExhShortScore ?? 40}, top&lt;${te.maxNearHigh ?? 10}%)` : ' (no pump exhaustion shorts)'}\n` +
        `🚫 Symbol Cap: <b>${te.maxDailyLossPerSymbol > 0 ? '$' + te.maxDailyLossPerSymbol : 'OFF'}</b>${te.maxDailyLossPerSymbol > 0 ? ' (per-symbol daily loss limit, resets midnight UTC)' : ''}\n` +
        `🕐 Hours: <b>${te.tradingHours?.length ? te.tradingHours.map(([s,e]) => `${String(s).padStart(2,'0')}-${String(e).padStart(2,'0')} UTC`).join(', ') : '24/7'}</b>\n` +
        `📈 Today P&L: <b>$${te.dailyPnL.toFixed(2)}</b>\n` +
        `📋 Open: <b>${openTrades.length}/${te.maxConcurrentPositions}</b>\n` +
        `${cbLine}\n` +
        `${getSettingsHealth(te)}\n` +
        `Tap any button to configure:`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`${te.mode === 'paper' ? '📝' : '🔴'} Mode: ${te.mode.toUpperCase()}`, 'oc_cfg_mode'),
         Markup.button.callback(`${te.enabled ? '✅ ON' : '⛔ OFF'}`, 'oc_cfg_toggle')],
        [Markup.button.callback(`💵 Size: $${te.maxPositionSize}`, 'oc_cfg_size'),
         Markup.button.callback(`⚡ Lev: ${te.defaultLeverage}x`, 'oc_cfg_lev')],
        [Markup.button.callback(`🛡️ Daily: $${te.maxDailyLoss}`, 'oc_cfg_dailyloss'),
         Markup.button.callback(`🔒 Trade: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}`, 'oc_cfg_tradeloss')],
        [Markup.button.callback(`🔰 Buffer: ${te.lossBufferPct}%`, 'oc_cfg_lossbuf'),
         Markup.button.callback(`🔄 BE: ${te.profitProtectLevPnl}%/${(te.trailGivebackPct * 100).toFixed(0)}%`, 'oc_cfg_be')],
        [Markup.button.callback(`🎯 TP1: ${(te.tp1ClosePct * 100).toFixed(0)}%`, 'oc_cfg_tp1'),
         Markup.button.callback(`🎯 TP2: ${te.tp2ClosePct >= 1 ? 'ALL' : (te.tp2ClosePct * 100).toFixed(0) + '%'}`, 'oc_cfg_tp2')],
        [Markup.button.callback(`🚀 Entry: ${te.entryMode === 'hybrid' ? `HYBRID ${te.hybridThreshold}%` : te.entryMode === 'market' ? 'MARKET' : 'PULLBACK'}`, 'oc_cfg_entry'),
         Markup.button.callback(`🎯 TP: ${(te.tpMultPreset || 'default').toUpperCase()}`, 'oc_cfg_tpmult')],
        [Markup.button.callback(`📊 Pos: ${te.maxConcurrentPositions}`, 'oc_cfg_maxpos'),
         Markup.button.callback(`📐 Risk-Fit: ${te.riskFitSizing ? 'ON' : 'OFF'}`, 'oc_cfg_riskfit')],
        [Markup.button.callback(`🎚️ Conf: ${te.confidenceScaling ? 'ON' : 'OFF'}`, 'oc_cfg_confscale'),
         Markup.button.callback(`${te.volatilityFilter ? '🌊 Vol: ON' : '⚡ Vol: OFF'}`, 'oc_cfg_volfilt')],
        [Markup.button.callback(`📏 4H: ${te.max4hRange || 15}%`, 'oc_cfg_4hrange'),
         Markup.button.callback(`📊 OI: ${te.minOiLong ?? 10}%`, 'oc_cfg_oigate')],
        [Markup.button.callback(`🎯 L:${ocScoreLabel(te)}-${te.maxOcScore || 69} S:${te.minShortScore || 70}+`, 'oc_cfg_minscore')],
        [Markup.button.callback(`🏦 Exchanges${te.disabledExchanges?.size ? ` (${te.disabledExchanges.size} off)` : ''}`, 'oc_cfg_exchanges')],
        [Markup.button.callback(`🔁 Drift: ${te.maxDriftPct > 0 ? te.maxDriftPct + '%' : 'OFF'}`, 'oc_cfg_drift'),
         Markup.button.callback(`📊 L/S: ${te.minTopLS > 0 ? te.minTopLS.toFixed(2) : 'OFF'}`, 'oc_cfg_ls')],
        [Markup.button.callback(`📉 Trend: ${te.trendFilter ? 'ON' : 'OFF'}`, 'oc_cfg_trend'),
         Markup.button.callback(`🔥 Exhaust: ${te.exhaustionFilter ? 'ON' : 'OFF'}`, 'oc_cfg_exhaust')],
        [Markup.button.callback(`🔥 Detect: ${te.minExhScore ?? 5}`, 'oc_cfg_exhaust_score'),
         Markup.button.callback(`🔥 RSI: ${te.minExhRsi ?? 80}`, 'oc_cfg_exhaust_rsi')],
        [Markup.button.callback(`🔥 S:${te.minExhShortScore ?? 40}+`, 'oc_cfg_exhaust_short'),
         Markup.button.callback(`🔥 Top: ${te.maxNearHigh ?? 10}%`, 'oc_cfg_nearhigh')],
        [Markup.button.callback(`🚫 SymCap: $${te.maxDailyLossPerSymbol || 'OFF'}`, 'oc_cfg_symcap')],
        [Markup.button.callback(`🕐 Hours: ${te.tradingHours?.length ? te.tradingHours.length + ' windows' : '24/7'}`, 'oc_cfg_hours')],
        [Markup.button.callback(cbBtnLabel, 'oc_cfg_cb')],
        [Markup.button.callback(`📋 Positions (${openTrades.length})`, 'oc_refresh'),
         Markup.button.callback(`⏳ Queued (${te.pendingEntries?.size || 0})`, 'oc_queued')],
        [Markup.button.callback('🔄 Refresh', 'oc_settings')],
        [Markup.button.callback('⬅️ Panel', 'panel_main'),
         Markup.button.callback('🛑 Close All & Stop', 'oc_closeall')],
      ]);

      if (isNew) {
        await ctx.replyWithHTML(text, keyboard);
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      }
    };

    this._showOcSettings = showOcSettings;
    this.bot.action('oc_settings', async (ctx) => {
      if (!octe()) return ctx.answerCbQuery('Not initialized.');
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showOcSettings(ctx); } catch (e) { logger.error(`oc_settings error: ${e.message}`); }
    });

    // ── MODE ──
    this.bot.action('oc_cfg_mode', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — TRADE MODE</b>\n\n` +
          `Current: <b>${te.mode.toUpperCase()}</b> ${te.mode === 'paper' ? '📝' : '💰'}\n\n` +
          `📝 <b>Paper</b> — Simulated trades, no real funds\n` +
          `💰 <b>Live</b> — Real orders on exchange`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`📝 Paper${ocCheck('paper', te.mode)}`, 'oc_mode_paper'),
             Markup.button.callback(`💰 Live${ocCheck('live', te.mode)}`, 'oc_mode_live')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_mode error: ${e.message}`); }
    });
    this.bot.action('oc_mode_paper', async (ctx) => {
      try {
        octe().mode = 'paper'; octe().enabled = true; octe().saveConfig();
        await ctx.answerCbQuery('Paper mode activated');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_mode_paper error: ${e.message}`); }
    });
    this.bot.action('oc_mode_live', async (ctx) => {
      try {
        const te = octe();
        await ctx.editMessageText(
          `⚠️ <b>SWITCH ONCHAIN TO LIVE?</b>\n\n` +
          `Real funds will be used for onchain signals.\n\n` +
          `💵 Size: $${te.maxPositionSize}/trade\n` +
          `⚡ Leverage: ${te.defaultLeverage}x\n` +
          `🔒 Max loss/trade: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'No cap ⚠️'}\n` +
          `🛡️ Daily loss limit: $${te.maxDailyLoss}`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, go LIVE', 'oc_mode_live_yes')],
            [Markup.button.callback('❌ Cancel', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_mode_live error: ${e.message}`); }
    });
    this.bot.action('oc_mode_live_yes', async (ctx) => {
      try {
        octe().mode = 'live'; octe().enabled = true; octe().saveConfig();
        await ctx.answerCbQuery('🔴 LIVE TRADING ACTIVATED');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_mode_live_yes error: ${e.message}`); }
    });

    // ── TOGGLE ──
    this.bot.action('oc_cfg_toggle', async (ctx) => {
      try {
        const te = octe();
        te.enabled = !te.enabled; te.saveConfig();
        await ctx.answerCbQuery(te.enabled ? 'Trading ENABLED' : 'Trading DISABLED');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cfg_toggle error: ${e.message}`); }
    });

    // ── POSITION SIZE ──
    this.bot.action('oc_cfg_size', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — POSITION SIZE</b>\n\n` +
          `Current: <b>$${te.maxPositionSize}</b> per trade\n\n` +
          `This is the maximum margin per trade.\nUse /onchainsize for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$50${ocCheck(50, te.maxPositionSize)}`, 'oc_size_50'),
             Markup.button.callback(`$100${ocCheck(100, te.maxPositionSize)}`, 'oc_size_100'),
             Markup.button.callback(`$250${ocCheck(250, te.maxPositionSize)}`, 'oc_size_250')],
            [Markup.button.callback(`$500${ocCheck(500, te.maxPositionSize)}`, 'oc_size_500'),
             Markup.button.callback(`$1000${ocCheck(1000, te.maxPositionSize)}`, 'oc_size_1000'),
             Markup.button.callback(`$2000${ocCheck(2000, te.maxPositionSize)}`, 'oc_size_2000')],
            [Markup.button.callback(`$3000${ocCheck(3000, te.maxPositionSize)}`, 'oc_size_3000'),
             Markup.button.callback(`$5000${ocCheck(5000, te.maxPositionSize)}`, 'oc_size_5000')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_size error: ${e.message}`); }
    });
    for (const size of [50, 100, 250, 500, 1000, 2000, 3000, 5000]) {
      this.bot.action(`oc_size_${size}`, async (ctx) => {
        try {
          octe().maxPositionSize = size; octe().saveConfig();
          await ctx.answerCbQuery(`Size: $${size}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_size_${size} error: ${e.message}`); }
      });
    }

    // ── LEVERAGE ──
    this.bot.action('oc_cfg_lev', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — LEVERAGE</b>\n\n` +
          `Current: <b>${te.defaultLeverage}x</b>\n\n` +
          `Higher leverage = more profit potential but faster liquidation.\nUse /onchainlev for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3x${ocCheck(3, te.defaultLeverage)}`, 'oc_lev_3'),
             Markup.button.callback(`5x${ocCheck(5, te.defaultLeverage)}`, 'oc_lev_5'),
             Markup.button.callback(`10x${ocCheck(10, te.defaultLeverage)}`, 'oc_lev_10')],
            [Markup.button.callback(`15x${ocCheck(15, te.defaultLeverage)}`, 'oc_lev_15'),
             Markup.button.callback(`20x${ocCheck(20, te.defaultLeverage)}`, 'oc_lev_20'),
             Markup.button.callback(`25x${ocCheck(25, te.defaultLeverage)}`, 'oc_lev_25')],
            [Markup.button.callback(`30x${ocCheck(30, te.defaultLeverage)}`, 'oc_lev_30'),
             Markup.button.callback(`50x${ocCheck(50, te.defaultLeverage)}`, 'oc_lev_50')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_lev error: ${e.message}`); }
    });
    for (const lev of [3, 5, 10, 15, 20, 25, 30, 50]) {
      this.bot.action(`oc_lev_${lev}`, async (ctx) => {
        try {
          octe().defaultLeverage = lev; octe().saveConfig();
          await ctx.answerCbQuery(`Leverage: ${lev}x`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_lev error: ${e.message}`); }
      });
    }

    // ── DAILY LOSS LIMIT ──
    this.bot.action('oc_cfg_dailyloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — DAILY LOSS LIMIT</b>\n\n` +
          `Current: <b>$${te.maxDailyLoss}</b>\n\n` +
          `Trading stops for the day when losses hit this limit.\nUse /onchainloss for custom values.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$10${ocCheck(10, te.maxDailyLoss)}`, 'oc_dloss_10'),
             Markup.button.callback(`$20${ocCheck(20, te.maxDailyLoss)}`, 'oc_dloss_20'),
             Markup.button.callback(`$30${ocCheck(30, te.maxDailyLoss)}`, 'oc_dloss_30')],
            [Markup.button.callback(`$50${ocCheck(50, te.maxDailyLoss)}`, 'oc_dloss_50'),
             Markup.button.callback(`$100${ocCheck(100, te.maxDailyLoss)}`, 'oc_dloss_100'),
             Markup.button.callback(`$200${ocCheck(200, te.maxDailyLoss)}`, 'oc_dloss_200')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_dailyloss error: ${e.message}`); }
    });
    for (const loss of [10, 20, 30, 50, 100, 200]) {
      this.bot.action(`oc_dloss_${loss}`, async (ctx) => {
        try {
          octe().maxDailyLoss = loss; octe().saveConfig();
          await ctx.answerCbQuery(`Daily loss: $${loss}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_dloss error: ${e.message}`); }
      });
    }

    // ── PER-TRADE MAX LOSS ──
    this.bot.action('oc_cfg_tradeloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — PER-TRADE MAX LOSS</b>\n\n` +
          `Current: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n\n` +
          `Trade is force-closed if unrealized loss exceeds this.\nUse /onchainmaxloss for any custom value.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`Off${ocCheck(0, te.maxLossPerTrade)}`, 'oc_tloss_0'),
             Markup.button.callback(`$6${ocCheck(6, te.maxLossPerTrade)}`, 'oc_tloss_6'),
             Markup.button.callback(`$10${ocCheck(10, te.maxLossPerTrade)}`, 'oc_tloss_10')],
            [Markup.button.callback(`$15${ocCheck(15, te.maxLossPerTrade)}`, 'oc_tloss_15'),
             Markup.button.callback(`$20${ocCheck(20, te.maxLossPerTrade)}`, 'oc_tloss_20'),
             Markup.button.callback(`$30${ocCheck(30, te.maxLossPerTrade)}`, 'oc_tloss_30')],
            [Markup.button.callback(`$50${ocCheck(50, te.maxLossPerTrade)}`, 'oc_tloss_50'),
             Markup.button.callback(`$75${ocCheck(75, te.maxLossPerTrade)}`, 'oc_tloss_75'),
             Markup.button.callback(`$100${ocCheck(100, te.maxLossPerTrade)}`, 'oc_tloss_100')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_tradeloss error: ${e.message}`); }
    });
    for (const loss of [0, 6, 10, 15, 20, 30, 50, 75, 100]) {
      this.bot.action(`oc_tloss_${loss}`, async (ctx) => {
        try {
          octe().maxLossPerTrade = loss; octe().saveConfig();
          await ctx.answerCbQuery(loss > 0 ? `Max loss/trade: $${loss}` : 'Per-trade cap disabled');
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_tloss error: ${e.message}`); }
      });
    }

    // ── MAX POSITIONS ──
    this.bot.action('oc_cfg_maxpos', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — MAX CONCURRENT POSITIONS</b>\n\n` +
          `Current: <b>${te.maxConcurrentPositions}</b>\n\n` +
          `Max trades open at the same time.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`1${ocCheck(1, te.maxConcurrentPositions)}`, 'oc_pos_1'),
             Markup.button.callback(`2${ocCheck(2, te.maxConcurrentPositions)}`, 'oc_pos_2'),
             Markup.button.callback(`3${ocCheck(3, te.maxConcurrentPositions)}`, 'oc_pos_3')],
            [Markup.button.callback(`5${ocCheck(5, te.maxConcurrentPositions)}`, 'oc_pos_5'),
             Markup.button.callback(`7${ocCheck(7, te.maxConcurrentPositions)}`, 'oc_pos_7'),
             Markup.button.callback(`10${ocCheck(10, te.maxConcurrentPositions)}`, 'oc_pos_10')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_maxpos error: ${e.message}`); }
    });
    for (const pos of [1, 2, 3, 5, 7, 10]) {
      this.bot.action(`oc_pos_${pos}`, async (ctx) => {
        try {
          octe().maxConcurrentPositions = pos; octe().saveConfig();
          await ctx.answerCbQuery(`Max positions: ${pos}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_pos error: ${e.message}`); }
      });
    }

    // ── MIN SCORE ──
    this.bot.action('oc_cfg_minscore', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.minOcScore || (te.minConfidence >= 5 ? 60 : te.minConfidence >= 4 ? 45 : 30);
        const maxCur = te.maxOcScore || 69;
        const shortMin = te.minShortScore || 70;
        const flipMin = te.flipScore || 70;
        const isBest = cur === 45 && maxCur === 69 && shortMin === 70;
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — SCORE CONFIG</b>\n\n` +
          `📈 <b>LONG:</b> ${cur} — ${maxCur} (min — max)\n` +
          `📉 <b>SHORT:</b> ${shortMin}+ (min)\n` +
          `🔄 <b>FLIP:</b> ${flipMin}+ (re-entry direction flip)\n\n` +
          `${isBest ? '✅ Using <b>BEST</b> preset (data-backed)\n\n' : ''}` +
          `<i>Long 45-49 = 76% WR | Long 70+ = 0% WR\nShort 70+ = 100% WR</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`${isBest ? '✅ ' : ''}BEST PRESET`, 'oc_score_best')],
            [Markup.button.callback(`--- LONG MIN ---`, 'noop')],
            [Markup.button.callback(`30+${ocCheck(30, cur)}`, 'oc_minscore_30'),
             Markup.button.callback(`35+${ocCheck(35, cur)}`, 'oc_minscore_35'),
             Markup.button.callback(`40+${ocCheck(40, cur)}`, 'oc_minscore_40')],
            [Markup.button.callback(`42+${ocCheck(42, cur)}`, 'oc_minscore_42'),
             Markup.button.callback(`45+${ocCheck(45, cur)}`, 'oc_minscore_45'),
             Markup.button.callback(`50+${ocCheck(50, cur)}`, 'oc_minscore_50')],
            [Markup.button.callback(`55+${ocCheck(55, cur)}`, 'oc_minscore_55'),
             Markup.button.callback(`60+${ocCheck(60, cur)}`, 'oc_minscore_60')],
            [Markup.button.callback(`--- LONG MAX ---`, 'noop')],
            [Markup.button.callback(`59${ocCheck(59, maxCur)}`, 'oc_maxscore_59'),
             Markup.button.callback(`69${ocCheck(69, maxCur)}`, 'oc_maxscore_69'),
             Markup.button.callback(`79${ocCheck(79, maxCur)}`, 'oc_maxscore_79'),
             Markup.button.callback(`No cap${ocCheck(99, maxCur)}`, 'oc_maxscore_99')],
            [Markup.button.callback(`--- SHORT MIN ---`, 'noop')],
            [Markup.button.callback(`35+${ocCheck(35, shortMin)}`, 'oc_shortmin_35'),
             Markup.button.callback(`40+${ocCheck(40, shortMin)}`, 'oc_shortmin_40'),
             Markup.button.callback(`42+${ocCheck(42, shortMin)}`, 'oc_shortmin_42'),
             Markup.button.callback(`45+${ocCheck(45, shortMin)}`, 'oc_shortmin_45')],
            [Markup.button.callback(`50+${ocCheck(50, shortMin)}`, 'oc_shortmin_50'),
             Markup.button.callback(`60+${ocCheck(60, shortMin)}`, 'oc_shortmin_60')],
            [Markup.button.callback(`--- FLIP MIN ---`, 'noop')],
            [Markup.button.callback(`45+${ocCheck(45, flipMin)}`, 'oc_flipscore_45'),
             Markup.button.callback(`55+${ocCheck(55, flipMin)}`, 'oc_flipscore_55'),
             Markup.button.callback(`60+${ocCheck(60, flipMin)}`, 'oc_flipscore_60'),
             Markup.button.callback(`70+${ocCheck(70, flipMin)}`, 'oc_flipscore_70')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_minscore error: ${e.message}`); }
    });
    // Best preset: Long 45-69, Short 70+
    this.bot.action('noop', async (ctx) => { await ctx.answerCbQuery(); });
    this.bot.action('oc_score_best', async (ctx) => {
      try {
        const te = octe();
        te.minOcScore = 45;
        te.minConfidence = 4;
        te.maxOcScore = 69;
        te.minShortScore = 45;
        te.flipScore = 70;
        te.saveConfig();
        await ctx.answerCbQuery('Best preset applied: L 45-69, S 45+, Flip 70+');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_score_best error: ${e.message}`); }
    });
    for (const score of [30, 35, 40, 42, 45, 50, 55, 60]) {
      this.bot.action(`oc_minscore_${score}`, async (ctx) => {
        try {
          const te = octe();
          te.minOcScore = score;
          te.minConfidence = score >= 60 ? 5 : score >= 45 ? 4 : 3;
          te.saveConfig();
          await ctx.answerCbQuery(`Long min: ${score}+`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_score error: ${e.message}`); }
      });
    }
    for (const score of [59, 69, 79, 99]) {
      this.bot.action(`oc_maxscore_${score}`, async (ctx) => {
        try {
          const te = octe();
          te.maxOcScore = score;
          te.saveConfig();
          await ctx.answerCbQuery(`Long max: ${score}${score >= 99 ? ' (no cap)' : ''}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_maxscore error: ${e.message}`); }
      });
    }
    for (const score of [35, 40, 42, 45, 50, 60]) {
      this.bot.action(`oc_shortmin_${score}`, async (ctx) => {
        try {
          const te = octe();
          te.minShortScore = score;
          te.saveConfig();
          await ctx.answerCbQuery(`Short min: ${score}+`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_shortmin error: ${e.message}`); }
      });
    }
    for (const score of [45, 55, 60, 70]) {
      this.bot.action(`oc_flipscore_${score}`, async (ctx) => {
        try {
          const te = octe();
          te.flipScore = score;
          te.saveConfig();
          await ctx.answerCbQuery(`Flip min: ${score}+`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_flipscore error: ${e.message}`); }
      });
    }

    // ── CIRCUIT BREAKER ──
    this.bot.action('oc_cfg_cb', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cb = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
        let text = '🛡️ <b>CIRCUIT BREAKER</b>\n\n';
        text += `Status: ${cb.active ? `🚨 <b>PAUSED</b> — ${cb.minsLeft}m remaining (${cb.streak} losses)` : cb.enabled ? '✅ Armed' : '🔓 Disabled'}\n`;
        text += `Trigger: <b>${te.cbStreak} consecutive losses</b>\n`;
        text += `Pause: <b>${te.cbPauseMinutes} minutes</b>\n\n`;
        if (cb.active) text += '<i>Trading is paused. Override to resume immediately.</i>';
        else if (!cb.enabled) text += '<i>Circuit breaker is disabled — no pause on losing streaks.</i>';
        else text += '<i>Will auto-pause trading after consecutive losses.</i>';

        const buttons = [];
        if (cb.active) {
          buttons.push([Markup.button.callback('⏭️ Override — Resume Now', 'oc_cb_override')]);
        }
        buttons.push([
          Markup.button.callback(`${te.cbEnabled ? '🔓 Disable' : '✅ Enable'}`, 'oc_cb_toggle'),
        ]);
        buttons.push([
          Markup.button.callback('3 losses', `oc_cb_streak_3`),
          Markup.button.callback('4 losses', `oc_cb_streak_4`),
          Markup.button.callback('5 losses', `oc_cb_streak_5`),
        ]);
        buttons.push([
          Markup.button.callback('30m pause', `oc_cb_pause_30`),
          Markup.button.callback('60m', `oc_cb_pause_60`),
          Markup.button.callback('120m', `oc_cb_pause_120`),
        ]);
        buttons.push([Markup.button.callback('⬅️ Back', 'oc_settings')]);
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
      } catch (e) { logger.error(`oc_cfg_cb error: ${e.message}`); }
    });

    this.bot.action('oc_cb_toggle', async (ctx) => {
      try {
        const te = octe();
        te.cbEnabled = !te.cbEnabled;
        te.saveConfig();
        await ctx.answerCbQuery(`Circuit breaker ${te.cbEnabled ? 'enabled' : 'disabled'}`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cb_toggle error: ${e.message}`); }
    });

    this.bot.action('oc_cb_override', async (ctx) => {
      try {
        const te = octe();
        te.cbOverrideUntil = Date.now() + 4 * 60 * 60 * 1000;
        await ctx.answerCbQuery('Circuit breaker overridden — trading resumed');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cb_override error: ${e.message}`); }
    });

    for (const n of [3, 4, 5]) {
      this.bot.action(`oc_cb_streak_${n}`, async (ctx) => {
        try {
          octe().cbStreak = n; octe().saveConfig();
          await ctx.answerCbQuery(`CB triggers after ${n} losses`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_cb_streak error: ${e.message}`); }
      });
    }
    for (const m of [30, 60, 120]) {
      this.bot.action(`oc_cb_pause_${m}`, async (ctx) => {
        try {
          octe().cbPauseMinutes = m; octe().saveConfig();
          await ctx.answerCbQuery(`CB pause: ${m} minutes`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_cb_pause error: ${e.message}`); }
      });
    }

    // Volatility filter toggle
    this.bot.action('oc_cfg_volfilt', async (ctx) => {
      try {
        const te = octe();
        te.volatilityFilter = !te.volatilityFilter;
        te.saveConfig();
        await ctx.answerCbQuery(`Volatility filter ${te.volatilityFilter ? 'enabled' : 'disabled'}`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cfg_volfilt error: ${e.message}`); }
    });

    // Trend structure filter toggle
    this.bot.action('oc_cfg_trend', async (ctx) => {
      try {
        const te = octe();
        te.trendFilter = !te.trendFilter;
        te.saveConfig();
        await ctx.answerCbQuery(`Trend filter ${te.trendFilter ? 'ON — blocks longs in downtrends' : 'OFF'}`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cfg_trend error: ${e.message}`); }
    });

    // Pump exhaustion filter toggle
    this.bot.action('oc_cfg_exhaust', async (ctx) => {
      try {
        const te = octe();
        te.exhaustionFilter = !te.exhaustionFilter;
        te.saveConfig();
        await ctx.answerCbQuery(`Exhaustion filter ${te.exhaustionFilter ? 'ON — flips pump-tops to shorts' : 'OFF'}`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cfg_exhaust error: ${e.message}`); }
    });

    // Exhaustion min score setting
    this.bot.action('oc_cfg_exhaust_score', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.minExhScore ?? 5;
        await ctx.editMessageText(
          `🔥 <b>ONCHAIN — EXHAUSTION MIN SCORE</b>\n\n` +
          `Current: <b>${cur}</b>\n\n` +
          `Exhaustion scoring axes (max 12):\n` +
          `• Price pump: +1/+2/+3 (5%/10%/15%)\n` +
          `• Near 24h high: +1/+2 (6%/3%)\n` +
          `• OI 4h: +1/+2/+3 (15%/25%/50%)\n` +
          `• Funding: +1/+2 (0.03%/0.1%)\n` +
          `• RSI 5m: +2 (above ${te.minExhRsi ?? 80})\n\n` +
          `Lower = more exhaustion shorts triggered\n` +
          `Higher = only strongest pump-tops flip`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3${cur === 3 ? ' ✓' : ''}`, 'oc_exhs_3'),
             Markup.button.callback(`4${cur === 4 ? ' ✓' : ''}`, 'oc_exhs_4')],
            [Markup.button.callback(`5${cur === 5 ? ' ✓' : ''}`, 'oc_exhs_5'),
             Markup.button.callback(`6${cur === 6 ? ' ✓' : ''}`, 'oc_exhs_6')],
            [Markup.button.callback(`7${cur === 7 ? ' ✓' : ''}`, 'oc_exhs_7'),
             Markup.button.callback(`8${cur === 8 ? ' ✓' : ''}`, 'oc_exhs_8')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_exhaust_score error: ${e.message}`); }
    });

    for (const v of [3, 4, 5, 6, 7, 8]) {
      this.bot.action(`oc_exhs_${v}`, async (ctx) => {
        try {
          const te = octe();
          te.minExhScore = v;
          te.saveConfig();
          await ctx.answerCbQuery(`Exhaustion min score set to ${v}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_exhs_${v} error: ${e.message}`); }
      });
    }

    // Exhaustion min RSI setting
    this.bot.action('oc_cfg_exhaust_rsi', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.minExhRsi ?? 80;
        await ctx.editMessageText(
          `🔥 <b>ONCHAIN — EXHAUSTION MIN RSI (5m)</b>\n\n` +
          `Current: <b>${cur}</b>\n\n` +
          `When 5m RSI is above this threshold, it adds +2 to the exhaustion score.\n` +
          `Lower RSI = more likely to add RSI points → more shorts\n` +
          `Higher RSI = only extreme overbought triggers RSI bonus`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`65${cur === 65 ? ' ✓' : ''}`, 'oc_exhr_65'),
             Markup.button.callback(`70${cur === 70 ? ' ✓' : ''}`, 'oc_exhr_70'),
             Markup.button.callback(`73${cur === 73 ? ' ✓' : ''}`, 'oc_exhr_73')],
            [Markup.button.callback(`75${cur === 75 ? ' ✓' : ''}`, 'oc_exhr_75'),
             Markup.button.callback(`77${cur === 77 ? ' ✓' : ''}`, 'oc_exhr_77'),
             Markup.button.callback(`78${cur === 78 ? ' ✓' : ''}`, 'oc_exhr_78')],
            [Markup.button.callback(`80${cur === 80 ? ' ✓' : ''}`, 'oc_exhr_80'),
             Markup.button.callback(`85${cur === 85 ? ' ✓' : ''}`, 'oc_exhr_85'),
             Markup.button.callback(`90${cur === 90 ? ' ✓' : ''}`, 'oc_exhr_90')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_exhaust_rsi error: ${e.message}`); }
    });

    for (const v of [65, 70, 73, 75, 77, 78, 80, 85, 90]) {
      this.bot.action(`oc_exhr_${v}`, async (ctx) => {
        try {
          const te = octe();
          te.minExhRsi = v;
          te.saveConfig();
          await ctx.answerCbQuery(`Exhaustion RSI threshold set to ${v}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_exhr_${v} error: ${e.message}`); }
      });
    }

    // Exhaustion short min onchain score
    this.bot.action('oc_cfg_exhaust_short', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.minExhShortScore ?? 0;
        await ctx.editMessageText(
          `🔥 <b>ONCHAIN — EXHAUSTION SHORT MIN SCORE</b>\n\n` +
          `Current: <b>${cur}+</b>\n\n` +
          `Minimum onchain score required for exhaustion/crowded short trades.\n` +
          `Regular shorts use S:${te.minShortScore || 45}+, this is a separate gate for pump-top shorts.\n\n` +
          `Lower = more exhaustion shorts pass\n` +
          `Higher = only high-conviction pump-top shorts`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`30${cur === 30 ? ' ✓' : ''}`, 'oc_exhss_30'),
             Markup.button.callback(`35${cur === 35 ? ' ✓' : ''}`, 'oc_exhss_35')],
            [Markup.button.callback(`40${cur === 40 ? ' ✓' : ''}`, 'oc_exhss_40'),
             Markup.button.callback(`42${cur === 42 ? ' ✓' : ''}`, 'oc_exhss_42')],
            [Markup.button.callback(`45${cur === 45 ? ' ✓' : ''}`, 'oc_exhss_45'),
             Markup.button.callback(`50${cur === 50 ? ' ✓' : ''}`, 'oc_exhss_50')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_exhaust_short error: ${e.message}`); }
    });

    for (const v of [30, 35, 40, 42, 45, 50]) {
      this.bot.action(`oc_exhss_${v}`, async (ctx) => {
        try {
          const te = octe();
          te.minExhShortScore = v;
          te.saveConfig();
          await ctx.answerCbQuery(`Exhaustion short min score ${v === 0 ? 'OFF (bypass)' : `set to ${v}`}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_exhss_${v} error: ${e.message}`); }
      });
    }

    // Near-high gate: max % from 24h high for exhaustion to trigger
    this.bot.action('oc_cfg_nearhigh', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.maxNearHigh ?? 10;
        await ctx.editMessageText(
          `🔥 <b>ONCHAIN — EXHAUSTION NEAR-HIGH GATE</b>\n\n` +
          `Current: <b>${cur}%</b>\n\n` +
          `If price is more than this % below the 24h high, the pump top window is considered closed and exhaustion is blocked.\n\n` +
          `Lower = stricter (only catches entries very near the peak)\n` +
          `Higher = looser (allows shorts further from the top)`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`5%${cur === 5 ? ' ✓' : ''}`, 'oc_nh_5'),
             Markup.button.callback(`7%${cur === 7 ? ' ✓' : ''}`, 'oc_nh_7')],
            [Markup.button.callback(`8%${cur === 8 ? ' ✓' : ''}`, 'oc_nh_8'),
             Markup.button.callback(`10%${cur === 10 ? ' ✓' : ''}`, 'oc_nh_10')],
            [Markup.button.callback(`12%${cur === 12 ? ' ✓' : ''}`, 'oc_nh_12'),
             Markup.button.callback(`15%${cur === 15 ? ' ✓' : ''}`, 'oc_nh_15')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_nearhigh error: ${e.message}`); }
    });

    for (const v of [5, 7, 8, 10, 12, 15]) {
      this.bot.action(`oc_nh_${v}`, async (ctx) => {
        try {
          const te = octe();
          te.maxNearHigh = v;
          te.saveConfig();
          await ctx.answerCbQuery(`Near-high gate set to ${v}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_nh_${v} error: ${e.message}`); }
      });
    }

    // 4H candle range threshold
    this.bot.action('oc_cfg_4hrange', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.max4hRange || 15;
        await ctx.editMessageText(
          `📏 <b>ONCHAIN — 4H CANDLE RANGE LIMIT</b>\n\n` +
          `Current: <b>${cur}%</b>\n\n` +
          `Rejects trades when the current or previous 4H candle has a range (high-low) exceeding this threshold.\n\n` +
          `Lower = stricter (skips more pumps)\n` +
          `Higher = looser (enters during bigger moves)`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`10%${cur === 10 ? ' ✓' : ''}`, 'oc_4hr_10'),
             Markup.button.callback(`15%${cur === 15 ? ' ✓' : ''}`, 'oc_4hr_15')],
            [Markup.button.callback(`20%${cur === 20 ? ' ✓' : ''}`, 'oc_4hr_20'),
             Markup.button.callback(`25%${cur === 25 ? ' ✓' : ''}`, 'oc_4hr_25')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_4hrange error: ${e.message}`); }
    });
    for (const val of [10, 15, 20, 25]) {
      this.bot.action(`oc_4hr_${val}`, async (ctx) => {
        try {
          const te = octe();
          te.max4hRange = val;
          te.saveConfig();
          await ctx.answerCbQuery(`4H range limit set to ${val}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_4hr_${val} error: ${e.message}`); }
      });
    }

    // OI gate threshold for longs
    this.bot.action('oc_cfg_oigate', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.minOiLong ?? 10;
        await ctx.editMessageText(
          `📊 <b>ONCHAIN — OI GATE (Long Entry)</b>\n\n` +
          `Current: <b>${cur}%</b>\n\n` +
          `Minimum OI 4h change required to enter longs. Also used as the bull-point threshold in direction scoring.\n\n` +
          `Lower = more long entries (catches early momentum)\n` +
          `Higher = stricter (only enters on confirmed OI buildup)\n\n` +
          `⚠️ Below 5% risks entering without real momentum confirmation.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3%${cur === 3 ? ' ✓' : ''}`, 'oc_oi_3'),
             Markup.button.callback(`5%${cur === 5 ? ' ✓' : ''}`, 'oc_oi_5')],
            [Markup.button.callback(`7%${cur === 7 ? ' ✓' : ''}`, 'oc_oi_7'),
             Markup.button.callback(`10%${cur === 10 ? ' ✓' : ''}`, 'oc_oi_10')],
            [Markup.button.callback(`15%${cur === 15 ? ' ✓' : ''}`, 'oc_oi_15'),
             Markup.button.callback(`20%${cur === 20 ? ' ✓' : ''}`, 'oc_oi_20')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_oigate error: ${e.message}`); }
    });
    for (const val of [3, 5, 7, 10, 15, 20]) {
      this.bot.action(`oc_oi_${val}`, async (ctx) => {
        try {
          const te = octe();
          te.minOiLong = val;
          te.saveConfig();
          await ctx.answerCbQuery(`OI gate set to ${val}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_oi_${val} error: ${e.message}`); }
      });
    }

    this.bot.action('oc_cfg_drift', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.maxDriftPct;
        await ctx.editMessageText(
          `🔁 <b>ONCHAIN — RE-ENTRY DRIFT LIMIT</b>\n\n` +
          `Current: <b>${cur}%</b>\n\n` +
          `Blocks re-entry if price has drifted more than this % from the last entry price (in the trade direction).\n\n` +
          `Lower = stricter (prevents chasing pumps)\n` +
          `Higher = looser (allows wider re-entries)`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`1%${cur === 1 ? ' ✓' : ''}`, 'oc_drift_1'),
             Markup.button.callback(`2%${cur === 2 ? ' ✓' : ''}`, 'oc_drift_2'),
             Markup.button.callback(`3%${cur === 3 ? ' ✓' : ''}`, 'oc_drift_3')],
            [Markup.button.callback(`5%${cur === 5 ? ' ✓' : ''}`, 'oc_drift_5'),
             Markup.button.callback(`7%${cur === 7 ? ' ✓' : ''}`, 'oc_drift_7'),
             Markup.button.callback(`10%${cur === 10 ? ' ✓' : ''}`, 'oc_drift_10')],
            [Markup.button.callback(`15%${cur === 15 ? ' ✓' : ''}`, 'oc_drift_15'),
             Markup.button.callback(`20%${cur === 20 ? ' ✓' : ''}`, 'oc_drift_20'),
             Markup.button.callback(`OFF${cur === 0 ? ' ✓' : ''}`, 'oc_drift_0')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_drift error: ${e.message}`); }
    });
    for (const val of [0, 1, 2, 3, 5, 7, 10, 15, 20]) {
      this.bot.action(`oc_drift_${val}`, async (ctx) => {
        try {
          const te = octe();
          te.maxDriftPct = val;
          te.saveConfig();
          await ctx.answerCbQuery(val === 0 ? 'Re-entry drift check OFF' : `Re-entry drift limit set to ${val}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_drift_${val} error: ${e.message}`); }
      });
    }

    this.bot.action('oc_cfg_symcap', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.maxDailyLossPerSymbol;
        await ctx.editMessageText(
          `🚫 <b>ONCHAIN — PER-SYMBOL DAILY LOSS CAP</b>\n\n` +
          `Current: <b>$${cur || 'OFF'}</b>\n\n` +
          `Blocks re-entry on a coin if net P&amp;L on that symbol today exceeds this loss.\n` +
          `Resets at <b>midnight UTC</b> daily.\n\n` +
          `Prevents the bot from repeatedly entering the same losing coin.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$5${cur === 5 ? ' ✓' : ''}`, 'oc_symcap_5'),
             Markup.button.callback(`$10${cur === 10 ? ' ✓' : ''}`, 'oc_symcap_10'),
             Markup.button.callback(`$15${cur === 15 ? ' ✓' : ''}`, 'oc_symcap_15')],
            [Markup.button.callback(`$20${cur === 20 ? ' ✓' : ''}`, 'oc_symcap_20'),
             Markup.button.callback(`$25${cur === 25 ? ' ✓' : ''}`, 'oc_symcap_25'),
             Markup.button.callback(`$50${cur === 50 ? ' ✓' : ''}`, 'oc_symcap_50')],
            [Markup.button.callback(`OFF${cur === 0 ? ' ✓' : ''}`, 'oc_symcap_0')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_symcap error: ${e.message}`); }
    });
    for (const val of [0, 5, 10, 15, 20, 25, 50]) {
      this.bot.action(`oc_symcap_${val}`, async (ctx) => {
        try {
          const te = octe();
          te.maxDailyLossPerSymbol = val;
          te.saveConfig();
          await ctx.answerCbQuery(val === 0 ? 'Per-symbol daily cap OFF' : `Per-symbol daily cap set to $${val}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_symcap_${val} error: ${e.message}`); }
      });
    }

    this.bot.action('oc_cfg_ls', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.minTopLS;
        await ctx.editMessageText(
          `📊 <b>ONCHAIN — L/S POSITIONING FILTER</b>\n\n` +
          `Current: <b>${cur > 0 ? cur.toFixed(2) : 'OFF'}</b>\n\n` +
          `Blocks LONG entries when top traders' Long/Short ratio is below this threshold.\n` +
          `Blocks SHORT entries when L/S is above the inverse (1/threshold).\n\n` +
          `<b>OFF</b> = Recommended. Data shows low L/S coins like BR still produce big winners.\n` +
          `<b>0.30</b> = Very loose — only blocks extreme shorts\n` +
          `<b>0.50</b> = Moderate\n` +
          `<b>0.75</b> = Strict (old default — blocked BR at 0.278)`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`OFF${cur === 0 ? ' ✓' : ''}`, 'oc_ls_0'),
             Markup.button.callback(`0.20${cur === 0.2 ? ' ✓' : ''}`, 'oc_ls_020'),
             Markup.button.callback(`0.25${cur === 0.25 ? ' ✓' : ''}`, 'oc_ls_025')],
            [Markup.button.callback(`0.30${cur === 0.3 ? ' ✓' : ''}`, 'oc_ls_030'),
             Markup.button.callback(`0.50${cur === 0.5 ? ' ✓' : ''}`, 'oc_ls_050')],
            [Markup.button.callback(`0.75${cur === 0.75 ? ' ✓' : ''}`, 'oc_ls_075'),
             Markup.button.callback(`1.00${cur === 1 ? ' ✓' : ''}`, 'oc_ls_100')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_ls error: ${e.message}`); }
    });
    for (const [label, val] of [['0', 0], ['020', 0.2], ['025', 0.25], ['030', 0.3], ['050', 0.5], ['075', 0.75], ['100', 1]]) {
      this.bot.action(`oc_ls_${label}`, async (ctx) => {
        try {
          const te = octe();
          te.minTopLS = val;
          te.saveConfig();
          await ctx.answerCbQuery(val === 0 ? 'L/S filter OFF' : `L/S filter set to ${val.toFixed(2)}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_ls_${label} error: ${e.message}`); }
      });
    }

    this.bot.action('oc_cfg_riskfit', async (ctx) => {
      try {
        const te = octe();
        te.riskFitSizing = !te.riskFitSizing; te.saveConfig();
        await ctx.answerCbQuery(`Risk-fit sizing ${te.riskFitSizing ? 'ON' : 'OFF'}`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cfg_riskfit error: ${e.message}`); }
    });

    this.bot.action('oc_cfg_confscale', async (ctx) => {
      try {
        const te = octe();
        te.confidenceScaling = !te.confidenceScaling; te.saveConfig();
        await ctx.answerCbQuery(`Confidence scaling ${te.confidenceScaling ? 'ON — low score = 50-75% size' : 'OFF — always full size'}`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_cfg_confscale error: ${e.message}`); }
    });

    // oc_ EXCHANGES
    this.bot.action('oc_cfg_exchanges', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const exchanges = ['binance', 'bybit'];
        let desc = `🔗 <b>ONCHAIN — EXCHANGES</b>\n\n`;
        desc += `Enable/disable exchanges for onchain trades.\nDisabled exchanges won't receive new trades.\n\n`;
        for (const ex of exchanges) {
          const disabled = te.disabledExchanges?.has(ex);
          const hasKey = !!(te.exchanges[ex]?.apiKey);
          desc += `${disabled ? '❌' : '✅'} <b>${ex}</b>${hasKey ? '' : ' (no API key)'}\n`;
        }
        await ctx.editMessageText(desc, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            exchanges.map(ex => {
              const disabled = te.disabledExchanges?.has(ex);
              return Markup.button.callback(`${disabled ? '❌' : '✅'} ${ex}`, `oc_ex_${ex}`);
            }),
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup,
        });
      } catch (e) { logger.error(`oc_cfg_exchanges error: ${e.message}`); }
    });
    for (const exId of ['binance', 'bybit']) {
      this.bot.action(`oc_ex_${exId}`, async (ctx) => {
        try {
          const te = octe();
          if (!te.disabledExchanges) te.disabledExchanges = new Set();
          if (te.disabledExchanges.has(exId)) { te.disabledExchanges.delete(exId); }
          else { te.disabledExchanges.add(exId); }
          te.saveConfig();
          await ctx.answerCbQuery(`${exId}: ${te.disabledExchanges.has(exId) ? 'disabled' : 'enabled'}`);
          await ctx.deleteMessage().catch(() => {});
          await showOcSettings(ctx, true);
        } catch (e) { logger.error(`oc_ex toggle error: ${e.message}`); }
      });
    }

    // oc_ LOSS BUFFER
    this.bot.action('oc_cfg_lossbuf', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const effCap = te.maxLossPerTrade > 0 ? `$${(te.maxLossPerTrade * te.lossBufferPct / 100).toFixed(1)}` : '—';
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — LOSS BUFFER</b>\n\n` +
          `Current: <b>${te.lossBufferPct}%</b> (closes at ${effCap} of $${te.maxLossPerTrade} cap)\n\n` +
          `<i>Closes trade early to avoid overshooting the loss cap.\n100% = close exactly at cap (may overshoot).\n80% = close at 80% of cap (safer).</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`60%${ocCheck(60, te.lossBufferPct)}`, 'oc_buf_60'),
             Markup.button.callback(`70%${ocCheck(70, te.lossBufferPct)}`, 'oc_buf_70'),
             Markup.button.callback(`80%${ocCheck(80, te.lossBufferPct)}`, 'oc_buf_80')],
            [Markup.button.callback(`90%${ocCheck(90, te.lossBufferPct)}`, 'oc_buf_90'),
             Markup.button.callback(`100%${ocCheck(100, te.lossBufferPct)}`, 'oc_buf_100')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_lossbuf error: ${e.message}`); }
    });
    for (const pct of [60, 70, 80, 90, 100]) {
      this.bot.action(`oc_buf_${pct}`, async (ctx) => {
        try {
          octe().lossBufferPct = pct; octe().saveConfig();
          await ctx.answerCbQuery(`Loss buffer: ${pct}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_buf error: ${e.message}`); }
      });
    }

    // oc_ BREAKEVEN THRESHOLD
    this.bot.action('oc_cfg_be', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const pricePct = (te.profitProtectLevPnl / te.defaultLeverage).toFixed(2);
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — BREAKEVEN TRIGGER</b>\n\n` +
          `Current: <b>${te.profitProtectLevPnl}% leveraged ROI</b>\n` +
          `At ${te.defaultLeverage}x leverage = <b>${pricePct}%</b> price move\n\n` +
          `<i>Once a trade reaches this ROI, SL moves to entry (breakeven).\nLower = safer (triggers sooner), higher = gives more room.\nTrail giveback: ${(te.trailGivebackPct * 100).toFixed(0)}% — how much of profit SL can retrace.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`5%${ocCheck(5, te.profitProtectLevPnl)}`, 'oc_be_5'),
             Markup.button.callback(`10%${ocCheck(10, te.profitProtectLevPnl)}`, 'oc_be_10'),
             Markup.button.callback(`15%${ocCheck(15, te.profitProtectLevPnl)}`, 'oc_be_15')],
            [Markup.button.callback(`20%${ocCheck(20, te.profitProtectLevPnl)}`, 'oc_be_20'),
             Markup.button.callback(`25%${ocCheck(25, te.profitProtectLevPnl)}`, 'oc_be_25'),
             Markup.button.callback(`35%${ocCheck(35, te.profitProtectLevPnl)}`, 'oc_be_35')],
            [Markup.button.callback(`Trail: 25%${ocCheck(0.25, te.trailGivebackPct)}`, 'oc_trail_25'),
             Markup.button.callback(`Trail: 40%${ocCheck(0.40, te.trailGivebackPct)}`, 'oc_trail_40'),
             Markup.button.callback(`Trail: 50%${ocCheck(0.50, te.trailGivebackPct)}`, 'oc_trail_50')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_be error: ${e.message}`); }
    });
    for (const roi of [5, 10, 15, 20, 25, 35]) {
      this.bot.action(`oc_be_${roi}`, async (ctx) => {
        try {
          octe().profitProtectLevPnl = roi; octe().saveConfig();
          await ctx.answerCbQuery(`Breakeven at ${roi}% ROI`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_be error: ${e.message}`); }
      });
    }
    for (const pct of [0.25, 0.40, 0.50]) {
      this.bot.action(`oc_trail_${Math.round(pct * 100)}`, async (ctx) => {
        try {
          octe().trailGivebackPct = pct; octe().saveConfig();
          await ctx.answerCbQuery(`Trail giveback: ${Math.round(pct * 100)}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_trail error: ${e.message}`); }
      });
    }

    // ── TP1 EXIT % ──
    this.bot.action('oc_cfg_tp1', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — TP1 CLOSE %</b>\n\n` +
          `Current: <b>${(te.tp1ClosePct * 100).toFixed(0)}%</b> of position closed at TP1\n\n` +
          `<i>Higher = bank more profit early (safer).\nLower = keep more for TP2/TP3 (bigger upside).</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`25%${ocCheck(0.25, te.tp1ClosePct)}`, 'oc_tp1_25'),
             Markup.button.callback(`33%${ocCheck(0.33, te.tp1ClosePct)}`, 'oc_tp1_33'),
             Markup.button.callback(`50%${ocCheck(0.50, te.tp1ClosePct)}`, 'oc_tp1_50')],
            [Markup.button.callback(`67%${ocCheck(0.67, te.tp1ClosePct)}`, 'oc_tp1_67'),
             Markup.button.callback(`75%${ocCheck(0.75, te.tp1ClosePct)}`, 'oc_tp1_75'),
             Markup.button.callback(`100%${ocCheck(1.0, te.tp1ClosePct)}`, 'oc_tp1_100')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_tp1 error: ${e.message}`); }
    });
    for (const pct of [25, 33, 50, 67, 75, 100]) {
      this.bot.action(`oc_tp1_${pct}`, async (ctx) => {
        try {
          octe().tp1ClosePct = pct / 100; octe().saveConfig();
          await ctx.answerCbQuery(`TP1 closes ${pct}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_tp1 error: ${e.message}`); }
      });
    }

    // ── TP2 EXIT % ──
    this.bot.action('oc_cfg_tp2', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — TP2 CLOSE %</b>\n\n` +
          `Current: <b>${te.tp2ClosePct >= 1 ? 'ALL (100%)' : (te.tp2ClosePct * 100).toFixed(0) + '%'}</b> of remaining closed at TP2\n\n` +
          `<i>100% = close everything at TP2, trade done (recommended for onchain).\nLower % keeps a runner for TP3/TP4.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`33%${ocCheck(0.33, te.tp2ClosePct)}`, 'oc_tp2_33'),
             Markup.button.callback(`50%${ocCheck(0.50, te.tp2ClosePct)}`, 'oc_tp2_50'),
             Markup.button.callback(`75%${ocCheck(0.75, te.tp2ClosePct)}`, 'oc_tp2_75')],
            [Markup.button.callback(`ALL (100%)${ocCheck(1.0, te.tp2ClosePct)}`, 'oc_tp2_100')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_tp2 error: ${e.message}`); }
    });
    for (const pct of [33, 50, 75, 100]) {
      this.bot.action(`oc_tp2_${pct}`, async (ctx) => {
        try {
          octe().tp2ClosePct = pct / 100; octe().saveConfig();
          await ctx.answerCbQuery(`TP2 closes ${pct}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_tp2 error: ${e.message}`); }
      });
    }

    // ── TRADING HOURS ──
    this.bot.action('oc_cfg_hours', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const hasHours = te.tradingHours?.length > 0;
        const hoursDesc = hasHours
          ? te.tradingHours.map(([s, e]) => {
              const ws = (s + 1) % 24, we = (e + 1) % 24;
              const fmt = h => { const h12 = h % 12 || 12; return h12 + (h >= 12 ? 'PM' : 'AM'); };
              return `${fmt(ws)}-${fmt(we)} WAT (${s}-${e} UTC)`;
            }).join('\n')
          : '24/7 (no restrictions)';
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — TRADING HOURS</b>\n\n` +
          `Current:\n<b>${hoursDesc}</b>\n\n` +
          `<b>Best hours (data):</b>\n` +
          `✅ 8PM-1AM WAT (19-0 UTC) — 60-67% WR\n` +
          `✅ 7-8AM WAT (6-7 UTC) — 50-62% WR\n` +
          `✅ 3-4AM WAT (2-3 UTC) — 60% WR\n\n` +
          `<b>Worst hours:</b>\n` +
          `❌ 5AM WAT (4 UTC) — 19% WR\n` +
          `❌ 5-8PM WAT (16-18 UTC) — 17-18% WR, -$92 PnL\n\n` +
          `<i>Pick a preset or 24/7 to trade all hours:</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🌙 Safe: Skip 5AM + 5-8PM WAT', 'oc_hrs_safe')],
            [Markup.button.callback('🎯 Best only: 6AM-5PM + 8PM-5AM WAT', 'oc_hrs_best')],
            [Markup.button.callback('🔓 24/7 (no restrictions)', 'oc_hrs_247')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_hours error: ${e.message}`); }
    });

    this.bot.action('oc_hrs_safe', async (ctx) => {
      try {
        await ctx.answerCbQuery('Hours: skip 5AM + 5-8PM WAT');
        octe().tradingHours = [[0, 4], [5, 16], [19, 24]];
        await octe().saveConfig();
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_hrs error: ${e.message}`); await ctx.answerCbQuery('Error: ' + e.message).catch(() => {}); }
    });
    this.bot.action('oc_hrs_best', async (ctx) => {
      try {
        await ctx.answerCbQuery('Hours: best windows only');
        octe().tradingHours = [[0, 4], [5, 9], [11, 16], [19, 24]];
        await octe().saveConfig();
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_hrs error: ${e.message}`); await ctx.answerCbQuery('Error: ' + e.message).catch(() => {}); }
    });
    this.bot.action('oc_hrs_247', async (ctx) => {
      try {
        await ctx.answerCbQuery('Hours: 24/7');
        octe().tradingHours = [];
        await octe().saveConfig();
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_hrs error: ${e.message}`); await ctx.answerCbQuery('Error: ' + e.message).catch(() => {}); }
    });

    // Entry mode toggle
    this.bot.action('oc_cfg_entry', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const cur = te.entryMode === 'hybrid' ? `HYBRID (>${te.hybridThreshold}% → pullback)` : te.entryMode === 'market' ? 'MARKET' : 'PULLBACK';
        await ctx.editMessageText(
          `🔗 <b>ONCHAIN — ENTRY MODE</b>\n\n` +
          `Current: <b>${cur}</b>\n\n` +
          `<b>⚡ MARKET</b> — Enter immediately when signal fires\n` +
          `  + Never misses a trade\n` +
          `  - Can enter at pump top on overextended coins\n\n` +
          `<b>🎯 PULLBACK</b> — Queue signal, wait for 5m zone sweep\n` +
          `  + Better entry price when pullback happens\n` +
          `  - Misses fast runners (5% cancel, 30min timeout)\n\n` +
          `<b>🔀 HYBRID</b> — Market for fresh moves, pullback for pumped coins\n` +
          `  + Best of both: catches early runners at market\n` +
          `  + Waits for pullback on overextended moves (>${te.hybridThreshold}%)\n` +
          `  + Extended timeout (90min) + wider threshold (20%) for pumps\n` +
          `  + Pullback bounce detection after peak retracement\n\n` +
          `<i>Hybrid recommended — avoids pump-top entries while keeping speed.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`⚡ Market${te.entryMode === 'market' ? ' ✓' : ''}`, 'oc_entry_market')],
            [Markup.button.callback(`🎯 Pullback${te.entryMode === 'pullback' ? ' ✓' : ''}`, 'oc_entry_pullback')],
            [Markup.button.callback(`🔀 Hybrid${te.entryMode === 'hybrid' ? ' ✓' : ''}`, 'oc_entry_hybrid')],
            ...(te.entryMode === 'hybrid' ? [[Markup.button.callback(`📏 Threshold: ${te.hybridThreshold}%`, 'oc_cfg_hybridpct')]] : []),
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_entry error: ${e.message}`); }
    });

    this.bot.action('oc_entry_market', async (ctx) => {
      try {
        octe().entryMode = 'market';
        octe().saveConfig();
        await ctx.answerCbQuery('Entry: Market (instant)');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_entry error: ${e.message}`); }
    });
    this.bot.action('oc_entry_pullback', async (ctx) => {
      try {
        octe().entryMode = 'pullback';
        octe().saveConfig();
        await ctx.answerCbQuery('Entry: Pullback (zone sweep)');
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_entry error: ${e.message}`); }
    });
    this.bot.action('oc_entry_hybrid', async (ctx) => {
      try {
        octe().entryMode = 'hybrid';
        octe().saveConfig();
        await ctx.answerCbQuery(`Entry: Hybrid (>${octe().hybridThreshold}% → pullback)`);
        await showOcSettings(ctx);
      } catch (e) { logger.error(`oc_entry error: ${e.message}`); }
    });
    this.bot.action('oc_cfg_hybridpct', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        await ctx.editMessageText(
          `📏 <b>HYBRID THRESHOLD</b>\n\n` +
          `Current: <b>${te.hybridThreshold}%</b>\n\n` +
          `If a coin's price already moved more than this %, use pullback entry instead of market.\n\n` +
          `Lower = more pullbacks (safer but misses more)\nHigher = more market entries (faster but riskier)`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`20%${te.hybridThreshold === 20 ? ' ✓' : ''}`, 'oc_hybpct_20'),
             Markup.button.callback(`25%${te.hybridThreshold === 25 ? ' ✓' : ''}`, 'oc_hybpct_25'),
             Markup.button.callback(`30%${te.hybridThreshold === 30 ? ' ✓' : ''}`, 'oc_hybpct_30')],
            [Markup.button.callback(`40%${te.hybridThreshold === 40 ? ' ✓' : ''}`, 'oc_hybpct_40'),
             Markup.button.callback(`50%${te.hybridThreshold === 50 ? ' ✓' : ''}`, 'oc_hybpct_50'),
             Markup.button.callback(`75%${te.hybridThreshold === 75 ? ' ✓' : ''}`, 'oc_hybpct_75')],
            [Markup.button.callback('⬅️ Back', 'oc_cfg_entry')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_hybridpct error: ${e.message}`); }
    });
    for (const pct of [20, 25, 30, 40, 50, 75]) {
      this.bot.action(`oc_hybpct_${pct}`, async (ctx) => {
        try {
          octe().hybridThreshold = pct;
          octe().saveConfig();
          await ctx.answerCbQuery(`Hybrid threshold: ${pct}%`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_hybpct error: ${e.message}`); }
      });
    }

    // ── TP TARGETS CONFIG ──
    this.bot.action('oc_cfg_tpmult', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = octe();
        const preset = te.tpMultPreset || 'default';
        const ck = (v) => v === preset ? ' ✓' : '';
        await ctx.editMessageText(
          `🎯 <b>ONCHAIN — TP TARGETS</b>\n\n` +
          `Current: <b>${preset.toUpperCase()}</b>\n` +
          `TP1: ${te.tp1Mult}x ATR (cap ${te.tpCapPct1}%) → close ${(te.tp1ClosePct * 100).toFixed(0)}%\n` +
          `TP2: ${te.tp2Mult}x ATR (cap ${te.tpCapPct2}%) → close ${(te.tp2ClosePct >= 1 ? 'ALL' : (te.tp2ClosePct * 100).toFixed(0) + '%')}\n` +
          `TP3: ${te.tp3Mult}x ATR (cap ${te.tpCapPct3}%)\n\n` +
          `<i>Data: tighter TPs hit more often.\nCurrent TP1 hit rate: 9%. Tight = 15%.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`DEFAULT (1.2x/2.5x/4x)${ck('default')}`, 'oc_tpmult_default')],
            [Markup.button.callback(`TIGHT (0.5x/1.0x/2x)${ck('tight')}`, 'oc_tpmult_tight')],
            [Markup.button.callback(`MEDIUM (0.75x/1.5x/2.5x)${ck('medium')}`, 'oc_tpmult_medium')],
            [Markup.button.callback(`WIDE (1.5x/3x/5x)${ck('wide')}`, 'oc_tpmult_wide')],
            [Markup.button.callback(`--- TP CAPS ---`, 'noop')],
            [Markup.button.callback(`TP1 cap: ${te.tpCapPct1}%`, 'oc_tpcap_1'),
             Markup.button.callback(`TP2 cap: ${te.tpCapPct2}%`, 'oc_tpcap_2'),
             Markup.button.callback(`TP3 cap: ${te.tpCapPct3}%`, 'oc_tpcap_3')],
            [Markup.button.callback('⬅️ Back', 'oc_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`oc_cfg_tpmult error: ${e.message}`); }
    });
    const tpPresets = {
      default: { tp1Mult: 1.2, tp2Mult: 2.5, tp3Mult: 4.0, tpCapPct1: 3, tpCapPct2: 6, tpCapPct3: 10 },
      tight:   { tp1Mult: 0.5, tp2Mult: 1.0, tp3Mult: 2.0, tpCapPct1: 2, tpCapPct2: 4, tpCapPct3: 8 },
      medium:  { tp1Mult: 0.75, tp2Mult: 1.5, tp3Mult: 2.5, tpCapPct1: 2, tpCapPct2: 5, tpCapPct3: 8 },
      wide:    { tp1Mult: 1.5, tp2Mult: 3.0, tp3Mult: 5.0, tpCapPct1: 5, tpCapPct2: 10, tpCapPct3: 15 },
    };
    for (const [name, vals] of Object.entries(tpPresets)) {
      this.bot.action(`oc_tpmult_${name}`, async (ctx) => {
        try {
          const te = octe();
          te.tpMultPreset = name;
          Object.assign(te, vals);
          te.saveConfig();
          await ctx.answerCbQuery(`TP targets: ${name.toUpperCase()}`);
          await showOcSettings(ctx);
        } catch (e) { logger.error(`oc_tpmult_${name} error: ${e.message}`); }
      });
    }
    for (const idx of [1, 2, 3]) {
      this.bot.action(`oc_tpcap_${idx}`, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          const te = octe();
          const key = `tpCapPct${idx}`;
          const cur = te[key];
          const opts = idx === 1 ? [1, 2, 3, 5] : idx === 2 ? [3, 4, 5, 6, 8, 10] : [5, 8, 10, 12, 15];
          await ctx.editMessageText(
            `🎯 <b>TP${idx} CAP %</b>\n\nCurrent: <b>${cur}%</b>\nMax % move for TP${idx} regardless of ATR.`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              ...opts.map(v => [Markup.button.callback(`${v}%${v === cur ? ' ✓' : ''}`, `oc_tpcapset_${idx}_${v}`)]),
              [Markup.button.callback('⬅️ Back', 'oc_cfg_tpmult')],
            ]).reply_markup }
          );
        } catch (e) { logger.error(`oc_tpcap error: ${e.message}`); }
      });
      const capOpts = idx === 1 ? [1, 2, 3, 5] : idx === 2 ? [3, 4, 5, 6, 8, 10] : [5, 8, 10, 12, 15];
      for (const v of capOpts) {
        this.bot.action(`oc_tpcapset_${idx}_${v}`, async (ctx) => {
          try {
            const te = octe();
            te[`tpCapPct${idx}`] = v;
            te.tpMultPreset = 'custom';
            te.saveConfig();
            await ctx.answerCbQuery(`TP${idx} cap: ${v}%`);
            await showOcSettings(ctx);
          } catch (e) { logger.error(`oc_tpcapset error: ${e.message}`); }
        });
      }
    }

    // Also wire /onchainsettings command to show the inline panel
    this.bot.command('onchainsettings', async (ctx) => {
      if (!octe()) return ctx.reply('Not initialized.');
      await showOcSettings(ctx, true);
    });

    this.bot.command('onchainclose', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      try {
        const symbol = (ctx.message.text.split(' ')[1] || '').toUpperCase();
        if (!symbol) return ctx.replyWithHTML('Usage: <code>/onchainclose UAI</code>\n\nOr use /onchainopen for inline buttons.');
        const result = await this.onchainTradeExecutor.closeBySymbol(symbol);
        if (!result) return ctx.replyWithHTML(`⚠️ No open onchain position for <b>${symbol}</b>`);
        const emoji = result.pnlUsd >= 0 ? '✅' : '❌';
        ctx.replyWithHTML(
          `${emoji} <b>[ONCHAIN] Position closed</b> — $${result.trade.symbol}\n\n` +
          `${result.trade.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'}\n` +
          `Entry: $${result.trade.entry_price} → Exit: $${(result.currentPrice || 0).toPrecision(6)}\n` +
          `P&L: <b>$${result.pnlUsd.toFixed(2)}</b> (${result.pnlPct.toFixed(2)}%)`
        );
      } catch (e) {
        ctx.replyWithHTML(`⚠️ ${e.message}`);
      }
    });

    this.bot.command('onchainstop', async (ctx) => {
      if (!this.onchainTradeExecutor) return ctx.reply('Not initialized.');
      try {
        const count = await this.onchainTradeExecutor.closeAllPositions();
        this.onchainTradeExecutor.enabled = false;
        this.onchainTradeExecutor.saveConfig();
        ctx.replyWithHTML(`🛑 <b>[ONCHAIN] ALL POSITIONS CLOSED</b>\n\n${count} position(s) closed.\nOnchain auto-trading DISABLED.\n\nUse /onchaintrade on to re-enable.`);
      } catch (err) {
        ctx.reply('Error closing onchain positions.');
      }
    });
    this.bot.command('onchain', async (ctx) => {
      if (!this.onchainScanner) return ctx.reply('Onchain scanner not initialized.');
      ctx.reply('🔗 Running onchain scan (OI + Funding across all perps)...');
      try {
        const results = await this.onchainScanner.scan();
        if (!results.length) {
          return ctx.replyWithHTML(
            '🔗 <b>ONCHAIN SCANNER</b>\n\n' +
            'No notable onchain activity detected right now.\n\n' +
            '<b>What this scans:</b>\n' +
            '• <b>Open Interest (OI)</b> — new positions opening/closing on Binance & Bybit perps\n' +
            '• <b>Funding Rates</b> — who\'s paying whom (longs vs shorts dominance)\n' +
            '• <b>Combined signals</b> — OI + price + funding aligned = high conviction\n\n' +
            '<b>Runs automatically every 10 min.</b> Alerts sent when score >= 40.\n\n' +
            '<b>Related commands:</b>\n' +
            '• /whale — Track large token transfers on Ethereum/BSC/Solana\n' +
            '• /flows — Check exchange inflow/outflow for a specific token\n\n' +
            '<i>Scans futures perps on Binance & Bybit only (MEXC doesn\'t expose OI via API).</i>'
          );
        }
        const msg = this.onchainScanner.formatAlerts(results, 8);
        if (msg) await ctx.replyWithHTML(msg);
        else ctx.reply('No tokens scored high enough to alert.');

        // Send setup chart images for top tokens
        const charted = results.filter(r => r.score >= 20).slice(0, 3);
        for (const token of charted) {
          try {
            const exchange = this.tradeExecutor?.exchanges?.[token.exchange];
            if (!exchange) continue;
            const ohlcv = await exchange.fetchOHLCV(token.pair, '1h', undefined, 60);
            if (!ohlcv || ohlcv.length < 10) continue;
            const liqScanner = this.onchainScanner.liquidationScanner;
            const snap = liqScanner ? liqScanner.generateSetupSnapshot(token) : { direction: 'neutral', confidence: 'low' };
            const chartInfo = {
              symbol: token.symbol, exchange: token.exchange,
              direction: snap.direction, confidence: snap.confidence,
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
              await ctx.replyWithPhoto({ source: chartBuf }, {
                caption: `📸 <b>${token.symbol}</b> Setup Snapshot — Score: ${token.score}/100`,
                parse_mode: 'HTML',
              });
            }
          } catch (e) {
            logger.debug(`/onchain chart failed for ${token.symbol}: ${e.message}`);
          }
        }
      } catch (err) {
        ctx.reply('Onchain scan failed.');
        logger.error(`/onchain error: ${err.message}`);
      }
    });

    // === SWING TRADE COMMANDS ===

    this.bot.command('swingtrade', async (ctx) => {
      if (!this.swingTradeExecutor) return ctx.reply('Swing trade executor not initialized.');
      const args = ctx.message.text.split(' ').slice(1);
      const mode = args[0]?.toLowerCase();
      if (mode === 'on' || mode === 'paper') {
        this.swingTradeExecutor.enabled = true;
        if (mode === 'paper') this.swingTradeExecutor.mode = 'paper';
        this.swingTradeExecutor.saveConfig();
        ctx.replyWithHTML(`🌊 Swing trading: <b>${this.swingTradeExecutor.mode.toUpperCase()}</b> | ON`);
      } else if (mode === 'off') {
        this.swingTradeExecutor.enabled = false;
        this.swingTradeExecutor.saveConfig();
        ctx.replyWithHTML('❌ Swing auto-trading <b>disabled</b>.');
      } else {
        const te = this.swingTradeExecutor;
        await te.recalcDailyPnL?.();
        const openTrades = await db.getOpenTrades('swing').catch(() => []);
        const watchlist = this.swingScanner?.getWatchlistStatus() || [];
        const text =
          `🌊 <b>SWING SETTINGS</b>\n\n` +
          `📝 Mode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\n` +
          `💵 Size: <b>$${te.maxPositionSize}</b>/trade\n` +
          `⚡ Leverage: <b>${te.defaultLeverage}x</b>\n` +
          `🛡️ Daily Loss: <b>$${te.maxDailyLoss}</b> | Per-Trade: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n` +
          `📊 Max Positions: <b>${te.maxConcurrentPositions}</b>\n` +
          `⏱️ Max Hold: <b>${Math.round(te.maxTradeAge / (24 * 60 * 60 * 1000))}d</b> | Time Exit: <b>${te.timeExitMinutes > 0 ? te.timeExitMinutes + 'min' : 'Off'}</b>\n` +
          `🎯 Profit Protect: <b>${te.profitProtectPct}%</b> | Trail: <b>${te.trailAtrMultPre}x/${te.trailAtrMultPost}x ATR</b>\n` +
          `🏦 Exchanges: <b>${te.disabledExchanges?.size ? `${te.disabledExchanges.size} off` : 'All ON'}</b>\n` +
          `📈 Today P&L: <b>$${te.dailyPnL.toFixed(2)}</b>\n` +
          `📋 Open: <b>${openTrades.length}/${te.maxConcurrentPositions}</b>\n` +
          `👁️ Watchlist: <b>${watchlist.length}</b> symbols\n\n` +
          `<i>Swing trades hold for days/weeks with wide structural SL.</i>`;
        ctx.replyWithHTML(text);
      }
    });

    this.bot.command('swingsize', async (ctx) => {
      if (!this.swingTradeExecutor) return ctx.reply('Not initialized.');
      const size = parseFloat(ctx.message.text.split(' ')[1]);
      if (!size || size < 5 || size > 10000) return ctx.reply('Usage: /swingsize <5-10000>');
      this.swingTradeExecutor.maxPositionSize = size;
      this.swingTradeExecutor.saveConfig();
      ctx.replyWithHTML(`🌊 Swing trade size: <b>$${size}</b>`);
    });

    this.bot.command('swinglev', async (ctx) => {
      if (!this.swingTradeExecutor) return ctx.reply('Not initialized.');
      const lev = parseInt(ctx.message.text.split(' ')[1]);
      if (!lev || lev < 1 || lev > 10) return ctx.reply('Usage: /swinglev <1-10>');
      this.swingTradeExecutor.defaultLeverage = lev;
      this.swingTradeExecutor.saveConfig();
      ctx.replyWithHTML(`🌊 Swing leverage: <b>${lev}x</b>`);
    });

    this.bot.command('swingopen', async (ctx) => {
      const trades = await db.getOpenTrades('swing').catch(() => []);
      if (!trades.length) return ctx.reply('🌊 No open swing trades.');
      let msg = `🌊 <b>OPEN SWING TRADES</b> (${trades.length})\n\n`;
      for (const t of trades) {
        const age = ((Date.now() - new Date(t.created_at).getTime()) / (60 * 60 * 1000)).toFixed(0);
        const _d = new Date(t.created_at);
        const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;
        msg += `${t.direction === 'long' ? '🟢' : '🔴'} <b>${escapeHtml(t.symbol)}</b> ${t.direction.toUpperCase()}\n`;
        msg += `  Entry: $${t.entry_price} | SL: $${t.stop_loss}\n`;
        msg += `  Size: $${(t.position_size || 0).toFixed(0)} (${t.leverage}x) | Age: ${age}h · ${openTime}\n`;
        msg += `  TP1: $${t.tp1} | TP2: $${t.tp2} | TP3: $${t.tp3}\n\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.command('swingclose', async (ctx) => {
      const symbol = ctx.message.text.split(' ')[1]?.toUpperCase();
      if (!symbol) return ctx.reply('Usage: /swingclose SYMBOL');
      const trades = await db.getOpenTrades('swing').catch(() => []);
      const trade = trades.find(t => t.symbol === symbol);
      if (!trade) return ctx.reply(`No open swing trade for ${symbol}.`);
      try {
        const exchange = this.swingTradeExecutor.exchanges[trade.exchange];
        const pair = [`${symbol}/USDT:USDT`, `${symbol}/USDT`].find(p => exchange?.markets?.[p]);
        const ticker = pair ? await exchange.fetchTicker(pair) : null;
        const price = ticker?.last || trade.entry_price;
        const pnlPct = trade.direction === 'long'
          ? ((price - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - price) / trade.entry_price) * 100;
        const pnlUsd = (pnlPct / 100) * (trade.position_size || 0);
        await db.closeTrade(trade.id, price, pnlPct, pnlUsd, 'manual_close');
        ctx.replyWithHTML(`🌊 Swing trade closed: <b>${symbol}</b>\nExit: $${price} | P&L: $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      } catch (e) {
        ctx.reply(`Failed to close: ${e.message}`);
      }
    });

    this.bot.command('swingstats', async (ctx) => {
      const s = await db.getTradeStatsBySource('swing').catch(() => ({}));
      const msg =
        `🌊 <b>SWING TRADE STATS</b>\n\n` +
        `Total: ${s.total || 0} | Open: ${s.open || 0}\n` +
        `Wins: ${s.wins || 0} | Losses: ${s.losses || 0}\n` +
        `P&L: <b>$${parseFloat(s.total_pnl || 0).toFixed(2)}</b>\n` +
        `Best: $${parseFloat(s.best_trade || 0).toFixed(2)} | Worst: $${parseFloat(s.worst_trade || 0).toFixed(2)}`;
      ctx.replyWithHTML(msg);
    });

    this.bot.command('swingperf', async (ctx) => {
      try {
        const days = parseInt(ctx.message.text.split(' ')[1]) || 30;
        const perf = await db.getSwingTradePerformance(days);
        const openTrades = await db.getSwingOpenTrades();

        const total = parseInt(perf.total) || 0;
        const closed = parseInt(perf.closed_count) || 0;
        const wins = parseInt(perf.wins) || 0;
        const losses = parseInt(perf.losses) || 0;
        const winRate = closed > 0 ? ((wins / closed) * 100).toFixed(0) : '—';
        const totalPnl = parseFloat(perf.total_pnl) || 0;
        const avgPnl = parseFloat(perf.avg_pnl) || 0;
        const avgWin = parseFloat(perf.avg_win_pct) || 0;
        const avgLoss = parseFloat(perf.avg_loss_pct) || 0;
        const bestTrade = parseFloat(perf.best_trade) || 0;
        const worstTrade = parseFloat(perf.worst_trade) || 0;
        const avgHold = parseFloat(perf.avg_hold_hours) || 0;
        const tp1Hits = parseInt(perf.tp1_hits) || 0;
        const tp2Hits = parseInt(perf.tp2_hits) || 0;
        const tp3Hits = parseInt(perf.tp3_hits) || 0;

        let msg = `🌊 <b>SWING TRADE PERFORMANCE</b> (${days}d)\n\n`;
        msg += `📊 <b>Overview</b>\n`;
        msg += `Total: ${total} | Open: ${perf.open_count || 0} | Closed: ${closed}\n`;
        msg += `Wins: ${wins} | Losses: ${losses} | Win Rate: <b>${winRate}%</b>\n\n`;

        msg += `💰 <b>P&L</b>\n`;
        msg += `Total: <b>${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</b>\n`;
        msg += `Avg/trade: $${avgPnl.toFixed(2)}\n`;
        msg += `Best: $${bestTrade.toFixed(2)} | Worst: $${worstTrade.toFixed(2)}\n`;
        if (avgWin || avgLoss) msg += `Avg win: +${avgWin.toFixed(1)}% | Avg loss: ${avgLoss.toFixed(1)}%\n`;
        msg += '\n';

        msg += `🎯 <b>TP Hit Rates</b>\n`;
        msg += `TP1: ${tp1Hits}/${total} (${total > 0 ? ((tp1Hits / total) * 100).toFixed(0) : 0}%)`;
        msg += ` | TP2: ${tp2Hits}/${total} (${total > 0 ? ((tp2Hits / total) * 100).toFixed(0) : 0}%)`;
        msg += ` | TP3: ${tp3Hits}/${total} (${total > 0 ? ((tp3Hits / total) * 100).toFixed(0) : 0}%)\n`;
        if (avgHold > 0) msg += `⏱ Avg hold time: ${avgHold >= 24 ? `${(avgHold / 24).toFixed(1)}d` : `${avgHold.toFixed(0)}h`}\n`;
        msg += '\n';

        if (openTrades.length) {
          msg += `📈 <b>Open Positions (${openTrades.length})</b>\n`;
          for (const t of openTrades.slice(0, 5)) {
            const entry = parseFloat(t.entry_price);
            const pnl = parseFloat(t.pnl_pct) || 0;
            const pnlUsd = parseFloat(t.pnl_usd) || 0;
            const ageMs = Date.now() - new Date(t.created_at).getTime();
            const ageHrs = ageMs / 3600000;
            const ageStr = ageHrs >= 24 ? `${Math.floor(ageHrs / 24)}d` : `${Math.floor(ageHrs)}h`;
            const pnlIcon = pnl >= 0 ? '🟢' : '🔴';
            const tpStr = [t.hit_tp1 && 'TP1', t.hit_tp2 && 'TP2', t.hit_tp3 && 'TP3'].filter(Boolean).join(' ');
            msg += `${pnlIcon} <b>${t.symbol}</b> ${t.direction.toUpperCase()} @ $${entry >= 1 ? entry.toFixed(4) : entry.toPrecision(4)}`;
            msg += ` → <b>${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%</b> ($${pnlUsd.toFixed(2)})`;
            msg += ` | ${ageStr}`;
            if (tpStr) msg += ` | ${tpStr} ✅`;
            msg += '\n';
          }
        }

        msg += `\n<i>Usage: /swingperf [days] — default 30</i>`;
        ctx.replyWithHTML(msg);
      } catch (e) {
        ctx.reply(`Error: ${e.message}`);
      }
    });

    this.bot.command('swingwatchlist', async (ctx) => {
      const items = this.swingScanner?.getWatchlistStatus() || [];
      if (!items.length) return ctx.reply('🌊 Swing watchlist is empty.');
      let msg = `🌊 <b>SWING WATCHLIST</b> (${items.length})\n\n`;
      for (const item of items) {
        msg += `<b>${escapeHtml(item.symbol)}</b> — Score: ${item.score}\n`;
        msg += `  Zone: ${item.entryZone} | SL: ${item.sl}\n`;
        msg += `  Age: ${item.age} | ${item.inZone ? '✅ In zone' : '⏳ Waiting'}\n\n`;
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.command('swingfollow', async (ctx) => {
      await db.setUserPaperConfig(ctx.state.user.telegram_id, { swingFollow: true });
      ctx.replyWithHTML('🌊 Swing paper trading <b>enabled</b>. You will auto-paper-trade swing setups scoring 60+.');
    });

    this.bot.command('swingunfollow', async (ctx) => {
      await db.setUserPaperConfig(ctx.state.user.telegram_id, { swingFollow: false });
      ctx.replyWithHTML('🌊 Swing paper trading <b>disabled</b>.');
    });

    // === Demand Zone Paper Trade Commands ===
    this.bot.command('dzopen', async (ctx) => {
      const trades = await db.getOpenTrades('demandzone').catch(() => []);
      if (!trades.length) return ctx.reply('🎯 No open demand zone paper trades.');
      let msg = `🎯 <b>OPEN DZ PAPER TRADES</b> (${trades.length})\n\n`;
      for (const t of trades) {
        const age = ((Date.now() - new Date(t.created_at).getTime()) / (60 * 60 * 1000)).toFixed(0);
        const _d = new Date(t.created_at);
        const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;
        const ctx_ = t.onchain_context || {};
        const scoreStr = ctx_.score ? ` | Score: ${ctx_.score}` : '';
        msg += `${t.direction === 'long' ? '🟢' : '🔴'} <b>${escapeHtml(t.symbol)}</b> ${t.direction.toUpperCase()}${scoreStr}\n`;
        msg += `  Entry: $${t.entry_price} | SL: $${t.stop_loss}\n`;
        msg += `  Size: $${(t.position_size || 0).toFixed(0)} (${t.leverage}x) | Age: ${age}h · ${openTime}\n`;
        msg += `  TP1: $${t.tp1}${t.hit_tp1 ? ' ✅' : ''} | TP2: $${t.tp2}${t.hit_tp2 ? ' ✅' : ''} | TP3: $${t.tp3}${t.hit_tp3 ? ' ✅' : ''}\n`;
        if (t.pnl_usd != null) msg += `  P&L: <b>$${parseFloat(t.pnl_usd).toFixed(2)}</b> (${parseFloat(t.pnl_pct).toFixed(1)}%)\n`;
        msg += '\n';
      }
      ctx.replyWithHTML(msg);
    });

    this.bot.command('dzclose', async (ctx) => {
      const symbol = ctx.message.text.split(' ')[1]?.toUpperCase();
      if (!symbol) return ctx.reply('Usage: /dzclose SYMBOL');
      const trades = await db.getOpenTrades('demandzone').catch(() => []);
      const trade = trades.find(t => t.symbol === symbol);
      if (!trade) return ctx.reply(`No open DZ paper trade for ${symbol}.`);
      try {
        const exchange = this.dzTradeExecutor.exchanges[trade.exchange];
        const pair = [`${symbol}/USDT:USDT`, `${symbol}/USDT`].find(p => exchange?.markets?.[p]);
        const ticker = pair ? await exchange.fetchTicker(pair) : null;
        const price = ticker?.last || trade.entry_price;
        const pnlPct = trade.direction === 'long'
          ? ((price - trade.entry_price) / trade.entry_price) * 100
          : ((trade.entry_price - price) / trade.entry_price) * 100;
        const pnlUsd = (pnlPct / 100) * (trade.position_size || 0);
        await db.closeTrade(trade.id, price, pnlPct, pnlUsd, 'manual_close');
        ctx.replyWithHTML(`🎯 DZ trade closed: <b>${symbol}</b>\nExit: $${price} | P&L: $${pnlUsd.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      } catch (e) {
        ctx.reply(`Failed to close: ${e.message}`);
      }
    });

    this.bot.command('dzstats', async (ctx) => {
      const s = await db.getTradeStatsBySource('demandzone').catch(() => ({}));
      const msg =
        `🎯 <b>DZ PAPER TRADE STATS</b>\n\n` +
        `Total: ${s.total || 0} | Open: ${s.open || 0}\n` +
        `Wins: ${s.wins || 0} | Losses: ${s.losses || 0}\n` +
        `P&L: <b>$${parseFloat(s.total_pnl || 0).toFixed(2)}</b>\n` +
        `Best: $${parseFloat(s.best_trade || 0).toFixed(2)} | Worst: $${parseFloat(s.worst_trade || 0).toFixed(2)}`;
      ctx.replyWithHTML(msg);
    });

    this.bot.command('dzperf', async (ctx) => {
      try {
        const days = parseInt(ctx.message.text.split(' ')[1]) || 30;
        const perf = await db.getDemandZonePerformance(days);
        const openTrades = await db.getDemandZoneOpenTrades();

        const total = parseInt(perf.total) || 0;
        const closed = parseInt(perf.closed_count) || 0;
        if (total === 0) return ctx.reply('🎯 No demand zone paper trades yet.');

        const wins = parseInt(perf.wins) || 0;
        const losses = parseInt(perf.losses) || 0;
        const winRate = closed > 0 ? ((wins / closed) * 100).toFixed(0) : '0';
        const totalPnl = parseFloat(perf.total_pnl) || 0;
        const avgPnl = parseFloat(perf.avg_pnl) || 0;
        const avgWin = parseFloat(perf.avg_win_pct) || 0;
        const avgLoss = parseFloat(perf.avg_loss_pct) || 0;
        const avgHold = parseFloat(perf.avg_hold_hours) || 0;
        const tp1 = parseInt(perf.tp1_hits) || 0;
        const tp2 = parseInt(perf.tp2_hits) || 0;
        const tp3 = parseInt(perf.tp3_hits) || 0;

        let msg = `🎯 <b>DEMAND ZONE PERFORMANCE</b> (${days}d)\n\n`;
        msg += `📊 ${total} trades | ${closed} closed | ${parseInt(perf.open_count) || 0} open\n`;
        msg += `✅ ${wins}W / ${losses}L — <b>${winRate}% win rate</b>\n`;
        msg += `💰 Total P&L: <b>$${totalPnl.toFixed(2)}</b>\n`;
        msg += `📈 Avg: $${avgPnl.toFixed(2)} | Win: +${avgWin.toFixed(1)}% | Loss: ${avgLoss.toFixed(1)}%\n`;
        msg += `⏱ Avg hold: ${avgHold.toFixed(1)}h\n`;
        msg += `🎯 TP hits: TP1 ${tp1} | TP2 ${tp2} | TP3 ${tp3}\n`;

        if (openTrades.length) {
          msg += `\n<b>OPEN POSITIONS</b>\n`;
          for (const t of openTrades) {
            const age = ((Date.now() - new Date(t.created_at).getTime()) / (60 * 60 * 1000)).toFixed(0);
            const ctx_ = t.onchain_context || {};
            msg += `${t.direction === 'long' ? '🟢' : '🔴'} <b>${escapeHtml(t.symbol)}</b> — $${t.entry_price} (${age}h)`;
            msg += ` | Score: ${ctx_.score || '?'}\n`;
          }
        }

        msg += `\n<i>Usage: /dzperf [days] — default 30</i>`;
        ctx.replyWithHTML(msg);
      } catch (e) {
        ctx.reply(`Error: ${e.message}`);
      }
    });

    // === UNIFIED TRADING CONTROL PANEL ===
    const showPanel = async (ctx, isNew = false) => {
      const text =
        `⚙️ <b>TRADING CONTROL PANEL</b>\n\n` +
        `Manage all trading systems from here.`;
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📊 Main Trading', 'cfg_main_new'),
         Markup.button.callback('🔗 Onchain', 'oc_settings')],
        [Markup.button.callback('🌊 Swing Trade', 'sw_settings'),
         Markup.button.callback('🎯 Demand Zone', 'dz_settings')],
      ]);
      if (isNew) {
        await ctx.replyWithHTML(text, keyboard);
      } else {
        try { await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }); } catch (e) { await ctx.replyWithHTML(text, keyboard); }
      }
    };

    this.bot.command('panel', async (ctx) => { await showPanel(ctx, true); });
    this.bot.action('panel_main', async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showPanel(ctx); } catch (e) { logger.error(`panel_main error: ${e.message}`); }
    });

    // === SWING TRADE SETTINGS PANEL (sw_ prefix) ===
    const swte = () => this.swingTradeExecutor;
    const showSwSettings = async (ctx, isNew = false) => {
      const te = swte();
      if (!te) return;
      await te.recalcDailyPnL?.();
      const openTrades = await db.getOpenTrades('swing').catch(() => []);

      const text =
        `🌊 <b>SWING TRADE SETTINGS</b>\n\n` +
        `${te.mode === 'paper' ? '📝' : '💰'} Mode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\n` +
        `💵 Size: <b>$${te.maxPositionSize}</b>/trade\n` +
        `⚡ Leverage: <b>${te.defaultLeverage}x</b>\n` +
        `🛡️ Daily Loss: <b>$${te.maxDailyLoss}</b> | Per-Trade: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n` +
        `📐 Risk-Fit: <b>${te.riskFitSizing ? 'ON' : 'OFF'}</b>${te.riskFitSizing ? ' (shrinks size to cap loss)' : ' (full size)'}\n` +
        `📊 Max Positions: <b>${te.maxConcurrentPositions}</b>\n` +
        `🏦 Exchanges: <b>${te.disabledExchanges?.size ? `${te.disabledExchanges.size} off` : 'All ON'}</b>\n` +
        `🕐 Hours: <b>${te.tradingHours?.length ? te.tradingHours.map(([s,e]) => `${String(s).padStart(2,'0')}-${String(e).padStart(2,'0')}`).join(', ') : '24/7'}</b> UTC\n` +
        `📈 Today P&L: <b>$${te.dailyPnL.toFixed(2)}</b>\n` +
        `📋 Open: <b>${openTrades.length}/${te.maxConcurrentPositions}</b>\n\n` +
        `Tap any button to configure:`;

      const swCbStatus = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
      const swCbLabel = swCbStatus.active ? `🚨 CB: PAUSED ${swCbStatus.minsLeft}m`
        : !swCbStatus.enabled ? '🔓 CB: OFF' : '🛡️ CB: ON';

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`${te.mode === 'paper' ? '📝' : '🔴'} Mode: ${te.mode.toUpperCase()}`, 'sw_cfg_mode'),
         Markup.button.callback(`${te.enabled ? '✅ ON' : '⛔ OFF'}`, 'sw_cfg_toggle')],
        [Markup.button.callback(`💵 Size: $${te.maxPositionSize}`, 'sw_cfg_size'),
         Markup.button.callback(`⚡ Lev: ${te.defaultLeverage}x`, 'sw_cfg_lev')],
        [Markup.button.callback(`🛡️ Daily: $${te.maxDailyLoss}`, 'sw_cfg_dailyloss'),
         Markup.button.callback(`🔒 Trade: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}`, 'sw_cfg_tradeloss')],
        [Markup.button.callback(`🔰 Buffer: ${te.lossBufferPct}%`, 'sw_cfg_lossbuf'),
         Markup.button.callback(`📊 Pos: ${te.maxConcurrentPositions}`, 'sw_cfg_maxpos')],
        [Markup.button.callback(`📐 Risk-Fit: ${te.riskFitSizing ? 'ON' : 'OFF'}`, 'sw_cfg_riskfit'),
         Markup.button.callback(swCbLabel, 'sw_cfg_cb')],
        [Markup.button.callback(`🏦 Exchanges${te.disabledExchanges?.size ? ` (${te.disabledExchanges.size} off)` : ''}`, 'sw_cfg_exchanges'),
         Markup.button.callback(`🕐 Hours: ${te.tradingHours?.length ? te.tradingHours.length + ' win' : '24/7'}`, 'sw_cfg_hours')],
        [Markup.button.callback(`📋 Positions (${openTrades.length})`, 'sw_trades'),
         Markup.button.callback('🔄 Refresh', 'sw_settings')],
        [Markup.button.callback('⬅️ Panel', 'panel_main'),
         Markup.button.callback('🛑 Close All & Stop', 'sw_closeall')],
      ]);

      if (isNew) {
        await ctx.replyWithHTML(text, keyboard);
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      }
    };

    this._showSwSettings = showSwSettings;
    this.bot.command('swingsettings', async (ctx) => { await showSwSettings(ctx, true); });
    this.bot.action('sw_settings', async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showSwSettings(ctx); } catch (e) { logger.error(`sw_settings error: ${e.message}`); }
    });
    this.bot.action('sw_refresh', async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showSwSettings(ctx); } catch (e) { logger.error(`sw_refresh error: ${e.message}`); }
    });

    this.bot.action('sw_trades', async (ctx) => {
      try { await ctx.answerCbQuery('Loading trades...'); } catch (e) {}
      try {
        const trades = await db.getOpenTrades('swing');
        if (!trades.length) {
          return ctx.editMessageText(
            `📋 <b>SWING POSITIONS</b>\n\n<i>No open positions.</i>`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'sw_trades')],
              [Markup.button.callback('⬅️ Settings', 'sw_settings')],
            ]).reply_markup }
          );
        }
        const te = swte();
        let msg = `📋 <b>SWING POSITIONS</b> (${trades.length})\n\n`;
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
          const pnlUsd = (pnlPct / 100) * (t.position_size || 0);
          totalPnl += pnlUsd;
          const icon = pnlPct > 0 ? '🟢' : pnlPct < -5 ? '🔴' : '🟡';
          const dir = isLong ? '⬆️' : '⬇️';
          const tpHit = [t.hit_tp1 ? 'TP1✅' : '', t.hit_tp2 ? 'TP2✅' : '', t.hit_tp3 ? 'TP3✅' : ''].filter(Boolean).join(' ') || 'none';
          const _age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
          const _ageStr = _age < 60 ? `${_age}m` : _age < 1440 ? `${Math.round(_age / 60)}h` : `${Math.round(_age / 1440)}d`;
          const _d = new Date(t.created_at);
          const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;
          msg += `${icon}${dir} <b>${t.symbol}</b> (${t.exchange || 'unknown'}) · ${_ageStr} · ${openTime}\n`;
          msg += `Entry: $${t.entry_price.toPrecision(6)} → $${currentPrice ? currentPrice.toPrecision(6) : '?'}\n`;
          msg += `PnL: <b>${pnlLev >= 0 ? '+' : ''}${pnlLev.toFixed(1)}%</b> ($${pnlUsd.toFixed(2)}) | ${t.leverage}x\n`;
          msg += `TP: ${tpHit} | SL: $${t.stop_loss.toPrecision(6)}\n`;
          msg += `Size: $${(t.position_size || 0).toFixed(2)} | ${t.mode}\n\n`;
        }
        msg += `<b>Total unrealized PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</b>`;
        if (msg.length > 4000) msg = msg.slice(0, 3990) + '\n\n<i>…truncated</i>';

        const closeButtons = trades.reduce((rows, t, i) => {
          if (i % 3 === 0) rows.push([]);
          rows[rows.length - 1].push(Markup.button.callback(`❌ ${t.symbol}`, `sw_close_${t.id}`));
          return rows;
        }, []);

        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          ...closeButtons,
          [Markup.button.callback('🛑 Close All Swing', 'sw_closeall_trades')],
          [Markup.button.callback('🔄 Refresh', 'sw_trades')],
          [Markup.button.callback('⬅️ Settings', 'sw_settings')],
        ]).reply_markup });
      } catch (e) {
        if (e.message?.includes('message is not modified')) return;
        logger.error(`sw_trades error: ${e.message}`);
        ctx.editMessageText('❌ Failed to load trades.', { reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'sw_settings')],
        ]).reply_markup }).catch(() => {});
      }
    });

    this.bot.action(/^sw_close_(\d+)$/, async (ctx) => {
      const tradeId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery(`Closing swing trade #${tradeId}...`);
      try {
        const te = swte();
        const result = await te.closeSingleTrade(tradeId);
        if (!result) return ctx.answerCbQuery('Trade not found or already closed', { show_alert: true });
        const { trade, pnlUsd } = result;
        await this.sendRaw(
          `✅ <b>SWING MANUAL CLOSE</b> ${trade.symbol} (${trade.exchange || 'unknown'})\n\n` +
          `PnL: ${pnlUsd >= 0 ? '🟢' : '🔴'} ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}\nMode: ${trade.mode}`
        );
        await ctx.editMessageText('✅ Trade closed. Tap Refresh to reload.', {
          parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'sw_trades')],
            [Markup.button.callback('⬅️ Settings', 'sw_settings')],
          ]).reply_markup
        });
      } catch (e) {
        logger.error(`sw_close error: ${e.message}`);
        ctx.answerCbQuery(`Failed: ${e.message}`, { show_alert: true });
      }
    });

    this.bot.action('sw_closeall_trades', async (ctx) => {
      await ctx.answerCbQuery('Closing all swing positions...');
      try {
        const count = await swte().closeAllPositions();
        await this.sendRaw(`🛑 <b>ALL SWING POSITIONS CLOSED</b>\n\n${count} trade(s) closed.`);
        await ctx.editMessageText('📋 <b>SWING POSITIONS</b>\n\n<i>All positions closed.</i>', {
          parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'sw_trades')],
            [Markup.button.callback('⬅️ Settings', 'sw_settings')],
          ]).reply_markup
        });
      } catch (e) {
        logger.error(`sw_closeall_trades error: ${e.message}`);
        ctx.answerCbQuery(`Failed: ${e.message}`, { show_alert: true });
      }
    });

    // sw_ MODE
    this.bot.action('sw_cfg_mode', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        await ctx.editMessageText(
          `🌊 <b>SWING — TRADE MODE</b>\n\n` +
          `Current: <b>${te.mode.toUpperCase()}</b> ${te.mode === 'paper' ? '📝' : '💰'}\n\n` +
          `📝 <b>Paper</b> — Simulated trades, no real funds\n` +
          `💰 <b>Live</b> — Real orders on exchange`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`📝 Paper${ocCheck('paper', te.mode)}`, 'sw_mode_paper'),
             Markup.button.callback(`💰 Live${ocCheck('live', te.mode)}`, 'sw_mode_live')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_mode error: ${e.message}`); }
    });
    this.bot.action('sw_mode_paper', async (ctx) => {
      try {
        swte().mode = 'paper'; swte().enabled = true; swte().saveConfig();
        await ctx.answerCbQuery('Paper mode activated');
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_mode_paper error: ${e.message}`); }
    });
    this.bot.action('sw_mode_live', async (ctx) => {
      try {
        const te = swte();
        await ctx.editMessageText(
          `⚠️ <b>SWITCH SWING TO LIVE?</b>\n\n` +
          `Real funds will be used for swing trades.\n\n` +
          `💵 Size: $${te.maxPositionSize}/trade\n` +
          `⚡ Leverage: ${te.defaultLeverage}x\n` +
          `🔒 Max loss/trade: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'No cap ⚠️'}\n` +
          `🛡️ Daily loss limit: $${te.maxDailyLoss}`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, go LIVE', 'sw_mode_live_yes')],
            [Markup.button.callback('❌ Cancel', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_mode_live error: ${e.message}`); }
    });
    this.bot.action('sw_mode_live_yes', async (ctx) => {
      try {
        swte().mode = 'live'; swte().enabled = true; swte().saveConfig();
        await ctx.answerCbQuery('🔴 LIVE TRADING ACTIVATED');
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_mode_live_yes error: ${e.message}`); }
    });

    // sw_ TOGGLE
    this.bot.action('sw_cfg_toggle', async (ctx) => {
      try {
        const te = swte();
        te.enabled = !te.enabled; te.saveConfig();
        await ctx.answerCbQuery(te.enabled ? 'Trading ENABLED' : 'Trading DISABLED');
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_cfg_toggle error: ${e.message}`); }
    });

    this.bot.action('sw_cfg_riskfit', async (ctx) => {
      try {
        const te = swte();
        te.riskFitSizing = !te.riskFitSizing; te.saveConfig();
        await ctx.answerCbQuery(`Risk-fit sizing ${te.riskFitSizing ? 'ON' : 'OFF'}`);
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_cfg_riskfit error: ${e.message}`); }
    });

    // sw_ SIZE
    this.bot.action('sw_cfg_size', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        await ctx.editMessageText(
          `🌊 <b>SWING — POSITION SIZE</b>\n\nCurrent: <b>$${te.maxPositionSize}</b> per trade\n\n<i>Custom: type /swingsize 75 for any amount</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$10${ocCheck(10, te.maxPositionSize)}`, 'sw_size_10'),
             Markup.button.callback(`$25${ocCheck(25, te.maxPositionSize)}`, 'sw_size_25'),
             Markup.button.callback(`$50${ocCheck(50, te.maxPositionSize)}`, 'sw_size_50')],
            [Markup.button.callback(`$100${ocCheck(100, te.maxPositionSize)}`, 'sw_size_100'),
             Markup.button.callback(`$250${ocCheck(250, te.maxPositionSize)}`, 'sw_size_250'),
             Markup.button.callback(`$500${ocCheck(500, te.maxPositionSize)}`, 'sw_size_500')],
            [Markup.button.callback(`$1000${ocCheck(1000, te.maxPositionSize)}`, 'sw_size_1000'),
             Markup.button.callback(`$2000${ocCheck(2000, te.maxPositionSize)}`, 'sw_size_2000'),
             Markup.button.callback(`$5000${ocCheck(5000, te.maxPositionSize)}`, 'sw_size_5000')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_size error: ${e.message}`); }
    });
    for (const size of [10, 25, 50, 100, 250, 500, 1000, 2000, 5000]) {
      this.bot.action(`sw_size_${size}`, async (ctx) => {
        try {
          swte().maxPositionSize = size; swte().saveConfig();
          await ctx.answerCbQuery(`Size: $${size}`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_size error: ${e.message}`); }
      });
    }

    // sw_ LEVERAGE
    this.bot.action('sw_cfg_lev', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        await ctx.editMessageText(
          `🌊 <b>SWING — LEVERAGE</b>\n\nCurrent: <b>${te.defaultLeverage}x</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3x${ocCheck(3, te.defaultLeverage)}`, 'sw_lev_3'),
             Markup.button.callback(`5x${ocCheck(5, te.defaultLeverage)}`, 'sw_lev_5'),
             Markup.button.callback(`10x${ocCheck(10, te.defaultLeverage)}`, 'sw_lev_10')],
            [Markup.button.callback(`15x${ocCheck(15, te.defaultLeverage)}`, 'sw_lev_15'),
             Markup.button.callback(`20x${ocCheck(20, te.defaultLeverage)}`, 'sw_lev_20'),
             Markup.button.callback(`25x${ocCheck(25, te.defaultLeverage)}`, 'sw_lev_25')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_lev error: ${e.message}`); }
    });
    for (const lev of [3, 5, 10, 15, 20, 25]) {
      this.bot.action(`sw_lev_${lev}`, async (ctx) => {
        try {
          swte().defaultLeverage = lev; swte().saveConfig();
          await ctx.answerCbQuery(`Leverage: ${lev}x`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_lev error: ${e.message}`); }
      });
    }

    // sw_ DAILY LOSS
    this.bot.action('sw_cfg_dailyloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        await ctx.editMessageText(
          `🌊 <b>SWING — DAILY LOSS LIMIT</b>\n\nCurrent: <b>$${te.maxDailyLoss}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$10${ocCheck(10, te.maxDailyLoss)}`, 'sw_dloss_10'),
             Markup.button.callback(`$20${ocCheck(20, te.maxDailyLoss)}`, 'sw_dloss_20'),
             Markup.button.callback(`$30${ocCheck(30, te.maxDailyLoss)}`, 'sw_dloss_30')],
            [Markup.button.callback(`$50${ocCheck(50, te.maxDailyLoss)}`, 'sw_dloss_50'),
             Markup.button.callback(`$100${ocCheck(100, te.maxDailyLoss)}`, 'sw_dloss_100')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_dailyloss error: ${e.message}`); }
    });
    for (const loss of [10, 20, 30, 50, 100]) {
      this.bot.action(`sw_dloss_${loss}`, async (ctx) => {
        try {
          swte().maxDailyLoss = loss; swte().saveConfig();
          await ctx.answerCbQuery(`Daily loss: $${loss}`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_dloss error: ${e.message}`); }
      });
    }

    // sw_ PER-TRADE LOSS
    this.bot.action('sw_cfg_tradeloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        await ctx.editMessageText(
          `🌊 <b>SWING — PER-TRADE MAX LOSS</b>\n\nCurrent: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n\n<i>Use /swingmaxloss for any custom value.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`Off${ocCheck(0, te.maxLossPerTrade)}`, 'sw_tloss_0'),
             Markup.button.callback(`$6${ocCheck(6, te.maxLossPerTrade)}`, 'sw_tloss_6'),
             Markup.button.callback(`$10${ocCheck(10, te.maxLossPerTrade)}`, 'sw_tloss_10')],
            [Markup.button.callback(`$15${ocCheck(15, te.maxLossPerTrade)}`, 'sw_tloss_15'),
             Markup.button.callback(`$20${ocCheck(20, te.maxLossPerTrade)}`, 'sw_tloss_20'),
             Markup.button.callback(`$30${ocCheck(30, te.maxLossPerTrade)}`, 'sw_tloss_30')],
            [Markup.button.callback(`$50${ocCheck(50, te.maxLossPerTrade)}`, 'sw_tloss_50'),
             Markup.button.callback(`$75${ocCheck(75, te.maxLossPerTrade)}`, 'sw_tloss_75'),
             Markup.button.callback(`$100${ocCheck(100, te.maxLossPerTrade)}`, 'sw_tloss_100')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_tradeloss error: ${e.message}`); }
    });
    for (const loss of [0, 6, 10, 15, 20, 30, 50, 75, 100]) {
      this.bot.action(`sw_tloss_${loss}`, async (ctx) => {
        try {
          swte().maxLossPerTrade = loss; swte().saveConfig();
          await ctx.answerCbQuery(loss > 0 ? `Max loss/trade: $${loss}` : 'Per-trade cap disabled');
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_tloss error: ${e.message}`); }
      });
    }

    this.bot.command('swingmaxloss', async (ctx) => {
      const input = ctx.message.text.split(' ')[1];
      if (!input) return ctx.replyWithHTML('Usage: <code>/swingmaxloss 25</code>\nRange: $1 — $10,000 per trade. Use <code>/swingmaxloss 0</code> to disable.');
      const loss = parseFloat(input);
      if (input === '0' || input.toLowerCase() === 'off') {
        swte().maxLossPerTrade = 0; swte().saveConfig();
        return ctx.replyWithHTML('✅ Swing per-trade loss cap <b>disabled</b>');
      }
      if (!loss || loss < 1 || loss > 10000) return ctx.replyWithHTML('Usage: <code>/swingmaxloss 25</code>\nRange: $1 — $10,000');
      swte().maxLossPerTrade = loss; swte().saveConfig();
      ctx.replyWithHTML(`✅ Swing per-trade loss cap set to <b>$${loss}</b>`);
    });

    // sw_ LOSS BUFFER
    this.bot.action('sw_cfg_lossbuf', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        const effCap = te.maxLossPerTrade > 0 ? `$${(te.maxLossPerTrade * te.lossBufferPct / 100).toFixed(1)}` : '—';
        await ctx.editMessageText(
          `🌊 <b>SWING — LOSS BUFFER</b>\n\n` +
          `Current: <b>${te.lossBufferPct}%</b> (closes at ${effCap} of $${te.maxLossPerTrade} cap)\n\n` +
          `<i>Closes trade early to avoid overshooting the loss cap.\n100% = close exactly at cap (may overshoot).\n80% = close at 80% of cap (safer).</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`60%${ocCheck(60, te.lossBufferPct)}`, 'sw_buf_60'),
             Markup.button.callback(`70%${ocCheck(70, te.lossBufferPct)}`, 'sw_buf_70'),
             Markup.button.callback(`80%${ocCheck(80, te.lossBufferPct)}`, 'sw_buf_80')],
            [Markup.button.callback(`90%${ocCheck(90, te.lossBufferPct)}`, 'sw_buf_90'),
             Markup.button.callback(`100%${ocCheck(100, te.lossBufferPct)}`, 'sw_buf_100')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_lossbuf error: ${e.message}`); }
    });
    for (const pct of [60, 70, 80, 90, 100]) {
      this.bot.action(`sw_buf_${pct}`, async (ctx) => {
        try {
          swte().lossBufferPct = pct; swte().saveConfig();
          await ctx.answerCbQuery(`Loss buffer: ${pct}%`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_buf error: ${e.message}`); }
      });
    }

    // sw_ MAX POSITIONS
    this.bot.action('sw_cfg_maxpos', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        await ctx.editMessageText(
          `🌊 <b>SWING — MAX CONCURRENT POSITIONS</b>\n\nCurrent: <b>${te.maxConcurrentPositions}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`1${ocCheck(1, te.maxConcurrentPositions)}`, 'sw_pos_1'),
             Markup.button.callback(`2${ocCheck(2, te.maxConcurrentPositions)}`, 'sw_pos_2'),
             Markup.button.callback(`3${ocCheck(3, te.maxConcurrentPositions)}`, 'sw_pos_3')],
            [Markup.button.callback(`5${ocCheck(5, te.maxConcurrentPositions)}`, 'sw_pos_5')],
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_cfg_maxpos error: ${e.message}`); }
    });
    for (const pos of [1, 2, 3, 5]) {
      this.bot.action(`sw_pos_${pos}`, async (ctx) => {
        try {
          swte().maxConcurrentPositions = pos; swte().saveConfig();
          await ctx.answerCbQuery(`Max positions: ${pos}`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_pos error: ${e.message}`); }
      });
    }

    // sw_ CLOSE ALL
    this.bot.action('sw_closeall', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        await ctx.editMessageText(
          `⚠️ <b>CLOSE ALL SWING POSITIONS?</b>\n\nThis will close all open swing trades and disable swing auto-trading.`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, close all', 'sw_closeall_yes')],
            [Markup.button.callback('❌ Cancel', 'sw_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`sw_closeall error: ${e.message}`); }
    });
    this.bot.action('sw_closeall_yes', async (ctx) => {
      try {
        const count = await swte().closeAllPositions();
        swte().enabled = false; swte().saveConfig();
        await ctx.answerCbQuery(`${count} position(s) closed`);
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_closeall_yes error: ${e.message}`); }
    });

    // ── SWING CIRCUIT BREAKER CONTROLS ──
    this.bot.action('sw_cfg_cb', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        const cb = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
        let text = '🛡️ <b>CIRCUIT BREAKER — Swing</b>\n\n';
        text += `Status: ${cb.active ? `🚨 <b>PAUSED</b> — ${cb.minsLeft}m remaining (${cb.streak} losses)` : cb.enabled ? '✅ Armed' : '🔓 Disabled'}\n`;
        text += `Trigger: <b>${te.cbStreak} consecutive losses</b>\n`;
        text += `Pause: <b>${te.cbPauseMinutes} minutes</b>\n\n`;
        if (cb.active) text += '<i>Trading is paused. Override to resume immediately.</i>';
        else if (!cb.enabled) text += '<i>Circuit breaker is disabled — no pause on losing streaks.</i>';
        else text += '<i>Will auto-pause trading after consecutive losses.</i>';

        const buttons = [];
        if (cb.active) {
          buttons.push([Markup.button.callback('⏭️ Override — Resume Now', 'sw_cb_override')]);
        }
        buttons.push([
          Markup.button.callback(`${te.cbEnabled ? '🔓 Disable' : '✅ Enable'}`, 'sw_cb_toggle'),
        ]);
        buttons.push([
          Markup.button.callback('3 losses', 'sw_cb_streak_3'),
          Markup.button.callback('4 losses', 'sw_cb_streak_4'),
          Markup.button.callback('5 losses', 'sw_cb_streak_5'),
        ]);
        buttons.push([
          Markup.button.callback('30m pause', 'sw_cb_pause_30'),
          Markup.button.callback('60m', 'sw_cb_pause_60'),
          Markup.button.callback('120m', 'sw_cb_pause_120'),
        ]);
        buttons.push([Markup.button.callback('⬅️ Back', 'sw_settings')]);
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
      } catch (e) { logger.error(`sw_cfg_cb error: ${e.message}`); }
    });

    this.bot.action('sw_cb_toggle', async (ctx) => {
      try {
        const te = swte();
        te.cbEnabled = !te.cbEnabled;
        te.saveConfig();
        await ctx.answerCbQuery(`Circuit breaker ${te.cbEnabled ? 'enabled' : 'disabled'}`);
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_cb_toggle error: ${e.message}`); }
    });

    this.bot.action('sw_cb_override', async (ctx) => {
      try {
        const te = swte();
        te.cbOverrideUntil = Date.now() + 4 * 60 * 60 * 1000;
        await ctx.answerCbQuery('Circuit breaker overridden — trading resumed');
        await showSwSettings(ctx);
      } catch (e) { logger.error(`sw_cb_override error: ${e.message}`); }
    });

    for (const n of [3, 4, 5]) {
      this.bot.action(`sw_cb_streak_${n}`, async (ctx) => {
        try {
          swte().cbStreak = n; swte().saveConfig();
          await ctx.answerCbQuery(`CB triggers after ${n} losses`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_cb_streak error: ${e.message}`); }
      });
    }
    for (const m of [30, 60, 120]) {
      this.bot.action(`sw_cb_pause_${m}`, async (ctx) => {
        try {
          swte().cbPauseMinutes = m; swte().saveConfig();
          await ctx.answerCbQuery(`CB pause: ${m} minutes`);
          await showSwSettings(ctx);
        } catch (e) { logger.error(`sw_cb_pause error: ${e.message}`); }
      });
    }

    // sw_ EXCHANGES
    this.bot.action('sw_cfg_exchanges', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = swte();
        const exchanges = ['binance', 'bybit'];
        let desc = `🌊 <b>SWING — EXCHANGES</b>\n\n`;
        desc += `Enable/disable exchanges for swing trades.\nDisabled exchanges won't receive new trades.\n\n`;
        for (const ex of exchanges) {
          const disabled = te.disabledExchanges?.has(ex);
          const hasKey = !!(te.exchanges[ex]?.apiKey);
          desc += `${disabled ? '❌' : '✅'} <b>${ex}</b>${hasKey ? '' : ' (no API key)'}\n`;
        }
        await ctx.editMessageText(desc, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            exchanges.map(ex => {
              const disabled = te.disabledExchanges?.has(ex);
              return Markup.button.callback(`${disabled ? '❌' : '✅'} ${ex}`, `sw_ex_${ex}`);
            }),
            [Markup.button.callback('⬅️ Back', 'sw_settings')],
          ]).reply_markup,
        });
      } catch (e) { logger.error(`sw_cfg_exchanges error: ${e.message}`); }
    });
    for (const exId of ['binance', 'bybit']) {
      this.bot.action(`sw_ex_${exId}`, async (ctx) => {
        try {
          const te = swte();
          if (!te.disabledExchanges) te.disabledExchanges = new Set();
          if (te.disabledExchanges.has(exId)) { te.disabledExchanges.delete(exId); }
          else { te.disabledExchanges.add(exId); }
          te.saveConfig();
          await ctx.answerCbQuery(`${exId}: ${te.disabledExchanges.has(exId) ? 'disabled' : 'enabled'}`);
          await ctx.deleteMessage().catch(() => {});
          await showSwSettings(ctx, true);
        } catch (e) { logger.error(`sw_ex toggle error: ${e.message}`); }
      });
    }

    // === DEMAND ZONE SETTINGS PANEL (dz_ prefix) — paper only ===
    const dzte = () => this.dzTradeExecutor;
    const showDzSettings = async (ctx, isNew = false) => {
      const te = dzte();
      if (!te) return;
      await te.recalcDailyPnL?.();
      const openTrades = await db.getOpenTrades('demandzone').catch(() => []);
      const paperTrades = openTrades.filter(t => t.mode === 'paper');
      const liveTrades = openTrades.filter(t => t.mode === 'live');
      const paperClosedPnl = await db.getTodayPnL('paper', 'demandzone').catch(() => 0);
      const liveClosedPnl = await db.getTodayPnL('live', 'demandzone').catch(() => 0);
      const paperOpenPartials = paperTrades.reduce((s, t) => s + (parseFloat(t.realized_pnl) || 0), 0);
      const liveOpenPartials = liveTrades.reduce((s, t) => s + (parseFloat(t.realized_pnl) || 0), 0);
      const paperPnl = paperClosedPnl + paperOpenPartials;
      const livePnl = liveClosedPnl + liveOpenPartials;
      const cbStatus = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
      const cbLine = !cbStatus.enabled ? '🔓 Circuit Breaker: <b>OFF</b>'
        : cbStatus.active ? `🚨 Circuit Breaker: <b>PAUSED ${cbStatus.minsLeft}m</b> (${cbStatus.streak} losses)`
        : cbStatus.overrideUntil ? '⏭️ Circuit Breaker: <b>OVERRIDDEN</b>'
        : `🛡️ Circuit Breaker: <b>ON</b> (${te.cbStreak} losses → ${te.cbPauseMinutes}m pause)`;
      const dzCbLabel = cbStatus.active ? `🚨 CB: PAUSED ${cbStatus.minsLeft}m`
        : !cbStatus.enabled ? '🔓 CB: OFF' : '🛡️ CB: ON';

      const text =
        `🎯 <b>DEMAND ZONE SETTINGS</b>\n\n` +
        `${te.mode === 'paper' ? '📝' : '💰'} Mode: <b>${te.mode.toUpperCase()}</b> | ${te.enabled ? '✅ ON' : '❌ OFF'}\n` +
        `💵 Size: <b>$${te.maxPositionSize}</b>/trade\n` +
        `⚡ Leverage: <b>${te.defaultLeverage}x</b>\n` +
        `🛡️ Daily Loss: <b>$${te.maxDailyLoss}</b> | Per-Trade: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n` +
        `🔰 Loss Buffer: <b>${te.lossBufferPct}%</b> (closes at $${te.maxLossPerTrade > 0 ? (te.maxLossPerTrade * te.lossBufferPct / 100).toFixed(1) : '—'})\n` +
        `🔄 Breakeven: <b>${te.profitProtectLevPnl}% ROI</b> (${(te.profitProtectLevPnl / te.defaultLeverage).toFixed(2)}% price @ ${te.defaultLeverage}x)\n` +
        `📐 Risk-Fit: <b>${te.riskFitSizing ? 'ON' : 'OFF'}</b>${te.riskFitSizing ? ' (shrinks size to cap loss)' : ' (full size)'}\n` +
        `🎚️ Conf-Scale: <b>${te.confidenceScaling ? 'ON' : 'OFF'}</b>${te.confidenceScaling ? ' (low score = smaller size)' : ' (always full size)'}\n` +
        `📊 Max Positions: <b>${te.maxConcurrentPositions}</b>\n` +
        `📈 Paper P&L: <b>$${paperPnl.toFixed(2)}</b> (${paperTrades.length} open)\n` +
        `💰 Live P&L: <b>$${livePnl.toFixed(2)}</b> (${liveTrades.length} open)\n` +
        `🏦 Exchanges: <b>${te.disabledExchanges?.size ? `${te.disabledExchanges.size} off` : 'All ON'}</b>\n` +
        `💧 Min Live Vol: <b>$${(te.minLiveVolume / 1e6).toFixed(0)}M</b>${te.minLiveVolume > 0 ? '' : ' (OFF)'}\n` +
        `🕐 Hours: <b>${te.tradingHours?.length ? te.tradingHours.map(([s,e]) => `${String(s).padStart(2,'0')}-${String(e).padStart(2,'0')}`).join(', ') : '24/7'}</b> UTC\n` +
        `📊 Min Score: <b>${te.minOcScore || 30}+</b>\n` +
        `📋 Total Open: <b>${openTrades.length}/${te.maxConcurrentPositions}</b>\n` +
        `${cbLine}\n\n` +
        `Tap any button to configure:`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback(`${te.mode === 'paper' ? '📝' : '🔴'} Mode: ${te.mode.toUpperCase()}`, 'dz_cfg_mode'),
         Markup.button.callback(`${te.enabled ? '✅ ON' : '⛔ OFF'}`, 'dz_cfg_toggle')],
        [Markup.button.callback(`💵 Size: $${te.maxPositionSize}`, 'dz_cfg_size'),
         Markup.button.callback(`⚡ Lev: ${te.defaultLeverage}x`, 'dz_cfg_lev')],
        [Markup.button.callback(`🛡️ Daily: $${te.maxDailyLoss}`, 'dz_cfg_dailyloss'),
         Markup.button.callback(`🔒 Trade: ${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}`, 'dz_cfg_tradeloss')],
        [Markup.button.callback(`🔰 Buffer: ${te.lossBufferPct}%`, 'dz_cfg_lossbuf'),
         Markup.button.callback(`🔄 BE: ${te.profitProtectLevPnl}% ROI`, 'dz_cfg_be')],
        [Markup.button.callback(`📊 Pos: ${te.maxConcurrentPositions}`, 'dz_cfg_maxpos'),
         Markup.button.callback(`📐 Risk-Fit: ${te.riskFitSizing ? 'ON' : 'OFF'}`, 'dz_cfg_riskfit')],
        [Markup.button.callback(`🎚️ Conf: ${te.confidenceScaling ? 'ON' : 'OFF'}`, 'dz_cfg_confscale'),
         Markup.button.callback(dzCbLabel, 'dz_cfg_cb')],
        [Markup.button.callback(`🏦 Exchanges${te.disabledExchanges?.size ? ` (${te.disabledExchanges.size} off)` : ''}`, 'dz_cfg_exchanges'),
         Markup.button.callback(`💧 Vol: $${(te.minLiveVolume / 1e6).toFixed(0)}M`, 'dz_cfg_minvol')],
        [Markup.button.callback(`🕐 Hours: ${te.tradingHours?.length ? te.tradingHours.length + ' windows' : '24/7'}`, 'dz_cfg_hours')],
        [Markup.button.callback(`🎯 TP1: ${(te.tp1ClosePct * 100).toFixed(0)}%`, 'dz_cfg_tp1'),
         Markup.button.callback(`🎯 TP2: ${(te.tp2ClosePct * 100).toFixed(0)}%`, 'dz_cfg_tp2')],
        [Markup.button.callback(`📊 Min Score: ${te.minOcScore || 30}+`, 'dz_cfg_minscore')],
        [Markup.button.callback('📊 Perf Stats', 'dz_perf_btn')],
        [Markup.button.callback(`📋 Positions (${openTrades.length})`, 'dz_trades'),
         Markup.button.callback('🔄 Refresh', 'dz_settings')],
        [Markup.button.callback('⬅️ Panel', 'panel_main')],
      ]);

      if (isNew) {
        await ctx.replyWithHTML(text, keyboard);
      } else {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
      }
    };

    this._showDzSettings = showDzSettings;
    this.bot.command('dzsettings', async (ctx) => { await showDzSettings(ctx, true); });
    this.bot.action('dz_settings', async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showDzSettings(ctx); } catch (e) { logger.error(`dz_settings error: ${e.message}`); }
    });
    this.bot.action('dz_refresh', async (ctx) => {
      try { await ctx.answerCbQuery(); } catch (e) {}
      try { await showDzSettings(ctx); } catch (e) { logger.error(`dz_refresh error: ${e.message}`); }
    });

    // dz_ MODE
    this.bot.action('dz_cfg_mode', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — TRADE MODE</b>\n\n` +
          `Current: <b>${te.mode.toUpperCase()}</b> ${te.mode === 'paper' ? '📝' : '💰'}\n\n` +
          `📝 <b>Paper</b> — Simulated trades, no real funds\n` +
          `💰 <b>Live</b> — Real orders on exchange`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`📝 Paper${ocCheck('paper', te.mode)}`, 'dz_mode_paper'),
             Markup.button.callback(`💰 Live${ocCheck('live', te.mode)}`, 'dz_mode_live')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_mode error: ${e.message}`); }
    });
    this.bot.action('dz_mode_paper', async (ctx) => {
      try {
        dzte().mode = 'paper'; dzte().enabled = true; dzte().saveConfig();
        await ctx.answerCbQuery('Paper mode activated');
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_mode_paper error: ${e.message}`); }
    });
    this.bot.action('dz_mode_live', async (ctx) => {
      try {
        const te = dzte();
        await ctx.editMessageText(
          `⚠️ <b>SWITCH DZ TO LIVE?</b>\n\n` +
          `Real funds will be used for demand zone trades.\n\n` +
          `💵 Size: $${te.maxPositionSize}/trade\n` +
          `⚡ Leverage: ${te.defaultLeverage}x\n` +
          `📊 Max positions: ${te.maxConcurrentPositions}`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅ Yes, go LIVE', 'dz_mode_live_yes')],
            [Markup.button.callback('❌ Cancel', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_mode_live error: ${e.message}`); }
    });
    this.bot.action('dz_mode_live_yes', async (ctx) => {
      try {
        dzte().mode = 'live'; dzte().enabled = true; dzte().saveConfig();
        await ctx.answerCbQuery('🔴 LIVE TRADING ACTIVATED');
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_mode_live_yes error: ${e.message}`); }
    });

    // dz_ TOGGLE
    this.bot.action('dz_cfg_toggle', async (ctx) => {
      try {
        const te = dzte();
        te.enabled = !te.enabled; te.saveConfig();
        await ctx.answerCbQuery(te.enabled ? 'DZ trading enabled' : 'DZ trading disabled');
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_cfg_toggle error: ${e.message}`); }
    });

    this.bot.action('dz_cfg_riskfit', async (ctx) => {
      try {
        const te = dzte();
        te.riskFitSizing = !te.riskFitSizing; te.saveConfig();
        await ctx.answerCbQuery(`Risk-fit sizing ${te.riskFitSizing ? 'ON — size shrinks to cap loss at SL' : 'OFF — full size, loss cap enforced by checker'}`);
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_cfg_riskfit error: ${e.message}`); }
    });

    this.bot.action('dz_cfg_confscale', async (ctx) => {
      try {
        const te = dzte();
        te.confidenceScaling = !te.confidenceScaling; te.saveConfig();
        await ctx.answerCbQuery(`Confidence scaling ${te.confidenceScaling ? 'ON — low score = 50-75% size' : 'OFF — always full size'}`);
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_cfg_confscale error: ${e.message}`); }
    });

    // dz_ MIN LIVE VOLUME
    this.bot.action('dz_cfg_minvol', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        const curM = (te.minLiveVolume / 1e6).toFixed(0);
        await ctx.editMessageText(
          `🎯 <b>DZ — MIN LIVE VOLUME</b>\n\n` +
          `Current: <b>$${curM}M</b> 24h quote volume\n\n` +
          `<i>Live trades are skipped if the token's 24h volume is below this threshold.\nLow volume = wide spreads = massive slippage on entry/exit.\nPaper trades are unaffected.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`Off${te.minLiveVolume === 0 ? ' ✓' : ''}`, 'dz_minvol_0'),
             Markup.button.callback(`$2M${te.minLiveVolume === 2000000 ? ' ✓' : ''}`, 'dz_minvol_2'),
             Markup.button.callback(`$5M${te.minLiveVolume === 5000000 ? ' ✓' : ''}`, 'dz_minvol_5')],
            [Markup.button.callback(`$10M${te.minLiveVolume === 10000000 ? ' ✓' : ''}`, 'dz_minvol_10'),
             Markup.button.callback(`$20M${te.minLiveVolume === 20000000 ? ' ✓' : ''}`, 'dz_minvol_20'),
             Markup.button.callback(`$50M${te.minLiveVolume === 50000000 ? ' ✓' : ''}`, 'dz_minvol_50')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_minvol error: ${e.message}`); }
    });
    for (const vol of [0, 2, 5, 10, 20, 50]) {
      this.bot.action(`dz_minvol_${vol}`, async (ctx) => {
        try {
          const te = dzte();
          te.minLiveVolume = vol * 1000000;
          te.saveConfig();
          await ctx.answerCbQuery(`Min live volume: ${vol === 0 ? 'OFF' : `$${vol}M`}`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_minvol set error: ${e.message}`); }
      });
    }

    // /dzsetsize custom command
    this.bot.command('dzsetsize', async (ctx) => {
      const amount = parseFloat(ctx.message.text.split(' ')[1]);
      if (!amount || amount < 1 || amount > 10000) {
        return ctx.replyWithHTML('Usage: <code>/dzsetsize 75</code>\nMin $1, Max $10000');
      }
      dzte().maxPositionSize = amount; dzte().saveConfig();
      ctx.replyWithHTML(`✅ DZ position size set to <b>$${amount}</b>`);
    });

    this.bot.action('dz_trades', async (ctx) => {
      try { await ctx.answerCbQuery('Loading trades...'); } catch (e) {}
      try {
        const trades = await db.getOpenTrades('demandzone');
        if (!trades.length) {
          return ctx.editMessageText(
            `📋 <b>DZ POSITIONS</b>\n\n<i>No open positions.</i>`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'dz_trades')],
              [Markup.button.callback('⬅️ Settings', 'dz_settings')],
            ]).reply_markup }
          );
        }
        const te = dzte();
        let msg = `📋 <b>DZ POSITIONS</b> (${trades.length})\n\n`;
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
          const pnlUsd = (pnlPct / 100) * (t.position_size || 0);
          totalPnl += pnlUsd;
          const icon = pnlPct > 0 ? '🟢' : pnlPct < -5 ? '🔴' : '🟡';
          const dir = isLong ? '⬆️' : '⬇️';
          const tpHit = [t.hit_tp1 ? 'TP1✅' : '', t.hit_tp2 ? 'TP2✅' : '', t.hit_tp3 ? 'TP3✅' : ''].filter(Boolean).join(' ') || 'none';
          const _age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
          const _ageStr = _age < 60 ? `${_age}m` : _age < 1440 ? `${Math.round(_age / 60)}h` : `${Math.round(_age / 1440)}d`;
          const _d = new Date(t.created_at);
          const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;
          msg += `${icon}${dir} <b>${t.symbol}</b> (${t.exchange || 'unknown'}) · ${_ageStr} · ${openTime}\n`;
          msg += `Entry: $${t.entry_price.toPrecision(6)} → $${currentPrice ? currentPrice.toPrecision(6) : '?'}\n`;
          msg += `PnL: <b>${pnlLev >= 0 ? '+' : ''}${pnlLev.toFixed(1)}%</b> ($${pnlUsd.toFixed(2)}) | ${t.leverage}x\n`;
          msg += `TP: ${tpHit} | SL: $${t.stop_loss.toPrecision(6)}\n`;
          msg += `Size: $${(t.position_size || 0).toFixed(2)} | ${t.mode}\n\n`;
        }
        msg += `<b>Total unrealized PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</b>`;
        if (msg.length > 4000) msg = msg.slice(0, 3990) + '\n\n<i>…truncated</i>';

        const closeButtons = trades.reduce((rows, t, i) => {
          if (i % 3 === 0) rows.push([]);
          rows[rows.length - 1].push(Markup.button.callback(`❌ ${t.symbol}`, `dz_close_${t.id}`));
          return rows;
        }, []);

        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          ...closeButtons,
          [Markup.button.callback('🛑 Close All DZ', 'dz_closeall_trades')],
          [Markup.button.callback('🔄 Refresh', 'dz_trades')],
          [Markup.button.callback('⬅️ Settings', 'dz_settings')],
        ]).reply_markup });
      } catch (e) {
        if (e.message?.includes('message is not modified')) return;
        logger.error(`dz_trades error: ${e.message}`);
        ctx.editMessageText('❌ Failed to load trades.', { reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'dz_settings')],
        ]).reply_markup }).catch(() => {});
      }
    });

    this.bot.action(/^dz_close_(\d+)$/, async (ctx) => {
      const tradeId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery(`Closing DZ trade #${tradeId}...`);
      try {
        const te = dzte();
        const result = await te.closeSingleTrade(tradeId);
        if (!result) return ctx.answerCbQuery('Trade not found or already closed', { show_alert: true });
        const { trade, pnlUsd } = result;
        await this.sendRaw(
          `✅ <b>DZ MANUAL CLOSE</b> ${trade.symbol} (${trade.exchange || 'unknown'})\n\n` +
          `PnL: ${pnlUsd >= 0 ? '🟢' : '🔴'} ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}\nMode: ${trade.mode}`
        );
        const remaining = await db.getOpenTrades('demandzone');
        if (!remaining.length) {
          await ctx.editMessageText('📋 <b>DZ POSITIONS</b>\n\n<i>All positions closed.</i>', {
            parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'dz_trades')],
              [Markup.button.callback('⬅️ Settings', 'dz_settings')],
            ]).reply_markup
          });
        } else {
          await ctx.editMessageText('✅ Trade closed. Tap Refresh to reload.', {
            parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔄 Refresh', 'dz_trades')],
              [Markup.button.callback('⬅️ Settings', 'dz_settings')],
            ]).reply_markup
          });
        }
      } catch (e) {
        logger.error(`dz_close error: ${e.message}`);
        ctx.answerCbQuery(`Failed: ${e.message}`, { show_alert: true });
      }
    });

    this.bot.action('dz_closeall_trades', async (ctx) => {
      await ctx.answerCbQuery('Closing all DZ positions...');
      try {
        const count = await dzte().closeAllPositions();
        await this.sendRaw(`🛑 <b>ALL DZ POSITIONS CLOSED</b>\n\n${count} trade(s) closed.`);
        await ctx.editMessageText('📋 <b>DZ POSITIONS</b>\n\n<i>All positions closed.</i>', {
          parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'dz_trades')],
            [Markup.button.callback('⬅️ Settings', 'dz_settings')],
          ]).reply_markup
        });
      } catch (e) {
        logger.error(`dz_closeall error: ${e.message}`);
        ctx.answerCbQuery(`Failed: ${e.message}`, { show_alert: true });
      }
    });

    // dz_ SIZE
    this.bot.action('dz_cfg_size', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — POSITION SIZE</b>\n\nCurrent: <b>$${te.maxPositionSize}</b> per trade\n\n<i>Custom: type /dzsetsize 75 for any amount</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$5${ocCheck(5, te.maxPositionSize)}`, 'dz_size_5'),
             Markup.button.callback(`$10${ocCheck(10, te.maxPositionSize)}`, 'dz_size_10'),
             Markup.button.callback(`$15${ocCheck(15, te.maxPositionSize)}`, 'dz_size_15')],
            [Markup.button.callback(`$20${ocCheck(20, te.maxPositionSize)}`, 'dz_size_20'),
             Markup.button.callback(`$25${ocCheck(25, te.maxPositionSize)}`, 'dz_size_25'),
             Markup.button.callback(`$50${ocCheck(50, te.maxPositionSize)}`, 'dz_size_50')],
            [Markup.button.callback(`$100${ocCheck(100, te.maxPositionSize)}`, 'dz_size_100'),
             Markup.button.callback(`$250${ocCheck(250, te.maxPositionSize)}`, 'dz_size_250'),
             Markup.button.callback(`$500${ocCheck(500, te.maxPositionSize)}`, 'dz_size_500')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_size error: ${e.message}`); }
    });
    for (const size of [5, 10, 15, 20, 25, 50, 100, 250, 500]) {
      this.bot.action(`dz_size_${size}`, async (ctx) => {
        try {
          dzte().maxPositionSize = size; dzte().saveConfig();
          await ctx.answerCbQuery(`Size: $${size}`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_size error: ${e.message}`); }
      });
    }

    // dz_ LEVERAGE
    this.bot.action('dz_cfg_lev', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — LEVERAGE</b>\n\nCurrent: <b>${te.defaultLeverage}x</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3x${ocCheck(3, te.defaultLeverage)}`, 'dz_lev_3'),
             Markup.button.callback(`5x${ocCheck(5, te.defaultLeverage)}`, 'dz_lev_5'),
             Markup.button.callback(`10x${ocCheck(10, te.defaultLeverage)}`, 'dz_lev_10')],
            [Markup.button.callback(`15x${ocCheck(15, te.defaultLeverage)}`, 'dz_lev_15'),
             Markup.button.callback(`20x${ocCheck(20, te.defaultLeverage)}`, 'dz_lev_20')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_lev error: ${e.message}`); }
    });
    for (const lev of [3, 5, 10, 15, 20]) {
      this.bot.action(`dz_lev_${lev}`, async (ctx) => {
        try {
          dzte().defaultLeverage = lev; dzte().saveConfig();
          await ctx.answerCbQuery(`Leverage: ${lev}x`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_lev error: ${e.message}`); }
      });
    }

    // dz_ DAILY LOSS LIMIT
    this.bot.action('dz_cfg_dailyloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — DAILY LOSS LIMIT</b>\n\nCurrent: <b>$${te.maxDailyLoss}</b>\nToday P&L: <b>$${te.dailyPnL.toFixed(2)}</b>\n\n<i>Trading stops for the day when losses hit this limit.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`$10${ocCheck(10, te.maxDailyLoss)}`, 'dz_dl_10'),
             Markup.button.callback(`$25${ocCheck(25, te.maxDailyLoss)}`, 'dz_dl_25'),
             Markup.button.callback(`$50${ocCheck(50, te.maxDailyLoss)}`, 'dz_dl_50')],
            [Markup.button.callback(`$100${ocCheck(100, te.maxDailyLoss)}`, 'dz_dl_100'),
             Markup.button.callback(`$200${ocCheck(200, te.maxDailyLoss)}`, 'dz_dl_200'),
             Markup.button.callback(`$500${ocCheck(500, te.maxDailyLoss)}`, 'dz_dl_500')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_dailyloss error: ${e.message}`); }
    });
    for (const dl of [10, 25, 50, 100, 200, 500]) {
      this.bot.action(`dz_dl_${dl}`, async (ctx) => {
        try {
          dzte().maxDailyLoss = dl; dzte().saveConfig();
          await ctx.answerCbQuery(`Daily loss limit: $${dl}`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_dl error: ${e.message}`); }
      });
    }

    // dz_ PER-TRADE LOSS CAP
    this.bot.action('dz_cfg_tradeloss', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — PER-TRADE LOSS CAP</b>\n\nCurrent: <b>${te.maxLossPerTrade > 0 ? `$${te.maxLossPerTrade}` : 'Off'}</b>\n\n<i>Each trade is auto-closed if its unrealized loss reaches this amount.\nUse /dzmaxloss for any custom value.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`Off${ocCheck(0, te.maxLossPerTrade)}`, 'dz_tl_0'),
             Markup.button.callback(`$5${ocCheck(5, te.maxLossPerTrade)}`, 'dz_tl_5'),
             Markup.button.callback(`$10${ocCheck(10, te.maxLossPerTrade)}`, 'dz_tl_10')],
            [Markup.button.callback(`$15${ocCheck(15, te.maxLossPerTrade)}`, 'dz_tl_15'),
             Markup.button.callback(`$20${ocCheck(20, te.maxLossPerTrade)}`, 'dz_tl_20'),
             Markup.button.callback(`$30${ocCheck(30, te.maxLossPerTrade)}`, 'dz_tl_30')],
            [Markup.button.callback(`$50${ocCheck(50, te.maxLossPerTrade)}`, 'dz_tl_50'),
             Markup.button.callback(`$75${ocCheck(75, te.maxLossPerTrade)}`, 'dz_tl_75'),
             Markup.button.callback(`$100${ocCheck(100, te.maxLossPerTrade)}`, 'dz_tl_100')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_tradeloss error: ${e.message}`); }
    });
    for (const tl of [0, 5, 10, 15, 20, 30, 50, 75, 100]) {
      this.bot.action(`dz_tl_${tl}`, async (ctx) => {
        try {
          dzte().maxLossPerTrade = tl; dzte().saveConfig();
          await ctx.answerCbQuery(tl > 0 ? `Trade cap: $${tl}` : 'Trade cap disabled');
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_tl error: ${e.message}`); }
      });
    }

    this.bot.command('dzmaxloss', async (ctx) => {
      const input = ctx.message.text.split(' ')[1];
      if (!input) return ctx.replyWithHTML('Usage: <code>/dzmaxloss 25</code>\nRange: $1 — $10,000 per trade. Use <code>/dzmaxloss 0</code> to disable.');
      const loss = parseFloat(input);
      if (input === '0' || input.toLowerCase() === 'off') {
        dzte().maxLossPerTrade = 0; dzte().saveConfig();
        return ctx.replyWithHTML('✅ DZ per-trade loss cap <b>disabled</b>');
      }
      if (!loss || loss < 1 || loss > 10000) return ctx.replyWithHTML('Usage: <code>/dzmaxloss 25</code>\nRange: $1 — $10,000');
      dzte().maxLossPerTrade = loss; dzte().saveConfig();
      ctx.replyWithHTML(`✅ DZ per-trade loss cap set to <b>$${loss}</b>`);
    });

    // dz_ LOSS BUFFER
    this.bot.action('dz_cfg_lossbuf', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        const effCap = te.maxLossPerTrade > 0 ? `$${(te.maxLossPerTrade * te.lossBufferPct / 100).toFixed(1)}` : '—';
        await ctx.editMessageText(
          `🔰 <b>DZ — LOSS BUFFER</b>\n\n` +
          `Current: <b>${te.lossBufferPct}%</b> (closes at ${effCap} of $${te.maxLossPerTrade} cap)\n\n` +
          `<i>Closes trade early to avoid overshooting the loss cap.\n100% = close exactly at cap (may overshoot).\n80% = close at 80% of cap (safer).</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`60%${ocCheck(60, te.lossBufferPct)}`, 'dz_buf_60'),
             Markup.button.callback(`70%${ocCheck(70, te.lossBufferPct)}`, 'dz_buf_70'),
             Markup.button.callback(`80%${ocCheck(80, te.lossBufferPct)}`, 'dz_buf_80')],
            [Markup.button.callback(`90%${ocCheck(90, te.lossBufferPct)}`, 'dz_buf_90'),
             Markup.button.callback(`100%${ocCheck(100, te.lossBufferPct)}`, 'dz_buf_100')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_lossbuf error: ${e.message}`); }
    });
    for (const pct of [60, 70, 80, 90, 100]) {
      this.bot.action(`dz_buf_${pct}`, async (ctx) => {
        try {
          dzte().lossBufferPct = pct; dzte().saveConfig();
          await ctx.answerCbQuery(`Loss buffer: ${pct}%`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_buf error: ${e.message}`); }
      });
    }

    // dz_ BREAKEVEN THRESHOLD
    this.bot.action('dz_cfg_be', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        const pricePct = (te.profitProtectLevPnl / te.defaultLeverage).toFixed(2);
        await ctx.editMessageText(
          `🔄 <b>DZ — BREAKEVEN TRIGGER</b>\n\n` +
          `Current: <b>${te.profitProtectLevPnl}% leveraged ROI</b>\n` +
          `At ${te.defaultLeverage}x leverage = <b>${pricePct}%</b> price move\n\n` +
          `<i>Once a trade reaches this ROI, SL moves to entry (breakeven).\nLower = safer (triggers sooner), higher = gives more room.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3%${ocCheck(3, te.profitProtectLevPnl)}`, 'dz_be_3'),
             Markup.button.callback(`5%${ocCheck(5, te.profitProtectLevPnl)}`, 'dz_be_5'),
             Markup.button.callback(`8%${ocCheck(8, te.profitProtectLevPnl)}`, 'dz_be_8')],
            [Markup.button.callback(`10%${ocCheck(10, te.profitProtectLevPnl)}`, 'dz_be_10'),
             Markup.button.callback(`12%${ocCheck(12, te.profitProtectLevPnl)}`, 'dz_be_12'),
             Markup.button.callback(`15%${ocCheck(15, te.profitProtectLevPnl)}`, 'dz_be_15')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_be error: ${e.message}`); }
    });
    for (const roi of [3, 5, 8, 10, 12, 15]) {
      this.bot.action(`dz_be_${roi}`, async (ctx) => {
        try {
          dzte().profitProtectLevPnl = roi; dzte().saveConfig();
          await ctx.answerCbQuery(`Breakeven at ${roi}% ROI`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_be error: ${e.message}`); }
      });
    }

    // dz_ CIRCUIT BREAKER
    this.bot.action('dz_cfg_cb', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        const cb = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
        let text = '🎯 <b>DZ — CIRCUIT BREAKER</b>\n\n';
        text += `Status: ${cb.active ? `🚨 <b>PAUSED</b> — ${cb.minsLeft}m remaining (${cb.streak} losses)` : cb.enabled ? '✅ Armed' : '🔓 Disabled'}\n`;
        text += `Trigger: <b>${te.cbStreak} consecutive losses</b>\n`;
        text += `Pause: <b>${te.cbPauseMinutes} minutes</b>\n\n`;
        if (cb.active) text += '<i>Trading is paused. Override to resume immediately.</i>';
        else if (!cb.enabled) text += '<i>Circuit breaker is disabled — no pause on losing streaks.</i>';
        else text += '<i>Will auto-pause trading after consecutive losses.</i>';

        const buttons = [];
        if (cb.active) {
          buttons.push([Markup.button.callback('⏭️ Override — Resume Now', 'dz_cb_override')]);
        }
        buttons.push([
          Markup.button.callback(`${te.cbEnabled ? '🔓 Disable' : '✅ Enable'}`, 'dz_cb_toggle'),
        ]);
        buttons.push([
          Markup.button.callback('3 losses', 'dz_cb_streak_3'),
          Markup.button.callback('4 losses', 'dz_cb_streak_4'),
          Markup.button.callback('5 losses', 'dz_cb_streak_5'),
        ]);
        buttons.push([
          Markup.button.callback('30m pause', 'dz_cb_pause_30'),
          Markup.button.callback('60m', 'dz_cb_pause_60'),
          Markup.button.callback('120m', 'dz_cb_pause_120'),
        ]);
        buttons.push([Markup.button.callback('⬅️ Back', 'dz_settings')]);
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
      } catch (e) { logger.error(`dz_cfg_cb error: ${e.message}`); }
    });

    this.bot.action('dz_cb_toggle', async (ctx) => {
      try {
        const te = dzte();
        te.cbEnabled = !te.cbEnabled; te.saveConfig();
        await ctx.answerCbQuery(`Circuit breaker ${te.cbEnabled ? 'enabled' : 'disabled'}`);
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_cb_toggle error: ${e.message}`); }
    });

    this.bot.action('dz_cb_override', async (ctx) => {
      try {
        const te = dzte();
        te.cbOverrideUntil = Date.now() + 4 * 60 * 60 * 1000;
        await ctx.answerCbQuery('Circuit breaker overridden — trading resumed');
        await showDzSettings(ctx);
      } catch (e) { logger.error(`dz_cb_override error: ${e.message}`); }
    });

    for (const n of [3, 4, 5]) {
      this.bot.action(`dz_cb_streak_${n}`, async (ctx) => {
        try {
          dzte().cbStreak = n; dzte().saveConfig();
          await ctx.answerCbQuery(`CB triggers after ${n} losses`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_cb_streak error: ${e.message}`); }
      });
    }
    for (const m of [30, 60, 120]) {
      this.bot.action(`dz_cb_pause_${m}`, async (ctx) => {
        try {
          dzte().cbPauseMinutes = m; dzte().saveConfig();
          await ctx.answerCbQuery(`CB pause: ${m} minutes`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_cb_pause error: ${e.message}`); }
      });
    }

    // dz_ EXCHANGES
    this.bot.action('dz_cfg_exchanges', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        const exchanges = ['binance', 'bybit'];
        let desc = `🎯 <b>DZ — EXCHANGES</b>\n\n`;
        desc += `Enable/disable exchanges for demand zone trades.\nDisabled exchanges won't receive new trades.\n\n`;
        for (const ex of exchanges) {
          const disabled = te.disabledExchanges?.has(ex);
          const hasKey = !!(te.exchanges[ex]?.apiKey);
          desc += `${disabled ? '❌' : '✅'} <b>${ex}</b>${hasKey ? '' : ' (no API key)'}\n`;
        }
        await ctx.editMessageText(desc, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            exchanges.map(ex => {
              const disabled = te.disabledExchanges?.has(ex);
              return Markup.button.callback(`${disabled ? '❌' : '✅'} ${ex}`, `dz_ex_${ex}`);
            }),
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup,
        });
      } catch (e) { logger.error(`dz_cfg_exchanges error: ${e.message}`); }
    });
    for (const exId of ['binance', 'bybit']) {
      this.bot.action(`dz_ex_${exId}`, async (ctx) => {
        try {
          const te = dzte();
          if (!te.disabledExchanges) te.disabledExchanges = new Set();
          if (te.disabledExchanges.has(exId)) { te.disabledExchanges.delete(exId); }
          else { te.disabledExchanges.add(exId); }
          te.saveConfig();
          await ctx.answerCbQuery(`${exId}: ${te.disabledExchanges.has(exId) ? 'disabled' : 'enabled'}`);
          await ctx.deleteMessage().catch(() => {});
          await showDzSettings(ctx, true);
        } catch (e) { logger.error(`dz_ex toggle error: ${e.message}`); }
      });
    }

    // dz_ MAX POSITIONS
    this.bot.action('dz_cfg_maxpos', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — MAX CONCURRENT POSITIONS</b>\n\nCurrent: <b>${te.maxConcurrentPositions}</b>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`3${ocCheck(3, te.maxConcurrentPositions)}`, 'dz_pos_3'),
             Markup.button.callback(`5${ocCheck(5, te.maxConcurrentPositions)}`, 'dz_pos_5'),
             Markup.button.callback(`7${ocCheck(7, te.maxConcurrentPositions)}`, 'dz_pos_7')],
            [Markup.button.callback(`10${ocCheck(10, te.maxConcurrentPositions)}`, 'dz_pos_10'),
             Markup.button.callback(`15${ocCheck(15, te.maxConcurrentPositions)}`, 'dz_pos_15')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_maxpos error: ${e.message}`); }
    });
    for (const pos of [3, 5, 7, 10, 15]) {
      this.bot.action(`dz_pos_${pos}`, async (ctx) => {
        try {
          dzte().maxConcurrentPositions = pos; dzte().saveConfig();
          await ctx.answerCbQuery(`Max positions: ${pos}`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_pos error: ${e.message}`); }
      });
    }

    // dz_ MIN SCORE
    this.bot.action('dz_cfg_minscore', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        const cur = te.minOcScore || 30;
        await ctx.editMessageText(
          `🎯 <b>DZ — MIN SCORE</b>\n\n` +
          `Current: <b>${cur}+</b>\n\n` +
          `<i>Lower = more trades (incl. weaker setups).\nHigher = fewer trades, only strongest zones.\n\nToday's SAGA scored 34 — would need ≤34 to catch it.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`25+${ocCheck(25, cur)}`, 'dz_minscore_25'),
             Markup.button.callback(`30+${ocCheck(30, cur)}`, 'dz_minscore_30'),
             Markup.button.callback(`35+${ocCheck(35, cur)}`, 'dz_minscore_35')],
            [Markup.button.callback(`40+${ocCheck(40, cur)}`, 'dz_minscore_40'),
             Markup.button.callback(`45+${ocCheck(45, cur)}`, 'dz_minscore_45'),
             Markup.button.callback(`50+${ocCheck(50, cur)}`, 'dz_minscore_50')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_minscore error: ${e.message}`); }
    });
    for (const score of [25, 30, 35, 40, 45, 50]) {
      this.bot.action(`dz_minscore_${score}`, async (ctx) => {
        try {
          dzte().minOcScore = score; dzte().saveConfig();
          await ctx.answerCbQuery(`Min DZ score: ${score}+`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_minscore error: ${e.message}`); }
      });
    }

    // dz_ TP1 EXIT %
    this.bot.action('dz_cfg_tp1', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — TP1 CLOSE %</b>\n\n` +
          `Current: <b>${(te.tp1ClosePct * 100).toFixed(0)}%</b> of position closed at TP1\n\n` +
          `<i>Higher = bank more profit early (safer).\nLower = keep more for TP2/TP3 (bigger upside).</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`25%${ocCheck(0.25, te.tp1ClosePct)}`, 'dz_tp1_25'),
             Markup.button.callback(`33%${ocCheck(0.33, te.tp1ClosePct)}`, 'dz_tp1_33'),
             Markup.button.callback(`50%${ocCheck(0.50, te.tp1ClosePct)}`, 'dz_tp1_50')],
            [Markup.button.callback(`67%${ocCheck(0.67, te.tp1ClosePct)}`, 'dz_tp1_67'),
             Markup.button.callback(`75%${ocCheck(0.75, te.tp1ClosePct)}`, 'dz_tp1_75'),
             Markup.button.callback(`100%${ocCheck(1.0, te.tp1ClosePct)}`, 'dz_tp1_100')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_tp1 error: ${e.message}`); }
    });
    for (const pct of [25, 33, 50, 67, 75, 100]) {
      this.bot.action(`dz_tp1_${pct}`, async (ctx) => {
        try {
          dzte().tp1ClosePct = pct / 100; dzte().saveConfig();
          await ctx.answerCbQuery(`TP1 closes ${pct}%`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_tp1 error: ${e.message}`); }
      });
    }

    // dz_ TP2 EXIT %
    this.bot.action('dz_cfg_tp2', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = dzte();
        await ctx.editMessageText(
          `🎯 <b>DZ — TP2 CLOSE %</b>\n\n` +
          `Current: <b>${te.tp2ClosePct >= 1 ? 'ALL (100%)' : (te.tp2ClosePct * 100).toFixed(0) + '%'}</b> of remaining closed at TP2\n\n` +
          `<i>100% = close everything at TP2, trade done.\nLower % keeps a runner for TP3.</i>`,
          { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(`33%${ocCheck(0.33, te.tp2ClosePct)}`, 'dz_tp2_33'),
             Markup.button.callback(`50%${ocCheck(0.50, te.tp2ClosePct)}`, 'dz_tp2_50'),
             Markup.button.callback(`75%${ocCheck(0.75, te.tp2ClosePct)}`, 'dz_tp2_75')],
            [Markup.button.callback(`ALL (100%)${ocCheck(1.0, te.tp2ClosePct)}`, 'dz_tp2_100')],
            [Markup.button.callback('⬅️ Back', 'dz_settings')],
          ]).reply_markup }
        );
      } catch (e) { logger.error(`dz_cfg_tp2 error: ${e.message}`); }
    });
    for (const pct of [33, 50, 75, 100]) {
      this.bot.action(`dz_tp2_${pct}`, async (ctx) => {
        try {
          dzte().tp2ClosePct = pct / 100; dzte().saveConfig();
          await ctx.answerCbQuery(`TP2 closes ${pct}%`);
          await showDzSettings(ctx);
        } catch (e) { logger.error(`dz_tp2 error: ${e.message}`); }
      });
    }

    // dz_ PERF STATS BUTTON
    this.bot.action('dz_perf_btn', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const perf = await db.getDemandZonePerformance(30);
        const total = parseInt(perf.total) || 0;
        if (total === 0) {
          await ctx.editMessageText(
            `🎯 <b>DEMAND ZONE PERFORMANCE</b>\n\nNo trades yet — data will appear after the first demand zone signal is paper-traded.`,
            { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back', 'dz_settings')],
            ]).reply_markup }
          );
          return;
        }
        const closed = parseInt(perf.closed_count) || 0;
        const wins = parseInt(perf.wins) || 0;
        const losses = parseInt(perf.losses) || 0;
        const winRate = closed > 0 ? ((wins / closed) * 100).toFixed(0) : '0';
        const totalPnl = parseFloat(perf.total_pnl) || 0;
        const avgPnl = parseFloat(perf.avg_pnl) || 0;
        const avgWin = parseFloat(perf.avg_win_pct) || 0;
        const avgLoss = parseFloat(perf.avg_loss_pct) || 0;
        const avgHold = parseFloat(perf.avg_hold_hours) || 0;
        const tp1 = parseInt(perf.tp1_hits) || 0;
        const tp2 = parseInt(perf.tp2_hits) || 0;
        const tp3 = parseInt(perf.tp3_hits) || 0;

        let msg = `🎯 <b>DEMAND ZONE PERFORMANCE</b> (30d)\n\n`;
        msg += `📊 ${total} trades | ${closed} closed | ${parseInt(perf.open_count) || 0} open\n`;
        msg += `✅ ${wins}W / ${losses}L — <b>${winRate}% win rate</b>\n`;
        msg += `💰 Total P&L: <b>$${totalPnl.toFixed(2)}</b>\n`;
        msg += `📈 Avg: $${avgPnl.toFixed(2)} | Win: +${avgWin.toFixed(1)}% | Loss: ${avgLoss.toFixed(1)}%\n`;
        msg += `⏱ Avg hold: ${avgHold.toFixed(1)}h\n`;
        msg += `🎯 TP hits: TP1 ${tp1} | TP2 ${tp2} | TP3 ${tp3}`;

        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', 'dz_settings')],
        ]).reply_markup });
      } catch (e) { logger.error(`dz_perf_btn error: ${e.message}`); }
    });

    this.bot.command('whale', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 3) {
        return ctx.replyWithHTML(
          '🐋 <b>WHALE TRACKER</b>\n\n' +
          '<b>What it does:</b>\n' +
          'Monitors large token transfers on-chain. Detects when tokens move in/out of exchange wallets — the same activity Flams watches before calling coins like BULLA.\n\n' +
          '<b>Usage:</b>\n' +
          '<code>/whale TOKEN CHAIN CONTRACT_ADDRESS</code>\n\n' +
          '<b>Examples:</b>\n' +
          '<code>/whale BULLA ethereum 0x1234...abcd</code>\n' +
          '<code>/whale KOMA bsc 0x5678...efgh</code>\n' +
          '<code>/whale BONK solana So11111...mint</code>\n\n' +
          '<b>Supported Chains (Etherscan V2 — one API key):</b>\n' +
          '• <code>ethereum</code> / <code>eth</code> — ERC-20 tokens ✅ Free\n' +
          '• <code>polygon</code> — Polygon tokens ✅ Free\n' +
          '• <code>arbitrum</code> — Arbitrum tokens ✅ Free\n' +
          '• <code>bsc</code> / <code>bnb</code> — BEP-20 tokens (needs separate BSCSCAN key or paid Etherscan)\n' +
          '• <code>base</code> — Base tokens (needs paid Etherscan plan)\n' +
          '• <code>optimism</code> — Optimism tokens (needs paid Etherscan plan)\n' +
          '• <code>avalanche</code> — Avalanche tokens (needs paid Etherscan plan)\n' +
          '• <code>solana</code> / <code>sol</code> — SPL tokens (requires SOLSCAN_API_KEY)\n\n' +
          '<b>NOT supported:</b> Robinhood chain, Sui, Aptos, TON\n\n' +
          '<b>How to read results:</b>\n' +
          '📤 <b>WITHDRAWAL</b> = Tokens leaving exchange → Bullish (accumulation)\n' +
          '📥 <b>DEPOSIT</b> = Tokens entering exchange → Bearish (sell pressure)\n' +
          '🔄 <b>TRANSFER</b> = Wallet-to-wallet move\n\n' +
          '<b>Where to find contract addresses:</b>\n' +
          '• CoinGecko → token page → Contract field\n' +
          '• CoinMarketCap → token page → Contracts section\n' +
          '• DEXScreener → pair page → token address\n\n' +
          '<b>API Keys needed (all free):</b>\n' +
          '• Etherscan: etherscan.io/apis (free, no card)\n' +
          '• BSCScan: bscscan.com/apis (free, no card)\n' +
          '• Solscan: pro-api.solscan.io (free tier available)\n\n' +
          '<i>Note: This tracks on-chain activity only. Our bot trades futures perps on Binance/Bybit/MEXC — it does NOT trade spot, DEX, Solana, or other L1/L2 chains directly.</i>'
        );
        return;
      }

      const [symbol, chain, address] = args;
      ctx.reply(`🐋 Checking whale activity for $${symbol.toUpperCase()} on ${chain}...`);

      try {
        let alerts = [];
        const c = chain.toLowerCase();
        const evmChains = ['ethereum', 'eth', 'bsc', 'bnb', 'polygon', 'arbitrum', 'base', 'optimism', 'avalanche', 'robinhood', 'rhood', 'solana', 'sol'];
        if (c === 'solana' || c === 'sol') {
          alerts = await this.onchainTracker.checkEvmWhales(address, symbol.toUpperCase(), c);
        } else if (evmChains.includes(c)) {
          alerts = await this.onchainTracker.checkEvmWhales(address, symbol.toUpperCase(), c);
        } else {
          return ctx.replyWithHTML(
            `❌ Chain <b>${chain}</b> is not supported.\n\n` +
            '<b>Supported EVM:</b> ethereum, bsc, polygon, arbitrum, base, optimism, avalanche, robinhood\n' +
            '<b>Supported non-EVM:</b> solana\n\n' +
            'Use <code>/whale</code> without args for full guide.'
          );
        }

        if (!alerts.length) {
          return ctx.replyWithHTML(
            `🐋 No recent whale transactions found for <b>$${symbol.toUpperCase()}</b> on ${chain}.\n\n` +
            '<i>This could mean:\n' +
            '• The contract address is wrong\n' +
            '• No large transfers in recent blocks\n' +
            '• The API key for this chain is not set</i>'
          );
        }

        for (const alert of alerts.slice(0, 5)) {
          ctx.replyWithHTML(formatWhaleAlert(alert));
        }
      } catch (err) {
        ctx.reply(`Whale check failed: ${err.message}`);
        logger.error(`/whale error: ${err.message}`);
      }
    });


    // Test chart generation — /testchart BTC or /testchart ETH long
    this.bot.command('testchart', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      const symbol = (args[0] || 'BTC').toUpperCase();
      const direction = (args[1] || 'long').toLowerCase();

      await ctx.replyWithHTML(`📊 Generating test chart for <b>${symbol}</b>...`);

      try {
        const exchange = Object.values(this.tradeExecutor.exchanges)[0];
        if (!exchange) return ctx.replyWithHTML('❌ No exchange available');

        const pair = `${symbol}/USDT:USDT`;
        const ohlcv = await exchange.fetchOHLCV(pair, '1h', undefined, 60);
        if (!ohlcv || ohlcv.length < 10) return ctx.replyWithHTML('❌ Not enough candle data');

        const lastCandle = ohlcv[ohlcv.length - 1];
        const price = lastCandle[4];
        const atr = ohlcv.slice(-14).reduce((sum, c) => sum + (c[2] - c[3]), 0) / 14;
        const isLong = direction === 'long';

        const mockSignal = {
          symbol,
          pair,
          exchange: Object.keys(this.tradeExecutor.exchanges)[0],
          direction,
          score: 82,
          currentPrice: price,
          tp1: isLong ? price + atr * 3 : price - atr * 3,
          tp2: isLong ? price + atr * 6 : price - atr * 6,
          tp3: isLong ? price + atr * 10 : price - atr * 10,
          stopLoss: isLong ? price - atr * 3 : price + atr * 3,
        };

        const chartBuf = generateSignalChart(ohlcv, mockSignal);
        if (!chartBuf) return ctx.replyWithHTML('❌ Chart generation failed — canvas may not be installed');

        const fmtP = (p) => p >= 1000 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(4) : p.toPrecision(4);
        const caption =
          `🎯 <b>TEST CHART — ${symbol}/USDT ${direction.toUpperCase()}</b>

` +
          `Entry: ${fmtP(price)}
` +
          `TP1: ${fmtP(mockSignal.tp1)}
` +
          `TP2: ${fmtP(mockSignal.tp2)}
` +
          `TP3: ${fmtP(mockSignal.tp3)}
` +
          `SL: ${fmtP(mockSignal.stopLoss)}

` +
          `<i>Mock signal — levels based on ATR. This is what real signal charts look like.</i>`;

        await ctx.replyWithPhoto({ source: chartBuf }, { caption, parse_mode: 'HTML' });
      } catch (err) {
        await ctx.replyWithHTML(`❌ Error: ${err.message}`);
      }
    });

    this.bot.command('flows', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);

      // No args: run full flow scanner across all perp tokens
      if (args.length === 0) {
        if (!this.flowScanner) {
          return ctx.replyWithHTML('❌ Flow scanner not initialized.');
        }
        ctx.replyWithHTML('🏦 Scanning all perp tokens for exchange flows... this takes 1-2 min.');
        try {
          const results = await this.flowScanner.scan();
          if (!results.length) {
            return ctx.replyWithHTML(
              '🏦 No significant exchange flows detected across perp tokens.\n\n' +
              '<i>This means no major exchange withdrawals/deposits in recent blocks. ' +
              'The scanner checks the top 30 perp tokens by volume for transfers to/from 35+ known exchange wallets.</i>'
            );
          }
          const msg = this.flowScanner.formatAlerts(results, 8);
          if (msg) await ctx.replyWithHTML(msg);

          // Send setup chart images for top flow tokens
          const charted = results.filter(r => r.flowScore >= 15).slice(0, 3);
          for (const token of charted) {
            try {
              const exchange = this.tradeExecutor?.exchanges?.[token.exchange];
              if (!exchange) continue;
              const ohlcv = await exchange.fetchOHLCV(token.pair, '1h', undefined, 60);
              if (!ohlcv || ohlcv.length < 10) continue;
              const dir = token.flow.outflowCount > token.flow.inflowCount ? 'long' : token.flow.inflowCount > token.flow.outflowCount ? 'short' : 'neutral';
              const chartInfo = {
                symbol: token.symbol, exchange: token.exchange,
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
              };
              const chartBuf = generateSetupChart(ohlcv, chartInfo);
              if (chartBuf) {
                await ctx.replyWithPhoto({ source: chartBuf }, {
                  caption: `📸 <b>${token.symbol}</b> Flow Snapshot — Score: ${token.flowScore}`,
                  parse_mode: 'HTML',
                });
              }
            } catch (e) {
              logger.debug(`/flows chart failed for ${token.symbol}: ${e.message}`);
            }
          }
          return;
        } catch (err) {
          ctx.replyWithHTML(`❌ Flow scan failed: ${err.message}`);
          logger.error(`/flows error: ${err.message}`);
        }
        return;
      }

      // With args: check specific token
      if (args.length === 1) {
        // Just symbol — auto-resolve contract address
        const symbol = args[0].toUpperCase();
        ctx.replyWithHTML(`🏦 Resolving contract and checking flows for <b>$${symbol}</b>...`);
        try {
          const contract = await this.onchainTracker.resolveContractAddress(symbol);
          if (!contract) {
            return ctx.replyWithHTML(
              `❌ Could not find contract address for <b>$${symbol}</b> on CoinGecko.\n\n` +
              'Try with explicit contract address:\n' +
              `<code>/flows ${symbol} 0xcontract... chain</code>`
            );
          }
          const chainKey = this.flowScanner?.mapChain(contract.chain) || contract.chain;
          const flow = await this.onchainTracker.analyzeExchangeFlows(contract.address, symbol, chainKey);
          if (!flow) {
            return ctx.replyWithHTML(
              `🏦 No exchange flow data for <b>$${symbol}</b> on ${contract.chain}.\n\n` +
              `<i>Contract: ${contract.address}\nChain: ${contract.chain}\n` +
              'No recent transfers detected involving known exchange wallets.</i>'
            );
          }
          return ctx.replyWithHTML(this.formatFlowResult(symbol, flow, contract));
        } catch (err) {
          ctx.replyWithHTML(`❌ Flow check failed: ${err.message}`);
          logger.error(`/flows ${symbol} error: ${err.message}`);
        }
        return;
      }

      // With symbol + contract address + optional chain
      const [symbol, address, chain] = args;
      ctx.replyWithHTML(`🏦 Checking exchange flows for <b>$${symbol.toUpperCase()}</b>...`);
      try {
        const chainName = chain || 'ethereum';
        const flow = await this.onchainTracker.analyzeExchangeFlows(address, symbol.toUpperCase(), chainName);
        if (!flow) {
          return ctx.replyWithHTML(
            `🏦 No exchange flow data for <b>$${symbol.toUpperCase()}</b>.\n\n` +
            '<i>No recent transfers involving known exchange wallets. ' +
            'Check the contract address is correct.</i>'
          );
        }
        return ctx.replyWithHTML(this.formatFlowResult(symbol.toUpperCase(), flow, { chain: chainName, address }));
      } catch (err) {
        ctx.replyWithHTML(`❌ Flow check failed: ${err.message}`);
        logger.error(`/flows error: ${err.message}`);
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
    this.bot.action('cfg_mode_paper', async (ctx) => {
      te().mode = 'paper';
      te().enabled = true;
      te().saveConfig();
      await ctx.answerCbQuery('Paper mode activated');
      await this.showSettingsMain(ctx);
    });
    this.bot.action('cfg_mode_live', async (ctx) => {
      const t = te();
      // Show confirmation before enabling live
      ctx.editMessageText(
        `⚠️ <b>SWITCH TO LIVE TRADING?</b>\n\n` +
        `This will use <b>real funds</b> on your exchange accounts.\n\n` +
        `Every signal that passes your filters will place real orders.\n` +
        `Make sure your risk settings are correct before enabling.\n\n` +
        `Current settings:\n` +
        `💵 Size: $${t.maxPositionSize}/trade\n` +
        `⚡ Leverage: ${t.defaultLeverage}x\n` +
        `🔒 Max loss/trade: ${t.maxLossPerTrade > 0 ? `$${t.maxLossPerTrade}` : 'No cap ⚠️'}\n` +
        `🛡️ Daily loss limit: $${t.maxDailyLoss}`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Yes, go LIVE', 'cfg_mode_live_confirm')],
          [Markup.button.callback('❌ Cancel', 'cfg_main')],
        ]).reply_markup }
      );
    });
    this.bot.action('cfg_mode_live_confirm', async (ctx) => {
      te().mode = 'live';
      te().enabled = true;
      te().saveConfig();
      await ctx.answerCbQuery('🔴 LIVE TRADING ACTIVATED');
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

    this.bot.action('cfg_riskfit', async (ctx) => {
      const t = te();
      t.riskFitSizing = !t.riskFitSizing; t.saveConfig();
      await ctx.answerCbQuery(`Risk-fit sizing ${t.riskFitSizing ? 'ON' : 'OFF'}`);
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
        `How much USDT to allocate per trade.\nWith DCA, this is split into 3 entries (1/3 each).\n\n` +
        `<i>Custom: type /setsize 12 for any amount</i>`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`$5${check(5, t.maxPositionSize)}`, 'cfg_size_5'),
           Markup.button.callback(`$10${check(10, t.maxPositionSize)}`, 'cfg_size_10'),
           Markup.button.callback(`$15${check(15, t.maxPositionSize)}`, 'cfg_size_15')],
          [Markup.button.callback(`$20${check(20, t.maxPositionSize)}`, 'cfg_size_20'),
           Markup.button.callback(`$25${check(25, t.maxPositionSize)}`, 'cfg_size_25'),
           Markup.button.callback(`$50${check(50, t.maxPositionSize)}`, 'cfg_size_50')],
          [Markup.button.callback(`$100${check(100, t.maxPositionSize)}`, 'cfg_size_100'),
           Markup.button.callback(`$250${check(250, t.maxPositionSize)}`, 'cfg_size_250'),
           Markup.button.callback(`$500${check(500, t.maxPositionSize)}`, 'cfg_size_500')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const size of [5, 10, 15, 20, 25, 50, 100, 250, 500]) {
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
          [Markup.button.callback(`4${check(4, t.maxConcurrentPositions)}`, 'cfg_mpos_4'),
           Markup.button.callback(`5${check(5, t.maxConcurrentPositions)}`, 'cfg_mpos_5'),
           Markup.button.callback(`6${check(6, t.maxConcurrentPositions)}`, 'cfg_mpos_6')],
          [Markup.button.callback(`7${check(7, t.maxConcurrentPositions)}`, 'cfg_mpos_7'),
           Markup.button.callback(`8${check(8, t.maxConcurrentPositions)}`, 'cfg_mpos_8'),
           Markup.button.callback(`10${check(10, t.maxConcurrentPositions)}`, 'cfg_mpos_10')],
          [Markup.button.callback(`15${check(15, t.maxConcurrentPositions)}`, 'cfg_mpos_15'),
           Markup.button.callback(`20${check(20, t.maxConcurrentPositions)}`, 'cfg_mpos_20')],
          [Markup.button.callback('⬅️ Back', 'cfg_main')],
        ]).reply_markup }
      );
    });
    for (const pos of [1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20]) {
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
    const signalTypes = ['BREAKOUT', 'VOLUME_SPIKE', 'LISTING', 'FUNDING_SHORT', 'ZONE_ENTRY'];
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

    // ── EXCLUDED SYMBOLS ──
    this.bot.action('cfg_exclude', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showExcludePanel(ctx);
    });
    const excludeTokens = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX'];
    for (const token of excludeTokens) {
      this.bot.action(`cfg_excl_${token}`, async (ctx) => {
        const t = te();
        if (!t.excludedSymbols) t.excludedSymbols = new Set();
        if (t.excludedSymbols.has(token)) {
          t.excludedSymbols.delete(token);
        } else {
          t.excludedSymbols.add(token);
        }
        t.saveConfig();
        await ctx.answerCbQuery(`${token}: ${t.excludedSymbols.has(token) ? 'excluded' : 'allowed'}`);
        await this.showExcludePanel(ctx);
      });
    }
    this.bot.action('cfg_excl_clear', async (ctx) => {
      const t = te();
      if (!t.excludedSymbols || t.excludedSymbols.size === 0) {
        t.excludedSymbols = new Set(excludeTokens);
      } else {
        t.excludedSymbols = new Set();
      }
      t.saveConfig();
      await ctx.answerCbQuery(t.excludedSymbols.size ? 'All excluded' : 'All cleared');
      await this.showExcludePanel(ctx);
    });

    // ── EXCHANGES TOGGLE ──
    this.bot.action('cfg_exchanges', async (ctx) => {
      await ctx.answerCbQuery();
      await this.showExchangesPanel(ctx);
    });
    const exchangeIds = ['binance', 'bybit'];
    for (const exId of exchangeIds) {
      this.bot.action(`cfg_ex_${exId}`, async (ctx) => {
        const t = te();
        if (!t.disabledExchanges) t.disabledExchanges = new Set();
        if (t.disabledExchanges.has(exId)) {
          t.disabledExchanges.delete(exId);
        } else {
          t.disabledExchanges.add(exId);
        }
        t.saveConfig();
        await ctx.answerCbQuery(`${exId}: ${t.disabledExchanges.has(exId) ? 'disabled' : 'enabled'}`);
        await this.showExchangesPanel(ctx);
      });
    }

    // ── TRADING HOURS (shared helper for all modes) ──
    const presets = {
      '24/7': [],
      'US Session': [[13, 21]],
      'EU Session': [[7, 16]],
      'Asia Session': [[0, 8]],
      'EU + US': [[7, 21]],
      'Best Hours': [[8, 14], [20, 23]],
    };

    const showHoursPanel = async (ctx, executor, prefix, backAction) => {
      const te = executor;
      const h = new Date().getUTCHours();
      const active = te.tradingHours?.length
        ? te.tradingHours.some(([s, e]) => s <= e ? (h >= s && h < e) : (h >= s || h < e))
        : true;
      let text = `🕐 <b>TRADING HOURS</b>\n\n`;
      text += `Current: <b>${te.tradingHours?.length ? te.tradingHours.map(([s,e]) => `${String(s).padStart(2,'0')}:00-${String(e).padStart(2,'0')}:00`).join(', ') : '24/7 (no restriction)'}</b> UTC\n`;
      text += `Now: <b>${String(h).padStart(2,'0')}:00 UTC</b> — ${active ? '✅ Trading active' : '❌ Outside hours'}\n\n`;
      text += `<b>Presets:</b>\n`;
      text += `• 24/7 — No restriction\n`;
      text += `• US — 13:00-21:00 UTC (NY open → close)\n`;
      text += `• EU — 07:00-16:00 UTC (London open → close)\n`;
      text += `• Asia — 00:00-08:00 UTC (Tokyo/HK)\n`;
      text += `• EU+US — 07:00-21:00 UTC (full western session)\n`;
      text += `• Best — 08:00-14:00 + 20:00-23:00 UTC\n\n`;
      text += `<i>Custom: /sethours ${prefix === 'cfg' ? '' : prefix.replace('_cfg','') + ' '}8-14,20-23</i>`;

      const buttons = [
        [Markup.button.callback('24/7', `${prefix}_hours_247`),
         Markup.button.callback('US 13-21', `${prefix}_hours_us`),
         Markup.button.callback('EU 7-16', `${prefix}_hours_eu`)],
        [Markup.button.callback('Asia 0-8', `${prefix}_hours_asia`),
         Markup.button.callback('EU+US 7-21', `${prefix}_hours_euus`),
         Markup.button.callback('Best', `${prefix}_hours_best`)],
        [Markup.button.callback('⬅️ Back', backAction)],
      ];
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
    };

    const registerHoursHandlers = (prefix, getExecutor, refreshFn) => {
      this.bot.action(`${prefix}_hours`, async (ctx) => {
        try {
          await ctx.answerCbQuery();
          await showHoursPanel(ctx, getExecutor(), prefix, prefix === 'cfg' ? 'cfg_main' : prefix.replace('_cfg', '_settings'));
        } catch (e) { logger.error(`${prefix}_hours error: ${e.message}`); }
      });
      const presetMap = { '247': '24/7', us: 'US Session', eu: 'EU Session', asia: 'Asia Session', euus: 'EU + US', best: 'Best Hours' };
      for (const [key, name] of Object.entries(presetMap)) {
        this.bot.action(`${prefix}_hours_${key}`, async (ctx) => {
          try {
            const te = getExecutor();
            te.tradingHours = presets[name];
            te.saveConfig();
            await ctx.answerCbQuery(`Hours: ${name}`);
            await refreshFn(ctx);
          } catch (e) { logger.error(`${prefix}_hours_${key} error: ${e.message}`); }
        });
      }
    };

    // Register for all modes
    registerHoursHandlers('cfg', () => te(), (ctx) => this.showSettingsMain(ctx));
    registerHoursHandlers('oc_cfg', () => this.onchainTradeExecutor, (ctx) => this._showOcSettings(ctx));
    registerHoursHandlers('sw_cfg', () => this.swingTradeExecutor, (ctx) => this._showSwSettings(ctx));
    registerHoursHandlers('dz_cfg', () => this.dzTradeExecutor, (ctx) => this._showDzSettings(ctx));

    // /sethours command: /sethours [mode] 8-14,20-23
    this.bot.command('sethours', async (ctx) => {
      if (!this.isAdmin(ctx)) return;
      const args = (ctx.message.text || '').split(/\s+/).slice(1);
      if (args.length === 0) {
        return ctx.replyWithHTML('Usage: <code>/sethours [mode] hours</code>\nMode: main, onchain, swing, dz (default: main)\nHours: <code>8-14,20-23</code> or <code>off</code> for 24/7\nExamples:\n<code>/sethours 8-14,20-23</code>\n<code>/sethours dz 13-21</code>\n<code>/sethours swing off</code>');
      }
      const modeMap = {
        main: () => this.tradeExecutor,
        onchain: () => this.onchainTradeExecutor,
        oc: () => this.onchainTradeExecutor,
        swing: () => this.swingTradeExecutor,
        sw: () => this.swingTradeExecutor,
        dz: () => this.dzTradeExecutor,
      };
      let modeName = 'main', hoursStr;
      if (modeMap[args[0]?.toLowerCase()]) {
        modeName = args[0].toLowerCase();
        hoursStr = args[1];
      } else {
        hoursStr = args[0];
      }
      const executor = (modeMap[modeName] || (() => this.tradeExecutor))();
      if (!executor) return ctx.reply('Executor not available');
      if (hoursStr === 'off' || hoursStr === '24/7') {
        executor.tradingHours = [];
      } else {
        const parsed = hoursStr.split(',').map(r => {
          const [s, e] = r.split('-').map(Number);
          return (!isNaN(s) && !isNaN(e) && s >= 0 && s <= 23 && e >= 0 && e <= 23) ? [s, e] : null;
        }).filter(Boolean);
        if (parsed.length === 0) return ctx.reply('Invalid format. Use: 8-14,20-23');
        executor.tradingHours = parsed;
      }
      executor.saveConfig();
      const display = executor.tradingHours.length
        ? executor.tradingHours.map(([s,e]) => `${String(s).padStart(2,'0')}:00-${String(e).padStart(2,'0')}:00`).join(', ')
        : '24/7 (no restriction)';
      ctx.replyWithHTML(`Trading hours for <b>${modeName}</b> set to: <b>${display}</b> UTC`);
    });

    // ── BALANCE ──
    this.bot.action('cfg_balance', async (ctx) => {
      await ctx.answerCbQuery('Fetching balances...');
      const t = te();
      const balances = await t.getAllBalances();

      let balText = '';
      let totalBal = 0;
      for (const [id, b] of Object.entries(balances)) {
        const icon = b.error ? '❌' : '✅';
        balText += `${icon} <b>${id}</b>: $${b.total.toFixed(2)} total${b.free > 0 && b.free !== b.total ? ` ($${b.free.toFixed(2)} free)` : ''}${b.used > 0 ? ` ($${b.used.toFixed(2)} in use)` : ''}\n`;
        totalBal += b.total;
      }
      if (!Object.keys(balances).length) balText = '<i>No exchange API keys configured</i>\n';

      const paperBal = t.paperBalance;
      ctx.editMessageText(
        `💰 <b>ACCOUNT BALANCES</b>\n\n` +
        `<b>═══ Exchange Accounts ═══</b>\n${balText}\n` +
        `<b>═══ Paper Account ═══</b>\n` +
        `📝 Paper Balance: <b>$${paperBal.toFixed(2)}</b>\n\n` +
        `Active mode: <b>${t.mode.toUpperCase()}</b> ${t.mode === 'paper' ? `(using $${paperBal.toFixed(2)})` : `(using $${totalBal.toFixed(2)} across exchanges)`}\n` +
        `${t.riskPct > 0 ? `Risk sizing: ${t.riskPct}% = $${((t.mode === 'paper' ? paperBal : totalBal) * t.riskPct / 100).toFixed(2)}/trade` : `Fixed sizing: $${t.maxPositionSize}/trade`}\n\n` +
        `<i>⚠️ Binance futures min order: $5 notional\nBybit futures min order: $5 notional\nIf trade size too small for DCA, bot enters full position at once.\nLeverage auto-adjusts if token max is lower than your setting.</i>`,
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
          const pnlUsd = (pnlPct / 100) * (t.position_size || 0);
          totalPnl += pnlUsd;

          const icon = pnlPct > 0 ? '🟢' : pnlPct < -5 ? '🔴' : '🟡';
          const dir = isLong ? '⬆️' : '⬇️';
          const dca = t.dca_filled_3 ? '3/3' : t.dca_filled_2 ? '2/3' : '1/3';
          const tpHit = [t.hit_tp1 ? 'TP1✅' : '', t.hit_tp2 ? 'TP2✅' : '', t.hit_tp3 ? 'TP3✅' : ''].filter(Boolean).join(' ') || 'none';
          const _age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
          const _ageStr = _age < 60 ? `${_age}m` : _age < 1440 ? `${Math.round(_age / 60)}h` : `${Math.round(_age / 1440)}d`;
          const _d = new Date(t.created_at);
          const openTime = `${_d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][_d.getUTCMonth()]} ${String(_d.getUTCHours()).padStart(2,'0')}:${String(_d.getUTCMinutes()).padStart(2,'0')}`;

          msg += `${icon}${dir} <b>${t.symbol}</b> (${t.exchange}) · ${_ageStr} · ${openTime}\n`;
          msg += `Entry: $${t.entry_price.toPrecision(6)} → $${currentPrice ? currentPrice.toPrecision(6) : '?'}\n`;
          msg += `PnL: <b>${pnlLev >= 0 ? '+' : ''}${pnlLev.toFixed(1)}%</b> ($${pnlUsd.toFixed(2)}) | ${t.leverage}x\n`;
          msg += `DCA: ${dca} | TP: ${tpHit} | SL: $${t.stop_loss.toPrecision(6)}\n`;
          msg += `Size: $${(t.position_size || 0).toFixed(2)} | ${t.mode}\n\n`;
        }

        msg += `<b>Total unrealized PnL: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</b>`;

        const closeButtons = trades.reduce((rows, t, i) => {
          if (i % 3 === 0) rows.push([]);
          const pnlIcon = totalPnl >= 0 ? '' : '';
          rows[rows.length - 1].push(Markup.button.callback(`❌ ${t.symbol}`, `close_trade_${t.id}`));
          return rows;
        }, []);

        ctx.editMessageText(msg, {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            ...closeButtons,
            [Markup.button.callback('🛑 Close All', 'close_all_trades')],
            [Markup.button.callback('🔄 Refresh', 'cfg_trades')],
            [Markup.button.callback('⬅️ Settings', 'cfg_main')],
          ]).reply_markup,
        });
      } catch (e) {
        if (e.message?.includes('message is not modified')) return;
        logger.error(`Active trades panel error: ${e.message}`);
        ctx.editMessageText('❌ Failed to load trades.', {
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back', 'cfg_main')]]).reply_markup,
        });
      }
    });

    // ── CLOSE SINGLE TRADE ──
    this.bot.action(/^close_trade_(\d+)$/, async (ctx) => {
      const tradeId = parseInt(ctx.match[1]);
      await ctx.answerCbQuery(`Closing trade #${tradeId}...`);
      try {
        const result = await this.tradeExecutor.closeSingleTrade(tradeId);
        if (!result) {
          return ctx.answerCbQuery('Trade not found or already closed', { show_alert: true });
        }
        const { trade, pnlUsd } = result;
        const pnlSign = pnlUsd >= 0 ? '+' : '';
        await this.sendRaw(
          `✅ <b>MANUAL CLOSE</b> ${trade.symbol}\n\n` +
          `PnL: ${pnlUsd >= 0 ? '🟢' : '🔴'} ${pnlSign}$${pnlUsd.toFixed(2)}\n` +
          `Mode: ${trade.mode}`
        );
        await this.refreshTradesPanel(ctx);
      } catch (e) {
        logger.error(`Manual close error: ${e.message}`);
        ctx.answerCbQuery(`Failed: ${e.message}`, { show_alert: true });
      }
    });

    // ── CLOSE ALL TRADES ──
    this.bot.action('close_all_trades', async (ctx) => {
      await ctx.answerCbQuery('Closing all positions...');
      try {
        const count = await this.tradeExecutor.closeAllPositions();
        await this.sendRaw(`🛑 <b>ALL POSITIONS CLOSED</b>\n\n${count} trade(s) closed manually.`);
        await this.refreshTradesPanel(ctx);
      } catch (e) {
        logger.error(`Close all error: ${e.message}`);
        ctx.answerCbQuery(`Failed: ${e.message}`, { show_alert: true });
      }
    });

    // ── MAIN CIRCUIT BREAKER CONTROLS ──
    this.bot.action('cfg_cb', async (ctx) => {
      try {
        await ctx.answerCbQuery();
        const te = this.tradeExecutor;
        const cb = await te.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
        let text = '🛡️ <b>CIRCUIT BREAKER — Main</b>\n\n';
        text += `Status: ${cb.active ? `🚨 <b>PAUSED</b> — ${cb.minsLeft}m remaining (${cb.streak} losses)` : cb.enabled ? '✅ Armed' : '🔓 Disabled'}\n`;
        text += `Trigger: <b>${te.cbStreak} consecutive losses</b>\n`;
        text += `Pause: <b>${te.cbPauseMinutes} minutes</b>\n\n`;
        if (cb.active) text += '<i>Trading is paused. Override to resume immediately.</i>';
        else if (!cb.enabled) text += '<i>Circuit breaker is disabled — no pause on losing streaks.</i>';
        else text += '<i>Will auto-pause trading after consecutive losses.</i>';

        const buttons = [];
        if (cb.active) {
          buttons.push([Markup.button.callback('⏭️ Override — Resume Now', 'cfg_cb_override')]);
        }
        buttons.push([
          Markup.button.callback(`${te.cbEnabled ? '🔓 Disable' : '✅ Enable'}`, 'cfg_cb_toggle'),
        ]);
        buttons.push([
          Markup.button.callback('3 losses', 'cfg_cb_streak_3'),
          Markup.button.callback('4 losses', 'cfg_cb_streak_4'),
          Markup.button.callback('5 losses', 'cfg_cb_streak_5'),
        ]);
        buttons.push([
          Markup.button.callback('30m pause', 'cfg_cb_pause_30'),
          Markup.button.callback('60m', 'cfg_cb_pause_60'),
          Markup.button.callback('120m', 'cfg_cb_pause_120'),
        ]);
        buttons.push([Markup.button.callback('⬅️ Back', 'cfg_main')]);
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(buttons).reply_markup });
      } catch (e) { logger.error(`cfg_cb error: ${e.message}`); }
    });

    this.bot.action('cfg_cb_toggle', async (ctx) => {
      try {
        const te = this.tradeExecutor;
        te.cbEnabled = !te.cbEnabled;
        te.saveConfig();
        await ctx.answerCbQuery(`Circuit breaker ${te.cbEnabled ? 'enabled' : 'disabled'}`);
        await this.showSettingsMain(ctx);
      } catch (e) { logger.error(`cfg_cb_toggle error: ${e.message}`); }
    });

    this.bot.action('cfg_cb_override', async (ctx) => {
      try {
        const te = this.tradeExecutor;
        te.cbOverrideUntil = Date.now() + 4 * 60 * 60 * 1000;
        await ctx.answerCbQuery('Circuit breaker overridden — trading resumed');
        await this.showSettingsMain(ctx);
      } catch (e) { logger.error(`cfg_cb_override error: ${e.message}`); }
    });

    for (const n of [3, 4, 5]) {
      this.bot.action(`cfg_cb_streak_${n}`, async (ctx) => {
        try {
          this.tradeExecutor.cbStreak = n; this.tradeExecutor.saveConfig();
          await ctx.answerCbQuery(`CB triggers after ${n} losses`);
          await this.showSettingsMain(ctx);
        } catch (e) { logger.error(`cfg_cb_streak error: ${e.message}`); }
      });
    }
    for (const m of [30, 60, 120]) {
      this.bot.action(`cfg_cb_pause_${m}`, async (ctx) => {
        try {
          this.tradeExecutor.cbPauseMinutes = m; this.tradeExecutor.saveConfig();
          await ctx.answerCbQuery(`CB pause: ${m} minutes`);
          await this.showSettingsMain(ctx);
        } catch (e) { logger.error(`cfg_cb_pause error: ${e.message}`); }
      });
    }
  }

  async refreshTradesPanel(ctx) {
    try {
      ctx.editMessageText(
        `📋 <b>ACTIVE TRADES</b>\n\n<i>Updated. Tap Refresh to reload.</i>`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'cfg_trades')],
          [Markup.button.callback('⬅️ Settings', 'cfg_main')],
        ]).reply_markup }
      );
    } catch (e) { /* ignore */ }
  }

  // Render the main settings panel
  async showSettingsMain(ctx, isNewMessage = false) {
    const t = this.tradeExecutor;
    await t.recalcDailyPnL();
    const [paperPnl, livePnl, paperToday, liveToday] = await Promise.all([
      db.getAllTimePnL(t.pnlResetDate || null, 'paper').catch(() => 0),
      db.getAllTimePnL(t.pnlResetDate || null, 'live').catch(() => 0),
      db.getTodayPnL('paper').catch(() => 0),
      db.getTodayPnL('live').catch(() => 0),
    ]);
    const balance = await t.getBalance();
    const sizeDisplay = t.riskPct > 0
      ? `${t.riskPct}% ($${(balance * t.riskPct / 100).toFixed(2)})`
      : `$${t.maxPositionSize}`;
    const filterDisplay = t.signalFilter.size > 0 ? [...t.signalFilter].join(', ') : 'All';

    // Always fetch live balances
    const liveBalances = await t.getAllBalances();
    let totalFree = 0;
    const parts = [];
    for (const [id, b] of Object.entries(liveBalances)) {
      const display = b.total > 0 ? b.total : b.free;
      if (!b.error) parts.push(`${id}: $${display.toFixed(2)}`);
      totalFree += display;
    }
    const liveBalLine = parts.length ? parts.join(' | ') : 'No API keys';

    let balLine = '';
    if (t.mode === 'paper') {
      balLine = `📝 Paper: <b>$${t.paperBalance.toFixed(2)}</b>\n💰 Live: ${liveBalLine}`;
    } else {
      balLine = `💰 Live: <b>$${totalFree.toFixed(2)}</b> (${liveBalLine})\n📝 Paper: $${t.paperBalance.toFixed(2)}`;
    }

    const text =
      `⚙️ <b>TRADING SETTINGS</b>\n\n` +
      `${t.mode === 'paper' ? '📝' : '💰'} Mode: <b>${t.mode.toUpperCase()}</b> | ${t.enabled ? '✅ ON' : '❌ OFF'}\n` +
      `${balLine}\n` +
      `💵 Size: <b>${sizeDisplay}</b>/trade\n` +
      `⚡ Leverage: <b>${t.defaultLeverage}x</b>${t.dynamicLeverage ? ' (dynamic)' : ''}\n` +
      `🛡️ Daily Loss: <b>$${t.maxDailyLoss}</b> | Per-Trade: <b>${t.maxLossPerTrade > 0 ? `$${t.maxLossPerTrade}` : 'Off'}</b>\n` +
      `📐 Risk-Fit: <b>${t.riskFitSizing ? 'ON' : 'OFF'}</b>${t.riskFitSizing ? ' (shrinks size to cap loss)' : ' (full size)'}\n` +
      `📊 Max Positions: <b>${t.maxConcurrentPositions}</b>\n` +
      `⭐ Min Confidence: <b>${t.minConfidence}/5</b>\n` +
      `🔍 Filter: <b>${filterDisplay}</b>\n` +
      `📈 Today: 📝 <b>${paperToday >= 0 ? '+' : ''}$${paperToday.toFixed(2)}</b> | 💰 <b>${liveToday >= 0 ? '+' : ''}$${liveToday.toFixed(2)}</b>\n` +
      `📊 Total: 📝 <b>${paperPnl >= 0 ? '+' : ''}$${paperPnl.toFixed(2)}</b> | 💰 <b>${livePnl >= 0 ? '+' : ''}$${livePnl.toFixed(2)}</b>\n` +
      `${t.excludedSymbols?.size ? `🚫 Excluded: <b>${[...t.excludedSymbols].join(', ')}</b>\n` : ''}` +
      `\n${this.getRiskAdvisory(t, totalFree)}\n` +
      `Tap any button below to configure:`;

    const openTrades = await db.getOpenTrades().catch(() => []);
    const cbStatus = await t.getCircuitBreakerStatus().catch(() => ({ active: false, enabled: true }));
    const cbBtnLabel = cbStatus.active ? `🚨 CB: PAUSED ${cbStatus.minsLeft}m`
      : !cbStatus.enabled ? '🔓 CB: OFF' : '🛡️ CB: ON';

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`${t.mode === 'paper' ? '📝' : '🔴'} Mode: ${t.mode.toUpperCase()}`, 'cfg_mode'),
       Markup.button.callback(`${t.enabled ? '✅ Trading ON' : '⛔ Trading OFF'}`, 'cfg_toggle')],
      [Markup.button.callback(`💵 Size: $${t.maxPositionSize}`, 'cfg_size'),
       Markup.button.callback(`📊 Risk: ${t.riskPct > 0 ? `${t.riskPct}%` : 'OFF'}`, 'cfg_risk')],
      [Markup.button.callback(`⚡ Leverage: ${t.defaultLeverage}x`, 'cfg_lev'),
       Markup.button.callback(`💰 Balance`, 'cfg_balance')],
      [Markup.button.callback(`🛡️ Daily Loss: $${t.maxDailyLoss}`, 'cfg_dailyloss'),
       Markup.button.callback(`🔒 Trade Cap: ${t.maxLossPerTrade > 0 ? `$${t.maxLossPerTrade}` : 'Off'}`, 'cfg_tradeloss')],
      [Markup.button.callback(`📊 Positions: ${t.maxConcurrentPositions}`, 'cfg_maxpos'),
       Markup.button.callback(`⭐ Confidence: ${t.minConfidence}/5`, 'cfg_conf')],
      [Markup.button.callback(`🔍 Signal Filter`, 'cfg_filter'),
       Markup.button.callback(`🚫 Excluded (${t.excludedSymbols?.size || 0})`, 'cfg_exclude')],
      [Markup.button.callback(`📐 Risk-Fit: ${t.riskFitSizing ? 'ON' : 'OFF'}`, 'cfg_riskfit'),
       Markup.button.callback(`🏦 Exchanges${t.disabledExchanges?.size ? ` (${t.disabledExchanges.size} off)` : ''}`, 'cfg_exchanges')],
      [Markup.button.callback(`🕐 Hours: ${t.tradingHours?.length ? t.tradingHours.length + ' windows' : '24/7'}`, 'cfg_hours'),
       Markup.button.callback(cbBtnLabel, 'cfg_cb')],
      [Markup.button.callback(`📋 Trades (${openTrades.length})`, 'cfg_trades'),
       Markup.button.callback('🔄 Refresh', 'cfg_main')],
      [Markup.button.callback('⬅️ Panel', 'panel_main'),
       Markup.button.callback('🛑 Kill Switch', 'action_stop')],
    ]);

    if (isNewMessage) {
      await ctx.replyWithHTML(text, keyboard);
    } else {
      await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
    }
  }

  getRiskAdvisory(t, balance) {
    const tips = [];
    const size = t.maxPositionSize;
    const lev = t.defaultLeverage;
    const cap = t.maxLossPerTrade;
    // Check if max loss cap is set
    if (!cap || cap <= 0) {
      tips.push('⚠️ No per-trade loss cap — set one to protect against big drops');
    }

    // Check reward:risk ratio — TP1 partial (33%) vs max loss
    if (cap > 0) {
      const typicalTP1Pct = 7;
      const tp1Profit = (typicalTP1Pct / 100) * (size * 0.33);
      const ratio = tp1Profit / cap;
      if (ratio < 0.5) {
        tips.push(`📐 Low R:R — TP1 earns ~$${tp1Profit.toFixed(2)} vs $${cap} risk (${ratio.toFixed(1)}:1). Increase leverage or size`);
      }
      const roomPct = (cap / size) * 100;
      if (roomPct < 1.5) {
        tips.push(`🔒 Loss cap too tight — only ${roomPct.toFixed(1)}% room, most trades will hit it. Increase cap or reduce size`);
      }
    }

    // Check if leverage is too low for the size
    if (lev < 10 && size <= 15) {
      tips.push(`⚡ Low leverage (${lev}x) with small size ($${size}) — wins too small to cover losses. Try 10x`);
    }

    // Check balance vs position size
    if (balance > 0) {
      const marginNeeded = size / lev;
      const maxPositions = t.maxConcurrentPositions;
      const totalMargin = marginNeeded * maxPositions;
      if (totalMargin > balance * 0.9) {
        tips.push(`💰 Tight balance — ${maxPositions} positions need ~$${totalMargin.toFixed(0)} margin, you have $${balance.toFixed(0)}`);
      }
      // Risk per trade vs balance
      if (cap > 0 && cap > balance * 0.1) {
        tips.push(`🎯 Risk per trade ($${cap}) is ${(cap / balance * 100).toFixed(0)}% of balance — keep under 5-10%`);
      }
    }

    // Check daily loss vs balance
    if (balance > 0 && t.maxDailyLoss > balance * 0.3) {
      tips.push(`🛡️ Daily loss limit ($${t.maxDailyLoss}) is ${(t.maxDailyLoss / balance * 100).toFixed(0)}% of balance — consider lowering`);
    }

    if (tips.length === 0) {
      return '✅ <i>Risk settings look good</i>\n';
    }
    return `💡 <b>Risk Notes:</b>\n${tips.map(t => `  ${t}`).join('\n')}\n`;
  }

  // Render the signal filter panel
  async showFilterPanel(ctx) {
    const t = this.tradeExecutor;
    const types = ['BREAKOUT', 'VOLUME_SPIKE', 'LISTING', 'FUNDING_SHORT', 'ZONE_ENTRY'];
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

  async showExcludePanel(ctx) {
    const t = this.tradeExecutor;
    const commonTokens = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX'];
    const noExclusions = !t.excludedSymbols || t.excludedSymbols.size === 0;

    let desc = `🚫 <b>EXCLUDED TOKENS</b>\n\n`;
    desc += noExclusions
      ? `No tokens excluded — bot trades <b>all</b> tokens.\n\n`
      : `Excluded: <b>${[...t.excludedSymbols].join(', ')}</b>\n\n`;
    desc += `Toggle tokens to exclude from auto-trading.\n`;
    desc += `Large caps like BTC/ETH move slower and need different strategies.\n\n`;
    desc += `<i>Tap to toggle. Excluded tokens won't trigger trades.</i>`;

    ctx.editMessageText(desc, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        ...commonTokens.reduce((rows, token, i) => {
          if (i % 4 === 0) rows.push([]);
          const excluded = t.excludedSymbols?.has(token);
          rows[rows.length - 1].push(Markup.button.callback(
            `${excluded ? '🚫' : '✅'} ${token}`, `cfg_excl_${token}`
          ));
          return rows;
        }, []),
        [Markup.button.callback(noExclusions ? '🚫 Exclude All Above' : '✅ Clear All', 'cfg_excl_clear')],
        [Markup.button.callback('⬅️ Back', 'cfg_main')],
      ]).reply_markup,
    });
  }

  async showExchangesPanel(ctx) {
    const t = this.tradeExecutor;
    const exchanges = ['binance', 'bybit'];
    let desc = `🏦 <b>EXCHANGE TOGGLE</b>\n\n`;
    desc += `Enable/disable exchanges for auto-trading.\n`;
    desc += `Disabled exchanges won't receive new trades.\n\n`;
    for (const ex of exchanges) {
      const disabled = t.disabledExchanges?.has(ex);
      const hasKey = !!(this.tradeExecutor.exchanges[ex]?.apiKey);
      desc += `${disabled ? '❌' : '✅'} <b>${ex}</b>${hasKey ? '' : ' (no API key)'}\n`;
    }

    ctx.editMessageText(desc, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        exchanges.map(ex => {
          const disabled = t.disabledExchanges?.has(ex);
          return Markup.button.callback(`${disabled ? '❌' : '✅'} ${ex}`, `cfg_ex_${ex}`);
        }),
        [Markup.button.callback('⬅️ Back', 'cfg_main')],
      ]).reply_markup,
    });
  }

  async sendSignal(signal) {
    // Fan out: channel + every approved user's DM + virtual paper accounts
    try {
      // Generate chart snapshot
      let chartBuf = null;
      try {
        const exchange = this.tradeExecutor.exchanges[signal.exchange];
        if (exchange) {
          const pair = signal.pair || `${signal.symbol}/USDT:USDT`;
          const ohlcv = await exchange.fetchOHLCV(pair, '1h', undefined, 60);
          if (ohlcv && ohlcv.length >= 10) {
            chartBuf = generateSignalChart(ohlcv, signal);
          }
        }
      } catch (e) {
        logger.debug(`Chart generation skipped: ${e.message}`);
      }

      const msgText = formatSignalMessage(signal);
      const sendToChat = async (chatId) => {
        if (chartBuf) {
          try {
            await this.bot.telegram.sendPhoto(chatId, { source: chartBuf }, {
              caption: msgText.length <= 1024 ? msgText : `🎯 ${signal.symbol} ${signal.direction.toUpperCase()} — Score ${signal.score}`,
              parse_mode: 'HTML',
            });
            if (msgText.length > 1024) {
              await this.bot.telegram.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
            }
          } catch (photoErr) {
            logger.debug(`Photo send failed, falling back to text: ${photoErr.message}`);
            await this.bot.telegram.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
          }
        } else {
          await this.bot.telegram.sendMessage(chatId, msgText, { parse_mode: 'HTML' });
        }
      };

      if (this.channelId) {
        await sendToChat(this.channelId);
      }
      logger.info(`Signal sent: ${signal.type} ${signal.symbol}`);

      // Open virtual paper trades for followers
      if (this.userPaperEngine) {
        await this.userPaperEngine.openForFollowers(signal);
      }

      // DM all active users
      const users = await db.getActiveUsers();
      for (const u of users) {
        try {
          await sendToChat(u.telegram_id);
        } catch (e) {
          if (!String(e.message).includes('blocked')) logger.debug(`DM to ${u.telegram_id}: ${e.message}`);
        }
      }
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

  formatFlowResult(symbol, flow, contract) {
    const arrow = flow.bias === 'bullish' ? '🟢' : flow.bias === 'bearish' ? '🔴' : '🔄';
    let msg = `🏦 <b>EXCHANGE FLOW — $${symbol}</b>\n\n`;
    msg += `${arrow} <b>Bias: ${flow.bias.toUpperCase()}</b>\n`;
    msg += `📤 Withdrawals (outflow): ${flow.outflowCount}\n`;
    msg += `📥 Deposits (inflow): ${flow.inflowCount}\n`;
    if (flow.exchanges.length) msg += `🏛 Exchanges: ${flow.exchanges.join(', ')}\n`;
    msg += `📊 Total transfers scanned: ${flow.totalTxs}\n`;
    msg += `⛓ Chain: ${contract.chain}\n\n`;

    if (flow.outflowCount > flow.inflowCount && flow.outflowCount >= 3) {
      msg += '🟢 <b>ACCUMULATION DETECTED</b>\n';
      msg += '<i>More tokens leaving exchanges than entering. Smart money is withdrawing to cold storage — reducing sell-side supply. This is the leading indicator before major moves.</i>\n';
    } else if (flow.inflowCount > flow.outflowCount && flow.inflowCount >= 3) {
      msg += '🔴 <b>DISTRIBUTION WARNING</b>\n';
      msg += '<i>More tokens entering exchanges than leaving. Holders may be preparing to sell. Exercise caution on long positions.</i>\n';
    } else {
      msg += '🔄 <b>BALANCED FLOW</b>\n';
      msg += '<i>Roughly equal inflow and outflow — no strong directional signal.</i>\n';
    }

    msg += `\n<i>Contract: ${contract.address.slice(0, 20)}...</i>`;
    return msg;
  }

  async sendWhaleAlert(alert) {
    if (!this.channelId) return;
    try {
      const msg = alert.type === 'arkham_flow'
        ? this.onchainTracker.formatArkhamAlert(alert)
        : formatWhaleAlert(alert);
      if (msg) await this.bot.telegram.sendMessage(this.channelId, msg, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error(`Failed to send whale alert: ${err.message}`);
    }
  }

  async sendRaw(message) {
    if (!this.channelId) return;
    try {
      if (message.length > 4000) {
        const parts = [];
        let remaining = message;
        while (remaining.length > 0) {
          if (remaining.length <= 4000) { parts.push(remaining); break; }
          let cut = remaining.lastIndexOf('\n', 4000);
          if (cut < 2000) cut = 4000;
          parts.push(remaining.slice(0, cut));
          remaining = remaining.slice(cut);
        }
        for (const part of parts) {
          await this.bot.telegram.sendMessage(this.channelId, part, { parse_mode: 'HTML' });
        }
      } else {
        await this.bot.telegram.sendMessage(this.channelId, message, { parse_mode: 'HTML' });
      }
    } catch (err) {
      logger.error(`Failed to send message: ${err.message}`);
    }
  }

  async sendRawPhoto(photoBuf, caption) {
    if (!this.channelId) return;
    try {
      await this.bot.telegram.sendPhoto(this.channelId, { source: photoBuf }, {
        caption: caption && caption.length <= 1024 ? caption : undefined,
        parse_mode: 'HTML',
      });
    } catch (err) {
      logger.error(`Failed to send photo: ${err.message}`);
    }
  }

  async broadcastToUsers(message) {
    try {
      const users = await db.getActiveUsers();
      for (const u of users) {
        try {
          await this.bot.telegram.sendMessage(u.telegram_id, message, { parse_mode: 'HTML' });
        } catch (e) {
          if (!String(e.message).includes('blocked')) logger.debug(`Broadcast DM ${u.telegram_id}: ${e.message}`);
        }
      }
    } catch (e) { logger.error(`broadcastToUsers: ${e.message}`); }
  }

  async broadcastPhotoToUsers(photoBuf, caption) {
    try {
      const users = await db.getActiveUsers();
      for (const u of users) {
        try {
          await this.bot.telegram.sendPhoto(u.telegram_id, { source: photoBuf }, {
            caption: caption && caption.length <= 1024 ? caption : undefined,
            parse_mode: 'HTML',
          });
        } catch (e) {
          if (!String(e.message).includes('blocked')) logger.debug(`Broadcast photo DM ${u.telegram_id}: ${e.message}`);
        }
      }
    } catch (e) { logger.error(`broadcastPhotoToUsers: ${e.message}`); }
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
      { command: 'alertperf', description: 'Onchain/flow alert P&L tracker' },
      { command: 'onchaintrade', description: 'Onchain auto-trade status & control' },
      { command: 'onchainsize', description: 'Set onchain position size' },
      { command: 'onchainlev', description: 'Set onchain leverage' },
      { command: 'onchainloss', description: 'Set onchain daily loss limit' },
      { command: 'onchainmaxloss', description: 'Set onchain max loss per trade' },
      { command: 'onchainpositions', description: 'Set onchain max positions' },
      { command: 'onchainminscore', description: 'Set min onchain score (30-100)' },
      { command: 'onchainsettings', description: 'Onchain settings panel' },
      { command: 'onchainstats', description: 'Onchain trading P&L stats' },
      { command: 'onchainopen', description: 'View open onchain positions' },
      { command: 'onchainclose', description: 'Close onchain position by symbol' },
      { command: 'onchainstop', description: 'Close all onchain positions' },
      { command: 'guide', description: 'How to start paper trading' },
      { command: 'follow', description: 'Auto-paper every signal' },
      { command: 'unfollow', description: 'Stop auto-papering' },
      { command: 'buy', description: 'Open manual paper long' },
      { command: 'sell', description: 'Open manual paper short' },
      { command: 'closetrade', description: 'Close a paper position' },
      { command: 'mypositions', description: 'Your open paper positions' },
      { command: 'mypaper', description: 'Your paper portfolio overview' },
      { command: 'mypnl', description: 'Your paper P&L history' },
      { command: 'setmysize', description: 'Set your paper margin size' },
      { command: 'setmyleverage', description: 'Set your paper leverage' },
      { command: 'onchainfollow', description: 'Auto-paper onchain signals' },
      { command: 'onchainunfollow', description: 'Stop onchain auto-paper' },
      { command: 'setmyscore', description: 'Set min onchain score' },
      { command: 'setmyloss', description: 'Set daily loss limit' },
      { command: 'setmymaxloss', description: 'Set per-trade max loss' },
      { command: 'setmypositions', description: 'Set max concurrent positions' },
      { command: 'myonchain', description: 'Your open onchain positions' },
      { command: 'myonchainstats', description: 'Onchain paper P&L stats' },
      { command: 'mysettings', description: 'View all your settings' },
      { command: 'dzopen', description: 'Open demand zone paper trades' },
      { command: 'dzperf', description: 'Demand zone performance stats' },
      { command: 'dzstats', description: 'Demand zone quick P&L' },
      { command: 'dzclose', description: 'Close a DZ paper trade' },
      { command: 'panel', description: 'Trading control panel' },
      { command: 'swingsettings', description: 'Swing trade settings' },
      { command: 'dzsettings', description: 'Demand zone settings' },
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
