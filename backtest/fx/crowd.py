# A4: crowding data on metal perps (Binance metrics, 5-min) vs the next 4h / 24h. Each measure is z-scored against its
# own last 7 days; trade the extreme (|z| > 2) both ways and see if the sign holds early vs late. 1 signal per 4h max.
import sys, os, json, numpy as np, datetime as dt; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import D, tstat
M = json.load(open(os.path.join(D, 'metrics.json'))); P = json.load(open(os.path.join(D, 'perps.json')))
SPLIT = dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc).timestamp() * 1000
names = ['oi_value', 'top_count_ls', 'top_pos_ls', 'crowd_ls', 'taker_ls']
res = {}
for sym in ('XAUUSDT', 'XAGUSDT', 'PAXGUSDT', 'XAUTUSDT', 'COPPERUSDT', 'CLUSDT'):
    k = P['binance:' + sym]['k']; kt = np.array([x[0] for x in k]); kc = np.array([x[4] for x in k])
    rows = sorted(M[sym], key=lambda r: r[0])
    t = np.array([dt.datetime.strptime(r[0], '%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc).timestamp() * 1000 for r in rows])
    X = np.array([r[1:] for r in rows], dtype=float)
    hourly = [i for i in range(len(t)) if t[i] % 3600000 == 0]
    for f in range(5):
        x = X[:, f].copy()
        if f == 0: x = np.r_[np.full(48, np.nan), np.log(x[48:] / x[:-48])]  # OI: 4h change
        last = -1e18
        for i in hourly:
            if i < 2016 or t[i] - last < 4 * 3600000: continue
            w = x[i - 2016:i]; w = w[~np.isnan(w)]
            if len(w) < 500 or w.std() == 0 or np.isnan(x[i]): continue
            z = (x[i] - w.mean()) / w.std()
            if abs(z) < 2: continue
            j = np.searchsorted(kt, t[i])  # bar starting at t[i] -> entry at its open ~ previous close
            if j < 1 or j + 24 >= len(kt): continue
            last = t[i]; e = kc[j - 1]
            for H in (4, 24):
                res.setdefault((names[f], H, t[i] >= SPLIT), []).append(np.sign(z) * np.log(kc[j - 1 + H] / e))
print('follow the extreme (sign of z) -- gross bp; negative = fading works. Fee 10bp. Split 1 Jun 2026')
for f in names:
    line = f'{f:13s}'
    for H in (4, 24):
        for late in (False, True):
            v = np.array(res.get((f, H, late), []))
            line += f' | {H:2d}h {"late " if late else "early"} n={len(v):4d} {v.mean()*1e4 if len(v) else 0:+6.1f}bp t{tstat(v) if len(v)>2 else 0:+.1f}'
    print(line)
