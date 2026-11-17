/* Landing page demo: a scripted 5-minute replay on TradingView Lightweight Charts 5 — downtrend with equal lows →
   sweep under them (that candle is the demand zone) → change of character → pull-back to the zone top (paper long,
   stop under the sweep) → break of structure → 3R target. Seeded noise: the same picture every visit.
   Illustration only, not market data. Needs window.LightweightCharts (5.2.1). */
(function () {
  'use strict';
  var box = document.querySelector('[data-hero-chart]');
  var LC = window.LightweightCharts;
  if (!box || !LC) return;
  var stageEl = document.querySelector('[data-stage]'), balEl = document.querySelector('[data-bal]'), posEl = document.querySelector('[data-pos]');

  // ---- the script ----
  function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  var PATH = [[0, 64300], [6, 64420], [12, 64280], [18, 64390], [24, 64230], [28, 64330], [33, 64060], [35, 64150], [37, 64065], [39, 64125], [41, 64170],
    [46, 64380], [50, 64520], [55, 64330], [60, 64125], [64, 64200], [72, 64480], [76, 64570], [82, 64720], [90, 64880], [100, 64960], [110, 64860], [119, 64930]];
  function pathAt(i) {
    for (var k = 1; k < PATH.length; k++) { var a = PATH[k - 1], b = PATH[k]; if (i <= b[0]) return a[1] + (b[1] - a[1]) * (i - a[0]) / (b[0] - a[0]); }
    return PATH[PATH.length - 1][1];
  }
  var SWEEP = 40, N = 120, R_MULT = 3;
  function buildDemo() {
    var r = rng(20261116), t0 = Date.UTC(2026, 9, 14, 8, 0) / 1000, C = [], prev = PATH[0][1];
    for (var i = 0; i < N; i++) {
      var open = prev, close = pathAt(i + 1) + (r() - 0.5) * 36;
      if (i === SWEEP) { open = 64112; close = 64078; }
      var high = Math.max(open, close) + 4 + r() * 18, low = Math.min(open, close) - 4 - r() * 18;
      if (i === SWEEP) low = 63946;
      C.push({ time: t0 + i * 300, open: open, high: high, low: low, close: close });
      prev = close;
    }
    var zone = { top: C[SWEEP].open, bot: C[SWEEP].low };
    var lh = 24; for (i = 24; i <= 36; i++) if (C[i].high > C[lh].high) lh = i;
    var choch = SWEEP + 1; while (choch < N - 1 && C[choch].close <= C[lh].high) choch++;
    var entry = choch + 2; while (entry < N - 1 && C[entry].low > zone.top) entry++;
    var px = zone.top, stop = zone.bot - 26, target = px + (px - stop) * R_MULT;
    var hi = choch; for (i = choch; i < entry; i++) if (C[i].high > C[hi].high) hi = i;
    var bos = entry + 1; while (bos < N - 1 && C[bos].close <= C[hi].high) bos++;
    var exit = entry + 1; while (exit < N - 1 && C[exit].high < target) exit++;
    return { C: C, zone: zone, choch: choch, entry: entry, px: px, stop: stop, target: target, bos: bos, exit: exit };
  }
  var d = buildDemo(), C = d.C;

  // ---- side panel ----
  var money = function (v) { return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  function say(label, tone, pnlR, open, done) {
    if (stageEl) { stageEl.className = 'stage' + (tone ? ' t-' + tone : ''); stageEl.lastChild.textContent = label; }
    var pnl = pnlR == null ? 0 : pnlR * 100;   // $100 risk on the demo account
    if (balEl) balEl.textContent = money(10000 + (done ? pnl : 0) + (open ? pnl : 0));
    if (!posEl) return;
    if (!open && !done) { posEl.innerHTML = '<div class="muted">No position. Wait for the setup.</div>'; return; }
    posEl.innerHTML = '<div style="display:flex;justify-content:space-between"><span class="up" style="font-weight:600">LONG 5×</span><span class="mono">BTC</span></div>' +
      '<div class="pos-pnl ' + (pnl >= 0 ? 'up' : 'down') + '">' + (pnl >= 0 ? '+' : '−') + money(Math.abs(pnl)) + ' <span class="muted" style="font-size:11px;font-weight:400">' + (pnlR || 0).toFixed(2) + 'R</span></div>' +
      (done ? '<div class="up" style="margin-top:4px;font-size:11px">Closed at TP ✓</div>' : '');
  }

  // ---- chart ----
  var css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  var chart = LC.createChart(box, {
    autoSize: true,
    layout: { background: { type: LC.ColorType.Solid, color: 'transparent' }, textColor: css('--muted'), fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 10, attributionLogo: false },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: false, lockVisibleTimeRangeOnResize: true },
    crosshair: { mode: LC.CrosshairMode.Normal },
    handleScroll: false, handleScale: false,
  });
  var series = chart.addSeries(LC.CandlestickSeries, {
    upColor: css('--up'), downColor: css('--down'), borderVisible: false, wickUpColor: css('--up'), wickDownColor: css('--down'),
    priceFormat: { type: 'price', precision: 1, minMove: 0.1 }, lastValueVisible: true, priceLineVisible: false,
  });
  // the demand zone: a shaded box from the sweep candle to the right edge
  var zoneOn = false;
  var zonePrim = {
    attached: function (p) { this.p = p; }, detached: function () { this.p = null; },
    paneViews: function () {
      var self = this;
      return [{ zOrder: function () { return 'bottom'; }, renderer: function () { return { draw: function (target) {
        if (!zoneOn || !self.p) return;
        target.useMediaCoordinateSpace(function (s) {
          var g = s.context, x0 = self.p.chart.timeScale().timeToCoordinate(C[SWEEP].time), y0 = self.p.series.priceToCoordinate(d.zone.top), y1 = self.p.series.priceToCoordinate(d.zone.bot);
          if (x0 == null || y0 == null || y1 == null) return;
          g.fillStyle = 'rgba(22,199,132,0.14)'; g.fillRect(x0, y0, s.mediaSize.width - x0, y1 - y0);
          g.strokeStyle = 'rgba(22,199,132,0.55)'; g.lineWidth = 1; g.strokeRect(x0 + 0.5, y0 + 0.5, s.mediaSize.width - x0, y1 - y0);
          g.font = '500 10px Geist Mono, monospace'; g.fillStyle = 'rgba(22,199,132,0.75)'; g.fillText('DEMAND', x0 + 6, y0 + 12);
        });
      } }; } }];
    },
  };
  series.attachPrimitive(zonePrim);
  var markers = LC.createSeriesMarkers(series, []);
  var view = function () { chart.timeScale().setVisibleLogicalRange({ from: -1, to: C.length + 3 }); };
  var mk = function (i, pos, color, shape, text) { return { time: C[i].time, position: pos, color: css(color), shape: shape, text: text }; };
  var START = 34, i = START, lines = [], marks = [], timer = null, R = d.px - d.stop;

  function reset() {
    lines.forEach(function (l) { series.removePriceLine(l); }); lines = [];
    zoneOn = false; marks = []; markers.setMarkers([]);
    series.setData(C.slice(0, START)); view(); i = START;
    say('Replaying BTCUSDT 5m from 08:00 UTC', '', null, false, false);
  }
  function tick() {
    if (i >= C.length) { timer = setTimeout(function () { reset(); tick(); }, 2600); return; }
    series.update(C[i]);
    if (i === SWEEP) { marks.push(mk(i, 'belowBar', '--warn', 'arrowUp', 'Sweep')); say('Liquidity sweep under the range low', 'primary', null, false, false); }
    if (i === d.choch) { marks.push(mk(i, 'aboveBar', '--primary', 'circle', 'CHoCH')); zoneOn = true; say('Change of character ↑ — demand zone marked', 'primary', null, false, false); }
    if (i === d.entry) {
      lines.push(series.createPriceLine({ price: d.px, color: css('--primary'), lineWidth: 1, lineStyle: LC.LineStyle.Solid, title: 'Long' }));
      lines.push(series.createPriceLine({ price: d.stop, color: css('--down'), lineWidth: 1, lineStyle: LC.LineStyle.Dashed, title: 'Stop' }));
      lines.push(series.createPriceLine({ price: d.target, color: css('--up'), lineWidth: 1, lineStyle: LC.LineStyle.Dashed, title: 'TP ' + R_MULT + 'R' }));
      marks.push(mk(i, 'belowBar', '--up', 'arrowUp', 'Long'));
      say('Paper long from the demand zone', 'up', 0, true, false);
    }
    if (i > d.entry && i < d.exit) say(i >= d.bos ? 'Break of structure — trend confirmed' : 'Holding the long', 'up', (C[i].close - d.px) / R, true, false);
    if (i === d.bos) marks.push(mk(i, 'aboveBar', '--primary', 'circle', 'BOS'));
    if (i === d.exit) {
      marks.push(mk(i, 'aboveBar', '--up', 'arrowDown', 'TP +' + R_MULT + 'R'));
      lines.forEach(function (l) { series.removePriceLine(l); }); lines = [];
      say('Target hit · +' + R_MULT + 'R on paper', 'up', R_MULT, false, true);
    }
    markers.setMarkers(marks);
    i++;
    timer = setTimeout(tick, i === d.exit + 1 ? 900 : 230);
  }

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  reset();
  box.classList.add('ready');
  if (reduce) {   // no animation: the finished picture
    series.setData(C); view(); zoneOn = true;
    markers.setMarkers([mk(SWEEP, 'belowBar', '--warn', 'arrowUp', 'Sweep'), mk(d.choch, 'aboveBar', '--primary', 'circle', 'CHoCH'), mk(d.entry, 'belowBar', '--up', 'arrowUp', 'Long'),
      mk(d.bos, 'aboveBar', '--primary', 'circle', 'BOS'), mk(d.exit, 'aboveBar', '--up', 'arrowDown', 'TP +' + R_MULT + 'R')]);
    say('Target hit · +' + R_MULT + 'R on paper', 'up', R_MULT, false, true);
  } else {
    // play only while on screen (saves the phone's battery)
    var visible = true;
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) {
      var v = es[0].isIntersecting;
      if (v && !visible) { visible = true; if (!timer) tick(); } else if (!v && visible) { visible = false; clearTimeout(timer); timer = null; }
    }).observe(box);
    timer = setTimeout(tick, 700);
  }

  // follow the theme
  new MutationObserver(function () {
    chart.applyOptions({ layout: { textColor: css('--muted') }, grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } } });
    series.applyOptions({ upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down') });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
