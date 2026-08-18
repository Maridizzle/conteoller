const express = require('express');
const lovense = require('../lovense');

const router = express.Router();

// Body: { toyId? } — omit toyId to stop every paired toy (spec §7: the
// server's `toy` param is omit-for-all).
router.post('/stop', async (req, res) => {
  const { toyId } = req.body || {};
  try {
    const result = await lovense.sendStop(toyId);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: 'stop failed', detail: err.message });
  }
});

module.exports = router;
