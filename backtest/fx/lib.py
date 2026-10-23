# Shared helpers for the forex research (daily data).
import json, os, time, numpy as np
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data_fx')
# pair -> (yahoo symbol, invert so the series is "units of USD per 1 base"? no: keep market quote) ; cost = round-trip spread as a fraction
PAIRS = {'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X', 'USDJPY': 'JPY=X', 'AUDUSD': 'AUDUSD=X', 'USDCAD': 'CAD=X', 'USDCHF': 'CHF=X',
         'NZDUSD': 'NZDUSD=X', 'EURJPY': 'EURJPY=X', 'GBPJPY': 'GBPJPY=X', 'AUDJPY': 'AUDJPY=X', 'EURGBP': 'EURGBP=X', 'XAUUSD': 'GC=F', 'XAGUSD': 'SI=F'}
COST = {p: 0.00012 for p in PAIRS} | {'EURJPY': 0.0002, 'GBPJPY': 0.00025, 'AUDJPY': 0.0002, 'XAUUSD': 0.0002, 'XAGUSD': 0.0005}
TRADEABLE = ('EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'XAGUSD')  # perps on Bybit/Binance
def day(t): return time.strftime('%Y-%m-%d', time.gmtime(t))
def clean(c):
    # remove one-day bad ticks: a huge move that is undone the next day
    c = c.copy(); r = np.diff(np.log(c))
    for i in range(60, len(r) - 1):
        sd = np.std(r[i - 60:i]) or 1e-9
        if abs(r[i]) > 5 * sd and abs(r[i + 1]) > 5 * sd and np.sign(r[i]) != np.sign(r[i + 1]) and abs(r[i] + r[i + 1]) < 0.5 * abs(r[i]):
            c[i + 1] = c[i]; r = np.diff(np.log(c))
    return c
def load_daily(syms=None):
    d = json.load(open(os.path.join(D, 'yahoo_daily.json'))); out = {}
    for k, v in d.items():
        a = np.array(v, dtype=float); a = a[np.argsort(a[:, 0])]
        days = np.array([day(t) for t in a[:, 0]]); _, idx = np.unique(days, return_index=True)  # one bar per date
        a, days = a[idx], days[idx]; out[k] = (days, clean(a[:, 4]))
    return out
def panel(series, names):
    # align closes on the union of dates of the named series, forward-filling gaps (max 3 days)
    dates = sorted(set().union(*[set(series[n][0]) for n in names]))
    M = np.full((len(dates), len(names)), np.nan); pos = {d: i for i, d in enumerate(dates)}
    for j, n in enumerate(names):
        for d, c in zip(*series[n]): M[pos[d], j] = c
    for j in range(len(names)):
        last, age = np.nan, 0
        for i in range(len(dates)):
            if np.isnan(M[i, j]):
                age += 1; M[i, j] = last if age <= 3 else np.nan
            else: last, age = M[i, j], 0
    return np.array(dates), M
def sharpe(r):
    r = np.asarray(r); r = r[~np.isnan(r)]
    return (r.mean() / r.std() * np.sqrt(252)) if len(r) > 20 and r.std() > 0 else np.nan
def tstat(r):
    r = np.asarray(r); r = r[~np.isnan(r)]
    return r.mean() / r.std() * np.sqrt(len(r)) if len(r) > 2 and r.std() > 0 else np.nan
