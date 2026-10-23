# Yahoo 1h candles, last 730 days -> backtest/data_fx/fx1h/y_<SYM>.npy [t, o, h, l, c]
import json, os, sys, urllib.request, numpy as np, time
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data_fx', 'fx1h'); os.makedirs(OUT, exist_ok=True)
M = {'EURUSD':'EURUSD=X','GBPUSD':'GBPUSD=X','USDJPY':'JPY=X','AUDUSD':'AUDUSD=X','USDCAD':'CAD=X','USDCHF':'CHF=X','NZDUSD':'NZDUSD=X',
     'EURJPY':'EURJPY=X','GBPJPY':'GBPJPY=X','EURGBP':'EURGBP=X','AUDJPY':'AUDJPY=X','XAUUSD':'GC=F','XAGUSD':'SI=F'}
for s, y in M.items():
    req = urllib.request.Request(f'https://query1.finance.yahoo.com/v8/finance/chart/{y}?interval=1h&range=730d', headers={'User-Agent': 'Mozilla/5.0'})
    r = json.load(urllib.request.urlopen(req, timeout=60))['chart']['result'][0]; q = r['indicators']['quote'][0]
    a = np.array([r['timestamp'], q['open'], q['high'], q['low'], q['close']], dtype=object).T
    a = np.array([row for row in a if None not in row], dtype=np.float64)
    a = a[(a[:, 2] >= a[:, 3]) & (a[:, 4] > 0)]
    np.save(os.path.join(OUT, f'y_{s}.npy'), a); print(s, len(a), time.strftime('%Y-%m-%d', time.gmtime(a[0, 0])), '->', time.strftime('%Y-%m-%d', time.gmtime(a[-1, 0])), a[-1, 4], flush=True)
    time.sleep(1)
