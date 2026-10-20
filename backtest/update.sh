#!/bin/sh
# Top up the backtest data in backtest/data/ to now. Only new days and new signals are downloaded.
#   sh backtest/update.sh            (from 1 Jun 2026)
#   sh backtest/update.sh 2026-09-01 (from another start date)
cd "$(dirname "$0")" || exit 1
export NODE_PATH="$(cd .. && pwd)/node_modules"
START="${1:-2026-06-01}"
END="$(date -u +%Y-%m-%dT%H:%MZ)"
node --max-old-space-size=6000 lt1.js "$START" "$END" > data/lt1.log 2>&1 || { tail -5 data/lt1.log; exit 1; }
tail -1 data/lt1.log
node --max-old-space-size=8000 lt3.js > data/lt3.log 2>&1 || { tail -5 data/lt3.log; exit 1; }
tail -1 data/lt3.log
