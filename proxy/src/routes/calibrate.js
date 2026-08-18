// Tier 3 (spec §6): guided calibration. The panel pulses each motor in
// turn and asks the user what they felt/where; the confirmed layout is
// saved here as ground truth (source: "calibration", the highest-trust
// tier short of a proven server capability call).

const express = require('express');
const deviceProfiles = require('../deviceProfiles');

const router = express.Router();

router.post('/calibrate', (req, res) => {
  const { toyId, name, motors } = req.body || {};
  if (!toyId || !Array.isArray(motors) || motors.length === 0) {
    return res.status(400).json({ error: 'toyId and a non-empty motors array are required' });
  }
  const profile = deviceProfiles.saveCalibratedProfile(toyId, name || 'unknown', motors);
  res.json({ profile });
});

module.exports = router;
