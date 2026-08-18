# Lovense Long-Distance Jog-Wheel Control Panel — Build Specification

**Author:** Maridizzle
**Status:** Ready to implement, pending Step 0 verifications
**Deliverable type:** Browser control panel + small hosted proxy (long-distance control via Lovense Server API)

---

## How to read this document

Facts in this spec are tagged by confidence and source:

- **[VERIFIED / first-party]** — confirmed in Lovense's own repository, `github.com/lovense/Standard_solutions`.
- **[COMMUNITY]** — from open-source / community sources (buttplug.io, buttplug-device-config, community bridges). Reliable in practice, but not Lovense-official. Treat as strong leads, not gospel.
- **[MUST CONFIRM]** — not yet proven for the long-distance server path. These are the coder's Step 0 tasks. Do not build load-bearing logic on them until proven on the actual devices.

Do not let a [COMMUNITY] or [MUST CONFIRM] item get quietly promoted to fact during implementation.

---

## 1. Goal and scope

Build a control panel that adjusts one or more Lovense toys **over long distance** (toy and controller on different networks), driven by both mouse and a game controller. Controller input uses a **relative jog-wheel** model: turn the stick to nudge a level, release and it holds. No spring-back to zero. "Set it and forget it."

**In scope:** long-distance control via the Lovense Server API; mouse control; gamepad jog-wheel control; multi-toy and multi-motor handling; a small token-holding proxy.

**Out of scope (non-goals):**
- Sub-level smoothing. Hardware resolution is fixed (see §7). Do not attempt dithering between levels to fake fractional intensity; over a cloud relay it produces jitter, not smoothness.
- Silky analog feel. Output is stepped by design.
- BLE / Buttplug control transport. This build uses Lovense's server path only. (Buttplug is referenced only as a device-knowledge catalog, see §6.)
- Toy-side telemetry. The server control path is one-way; the panel gets no live readback of what the motors are doing.

---

## 2. Architecture

```
[ Browser panel ]  --(authenticated)-->  [ Express proxy on Railway ]  -->  [ Lovense server ]  -->  [ Lovense Remote app ]  -->  [ toys ]
   mouse + gamepad                         holds dev token,                  api.lovense.com          paired at user's phone/PC
   jog-wheel UI                            relays commands
```

**Why the proxy is not optional:**

1. **Token secrecy.** The Lovense developer token is a secret. Anything it can do, anyone holding it can do. It must never sit in browser-delivered JavaScript. The proxy holds it server-side and the panel never sees it.
2. **The sanctioned in-browser path is LAN-only.** Lovense's browser JS API (LAN.JS) explicitly requires the user's devices to be on the same local network **[VERIFIED / first-party]**. That is the local path, not ours. Long distance must go through the Server API, which realistically needs a small backend.

---

## 3. Step 0 — Blocking verifications (do these FIRST)

These cannot be settled from documentation alone. They require live calls with a real developer token and the actual toys connected. **Do them before writing control logic**, because each one can change the design.

1. **Real server command endpoint, and that it relays across networks.**
   Lovense's README lists the command URL ambiguously as `https://{domain}:{httpsPort}/command` for both the local and server sections **[VERIFIED / first-party, but ambiguous]**. Community code points at `https://api.lovense.com/api/lan/v2/command` as the server command endpoint **[COMMUNITY]**. Confirm the true endpoint against `developer.lovense.com`, and confirm a command sent from a machine **not** on the toy's LAN actually reaches the toy. The entire long-distance premise depends on this.

2. **Per-motor addressing on the server path.**
   Does the server `Function` action accept per-motor names like `Vibrate1` / `Vibrate2`? Community tooling uses `VIBRATE1` / `VIBRATE2` for dual-vibrator toys **[COMMUNITY]**, and Buttplug's Lovense protocol notes a feature-indexed vibrate command used for multi-feature devices **[COMMUNITY]**. Lovense's own server docs list only `Vibrate`, `Rotate`, `Pump` **[VERIFIED / first-party]**. Prove `Vibrate1`/`Vibrate2` on the Dolce before promising two independent wheels.

3. **Exact combined multi-motor syntax.**
   Confirm the precise action string that sets two motors at once in a single command, e.g. `"Vibrate1:8,Vibrate2:14"` vs some other form. This matters because of `stopPrevious` (see §7): two separate commands to one toy would cancel each other.

