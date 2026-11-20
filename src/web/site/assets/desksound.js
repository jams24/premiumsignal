/* ReplayDesk · sounds and alarms: the bell in the top bar. Every tab of this site that can make a sound talks over one
   BroadcastChannel: desk tabs (the A+ alarm, the A+ Watchlist, price alerts, the red news warning) and the classic dashboard
   (its simulator alerts and news warning). So from any desk tab you can stop an alarm ringing in a tab you cannot see, mute
   every tab, see what is set to make a sound (and turn it off where it runs) and what sounded lately, with the tab it came from.
   A ringing tab also puts 🔔 ALARM in front of its title, so it stands out in the tab bar.
   Every sound system this page opens (AudioContext) is tracked: while you mute, or while nothing in this tab is set to make a
   sound, they are all switched off, so no sound can come from this tab — not even one left playing by mistake — and the
   browser's speaker icon goes away. */
(function () {
  'use strict';
  const RD = window.__rd, root = document.querySelector('[data-snd]');
  if (!RD || !root) return;
  const { U, R } = RD, X = RD.ext, u = RD.util;
  const btn = root.querySelector('[data-act="snd"]'), pop = root.querySelector('[data-sndpop]');
  const TAB = 'd' + Math.random().toString(36).slice(2, 10), MUTE = 'rd-snd-mute', LOG = 'rd-snd-log', CLAIM = 'rd-snd-claim', HOLD = 10 * 60000, PRE = '🔔 ALARM · ';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode or full */ } },
  };
  let ch = null;
  try { ch = 'BroadcastChannel' in window ? new BroadcastChannel('rd-sound') : null; } catch (e) { ch = null; }
  const post = m => { try { if (ch) ch.postMessage(Object.assign({ from: TAB }, m)); } catch (e) { /* closed */ } };
  // src: this tab's sound sources (each module adds its own); tabs: the other tabs' last state
  const S = { src: new Map(), stops: [], mutes: [], ring: null, tabs: new Map(), sent: '', asked: 0 };
  const hm = t => new Date(t).toISOString().slice(11, 16);
  const where = () => `${u.coin(U.sym)} ${U.tf}${R.on ? ' replay' : ''}`;
  const muted = () => ls.get(MUTE, false) === true;

  // ---------------------------------------------------------------- every sound system of this page (desk modules open their own)
  const CTX = new Set(), Native = window.AudioContext || window.webkitAudioContext;
  if (Native) {
    try {
      const Tracked = class extends Native {
        constructor(...a) { super(...a); CTX.add(this); }
        resume() { return muted() ? Promise.resolve() : super.resume(); }   // muted: nothing on this page can switch sound back on
      };
      window.AudioContext = Tracked; if (window.webkitAudioContext) window.webkitAudioContext = Tracked;
    } catch (e) { /* an old browser: the modules' own checks still apply */ }
  }
  function hush() { for (const c of CTX) { try { if (c.state === 'running' && typeof c.suspend === 'function') c.suspend().catch(() => {}); } catch (e) { /* closed */ } } }

  // ---------------------------------------------------------------- this tab's state, sent to the others when it changes
  function items() {
    const out = [];
    for (const [id, d] of S.src) { let l = ''; try { l = d.label() || ''; } catch (e) { l = ''; } if (l) out.push({ id, label: l, all: !!d.all, btn: d.btn || '' }); }
    return out;
  }
  function state(force) {
    const m = { t: 'state', page: 'desk', where: where(), items: items(), ring: S.ring };
    const k = JSON.stringify(m); if (!force && k === S.sent) return false;
    S.sent = k; post(m); return true;
  }
  const ringing = () => S.ring ? { title: S.ring, tab: TAB } : [...S.tabs].map(([tab, s]) => (s.ring ? { title: s.ring, tab } : null)).find(Boolean) || null;
  const tabName = tab => {
    if (tab === TAB) return 'this tab';
    const s = S.tabs.get(tab); if (!s) return null;
    return s.page === 'classic' ? 'the classic dashboard tab' : `another desk tab (${s.where})`;
  };

  // ---------------------------------------------------------------- stop, mute, the tab title
  function stopHere() { for (const f of S.stops) { try { f(); } catch (e) { console.error(e); } } }
  function applyMute(on) { if (on) hush(); for (const f of S.mutes) { try { f(on); } catch (e) { console.error(e); } } paint(); }
  // nothing in this tab can sound (or all muted): switch its sound systems off
  function idle() { if (muted() || (!S.ring && !items().length)) hush(); }
  function setMute(on) { ls.set(MUTE, !!on); post({ t: 'mute', on: !!on }); applyMute(!!on); }
  function setTitle() { const t = document.title.split(PRE).join(''); X.titlePre = S.ring ? PRE : ''; document.title = X.titlePre + t; }

  // what sounded lately, in every tab of this browser (newest last)
  function logIt(title, rang) {
    const L = ls.get(LOG, []);
    L.push({ at: Date.now(), title: String(title).slice(0, 140), tab: TAB, page: 'desk', where: where(), rang: !!rang });
    ls.set(LOG, L.slice(-25)); post({ t: 'played' });
  }
  // one alert, one tab: every desk tab reads the same Watchlist (and maybe the same chart), so the first tab to sound an
  // alert keeps it for 10 minutes and the others stay quiet; the bell in every tab can still stop it
  function claim(tag) {
    if (!tag) return true;
    const now = Date.now(), C = ls.get(CLAIM, {});
    for (const k of Object.keys(C)) if (!C[k] || now - C[k].at > HOLD) delete C[k];
    if (C[tag] && C[tag].tab !== TAB) return false;
    C[tag] = { tab: TAB, at: now }; ls.set(CLAIM, C); return true;
  }
  function release() { const C = ls.get(CLAIM, {}); let n = 0; for (const k of Object.keys(C)) if (C[k] && C[k].tab === TAB) { delete C[k]; n++; } if (n) ls.set(CLAIM, C); }

  function turnOff(id) { const d = S.src.get(id); if (d) { try { d.off(); } catch (e) { console.error(e); } } }

  RD.sound = {
    tab: TAB, muted, claim, contexts: () => [...CTX].map(c => c.state),
    // d: { label() → what it is ('' while it cannot sound), off(), all: one setting for every desk tab, btn: button text }
    source(id, d) { S.src.set(id, d); },
    onStop(f) { S.stops.push(f); },
    onMute(f) { S.mutes.push(f); },
    stopAll() { stopHere(); post({ t: 'stop' }); setTimeout(idle, 300); },
    ringing(title) { const r = title || null; if (r === S.ring) return; S.ring = r; setTitle(); state(); paint(); },
    played(title, rang) { logIt(title, rang); paint(); },
    changed() { if (state()) paint(); },
  };

  // ---------------------------------------------------------------- the bell and its panel
  function paintBell() {
    const r = ringing(), m = muted();
    btn.classList.toggle('ringing', !!r); btn.classList.toggle('muted', m && !r);
    const tip = r ? `Stop the alarm: ${r.title}${r.tab === TAB ? '' : ` (${tabName(r.tab) || 'another tab'})`}`
      : m ? 'Every sound on this site is muted. Click for sounds and alarms.' : 'Sounds and alarms: stop an alarm, mute every tab, see what made a sound';
    btn.title = tip; btn.setAttribute('aria-label', tip);
  }
  function body() {
    const esc = u.esc, r = ringing(), m = muted(), settled = Date.now() - S.asked > 600;
    let h = '<h3>Sounds and alarms</h3>';
    if (r) h += `<div class="snd-ring"><b>🔔 Ringing now</b><span>${esc(r.title)}</span><em>in ${esc(tabName(r.tab) || 'another tab')}</em></div><button type="button" class="snd-stop" data-snd="stop">Stop alarm</button>`;
    h += `<label class="snd-mute"><input type="checkbox" data-snd="mute"${m ? ' checked' : ''}> Mute every sound on this site</label>
      <p>In all tabs, the classic dashboard too, until you untick it. Alerts still show on screen, as notifications and on Telegram.</p>`;
    // what can make a sound: this tab first, then the others (a setting shared by every desk tab is listed once)
    const rows = items().map(it => ({ tab: TAB, ...it, who: `This tab (${where()})` }));
    for (const [tab, s] of S.tabs) for (const it of s.items || []) {
      if (it.all && rows.some(x => x.id === it.id && x.all)) continue;
      rows.push({ tab, ...it, who: s.page === 'classic' ? 'Classic dashboard tab' : `Desk tab (${s.where})` });
    }
    h += '<div class="snd-sec">Set to make a sound</div>';
    h += rows.length ? rows.map(x => `<div class="snd-row"><span><b>${esc(x.who)}</b>${esc(x.label)}</span><button type="button" data-snd-off="${esc(x.all ? '*' : x.tab)}|${esc(x.id)}">${esc(x.btn || 'Turn off')}</button></div>`).join('')
      : `<p>${settled ? 'Nothing in the open tabs of this site is set to make a sound, and their sound is switched off.' : 'Asking the other tabs…'}</p>`;
    if (settled) h += '<p class="snd-help"><b>Still hearing a sound?</b> It is not from a tab listed here. Check for a tab of this site that has been open since before this bell was added (reload it once), or another site or app: YouTube, Telegram, a notification. The tab playing it shows a speaker icon.</p>';
    const L = ls.get(LOG, []).slice(-8).reverse();
    h += '<div class="snd-sec">Sounded lately</div>';
    h += L.length ? '<div class="snd-log">' + L.map(e => {
      const n = tabName(e.tab), w = n ? n : (e.page === 'classic' ? 'the classic dashboard' : `a desk tab (${e.where})`) + (settled ? ', closed now' : '');
      return `<div><time>${hm(e.at)}</time><span>${esc(e.title)}${e.rang ? ' · rang' : ''}</span><em>${esc(w)}</em></div>`;
    }).join('') + '</div>' : '<p>No sound yet.</p>';
    return h + '<p class="snd-utc">Times in UTC.</p>';
  }
  function paint() { paintBell(); if (!pop.hidden) pop.innerHTML = body(); }
  function open(on) {
    pop.hidden = !on; btn.setAttribute('aria-expanded', String(on));
    if (!on) return;
    S.asked = Date.now(); post({ t: 'hi' }); paint(); setTimeout(paint, 700);
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const r = ringing();
    if (r) {   // the button says Stop alarm: stop it everywhere, and say where it was
      RD.sound.stopAll();
      RD.toast(`🔕 Alarm stopped: ${r.title}${r.tab === TAB ? '' : ` · it was ringing in ${tabName(r.tab) || 'another tab'}`}`, 'up');
      if (r.tab !== TAB) { const s = S.tabs.get(r.tab); if (s) S.tabs.set(r.tab, { ...s, ring: null }); }
      paint(); return;
    }
    open(pop.hidden);
  });
  pop.addEventListener('click', e => {
    if (e.target.closest('[data-snd="stop"]')) { const r = ringing(); RD.sound.stopAll(); if (r && r.tab !== TAB) { const s = S.tabs.get(r.tab); if (s) S.tabs.set(r.tab, { ...s, ring: null }); } paint(); return; }
    const off = e.target.closest('[data-snd-off]');
    if (off) {
      const [tab, id] = off.dataset.sndOff.split('|');
      if (tab === TAB || tab === '*') { turnOff(id); setTimeout(idle, 300); }
      if (tab !== TAB) post({ t: 'off', to: tab, id });
      off.disabled = true; off.textContent = 'Off';
      setTimeout(() => { state(); S.asked = Date.now(); S.tabs.clear(); post({ t: 'hi' }); paint(); setTimeout(paint, 700); }, 400);
    }
  });
  pop.addEventListener('change', e => {
    if (!e.target.matches('[data-snd="mute"]')) return;
    const on = e.target.checked; setMute(on);
    RD.toast(on ? '🔕 Every sound on this site is muted, in all tabs.' : '🔔 Sounds are back on.', on ? 'down' : 'up');
  });
  document.addEventListener('click', e => { if (!pop.hidden && !root.contains(e.target)) open(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) open(false); });

  // ---------------------------------------------------------------- the other tabs
  if (ch) ch.onmessage = e => {
    const m = e.data || {}; if (!m.from || m.from === TAB) return;
    if (m.t === 'hi') state(true);
    else if (m.t === 'state') { S.tabs.set(m.from, m); paint(); }
    else if (m.t === 'bye') { S.tabs.delete(m.from); paint(); }
    else if (m.t === 'stop') { stopHere(); setTimeout(idle, 300); }
    else if (m.t === 'mute') applyMute(!!m.on);
    else if (m.t === 'played') { if (!pop.hidden) paint(); }
    else if (m.t === 'off' && (m.to === TAB || m.to === '*')) { turnOff(m.id); setTimeout(() => { state(); idle(); }, 300); }
  };
  window.addEventListener('storage', e => { if (e.key === MUTE) applyMute(muted()); });
  window.addEventListener('pagehide', () => { release(); post({ t: 'bye' }); });
  window.addEventListener('pageshow', e => { if (e.persisted) { post({ t: 'hi' }); state(true); } });
  setInterval(() => { if (state()) paint(); else paintBell(); idle(); }, 2000);   // a setting changed in this tab
  post({ t: 'hi' }); setTimeout(() => state(true), 50);
  paintBell();
})();
