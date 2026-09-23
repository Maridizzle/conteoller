// Panel shell: fetches toys/config, renders one compound dial per toy
// (mouse control per spec §10), wires Panic Stop, link flow, and error
// banners. Gamepad + harvest/calibration wiring live in their own files
// and hook into the same CommandManager / render functions via
// window.Panel*.

let actionRanges = {};
const toyMotorsById = new Map(); // toyId -> motors[] (for harvest/calibrate/gamepad UI)

// --- Compound dial: concentric rings, one per motor, each with a
// draggable "stick" (line + handle) whose distance from center sets that
// motor's level. Angle is presentation-only — CommandManager never sees
// it — stored per toy here, either one shared angle ("connected" mode,
// every ring's stick points the same direction) or one angle per motor
// ("separate" mode, each stick points wherever it was last dragged).
const dialAngleState = new Map(); // toyId -> { mode, shared, perMotor: {action: angle} }

const DIAL_VIEWBOX = 200;
const DIAL_CENTER = 100;
const OUTER_MAX_R = 88;
const RING_GAP = 26;
const HANDLE_R = 8;
// At level 0 a handle still sits HANDLE_MIN_R out from center, never
// exactly on it — otherwise every ring's handle would draw on the same
// point at rest, and only the topmost (innermost) one could ever be
// grabbed. Rings also default to different angles so two at-rest handles
// aren't stacked along the same line either. The combination is sized so
// two adjacent rings' handle circles (radius HANDLE_R) don't overlap at
// rest: chord length 2*HANDLE_MIN_R*sin(step/2) must exceed 2*HANDLE_R.
const HANDLE_MIN_R = 24;
const DEFAULT_ANGLE_STEP = Math.PI / 4; // 45°, spread between rings' resting angles
const DRAG_EPSILON = 3; // viewBox units; below this, atan2 is degenerate

function defaultAngleForRing(ringIndex) {
  return -Math.PI / 2 + ringIndex * DEFAULT_ANGLE_STEP;
}

window.PanelEvents = {
  onCommandResult(toyId, data) {
    const code = data.code ?? data.httpStatus;
    if (code === 507) {
      showBanner('offlineBanner', true);
      CommandManager.setContactLost(toyId, true);
    } else if ([501, 502, 503].includes(code)) {
      showBanner('offlineBanner', true, 'Connection not authorized. Check the proxy configuration.');
    } else if (code === 200 || data.httpStatus === 200) {
      showBanner('offlineBanner', false);
      showBanner('reconnectingBanner', false);
      CommandManager.setContactLost(toyId, false);
    }
  },
  onContactLost(toyId) {
    showBanner('reconnectingBanner', true);
    CommandManager.setContactLost(toyId, true);
    scheduleReconnectCheck();
  },
};

let reconnectTimer = null;
function scheduleReconnectCheck() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    try {
      const res = await fetch('/toys');
      if (res.ok) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
        showBanner('reconnectingBanner', false);
        CommandManager.listToyIds().forEach((id) => CommandManager.setContactLost(id, false));
      }
    } catch (err) {
      // still down, keep waiting
    }
  }, 5000);
}

function showBanner(id, show, text) {
  const el = document.getElementById(id);
  if (!el) return;
  if (text) el.textContent = text;
  el.classList.toggle('show', show);
}

async function loadConfig() {
  const res = await fetch('/config');
  const data = await res.json();
  actionRanges = data.actionRanges;
  CommandManager.configure(data);
  return data;
}

function motorMaxSteps(motor) {
  return actionRanges[motor.type]?.max ?? 20;
}

async function loadToys() {
  const res = await fetch('/toys');
  const data = await res.json();
  window.PanelState = window.PanelState || {};
  window.PanelState.lan = data.lan;
  renderToys(data.toys);
  document.getElementById('emptyState').style.display = data.toys.length ? 'none' : 'block';
  document.getElementById('linkSection').style.display = data.toys.length ? 'none' : 'block';
  return data.toys;
}

