const { Telegraf, Markup } = require('telegraf');
const logger = require('../utils/logger');
const config = require('../utils/config');
const db = require('../db/database');
const { formatSignalMessage, formatListingAlert, formatWhaleAlert, formatScanResult, escapeHtml } = require('../utils/formatting');
const { generateSignalChart } = require('../utils/chartGenerator');

class TelegramBot {
  constructor({ technicalScanner, socialScanner, onchainTracker, marketIntel, tradeExecutor }) {
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
    this.marketIntel = marketIntel;
    this.tradeExecutor = tradeExecutor;
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
      'setpositions', 'setconfidence', 'risk', 'dynlev', 'filter', 'balance',
      'settings', 'users', 'grant', 'revoke',
    ]);
    const ADMIN_ACTIONS = /^cfg_/;
    const PUBLIC_COMMANDS = new Set([
      'start', 'menu', 'help', 'guide', 'signals', 'scan', 'trending', 'funding', 'stats',
      'intel', 'dex', 'whale', 'review', 'analyse', 'positions', 'pnl',
      'follow', 'unfollow', 'mypaper', 'myaccess',
      'setmysize', 'setmyleverage', 'buy', 'sell', 'closetrade', 'mypositions', 'mypnl',
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
        (isAdmin
          ? `<b>👑 Admin — Trading Control:</b>\n` +
            `/trade — Trading status &amp; config\n` +
            `/settings — Interactive settings panel\n` +
            `/positions — Open positions\n` +
            `/pnl — Trade P&amp;L\n` +
            `/trademode paper|live — Switch mode\n` +
            `/stop — Kill switch (close all)\n` +
            `/users /grant &lt;id&gt; /revoke &lt;id&gt; — Access control\n\n`
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
        const open = await db.getOpenUserTrades(uid);
        const size = parseFloat(user.paper_size) || 100;
        const lev = parseInt(user.paper_leverage) || 20;
        let msg = `📊 <b>Your Paper Portfolio</b>\n\n` +
          `⚙️ Size: $${size} | Leverage: ${lev}x | Notional: $${(size * lev).toFixed(0)}\n\n` +
          `Closed: ${stats.closed} | Wins: ${stats.wins}\n` +
          `Total P&L: <b>$${parseFloat(stats.total_pnl).toFixed(2)}</b>\n` +
          `Avg trade: ${parseFloat(stats.avg_pnl_pct).toFixed(2)}%\n`;
        if (open.length) {
          msg += `\n<b>Open (${open.length}):</b>\n`;
          for (const t of open.slice(0, 10)) {
            const entry = parseFloat(t.entry_price);
            const realized = parseFloat(t.realized_pnl_usd || 0);
            const tps = [t.hit_tp1 ? 'TP1' : '', t.hit_tp2 ? 'TP2' : '', t.hit_tp3 ? 'TP3' : ''].filter(Boolean).join(',');
            const pnlStr = realized > 0 ? ` | banked $${realized.toFixed(2)}` : '';
            const src = t.source === 'manual' ? ' 🔧' : '';
            msg += `${t.direction === 'long' ? '🟢' : '🔴'} $${escapeHtml(t.symbol)} @ $${entry.toPrecision(6)}${pnlStr}${tps ? ` | ${tps}` : ''}${src}\n`;
          }
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
        const result = await this.userPaperEngine.closeManualTrade(ctx.state.user.telegram_id, symbol);
        const emoji = result.pnlUsd >= 0 ? '✅' : '❌';
        ctx.replyWithHTML(
          `${emoji} <b>Position closed</b> — $${escapeHtml(symbol)}\n\n` +
          `${result.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'}\n` +
          `Entry: $${result.entry.toPrecision(6)} → Exit: $${result.exit.toPrecision(6)}\n` +
          `P&L: <b>$${result.pnlUsd.toFixed(2)}</b> (${result.pnlPct.toFixed(2)}%)`
        );
      } catch (e) {
        ctx.replyWithHTML(`⚠️ ${escapeHtml(e.message)}`);
      }
    });

    this.bot.command('mypositions', async (ctx) => {
      try {
        if (!this.userPaperEngine) return ctx.replyWithHTML('⚠️ Paper engine not ready.');
        const uid = ctx.state.user.telegram_id;
        const open = await db.getOpenUserTrades(uid);
        if (!open.length) return ctx.replyWithHTML('📭 No open positions.\n\nUse /buy <SYMBOL> or /follow to start trading.');

        let msg = `📈 <b>Your Open Positions (${open.length})</b>\n\n`;
        for (const t of open.slice(0, 15)) {
          const entry = parseFloat(t.entry_price);
          const posSize = parseFloat(t.position_size);
          const realized = parseFloat(t.realized_pnl_usd || 0);
          const tps = [t.hit_tp1 ? '✅TP1' : '', t.hit_tp2 ? '✅TP2' : '', t.hit_tp3 ? '✅TP3' : ''].filter(Boolean).join(' ');
          const src = t.source === 'manual' ? '🔧' : '📡';
          const age = Math.round((Date.now() - new Date(t.created_at).getTime()) / 60000);
          const ageStr = age < 60 ? `${age}m` : `${Math.round(age / 60)}h`;

          msg += `${t.direction === 'long' ? '🟢' : '🔴'} <b>$${escapeHtml(t.symbol)}</b> ${src}\n`;
          msg += `  Entry: $${entry.toPrecision(6)} | Size: $${posSize.toFixed(0)} | ${ageStr}\n`;
          msg += `  SL: $${parseFloat(t.stop_loss).toPrecision(6)}`;
          if (realized > 0) msg += ` | Banked: $${realized.toFixed(2)}`;
          if (tps) msg += ` | ${tps}`;
          msg += `\n\n`;
        }
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
    const exchangeIds = ['binance', 'bybit', 'mexc'];
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

          msg += `${icon}${dir} <b>${t.symbol}</b> (${t.exchange})\n`;
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
      `📊 Max Positions: <b>${t.maxConcurrentPositions}</b>\n` +
      `⭐ Min Confidence: <b>${t.minConfidence}/5</b>\n` +
      `🔍 Filter: <b>${filterDisplay}</b>\n` +
      `📈 Today: 📝 <b>${paperToday >= 0 ? '+' : ''}$${paperToday.toFixed(2)}</b> | 💰 <b>${liveToday >= 0 ? '+' : ''}$${liveToday.toFixed(2)}</b>\n` +
      `📊 Total: 📝 <b>${paperPnl >= 0 ? '+' : ''}$${paperPnl.toFixed(2)}</b> | 💰 <b>${livePnl >= 0 ? '+' : ''}$${livePnl.toFixed(2)}</b>\n` +
      `${t.excludedSymbols?.size ? `🚫 Excluded: <b>${[...t.excludedSymbols].join(', ')}</b>\n` : ''}` +
      `\n${this.getRiskAdvisory(t, totalFree)}\n` +
      `Tap any button below to configure:`;

    const openTrades = await db.getOpenTrades().catch(() => []);

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
      [Markup.button.callback(`🏦 Exchanges${t.disabledExchanges?.size ? ` (${t.disabledExchanges.size} off)` : ''}`, 'cfg_exchanges')],
      [Markup.button.callback(`📋 Trades (${openTrades.length})`, 'cfg_trades'),
       Markup.button.callback('🔄 Refresh', 'cfg_main')],
      [Markup.button.callback('🛑 Kill Switch', 'action_stop')],
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
    const exchanges = ['binance', 'bybit', 'mexc'];
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
