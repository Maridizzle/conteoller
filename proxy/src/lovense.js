// Lovense Server API client. getQrCode/link flow is [VERIFIED / first-party]
// per spec §4. sendCommand posts to config.lovense.commandUrl, which is
// [MUST CONFIRM] — see src/config.js. Nothing else in this file should
// assume the endpoint or per-motor syntax is correct; that's Step 0's job.

const crypto = require('crypto');
const config = require('./config');

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function utoken() {
  return md5(config.lovense.uid + config.lovense.salt);
}

async function getQrCode() {
  const body = {
    token: config.lovense.token,
    uid: config.lovense.uid,
    uname: config.lovense.uid,
    utoken: utoken(),
    v: 2,
  };

  const res = await fetch(config.lovense.qrUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`getQrCode failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Builds the combined action string, e.g. "Vibrate1:8,Vibrate2:14".
// actions: [{ action: 'Vibrate1', level: 8 }, ...]
function buildActionString(actions) {
  return actions.map(({ action, level }) => `${action}:${level}`).join(',');
}

// Sends one Function command. Per spec §7, to move two motors of one toy
// independently you MUST send them as a single combined action string in
// one command — separate commands with default stopPrevious would cancel
// each other. Callers are responsible for batching all of a toy's current
// motor levels into one call.
async function sendCommand({ toyId, actions, timeSec, stopPrevious }) {
  if (!actions || !actions.length) throw new Error('sendCommand requires at least one action');

  const body = {
    token: config.lovense.token,
    uid: config.lovense.uid,
    command: 'Function',
    action: buildActionString(actions),
    timeSec: timeSec ?? config.safety.holdSeconds,
    apiVer: 1,
  };
  if (toyId) body.toy = toyId;
  if (stopPrevious !== undefined) body.stopPrevious = stopPrevious ? 1 : 0;

  return postCommand(body);
}

async function sendStop(toyId) {
  const body = {
    token: config.lovense.token,
    uid: config.lovense.uid,
    command: 'Function',
    action: 'Stop',
    timeSec: 0,
    apiVer: 1,
  };
  if (toyId) body.toy = toyId;
  return postCommand(body);
}

async function postCommand(body) {
  const res = await fetch(config.lovense.commandUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  // Lovense error codes [VERIFIED / first-party]: 200 success, 400 invalid
  // command, 404 invalid parameter, 501 invalid token, 502 no permission,
  // 503 invalid user id, 507 app offline.
  return { httpStatus: res.status, ...data };
}

module.exports = { getQrCode, sendCommand, sendStop, buildActionString, utoken };
