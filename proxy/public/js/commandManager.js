// Per-toy command manager. Both the mouse controls and the gamepad jog-
// wheel (spec §8) drive levels through this single module so throttling,
// combined-action batching (spec §7), and the bounded-hold renewal
// (spec §9) only exist in one place.
//
// Critical rule from spec §7: to move two motors of one toy independently
// you must send ONE combined action string per toy, not one command per
// motor — a second default command would stopPrevious-cancel the first.
// So every send for a toy includes ALL of that toy's current motor
// levels, not just the one that changed.

const CommandManager = (() => {
  const toys = new Map(); // toyId -> state

  let cfg = {
    minCommandIntervalMs: 350,
    holdSeconds: 12,
    renewalFactor: 0.66,
  };

  function configure(serverConfig) {
    cfg = { ...cfg, ...serverConfig.safety };
  }

  function registerToy(toyId, motors) {
    const existing = toys.get(toyId);
    if (existing) {
      // Reconcile against the freshly-resolved motor list (harvest/calibrate
      // can change a toy's motors between renders): keep levels for actions
      // still present, default new ones to 0, drop ones that disappeared.
      existing.motors = motors;
      existing.levels = Object.fromEntries(
        motors.map((m) => [m.action, existing.levels[m.action] ?? 0])
      );
      existing.lastSentBuckets = Object.fromEntries(
        motors.map((m) => [m.action, existing.lastSentBuckets[m.action] ?? null])
      );
      return existing;
    }
    const state = {
      motors, // [{ action, maxSteps, type }]
      levels: Object.fromEntries(motors.map((m) => [m.action, 0])),
      lastSentBuckets: Object.fromEntries(motors.map((m) => [m.action, null])),
      lastSentTime: 0,
      renewalTimer: null,
      onLevelChange: null, // UI hook: (action, level) => void
      contactLost: false,
    };
    toys.set(toyId, state);
    return state;
  }

  function getState(toyId) {
    return toys.get(toyId);
  }

  function clamp(level, motor) {
    const max = motor.maxSteps ?? 20;
    return Math.max(0, Math.min(max, level));
  }

  // Sets an absolute level for one motor (used by mouse drag/scroll and
  // +/- buttons). Buckets are integers — hardware resolution is stepped,
  // see spec §7.
  function setLevel(toyId, action, rawLevel) {
    const state = toys.get(toyId);
    if (!state) return;
    const motor = state.motors.find((m) => m.action === action);
    if (!motor) return;
    const level = Math.round(clamp(rawLevel, motor));
    if (level === state.levels[action]) return;
    state.levels[action] = level;
    if (state.onLevelChange) state.onLevelChange(action, level);
    maybeSend(toyId);
  }

  function nudgeLevel(toyId, action, delta) {
    const state = toys.get(toyId);
    if (!state) return;
    setLevel(toyId, action, state.levels[action] + delta);
  }

  // Only emits on bucket change AND after the per-toy throttle interval,
  // per spec §8's pseudocode. Skips silently if any bucket didn't
  // actually change and nothing is stale enough to need a renewal.
  function maybeSend(toyId) {
    const state = toys.get(toyId);
    if (!state || state.contactLost) return;

    const now = performance.now();
    if (now - state.lastSentTime < cfg.minCommandIntervalMs) {
      // Re-check shortly after the throttle window so a rapid drag still
      // lands its final bucket instead of being dropped.
      clearTimeout(state.pendingRetry);
      state.pendingRetry = setTimeout(() => maybeSend(toyId), cfg.minCommandIntervalMs);
      return;
    }

    const changed = state.motors.some(
      (m) => state.lastSentBuckets[m.action] !== state.levels[m.action]
    );
    if (!changed) return;

    sendNow(toyId);
  }

  async function sendNow(toyId) {
    const state = toys.get(toyId);
    if (!state) return;

    const actions = state.motors.map((m) => ({ action: m.action, level: state.levels[m.action] }));
    state.lastSentTime = performance.now();
    state.motors.forEach((m) => {
      state.lastSentBuckets[m.action] = state.levels[m.action];
    });

    try {
      const res = await fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toyId, actions, timeSec: cfg.holdSeconds }),
      });
      const data = await res.json();
      window.PanelEvents?.onCommandResult(toyId, data);
      ensureRenewal(toyId);
    } catch (err) {
      window.PanelEvents?.onContactLost(toyId);
    }
  }

  // Spec §9: re-send the current combined level every holdSeconds *
  // renewalFactor so the toy never lapses while the panel is alive.
  function ensureRenewal(toyId) {
    const state = toys.get(toyId);
    if (!state || state.renewalTimer) return;
    const intervalMs = cfg.holdSeconds * cfg.renewalFactor * 1000;
    state.renewalTimer = setInterval(() => {
      if (state.contactLost) return;
      sendNow(toyId);
    }, intervalMs);
  }

  function stopRenewal(toyId) {
    const state = toys.get(toyId);
    if (!state) return;
    if (state.renewalTimer) clearInterval(state.renewalTimer);
    state.renewalTimer = null;
  }

  function zeroToy(toyId) {
    const state = toys.get(toyId);
    if (!state) return;
    state.motors.forEach((m) => {
      state.levels[m.action] = 0;
      state.lastSentBuckets[m.action] = 0;
      if (state.onLevelChange) state.onLevelChange(m.action, 0);
    });
  }

  // Panic Stop (spec §9): send Stop to every toy, cancel every renewal.
  async function panicStopAll() {
    for (const toyId of toys.keys()) {
      stopRenewal(toyId);
      zeroToy(toyId);
    }
    try {
      await fetch('/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (err) {
      // best-effort; the bounded hold (spec §9) is the real safety net
    }
  }

  // Best-effort stop on tab close / hide — bonus only, per spec §9.
  function bestEffortStopAll() {
    for (const toyId of toys.keys()) {
      const actions = [{ action: 'Stop', level: 0 }];
      try {
        navigator.sendBeacon?.(
          '/stop',
          new Blob([JSON.stringify({ toyId })], { type: 'application/json' })
        );
      } catch (err) {
        // ignore — unload-time network calls are unreliable, per spec §9
      }
    }
  }

  function setContactLost(toyId, lost) {
    const state = toys.get(toyId);
    if (!state) return;
    state.contactLost = lost;
  }

  return {
    configure,
    registerToy,
    getState,
    setLevel,
    nudgeLevel,
    stopRenewal,
    zeroToy,
    panicStopAll,
    bestEffortStopAll,
    setContactLost,
    listToyIds: () => Array.from(toys.keys()),
  };
})();

window.CommandManager = CommandManager;
