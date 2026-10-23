# Part B: textbook forex effects on daily data, 2003-2026. Rules come from the literature (not tuned here).
# Discovery = 2003-2014, unseen check = 2015-2026. Costs: round-trip spread on every position change.
import sys, os, json, numpy as np; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
S = load_daily(); names = list(PAIRS); dates, C = panel(S, [PAIRS[p] for p in names])
R = np.vstack([np.full(len(names), np.nan), np.diff(np.log(C), axis=0)])  # R[t] = return from t-1 to t
yrs = np.array([int(d[:4]) for d in dates]); TR, TE = yrs <= 2014, yrs >= 2015
cost = np.array([COST[p] for p in names])
def vol(R, n=60):
    v = np.full_like(R, np.nan)
    for t in range(n, len(R)): v[t] = np.nanstd(R[t - n + 1:t + 1], axis=0) * np.sqrt(252)
    return v
V = vol(R)
def run(pos, label):
    # pos[t] decided at close t, earns R[t+1]; returns per instrument (vol-targeted to 10%/yr) and an equal-weight portfolio
    P = np.nan_to_num(pos); ret = P[:-1] * np.nan_to_num(R[1:]) - np.abs(np.diff(np.vstack([np.zeros(len(names)), P]), axis=0))[:-1] * cost
    port = ret.mean(axis=1); m = lambda mask: mask[1:]
    line = f'{label:38s} | train SR {sharpe(port[m(TR)]):+.2f} t {tstat(port[m(TR)]):+.1f} | test SR {sharpe(port[m(TE)]):+.2f} t {tstat(port[m(TE)]):+.1f} ann {port[m(TE)].mean()*252*100:+.1f}%'
    per = ' '.join(f'{n}:{sharpe(ret[m(TE), j]):+.1f}' for j, n in enumerate(names))
    print(line); print('    test SR by market:', per)
    return ret, port
scale = np.where(V > 0, 0.10 / V, 0)
print('=== B1 trend (time-series momentum): position = sign of the last L days, sized to 10%/yr vol ===')
logC = np.log(C)
for L in (21, 63, 126, 252):
    sig = np.full_like(C, np.nan); sig[L:] = np.sign(logC[L:] - logC[:-L]); run(sig * scale, f'trend {L}d')
sigs = []
for L in (21, 63, 126, 252):
    s = np.full_like(C, 0.0); s[L:] = np.sign(logC[L:] - logC[:-L]); sigs.append(s)