function renderToys(toys) {
  const container = document.getElementById('toysContainer');
  container.innerHTML = '';
  toyMotorsById.clear();

  toys.forEach((toy) => {
    const motors = toy.profile.motors.map((m) => ({ ...m, maxSteps: motorMaxSteps(m) }));
    toyMotorsById.set(toy.id, { name: toy.name, motors, verified: toy.profile.verifiedByCalibration });
    CommandManager.registerToy(toy.id, motors);

    const card = document.createElement('section');
    card.className = 'card toy-card';
    card.innerHTML = `
      <div class="toy-head">
        <div>
          <h2>${escapeHtml(toy.nickName || toy.name || toy.id)}</h2>
          <div class="meta">source: ${toy.profile.source}${toy.profile.transportFallback ? ' (combined — per-motor unsupported)' : ''}</div>
        </div>
        <span class="badge ${toy.status === '1' || toy.status === 1 ? 'ok' : 'warn'}">${toy.status === '1' || toy.status === 1 ? 'connected' : 'unknown'}</span>
      </div>
      <div class="dial-container"></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn secondary harvest-btn" style="width:auto;">Harvest on LAN</button>
        <button class="btn secondary calibrate-btn" style="width:auto;">${toy.profile.verifiedByCalibration ? 'Re-calibrate' : 'Calibrate'}</button>
      </div>
    `;

    const dialContainerEl = card.querySelector('.dial-container');
    dialContainerEl.appendChild(buildCompoundDial(toy.id, motors));

    card.querySelector('.harvest-btn').addEventListener('click', () => window.PanelHarvest?.run(toy.id));
    card.querySelector('.calibrate-btn').addEventListener('click', () => window.PanelCalibrate?.start(toy.id));

    container.appendChild(card);
  });

  window.PanelGamepad?.refreshChannels();
}

function ringMaxRadius(ringIndex) {
  return OUTER_MAX_R - ringIndex * RING_GAP;
}

// Angle is purely presentational (CommandManager never sees it). One
// entry per toy: a shared angle used when "connected", plus a per-motor
// angle used when "separate". Reconciled against the current motor list
// on every call so a harvest/calibrate re-render can't leave stale keys.
function getDialAngleState(toyId, motors) {
  let state = dialAngleState.get(toyId);
  if (!state) {
    state = { mode: 'separate', shared: defaultAngleForRing(0), perMotor: {} };
    dialAngleState.set(toyId, state);
  }
  const nextPerMotor = {};
  motors.forEach((m, i) => {
    nextPerMotor[m.action] = state.perMotor[m.action] ?? defaultAngleForRing(i);
  });
  state.perMotor = nextPerMotor;
  return state;
}

function angleForMotor(toyId, motor, ringIndex) {
  const state = dialAngleState.get(toyId);
  if (!state) return defaultAngleForRing(ringIndex);
  return state.mode === 'connected' ? state.shared : (state.perMotor[motor.action] ?? defaultAngleForRing(ringIndex));
}

function setAngleForMotor(toyId, motor, theta) {
  const state = dialAngleState.get(toyId);
  if (!state) return;
  if (state.mode === 'connected') state.shared = theta;
  else state.perMotor[motor.action] = theta;
}

function pointerToDialCoords(svgEl, clientX, clientY) {
  const rect = svgEl.getBoundingClientRect();
  const scaleX = DIAL_VIEWBOX / rect.width;
  const scaleY = DIAL_VIEWBOX / rect.height;
  const px = (clientX - rect.left) * scaleX;
  const py = (clientY - rect.top) * scaleY;
  return { dx: px - DIAL_CENTER, dy: py - DIAL_CENTER };
}

// The only place that ever writes a handle's on-screen position — always
// derives it from the *committed* level (never a raw drag pixel), so the
// stick always snaps to the actual bucketed/sent value.
function renderRing(toyId, ref) {
  const { motor, ringIndex, line, handle, readoutLevel } = ref;
  const state = CommandManager.getState(toyId);
  const level = state.levels[motor.action] ?? 0;
  const maxR = ringMaxRadius(ringIndex);
  const r = HANDLE_MIN_R + (level / motor.maxSteps) * (maxR - HANDLE_MIN_R);
  const angle = angleForMotor(toyId, motor, ringIndex);
  const x = DIAL_CENTER + r * Math.cos(angle);
  const y = DIAL_CENTER + r * Math.sin(angle);
  line.setAttribute('x2', x);
  line.setAttribute('y2', y);
  handle.setAttribute('cx', x);
  handle.setAttribute('cy', y);
  readoutLevel.textContent = level;
}

