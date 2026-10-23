# Part A3: does the perp's premium over its index (or funding) predict the next hours? Fade a rich perp, buy a cheap one.
# Binance TradFi + gold-token perps, open-market hours and closed hours separately. Split by date; fee 0.1% round trip.
import sys, os, json, numpy as np, datetime as dt; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zoneinfo import ZoneInfo
from lib import D, tstat
ET = ZoneInfo('America/New_York'); SPLIT = dt.datetime(2026, 5, 1, tzinfo=dt.timezone.utc).timestamp() * 1000
P = json.load(open(os.path.join(D, 'perps.json')))
def is_open(ms, typ):
    x = dt.datetime.fromtimestamp(ms / 1000, ET); wd, h = x.weekday(), x.hour + x.minute / 60
    if typ == 'EQUITY': return wd < 5 and 9.5 <= h < 16
    if wd == 5 or (wd == 6 and h < 18) or (wd == 4 and h >= 17): return False
    return not (17 <= h < 18)
groups = {'metals': ('XAUUSDT', 'XAGUSDT', 'XPTUSDT', 'XPDUSDT', 'COPPERUSDT', 'PAXGUSDT', 'XAUTUSDT'), 'energy': ('CLUSDT', 'BZUSDT', 'NATGASUSDT')}
for gname in ('metals', 'energy', 'stocks'):
    res = {}
    for key, d in P.items():
        if not key.startswith('binance:'): continue
        s = key.split(':')[1]
        if gname == 'stocks' and d.get('type') != 'EQUITY': continue
        if gname != 'stocks' and s not in groups[gname]: continue
        k = d['k']; prem = {x[0]: x[1] for x in d['prem']}
        t = np.array([x[0] for x in k]); c = np.array([x[4] for x in k])
        pr = np.array([prem.get(x, np.nan) for x in t]); typ = d.get('type')
        for H in (1, 4, 24):
            for i in range(24 * 7, len(t) - H):
                if np.isnan(pr[i]): continue
                w = pr[i - 24 * 7:i]; w = w[~np.isnan(w)]
                if len(w) < 50 or w.std() == 0: continue
                z = (pr[i] - w.mean()) / w.std()
                if abs(z) < 2: continue
                op = is_open(t[i] + 3600000, typ)
                res.setdefault((H, op, t[i] >= SPLIT), []).append(-np.sign(z) * np.log(c[i + H] / c[i]))
    print(f'\n{gname}: fade the perp when its premium is > 2 sd from its 7-day average (gross bp per trade; fee = -10bp)')
    for H in (1, 4, 24):
        line = f'  hold {H:2d}h:'
        for op in (True, False):
            for late in (False, True):
                v = np.array(res.get((H, op, late), []))
                line += f' {"open" if op else "closed"}-{"late" if late else "early"} n={len(v):5d} {v.mean()*1e4 if len(v) else 0:+5.1f}bp t{tstat(v) if len(v) > 2 else 0:+.1f} |'
        print(line)
