// Binance futures 5m metrics (data.binance.vision: OI, top-trader and global long/short ratios, taker buy/sell ratio)
// and the premium index (perp vs index price) for the 6h before every entry → data/ext_metrics.json { key: { m: [[t, oi$, topAcc, topPos, glob, taker]], prem: [[t, close]] } }
process.chdir(require('path').join(__dirname, process.env.BT_DATA || 'data'));
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const B = JSON.parse(fs.readFileSync('base_trades.json')); const OUT = 'ext_metrics.json', M = 60000, H = 60 * M;
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'metrics-'));
const sleep = ms => new Promise(r => setTimeout(r, ms)); const lim = {}; const gate = async (k, ps) => { const now = Date.now(), at = Math.max(now, lim[k] || 0); lim[k] = at + 1000 / ps; if (at > now) await sleep(at - now); };
const cache = new Map(); // sym-day → rows
async function day(sym, d) { const k = sym + d; if (cache.has(k)) return cache.get(k);
  const p = (async () => { for (let i = 0; i < 4; i++) { await gate('vision', 12);
    try { const r = await fetch(`https://data.binance.vision/data/futures/um/daily/metrics/${sym}/${sym}-metrics-${d}.zip`, { signal: AbortSignal.timeout(30000) }); if (r.status === 404) return [];
      if (!r.ok) throw new Error(r.status); const z = path.join(TMP, k + '.zip'); fs.writeFileSync(z, Buffer.from(await r.arrayBuffer()));
      const csv = execFileSync('unzip', ['-p', z]).toString(); fs.unlinkSync(z);
      return csv.split('\n').slice(1).map(l => l.split(',')).filter(p => p.length >= 8).map(p => [Date.parse(p[0].replace(' ', 'T') + 'Z'), +p[3], +p[4], +p[5], +p[6], +p[7]]);
    } catch (e) { await sleep(2000 * (i + 1)); } } return []; })();
  cache.set(k, p); return p; }
(async () => {
  const have = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {}; const todo = B.filter(x => !have[x.key]); let n = 0;
  const one = async (x) => { const a = x.t - 6 * H, days = [...new Set([new Date(a).toISOString().slice(0, 10), new Date(x.t).toISOString().slice(0, 10)])];
    const m = (await Promise.all(days.map(d => day(x.s, d)))).flat().filter(r => r[0] >= a && r[0] <= x.t).sort((p, q) => p[0] - q[0]);
    await gate('fapi', 6); let prem = [];
    try { const j = await (await fetch(`https://fapi.binance.com/fapi/v1/premiumIndexKlines?symbol=${x.s}&interval=5m&startTime=${a}&endTime=${x.t - 1}&limit=80`, { signal: AbortSignal.timeout(20000) })).json();
      if (Array.isArray(j)) prem = j.filter(c => c[0] + 5 * M <= x.t).map(c => [+c[0], +c[4], +c[2], +c[3]]); } catch (e) {}
    have[x.key] = { m, prem }; if (++n % 100 === 0) { console.log(new Date().toISOString().slice(11, 19), n, '/', todo.length); fs.writeFileSync(OUT, JSON.stringify(have)); } };
  let i = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (i < todo.length) await one(todo[i++]).catch(e => console.log('ERR', e.message)); }));
  fs.writeFileSync(OUT, JSON.stringify(have)); fs.rmSync(TMP, { recursive: true, force: true });
  console.log('DONE', Object.keys(have).length, 'metrics rows>0:', Object.values(have).filter(v => v.m.length).length, 'premium>0:', Object.values(have).filter(v => v.prem.length).length);
})();