// Radial-pull drag: a handle's distance from center sets its motor's
// level (absolute, not the gamepad's relative/accumulating jog model).
// Re-renders every ring on the toy after each move — a no-op for
// untouched rings in "separate" mode, and exactly what rotates every
// other stick to match in "connected" mode.
function wireHandleDrag(svgEl, toyId, ref, refsList) {
  const { motor, ringIndex, handle } = ref;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const { dx, dy } = pointerToDialCoords(svgEl, e.clientX, e.clientY);
    const r = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);
    const maxR = ringMaxRadius(ringIndex);
    const rClamped = Math.max(0, Math.min(r, maxR));

    // Skip the angle write when right on top of center — atan2(0,0) is
    // degenerate and would otherwise snap the stick to angle 0.
    if (rClamped > DRAG_EPSILON) setAngleForMotor(toyId, motor, theta);

    // Inverse of renderRing's r = HANDLE_MIN_R + level-fraction * (maxR -
    // HANDLE_MIN_R): dragging inside the dead zone floors at level 0.
    const usableR = Math.max(0, rClamped - HANDLE_MIN_R);
    CommandManager.setLevel(toyId, motor.action, (usableR / (maxR - HANDLE_MIN_R)) * motor.maxSteps);
    refsList.forEach((otherRef) => renderRing(toyId, otherRef));
  });

  const endDrag = () => {
    dragging = false;
    handle.classList.remove('dragging');
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function wireScrollNudge(handle, toyId, motor) {
  handle.addEventListener('wheel', (e) => {
    e.preventDefault();
    CommandManager.nudgeLevel(toyId, motor.action, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

function wireStepButtons(row, toyId, motor) {
  row.querySelector('.plus').addEventListener('click', () => CommandManager.nudgeLevel(toyId, motor.action, 1));
  row.querySelector('.minus').addEventListener('click', () => CommandManager.nudgeLevel(toyId, motor.action, -1));
}

// Only shown for 2+ motors. Toggling never changes any level — connected
// anchors the shared angle to the outer ring's current angle; separate
// freezes each ring's current visual angle into its own slot so nothing
// snaps.
function buildConnectToggle(toyId, motors, refsList) {
  const label = document.createElement('label');
  label.className = 'dial-toggle small';
  label.innerHTML = '<input type="checkbox" class="connect-toggle" /> Connected (locked angle)';
  const input = label.querySelector('input');

  input.addEventListener('change', () => {
    const state = getDialAngleState(toyId, motors);
    if (input.checked) {
      state.shared = state.perMotor[motors[0].action] ?? defaultAngleForRing(0);
      state.mode = 'connected';
    } else {
      motors.forEach((m) => { state.perMotor[m.action] = state.shared; });
      state.mode = 'separate';
    }
    refsList.forEach((ref) => renderRing(toyId, ref));
  });

  return label;
}

// One compound dial per toy: concentric ring-tracks (outer = first motor)
// with a draggable stick per motor, plus a plain-text readout list below
// (labels live outside the SVG so they never rotate/overlap when two
// sticks share an angle in connected mode).
function buildCompoundDial(toyId, motors) {
  const wrap = document.createElement('div');
  wrap.className = 'dial-widget';

  const ringTracks = motors
    .map((_, i) => `<circle class="ring-track" cx="${DIAL_CENTER}" cy="${DIAL_CENTER}" r="${ringMaxRadius(i)}"></circle>`)
    .join('');

  const stickGroups = motors
    .map((_, i) => `
      <g class="stick-group">
        <line class="stick-line" data-ring-color="${i}" x1="${DIAL_CENTER}" y1="${DIAL_CENTER}" x2="${DIAL_CENTER}" y2="${DIAL_CENTER}"></line>
        <circle class="stick-handle" data-ring-color="${i}" cx="${DIAL_CENTER}" cy="${DIAL_CENTER}" r="${HANDLE_R}" tabindex="0"></circle>
      </g>
    `)
    .join('');

  const readoutRows = motors
    .map((motor, i) => `
      <div class="dial-readout-row">
        <span class="ring-swatch" data-ring-color="${i}"></span>
        <span class="readout-label">${escapeHtml(motor.label || motor.action)}</span>
        <span class="readout-level">0</span>
        <div class="buttons">
          <button class="minus">−</button>
          <button class="plus">+</button>
        </div>
      </div>
    `)
    .join('');

  wrap.innerHTML = `
    <svg class="compound-dial" viewBox="0 0 ${DIAL_VIEWBOX} ${DIAL_VIEWBOX}" width="220" height="220">
      ${ringTracks}
      <circle class="dial-center" cx="${DIAL_CENTER}" cy="${DIAL_CENTER}" r="3"></circle>
      ${stickGroups}
    </svg>
    <div class="dial-readouts">${readoutRows}</div>
  `;

  const svgEl = wrap.querySelector('.compound-dial');
  const stickGroupEls = Array.from(wrap.querySelectorAll('.stick-group'));
  const rowEls = Array.from(wrap.querySelectorAll('.dial-readout-row'));

  const refsList = motors.map((motor, ringIndex) => ({
    motor,
    ringIndex,
    line: stickGroupEls[ringIndex].querySelector('.stick-line'),
    handle: stickGroupEls[ringIndex].querySelector('.stick-handle'),
    row: rowEls[ringIndex],
    readoutLevel: rowEls[ringIndex].querySelector('.readout-level'),
  }));

  getDialAngleState(toyId, motors);

  refsList.forEach((ref) => {
    wireHandleDrag(svgEl, toyId, ref, refsList);
    wireScrollNudge(ref.handle, toyId, ref.motor);
    wireStepButtons(ref.row, toyId, ref.motor);
  });

  if (motors.length >= 2) wrap.appendChild(buildConnectToggle(toyId, motors, refsList));

  // Single plain assignment, not a chain — buildCompoundDial runs once
  // per toy per render, unlike the old per-motor buildWheel.
  CommandManager.getState(toyId).onLevelChange = (action, level) => {
    const ref = refsList.find((r) => r.motor.action === action);
    if (ref) renderRing(toyId, ref);
  };

  refsList.forEach((ref) => renderRing(toyId, ref)); // initial paint

  return wrap;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function handleLink() {
  const btn = document.getElementById('linkBtn');
  const resultEl = document.getElementById('linkResult');
  btn.disabled = true;
  resultEl.textContent = 'Requesting link…';
  try {
    const res = await fetch('/link', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'link failed');
    resultEl.innerHTML = `
      <img src="${data.data?.qr || data.qrCode || data.qrcode || ''}" alt="QR" />
      <div>Or enter code: <span class="link-code">${escapeHtml(data.data?.code || data.qrcodeCode || '')}</span></div>
      <p class="small">After scanning, the app will call our callback and toys will appear below.</p>
    `;
  } catch (err) {
    resultEl.textContent = `Link failed: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function wireGlobalControls() {
  document.getElementById('panicStop').addEventListener('click', () => CommandManager.panicStopAll());
  document.getElementById('linkBtn').addEventListener('click', handleLink);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) CommandManager.bestEffortStopAll();
  });
  window.addEventListener('beforeunload', () => {
    CommandManager.bestEffortStopAll();
  });
}

async function init() {
  wireGlobalControls();
  await loadConfig();
  const toys = await loadToys();
  window.PanelGamepad?.init();
  // Poll for newly-linked toys until at least one shows up.
  if (!toys.length) {
    const poll = setInterval(async () => {
      const t = await loadToys();
      if (t.length) clearInterval(poll);
    }, 4000);
  }
}

document.addEventListener('DOMContentLoaded', init);

window.PanelApp = { loadToys, toyMotorsById };
