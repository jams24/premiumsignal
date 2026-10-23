# B4: CFTC positioning (weekly). Leveraged funds (TFF) for currencies, managed money (disaggregated) for gold/silver.
# Tuesday data is public Friday -> trade Friday close to next Friday close. With the 3-year z window trades start 2015: discovery 2015-2017, check 2018-2026.
import sys, os, json, datetime as dt, numpy as np; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
cot = json.load(open(os.path.join(D, 'cot.json')))
MK = {'EUR': ('EURO FX - ', 'EURUSD', 1), 'GBP': ('BRITISH POUND', 'GBPUSD', 1), 'JPY': ('JAPANESE YEN - ', 'USDJPY', -1), 'AUD': ('AUSTRALIAN DOLLAR - ', 'AUDUSD', 1),
      'CAD': ('CANADIAN DOLLAR - ', 'USDCAD', -1), 'CHF': ('SWISS FRANC - ', 'USDCHF', -1), 'NZD': ('NZ DOLLAR - ', 'NZDUSD', 1), 'XAU': ('GOLD - COMMODITY', 'XAUUSD', 1), 'XAG': ('SILVER - COMMODITY', 'XAGUSD', 1)}
S = load_daily(); names = list(PAIRS); dates, C = panel(S, [PAIRS[p] for p in names]); dpos = {d: i for i, d in enumerate(dates)}
def px_on_or_before(j, d):
    for k in range(6):
        x = (dt.date.fromisoformat(d) - dt.timedelta(k)).isoformat()
        if x in dpos and not np.isnan(C[dpos[x], j]): return C[dpos[x], j]
    return np.nan
rows = []
for cur, (key, pair, sgn) in MK.items():
    recs = {}
    for r in cot:
        n = r['Market_and_Exchange_Names']
        if not n.startswith(key) or 'XRATE' in n or 'E-MINI' in n or 'MICRO' in n: continue
        d = r.get('Report_Date_as_YYYY-MM-DD') or r.get('Report_Date_as_YYYY_MM_DD') or ''
        try: oi = float(r['Open_Interest_All'])
        except Exception: continue
        if r['kind'] == 'tff' and cur not in ('XAU', 'XAG'): L, Sh = float(r['Lev_Money_Positions_Long_All']), float(r['Lev_Money_Positions_Short_All'])
        elif r['kind'] == 'dis' and cur in ('XAU', 'XAG'): L, Sh = float(r['M_Money_Positions_Long_All']), float(r['M_Money_Positions_Short_All'])
        else: continue
        if d[:10] not in recs or oi > recs[d[:10]][1]: recs[d[:10]] = ((L - Sh) / oi, oi)
    ds = sorted(recs); net = np.array([recs[d][0] for d in ds]); j = names.index(pair)
    for i in range(156, len(ds) - 1):
        w = net[i - 156:i]; z = (net[i] - w.mean()) / (w.std() or 1)
        d0 = (dt.date.fromisoformat(ds[i]) + dt.timedelta(3)).isoformat(); d1 = (dt.date.fromisoformat(ds[i + 1]) + dt.timedelta(3)).isoformat()
        p0, p1 = px_on_or_before(j, d0), px_on_or_before(j, d1)
        if np.isnan(p0) or np.isnan(p1): continue
        ret = np.log(p1 / p0) * sgn  # return of being long the currency/metal the futures are in
        rows.append(dict(y=int(ds[i][:4]), cur=cur, z=z, dnet=net[i] - net[i - 1], d4=net[i] - net[i - 4], net=net[i], ret=ret, cost=COST[pair]))
print('weeks', len(rows), 'markets', len({r['cur'] for r in rows}), 'years', min(r['y'] for r in rows), '-', max(r['y'] for r in rows))
def test(label, f):
    for per, m in (('2015-17', lambda r: r['y'] <= 2017), ('2018-26', lambda r: r['y'] >= 2018)):
        v = np.array([f(r) * r['ret'] - abs(f(r)) * r['cost'] for r in rows if m(r) and f(r) != 0])
        print(f'{label:46s} {per}: {len(v):4d} weeks avg {v.mean()*1e4:+6.1f}bp t {tstat(v):+.1f} hit {np.mean(v > 0)*100:.0f}%', end=' |')
    print()
test('fade crowding: z > +1.5 short, z < -1.5 long', lambda r: -np.sign(r['z']) if abs(r['z']) > 1.5 else 0)
test('fade crowding: |z| > 2', lambda r: -np.sign(r['z']) if abs(r['z']) > 2 else 0)
test('follow positioning: sign of net', lambda r: np.sign(r['net']))
test('follow 1-week change in net', lambda r: np.sign(r['dnet']))
test('follow 4-week change in net', lambda r: np.sign(r['d4']))
test('fade 4-week change in net', lambda r: -np.sign(r['d4']))
for cur in MK:
    test(f'  {cur} fade |z|>1.5', lambda r, c=cur: (-np.sign(r['z']) if abs(r['z']) > 1.5 else 0) if r['cur'] == c else 0)
# Is "fade last week's change in positioning" just a price reversal? Same Friday-to-Friday weeks, price only.
print()
prev = {}
for r in rows: prev.setdefault(r['cur'], []).append(r)
for c, L in prev.items():
    for a, b in zip(L, L[1:]): b['pret'] = a['ret']
rows = [r for r in rows if 'pret' in r]
test('fade last week PRICE move (no COT)', lambda r: -np.sign(r['pret']))
test('fade 1-week positioning change', lambda r: -np.sign(r['dnet']))
test('fade positioning change, price agrees', lambda r: -np.sign(r['dnet']) if np.sign(r['dnet']) == np.sign(r['pret']) else 0)
test('fade positioning change, price disagrees', lambda r: -np.sign(r['dnet']) if np.sign(r['dnet']) != np.sign(r['pret']) else 0)
print('corr(1w positioning change, last week price move):', np.corrcoef([r['dnet'] for r in rows], [r['pret'] for r in rows])[0, 1].round(2))
