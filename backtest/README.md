# Pump-signal backtest

Local copy of the pump-signal history so backtests don't download everything again.

- `data/` (not in git, ~320 MB)
  - `h1L.json`: 1h candles of every Binance USDT perp
  - `signals_L.json`: pump signals found by the detector (`lt1.js`)
  - `replay_L.json`: the bot's real 5-min watch checks for 2h after each signal, plus spot share (`lt3.js`)
  - `paths_L.json`: 1m high/low/close for 72h after each signal
- `sh backtest/update.sh` tops the data up to now. Only new days and signals are fetched.
- Run a study: `NODE_PATH=node_modules node --max-old-space-size=8000 backtest/conf.js`
  - `conf.js`: more confirmation time before the short
  - `side.js`: short + runner long together
  - `rules.js`: entry-rule helpers

Open interest comes from Bybit (Binance keeps only 30 days), so coins without a Bybit perp are left out.

## Forex / metals research (`backtest/fx/`, Oct 2026)

Data in `backtest/data_fx/` (not in git): `python3 -I backtest/fx/fetch_ref.py` (Yahoo daily 2003+, Yahoo 1h, FRED rates, CFTC COT),
`fetch_fx1h.py` (Yahoo 1h FX), `fetch_perps.py` (Binance/Bybit TradFi perps: 1h klines, index, premium, funding), `fetch_metrics.py` (Binance OI / long-short ratios).
Studies (run with `python3 -I backtest/fx/<name>.py`): `daily_factors.py` (trend, carry, month-end, weekday), `cot.py`, `intraday.py`
(hour-of-day, home hours, Asian breakout, gold sessions), `closed.py` (perp moves while the real market is shut), `overnight.py`,
`premium.py`, `crowd.py`, `perpshare.py` (perp volume vs CME volume). Result: no edge held in both halves after fees.
