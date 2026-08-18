const express = require('express');
const store = require('../store');
const deviceProfiles = require('../deviceProfiles');

const router = express.Router();

router.get('/toys', (req, res) => {
  const cache = store.readJson('toysCache', { toys: [] });
  const toys = (cache.toys || []).map((toy) => ({
    ...toy,
    profile: deviceProfiles.resolveProfile(toy),
  }));
  res.json({
    toys,
    receivedAt: cache.receivedAt || null,
    // Connection info from the last /callback, needed by the client-side
    // Tier 1 LAN harvest attempt (see public/js/harvest.js).
    lan: {
      domain: cache.domain || null,
      httpPort: cache.httpPort || null,
      httpsPort: cache.httpsPort || null,
    },
  });
});

module.exports = router;
