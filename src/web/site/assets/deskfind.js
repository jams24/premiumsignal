/* ReplayDesk · Find setups (toolbar → "Find setups"): the classic simulator's coin scan on the desk. It loads each coin in the
   chosen list and reports where its A+ setup stands: triggered, or how many of the 4 steps are done (break · premium / discount ·
   sweep · 1m CHoCH). Same data and rules as the chart's A+ (deskaplus.js): 3 days of 1-minute candles plus 300 older structure
   candles, closed candles only, so a row opens on the chart as the same setup. Candles come straight from the exchange in this
   browser and are paced to stay inside its limits. Practice, not signals: these rules lost after fees in our test. */
(function () {
  'use strict';
  const RD = window.__rd, SMC = window.SMC, root = document.querySelector('[data-find]'), pill = document.querySelector('[data-act="find"]');
  if (!RD || !SMC || !root || !pill) return;
  const { U, R } = RD, u = RD.util, { MIN, DAY, TF, esc, coin, ic } = u;
  const admin = !!document.querySelector('.dk-admin');
  const DAYS = 3, HIST = 300, FRESH = 45 * MIN, TRIG = 90 * MIN, TOP_N = 50, SHOWN = 60, COOL = 3 * MIN, KEY = 'rd-find-v1';
  const STABLE = /^(USDC|FDUSD|TUSD|BUSD|USDP|DAI|USDE|RLUSD|USD1|XUSD|BFUSD|USTC)USDT$/;
  const TESTED = 'Practice, not signals. On the 207 coins our bot traded (14 Oct – 13 Nov 2026) these exact rules lost after fees: −0.18R a trade on 15m, −0.12R on 5m, no better than a random entry with the same stop and target.';
  const SCOPES = admin
    ? [['top', 'Top 50 by volume + signals 48h'], ['watch', 'My Watchlist'], ['recent', 'Coins traded in 30 days + signals 48h'], ['all', 'Every coin we traded + signals 48h'], ['alltop', 'Every coin we traded + top 50 + signals 48h'], ['signals', 'Bot signals 48h only']]
    : [['top', 'Top 50 by volume'], ['watch', 'My Watchlist']];
  const TFS = ['5m', '15m', '1H', '4H'];
  const saved = RD.store.get(KEY, null) || {};
  const F = {
    scope: SCOPES.some(s => s[0] === saved.scope) ? saved.scope : 'top',
    tf: TFS.includes(saved.tf) ? saved.tf : (TFS.includes(U.tf) ? U.tf : '15m'),
    side: ['all', 'long', 'short', 'a3'].includes(saved.side) ? saved.side : 'all',
    min: [4, 3, 2].includes(saved.min) ? saved.min : 2,
    ex: saved.ex === 'bybit' || saved.ex === 'binance' ? saved.ex : U.ex === 'fx' ? 'binance' : U.ex,
  };
  const S = { run: 0, busy: false, rows: [], early: 0, quiet: 0, bad: [], missing: [], total: 0, done: 0, t0: 0, at: 0, tf: '', ex: '', scope: '', msg: '', cool: 0, open: '' };

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const px = v => (+v).toFixed(v > 0 ? Math.min(8, Math.max(2, 4 - Math.floor(Math.log10(v)))) : 4);
  const hm = t => new Date(t).toISOString().slice(11, 16);

  // ---------------------------------------------------------------- staying inside the exchange's limits
  // Binance counts request weight (2400 a minute per address): 499 candles cost 2, so a coin costs about 20. Bybit counts requests.
  function bucket(rate, cap) {
    let have = cap, at = performance.now();
    return async n => {
      for (;;) {
        const now = performance.now(); have = Math.min(cap, have + (now - at) / 1000 * rate); at = now;
        if (have >= n) { have -= n; return; }
        await wait(Math.ceil((n - have) / rate * 1000));
      }
    };
  }
  const PACE = { binance: { take: bucket(15, 40), size: 499, cost: 2, workers: 6 }, bybit: { take: bucket(10, 20), size: 1000, cost: 1, workers: 4 } };
  const limited = e => e && (e.status === 429 || e.status === 418 || e.status === 403 || /too many|rate limit/i.test(e.message || ''));
  const STOP = new Error('stopped');

  async function pull(sym, from, to, ex, run) {
    const P = PACE[ex], A = u.api(ex), out = [];
    for (let t = from; t < to;) {
      if (run !== S.run) throw STOP;
      const end = Math.min(to - 1, t + P.size * MIN - 1);
      await P.take(P.cost);
      if (run !== S.run) throw STOP;
      for (const k of await A.klines(sym, '1m', { start: t, end, limit: P.size })) if (k[0] >= t && k[0] < to) out.push(k);
      t = end + 1;
    }
    return out;
  }

  // ---------------------------------------------------------------- where a coin's setup stands
  const spot = x => { const sh = x.dir === -1, w = x.sweep.wick, rng = x.hi - x.lo; return { sh, depth: rng > 0 ? (sh ? w - x.lo : x.hi - w) / rng : 0, zone: !!x.zone && (sh ? w >= x.zone.bot : w <= x.zone.top) }; };
  const isA3 = x => { const p = spot(x); return !p.sh && (p.depth >= 0.75 || p.zone); };   // A+++ long: deep discount or demand zone
  const whereOf = x => { const { sh, depth, zone } = spot(x); return (depth >= 0.75 ? (sh ? 'top of premium' : 'bottom of discount') : (sh ? 'mid premium' : 'mid discount')) + (zone ? (sh ? ', in supply zone' : ', in demand zone') : ''); };
  const firstAfter = (B, t) => { let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] <= t) lo = m + 1; else hi = m; } return lo; };
  function finished(s, B) {   // already at its stop or target: nothing left to act on
    for (let i = firstAfter(B, s.t); i < B.length; i++) { const k = B[i]; if (s.dir === -1 ? k[2] >= s.stop || k[3] <= s.target : k[3] <= s.stop || k[2] >= s.target) return true; }
    return false;
  }
  function readRow(sym, ex, tf, A, B, end) {
    const base = { sym, ex, tf };
    const s = A.setups.length ? A.setups[A.setups.length - 1] : null;
    if (s && end - s.conf < FRESH && !finished(s, B)) {
      return { ...base, stage: 4, side: s.side, a3: isA3(s), age: Math.max(0, Math.round((end - s.conf) / MIN)), t: s.t, entry: s.entry, stop: s.stop, target: s.target, R: s.R, where: whereOf(s) };
    }
    const g = A.leg && !A.leg.dead && A.leg.brk ? A.leg : null;
    if (!g) return { ...base, stage: 0 };
    const sh = g.dir === -1, side = sh ? 'short' : 'long', swept = !!g.sweep && end - g.sweep.conf < TRIG;   // an old sweep can no longer trigger
    const stage = 1 + (g.prem ? 1 : 0) + (swept ? 1 : 0), mid = (g.hi + g.lo) / 2;
    const next = swept ? `Waiting for a 1-minute close ${sh ? 'below' : 'above'} ${g.trig ? px(g.trig.p) : 'the last 1-minute swing'}`
      : g.prem ? `In ${sh ? 'premium' : 'discount'}, waiting for a sweep` : `Waiting for a ${sh ? 'bounce above' : 'dip below'} ${px(mid)}`;
    return { ...base, stage, side, a3: swept && isA3(g), brk: g.brk.t, next, where: swept ? whereOf(g) : '' };
  }
  async function readCoin(sym, ex, tf, run) {
    const sms = TF[tf].ms, end = Math.floor(Date.now() / MIN) * MIN, from = Math.floor((end - DAYS * DAY) / sms) * sms;
    const B = (await pull(sym, from, end, ex, run)).filter(k => k[0] + MIN <= end);
    if (B.length < 30) return null;
    let hist = [];
    try { await PACE[ex].take(PACE[ex].cost); hist = (await u.api(ex).klines(sym, tf, { end: from - 1, limit: HIST })).filter(k => k[0] + sms <= from); } catch (e) { if (limited(e)) throw e; }
    if (run !== S.run) throw STOP;
    return readRow(sym, ex, tf, SMC.analyze(B, B.length - 1, { tf: sms, hist: hist.length ? { k: hist, step: sms } : null }), B, end);
  }

  // ---------------------------------------------------------------- which coins
  async function adminJSON(path) { const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  async function coinList(scope, ex) {
    const known = new Set((await u.api(ex).symbols()).map(s => s.s)), list = [], why = {}, missing = [];
    const add = (raw, tag) => {
      const n = String(raw || '').toUpperCase().replace(/USDT$/, ''); if (!n) return;
      const sym = [n + 'USDT', '1000' + n + 'USDT', '1000000' + n + 'USDT', n.replace(/^1000+/, '') + 'USDT'].find(x => known.has(x));
      if (!sym) { if (!missing.includes(n)) missing.push(n); return; }
      if (!why[sym]) { why[sym] = []; list.push(sym); } if (!why[sym].includes(tag)) why[sym].push(tag);
    };
    add(U.sym, 'on chart');
    const cmp = window.__rdCmp && window.__rdCmp.C; if (cmp && cmp.on && cmp.sym) add(cmp.sym, 'compare');
    for (const p of (RD.A && RD.A.pos) || []) add(p.sym, 'open trade');
    if (scope === 'watch') for (const s of RD.watchlist()) add(s, 'watchlist');
    if (admin && scope !== 'watch') {
      try { const since = Date.now() - 48 * 3600e3; for (const s of (await adminJSON('/api/sim/signals?days=2')).signals || []) if (s.t >= since) add(s.symbol, 'bot signal'); } catch (e) { S.msg = 'Bot signals could not be read.'; }
    }
    if (scope === 'top' || scope === 'alltop') {
      const t = await u.api(ex).tickers();
      Object.keys(t).filter(s => known.has(s) && !STABLE.test(s) && t[s].vol > 0).sort((a, b) => t[b].vol - t[a].vol).slice(0, TOP_N).forEach((s, i) => add(s, '#' + (i + 1) + ' by volume'));
    }
    if (admin && (scope === 'all' || scope === 'recent' || scope === 'alltop')) {
      try { const cut = scope === 'recent' ? Date.now() - 30 * DAY : 0; for (const c of (await adminJSON('/api/sim/coins')).coins || []) if (c.t >= cut) add(c.symbol, 'we traded it'); } catch (e) { S.msg = 'The coins we traded could not be read.'; }
    }
    return { list, why, missing };
  }

  // ---------------------------------------------------------------- the panel
  const seg = (k, opts, label) => `<div class="fd-seg" role="group" aria-label="${label}">${opts.map(([v, t, tip]) => `<button type="button" data-fdk="${k}" data-v="${v}"${tip ? ` title="${esc(tip)}"` : ''}>${t}</button>`).join('')}</div>`;
  root.innerHTML = `<div class="fd">
    <div class="fd-h"><b>Find setups</b><button type="button" class="fd-x" data-fdx aria-label="Close Find setups">${ic('x')}</button></div>
    <label class="fd-f"><span>Coins</span><select data-fdscope aria-label="Which coins to check">${SCOPES.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label>
    <div class="fd-f"><span>Timeframe</span>${seg('tf', TFS.map(t => [t, t]), 'Structure timeframe')}</div>
    <div class="fd-f"><span>Side</span>${seg('side', [['all', 'All'], ['long', 'Longs'], ['short', 'Shorts'], ['a3', 'A+++', 'Longs whose sweep reached deep discount or the demand zone']], 'Side')}</div>
    <div class="fd-f"><span>Show</span>${seg('min', [[4, 'A+ only', 'Triggered in the last 45 minutes and still open'], [3, '3 of 4', 'Triggered, or swept and one close away'], [2, '2 of 4', 'Also coins already in premium / discount']], 'How far along')}</div>
    <div class="fd-f"><span>Data</span>${seg('ex', [['binance', 'Binance'], ['bybit', 'Bybit']], 'Exchange')}</div>
    <button type="button" class="btn btn-primary btn-block fd-go" data-fdgo></button>
    <progress class="fd-bar" data-fdbar max="1" value="0" hidden></progress>
    <p class="fd-sum" data-fdsum aria-live="polite"></p>
    <div class="fd-list" data-fdlist></div>
    <p class="fd-note">${esc(TESTED)}</p>
  </div>`;
  const $ = s => root.querySelector(s), go = $('[data-fdgo]'), bar = $('[data-fdbar]'), sum = $('[data-fdsum]'), box = $('[data-fdlist]'), sel = $('[data-fdscope]');
  sel.value = F.scope;
  const stale = () => S.at && (S.tf !== F.tf || S.ex !== F.ex || S.scope !== F.scope);
  const want = r => r.stage >= F.min && (F.side === 'all' || (F.side === 'a3' ? r.a3 : r.side === F.side));

  function paintControls() {
    root.querySelectorAll('[data-fdk]').forEach(b => { const on = String(F[b.dataset.fdk]) === b.dataset.v; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    const cooling = S.cool > Date.now();
    go.innerHTML = S.busy ? 'Stop' : `${ic('search')} Find setups`; go.classList.toggle('stop', S.busy); go.disabled = cooling && !S.busy;
    if (cooling && !S.busy) go.textContent = 'Wait a few minutes';
  }
  function rowHtml(r, i) {
    const on = S.open === r.sym + r.tf, tag = r.a3 ? '<em class="fd-a3">A+++</em>' : '', why = (S.why[r.sym] || []).join(' · ');
    const head = `<b>${esc(coin(r.sym))}</b><span class="fd-side ${r.side === 'long' ? 'up' : 'down'}">${r.side}</span>${tag}`;
    if (r.stage === 4) return `<button type="button" class="fd-row hot${on ? ' on' : ''}" data-fdi="${i}"><span class="fd-t">${head}<span class="fd-st">🎯 A+ · ${r.age ? r.age + ' min ago' : 'just now'}</span></span><span class="fd-d mono">Entry ${px(r.entry)} · Stop ${px(r.stop)} · Target ${px(r.target)} · ${r.R.toFixed(1)}R</span><span class="fd-w">Sweep at ${esc(r.where)} · ${esc(why)}</span></button>`;
    return `<button type="button" class="fd-row${on ? ' on' : ''}" data-fdi="${i}"><span class="fd-t">${head}<span class="fd-st">${r.stage} of 4</span></span><span class="fd-d">${esc(r.next)}</span><span class="fd-w">${r.where ? 'Sweep at ' + esc(r.where) + ' · ' : ''}${esc(why)}</span></button>`;
  }
  let shown = [];
  function paint() {
    paintControls();
    const all = [...S.rows].sort((a, b) => b.stage - a.stage || (a.age || 0) - (b.age || 0) || a.sym.localeCompare(b.sym)), match = all.filter(want);
    shown = match.slice(0, SHOWN);
    const ap = match.filter(r => r.stage === 4).length, n3 = match.filter(r => r.stage === 3).length, n2 = match.filter(r => r.stage === 2).length, hidden = all.filter(r => r.stage >= 2).length - match.length;
    bar.hidden = !S.busy; bar.max = Math.max(1, S.total); bar.value = S.done;
    let head = '';
    if (S.busy) {
      const left = S.done >= 3 ? Math.ceil((Date.now() - S.t0) / S.done * (S.total - S.done) / MIN) : 0;
      head = S.total ? `Checking ${S.done} of ${S.total} coins${left > 1 ? ` · about ${left} min left` : ''}` : 'Getting the coins…';
    } else if (S.at) head = `${S.done} coin${S.done === 1 ? '' : 's'} checked at ${hm(S.at)} UTC on ${S.tf} · ${S.ex === 'bybit' ? 'Bybit' : 'Binance'}`;
    const counts = S.at || S.busy ? `<b>${ap}</b> A+ · <b>${n3}</b> at 3 of 4 · <b>${n2}</b> at 2 of 4` : '';
    sum.innerHTML = [esc(head), counts, S.msg ? `<span class="down">${esc(S.msg)}</span>` : '', stale() && !S.busy ? '<span class="fd-warn">You changed the coins, timeframe or data. Press Find setups to read them.</span>' : ''].filter(Boolean).join('<br>');
    const foot = [
      match.length > shown.length ? `And ${match.length - shown.length} more. Narrow the filters to see them.` : '',
      hidden > 0 ? `${hidden} more hidden by your filters.` : '',
      S.early ? `Structure broke but not in the zone yet (1 of 4): ${S.early} coin${S.early === 1 ? '' : 's'}.` : '',
      S.quiet ? `No live idea right now: ${S.quiet} coin${S.quiet === 1 ? '' : 's'}.` : '',
      S.bad.length ? `Could not be read: ${S.bad.map(coin).join(', ')}.` : '',
      S.missing.length ? `Not listed on ${S.ex === 'bybit' ? 'Bybit' : 'Binance'}: ${S.missing.slice(0, 12).join(', ')}${S.missing.length > 12 ? ` and ${S.missing.length - 12} more` : ''}.` : '',
    ].filter(Boolean);
    const empty = !shown.length && S.at && !S.busy ? '<p class="fd-empty">No coin matches these filters right now.</p>' : '';
    box.innerHTML = shown.map(rowHtml).join('') + empty + foot.map(t => `<p class="fd-foot">${esc(t)}</p>`).join('');
  }
  S.why = {};

  async function scan() {
    if (S.busy) { S.run++; return; }
    const run = ++S.run, ex = F.ex, tf = F.tf, scope = F.scope;
    Object.assign(S, { busy: true, rows: [], early: 0, quiet: 0, bad: [], missing: [], total: 0, done: 0, t0: Date.now(), at: 0, tf, ex, scope, msg: '', why: {} });
    paint();
    let tick = 0;
    try {
      const { list, why, missing } = await coinList(scope, ex);
      if (run !== S.run) return;
      S.why = why; S.missing = missing; S.total = list.length; S.t0 = Date.now(); paint();
      let next = 0;
      const worker = async () => {
        while (run === S.run && next < list.length) {
          const sym = list[next++];
          try {
            const r = await readCoin(sym, ex, tf, run);
            if (run !== S.run) return;
            if (!r) S.bad.push(sym); else if (r.stage >= 2) S.rows.push(r); else if (r.stage === 1) S.early++; else S.quiet++;
          } catch (e) {
            if (e === STOP || run !== S.run) return;
            if (limited(e)) { S.run++; S.cool = Date.now() + COOL; S.msg = 'The exchange asked us to slow down, so the scan stopped. Results so far are below.'; setTimeout(paintControls, COOL + 50); return; }
            S.bad.push(sym);
          }
          S.done++;
          if (Date.now() - tick > 350) { tick = Date.now(); paint(); }
        }
      };
      await Promise.all(Array.from({ length: PACE[ex].workers }, worker));
      if (run !== S.run && !S.msg) S.msg = `Stopped after ${S.done} of ${S.total} coins.`;
    } catch (e) {
      if (limited(e)) { S.cool = Date.now() + COOL; setTimeout(paintControls, COOL + 50); }
      S.msg = limited(e) ? 'The exchange asked us to slow down. Try again in a few minutes.' : 'The coin list could not be loaded: ' + (e.message || 'try again');
    } finally {
      S.busy = false; S.at = Date.now(); paint();
    }
  }

  function openRow(r) {
    S.open = r.sym + r.tf;
    if (R.on) RD.exitReplay();
    RD.setSymbol(r.sym, r.ex); RD.setTF(r.tf);
    const box2 = document.querySelector('[data-ind="aplus"]'); if (box2 && !box2.checked) box2.click();
    if (u.phone()) RD.closeSheets();
    paint();
  }

  // ---------------------------------------------------------------- opening and closing the panel
  let back = 'watch';
  const isOpen = () => !root.closest('[data-pane]').hidden;
  const showPane = on => {
    if (on) { if (u.phone()) RD.openSheet('find'); else RD.sideTab('find'); }
    else if (u.phone()) RD.closeSheets(); else RD.sideTab(back);
    pill.setAttribute('aria-pressed', String(isOpen() && on));
  };
  RD.on('pane', t => { if (t !== 'find') back = t; pill.setAttribute('aria-pressed', String(t === 'find')); });
  pill.addEventListener('click', () => showPane(!(isOpen() && (!u.phone() || document.querySelector('.dk-side').classList.contains('open')))));
  root.addEventListener('click', e => {
    if (e.target.closest('[data-fdx]')) return showPane(false);
    if (e.target.closest('[data-fdgo]')) return scan();
    const k = e.target.closest('[data-fdk]');
    if (k) { F[k.dataset.fdk] = k.dataset.fdk === 'min' ? +k.dataset.v : k.dataset.v; RD.store.set(KEY, F); paint(); return; }
    const row = e.target.closest('[data-fdi]'); if (row) openRow(shown[+row.dataset.fdi]);
  });
  sel.addEventListener('change', () => { F.scope = sel.value; RD.store.set(KEY, F); paint(); });
  paint();
  window.__rdFind = { S, F, scan, get shown() { return shown; }, PACE };   // for tests
})();
