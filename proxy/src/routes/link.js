// Spec §4 linking flow, step 1-2: proxy asks Lovense for a QR + code; the
// user scans it (or enters the code) in the Lovense Remote app, which then
// POSTs the toy list to our public /callback route. One-time per device.

const express = require('express');
const lovense = require('../lovense');

const router = express.Router();

router.post('/link', async (req, res) => {
  try {
    const data = await lovense.getQrCode();
    res.json(data);
  } catch (err) {
    res.status(err.status || 502).json({ error: 'link failed', detail: err.data || err.message });
  }
});

module.exports = router;
