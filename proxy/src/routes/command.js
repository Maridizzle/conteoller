const express = require('express');
const lovense = require('../lovense');
const config = require('../config');

const router = express.Router();

function baseType(action) {
  const match = /^(Vibrate|Rotate|Pump)\d*$/.exec(action);
  return match ? match[1] : null;
}

function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    return 'actions must be a non-empty array';
  }
  for (const a of actions) {
    if (!a || typeof a.action !== 'string' || typeof a.level !== 'number') {
      return 'each action needs a string action and numeric level';
    }
    const type = baseType(a.action);
    const range = type && config.actionRanges[type];
    if (!range) return `unknown action "${a.action}"`;
    if (!Number.isInteger(a.level) || a.level < range.min || a.level > range.max) {
      return `${a.action} level must be an integer between ${range.min} and ${range.max}`;
    }
  }
  return null;
}

// Body: { toyId, actions: [{ action, level }], timeSec?, stopPrevious? }
// Per spec §7/§9: callers should batch ALL of a toy's current motor levels
// into one call (stopPrevious defaults to 1, which would otherwise cancel
// a sibling motor's level) and should always rely on the default
// timeSec = HOLD_SECONDS rather than passing 0.
router.post('/command', async (req, res) => {
  const { toyId, actions, timeSec, stopPrevious } = req.body || {};

  const validationError = validateActions(actions);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const result = await lovense.sendCommand({
      toyId,
      actions,
      timeSec: timeSec ?? config.safety.holdSeconds,
      stopPrevious,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'command failed', detail: err.message });
  }
});

module.exports = router;
