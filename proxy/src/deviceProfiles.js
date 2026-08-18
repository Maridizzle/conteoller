// Spec §6: tiered device discovery, decoupled from control transport.
// Every tier writes into one profile store keyed by stable toy ID, so
// discovery cost is paid once per device, not once per session.
//
// Tier 0 — server capability call, if Step 0 item 4 proves it exists.
// Tier 1 — one-time local LAN harvest (primary source of truth).
// Tier 2 — static catalog lookup by reported name (src/catalog.js).
// Tier 3 — guided calibration (ground truth verifier + last resort).

const store = require('./store');
const catalog = require('./catalog');
const config = require('./config');

const COLLECTION = 'deviceProfiles';
const INDEXED_ACTION_RE = /^(Vibrate|Rotate|Pump)(\d+)$/;

function allProfiles() {
  return store.readJson(COLLECTION, {});
}

function getProfile(toyId) {
  return allProfiles()[toyId] || null;
}

function saveProfile(toyId, profile) {
  const all = allProfiles();
  all[toyId] = { ...profile, toyId, updatedAt: new Date().toISOString() };
  store.writeJson(COLLECTION, all);
  return all[toyId];
}

// If the server path turns out not to accept per-motor indexed actions
// (Step 0 item 2, config.lovense.supportsPerMotor === false), a profile
// built around Vibrate1/Vibrate2 is not controllable as designed. Collapse
// it to a single combined channel rather than silently sending commands
// that may only ever hit motor 1 (or be rejected outright).
function applyTransportConstraints(profile) {
  if (config.lovense.supportsPerMotor) return profile;
  const indexed = profile.motors.filter((m) => INDEXED_ACTION_RE.test(m.action));
  if (indexed.length < 2) return profile;

  return {
    ...profile,
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Combined (per-motor unsupported)' }],
    transportFallback: true,
  };
}

// toy: the payload as reported by /toys (from the callback cache), e.g.
// { id, name, status, nickName, serverCapabilities? }
function resolveProfile(toy) {
  const existing = getProfile(toy.id);

  // Tier 3 calibration and Tier 1 harvest results are ground-truth for
  // this exact device; never let a lower tier overwrite them.
  if (existing && (existing.source === 'calibration' || existing.source === 'harvest')) {
    return applyTransportConstraints(existing);
  }

  // Tier 0 — only real if the callback/toys payload actually carries
  // capability data. [MUST CONFIRM, Step 0 item 4]. Until proven, this is
  // dead code in practice — serverCapabilities will not be present.
  if (toy.serverCapabilities && toy.serverCapabilities.motors) {
    const profile = {
      name: toy.name,
      motorCount: toy.serverCapabilities.motors.length,
      motors: toy.serverCapabilities.motors,
      source: 'server',
      verifiedByCalibration: false,
    };
    saveProfile(toy.id, profile);
    return applyTransportConstraints(profile);
  }

  // Tier 1 already-harvested / Tier 2 already-cataloged from a prior run.
  if (existing) return applyTransportConstraints(existing);

  // Tier 2 — catalog lookup by reported name.
  const cataloged = catalog.lookup(toy.name);
  if (cataloged) {
    const profile = {
      name: toy.name,
      motorCount: cataloged.motorCount,
      motors: cataloged.motors,
      source: 'catalog',
      verifiedByCalibration: false,
    };
    saveProfile(toy.id, profile);
    return applyTransportConstraints(profile);
  }

  // Tier 3 fallback — unknown toy, no harvest yet. Assume a single
  // vibrate channel (the safe universal default) until harvest or
  // calibration proves otherwise.
  const fallback = {
    name: toy.name,
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Vibration (unverified)' }],
    source: 'fallback',
    verifiedByCalibration: false,
  };
  saveProfile(toy.id, fallback);
  return applyTransportConstraints(fallback);
}

// Called by the /harvest route with a client-side LAN GetToys result.
function saveHarvestedProfile(toyId, name, motors) {
  const profile = {
    name,
    motorCount: motors.length,
    motors,
    source: 'harvest',
    verifiedByCalibration: false,
  };
  return saveProfile(toyId, profile);
}

// Called by the /calibrate route once the user has confirmed, motor by
// motor, what they actually felt.
function saveCalibratedProfile(toyId, name, motors) {
  const profile = {
    name,
    motorCount: motors.length,
    motors,
    source: 'calibration',
    verifiedByCalibration: true,
  };
  return saveProfile(toyId, profile);
}

module.exports = {
  getProfile,
  saveProfile,
  resolveProfile,
  saveHarvestedProfile,
  saveCalibratedProfile,
  allProfiles,
};
