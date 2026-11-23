(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // closes → [o, h, l, c]; H / L / O pin exact highs, lows, opens where the lesson needs a precise level
  function gen(closes, o = {}) {
    const r = rng(o.seed || 11), w = o.wick ?? 0.0022, H = o.H || {}, L = o.L || {}, O = o.O || {};
    return closes.map((c, i) => {
      const op = O[i] ?? (i ? closes[i - 1] : c * 0.997);
      const top = Math.max(op, c), bot = Math.min(op, c), s = w * c;
      const h = H[i] != null ? Math.max(H[i], top) : top + r() * s;
      const l = L[i] != null ? Math.min(L[i], bot) : bot - r() * s;
      return [op, h, l, c];
    });
  }
  function mk(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function txt(parent, x, y, s, cls, anchor = 'start') { const t = mk('text', { x, y, class: cls || '', 'text-anchor': anchor }, parent); t.textContent = s; return t; }
  function ticks(lo, hi, m) {
    const raw = (hi - lo) / m, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const s = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
    for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-12; v += s) out.push(v);
    return { out, dec: Math.max(0, -Math.floor(Math.log10(s) + 1e-9)) };
  }

  // n = candles shown; post = show annotations flagged post (drill answers)
  function draw(host, S, n, post) {
    const C = S.candles, N = C.length, d = S.digits ?? 1;
    const W = Math.max(300, Math.floor(host.clientWidth || 640)), H = Math.round(Math.min(420, Math.max(W < 560 ? 340 : 280, W * 0.5)));
    const padL = 8, padR = W < 480 ? 50 : 60, padT = 22, padB = 24;
    let lo = Infinity, hi = -Infinity;
    (S.fit ? C.slice(0, n) : C).forEach(k => { lo = Math.min(lo, k[2]); hi = Math.max(hi, k[1]); });
    (S.ann || []).filter(a => !S.fit || ((a.at ?? 0) <= n - 1 && (!a.post || post))).forEach(a => { for (const v of [a.y, a.y0, a.y1, a.stop, a.tp, a.tp2]) if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
    const slot = (W - padL - padR) / N, X = i => padL + slot * (i + 0.5), Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': S.aria || '' });
    const tk = ticks(lo, hi, 5);
    tk.out.forEach(v => { mk('line', { x1: padL, x2: W - padR + 4, y1: Y(v), y2: Y(v), class: 'grid' }, svg); txt(svg, W - padR + 8, Y(v) + 3.5, v.toFixed(tk.dec), 'ax'); });
    const every = S.xEvery || 5;
    for (let i = 0; i < N; i += every) txt(svg, X(i), H - 7, S.times ? S.times[i] : String(i + 1), 'ax', 'middle');

    const seen = a => (a.at ?? 0) <= n - 1 && (!a.post || post);
    const xEnd = (i0, i1) => X(Math.max(i0, Math.min(i1 ?? N - 1, n - 1))) + slot / 2;
    const anns = (S.ann || []).filter(seen);

    for (const a of anns.filter(a => a.type === 'zone')) {
      const x1 = X(a.i0) - slot / 2, x2 = xEnd(a.i0, a.i1), yT = Y(Math.max(a.y0, a.y1)), yB = Y(Math.min(a.y0, a.y1));
      mk('rect', { x: x1, y: yT, width: Math.max(1, x2 - x1), height: Math.max(1, yB - yT), class: 'z-' + a.cls }, svg);
      if (a.label) {
        const lp = a.lp || 'in-right';
        if (lp === 'in-right') txt(svg, x2 - 5, yT + 14, a.label, 't-zone', 'end');
        else if (lp === 'in-left') txt(svg, x1 + 5, yT + 14, a.label, 't-zone');
        else if (lp === 'above-left') txt(svg, x1 + 3, yT - 6, a.label, 't-zone');
        else if (lp === 'bottom-right') txt(svg, x2 - 5, yB - 6, a.label, 't-zone', 'end');
        else if (lp === 'below-left') txt(svg, x1 + 3, yB + 15, a.label, 't-zone');
      }
    }
    for (const a of anns.filter(a => a.type === 'box')) {
      const x1 = X(a.i0) - slot / 2, x2 = xEnd(a.i0, a.i1), w = Math.max(1, x2 - x1);
      const yE = Y(a.entry), yS = Y(a.stop), yT = Y(a.tp);
      mk('rect', { x: x1, y: Math.min(yE, yS), width: w, height: Math.abs(yS - yE), class: 'risk' }, svg);
      mk('rect', { x: x1, y: Math.min(yE, yT), width: w, height: Math.abs(yT - yE), class: 'reward' }, svg);
      a._x = [x1, x2];
    }
    const bw = Math.max(2, Math.min(14, slot * 0.62));
    for (let i = 0; i < n; i++) {
      const [o, h, l, c] = C[i], up = c >= o;
      mk('line', { x1: X(i), x2: X(i), y1: Y(h), y2: Y(l), class: up ? 'wu' : 'wd' }, svg);
      const y1 = Y(Math.max(o, c)), y2 = Y(Math.min(o, c));
      mk('rect', { x: X(i) - bw / 2, y: y1, width: bw, height: Math.max(1.2, y2 - y1), class: up ? 'cu' : 'cd' }, svg);
    }
    for (const a of anns.filter(a => a.type === 'box')) {
      const [x1, x2] = a._x, f = v => (a.bare ? '' : v.toFixed(d)), R = v => Math.abs(a.entry - v) / Math.abs(a.stop - a.entry);
      mk('line', { x1, x2, y1: Y(a.stop), y2: Y(a.stop), class: 'l-stop' }, svg);
      mk('line', { x1, x2, y1: Y(a.entry), y2: Y(a.entry), class: 'l-entry' }, svg);
      mk('line', { x1, x2, y1: Y(a.tp), y2: Y(a.tp), class: 'l-tp' }, svg);
      txt(svg, x2 - 4, Y(a.stop) - 6, (a.stopLabel || 'Stop') + ' ' + f(a.stop), 't-stop', 'end');
      txt(svg, x2 - 4, Y(a.entry) - 6, (a.entryLabel || 'Short') + ' ' + f(a.entry), 't-entry', 'end');
      txt(svg, x2 - 4, Y(a.tp) + 15, (a.tpLabel || 'Target') + ' ' + f(a.tp) + (a.noR ? '' : ` · ${R(a.tp).toFixed(1)}R`), 't-tp', 'end');
      if (a.tp2 != null) {
        mk('line', { x1, x2, y1: Y(a.tp2), y2: Y(a.tp2), class: 'l-tp' }, svg);
        txt(svg, x2 - 4, Y(a.tp2) + 15, (a.tp2Label || 'TP2') + ' ' + f(a.tp2) + (a.noR ? '' : ` · ${R(a.tp2).toFixed(1)}R`), 't-tp', 'end');
      }
    }
    for (const a of anns.filter(a => a.type === 'line')) {
      const x1 = X(a.i0) - slot * 0.3, x2 = xEnd(a.i0, a.i1) - slot * 0.1, y = Y(a.y);
      mk('line', { x1, x2, y1: y, y2: y, class: 'l-' + a.cls }, svg);
      if (!a.label || (a.minW && W < a.minW)) continue;
      const lp = a.lp || 'mid', below = a.ly === 'below';
      if (lp === 'mid') txt(svg, (x1 + x2) / 2, below ? y + 15 : y - 6, a.label, 't-' + a.cls, 'middle');
      else if (lp === 'before') txt(svg, x1 - 5, y + 4, a.label, 't-' + a.cls, 'end');
      else if (lp === 'after') txt(svg, x2 + 5, y + 4, a.label, 't-' + a.cls);
      else if (lp === 'end') txt(svg, x2, below ? y + 15 : y - 6, a.label, 't-' + a.cls, 'end');
    }
    for (const a of anns.filter(a => a.type === 'mark')) {
      const x = X(a.i), y = Y(a.y), above = a.pos !== 'below';
      mk('circle', { cx: x, cy: y, r: a.cls === 'struct' ? 3.5 : 4.5, class: 'm-' + a.cls }, svg);
      if (!a.label || (a.minW && W < a.minW)) continue;
      const anchor = a.anchor || (x > W * 0.72 ? 'end' : x < W * 0.2 ? 'start' : 'middle');
      const dx = anchor === 'end' ? 6 : anchor === 'start' ? -6 : 0;
      txt(svg, x + dx, above ? y - 10 : y + 19, a.label, 't-' + a.cls, anchor);
    }
    host.replaceChildren(svg);
  }

  function observe(host, fn) {
    let w = 0, raf = 0;
    new ResizeObserver(() => { const cw = Math.floor(host.clientWidth); if (cw && cw !== w) { w = cw; cancelAnimationFrame(raf); raf = requestAnimationFrame(fn); } }).observe(host);
  }

  // ---------- lessons ----------
  const L = {};
  L.structure = {
    aria: 'Uptrend with higher highs and higher lows, a CHoCH, then lower highs and breaks of structure down',
    candles: gen([100, 101.4, 102.8, 104.0, 103.0, 102.2, 103.6, 105.0, 106.4, 105.4, 104.4, 104.0, 105.4, 107.1, 108.2, 107.0, 105.8, 104.8, 103.0, 104.0, 105.2, 106.0, 105.0, 103.8, 102.4, 101.6, 102.6, 103.6, 102.6, 101.4, 100.4, 99.6],
      { L: { 5: 101.8, 11: 103.6, 18: 102.7, 25: 101.2 }, H: { 8: 106.9, 14: 108.8, 21: 106.5, 27: 104.0 } }),
    ann: [
      { type: 'mark', i: 5, y: 101.8, label: 'HL', cls: 'struct', pos: 'below', at: 6 },
      { type: 'mark', i: 8, y: 106.9, label: 'HH', cls: 'struct', at: 9 },
      { type: 'mark', i: 11, y: 103.6, label: 'HL', cls: 'struct', pos: 'below', at: 12 },
      { type: 'line', y: 106.9, i0: 8, i1: 13, cls: 'bos', label: 'BOS', at: 13 },
      { type: 'mark', i: 14, y: 108.8, label: 'HH', cls: 'struct', at: 15 },
      { type: 'line', y: 103.6, i0: 11, i1: 18, cls: 'choch', label: 'CHoCH', at: 18 },
      { type: 'mark', i: 21, y: 106.5, label: 'LH', cls: 'struct', at: 22 },
      { type: 'line', y: 102.7, i0: 18, i1: 24, cls: 'bos', label: 'BOS', at: 24 },
      { type: 'mark', i: 25, y: 101.2, label: 'LL', cls: 'struct', pos: 'below', at: 26 },
      { type: 'mark', i: 27, y: 104.0, label: 'LH', cls: 'struct', at: 28 },
      { type: 'line', y: 101.2, i0: 25, i1: 30, cls: 'bos', label: 'BOS', at: 30 },
    ],
    notes: [
      { at: 6, t: 'Each dip stops above the last one: higher lows (HL). Each push goes past the last high: higher highs (HH). Buyers are in control.' },
      { at: 13, t: 'A close above the last higher high is a BOS in the trend direction. The uptrend is still healthy.' },
      { at: 18, t: 'This candle closes below the last higher low. That is a CHoCH: the first sign sellers are taking over. From here, longs are off the table.' },
      { at: 22, t: 'The bounce fails below the old high: a lower high (LH).' },
      { at: 24, t: 'A close below the CHoCH low: BOS down. Structure is now bearish, lower highs and lower lows.' },
      { at: 30, t: 'Every new lower low confirms it. In this structure we look for shorts when price bounces into a lower high.' },
    ],
  };
  const liqBase = [100.6, 101.3, 102.2, 103.4, 102.6, 101.6, 100.8, 101.8, 102.9, 103.5, 102.7, 101.7, 100.9, 101.9, 102.8, 103.4, 103.2, 103.6];
  L.liquidity = {
    aria: 'Range with equal highs and equal lows; price sweeps the highs, closes back below, then runs to the equal lows',
    candles: gen(liqBase.concat([103.5, 102.6, 101.6, 100.8, 100.0, 99.2, 99.6]),
      { O: { 18: 103.6 }, H: { 3: 104.0, 9: 104.05, 18: 104.9 }, L: { 0: 100.3, 6: 100.2, 12: 100.25, 18: 103.4, 22: 99.7 } }),
    ann: [
      { type: 'line', y: 104.05, i0: 3, i1: 18, cls: 'liq', label: 'Equal highs · buy-side liquidity', at: 9 },
      { type: 'line', y: 100.2, i0: 6, i1: 22, cls: 'liq', label: 'Equal lows · sell-side liquidity', ly: 'below', at: 12 },
      { type: 'mark', i: 18, y: 104.9, label: 'Sweep: wick above, close back below', cls: 'sweep', anchor: 'end', at: 18 },
      { type: 'box', i0: 19, i1: 24, entry: 103.5, stop: 105.1, tp: 100.25, at: 18 },
      { type: 'mark', i: 22, y: 99.7, label: 'Sell-side taken', cls: 'tp', pos: 'below', at: 22 },
    ],
    notes: [
      { at: 3, t: 'Every swing high has shorts\' stop-losses and breakout buy orders resting just above it.' },
      { at: 9, t: 'Two highs at the same price (equal highs) make an obvious pool of orders: buy-side liquidity.' },
      { at: 12, t: 'Same below the equal lows: longs\' stops and breakout sells. Sell-side liquidity.' },
      { at: 18, t: 'Price spikes above the equal highs, fills those buy orders, and the candle closes back below. That is a sweep. Big sellers used the buyers\' orders to fill their shorts.' },
      { at: 19, t: 'Short on the close back below. Stop above the sweep wick. First target: the sell-side liquidity at the equal lows.' },
      { at: 22, t: 'The equal lows get taken. Target reached, about 2R (twice the risk).' },
    ],
  };
  L.breakout = {
    aria: 'Same range, but price closes above the equal highs, retests them as support and keeps rising',
    candles: gen(liqBase.concat([104.6, 105.2, 104.6, 105.6, 106.4, 107.0, 106.6, 107.6]),
      { O: { 18: 103.6 }, H: { 3: 104.0, 9: 104.05, 18: 104.9 }, L: { 0: 100.3, 6: 100.2, 12: 100.25, 20: 104.2 } }),
    ann: [
      { type: 'line', y: 104.05, i0: 3, i1: 25, cls: 'liq', label: 'Equal highs', at: 9 },
      { type: 'line', y: 100.2, i0: 6, i1: 25, cls: 'liq', label: 'Equal lows', ly: 'below', at: 12 },
      { type: 'mark', i: 18, y: 104.9, label: 'Closes above the level', cls: 'stop', anchor: 'end', at: 18 },
      { type: 'mark', i: 20, y: 104.2, label: 'Retest holds', cls: 'tp', pos: 'below', at: 20 },
    ],
    notes: [
      { at: 18, t: 'Same spike as lesson 2, but this candle closes above the equal highs.' },
      { at: 19, t: 'The next candle stays above too. No close back below means no sweep. A short here is a guess.' },
      { at: 20, t: 'Price drops back to the old highs and they hold as support. That retest is buyers defending the breakout.' },
      { at: 23, t: 'Breakout. A simple rule many traders use: if price holds above the top for 6 candles, the new high becomes the level to watch.' },
      { at: 25, t: 'Rule of thumb: a sweep is a wick through the level and a close back inside within 1–2 candles. Anything else, stand aside.' },
    ],
  };
  L.supply = {
    aria: 'Last up candle before a strong drop marked as a supply zone, a fair value gap inside the drop, price returning into both and getting rejected',
    candles: gen([100.0, 100.8, 101.6, 102.3, 103.0, 100.6, 98.8, 98.2, 97.6, 98.4, 99.3, 100.2, 101.0, 101.9, 101.2, 100.2, 99.0, 97.8, 96.9, 96.4, 96.8],
      { O: { 0: 100.6, 4: 102.3, 5: 103.0, 14: 101.9 }, H: { 4: 103.4, 5: 103.1, 6: 100.9, 13: 102.0, 14: 102.7 }, L: { 0: 99.5, 4: 102.15, 5: 100.4, 6: 98.6, 19: 96.2 } }),
    ann: [
      { type: 'zone', y0: 102.3, y1: 103.4, i0: 4, i1: 20, cls: 'supply', label: 'Supply zone (order block)', at: 4 },
      { type: 'zone', y0: 100.9, y1: 102.15, i0: 5, i1: 20, cls: 'fvg', label: 'Fair value gap', at: 6 },
      { type: 'line', y: 99.5, i0: 0, i1: 6, cls: 'bos', label: 'BOS', ly: 'below', at: 6 },
      { type: 'mark', i: 14, y: 102.7, label: 'Rejected in the zone', cls: 'sweep', at: 14 },
      { type: 'box', i0: 15, i1: 20, entry: 101.2, stop: 103.6, tp: 96.7, at: 14 },
    ],
    notes: [
      { at: 4, t: 'The last green candle before a strong drop. SMC calls it an order block: where sellers loaded up. Mark from its open to its high.' },
      { at: 6, t: 'The drop is so fast it leaves a gap: this candle\'s high never reaches the low two candles back. That is a bearish FVG. The close below the old low is also a BOS, which makes the zone above valid.' },
      { at: 12, t: 'Price climbs back into the gap. Gaps often get partly filled before the move continues.' },
      { at: 14, t: 'It pokes into the supply zone and gets rejected: long upper wick, close back down. Short on the close.' },
      { at: 15, t: 'Stop above the whole zone: if price closes above it, the idea is wrong. Target below the last low.' },
      { at: 19, t: 'Target hit, about 1.9R.' },
    ],
  };
  // points of interest: a demand order block that ticks all five boxes, and price coming back to it
  L.poi = {
    aria: 'A red candle sweeps an old low, a fast rally leaves a fair value gap and breaks the last high; that red candle is the point of interest. Price pulls back, takes a small inducement low, taps the zone and rallies to the old high',
    candles: gen([103.2, 102.4, 100.9, 101.8, 101.2, 100.6, 102.4, 103.4, 104.3, 104.8, 104.1, 103.6, 103.3, 103.9, 104.2, 103.4, 102.4, 101.7, 102.6, 103.4, 104.1, 104.9, 105.4, 105.0, 105.6],
      { O: { 0: 103.8, 5: 101.3, 7: 102.6, 17: 102.1 }, H: { 3: 102.6, 5: 101.4, 9: 105.1, 14: 104.4, 22: 105.6 }, L: { 2: 100.4, 5: 99.8, 7: 102.5, 12: 103.0, 16: 102.2, 17: 100.95 } }),
    ann: [
      { type: 'line', y: 100.4, i0: 2, i1: 5, cls: 'liq', label: 'Old low', ly: 'below', at: 2 },
      { type: 'mark', i: 5, y: 99.8, label: 'Takes the old low', cls: 'sweep', pos: 'below', at: 5 },
      { type: 'zone', y0: 99.8, y1: 101.3, i0: 5, i1: 14, cls: 'demand', label: 'POI · order block', lp: 'in-right', at: 7 },
      { type: 'zone', y0: 101.4, y1: 102.5, i0: 6, i1: 14, cls: 'fvg', label: 'FVG', lp: 'in-right', at: 7 },
      { type: 'line', y: 102.6, i0: 3, i1: 7, cls: 'bos', label: 'BOS', at: 7 },
      { type: 'line', y: 103.0, i0: 12, i1: 16, cls: 'liq', label: 'Inducement', ly: 'below', at: 12 },
      { type: 'mark', i: 17, y: 100.95, label: 'POI tapped', cls: 'tp', pos: 'below', at: 17 },
      { type: 'box', i0: 17, i1: 24, entry: 101.3, stop: 99.7, tp: 105.1, entryLabel: 'Buy', at: 17 },
    ],
    notes: [
      { at: 2, t: 'An old low at 100.4. Buyers\' stops sit just under it: sell-side liquidity.' },
      { at: 5, t: 'The last red candle dips under that low, fills those stops, and closes back above. Box 4 of the checklist: it took liquidity.' },
      { at: 7, t: 'A fast rally leaves a fair value gap (box 3) and closes above the last high: a BOS. The last red candle before it is the order block. Mark it from its open to its low. That box is the POI.' },
      { at: 9, t: 'Price makes a new high. The POI now sits in the bottom (discount) half of the move: box 2. Box 1 is the slower chart\'s trend, up here.' },
      { at: 12, t: 'Price pulls back and a small low forms above the POI. Early buyers put their stops under it. SMC calls it inducement: box 5.' },
      { at: 16, t: 'Price takes that small low on the way down. Those stops are the fuel that brings price into the POI.' },
      { at: 17, t: 'It taps the POI and closes back up. A buy limit at the top of the box fills at 101.3, stop under the box at 99.7.' },
      { at: 22, t: 'Price runs to the old high: 2.4R. This is the textbook picture, 5 boxes out of 5. The next part shows how often it really goes like this.' },
    ],
  };
  L.premium = {
    aria: 'A swing from 110 down to 100 split at 50 percent into premium and discount, with a short taken in the 62 to 79 percent band',
    candles: gen([109.2, 108.6, 107.4, 106.8, 105.5, 104.9, 103.6, 102.8, 101.6, 100.9, 100.4, 101.2, 102.3, 103.6, 104.4, 105.6, 106.6, 106.0, 104.8, 103.5, 102.4, 101.2, 100.3, 99.4, 99.8],
      { O: { 0: 109.6, 17: 106.6 }, H: { 0: 110.0, 17: 107.3 }, L: { 10: 100.0, 23: 99.1 } }),
    ann: [
      { type: 'zone', y0: 105, y1: 110, i0: 10, i1: 24, cls: 'prem', label: 'Premium · shorts', at: 10 },
      { type: 'zone', y0: 100, y1: 105, i0: 10, i1: 24, cls: 'disc', label: 'Discount · no shorts', at: 10 },
      { type: 'line', y: 105, i0: 10, i1: 24, cls: 'eq', label: '50%', lp: 'before', at: 10 },
      { type: 'zone', y0: 106.2, y1: 107.9, i0: 13, i1: 24, cls: 'ote', label: 'OTE 62–79%', lp: 'in-left', at: 13 },
      { type: 'mark', i: 17, y: 107.3, label: 'Short from premium', cls: 'sweep', anchor: 'end', at: 17 },
      { type: 'box', i0: 18, i1: 24, entry: 106.0, stop: 107.6, tp: 100.0, at: 17 },
    ],
    notes: [
      { at: 10, t: 'Measure the last swing: 110 high to 100 low. The 50% line splits it. Above is premium (expensive), below is discount (cheap).' },
      { at: 13, t: 'In a downtrend, shorts are only taken in premium. ICT\'s optimal trade entry (OTE) is the 62–79% retracement of the swing.' },
      { at: 17, t: 'Price reaches the OTE band and rejects. Short, with the stop above the wick.' },
      { at: 23, t: 'Shorting from premium leaves room to the low: here about 3.8R. A short in discount has little room left and fights the bounce.' },
    ],
  };
  L.setup = {
    aria: 'Full short setup: supply zone, equal lows below, inducement high swept into the zone, CHoCH, entry on the retest, targets at the lows',
    candles: gen([107.4, 105.6, 104.2, 102.9, 102.3, 102.9, 103.6, 102.8, 102.2, 102.9, 103.8, 104.7, 105.6, 105.1, 105.8, 106.0, 104.5, 105.2, 104.0, 103.0, 102.3, 101.5, 100.6, 99.8, 100.2],
      { O: { 0: 106.2, 15: 105.8 }, H: { 0: 108.0, 12: 106.4, 15: 106.9, 17: 105.5 }, L: { 0: 106.0, 4: 101.9, 8: 101.92, 13: 104.85, 16: 104.3, 23: 99.5 } }),
    ann: [
      { type: 'zone', y0: 106.2, y1: 108.0, i0: 0, i1: 24, cls: 'supply', label: 'Supply zone (higher timeframe)', lp: 'above-left', at: 1 },
      { type: 'line', y: 101.9, i0: 4, i1: 21, cls: 'liq', label: 'Equal lows · target', ly: 'below', at: 8 },
      { type: 'line', y: 106.4, i0: 12, i1: 15, cls: 'liq', at: 13 },
      { type: 'mark', i: 12, y: 106.4, label: 'Inducement high', cls: 'struct', anchor: 'end', at: 13 },
      { type: 'mark', i: 15, y: 106.9, label: 'Sweep', cls: 'sweep', anchor: 'start', at: 15 },
      { type: 'line', y: 104.85, i0: 13, i1: 16, cls: 'choch', label: 'CHoCH', ly: 'below', at: 16 },
      { type: 'box', i0: 17, i1: 24, entry: 105.4, stop: 107.1, tp: 101.9, tp2: 99.6, tpLabel: 'TP1', at: 17 },
    ],
    notes: [
      { at: 3, t: 'Start on the higher timeframe: downtrend, with a supply zone left at the top. Only shorts are on the menu.' },
      { at: 8, t: 'Two equal lows form below: sell-side liquidity. That is where price is likely to go later, so it is the target.' },
      { at: 12, t: 'Price bounces back toward the supply zone. A small high forms inside the bounce. SMC calls it inducement: early shorts put their stops above it.' },
      { at: 15, t: 'Price sweeps that high, taps the supply zone and closes back below. Liquidity taken, zone respected.' },
      { at: 16, t: 'The next candle closes below the bounce\'s last higher low: a CHoCH on the lower timeframe. Sellers are back.' },
      { at: 17, t: 'Enter on the pullback at 105.4 instead of chasing the CHoCH candle. Stop 107.1 above the sweep, TP1 at the equal lows (2R), TP2 lower (3.4R).' },
      { at: 21, t: 'TP1 hits when the equal lows are swept.' },
      { at: 23, t: 'TP2 hits. If the pullback had never come, the trade is simply missed.' },
    ],
  };
  // lesson 7: one move on three timeframes. The 15m chart is 4H candles 16–17 zoomed in, the 1m chart is 15m candles 14–15.
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const clock = (startMin, step, n, day) => Array.from({ length: n }, (_, i) => {
    const m = startMin + step * i;
    return (day ? DAYS[Math.floor(m / 1440) % 7] + ' ' : '') + String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  });
  L.tf4h = {
    aria: '4 hour chart: higher high, CHoCH down, lower high with a supply zone, lower low, then a bounce into premium that wicks into the supply zone',
    candles: gen([104.0, 106.2, 108.8, 110.6, 108.3, 105.9, 103.6, 105.45, 106.6, 104.0, 101.8, 99.2, 97.0, 98.6, 100.1, 102.0, 104.9, 101.4],
      { O: { 0: 102.6 }, H: { 3: 111.4, 8: 107.6, 16: 106.85, 17: 105.1 }, L: { 0: 102.2, 6: 103.1, 12: 96.4, 16: 101.9, 17: 101.0 } }),
    times: clock(0, 240, 18, true), xEvery: 6,
    ann: [
      { type: 'mark', i: 3, y: 111.4, label: 'HH', cls: 'struct', at: 5 },
      { type: 'mark', i: 6, y: 103.1, label: 'HL', cls: 'struct', pos: 'below', at: 8 },
      { type: 'line', y: 103.1, i0: 6, i1: 10, cls: 'choch', label: 'CHoCH', ly: 'below', at: 10 },
      { type: 'mark', i: 8, y: 107.6, label: 'LH', cls: 'struct', at: 10 },
      { type: 'zone', y0: 105.45, y1: 107.6, i0: 8, i1: 17, cls: 'supply', label: 'Supply zone', lp: 'in-left', at: 10 },
      { type: 'mark', i: 12, y: 96.4, label: 'LL', cls: 'struct', pos: 'below', at: 14 },
      { type: 'zone', y0: 102.0, y1: 105.45, i0: 12, i1: 17, cls: 'prem', label: 'Premium', lp: 'in-left', at: 14 },
      { type: 'line', y: 102.0, i0: 12, i1: 17, cls: 'eq', label: '50%', lp: 'before', at: 14 },
      { type: 'mark', i: 16, y: 106.85, label: 'Into the zone', cls: 'sweep', anchor: 'end', at: 16 },
    ],
    notes: [
      { at: 5, t: 'The 4H makes a higher high at 111.4. Buyers are in control.' },
      { at: 10, t: 'This 4H candle closes below the last higher low (103.1): CHoCH. The 4H now says short. The last up candle before the drop, 105.45 to 107.6, is the supply zone.' },
      { at: 14, t: 'A lower low at 96.4. Measure the leg from the lower high (107.6) to 96.4: the 50% line is 102.0. Above it is premium.' },
      { at: 15, t: 'Price bounces back to 102. On the 4H you just wait. Shorts are allowed once price is in premium, under the supply zone.' },
      { at: 16, t: 'Price is in premium and wicks into the supply zone. Open the 15m to see this candle in detail (step 2).' },
      { at: 17, t: 'The next 4H candle drops to 101.4. On the 4H the whole entry is hidden inside one candle. That is why you need the faster charts.' },
    ],
  };
  L.tf15 = {
    aria: '15 minute chart of the bounce: rising steps, equal highs inside the 4 hour supply zone, a sweep candle that closes back below, then a drop to the start of the bounce',
    candles: gen([102.4, 102.9, 103.6, 103.2, 104.0, 104.7, 104.3, 104.9, 105.4, 104.95, 105.15, 105.45, 105.05, 105.30, 105.35, 104.90, 104.4, 104.6, 103.9, 103.2, 102.7, 102.1, 101.8, 101.9],
      { wick: 0.0012, O: { 0: 102.0 }, H: { 8: 105.70, 11: 105.72, 14: 106.85 }, L: { 0: 101.9, 14: 105.1, 22: 101.6 } }),
    digits: 2, times: clock(16 * 60, 15, 24), xEvery: 4,
    ann: [
      { type: 'zone', y0: 105.45, y1: 107.6, i0: 0, i1: 23, cls: 'supply', label: '4H supply zone', lp: 'in-left', at: 0 },
      { type: 'line', y: 102.0, i0: 0, i1: 23, cls: 'eq', label: '4H 50%', at: 0 },
      { type: 'line', y: 105.72, i0: 8, i1: 14, cls: 'liq', label: 'Equal highs', at: 11 },
      { type: 'mark', i: 14, y: 106.85, label: 'Sweep, close back below', cls: 'sweep', anchor: 'end', at: 14 },
      { type: 'box', i0: 15, i1: 23, entry: 105.10, stop: 106.95, tp: 101.95, entryLabel: 'Short (from the 1m)', tpLabel: 'TP1', at: 15 },
    ],
    notes: [
      { at: 4, t: 'Inside the 4H bounce, the 15m looks bullish: higher highs and higher lows. That is normal. It is the 4H pullback, so don\'t take direction from it.' },
      { at: 11, t: 'Two equal highs at about 105.7, just inside the 4H supply zone. Early shorts\' stops and breakout buys sit above them: liquidity.' },
      { at: 14, t: 'This candle spikes to 106.85, takes the equal highs and closes back below at 105.35. The sweep is confirmed. Switch to the 1m for the entry (step 3).' },
      { at: 15, t: 'The 1m entry happens inside this candle: short 105.10, stop 106.95 above the wick.' },
      { at: 21, t: 'TP1 at the start of the bounce (101.95), the 15m sell-side liquidity: 1.7R. The 4H low at 96.4 is the bigger target.' },
    ],
  };
  L.tf1 = {
    aria: '1 minute chart of the sweep candle: a swing low, a spike to 106.85, the 15 minute close, then a close below the swing low as the entry',
    candles: gen([105.45, 105.60, 105.50, 105.35, 105.28, 105.62, 105.95, 106.30, 106.55, 106.05, 105.80, 105.95, 105.65, 105.50, 105.35, 105.42, 105.10, 105.22, 104.95, 105.05, 104.80, 104.70, 104.85, 104.55],
      { wick: 0.0006, O: { 0: 105.30 }, H: { 8: 106.85 }, L: { 4: 105.20 } }),
    digits: 2, times: clock(19 * 60 + 30, 1, 24), xEvery: 5,
    ann: [
      { type: 'zone', y0: 105.45, y1: 107.6, i0: 0, i1: 23, cls: 'supply', label: '4H supply zone', at: 0 },
      { type: 'line', y: 105.72, i0: 0, i1: 23, cls: 'liq', label: '15m equal highs', lp: 'end', at: 0 },
      { type: 'mark', i: 4, y: 105.20, label: 'Last 1m swing low', cls: 'struct', pos: 'below', anchor: 'start', at: 7 },
      { type: 'mark', i: 8, y: 106.85, label: 'Sweep wick', cls: 'sweep', at: 8 },
      { type: 'line', y: 105.20, i0: 4, i1: 16, cls: 'choch', label: '1m CHoCH', ly: 'below', at: 16 },
      { type: 'line', y: 106.95, i0: 16, i1: 23, cls: 'stop', label: 'Stop 106.95', lp: 'end', at: 16 },
      { type: 'line', y: 105.10, i0: 16, i1: 23, cls: 'entry', label: 'Short 105.10', lp: 'end', ly: 'below', at: 16 },
    ],
    notes: [
      { at: 7, t: 'The last 1m swing low before the spike is 105.20 (confirmed three candles later). Mark it: it is the trigger level.' },
      { at: 8, t: 'The spike into the 4H zone. This wick, 106.85, is the sweep the 15m showed.' },
      { at: 14, t: 'The 15m candle closes here at 105.35, back below the equal highs. Only now is the sweep confirmed. Before this close it could still have become a breakout.' },
      { at: 16, t: 'A 1m close below 105.20: CHoCH. Short 105.10 at the close, stop 106.95 just above the wick. The targets come from the slower charts: 101.95 (15m, 1.7R) and 96.4 (the 4H low, 4.7R).' },
      { at: 23, t: 'The 1m only times the entry. If the 4H had been bullish, this same 1m CHoCH would just be a dip in an uptrend.' },
    ],
  };
  // lesson 8: the group charts' zone retest, a resting sell limit at the order block's edge
  L.retest = {
    aria: 'Rise, last up candle marked as a supply zone, break of structure, first return fills a sell limit at the zone edge, target the recent low',
    candles: gen([100.0, 100.5, 101.1, 101.6, 102.2, 101.0, 99.9, 99.2, 98.7, 99.1, 99.6, 100.3, 100.9, 101.4, 101.2, 100.6, 99.9, 99.2, 98.6, 98.8],
      { O: { 0: 99.6, 4: 101.6 }, H: { 4: 102.6, 13: 101.75 }, L: { 0: 99.5, 8: 98.4, 18: 98.35 } }),
    ann: [
      { type: 'mark', i: 4, y: 102.6, label: 'Last up candle', cls: 'struct', at: 4 },
      { type: 'zone', y0: 101.6, y1: 102.6, i0: 4, i1: 19, cls: 'supply', label: 'Supply zone (the grey box)', at: 7 },
      { type: 'line', y: 99.5, i0: 0, i1: 7, cls: 'bos', label: 'BOS', ly: 'below', at: 7 },
      { type: 'mark', i: 8, y: 98.4, label: 'Recent low', cls: 'struct', pos: 'below', at: 10 },
      { type: 'box', i0: 13, i1: 19, entry: 101.6, stop: 102.7, tp: 98.4, entryLabel: 'Sell limit', tpLabel: 'Recent low', at: 12 },
      { type: 'mark', i: 13, y: 101.75, label: 'Filled at the edge', cls: 'sweep', anchor: 'end', at: 13 },
      { type: 'mark', i: 18, y: 98.35, label: 'Target hit', cls: 'tp', pos: 'below', at: 18 },
    ],
    notes: [
      { at: 4, t: 'The last up candle before the drop. The group\'s grey box runs from its body bottom (101.6) to its high (102.6). That is the order block.' },
      { at: 7, t: 'A close below the low the move started from: break of structure. The box above is now a supply zone.' },
      { at: 10, t: 'The recent low, 98.4, becomes the target.' },
      { at: 12, t: 'The order is placed before price gets back: sell limit at the zone edge (101.6), stop just above the box (102.7), target the recent low. About 2.9R, with no sweep and no lower-timeframe CHoCH.' },
      { at: 13, t: 'The first return to the box fills the order.' },
      { at: 18, t: 'Target hit. When it works, the entry beats ours because it waits for nothing. When price runs straight through the box, the stop is hit with no warning.' },
    ],
  };
  // lesson 9: inducement (the @varisthetrader video), five invented charts
  L.ind1 = {
    aria: 'Downtrend: one candle body closes below a low (a real break), later a candle only wicks below the next low and closes back above (a fake break)',
    candles: gen([108.0, 107.0, 105.8, 104.6, 105.4, 106.2, 105.0, 103.4, 102.9, 103.8, 104.6, 103.9, 103.2, 103.5, 104.2, 104.9],
      { O: { 0: 108.6, 13: 103.2 }, H: { 0: 108.9, 5: 106.5, 10: 104.9 }, L: { 3: 104.0, 8: 102.6, 13: 102.1 } }),
    ann: [
      { type: 'mark', i: 3, y: 104.0, label: 'Low', cls: 'struct', pos: 'below', at: 4 },
      { type: 'line', y: 104.0, i0: 3, i1: 7, cls: 'bos', label: 'Real break', ly: 'below', at: 7 },
      { type: 'mark', i: 8, y: 102.6, label: 'New low', cls: 'struct', pos: 'below', at: 9 },
      { type: 'line', y: 102.6, i0: 8, i1: 15, cls: 'liq', label: 'Only a wick: not a break', lp: 'end', at: 13 },
      { type: 'mark', i: 13, y: 102.1, label: 'Wick', cls: 'sweep', pos: 'below', at: 13 },
    ],
    notes: [
      { at: 3, t: 'Price is walking down a staircase. Each low is a step. This step is at 104.0.' },
      { at: 7, t: 'This candle\'s body closes below 104.0. That is a real break (BOS), like jumping over a puddle and landing on the other side.' },
      { at: 8, t: 'A new, lower step forms at 102.6.' },
      { at: 13, t: 'This candle\'s wick dips below 102.6, but its body closes back above. That is dipping a toe in the puddle and pulling it back. The low is NOT broken.' },
      { at: 15, t: 'Price climbs again. The video says a fake break means the market wants to go up first and grab something. Example 2 shows what.' },
    ],
  };
  L.ind2 = {
    aria: 'Bearish inducement: two real breaks, an order block above, a wick-only break, then price takes the small high, taps the order block where a sell limit fills, and falls through the wick low',
    candles: gen([110.2, 109.4, 108.3, 108.9, 109.5, 108.6, 107.3, 106.6, 107.1, 107.9, 107.0, 105.8, 105.3, 105.6, 106.1, 105.5, 105.4, 106.0, 106.7, 106.6, 105.9, 105.2, 104.6, 104.0, 104.3],
      { O: { 0: 110.8, 19: 106.7 }, H: { 0: 111.0, 4: 109.8, 9: 108.3, 14: 106.4, 18: 106.9, 19: 107.4 }, L: { 2: 107.9, 7: 106.2, 12: 104.9, 16: 104.3, 23: 103.8 } }),
    ann: [
      { type: 'line', y: 107.9, i0: 2, i1: 6, cls: 'bos', label: 'Real break', ly: 'below', at: 6 },
      { type: 'line', y: 106.2, i0: 7, i1: 11, cls: 'bos', label: 'Real break', ly: 'below', at: 11 },
      { type: 'zone', y0: 107.1, y1: 108.3, i0: 9, i1: 24, cls: 'supply', label: 'Order block (the box)', lp: 'above-left', at: 11 },
      { type: 'line', y: 104.9, i0: 12, i1: 16, cls: 'liq', label: 'Only a wick', ly: 'below', at: 16 },
      { type: 'line', y: 106.4, i0: 14, i1: 18, cls: 'liq', at: 16 },
      { type: 'mark', i: 14, y: 106.4, label: 'Bait', cls: 'struct', at: 16 },
      { type: 'mark', i: 16, y: 104.3, label: 'Wick low = target', cls: 'tp', pos: 'below', at: 16 },
      { type: 'box', i0: 17, i1: 24, entry: 107.1, stop: 108.4, tp: 104.3, entryLabel: 'Sell limit', tpLabel: 'Wick low', at: 17 },
      { type: 'mark', i: 18, y: 106.9, label: 'Bait grabbed', cls: 'sweep', anchor: 'end', at: 18 },
      { type: 'mark', i: 23, y: 103.8, label: 'Target hit', cls: 'tp', pos: 'below', at: 23 },
    ],
    notes: [
      { at: 6, t: 'Price is going down. This body closes below the last low: a real break. Sellers are in charge.' },
      { at: 11, t: 'Another real break. The last green candle before this drop is the order block, the red box from 107.1 to 108.3. Big sellers started the drop there.' },
      { at: 14, t: 'A small bounce makes a little high at 106.4.' },
      { at: 16, t: 'The trick: this candle only wicks below the last low (104.9) and closes back above. Not a real break, so the little high at 106.4 is not protected. Sellers have their stop-losses just above it. That pile of stops is the inducement: the bait.' },
      { at: 17, t: 'The video\'s plan: price climbs, grabs the bait above 106.4, touches the box, then falls to the wick low. So: sell limit at the bottom of the box (107.1), stop just above the box (108.4), target the wick low (104.3). About 2.2R: you would win 2.2 times what you risk.' },
      { at: 18, t: 'Price goes above 106.4. The stops there are hit: the bait is grabbed.' },
      { at: 19, t: 'Price pokes into the box and gets pushed back down. The sell limit fills at 107.1.' },
      { at: 23, t: 'Price falls through the wick low. Target hit, +2.2R. This is the picture the video shows.' },
    ],
  };
  L.ind3 = {
    aria: 'Bullish inducement: a real break up, a demand order block below, a wick-only break above the high, then price takes the small low, taps the order block where a buy limit fills, and rallies through the wick high',
    candles: gen([46.0, 46.6, 47.3, 46.9, 46.5, 47.2, 48.0, 48.6, 48.2, 47.8, 48.4, 48.7, 48.1, 47.5, 47.2, 47.8, 48.4, 49.1, 49.7, 49.5],
      { O: { 0: 45.6, 11: 48.4 }, H: { 2: 47.5, 7: 48.9, 11: 49.6, 18: 49.9 }, L: { 0: 45.4, 4: 46.2, 9: 47.6, 13: 47.3, 14: 46.8 } }),
    digits: 2,
    ann: [
      { type: 'line', y: 47.5, i0: 2, i1: 6, cls: 'bos', label: 'Real break up', at: 6 },
      { type: 'zone', y0: 46.2, y1: 46.9, i0: 4, i1: 19, cls: 'disc', label: 'Order block (the box)', lp: 'below-left', at: 7 },
      { type: 'line', y: 48.9, i0: 7, i1: 11, cls: 'liq', label: 'Only a wick', at: 11 },
      { type: 'line', y: 47.6, i0: 9, i1: 13, cls: 'liq', at: 11 },
      { type: 'mark', i: 9, y: 47.6, label: 'Bait', cls: 'struct', pos: 'below', at: 11 },
      { type: 'mark', i: 11, y: 49.6, label: 'Wick high = target', cls: 'tp', at: 11 },
      { type: 'box', i0: 12, i1: 19, entry: 46.9, stop: 46.15, tp: 49.6, entryLabel: 'Buy limit', tpLabel: 'Wick high', at: 12 },
      { type: 'mark', i: 13, y: 47.3, label: 'Bait grabbed', cls: 'sweep', pos: 'below', anchor: 'end', at: 13 },
      { type: 'mark', i: 18, y: 49.9, label: 'Target hit', cls: 'tp', at: 18 },
    ],
    notes: [
      { at: 6, t: 'Now the other way. Price is going up, and this body closes above the last high: a real break up. Buyers are in charge.' },
      { at: 7, t: 'The last red candle before this push up is the order block, the green box from 46.2 to 46.9. Big buyers started the move there.' },
      { at: 9, t: 'A small dip makes a little low at 47.6.' },
      { at: 11, t: 'This candle\'s wick pokes above the high (48.9), but its body closes back below. A fake break. So the little low at 47.6 is the bait: buyers hide their stop-losses just under it.' },
      { at: 12, t: 'The mirror plan: buy limit at the top of the box (46.9), stop just under the box (46.15), target the wick high (49.6). About 3.6R.' },
      { at: 13, t: 'Price drops below 47.6: the bait is grabbed.' },
      { at: 14, t: 'It dips into the box and bounces. The buy limit fills at 46.9.' },
      { at: 18, t: 'Up through the wick high. Target hit, +3.6R.' },
    ],
  };
  L.ind4 = {
    aria: 'Inducement short that fails: same pattern, the sell limit fills at the order block, then price keeps rising through the box and hits the stop',
    candles: gen([2.300, 2.240, 2.180, 2.220, 2.260, 2.190, 2.120, 2.090, 2.130, 2.160, 2.120, 2.100, 2.140, 2.190, 2.250, 2.270, 2.310, 2.360, 2.400, 2.380],
      { O: { 0: 2.36, 11: 2.12 }, H: { 0: 2.38, 4: 2.28, 9: 2.17, 13: 2.20, 14: 2.26, 16: 2.33 }, L: { 2: 2.15, 7: 2.07, 11: 2.04 } }),
    digits: 3,
    ann: [
      { type: 'line', y: 2.15, i0: 2, i1: 6, cls: 'bos', label: 'Real break', ly: 'below', at: 6 },
      { type: 'zone', y0: 2.22, y1: 2.28, i0: 4, i1: 19, cls: 'supply', label: 'Order block', lp: 'above-left', at: 6 },
      { type: 'line', y: 2.07, i0: 7, i1: 11, cls: 'liq', label: 'Only a wick', ly: 'below', at: 11 },
      { type: 'mark', i: 9, y: 2.17, label: 'Bait', cls: 'struct', at: 11 },
      { type: 'mark', i: 11, y: 2.04, label: 'Wick low = target', cls: 'tp', pos: 'below', at: 11 },
      { type: 'box', i0: 12, i1: 19, entry: 2.22, stop: 2.283, tp: 2.04, entryLabel: 'Sell limit', tpLabel: 'Wick low', at: 12 },
      { type: 'mark', i: 13, y: 2.20, label: 'Bait grabbed', cls: 'sweep', anchor: 'end', at: 13 },
      { type: 'mark', i: 16, y: 2.33, label: 'Stopped: −1R', cls: 'stop', anchor: 'end', at: 16 },
    ],
    notes: [
      { at: 11, t: 'Same picture as example 2: a real break, then a wick-only break, bait at 2.17 and the box above it. Sell limit at 2.22, stop 2.283, target the wick low 2.04 (2.9R).' },
      { at: 13, t: 'The bait is grabbed, just like the video says.' },
      { at: 14, t: 'Price reaches the box. The sell limit fills at 2.22.' },
      { at: 16, t: 'But price doesn\'t care about our box. It keeps climbing and hits the stop: −1R.' },
      { at: 19, t: 'In our test this is how about 3 trades in 4 ended: the stop was hit before the wick low. Each win paid about 3R, but only about 1 trade in 4 won, so overall it lost.' },
    ],
  };
  L.ind5 = {
    aria: 'Forex chart: real break, order block, a wick-only break, then a body closes below the low two candles later, so the waiting sell limit is cancelled and price falls without returning',
    candles: gen([1.0920, 1.0905, 1.0890, 1.0900, 1.0912, 1.0895, 1.0872, 1.0866, 1.0876, 1.0884, 1.0874, 1.0868, 1.0864, 1.0850, 1.0838, 1.0829, 1.0820, 1.0826],
      { wick: 0.0002, O: { 0: 1.0935, 11: 1.0874 }, H: { 0: 1.0940, 4: 1.0918, 9: 1.0888 }, L: { 2: 1.0882, 7: 1.0860, 11: 1.0852, 16: 1.0815 } }),
    digits: 4,
    ann: [
      { type: 'line', y: 1.0882, i0: 2, i1: 6, cls: 'bos', label: 'Real break', ly: 'below', at: 6 },
      { type: 'zone', y0: 1.0900, y1: 1.0918, i0: 4, i1: 17, cls: 'supply', label: 'Order block', lp: 'above-left', at: 6 },
      { type: 'line', y: 1.0860, i0: 7, i1: 11, cls: 'liq', label: 'Only a wick… for now', ly: 'below', at: 11 },
      { type: 'mark', i: 9, y: 1.0888, label: 'Bait?', cls: 'struct', at: 11 },
      { type: 'line', y: 1.0900, i0: 11, i1: 13, cls: 'entry', label: 'Sell limit waiting', lp: 'end', at: 11 },
      { type: 'line', y: 1.0860, i0: 12, i1: 14, cls: 'bos', label: 'Real break', lp: 'after', at: 13 },
      { type: 'mark', i: 13, y: 1.0900, label: '✕ Cancel the limit', cls: 'stop', pos: 'below', anchor: 'end', at: 13 },
    ],
    notes: [
      { at: 6, t: 'A forex pair this time (1.09 is a price like EURUSD). A real break at 1.0882 and an order block above it.' },
      { at: 11, t: 'A wick below 1.0860 and the body closes back above: a fake break, for now. Bait at 1.0888. The sell limit waits at the bottom of the box, 1.0900.' },
      { at: 13, t: 'Two candles later a body closes below 1.0860. Now the low IS broken for real. The high at 1.0888 is protected after all, so the idea is dead: cancel the sell limit.' },
      { at: 17, t: 'Price falls without ever coming back to the box. No trade and no loss, even though price went your way. Our test also cancelled the order if price didn\'t reach the box within 40 candles.' },
    ],
  };
  // replays of our bot's own trades come with the admin-only lesson pages, not in this public file
  document.querySelectorAll('script[type="application/json"][data-replay]').forEach(el => { try { const o = JSON.parse(el.textContent); if (o.gen) o.candles = gen(...o.gen); L[el.dataset.replay] = o; } catch (err) { /* a broken block leaves that replay out */ } });

  function lesson(id) {
    const S = L[id], sec = document.querySelector(`[data-lesson="${id}"]`); if (!S || !sec) return; const N = S.candles.length;
    const fig = document.createElement('div'); fig.className = 'figure';
    fig.innerHTML = `<div class="chart"></div>
      <div class="controls">
        <button type="button" class="primary" data-a="play">▶ Replay</button>
        <button type="button" data-a="prev" aria-label="Previous candle">◀</button>
        <button type="button" data-a="next" aria-label="Next candle">▶</button>
        <input type="range" id="smc-rng-${id}" min="1" max="${N}" value="${N}" aria-label="Candles shown">
        <span class="counter"></span>
      </div>
      <p class="caption" aria-live="polite"></p>`;
    sec.appendChild(fig);
    const ol = document.createElement('ol'); ol.className = 'notes'; sec.appendChild(ol);
    const lab = i => S.times ? S.times[i] : 'C' + (i + 1);
    S.notes.forEach(nt => { const li = document.createElement('li'); li.innerHTML = `<button type="button"><span class="k">${lab(nt.at)}</span><span></span></button>`; li.querySelector('span:last-child').textContent = nt.t; li.firstChild.onclick = () => { stop(); n = nt.at + 1; render(); }; ol.appendChild(li); });
    const host = fig.querySelector('.chart'), range = fig.querySelector('input'), counter = fig.querySelector('.counter'), cap = fig.querySelector('.caption'), playBtn = fig.querySelector('[data-a=play]');
    let n = N, timer = null;
    function render() {
      draw(host, S, n, true); range.value = n;
      counter.textContent = (S.times ? S.times[n - 1] + ' · ' : '') + `candle ${n}/${N}`;
      let cur = -1; S.notes.forEach((nt, k) => { if (nt.at <= n - 1) cur = k; });
      [...ol.children].forEach((li, k) => li.firstChild.classList.toggle('on', k === cur));
      cap.textContent = cur >= 0 ? S.notes[cur].t : 'Press Replay to watch it form.';
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } playBtn.textContent = '▶ Replay'; }
    playBtn.onclick = () => {
      if (timer) return stop();
      if (n >= N) n = 1;
      playBtn.textContent = '❚❚ Pause'; render();
      timer = setInterval(() => { if (n >= N) return stop(); n++; render(); }, S.speed || 420);
    };
    fig.querySelector('[data-a=prev]').onclick = () => { stop(); n = Math.max(1, n - 1); render(); };
    fig.querySelector('[data-a=next]').onclick = () => { stop(); n = Math.min(N, n + 1); render(); };
    range.oninput = () => { stop(); n = +range.value; render(); };
    observe(host, render); render();
  }
  // ---------- candlestick patterns: two replays built from the pattern file's textbook examples ----------
  const CP = window.CPat, CP_AFTER = [1.3, 1.1, -0.4, 1.4, 1.2, 0.9, 1.0, -0.6, 1.3, 1.1, 0.8, 1.2, 0.7, 1.0];
  // a textbook example as a lesson chart: candles, the pattern box, and (directional ones) the standard trade
  // lead = candles kept before the pattern (all when left out): a long run-in squashes the pattern into a corner
  function cpExample(key, after, lead) {
    const p = CP.BY[key], ex = CP.example(key, after), s0 = lead != null ? Math.max(0, ex.i0 - lead) : 0, H = 3600e3;
    const K = ex.K.slice(s0).map((k, j) => [j * H].concat(k.slice(1))), e = { i0: ex.i0 - s0, i: ex.i - s0, K };
    let hi = -Infinity, lo = Infinity; for (let k = e.i0; k <= e.i; k++) { hi = Math.max(hi, K[k][2]); lo = Math.min(lo, K[k][3]); }
    const S = { candles: K.map(k => k.slice(1, 5)), digits: 1, xEvery: 5, aria: p.name + ': a textbook example with invented candles',
      ann: [{ type: 'zone', cls: 'pat', i0: e.i0, i1: e.i, y0: lo, y1: hi, label: p.name, lp: p.side === -1 ? 'below-left' : 'above-left', at: e.i }], e, p };
    if (p.side) {
      // the trade on the whole example (its stop buffer needs 14 candles of ATR), then moved to the trimmed chart
      const t = CP.trade(ex.K, { key, i0: ex.i0, i: ex.i, side: p.side }, { hor: 40 });
      S.t = t; S.at1 = t.at1 != null ? Math.round(t.at1 / H) - s0 : null; S.at2 = t.at2 != null ? Math.round(t.at2 / H) - s0 : null;
      S.ann.push({ type: 'box', i0: e.i + 1, entry: t.entry, stop: t.stop, tp: t.t1, tp2: t.t2, entryLabel: p.side === 1 ? 'Long' : 'Short', tpLabel: '1R', tp2Label: '2R', noR: true, at: e.i + 1 });
    } else {
      S.ann.push({ type: 'line', cls: 'tp', y: hi, i0: e.i, i1: K.length - 1, label: 'Break up → long', lp: 'end', at: e.i },
        { type: 'line', cls: 'stop', y: lo, i0: e.i, i1: K.length - 1, label: 'Break down → short', lp: 'end', ly: 'below', at: e.i });
    }
    return S;
  }
  if (CP) {
    const S1 = cpExample('bullengulf', CP_AFTER), e1 = S1.e;
    L['cp-bullengulf'] = Object.assign(S1, { notes: [
      { at: 3, t: 'A steady drop: lower highs and lower lows. A reversal pattern needs a move to reverse, so this comes first.' },
      { at: e1.i0, t: 'A red candle. Sellers are still in charge.' },
      { at: e1.i, t: 'The next candle opens at the red close, then buyers take it all back and close above the red open: the green body swallows the red one. That is the bullish engulfing.' },
      { at: e1.i + 1, t: 'The standard trade: long at the next open, stop just under the pattern’s lowest low, targets at 1R and 2R (R = the distance to the stop).' },
      { at: S1.at1, t: '1R reached: price moved as far up as the stop was down.' },
      { at: S1.at2, t: '2R reached. This is a textbook picture with invented candles. On real charts the same trade hits 2R about 3 times in 10 — about as often as a random entry (see the last lesson).' },
    ].filter(x => x.at != null) });
    const S2 = cpExample('evening', CP_AFTER), e2 = S2.e;
    L['cp-evening'] = Object.assign(S2, { notes: [
      { at: 3, t: 'A steady rise: higher highs and higher lows.' },
      { at: e2.i0, t: 'A big green candle: buyers still pushing hard.' },
      { at: e2.i0 + 1, t: 'A small candle: the push stalls. Neither side wins it.' },
      { at: e2.i, t: 'A red candle closes deep into the big green body: sellers took over. Big green, small, big red = evening star.' },
      { at: e2.i + 1, t: 'The standard trade: short at the next open, stop just above the pattern’s highest high, targets at 1R and 2R.' },
      { at: S2.at1, t: '1R reached.' },
      { at: S2.at2, t: '2R reached. Again a textbook picture; real evening stars hit 2R about 38 times in 100, random entries about 34.' },
    ].filter(x => x.at != null) });
  }
  document.querySelectorAll('[data-lesson]').forEach(el => lesson(el.dataset.lesson));

  // ---------- drills ----------
  const D = [
    { title: 'Downtrend bounce', digits: 2,
      candles: gen([54.0, 53.2, 52.1, 51.0, 49.9, 49.0, 48.5, 49.3, 50.4, 51.3, 52.0, 51.4, 50.9, 51.6, 52.0, 51.6, 51.9, 51.0, 50.2, 49.4, 48.6, 48.0, 48.3],
        { O: { 16: 51.6 }, H: { 0: 54.4, 10: 52.3, 14: 52.32, 16: 52.85 }, L: { 6: 48.1, 21: 47.9 } }), d: 16,
      q: 'Downtrend with lower highs. Price bounces into equal highs, wicks above them, and this candle closes back below. What do you do?',
      ann: [
        { type: 'line', y: 52.3, i0: 10, i1: 22, cls: 'liq', label: 'Equal highs', at: 14 },
        { type: 'box', i0: 17, i1: 22, entry: 51.9, stop: 53.0, tp: 48.1, post: true, at: 16 },
      ],
      choices: [
        { k: 'Short now', v: 'right', fb: 'Bearish structure, the liquidity above the equal highs is taken, and the candle closed back below. Stop above the wick (53.0), target the last low (48.1): about 3.5R.' },
        { k: 'Wait for more', v: 'ok', fb: 'Not wrong, but every condition is already met. Waiting usually means a worse price.' },
        { k: 'Skip it', v: 'wrong', fb: 'This is the textbook version: trend down, sweep of equal highs, close back below.' },
      ],
      result: 'Price drops to the target five candles later.' },
    { title: 'Push through the highs', digits: 2,
      candles: gen([18.0, 18.4, 18.9, 19.3, 19.0, 18.7, 19.1, 19.4, 19.2, 19.0, 19.3, 19.95, 20.3, 19.9, 20.6, 21.2, 21.8, 21.5, 22.3],
        { O: { 11: 19.3 }, H: { 3: 19.6, 7: 19.62, 11: 20.1 }, L: { 0: 17.8, 5: 18.5, 13: 19.7 } }), d: 11,
      q: 'Uptrend. Price pushes through the equal highs and this candle closes above them. Short it?',
      ann: [
        { type: 'line', y: 19.62, i0: 3, i1: 18, cls: 'liq', label: 'Equal highs', at: 7 },
        { type: 'mark', i: 13, y: 19.7, label: 'Retest holds', cls: 'tp', pos: 'below', post: true, at: 13 },
      ],
      choices: [
        { k: 'Short now', v: 'wrong', fb: 'No close back below means no sweep. In an uptrend, a close above the highs is a breakout, and a short here becomes the liquidity.' },
        { k: 'Wait for more', v: 'ok', fb: 'Fine. Waiting shows the retest holding, and then you skip it.' },
        { k: 'Skip it', v: 'right', fb: 'Uptrend plus a close above the level is a breakout. There is nothing to short.' },
      ],
      result: 'Price retests the old highs, holds, and runs another 12%.' },
    { title: 'Sweep in the discount', digits: 1,
      candles: gen([70, 71.5, 73.2, 74.6, 73.9, 75.6, 77.8, 79.9, 82.0, 84.1, 85.6, 84.4, 82.6, 81.0, 77.6, 76.4, 77.4, 76.8, 77.3, 78.9, 80.8, 82.6, 84.4, 86.6],
        { O: { 18: 76.8 }, H: { 10: 86.2, 16: 77.7, 18: 78.1 }, L: { 0: 69.8, 15: 75.9 } }), d: 18,
      q: 'Uptrend, then a deep pullback. A small high gets swept and this candle closes back below it. Short?',
      ann: [
        { type: 'line', y: 77.7, i0: 16, i1: 23, cls: 'liq', label: 'Small high', lp: 'before', at: 17 },
        { type: 'zone', y0: 69.8, y1: 78.0, i0: 10, i1: 23, cls: 'disc', label: 'Discount half of the range', lp: 'bottom-right', post: true, at: 18 },
      ],
      choices: [
        { k: 'Short now', v: 'wrong', fb: 'Structure is bullish (higher highs) and price is in the discount half of the range. SMC traders would look for a long here, not a short.' },
        { k: 'Wait for more', v: 'ok', fb: 'Safe, but waiting won\'t turn this into a short. The context is wrong.' },
        { k: 'Skip it', v: 'right', fb: 'Uptrend plus discount means no shorts, whatever this one candle does.' },
      ],
      result: 'Price rallies back to the highs.' },
    { title: 'Closed above, not below', digits: 2,
      candles: gen([33.0, 32.4, 31.6, 30.8, 30.2, 30.7, 31.3, 30.9, 30.5, 31.0, 31.35, 31.7, 31.3, 30.7, 30.0, 29.5, 29.8],
        { O: { 0: 33.2, 11: 31.35, 12: 31.7 }, H: { 0: 33.3, 6: 31.6, 10: 31.62, 11: 31.9, 12: 31.85 }, L: { 4: 29.9, 15: 29.3 } }), d: 11,
      q: 'Downtrend. This candle wicked above the equal highs, but it closed above them. Short now?',
      ann: [
        { type: 'line', y: 31.62, i0: 6, i1: 16, cls: 'liq', label: 'Equal highs', lp: 'before', at: 10 },
        { type: 'mark', i: 12, y: 31.85, label: 'Closes back below', cls: 'sweep', post: true, at: 12 },
        { type: 'box', i0: 13, i1: 16, entry: 31.3, stop: 32.0, tp: 29.9, post: true, at: 12 },
      ],
      choices: [
        { k: 'Short now', v: 'wrong', fb: 'Too early. A close above can be the start of a breakout. The sweep is only confirmed when a candle closes back below.' },
        { k: 'Wait one candle', v: 'right', fb: 'The next candle closes back below the equal highs. Now it is a sweep: short there, stop above the high.' },
        { k: 'Skip it', v: 'ok', fb: 'Safe, but one more candle would have confirmed the setup.' },
      ],
      result: 'Next candle closes back under. Short 31.3, stop 32.0, target 29.9 hit: 2R.' },
    { title: 'Where does the stop go?', digits: 4,
      candles: gen([0.620, 0.655, 0.700, 0.760, 0.820, 0.880, 0.920, 0.945, 0.950, 0.915, 0.890, 0.905, 0.945, 0.990, 0.960, 0.920, 0.880, 0.860, 0.840, 0.810, 0.830],
        { H: { 8: 0.962, 12: 0.981, 13: 1.012, 14: 1.015 }, L: { 19: 0.80 } }), d: 12,
      q: 'Pump coin. The sweep is confirmed and you short at 0.945. Where does the stop go?',
      ann: [
        { type: 'line', y: 0.962, i0: 8, i1: 20, cls: 'top', label: '24h top', lp: 'before', at: 8 },
        { type: 'mark', i: 12, y: 0.981, label: 'Sweep', cls: 'sweep', at: 12 },
        { type: 'line', y: 0.986, i0: 13, i1: 13, cls: 'tight', label: 'tight stop hit', lp: 'after', post: true, at: 13 },
        { type: 'box', i0: 13, i1: 20, entry: 0.945, stop: 1.0206, tp: 0.8978, tp2: 0.8316, stopLabel: '8% stop', tpLabel: 'TP1 −5%', tp2Label: 'TP2 −12%', noR: true, post: true, at: 12 },
      ],
      choices: [
        { k: 'Just above the wick (0.986)', v: 'wrong', fb: 'Pump coins wick far past the sweep high before they dump. A stop 0.5% above the wick is taken by the very next candle.' },
        { k: '8% above entry (1.0206)', v: 'right', fb: 'Our tests on pump coins: every stop tighter than 8% lost money. The spike to 1.015 stays under it, then TP1 and TP2 hit.' },
      ],
      result: 'The next candle spikes 3% past the sweep high, then the dump: TP1 (−5%) and TP2 (−12%) hit.' },
    { title: 'Did the low break?', digits: 1,
      candles: gen([64.0, 63.0, 62.2, 62.9, 63.5, 62.6, 61.2, 60.8, 61.6, 62.3, 61.7, 61.1, 61.9, 62.8, 63.4, 62.7, 61.8],
        { O: { 0: 64.6, 11: 61.7 }, H: { 0: 64.8, 4: 63.8, 9: 62.6, 13: 63.0 }, L: { 2: 61.8, 7: 60.5, 11: 59.9 } }), d: 11,
      q: 'Downtrend. This candle went below the last low (60.5). Did it break the low?',
      ann: [
        { type: 'line', y: 61.8, i0: 2, i1: 6, cls: 'bos', label: 'Real break', ly: 'below', at: 6 },
        { type: 'line', y: 60.5, i0: 7, i1: 16, cls: 'liq', label: 'Last low', lp: 'before', at: 7 },
        { type: 'mark', i: 9, y: 62.6, label: 'Small high', cls: 'struct', at: 10 },
        { type: 'mark', i: 13, y: 63.0, label: 'Stops above taken', cls: 'sweep', post: true, at: 13 },
      ],
      choices: [
        { k: 'Yes, it broke the low', v: 'wrong', fb: 'Only the wick went below 60.5. The body closed back above it, so the low is not broken. A break needs a body close.' },
        { k: 'No, only the wick did', v: 'right', fb: 'A fake break. That makes the small high at 62.6 the inducement: the stops above it are bait.' },
      ],
      result: 'Price climbs back above the small high at 62.6 and grabs the stops there, as lesson 9 says it often does.' },
    { title: 'Where does the sell limit go?', digits: 3,
      candles: gen([0.560, 0.548, 0.541, 0.546, 0.553, 0.540, 0.530, 0.526, 0.531, 0.536, 0.529, 0.527, 0.533, 0.541, 0.545, 0.541, 0.532, 0.523, 0.515, 0.518],
        { O: { 0: 0.572, 11: 0.529, 14: 0.541 }, H: { 0: 0.575, 4: 0.558, 9: 0.539, 13: 0.543, 14: 0.550 }, L: { 2: 0.536, 7: 0.522, 11: 0.516, 18: 0.513 } }), d: 11,
      q: 'A real break, then a fake break (only a wick below 0.522). You want to trade the inducement idea. Where does the sell limit go?',
      ann: [
        { type: 'line', y: 0.536, i0: 2, i1: 6, cls: 'bos', label: 'Real break', ly: 'below', at: 6 },
        { type: 'zone', y0: 0.546, y1: 0.558, i0: 4, i1: 19, cls: 'supply', label: 'Order block', lp: 'above-left', at: 6 },
        { type: 'line', y: 0.522, i0: 7, i1: 11, cls: 'liq', label: 'Only a wick', ly: 'below', at: 11 },
        { type: 'mark', i: 9, y: 0.539, label: 'Inducement high', cls: 'struct', at: 10 },
        { type: 'box', i0: 12, i1: 19, entry: 0.546, stop: 0.559, tp: 0.516, entryLabel: 'Sell limit', tpLabel: 'Wick low', post: true, at: 11 },
      ],
      choices: [
        { k: 'At the inducement high (0.539)', v: 'wrong', fb: 'That high is the bait. The idea expects price to run through it to grab the stops there, so a short at 0.539 is the trade that gets stopped.' },
        { k: 'At the bottom of the order block (0.546)', v: 'right', fb: 'Price should grab the bait and touch the box. Stop just above the box (0.559), target the wick low (0.516): about 2.3R.' },
        { k: 'Sell now at 0.527', v: 'wrong', fb: 'The idea says price goes up first, so a short here starts by losing, and the wick low is only 0.011 away.' },
      ],
      result: 'Price grabs the bait, fills the limit at 0.546 and falls to the wick low: +2.3R. It worked this time; in our test about 3 in 4 of these hit the stop first.' },
    { title: 'Signal now, but no sweep yet', digits: 3, unscored: true,
      candles: gen([1.40, 1.46, 1.55, 1.63, 1.74, 1.86, 1.95, 2.03, 1.98, 1.95, 1.93, 1.96, 1.98, 1.93, 1.89, 1.86, 1.87, 1.82, 1.79, 1.81, 1.77, 1.74, 1.75],
        { H: { 7: 2.08, 12: 2.02 } }), d: 10,
      q: 'A small pump stalls under its 24h top. Your signal says short now at 1.93, but the top hasn\'t been swept. What do you do?',
      ann: [
        { type: 'line', y: 2.08, i0: 7, i1: 22, cls: 'top', label: '24h top', lp: 'before', at: 7 },
        { type: 'mark', i: 10, y: 1.93, label: 'Signal 1.93', cls: 'bot', pos: 'below', at: 10 },
        { type: 'line', y: 1.8335, i0: 11, i1: 22, cls: 'tp', label: 'TP1 −5% from the signal', lp: 'end', ly: 'below', post: true, at: 11 },
      ],
      choices: [
        { k: 'Short at the signal', v: 'mix', fb: 'This time it pays: price never returns to the top and bleeds 10%. The next one might squeeze into the stop first.' },
        { k: 'Wait for the sweep', v: 'mix', fb: 'No sweep came within 2 hours, so no trade. You missed a winner, and that is the cost of the rule.' },
      ],
      result: 'No answer is right here. In our pump replay about 2 of 3 small-pump winners never swept the top, so waiting skipped them; it also skipped about 4 in 10 losers, and the trades it took started from a better price.' },
  ];

  const list = document.getElementById('smc-drill-list'), scoreEl = document.getElementById('smc-score');
  if (list) {
  const answers = new Map();
  const updScore = () => { const right = [...answers.values()].filter(v => v === 'right').length, of = D.filter(x => !x.unscored).length; scoreEl.textContent = `Score: ${right} of ${of} right`; if (right === of && slug) markDone(slug); };
  D.forEach((S, k) => {
    const N = S.candles.length, card = document.createElement('div'); card.className = 'figure drill';
    card.innerHTML = `<h3>Drill ${k + 1} · ${S.title}</h3><div class="chart"></div><p class="q"></p><div class="choices"></div><div class="fb" hidden><b></b><span></span><span class="muted res"></span></div><div><button type="button" class="again" hidden>Try again</button></div>`;
    card.querySelector('.q').textContent = S.q;
    list.appendChild(card);
    const host = card.querySelector('.chart'), fb = card.querySelector('.fb'), again = card.querySelector('.again'), ch = card.querySelector('.choices');
    let n = S.d + 1, answered = false, timer = null;
    const render = () => draw(host, S, n, answered);
    const btns = S.choices.map(c => { const b = document.createElement('button'); b.type = 'button'; b.textContent = c.k; b.setAttribute('aria-pressed', 'false'); ch.appendChild(b); b.onclick = () => choose(c, b); return b; });
    function choose(c, b) {
      answered = true; b.setAttribute('aria-pressed', 'true');
      btns.forEach((x, i) => { x.disabled = true; if (S.choices[i].v === 'right') x.classList.add('right'); });
      fb.className = 'fb ' + (c.v === 'right' ? 'ok' : c.v === 'wrong' ? 'bad' : 'mix');
      fb.querySelector('b').textContent = c.v === 'right' ? 'Right' : c.v === 'wrong' ? 'Not this one' : c.v === 'ok' ? 'Acceptable' : 'Depends';
      fb.querySelector('span').textContent = c.fb; fb.querySelector('.res').textContent = ''; fb.hidden = false; again.hidden = false;
      if (!S.unscored) { answers.set(k, c.v); updScore(); }
      const done = () => { fb.querySelector('.res').textContent = 'What happened: ' + S.result; };
      if (reduce) { n = N; render(); done(); return; }
      render();
      timer = setInterval(() => { if (n >= N) { clearInterval(timer); timer = null; done(); return; } n++; render(); }, 260);
    }
    again.onclick = () => {
      if (timer) { clearInterval(timer); timer = null; }
      answered = false; n = S.d + 1; fb.hidden = true; again.hidden = true;
      btns.forEach(x => { x.disabled = false; x.classList.remove('right'); x.setAttribute('aria-pressed', 'false'); });
      if (!S.unscored) { answers.delete(k); updScore(); }
      render();
    };
    observe(host, render); render();
  });
  }

  // =====================================================================================================================
  // ReplayDesk Academy: progress, quizzes and the interactive widgets (data-widget="…"). Plain DOM, no libraries.
  // =====================================================================================================================
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY = 'rd-learn-v1';
  const prog = () => { try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return p && typeof p === 'object' && p.done ? p : { done: {} }; } catch (e) { return { done: {} }; } };
  const saveProg = p => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode: progress isn't kept */ } };
  const slug = document.body.dataset.lxSlug || '';
  function markDone(s, on = true) {
    const p = prog(); if (on) p.done[s] = Date.now(); else delete p.done[s]; p.last = s; saveProg(p); paintProgress();
  }
  function paintProgress() {
    const p = prog();
    $$('[data-slug]').forEach(e => e.classList.toggle('is-done', !!p.done[e.dataset.slug]));
    $$('[data-track-prog]').forEach(e => {
      const ss = e.dataset.trackProg.split(','), n = ss.filter(s => p.done[s]).length;
      const bar = $('i', e); if (bar) bar.style.width = (n / ss.length * 100).toFixed(1) + '%';
      const t = $('[data-n]', e.parentElement); if (t) t.textContent = `${n} of ${ss.length} done`;
    });
    const all = $('[data-all-prog]');
    if (all) { const ss = all.dataset.allProg.split(','), n = ss.filter(s => p.done[s]).length; all.textContent = n ? `${n} of ${ss.length} lessons done` : `${ss.length} lessons`; }
    const cont = $('[data-continue]');
    if (cont) {
      const order = cont.dataset.continue.split(','), next = order.find(s => !p.done[s]);
      if (Object.keys(p.done).length && next) { cont.href = '/learn/' + next; cont.querySelector('span').textContent = 'Continue where you left off'; }
    }
    const mb = $('[data-mark]');
    if (mb && slug) { const d = !!p.done[slug]; mb.classList.toggle('is-done', d); mb.querySelector('span').textContent = d ? 'Completed' : 'Mark as complete'; }
  }
  if (slug) { const p = prog(); p.last = slug; saveProg(p); }
  document.addEventListener('click', e => {
    const mb = e.target.closest('[data-mark]'); if (mb && slug) { markDone(slug, !prog().done[slug]); }
  });

  // ---- quick check: one question at a time is overkill; all questions show, each answers on click
  $$('[data-quiz]').forEach(box => {
    let qs; try { qs = JSON.parse($('script', box).textContent); } catch (e) { return; }
    buildQuiz(box, qs);
  });
  function buildQuiz(box, qs) {
    $$('.qz, .qz-res, .qz-again', box).forEach(x => x.remove());
    const res = el('p', 'qz-res'); let right = 0, answered = 0;
    qs.forEach((q, i) => {
      const card = el('div', 'qz'), head = el('p', 'qz-q'); head.innerHTML = `<span>${i + 1}</span>${esc(q.q)}`; card.appendChild(head);
      const opts = el('div', 'qz-opts'), why = el('p', 'qz-why'); why.hidden = true;
      q.o.forEach((o, k) => {
        const b = el('button', 'qz-o'); b.type = 'button'; b.textContent = o; opts.appendChild(b);
        b.onclick = () => {
          if (card.dataset.done) return; card.dataset.done = '1'; answered++;
          const ok = k === q.a; if (ok) right++;
          $$('.qz-o', opts).forEach((x, j) => { x.disabled = true; if (j === q.a) x.classList.add('ok'); });
          if (!ok) b.classList.add('bad');
          why.innerHTML = `<b>${ok ? 'Right.' : 'Not quite.'}</b> ${esc(q.why)}`; why.hidden = false; why.className = 'qz-why ' + (ok ? 'ok' : 'bad');
          if (answered === qs.length) {
            res.textContent = right === qs.length ? `${right} of ${qs.length} right. Lesson marked complete.` : `${right} of ${qs.length} right. Read the explanations, then try again.`;
            res.className = 'qz-res ' + (right === qs.length ? 'ok' : '');
            if (right === qs.length && slug) markDone(slug);
            again.hidden = right === qs.length;
          }
        };
      });
      card.appendChild(opts); card.appendChild(why); box.appendChild(card);
    });
    const again = el('button', 'btn btn-secondary btn-sm qz-again', 'Try again'); again.type = 'button'; again.hidden = true;
    again.onclick = () => buildQuiz(box, qs);
    box.appendChild(res); box.appendChild(again);
  }

  // ---- widgets
  const W = {};
  const svgEl = (tag, attrs, parent) => mk(tag, attrs, parent);
  const fmt = (v, d = 2) => (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const range = (label, min, max, step, val, unit = '') => `<label class="wx-r"><span>${label}<b data-v></b>${unit ? `<em>${unit}</em>` : ''}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
  const seg = (name, items, on) => `<div class="wx-seg" role="group" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === on}">${l}</button>`).join('')}</div>`;
  function segVal(root, name) { const b = $(`[data-seg="${name}"] [aria-pressed="true"]`, root); return b ? b.dataset.v : null; }
  function segWire(root, fn) { $$('[data-seg] button', root).forEach(b => b.addEventListener('click', () => { $$('button', b.parentElement).forEach(x => x.setAttribute('aria-pressed', String(x === b))); fn(); })); }

  // 1 · candle anatomy: drag open / high / low / close and read the candle
  W.candle = root => {
    root.innerHTML = `<div class="wx-grid"><div class="wx-fig"><svg viewBox="0 0 240 280" aria-label="A candle you can shape"></svg></div>
      <div class="wx-side">${range('Open', 0, 100, 1, 35)}${range('High', 0, 100, 1, 92)}${range('Low', 0, 100, 1, 18)}${range('Close', 0, 100, 1, 78)}
      <div class="wx-chips">${[['bull', 'Strong up'], ['bear', 'Strong down'], ['hammer', 'Hammer'], ['star', 'Shooting star'], ['doji', 'Doji']].map(([k, l]) => `<button type="button" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="wx-out" aria-live="polite"></div></div></div>`;
    const svg = $('svg', root), [ro, rh, rl, rc] = $$('input', root), out = $('.wx-out', root);
    const P = { bull: [20, 96, 14, 92], bear: [88, 92, 6, 12], hammer: [70, 78, 8, 76], star: [24, 92, 20, 30], doji: [50, 84, 16, 51] };
    $$('[data-p]', root).forEach(b => b.onclick = () => { [ro.value, rh.value, rl.value, rc.value] = P[b.dataset.p]; draw2(); });
    const Y = v => 250 - v * 2.2;
    function draw2(src) {
      let o = +ro.value, h = +rh.value, l = +rl.value, c = +rc.value;
      if (src === rh) { h = Math.max(h, o, c); } else if (src === rl) { l = Math.min(l, o, c); } else { h = Math.max(h, o, c); l = Math.min(l, o, c); }
      rh.value = h; rl.value = l;
      $$('[data-v]', root).forEach((b, i) => { b.textContent = ' ' + (100 + [o, h, l, c][i] / 5).toFixed(1); });
      const up = c >= o, cls = up ? 'up' : 'dn', rng2 = Math.max(1e-9, h - l), body = Math.abs(c - o), uw = h - Math.max(o, c), lw = Math.min(o, c) - l;
      svg.replaceChildren();
      svgEl('line', { x1: 120, x2: 120, y1: Y(h), y2: Y(l), class: 'wx-wick ' + cls }, svg);
      svgEl('rect', { x: 92, y: Y(Math.max(o, c)), width: 56, height: Math.max(2, Y(Math.min(o, c)) - Y(Math.max(o, c))), rx: 3, class: 'wx-body ' + cls }, svg);
      const tag = (y, t, side) => { svgEl('line', { x1: side ? 150 : 90, x2: side ? 172 : 68, y1: y, y2: y, class: 'wx-tick' }, svg); txt(svg, side ? 176 : 64, y + 4, t, 'wx-lab', side ? 'start' : 'end'); };
      tag(Y(h), 'High', true); tag(Y(l), 'Low', true); tag(Y(o), 'Open', false); tag(Y(c), 'Close', false);
      let name = 'An ordinary candle', what = up ? 'Buyers won this period, but not by much.' : 'Sellers won this period, but not by much.';
      if (body <= rng2 * 0.1) { name = 'Doji'; what = 'Open and close almost equal: nobody won. Indecision, often before a turn or a pause.'; }
      else if (lw >= body * 2 && uw <= body * 0.6) { name = 'Hammer'; what = 'Sellers pushed price far down and buyers pushed it all the way back. At a support level that rejection is a bullish sign.'; }
      else if (uw >= body * 2 && lw <= body * 0.6) { name = 'Shooting star'; what = 'Buyers pushed price far up and sellers slammed it back. At a resistance level that rejection is a bearish sign.'; }
      else if (uw <= rng2 * 0.06 && lw <= rng2 * 0.06) { name = up ? 'Marubozu (up)' : 'Marubozu (down)'; what = 'Almost no wicks: one side was in full control from open to close.'; }
      else if (body >= rng2 * 0.7) { name = up ? 'Strong up candle' : 'Strong down candle'; what = up ? 'A tall green body: a decisive move up.' : 'A tall red body: a decisive move down.'; }
      out.innerHTML = `<b class="${up ? 'up' : 'down'}">${up ? 'Green · price rose' : 'Red · price fell'}</b><b>${name}</b><p>${what}</p>
        <dl><dt>Body</dt><dd>${(body / rng2 * 100).toFixed(0)}% of the range</dd><dt>Upper wick</dt><dd>${(uw / rng2 * 100).toFixed(0)}%</dd><dt>Lower wick</dt><dd>${(lw / rng2 * 100).toFixed(0)}%</dd></dl>`;
    }
    [ro, rh, rl, rc].forEach(r => r.addEventListener('input', () => draw2(r)));
    draw2();
  };

  // 2 · open interest: what price and OI together say
  W.oi = root => {
    const Q = {
      'up,up': ['New longs are opening', 'Fresh money is buying with leverage. The move has fuel behind it — as long as OI keeps rising with price.', 'up'],
      'down,up': ['New shorts are opening', 'Bears are piling in with fresh money. The drop is backed by new positions — and those shorts are fuel for a squeeze if price turns.', 'down'],
      'up,down': ['Shorts are closing', 'Price rises because shorts buy back, not because new buyers arrive. Short covering often fades once it is done.', 'warn'],
      'down,down': ['Longs are closing', 'Price falls because longs sell out, not because new shorts arrive. Once the exits are done the selling can dry up.', 'warn'],
    };
    root.innerHTML = `<div class="wx-row">${seg('p', [['up', 'Price rising'], ['down', 'Price falling']], 'up')}${seg('oi', [['up', 'OI rising'], ['down', 'OI falling']], 'up')}</div>
      <div class="wx-grid"><div class="wx-fig"><svg viewBox="0 0 320 180" aria-label="Price line over open interest bars"></svg></div><div class="wx-out" aria-live="polite"></div></div>
      <div class="wx-quad">${Object.entries(Q).map(([k, v]) => `<div data-q="${k}"><span>${k.split(',')[0] === 'up' ? 'Price ↑' : 'Price ↓'} · ${k.split(',')[1] === 'up' ? 'OI ↑' : 'OI ↓'}</span><b>${v[0]}</b></div>`).join('')}</div>`;
    const svg = $('svg', root), out = $('.wx-out', root);
    function upd() {
      const p = segVal(root, 'p'), o = segVal(root, 'oi'), k = `${p},${o}`, q = Q[k];
      $$('[data-q]', root).forEach(d => d.classList.toggle('on', d.dataset.q === k));
      out.innerHTML = `<b class="${q[2] === 'up' ? 'up' : q[2] === 'down' ? 'down' : 'warn'}">${q[0]}</b><p>${q[1]}</p>`;
      svg.replaceChildren();
      const n = 24, r = rng(p === 'up' ? 7 : 9);
      for (let i = 0; i < n; i++) { const v = o === 'up' ? 30 + i * 3 + r() * 8 : 100 - i * 3 + r() * 8; svgEl('rect', { x: 12 + i * 12.5, y: 170 - v * 0.7, width: 8, height: v * 0.7, rx: 1.5, class: 'wx-oi' }, svg); }
      const pts = []; let y = p === 'up' ? 120 : 30;
      for (let i = 0; i < n; i++) { y += (p === 'up' ? -3.6 : 3.6) + (r() - 0.5) * 9; pts.push(`${16 + i * 12.5},${Math.max(12, Math.min(150, y)).toFixed(1)}`); }
      svgEl('polyline', { points: pts.join(' '), class: 'wx-px ' + (p === 'up' ? 'up' : 'dn') }, svg);
      txt(svg, 14, 16, 'Price', 'wx-lab'); txt(svg, 14, 176, 'Open interest', 'wx-lab');
    }
    segWire(root, upd); upd();
  };

  // 3 · funding rate: who pays whom, how much, how crowded
  W.funding = root => {
    root.innerHTML = `<div class="wx-grid"><div class="wx-side">${range('Funding rate', -0.3, 0.3, 0.005, 0.01, '% / 8h')}
      <label class="wx-r"><span>Your position<b data-pos> $1,000</b></span><input type="range" min="100" max="10000" step="100" value="1000" data-size></label>
      <div class="wx-chips">${[['-0.15', 'Crowded short'], ['-0.01', 'Slightly short'], ['0.01', 'Normal'], ['0.06', 'Crowded long'], ['0.2', 'Extreme long']].map(([v, l]) => `<button type="button" data-f="${v}">${l}</button>`).join('')}</div></div>
      <div class="wx-out" aria-live="polite"></div></div><div class="wx-meter"><i></i><span>Short crowded</span><span>Balanced</span><span>Long crowded</span></div>`;
    const [rf, rs] = $$('input', root), out = $('.wx-out', root), dot = $('.wx-meter i', root);
    $$('[data-f]', root).forEach(b => b.onclick = () => { rf.value = b.dataset.f; upd(); });
    function upd() {
      const f = +rf.value, size = +rs.value, pay = Math.abs(f) / 100 * size;
      $('[data-v]', root).textContent = ' ' + (f > 0 ? '+' : '') + f.toFixed(3) + '%'; $('[data-pos]', root).textContent = ' $' + size.toLocaleString('en-US');
      const a = Math.abs(f), lvl = a <= 0.01 ? ['Normal', ''] : a <= 0.05 ? ['Elevated', 'warn'] : a <= 0.1 ? ['Crowded', 'warn'] : ['Extreme', 'down'];
      const side = f > 0 ? 'longs' : 'shorts', other = f > 0 ? 'shorts' : 'longs';
      dot.style.left = (50 + Math.max(-1, Math.min(1, f / 0.2)) * 46) + '%';
      out.innerHTML = a < 0.0001 ? '<b>Zero funding</b><p>Nobody pays. The perp price sits right on spot.</p>' :
        `<b>${side[0].toUpperCase() + side.slice(1)} pay ${other}</b><p>Every 8 hours a ${side.slice(0, -1)} of $${size.toLocaleString('en-US')} pays <b class="mono">$${fmt(pay)}</b> — <b class="mono">$${fmt(pay * 3)}</b> a day, about <b class="mono">${(a * 3 * 365).toFixed(0)}%</b> a year.</p>
        <p><b class="${lvl[1]}">${lvl[0]}</b> — ${a <= 0.01 ? 'a normal level, it tells you little.' : `the ${side} side is crowded. ${a > 0.1 ? 'A sharp move against them can force a cascade of exits: a ' + (f > 0 ? 'long squeeze down.' : 'short squeeze up.') : 'Holding that side is getting expensive.'}`}</p>`;
    }
    [rf, rs].forEach(r => r.addEventListener('input', upd)); upd();
  };

  // 4 · squeeze: push price into a ladder of liquidation clusters and watch the chain reaction
  W.squeeze = root => {
    root.innerHTML = `<div class="wx-row">${seg('dir', [['short', 'Short squeeze'], ['long', 'Long squeeze']], 'short')}<button type="button" class="btn btn-primary btn-sm" data-push>Push price</button><button type="button" class="btn btn-secondary btn-sm" data-reset>Reset</button></div>
      <div class="wx-grid"><div class="wx-fig"><svg viewBox="0 0 340 260" aria-label="Price ladder with liquidation clusters"></svg></div><div class="wx-out" aria-live="polite"></div></div>`;
    const svg = $('svg', root), out = $('.wx-out', root);
    let px, clusters, log, busy = false;
    const lv = [[102, 3], [104.5, 4], [107.5, 6], [111.5, 8], [116, 10]];
    function reset() { px = 100; clusters = lv.map(([p, s]) => ({ p, s, gone: false })); log = []; paint(); }
    const dir = () => segVal(root, 'dir') === 'short' ? 1 : -1;
    const Y = p => { const d = dir(), v = d === 1 ? p : 200 - p; return 240 - (v - 98) * 6.6; };
    function paint() {
      const d = dir(); svg.replaceChildren();
      for (const c of clusters) {
        const p = d === 1 ? c.p : 200 - c.p, y = Y(p);
        svgEl('rect', { x: 128, y: y - 7, width: c.s * 9, height: 14, rx: 3, class: 'wx-liq' + (c.gone ? ' gone' : '') }, svg);
        txt(svg, 122, y + 4, fmt(p, 1), 'wx-lab', 'end');
        txt(svg, 132 + c.s * 9, y + 4, c.gone ? 'liquidated' : `${c.s}k ${d === 1 ? 'short' : 'long'} stops`, 'wx-lab');
      }
      const yp = Y(px); svgEl('line', { x1: 20, x2: 330, y1: yp, y2: yp, class: 'wx-pxl ' + (d === 1 ? 'up' : 'dn') }, svg);
      txt(svg, 20, yp - 6, 'Price ' + fmt(px, 1), 'wx-lab strong');
      const n = clusters.filter(c => c.gone).length;
      out.innerHTML = `<b>${n ? `${n} cluster${n > 1 ? 's' : ''} liquidated` : 'Crowded ' + (d === 1 ? 'shorts' : 'longs')}</b><p>${log.length ? log.slice(-3).map(esc).join('<br>') : `Many traders are ${d === 1 ? 'short' : 'long'} with stops and liquidation prices stacked ${d === 1 ? 'above' : 'below'} the price. Push the price and see what happens.`}</p>
        ${n === clusters.length ? `<p class="mono">Price moved ${fmt(Math.abs(px - 100), 1)}% from a ${d === 1 ? '2' : '2'}% push. That gap is the squeeze.</p>` : ''}`;
    }
    async function push() {
      if (busy) return; busy = true;
      const d = dir(); let target = d === 1 ? px + 2 : px - 2;
      for (;;) {
        await stepTo(target);
        const hit = clusters.find(c => !c.gone && (d === 1 ? (c.p <= px) : (200 - c.p >= px)));
        if (!hit) break;
        hit.gone = true;
        log.push(`${hit.s}k ${d === 1 ? 'shorts are forced to buy' : 'longs are forced to sell'} at ${fmt(d === 1 ? hit.p : 200 - hit.p, 1)} → price ${d === 1 ? 'jumps' : 'drops'} ${(hit.s * 0.9).toFixed(1)}%`);
        target = px + d * hit.s * 0.9; paint();
      }
      busy = false; paint();
    }
    function stepTo(t) { return new Promise(res => { if (reduce) { px = t; paint(); return res(); } const s = px, t0 = performance.now(); (function f(now) { const k = Math.min(1, (now - t0) / 450); px = s + (t - s) * k; paint(); if (k < 1) requestAnimationFrame(f); else res(); })(t0); }); }
    $('[data-push]', root).onclick = push; $('[data-reset]', root).onclick = reset; segWire(root, reset); reset();
  };

  // 5 · long/short ratios: retail vs top traders
  W.ls = root => {
    root.innerHTML = `<div class="wx-grid"><div class="wx-side">${range('Retail L/S (accounts)', 0.4, 2.6, 0.01, 0.74)}${range('Top traders L/S (positions)', 0.4, 2.6, 0.01, 1.62)}
      <div class="wx-chips"><button type="button" data-s="0.74,1.62">Squeeze-up setup</button><button type="button" data-s="2.3,0.62">Dump setup</button><button type="button" data-s="1.05,1.1">No divergence</button></div></div>
      <div class="wx-out" aria-live="polite"></div></div>
      <div class="wx-scale"><div class="wx-bar"></div><i data-m="r" title="Retail"></i><i data-m="t" title="Top traders"></i><span style="left:0">0.4</span><span style="left:20.5%">0.85</span><span style="left:27.3%">1.0</span><span style="left:50%">1.5</span><span style="left:72.7%">2.0</span><span style="left:100%">2.6</span></div>`;
    const [rr, rt] = $$('input', root), out = $('.wx-out', root), pos = v => ((v - 0.4) / 2.2 * 100) + '%';
    $$('[data-s]', root).forEach(b => b.onclick = () => { [rr.value, rt.value] = b.dataset.s.split(','); upd(); });
    function upd() {
      const r = +rr.value, t = +rt.value; $$('[data-v]', root)[0].textContent = ' ' + r.toFixed(2); $$('[data-v]', root)[1].textContent = ' ' + t.toFixed(2);
      $('[data-m="r"]', root).style.left = pos(r); $('[data-m="t"]', root).style.left = pos(t);
      let v;
      if (r < 0.85 && t > 1.5) v = ['up', 'Classic squeeze-up setup', 'Retail is crowded short while the big money is long. Retail keeps shorting into buyers who absorb it; if price lifts, those shorts are forced to buy.'];
      else if (r > 2.0 && t < 0.7) v = ['down', 'Dump setup', 'Everyone small is long while the big money is short. A drop forces those longs out and feeds the fall.'];
      else if (Math.abs(r - t) < 0.25) v = ['', 'No divergence', 'Retail and top traders lean the same way. No trap is visible here — this reading alone says nothing.'];
      else v = ['warn', 'Some divergence', `Top traders lean ${t > r ? 'more long' : 'more short'} than retail, but not at the extremes. Watch it; don't trade on it alone.`];
      out.innerHTML = `<b class="${v[0]}">${v[1]}</b><p>${v[2]}</p><p class="muted">Below 1.0 means more shorts than longs. Account ratios count people; position ratios weigh their money.</p>`;
    }
    [rr, rt].forEach(x => x.addEventListener('input', upd)); upd();
  };

  // 6 · real breakout or leverage trap
  W.oispot = root => {
    root.innerHTML = `<div class="wx-grid"><div class="wx-side">${range('Futures volume vs spot', 1, 20, 0.5, 10, ': 1')}${range('Open interest change', -20, 400, 5, 330, '%')}${range('Funding', -0.05, 0.3, 0.005, 0.12, '%')}${range('Short share of liquidations', 0, 100, 1, 85, '%')}
      <div class="wx-chips"><button type="button" data-s="2,60,0.02,55">Healthy breakout</button><button type="button" data-s="10,330,0.12,85">Leverage trap</button></div></div>
      <div class="wx-out" aria-live="polite"></div></div>`;
    const rs = $$('input', root), out = $('.wx-out', root);
    $$('[data-s]', root).forEach(b => b.onclick = () => { b.dataset.s.split(',').forEach((v, i) => { rs[i].value = v; }); upd(); });
    function upd() {
      const [ratio, oi, fund, liq] = rs.map(r => +r.value), V = $$('[data-v]', root);
      V[0].textContent = ' ' + ratio.toFixed(1); V[1].textContent = ' ' + (oi > 0 ? '+' : '') + oi; V[2].textContent = ' ' + fund.toFixed(3); V[3].textContent = ' ' + liq;
      const flags = [];
      if (ratio >= 6) flags.push(`Futures trade ${ratio.toFixed(0)}× the spot volume: the move is mostly leverage.`);
      if (oi >= 150) flags.push(`OI +${oi}%: a flood of new leveraged positions.`);
      if (fund > 0.1) flags.push(`Funding ${fund.toFixed(3)}%: the long side is paying heavily to stay in.`);
      if (liq >= 75) flags.push(`${liq}% of liquidations are shorts: the rise is fed by forced buying, not new demand.`);
      const good = [];
      if (ratio < 4) good.push('Spot volume keeps up with futures: real buyers are there.');
      if (oi > 0 && oi < 150) good.push('OI rises at a sane pace.');
      if (fund <= 0.05 && fund >= -0.01) good.push('Funding is mild.');
      if (liq < 70) good.push('Both sides get liquidated.');
      const s = flags.length, v = s >= 3 ? ['down', 'Leverage trap'] : s === 2 ? ['warn', 'Mixed: be careful'] : ['up', 'Looks like a real breakout'];
      out.innerHTML = `<b class="${v[0]}">${v[1]}</b>${flags.length ? `<ul>${flags.map(f => `<li class="bad">${esc(f)}</li>`).join('')}</ul>` : ''}${good.length ? `<ul>${good.map(f => `<li class="ok">${esc(f)}</li>`).join('')}</ul>` : ''}<p class="muted">Rule: never chase a pump that only shows up in futures. Check spot volume first.</p>`;
    }
    rs.forEach(r => r.addEventListener('input', upd)); upd();
  };

  // 7 · wallet flow: where tokens go and what it means
  W.flow = root => {
    const N = { cold: [72, 50, 'Cold wallet'], whale: [72, 170, 'Self-custody'], dep: [260, 50, 'Deposit address'], hot: [260, 170, 'Exchange hot wallet'], book: [448, 170, 'Order book'], a: [448, 50, 'Wallet A'], b: [448, 110, 'Wallet B'] };
    const S = {
      accum: { label: 'Accumulation', tone: 'up', path: [['hot', 'whale']], steps: ['Tokens leave the exchange hot wallet for a self-custody wallet that keeps the balance.', 'Supply on the exchange shrinks: less to sell, so price can rise more easily. A bullish sign — if the wallet holds.'] },
      queue: { label: 'Preparing to sell', tone: 'warn', path: [['cold', 'dep']], steps: ['A whale moves tokens from cold storage to an exchange deposit address.', 'Supply is queued, not yet for sale. Tokens sitting in a deposit address can still wait for days.'] },
      dump: { label: 'Supply hits the book', tone: 'down', path: [['dep', 'hot'], ['hot', 'book']], steps: ['The exchange sweeps the deposits into its main hot wallet.', 'Now the tokens can be sold on the order book. This timing is when a squeeze can turn into a sudden crash.'] },
      route: { label: 'Router pass-through', tone: '', path: [['hot', 'a'], ['a', 'b']], steps: ['A big withdrawal lands in Wallet A…', '…and Wallet A sends it all to Wallet B within hours, back to a near-zero balance. A is a router. Follow B: that is where the tokens really sit.'] },
    };
    root.innerHTML = `<div class="wx-chips">${Object.entries(S).map(([k, s], i) => `<button type="button" data-sc="${k}" aria-pressed="${i === 0}">${s.label}</button>`).join('')}</div>
      <div class="wx-fig wide"><svg viewBox="0 0 520 220" aria-label="Wallet flow diagram"></svg></div><div class="wx-out" aria-live="polite"></div>
      <div class="wx-row"><button type="button" class="btn btn-secondary btn-sm" data-step>Next step</button><span class="muted mono" data-sn></span></div>`;
    const svg = $('svg', root), out = $('.wx-out', root); let cur = 'accum', st = 0, anim = 0;
    function paint() {
      const s = S[cur], shown = s.path.slice(0, Math.min(s.path.length, st + 1)); svg.replaceChildren();
      const defs = svgEl('defs', {}, svg), m = svgEl('marker', { id: 'wxa', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs); svgEl('path', { d: 'M0 0L10 5L0 10z', class: 'wx-arrowhead' }, m);
      const used = new Set(shown.flat());
      // an edge runs from the first box's border to the second's (boxes are 132 × 34), so neither line nor token crosses a label
      const ends = (a, b) => { const [ax, ay] = N[a], [bx, by] = N[b], L2 = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L2, uy = (by - ay) / L2;
        const t = Math.min(ux ? 66 / Math.abs(ux) : 1e9, uy ? 17 / Math.abs(uy) : 1e9);
        return [ax + ux * (t + 4), ay + uy * (t + 4), bx - ux * (t + 8), by - uy * (t + 8)]; };
      for (const [a, b] of shown) { const [x1, y1, x2, y2] = ends(a, b);
        svgEl('line', { x1, y1, x2, y2, class: 'wx-edge ' + s.tone, 'marker-end': 'url(#wxa)' }, svg); }
      for (const [k, [x, y, t]] of Object.entries(N)) { const g = svgEl('g', { class: 'wx-node' + (used.has(k) ? ' on' : '') }, svg); svgEl('rect', { x: x - 66, y: y - 17, width: 132, height: 34, rx: 9 }, g); txt(g, x, y + 4, t, 'wx-lab', 'middle'); }
      const [x1, y1, x2, y2] = ends(...shown[shown.length - 1]);
      const dotc = svgEl('circle', { r: 5, class: 'wx-token ' + s.tone }, svg); cancelAnimationFrame(anim);
      if (!reduce) { const t0 = performance.now(); (function f(now) { const k = ((now - t0) % 1600) / 1600; dotc.setAttribute('cx', x1 + (x2 - x1) * k); dotc.setAttribute('cy', y1 + (y2 - y1) * k); anim = requestAnimationFrame(f); })(t0); }
      else { dotc.setAttribute('cx', x2); dotc.setAttribute('cy', y2); }
      out.innerHTML = `<b class="${s.tone === 'up' ? 'up' : s.tone === 'down' ? 'down' : s.tone === 'warn' ? 'warn' : ''}">${s.label}</b><p>${esc(s.steps[Math.min(st, s.steps.length - 1)])}</p>`;
      $('[data-sn]', root).textContent = `step ${Math.min(st, s.steps.length - 1) + 1} of ${s.steps.length}`;
      $('[data-step]', root).textContent = st >= s.steps.length - 1 ? 'Start again' : 'Next step';
    }
    $$('[data-sc]', root).forEach(b => b.onclick = () => { $$('[data-sc]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); cur = b.dataset.sc; st = 0; paint(); });
    $('[data-step]', root).onclick = () => { st = st >= S[cur].steps.length - 1 ? 0 : st + 1; paint(); };
    paint();
  };

  // 8 · the 5-step confirmation chain
  W.chain = root => {
    const steps = [['On-chain flow', 'Tokens flow out of exchanges (long) or into them (short).'], ['Exchange activity', 'The supply actually reached the hot wallet — not just a deposit address.'],
      ['Cost basis', 'You know roughly where the big holder bought, and how far price is from it.'], ['Derivatives', 'Funding, OI and the L/S ratios show a crowd on the wrong side.'], ['Price structure', 'A clean entry: a sweep and reclaim with a higher low (or the mirror for shorts).']];
    root.innerHTML = `<div class="wx-check">${steps.map(([t, d], i) => `<label><input type="checkbox"><span><b>${i + 1} · ${t}</b>${d}</span></label>`).join('')}</div><div class="wx-meter2"><i></i></div><div class="wx-out" aria-live="polite"></div>`;
    const cb = $$('input', root), bar = $('.wx-meter2 i', root), out = $('.wx-out', root);
    function upd() {
      const n = cb.filter(c => c.checked).length; bar.style.width = n * 20 + '%'; bar.className = n >= 4 ? 'ok' : n >= 2 ? 'mid' : '';
      out.innerHTML = n === 5 ? '<b class="up">Full thesis</b><p>Every link agrees. This is when the framework says size up — and it can still be wrong, so the stop stays.</p>'
        : n >= 3 ? `<b class="warn">${n} of 5</b><p>A partial story. Trade smaller, or wait for the missing link.</p>`
        : `<b>${n} of 5</b><p>One big wallet or one signal is not a thesis. Keep building it before you trade.</p>`;
    }
    cb.forEach(c => c.addEventListener('change', upd)); upd();
  };

  // 9 · premium / discount calculator: drag price inside a leg
  W.zones = root => {
    root.innerHTML = `<div class="wx-grid"><div class="wx-fig"><svg viewBox="0 0 320 240" aria-label="Range split into premium and discount"></svg></div>
      <div class="wx-side">${range('Swing low', 80, 100, 0.5, 90)}${range('Swing high', 100, 130, 0.5, 120)}${range('Price now', 80, 130, 0.25, 113)}<div class="wx-out" aria-live="polite"></div></div></div>`;
    const svg = $('svg', root), [rl, rh, rp] = $$('input', root), out = $('.wx-out', root);
    function upd() {
      const lo = +rl.value, hi = +rh.value, p = Math.max(lo, Math.min(hi, +rp.value)), V = $$('[data-v]', root);
      V[0].textContent = ' ' + lo.toFixed(1); V[1].textContent = ' ' + hi.toFixed(1); V[2].textContent = ' ' + (+rp.value).toFixed(2);
      const Y = v => 220 - (v - lo) / (hi - lo) * 200, mid = (lo + hi) / 2, o62 = hi - (hi - lo) * 0.62, o79 = hi - (hi - lo) * 0.79;
      svg.replaceChildren();
      svgEl('rect', { x: 40, y: Y(hi), width: 250, height: Y(mid) - Y(hi), class: 'wx-prem' }, svg);
      svgEl('rect', { x: 40, y: Y(mid), width: 250, height: Y(lo) - Y(mid), class: 'wx-disc' }, svg);
      const lvl = (v, t) => { svgEl('line', { x1: 40, x2: 290, y1: Y(v), y2: Y(v), class: 'wx-tick' }, svg); txt(svg, 36, Y(v) + 4, t, 'wx-lab', 'end'); };
      lvl(hi, '100%'); lvl(mid, '50%'); lvl(lo, '0%');
      txt(svg, 286, Y(hi) + 16, 'Premium · look for shorts', 'wx-lab', 'end'); txt(svg, 286, Y(lo) - 8, 'Discount · look for longs', 'wx-lab', 'end');
      const yp = Y(p); svgEl('line', { x1: 40, x2: 290, y1: yp, y2: yp, class: 'wx-pxl up' }, svg); svgEl('circle', { cx: 165, cy: yp, r: 5, class: 'wx-token' }, svg);
      const pct = (p - lo) / (hi - lo) * 100, ret = (hi - p) / (hi - lo) * 100;
      out.innerHTML = `<b class="${pct >= 50 ? 'down' : 'up'}">${pct >= 50 ? 'Premium' : 'Discount'} · ${pct.toFixed(0)}% of the range</b><p>In an up leg this price is a ${ret.toFixed(0)}% pullback from the high. ${pct >= 50 ? 'Shorts belong up here; longs are expensive.' : 'Longs belong down here; shorts are cheap.'}</p><p class="muted">Equilibrium (50%) is ${fmt(mid)}.</p>`;
    }
    [rl, rh, rp].forEach(r => r.addEventListener('input', upd)); upd();
  };

  // 10 · position size: risk a fixed amount, size from the stop
  W.risk = root => {
    root.innerHTML = `<div class="wx-grid"><div class="wx-side">${range('Account', 100, 20000, 100, 5000, '$')}${range('Risk per trade', 0.25, 5, 0.25, 1, '%')}${range('Stop distance', 0.25, 15, 0.25, 3, '%')}${range('Leverage', 1, 50, 1, 10, '×')}</div><div class="wx-out" aria-live="polite"></div></div>`;
    const rs = $$('input', root), out = $('.wx-out', root);
    function upd() {
      const [acct, rp, sp, lev] = rs.map(r => +r.value), V = $$('[data-v]', root);
      V[0].textContent = ' ' + acct.toLocaleString('en-US'); V[1].textContent = ' ' + rp; V[2].textContent = ' ' + sp; V[3].textContent = ' ' + lev;
      const risk = acct * rp / 100, notional = risk / (sp / 100), margin = notional / lev, liqPct = 100 / lev - 0.5;
      out.innerHTML = `<b>Position $${fmt(notional, 0)}</b><p>If the stop is hit you lose about <b class="down mono">$${fmt(risk)}</b> (${rp}% of the account), plus fees.</p>
        <dl><dt>Margin at ${lev}×</dt><dd class="mono">$${fmt(margin)}${margin > acct ? ' — more than the account!' : ''}</dd><dt>Liquidation</dt><dd class="mono">about ${liqPct.toFixed(1)}% away</dd></dl>
        ${liqPct <= sp ? `<p class="down"><b>Liquidation comes before your stop.</b> Lower the leverage until it sits beyond ${sp}%.</p>` : '<p class="muted">Leverage only changes the margin, not the risk. The stop sets the risk.</p>'}`;
    }
    rs.forEach(r => r.addEventListener('input', upd)); upd();
  };

  // =====================================================================================================================
  // Candlestick patterns (/assets/cpat.js): gallery, context, entry lab, trainer on real charts, live check vs random
  // =====================================================================================================================
  const CP_EV = (CP && CP.TEST) || {};   // our real-chart test numbers, kept in cpat.js
  const sideName = s => s === 1 ? 'Bullish' : s === -1 ? 'Bearish' : 'No side';
  const sideCls = s => s === 1 ? 'up' : s === -1 ? 'down' : 'warn';
  const signR = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + 'R';
  const tradeHow = p => p.side === 1 ? 'Long at the next candle’s open, or a buy-stop just above the pattern’s high. Stop just under the pattern’s lowest low. Target 1R–2R, or the next level above.'
    : p.side === -1 ? 'Short at the next candle’s open, or a sell-stop just under the pattern’s low. Stop just above the pattern’s highest high. Target 1R–2R, or the next level below.'
    : 'It has no side. Mark its high and low and wait: a close above the high says long, a close below the low says short. The stop goes at the other end.';
  function evLine(key) {
    const v = CP_EV[key];
    if (!v) return '<p class="muted">Not in our test: it has no direction to trade.</p>';
    return `<p class="cp-ev"><b>Real charts:</b> ${v[0].toLocaleString('en-US')} trades on 40 coins. 1R before the stop <b>${v[1]}%</b> (random entries ${v[2]}%), 2R <b>${v[3]}%</b> (random ${v[4]}%). Typical stop ${v[5]}%. Aiming for 2R, after fees: <b class="${v[6] > 0 ? 'up' : 'down'}">${signR(v[6])}</b> a trade.</p>`;
  }

  // the standard trade with a choice of entry. mode: open = next candle's open · break = stop order at the pattern's
  // high (long) / low (short), 5 candles to fill · pull = limit at the middle of the pattern, 5 candles to fill.
  // Stop 0.05 ATR past the pattern's extreme. On a stop / limit fill candle only the stop counts (its high / low may have
  // come before the fill); a candle reaching stop and target counts as the stop. hor candles, then out at the close.
  function cpPlan(K, h, side, mode, tR, hor, A) {
    let hi = -Infinity, lo = Infinity;
    for (let k = h.i0; k <= h.i; k++) { hi = Math.max(hi, K[k][2]); lo = Math.min(lo, K[k][3]); }
    const buf = 0.05 * (A[h.i] || 0), stop = side === 1 ? lo - buf : hi + buf;
    const lvl = mode === 'break' ? (side === 1 ? hi : lo) : mode === 'pull' ? (hi + lo) / 2 : null;
    const P = { side, mode, tR, lvl, stop, hi, lo, fill: -1, res: 'nofill' };
    if (mode === 'open') { if (h.i + 1 < K.length) { P.fill = h.i + 1; P.entry = K[h.i + 1][1]; } }
    else for (let k = h.i + 1; k < Math.min(K.length, h.i + 6); k++) {
      const o = K[k][1], hh = K[k][2], ll = K[k][3];
      const hit = mode === 'break' ? (side === 1 ? hh > lvl : ll < lvl) : (side === 1 ? ll <= lvl : hh >= lvl);
      if (!hit) continue;
      P.fill = k; P.entry = mode === 'break' ? (side === 1 ? Math.max(lvl, o) : Math.min(lvl, o)) : (side === 1 ? Math.min(lvl, o) : Math.max(lvl, o));
      break;
    }
    if (P.fill < 0) return P;
    const r = (P.entry - stop) * side;
    if (!(r > 0)) { P.fill = -1; P.why = 'past'; return P; }   // filled beyond the stop: no trade
    P.r = r; P.pct = r / P.entry; P.tgt = P.entry + side * tR * r; P.feeR = 0.001 / P.pct;   // 0.05% taker in and out
    for (let k = P.fill; k < Math.min(K.length, P.fill + hor); k++) {
      const hh = K[k][2], ll = K[k][3];
      P.exit = k;
      if (side === 1 ? ll <= stop : hh >= stop) { P.res = 'stop'; P.R = -1; P.exitPx = stop; break; }
      if ((k > P.fill || mode === 'open') && (side === 1 ? hh >= P.tgt : ll <= P.tgt)) { P.res = 'target'; P.R = tR; P.exitPx = P.tgt; break; }
      P.res = 'time'; P.exitPx = K[k][4]; P.R = (K[k][4] - P.entry) * side / r;
    }
    P.net = P.R - P.feeR;
    return P;
  }
  // the same side, stop size and target from random candles of the same chart (entry at their open): average R after fees
  function cpRandom(K, side, pct, tR, hor, rnd) {
    let sum = 0, n = 0;
    for (let q = 0; q < 40; q++) {
      const j = 20 + Math.floor(rnd() * Math.max(1, K.length - hor - 22)), e = K[j][1], st = e * (1 - side * pct), tg = e * (1 + side * tR * pct);
      let R = null;
      for (let k = j; k < Math.min(K.length, j + hor); k++) {
        if (side === 1 ? K[k][3] <= st : K[k][2] >= st) { R = -1; break; }
        if (side === 1 ? K[k][2] >= tg : K[k][3] <= tg) { R = tR; break; }
        R = (K[k][4] - e) * side / (e * pct);
      }
      if (R != null) { sum += R - 0.001 / pct; n++; }
    }
    return n ? sum / n : 0;
  }

  // gallery: pick a pattern, see a textbook example with its trade, the rules and the real-chart numbers
  function cpGallery(root, keys) {
    if (!CP) throw new Error('pattern file missing');
    root.innerHTML = `<div class="wx-chips" role="group" aria-label="Pick a pattern">${keys.map(k => `<button type="button" data-k="${k}" aria-pressed="false">${esc(CP.BY[k].name)}</button>`).join('')}</div>
      <div class="wx-grid"><div class="figure cp-fig"><div class="chart"></div><p class="cp-note">Textbook example, invented candles</p></div><div class="wx-out" aria-live="polite"></div></div>`;
    const host = $('.chart', root), out = $('.wx-out', root); let S = null;
    const render = () => { if (S) draw(host, S, S.candles.length, true); };
    function pick(k) {
      $$('[data-k]', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
      const p = CP.BY[k]; S = cpExample(k, CP_AFTER, 8); S.ann[0].label = '';   // the panel names it; on the chart it sits on a candle
      out.innerHTML = `<b class="${sideCls(p.side)}">${esc(p.name)} · ${sideName(p.side)}</b><p>${esc(p.says)}</p>
        <dl class="cp-dl"><dt>Spot it</dt><dd>${esc(p.how)}</dd><dt>Trade it</dt><dd>${esc(tradeHow(p))}</dd></dl>${evLine(k)}`;
      render();
    }
    $$('[data-k]', root).forEach(b => b.onclick = () => pick(b.dataset.k));
    observe(host, render); pick(keys[0]);
  }
  W.cpsingle = root => cpGallery(root, CP.PATTERNS.filter(p => p.group === 'single').map(p => p.key).concat('inside'));
  W.cpbull = root => cpGallery(root, CP.PATTERNS.filter(p => p.side === 1 && p.n > 1).map(p => p.key));
  W.cpbear = root => cpGallery(root, CP.PATTERNS.filter(p => p.side === -1 && p.n > 1).map(p => p.key));

  // context: the same shape after a drop, after a rise or sideways — the detector names it (or doesn't)
  W.cpctx = root => {
    if (!CP) throw new Error('pattern file missing');
    const SH = { hammer: ['Hammer shape', [[0, 0.8, -4.5, 0.6]]], inv: ['Upside-down hammer', [[0, 4.5, -0.2, 0.5]]], doji: ['Doji', [[0, 1.5, -1.5, 0.05]]],
      geng: ['Green swallows red', [[0, 0.2, -1.5, -1.3], [-1.3, 0.8, -1.5, 0.6]]], reng: ['Red swallows green', [[0, 1.5, -0.2, 1.3], [1.3, 1.5, -0.8, -0.6]]] };
    root.innerHTML = `<div class="wx-row"><span class="cp-lab">Shape</span><div class="wx-chips" role="group" aria-label="Shape">${Object.entries(SH).map(([k, [l]], i) => `<button type="button" data-s="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div></div>
      <div class="wx-row"><span class="cp-lab">Before it</span>${seg('ctx', [['drop', 'A drop'], ['rise', 'A rise'], ['flat', 'Sideways']], 'drop')}</div>
      <div class="wx-grid"><div class="figure cp-fig"><div class="chart"></div></div><div class="wx-out" aria-live="polite"></div></div>`;
    const host = $('.chart', root), out = $('.wx-out', root); let S = null;
    const render = () => { if (S) draw(host, S, S.candles.length, true); };
    function upd() {
      const sk = $('[data-s][aria-pressed="true"]', root).dataset.s, ctx = segVal(root, 'ctx'), shape = SH[sk][1];
      const d = ctx === 'drop' ? Array(18).fill(-1.4) : ctx === 'rise' ? Array(18).fill(1.4) : Array.from({ length: 18 }, (_, k) => (k % 2 ? -0.6 : 0.6));
      let c = 100 - d.reduce((a, b) => a + b, 0); const K = [];
      for (const x of d) { const o = c; c = o + x; K.push([0, o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c, 1]); }
      const P = c; for (const [o, h, l, cl] of shape) K.push([0, P + o, P + h, P + l, P + cl, 1]);
      K.forEach((k, i) => { k[0] = i * 3600e3; });
      const last = K.length - 1, first = last - shape.length + 1, names = CP.detect(K).filter(h => h.i === last && h.i0 === first);
      let hi = -Infinity, lo = Infinity; for (let k = first; k <= last; k++) { hi = Math.max(hi, K[k][2]); lo = Math.min(lo, K[k][3]); }
      // the detector reads all 18 candles before the shape; the chart shows the last 10 so the shape isn't tiny (the panel names it)
      const s0 = 8;
      S = { candles: K.slice(s0).map(k => k.slice(1, 5)), digits: 1, xEvery: 5, aria: 'The chosen shape after ' + (ctx === 'flat' ? 'a sideways stretch' : 'a ' + ctx),
        ann: [{ type: 'zone', cls: 'pat', i0: first - s0, i1: last - s0, y0: lo, y1: hi }] };
      const why = {
        hammer: 'After a drop this shape is a <b>hammer</b> (bullish). After a rise the very same candle is a <b>hanging man</b> (bearish). Sideways it is just a candle.',
        inv: 'After a drop this shape is an <b>inverted hammer</b> (bullish). After a rise the same candle is a <b>shooting star</b> (bearish). Sideways it is just a candle.',
        doji: 'A doji means indecision wherever it appears; it has no side of its own. What comes next decides.',
        geng: 'After a drop a green body swallowing a red one is a <b>bullish engulfing</b>. After a rise it is just more buying — the bearish version needs the colours the other way round.',
        reng: 'After a rise a red body swallowing a green one is a <b>bearish engulfing</b>. After a drop it is just more selling.' }[sk];
      out.innerHTML = names.length
        ? names.map(h => { const p = CP.BY[h.key]; return `<b class="${sideCls(p.side)}">${esc(p.name)} · ${sideName(p.side)}</b><p>${esc(p.says)}</p>`; }).join('') + `<p class="muted">${why}</p>`
        : `<b>No pattern here</b><p>${why}</p><p class="muted">A reversal pattern needs a move to reverse: a drop before a bullish one, a rise before a bearish one.</p>`;
      render();
    }
    $$('[data-s]', root).forEach(b => b.onclick = () => { $$('[data-s]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); upd(); });
    segWire(root, upd); observe(host, render); upd();
  };

  // entry lab: the same pattern, three ways in; where the stop and target land, the size for a fixed risk, and fees in R
  W.cpentry = root => {
    if (!CP) throw new Error('pattern file missing');
    const keys = ['bullengulf', 'hammer', 'morning', 'bearengulf', 'star', 'evening'], AFT = [0.4, -1.6, 1.2, 1.4, 1.0, 1.3, -0.5, 1.2, 1.1, 0.9, 1.0, 0.8, 1.1, 0.7];
    root.innerHTML = `<div class="wx-chips" role="group" aria-label="Pattern">${keys.map((k, i) => `<button type="button" data-k="${k}" aria-pressed="${i === 0}">${esc(CP.BY[k].name)}</button>`).join('')}</div>
      <div class="wx-row">${seg('mode', [['open', 'Next open'], ['break', 'Break of the pattern'], ['pull', 'Pullback to its middle']], 'open')}${seg('tgt', [['1', '1R'], ['2', '2R'], ['3', '3R']], '2')}</div>
      <div class="wx-grid"><div class="figure cp-fig"><div class="chart"></div><p class="cp-note">Textbook example, invented candles</p></div><div class="wx-side">${range('Risk per trade', 10, 500, 10, 50, '$')}<div class="wx-out" aria-live="polite"></div></div></div>`;
    const host = $('.chart', root), out = $('.wx-out', root), rr = $('input[type=range]', root); let S = null;
    const render = () => { if (S) draw(host, S, S.candles.length, true); };
    const why = { open: 'Always fills, as soon as the pattern closes. No extra proof that it worked.',
      break: 'Fills only if price breaks the pattern first: a little proof, but a worse price, so the stop is further away and the position smaller for the same risk.',
      pull: 'The best price and the smallest stop, so a bigger position for the same risk. It fills only if price comes back, and strong moves leave without you.' };
    function upd() {
      const k = $('[data-k][aria-pressed="true"]', root).dataset.k, p = CP.BY[k], mode = segVal(root, 'mode'), tR = +segVal(root, 'tgt'), risk = +rr.value;
      $('.wx-r [data-v]', root).textContent = ' ' + risk;   // the slider's read-out (the seg buttons carry data-v too)
      const e = CP.example(k, AFT), K = e.K, A = CP.atrOf(K), h = { i0: e.i0, i: e.i }, P = cpPlan(K, h, p.side, mode, tR, 40, A);
      const s0 = e.i0 - 8, x = i => i - s0;   // traded on the whole example, drawn from 8 candles before the pattern
      const ann = [{ type: 'zone', cls: 'pat', i0: x(e.i0), i1: x(e.i), y0: P.lo, y1: P.hi }];
      const ordLab = mode === 'break' ? (p.side === 1 ? 'Buy-stop' : 'Sell-stop') : (p.side === 1 ? 'Buy limit' : 'Sell limit');
      if (mode !== 'open') ann.push({ type: 'line', cls: 'entry', y: P.lvl, i0: x(e.i + 1), i1: x(e.i + 5), label: ordLab, lp: 'end', ly: p.side === 1 && mode === 'pull' ? 'below' : undefined });
      if (P.fill >= 0) ann.push({ type: 'box', i0: x(P.fill), entry: P.entry, stop: P.stop, tp: P.tgt, entryLabel: p.side === 1 ? 'Long' : 'Short', tpLabel: tR + 'R', noR: true });
      S = { candles: K.slice(s0).map(c => c.slice(1, 5)), digits: 1, xEvery: 5, ann, aria: p.name + ' with a ' + mode + ' entry' };
      const f = v => v.toFixed(2);
      if (P.fill < 0) {
        out.innerHTML = `<b class="warn">No fill</b><p>${mode === 'pull' ? 'Price never came back to the middle of the pattern within 5 candles, so the limit order expired. The move went without you.' : 'Price never broke the pattern within 5 candles, so the stop order expired.'}</p><p class="muted">${why[mode]}</p>`;
      } else {
        const size = risk / P.pct, fee = size * 0.001;
        out.innerHTML = `<b>${p.side === 1 ? 'Long' : 'Short'} at ${f(P.entry)}</b>
          <dl><dt>Stop</dt><dd>${f(P.stop)} · ${(P.pct * 100).toFixed(2)}% away</dd><dt>Target ${tR}R</dt><dd>${f(P.tgt)}</dd><dt>Position</dt><dd>$${fmt(size, 0)} for $${risk} risk</dd><dt>Fees in + out</dt><dd>$${fmt(fee)} = ${(fee / risk).toFixed(2)}R</dd></dl>
          <p class="muted">${why[mode]}</p>`;
      }
      render();
    }
    $$('[data-k]', root).forEach(b => b.onclick = () => { $$('[data-k]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); upd(); });
    segWire(root, upd); rr.addEventListener('input', upd); observe(host, render); upd();
  };

  // real candles straight from Binance in the browser (public data; nothing goes through our server)
  const CP_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'SUI', 'AVAX', 'LINK', 'ADA', 'LTC', 'DOT', 'NEAR', 'APT', 'ARB', 'OP', 'INJ', 'TIA', 'WIF', '1000PEPE', 'AAVE', 'UNI', 'ENA', 'ONDO', 'HBAR', 'TRX', 'FIL', 'ATOM', 'SEI', 'ORDI'];
  const CP_TF = { '15m': 15 * 60e3, '1h': 3600e3, '4h': 4 * 3600e3 }, CP_TFL = { '15m': '15m', '1h': '1H', '4h': '4H' };
  async function cpKlines(sym, iv, pages) {
    let end = null, out = [];
    for (let p = 0; p < (pages || 1); p++) {
      const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${iv}&limit=1500${end ? '&endTime=' + end : ''}`);
      if (!r.ok) throw new Error(r.status === 400 ? 'no such coin on Binance futures' : 'Binance answered ' + r.status);
      const d = await r.json(); if (!Array.isArray(d) || !d.length) break;
      out = d.map(k => [+k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]).concat(out);
      end = +d[0][0] - 1; if (d.length < 1500) break;
    }
    if (out.length && out[out.length - 1][0] + CP_TF[iv] > Date.now()) out.pop();   // the candle still forming
    return out;
  }
  const cpDigits = p => p >= 1000 ? 1 : p >= 100 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.1 ? 5 : 6;
  const cpDate = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ', ' + new Date(t).toISOString().slice(11, 16) + ' UTC';

  // the trainer: a real chart stops on a pattern. Name it, place a trade (or skip), watch it play out; score vs random
  W.cptrain = root => {
    if (!CP) throw new Error('pattern file missing');
    const KEYS = CP.PATTERNS.filter(p => p.side).map(p => p.key), HOR = 30, SK = 'rd-cptrain-v1', rnd = Math.random;
    const blank = () => ({ rounds: 0, named: 0, trades: 0, wins: 0, stops: 0, times: 0, nofill: 0, skips: 0, sumR: 0, sumRand: 0 });
    const load = () => { try { const o = JSON.parse(localStorage.getItem(SK) || 'null'); return o && typeof o.rounds === 'number' ? Object.assign(blank(), o) : blank(); } catch (e) { return blank(); } };
    const save = () => { try { localStorage.setItem(SK, JSON.stringify(SC)); } catch (e) { /* private mode: the score isn't kept */ } };
    let SC = load(), R = null, timer = null, token = 0;
    const seen = new Set();
    root.innerHTML = `<div class="wx-row cpt-bar">${seg('tf', [['any', 'Any'], ['15m', '15m'], ['1h', '1H'], ['4h', '4H']], 'any')}
        <label class="cpt-sel"><span>Pattern</span><select aria-label="Pattern to practise"><option value="any">Any pattern</option>${KEYS.map(k => `<option value="${k}">${esc(CP.BY[k].name)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-secondary btn-sm cpt-new">New chart</button></div>
      <div class="figure cp-fig cpt-fig"><div class="chart"></div><p class="caption cpt-cap" aria-live="polite">Loading a real chart…</p></div>
      <div class="cpt-step"></div>
      <div class="cpt-score" aria-live="polite"></div>`;
    const host = $('.chart', root), cap = $('.cpt-cap', root), step = $('.cpt-step', root), scoreEl = $('.cpt-score', root), sel = $('select', root);
    const render = () => { if (R) draw(host, R.S, R.n, true); };
    const stopTimer = () => { if (timer) { clearInterval(timer); timer = null; } };
    function paintScore() {
      const tr = SC.trades, avg = tr ? SC.sumR / tr : 0, ravg = tr ? SC.sumRand / tr : 0;
      scoreEl.innerHTML = `<dl class="cpt-stats"><div><dt>Rounds</dt><dd>${SC.rounds}</dd></div><div><dt>Names right</dt><dd>${SC.named} of ${SC.rounds}</dd></div>
        <div><dt>Trades</dt><dd>${tr ? `${tr} · ${SC.wins} target, ${SC.stops} stop${SC.times ? `, ${SC.times} time` : ''}` : '0'}</dd></div>
        <div><dt>You, after fees</dt><dd class="${SC.sumR > 0 ? 'up' : SC.sumR < 0 ? 'down' : ''}">${tr ? signR(SC.sumR) + ` · ${signR(avg)} a trade` : '–'}</dd></div>
        <div><dt>Random, same trades</dt><dd>${tr ? signR(SC.sumRand) + ` · ${signR(ravg)} a trade` : '–'}</dd></div></dl>
        <p class="muted cpt-foot">${tr >= 10 ? `Over ${tr} trades you made ${signR(avg)} a trade; the same stops and targets from random candles made ${signR(ravg)}. ${tr < 100 ? 'Under about 100 trades that gap is mostly luck.' : 'Keep going: the gap only means something if it holds.'}` : 'Random = the same side, stop size and target placed at random candles of the same chart. The score stays in this browser.'}
        ${SC.rounds ? ' <button type="button" class="cpt-reset">Reset score</button>' : ''}</p>`;
      const rb = $('.cpt-reset', scoreEl); if (rb) rb.onclick = () => { SC = blank(); save(); paintScore(); };
    }
    async function newRound() {
      stopTimer(); const my = ++token;
      R = null; host.replaceChildren(); step.innerHTML = ''; cap.textContent = 'Loading a real chart…';
      const tfSel = segVal(root, 'tf'), pat = sel.value, before = (host.clientWidth || 600) < 520 ? 30 : 46;
      let err = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        const iv = tfSel === 'any' ? ['15m', '1h', '4h'][Math.floor(rnd() * 3)] : tfSel, coin = CP_COINS[Math.floor(rnd() * CP_COINS.length)], sym = coin + 'USDT';
        let K; try { K = await cpKlines(sym, iv, pat === 'any' ? 1 : 2); } catch (e) { err = e; continue; }
        if (my !== token) return;
        const hits = CP.detect(K).filter(h => h.side && h.i - before >= 20 && h.i + HOR + 2 < K.length && (pat === 'any' || h.key === pat) && !seen.has(sym + iv + K[h.i][0]));
        if (!hits.length) continue;
        const keys = [...new Set(hits.map(h => h.key))], key = keys[Math.floor(rnd() * keys.length)], pool = hits.filter(h => h.key === key);   // every pattern equally likely
        const h = pool[Math.floor(rnd() * pool.length)]; seen.add(sym + iv + K[h.i][0]);
        const s0 = h.i - before + 1, A = CP.atrOf(K), alsoKeys = CP.detect(K.slice(0, h.i + 1)).filter(x => x.i === h.i).map(x => x.key);
        let hi = -Infinity, lo = Infinity; for (let k = h.i0; k <= h.i; k++) { hi = Math.max(hi, K[k][2]); lo = Math.min(lo, K[k][3]); }
        const S = { candles: K.slice(s0, h.i + 1 + HOR).map(k => k.slice(1, 5)), digits: cpDigits(K[h.i][4]), fit: true, xEvery: 1e9, times: Array(before + HOR).fill(''),
          aria: 'A real chart stopped on a candle pattern', ann: [{ type: 'zone', cls: 'pat', i0: h.i0 - s0, i1: h.i - s0, y0: lo, y1: hi, label: '?', lp: 'above-left' }] };
        R = { K, A, h, s0, S, n: before, sym, iv, also: new Set(alsoKeys), p: CP.BY[h.key], narrow: before === 30 };
        cap.textContent = 'A real chart, stopped on the candle that completed a pattern (boxed). The coin and date show at the end.';
        render(); askName(); return;
      }
      cap.textContent = `Couldn’t load a chart${err ? ' (' + err.message + ')' : ''}${pat !== 'any' ? ' with a recent ' + CP.BY[pat].name.toLowerCase() : ''}. Press New chart to try again.`;
    }
    function askName() {
      const p = R.p, same = KEYS.filter(k => !R.also.has(k) && CP.BY[k].n === p.n), other = KEYS.filter(k => !R.also.has(k) && CP.BY[k].n !== p.n);
      const pick = (arr, m) => arr.slice().sort(() => rnd() - 0.5).slice(0, m);
      const wrong = pick(same, 2).concat(pick(other, 3)).slice(0, 3), opts = wrong.concat(p.key).sort(() => rnd() - 0.5);
      step.innerHTML = `<p class="cpt-q"><span>1 of 2</span>Which pattern is in the box?</p><div class="qz-opts cpt-opts">${opts.map(k => `<button type="button" class="qz-o" data-k="${k}">${esc(CP.BY[k].name)}</button>`).join('')}</div><p class="qz-why" hidden></p>`;
      $$('[data-k]', step).forEach(b => b.onclick = () => {
        const ok = R.also.has(b.dataset.k); R.named = ok;
        $$('[data-k]', step).forEach(x => { x.disabled = true; if (R.also.has(x.dataset.k)) x.classList.add('ok'); });
        if (!ok) b.classList.add('bad');
        const why = $('.qz-why', step); why.hidden = false; why.className = 'qz-why ' + (ok ? 'ok' : 'bad');
        why.innerHTML = `<b>${ok ? 'Right.' : 'Not quite.'}</b> ${esc(p.name)}: ${esc(p.how)}`;
        R.S.ann[0].label = ''; render(); askTrade();   // the name is in the answer; on the chart it would sit on the trade's labels
      });
    }
    function askTrade() {
      const box = el('div', 'cpt-trade');
      box.innerHTML = `<p class="cpt-q"><span>2 of 2</span>Your trade. The stop goes just past the far end of the pattern; you choose the entry and the target.</p>
        <div class="wx-row">${seg('mode', [['open', 'Next open'], ['break', 'Break of the pattern'], ['pull', 'Pullback to its middle']], 'open')}${seg('tgt', [['1', '1R'], ['2', '2R'], ['3', '3R']], '2')}</div>
        <div class="wx-row cpt-go"><button type="button" class="btn btn-sm cpt-long" data-side="1">Long</button><button type="button" class="btn btn-sm cpt-short" data-side="-1">Short</button><button type="button" class="btn btn-secondary btn-sm" data-side="0">Skip this one</button></div>`;
      step.appendChild(box); segWire(box, () => {});
      $$('[data-side]', box).forEach(b => b.onclick = () => {
        $$('button', box).forEach(x => { x.disabled = true; }); b.classList.add('on');
        play(+b.dataset.side, segVal(box, 'mode'), +segVal(box, 'tgt'));
      });
    }
    function play(side, mode, tR) {
      const { K, A, h, s0, S } = R, loc = i => i - s0, tside = R.p.side;
      const P = side ? cpPlan(K, h, side, mode, tR, HOR, A) : null, T = cpPlan(K, h, tside, 'open', 2, HOR, A);   // T = the textbook trade
      if (P && mode !== 'open' && P.lvl != null) S.ann.push({ type: 'line', cls: 'entry', y: P.lvl, i0: loc(h.i + 1), i1: loc(h.i + 5), label: mode === 'break' ? (side === 1 ? 'Buy-stop' : 'Sell-stop') : (side === 1 ? 'Buy limit' : 'Sell limit'), lp: 'end', ly: 'below', at: loc(h.i + 1) });
      let endAt = S.candles.length;
      if (P && P.fill >= 0) {
        const wide = R.narrow ? 14 : 10;   // a minimum width (candles), so the labels don't pile up
        S.ann.push({ type: 'box', i0: loc(P.fill), i1: Math.max(loc(P.exit), loc(P.fill) + wide), bare: R.narrow,
           entry: P.entry, stop: P.stop, tp: P.tgt, entryLabel: side === 1 ? 'Long' : 'Short', tpLabel: tR + 'R', noR: true, at: loc(P.fill) });
        S.ann.push({ type: 'mark', i: loc(P.exit), y: P.exitPx, cls: P.res === 'target' ? 'tp' : P.res === 'stop' ? 'stop' : 'bot', label: P.res === 'time' ? 'Time' : signR(P.R).replace('.00', ''), pos: (P.res === 'target') === (side === 1) ? 'above' : 'below', at: loc(P.exit) });
        endAt = Math.min(S.candles.length, Math.max(loc(P.exit) + 4, loc(P.fill) + wide + 1));
      }
      const finish = () => { R.n = endAt; render(); result(side, mode, tR, P, T); };
      if (reduce) return finish();
      timer = setInterval(() => { if (R.n >= endAt) { stopTimer(); return finish(); } R.n++; render(); }, 150);
    }
    function result(side, mode, tR, P, T) {
      const { K, h, sym, iv } = R, desc = x => x.res === 'target' ? `hit its ${x.tR}R target` : x.res === 'stop' ? 'hit the stop' : x.res === 'time' ? `was ${signR(x.R)} after ${HOR} candles` : 'did not fill';
      SC.rounds++; if (R.named) SC.named++;
      let head, body = '';
      if (!side) { SC.skips++; head = `<b>Skipped</b>`; }
      else if (P.fill < 0) { SC.nofill++; head = `<b class="warn">No fill</b>`; body = `<p>${mode === 'pull' ? 'Price never came back to the middle of the pattern within 5 candles.' : 'Price never broke the pattern within 5 candles.'} No trade, no score.</p>`; }
      else {
        const rr = cpRandom(K, side, P.pct, tR, HOR, Math.random);
        SC.trades++; SC.sumR += P.net; SC.sumRand += rr;
        if (P.res === 'target') SC.wins++; else if (P.res === 'stop') SC.stops++; else SC.times++;
        head = `<b class="${P.net > 0 ? 'up' : 'down'}">${P.res === 'target' ? 'Target hit' : P.res === 'stop' ? 'Stopped out' : 'Time’s up'} · ${signR(P.R)}</b>`;
        const dg = R.S.digits;
        body = `<p>${side === 1 ? 'Long' : 'Short'} ${P.entry.toFixed(dg)} · stop ${P.stop.toFixed(dg)} · target ${P.tgt.toFixed(dg)}.</p><p>Stop ${(P.pct * 100).toFixed(2)}% away, so fees cost ${P.feeR.toFixed(2)}R: <b>${signR(P.net)}</b> after fees. The same trade from 40 random candles of this chart averaged ${signR(rr)}.</p>`;
      }
      const tbook = !side || side !== R.p.side || mode !== 'open' || tR !== 2;
      if (tbook && T.fill >= 0) body += `<p class="muted">The textbook trade (${R.p.side === 1 ? 'long' : 'short'} at the next open, 2R target) ${desc(T)}.</p>`;
      save(); paintScore();
      if (slug && SC.rounds >= 10) markDone(slug);
      if (!side) { R.n = R.S.candles.length; render(); }
      const res = el('div', 'wx-out cpt-res');
      res.innerHTML = `${head}${body}<p class="muted">${sym.replace(/USDT$/, '')} ${CP_TFL[iv]} · the pattern closed ${cpDate(K[h.i][0] + CP_TF[iv])}.</p><div><button type="button" class="btn btn-primary btn-sm cpt-next">Next chart</button></div>`;
      step.appendChild(res); $('.cpt-next', res).onclick = newRound;
    }
    $('.cpt-new', root).onclick = newRound; sel.onchange = newRound; segWire($('.cpt-bar', root), newRound);
    observe(host, render); paintScore(); newRound();
  };

  // live check: every pattern on one coin and timeframe vs the same trade from random candles (1R target)
  W.cpcheck = root => {
    if (!CP) throw new Error('pattern file missing');
    root.innerHTML = `<div class="wx-row"><label class="cpt-sel"><span>Coin</span><input type="text" list="cpc-coins" value="BTC" maxlength="20" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Coin"></label>
        <datalist id="cpc-coins">${CP_COINS.map(c => `<option value="${c}">`).join('')}</datalist>
        ${seg('tf', [['15m', '15m'], ['1h', '1H'], ['4h', '4H']], '1h')}<button type="button" class="btn btn-primary btn-sm cpc-go">Check</button></div>
      <div class="cpc-out" aria-live="polite"><p class="muted">Pick a coin and a timeframe, then press Check. Up to 4,500 candles load straight from Binance in your browser.</p></div>`;
    const inp = $('input', root), out = $('.cpc-out', root); let busy = false;
    async function run() {
      if (busy) return;
      const coin = inp.value.trim().toUpperCase().replace(/USDT$/, ''), iv = segVal(root, 'tf');
      if (!/^[A-Z0-9]{2,20}$/.test(coin)) { out.innerHTML = '<p class="down">Type a coin like BTC, SOL or 1000PEPE.</p>'; return; }
      busy = true; out.innerHTML = `<p class="muted">Loading ${esc(coin)} ${CP_TFL[iv]}…</p>`;
      try {
        const K = await cpKlines(coin + 'USDT', iv, 3);
        if (K.length < 300) { out.innerHTML = `<p class="down">Only ${K.length} candles of history: too little to check.</p>`; return; }
        await new Promise(r => setTimeout(r, 20));
        const S = CP.stats(K, { hor: 48, draws: 20, seed: K.length + coin.length * 31 });
        const rows = Object.entries(S).filter(([, s]) => s.d1).sort((a, b) => b[1].n - a[1].n).map(([k, s]) => {
          const p = s.w1 / s.d1, b = s.rn1 ? s.rw1 / s.rn1 : null, luck = b == null ? 0 : 1.96 * Math.sqrt(Math.max(b * (1 - b), 0.01) / s.d1);
          const med = s.pct.slice().sort((x, y) => x - y)[Math.floor(s.pct.length / 2)], ev = 2 * p - 1 - 0.001 / med;
          const v = s.d1 < 25 ? ['Too few to tell', 'mix'] : b == null ? ['–', ''] : p - b > luck ? ['Better than random — could be luck', 'pos'] : b - p > luck ? ['Worse than random', 'neg'] : ['Same as random', ''];
          return `<tr><td>${esc(CP.BY[k].name)}</td><td class="mono">${s.n}</td><td class="mono">${(p * 100).toFixed(0)}%</td><td class="mono">${b == null ? '–' : (b * 100).toFixed(0) + '%'}</td><td><span class="r ${ev > 0 ? 'pos' : 'neg'}">${signR(ev)}</span></td><td><span class="r ${v[1]}">${v[0]}</span></td></tr>`;
        });
        const better = rows.filter(r => r.includes('r pos')).length;
        out.innerHTML = `<p class="cpc-head"><b>${esc(coin)}USDT ${CP_TFL[iv]}</b> · ${K.length.toLocaleString('en-US')} candles, ${cpDate(K[0][0]).split(',')[0]} – ${cpDate(K[K.length - 1][0]).split(',')[0]}</p>
          ${rows.length ? `<div class="tbl"><table><thead><tr><th>Pattern</th><th>Trades</th><th>1R first</th><th>Random</th><th>After fees</th><th>Verdict</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<p class="muted">No directional patterns found.</p>'}
          <p class="muted">Trade: entry at the next open, stop just past the pattern, target 1R, 48 candles at most. Random: the same side and stop size from 20 random candles each. “After fees” = average R with 0.05% taker fees in and out. ${rows.length ? `With ${rows.length} patterns checked, one or two will look better or worse than random by luck alone${better ? ' — check a “better” one on another coin and timeframe before you believe it' : ''}.` : ''}</p>`;
      } catch (e) { out.innerHTML = `<p class="down">Couldn’t load ${esc(coin)}: ${esc(e.message)}.</p>`; }
      finally { busy = false; }
    }
    segWire(root, () => {}); $('.cpc-go', root).onclick = run; inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  };

  // pointer spotlight on cards (the landing's .spot effect)
  if (!reduce) document.addEventListener('pointermove', e => { const c = e.target.closest && e.target.closest('.spot'); if (!c) return; const r = c.getBoundingClientRect(); c.style.setProperty('--x', (e.clientX - r.left) + 'px'); c.style.setProperty('--y', (e.clientY - r.top) + 'px'); }, { passive: true });

  $$('[data-widget]').forEach(root => { const f = W[root.dataset.widget]; if (f) try { f(root); } catch (e) { root.textContent = 'This example could not load.'; } });
  paintProgress();
})();
