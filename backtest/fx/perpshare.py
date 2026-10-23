# A5: "perp share" = Binance+Bybit perp volume / CME futures volume (both in $) during a big move -- the gold/silver/oil/copper
# version of our crypto spot-share rule. Big move = 4h return > 2 x its usual 4h size (last 20 days), real market open,
# >= 24h apart. Then fade it; compare high-share (perp-led) vs low-share (CME-led) moves, early vs late. Fee 10bp.
import sys, os, json, numpy as np, datetime as dt; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import D, tstat
P = json.load(open(os.path.join(D, 'perps.json'))); Y = json.load(open(os.path.join(D, 'yahoo_1h.json')))
SETS = {'gold': ('GC=F', 100, ['binance:XAUUSDT', 'bybit:XAUUSDT', 'binance:PAXGUSDT', 'bybit:PAXGUSDT', 'binance:XAUTUSDT', 'bybit:XAUTUSDT']),
        'silver': ('SI=F', 5000, ['binance:XAGUSDT', 'bybit:XAGUSDT']), 'oil': ('CL=F', 1000, ['binance:CLUSDT', 'binance:BZUSDT']),
        'copper': ('HG=F', 25000, ['binance:COPPERUSDT'])}
H = 3600000; SPLIT = dt.datetime(2026, 6, 1, tzinfo=dt.timezone.utc).timestamp() * 1000; ev = []
for nm, (ys, mult, perps) in SETS.items():
    y = {int(r[0] * 1000) // H * H: r for r in Y[ys]}  # yahoo 1h: [t, o, h, l, c, vol]
    pv = {}
    for k in perps:
        for x in P.get(k, {}).get('k', []): pv[x[0]] = pv.get(x[0], 0) + x[5]
    main = P[perps[0]]['k']; t = np.array([x[0] for x in main]); c = np.array([x[4] for x in main])
    r4 = np.r_[np.full(4, np.nan), np.log(c[4:] / c[:-4])]; last = -1e18
    for i in range(24 * 20 + 4, len(t) - 25):
        cme = [y.get(t[j]) for j in range(i - 3, i + 1)]
        if None in cme or any(b[5] <= 0 for b in cme): continue  # CME open with volume in all 4 hours
        w = r4[i - 24 * 20:i:4]; w = w[~np.isnan(w)]
        if len(w) < 60: continue
        sd = np.sqrt(np.mean(w ** 2))
        if abs(r4[i]) < 2 * sd or t[i] - last < 24 * H: continue
        last = t[i]; cme_usd = sum(b[5] * mult * b[4] for b in cme); perp_usd = sum(pv.get(t[j], 0) for j in range(i - 3, i + 1))
        ev.append(dict(m=nm, t=t[i], late=t[i] >= SPLIT, share=perp_usd / cme_usd, f4=-np.sign(r4[i]) * np.log(c[i + 4] / c[i]), f24=-np.sign(r4[i]) * np.log(c[i + 24] / c[i])))
print('big moves', len(ev), {m: sum(e['m'] == m for e in ev) for m in SETS})
for m in SETS:
    E = [e for e in ev if e['m'] == m]
    if len(E) < 10: continue
    med = np.median([e['share'] for e in E if not e['late']] or [np.median([e['share'] for e in E])])
    print(f'\n{m}: perp share median {med*100:.1f}% of CME volume (early)')
    for late in (False, True):
        for hi in (True, False):
            g = [e for e in E if e['late'] == late and (e['share'] > med) == hi]
            if len(g) < 3: print(f'   {"late " if late else "early"} {"perp-led" if hi else "CME-led "}: n={len(g)}'); continue
            a4, a24 = np.array([e['f4'] for e in g]), np.array([e['f24'] for e in g])
            print(f'   {"late " if late else "early"} {"perp-led" if hi else "CME-led "}: n={len(g):3d} fade 4h {a4.mean()*1e4:+6.1f}bp (t{tstat(a4):+.1f}) 24h {a24.mean()*1e4:+6.1f}bp (t{tstat(a24):+.1f}) win24 {np.mean(a24>0)*100:.0f}%')
