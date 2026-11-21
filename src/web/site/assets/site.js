/* ReplayDesk site behaviour: theme, navbar, menus, scroll reveal, password eye, account forms.
   No inline handlers (the pages run under a strict Content-Security-Policy). */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };

  // ---- theme ----
  $$('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = root.dataset.theme === 'light' ? 'dark' : 'light';
      root.dataset.theme = next;
      store.set('rd-theme', next);
    });
  });

  // ---- navbar: glass once scrolled, phone menu ----
  var nav = $('[data-nav]');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('is-scrolled', window.scrollY > 12); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    var menu = $('[data-menu]', nav), tog = $('[data-menu-toggle]', nav);
    var setOpen = function (on) {
      nav.classList.toggle('is-open', on); menu.hidden = !on; tog.setAttribute('aria-expanded', String(on));
      tog.setAttribute('aria-label', on ? 'Close menu' : 'Open menu'); document.body.style.overflow = on ? 'hidden' : '';
    };
    if (tog && menu) {
      tog.addEventListener('click', function () { setOpen(menu.hidden); });
      $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });
    }
  }

  // ---- reveal on scroll ----
  var reveals = $$('.reveal');
  if (reveals.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -60px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add('in'); });

  // ---- account menu ----
  $$('[data-umenu]').forEach(function (wrap) {
    var b = $('button', wrap), m = $('.menu', wrap);
    var close = function () { m.hidden = true; b.setAttribute('aria-expanded', 'false'); };
    b.addEventListener('click', function (e) { e.stopPropagation(); m.hidden = !m.hidden; b.setAttribute('aria-expanded', String(!m.hidden)); });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  });

  // ---- password show / hide ----
  $$('[data-eye]').forEach(function (b) {
    b.addEventListener('click', function () {
      var i = b.parentNode.querySelector('input'), show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      b.classList.toggle('is-on', show);
    });
  });

  // ---- talking to /auth ----
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, data: d }; }); })
      .catch(function () { return { status: 0, data: {} }; });
  }
  function alertBox(form, tone, html) {
    var a = $('[data-alert]', form.parentNode) || $('[data-alert]');
    if (!a) return;
    a.className = 'alert alert-' + tone; a.innerHTML = html; a.hidden = false;
    if (tone === 'down') shake(a);
  }
  var escHtml = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function busy(form, on, label) {
    var b = $('button[type=submit]', form);
    if (!b) return;
    if (on) { b.dataset.label = b.innerHTML; b.innerHTML = '<span class="spin" aria-hidden="true"></span><span>' + escHtml(label) + '</span>'; b.classList.add('is-busy'); }
    else { if (b.dataset.label) b.innerHTML = b.dataset.label; b.classList.remove('is-busy'); }
  }
  function values(form) { var o = {}; $$('input', form).forEach(function (i) { if (i.name) o[i.name] = i.value; }); return o; }
  var GENERIC = 'Something went wrong. Check your connection and try again.';
  var TOO_MANY = 'Too many tries. Wait a few minutes and try again.';

  function wireResend(scope, email, next) {
    $$('[data-resend]', scope).forEach(function (b) {
      b.addEventListener('click', function () {
        var e = email || b.dataset.email;
        if (!e) return;
        b.disabled = true; b.textContent = 'Sending…';
        post('/auth/resend', { email: e, next: next || b.dataset.next || '/app' }).then(function (r) {
          b.textContent = r.status === 200 ? 'Sent again ✓' : r.status === 429 ? 'Wait a few minutes' : 'Couldn’t send — try again';
          if (r.status !== 200) b.disabled = false;
        });
      });
    });
  }
  wireResend(document);

  var handlers = {
    signin: function (form, v) {
      busy(form, true, 'Signing in…');
      post('/auth/sign-in', v).then(function (r) {
        if (r.status === 200) { done(form, 'Signed in', function () { location.href = r.data.redirect || '/app'; }); return; }
        busy(form, false);
        if (r.status === 403 && r.data.error === 'email_not_verified') {
          alertBox(form, 'pri', 'Confirm your email first: we sent a new link to <b>' + escHtml(v.email) + '</b>. <button type="button" data-resend>Send it again</button>');
          wireResend(form.parentNode, v.email, v.next);
        } else alertBox(form, 'down', r.status === 429 ? TOO_MANY : r.status === 401 ? 'That email and password don’t match.' : r.data.message || GENERIC);
      });
    },
    signup: function (form, v) {
      if ((v.password || '').length < 8) return alertBox(form, 'down', 'Use at least 8 characters for the password.');
      busy(form, true, 'Creating your account…');
      post('/auth/sign-up', v).then(function (r) {
        if (r.status === 200) { done(form, r.data.instant ? 'You’re in. Opening your desk…' : 'Account created', function () { location.href = r.data.redirect || '/app'; }); return; }
        busy(form, false);
        alertBox(form, 'down', r.status === 409 ? 'An account with this email already exists. <a class="link" href="/signin">Sign in</a> instead, or <a class="link" href="/forgot">reset the password</a>.'
          : r.status === 429 ? TOO_MANY : r.data.message || GENERIC);
      });
    },
    forgot: function (form, v) {
      busy(form, true, 'Sending…');
      post('/auth/forgot', v).then(function (r) {
        busy(form, false);
        if (r.status === 429) return alertBox(form, 'down', TOO_MANY);
        alertBox(form, 'up', 'If an account exists for <b>' + escHtml(v.email) + '</b>, a reset link is on its way. It works for 1 hour.');
        form.hidden = true;
      });
    },
    reset: function (form, v) {
      if ((v.password || '').length < 8) return alertBox(form, 'down', 'Use at least 8 characters.');
      if (v.password !== v.password2) return alertBox(form, 'down', 'The two passwords don’t match.');
      busy(form, true, 'Saving…');
      post('/auth/reset', { token: v.token, password: v.password }).then(function (r) {
        if (r.status === 200) { done(form, 'Password saved', function () { location.href = '/signin?reset=1'; }); return; }
        busy(form, false);
        alertBox(form, 'down', r.status === 400 ? 'This reset link has expired or was already used. <a class="link" href="/forgot">Ask for a new one</a>.' : r.status === 429 ? TOO_MANY : GENERIC);
      });
    },
    key: function (form, v) {
      busy(form, true, 'Checking…');
      post('/auth/key', { key: v.key }).then(function (r) {
        if (r.status === 200) { store.set('sc_key', v.key); location.reload(); return; }
        busy(form, false);
        alertBox(form, 'down', r.status === 401 ? 'That key doesn’t match the dashboard key.' : r.status === 429 ? TOO_MANY : GENERIC);
      });
    },
  };
  $$('form[data-form]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var h = handlers[form.dataset.form];
      if (h) h(form, values(form));
    });
  });

  // live hint: password length on sign-up
  $$('input[data-minlen]').forEach(function (i) {
    if (i.closest('.field').querySelector('[data-pw-meter]')) return;   // the strength meter handles it
    var hint = i.closest('.field').querySelector('.hint');
    i.addEventListener('input', function () {
      var short = i.value.length > 0 && i.value.length < +i.dataset.minlen;
      i.setAttribute('aria-invalid', short ? 'true' : 'false');
      if (hint) { hint.classList.toggle('err', short); hint.textContent = short ? 'At least ' + i.dataset.minlen + ' characters' : hint.dataset.text; }
    });
  });

  // sign out
  $$('[data-signout]').forEach(function (b) {
    b.addEventListener('click', function () { post('/auth/sign-out').then(function () { location.href = '/'; }); });
  });

  // admin gate: a dashboard key already saved on this device signs in by itself
  var auto = $('[data-autokey]');
  if (auto) {
    var k = store.get('sc_key');
    if (k) {
      auto.hidden = false;
      post('/auth/key', { key: k }).then(function (r) {
        if (r.status === 200) location.reload();
        else { auto.hidden = true; if (r.status === 401) alertBox($('form[data-form=key]'), 'down', 'The dashboard key saved on this device no longer matches. Enter the current one.'); }
      });
    }
  }

  // landing: a visitor who used the old dashboard here gets pointed at its new address
  if ($('[data-landing]') && !$('[data-signed-in]') && store.get('sc_key') && !store.get('rd-moved-seen')) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span>Your trading dashboard moved into the new desk (the classic page is still there).</span><a class="btn btn-primary btn-sm" href="/dashboard">Open it</a><button type="button" class="icon-btn" aria-label="Dismiss">✕</button>';
    document.body.appendChild(t);
    $('button', t).addEventListener('click', function () { store.set('rd-moved-seen', '1'); t.remove(); });
  }

  // ===================================================================== auth pages: motion and small helpers
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function shake(el) {
    if (!el || calm) return;
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    el.addEventListener('animationend', function f() { el.classList.remove('shake'); el.removeEventListener('animationend', f); });
  }
  var TICK = '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  /** The submit button turns green with a tick, then `then` runs (the redirect). */
  function done(form, label, then) {
    var b = $('button[type=submit]', form);
    if (b) { b.classList.remove('is-busy'); b.classList.add('is-done'); b.innerHTML = TICK + '<span>' + escHtml(label) + '</span>'; }
    setTimeout(then, calm ? 120 : 650);
  }

  // moving between sign-in / sign-up / forgot keeps the right-hand panel still (see the inline script in authShell)
  if ($('.auth')) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.origin !== location.origin || !/^\/(signin|signup|forgot)$/.test(a.pathname)) return;
      try { sessionStorage.setItem('rd-auth-nav', String(Date.now())); } catch (er) { /* private window */ }
    });
  }

  // password strength (new passwords): four bars and a plain-words hint
  var COMMON = /^(password1?|passw0rd|12345678+9?0?|123456789|qwerty(uiop|123)?|11111111|iloveyou|abc12345|admin123|letmein1?|welcome1?|bitcoin1?|trading1?)$/i;
  function strength(p) {
    if (!p) return 0;
    if (p.length < 8) return 1;
    var kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(function (r) { return r.test(p); }).length;
    if (COMMON.test(p) || /^(.)\1+$/.test(p) || (kinds < 2 && p.length < 12)) return 2;
    if (p.length >= 16 || (p.length >= 12 && kinds >= 3)) return 4;
    return p.length >= 12 || kinds >= 3 ? 3 : 2;
  }
  var SAY = ['', 'At least 8 characters', 'Okay, but easy to guess. A short sentence is stronger.', 'Good password', 'Strong password'];
  $$('[data-pw-meter]').forEach(function (m) {
    var f = m.closest('.field'), i = $('input', f), hint = $('.hint', f);
    i.addEventListener('input', function () {
      var s = strength(i.value);
      m.dataset.s = String(s);
      i.setAttribute('aria-invalid', s === 1 ? 'true' : 'false');
      if (hint) { hint.textContent = s ? SAY[s] : hint.dataset.text; hint.classList.toggle('err', s === 1); hint.classList.toggle('ok', s >= 3); }
    });
  });

  // Caps Lock warning on password boxes
  $$('.auth input[type=password]').forEach(function (i) {
    var note = null;
    function check(e) {
      var on = e.getModifierState && e.getModifierState('CapsLock');
      if (on && !note) { note = document.createElement('p'); note.className = 'caps'; note.textContent = '⇪ Caps Lock is on'; i.closest('.input-wrap').insertAdjacentElement('afterend', note); }
      else if (!on && note) { note.remove(); note = null; }
    }
    i.addEventListener('keydown', check); i.addEventListener('keyup', check);
    i.addEventListener('blur', function () { if (note) { note.remove(); note = null; } });
  });

  // "did you mean …@gmail.com?" for a mistyped email domain
  var DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'yandex.com', 'gmx.com', 'mail.com', 'ymail.com', 'msn.com'];
  function dist(a, b) {
    var d = []; for (var x = 0; x <= a.length; x++) { d[x] = [x]; } for (var y = 1; y <= b.length; y++) d[0][y] = y;
    for (x = 1; x <= a.length; x++) for (y = 1; y <= b.length; y++) d[x][y] = Math.min(d[x - 1][y] + 1, d[x][y - 1] + 1, d[x - 1][y - 1] + (a[x - 1] === b[y - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  $$('.auth input[type=email]').forEach(function (i) {
    var box = null;
    i.addEventListener('blur', function () {
      if (box) { box.remove(); box = null; }
      var v = i.value.trim().toLowerCase(), at = v.lastIndexOf('@');
      if (at < 1) return;
      var dom = v.slice(at + 1);
      if (!dom || DOMAINS.indexOf(dom) >= 0) return;
      var best = null, bd = 3;
      DOMAINS.forEach(function (d) { var k = dist(dom, d); if (k < bd) { bd = k; best = d; } });
      if (!best || bd > 2) return;
      var fix = v.slice(0, at + 1) + best;
      box = document.createElement('p'); box.className = 'typo';
      box.innerHTML = 'Did you mean <button type="button">' + escHtml(fix) + '</button>?';
      $('button', box).addEventListener('click', function () { i.value = fix; box.remove(); box = null; i.focus(); });
      i.closest('.input-wrap').insertAdjacentElement('afterend', box);
    });
  });

  // ---- the replay card: a scripted replay that loops (downtrend, liquidity, sweep, CHoCH, paper long, target) ----
  var ra = $('[data-ra]');
  if (ra) (function () {
    var svg = $('[data-ra-svg]', ra), toast = $('[data-ra-toast]', ra), bar = $('[data-ra-bar]', ra), clock = $('[data-ra-clock]', ra);
    var K = [[77, 79, 75, 76], [76, 77, 72, 73], [73, 75, 71, 74], [74, 74.5, 69, 70], [70, 71, 66, 67], [67, 69.5, 66, 69], [69, 70, 64, 65], [65, 66, 61, 62],
      [62, 64.5, 61, 64], [64, 65, 59, 60], [60, 61, 56, 57], [57, 59.5, 56, 59], [59, 60.5, 57, 58], [58, 58.5, 53, 54], [54, 55, 50, 51], [51, 52, 47.5, 48],
      [48, 49, 44.5, 45.5], [45.5, 50.5, 45, 50], [50, 50.2, 46, 46.5], [46.5, 47, 43, 44], [44, 45, 40.5, 41.5], [41.5, 44.5, 41, 44], [44, 46, 43, 43.5],
      [43.5, 44, 41.5, 42.5], [42.5, 43, 37, 41.8], [41.8, 45.5, 41.5, 45], [45, 49, 44.5, 48.5], [48.5, 52.5, 48, 52], [52, 53, 49.5, 50], [50, 50.8, 47.8, 48.4],
      [48.4, 51, 48, 50.5], [50.5, 54, 50, 53.5], [53.5, 55, 52, 54], [54, 58, 53.5, 57.5], [57.5, 59, 55.5, 56], [56, 60.5, 55.5, 60], [60, 63, 59, 62.5],
      [62.5, 64, 60.5, 61], [61, 65.5, 60.5, 65], [65, 68, 64, 67.5], [67.5, 69, 65.5, 66.5], [66.5, 71, 66, 70.5], [70.5, 73.5, 69.5, 72.8], [72.8, 74, 71, 72]];
    var N = K.length, START = 8, LOW = 40.5, LH = 50.5, ENTRY = 48.4, STOP = 36.5, TGT = 72.2;
    var X = function (i) { return 10 + i * 9.6; }, Y = function (v) { return 12 + (80 - v) * (176 / 46); };
    var px = function (v) { return (56800 + v * 40).toLocaleString('en-US', { maximumFractionDigits: 0 }); };
    var NS = 'http://www.w3.org/2000/svg';
    function el(tag, attrs, style, cls) {
      var e = document.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      for (var s in (style || {})) e.style[s] = style[s];
      if (cls) e.setAttribute('class', cls);
      svg.appendChild(e); return e;
    }
    function text(x, y, t, color, anchor, cls) { var e = el('text', { x: x, y: y, 'text-anchor': anchor || 'start' }, { fill: color }, 'ra-txt ' + (cls || '')); e.textContent = t; return e; }
    function candle(i, anim) {
      var k = K[i], up = k[3] >= k[0], col = up ? 'var(--up)' : 'var(--down)', x = X(i);
      var g = el('g', {}, {}, anim ? 'ra-c' : '');
      var w = document.createElementNS(NS, 'line'); w.setAttribute('x1', x); w.setAttribute('x2', x); w.setAttribute('y1', Y(k[1])); w.setAttribute('y2', Y(k[2])); w.style.stroke = col; w.style.strokeWidth = '1.2'; g.appendChild(w);
      var b = document.createElementNS(NS, 'rect'), top = Y(Math.max(k[0], k[3]));
      b.setAttribute('x', x - 3); b.setAttribute('width', 6); b.setAttribute('y', top); b.setAttribute('height', Math.max(1.5, Y(Math.min(k[0], k[3])) - top)); b.setAttribute('rx', 1);
      b.style.fill = col; g.appendChild(b);
    }
    function say(html) { toast.innerHTML = html; toast.classList.add('on'); }
    // what appears when candle i has printed (f = fade in)
    function events(i, f) {
      var c = f ? 'ra-f' : '';
      if (i === 23) {   // the low at 20 is now a confirmed swing: resting stops under it
        el('line', { x1: X(20), x2: 440, y1: Y(LOW), y2: Y(LOW) }, { stroke: 'var(--warn)', strokeWidth: '1', strokeDasharray: '3 4' }, c);
        text(436, Y(LOW) - 4, 'liquidity', 'var(--warn)', 'end', c);
      }
      if (i === 24) {
        el('circle', { cx: X(24), cy: Y(37), r: 5 }, { fill: 'none', stroke: 'var(--warn)', strokeWidth: '1.4' }, c);
        text(X(24), Y(37) + 15, 'sweep', 'var(--warn)', 'middle', c);
        if (f) say('<span class="dot" style="background:var(--warn)"></span>Liquidity swept · the wick closed back above');
      }
      if (i === 27) {
        el('line', { x1: X(17), x2: X(27), y1: Y(LH), y2: Y(LH) }, { stroke: 'var(--primary)', strokeWidth: '1.4' }, c);
        text((X(17) + X(27)) / 2, Y(LH) - 5, 'CHoCH', 'var(--primary)', 'middle', c);
        if (f) say('<span class="dot"></span>CHoCH ↑ · structure turned up');
      }
      if (i === 29) {
        el('rect', { x: X(29), width: 440 - X(29), y: Y(TGT), height: Y(ENTRY) - Y(TGT) }, { fill: 'color-mix(in oklab, var(--up) 14%, transparent)' }, c);
        el('rect', { x: X(29), width: 440 - X(29), y: Y(ENTRY), height: Y(STOP) - Y(ENTRY) }, { fill: 'color-mix(in oklab, var(--down) 13%, transparent)' }, c);
        el('line', { x1: X(29), x2: 440, y1: Y(ENTRY), y2: Y(ENTRY) }, { stroke: 'var(--text-2)', strokeWidth: '1', strokeDasharray: '2 3' }, c);
        text(X(29) + 5, Y(TGT) + 11, 'target ' + px(TGT), 'var(--up)', 'start', c);
        text(X(29) + 5, Y(STOP) - 4, 'stop ' + px(STOP), 'var(--down)', 'start', c);
        if (f) say('<span class="dot" style="background:var(--up)"></span>Paper long ' + px(ENTRY) + ' · stop under the sweep');
      }
      if (i === 42 && f) say('<span class="dot" style="background:var(--up)"></span>Target hit · <b class="up">+2.0R</b> · saved to your journal');
    }
    function foot(i) {
      bar.style.width = ((i + 1) / N * 100).toFixed(1) + '%';
      var t = Date.UTC(2026, 10, 21, 2, 0) + i * 300e3, d = new Date(t);
      clock.textContent = '21 Nov · ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    }
    function drawTo(n) {   // candles 0..n at once (no animation)
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      for (var i = 0; i <= n; i++) { candle(i, false); events(i, false); }
      foot(n);
    }
    var i = START, timer = null;
    function step() {
      timer = null;
      if (i >= N - 1) {   // hold, rewind, start again
        timer = setTimeout(function () {
          ra.classList.add('rewind'); toast.classList.remove('on');
          timer = setTimeout(function () { i = START; drawTo(i); ra.classList.remove('rewind'); say('<span class="dot"></span>Rewind · same coin, try it again'); timer = setTimeout(step, 1600); }, 480);
        }, 2600);
        return;
      }
      i++; candle(i, true); events(i, true); foot(i);
      if (i === 25 || i === 30) toast.classList.remove('on');
      timer = setTimeout(step, [24, 27, 29, 42].indexOf(i) >= 0 ? 1400 : 260);
    }
    if (calm) { drawTo(N - 1); say('<span class="dot" style="background:var(--up)"></span>Target hit · <b class="up">+2.0R</b> · saved to your journal'); return; }
    try { var s = JSON.parse(sessionStorage.getItem('rd-ra') || 'null'); if (s && Date.now() - s.t < 8000 && s.i >= START && s.i < N - 1) i = s.i; } catch (e) { /* none */ }
    drawTo(i);
    timer = setTimeout(step, 500);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (timer) { clearTimeout(timer); timer = null; } }
      else if (!timer && !ra.classList.contains('rewind')) timer = setTimeout(step, 300);
    });
    window.addEventListener('pagehide', function () { try { sessionStorage.setItem('rd-ra', JSON.stringify({ i: i, t: Date.now() })); } catch (e) { /* private */ } });
    window.__rdRa = { get i() { return i; }, N: N };   // tests
  })();

})();
