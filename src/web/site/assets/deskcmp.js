/* ReplayDesk · Compare: a second chart beside the main one (below it on a phone) — "which one is stronger" (BTC vs ETH vs
   SOL), or the SAME coin on another timeframe for a top-down view (BTC 1m on the main chart, BTC 15m here). Candles come
   straight from the exchange like the main chart. It follows the main chart's clock both ways: in a replay it never shows a
   candle the main chart hasn't reached (the forming candle is built from closed finer candles only), and a step back on the
   main chart takes it back too. Same timeframe: scroll, zoom
   and crosshair move together; its own timeframe: own zoom, the crosshair still points at the same moment.
   Its own Indicators menu (volume, order flow, big trades, volume profile, EMAs, high / low, PDH / PDL, sessions, FVG, trend
   lines, SMC, POI, RD ▲ / ▼), separate from the main chart's ticks but drawn by the same code (RD.paint, RD.util.ofMake /
   btMake / vpMake, RD.rdMake), and a 24 h read-out of both coins: % change and where
   each sits in its 24 h high–low range. */
(() => {
  'use strict';
  const RD = window.__rd, LC = window.LightweightCharts;
  if (!RD || !LC) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const { fp, pct, esc, coin, fv, ic, phone, hexA, nowT, fetchSpan, api, TF, RES, bucket, nextB, smcOpt, MIN, HOUR, tshort, WEEK,
    fvgScan, tlSnap, tlAfterOn, tlTop, t2lOf, l2xOf, emaOf, EMAS, ofMake, btMake, vpMake, rsiMake, paneLayout, poiList, poiWhy, VMA } = RD.util;
  const U = RD.U, R = RD.R, S = RD.S, COL = RD.COL, chartEl = RD.chartEl, PAINT = RD.paint, TLF = RD.TLF;
  const btn = $('[data-act="cmp"]');
  const C = Object.assign({ on: false, sym: 'ETHUSDT', tf: '', smc: true, ind: null }, RD.store.get('rd-cmp-v1', {}),
    { bars: [], gen: 0, ws: null, wsT: null, hist: [], fine: [], fi: 0, b0: 0, bufEnd: 0, fetching: null, res: '1m', clock: 0, A: null, F: null, TL: null, tlsn: null, pd: null, ema: {},
      key: '', prec: 2, driver: 'main', hover: null, hp: null, err: '', P: null, rd: null });
  // this chart's own indicator ticks (older saves had one SMC switch: it becomes SMC + CHoCH + BOS)
  const I = Object.assign({ vol: true, ema20: false, ema50: false, ema200: false, hilo: false, pdhl: false, sess: false, fvg: false, tline: false, tlineHtf: true, smc: false, choch: false, bos: false, eq: false, liq: false, zz: false, volMa: true, volHi: true, of: false, cvd: true, ofAbs: false, rsi: false, bt: false, vp: false, kpoi: false, poi: false, ob: false },
    C.ind && typeof C.ind === 'object' ? C.ind : { smc: C.smc !== false, choch: C.smc !== false, bos: C.smc !== false });
  if (C.ind && typeof C.ind === 'object' && !('eq' in C.ind)) I.eq = !!I.smc;   // saved before EQH / EQL had a tick: SMC drew them
  C.ind = I;
  const save = () => RD.store.set('rd-cmp-v1', { on: C.on, sym: C.sym, tf: C.tf, ind: I });
  const smcAny = () => !!(I.smc || I.choch || I.bos || I.eq || I.liq || I.zz || I.ob || I.kpoi);
  const ctf = () => C.tf || U.tf;
  const same = () => C.sym === U.sym;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fpc = v => fp(v, C.prec);
  // the main chart's timeframe → the one above it, for a top-down view of the same coin
  const UP = { '1m': '15m', '5m': '1H', '15m': '4H', '30m': '4H', '1H': '4H', '4H': '1D', '1D': '1W', '1W': '1M' };

  // ---- the pane
  const ROWS = [
    ['vol', 'Volume'],
    ['volMa', 'Average volume line (20 candles)', 'A line over the volume bars: the average volume of the last 20 candles.', 'sub'],
    ['volHi', 'Brighter bars at 2× the average or more', 'A bar with at least twice the average volume of the 20 candles before it is drawn brighter.', 'sub'],
    ['of', 'Order flow (delta)', 'Market buys − market sells in each candle, as bars in a pane under this chart (Binance candles; a Bybit chart borrows the same coin\'s Binance flow). Not for FX.'],
    ['cvd', 'CVD line', 'The deltas added up from the first loaded candle, in a pane of its own: read its slope, not its level.', 'sub'],
    ['ofAbs', 'Absorption marks', 'Heavy one-sided market orders (delta at least twice the average) on a candle that still closed the other way. Closed candles only.', 'sub'],
    ['rsi', 'RSI (14)', 'RSI (Relative Strength Index, 14 candles, Wilder\'s smoothing): the size of the recent up-closes against the down-closes, from 0 to 100, as a line in a pane under the chart. Above 70 = stretched up (“overbought”), below 30 = stretched down (“oversold”), 50 = balanced. A reading of the move, not a signal on its own: a stretched RSI can stay stretched in a strong move.'],
    ['bt', 'Big trades (bubbles)', 'Single market orders as circles where they traded: green = market buy, red = market sell, bigger = bigger order. Past days from the exchange\'s daily trade file, today from our server\'s recording and the live trades. Size: the main chart\'s setting (Indicators → Big trades → Size).'],
    ['vp', 'Volume profile', 'How much traded at each price, as rows; POC = the fullest row, VAH / VAL = the 70% value area. Range: the main chart\'s setting (candles in view or each day).'],
    ['ema20', 'EMA 20'], ['ema50', 'EMA 50'], ['ema200', 'EMA 200'],
    ['hilo', 'High / low of the candles in view'],
    ['pdhl', 'Previous day high / low (PDH / PDL)', 'Yesterday\'s high and low (UTC days) of this chart\'s coin. In a replay: the day before the replay clock. Not shown on 1W / 1M.'],
    ['sess', 'Sessions (Asia, London, New York)', 'Session open / close lines with the main chart\'s session settings (Indicators → Sessions: which sessions, their times, shading). Shown on 1m–4H.'],
    ['ob', 'Order blocks (OB)', 'The last candle against the move that broke structure: blue bull, pink bear. 15 candles long like the FVG boxes, shorter when tapped (dashed) or broken. Overlapping ones drawn as one. Closed candles only.'],
    ['kpoi', 'POI: graded order blocks', 'The untouched order blocks nearest the price (two each side), each graded out of 5 with this chart\'s next slower timeframe (trend, premium / discount, FVG, took liquidity, inducement). Hover the grade in the legend for the ticks.'],
    ['fvg', 'Fair value gaps (FVG)', 'Three candles where the first and third don\'t overlap. Green = gap below price, orange = gap above. Closed candles only.'],
    ['tline', 'Trend lines (auto, frozen when drawn)', 'Drawn once when switched on, then kept while price moves: a × marks the first close through a line, hollow dots new touches. Redraw now (in this chart\'s legend) draws them again. The main chart\'s top-down option shows the lines drawn here.'],
    ['tlineHtf', 'Also show higher-timeframe lines (top-down)', 'Lines drawn on a higher timeframe of this coin, on either chart, tagged with their timeframe.', 'sub'],
    'hr',
    ['smc', 'SMC: swing points, zones, liquidity', 'Swing labels, sweeps and supply / demand zones. On also ticks CHoCH, BOS, equal highs / lows and liquidity; off clears all five.'],
    ['choch', 'CHoCH: change of character'], ['bos', 'BOS: break of structure'],
    ['eq', 'Equal highs / lows (EQH / EQL)', 'Two swing highs (or lows) at about the same price: stops rest just past them. The main chart\'s "keep after price takes them" setting applies.'],
    ['liq', 'Liquidity: BSL / SSL and sweeps', 'Untaken swing highs (buy-side) and lows (sell-side), where stops rest, and where a wick swept one and closed back.'],
    ['poi', 'RD ▲ / ▼ signal', 'Our own version of the 15m-gap → 1m-CHoCH buy / sell, on this chart\'s coin (1H charts and lower). Sessions: the main chart\'s All hours setting. No sound or replay pause from this chart. Practice: tested ≈ random.'],
    ['zz', 'ZigZag: swing points joined, HH / HL / LH / LL', 'The swing points joined into one line with HH / HL / LH / LL labels, and a dashed leg to the furthest price since the last swing.'],
  ];
  const pane = document.createElement('div');
  pane.className = 'dk-cmp'; pane.hidden = true; pane.setAttribute('aria-label', 'Compare chart');
  pane.innerHTML = `<div class="cmp-bar">
    <button type="button" class="cmp-sym" data-cx="pick" aria-haspopup="dialog" title="Change the coin (the main chart's coin too, on another timeframe)">${ic('search')}<b data-cmp-name></b></button>
    <select data-cmp-tf aria-label="Compare timeframe" title="= Main: same timeframe, both scroll and zoom together. Another timeframe: its own zoom, the crosshair still points at the same moment."><option value="">= Main</option>${Object.keys(TF).map(t => `<option value="${t}">${t}</option>`).join('')}</select>
    <button type="button" class="cmp-b cmp-indb" data-cx="ind" aria-expanded="false" aria-haspopup="dialog" title="Indicators on this chart (its own ticks: the main chart keeps its own)">${ic('activity')}<span>Indicators</span></button>
    <button type="button" class="cmp-b" data-cx="swap" title="Swap: this coin becomes the main chart (same coin: the two timeframes swap)">⇄</button>
    <button type="button" class="cmp-b" data-cx="x" aria-label="Close compare" title="Close compare">${ic('x')}</button>
  </div>
  <div class="cmp-legend" data-cmp-legend></div>
  <div class="cmp-canvas" data-cmp-canvas></div>
  <div class="cmp-msg" data-cmp-msg hidden></div>
  <div class="cmp-pick" data-cmp-pick hidden role="dialog" aria-label="Compare with">
    <div class="cmp-pin">${ic('search')}<input data-cmp-q placeholder="Coin — ETH, SOL, PEPE…" autocomplete="off" spellcheck="false" aria-label="Coin to compare"></div>
    <div class="cmp-chips" data-cmp-chips></div>
  </div>
  <div class="dk-pop cmp-ipop" data-cmp-ipop hidden role="dialog" aria-label="Indicators on the compare chart">
    <div class="cmp-ihd"><b>On this chart</b><button type="button" class="cmp-same" data-cx="indmain" title="Tick the same indicators as the main chart has now">Same as main</button></div>
    ${ROWS.map(r => r === 'hr' ? '<hr>' : `<label${r[3] ? ' class="dk-sub"' : ''}${r[2] ? ` title="${esc(r[2])}"` : ''}><input type="checkbox" data-ci="${r[0]}"> ${esc(r[1])}</label>`).join('')}
    <p>Its own ticks: the main chart keeps its own. FVG, trend lines and SMC read closed candles only, so in a replay nothing sees past the clock.</p>
  </div>`;
  chartEl.appendChild(pane);
  const box = $('[data-cmp-canvas]', pane), msgEl = $('[data-cmp-msg]', pane), lgEl = $('[data-cmp-legend]', pane), pickEl = $('[data-cmp-pick]', pane), qEl = $('[data-cmp-q]', pane);
  const ipop = $('[data-cmp-ipop]', pane), indB = $('[data-cx="ind"]', pane);
  const sumEl = document.createElement('div');
  sumEl.className = 'cmp-sum'; sumEl.hidden = true; sumEl.setAttribute('aria-live', 'polite');
  chartEl.appendChild(sumEl);

  let ch = null, cs = null, vs = null, vma = null, mk = null, OFc = null, BTc = null, VPc = null, RSIc = null; const es = {};
  // the panes under this chart in a fixed order (delta, CVD, RSI)
  function cLayout() { if (ch) paneLayout(ch, (OFc ? OFc.series() : []).concat(RSIc ? RSIc.series() : [])); }
  function make() {
    if (ch) return;
    ch = LC.createChart(box, {
      autoSize: true,
      layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted, fontFamily: "'Geist Mono', ui-monospace, Menlo, monospace", fontSize: 11, attributionLogo: false },   // the page credits TradingView once (data-credit)
      grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      crosshair: { mode: LC.CrosshairMode.Normal, vertLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') }, horzLine: { style: LC.LineStyle.Dashed, labelBackgroundColor: css('--panel-3') } },
      rightPriceScale: { borderColor: css('--dk-line'), scaleMargins: { top: 0.12, bottom: I.vol ? 0.18 : 0.06 } },
      timeScale: { borderColor: css('--dk-line'), timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 8, minBarSpacing: 1 },
    });
    cs = ch.addSeries(LC.CandlestickSeries, Object.assign(RD.candleOpts(), { priceLineStyle: LC.LineStyle.Dashed }));
    vs = ch.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    ch.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    vma = ch.addSeries(LC.LineSeries, { priceScaleId: 'vol', color: 'rgba(160,168,184,.85)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const host = { chart: ch, box, bars: () => C.bars, tf: ctf, ex: () => C.ex, sym: () => C.sym, replay: () => R.on, clock: () => R.clock, now: () => nowT(), legend: () => legendSoon(), p2y, t2l, fp: fpc };
    OFc = ofMake(Object.assign({}, host, { ind: () => ({ of: I.of && C.on, cvd: I.cvd, ofAbs: I.ofAbs }), marks: () => marks(), layout: () => cLayout() }));
    RSIc = rsiMake(Object.assign({}, host, { ind: () => ({ rsi: I.rsi && C.on }), layout: () => cLayout() }));
    BTc = btMake(Object.assign({}, host, { ind: () => ({ bt: I.bt && C.on, btMin: U.btMin }), req: () => prim.req(), hover: () => C.hp, exName: () => api(C.ex).name }));
    VPc = vpMake(Object.assign({}, host, { ind: () => ({ vpMode: U.vpMode }), vb: b => OFc.vb(b) }));
    for (const k in EMAS) es[k] = ch.addSeries(LC.LineSeries, { color: EMAS[k][1], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: !!I[k] });
    mk = typeof LC.createSeriesMarkers === 'function' ? LC.createSeriesMarkers(cs, []) : null;
    cs.attachPrimitive(prim);
    // scroll / zoom / crosshair follow whichever chart the pointer is on
    for (const [el, who] of [[box, 'cmp'], [RD.box, 'main']]) for (const ev of ['pointerenter', 'pointerdown', 'wheel', 'touchstart']) el.addEventListener(ev, () => { C.driver = who; }, { passive: true });
    RD.chart.timeScale().subscribeVisibleTimeRangeChange(r => { if (C.on && !C.tf && C.driver === 'main' && r && C.bars.length) try { ch.timeScale().setVisibleRange(r); } catch (e) { /* not drawn yet */ } });
    ch.timeScale().subscribeVisibleTimeRangeChange(r => { if (C.on && !C.tf && C.driver === 'cmp' && r && S.bars.length) try { RD.chart.timeScale().setVisibleRange(r); } catch (e) { /* not drawn yet */ } });
    RD.chart.subscribeCrosshairMove(p => {
      if (!C.on || C.driver !== 'main') return;
      C.hp = null;
      if (!p || p.time == null) { ch.clearCrosshairPosition(); C.hover = null; legend(); return; }
      const b = at(C.bars, bucket(p.time * 1000, ctf()));
      if (b) { ch.setCrosshairPosition(b[4], b[0] / 1000, cs); C.hover = b; } else { ch.clearCrosshairPosition(); C.hover = null; }
      legend();
    });
    ch.subscribeCrosshairMove(p => {
      if (!C.on || C.driver !== 'cmp') return;
      C.hp = p && p.point ? { x: p.point.x, y: p.point.y } : null;
      if (!p || p.time == null) { C.hover = null; RD.chart.clearCrosshairPosition(); legend(); return; }
      C.hover = at(C.bars, p.time * 1000);
      const mb = at(S.bars, bucket(p.time * 1000, U.tf));
      if (mb) RD.chart.setCrosshairPosition(mb[4], mb[0] / 1000, RD.cs); else RD.chart.clearCrosshairPosition();
      legend();
    });
  }
  const at = (B, t) => { let lo = 0, hi = B.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (B[m][0] <= t) lo = m; else hi = m - 1; } return B[lo] && B[lo][0] === t ? B[lo] : null; };
  const toC = b => ({ time: b[0] / 1000, open: b[1], high: b[2], low: b[3], close: b[4] });
  // average volume of the VMA candles ending at i (incl) or just before it (a spike is judged against the candles before it)
  const volAvg = (i, incl) => { const e = incl ? i : i - 1, s0 = e - VMA + 1; if (s0 < 0 || e >= C.bars.length) return null; let t = 0; for (let j = s0; j <= e; j++) t += C.bars[j][5]; return t / VMA; };
  const toV = (b, i) => { const a = I.volHi && i != null ? volAvg(i, false) : null; return { time: b[0] / 1000, value: b[5], color: RD.volColor(b[4] >= b[1], a != null && a > 0 && b[5] >= 2 * a) }; };
  const vmaOn = () => I.vol && I.volMa && C.ex !== 'fx';
  // one candle changed (live tick, replay step): volume bar, average line, order flow
  function volUpd(i) {
    const b = C.bars[i]; if (!b) return;
    if (I.vol) { vs.update(toV(b, i)); if (vmaOn() && i >= VMA - 1) vma.update({ time: b[0] / 1000, value: volAvg(i, true) }); }
    OFc.upd(i);
    if (RSIc) RSIc.upd(i);
  }
  // this chart's time → x and price → y (between candles too), for the shared painters
  const t2l = t => t2lOf(C.bars, TF[ctf()].ms, t);
  const t2x = t => (ch ? l2xOf(ch.timeScale(), t2l(t)) : null);
  const p2y = p => cs.priceToCoordinate(p);
  function theme() {
    if (!ch) return;
    ch.applyOptions({ layout: { background: { type: LC.ColorType.Solid, color: COL.bg }, textColor: COL.muted }, grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
      crosshair: { vertLine: { labelBackgroundColor: css('--panel-3') }, horzLine: { labelBackgroundColor: css('--panel-3') } }, rightPriceScale: { borderColor: css('--dk-line') }, timeScale: { borderColor: css('--dk-line') } });
    cs.applyOptions(RD.candleOpts());
    if (C.bars.length) setVol();
    marks(); prim.req();
  }
  const say = t => { msgEl.innerHTML = t; msgEl.hidden = !t; };
  // volume + EMAs from this chart's candles (its own ticks)
  function setVol() {
    if (!ch) return;
    vs.setData(I.vol && C.bars.length ? C.bars.map(toV) : []);
    const L = []; if (vmaOn()) for (let i = VMA - 1; i < C.bars.length; i++) L.push({ time: C.bars[i][0] / 1000, value: volAvg(i, true) });
    vma.setData(L);
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: I.vol ? 0.18 : 0.06 } });
    OFc.set();
    if (RSIc) RSIc.set();
  }
  function setEMAs() { if (!ch) return; for (const k in EMAS) { C.ema[k] = I[k] && C.bars.length ? emaOf(C.bars, EMAS[k][0]) : []; es[k].applyOptions({ visible: !!I[k] }); es[k].setData(C.ema[k]); } }
  function emaLast() { for (const k in EMAS) if (I[k] && C.bars.length) { const a = emaOf(C.bars, EMAS[k][0]); C.ema[k] = a; if (a.length) es[k].update(a[a.length - 1]); } }

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
    if (k[0] === last[0]) B[B.length - 1] = k; else if (k[0] > last[0]) { B.push(k); runSoon(); } else return;
    cs.update(toC(k)); volUpd(B.length - 1); emaLast(); legendSoon();
  }
  async function load() {
    if (!C.on || !C.sym) return;
    make();
    const g = ++C.gen, tf = ctf(); stopWs();
    C.ex = U.ex; C.err = ''; C.A = null; C.F = null; C.TL = null; C.key = ''; C.hover = null; C.mode = '';
    syncBar();
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
        C.hist = hist.filter(k => k[0] < b0); C.bars = C.hist.slice(); C.fine = []; C.fi = 0; C.b0 = b0; C.bufEnd = b0; C.res = RD.util.resOf ? RD.util.resOf(tf, C.ex) : RES[tf]; C.fetching = null; C.clock = b0;
        await feed(clock + 120 * TF[C.res].ms, g);
        if (g !== C.gen) return;
        reveal(clock, true);
        if (!C.bars.length) throw new Error(`not listed yet at ${RD.util.tnice(clock)}`);
      }
      C.mode = R.on ? 'replay' : 'live';
      C.key = C.ex + '|' + C.sym + '|' + tf;   // these candles are this coin + timeframe (frozen lines are kept per key)
      C.prec = guessPrec(C.bars[C.bars.length - 1][4]);
      cs.applyOptions({ priceFormat: { type: 'price', precision: C.prec, minMove: Math.pow(10, -C.prec) } });
      cs.setData(C.bars.map(toC)); setVol(); setEMAs(); BTc.set();
      fit(); say(''); indRun(); legend();
      if (!R.on) startWs(g);
      else if (nowT() !== C.clock) { const t = nowT(); if (t > C.clock) reveal(t); else rewind(t); }   // the clock moved while this loaded (steps are ignored until then)
    } catch (e) {
      if (g !== C.gen) return;
      C.bars = []; cs.setData([]); setVol(); setEMAs(); BTc.set(); C.err = e.message; marks(); prim.req(); legend();
      say(`<b>Could not load ${esc(coin(C.sym))}</b><span>${esc(e.message)}${/Invalid symbol|not exist|-1121|10001/i.test(e.message) ? ` — it may not be listed on ${esc(api(C.ex).name)}.` : ''}</span><button type="button" class="btn btn-secondary btn-sm" data-cx="pick">Pick another coin</button>`);
    }
  }
  function fit() {
    if (!C.bars.length) return;
    cs.priceScale().applyOptions({ autoScale: true });   // a new coin / timeframe re-fits the price axis (a drag up/down turns its auto-fit off)
    if (!C.tf) { const r = RD.chart.timeScale().getVisibleRange(); if (r) { try { ch.timeScale().setVisibleRange(r); return; } catch (e) { /* fall through */ } } }
    const n = C.bars.length; ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - (phone() ? 90 : 160)), to: n + 10 });
  }
  function feed(until, g) {   // one fetch at a time per load (a newer load never waits on an older one's fetch)
    if (C.fetching && C.fetching.g === g) return C.fetching.p;
    const p = (async () => {
      const lim = Math.floor(Date.now() / MIN) * MIN;
      while (g === C.gen && C.bufEnd < until && C.bufEnd < lim) {
        const rms = TF[C.res].ms, to = Math.min(C.bufEnd + 700 * rms, lim);
        const ks = await fetchSpan(C.sym, C.bufEnd, to, C.res, C.ex);
        if (g !== C.gen) return;
        for (const k of ks) if (k[0] >= C.bufEnd) C.fine.push(k);
        C.bufEnd = to;
      }
    })().finally(() => { if (C.fetching && C.fetching.p === p) C.fetching = null; });
    C.fetching = { g, p };
    return p;
  }
  // closed finer candles up to the main clock go into the compare candles. They stay in C.fine (C.fi = the next one not
  // shown yet), so a step back can build the chart again at the earlier clock.
  function reveal(clock, quiet) {
    const tf = ctf(), B = C.bars, F = C.fine; let from = Infinity;
    while (C.fi < F.length && F[C.fi][0] + F[C.fi][6] <= clock) {
      const k = F[C.fi++], b = bucket(k[0], tf), last = B[B.length - 1];
      if (last && last[0] === b) { last[2] = Math.max(last[2], k[2]); last[3] = Math.min(last[3], k[3]); last[4] = k[4]; last[5] += k[5]; last[7] = last[7] != null && k[7] != null ? last[7] + k[7] : null; from = Math.min(from, B.length - 1); }
      else if (!last || b > last[0]) { B.push([b, k[1], k[2], k[3], k[4], k[5], TF[tf].ms, k[7] != null ? k[7] : null]); from = Math.min(from, B.length - 1); }
    }
    C.clock = clock;
    if (!quiet && from !== Infinity) { for (let i = from; i < B.length; i++) { cs.update(toC(B[i])); volUpd(i); } if (Object.keys(EMAS).some(k => I[k])) setEMAs(); runSoon(); legendSoon(); }
    if (C.fine.length - C.fi < 60 && R.on) { const g = C.gen; feed(clock + 300 * TF[C.res].ms, g).then(() => { const k = C.fine[C.fi]; if (g === C.gen && C.clock === clock && k && k[0] + k[6] <= nowT()) reveal(nowT()); }).catch(() => { /* next tick retries */ }); }
  }
  // the main chart went back in time: the candles before this chart's first replay candle never change, the rest is built
  // again from the finer candles up to the new clock. Further back than that first candle: load again at the new clock.
  function rewind(clock) {
    if (clock < C.b0) { load(); return; }
    C.bars = C.hist.slice(); C.fi = 0; C.hover = null;
    reveal(clock, true);
    cs.setData(C.bars.map(toC)); setVol(); setEMAs(); indRun(); legend();
  }

  // ---- indicators that read the candles: FVG, frozen trend lines, SMC / CHoCH / BOS (closed candles only) and PDH / PDL
  let runT = null;
  const needRun = () => smcAny() || I.fvg || I.tline || I.pdhl || I.poi;
  // RD ▲ / ▼ for this chart's coin (deskpoi.js loads after this file: made on first use)
  const rdi = () => C.rd || (RD.rdMake ? (C.rd = RD.rdMake({ sym: () => C.sym, ex: () => C.ex, tf: ctf, on: () => !!I.poi && C.on && !!C.key, all: () => !!U.poiAll, loud: false,
    t2x, p2y, bars: () => C.bars, box, chart: ch, req: () => prim.req(), marks: () => marks(), legend: () => legendSoon(), fp: fpc })) : null);
  function rdLoad() { if (!ch) return; const r = I.poi ? rdi() : C.rd; if (r) r.load(); }
  setInterval(() => { if (C.on && I.poi && !R.on && !document.hidden) rdLoad(); }, 20000);   // live: new 1-minute closes between this chart's candles
  const runSoon = () => { if (!needRun() || runT) return; runT = setTimeout(() => { runT = null; indRun(); }, R.playing ? 250 : 30); };
  function indRun() {
    C.A = null; C.F = null; C.TL = null; C.P = null;
    const B = C.bars, tf = ctf(); let n = B.length; if (n && nextB(B[n - 1][0], tf) > nowT()) n--;
    const base = B.slice(Math.max(0, n - 500), n).map(b => [b[0], b[1], b[2], b[3], b[4], b[5]]);
    if (I.fvg && base.length >= 3) C.F = fvgScan(base, tf);
    if (I.tline && base.length >= 12 && C.key === C.ex + '|' + C.sym + '|' + tf) {
      // frozen like the main chart's, in the same store (per coin + timeframe): the main chart's top-down shows them
      const mode = R.on ? 'replay' : 'live', key = C.key;
      let sn = TLF[mode][key];
      if (!sn && C.tlsn && C.tlsn.key === key && C.tlsn.mode === mode) { sn = C.tlsn.sn; TLF[mode][key] = sn; if (mode === 'live') RD.tlSave(); }   // the main chart's "off" forgot them: this chart keeps its lines
      if (!sn || sn.at > nowT()) { sn = tlSnap(base, tf); TLF[mode][key] = sn; if (mode === 'live') RD.tlSave(); }
      C.tlsn = { key, mode, sn };
      C.TL = tlAfterOn(sn, B, tf, t2l); C.TL.at = sn.at;
      if (I.tlineHtf) C.TL.push(...tlTop(mode, key, B, TF[tf].ms, t2l));
    }
    if (smcAny() && window.SMC && base.length >= 12) {
      const l = base[base.length - 1]; base.push([nextB(l[0], tf), l[4], l[4], l[4], l[4], 0]);   // closes the last real candle
      try { C.A = window.SMC.analyze(base, base.length - 1, smcOpt(tf)); } catch (e) { C.A = null; }
      C.P = null; if (I.kpoi && C.A) try { C.P = poiList(base, C.A, tf); } catch (e) { C.P = null; }
    }
    rdLoad(); pdCheck(); marks(); prim.req(); legend();
  }
  // yesterday's daily candle of this chart's coin (a replay: the day before the replay clock), once a day per coin
  let PDB = '', PDF = { key: '', at: 0 };
  const pdKey = () => C.ex + '|' + C.sym + '|' + bucket(nowT(), '1D');
  const pdOK = () => I.pdhl && TF[ctf()].ms < WEEK && ctf() !== '1M';
  function pdCheck() {
    if (!C.on || !pdOK() || !C.sym) return;
    const d0 = bucket(nowT(), '1D'), key = C.ex + '|' + C.sym + '|' + d0;
    if ((C.pd && C.pd.key === key) || PDB === key || (PDF.key === key && Date.now() - PDF.at < 30e3)) return;
    PDB = key;
    api(C.ex).klines(C.sym, '1D', { end: d0 - 1, limit: 3 }).then(k => {
      if (PDB !== key) return; PDB = '';
      const p = (k || []).filter(c => c[0] < d0).pop();
      C.pd = p ? { key, t: p[0], h: p[2], l: p[3] } : { key, none: true };
      prim.req(); legend();
    }).catch(() => { if (PDB === key) { PDB = ''; PDF = { key, at: Date.now() }; } });
  }
  const pdNow = () => (pdOK() && C.pd && !C.pd.none && C.pd.key === pdKey() ? C.pd : null);
  function marks() {
    if (!mk) return;
    const M = [], r = C.A, first = C.bars.length ? C.bars[0][0] : 0;
    if (r && I.smc) {
      for (const s of r.swings.slice(-30)) if (s.t >= first) M.push({ time: s.t / 1000, position: s.side === 'H' ? 'aboveBar' : 'belowBar', color: s.side === 'H' ? COL.down : COL.up, shape: 'circle', size: 0.4, text: s.label });
      for (const w of r.sweeps.slice(-5)) if (w.t >= first) M.push({ time: w.t / 1000, position: w.dir === -1 ? 'aboveBar' : 'belowBar', color: COL.warn, shape: w.dir === -1 ? 'arrowDown' : 'arrowUp', text: 'sweep' });
    }
    if (OFc) { OFc.X.abs = OFc.abs(); for (const m of OFc.X.abs) if (m.t >= first) M.push({ time: m.t / 1000, position: m.side === 1 ? 'belowBar' : 'aboveBar', color: m.side === 1 ? COL.up : COL.down, shape: m.side === 1 ? 'arrowUp' : 'arrowDown', text: 'absorb' }); }
    if (I.poi && C.rd && C.bars.length) {   // RD ▲ / ▼ snapped to this chart's candle, never past the clock
      const last = C.bars[C.bars.length - 1][0], now = nowT(), tf = ctf();
      for (const m of C.rd.marks()) if (m.t >= first && m.t <= now && bucket(m.t, tf) <= last) M.push({ time: bucket(m.t, tf) / 1000, position: m.position, color: m.color, shape: m.shape, text: m.text });
    }
    M.sort((a, b) => a.time - b.time); mk.setMarkers(M);
  }
  // drawn with the main chart's painters on this chart's candles
  let DRAWN = {};
  const sctx = () => ({ bars: C.bars, tf: ctf(), t2x, p2y, ts: ch.timeScale(), H: () => box.clientHeight - ch.timeScale().height() });
  function paint(g, W, z) {
    if (!C.bars.length || !C.key) return;
    const one = f => { g.save(); try { f(); } catch (e) { console.error(e); } g.restore(); };
    if (z === 'bottom') {
      DRAWN = {};
      if (I.vp && C.ex !== 'fx') one(() => { VPc.draw(g, W); DRAWN.vp = !!VPc.X; });
      if (I.sess && RD.sessPaint) one(() => RD.sessPaint(g, W, 'bottom', sctx()));
      if (I.fvg && C.F) one(() => { DRAWN.fvg = PAINT.fvg(g, W, { ms: TF[ctf()].ms, list: C.F.filter(f => !f.filled).slice(-8), t2x, p2y }); });
      if (smcAny() && C.A) one(() => { DRAWN.smc = PAINT.smc(g, W, { r: C.A, all: false, smc: I.smc, taken: U.smcTaken, choch: I.choch, bos: I.bos, eq: I.eq, liq: I.liq, zz: I.zz, ob: I.ob, poi: I.kpoi ? C.P : null, bars: C.bars, t2x, p2y }); });
      if (I.poi && C.rd) one(() => C.rd.draw(g, W, 'bottom'));
    } else {
      if (I.hilo) one(() => { PAINT.hilo(g, W, { bars: C.bars, ts: ch.timeScale(), p2y, fp: fpc, covers: () => PAINT.covers(box, [$('.cmp-bar', pane), pickEl, ipop, sumEl], [lgEl]) }); DRAWN.hilo = true; });
      if (I.sess && RD.sessPaint) one(() => { DRAWN.sess = RD.sessPaint(g, W, 'top', sctx()); });
      if (I.tline && C.TL) one(() => { DRAWN.tl = PAINT.tl(g, W, { ts: ch.timeScale(), bars: C.bars, lines: C.TL, t2l, p2y, fp: fpc }); });
      const pd = pdNow(); if (pd) one(() => { PAINT.pd(g, W, { pd, t2x, p2y, fp: fpc }); DRAWN.pd = true; });
      if (I.bt && C.ex !== 'fx') one(() => { BTc.draw(g); DRAWN.bt = BTc.hits.length; }); else if (BTc.hits.length) BTc.clearHits();
      if (I.poi && C.rd) one(() => C.rd.draw(g, W, 'top'));
    }
  }
  const prim = {
    _p: null, attached(p) { this._p = p; }, detached() { this._p = null; }, req() { if (this._p) this._p.requestUpdate(); }, updateAllViews() { /* drawn from state */ },
    paneViews() { return VIEWS; },
  };
  const VIEWS = [
    { zOrder: () => 'bottom', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => paint(s.context, s.mediaSize.width, 'bottom')) }) },
    { zOrder: () => 'top', renderer: () => ({ draw: target => target.useMediaCoordinateSpace(s => paint(s.context, s.mediaSize.width, 'top')) }) },
  ];

  // ---- legend + the 24 h read-out of both coins
  function day(B, clock) {   // last 24 h of candles before the clock: change and where the price sits in the high–low range
    let i = B.length - 1; while (i >= 0 && B[i][0] >= clock) i--;
    if (i < 0) return null;
    const end = i; let hi = -Infinity, lo = Infinity;
    for (; i >= 0 && B[i][0] >= clock - 24 * HOUR; i--) { hi = Math.max(hi, B[i][2]); lo = Math.min(lo, B[i][3]); }
    const s = Math.min(end, i + 1), open = B[s][1], c = B[end][4];
    return { chg: (c / open - 1) * 100, pos: hi > lo ? (c - lo) / (hi - lo) : 0.5, hrs: Math.max(1, Math.round((clock - B[s][0]) / HOUR)) };
  }
  const emaAt = (k, t) => { const a = C.ema[k] || []; if (!a.length) return null; if (t == null) return a[a.length - 1].value; let lo = 0, hi = a.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m].time <= t) lo = m; else hi = m - 1; } return a[lo].time === t ? a[lo].value : null; };
  let lgQ = false;
  const legendSoon = () => { if (lgQ) return; lgQ = true; requestAnimationFrame(() => { lgQ = false; legend(); }); };
  function legend() {
    if (!C.on) { sumEl.hidden = true; return; }
    const b = C.hover || C.bars[C.bars.length - 1];
    if (b) {
      const d = b[4] - b[1], cl = d >= 0 ? 'up' : 'down', bits = [];
      for (const k in EMAS) if (I[k]) { const v = emaAt(k, C.hover ? C.hover[0] / 1000 : null); if (v != null) bits.push(`<span style="color:${EMAS[k][1]}">EMA ${EMAS[k][0]} <b>${fpc(v)}</b></span>`); }
      if (smcAny() && C.A) bits.push(`<span>SMC trend <b class="${C.A.trend === 1 ? 'up' : C.A.trend === -1 ? 'down' : ''}">${C.A.trend === 1 ? 'up' : C.A.trend === -1 ? 'down' : '—'}</b></span>`);
      const pd = pdNow(); if (pd) bits.push(`<span>PDH <b>${fpc(pd.h)}</b> · PDL <b>${fpc(pd.l)}</b></span>`);
      if (I.tline && C.TL) {
        const nb = C.TL.filter(l => l.liveBrk != null).length, ht = C.TL.filter(l => l.htf).length;
        bits.push(`<span>Trend lines drawn <b>${esc(tshort(C.TL.at))}</b>${ht ? ` · +${ht} higher tf` : ''}${nb ? ` · ${nb} broken since` : ''} <button type="button" class="cmp-lb" data-cx="tlredraw" title="Draw the lines again from the latest closed candles">Redraw now</button></span>`);
      }
      if (I.vol && C.ex !== 'fx') { const bi = C.bars.indexOf(b), av = bi >= 0 ? volAvg(bi, false) : null, x = av > 0 ? b[5] / av : null; bits.push(`<span>Vol <b>${fv(b[5])}</b>${x != null ? ` · <b class="${x >= 2 ? 'warn' : ''}">${x.toFixed(1)}×</b> avg` : ''}</span>`); }
      if (I.of) { const h = OFc.legend(b); if (h) bits.push(h); }
      if (I.rsi && RSIc) { const h = RSIc.legend(b); if (h) bits.push(h); }
      if (I.bt) bits.push(BTc.legend());
      if (I.vp) { const h = VPc.legend(); if (h) bits.push(h); }
      if (I.kpoi && C.P) {
        const one = (q, arrow) => q ? `<span title="${esc(poiWhy(q, C.P.htf))}">POI ${arrow} <b class="${q.d === 1 ? 'up' : 'down'}">${fpc(q.z.bot)}–${fpc(q.z.top)}</b> <b class="poi-g">${q.grade}/${q.of}</b></span>` : '';
        bits.push(one(C.P.up, '▼') + one(C.P.dn, '▲') || '<span>POI: no untouched order block</span>');
      }
      if (I.poi && C.rd) { const h = C.rd.legend(); if (h) bits.push(h); }
      lgEl.innerHTML = `<div class="l1"><b>${esc(coin(C.sym))}/USDT · ${ctf()}</b><span class="ohlc"><span><em>O</em>${fpc(b[1])}</span><span><em>H</em>${fpc(b[2])}</span><span><em>L</em>${fpc(b[3])}</span><span class="${cl}"><em>C</em>${fpc(b[4])}</span><span class="${cl}">${pct(d / b[1] * 100)}</span></span></div>` +
        (bits.length ? `<div class="l2">${bits.join('')}</div>` : '');
    } else lgEl.innerHTML = '';
    if (same()) { sumEl.hidden = true; return; }   // the same coin on two timeframes: nothing to compare
    const clock = R.on ? nowT() : Date.now() + MIN, a = day(S.bars, clock), c = day(C.bars, clock);
    if (!a || !c) { sumEl.hidden = true; return; }
    const hrs = Math.min(a.hrs, c.hrs), lbl = hrs >= 24 ? '24h' : hrs + 'h';
    const diff = c.chg - a.chg, even = Math.abs(diff) < 0.25;
    const one = (s, d) => `<span class="cs-c"><b>${esc(coin(s))}</b> <span class="${d.chg >= 0 ? 'up' : 'down'}">${pct(d.chg)}</span><i class="cs-bar" title="Where the price sits in its ${lbl} high–low range"><i style="left:${Math.round(d.pos * 100)}%"></i></i><em>${Math.round(d.pos * 100)}% of range</em></span>`;
    sumEl.innerHTML = `<span class="cs-h">${lbl}</span>${one(U.sym, a)}${one(C.sym, c)}<span class="cs-v">${even ? 'about even' : `<b>${esc(coin(diff > 0 ? C.sym : U.sym))}</b> stronger`}</span>`;
    sumEl.hidden = false;
  }

  // ---- open / close / pick a coin / indicators
  function syncBar() {
    $('[data-cmp-name]', pane).textContent = coin(C.sym);
    const sel = $('[data-cmp-tf]', pane); sel.value = C.tf; sel.options[0].textContent = `= Main (${U.tf})`;
    $$('[data-ci]', ipop).forEach(i => { i.checked = !!I[i.dataset.ci]; });
    const n = ROWS.filter(r => r !== 'hr' && !r[3] && I[r[0]]).length;
    indB.classList.toggle('has', n > 0); indB.title = `Indicators on this chart: ${n} on (its own ticks: the main chart keeps its own)`;
  }
  function show(on) {
    C.on = on; save();
    pane.hidden = !on; chartEl.classList.toggle('cmp-on', on);
    if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('on', on); }
    syncBar();
    if (on) { if (S.bars.length) load(); } else { C.gen++; stopWs(); C.bars = []; C.key = ''; C.P = null; sumEl.hidden = true; pickEl.hidden = true; indPop(false); if (ch) { cs.setData([]); setVol(); setEMAs(); BTc.set(); OFc.flowStop(); if (C.rd) C.rd.load(); marks(); prim.req(); } }
  }
  function norm(q) {
    q = String(q || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!q) return '';
    return /USDT$/.test(q) ? q : q + 'USDT';
  }
  function openPick() {
    indPop(false);
    const wl = RD.store.get('rd-wl-v1', null) || [];
    const list = Array.from(new Set([U.sym, 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'].concat(wl))).slice(0, 15);
    $('[data-cmp-chips]', pane).innerHTML = list.map(s => s === U.sym
      ? `<button type="button" data-cs="${esc(s)}" class="main${s === C.sym ? ' on' : ''}" title="The main chart's coin on another timeframe: a top-down view">${esc(coin(s))} · main</button>`
      : `<button type="button" data-cs="${esc(s)}"${s === C.sym ? ' class="on"' : ''}>${esc(coin(s))}</button>`).join('');
    pickEl.hidden = false; qEl.value = ''; qEl.focus();
  }
  function choose(sym) {
    sym = norm(sym); if (!sym) return;
    pickEl.hidden = true;
    // the main chart's coin on the main chart's timeframe would be the same chart twice: go one timeframe up (top-down)
    if (sym === U.sym && ctf() === U.tf && UP[U.tf]) { C.tf = UP[U.tf]; RD.toast(`${coin(sym)} ${C.tf} next to the main ${U.tf}: a top-down view. Change the timeframe in the box beside the coin.`); }
    C.sym = sym; save(); load();
  }
  function indPop(open) {
    ipop.hidden = !open; indB.setAttribute('aria-expanded', String(open));
    if (open) { pickEl.hidden = true; syncBar(); }
  }
  function apply(k) {
    if (k === 'vol' || k === 'volMa' || k === 'volHi' || k === 'of' || k === 'cvd' || k === 'rsi') setVol();
    else if (k === 'ofAbs') { if (OFc) { OFc.set(); marks(); } }   // before the chart is made: the ticks apply when it loads
    else if (k === 'bt') { if (BTc) BTc.set(); prim.req(); }
    else if (k === 'vp') prim.req();
    else if (k === 'poi') { rdLoad(); marks(); prim.req(); }
    else if (k in EMAS) setEMAs();
    else if (k === 'hilo' || k === 'sess') prim.req();
    else indRun();
    syncBar(); legend();
  }
  ipop.addEventListener('change', e => {
    const i = e.target.closest('[data-ci]'); if (!i) return;
    const k = i.dataset.ci; I[k] = i.checked;
    if (k === 'smc') { I.choch = I.smc; I.bos = I.smc; I.eq = I.smc; I.liq = I.smc; }
    if (k === 'tline' && !I.tline) forgetLines();
    save(); apply(k);
  });
  function forgetLines() {   // off / Redraw now: this chart's frozen lines go (the main chart's other coins / timeframes stay)
    const mode = R.on ? 'replay' : 'live';
    if (C.key && !(U.tline && C.key === U.ex + '|' + U.sym + '|' + U.tf)) { delete TLF[mode][C.key]; if (mode === 'live') RD.tlSave(); }
    C.tlsn = null;
  }
  qEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); choose(qEl.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pickEl.hidden = true; }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ipop.hidden) { e.stopPropagation(); indPop(false); } }, true);
  document.addEventListener('pointerdown', e => {
    if (!pickEl.hidden && !pickEl.contains(e.target) && !e.target.closest('[data-cx="pick"]')) pickEl.hidden = true;
    if (!ipop.hidden && !ipop.contains(e.target) && !e.target.closest('[data-cx="ind"]')) indPop(false);
  }, true);
  pane.addEventListener('click', e => {
    const cs2 = e.target.closest('[data-cs]'); if (cs2) { choose(cs2.dataset.cs); return; }
    const b = e.target.closest('[data-cx]'); if (!b) return;
    const k = b.dataset.cx;
    if (k === 'x') show(false);
    else if (k === 'pick') { if (pickEl.hidden) openPick(); else pickEl.hidden = true; }
    else if (k === 'ind') indPop(ipop.hidden);
    else if (k === 'indmain') {   // the main chart's ticks, copied once (each chart keeps its own after that)
      const ss = window.__rdSess && window.__rdSess.P;
      Object.assign(I, { vol: !!U.vol, ema20: !!U.ema20, ema50: !!U.ema50, ema200: !!U.ema200, hilo: !!U.hilo, pdhl: !!U.pdhl, sess: !!(ss && ss.on), fvg: !!U.smcFvg, tline: !!U.tline, tlineHtf: U.tlineHtf !== false, smc: !!U.smc, choch: !!U.choch, bos: !!U.bos, eq: !!U.eq, liq: !!U.liq, zz: !!U.zz, ob: !!U.ob,
        volMa: U.volMa !== false, volHi: U.volHi !== false, of: !!U.of, cvd: U.cvd !== false, ofAbs: !!U.ofAbs, rsi: !!U.rsi, bt: !!U.bt, vp: !!U.vp, kpoi: !!U.kpoi, poi: !!U.poi });
      save(); setVol(); setEMAs(); if (BTc) BTc.set(); indRun(); syncBar(); legend();
    }
    else if (k === 'tlredraw') {   // both charts show the same lines for one coin + timeframe: a redraw is for both
      const mode = R.on ? 'replay' : 'live'; C.tlsn = null; if (C.key) { delete TLF[mode][C.key]; if (mode === 'live') RD.tlSave(); } indRun();
    }
    else if (k === 'swap') {
      if (!C.bars.length) return;
      if (same()) {   // the same coin: the two timeframes swap
        const ct = ctf(); if (ct === U.tf) { RD.toast('Both charts show the same coin and timeframe: nothing to swap.'); return; }
        C.tf = U.tf; save(); RD.setTF(ct); return;
      }
      const other = C.sym; C.sym = U.sym; save(); RD.setSymbol(other);
    }
  });
  $('[data-cmp-tf]', pane).addEventListener('change', e => { C.tf = e.target.value; save(); load(); });
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-act="cmp"]'); if (!a) return;
    show(!C.on);
  });

  // ---- follow the main chart (its coin may be this one: then this is a top-down view of it)
  RD.on('load', () => { if (C.on) load(); else syncBar(); });
  RD.on('tick', () => {
    if (!C.on || !C.bars.length) return;
    if (R.on && C.mode === 'replay') { const t = nowT(); if (t > C.clock) reveal(t); else if (t < C.clock) rewind(t); }
    legendSoon();
  });
  RD.on('theme', theme);
  // live ⇄ replay: drop what is on screen and any load still running at once — a live candle must never show in a replay,
  // even for the second until the main chart's replay is ready (its 'load' then loads this one again)
  RD.on('mode', () => {
    if (!C.on) return;
    C.gen++; stopWs(); C.mode = ''; C.bars = []; C.hist = []; C.fine = []; C.fi = 0; C.A = null; C.F = null; C.TL = null; C.tlsn = null; C.key = ''; C.hover = null; C.P = null;
    if (ch) { cs.setData([]); setVol(); setEMAs(); BTc.set(); if (C.rd) C.rd.load(); marks(); prim.req(); }
    sumEl.hidden = true; lgEl.innerHTML = ''; say(`<span class="spin-s"></span> Loading ${esc(coin(C.sym))}…`);
  });
  window.__rdCmp = { C, I, show, load, indRun, choose, openPick, get DRAWN() { return DRAWN; }, get OF() { return OFc; }, get BT() { return BTc; }, get VP() { return VPc; }, get RDS() { return C.rd; }, get VMAD() { return vma ? vma.data() : []; }, get RSI() { return RSIc; } };   // for tests
  if (C.on) show(true); else syncBar();
})();
