// Panel shell: fetches toys/config, renders one wheel per motor (mouse
// control per spec §10), wires Panic Stop, link flow, and error banners.
// Gamepad + harvest/calibration wiring live in their own files and hook
// into the same CommandManager / render functions via window.Panel*.

let actionRanges = {};
const toyMotorsById = new Map(); // toyId -> motors[] (for harvest/calibrate/gamepad UI)

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
      <div class="wheels"></div>
      <div class="row" style="margin-top:12px;">
        <button class="btn secondary harvest-btn" style="width:auto;">Harvest on LAN</button>
        <button class="btn secondary calibrate-btn" style="width:auto;">${toy.profile.verifiedByCalibration ? 'Re-calibrate' : 'Calibrate'}</button>
      </div>
    `;

    const wheelsEl = card.querySelector('.wheels');
    motors.forEach((motor) => wheelsEl.appendChild(buildWheel(toy.id, motor)));

    card.querySelector('.harvest-btn').addEventListener('click', () => window.PanelHarvest?.run(toy.id));
    card.querySelector('.calibrate-btn').addEventListener('click', () => window.PanelCalibrate?.start(toy.id));

    container.appendChild(card);
  });

  window.PanelGamepad?.refreshChannels();
}

function buildWheel(toyId, motor) {
  const wrap = document.createElement('div');
  wrap.className = 'wheel';
  wrap.innerHTML = `
    <div class="label">${escapeHtml(motor.label || motor.action)}</div>
    <div class="dial" style="--pct:0" tabindex="0">
      <div class="level">0</div>
    </div>
    <div class="buttons">
      <button class="minus">−</button>
      <button class="plus">+</button>
    </div>
  `;

  const dial = wrap.querySelector('.dial');
  const levelEl = wrap.querySelector('.level');

  // CommandManager exposes one onLevelChange slot per toy, shared across
  // all of that toy's motors — chain into it so each wheel updates only
  // its own action's dial.
  const cmState = CommandManager.getState(toyId);
  const prevOnChange = cmState.onLevelChange;
  cmState.onLevelChange = (action, level) => {
    if (typeof prevOnChange === 'function') prevOnChange(action, level);
    if (action !== motor.action) return;
    levelEl.textContent = level;
    dial.style.setProperty('--pct', String((level / motor.maxSteps) * 100));
  };

  wrap.querySelector('.plus').addEventListener('click', () => CommandManager.nudgeLevel(toyId, motor.action, 1));
  wrap.querySelector('.minus').addEventListener('click', () => CommandManager.nudgeLevel(toyId, motor.action, -1));

  dial.addEventListener('wheel', (e) => {
    e.preventDefault();
    CommandManager.nudgeLevel(toyId, motor.action, e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  let dragging = false;
  let dragStartY = 0;
  let dragStartLevel = 0;
  dial.addEventListener('pointerdown', (e) => {
    dragging = true;
    dragStartY = e.clientY;
    dragStartLevel = CommandManager.getState(toyId).levels[motor.action];
    dial.setPointerCapture(e.pointerId);
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const deltaY = dragStartY - e.clientY; // up = increase
    const sensitivity = motor.maxSteps / 120; // full range over ~120px
    CommandManager.setLevel(toyId, motor.action, dragStartLevel + deltaY * sensitivity);
  });
  dial.addEventListener('pointerup', () => { dragging = false; });
  dial.addEventListener('pointercancel', () => { dragging = false; });

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
      <img src="${data.qrCode || data.qrcode || ''}" alt="QR" />
      <div>Or enter code: <span class="link-code">${escapeHtml(data.code || data.qrcodeCode || '')}</span></div>
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
