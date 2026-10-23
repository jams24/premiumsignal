# Part C: intraday effects on Yahoo 1h, Jan 2024 - Oct 2026. Discovery = to 2025-04-30, check = 2025-05-01 on.
import sys, os, json, numpy as np, time; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import tstat, COST
Y = {'EURUSD': 'y_EURUSD', 'GBPUSD': 'y_GBPUSD', 'USDJPY': 'y_USDJPY', 'AUDUSD': 'y_AUDUSD', 'USDCAD': 'y_USDCAD', 'USDCHF': 'y_USDCHF', 'NZDUSD': 'y_NZDUSD',
     'EURJPY': 'y_EURJPY', 'GBPJPY': 'y_GBPJPY', 'AUDJPY': 'y_AUDJPY', 'EURGBP': 'y_EURGBP', 'XAUUSD': 'y_XAUUSD', 'XAGUSD': 'y_XAGUSD'}
SP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data_fx', 'fx1h') + '/'  # from fetch_fx1h.py
SPLIT = time.mktime(time.strptime('2025-05-01', '%Y-%m-%d'))
data = {p: np.load(SP + f + '.npy') for p, f in Y.items()}
print('=== C1 hour-of-day: mean return per UTC hour, discovery vs check (USD direction for USD pairs) ===')
agree = 0; tot = 0
for p, a in data.items():
    t, o, c = a[:, 0], a[:, 1], a[:, 4]; hr = ((t % 86400) // 3600).astype(int); r = np.log(c / o)
    sgn = 1 if p.startswith('USD') else -1 if p.endswith('USD') and not p.startswith('XA') else 1
    tr, te = t < SPLIT, t >= SPLIT; out = []
    for h in range(24):
        a1, a2 = r[(hr == h) & tr] * sgn, r[(hr == h) & te] * sgn
        if len(a1) < 50: continue
        t1, t2 = tstat(a1), tstat(a2)
        if abs(t1) > 2:
            tot += 1; agree += np.sign(t1) == np.sign(t2)
            out.append(f'{h:02d}h {a1.mean()*1e4:+.1f}/{a2.mean()*1e4:+.1f}bp(t{t1:+.1f}/{t2:+.1f})')
    print(f'{p}: hours with |t|>2 in discovery: ' + ('; '.join(out) or '-'))
print(f'--> {tot} hours significant in discovery; {agree} kept the same sign in the check (coin flip would be ~{tot/2:.0f})')
print('\n=== C1b home-hours effect (Breedon-Ranaldo): currency weakens in its own trading hours ===')
HOME = {'EUR': range(7, 12), 'GBP': range(7, 12), 'CHF': range(7, 12), 'JPY': list(range(0, 6)), 'AUD': list(range(0, 6)), 'NZD': list(range(21, 24)) + [0, 1, 2, 3], 'CAD': range(13, 20), 'USD': range(13, 20)}
for per, m in (('discovery', lambda t: t < SPLIT), ('check', lambda t: t >= SPLIT)):
    v = []
    for p, a in data.items():
        if p.startswith('XA'): continue
        t, o, c = a[:, 0], a[:, 1], a[:, 4]; hr = ((t % 86400) // 3600).astype(int); r = np.log(c / o); b, q = p[:3], p[3:]
        for i in np.where(m(t))[0]:
            pos = (-1 if hr[i] in HOME[b] else 0) + (1 if hr[i] in HOME[q] else 0)  # base weakens in base hours, quote weakens in quote hours
            if pos: v.append(pos * r[i])
    v = np.array(v); print(f'  {per}: {len(v)} pair-hours, avg {v.mean()*1e4:+.2f}bp per hour held, t {tstat(v):+.1f}  (cost ~1.2bp per round trip per block)')
print('\n=== C2 Asian-range breakout at London open (range 00-07 UTC, stop orders at range edges, stop = other edge, exit 16 UTC) ===')
for tgt in (1.0, 2.0, None):
    for per, m in (('discovery', lambda t: t < SPLIT), ('check', lambda t: t >= SPLIT)):
        res = []
        for p, a in data.items():
            t = a[:, 0]; dayk = (t // 86400).astype(int); hr = ((t % 86400) // 3600).astype(int)
            for dk in np.unique(dayk):
                idx = np.where(dayk == dk)[0]
                if not m(t[idx[0]]) or len(idx) < 18: continue
                asia = idx[hr[idx] < 7]; sess = idx[(hr[idx] >= 7) & (hr[idx] < 16)]
                if len(asia) < 6 or len(sess) < 8: continue
                H, L = a[asia, 2].max(), a[asia, 3].min(); rng = H - L
                if rng <= 0: continue
                d0, E, stop, tp, out = 0, None, None, None, None
                for k in sess:
                    h, l, c = a[k, 2], a[k, 3], a[k, 4]
                    if d0 == 0:
                        up, dn = h > H, l < L
                        if up and dn: break  # both sides in one hour: skip (unknown order)
                        if up: d0, E, stop = 1, H, L
                        elif dn: d0, E, stop = -1, L, H
                        if d0: tp = E + d0 * tgt * rng if tgt else None
                        continue
                    if (d0 > 0 and l <= stop) or (d0 < 0 and h >= stop): out = -1.0; break
                    if tp is not None and ((d0 > 0 and h >= tp) or (d0 < 0 and l <= tp)): out = tgt; break
                if d0 and out is None: out = d0 * (a[sess[-1], 4] - E) / rng
                if d0: res.append(out - COST[p] * E / rng)
        v = np.array(res); print(f'  target {tgt or "none (exit 16h)"} {per}: {len(v)} trades, avg {v.mean():+.3f}R, t {tstat(v):+.1f}, win {np.mean(v>0)*100:.0f}%')
print('\n=== C3 gold/silver by session: Asia 23-07, London 07-13, New York 13-21 UTC (mean bp per day) ===')
for p in ('XAUUSD', 'XAGUSD'):
    a = data[p]; t, o, c = a[:, 0], a[:, 1], a[:, 4]; hr = ((t % 86400) // 3600).astype(int); r = np.log(c / o)
    for nm, hs in (('Asia', list(range(23, 24)) + list(range(0, 7))), ('London', range(7, 13)), ('NewYork', range(13, 21))):
        mk = np.isin(hr, list(hs)); d1 = r[mk & (t < SPLIT)]; d2 = r[mk & (t >= SPLIT)]
        print(f'  {p} {nm:8s}: discovery {d1.sum()/ (len(d1)/len(hs))*1e4:+.1f}bp/day t {tstat(d1):+.1f} | check {d2.sum()/(len(d2)/len(hs))*1e4:+.1f}bp/day t {tstat(d2):+.1f}')