4. **Does the server callback return capabilities?**
   The documented callback payload from the Lovense Remote app carries only `name`, `id`, `status` (and `nickName`) per toy **[VERIFIED / first-party]**. Confirm whether anything richer (motor count / function list) is returned over the server path. If yes, the §6 discovery tiers simplify dramatically. If no, §6 Tier 1–3 are required.

5. **Rate limits / minimum command interval.**
   Lovense warns that changing the response very frequently causes network pressure and recommends pattern requests for that case **[VERIFIED / first-party]**. Find the practical minimum interval between commands per user/toy. This sets the throttle constant in §8.

---

## 4. Prerequisites and one-time setup

- **Lovense developer account + token** from the developer dashboard (`https://www.lovense.com/user/developer/info`) **[VERIFIED / first-party]**.
- **Callback URL** set in that dashboard, pointing at the proxy's public `/callback` route **[VERIFIED / first-party]**.
- **Lovense Remote app** installed with the toys paired. Minimum app versions for commands: iOS Remote 5.1.4+, Android Remote 5.1.1+, PC Remote 1.5.8+ **[VERIFIED / first-party]**.
- **PC Remote linking** additionally requires entering the code generated alongside the QR **[VERIFIED / first-party]**.
- **Railway project** for the proxy.

**Linking flow [VERIFIED / first-party]:**
1. Proxy POSTs to `https://api.lovense.com/api/lan/getQrCode` with `{ token, uid, uname, utoken: md5(uid + salt), v: 2 }`.
2. Response returns a QR image URL and a `code`.
3. User scans the QR with the Lovense Remote app (or enters the code on PC Remote).
4. The app POSTs the toy list to the proxy's Callback URL. Cache that payload (toys, connection domain/ports, `utoken`).

---

## 5. Proxy specification (Express on Railway)

**Environment variables:**
- `LOVENSE_TOKEN` — developer token (secret, never sent to the browser).
- `LOVENSE_UID` — the user's id on our own system (any stable string).
- `LOVENSE_SALT` — salt for the `utoken` md5.
- `PANEL_PASSWORD` — gate for the panel (see auth below).
- `PANEL_API_KEY` — shared secret for panel-to-proxy command calls (server-side use; see auth note).
- `PORT`, `CALLBACK_PUBLIC_URL`.

**Routes:**
- `POST /link` — runs the getQrCode flow, returns QR URL + code for the user to scan. One-time.
- `POST /callback` — public Callback URL registered in the Lovense dashboard. Receives the app's toy payload; caches toys + connection info. This is called by Lovense, not the panel.
- `GET /toys` — returns the currently known toys (from the last callback) to the panel.
- `POST /command` — **authenticated.** Body `{ toy, action, timeSec, stopPrevious }`. Injects `LOVENSE_TOKEN` + `LOVENSE_UID` server-side and relays to the confirmed Lovense command endpoint. The token never leaves the proxy.
- `POST /stop` — convenience: Stop all toys.

**Authentication (this is a must-have, not a nicety):**
A Railway service with an open command route is a public one. Anyone who finds the URL could drive the hardware from anywhere. Lock it down:
- **Recommended:** the proxy also *serves* the panel, behind a simple `PANEL_PASSWORD` login that sets an httpOnly session cookie. `PANEL_API_KEY` is then used server-side only and never appears in client JS. This mirrors the `X-Bot-Api-Key` pattern already used on ChecklistBot.
- **Do not** embed a bare API key in a static client-side panel. If the panel must be static/local-only, keep it strictly on localhost and treat the key as compromised-if-shared.
- CORS: allow only the panel's own origin.

---

## 6. Device discovery — the tiered strategy (#3)

**Principle: decouple capability *discovery* from control *transport*.** They do not have to travel over the same pipe. Discovery can be exact and local even when control is remote. Every tier writes into one **device-profile store keyed by stable toy ID**, so the discovery cost is paid **once per device, ever**, not once per session.

Resolve in this order and stop at the first that succeeds:

- **Tier 0 — Server capability call.** If Step 0 item 4 shows the server path returns motor/function data, use it directly. Everything below is then moot.

- **Tier 1 — Local harvest as a one-time oracle (PRIMARY).** The **LAN** `GetToys` call returns richer data (per-toy `name`, `id`, `status`, `version`, `battery`, and function/capability detail) that the long-distance callback does not **[VERIFIED / first-party for LAN GetToys existence; exact capability fields to confirm]**. Since the toys are paired at home, run `GetToys` **once on the local network**, capture each toy's true motor layout, and cache it by toy ID. From then on, control long distance while reading layout from cache. Lovense's own data, no guessing, no external dependency.

