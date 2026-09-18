# Trade Analysis Checklist

Key points to verify when reviewing trade performance and diagnosing issues.

## 1. Dashboard vs Live Trade Distinction

- **Dashboard P&L is simulated** — "if you entered at alert price." It is NOT live bot P&L.
- Bot may enter at a different price and time than the first alert (dead hours, max positions full, pullback entry waiting).
- Always cross-check dashboard entries against actual trades in DB (`trades` table with `source = 'onchain'`).
- A dashboard entry showing +$47 does not mean the bot made +$47.

## 2. Exchange Position vs Bot State

- **Binance has NO exchange stop-loss orders** — SL is managed internally by `checkOpenTrades` every minute.
- If `closeExchangePosition` fails silently, the exchange position stays open but DB marks it closed (**orphan position**).
- Always check Binance/Bybit closed positions against bot's closed trades — mismatches = orphans.
- `reconcileExchangePositions()` now alerts on orphans every 30 min, but still verify manually after losses.
- `max_loss` exit was previously missing from exchange close trigger (fixed Sep 18 2026).

## 3. Profit Protection & Trailing SL

- **Breakeven trigger**: `profitProtectLevPnl` — the leveraged ROI % at which SL moves to entry.
  - At 10x leverage: 25% ROI = 2.5% price move before BE triggers.
  - Too low = kills winners early. Too high = no protection on fakeouts.
- **Trail giveback**: `trailGivebackPct` — how much of peak profit the trailing SL gives back.
  - 50% = SL trails at halfway between entry and peak.
  - Lower = tighter trail (protects more, but catches pullbacks). Higher = more room to breathe.
- Fakeout pumps that reverse benefit from tight trailing. Genuine runners benefit from wide trailing.
- There is no magic number — it's a tradeoff. Review recent trades to calibrate.

## 4. Re-Entry & Cooldown

- **2h minimum cooldown** after any close (hardcoded, not configurable).
- **Drift check**: blocks re-entry if price moved >10% from last entry in trade direction (chasing).
- **1am UTC daily reset** clears the cooldown entirely — drift check is bypassed after reset.
  - This means a coin can be re-entered at +80% from last entry after 1am (potential TODO: persist drift check past reset).
- **Cross-exchange**: cooldown is symbol-based (no exchange suffix), so closing on Bybit blocks Binance too.
- Scanner deduplicates per scan cycle (keeps best score), but different scans may pick different exchanges.

## 5. Score Filtering

- `minOcScore` — minimum onchain score to enter a long trade.
- `maxOcScore` — maximum score for longs (high score = exhausted pump, use short instead).
- `minShortScore` — separate minimum for short entries.
- All three are enforced in `canTrade()` (fixed Sep 17 2026 — were previously unchecked).

## 6. Common Churn Pattern

The most expensive pattern:
1. Trade enters on a small pump
2. Profit protection triggers early (tight BE threshold)
3. Trailing SL catches the first pullback
4. Price recovers, scanner picks it up again (maybe different exchange)
5. Smart re-entry allows it (within 10% drift, >2h cooldown passed)
6. Repeat 2-3x on the same coin

**Root cause**: tight profit protection, not the re-entry logic. Widening BE trigger reduces churn.

## 7. When Analyzing a Losing Trade

1. Was it a fakeout or a genuine reversal? (Check 1h/4h trend, OI, funding)
2. Did profit protection fire? At what ROI? Would wider settings have helped or hurt?
3. Did the coin keep running after exit? (Check current price vs exit price)
4. Was there an orphan position left on exchange?
5. Was it a re-entry? How many times was this coin traded today?
6. Was the score filter respected? (Check `oc_score` in trade data vs panel `minOcScore`)
7. What entry mode was used? (market/pullback/hybrid — check if falling edge detection applied)
