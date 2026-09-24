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
const SwingScanner = require('./collectors/swingScanner');
const TelegramBot = require('./bot/telegramBot');
const { generateSetupChart } = require('./utils/chartGenerator');

let dbReady = false;
let exchangeRef = null;

// Alert cooldown — skip duplicate symbol+direction within 30 min
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
function shouldLogAlert(type, symbol, direction) {
  const key = `${type}:${symbol}:${direction}`;
  const last = alertCooldowns.get(key);
  if (last && Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertCooldowns.set(key, Date.now());
  return true;
}

async function main() {
  logger.info('=== CryptoSignal Bot Starting ===');

  // Start health check + dashboard server
  const dashboardHtml = require('./dashboard');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = (url.searchParams.get('key') || '').trim();
    const authed = key && key === (process.env.DASHBOARD_KEY || '').trim();

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', dbReady, uptime: process.uptime() }));
    }


    if (url.pathname === '/' || url.pathname === '/dashboard') {
      logger.info(`[DASHBOARD] Page loaded from ${req.headers['user-agent'] ? (req.headers['user-agent'].includes('Mobile') ? 'MOBILE' : 'DESKTOP') : 'unknown'}`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      return res.end(dashboardHtml);
    }

    if (url.pathname.startsWith('/api/') && !authed) {
      const dk = process.env.DASHBOARD_KEY;
      logger.warn(`[AUTH FAIL] path=${url.pathname} keyProvided=${!!key} keyLen=${key.length} envSet=${!!dk} envLen=${dk ? dk.length : 0} match=${key === dk} trimMatch=${(key||'').trim() === (dk||'').trim()}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid dashboard key' }));
    }

    if (url.pathname === '/api/signals' && authed) {
      logger.info(`[AUTH OK] /api/signals request authenticated`);

      try {
        const hours = parseInt(url.searchParams.get('hours')) || 24;
        const minScore = parseInt(url.searchParams.get('minScore')) || 30;
        const result = await db.query(`
          WITH raw_alerts AS (
            SELECT symbol, data->>'direction' as direction,
              (data->>'score')::int as score,
              (data->>'price')::numeric as price,
              data->>'fundingBias' as funding_bias,
              data->'exchangeFlow'->>'bias' as flow_bias,
              (data->>'oiChange4h')::numeric as oi_4h,
              (data->>'oiChange1h')::numeric as oi_1h,
              (data->>'priceChange')::numeric as price_change,
              (data->>'fundingRate')::numeric as funding_rate,
              data->'lsData' as ls_data,
              (data->>'tp1')::numeric as tp1,
              (data->>'tp2')::numeric as tp2,
              (data->>'tp3')::numeric as tp3,
              (data->>'stopLoss')::numeric as stop_loss,
              (data->>'atr')::numeric as atr,
              (data->>'confidence')::int as confidence,
              data->>'exchange' as exchange,
              data->>'pair' as pair,
              alert_type,
              created_at,
              LAG(created_at) OVER (PARTITION BY symbol ORDER BY created_at) as prev_at,
              LAG((data->>'price')::numeric) OVER (PARTITION BY symbol ORDER BY created_at) as prev_price
            FROM alert_log
            WHERE alert_type = 'ONCHAIN'
              AND (data->>'score')::int >= $1
              AND created_at >= NOW() - INTERVAL '1 hour' * $2
          ),
          sessioned AS (
            SELECT *,
              SUM(CASE WHEN prev_at IS NULL
                OR EXTRACT(EPOCH FROM (created_at - prev_at)) > 14400
                OR (prev_price > 0 AND ABS((price - prev_price) / prev_price) > 0.10)
                THEN 1 ELSE 0 END)
              OVER (PARTITION BY symbol ORDER BY created_at) as sess
            FROM raw_alerts
          ),
          first_alert AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol, sess ORDER BY created_at ASC) as rn
            FROM sessioned
          ),
          best_score AS (
            SELECT DISTINCT ON (symbol, sess)
              symbol, sess,
              score as max_score,
              price as best_price,
              created_at as best_at
            FROM sessioned
            ORDER BY symbol, sess, score DESC, created_at ASC
          ),
          latest_alert AS (
            SELECT DISTINCT ON (symbol, sess)
              symbol, sess,
              score as latest_score
            FROM sessioned
            ORDER BY symbol, sess, created_at DESC
          )
          SELECT f.*, COALESCE(b.max_score, f.score) as best_score,
            b.best_price, b.best_at,
            COALESCE(l.latest_score, f.score) as current_score
          FROM first_alert f
          LEFT JOIN best_score b ON f.symbol = b.symbol AND f.sess = b.sess
          LEFT JOIN latest_alert l ON f.symbol = l.symbol AND f.sess = l.sess
          WHERE f.rn = 1
          ORDER BY COALESCE(b.max_score, f.score) DESC
        `, [minScore, hours]);
        const flowResult = await db.query(`
          WITH ranked AS (
            SELECT symbol, data->>'direction' as direction,
              0 as score,
              (data->>'price')::numeric as price,
              NULL as funding_bias, NULL as flow_bias,
              NULL as oi_4h, NULL as oi_1h,
              NULL as price_change, NULL as funding_rate,
              NULL as ls_data,
              alert_type,
              message,
              created_at,
              ROW_NUMBER() OVER (PARTITION BY symbol, data->>'direction', alert_type ORDER BY created_at DESC) as rn
            FROM alert_log
            WHERE alert_type IN ('FLOW','SUPPLY_MOVE')
              AND data->>'direction' IS NOT NULL
              AND created_at >= NOW() - INTERVAL '1 hour' * $1
          )
          SELECT * FROM ranked WHERE rn = 1 ORDER BY created_at DESC
        `, [hours]);
        const allSignals = result.rows;
        if (allSignals.length && listingMonitor?.exchanges) {
          const byExchange = {};
          for (const s of allSignals) {
            const ex = s.exchange || 'bybit';
            const pair = s.pair || s.symbol + '/USDT:USDT';
            if (!byExchange[ex]) byExchange[ex] = [];
            byExchange[ex].push({ sig: s, pair });
          }
          for (const [exName, items] of Object.entries(byExchange)) {
            const ex = listingMonitor.exchanges[exName];
            if (!ex) continue;
            try {
              const pairs = [...new Set(items.map(i => i.pair))];
              const tickers = await ex.fetchTickers(pairs);
              for (const item of items) {
                const t = tickers[item.pair];
                if (t && t.last) {
                  const entry = parseFloat(item.sig.price);
                  const ratio = t.last / entry;
                  if (ratio < 10 && ratio > 0.1) item.sig.current_price = t.last;
                }
              }
            } catch (_) {}
          }
          // Fetch 4H OHLCV candles for peak/trough watermark (TP hit detection)
          const candleCache = {};
          const candleWindow = Math.min(hours, 168);
          const since48h = Date.now() - candleWindow * 60 * 60 * 1000;
          for (const [exName, items] of Object.entries(byExchange)) {
            const ex = listingMonitor.exchanges[exName];
            if (!ex) continue;
            const uniquePairs = [...new Set(items.map(i => i.pair))];
            try {
              await Promise.all(uniquePairs.map(pair =>
                ex.fetchOHLCV(pair, '4h', since48h, Math.ceil(candleWindow / 4))
                  .then(c => { if (c?.length) candleCache[pair] = c; })
                  .catch(() => {})
              ));
            } catch (_) {}
          }
          for (const s of allSignals) {
            const pair = s.pair || s.symbol + '/USDT:USDT';
            const candles = candleCache[pair];
            if (!candles) continue;
            const sigTime = new Date(s.created_at).getTime();
            const relevant = candles.filter(c => c[0] >= sigTime);
            if (relevant.length) {
              s.peak_price = Math.max(...relevant.map(c => c[2]));
              s.trough_price = Math.min(...relevant.map(c => c[3]));
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ signals: allSignals, flow_alerts: flowResult.rows, ts: Date.now() }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === '/api/patterns' && authed) {
      try {
        const result = await db.query(`
          WITH scored AS (
            SELECT symbol, data->>'direction' as dir,
              (data->>'score')::int as score,
              (data->>'price')::numeric as price,
              data->>'fundingBias' as funding,
              data->'exchangeFlow'->>'bias' as flow_bias,
              (data->>'oiChange4h')::numeric as oi_4h,
              created_at
            FROM alert_log WHERE alert_type = 'ONCHAIN' AND (data->>'score')::int >= 60
          ),
          with_out AS (
            SELECT a.*,
              (SELECT (d.data->>'price')::numeric FROM alert_log d
               WHERE d.symbol = a.symbol AND d.alert_type = 'ONCHAIN'
               AND d.created_at BETWEEN a.created_at + INTERVAL '3 hours' AND a.created_at + INTERVAL '12 hours'
               ORDER BY d.created_at LIMIT 1) as later_price
            FROM scored a
          )
          SELECT dir as direction,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE later_price IS NOT NULL AND
              ((dir='long' AND later_price > price) OR (dir='short' AND later_price < price))) as correct,
            COUNT(*) FILTER (WHERE later_price IS NOT NULL) as with_data,
            COUNT(*) FILTER (WHERE funding = dir AND later_price IS NOT NULL AND
              ((dir='long' AND later_price > price) OR (dir='short' AND later_price < price))) as fund_aligned_correct,
            COUNT(*) FILTER (WHERE funding = dir AND later_price IS NOT NULL) as fund_aligned_total,
            COUNT(*) FILTER (WHERE score >= 80 AND later_price IS NOT NULL AND
              ((dir='long' AND later_price > price) OR (dir='short' AND later_price < price))) as high_score_correct,
            COUNT(*) FILTER (WHERE score >= 80 AND later_price IS NOT NULL) as high_score_total
          FROM with_out GROUP BY dir
        `);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ patterns: result.rows, ts: Date.now() }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === '/api/trades' && authed) {
      try {
        const page = Math.max(1, parseInt(url.searchParams.get('page')) || 1);
        const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get('limit')) || 25));
        const period = url.searchParams.get('period') || 'all';
        const source = url.searchParams.get('source') || 'all';
        const offset = (page - 1) * limit;
        let dateFilter = '';
        if (period === 'today') dateFilter = "AND closed_at >= CURRENT_DATE";
        else if (period === 'week') dateFilter = "AND closed_at >= CURRENT_DATE - INTERVAL '7 days'";
        else if (period === 'month') dateFilter = "AND closed_at >= CURRENT_DATE - INTERVAL '30 days'";
        const validSources = ['onchain', 'demandzone', 'main', 'swing'];
        const sourceFilter = validSources.includes(source) ? `AND source = '${source}'` : '';
        const result = await db.query(`
          SELECT symbol, direction, entry_price, exit_price, position_size, source,
            ROUND(pnl_pct::numeric, 2) as pnl_pct, ROUND(pnl_usd::numeric, 2) as pnl_usd,
            leverage, close_reason, mode, hit_tp1, hit_tp2, hit_tp3,
            (onchain_context->>'score')::int as score,
            onchain_context->>'fundingBias' as funding,
            onchain_context->'exchangeFlow'->>'bias' as flow_bias,
            (onchain_context->>'oiChange4h')::numeric as oi_4h,
            (onchain_context->>'priceChange')::numeric as price_change,
            created_at, closed_at
          FROM trades WHERE status = 'closed' ${sourceFilter} ${dateFilter}
          ORDER BY closed_at DESC LIMIT $1 OFFSET $2
        `, [limit, offset]);
        const countRes = await db.query(
          `SELECT COUNT(*) as total FROM trades WHERE status = 'closed' ${sourceFilter} ${dateFilter}`
        );
        const open = await db.query(`
          SELECT symbol, direction, entry_price, leverage, position_size, mode, source,
            (onchain_context->>'score')::int as score,
            onchain_context->>'fundingBias' as funding,
            tp1, tp2, tp3, stop_loss, peak_price, created_at
          FROM trades WHERE status = 'open' ${sourceFilter}
        `);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          closed: result.rows, open: open.rows,
          total: parseInt(countRes.rows[0].total),
          page, limit, ts: Date.now()
        }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === '/api/trade-stats' && authed) {
      try {
        const source = url.searchParams.get('source') || 'all';
        const validSources = ['onchain', 'demandzone', 'main', 'swing'];
        const srcFilter = validSources.includes(source) ? `AND source = '${source}'` : '';
        const stats = await db.query(`
          SELECT
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE) as today_count,
            COALESCE(SUM(pnl_usd) FILTER (WHERE closed_at >= CURRENT_DATE), 0) as today_pnl,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE AND pnl_usd > 0) as today_wins,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE AND pnl_usd <= 0) as today_losses,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '7 days') as week_count,
            COALESCE(SUM(pnl_usd) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '7 days'), 0) as week_pnl,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '7 days' AND pnl_usd > 0) as week_wins,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '7 days' AND pnl_usd <= 0) as week_losses,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '30 days') as month_count,
            COALESCE(SUM(pnl_usd) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '30 days'), 0) as month_pnl,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '30 days' AND pnl_usd > 0) as month_wins,
            COUNT(*) FILTER (WHERE closed_at >= CURRENT_DATE - INTERVAL '30 days' AND pnl_usd <= 0) as month_losses,
            COUNT(*) as all_count,
            COALESCE(SUM(pnl_usd), 0) as all_pnl,
            COUNT(*) FILTER (WHERE pnl_usd > 0) as all_wins,
            COUNT(*) FILTER (WHERE pnl_usd <= 0) as all_losses,
            COALESCE(MAX(pnl_usd), 0) as best_trade,
            COALESCE(MIN(pnl_usd), 0) as worst_trade,
            COALESCE(AVG(pnl_usd) FILTER (WHERE pnl_usd > 0), 0) as avg_win,
            COALESCE(AVG(pnl_usd) FILTER (WHERE pnl_usd <= 0), 0) as avg_loss,
            COALESCE(AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 60), 0) as avg_hold_min
          FROM trades WHERE status = 'closed' ${srcFilter}
        `);
        const byReason = await db.query(`
          SELECT close_reason, COUNT(*) as cnt,
            COALESCE(SUM(pnl_usd), 0) as pnl
          FROM trades WHERE status = 'closed' ${srcFilter}
          GROUP BY close_reason ORDER BY cnt DESC
        `);
        const byDirection = await db.query(`
          SELECT direction, COUNT(*) as cnt,
            COUNT(*) FILTER (WHERE pnl_usd > 0) as wins,
            COALESCE(SUM(pnl_usd), 0) as pnl
          FROM trades WHERE status = 'closed' ${srcFilter}
          GROUP BY direction
        `);
        const dailyPnl = await db.query(`
          SELECT DATE(closed_at) as day,
            COUNT(*) as trades,
            COALESCE(SUM(pnl_usd), 0) as pnl,
            COUNT(*) FILTER (WHERE pnl_usd > 0) as wins
          FROM trades WHERE status = 'closed' ${srcFilter}
            AND closed_at >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY DATE(closed_at) ORDER BY day DESC
        `);
        const topSymbols = await db.query(`
          SELECT symbol, COUNT(*) as cnt,
            COUNT(*) FILTER (WHERE pnl_usd > 0) as wins,
            ROUND(COALESCE(SUM(pnl_usd), 0)::numeric, 2) as pnl
          FROM trades WHERE status = 'closed' ${srcFilter}
          GROUP BY symbol ORDER BY pnl DESC LIMIT 10
        `);
        const worstSymbols = await db.query(`
          SELECT symbol, COUNT(*) as cnt,
            COUNT(*) FILTER (WHERE pnl_usd > 0) as wins,
            ROUND(COALESCE(SUM(pnl_usd), 0)::numeric, 2) as pnl
          FROM trades WHERE status = 'closed' ${srcFilter}
          GROUP BY symbol ORDER BY pnl ASC LIMIT 10
        `);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          summary: stats.rows[0],
          byReason: byReason.rows,
          byDirection: byDirection.rows,
          dailyPnl: dailyPnl.rows,
          topSymbols: topSymbols.rows,
          worstSymbols: worstSymbols.rows,
          ts: Date.now()
        }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === '/api/history' && authed) {
      try {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) { res.writeHead(400); return res.end('{"error":"symbol required"}'); }
        const result = await db.query(`
          SELECT alert_type, data->>'direction' as direction,
            (data->>'score')::int as score,
            (data->>'price')::numeric as price,
            data->>'fundingBias' as funding_bias,
            data->'exchangeFlow'->>'bias' as flow_bias,
            (data->>'oiChange4h')::numeric as oi_4h,
            (data->>'priceChange')::numeric as price_change,
            (data->>'fundingRate')::numeric as funding_rate,
            created_at
          FROM alert_log WHERE symbol = $1 AND alert_type = 'ONCHAIN'
          ORDER BY created_at DESC LIMIT 100
        `, [symbol]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ history: result.rows, ts: Date.now() }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    if (url.pathname === '/api/chart' && authed) {
      try {
        let symbol = url.searchParams.get('symbol');
        const tf = url.searchParams.get('tf') || '15m';
        const since = url.searchParams.get('since');
        const exchParam = url.searchParams.get('exchange');
        if (!symbol) { res.writeHead(400); return res.end('{"error":"symbol required"}'); }
        if (!listingMonitor?.exchanges) { res.writeHead(503); return res.end('{"error":"exchange not ready"}'); }
        const validTf = ['5m','15m','1h','4h'];
        if (!validTf.includes(tf)) { res.writeHead(400); return res.end('{"error":"tf must be 5m/15m/1h/4h"}'); }
        if (!symbol.includes('/')) symbol = symbol + '/USDT:USDT';
        const allExchanges = listingMonitor.exchanges;
        let exchange = exchParam && allExchanges[exchParam] ? allExchanges[exchParam] : null;
        if (!exchange) {
          for (const ex of Object.values(allExchanges)) {
            if (ex.markets && ex.markets[symbol]) { exchange = ex; break; }
          }
        }
        if (!exchange) {
          for (const ex of Object.values(allExchanges)) {
            try { await ex.loadMarkets(false); } catch (_) {}
            if (ex.markets && ex.markets[symbol]) { exchange = ex; break; }
          }
        }
        if (!exchange) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not_listed', symbol }));
        }
        const sinceMs = since ? parseInt(since) : Date.now() - (tf === '4h' ? 30*24*60*60*1000 : tf === '1h' ? 7*24*60*60*1000 : 2*24*60*60*1000);
        const candles = await exchange.fetchOHLCV(symbol, tf, sinceMs, 200);
        const data = candles.map(c => ({ time: Math.floor(c[0]/1000), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ candles: data, symbol, tf, exchange: exchange.id }));
      } catch (e) {
        res.writeHead(500);
        return res.end(JSON.stringify({ error: e.message }));
      }
    }

    res.writeHead(200);
    res.end('CryptoSignal Bot Running');
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
  exchangeRef = listingMonitor.exchanges?.bybit || listingMonitor.exchanges?.binance || Object.values(listingMonitor.exchanges || {})[0];

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

  // Init onchain trade executor — separate settings, independent from main engine
  const onchainTradeExecutor = new TradeExecutor(listingMonitor.exchanges, {
    settingsKey: 'onchain',
    mode: 'paper',
    maxPositionSize: 20,
    maxDailyLoss: 30,
    maxLossPerTrade: 6,
    maxConcurrentPositions: 3,
    defaultLeverage: 20,
    minConfidence: 4,
    paperBalance: 500,
    dynamicLeverage: false,
    dcaEnabled: false,
    signalFilter: new Set(['ONCHAIN_SETUP']),
    profitProtectPct: 3.0,
    profitProtectLevPnl: 25,
    trailGivebackPct: 0.50,
    tp1ClosePct: 0.50,
    tp2ClosePct: 1.0,
    tradingHours: [[0, 4], [5, 16], [19, 24]],
    entryMode: 'hybrid',
    hybridThreshold: 30,
  });

  // Init swing trade executor — daily timeframe, wide stops, long hold
  const swingTradeExecutor = new TradeExecutor(listingMonitor.exchanges, {
    settingsKey: 'swing',
    mode: 'live',
    maxPositionSize: 10,
    maxDailyLoss: 50,
    maxLossPerTrade: 15,
    maxConcurrentPositions: 3,
    defaultLeverage: 20,
    minConfidence: 3,
    paperBalance: 500,
    dynamicLeverage: false,
    dcaEnabled: false,
    signalFilter: new Set(['SWING_SETUP']),
    maxTradeAge: 14 * 24 * 60 * 60 * 1000,
    timeExitMinutes: 0,
    profitProtectPct: 15,
    profitProtectLevPnl: 50,
    trailAtrMultPre: 3,
    trailAtrMultPost: 5,
  });

  // Init demand zone executor — paper-trades ALL demand zone signals for performance tracking
  const dzTradeExecutor = new TradeExecutor(listingMonitor.exchanges, {
    settingsKey: 'demandzone',
    mode: 'paper',
    maxPositionSize: 20,
    maxDailyLoss: 100,
    maxLossPerTrade: 10,
    maxConcurrentPositions: 10,
    defaultLeverage: 5,
    minConfidence: 3,
    paperBalance: 1000,
    dynamicLeverage: false,
    dcaEnabled: false,
    confidenceScaling: false,
    signalFilter: new Set(['DEMAND_ZONE_SETUP']),
  });

  // Init swing scanner
  const swingScanner = new SwingScanner(listingMonitor.exchanges, flowScanner, onchainScanner);

  // Load persisted settings and today's PnL from DB
  if (dbReady) {
    await tradeExecutor.loadConfig();
    await tradeExecutor.recalcDailyPnL();
    await onchainTradeExecutor.loadConfig();
    await onchainTradeExecutor.recalcDailyPnL();
    await swingTradeExecutor.loadConfig();
    await swingTradeExecutor.recalcDailyPnL();
    await dzTradeExecutor.loadConfig();
    await dzTradeExecutor.recalcDailyPnL();
  }

  // Init Telegram bot
  const bot = new TelegramBot({ technicalScanner, socialScanner, onchainTracker, onchainScanner, flowScanner, marketIntel, tradeExecutor, onchainTradeExecutor, swingTradeExecutor, swingScanner, dzTradeExecutor });

  // Per-user virtual paper accounts (pass bot for user notifications)
  const userPaperEngine = new UserPaperEngine(listingMonitor.exchanges, bot.bot);
  bot.userPaperEngine = userPaperEngine;

  // Wire trade executor notifications to Telegram
  tradeExecutor.onTradeUpdate(async (msg) => {
    await bot.sendRaw(msg);
  });

  // Wire onchain trade executor notifications
  onchainTradeExecutor.onTradeUpdate(async (msg) => {
    await bot.sendRaw(`🔗 <b>[ONCHAIN]</b> ${msg}`);
  });

  // Wire swing trade executor notifications
  swingTradeExecutor.onTradeUpdate(async (msg) => {
    await bot.sendRaw(`🌊 <b>[SWING]</b> ${msg}`);
  });

  // Wire demand zone executor notifications
  dzTradeExecutor.onTradeUpdate(async (msg) => {
    await bot.sendRaw(`🎯 <b>[DZ]</b> ${msg}`);
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
            const fundMsg = `📉 <b>FUNDING ALERT</b>\n\n` +
              `<b>${opp.symbol}</b> on ${opp.exchange}\n` +
              `${opp.reason}\n` +
              `Suggested: ${opp.direction.toUpperCase()}\n\n` +
              `<i>Mean reversion opportunity — DYOR</i>`;
            await bot.sendRaw(fundMsg);
            await bot.broadcastToUsers(fundMsg);
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
        if (msg) {
          await bot.sendRaw(msg);
          await bot.broadcastToUsers(msg);
        }
      }
      if (updates.length) logger.info(`Tracker: ${updates.length} signal updates`);
    } catch (err) {
      logger.error(`Signal tracker error: ${err.message}`);
    }
  });

  // Evaluate per-user virtual paper trades every minute
  cron.schedule('* * * * *', async () => {
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


  // === Fast OI Spike Detector — every 2 min, lightweight ===
  cron.schedule('*/2 * * * *', async () => {
    try {
      const spikes = await onchainScanner.quickOIScan();
      for (const spike of spikes.slice(0, 3)) {
        const dir = spike.direction.toLowerCase();
        if (!shouldLogAlert('OI_SPIKE', spike.symbol, dir)) continue;
        const msg = onchainScanner.formatOISpike(spike);
        await bot.sendRaw(msg);
        await db.logAlert('OI_SPIKE', spike.symbol, {
          price: spike.price, direction: spike.direction.toLowerCase(),
          oiChange1h: spike.oiChange1h, priceChange: spike.priceChange,
          exchange: spike.exchange, pair: spike.pair, volume: spike.volume,
        }, `OI_SPIKE ${spike.direction} ${spike.symbol} +${spike.oiChange1h.toFixed(0)}%`).catch(() => {});
      }
    } catch (err) {
      logger.error(`OI spike scan error: ${err.message}`);
    }
  });

  // === Onchain Scanner — OI + Funding rate analysis every 5 min ===
  cron.schedule('*/5 * * * *', async () => {
    try {
      const results = await onchainScanner.scan();
      const hotTokens = results.filter(r => r.score >= 40);
      if (hotTokens.length > 0) {
        for (const token of hotTokens) {
          try {
            token._tradeSetup = await onchainScanner.buildTradeSetup(token, listingMonitor.exchanges, 'ONCHAIN_SETUP', { volatilityFilter: onchainTradeExecutor.volatilityFilter, max4hRange: onchainTradeExecutor.max4hRange, minTopLS: onchainTradeExecutor.minTopLS, exhaustionFilter: onchainTradeExecutor.exhaustionFilter, minOiLong: onchainTradeExecutor.minOiLong, minExhScore: onchainTradeExecutor.minExhScore, minExhRsi: onchainTradeExecutor.minExhRsi });
          } catch (e) {
            token._setupError = e.message;
          }
        }
        // Attach prior alert tracking data for inline PnL display
        try {
          const priorAlerts = await db.getActiveAlerts(['ONCHAIN', 'FLOW', 'OI_SPIKE', 'SUPPLY_MOVE'], 48);
          const priorBySymbol = {};
          for (const a of priorAlerts) priorBySymbol[a.symbol] = a;
          for (const token of hotTokens) {
            const prior = priorBySymbol[token.symbol];
            if (prior && prior.data?.price) {
              const priorDir = prior.data.direction || 'long';
              const currentDir = token._tradeSetup?.direction || (token.fundingBias === 'bullish' || token.priceChange > 0 ? 'long' : 'short');
              if (priorDir !== currentDir) {
                // Direction flipped — record final PnL on the old alert before starting fresh
                const oldEntry = parseFloat(prior.data.first_alert_price || prior.data.price);
                const oldRaw = ((token.price - oldEntry) / oldEntry) * 100;
                const flipPnl = priorDir === 'short' ? -oldRaw : oldRaw;
                db.updateAlertPerformance(prior.id, {
                  direction_flipped: true,
                  flip_to: currentDir,
                  flip_price: token.price,
                  flip_pnl: parseFloat(flipPnl.toFixed(2)),
                  flip_at: new Date().toISOString(),
                  invalidated: true,
                }).catch(() => {});
                token._alertTracking = {
                  firstAlertedAt: new Date().toISOString(),
                  entryPrice: token.price,
                  direction: currentDir,
                  pnl: 0,
                  bestPnl: 0,
                  worstPnl: 0,
                  alertCount: 0,
                  flippedFrom: priorDir,
                  flipPnl: parseFloat(flipPnl.toFixed(2)),
                };
                continue;
              }
              const entryPrice = parseFloat(prior.data.first_alert_price || prior.data.price);
              const firstAlertedAt = prior.data.first_alert_at || prior.created_at;
              const rawPnl = ((token.price - entryPrice) / entryPrice) * 100;
              token._alertTracking = {
                firstAlertedAt,
                entryPrice,
                direction: priorDir,
                pnl: priorDir === 'short' ? -rawPnl : rawPnl,
                bestPnl: parseFloat(prior.data.best_pnl) || 0,
                worstPnl: parseFloat(prior.data.worst_pnl) || 0,
                alertCount: parseInt(prior.data.alert_count) || 1,
                tp1Hit: prior.data.tp1_hit || false,
                tp2Hit: prior.data.tp2_hit || false,
              };
            }
          }
        } catch (e) { logger.debug(`Alert tracking lookup failed: ${e.message}`); }

        const qualityTokens = hotTokens.filter(t => {
          const passes = onchainScanner.passesQualityGate(t, { minShortScore: onchainTradeExecutor.minShortScore || 45 });
          if (!passes && t._tradeSetup) {
            db.logSkip(t.symbol, { direction: t._tradeSetup.direction || (t.priceChange > 0 ? 'long' : 'short'), score: t.score, price: t.price, blockReason: 'Quality gate rejected', blockStage: 'pre_filter', source: 'onchain', onchainData: { oiChange1h: t.oiChange1h, oiChange4h: t.oiChange4h, fundingRate: t.fundingRate, fundingBias: t.fundingBias, priceChange: t.priceChange, volume: t.volume, signals: t.signals, exchange: t.exchange } }).catch(() => {});
          }
          return passes;
        });
        const msg = onchainScanner.formatAlerts(qualityTokens, 5);
        if (msg) {
          await bot.sendRaw(msg);
          await bot.broadcastToUsers(msg);
        }

        for (const token of qualityTokens) {
          const dir = (token.fundingBias === 'bullish' || token.priceChange > 0) ? 'long' : 'short';
          if (!shouldLogAlert('ONCHAIN', token.symbol, dir)) continue;
          const setup = token._tradeSetup;
          const priorCount = token._alertTracking?.alertCount || 0;
          await db.logAlert('ONCHAIN', token.symbol, {
            score: token.score, price: token.price, direction: setup?.direction || dir,
            exchange: token.exchange, pair: token.pair,
            oiChange1h: token.oiChange1h, oiChange4h: token.oiChange4h,
            fundingRate: token.fundingRate, fundingBias: token.fundingBias,
            priceChange: token.priceChange, volume: token.volume,
            signals: token.signals,
            lsData: token.lsData || null,
            exchangeFlow: token.exchangeFlow || null,
            setupData: token.setupData ? {
              liquidations: token.setupData.liquidations || null,
              orderBook: token.setupData.orderBook || null,
            } : null,
            alert_count: priorCount + 1,
            first_alert_price: token._alertTracking?.entryPrice || token.price,
            first_alert_at: token._alertTracking?.firstAlertedAt || new Date().toISOString(),
            tp1: setup?.tp1, tp2: setup?.tp2, tp3: setup?.tp3,
            stopLoss: setup?.stopLoss, atr: setup?.atr,
            confidence: setup?.confidence,
          }, `ONCHAIN ${setup?.direction || dir} ${token.symbol} score=${token.score}`).catch(() => {});
        }

        // Auto-trade onchain signals — reuse _tradeSetup from alert phase
        // (calling buildTradeSetup again can flip direction between neutral/long)
        const ocMinScore = onchainTradeExecutor.minOcScore || (onchainTradeExecutor.minConfidence >= 5 ? 60 : onchainTradeExecutor.minConfidence >= 4 ? 45 : 35);
        const buildSkipData = (token, setup) => ({
          oiChange1h: token.oiChange1h, oiChange4h: token.oiChange4h,
          fundingRate: token.fundingRate, fundingBias: token.fundingBias,
          priceChange: token.priceChange, volume: token.volume,
          signals: token.signals, lsData: token.lsData || null,
          exchangeFlow: token.exchangeFlow || null,
          exhaustion: setup?.onchainContext?.exhaustion || false,
          exhaustionScore: setup?.onchainContext?.exhaustionScore || 0,
          crowdedFlip: setup?.onchainContext?.crowdedFlip || false,
          tp1: setup?.tp1, tp2: setup?.tp2, tp3: setup?.tp3,
          stopLoss: setup?.stopLoss, atr: setup?.atr,
          confidence: setup?.confidence, exchange: token.exchange,
        });

        for (const token of qualityTokens) {
          if (!onchainTradeExecutor.enabled) continue;
          try {
            const setup = token._tradeSetup;
            if (!setup) {
              db.logSkip(token.symbol, { direction: token.priceChange > 0 ? 'long' : 'short', score: token.score, price: token.price, blockReason: token._rejectReason || `No trade setup built${token._setupError ? ': ' + token._setupError : ''}`, blockStage: 'pre_filter', source: 'onchain', onchainData: { oiChange1h: token.oiChange1h, oiChange4h: token.oiChange4h, fundingRate: token.fundingRate, priceChange: token.priceChange, volume: token.volume, signals: token.signals, exchange: token.exchange } }).catch(() => {});
              continue;
            }
            const isReversalShort = (setup.onchainContext?.exhaustion || setup.onchainContext?.crowdedFlip) && setup.direction === 'short';
            if (token.score < ocMinScore && !isReversalShort) {
              db.logSkip(token.symbol, { direction: setup.direction, score: token.score, price: token.price, blockReason: `Score ${token.score} < minOcScore ${ocMinScore}`, blockStage: 'pre_filter', source: 'onchain', onchainData: buildSkipData(token, setup) }).catch(() => {});
              continue;
            }
            const ocMaxScore = onchainTradeExecutor.maxOcScore || 69;
            const minShortScore = onchainTradeExecutor.minShortScore || 70;
            if (setup.direction === 'long' && token.score > ocMaxScore) {
              logger.info(`Onchain skip ${token.symbol}: LONG score ${token.score} > ${ocMaxScore} — likely exhausted pump, alert only`);
              db.logSkip(token.symbol, { direction: 'long', score: token.score, price: token.price, blockReason: `Long score ${token.score} > maxOcScore ${ocMaxScore}`, blockStage: 'pre_filter', source: 'onchain', onchainData: buildSkipData(token, setup) }).catch(() => {});
              continue;
            }
            if (setup.direction === 'short' && token.score < minShortScore && !isReversalShort) {
              logger.info(`Onchain skip ${token.symbol}: SHORT score ${token.score} < ${minShortScore} — not enough conviction`);
              db.logSkip(token.symbol, { direction: 'short', score: token.score, price: token.price, blockReason: `Short score ${token.score} < minShortScore ${minShortScore}`, blockStage: 'pre_filter', source: 'onchain', onchainData: buildSkipData(token, setup) }).catch(() => {});
              continue;
            }
            const pumpLimit = token.score >= 60 ? 200 : token.score >= 45 ? 150 : 80;
            if (Math.abs(token.priceChange) > pumpLimit) {
              logger.info(`Onchain skip ${token.symbol}: price moved ${token.priceChange.toFixed(1)}% (limit ${pumpLimit}% for score ${token.score}) — late entry risk`);
              db.logSkip(token.symbol, { direction: setup.direction, score: token.score, price: token.price, blockReason: `Price moved ${token.priceChange.toFixed(1)}% > limit ${pumpLimit}% — late entry`, blockStage: 'pre_filter', source: 'onchain', onchainData: buildSkipData(token, setup) }).catch(() => {});
              continue;
            }
            // Entry drift check: skip if price drifted >2% from recent alert (falling knife)
            let driftBlocked = false;
            try {
              const { rows: recentAlerts } = await db.query(
                `SELECT (data->>'price')::numeric as price, data->>'direction' as dir
                 FROM alert_log WHERE symbol = $1 AND alert_type = 'ONCHAIN'
                 AND created_at > NOW() - INTERVAL '1 hour'
                 ORDER BY created_at ASC LIMIT 1`,
                [token.symbol]
              );
              if (recentAlerts.length) {
                const firstAlertPrice = parseFloat(recentAlerts[0].price);
                const driftPct = ((token.price - firstAlertPrice) / firstAlertPrice) * 100;
                const badDrift = setup.direction === 'long' ? (driftPct < -5 || driftPct > 10) : (driftPct > 5 || driftPct < -10);
                if (badDrift) {
                  const reason = (setup.direction === 'long' ? driftPct > 0 : driftPct < 0) ? 'chasing pump' : 'falling knife';
                  logger.info(`Onchain skip ${token.symbol}: entry drifted ${driftPct.toFixed(1)}% from first alert $${firstAlertPrice.toPrecision(4)} — ${reason}`);
                  db.logSkip(token.symbol, { direction: setup.direction, score: token.score, price: token.price, blockReason: `Entry drift ${driftPct.toFixed(1)}% from alert price $${firstAlertPrice.toPrecision(4)} — ${reason}`, blockStage: 'pre_filter', source: 'onchain', onchainData: { ...buildSkipData(token, setup), firstAlertPrice, driftPct } }).catch(() => {});
                  driftBlocked = true;
                }
              }
            } catch (e) { /* skip drift check on error */ }
            if (driftBlocked) continue;
            await onchainTradeExecutor.queueSignal(setup);
          } catch (e) {
            logger.debug(`Onchain auto-trade failed for ${token.symbol}: ${e.message}`);
          }
        }

        // Open paper trades for users following onchain signals
        for (const token of hotTokens) {
          const setup = token._tradeSetup;
          if (!setup) continue;
          try {
            await userPaperEngine.openForOnchainFollowers(setup, token.score);
          } catch (e) { logger.debug(`User onchain paper failed ${token.symbol}: ${e.message}`); }
        }

        // Send large transfer alerts for tokens with heavy supply movement
        for (const token of hotTokens.slice(0, 3)) {
          if (!token.exchangeFlow?.largeTransfers?.length) continue;
          const flow = token.exchangeFlow;
          const totalFlowUsd = (flow.inflowAmount + flow.outflowAmount) * (token.price || 0);
          if (totalFlowUsd < 50000) continue; // Only alert if >$50K total flow
          if (!shouldLogAlert('SUPPLY_MOVE', token.symbol, flow.bias)) continue;
          const transferMsg = onchainTracker.formatLargeTransferAlert(flow, token.price);
          if (transferMsg) {
            await bot.sendRaw(transferMsg);
            await bot.broadcastToUsers(transferMsg);
          }
          await db.logAlert('SUPPLY_MOVE', token.symbol, {
            price: token.price, direction: flow.bias === 'bearish' ? 'short' : 'long',
            exchange: token.exchange, pair: token.pair,
            inflowUsd: flow.inflowAmount * (token.price || 0),
            outflowUsd: flow.outflowAmount * (token.price || 0),
            netFlowUsd: flow.netFlow * (token.price || 0),
            transferCount: flow.largeTransfers.length,
            exchanges: flow.exchanges,
          }, `SUPPLY_MOVE ${flow.bias} ${token.symbol} ${flow.largeTransfers.length} transfers`).catch(() => {});
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
              const cap = `📸 <b>${token.symbol}</b> Setup Snapshot — Score: ${token.score}/100`;
              await bot.sendRawPhoto(chartBuf, cap);
              await bot.broadcastPhotoToUsers(chartBuf, cap);
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
  // === Demand Zone Scanner — 4H pre-breakout zone detection every 15 min ===
  cron.schedule('*/15 * * * *', async () => {
    try {
      const results = await onchainScanner.scanDemandZones();
      // Cross-scanner dedup: skip symbols onchain executor already has open positions on
      const ocOpen = await db.getOpenTrades('onchain').catch(() => []);
      const ocSymbols = new Set(ocOpen.map(t => t.symbol));
      const qualified = results.filter(r => r.score >= 30 && !ocSymbols.has(r.symbol));
      if (!qualified.length) return;

      for (const token of qualified) {
        try {
          token._tradeSetup = onchainScanner.buildDemandZoneSetup(token);
          token._liveSetup = onchainScanner.buildDemandZoneSetup(token, { requireBounce: true });
        } catch (e) { /* skip */ }
      }

      // Attach prior alert tracking data for inline PnL display
      try {
        const priorDzAlerts = await db.getActiveAlerts(['DEMAND_ZONE'], 48);
        const priorBySymbol = {};
        for (const a of priorDzAlerts) priorBySymbol[a.symbol] = a;
        for (const token of qualified) {
          const prior = priorBySymbol[token.symbol];
          if (prior && prior.data?.price) {
            const priorDir = prior.data.direction || 'long';
            const entryPrice = parseFloat(prior.data.first_alert_price || prior.data.price);
            const firstAlertedAt = prior.data.first_alert_at || prior.created_at;
            const rawPnl = ((token.price - entryPrice) / entryPrice) * 100;
            token._alertTracking = {
              firstAlertedAt,
              entryPrice,
              direction: priorDir,
              pnl: priorDir === 'short' ? -rawPnl : rawPnl,
              bestPnl: parseFloat(prior.data.best_pnl) || 0,
              worstPnl: parseFloat(prior.data.worst_pnl) || 0,
              alertCount: parseInt(prior.data.alert_count) || 1,
              tp1Hit: prior.data.tp1_hit || false,
              tp2Hit: prior.data.tp2_hit || false,
              slHit: prior.data.sl_hit || false,
            };
          }
        }
      } catch (e) { logger.debug(`DZ alert tracking lookup failed: ${e.message}`); }

      const dzOpenTrades = await db.getOpenTrades('demandzone').catch(() => []);
      const msg = onchainScanner.formatDemandZoneAlerts(qualified, 5, dzOpenTrades);
      if (msg) {
        await bot.sendRaw(msg);
        await bot.broadcastToUsers(msg);
      }

      for (const token of qualified) {
        const dir = token.zone?.breakoutDir || 'long';
        if (!shouldLogAlert('DEMAND_ZONE', token.symbol, dir)) continue;
        const setup = token._tradeSetup;
        const priorCount = token._alertTracking?.alertCount || 0;
        await db.logAlert('DEMAND_ZONE', token.symbol, {
          score: token.score, price: token.price, direction: dir,
          exchange: token.exchange, pair: token.pair,
          zone: token.zone ? { low: token.zone.zoneLow, high: token.zone.zoneHigh, range: token.zone.zoneRange } : null,
          inZone: token.inZone, distToZone: token.distToZone,
          signals: token.signals,
          oiChange4h: token.oiChange4h, exchangeFlow: token.exchangeFlow || null,
          lsData: token.lsData || null,
          tp1: setup?.tp1, tp2: setup?.tp2, tp3: setup?.tp3,
          stopLoss: setup?.stopLoss, atr: setup?.atr,
          confidence: setup?.confidence,
          alert_count: priorCount + 1,
          first_alert_price: token._alertTracking?.entryPrice || token.price,
          first_alert_at: token._alertTracking?.firstAlertedAt || new Date().toISOString(),
        }, `DEMAND_ZONE ${dir} ${token.symbol} score=${token.score}`).catch(() => {});
      }

      // Paper-trade ALL demand zone signals for performance tracking
      for (const token of qualified) {
        const setup = token._tradeSetup;
        if (!setup) continue;
        try {
          await dzTradeExecutor.queueSignal(setup);
        } catch (e) {
          logger.debug(`DZ paper-trade failed for ${token.symbol}: ${e.message}`);
        }
      }

      // Auto-trade demand zone signals — ONLY with bounce confirmation
      const dzMinScore = dzTradeExecutor.minOcScore || 30;
      for (const token of qualified) {
        if (token.score < dzMinScore || !dzTradeExecutor.enabled) continue;
        const setup = token._liveSetup;
        if (!setup) continue;
        try {
          await onchainTradeExecutor.queueSignal(setup);
        } catch (e) {
          logger.debug(`Demand zone auto-trade failed for ${token.symbol}: ${e.message}`);
        }
      }

      for (const token of qualified) {
        if (token.score < 45) continue;
        const setup = token._tradeSetup;
        if (!setup) continue;
        try {
          await userPaperEngine.openForOnchainFollowers(setup, token.score);
        } catch (e) { logger.debug(`User demand zone paper failed ${token.symbol}: ${e.message}`); }
      }

      logger.info(`Demand zone scan: ${qualified.length} zones, top=${qualified[0]?.symbol} score=${qualified[0]?.score}`);
    } catch (err) {
      logger.error(`Demand zone scan error: ${err.message}`);
    }
  });

  // === Swing Scanner — daily timeframe accumulation reversal detection every 2h ===
  cron.schedule('0 */2 * * *', async () => {
    logger.info('Running swing scan...');
    try {
      const results = await swingScanner.scan();
      const qualified = results.filter(r => r.score >= 35);

      // Load prior swing alerts for PnL tracking
      let swingPriorBySymbol = {};
      try {
        const priorSwAlerts = await db.getActiveAlerts(['SWING'], 336);
        for (const a of priorSwAlerts) swingPriorBySymbol[a.symbol] = a;
      } catch (e) { logger.debug(`Swing alert tracking lookup failed: ${e.message}`); }

      for (const candidate of qualified.slice(0, 5)) {
        try {
          const setup = await swingScanner.buildSwingSetup(candidate);
          if (!setup) continue;

          // Attach alert tracking for inline PnL
          const prior = swingPriorBySymbol[setup.symbol];
          if (prior && prior.data?.price) {
            const entryPrice = parseFloat(prior.data.first_alert_price || prior.data.price);
            const firstAlertedAt = prior.data.first_alert_at || prior.created_at;
            const rawPnl = ((setup.currentPrice - entryPrice) / entryPrice) * 100;
            const dir = prior.data.direction || 'long';
            setup._alertTracking = {
              firstAlertedAt,
              entryPrice,
              direction: dir,
              pnl: dir === 'short' ? -rawPnl : rawPnl,
              bestPnl: parseFloat(prior.data.best_pnl) || 0,
              worstPnl: parseFloat(prior.data.worst_pnl) || 0,
              alertCount: parseInt(prior.data.alert_count) || 1,
              tp1Hit: prior.data.tp1_hit || false,
              tp2Hit: prior.data.tp2_hit || false,
              slHit: prior.data.sl_hit || false,
            };
          }

          const msg = swingScanner.formatSwingAlert(setup, candidate);
          await bot.sendRaw(msg);
          await bot.broadcastToUsers(msg);

          const priorCount = setup._alertTracking?.alertCount || 0;
          await db.logAlert('SWING', setup.symbol, {
            score: setup.score, price: setup.currentPrice,
            direction: 'long', exchange: setup.exchange, pair: setup.pair,
            tp1: setup.tp1, tp2: setup.tp2, tp3: setup.tp3,
            stopLoss: setup.stopLoss, rr: setup.rr,
            signals: candidate.signals,
            ninetyDayHigh: candidate.ninetyDayHigh,
            ninetyDayLow: candidate.ninetyDayLow,
            alert_count: priorCount + 1,
            first_alert_price: setup._alertTracking?.entryPrice || setup.currentPrice,
            first_alert_at: setup._alertTracking?.firstAlertedAt || new Date().toISOString(),
          }, `SWING long ${setup.symbol} score=${setup.score}`).catch(() => {});

          swingScanner.addToWatchlist(setup);

          // Always paper-trade swing setups for analytics — score 45+ auto-enters
          if (setup.score >= 45) {
            await swingTradeExecutor.queueSignal(setup);
          }

          // Open paper trades for users following swing signals
          try {
            await userPaperEngine.openForSwingFollowers(setup, setup.score);
          } catch (e) { logger.debug(`User swing paper failed: ${e.message}`); }
        } catch (e) {
          logger.debug(`Swing setup failed for ${candidate.symbol}: ${e.message}`);
        }
      }

      if (qualified.length) {
        logger.info(`Swing scan: ${qualified.length} candidates, top=${qualified[0]?.symbol} score=${qualified[0]?.score}`);
      }
    } catch (err) {
      logger.error(`Swing scan error: ${err.message}`);
    }
  });

  // === Swing Watchlist — check if prices entered buy zones every 15 min ===
  cron.schedule('*/15 * * * *', async () => {
    try {
      const entered = await swingScanner.checkWatchlist();
      for (const setup of entered) {
        // Always paper-trade watchlist zone entries for analytics
        await swingTradeExecutor.queueSignal(setup);
        const msg = `🌊 <b>SWING ENTRY ZONE</b> — $${setup.symbol}\n\n` +
          `Price entered buy zone: $${setup.currentPrice.toPrecision(4)}\n` +
          `Zone: $${setup.entryLow.toPrecision(4)} — $${setup.entryHigh.toPrecision(4)}`;
        await bot.sendRaw(msg);
      }
    } catch (err) {
      logger.error(`Swing watchlist error: ${err.message}`);
    }
  });

  // === Flow Scanner — standalone exchange flow detection every 10 min ===
  cron.schedule('*/10 * * * *', async () => {
    try {
      const results = await flowScanner.scan();
      const significant = results.filter(r => r.flowScore >= 15);
      if (significant.length > 0) {
        for (const token of significant) {
          try {
            if (token.flow && !token.exchangeFlow) token.exchangeFlow = token.flow;
            token.tradeSetup = await onchainScanner.buildTradeSetup(token, listingMonitor.exchanges, 'FLOW_SETUP', { volatilityFilter: onchainTradeExecutor.volatilityFilter, max4hRange: onchainTradeExecutor.max4hRange, minTopLS: onchainTradeExecutor.minTopLS, exhaustionFilter: onchainTradeExecutor.exhaustionFilter, minOiLong: onchainTradeExecutor.minOiLong, minExhScore: onchainTradeExecutor.minExhScore, minExhRsi: onchainTradeExecutor.minExhRsi });
          } catch (e) { /* skip */ }
        }
        // Attach prior alert tracking for inline PnL on flow alerts
        try {
          const priorAlerts = await db.getActiveAlerts(['ONCHAIN', 'FLOW', 'OI_SPIKE', 'SUPPLY_MOVE'], 48);
          const priorBySymbol = {};
          for (const a of priorAlerts) priorBySymbol[a.symbol] = a;
          for (const token of significant) {
            const prior = priorBySymbol[token.symbol];
            if (prior && prior.data?.price) {
              const priorDir = prior.data.direction || 'long';
              const currentDir = token.flow?.outflowCount > token.flow?.inflowCount ? 'long' : 'short';
              if (priorDir !== currentDir) {
                const oldEntry = parseFloat(prior.data.first_alert_price || prior.data.price);
                const oldRaw = ((token.price - oldEntry) / oldEntry) * 100;
                const flipPnl = priorDir === 'short' ? -oldRaw : oldRaw;
                db.updateAlertPerformance(prior.id, {
                  direction_flipped: true,
                  flip_to: currentDir,
                  flip_price: token.price,
                  flip_pnl: parseFloat(flipPnl.toFixed(2)),
                  flip_at: new Date().toISOString(),
                  invalidated: true,
                }).catch(() => {});
                token._alertTracking = {
                  firstAlertedAt: new Date().toISOString(),
                  entryPrice: token.price,
                  direction: currentDir,
                  pnl: 0,
                  bestPnl: 0,
                  worstPnl: 0,
                  alertCount: 0,
                  flippedFrom: priorDir,
                  flipPnl: parseFloat(flipPnl.toFixed(2)),
                };
                continue;
              }
              const entryPrice = parseFloat(prior.data.first_alert_price || prior.data.price);
              const firstAlertedAt = prior.data.first_alert_at || prior.created_at;
              const rawPnl = ((token.price - entryPrice) / entryPrice) * 100;
              token._alertTracking = {
                firstAlertedAt,
                entryPrice,
                direction: priorDir,
                pnl: priorDir === 'short' ? -rawPnl : rawPnl,
                bestPnl: parseFloat(prior.data.best_pnl) || 0,
                worstPnl: parseFloat(prior.data.worst_pnl) || 0,
                alertCount: parseInt(prior.data.alert_count) || 1,
                tp1Hit: prior.data.tp1_hit || false,
                tp2Hit: prior.data.tp2_hit || false,
              };
            }
          }
        } catch (e) { logger.debug(`Flow alert tracking lookup failed: ${e.message}`); }

        const msg = flowScanner.formatAlerts(significant, 5);
        if (msg) {
          await bot.sendRaw(msg);
          await bot.broadcastToUsers(msg);
        }

        for (const token of significant) {
          const dir = token.flow?.outflowCount > token.flow?.inflowCount ? 'long' : 'short';
          if (!shouldLogAlert('FLOW', token.symbol, dir)) continue;
          const priorCount = token._alertTracking?.alertCount || 0;
          await db.logAlert('FLOW', token.symbol, {
            flowScore: token.flowScore, price: token.price, direction: dir,
            alert_count: priorCount + 1,
            first_alert_price: token._alertTracking?.entryPrice || token.price,
            first_alert_at: token._alertTracking?.firstAlertedAt || new Date().toISOString(),
            exchange: token.exchange, pair: token.pair,
            priceChange: token.priceChange,
            outflowCount: token.flow?.outflowCount, inflowCount: token.flow?.inflowCount,
            netFlow: token.flow?.netFlow,
          }, `FLOW ${dir} ${token.symbol} score=${token.flowScore}`).catch(() => {});
        }

        // Flow auto-trade disabled — flow signals are alerts-only (negative 4h avg -4.2%)
        // Onchain auto-trade (ONCHAIN_SETUP) is unaffected

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
              const cap = `📸 <b>${token.symbol}</b> Flow Snapshot — Score: ${token.flowScore}`;
              await bot.sendRawPhoto(chartBuf, cap);
              await bot.broadcastPhotoToUsers(chartBuf, cap);
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
          if (escMsg) {
            await bot.sendRaw(escMsg);
            await bot.broadcastToUsers(escMsg);
          }
        }
      }
      if (results.length) {
        logger.info(`FlowScanner: top=${results[0]?.symbol} score=${results[0]?.flowScore}, ${significant.length} significant`);
      }
    } catch (err) {
      logger.error(`Flow scanner error: ${err.message}`);
    }
  });

  // === Alert Performance Tracker — check prices for past alerts every 5 min ===
  cron.schedule('*/5 * * * *', async () => {
    try {
      const unchecked = await db.getUncheckedAlerts(['ONCHAIN', 'FLOW', 'OI_SPIKE', 'SUPPLY_MOVE', 'DEMAND_ZONE', 'SWING'], 10);
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

          // Continuous best/worst PnL tracking — updated every check
          const prevBest = parseFloat(alert.data?.best_pnl) || 0;
          const prevWorst = parseFloat(alert.data?.worst_pnl) || 0;
          if (pnl > prevBest) { updates.best_pnl = parseFloat(pnl.toFixed(2)); updates.best_price = currentPrice; }
          if (pnl < prevWorst) { updates.worst_pnl = parseFloat(pnl.toFixed(2)); updates.worst_price = currentPrice; }

          // Checkpoint snapshots — 15m, 30m, 1h, 4h, 24h
          if (!alert.data.checked_15m && ageHours >= 0.25) {
            updates.checked_15m = true; updates.price_15m = currentPrice; updates.pnl_15m = parseFloat(pnl.toFixed(2));
          }
          if (!alert.data.checked_30m && ageHours >= 0.5) {
            updates.checked_30m = true; updates.price_30m = currentPrice; updates.pnl_30m = parseFloat(pnl.toFixed(2));
          }
          if (!alert.data.checked_1h && ageHours >= 1) {
            updates.checked_1h = true; updates.price_1h = currentPrice; updates.pnl_1h = parseFloat(pnl.toFixed(2));
          }
          if (!alert.data.checked_4h && ageHours >= 4) {
            updates.checked_4h = true; updates.price_4h = currentPrice; updates.pnl_4h = parseFloat(pnl.toFixed(2));
          }
          if (!alert.data.checked_24h && ageHours >= 24) {
            updates.checked_24h = true; updates.price_24h = currentPrice; updates.pnl_24h = parseFloat(pnl.toFixed(2));
            updates.direction_correct = pnl > 0;
          }

          // TP hit tracking — check if price reached TP levels from the trade setup
          if (!alert.data.tp1_hit) {
            const tp1 = parseFloat(alert.data?.tp1);
            if (tp1 && (direction === 'long' ? currentPrice >= tp1 : currentPrice <= tp1)) {
              updates.tp1_hit = true; updates.tp1_hit_at = new Date().toISOString();
              updates.tp1_time_min = Math.round(ageHours * 60);
            }
          }
          if (!alert.data.tp2_hit) {
            const tp2 = parseFloat(alert.data?.tp2);
            if (tp2 && (direction === 'long' ? currentPrice >= tp2 : currentPrice <= tp2)) {
              updates.tp2_hit = true; updates.tp2_hit_at = new Date().toISOString();
              updates.tp2_time_min = Math.round(ageHours * 60);
            }
          }
          if (!alert.data.tp3_hit) {
            const tp3 = parseFloat(alert.data?.tp3);
            if (tp3 && (direction === 'long' ? currentPrice >= tp3 : currentPrice <= tp3)) {
              updates.tp3_hit = true; updates.tp3_hit_at = new Date().toISOString();
              updates.tp3_time_min = Math.round(ageHours * 60);
            }
          }

          // SL hit tracking
          if (!alert.data.sl_hit) {
            const sl = parseFloat(alert.data?.stopLoss || alert.data?.sl);
            if (sl && (direction === 'long' ? currentPrice <= sl : currentPrice >= sl)) {
              updates.sl_hit = true; updates.sl_hit_at = new Date().toISOString();
              updates.sl_time_min = Math.round(ageHours * 60);
            }
          }

          // Flag if this alert had exchange flow data
          if (alert.data.has_flow === undefined) {
            const signals = alert.data?.signals || [];
            updates.has_flow = signals.some(s => typeof s === 'string' && (s.includes('outflow') || s.includes('OUTFLOW')));
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

  // === Alert Invalidation Checker — every 10 min, checks if active alerts flipped ===
  cron.schedule('3,13,23,33,43,53 * * * *', async () => {
    try {
      const activeAlerts = await db.getActiveAlerts(['ONCHAIN', 'FLOW', 'OI_SPIKE', 'SUPPLY_MOVE', 'DEMAND_ZONE', 'SWING'], 2);
      if (!activeAlerts.length) return;

      for (const alert of activeAlerts) {
        try {
          const pair = alert.data?.pair;
          const exchangeId = alert.data?.exchange;
          const alertPrice = parseFloat(alert.data?.price);
          const origDir = alert.data?.direction;
          if (!pair || !exchangeId || !alertPrice || !origDir) continue;

          const exchange = listingMonitor.exchanges[exchangeId];
          if (!exchange) continue;
          const ticker = await exchange.fetchTicker(pair);
          if (!ticker?.last) continue;

          const currentPrice = ticker.last;
          const pricePnl = ((currentPrice - alertPrice) / alertPrice) * 100;
          const dirPnl = origDir === 'short' ? -pricePnl : pricePnl;

          // Invalidate threshold: swing/DZ use SL level if available, otherwise wider threshold
          const alertSl = parseFloat(alert.data?.stopLoss || alert.data?.sl);
          let invalidateThreshold = -3;
          if (alert.alert_type === 'SWING' || alert.alert_type === 'DEMAND_ZONE') {
            if (alertSl) {
              const slPct = origDir === 'long'
                ? ((alertSl - alertPrice) / alertPrice) * 100
                : ((alertPrice - alertSl) / alertPrice) * 100;
              invalidateThreshold = slPct;
            } else {
              invalidateThreshold = -8;
            }
          }
          if (dirPnl < invalidateThreshold) {
            await db.updateAlertPerformance(alert.id, { invalidated: true, invalidated_at: new Date().toISOString(), invalidation_pnl: parseFloat(dirPnl.toFixed(2)) });

            const emoji = origDir === 'long' ? '📉' : '📈';
            const msg = `⚠️ <b>ALERT INVALIDATED</b>\n\n` +
              `${emoji} <b>${alert.symbol}</b> — ${alert.alert_type} ${origDir.toUpperCase()} bias invalidated\n` +
              `Entry: $${alertPrice.toPrecision(4)} → Now: $${currentPrice.toPrecision(4)} (${dirPnl.toFixed(1)}%)\n` +
              `Price moved against the call — consider exiting if in position.\n\n` +
              `<i>${new Date().toUTCString().slice(0, -4)}</i>`;
            await bot.sendRaw(msg);
            await bot.broadcastToUsers(msg);

            // Set cooldown on onchain auto-trader so it doesn't re-enter the same symbol
            if (onchainTradeExecutor?.cooldowns) {
              onchainTradeExecutor.cooldowns.set(alert.symbol.toUpperCase(), Date.now() + 2 * 60 * 60 * 1000);
            }
          }
        } catch (e) {
          logger.debug(`Invalidation check failed for ${alert.symbol}: ${e.message}`);
        }
      }
    } catch (err) {
      logger.error(`Alert invalidation checker error: ${err.message}`);
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
    try {
      await onchainTradeExecutor.checkOpenTrades();
      await onchainTradeExecutor.reconcileExchangePositions();
    } catch (err) {
      logger.error(`Onchain trade tracker error: ${err.message}`);
    }
    try {
      await onchainTradeExecutor.checkPendingEntries();
    } catch (err) {
      logger.error(`Pending entry check error: ${err.message}`);
    }
    try {
      await userPaperEngine.checkPendingUserEntries();
    } catch (err) {
      logger.error(`User pending entry check error: ${err.message}`);
    }
    try {
      await swingTradeExecutor.checkOpenTrades();
    } catch (err) {
      logger.error(`Swing trade tracker error: ${err.message}`);
    }
    try {
      await swingTradeExecutor.checkPendingEntries();
    } catch (err) {
      logger.error(`Swing pending entry check error: ${err.message}`);
    }
    try {
      await dzTradeExecutor.checkOpenTrades();
    } catch (err) {
      logger.error(`DZ trade tracker error: ${err.message}`);
    }
    try {
      await dzTradeExecutor.checkPendingEntries();
    } catch (err) {
      logger.error(`DZ pending entry check error: ${err.message}`);
    }
  });

  cron.schedule('*/2 * * * *', async () => {
    try {
      await listingMonitor.checkAnnouncementPages();
    } catch (err) {
      logger.error(`Announcement check error: ${err.message}`);
    }
  });

  // Skip outcome checker — every 15 min, check what happened to skipped trades
  cron.schedule('*/15 * * * *', async () => {
    try {
      const skips = await db.getUncheckedSkips();
      if (!skips.length) return;
      const exchange = Object.values(listingMonitor.exchanges).find(e => e.id === 'binance') || Object.values(listingMonitor.exchanges)[0];
      if (!exchange) return;
      for (const skip of skips) {
        try {
          const pair = `${skip.symbol}/USDT`;
          const since = new Date(skip.created_at).getTime();
          const now = Date.now();
          const age = (now - since) / 3600000;
          if (age < 1) continue;
          const candles = await exchange.fetchOHLCV(pair, '5m', since, 50);
          if (!candles || candles.length < 2) continue;
          const skipPrice = parseFloat(skip.price);
          const dir = skip.direction;
          const tp1 = parseFloat(skip.onchain_data?.tp1 || 0);
          const sl = parseFloat(skip.onchain_data?.stopLoss || skip.onchain_data?.stop_loss || 0);
          let bestPrice = skipPrice, worstPrice = skipPrice;
          let price1h = null, price4h = null;
          let wouldHitTp1 = false, wouldHitSl = false;
          for (const c of candles) {
            const [ts, o, h, l, close] = c;
            const elapsed = (ts - since) / 3600000;
            if (dir === 'long') {
              if (h > bestPrice) bestPrice = h;
              if (l < worstPrice) worstPrice = l;
              if (tp1 && h >= tp1) wouldHitTp1 = true;
              if (sl && l <= sl) wouldHitSl = true;
            } else {
              if (l < bestPrice) bestPrice = l;
              if (h > worstPrice) worstPrice = h;
              if (tp1 && l <= tp1) wouldHitTp1 = true;
              if (sl && h >= sl) wouldHitSl = true;
            }
            if (!price1h && elapsed >= 1) price1h = close;
            if (!price4h && elapsed >= 4) price4h = close;
          }
          if (!price1h) price1h = candles[candles.length - 1][4];
          const movePct = dir === 'long'
            ? ((bestPrice - skipPrice) / skipPrice) * 100
            : ((skipPrice - bestPrice) / skipPrice) * 100;
          let outcome;
          if (wouldHitSl && !wouldHitTp1) outcome = 'would_lose';
          else if (wouldHitTp1 && !wouldHitSl) outcome = 'would_win';
          else if (wouldHitTp1 && wouldHitSl) outcome = 'would_sl_first';
          else if (movePct > 2) outcome = 'missed_profit';
          else if (movePct < -2) outcome = 'dodged_loss';
          else outcome = 'neutral';
          await db.updateSkipOutcome(skip.id, {
            price1h, price4h: price4h || price1h,
            bestPrice, worstPrice,
            wouldHitTp1, wouldHitSl, outcome,
          });
        } catch (e) { /* skip individual check errors */ }
      }
      logger.info(`Skip outcomes checked: ${skips.length} entries`);
    } catch (err) {
      logger.debug(`Skip outcome check error: ${err.message}`);
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
    `Onchain Trade: ${onchainTradeExecutor.mode.toUpperCase()} mode | $${onchainTradeExecutor.maxPositionSize}/trade | ${onchainTradeExecutor.defaultLeverage}x | ${onchainTradeExecutor.enabled ? 'ON' : 'OFF'}\n` +
    `Listing check: every ${config.signals.listingCheckInterval / 1000}s\n` +
    `Technical scan: every 5 min\n` +
    `OI spike: every 2 min | Onchain scan: every 5 min\n` +
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