- **Tier 2 — Authoritative catalog lookup (no home network needed).** Map the toy's reported `name`/model identifier to the **Buttplug device-config database**, which is that project's stated source of truth for known devices and enumerates per-toy motor layouts (its worked example: the Lovense Edge, catalogued as two motors, an internal and a perineum vibrator) **[COMMUNITY: buttplugio/buttplug-device-config, BSD-licensed]**. Community-maintained, updates as new toys ship. Flag in code that this source is community, not Lovense-official.

- **Tier 3 — Guided calibration (ground-truth verifier + final fallback).** Because the server path returns no telemetry, the only way to *know* two heads respond is to feel them. One time per toy: pulse motor 1, then motor 2, and ask the user what they felt and where. Save the result to the device profile. This doubles as the on-device proof for Step 0 item 2, so it earns its place twice.

**Device-profile record (per toy ID):**
```
{
  "toyId": "ff922f7fd345",
  "name": "dolce",
  "motorCount": 2,
  "motors": [
    { "action": "Vibrate1", "maxSteps": 20 },
    { "action": "Vibrate2", "maxSteps": 20 }
  ],
  "source": "harvest | catalog | calibration | server",
  "verifiedByCalibration": true
}
```

**Persistence:** JSON on a Railway mounted volume (matches the FamilyBot data pattern) or a `kv_store` row (matches BrainStation). Coder's choice; lean toward the volume JSON for simplicity.

---

## 7. Command semantics [VERIFIED / first-party unless noted]

**Server `Function` request parameters:**
`token`, `uid`, `command: "Function"`, `action`, `timeSec`, optional `loopRunningSec`, optional `loopPauseSec`, optional `toy` (toy ID; omit to hit all toys), optional `stopPrevious`, `apiVer: 1`.

**Action strength ranges:**
- `Vibrate: 0 ~ 20`
- `Rotate: 0 ~ 20`
- `Pump: 0 ~ 3`
- Combined in one string: `"Vibrate:2,Rotate:3,Pump:4"`.
- `"Stop"` stops the toy.
- Per-motor names (`Vibrate1`, `Vibrate2`): **[MUST CONFIRM, Step 0 item 2]**.

**`timeSec`:** `0` = indefinite. Otherwise must be greater than 1. **We do not use 0** (see §9).

**`stopPrevious`:** default `1` (a new command stops the previous). Set `0` to stack commands. **Critical for multi-motor:** to run two motors of one toy at independent levels, send **one** combined-action command per toy. Sending `Vibrate1` then `Vibrate2` as separate default commands would have the second cancel the first.

**Hardware resolution ceiling:** 21 vibrate levels (0–20), 21 rotate levels, 4 pump levels (0–3). This is the real output resolution. No input scheme increases it.

**Server error codes:** `200` Success, `400` Invalid command, `404` Invalid Parameter, `501` Invalid token, `502` No permission, `503` Invalid User ID, `507` Lovense app offline.

---

## 8. Gamepad jog-wheel input model

Use the **Gamepad API** (W3C standard; polled, not event-driven) **[VERIFIED / standards doc, MDN]**.

- Listen for `gamepadconnected` / `gamepaddisconnected`.
- Poll `navigator.getGamepads()` inside a `requestAnimationFrame` loop.
- Apply a **deadzone** (start ~0.15) to kill stick drift.

**Relative accumulation (this is what removes spring-back):**
The stick's displacement from center is a **rate of change**, not an absolute value.

```
each frame:
  a = axisValue (after deadzone)
  level += a * sensitivity * dt        // creep up/down while held
  level = clamp(level, 0, motor.maxSteps)
  bucket = round(level)
  if bucket != lastSentBucket AND (now - lastSentTime) >= MIN_INTERVAL:
      sendCommand(toy, motor.action, bucket)
      lastSentBucket = bucket
      lastSentTime = now
```

- Centering the stick means `a = 0`, so `level` stops changing and **holds**. No return to zero.
- Push depth sets rate: a light push creeps, a hard push moves fast.
- `MIN_INTERVAL` comes from Step 0 item 5. Only emit on **bucket change**, never per frame.

