// Spec §8: Gamepad API jog-wheel input. Relative accumulation removes
// spring-back — the stick's displacement from center is a rate of
// change applied to a persistent per-channel level, not an absolute
// position. Centering the stick means a = 0, so level stops changing
// and holds.

const PanelGamepad = (() => {
  const DEADZONE = 0.15; // overwritten by /config on init, see refreshDeadzone()
  const SENSITIVITY = 10; // steps/sec at full stick deflection — coder's choice, not spec'd
  const MAX_CHANNELS = 5;

  // Default axis map: LS-X, LS-Y, RS-X, RS-Y, then a trigger button.
  // index into gamepad.axes for the first four; the 5th channel reads a
  // button's analog `value` (right trigger is typically button 7).
  const DEFAULT_SOURCES = [
    { kind: 'axis', index: 0, label: 'Left stick X' },
    { kind: 'axis', index: 1, label: 'Left stick Y' },
    { kind: 'axis', index: 2, label: 'Right stick X' },
    { kind: 'axis', index: 3, label: 'Right stick Y' },
    { kind: 'button', index: 7, label: 'Right trigger' },
  ];

  let deadzone = DEADZONE;
  let channels = DEFAULT_SOURCES.map((source) => ({ source, target: null })); // target: { toyId, action, maxSteps }
  const floatLevels = new Array(MAX_CHANNELS).fill(0);

  let focusMode = false;
  let focusChannelIndex = 0;

  let rafId = null;
  let lastFrameTime = null;
  let panicHeldSince = null;

  function connectedGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p) return p;
    return null;
  }

  function applyDeadzone(v) {
    if (Math.abs(v) < deadzone) return 0;
    // rescale so output is continuous from the deadzone edge
    const sign = Math.sign(v);
    return sign * ((Math.abs(v) - deadzone) / (1 - deadzone));
  }

  function flattenAllMotors() {
    const list = [];
    for (const [toyId, info] of window.PanelApp.toyMotorsById.entries()) {
      info.motors.forEach((m) => list.push({ toyId, action: m.action, maxSteps: m.maxSteps, label: `${info.name} — ${m.label || m.action}` }));
    }
    return list;
  }

  function refreshChannels() {
    const motors = flattenAllMotors();
    channels.forEach((ch, i) => {
      if (!ch.target && motors[i]) {
        ch.target = motors[i];
      }
      // Drop targets that no longer exist (toy unlinked, etc).
      if (ch.target && !motors.find((m) => m.toyId === ch.target.toyId && m.action === ch.target.action)) {
        ch.target = null;
      }
    });
    renderMappingTable(motors);
    renderFocusSelect(motors);
  }

  function renderMappingTable(motors) {
    const tbody = document.querySelector('#mappingTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    channels.forEach((ch, i) => {
      const tr = document.createElement('tr');
      const tdAxis = document.createElement('td');
      tdAxis.textContent = ch.source.label;
      const tdSelect = document.createElement('td');
      const select = document.createElement('select');
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = '(unassigned)';
      select.appendChild(noneOpt);
      motors.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = `${m.toyId}::${m.action}`;
        opt.textContent = m.label;
        if (ch.target && ch.target.toyId === m.toyId && ch.target.action === m.action) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        if (!select.value) { channels[i].target = null; return; }
        const [toyId, action] = select.value.split('::');
        channels[i].target = motors.find((m) => m.toyId === toyId && m.action === action) || null;
        floatLevels[i] = channels[i].target ? CommandManager.getState(toyId).levels[action] : 0;
      });
      tdSelect.appendChild(select);
      tr.appendChild(tdAxis);
      tr.appendChild(tdSelect);
      tbody.appendChild(tr);
    });
  }

  function renderFocusSelect(motors) {
    const select = document.getElementById('focusChannelSelect');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    channels.forEach((ch, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = ch.target ? ch.target.label : `Channel ${i + 1} (unassigned)`;
      select.appendChild(opt);
    });
    if (prev) select.value = prev;
    focusChannelIndex = Number(select.value || 0);
  }

  function wireFocusControls() {
    const toggle = document.getElementById('focusModeToggle');
    const select = document.getElementById('focusChannelSelect');
    toggle?.addEventListener('change', () => { focusMode = toggle.checked; });
    select?.addEventListener('change', () => { focusChannelIndex = Number(select.value); });
  }

  function readSourceValue(pad, source) {
    if (source.kind === 'axis') return pad.axes[source.index] ?? 0;
    const btn = pad.buttons[source.index];
    return btn ? btn.value : 0;
  }

  function checkPanicBinding(pad) {
    // Dedicated button (Select/Back, commonly index 8) OR both bumpers
    // (indices 4 and 5) held together.
    const dedicated = pad.buttons[8]?.pressed;
    const bothBumpers = pad.buttons[4]?.pressed && pad.buttons[5]?.pressed;
    const held = !!(dedicated || bothBumpers);

    if (held && panicHeldSince === null) {
      panicHeldSince = performance.now();
      CommandManager.panicStopAll();
    } else if (!held) {
      panicHeldSince = null;
    }
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const pad = connectedGamepad();
    const statusEl = document.getElementById('gamepadStatus');

    if (!pad) {
      if (statusEl) statusEl.textContent = 'No gamepad';
      lastFrameTime = null;
      return;
    }
    if (statusEl) statusEl.textContent = `Gamepad: ${pad.id.slice(0, 40)}`;

    checkPanicBinding(pad);

    const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
    lastFrameTime = now;
    if (dt <= 0 || dt > 0.5) return; // skip first frame / tab-was-hidden gaps

    channels.forEach((ch, i) => {
      const isActive = focusMode ? i === focusChannelIndex : true;
      if (!isActive || !ch.target) return;

      const raw = readSourceValue(pad, ch.source);
      const a = applyDeadzone(raw);
      if (a === 0) return; // centered — holds, no update needed

      const { toyId, action, maxSteps } = ch.target;
      floatLevels[i] = Math.max(0, Math.min(maxSteps, floatLevels[i] + a * SENSITIVITY * dt));
      CommandManager.setLevel(toyId, action, floatLevels[i]);
    });
  }

  function init() {
    fetch('/config').then((r) => r.json()).then((cfg) => { deadzone = cfg.gamepad?.deadzone ?? DEADZONE; });
    wireFocusControls();
    refreshChannels();
    window.addEventListener('gamepadconnected', () => refreshChannels());
    window.addEventListener('gamepaddisconnected', () => {
      const statusEl = document.getElementById('gamepadStatus');
      if (statusEl) statusEl.textContent = 'No gamepad';
    });
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  return { init, refreshChannels };
})();

window.PanelGamepad = PanelGamepad;
