const express = require('express');
const config = require('../config');

const router = express.Router();

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'password required' });
  }
  if (password !== config.panel.password) {
    return res.status(401).json({ error: 'invalid password' });
  }
  req.session.authed = true;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

module.exports = router;
