/* ReplayDesk · A+ setups on the chart (Indicators → "A+ setups"), as on the classic simulator.
   The SMC engine (smc.js) finds them on 1-minute candles: a structure break, the pullback into premium / discount, a
   sweep of a swing high / low on the structure timeframe, then a 1-minute close past the last 1-minute swing (the 1m
   CHoCH). Entry = that close, stop just past the sweep wick, target the end of the move (2R when that is too close).
   Structure timeframe = the chart's (5m / 15m / 1H / 4H; a 1m chart reads 5m). Data: the last 3 days of 1-minute
   candles plus 300 older structure candles in front, straight from Binance / Bybit in this browser. Closed candles up
   to the clock only, so in a replay it never sees the future: a setup shows once its trigger candle has closed, and its
   result (target / stop) once price got there. Each box runs from the trigger to the stop or target. A setup still running is
   drawn bold with its prices at the right edge, finished ones are faded. One close from the trigger (3 of 4), the same box is
   drawn dashed as the plan: where the entry, stop and target will be if that close comes.
   While a move is live (step 1 of 4: a structure break), its premium / discount range and 50% line are drawn and the
   top-left line ticks off break · premium / discount · sweep · 1m CHoCH, as on the classic chart.
   Practice, not a signal: our test of these exact rules lost after fees (see TESTED). */
