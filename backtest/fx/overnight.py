# Stock-perp overnight fade, honest version: one number per night (stocks on the same night move together).
import sys, os, json, numpy as np; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import D, tstat
R = [r for r in json.load(open(os.path.join(D, 'closed_events.json'))) if r['kind'] == 'stock']
P = json.load(open(os.path.join(D, 'perps.json')))
days = sorted({r['day'] for r in R}); mid = days[len(days) // 2]
print('stock nights', len(days), days[0], '->', days[-1], '| split at', mid, '| stocks per night median', int(np.median([sum(r['day'] == d for r in R) for d in days[::10]])))
for label, mode in (('fade each stock\'s own move', 'raw'), ('fade vs the other stocks (market-neutral)', 'rel'), ('fade the market-wide move only', 'mkt')):
    for e, ename in ((0, '10:00'), (1, '12:00'), (2, '16:00')):
        out = {}
        for d in days:
            g = [r for r in R if r['day'] == d]
            if len(g) < 5: continue
            mv = np.array([r['mv'] for r in g]); o = np.array([r['o'][e] for r in g]); avg = mv.mean()
            if mode == 'raw': v = np.mean(-np.sign(mv) * o)
            elif mode == 'rel': s = -np.sign(mv - np.median(mv)); v = np.mean(s * (o - o.mean()))
            else: v = -np.sign(avg) * o.mean()
            out.setdefault(d >= mid, []).append(v)
        a, b = np.array(out[False]), np.array(out[True])
        print(f'{label:42s} exit {ename}: first half {a.mean()*1e4:+5.1f}bp/night t {tstat(a):+.1f} ({np.mean(a>0)*100:.0f}% nights up) | second half {b.mean()*1e4:+5.1f}bp t {tstat(b):+.1f} ({np.mean(b>0)*100:.0f}%)')
# liquidity of the stock perps around the open (quote volume of the 9:00-10:00 ET bar), median across stocks
vols = []
for k, d in P.items():
    if d.get('type') == 'EQUITY' and len(d['k']) > 500:
        q = [x[5] for x in d['k'][-24 * 30:]]; vols.append((np.median(q), k.split(':')[1]))
vols.sort(reverse=True)
print('median hourly volume, last 30 days: top 10', [(s, f'${v/1e6:.1f}M') for v, s in vols[:10]], '| median stock', f'${np.median([v for v, _ in vols])/1e3:.0f}k/h')
