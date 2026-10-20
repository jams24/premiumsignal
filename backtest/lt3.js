// Long-period replay: every 5 min for 2h after each signal run the bot's real followUpCheck (Bybit OI in USD),
// record spot share, then keep the 1m path (72h) after the signal for exit simulation.
process.chdir(require('path').join(__dirname, 'data')); // all JSON lives in backtest/data
const fs = require('fs'); const { getJ, pool } = require('./lib'); const { bybitOI } = require('./lt1');
const { followUpCheck, measureTop } = require('/Users/jams/Desktop/MY PROJECT/cryptosignal/src/collectors/pumpSignalCheck');
const F = 'https://fapi.binance.com', M = 60000, H = 60 * M;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const signals = JSON.parse(fs.readFileSync('signals_L.json')).signals;
const OUT = 'replay_L.json', PATHS = 'paths_L.json';
const paths = fs.existsSync(PATHS) ? JSON.parse(fs.readFileSync(PATHS)) : {};
// a row is final once its 72h path is complete or the signal is older than 74h; otherwise replay it again
const final = r => (paths[r.s + r.t]?.length ?? 0) >= 72 * 60 * 3 || r.t + 74 * 3600000 <= r.at;
const done = (fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : []).filter(final); const have = new Set(done.map(r => r.s + r.t));
function agg(m1, tfMin, now) { const map = new Map(); for (const c of m1) { if (c[0] >= now) break; const k = Math.floor(c[0] / (tfMin * M)) * tfMin * M; const b = map.get(k);
  if (!b) map.set(k, [k, c[1], c[2], c[3], c[4], c[5]]); else { b[2] = Math.max(b[2], c[2]); b[3] = Math.min(b[3], c[3]); b[4] = c[4]; b[5] += c[5]; } } return [...map.values()]; }
(async () => {
  log('signals', signals.length, 'done', done.length); let n = 0;
  await pool(signals.filter(g => !have.has(g.s + g.t)), 4, async (g) => {
    const e = encodeURIComponent(g.s), sigAt = g.t, until = Math.min(Date.now(), sigAt + 74 * H), sym = g.s.replace(/USDT$/, '');
    let m1 = []; for (let t = sigAt - 26 * H; t < until;) { const k = await getJ(`${F}/fapi/v1/klines?symbol=${e}&interval=1m&startTime=${t}&endTime=${until}&limit=1500`); if (!Array.isArray(k) || !k.length) break; m1.push(...k.map(x => [+x[0], +x[1], +x[2], +x[3], +x[4], +x[7]])); t = +k.at(-1)[0] + M; if (k.length < 1500) break; }
    if (m1.length < 1500) return;
    const closeAt = new Map(m1.map(c => [c[0], c[4]]));
    const oi = (await bybitOI(g.s, sigAt - 2 * H, sigAt + 150 * M)).map(x => { const p = closeAt.get(x.t) ?? closeAt.get(x.t - M); return p ? { timestamp: x.t, openInterestAmount: x.q, openInterestValue: x.q * p } : null; }).filter(Boolean);
    const a = sigAt - 2 * H, b = sigAt + 150 * M;
    const bn = async (u, k) => { const j = await getJ(u, k); return Array.isArray(j) && j.length ? j.map(x => [+x[0], +x[7]]) : null; };
    const by = async (cat) => { const j = await getJ(`https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${e}&interval=5&start=${a}&end=${b}&limit=200`, 'bybit'); const l = j?.result?.list; return Array.isArray(l) && l.length ? l.map(x => [+x[0], +x[6]]).sort((p, q) => p[0] - q[0]) : null; };
    const v = { bnSpot: await bn(`https://api.binance.com/api/v3/klines?symbol=${e}&interval=5m&startTime=${a}&endTime=${b}&limit=200`, 'spot'), bySpot: await by('spot'), byPerp: await by('linear') };
    v.bnPerp = agg(m1.filter(c => c[0] >= a - 5 * M), 5, b).map(c => [c[0], c[5]]);
    const w = (ser, now) => ser ? ser.filter(x => x[0] + 5 * M <= now && x[0] >= now - H - 5 * M).slice(-12).reduce((t, x) => t + x[1], 0) : 0;
    const share = (now) => { const sp = ['bnSpot', 'bySpot'].filter(k => v[k]), pp = ['bnPerp', 'byPerp'].filter(k => v[k]); if (!sp.length || !pp.length) return null; const p = pp.reduce((t, k) => t + w(v[k], now), 0); return p ? sp.reduce((t, k) => t + w(v[k], now), 0) / p * 100 : null; };
    const fake = (now) => ({ has: { fetchOpenInterestHistory: oi.length > 0 },
      fetchOHLCV: async (p, tf, since, limit) => { const nn = { '5m': 5, '15m': 15, '1h': 60 }[tf]; let c = agg(m1, nn, now); if (since) c = c.filter(x => x[0] >= since); return c.slice(-limit); },
      fetchOpenInterestHistory: async (p, tf, since) => oi.filter(o => o.timestamp >= since && o.timestamp + 5 * M <= now),
      fetchTicker: async () => ({ last: m1.filter(c => c[0] < now).at(-1)[4] }) });
    const top0 = await measureTop(fake(sigAt), sym, sigAt); if (!top0) return;
    const watch = { symbol: sym, verdict: 'top_fresh', pumpBase: top0.low24, high: top0.high24 }; const all = []; let end = 'expired';
    for (let now = sigAt; now <= sigAt + 120 * M; now += 5 * M) {
      const r = await followUpCheck(fake(now), watch, now); if (r.kind === 'new_high') watch.high = r.top.high24;
      all.push({ now, p: r.price, k: r.kind, age: r.top?.topAgeMin ?? null, oi: r.oi1h ?? null, c: r.cisd?.score ?? 0, c15: r.cisd?.m15?.score ?? 0, below: r.belowHigh ?? null, ret: r.retrace ?? null, sp: share(now) });
      if (r.kind === 'missed') { end = 'missed'; break; } }
    const hl = []; for (const c of m1) if (c[0] >= sigAt && c[0] < sigAt + 72 * H) hl.push(c[2], c[3], c[4]);
    paths[g.s + g.t] = hl;
    done.push({ s: g.s, t: g.t, at: Date.now(), sig: g, end, all, hasSpot: !!(v.bnSpot || v.bySpot), oiN: oi.length });
    if (++n % 25 === 0) { fs.writeFileSync(OUT, JSON.stringify(done)); fs.writeFileSync(PATHS, JSON.stringify(paths)); log('done', done.length, '/', signals.length); }
  });
  fs.writeFileSync(OUT, JSON.stringify(done)); fs.writeFileSync(PATHS, JSON.stringify(paths)); log('FINISHED', done.length);
})().catch(e => { console.log('FATAL', e.stack); process.exit(1); });
