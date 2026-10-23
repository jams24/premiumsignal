# Reference data: Yahoo daily since 2003 + Yahoo 1h (730d) of the real markets, FRED short rates, CFTC COT (TFF + disaggregated).
import json, time, urllib.request, os, io, zipfile, csv
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data_fx')
def raw(u, tries=5):
    for i in range(tries):
        try: return urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read()
        except Exception as e: print('retry', u[:100], e, flush=True); time.sleep(3 + 5 * i)
def yahoo(sym, q):
    b = raw(f'https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?{q}')
    if not b: return []
    r = json.loads(b)['chart']['result'][0]; qq = r['indicators']['quote'][0]
    return [[t, o, h, l, c, v or 0] for t, o, h, l, c, v in zip(r.get('timestamp', []), qq['open'], qq['high'], qq['low'], qq['close'], qq.get('volume') or [0] * len(qq['open'])) if None not in (o, h, l, c)]
import urllib.parse
DAILY = ['EURUSD=X', 'GBPUSD=X', 'JPY=X', 'AUDUSD=X', 'CAD=X', 'CHF=X', 'NZDUSD=X', 'EURJPY=X', 'GBPJPY=X', 'AUDJPY=X', 'EURGBP=X', 'DX-Y.NYB',
         'GC=F', 'SI=F', 'HG=F', 'CL=F', '^GSPC', '^STOXX50E', '^GDAXI', '^FTSE', '^N225', '^AXJO', '^GSPTSE', '^VIX', '^IRX', '^FVX', '^TNX',
         '6E=F', '6B=F', '6J=F', '6A=F', '6C=F', '6S=F']
out = {}
for s in DAILY:
    out[s] = yahoo(s, f'interval=1d&period1=1041379200&period2={int(time.time())}'); time.sleep(0.7)
    print('daily', s, len(out[s]), time.strftime('%Y-%m-%d', time.gmtime(out[s][0][0])) if out[s] else '-', flush=True)
json.dump(out, open(os.path.join(D, 'yahoo_daily.json'), 'w'))
H1 = ['GC=F', 'SI=F', 'PL=F', 'PA=F', 'HG=F', 'CL=F', 'BZ=F', 'NG=F', 'EURUSD=X', 'GBPUSD=X', 'JPY=X', '6E=F', '6B=F', '6J=F', '^GSPC', '^VIX', 'DX-Y.NYB']
out = {}
for s in H1:
    out[s] = yahoo(s, 'interval=1h&range=730d'); time.sleep(0.7); print('1h', s, len(out[s]), flush=True)
json.dump(out, open(os.path.join(D, 'yahoo_1h.json'), 'w'))
fred = {}
for cc in ('US', 'EZ', 'GB', 'JP', 'AU', 'CA', 'CH', 'NZ'):
    for sid in (f'IR3TIB01{cc}M156N', f'IRSTCI01{cc}M156N'):
        b = raw(f'https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}', 3)
        if b and b[:4] != b'<!DO':
            rows = [r for r in csv.reader(io.StringIO(b.decode())) if r and r[0][:1].isdigit() and r[1] not in ('', '.')]
            fred[sid] = [[r[0], float(r[1])] for r in rows]; print('fred', sid, len(rows), rows[-1][0] if rows else '-', flush=True)
        time.sleep(0.5)
json.dump(fred, open(os.path.join(D, 'fred.json'), 'w'))
cot = []
for y in range(2006, 2027):
    for kind, url in (('tff', f'https://www.cftc.gov/files/dea/history/fut_fin_txt_{y}.zip'), ('dis', f'https://www.cftc.gov/files/dea/history/fut_disagg_txt_{y}.zip')):
        b = raw(url, 3)
        if not b: continue
        z = zipfile.ZipFile(io.BytesIO(b)); txt = z.read(z.namelist()[0]).decode('latin-1')
        rd = csv.DictReader(io.StringIO(txt)); n = 0
        for r in rd:
            name = r.get('Market_and_Exchange_Names', '')
            if not any(k in name for k in ('EURO FX - CHICAGO', 'BRITISH POUND', 'JAPANESE YEN', 'AUSTRALIAN DOLLAR', 'CANADIAN DOLLAR', 'SWISS FRANC', 'NZ DOLLAR', 'NEW ZEALAND DOLLAR', 'GOLD - COMMODITY EXCHANGE', 'SILVER - COMMODITY EXCHANGE', 'USD INDEX')): continue
            keep = {k: r[k] for k in r if k and (k.startswith(('Market_and', 'Report_Date', 'Open_Interest_All', 'Dealer_Positions', 'Asset_Mgr_Positions', 'Lev_Money_Positions', 'M_Money_Positions', 'Prod_Merc_Positions', 'Swap_Positions', 'NonRept_Positions')) and ('_All' in k or k.startswith(('Market', 'Report'))))}
            keep['kind'] = kind; cot.append(keep); n += 1
        print('cot', kind, y, n, flush=True)
json.dump(cot, open(os.path.join(D, 'cot.json'), 'w')); print('DONE')
