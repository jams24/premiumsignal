// shared helpers: rate-limited fetch with retry
const sleep = ms => new Promise(r => setTimeout(r, ms));
function limiter(perSec) { let next = 0; return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + 1000 / perSec; if (at > now) await sleep(at - now); }; }
const lim = { fapi: limiter(6), data: limiter(2.6), spot: limiter(8), bybit: limiter(8) };
async function getJ(url, kind = 'fapi') {
  for (let i = 0; i < 5; i++) {
    await lim[kind]();
    try { const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status === 418) { await sleep(20000 * (i + 1)); continue; }
      const j = await r.json(); return j; } catch (e) { await sleep(1000 * (i + 1)); }
  }
  return null;
}
async function pool(items, n, fn) { let i = 0; const out = new Array(items.length); await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } } })); return out; }
const rsiLast = (closes, p = 14) => { if (closes.length <= p) return null; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; } g /= p; l /= p;
  for (let i = p + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
module.exports = { sleep, getJ, pool, rsiLast };
