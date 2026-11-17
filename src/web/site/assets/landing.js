/* Landing extras: live price ticker (exchange public data, straight from the browser), count-up stats, card spotlight
   that follows the pointer, and the product shot that tilts flat as it scrolls in. All optional: the page reads fine
   without any of it. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  // ---- live ticker ----
  var track = document.querySelector('[data-ticker]');
  var COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'SUI', 'LINK', 'AVAX', 'TON', 'ADA', 'PEPE'];
  function fmtPx(p) { return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 1 }) : p >= 1 ? p.toFixed(p >= 100 ? 2 : 3) : p.toPrecision(4); }
  function render(rows) {
    if (!track || !rows.length) return;
    var html = rows.map(function (r) {
      var up = r.chg >= 0;
      return '<span class="tk"><b>' + r.sym + '</b><span class="mono">' + fmtPx(r.px) + '</span><span class="mono ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '') + r.chg.toFixed(2) + '%</span></span>';
    }).join('');
    track.innerHTML = '<div class="tk-run">' + html + '</div><div class="tk-run" aria-hidden="true">' + html + '</div>';
    track.closest('.ticker').classList.add('on');
  }
  function binance() {
    return Promise.all(COINS.map(function (c) {
      var s = (c === 'PEPE' ? '1000PEPE' : c) + 'USDT';
      return fetch('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=' + s).then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) { return { sym: c, px: +d.lastPrice / (c === 'PEPE' ? 1000 : 1), chg: +d.priceChangePercent }; });
    }));
  }
  function bybit() {
    return Promise.all(COINS.map(function (c) {
      var s = (c === 'PEPE' ? '1000PEPE' : c) + 'USDT';
      return fetch('https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + s).then(function (r) { return r.json(); })
        .then(function (d) { var t = d.result.list[0]; return { sym: c, px: +t.lastPrice / (c === 'PEPE' ? 1000 : 1), chg: +t.price24hPcnt * 100 }; });
    }));
  }
  function load() { return binance().catch(bybit).then(render).catch(function () { /* no data: the strip stays hidden */ }); }
  if (track) { load(); setInterval(function () { if (!document.hidden) load(); }, 30000); }

  // ---- count-up stats ----
  var nums = $$('[data-count]');
  function run(el) {
    var end = +el.dataset.count, dec = +(el.dataset.dec || 0), pre = el.dataset.pre || '', suf = el.dataset.suf || '', t0 = null, dur = 1600;
    if (reduce) { el.textContent = pre + end.toFixed(dec) + suf; return; }
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = pre + (end * e).toFixed(dec) + suf;
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (nums.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } }); }, { threshold: 0.6 });
    nums.forEach(function (n) { io.observe(n); });
  } else nums.forEach(run);

  // ---- spotlight cards ----
  $$('.spot').forEach(function (c) {
    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty('--x', (e.clientX - r.left) + 'px');
      c.style.setProperty('--y', (e.clientY - r.top) + 'px');
    });
  });

  // ---- product shot: tilted back, flattens as it scrolls into view ----
  var shot = document.querySelector('[data-tilt]');
  if (shot && !reduce) {
    var tick = false;
    var upd = function () {
      tick = false;
      var r = shot.getBoundingClientRect(), vh = window.innerHeight;
      var k = Math.max(0, Math.min(1, (vh - r.top) / (vh * 0.75)));   // 0 = just below the fold, 1 = well in view
      shot.style.setProperty('--tilt', (14 * (1 - k)).toFixed(2) + 'deg');
      shot.style.setProperty('--lift', (1 - k).toFixed(3));
    };
    upd();
    window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
    window.addEventListener('resize', upd);
  }
})();
