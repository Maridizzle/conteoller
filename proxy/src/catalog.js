// Tier 2 catalog (spec §6): static name -> motor layout table. Source is
// community knowledge (buttplugio/buttplug-device-config and general
// Lovense product docs), NOT Lovense's own server API. [COMMUNITY] — treat
// as a strong lead, not gospel, and prefer a harvested (Tier 1) or
// server-reported (Tier 0) profile whenever one exists.
//
// Keyed by the lowercased `name` field Lovense reports for a toy.

const CATALOG = {
  // Two independent vibrators (internal + perineum/clitoral arm).
  edge: {
    motorCount: 2,
    motors: [
      { action: 'Vibrate1', type: 'Vibrate', label: 'Internal' },
      { action: 'Vibrate2', type: 'Vibrate', label: 'Perineum arm' },
    ],
  },
  // Spec's own worked example toy — two vibrators.
  dolce: {
    motorCount: 2,
    motors: [
      { action: 'Vibrate1', type: 'Vibrate', label: 'Motor 1' },
      { action: 'Vibrate2', type: 'Vibrate', label: 'Motor 2' },
    ],
  },
  nora: {
    motorCount: 2,
    motors: [
      { action: 'Vibrate', type: 'Vibrate', label: 'Vibration' },
      { action: 'Rotate', type: 'Rotate', label: 'Rotation' },
    ],
  },
  max: {
    motorCount: 2,
    motors: [
      { action: 'Vibrate', type: 'Vibrate', label: 'Vibration' },
      { action: 'Pump', type: 'Pump', label: 'Air chamber' },
    ],
  },
  lush: {
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Vibration' }],
  },
  hush: {
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Vibration' }],
  },
  domi: {
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Vibration' }],
  },
  ferri: {
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Vibration' }],
  },
  gush: {
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Vibration' }],
  },
  osci: {
    motorCount: 1,
    motors: [{ action: 'Vibrate', type: 'Vibrate', label: 'Oscillation' }],
  },
};

function lookup(name) {
  if (!name) return null;
  const entry = CATALOG[name.trim().toLowerCase()];
  return entry ? { ...entry, source: 'catalog' } : null;
}

module.exports = { lookup, CATALOG };