run(np.mean(sigs, axis=0) * scale, 'trend blend 1/3/6/12m')
for L in (20, 55, 100):  # breakout: long at an L-day high, short at an L-day low, hold until the opposite L/2-day extreme
    pos = np.zeros_like(C)
    for j in range(len(names)):
        p = 0
        for t in range(L, len(C)):
            w = C[t - L:t, j]; w2 = C[t - L // 2:t, j]
            if np.isnan(C[t, j]) or np.isnan(w).any(): pos[t, j] = 0; continue
            if C[t, j] > w.max(): p = 1
            elif C[t, j] < w.min(): p = -1
            elif p == 1 and C[t, j] < w2.min(): p = 0
            elif p == -1 and C[t, j] > w2.max(): p = 0
            pos[t, j] = p
    run(pos * scale, f'breakout {L}d (exit {L//2}d)')
print('\n=== B2 carry: long the higher-rate currency (FRED 3m interbank, 1-month lag), monthly ===')
fred = json.load(open(os.path.join(D, 'fred.json')))
def rate(cc):
    a = {d[:7]: v for d, v in fred.get(f'IRSTCI01{cc}M156N', [])}; a.update({d[:7]: v for d, v in fred.get(f'IR3TIB01{cc}M156N', [])}); return a
CC = {'EUR': 'EZ', 'GBP': 'GB', 'JPY': 'JP', 'AUD': 'AU', 'CAD': 'CA', 'CHF': 'CH', 'NZD': 'NZ', 'USD': 'US'}
RT = {k: rate(v) for k, v in CC.items()}
def lagged(cur, ym):
    y, m = int(ym[:4]), int(ym[5:7]); m -= 1
    if m == 0: y, m = y - 1, 12
    for _ in range(12):  # last value published at least one month earlier
        k = f'{y}-{m:02d}'
        if k in RT[cur]: return RT[cur][k]
        m -= 1
        if m == 0: y, m = y - 1, 12
    return np.nan
diff = np.full_like(C, np.nan)
for t, d in enumerate(dates):
    for j, n in enumerate(names):
        if n[:3] in CC and n[3:] in CC: diff[t, j] = lagged(n[:3], d[:7]) - lagged(n[3:], d[:7])
carry_sig = np.sign(diff); carry_sig[np.abs(diff) < 0.25] = 0
ret, _ = run(carry_sig * scale, 'carry, spot move only (= perps)')
accr = np.nan_to_num(carry_sig * scale * diff / 100 / 252)
retc = ret + accr[:-1]; port = retc.mean(axis=1)
print(f'{"carry + interest earned (= FX broker)":38s} | train SR {sharpe(port[TR[1:]]):+.2f} | test SR {sharpe(port[TE[1:]]):+.2f} ann {port[TE[1:]].mean()*252*100:+.1f}%')
print('\n=== B3 month-end hedge flows: US stocks beat the rest this month -> USD weakens into month-end ===')
eq = {k: S[k] for k in ('^GSPC', '^STOXX50E', '^FTSE', '^N225', '^AXJO', '^GSPTSE')}
ed, E = panel(eq, list(eq)); epos = {d: i for i, d in enumerate(ed)}
usd_base = np.array([1 if n.startswith('USD') else -1 if n.endswith('USD') else 0 for n in names])  # +1: pair rises when USD rises
months = sorted({d[:7] for d in dates})
for lab, back, hold in (('last 2 days', 3, 2), ('last day', 2, 1), ('first 2 days of next month (reversal?)', 0, -2)):
    rows = []
    for mo in months:
        idx = [i for i, d in enumerate(dates) if d[:7] == mo]
        if len(idx) < 15: continue
        if hold > 0: a, b = idx[-1 - hold], idx[-1]
        else:
            nxt = [i for i, d in enumerate(dates) if d[:7] > mo][:2]
            if len(nxt) < 2: continue
            a, b = idx[-1], nxt[-1]
        sd = dates[idx[-1 - max(hold, 0) - 1] if hold > 0 else idx[-1]]
        s0 = [i for i, d in enumerate(ed) if d[:7] < mo]
        if not s0 or sd not in epos: continue
        e0, e1 = E[s0[-1]], E[epos[sd]]; er = np.log(e1 / e0)
        if np.isnan(er).any(): continue
        us_minus = er[0] - er[1:].mean(); sgn = -np.sign(us_minus)  # US outperformed -> expect USD down
        fx = np.log(C[b] / C[a]) * usd_base
        for j, n in enumerate(names):
            if usd_base[j] and not np.isnan(fx[j]): rows.append((int(mo[:4]), n, sgn * fx[j] * scale[a, j] - 2 * cost[j] * scale[a, j]))
    r = np.array([x[2] for x in rows]); y = np.array([x[0] for x in rows])
    print(f'{lab:38s} | train mean {r[y<=2014].mean()*1e4:+.1f}bp t {tstat(r[y<=2014]):+.1f} n={sum(y<=2014)} | test mean {r[y>=2015].mean()*1e4:+.1f}bp t {tstat(r[y>=2015]):+.1f} n={sum(y>=2015)} (bp at 10% vol size)')
print('\n=== B5 day-of-week (USD pairs, USD direction): train mean vs test mean ===')
import datetime as dt
wd = np.array([dt.date.fromisoformat(d).weekday() for d in dates])
for k in range(5):
    m = wd == k; usd = np.nanmean(R[:, usd_base != 0] * usd_base[usd_base != 0], axis=1)
    print(f'  {"MonTueWedThuFri"[3*k:3*k+3]} USD: train {np.nanmean(usd[m & TR])*1e4:+.1f}bp t {tstat(usd[m & TR]):+.1f} | test {np.nanmean(usd[m & TE])*1e4:+.1f}bp t {tstat(usd[m & TE]):+.1f}')
gold = R[:, names.index('XAUUSD')]
for k in range(5):
    m = wd == k; print(f'  {"MonTueWedThuFri"[3*k:3*k+3]} gold: train {np.nanmean(gold[m & TR])*1e4:+.1f}bp t {tstat(gold[m & TR]):+.1f} | test {np.nanmean(gold[m & TE])*1e4:+.1f}bp t {tstat(gold[m & TE]):+.1f}')
