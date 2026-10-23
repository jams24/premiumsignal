# Part A1: perps that keep trading while the real market is shut (weekends for gold/silver/FX/oil, nights + weekends for stocks).
# Idea carried over from the crypto edge: a move made by perp traders alone, with the real (spot/futures) market closed,
# should partly reverse when the real market reopens. Decision = 1h before the reopen; fade the closed-market move.
# Fee 0.1% round trip (taker both sides) like the crypto sims; also shown gross. Pre-registered: fade, |move| > k x daily vol.
import sys, os, json, numpy as np, datetime as dt; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zoneinfo import ZoneInfo
from lib import D, tstat
ET = ZoneInfo('America/New_York'); FEE = 0.001
P = json.load(open(os.path.join(D, 'perps.json')))
def kind(key, d):
    s = key.split(':')[1]
    if d.get('type') == 'EQUITY': return 'stock'
    if s in ('EURUSDUSDT', 'GBPUSDUSDT', 'USDJPYUSDT'): return 'fx'
    return 'cme'
def ts(d, hh, mm=0): return int(dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).timestamp() * 1000)
rows = []
for key, d in P.items():
    k = d['k']
    if len(k) < 24 * 20: continue
    t = np.array([x[0] for x in k]); c = np.array([x[4] for x in k]); close_at = {x[0] + 3600000: x[4] for x in k}  # price at the END of each bar
    def px(ms):
        for back in range(0, 4):  # bar ending exactly then (or up to 3h earlier if missing)
            v = close_at.get(ms - back * 3600000)
            if v: return v
        return None
    r1 = np.diff(np.log(c)); kd = kind(key, d)
    day0 = dt.datetime.fromtimestamp(t[0] / 1000, ET).date(); day1 = dt.datetime.fromtimestamp(t[-1] / 1000, ET).date()
    x = day0
    while x <= day1:
        events = []
        if kd in ('cme', 'fx') and x.weekday() == 4:  # Friday close -> Sunday reopen
            sun = x + dt.timedelta(2); ro = 18 if kd == 'cme' else 17
            events.append((ts(x, 17), ts(sun, ro - 1), ts(sun, ro + 1), ts(sun + dt.timedelta(1), 3), ts(sun + dt.timedelta(1), 17), 'weekend'))
        if kd == 'stock' and x.weekday() < 5:  # 16:00 close -> next trading day's 9:30 open (decision 9:00, bar ends)
            nxt = x + dt.timedelta(1 if x.weekday() < 4 else 3)
            events.append((ts(x, 16), ts(nxt, 9), ts(nxt, 10), ts(nxt, 12), ts(nxt, 16), 'weekend' if x.weekday() == 4 else 'night'))
        for (a, b, e1, e2, e3, typ) in events:
            pa, pb = px(a), px(b)
            if not pa or not pb: continue
            i = np.searchsorted(t, a); sd = np.std(r1[max(0, i - 24 * 20):i]) * np.sqrt(24) if i > 48 else None  # ~daily vol from the last 20 days of hours
            if not sd: continue
            outs = [px(e) for e in (e1, e2, e3)]
            if None in outs: continue
            rows.append(dict(sym=key, kind=kd, typ=typ, t=a, mv=np.log(pb / pa), sd=sd, o=[np.log(v / pb) for v in outs], day=x.isoformat()))
        x += dt.timedelta(1)
print('events', len(rows), {k: sum(r['kind'] == k for r in rows) for k in ('cme', 'fx', 'stock')})
EXIT = ['1h after open', '+9h', '+23h (next close)']
SPLIT = '2026-05-01'
def show(label, sel):
    for kk in (0.0, 0.5, 1.0):
        line = f'{label:34s} |move|>{kk:.1f}x day vol:'
        for half, m in (('early', lambda r: r['day'] < SPLIT), ('late', lambda r: r['day'] >= SPLIT)):
            R = [r for r in rows if sel(r) and m(r) and abs(r['mv']) > kk * r['sd']]
            if len(R) < 5: line += f' {half} n={len(R):3d} -          |'; continue
            g = np.array([[-np.sign(r['mv']) * r['o'][e] for e in range(3)] for r in R])
            line += f' {half} n={len(R):4d} ' + ' '.join(f'{g[:, e].mean()*1e4:+5.0f}bp(t{tstat(g[:, e]):+.1f})' for e in range(3)) + ' |'
        print(line)
print(f'fade the closed-market move; average gross return of the fade at exits: {EXIT}; split {SPLIT}; fee would be -10bp each')
show('GOLD tokens PAXG/XAUT (2022+)', lambda r: any(s in r['sym'] for s in ('PAXG', 'XAUT')) and 'PERP' not in r['sym'])
show('gold/silver/metal perps', lambda r: r['kind'] == 'cme' and any(s in r['sym'] for s in ('XAU', 'XAG', 'XPT', 'XPD', 'COPPER')) and not any(s in r['sym'] for s in ('PAXG', 'XAUT')))
show('oil/gas perps', lambda r: any(s in r['sym'] for s in ('CLUSDT', 'BZUSDT', 'NATGAS')))
show('FX perps (Bybit, since Sep 2026)', lambda r: r['kind'] == 'fx')
show('stock perps, weeknights', lambda r: r['kind'] == 'stock' and r['typ'] == 'night')
show('stock perps, weekends', lambda r: r['kind'] == 'stock' and r['typ'] == 'weekend')
json.dump(rows, open(os.path.join(D, 'closed_events.json'), 'w'))
