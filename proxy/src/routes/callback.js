// Public route — registered as the Callback URL in the Lovense developer
// dashboard (spec §4/§5). Lovense's Remote app calls this, not the panel,
// so it deliberately carries no auth middleware. Payload per spec §4/§6:
// toy list (name, id, status, nickName) plus connection domain/ports and
// utoken [VERIFIED / first-party for the toy fields; exact envelope shape
// can vary by app version, so this normalizes defensively].

const express = require('express');
const store = require('../store');

const router = express.Router();
const COLLECTION = 'toysCache';

function normalizeToys(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
}

router.post('/callback', (req, res) => {
  const body = req.body || {};
  const toys = normalizeToys(body.toys);

  store.writeJson(COLLECTION, {
    toys,
    domain: body.domain,
    httpPort: body.httpPort,
    httpsPort: body.httpsPort,
    wsPort: body.wsPort,
    wssPort: body.wssPort,
    platform: body.platform,
    uid: body.uid,
    utoken: body.utoken,
    receivedAt: new Date().toISOString(),
  });

  res.json({ ok: true });
});

module.exports = router;
