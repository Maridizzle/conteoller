// Non-secret tunables the panel's JS needs at runtime (throttle, hold
// duration, deadzone, hardware ranges). Gated behind requireAuth same as
// everything else even though none of it is sensitive, just to keep one
// consistent auth boundary.

const express = require('express');
const config = require('../config');

const router = express.Router();

router.get('/config', (req, res) => {
  res.json({
    safety: config.safety,
    gamepad: config.gamepad,
    actionRanges: config.actionRanges,
  });
});

module.exports = router;
