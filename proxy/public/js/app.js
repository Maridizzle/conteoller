// Panel shell: fetches toys/config, renders one concentric-arc dial per
// toy (270 deg sweep, bead-on-track), wires Panic Stop, link flow, and
// error banners. Gamepad + harvest/calibration wiring live in their own
// files and hook into the same CommandManager / render functions via
// window.Panel*.

let actionRanges = {};
const toyMotorsById = new Map(); // toyId -> { name, motors, verified }

// ---------------------------------------------------------------
// Concentric arc dial — 270 deg sweep with hard stops.
//
// Each ring's dot lives at a FIXED radius (its own ring track). Level
// is the dot's ANGULAR position along a 270 deg arc: 0 at the lower-
// left stop, max at the lower-right stop. The dot's angle is set
// DIRECTLY from the pointer's angle relative to center — like a real
// hand on a pivot. Close to center = coarse (tiny sideways nudge
// sweeps a huge angle), far out = fine — natural pivot geometry.
// You can press anywhere near a ring, not just the dot: each ring
// owns a wide invisible drag surface.
// ---------------------------------------------------------------

const DIAL_VIEWBOX = 200;
const DIAL_CENTER = 100;
const OUTER_MAX_R = 88;
const RING_GAP = 26;
const HANDLE_R = 7;
const ANGLE_START = (3 * Math.PI) / 4;     // 135 deg — lower-left, level 0
const ANGLE_SWEEP = (3 * Math.PI) / 2;     // 270 deg clockwise over the top
const HIT_MARGIN = RING_GAP / 2;           // how far past a ring's track its drag surface grabs

function ringMaxRadius(i) { return OUTER_MAX_R - i * RING_GAP; }
function hitRadius(i) { return Math.min(ringMaxRadius(i) + HIT_MARGIN, 98); }
function angleForLevel(level, maxSteps) { return ANGLE_START + (level / maxSteps) * ANGLE_SWEEP; }

// Pointer angle -> level fraction 0..1. Angles in the bottom gap
// (past either stop) clamp to whichever stop is nearer.
function levelFractionFromPointer(dx, dy) {
  const twoPi = Math.PI * 2;
  let a = Math.atan2(dy, dx);
  while (a < ANGLE_START) a += twoPi;
  while (a >= ANGLE_START + twoPi) a -= twoPi;
  const angleEnd = ANGLE_START + ANGLE_SWEEP;
  if (a <= angleEnd) return (a - ANGLE_START) / ANGLE_SWEEP;
  const gapMid = angleEnd + (twoPi - ANGLE_SWEEP) / 2;
  return a < gapMid ? 1 : 0;
}

// SVG arc path for a ring track from ANGLE_START to ANGLE_START +
// ANGLE_SWEEP, leaving the bottom gap visible (the hard stops).
function describeArc(r) {
  const sa = ANGLE_START, ea = ANGLE_START + ANGLE_SWEEP;
  const sx = DIAL_CENTER + r * Math.cos(sa), sy = DIAL_CENTER + r * Math.sin(sa);
  const ex = DIAL_CENTER + r * Math.cos(ea), ey = DIAL_CENTER + r * Math.sin(ea);
  return `M ${sx} ${sy} A ${r} ${r} 0 1 1 ${ex} ${ey}`;
}

function pointerToDialCoords(svgEl, clientX, clientY) {
  const rect = svgEl.getBoundingClientRect();
  const scaleX = DIAL_VIEWBOX / rect.width;
  const scaleY = DIAL_VIEWBOX / rect.height;
  return {
    dx: (clientX - rect.left) * scaleX - DIAL_CENTER,
    dy: (clientY - rect.top) * scaleY - DIAL_CENTER,
  };
}


// ---------------------------------------------------------------
// Panel events — command result handling, reconnect logic
// ---------------------------------------------------------------

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


// ---------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------

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


// ---------------------------------------------------------------
// Toy rendering — one card + arc dial per toy
// ---------------------------------------------------------------

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


// ---------------------------------------------------------------
// Arc dial — render, drag, scroll, step buttons
// ---------------------------------------------------------------

// Places a handle bead at the angle corresponding to its motor's
// current level, always at its ring's fixed radius.
function renderRing(toyId, ref) {
  const state = CommandManager.getState(toyId);
  const level = state.levels[ref.motor.action] ?? 0;
  const radius = ringMaxRadius(ref.ringIndex);
  const angle = angleForLevel(level, ref.motor.maxSteps);
  const x = DIAL_CENTER + radius * Math.cos(angle);
  const y = DIAL_CENTER + radius * Math.sin(angle);
  ref.handle.setAttribute('cx', x);
  ref.handle.setAttribute('cy', y);
  ref.readoutLevel.textContent = level;
}

