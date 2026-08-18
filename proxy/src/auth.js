// Spec §5 auth note: an open command route on a public Railway URL is a
// public route. Two ways in:
//   1. Browser session — PANEL_PASSWORD login sets an httpOnly cookie.
//   2. Server-to-server — X-Panel-Api-Key header matching PANEL_API_KEY.
// PANEL_API_KEY must never be embedded in client-side JS (see public/js —
// it never appears there); it exists for non-browser automation only.

const config = require('./config');

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();

  const key = req.get('X-Panel-Api-Key');
  if (config.panel.apiKey && key && timingSafeEqual(key, config.panel.apiKey)) {
    return next();
  }

  return res.status(401).json({ error: 'unauthorized' });
}

function timingSafeEqual(a, b) {
  const crypto = require('crypto');
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { requireAuth };
