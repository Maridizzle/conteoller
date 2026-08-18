// Tier 3 (spec §6): guided calibration — the only way to *know* two heads
// respond is to feel them, since the server control path returns no
// telemetry. Pulses each candidate motor in turn (low level, ~2s) and
// asks the user what they felt; confirmed motors are saved as the
// device's ground-truth profile.

const PanelCalibrate = (() => {
  const PULSE_LEVEL = 6;
  const PULSE_SECONDS = 2;

  let toyId = null;
  let candidates = [];
  let confirmed = [];
  let index = 0;

  const dialog = () => document.getElementById('calibrateDialog');

  function start(id) {
    toyId = id;
    const info = window.PanelApp.toyMotorsById.get(id);
    candidates = (info?.motors || []).map((m) => ({ action: m.action, type: m.type, label: m.label }));
    if (!candidates.length) {
      window.alert('No known motors to calibrate — run "Harvest on LAN" first to define the motor list.');
      return;
    }
    confirmed = [];
    index = 0;
    dialog().showModal();
    renderStep();
  }

  function renderStep() {
    const motor = candidates[index];
    document.getElementById('calibrateTitle').textContent = `Calibrating motor ${index + 1} of ${candidates.length}`;
    document.getElementById('calibrateStep').textContent =
      `Action: ${motor.action}. Press "Pulse this motor", then tell us whether you felt it.`;
  }

  async function pulse() {
    const motor = candidates[index];
    try {
      await fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toyId,
          actions: [{ action: motor.action, level: PULSE_LEVEL }],
          timeSec: PULSE_SECONDS + 1,
          stopPrevious: 1,
        }),
      });
      setTimeout(() => {
        fetch('/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toyId }),
        });
      }, PULSE_SECONDS * 1000);
    } catch (err) {
      window.alert(`Pulse failed: ${err.message}`);
    }
  }

  function next(felt) {
    if (felt) confirmed.push(candidates[index]);
    index += 1;
    if (index >= candidates.length) return finish();
    renderStep();
  }

  async function finish() {
    dialog().close();
    if (!confirmed.length) {
      window.alert('No motors confirmed — calibration not saved.');
      return;
    }
    const info = window.PanelApp.toyMotorsById.get(toyId);
    await fetch('/calibrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toyId, name: info?.name, motors: confirmed }),
    });
    await window.PanelApp.loadToys();
  }

  function cancel() {
    dialog().close();
  }

  function wireDialogButtons() {
    document.getElementById('calibratePulseBtn')?.addEventListener('click', pulse);
    document.getElementById('calibrateFeltBtn')?.addEventListener('click', () => next(true));
    document.getElementById('calibrateNothingBtn')?.addEventListener('click', () => next(false));
    document.getElementById('calibrateCancelBtn')?.addEventListener('click', cancel);
  }

  document.addEventListener('DOMContentLoaded', wireDialogButtons);

  return { start };
})();

window.PanelCalibrate = PanelCalibrate;
