/* ReplayDesk · Compare: a second chart beside the main one (below it on a phone) — "which one is stronger" (BTC vs ETH vs
   SOL). Candles come straight from the exchange like the main chart. It follows the main chart's clock: in a replay it never
   shows a candle the main chart hasn't reached (the forming candle is built from closed finer candles only). Same timeframe:
   scroll, zoom and crosshair move together; its own timeframe: own zoom, the crosshair still points at the same moment.
   Optional SMC marks on it, and a 24 h read-out of both coins: % change and where each sits in its 24 h high–low range. */
(() => {
  'use strict';
  const RD = window.__rd, LC = window.LightweightCharts;
  if (!RD || !LC) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const { fp, pct, esc, coin, fv, ic, phone, hexA, nowT, fetchSpan, api, TF, RES, bucket, nextB, smcOpt, MIN, HOUR } = RD.util;
  const U = RD.U, R = RD.R, S = RD.S, COL = RD.COL, chartEl = RD.chartEl;
  const btn = $('[data-act="cmp"]');
  const C = Object.assign({ on: false, sym: 'ETHUSDT', tf: '', smc: true }, RD.store.get('rd-cmp-v1', {}),
    { bars: [], gen: 0, ws: null, wsT: null, buf: [], bufEnd: 0, fetching: null, res: '1m', clock: 0, A: null, prec: 2, driver: 'main', hover: null, err: '' });
  const save = () => RD.store.set('rd-cmp-v1', { on: C.on, sym: C.sym, tf: C.tf, smc: C.smc });
  const ctf = () => C.tf || U.tf;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fpc = v => fp(v, C.prec);

  // ---- the pane
  const pane = document.createElement('div');
  pane.className = 'dk-cmp'; pane.hidden = true; pane.setAttribute('aria-label', 'Compare chart');
  pane.innerHTML = `<div class="cmp-bar">
    <button type="button" class="cmp-sym" data-cx="pick" aria-haspopup="dialog" title="Change the coin">${ic('search')}<b data-cmp-name></b></button>
    <select data-cmp-tf aria-label="Compare timeframe" title="Same as the main chart: both scroll and zoom together"><option value="">= Main</option>${Object.keys(TF).map(t => `<option value="${t}">${t}</option>`).join('')}</select>
    <button type="button" class="cmp-b" data-cx="smc" aria-pressed="false" title="SMC marks on this chart">SMC</button>
    <button type="button" class="cmp-b" data-cx="swap" title="Make this coin the main chart (the main coin comes here)">⇄</button>
    <button type="button" class="cmp-b" data-cx="x" aria-label="Close compare" title="Close compare">${ic('x')}</button>
  </div>
  <div class="cmp-legend" data-cmp-legend></div>
  <div class="cmp-canvas" data-cmp-canvas></div>
  <div class="cmp-msg" data-cmp-msg hidden></div>
  <div class="cmp-pick" data-cmp-pick hidden role="dialog" aria-label="Compare with">
    <div class="cmp-pin">${ic('search')}<input data-cmp-q placeholder="Coin — ETH, SOL, PEPE…" autocomplete="off" spellcheck="false" aria-label="Coin to compare"></div>
    <div class="cmp-chips" data-cmp-chips></div>
  </div>`;
  chartEl.appendChild(pane);
  const box = $('[data-cmp-canvas]', pane), msgEl = $('[data-cmp-msg]', pane), lgEl = $('[data-cmp-legend]', pane), pickEl = $('[data-cmp-pick]', pane), qEl = $('[data-cmp-q]', pane);
  const sumEl = document.createElement('div');
  sumEl.className = 'cmp-sum'; sumEl.hidden = true; sumEl.setAttribute('aria-live', 'polite');
  chartEl.appendChild(sumEl);

  let ch = null, cs = null, vs = null, mk = null;
  function make() {
    if (ch) return;
    ch = LC.createChart(box, {
      autoSize: true,
      layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted, fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace", fontSize: 11 },
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      crosshair: { mode: LC.CrosshairMode.Normal, vertLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') }, horzLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') } },
      rightPriceScale: { borderColor: css('--dk-line'), scaleMargins: { top: 0.12, bottom: 0.18 } },
      timeScale: { borderColor: css('--dk-line'), timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 8, minBarSpacing: 1 },
    });
    cs = ch.addSeries(LC.CandlestickSeries, Object.assign(RD.candleOpts(), { priceLineStyle: LC.LineStyle.Dashed }));
    vs = ch.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    ch.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    mk = typeof LC.createSeriesMarkers === 'function' ? LC.createSeriesMarkers(cs, []) : null;
    cs.attachPrimitive(prim);
    // scroll / zoom / crosshair follow whichever chart the pointer is on
    for (const [el, who] of [[box, 'cmp'], [RD.box, 'main']]) for (const ev of ['pointerenter', 'pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, () => { C.driver = who; }, { passive: true });
    RD.chart.timeScale().subscribeVisibleTimeRangeChange(r => { if (C.on && !C.tf && C.driver === 'main' && r && C.bars.length) try { ch.timeScale().setVisibleRange(r); } catch (e) { /* not drawn yet */ } });
    ch.timeScale().subscribeVisibleTimeRangeChange(r => { if (C.on && !C.tf && C.driver === 'cmp' && r && S.bars.length) try { RD.chart.timeScale().setVisibleRange(r); } catch (e) { /* not drawn yet */ } });
    RD.chart.subscribeCrosshairMove(p => {
      if (!C.on || C.driver !== 'main') return;
      if (!p || p.time == null) { ch.clearCrosshairPosition(); C.hover = null; legend(); return; }
      const b = at(C.bars, bucket(p.time * 1000, ctf()));
      if (b) { ch.setCrosshairPosition(b[4], b[0] / 1000, cs); C.hover = b; } else { ch.clearCrosshairPosition(); C.hover = null; }
      legend();
    });
    ch.subscribeCrosshairMove(p => {
      if (!C.on || C.driver !== 'cmp') return;
      if (!p || p.time == null) { C.hover = null; RD.chart.clearCrosshairPosition(); legend(); return; }
      C.hover = at(C.bars, p.time * 1000);
      const mb = at(S.bars, bucket(p.time * 1000, U.tf));
      if (mb) RD.chart.setCrosshairPosition(mb[4], mb[0] / 1000, RD.cs); else RD.chart.clearCrosshairPosition();
      legend();
    });
  }
  const at = (B, t) => { let lo = 0, hi = B.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m][0] <= t) lo = m; else hi = m - 1; } return B[lo] && B[lo][0] === t ? B[lo] : null; };
  const toC = b => ({ time: b[0] / 1000, open: b[1], high: b[2], low: b[3], close: b[4] });
  const toV = b => ({ time: b[0] / 1000, value: b[5], color: RD.volColor(b[4] >= b[1]) });
  function theme() {
    if (!ch) return;
    ch.applyOptions({ layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted }, grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      crosshair: { vertLine: { labelBackgroundColor: css('--panel-3') }, horzLine: { labelBackgroundColor: css('--panel-3') } }, rightPriceScale: { borderColor: css('--dk-line') }, timeScale: { borderColor: css('--dk-line') } });
    cs.applyOptions(RD.candleOpts());
    if (C.bars.length) vs.setData(C.bars.map(toV));
    marks(); prim.req();
  }
  const say = t => { msgEl.innerHTML = t; msgEl.hidden = !t; };

  // ---- data: live = the exchange's candles + its stream · replay = history before the clock's candle, then closed finer
  // candles (1m up to 1H, like the main replay) revealed only as the main clock passes them
  const guessPrec = px => Math.max(0, Math.min(8, 5 - Math.floor(Math.log10(Math.max(px, 1e-9)))));
  function stopWs() { if (C.ws) { C.ws.close(); C.ws = null; } }
  function startWs(g) {   // the shared live feed reconnects and catches up by itself (REST check behind the socket)
    stopWs();
    let h; try { h = api(C.ex).stream(C.sym, ctf(), onK, { last: C.bars[C.bars.length - 1], gap: () => { if (g === C.gen && !R.on && C.on) load(); } }); } catch (e) { return; }
    C.ws = h;
  }
  function onK(k) {
    if (R.on || !C.on) return;
    const B = C.bars, last = B[B.length - 1]; if (!last) return;
    if (k[0] === last[0]) B[B.length - 1] = k; else if (k[0] > last[0]) { B.push(k); smcSoon(); } else return;
    cs.update(toC(k)); vs.update(toV(k)); legendSoon();
  }
  async function load() {
    if (!C.on || !C.sym) return;
    make();
    const g = ++C.gen, tf = ctf(); stopWs();
    C.ex = U.ex; C.err = ''; C.A = null; C.hover = null; C.mode = '';
    $('[data-cmp-name]', pane).textContent = coin(C.sym);
    say(`<span class="spin-s"></span> Loading ${esc(coin(C.sym))} ${tf}…`);
    try {
      if (!R.on) {
        const ks = await api(C.ex).klines(C.sym, tf, { limit: 1000 });
        if (g !== C.gen) return;
        if (!ks.length) throw new Error('no candles');
        C.bars = ks;
      } else {
        const clock = nowT(), b0 = bucket(clock, tf);
        const hist = await api(C.ex).klines(C.sym, tf, { end: b0 - 1, limit: 1000 });
        if (g !== C.gen) return;
        C.bars = hist.filter(k => k[0] < b0); C.buf = []; C.bufEnd = b0; C.res = RD.util.resOf ? RD.util.resOf(tf, C.ex) : RES[tf]; C.fetching = null; C.clock = b0;
        await feed(clock + 120 * TF[C.res].ms, g);
        if (g !== C.gen) return;
        reveal(clock, true);
        if (!C.bars.length) throw new Error(`not listed yet at ${RD.util.tnice(clock)}`);
      }
      C.mode = R.on ? 'replay' : 'live';
      C.prec = guessPrec(C.bars[C.bars.length - 1][4]);
      cs.applyOptions({ priceFormat: { type: 'price', precision: C.prec, minMove: Math.pow(10, -C.prec) } });
      cs.setData(C.bars.map(toC)); vs.setData(C.bars.map(toV));
      fit(); say(''); smcRun(); legend();
      if (!R.on) startWs(g);
    } catch (e) {
      if (g !== C.gen) return;
      C.bars = []; cs.setData([]); vs.setData([]); C.err = e.message; marks(); prim.req(); legend();
      say(`<b>Could not load ${esc(coin(C.sym))}</b><span>${esc(e.message)}${/Invalid symbol|not exist|-1121|10001/i.test(e.message) ? ` — it may not be listed on ${esc(api(C.ex).name)}.` : ''}</span><button type="button" class="btn btn-secondary btn-sm" data-cx="pick">Pick another coin</button>`);
    }
  }
  function fit() {
    if (!C.bars.length) return;
    cs.priceScale().applyOptions({ autoScale: true });   // a new coin / timeframe re-fits the price axis (a drag up/down turns its auto-fit off)
    if (!C.tf) { const r = RD.chart.timeScale().getVisibleRange(); if (r) { try { ch.timeScale().setVisibleRange(r); return; } catch (e) { /* fall through */ } } }
    const n = C.bars.length; ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (phone() ? 90 : 160)), to: n + 10 });
  }
  function feed(until, g) {
    if (C.fetching) return C.fetching;
    C.fetching = (async () => {
      const lim = Math.floor(Date.now() / MIN) * MIN;
      while (g === C.gen && C.bufEnd < until && C.bufEnd < lim) {
        const rms = TF[C.res].ms, to = Math.min(C.bufEnd + 700 * rms, lim);
        const ks = await fetchSpan(C.sym, C.bufEnd, to, C.res, C.ex);
        if (g !== C.gen) return;
        for (const k of ks) if (k[0] >= C.bufEnd) C.buf.push(k);
        C.bufEnd = to;
      }
    })().finally(() => { C.fetching = null; });
    return C.fetching;
  }
  function reveal(clock, quiet) {   // closed feed candles up to the main clock go into the compare candles
    const tf = ctf(), B = C.bars; let from = Infinity;
    while (C.buf.length && C.buf[0][0] + C.buf[0][6] <= clock) {
      const k = C.buf.shift(), b = bucket(k[0], tf), last = B[B.length - 1];
      if (last && last[0] === b) { last[2] = Math.max(last[2], k[2]); last[3] = Math.min(last[3], k[3]); last[4] = k[4]; last[5] += k[5]; from = Math.min(from, B.length - 1); }
      else if (!last || b > last[0]) { B.push([b, k[1], k[2], k[3], k[4], k[5]]); from = Math.min(from, B.length - 1); }
    }
    C.clock = clock;
    if (!quiet && from !== Infinity) { for (let i = from; i < B.length; i++) { cs.update(toC(B[i])); vs.update(toV(B[i])); } smcSoon(); legendSoon(); }
    if (C.buf.length < 60 && R.on) { const g = C.gen; feed(clock + 300 * TF[C.res].ms, g).then(() => { if (g === C.gen && C.clock === clock && C.buf.length && C.buf[0][0] + C.buf[0][6] <= nowT()) reveal(nowT()); }).catch(() => { /* next tick retries */ }); }
  }

  // ---- SMC marks on the compare coin (closed candles only, like the main chart)
  let smcT = null;
  const smcSoon = () => { if (!C.smc || smcT) return; smcT = setTimeout(() => { smcT = null; smcRun(); }, R.playing ? 250 : 30); };
  function smcRun() {
    C.A = null;
    if (C.smc && window.SMC && C.bars.length) {
      const B = C.bars, tf = ctf(); let n = B.length; if (n && nextB(B[n - 1][0], tf) > nowT()) n--;
      const base = B.slice(Math.max(0, n - 500), n).map(b => [b[0], b[1], b[2], b[3], b[4], b[5]]);
      if (base.length >= 12) {
        const l = base[base.length - 1]; base.push([nextB(l[0], tf), l[4], l[4], l[4], l[4], 0]);
        try { C.A = window.SMC.analyze(base, base.length - 1, smcOpt(tf)); } catch (e) { C.A = null; }
      }
    }
    marks(); prim.req(); legend();
  }
  function marks() {
    if (!mk) return;
    const M = [], r = C.A, first = C.bars.length ? C.bars[0][0] : 0;
    if (r && C.smc) {
      for (const s of r.swings.slice(-30)) if (s.t >= first) M.push({ time: s.t / 1000, position: s.side === 'H' ? 'aboveBar' : 'belowBar', color: s.side === 'H' ? COL.down : COL.up, shape: 'circle', size: 0.4, text: s.label });
      for (const w of r.sweeps.slice(-5)) if (w.t >= first) M.push({ time: w.t / 1000, position: w.dir === -1 ? 'aboveBar' : 'belowBar', color: COL.warn, shape: w.dir === -1 ? 'arrowDown' : 'arrowUp', text: 'sweep' });
    }
    M.sort((a, b) => a.time - b.time); mk.setMarkers(M);
  }
  const prim = {
    _p: null, attached(p) { this._p = p; }, detached() { this._p = null; }, req() { if (this._p) this._p.requestUpdate(); }, updateAllViews() { /* drawn from state */ },
    paneViews() { return [{ zOrder: () => 'bottom', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => drawSMC(s.context, s.mediaSize.width)) }) }]; },
  };
  const tx = t => ch.timeScale().timeToCoordinate(t / 1000), py = p => cs.priceToCoordinate(p);
  function lab(g, text, x, y, color, align) {
    g.font = '600 10px "Geist Mono", ui-monospace, monospace'; const w = g.measureText(text).width;
    g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, align === 'right' ? x - w - 4 : align === 'center' ? x - w / 2 : x + 4, y);
  }
  function drawSMC(g, W) {
    const r = C.A; if (!r || !C.smc) return;
    for (const z of r.zones.filter(z => !z.broken).slice(-5)) {
      const x0 = tx(z.t), y0 = py(z.top), y1 = py(z.bot); if (x0 == null || y0 == null || y1 == null) continue;
      const c = z.type === 'demand' ? COL.up : COL.down;
      g.fillStyle = hexA(c, 0.11); g.fillRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      g.strokeStyle = hexA(c, 0.45); g.lineWidth = 1; g.strokeRect(x0, Math.min(y0, y1), W - x0, Math.abs(y1 - y0));
      lab(g, z.type === 'demand' ? 'Demand' : 'Supply', x0, Math.min(y0, y1) + 9, c);
    }
    for (const b of r.breaks.slice(-6)) {
      const x0 = tx(b.fromT), x1 = tx(b.t), y = py(b.p); if (x0 == null || x1 == null || y == null) continue;
      const c = b.dir === 1 ? COL.up : COL.down;
      g.strokeStyle = c; g.setLineDash([5, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]);
      lab(g, b.kind, (x0 + x1) / 2, y + (b.dir === 1 ? -9 : 9), c, 'center');
    }
  }

  // ---- legend + the 24 h read-out of both coins
  function day(B, clock) {   // last 24 h of candles before the clock: change and where the price sits in the high–low range
    let i = B.length - 1; while (i >= 0 && B[i][0] >= clock) i--;
    if (i < 0) return null;
    const end = i; let hi = -Infinity, lo = Infinity;
    for (; i >= 0 && B[i][0] >= clock - 24 * HOUR; i--) { hi = Math.max(hi, B[i][2]); lo = Math.min(lo, B[i][3]); }
    const s = Math.min(end, i + 1), open = B[s][1], c = B[end][4];
    return { chg: (c / open - 1) * 100, pos: hi > lo ? (c - lo) / (hi - lo) : 0.5, hrs: Math.max(1, Math.round((clock - B[s][0]) / HOUR)) };
  }
  let lgQ = false;
  const legendSoon = () => { if (lgQ) return; lgQ = true; requestAnimationFrame(() => { lgQ = false; legend(); }); };
  function legend() {
    if (!C.on) { sumEl.hidden = true; return; }
    const b = C.hover || C.bars[C.bars.length - 1];
    if (b) {
      const d = b[4] - b[1], cl = d >= 0 ? 'up' : 'down';
      lgEl.innerHTML = `<div class="l1"><b>${esc(coin(C.sym))}/USDT · ${ctf()}</b><span class="ohlc"><span><em>O</em>${fpc(b[1])}</span><span><em>H</em>${fpc(b[2])}</span><span><em>L</em>${fpc(b[3])}</span><span class="${cl}"><em>C</em>${fpc(b[4])}</span><span class="${cl}">${pct(d / b[1] * 100)}</span></span></div>` +
        (C.smc && C.A ? `<div class="l2"><span>SMC trend <b class="${C.A.trend === 1 ? 'up' : C.A.trend === -1 ? 'down' : ''}">${C.A.trend === 1 ? 'up' : C.A.trend === -1 ? 'down' : '—'}</b></span><span>Vol <b>${fv(b[5])}</b></span></div>` : '');
    } else lgEl.innerHTML = '';
    const clock = R.on ? nowT() : Date.now() + MIN, a = day(S.bars, clock), c = day(C.bars, clock);
    if (!a || !c) { sumEl.hidden = true; return; }
    const hrs = Math.min(a.hrs, c.hrs), lbl = hrs >= 24 ? '24h' : hrs + 'h';
    const diff = c.chg - a.chg, even = Math.abs(diff) < 0.25;
    const one = (s, d) => `<span class="cs-c"><b>${esc(coin(s))}</b> <span class="${d.chg >= 0 ? 'up' : 'down'}">${pct(d.chg)}</span><i class="cs-bar" title="Where the price sits in its ${lbl} high–low range"><i style="left:${Math.round(d.pos * 100)}%"></i></i><em>${Math.round(d.pos * 100)}% of range</em></span>`;
    sumEl.innerHTML = `<span class="cs-h">${lbl}</span>${one(U.sym, a)}${one(C.sym, c)}<span class="cs-v">${even ? 'about even' : `<b>${esc(coin(diff > 0 ? C.sym : U.sym))}</b> stronger`}</span>`;
    sumEl.hidden = false;
  }

  // ---- open / close / pick a coin
  function show(on) {
    C.on = on; save();
    pane.hidden = !on; chartEl.classList.toggle('cmp-on', on);
    if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('on', on); }
    $('[data-cx="smc"]', pane).setAttribute('aria-pressed', String(!!C.smc));
    $('[data-cmp-tf]', pane).value = C.tf;
    if (on) { if (S.bars.length) load(); } else { C.gen++; stopWs(); C.bars = []; sumEl.hidden = true; pickEl.hidden = true; if (ch) { cs.setData([]); vs.setData([]); } }
  }
  function norm(q) {
    q = String(q || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!q) return '';
    return /USDT$/.test(q) ? q : q + 'USDT';
  }
  function openPick() {
    const wl = RD.store.get('rd-wl-v1', null) || [];
    const list = Array.from(new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].concat(wl))).filter(s => s !== U.sym).slice(0, 14);
    $('[data-cmp-chips]', pane).innerHTML = list.map(s => `<button type="button" data-cs="${esc(s)}"${s === C.sym ? ' class="on"' : ''}>${esc(coin(s))}</button>`).join('');
    pickEl.hidden = false; qEl.value = ''; qEl.focus();
  }
  function choose(sym) {
    sym = norm(sym); if (!sym) return;
    pickEl.hidden = true;
    if (sym === U.sym) { RD.toast(`${coin(sym)} is already the main chart.`); return; }
    C.sym = sym; save(); load();
  }
  qEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); choose(qEl.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pickEl.hidden = true; }
  });
  document.addEventListener('pointerdown', e => { if (!pickEl.hidden && !pickEl.contains(e.target) && !e.target.closest('[data-cx="pick"]')) pickEl.hidden = true; }, true);
  pane.addEventListener('click', e => {
    const cs2 = e.target.closest('[data-cs]'); if (cs2) { choose(cs2.dataset.cs); return; }
    const b = e.target.closest('[data-cx]'); if (!b) return;
    const k = b.dataset.cx;
    if (k === 'x') show(false);
    else if (k === 'pick') { if (pickEl.hidden) openPick(); else pickEl.hidden = true; }
    else if (k === 'smc') { C.smc = !C.smc; save(); b.setAttribute('aria-pressed', String(C.smc)); smcRun(); if (C.smc && !window.SMC) RD.toast('The SMC overlay did not load. Reload the page.', 'down'); }
    else if (k === 'swap') { if (!C.bars.length) return; const other = C.sym; C.sym = U.sym; save(); RD.setSymbol(other); }
  });
  $('[data-cmp-tf]', pane).addEventListener('change', e => { C.tf = e.target.value; save(); load(); });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act="cmp"]'); if (!a) return;
    show(!C.on);
  });

  // ---- follow the main chart
  RD.on('load', () => { if (C.on) { if (C.sym === U.sym) { C.sym = U.sym === 'BTCUSDT' ? 'ETHUSDT' : 'BTCUSDT'; save(); } load(); } });
  RD.on('tick', () => {
    if (!C.on || !C.bars.length) return;
    if (R.on && C.mode === 'replay' && nowT() > C.clock) reveal(nowT());
    legendSoon();
  });
  RD.on('theme', theme);
  // live ⇄ replay: drop what is on screen and any load still running at once — a live candle must never show in a replay,
  // even for the second until the main chart's replay is ready (its 'load' then loads this one again)
  RD.on('mode', () => {
    if (!C.on) return;
    C.gen++; stopWs(); C.mode = ''; C.bars = []; C.buf = []; C.A = null; C.hover = null;
    if (ch) { cs.setData([]); vs.setData([]); marks(); prim.req(); }
    sumEl.hidden = true; lgEl.innerHTML = ''; say(`<span class="spin-s"></span> Loading ${esc(coin(C.sym))}…`);
  });
  // the live feed checks itself when the tab comes back (fills the gap, reopens a dead socket)
  window.__rdCmp = { C, show, load };   // for tests
  if (C.on) show(true);
})();
