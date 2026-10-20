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
