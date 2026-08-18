// Tier 1 (spec §6): one-time LAN harvest, run when the panel happens to
// be opened on the same network as the toy. [MUST CONFIRM] — the exact
// LAN GetToys endpoint/response shape is not proven (spec §3 item 1 notes
// the README is ambiguous about /command being shared between LAN and
// server paths). This makes a best-effort attempt and always falls back
// to a manual entry form, since that fallback is the only thing that can
// be trusted without Step 0 being done first.

const PanelHarvest = (() => {
  async function attemptLanGetToys(lan) {
    const port = lan.httpsPort || lan.httpPort;
    if (!lan.domain || !port) return null;
    const scheme = lan.httpsPort ? 'https' : 'http';
    const url = `${scheme}://${lan.domain}:${port}/command`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'GetToys' }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data;
  }

  // Best-effort heuristic parse — the response shape here is unverified,
  // so this only recognizes a couple of plausible layouts and otherwise
  // returns null so the caller falls back to manual entry.
  function parseMotors(data, toyId) {
    if (!data) return null;
    const toysObj = data.toys || data.data || data;
    const toy = toysObj?.[toyId] || (Array.isArray(toysObj) ? toysObj.find((t) => t.id === toyId) : null);
    if (!toy) return null;

    if (Array.isArray(toy.functions) && toy.functions.length) {
      return toy.functions.map((fn) => ({
        action: fn,
        type: (fn.match(/^(Vibrate|Rotate|Pump)/) || [])[1] || 'Vibrate',
        label: fn,
      }));
    }
    if (typeof toy.vibrator1Level !== 'undefined' && typeof toy.vibrator2Level !== 'undefined') {
      return [
        { action: 'Vibrate1', type: 'Vibrate', label: 'Motor 1' },
        { action: 'Vibrate2', type: 'Vibrate', label: 'Motor 2' },
      ];
    }
    return null;
  }

  function manualEntry() {
    const countStr = window.prompt(
      'LAN auto-detect unavailable or unclear. How many independently-controllable motors does this toy have?',
      '1'
    );
    const count = parseInt(countStr, 10);
    if (!count || count < 1) return null;

    const motors = [];
    for (let i = 1; i <= count; i += 1) {
      const type = (window.prompt(`Motor ${i} type — Vibrate, Rotate, or Pump:`, 'Vibrate') || 'Vibrate').trim();
      const label = window.prompt(`Motor ${i} label (what it is / where it sits):`, `Motor ${i}`) || `Motor ${i}`;
      const action = count === 1 ? type : `${type}${i}`;
      motors.push({ action, type, label });
    }
    return motors;
  }

  async function saveProfile(toyId, motors) {
    const info = window.PanelApp.toyMotorsById.get(toyId);
    await fetch('/harvest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toyId, name: info?.name, motors }),
    });
    await window.PanelApp.loadToys();
  }

  async function run(toyId) {
    const lan = window.PanelState?.lan;
    let detected = null;

    if (lan?.domain) {
      try {
        const raw = await attemptLanGetToys(lan);
        detected = parseMotors(raw, toyId);
      } catch (err) {
        detected = null; // network/CORS/self-signed cert failure — expected off-LAN
      }
    }

    if (detected && detected.length) {
      const ok = window.confirm(
        `Detected ${detected.length} motor(s): ${detected.map((m) => m.action).join(', ')}. Save as this toy's profile?`
      );
      if (ok) return saveProfile(toyId, detected);
    }

    const manual = manualEntry();
    if (manual) return saveProfile(toyId, manual);
    return null;
  }

  return { run };
})();

window.PanelHarvest = PanelHarvest;
