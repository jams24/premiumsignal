# CryptoSignal Bot — Development Guide

## Mandatory Dry Run

**Before committing ANY change to trading logic**, run the backtest:

```bash
node src/tests/dryrun.js
```

This replays all historical trades from the database through the current engine and compares old vs new P&L. The script exits with code 0 (pass) or 1 (fail).

### Rules
- **MUST PASS before committing** changes to these files:
  - `src/engine/tradeExecutor.js` (trade execution, TP/SL logic, partial exits)
  - `src/collectors/technicalScanner.js` (signal scoring, filters, TP/SL calculation)
  - `src/collectors/smcAnalyzer.js` (SMC structure analysis)
  - `src/engine/signalEngine.js` (signal processing)
- **Zero regressions** — no individual trade should perform worse
- **Live P&L must improve or stay equal** — paper regressions on manual closes are acceptable (user-timed exits)
- If the dry run fails, **fix the regression before committing**

### Updating the Backtest
When engine parameters change, update `ENGINE` constants in `src/tests/dryrun.js` to match:
- `tp1Mult`, `tp2Mult`, `tp3Mult`, `slMult` — ATR multipliers (from technicalScanner.js)
- `partialTP1/TP2/TP3` — partial exit fractions (from tradeExecutor.js checkOpenTrades)
- `profitProtectPct` — breakeven trail threshold (from tradeExecutor.js)
- `maxLossPerTrade` — per-trade loss cap (from tradeExecutor.js)
- `deadHoursStart/End` — suppressed hours UTC (from technicalScanner.js)

## Architecture

- **Node.js / CommonJS** — no ESM, no TypeScript
- **ccxt v3** for exchange APIs, **Telegraf** for Telegram bot
- **PostgreSQL** via `pg` (not Prisma) — use `db push` pattern, not migrations
- **Deployed on Deployzy** — auto-deploys from `main` branch on GitHub (`jams24/premiumsignal`)

## Key Flows

### Signal → Trade Pipeline
1. `technicalScanner.scanAll()` runs every 5 min
2. Scores candidates with indicators + SMC analysis + 4H trend filter
3. `signalEngine.processBreakoutSignal()` creates signal
4. `tradeExecutor.executeSignal()` checks filters, executes paper or live
5. `tradeExecutor.checkOpenTrades()` runs every 1 min — manages TP/SL/DCA/invalidation

### Trade Management
- **Partial exits**: 33% at TP1, 50% at TP2, 50% at TP3, all at TP4
- **Profit protection**: SL trails to breakeven at +5% before TP1
- **Max loss cap**: $6/trade, checked every minute
- **4H invalidation**: closes trade if 4H candle closes below invalidation level
- **Cooldown**: 4h cooldown after SL/invalidation prevents re-entry loops

### Pre-Entry Filters (toggleable from /onchaintrade settings)
- **Trend Structure Filter** (`trendFilter`, default OFF): Blocks longs when 1H swing structure shows downtrend. Uses lookback=3 swing points — if last 3 swing highs OR last 3 swing lows are all descending, the long is rejected. Unblocks when a new higher high or higher low breaks the descending pattern. Backtested +$102 over 14 days (368 trades). Toggle off on green momentum days to avoid false positives.
- **Volatility Filter** (`volatilityFilter`, default ON): Rejects entries when 4H candle range exceeds threshold (default 15%)
- **L/S Filter** (`minTopLS`): Rejects longs when top trader long/short ratio is below threshold
- **Pump Exhaustion Filter** (`exhaustionFilter`, default OFF): Detects pump-top setups (big price surge + crowded OI + near 24h high + crowded funding) and flips direction from long to short. Bypasses the "near peak" and "above EMA" short blockers for exhaustion setups. Scoring: priceChange>15% (+3), nearHigh<3% (+2), OI>50% (+3), funding>0.1% (+2). Threshold: score>=5. Backtested +$136 over 5 days (blocks 11 losers saving $171, blocks 17 small winners losing $34). Use for active short edge on pump reversals.
- **Circuit Breaker** (`cbEnabled`, default ON): Pauses trading after consecutive losses

## Risk Parameters (current defaults)
- Size: $12/trade, 5x leverage (10x for high confidence)
- Max 3 concurrent positions
- $10 daily loss limit, $6 per-trade cap
- Min confidence: 5/5
- Dead hours: 04:00-06:00 UTC (suppressed)
- Min volume: 1.5M USDT quote volume
