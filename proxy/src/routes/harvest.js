// Tier 1 (spec §6): the panel, when opened on the toy's own LAN, attempts
// a one-time LAN.js GetToys call client-side and POSTs the result here so
// it's cached forever against this toy's ID — paid once, used for every
// long-distance session after.

const express = require('express');
const deviceProfiles = require('../deviceProfiles');

const router = express.Router();

router.post('/harvest', (req, res) => {
  const { toyId, name, motors } = req.body || {};
  if (!toyId || !Array.isArray(motors) || motors.length === 0) {
    return res.status(400).json({ error: 'toyId and a non-empty motors array are required' });
  }
  const profile = deviceProfiles.saveHarvestedProfile(toyId, name || 'unknown', motors);
  res.json({ profile });
});

module.exports = router;
