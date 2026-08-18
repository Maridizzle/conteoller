// Central place for every value the spec tags [COMMUNITY] or [MUST CONFIRM].
// Nothing here should be treated as proven until Step 0 (spec §3) is done
// against real hardware. Confirmed values just need updating in .env.

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) {
    // eslint-disable-next-line no-console
    console.warn(`[config] ${name} is not set — related routes will fail until it is.`);
  }
  return v;
}

module.exports = {
  lovense: {
    token: required('LOVENSE_TOKEN'),
    uid: required('LOVENSE_UID'),
    salt: required('LOVENSE_SALT'),

    // [VERIFIED / first-party]
    qrUrl: process.env.LOVENSE_QR_URL || 'https://api.lovense.com/api/lan/getQrCode',

    // [COMMUNITY — MUST CONFIRM, spec Step 0 item 1]. Lovense's own README
    // is ambiguous between the LAN and server sections. This is the
    // community-reported server command endpoint; swap it the moment
    // developer.lovense.com or a live test proves otherwise.
    commandUrl: process.env.LOVENSE_COMMAND_URL || 'https://api.lovense.com/api/lan/v2/command',

    // [MUST CONFIRM, Step 0 item 2]. If per-motor actions (Vibrate1/
    // Vibrate2) turn out not to be accepted server-side, flip this to
    // false and the device profile / command builder fall back to a
    // single combined Vibrate channel per toy.
    supportsPerMotor: (process.env.LOVENSE_SUPPORTS_PER_MOTOR ?? 'true') === 'true',
  },

  panel: {
    password: required('PANEL_PASSWORD'),
    apiKey: process.env.PANEL_API_KEY || null,
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  },

  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    callbackPublicUrl: process.env.CALLBACK_PUBLIC_URL || '',
  },

  // Hardware resolution ceiling [VERIFIED / first-party] — real output
  // resolution, not an input-scheme choice. Do not raise these.
  actionRanges: {
    Vibrate: { min: 0, max: 20 },
    Rotate: { min: 0, max: 20 },
    Pump: { min: 0, max: 3 },
  },

  safety: {
    // §9: every command sends timeSec = HOLD_SECONDS, never 0. Renewals
    // re-send the current level at HOLD_SECONDS * RENEWAL_FACTOR so the
    // toy self-winds-down if the panel loses contact.
    holdSeconds: parseInt(process.env.HOLD_SECONDS || '12', 10),
    renewalFactor: 0.66,

    // [MUST CONFIRM, Step 0 item 5]. Lovense warns frequent changes cause
    // network pressure but does not publish a hard number. This is a
    // conservative starting guess, not a proven floor — tighten or loosen
    // once Step 0 is done against the real account/toys.
    minCommandIntervalMs: parseInt(process.env.MIN_COMMAND_INTERVAL_MS || '350', 10),
  },

  gamepad: {
    deadzone: 0.15,
  },
};
