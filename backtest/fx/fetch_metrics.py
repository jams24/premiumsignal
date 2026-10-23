# Binance futures metrics (5-min open interest, top-trader and taker long/short ratios) from data.binance.vision, daily zips.
import io, os, sys, csv, json, zipfile, time, datetime as dt, urllib.request
from concurrent.futures import ThreadPoolExecutor
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data_fx')
SYMS = {'XAUUSDT': '2025-12-11', 'XAGUSDT': '2026-01-07', 'PAXGUSDT': '2025-03-27', 'XAUTUSDT': '2026-03-26', 'CLUSDT': '2026-04-01', 'COPPERUSDT': '2026-03-06'}
def one(sym, day):
    u = f'https://data.binance.vision/data/futures/um/daily/metrics/{sym}/{sym}-metrics-{day}.zip'
    for i in range(3):
        try:
            b = urllib.request.urlopen(u, timeout=30).read(); z = zipfile.ZipFile(io.BytesIO(b))
            return list(csv.DictReader(io.StringIO(z.read(z.namelist()[0]).decode())))
        except urllib.error.HTTPError as e:
            if e.code == 404: return []
        except Exception: time.sleep(2)
    return []
out = {}
for sym, start in SYMS.items():
    days = []; x = dt.date.fromisoformat(start)
    while x < dt.date(2026, 10, 22): days.append(x.isoformat()); x += dt.timedelta(1)
    with ThreadPoolExecutor(8) as ex: parts = list(ex.map(lambda d: one(sym, d), days))
    rows = [r for p in parts for r in p]
    out[sym] = [[r['create_time'], float(r['sum_open_interest_value'] or 0), float(r['count_toptrader_long_short_ratio'] or 0), float(r['sum_toptrader_long_short_ratio'] or 0),
                 float(r['count_long_short_ratio'] or 0), float(r['sum_taker_long_short_vol_ratio'] or 0)] for r in rows]
    print(sym, len(out[sym]), 'rows', flush=True)
json.dump(out, open(os.path.join(D, 'metrics.json'), 'w')); print('DONE')
