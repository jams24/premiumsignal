# TradFi perps on the bot's exchanges: 1h klines (+ Binance index price, premium, funding) since listing.
# -> backtest/data_fx/perps.json {venue:sym: {k:[[t,o,h,l,c,quoteVol]], idx:[[t,o,h,l,c]], prem:[[t,c]], fund:[[t,rate]]}}
import json, time, urllib.request, os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data_fx', 'perps.json')
def get(u):
    for i in range(5):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30))
        except Exception as e: print('retry', u[:90], e, flush=True); time.sleep(3 + 5 * i)
    return None
H = 3600000; now = int(time.time() * 1000); res = {}
info = get('https://fapi.binance.com/fapi/v1/exchangeInfo')
syms = [s for s in info['symbols'] if s['status'] == 'TRADING' and (s.get('underlyingSubType') == ['TradFi'] or s['symbol'] in ('PAXGUSDT', 'XAUTUSDT'))]
for s in syms:
    sym, t0 = s['symbol'], s['onboardDate']; d = {'type': s.get('underlyingType'), 'k': [], 'idx': [], 'prem': [], 'fund': []}
    for key, url in (('k', f'https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=1h'), ('idx', f'https://fapi.binance.com/fapi/v1/indexPriceKlines?pair={sym}&interval=1h'),
                     ('prem', f'https://fapi.binance.com/fapi/v1/premiumIndexKlines?symbol={sym}&interval=1h')):
        t = t0
        while t < now:
            k = get(f'{url}&startTime={t}&limit=1500'); time.sleep(0.25)
            if not k: break
            d[key] += [[x[0], float(x[1]), float(x[2]), float(x[3]), float(x[4]), float(x[7])] if key == 'k' else [x[0], float(x[1]), float(x[2]), float(x[3]), float(x[4])] if key == 'idx' else [x[0], float(x[4])] for x in k]
            t = k[-1][0] + H
            if len(k) < 1500: break
    t = t0
    while t < now:
        f = get(f'https://fapi.binance.com/fapi/v1/fundingRate?symbol={sym}&startTime={t}&limit=1000'); time.sleep(0.25)
        if not f: break
        d['fund'] += [[x['fundingTime'], float(x['fundingRate'])] for x in f]; t = f[-1]['fundingTime'] + 1
        if len(f) < 1000: break
    res['binance:' + sym] = d; print('binance', sym, d['type'], len(d['k']), 'h', time.strftime('%Y-%m-%d', time.gmtime(t0 / 1000)), flush=True)
for sym in ('EURUSDUSDT', 'GBPUSDUSDT', 'USDJPYUSDT', 'XAUUSDT', 'XAGUSDT', 'XAUTUSDT', 'PAXGUSDT'):
    d = {'k': [], 'fund': []}; end = now
    while True:
        j = get(f'https://api.bybit.com/v5/market/kline?category=linear&symbol={sym}&interval=60&end={end}&limit=1000'); time.sleep(0.25)
        l = (j or {}).get('result', {}).get('list') or []
        if not l: break
        d['k'] += [[int(x[0]), float(x[1]), float(x[2]), float(x[3]), float(x[4]), float(x[6])] for x in l]; end = int(l[-1][0]) - 1
        if len(l) < 1000: break
    d['k'] = sorted({x[0]: x for x in d['k']}.values())
    end = now
    while True:
        j = get(f'https://api.bybit.com/v5/market/funding/history?category=linear&symbol={sym}&endTime={end}&limit=200'); time.sleep(0.25)
        l = (j or {}).get('result', {}).get('list') or []
        if not l: break
        d['fund'] += [[int(x['fundingRateTimestamp']), float(x['fundingRate'])] for x in l]; end = int(l[-1]['fundingRateTimestamp']) - 1
        if len(l) < 200: break
    d['fund'].sort(); res['bybit:' + sym] = d; print('bybit', sym, len(d['k']), 'h', time.strftime('%Y-%m-%d', time.gmtime(d['k'][0][0] / 1000)) if d['k'] else '-', flush=True)
json.dump(res, open(OUT, 'w')); print('saved', OUT)
