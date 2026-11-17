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
  }
  var escHtml = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function busy(form, on, label) {
    var b = $('button[type=submit]', form);
    if (!b) return;
    if (on) { b.dataset.label = b.innerHTML; b.textContent = label; b.classList.add('is-busy'); }
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
        if (r.status === 200) { location.href = r.data.redirect || '/app'; return; }
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
        if (r.status === 200) { location.href = r.data.redirect; return; }
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
        if (r.status === 200) { location.href = '/signin?reset=1'; return; }
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
})();
