# CryptoSignal Bot — Development Guide

## Mandatory Checks Before Committing Trading Logic

Two checks, each exits 0 (pass) or 1 (fail). Both compare the current code/config against a saved baseline.

### 1. Dry run — technical-signal trades
```bash
node src/tests/dryrun.js
```
Replays the closed `main`/`onchain` technical-signal trades (not pump auto/manual trades) through a simple exit model
with the baseline settings and with the current ones. Current settings are read from the code and DB (executor TP1/TP2
close %, profit protect %, max loss per trade; dead hours parsed from technicalScanner.js) — no constants to keep in sync.
- **MUST PASS before committing** changes to:
  - `src/engine/tradeExecutor.js` (trade execution, TP/SL logic, partial exits)
  - `src/collectors/technicalScanner.js` (signal scoring, filters, TP/SL calculation)
  - `src/collectors/smcAnalyzer.js` (SMC structure analysis)
  - `src/engine/signalEngine.js` (signal processing)
- **Zero regressions vs the baseline settings**, and live P&L equal or better (manual closes don't count)
- The model only uses stored trades (exit price + TP hit flags), so it reacts to the settings above, not to code
  paths like order placement or leverage. Say so when a change isn't covered.

### 2. Pump check — pump short + runner long
```bash
node --max-old-space-size=8000 src/tests/pumpcheck.js
```
Replays the pump-signal history (`backtest/data` Jun–Oct, `backtest/data_early` Dec–May; git-ignored, fill with
`sh backtest/update.sh`) through the bot's own pump code: `entryVerdict`, the signal-time re-check, `blockReason`
(BTC pause, spot share, no-spot), `isRunnerSignal`, TP/stop levels, early stop move, executor TP close sizes — with the
live /autopump config from the DB (`--defaults` for code defaults). $150/trade, fees in.
- **MUST PASS before committing** changes to `src/collectors/pumpSignalCheck.js`, `src/engine/pumpAutoTrader.js`,
  `src/engine/pumpRunnerPaper.js`, `src/collectors/spotShare.js`, and to the TP/stop handling in `tradeExecutor.js`
- Pass = P&L equal or better in **both** periods; it lists trades that got worse, new and no longer taken
- Not modelled: max open, daily loss stop, real fills/slippage, liquidation

### Updating a baseline
Only after the user approves a change that moves the result: `node src/tests/dryrun.js --update` /
`node --max-old-space-size=8000 src/tests/pumpcheck.js --update`, and commit the baseline JSON with the change.
A /autopump settings change in Telegram also moves the pump check (it reads the live config) — re-baseline then too.

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
