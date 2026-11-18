/* ReplayDesk · A+ on the whole Watchlist (admin; Indicators → "Watch my Watchlist"). The server checks every coin each minute
   (src/collectors/aplusWatch.js) and messages Telegram, so alerts arrive with this page closed. While the page is open, this
   file asks the server for new alerts and rings here too, whatever chart is on screen, with a button that opens the coin. */
(function () {
  'use strict';
  const RD = window.__rd, AP = window.__rdAplus, root = document.querySelector('[data-awbox]');
  if (!RD || !AP || !root) return;
  const { U, R } = RD, X = RD.ext, u = RD.util;
  const POLL = 15000, MARK = 45 * 60000, API = '/api/aplus/watch';
  const $ = s => root.querySelector(s);
  const W = { cfg: null, status: null, last: 0, marks: {}, busy: false };

  const hm = t => new Date(t).toISOString().slice(11, 16);
  const coin = s => u.coin(s);
  const sameList = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  const listNow = () => RD.watchlist().slice(0, W.status ? W.status.max : 30);

  async function call(body) {
    const q = !body && W.last ? '?since=' + W.last : '';
    const r = await fetch(API + q, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error((j && j.error) || 'The server did not answer');
    return j;
  }

  // ---------------------------------------------------------------- open the coin an alert is about
  function openChart(ev) {
    if (R.on) RD.exitReplay();
    RD.setSymbol(ev.sym, ev.ex); RD.setTF(ev.tf);
    const box = document.querySelector('[data-ind="aplus"]');
    if (box && !box.checked) box.click();
    if (window.matchMedia('(max-width: 899px)').matches) RD.closeSheets();
  }
  // the chart is already reading this coin and timeframe: one alert, not two
  function onThisChart(ev) {
    if (ev.sym !== U.sym || ev.tf !== AP.stfNow() || !U.aplus || !U.aplusAlert || R.on || X.smcOff) return false;
    if (ev.stage === 3) { if (AP.seen != null && AP.seen >= ev.conf) return true; if (AP.seen != null) AP.seen = ev.conf; return false; }
    if (AP.armed === ev.key) return true;
    AP.armed = ev.key; AP.armedLeg = ev.leg; AP.armedAt = Math.floor(ev.at / 60000) * 60000;
    return false;
  }

  function onAlerts(list) {
    for (const ev of list) W.marks[ev.sym] = ev;
    RD.renderWatch();
    const news = list.filter(ev => !onThisChart(ev));
    if (!news.length) return;
    const top = [...news].sort((a, b) => b.stage - a.stage || b.id - a.id)[0], rest = news.filter(ev => ev !== top);
    const more = rest.length ? ` · also ${rest.slice(0, 3).map(ev => coin(ev.sym) + ' ' + ev.tf).join(', ')}${rest.length > 3 ? ` and ${rest.length - 3} more` : ''}` : '';
    AP.alertUser(top.stage, top.title, top.body + more, 'rd-aw-' + top.sym + '-' + top.tf + '-' + top.key, top.tone, () => openChart(top));
  }

  // ---------------------------------------------------------------- the Watchlist rows
  X.wlMark = s => {
    const ev = W.marks[s];
    if (!ev || !W.cfg || !W.cfg.on || Date.now() - ev.at > MARK) return '';
    const what = ev.stage === 3 ? 'triggered' : 'almost ready';
    return `<span class="wl-aw ${ev.tone}" data-awtf="${u.esc(ev.tf)}" title="A+ ${u.esc(ev.side)} ${what} on ${u.esc(ev.tf)} at ${hm(ev.at)} UTC">${ev.stage === 3 ? '🎯' : '🔔'} ${u.esc(ev.tf)}</span>`;
  };
  document.addEventListener('click', e => {
    const row = e.target.closest && e.target.closest('.wl-row'), ev = row && W.marks[row.dataset.s];
    if (!ev || !row.querySelector('.wl-aw')) return;
    e.stopPropagation(); openChart(ev);
  }, true);

  // ---------------------------------------------------------------- the Indicators rows
  function paint() {
    const c = W.cfg, s = W.status, on = !!(c && c.on), box = $('[data-aw="on"]'), rd = $('[data-aw="ready"]'), line = $('[data-awstat]'), sync = $('[data-awsync]');
    if (!c) { line.textContent = 'Could not reach the server.'; return; }
    box.checked = on; rd.checked = c.ready;
    root.querySelectorAll('[data-awpick]').forEach(b => b.classList.toggle('on', c.tfs.includes(b.dataset.awpick)));
    const mine = listNow(), differs = on && !sameList(mine, c.coins);
    let t = 'Every coin in your Watchlist, checked each minute by the server. Alerts reach Telegram even with this page closed.';
    if (on) {
      t = s.loaded < s.coins ? `Loading candles: ${s.loaded} of ${s.coins} coins…` : `Watching ${s.coins} coin${s.coins === 1 ? '' : 's'} on ${c.tfs.join(', ')}` + (s.at ? ` · checked ${hm(s.at)} UTC` : '');
      if (RD.watchlist().length > s.max) t += ` · first ${s.max} coins only`;
      if (s.missing.length) t += ` · no candles for ${s.missing.join(', ')}`;
      if (s.paused) t += ' · exchange busy, waiting a few minutes';
      if (s.sendErr) t += ` · ${s.sendErr}`;
    }
    line.textContent = t; line.classList.toggle('down', on && (!!s.sendErr || s.paused));
    sync.hidden = !differs;
    RD.legend();
  }
  function take(j) {
    W.cfg = j.cfg; W.status = j.status;
    const first = !W.last; W.last = j.last;
    if (!first && j.cfg.on && j.events.length) onAlerts(j.events);
    paint();
  }
  async function save(patch, okMsg) {
    if (W.busy) return; W.busy = true;
    try { take(await call(patch)); if (okMsg) RD.toast(okMsg, 'up'); } catch (e) { RD.toast('A+ Watchlist: ' + e.message, 'down'); paint(); } finally { W.busy = false; }
  }

  root.addEventListener('click', e => {
    const pick = e.target.closest('[data-awpick]');
    if (pick && W.cfg) {
      const tf = pick.dataset.awpick, set = W.cfg.tfs.includes(tf) ? W.cfg.tfs.filter(x => x !== tf) : W.cfg.tfs.concat(tf);
      if (!set.length) { RD.toast('Keep at least one timeframe.', 'down'); return; }
      save({ tfs: set });
    }
    if (e.target.closest('[data-awsync]')) save({ coins: listNow(), ex: U.ex }, '🔔 Now watching the Watchlist on this device.');
  });
  $('[data-aw="ready"]').addEventListener('change', e => save({ ready: e.target.checked }));
  $('[data-aw="on"]').addEventListener('change', e => {
    if (!e.target.checked) { AP.stopRing(); save({ on: false }, 'A+ Watchlist alerts are off.'); return; }
    const list = listNow();
    if (!list.length) { e.target.checked = false; RD.toast('Add coins to your Watchlist first.', 'down'); return; }
    AP.unlock();
    try { if ('Notification' in window && Notification.permission === 'default') { const p = Notification.requestPermission(); if (p && p.then) p.then(() => {}, () => {}); } } catch (err) { /* sound and Telegram still work */ }
    save({ on: true, coins: list, ex: U.ex }, `🔔 Watching ${list.length} coin${list.length === 1 ? '' : 's'}. Check Telegram for the first message.`);
  });

  // a coin starred or removed on this device is watched too
  let syncTimer = 0;
  RD.on('watchlist', () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { if (W.cfg && W.cfg.on && !sameList(listNow(), W.cfg.coins)) save({ coins: listNow() }); else paint(); }, 700);
  });

  // browsers keep a page silent until its first click
  document.addEventListener('click', () => { if (W.cfg && W.cfg.on) AP.unlock(); }, true);
  X.legend.push(() => (W.cfg && W.cfg.on && !AP.soundReady() && !(U.aplus && U.aplusAlert && !R.on) ? '<span class="down">🔇 Click the page once so Watchlist alerts can sound</span>' : ''));

  // ---------------------------------------------------------------- /app#chart=BTCUSDT/15m/binance (the Telegram link)
  function readLink() {
    const link = /^#chart=([^/]+)\/(5m|15m|1H|4H)\/(binance|bybit)$/.exec(location.hash);
    if (!link) return;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(() => openChart({ sym: decodeURIComponent(link[1]).toUpperCase(), tf: link[2], ex: link[3] }), 0);
  }
  readLink(); window.addEventListener('hashchange', readLink);   // the desk may already be open in this tab

  const poll = async () => { try { take(await call()); } catch (e) { if (!W.cfg) paint(); } };
  poll(); setInterval(poll, POLL);
  W.poll = poll; window.__rdWatch = W;   // for tests
})();