// Drag wired to invisible hit surfaces. Pointer angle relative to
// center directly maps to level — the absolute-angle model.
function wireRingDrag(svgEl, toyId, ref, refsList, isConnected) {
  let dragging = false;

  function applyFromPointer(e) {
    const c = pointerToDialCoords(svgEl, e.clientX, e.clientY);
    const fraction = levelFractionFromPointer(c.dx, c.dy);
    if (isConnected()) {
      refsList.forEach((other) => {
        CommandManager.setLevel(toyId, other.motor.action, fraction * other.motor.maxSteps);
      });
    } else {
      CommandManager.setLevel(toyId, ref.motor.action, fraction * ref.motor.maxSteps);
    }
  }

  ref.hit.addEventListener('pointerdown', (e) => {
    dragging = true;
    ref.hit.classList.add('dragging');
    ref.handle.classList.add('dragging');
    ref.hit.setPointerCapture(e.pointerId);
    applyFromPointer(e);
  });

  ref.hit.addEventListener('pointermove', (e) => {
    if (dragging) applyFromPointer(e);
  });

  function end() {
    dragging = false;
    ref.hit.classList.remove('dragging');
    ref.handle.classList.remove('dragging');
  }
  ref.hit.addEventListener('pointerup', end);
  ref.hit.addEventListener('pointercancel', end);
}

function wireScrollNudge(hitEl, toyId, motor) {
  hitEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    CommandManager.nudgeLevel(toyId, motor.action, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

function wireStepButtons(row, toyId, motor) {
  row.querySelector('.plus').addEventListener('click', () => CommandManager.nudgeLevel(toyId, motor.action, 1));
  row.querySelector('.minus').addEventListener('click', () => CommandManager.nudgeLevel(toyId, motor.action, -1));
}

// One compound arc dial per toy: concentric 270 deg ring-tracks
// (outer = first motor) with a draggable bead per motor, plus
// plain-text readout rows below. SVG order: tracks -> center dot ->
// handles -> hit surfaces (outer-to-inner so inner rings win pointer
// events in their zone, while the outermost ring's surface catches
// the rest).
function buildCompoundDial(toyId, motors) {
  const wrap = document.createElement('div');
  wrap.className = 'dial-widget';

  const ringTracks = motors
    .map((_, i) => `<path class="ring-track" d="${describeArc(ringMaxRadius(i))}"></path>`)
    .join('');

  const handles = motors
    .map((_, i) =>
      `<circle class="stick-handle" data-ring-color="${i}" cx="${DIAL_CENTER}" cy="${DIAL_CENTER}" r="${HANDLE_R}"></circle>`
    )
    .join('');

  // Hit circles drawn outer-to-inner so smaller (inner) surfaces sit
  // on top and win the pointer for their own zone.
  const hitCircles = motors
    .map((_, i) =>
      `<circle class="ring-hit" cx="${DIAL_CENTER}" cy="${DIAL_CENTER}" r="${hitRadius(i)}"></circle>`
    )
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
      ${handles}
      ${hitCircles}
    </svg>
    <div class="dial-readouts">${readoutRows}</div>
  `;

  const svgEl = wrap.querySelector('.compound-dial');
  const handleEls = Array.from(wrap.querySelectorAll('.stick-handle'));
  const hits = Array.from(wrap.querySelectorAll('.ring-hit'));
  const rows = Array.from(wrap.querySelectorAll('.dial-readout-row'));

  const refsList = motors.map((motor, i) => ({
    motor,
    ringIndex: i,
    handle: handleEls[i],
    hit: hits[i],
    row: rows[i],
    readoutLevel: rows[i].querySelector('.readout-level'),
  }));

  // Connected toggle — only shown for 2+ motors
  let connectToggle = null;
  if (motors.length >= 2) {
    connectToggle = document.createElement('label');
    connectToggle.className = 'dial-toggle';
    connectToggle.innerHTML = '<input type="checkbox" class="connect-toggle" /> Connected (move together)';
  }
  function isConnected() {
    return !!(connectToggle && connectToggle.querySelector('input').checked);
  }

  refsList.forEach((ref) => {
    wireRingDrag(svgEl, toyId, ref, refsList, isConnected);
    wireScrollNudge(ref.hit, toyId, ref.motor);
    wireStepButtons(ref.row, toyId, ref.motor);
  });

  if (connectToggle) wrap.appendChild(connectToggle);

  CommandManager.getState(toyId).onLevelChange = (action, level) => {
    const ref = refsList.find((r) => r.motor.action === action);
    if (ref) renderRing(toyId, ref);
  };

  refsList.forEach((ref) => renderRing(toyId, ref)); // initial paint

  return wrap;
}


// ---------------------------------------------------------------
// Utility
// ---------------------------------------------------------------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


// ---------------------------------------------------------------
// Link flow — QR code + manual code
// ---------------------------------------------------------------

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


// ---------------------------------------------------------------
// Global controls wiring
// ---------------------------------------------------------------

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


// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------

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
