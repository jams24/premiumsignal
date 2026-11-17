// Account emails (confirm address, reset password) through Resend's HTTP API — no extra package.
// RESEND_API_KEY + EMAIL_FROM set → real email. WEB_DEV_MAIL=1 (local tests only) → the link is written to the log.
// Neither → mail.ready() is false and the site does not offer sign-up (the admin can still use the dashboard key).
const logger = require('../../utils/logger');
const { SITE, esc } = require('./html');

const ready = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) || process.env.WEB_DEV_MAIL === '1';

function shell(title, body, cta, url, foot) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0e1320">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;border:1px solid #e6e9f0">
<tr><td style="padding:28px 28px 0"><span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#4f7cff,#8b5cf6);vertical-align:middle"></span>
<span style="font-weight:600;font-size:17px;vertical-align:middle;margin-left:8px">${esc(SITE.name)}</span></td></tr>
<tr><td style="padding:20px 28px 8px"><h1 style="margin:0 0 10px;font-size:21px">${esc(title)}</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#3d4659">${body}</p></td></tr>
<tr><td style="padding:18px 28px 6px"><a href="${esc(url)}" style="display:inline-block;background:#3461f5;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(cta)}</a></td></tr>
<tr><td style="padding:14px 28px 28px;font-size:12.5px;line-height:1.6;color:#6b7486">${foot}<br>If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${esc(url)}</span></td></tr>
</table><p style="font-size:12px;color:#8a92a3;margin:16px 0 0">${esc(SITE.name)} · paper trading and education only</p></td></tr></table></body></html>`;
}

async function send(to, subject, html, link) {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`resend ${r.status}`);
    return;
  }
  if (process.env.WEB_DEV_MAIL === '1') { logger.info(`[email:dev] to=${to} subject="${subject}" link=${link}`); return; }
  throw new Error('email not configured');
}

const sendVerify = (to, name, url) => send(to, `Confirm your ${SITE.name} email`,
  shell('Confirm your email', `Hi ${esc(name || 'there')}, tap the button to confirm this address and open your desk.`, 'Confirm email', url,
    'The link works for 24 hours. If you didn\'t sign up, ignore this email.'), url);

const sendReset = (to, url) => send(to, `Reset your ${SITE.name} password`,
  shell('Reset your password', 'Someone (hopefully you) asked to reset the password for this account.', 'Choose a new password', url,
    'The link works for 1 hour and only once. If you didn\'t ask, ignore this email: your password stays the same.'), url);

module.exports = { ready, sendVerify, sendReset };