**Axis-to-channel mapping:**
Up to 5 channels but a typical pad has 4 stick axes plus triggers. Provide:
- A default map (LS-X → ch1, LS-Y → ch2, RS-X → ch3, RS-Y → ch4, trigger → ch5), all reassignable in a small config UI.
- A **focus/solo mode**: one stick drives whichever wheel is currently selected. This is the comfortable option for the common 1-to-4-channel case.

**Panic Stop binding:** a dedicated gamepad button (or hold both bumpers) fires the same all-stop as the UI button in §9.

---

## 9. Safety model — bounded self-healing hold

This replaces the earlier "indefinite hold + watchdog" idea, which was weaker: a watchdog living in the browser panel dies at the exact moment it is needed (tab close, sleep, network drop are both the failure and the thing that kills the watchdog). A safety net in the same process as the failure is not a net. This matters more given one channel is a pair of clamps, where a stuck-on failure is not merely annoying.

**Model:**
- Every command sends `timeSec = HOLD_SECONDS` (start ~12), **never 0**.
- A per-channel **renewal timer** re-sends the current level every `HOLD_SECONDS * 0.66` (e.g. ~8s for a 12s hold) so the toy never lapses while the panel is alive and in contact.
- If the panel dies, loses contact, or the tab closes, renewals stop arriving and **the toy winds itself down within `HOLD_SECONDS` on its own.** Self-healing against both panel death and proxy death.
- **Panic Stop** (UI button + gamepad binding): sends `Stop` to all toys and cancels all renewal timers.
- On `visibilitychange` (hidden) / `beforeunload`: best-effort `Stop`. Treat this as a bonus only; the bounded hold is the real net, since unload-time network calls are unreliable.

**Trade-off, stated honestly:** renewals are chattier than an indefinite hold, nudging the network-pressure ceiling. That is the price of self-healing, and it is the right price here.

---

## 10. UI

- **One jog-wheel widget per channel/motor**, rendered from the device profile (§6). Connect one toy, get one wheel. Connect everything, get up to five.
- Each wheel shows current level `0..maxSteps` as a ring/dial fill.
- **Mouse control** on each wheel: click-drag rotary, scroll to nudge, plus explicit `+` / `-` buttons. Same channel target as the gamepad, same command path.
- **Connection status** per toy (watch for error `507`, app offline).
- **Calibration flow** UI for Tier 3.
- Prominent **Panic Stop**.

---

## 11. Error handling

- `507` (app offline): prominent banner, pause sends, prompt the user to open the Lovense app.
- `501` / `502` / `503`: configuration/auth problem. Log server-side; surface a generic "connection not authorized" state.
- Network / relay failure: treat as lost contact. Do **not** panic-spam retries. Rely on the bounded hold to wind down, show a "reconnecting" state, resume renewals when contact returns.

---

## 12. Build order

1. **Step 0 verifications (§3).** Nothing load-bearing until these are settled.
2. Stand up the proxy (§5): env vars, `/link`, `/callback`, auth. Prove the one-time link and a single hardcoded `Vibrate:5` round-trip **long distance**.
3. Device discovery (§6): implement Tier resolution, populate the device-profile store, confirm the Dolce resolves to two motors.
4. Build the panel UI (§10) with mouse control only first. Prove each wheel drives its channel.
5. Add the Gamepad jog-wheel (§8): deadzone, relative accumulation, bucket change-detection, throttle.
6. Add the safety model (§9): bounded hold, renewals, panic Stop.
7. **Prove it end to end long distance with the Dolce**, confirming two-head control actually responds, before calling it done. Prove one channel fully before wiring all five.

---

## Source provenance

- **Lovense first-party:** `github.com/lovense/Standard_solutions` (Server API, getQrCode/callback flow, Function/Pattern/Preset params, strength ranges, error codes, version minimums, LAN.JS LAN-only constraint).
- **Community (reliable, not official):** buttplug.io Lovense protocol notes; `buttplugio/buttplug-device-config` (device catalog / motor layouts, BSD-licensed); community bridges (per-motor `Vibrate1`/`Vibrate2` naming); community worker code (candidate server endpoint `api.lovense.com/api/lan/v2/command`).
- **Standards:** MDN / W3C Gamepad API.
- **Unverified for the long-distance server path (Step 0):** exact command endpoint; per-motor action support; combined multi-motor syntax; whether the callback returns capabilities; rate limits.

---

*Spec by Maridizzle. Nothing in here is built, hosted, linked, or committed until the builder says so. Prove Step 0 before trusting anything marked MUST CONFIRM.*