(function () {
  'use strict';
  const RD = window.__rd;
  if (!RD || !window.SMC) return;
  const { U, R } = RD, u = RD.util, X = RD.ext, { MIN, HOUR, DAY, TF } = u;
  const DAYS = 3, HIST = 300, FRESH = 45 * MIN, AHEAD = 6 * HOUR;
  const STF = { '1m': '5m', '5m': '5m', '15m': '15m', '1H': '1H', '4H': '4H' };   // chart → structure timeframe (1D / 1W: not offered)
  const TESTED = 'Practice, not signals: on the 207 coins our bot traded (14 Oct – 13 Nov 2026) these exact rules lost after fees (15m: −0.18R a trade over 6,014 setups; 5m: −0.12R over 6,834), no better than entering at a random time with the same stop and target.';
  const hm = t => new Date(t).toISOString().slice(11, 16);
  const when = (t, stf) => (TF[stf].ms >= HOUR ? new Date(t).toISOString().slice(5, 10) + ' ' : '') + hm(t);

  // M.all: fetched 1m candles, oldest first, from M.from (a structure-candle boundary) to M.to (exclusive; in a replay it
  // may run ahead of the clock — only candles closed by the clock are ever read)
  const M = { key: '', from: 0, to: 0, all: [], hist: [], A: null, n: -1, end: 0, busy: false, again: false, err: '', seen: null, armed: '', armedLeg: 0, armedAt: 0, gen: 0 };
  const endNow = () => Math.floor((R.on ? R.clock : Date.now()) / MIN) * MIN;
  const stfNow = () => STF[U.tf] || null;
  const keyNow = () => [U.sym, U.ex, stfNow(), R.on ? 'r' : 'l'].join('|');
  const closedCount = end => { let lo = 0, hi = M.all.length; while (lo < hi) { const m = (lo + hi) >> 1; if (M.all[m][0] + MIN <= end) lo = m + 1; else hi = m; } return lo; };

  function reset() { M.gen++; M.key = ''; M.all = []; M.hist = []; M.A = null; M.n = -1; M.err = ''; M.seen = null; M.armed = ''; M.from = M.to = 0; }

  // ---------------------------------------------------------------- alerts (Indicators → "Alert me")
  // Stage 2: the sweep is done, one 1-minute close away. Stage 3: the setup triggered. Live chart only.
  // Browsers only allow sound after a click on the page, so the audio starts on the first click and stays ready.
  let actx = null;
  const RG = { on: false, stage: 0, src: null, el: null, open: null, hide: 0 };   // the alarm that rings until it is stopped
  const unlockAudio = () => {
    try {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      if (!actx) { actx = new C(); actx.onstatechange = () => RD.legend(); }
      if (actx.state !== 'running') actx.resume().catch(() => {});
      if (RG.on && !RG.src) ringSound();   // it went off before the first click on the page
    } catch (e) { /* no audio */ }
  };
  const soundReady = () => !!actx && actx.state === 'running';
  // one looping sound played by the audio system, so the slowed-down timers of a hidden tab cannot break it up
  function ringBuffer(stage) {
    const sr = actx.sampleRate, notes = stage === 3 ? [880, 1175, 1568] : [660, 880], n = Math.round(sr * 0.17), b = actx.createBuffer(1, n * notes.length + Math.round(sr * 0.7), sr), d = b.getChannelData(0);
    notes.forEach((f, i) => { for (let j = 0; j < n; j++) d[i * n + j] = 0.4 * Math.min(1, j / (sr * 0.01)) * Math.min(1, (n - j) / (sr * 0.06)) * Math.sin(2 * Math.PI * f * j / sr); });
    return b;
  }
  function stopSound() { if (!RG.src) return; try { RG.src.stop(); RG.src.disconnect(); } catch (e) { /* already stopped */ } RG.src = null; }
  function ringSound() {
    stopSound(); if (!actx) return;
    try { const s = actx.createBufferSource(); s.buffer = ringBuffer(RG.stage); s.loop = true; s.connect(actx.destination); s.start(); RG.src = s; if (actx.state !== 'running') actx.resume().catch(() => {}); } catch (e) { RG.src = null; }
  }
  function stopRing() { RG.on = false; RG.stage = 0; RG.open = null; clearTimeout(RG.hide); stopSound(); if (RG.el) RG.el.hidden = true; }
  // the card under the toolbar: an alarm that rings, or a quiet notice for a coin that is not on this chart
  function card(title, body, tone, open, ringing) {
    if (!RG.el) {
      const el = document.createElement('div'); el.setAttribute('role', 'alert');
      el.innerHTML = '<span class="dk-alarm-bell" aria-hidden="true">🔔</span><div class="dk-alarm-txt"><b></b><span></span></div><button type="button" class="dk-alarm-open" hidden>Open chart</button><button type="button" class="dk-alarm-stop">Stop alarm</button>';
      el.querySelector('.dk-alarm-stop').addEventListener('click', stopRing);
      el.querySelector('.dk-alarm-open').addEventListener('click', () => { const f = RG.open; stopRing(); if (f) f(); });
      document.body.appendChild(el); RG.el = el;
    }
    clearTimeout(RG.hide); RG.open = open || null;
    RG.el.className = 'dk-alarm ' + tone + (ringing ? '' : ' quiet'); RG.el.querySelector('b').textContent = title; RG.el.querySelector('.dk-alarm-txt span').textContent = hm(Date.now()) + ' UTC · ' + body;
    RG.el.querySelector('.dk-alarm-open').hidden = !open; RG.el.querySelector('.dk-alarm-stop').textContent = ringing ? 'Stop alarm' : 'Dismiss'; RG.el.hidden = false;
    if (!ringing) RG.hide = setTimeout(stopRing, 120000);
  }
  function ring(stage, title, body, tone, open) {
    if (RG.on && RG.stage > stage) return;   // a triggered setup keeps the alarm over a new "almost ready"
    const again = RG.on && RG.stage === stage && RG.src;
    RG.on = true; RG.stage = stage; if (!again) ringSound();
    card(title, body, tone, open, true);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && RG.on) { e.preventDefault(); e.stopPropagation(); stopRing(); } }, true);
  function chime(stage) {
    if (!actx) return;
    const asked = Date.now(), play = () => {
      if (Date.now() - asked > 1500) return;   // the audio woke up long after the alert: too late to mean anything
      const t = actx.currentTime, notes = stage === 3 ? [880, 1175, 1568] : [660, 880], vol = stage === 3 ? 0.3 : 0.2;
      notes.forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(), at = t + i * 0.17; o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + 0.17); });
    };
    try { if (actx.state === 'running') play(); else actx.resume().then(play).catch(() => {}); } catch (e) { /* no audio */ }
  }
  function popup(title, body, tag, sticky, open) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { const n = new Notification(title, { body, tag, icon: '/icon.svg', requireInteraction: !!sticky }); n.onclick = () => { window.focus(); stopRing(); n.close(); if (open) open(); }; } catch (e) { /* phones only allow these from an installed app */ }
  }
  const away = () => document.hidden || !document.hasFocus();   // looking at the page: the toast and the sound are enough
  const alertsOn = () => !!U.aplusAlert && !!U.aplus && !R.on && !X.smcOff;
  function alertUser(stage, title, body, tag, tone, open) {
    const rings = U.aplusRing && !(stage === 2 && U.aplusRingTrig);   // "only when a setup triggers": almost ready plays the short sound once
    if (rings) ring(stage, title, body, tone, open); else if (!RG.on) { chime(stage); if (open) card(title, body, tone, open, false); }
    if (away()) popup(title, body, tag, rings, open);
  }
  document.addEventListener('click', e => {
    if (U.aplusAlert) unlockAudio();
    if (e.target && e.target.matches && e.target.matches('[data-ind="aplusRingTrig"]') && e.target.checked) {
      U.aplusRingTrig = true; unlockAudio();
      const box = document.querySelector('[data-ind="aplusRing"]');
      if (box && !box.checked) box.click(); else chime(2);   // the option needs the alarm on
      RD.toast('🔔 The alarm rings when a setup triggers. Almost ready plays one short sound.', 'up');
      return;
    }
    if (e.target && e.target.matches && e.target.matches('[data-ind="aplusRing"]') && !e.target.checked) U.aplusRingTrig = false;
    if (e.target && e.target.matches && e.target.matches('[data-ind="aplusRing"]') && e.target.checked) {
      U.aplusRing = true; unlockAudio();
      const box = document.querySelector('[data-ind="aplusAlert"]');
      if (box && !box.checked) box.click();   // ringing needs the alert on
      else { chime(3); RD.toast('🔔 The alarm will ring until you press Stop alarm.', 'up'); }
      return;
    }
    const i = e.target && e.target.matches && e.target.matches('[data-ind="aplusAlert"]') ? e.target : null;
    if (!i || !i.checked) return;
    unlockAudio(); U.aplus = true;   // the alert needs the setups on
    const done = () => {
      chime(3);
      const perm = 'Notification' in window ? Notification.permission : 'none';
      if (perm === 'granted') popup('A+ alerts are on', 'You will get one of these when a setup is almost ready and when it triggers.', 'rd-aplus-on');
      RD.toast(perm === 'granted' ? '🔔 A+ alerts on for the chart you have open. Keep this page open.'
        : perm === 'none' ? '🔔 A+ sound is on. This browser cannot show notifications.'
          : '🔔 A+ sound is on. Notifications are blocked: allow them for this site in your browser settings.', perm === 'granted' ? 'up' : 'down');
    };
    if ('Notification' in window && Notification.permission === 'default') { try { const p = Notification.requestPermission(done); if (p && p.then) p.then(() => {}, () => {}); } catch (err) { done(); } } else done();
  }, true);

  async function load() {
    if (!U.aplus || !stfNow()) { if (M.A || M.key) { reset(); RD.req(); RD.legend(); } return; }
    if (M.busy) { M.again = true; return; }
    const key = keyNow(), end = endNow(), sym = U.sym, ex = U.ex, stf = stfNow(), sms = TF[stf].ms;
    const fresh = key !== M.key || end < M.from + HOUR || end > M.to + DAY || M.all.length > (DAYS + 4) * 1440;
    if (!fresh && end <= M.to) { analyze(); return; }
    M.busy = true; const g = fresh ? ++M.gen : M.gen;
    try {
      if (fresh) {
        M.key = key; M.A = null; M.all = []; M.hist = []; M.err = ''; M.seen = null; M.armed = ''; M.n = -1; RD.req(); RD.legend();
        const from = Math.floor((end - DAYS * DAY) / sms) * sms, to = Math.min(Math.floor(Date.now() / MIN) * MIN, end + (R.on ? AHEAD : 0));
        const ks = await u.fetchRange(sym, '1m', from, to, ex);
        if (g !== M.gen || key !== keyNow()) return;
        if (!ks.length) throw new Error('no 1-minute candles');
        let hist = [];
        try { hist = (await u.api(ex).klines(sym, stf, { end: from - 1, limit: HIST })).filter(k => k[0] + sms <= from); } catch (e) { /* the minutes alone */ }
        if (g !== M.gen || key !== keyNow()) return;
        M.from = from; M.to = to; M.all = ks.filter(k => k[0] >= from && k[0] < to); M.hist = hist;
      } else {
        const to = Math.min(Math.floor(Date.now() / MIN) * MIN, end + (R.on ? AHEAD : 0));
        if (to > M.to) {
          const ks = await u.fetchRange(sym, '1m', M.to, to, ex);
          if (g !== M.gen || key !== M.key) return;
          const last = M.all.length ? M.all[M.all.length - 1][0] : -1;
          for (const k of ks) if (k[0] > last && k[0] < to) M.all.push(k);
          M.to = to;
        }
      }
      analyze();
    } catch (e) { if (g === M.gen) { M.err = e.message || String(e); RD.legend(); } }
    finally { M.busy = false; if (M.again) { M.again = false; setTimeout(load, 30); } }
  }

  function analyze() {
    const end = endNow(), n = closedCount(end), stf = stfNow();
    if (!stf || M.key !== keyNow()) return;
    if (n === M.n && end === M.end && M.A) return;
    M.n = n; M.end = end;
    if (n < 30) { M.A = null; RD.req(); RD.legend(); return; }
    const sms = TF[stf].ms;
    try { M.A = window.SMC.analyze(M.all, n - 1, { tf: sms, hist: M.hist.length ? { k: M.hist, step: sms } : null }); M.err = ''; }
    catch (e) { M.A = null; M.err = 'the SMC engine could not read this chart'; }
    const A = M.A, l = A && A.setups.length ? A.setups[A.setups.length - 1] : null, conf = l ? l.conf : 0;
    const first = M.seen == null;
    if (first) M.seen = conf;   // the first read: no toast for setups already on the chart
    else if (conf > M.seen) {
      M.seen = conf;
      if (R.on && R.playing && U.aplusPause !== false) RD.pause();
      RD.toast(`🎯 A+ ${l.side} on ${u.coin(U.sym)} at ${when(l.t, stf)} UTC · entry ${u.fp(l.entry)}, stop ${u.fp(l.stop)}, target ${u.fp(l.target)} (${l.R.toFixed(1)}R)`, l.side === 'long' ? 'up' : 'down');
      if (alertsOn() && !result(l)) {   // already at its stop or target by the time we read it: nothing left to act on
        const late = Math.floor((end - l.conf) / MIN);
        alertUser(3, `🎯 A+ ${l.side} · ${u.coin(U.sym)} ${stf}`, `${late >= 2 ? late + ' min ago · ' : ''}Entry ${u.fp(l.entry)}, stop ${u.fp(l.stop)}, target ${u.fp(l.target)} (${l.R.toFixed(1)}R)`, 'rd-aplus-' + U.sym + '-' + l.t, l.side === 'long' ? 'up' : 'down');
      }
    }
    const lg = armed();
    if (lg) {
      const id = lg.brk.t + '|' + lg.sweep.t;
      if (id !== M.armed) {
        M.armed = id;
        // a deeper sweep of the same move soon after is the same warning: stay quiet for 30 minutes
        if (!first && alertsOn() && !(M.armedLeg === lg.brk.t && end - M.armedAt < 30 * MIN)) {
          M.armedLeg = lg.brk.t; M.armedAt = end;
          const side = lg.dir === -1 ? 'short' : 'long', how = `a 1-minute close ${lg.dir === -1 ? 'below' : 'above'} ${u.fp(lg.trig.p)}`;
          RD.toast(`🔔 A+ ${side} almost ready on ${u.coin(U.sym)}: it triggers on ${how}.`, lg.dir === -1 ? 'down' : 'up');
          alertUser(2, `A+ ${side} almost ready · ${u.coin(U.sym)} ${stf}`, `Sweep done. It triggers on ${how}.`, 'rd-aplus-' + U.sym + '-' + id, lg.dir === -1 ? 'down' : 'up');
        }
      }
    }
    RD.req(); RD.legend();
  }

  // stop or target, walking the 1m candles after the trigger up to the clock (a candle that reaches both counts as the stop)
  function result(s) {
    const end = endNow(), B = M.all;
    let lo = 0, hi = B.length; while (lo < hi) { const m = (lo + hi) >> 1; if (B[m][0] <= s.t) lo = m + 1; else hi = m; }
    for (let i = lo; i < B.length && B[i][0] + MIN <= end; i++) {
      const k = B[i];
      if (s.dir === -1 ? k[2] >= s.stop : k[3] <= s.stop) return { kind: 'stop', t: k[0] };
      if (s.dir === -1 ? k[3] <= s.target : k[2] >= s.target) return { kind: 'target', t: k[0] };
    }
    return null;
  }
  // Show finished A+ setups off: only the ones still open (no stop / target yet) stay on the chart
  const shown = () => { if (!M.A || !U.aplus || X.smcOff || M.key !== keyNow()) return []; const L = U.aplusDone === false ? M.A.setups.filter(s => !result(s)) : M.A.setups; return U.smcAll ? L : L.slice(-4); };
  // the idea being built (step 1 of 4 done: a structure break whose move price hasn't closed back past), as on the classic chart
  const idea = () => (M.A && M.A.leg && !M.A.leg.dead && M.A.leg.brk ? M.A.leg : null);
  // 3 of 4 steps done: swept, and one 1-minute close away from the trigger
  const armed = () => { const l = idea(); return l && l.sweep && l.trig && endNow() - l.sweep.conf < 90 * MIN ? l : null; };
  // x of a time; a move that starts before the chart's first candle starts at the left edge
  const xL = t => { const x = RD.t2x(t); return x != null ? x : RD.S.bars.length && t < RD.S.bars[0][0] ? 0 : null; };

  // ---------------------------------------------------------------- on the chart
  X.draw.push((g, W, z) => {
    const list = shown(); if (!M.A || !U.aplus || X.smcOff || M.key !== keyNow()) return;
    const COL = RD.COL, red = COL.down, green = COL.up, gold = '#f5b301', blue = '#60a5fa';
    const ok = (...v) => v.every(q => q != null && isFinite(q));
    const xs = t => { const x = RD.t2x(t); return x == null ? null : Math.max(-40, Math.min(W + 40, x)); };
    const H = RD.box.clientHeight - RD.chart.timeScale().height(), inY = y => Math.max(11, Math.min(H - 11, y));
    const lv = armed(), pl = lv && lv.plan, planX = pl ? xL(lv.sweep.wickT) : null, pe = pl ? RD.p2y(pl.entry) : null, ps = pl ? RD.p2y(pl.stop) : null, pt = pl ? RD.p2y(pl.target) : null, planOk = !!pl && ok(planX, pe, ps, pt) && planX < W;
    const boxes = list.map(s => { const r = result(s), x0 = r ? xs(s.t) : xL(s.t), x1 = r ? xs(r.t) : W; return { s, r, x0, x1: x0 == null ? null : Math.min(W, Math.max(x0 + 24, x1 == null ? W : x1)), ye: RD.p2y(s.entry), ys: RD.p2y(s.stop), yt: RD.p2y(s.target) }; });
    const lg = idea(), lx = lg ? xL(lg.dir === -1 ? lg.hiT : lg.loT) : null, yH = lg ? RD.p2y(lg.hi) : null, yL = lg ? RD.p2y(lg.lo) : null, yE = lg ? RD.p2y((lg.hi + lg.lo) / 2) : null;
    const range = lg && ok(lx, yH, yE, yL) && lx < W;
    if (z === 'bottom') {
      if (range) {   // the move's top half = premium (shorts sell here), bottom half = discount (longs buy here)
        g.fillStyle = u.hexA(red, 0.07); g.fillRect(lx, yH, W - lx, yE - yH);
        g.fillStyle = u.hexA(green, 0.07); g.fillRect(lx, yE, W - lx, yL - yE);
      }
      if (planOk) {   // not triggered yet: the box it would be
        g.fillStyle = u.hexA(red, 0.2); g.fillRect(planX, Math.min(pe, ps), W - planX, Math.abs(ps - pe));
        g.fillStyle = u.hexA(green, 0.18); g.fillRect(planX, Math.min(pe, pt), W - planX, Math.abs(pt - pe));
      }
      for (const b of boxes) {
        if (!ok(b.x0, b.x1, b.ye, b.ys, b.yt) || b.x1 < 0 || b.x0 > W) continue;
        g.fillStyle = u.hexA(red, b.r ? 0.08 : 0.28); g.fillRect(b.x0, Math.min(b.ye, b.ys), b.x1 - b.x0, Math.abs(b.ys - b.ye));
        g.fillStyle = u.hexA(green, b.r ? 0.07 : 0.26); g.fillRect(b.x0, Math.min(b.ye, b.yt), b.x1 - b.x0, Math.abs(b.yt - b.ye));
      }
      return;
    }
    const line = (x0, x1, y, c, dash, w) => { if (!ok(x0, x1, y)) return; g.strokeStyle = c; g.lineWidth = w || 1; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x0, Math.round(y) + 0.5); g.lineTo(x1, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]); };
    const placed = [];   // labels so far: a new one that would overlap moves a line up or down, or is left out
    g.font = '600 10.5px "Geist Mono", ui-monospace, monospace';
    const tag = (t, x, y, c, al) => {
      if (!ok(x, y)) return; const w = g.measureText(t).width + 8, x0 = Math.max(2, Math.min(W - w - 2, al === 'right' ? x - w : x));   // kept inside the chart (phones)
      const free = yy => placed.every(p => x0 + w <= p.x || x0 >= p.x + p.w || yy + 8 <= p.y - 8 || yy - 8 >= p.y + 8);
      const yy = [y, y - 17, y + 17].find(free); if (yy == null) return;
      placed.push({ x: x0, y: yy, w }); RD.label(g, t, x0, yy, c, 'left');
    };
    const stf = stfNow(), edge = (t, y, c) => tag(t, W - 6, inY(y), c, 'right');
    if (range) line(lx, W, yE, u.hexA(COL.text, 0.55), [6, 4], 1);   // under the labels
    if (planOk) {   // the 1m close that would trigger it, and the stop and target it would have
      const sh = lv.dir === -1, away = sh ? 11 : -11;
      line(planX, W, ps, red, [6, 3], 2); line(planX, W, pe, blue, [5, 3], 2); line(planX, W, pt, green, [6, 3], 2);
      edge(`A+ ${sh ? 'short' : 'long'} if a 1m candle closes ${sh ? 'below' : 'above'} ${u.fp(pl.entry)}`, pe + away, blue);
      edge(`Plan stop ${u.fp(pl.stop)}`, ps - away, red);
      edge(`Plan target ${u.fp(pl.target)} · ${pl.R.toFixed(1)}R`, pt + away, green);
    }
    if (range) {
      tag('50% · EQ', W - 6, yE - 10, COL.text, 'right');
      tag('Premium', W - 6, yH + 10, red, 'right'); tag('Discount', W - 6, yL - 10, green, 'right');
    }
    for (const b of boxes.slice().reverse().sort((p, q) => (p.r ? 1 : 0) - (q.r ? 1 : 0))) {   // running setups first: their labels get the room
      if (!ok(b.x0, b.x1, b.ye, b.ys, b.yt) || b.x1 < 0 || b.x0 > W) continue;
      const s = b.s, r = b.r, away = s.dir === -1 ? 11 : -11;
      line(b.x0, b.x1, b.ys, r ? u.hexA(red, 0.45) : red, [], r ? 1 : 2.5); line(b.x0, b.x1, b.ye, r ? u.hexA(COL.text, 0.4) : COL.text, [], r ? 1 : 1.5); line(b.x0, b.x1, b.yt, r ? u.hexA(green, 0.45) : green, [], r ? 1 : 2.5);
      if (!r) { edge(`A+ stop ${u.fp(s.stop)}`, b.ys - away, red); edge(`A+ entry ${u.fp(s.entry)}`, b.ye + away, COL.text); edge(`A+ target ${u.fp(s.target)} · ${s.R.toFixed(1)}R`, b.yt + away, green); }
      tag(`A+ ${s.side} · ${s.R.toFixed(1)}R${!r ? ' · open' : r.kind === 'stop' ? ' · ✗ stopped ' + when(r.t, stf) : ' · ✓ target ' + when(r.t, stf)}`,
        Math.max(2, b.x0), s.dir === -1 ? b.ys - 11 : b.ys + 11, !r ? gold : r.kind === 'stop' ? red : green);
    }
  });

  // ---------------------------------------------------------------- legend: the newest setup, or what it is waiting for
  const aplusLine = () => {
    if (!U.aplus) return '';
    const t = ` title="${u.esc(TESTED)}"`;
    if (!stfNow()) return `<span${t}>A+ setups: 4H and lower</span>`;
    if (M.err) return `<span${t}>A+: ${u.esc(M.err)}</span>`;
    if (!M.A || M.key !== keyNow()) return `<span${t}>A+ loading…</span>`;
    const A = M.A, l = A.setups[A.setups.length - 1], leg = A.leg && !A.leg.dead ? A.leg : null, end = endNow(), stf = stfNow();
    const lr = l ? result(l) : null;
    const newest = l ? `<span${t}>🎯 <b class="${l.side === 'long' ? 'up' : 'down'}">A+ ${l.side}</b> ${when(l.t, stf)} · ${l.R.toFixed(1)}R${lr ? (lr.kind === 'stop' ? ' · stopped' : ' · target hit') : ` · <b>running</b> · entry ${u.fp(l.entry)} · stop ${u.fp(l.stop)} · target ${u.fp(l.target)}`}</span>` : '';
    if (l && end - l.conf < FRESH) return newest;
    const run = l && !lr ? newest : '';   // an older setup still running stays in view next to the next idea
    const n = A.setups.length, done = A.setups.map(result), w = done.filter(r => r && r.kind === 'target').length, s = done.filter(r => r && r.kind === 'stop').length;
    const count = `<span${t}>A+ ${DAYS}d: <b>${n}</b>${n ? ` · ${w} target, ${s} stop${n - w - s ? `, ${n - w - s} open` : ''}` : ''}</span>`;
    const lg = idea(); if (!lg) return run + count;
    // the idea's 4 steps, as on the classic chart: break ✓ · premium / discount · sweep · 1m CHoCH (the trigger)
    const sh = lg.dir === -1, ck = (on, x) => `<span class="${on ? 'up' : 'mut'}">${on ? '✓' : '○'} ${x}</span>`;
    const trig = !!armed();
    return run + `<span${t}>A+ <b class="${sh ? 'down' : 'up'}">${sh ? 'short' : 'long'} idea</b> since the ${lg.brk.kind} ${when(lg.brk.t, stf)} · ` +
      [ck(true, 'break'), ck(!!lg.prem, sh ? 'premium' : 'discount'), ck(!!lg.sweep, 'sweep'), ck(false, '1m CHoCH')].join(' ') +
      (trig ? ` · waiting for a 1m close ${sh ? 'below' : 'above'} <b>${u.fp(lg.trig.p)}</b>${lg.plan ? ` · plan stop ${u.fp(lg.plan.stop)} · target ${u.fp(lg.plan.target)} · ${lg.plan.R.toFixed(1)}R` : ''}` : '') + `</span>` + count;
  };
  // browsers keep a page silent until its first click: say so, or the alarm could stay quiet after a reload
  X.legend.push(() => { const s = aplusLine(); return s && U.aplusAlert && !R.on && !soundReady() ? '<span class="down">🔇 Click the page once so the alert can sound</span>' + s : s; });

  // ---------------------------------------------------------------- when to read again
  RD.on('aplus', () => { if (!U.aplus || !U.aplusAlert || !U.aplusRing || (U.aplusRingTrig && RG.stage === 2)) stopRing(); if (!U.aplus) { reset(); RD.req(); RD.legend(); } else load(); });
  RD.on('sym', () => { reset(); load(); });
  RD.on('load', () => load());
  RD.on('mode', () => { reset(); load(); });
  RD.on('bars', () => { if (U.aplus) load(); });   // a new candle, a replay step, another timeframe
  setInterval(() => { if (U.aplus && !R.on && (!document.hidden || U.aplusAlert)) load(); }, 20000);   // live: new 1-minute closes between chart candles (alerts keep watching from a hidden tab)
  // the Watchlist alerts (deskwatch.js) ring through the same sound, card and notification
  Object.assign(M, { analyze, alertUser, stopRing, unlock: unlockAudio, soundReady, stfNow }); window.__rdAplus = M;
  if (U.aplus) load();
})();
