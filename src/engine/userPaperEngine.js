const logger = require('../utils/logger');
const db = require('../db/database');
const { ATR } = require('technicalindicators');
const { escapeHtml } = require('../utils/formatting');

class UserPaperEngine {
  constructor(exchanges, bot) {
    this.exchanges = exchanges;
    this.bot = bot;
    this.pendingEntries = new Map();
  }

  async notify(telegramId, msg) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendMessage(telegramId, msg, { parse_mode: 'HTML' });
    } catch (e) {
      logger.debug(`User notify ${telegramId}: ${e.message}`);
    }
  }

  async getBalance(telegramId) {
    try {
      const user = await db.getUser(telegramId);
      return parseFloat(user?.paper_balance) || 1000;
    } catch (e) { return null; }
  }

  balanceTag(bal) {
    if (bal == null) return '';
    const emoji = bal >= 500 ? '💰' : bal >= 100 ? '⚠️' : '🔴';
    return `\n${emoji} Balance: <b>$${bal.toFixed(2)}</b>`;
  }

  async openForFollowers(signal) {
    try {
      const followers = await db.getFollowers();
      for (const user of followers) {
        try {
          await this._queueEntry(user.telegram_id, {
            signalId: signal.id || null,
            symbol: signal.symbol,
            exchange: signal.exchange,
            direction: signal.direction,
            currentPrice: signal.currentPrice,
            tp1: signal.tp1, tp2: signal.tp2, tp3: signal.tp3,
            stopLoss: signal.stopLoss,
            atr: signal.atr || Math.abs(signal.stopLoss - signal.currentPrice) / 3,
          }, 'signal', user);
        } catch (e) {
          logger.warn(`User paper queue failed for ${user.telegram_id}: ${e.message}`);
        }
      }
      if (followers.length) logger.info(`User paper entries queued for ${followers.length} follower(s): ${signal.symbol}`);
    } catch (e) {
      logger.error(`openForFollowers failed: ${e.message}`);
    }
  }

  async openForOnchainFollowers(setup, score) {
    try {
      const followers = await db.getOnchainFollowers();
      let queued = 0;
      for (const user of followers) {
        try {
          const minScore = parseInt(user.onchain_min_score) || 45;
          if (score < minScore) continue;

          const maxPos = parseInt(user.max_positions) || 5;
          const openTrades = await db.getOpenUserTrades(user.telegram_id);
          if (openTrades.length >= maxPos) continue;
          if (openTrades.find(t => t.symbol === setup.symbol)) continue;

          const dailyLossLimit = parseFloat(user.daily_loss_limit) || 100;
          const dailyPnl = await db.getUserDailyPnL(user.telegram_id);
          if (dailyPnl <= -dailyLossLimit) continue;

          await this._queueEntry(user.telegram_id, {
            symbol: setup.symbol,
            exchange: setup.exchange,
            direction: setup.direction,
            currentPrice: setup.currentPrice,
            tp1: setup.tp1, tp2: setup.tp2, tp3: setup.tp3,
            stopLoss: setup.stopLoss,
            invalidation: setup.invalidation,
            atr: setup.atr || Math.abs(setup.stopLoss - setup.currentPrice) / 3,
            onchainContext: setup.onchainContext || null,
          }, 'onchain', user);
          queued++;
        } catch (e) {
          logger.warn(`User onchain paper queue failed for ${user.telegram_id}: ${e.message}`);
        }
      }
      if (queued) logger.info(`Onchain paper entries queued for ${queued} user(s): ${setup.symbol}`);
    } catch (e) {
      logger.error(`openForOnchainFollowers failed: ${e.message}`);
    }
  }

  async openForSwingFollowers(setup, score) {
    try {
      const followers = await db.getSwingFollowers();
      let queued = 0;
      for (const user of followers) {
        try {
          const minScore = parseInt(user.swing_min_score) || 60;
          if (score < minScore) continue;

          const maxPos = parseInt(user.max_positions) || 5;
          const openTrades = await db.getOpenUserTrades(user.telegram_id);
          if (openTrades.length >= maxPos) continue;
          if (openTrades.find(t => t.symbol === setup.symbol)) continue;

          const dailyLossLimit = parseFloat(user.daily_loss_limit) || 100;
          const dailyPnl = await db.getUserDailyPnL(user.telegram_id);
          if (dailyPnl <= -dailyLossLimit) continue;

          await this._queueEntry(user.telegram_id, {
            symbol: setup.symbol,
            exchange: setup.exchange,
            direction: setup.direction,
            currentPrice: setup.currentPrice,
            tp1: setup.tp1, tp2: setup.tp2, tp3: setup.tp3,
            stopLoss: setup.stopLoss,
            invalidation: setup.stopLoss,
            atr: setup.atr || Math.abs(setup.stopLoss - setup.currentPrice) / 3,
            onchainContext: setup.onchainContext || null,
          }, 'swing', user);
          queued++;
        } catch (e) {
          logger.warn(`User swing paper queue failed for ${user.telegram_id}: ${e.message}`);
        }
      }
      if (queued) logger.info(`Swing paper entries queued for ${queued} user(s): ${setup.symbol}`);
    } catch (e) {
      logger.error(`openForSwingFollowers failed: ${e.message}`);
    }
  }

  async _queueEntry(telegramId, setup, source, user) {
    const key = `${telegramId}_${setup.symbol}`;
    if (this.pendingEntries.has(key)) return;

    // Check cooldown from recent closed user trades
    try {
      const { rows: lastTrades } = await db.query(
        `SELECT direction, closed_at, close_reason, pnl_usd FROM user_paper_trades WHERE telegram_id = $1 AND symbol = $2 AND status = 'closed' ORDER BY closed_at DESC LIMIT 1`,
        [telegramId, setup.symbol]
      );
      if (lastTrades.length) {
        const closedAt = new Date(lastTrades[0].closed_at).getTime();
        const pnl = parseFloat(lastTrades[0].pnl_usd) || 0;
        const lossReasons = ['max_loss', 'invalidated', 'thesis_broken', 'time_exit'];
        const wasLoss = lossReasons.includes(lastTrades[0].close_reason)
          || (lastTrades[0].close_reason === 'sl' && pnl < -0.01)
          || pnl < -0.01;
        const isFlip = lastTrades[0].direction !== setup.direction;
        let cooldownMs;
        if (wasLoss) cooldownMs = 4 * 60 * 60 * 1000;
        else if (isFlip) cooldownMs = 2 * 60 * 60 * 1000;
        else cooldownMs = 1 * 60 * 60 * 1000;
        if (Date.now() < closedAt + cooldownMs) return;
      }
    } catch (e) { /* proceed */ }

    // Find demand/supply zone from recent 5m candles
    let demandZone = null;
    try {
      const exchange = this.exchanges[setup.exchange];
      if (exchange) {
        const pair = [`${setup.symbol}/USDT:USDT`, `${setup.symbol}/USDT`].find(p => exchange.markets?.[p]);
        if (pair) {
          const candles = await exchange.fetchOHLCV(pair, '5m', undefined, 30);
          if (candles?.length >= 5) {
            const completed = candles.slice(0, -1);
            const isLong = setup.direction === 'long';
            const price = setup.currentPrice;
            const sl = setup.stopLoss;
            if (isLong) {
              const swingLows = [];
              for (let i = 1; i < completed.length - 1; i++) {
                if (completed[i][3] < completed[i - 1][3] && completed[i][3] < completed[i + 1][3]) {
                  const lvl = completed[i][3];
                  if (lvl < price && lvl > sl) swingLows.push(lvl);
                }
              }
              demandZone = swingLows.length ? Math.max(...swingLows) : price - (price - sl) * 0.4;
            } else {
              const swingHighs = [];
              for (let i = 1; i < completed.length - 1; i++) {
                if (completed[i][2] > completed[i - 1][2] && completed[i][2] > completed[i + 1][2]) {
                  const lvl = completed[i][2];
                  if (lvl > price && lvl < sl) swingHighs.push(lvl);
                }
              }
              demandZone = swingHighs.length ? Math.min(...swingHighs) : price + (sl - price) * 0.4;
            }
          }
        }
      }
    } catch (e) { /* proceed without zone */ }

    this.pendingEntries.set(key, {
      telegramId,
      setup,
      source,
      user,
      queuedAt: Date.now(),
      signalPrice: setup.currentPrice,
      demandZone,
    });

    const dzInfo = demandZone ? `\nEntry zone: $${demandZone.toPrecision(6)}` : '';
    logger.info(`User ${telegramId} queued ${setup.direction} ${setup.symbol} for demand zone entry`);
    await this.notify(telegramId,
      `⏳ <b>ENTRY QUEUED</b> $${escapeHtml(setup.symbol)}\n\n` +
      `${setup.direction === 'long' ? '🟢 LONG' : '🔴 SHORT'} — waiting for demand zone\n` +
      `Signal: $${setup.currentPrice}${dzInfo}\n` +
      `SL: $${setup.stopLoss?.toPrecision(6) || '?'}\n` +
      `Will enter at structure or expire after 30 min`
    );
  }

  async _executeQueuedEntry(telegramId, setup, source, user) {
    const size = parseFloat(user.paper_size) || 100;
    const leverage = parseInt(user.paper_leverage) || 20;
    const notional = size * leverage;
    const quantity = notional / setup.currentPrice;
    const isLong = setup.direction === 'long';
    const atr = setup.atr;
    const tp4 = isLong ? setup.currentPrice + atr * 8 : setup.currentPrice - atr * 8;
    const invalidation = setup.invalidation || (isLong ? setup.currentPrice - atr * 3 : setup.currentPrice + atr * 3);

    await db.saveUserPaperTrade({
      telegramId,
      signalId: setup.signalId || null,
      symbol: setup.symbol,
      exchange: setup.exchange,
      direction: setup.direction,
      entryPrice: setup.currentPrice,
      positionSize: notional,
      tp1: setup.tp1, tp2: setup.tp2, tp3: setup.tp3, tp4,
      stopLoss: setup.stopLoss,
      leverage, quantity, atr, invalidation,
      source,
      onchainContext: setup.onchainContext || null,
    });

    const emoji = source === 'onchain' ? '🔗' : '📝';
    await this.notify(telegramId,
      `${emoji} <b>Paper trade opened</b>\n\n` +
      `${isLong ? '🟢 LONG' : '🔴 SHORT'} $${escapeHtml(setup.symbol)}\n` +
      `Entry: $${setup.currentPrice.toPrecision(6)}\n` +
      `Size: $${notional.toFixed(0)} (${leverage}x)\n` +
      `TP1: $${parseFloat(setup.tp1).toPrecision(6)} | TP2: $${parseFloat(setup.tp2).toPrecision(6)}\n` +
      `TP3: $${parseFloat(setup.tp3).toPrecision(6)}\n` +
      `SL: $${parseFloat(setup.stopLoss).toPrecision(6)}`
    );
  }

  async checkPendingUserEntries() {
    for (const [key, entry] of this.pendingEntries) {
      try {
        const { telegramId, setup, source, user, queuedAt, signalPrice } = entry;
        const ageMin = (Date.now() - queuedAt) / 60000;
        const isLong = setup.direction === 'long';

        // Re-check: if user already has a position on this symbol, cancel
        try {
          const openTrades = await db.getOpenUserTrades(telegramId);
          if (openTrades.find(t => t.symbol === setup.symbol)) {
            this.pendingEntries.delete(key);
            continue;
          }
        } catch (e) { /* proceed */ }

        const exchange = this.exchanges[setup.exchange];
        if (!exchange) { this.pendingEntries.delete(key); continue; }

        const pair = [`${setup.symbol}/USDT:USDT`, `${setup.symbol}/USDT`].find(p => exchange.markets?.[p]);
        if (!pair) { this.pendingEntries.delete(key); continue; }

        const candles = await exchange.fetchOHLCV(pair, '5m', undefined, 6);
        if (!candles?.length) continue;

        const latest = candles[candles.length - 1];
        const [, open, high, low, close] = latest;

        // Price ran 5%+ away → cancel
        const ranAway = isLong ? close > signalPrice * 1.05 : close < signalPrice * 0.95;
        const ranAgainst = isLong ? close < signalPrice * 0.95 : close > signalPrice * 1.05;
        if (ranAway || ranAgainst) {
          this.pendingEntries.delete(key);
          await this.notify(telegramId,
            `⏭ <b>ENTRY CANCELLED</b> $${escapeHtml(setup.symbol)}\n\n` +
            `Price: $${signalPrice} → $${close}\n${ranAgainst ? 'Signal invalidated — price moved against bias.' : 'Skipped — chasing risk too high.'}`
          );
          continue;
        }

        // Price already past SL → cancel
        if (setup.stopLoss) {
          const slInvalid = isLong ? close <= setup.stopLoss : close >= setup.stopLoss;
          if (slInvalid) {
            this.pendingEntries.delete(key);
            await this.notify(telegramId,
              `⏭ <b>ENTRY CANCELLED</b> $${escapeHtml(setup.symbol)}\n\n` +
              `Price $${close} already past SL $${setup.stopLoss}\nWould trigger instant stop-out.`
            );
            continue;
          }
        }

        // Pullback to demand zone + recovery candle → enter at structure
        const dz = entry.demandZone;
        const pulledBack = dz
          ? (isLong ? low <= dz : high >= dz)
          : (isLong ? low < signalPrice * 0.99 : high > signalPrice * 1.01);
        const recovering = isLong ? close > open : close < open;

        if (pulledBack && recovering) {
          setup.currentPrice = close;
          this.pendingEntries.delete(key);
          await this._executeQueuedEntry(telegramId, setup, source, user);
          const saved = Math.abs(((close - signalPrice) / signalPrice) * 100).toFixed(1);
          logger.info(`User ${telegramId} demand zone entry ${setup.symbol} at $${close} (signal $${signalPrice}, zone $${dz?.toPrecision(6)}, saved ${saved}%)`);
          continue;
        }

        // 30 min timeout — only enter if recovery candle confirms
        if (ageMin >= 30) {
          this.pendingEntries.delete(key);
          if (recovering) {
            setup.currentPrice = close;
            await this._executeQueuedEntry(telegramId, setup, source, user);
            logger.info(`User ${telegramId} timeout entry ${setup.symbol} at $${close} (candle confirms)`);
          } else {
            logger.info(`User ${telegramId} entry expired ${setup.symbol} — no recovery candle after ${ageMin.toFixed(0)}m`);
            await this.notify(telegramId,
              `⏭ <b>ENTRY EXPIRED</b> $${escapeHtml(setup.symbol)}\n\n` +
              `No pullback + recovery after 30m\nPrice still moving against — skipping.`
            );
          }
          continue;
        }
      } catch (e) {
        logger.debug(`User pending entry check failed for ${key}: ${e.message}`);
      }
    }
  }

  async openManualTrade(telegramId, symbol, direction) {
    const user = await db.getUser(telegramId);
    if (!user) throw new Error('User not found');

    const size = parseFloat(user.paper_size) || 100;
    const leverage = parseInt(user.paper_leverage) || 20;

    // Find the symbol on an exchange
    let exchange = null;
    let exchangeId = null;
    let pair = null;
    for (const [id, ex] of Object.entries(this.exchanges)) {
      const p = `${symbol}/USDT:USDT`;
      if (ex.markets?.[p]) {
        exchange = ex;
        exchangeId = id;
        pair = p;
        break;
      }
    }
    if (!exchange) throw new Error(`${symbol} not found on any exchange`);

    // Check for existing open position
    const openTrades = await db.getOpenUserTrades(telegramId);
    if (openTrades.some(t => t.symbol.toUpperCase() === symbol.toUpperCase())) {
      throw new Error(`Already have an open position in ${symbol}`);
    }

    const ticker = await exchange.fetchTicker(pair);
    const currentPrice = ticker.last;

    // Calculate ATR from recent OHLCV
    let atr;
    try {
      const ohlcv = await exchange.fetchOHLCV(pair, '1h', undefined, 20);
      const highs = ohlcv.map(c => c[2]);
      const lows = ohlcv.map(c => c[3]);
      const closes = ohlcv.map(c => c[4]);
      const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
      atr = atrValues[atrValues.length - 1] || currentPrice * 0.02;
    } catch (e) {
      atr = currentPrice * 0.02;
    }

    const isLong = direction === 'long';
    const notional = size * leverage;
    const quantity = notional / currentPrice;
    const stopLoss = isLong ? currentPrice - atr * 3 : currentPrice + atr * 3;
    const tp1 = isLong ? currentPrice + atr * 3 : currentPrice - atr * 3;
    const tp2 = isLong ? currentPrice + atr * 6 : currentPrice - atr * 6;
    const tp3 = isLong ? currentPrice + atr * 10 : currentPrice - atr * 10;
    const tp4 = isLong ? currentPrice + atr * 8 : currentPrice - atr * 8;
    const invalidation = stopLoss;

    const result = await db.saveUserPaperTrade({
      telegramId,
      symbol,
      exchange: exchangeId,
      direction,
      entryPrice: currentPrice,
      positionSize: notional,
      tp1, tp2, tp3, tp4,
      stopLoss,
      leverage,
      quantity,
      atr,
      invalidation,
      source: 'manual',
    });

    return { id: result.id, symbol, direction, currentPrice, notional, leverage, tp1, tp2, tp3, tp4, stopLoss, atr };
  }

  async closeManualTrade(telegramId, symbol) {
    const openTrades = await db.getOpenUserTrades(telegramId);
    const trade = openTrades.find(t => t.symbol.toUpperCase() === symbol.toUpperCase());
    if (!trade) throw new Error(`No open position in ${symbol}`);

    let exchange = this.exchanges[trade.exchange];
    if (!exchange) exchange = Object.values(this.exchanges)[0];

    const pairs = [`${trade.symbol}/USDT:USDT`, `${trade.symbol}/USDT`];
    let currentPrice = null;
    for (const p of pairs) {
      if (exchange.markets?.[p]) {
        const ticker = await exchange.fetchTicker(p);
        currentPrice = ticker.last;
        break;
      }
    }
    if (!currentPrice) throw new Error(`Cannot fetch price for ${symbol}`);

    const entry = parseFloat(trade.entry_price);
    const isLong = trade.direction === 'long';
    const pnlPct = isLong
      ? ((currentPrice - entry) / entry) * 100
      : ((entry - currentPrice) / entry) * 100;
    const pnlUsd = (pnlPct / 100) * parseFloat(trade.position_size) + parseFloat(trade.realized_pnl_usd || 0);

    await db.closeUserPaperTrade(trade.id, currentPrice, pnlPct, pnlUsd, 'manual_close');
    return { symbol, direction: trade.direction, entry, exit: currentPrice, pnlPct, pnlUsd };
  }

  async checkAllTrades() {
    let open = [];
    try {
      open = await db.getOpenUserTrades();
    } catch (e) {
      logger.warn(`user paper check: ${e.message}`);
      return;
    }
    if (!open.length) return;

    // Fetch tickers + 4H OHLCV per symbol/exchange
    const priceData = new Map();
    for (const t of open) {
      const key = `${t.exchange}:${t.symbol}`;
      if (priceData.has(key)) continue;
      priceData.set(key, { price: null, ohlcv: null });
    }

    for (const key of priceData.keys()) {
      const [exId, sym] = key.split(':');
      let exchange = this.exchanges[exId];
      if (!exchange) exchange = Object.values(this.exchanges)[0];
      if (!exchange) continue;
      const pairs = [`${sym}/USDT:USDT`, `${sym}/USDT`];
      for (const pair of pairs) {
        if (exchange.markets?.[pair]) {
          try {
            const ticker = await exchange.fetchTicker(pair);
            const data = { price: ticker.last, ohlcv: null };
            try { data.ohlcv = await exchange.fetchOHLCV(pair, '4h', undefined, 2); } catch (e) { /* ok */ }
            priceData.set(key, data);
          } catch (e) {
            logger.debug(`user paper ticker ${key}: ${e.message}`);
          }
          break;
        }
      }
    }

    // Load per-user settings for all users with open trades
    const userSettings = new Map();
    for (const t of open) {
      if (!userSettings.has(t.telegram_id)) {
        try {
          const u = await db.getUser(t.telegram_id);
          userSettings.set(t.telegram_id, u);
        } catch (e) { /* use defaults */ }
      }
    }

    for (const t of open) {
      const data = priceData.get(`${t.exchange}:${t.symbol}`);
      if (!data?.price) continue;
      const u = userSettings.get(t.telegram_id);
      if (u?.per_trade_loss) t._perTradeLoss = parseFloat(u.per_trade_loss);
      try {
        await this.evaluateTrade(t, data.price, data.ohlcv);
      } catch (e) {
        logger.warn(`user paper evaluate #${t.id}: ${e.message}`);
      }
    }
  }

  async evaluateTrade(t, price, ohlcv) {
    const isLong = t.direction === 'long';
    const entry = parseFloat(t.entry_price);
    const posSize = parseFloat(t.position_size);
    const atr = parseFloat(t.atr) || 0;
    const leverage = parseInt(t.leverage) || 1;
    const tradeAgeMs = Date.now() - new Date(t.created_at).getTime();

    const pnlPct = isLong
      ? ((price - entry) / entry) * 100
      : ((entry - price) / entry) * 100;
    const pnlUsd = (pnlPct / 100) * posSize;

    // Always track peak price
    const prevPeak = parseFloat(t.peak_price) || entry;
    const curPeak = isLong ? Math.max(prevPeak, price) : Math.min(prevPeak, price);
    if (curPeak !== prevPeak) {
      await db.updateUserPaperTrade(t.id, { peak_price: curPeak });
      t.peak_price = curPeak;
    }

    let action = null;

    // --- TIME-BASED EXIT: edge decays after 45-90 min ---
    if (!action && !t.hit_tp1 && tradeAgeMs > 45 * 60 * 1000) {
      if (pnlUsd > 0 && tradeAgeMs < 90 * 60 * 1000) {
        const beTrail = isLong ? entry * 1.01 : entry * 0.99;
        const currentSL = parseFloat(t.stop_loss);
        const priceAboveTrail = isLong ? price > beTrail : price < beTrail;
        const shouldMove = priceAboveTrail && (isLong ? beTrail > currentSL : beTrail < currentSL);
        if (shouldMove) {
          await db.updateUserPaperTrade(t.id, { stop_loss: beTrail });
          t.stop_loss = beTrail;
          action = 'time_trail';
        }
      } else if (tradeAgeMs > 90 * 60 * 1000) {
        action = 'time_exit';
        const totalPnl = pnlUsd + parseFloat(t.realized_pnl_usd || 0);
        await db.closeUserPaperTrade(t.id, price, pnlPct, totalPnl, 'time_exit');
        const bal = await this.getBalance(t.telegram_id);
        await this.notify(t.telegram_id,
          `⏰ <b>TIME EXIT</b> — $${escapeHtml(t.symbol)}\n` +
          `90min+ no TP1 — edge decayed\nP&L: $${totalPnl.toFixed(2)}${this.balanceTag(bal)}`);
      }
    }

    // --- SMC THESIS RE-CHECK: detect structure flip every 15 min ---
    if (!action && tradeAgeMs > 30 * 60 * 1000 && !t.hit_tp1) {
      const lastRecheck = t._lastSmcRecheck || 0;
      if (Date.now() - lastRecheck > 15 * 60 * 1000) {
        t._lastSmcRecheck = Date.now();
        try {
          let exchange = this.exchanges[t.exchange] || Object.values(this.exchanges)[0];
          const pair = [`${t.symbol}/USDT:USDT`, `${t.symbol}/USDT`].find(p => exchange?.markets?.[p]);
          if (pair && exchange) {
            const ohlcv1h = await exchange.fetchOHLCV(pair, '1h', undefined, 100);
            if (ohlcv1h && ohlcv1h.length >= 20) {
              const SMCAnalyzer = require('../collectors/smcAnalyzer');
              const smc = new SMCAnalyzer();
              const result = smc.analyze(ohlcv1h);
              if (result && result.structureBias !== 'neutral') {
                const structureConflict = (isLong && result.structureBias === 'bearish') ||
                  (!isLong && result.structureBias === 'bullish');
                const hasChoch = isLong
                  ? result.chochEvents.some(e => e.type === 'CHOCH_BEARISH')
                  : result.chochEvents.some(e => e.type === 'CHOCH_BULLISH');
                if (structureConflict && hasChoch && pnlUsd < 0) {
                  action = 'thesis_broken';
                  const totalPnl = pnlUsd + parseFloat(t.realized_pnl_usd || 0);
                  await db.closeUserPaperTrade(t.id, price, pnlPct, totalPnl, 'thesis_broken');
                  const bal = await this.getBalance(t.telegram_id);
                  await this.notify(t.telegram_id,
                    `🔄 <b>THESIS BROKEN</b> — $${escapeHtml(t.symbol)}\n` +
                    `SMC structure flipped ${result.structureBias} with ChoCH\nP&L: $${totalPnl.toFixed(2)}${this.balanceTag(bal)}`);
                }
              }
            }
          }
        } catch (e) { /* SMC recheck failed */ }
      }
    }

    // --- INVALIDATION CHECK: 4H candle close below invalidation level ---
    if (!action && t.invalidation && ohlcv && ohlcv.length >= 2 && tradeAgeMs > 4 * 60 * 60 * 1000) {
      const prevClose = ohlcv[ohlcv.length - 2][4];
      const invalidated = isLong ? prevClose < t.invalidation : prevClose > t.invalidation;
      if (invalidated) {
        action = 'invalidated';
        await db.closeUserPaperTrade(t.id, price, pnlPct, pnlUsd + parseFloat(t.realized_pnl_usd || 0), 'invalidated');
      }
    }

    // --- TP4: close full remaining ---
    if (!action && t.tp4 && (isLong ? price >= t.tp4 : price <= t.tp4)) {
      action = 'tp4';
      const totalPnl = (pnlPct / 100) * posSize + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, price, pnlPct, totalPnl, 'tp4');
    }

    // --- TP3: close 50% remaining, keep runner, SL to TP2 ---
    if (!action && !t.hit_tp3 && t.tp3 && (isLong ? price >= t.tp3 : price <= t.tp3)) {
      action = 'tp3';
      const partialPnl = await this.partialClose(t, 0.5, price);
      await db.updateUserPaperTrade(t.id, { hit_tp3: true, stop_loss: t.tp2 });
      await this.notify(t.telegram_id,
        `🎯 <b>TP3 HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed 50% (+$${partialPnl.toFixed(2)})\n` +
        `🏃 Runner riding with wide trail (3x ATR)\nSL → $${parseFloat(t.tp2).toPrecision(6)}`);
    }

    // --- TP2: close 50% remaining, SL to TP1 ---
    if (!action && !t.hit_tp2 && t.tp2 && (isLong ? price >= t.tp2 : price <= t.tp2)) {
      action = 'tp2';
      const partialPnl = await this.partialClose(t, 0.5, price);
      await db.updateUserPaperTrade(t.id, { hit_tp2: true, stop_loss: t.tp1 });
      await this.notify(t.telegram_id,
        `🎯 <b>TP2 HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed 50% (+$${partialPnl.toFixed(2)})\nSL → $${parseFloat(t.tp1).toPrecision(6)}`);
    }

    // --- TP1: close 33%, SL to breakeven ---
    if (!action && !t.hit_tp1 && t.tp1 && (isLong ? price >= t.tp1 : price <= t.tp1)) {
      action = 'tp1';
      const partialPnl = await this.partialClose(t, 0.33, price);
      await db.updateUserPaperTrade(t.id, { hit_tp1: true, stop_loss: entry });
      await this.notify(t.telegram_id,
        `🎯 <b>TP1 HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed 33% (+$${partialPnl.toFixed(2)})\nSL → breakeven ($${entry.toPrecision(6)})`);
    }

    // --- TRAILING SL (after TP1) ---
    if (!action && t.hit_tp1 && atr) {
      const trailDist = t.hit_tp3 ? atr * 3 : atr * 1.5;
      const peak = parseFloat(t.peak_price) || entry;
      const newPeak = isLong ? Math.max(peak, price) : Math.min(peak, price);

      if (newPeak !== peak) {
        await db.updateUserPaperTrade(t.id, { peak_price: newPeak });
        t.peak_price = newPeak;
      }

      const trailSL = isLong ? newPeak - trailDist : newPeak + trailDist;
      const currentSL = parseFloat(t.stop_loss);
      const shouldUpdate = isLong ? trailSL > currentSL : trailSL < currentSL;
      if (shouldUpdate) {
        await db.updateUserPaperTrade(t.id, { stop_loss: trailSL });
        t.stop_loss = trailSL;
        action = 'trail';
      }
    }

    // --- PROFIT PROTECTION (pre-TP1) ---
    const leveragedPnl = pnlPct * leverage;
    if (!action && !t.hit_tp1 && (pnlPct > 2.5 || leveragedPnl > 12)) {
      const currentSL = parseFloat(t.stop_loss);
      const atBreakeven = isLong ? currentSL >= entry : currentSL <= entry;
      if (!atBreakeven) {
        await db.updateUserPaperTrade(t.id, { stop_loss: entry });
        action = 'profit_protect';
      } else if (atr) {
        const peak = parseFloat(t.peak_price) || entry;
        const newPeak = isLong ? Math.max(peak, price) : Math.min(peak, price);
        if (newPeak !== peak) {
          await db.updateUserPaperTrade(t.id, { peak_price: newPeak });
          t.peak_price = newPeak;
        }
        const profitDist = Math.abs(newPeak - entry);
        const trailDist = Math.min(atr * 1.5, profitDist * 0.33 || atr * 1.5);
        const trailSL = isLong ? newPeak - trailDist : newPeak + trailDist;
        const aboveBreakeven = isLong ? trailSL > entry : trailSL < entry;
        const shouldUpdate = isLong ? trailSL > currentSL : trailSL < currentSL;
        if (shouldUpdate && aboveBreakeven) {
          await db.updateUserPaperTrade(t.id, { stop_loss: trailSL });
          t.stop_loss = trailSL;
          action = 'trail';
        }
      }
    }

    // --- MAX LOSS CAP (per-user setting or scaled default) ---
    const userPerTradeLoss = t._perTradeLoss || (6 * (posSize / 800));
    if (!action && pnlUsd < 0 && Math.abs(pnlUsd) >= userPerTradeLoss) {
      action = 'max_loss';
      await db.closeUserPaperTrade(t.id, price, pnlPct, pnlUsd + parseFloat(t.realized_pnl_usd || 0), 'max_loss');
      const bal = await this.getBalance(t.telegram_id);
      await this.notify(t.telegram_id,
        `❌ <b>MAX LOSS</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed at $${price.toPrecision(6)}\nP&L: $${pnlUsd.toFixed(2)}${this.balanceTag(bal)}`);
    }

    // --- SL CHECK ---
    if (!action && t.stop_loss && (isLong ? price <= parseFloat(t.stop_loss) : price >= parseFloat(t.stop_loss))) {
      action = 'sl';
      const slPrice = parseFloat(t.stop_loss);
      const slPnlPct = isLong
        ? ((slPrice - entry) / entry) * 100
        : ((entry - slPrice) / entry) * 100;
      const slPnlUsd = (slPnlPct / 100) * posSize + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, slPrice, slPnlPct, slPnlUsd, t.hit_tp1 ? 'sl_trailed' : 'sl');
      const slBal = await this.getBalance(t.telegram_id);
      const emoji = slPnlUsd >= 0 ? '✅' : '❌';
      await this.notify(t.telegram_id,
        `${emoji} <b>SL HIT</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed at $${slPrice.toPrecision(6)}\nP&L: $${slPnlUsd.toFixed(2)}${this.balanceTag(slBal)}`);
    }

    // --- TRADE EXPIRY (48h default, 14d for swing) ---
    const maxTradeAge = t.onchain_context?.swingData ? 14 * 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000;
    if (!action && tradeAgeMs > maxTradeAge) {
      action = 'expired';
      const totalPnl = pnlUsd + parseFloat(t.realized_pnl_usd || 0);
      await db.closeUserPaperTrade(t.id, price, pnlPct, totalPnl, 'expired');
      const expBal = await this.getBalance(t.telegram_id);
      await this.notify(t.telegram_id,
        `⏰ <b>EXPIRED</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed after 48h at $${price.toPrecision(6)}\nP&L: $${totalPnl.toFixed(2)}${this.balanceTag(expBal)}`);
    }

    // Notify on close actions
    if (action && ['tp4', 'invalidated'].includes(action)) {
      const totalPnl = (pnlPct / 100) * posSize + parseFloat(t.realized_pnl_usd || 0);
      const closeBal = await this.getBalance(t.telegram_id);
      const emoji = totalPnl >= 0 ? '🎯' : '❌';
      await this.notify(t.telegram_id,
        `${emoji} <b>${action.toUpperCase()}</b> — $${escapeHtml(t.symbol)}\n` +
        `Closed at $${price.toPrecision(6)}\nP&L: $${totalPnl.toFixed(2)}${this.balanceTag(closeBal)}`);
    }
  }

  async partialClose(trade, fraction, currentPrice) {
    const entry = parseFloat(trade.entry_price);
    const posSize = parseFloat(trade.position_size);
    const qty = parseFloat(trade.quantity) || posSize / entry;
    const isLong = trade.direction === 'long';

    const closePct = isLong
      ? ((currentPrice - entry) / entry) * 100
      : ((entry - currentPrice) / entry) * 100;

    const closeQty = qty * fraction;
    const closeSize = posSize * fraction;
    const partialPnl = (closePct / 100) * closeSize;

    const newQty = qty - closeQty;
    const newSize = posSize - closeSize;
    const newRealized = parseFloat(trade.realized_pnl_usd || 0) + partialPnl;

    await db.updateUserPaperTrade(trade.id, {
      quantity: newQty,
      position_size: newSize,
      realized_pnl_usd: newRealized,
    });

    trade.quantity = newQty;
    trade.position_size = newSize;
    trade.realized_pnl_usd = newRealized;

    return partialPnl;
  }

  async getOpen(telegramId) {
    return db.getOpenUserTrades(telegramId);
  }

  async getStats(telegramId) {
    return db.getUserTradeStats(telegramId);
  }
}

module.exports = UserPaperEngine;
