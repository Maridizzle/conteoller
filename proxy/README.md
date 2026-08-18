# Lovense Long-Distance Jog-Wheel Control Panel

Implementation of `LOVENSE_JOGWHEEL_SPEC.md`: a browser control panel plus a
small Express proxy that holds the Lovense developer token and relays
commands, so the toy and the controller can be on different networks.

## Status vs. the spec

Built per the spec's §12 order, tasks 2–6 (proxy, discovery, panel UI,
gamepad, safety model). **Task 1 — spec §3 "Step 0" — is not done.** Every
value the spec tags `[MUST CONFIRM]` is pulled into `src/config.js` /
`.env` rather than hardcoded, specifically so it's a one-line change once
you've verified it against a real developer token and paired hardware:

| Step 0 item | Where it lives now | How to update once confirmed |
|---|---|---|
| 1. Real command endpoint / cross-network relay | `LOVENSE_COMMAND_URL` env var | Set it in `.env` |
| 2. Per-motor addressing (`Vibrate1`/`Vibrate2`) | `LOVENSE_SUPPORTS_PER_MOTOR` env var | Set to `false` if unsupported — multi-motor toys fall back to one combined channel automatically (`src/deviceProfiles.js`) |
| 3. Combined multi-motor syntax | `lovense.buildActionString()` in `src/lovense.js` | Edit the join logic if the real syntax differs from `"Vibrate1:8,Vibrate2:14"` |
| 4. Callback capability data | Tier 0 in `src/deviceProfiles.js` (`toy.serverCapabilities`) | Currently dead code — wire it up if the callback/`/toys` payload turns out to carry motor data |
| 5. Rate limit / min interval | `MIN_COMMAND_INTERVAL_MS` env var | Tighten/loosen the throttle |

Until Step 0 is run, **do not** trust that two-motor toys actually respond
independently over long distance — verify with the calibration flow (Tier
3, see below) before relying on it.

## Architecture

```
[ Browser panel ]  --(session cookie)-->  [ Express proxy ]  -->  [ Lovense server ]  -->  [ Lovense Remote app ]  -->  [ toys ]
```

The proxy holds `LOVENSE_TOKEN` server-side; it never reaches the browser.
The panel is served by the same proxy, gated behind a password login.

## Setup

```
cd proxy
cp .env.example .env   # fill in real values
npm install
npm start               # or `npm run dev` for --watch
```

Required env vars are documented inline in `.env.example`. At minimum:
`LOVENSE_TOKEN`, `LOVENSE_UID`, `LOVENSE_SALT`, `PANEL_PASSWORD`,
`SESSION_SECRET`.

Deploying to Railway: set the same env vars there, mount a volume at
`proxy/data` (or leave it as container-local storage if losing cached
device profiles on redeploy is acceptable), and set `CALLBACK_PUBLIC_URL`
to the deployed URL. Register `<CALLBACK_PUBLIC_URL>/callback` as the
Callback URL in the Lovense developer dashboard.

## Using it

1. Open the deployed URL, log in with `PANEL_PASSWORD`.
2. Click **Get link QR**, scan it with the Lovense Remote app (or enter
   the code on PC Remote). The app calls back to `/callback`; toys then
   appear on the panel (polls every 4s until at least one shows up).
3. Each toy renders one wheel per motor, resolved via the tiered device
   discovery in spec §6:
   - a cached harvest/calibration profile, if one exists,
   - otherwise a static catalog match by reported name (`src/catalog.js`,
     community-sourced, not Lovense-official),
   - otherwise a single-motor fallback.
   Use **Harvest on LAN** (Tier 1, only works when the panel happens to be
   on the toy's own network — attempts a best-effort LAN `GetToys` call,
   with a manual-entry prompt fallback since the exact LAN response shape
   is unverified) or **Calibrate** (Tier 3 — pulses each candidate motor
   and asks what you felt; this is the ground-truth check and doubles as
   your Step 0 item 2 proof) to get a verified profile.
4. Drive wheels with mouse drag/scroll/±buttons, or a connected gamepad
   (deadzone + relative accumulation per spec §8 — hold a direction to
   creep the level, center to hold). Reassign axis→channel mapping in the
   Gamepad section; enable focus/solo mode to have one stick drive
   whichever channel is currently selected.
5. **Panic Stop** (button, or gamepad Back/Select or both bumpers) stops
   every toy and cancels all renewal timers immediately.

## Safety model (spec §9)

Every command sends `timeSec = HOLD_SECONDS` (default 12s), never 0. A
renewal timer re-sends the current combined level every
`HOLD_SECONDS * 0.66` while the panel is alive and in contact. If the tab
closes, the panel loses contact, or the proxy dies, renewals stop and the
toy winds itself down within `HOLD_SECONDS` on its own — the safety net
lives in the toy's own firmware timeout, not in a watchdog that could die
alongside the failure it's meant to catch.

## Project layout

```
proxy/
  server.js              Express app, session auth, route wiring
  src/
    config.js             Every tunable + [MUST CONFIRM] value, one place
    lovense.js             Lovense Server API client
    store.js               Atomic JSON file persistence
    deviceProfiles.js      Tiered discovery resolver (spec §6)
    catalog.js              Tier 2 static device catalog [COMMUNITY]
    auth.js                 Session / API-key auth middleware
    routes/                 /auth, /link, /callback, /toys, /command,
                             /stop, /harvest, /calibrate, /config
  public/
    login.html, index.html, css/style.css
    js/
      commandManager.js     Per-toy combined-action batching, throttle,
                             renewal timers
      gamepad.js             Gamepad API jog-wheel input (spec §8)
      harvest.js              Tier 1 LAN harvest + manual fallback
      calibrate.js            Tier 3 guided calibration flow
      app.js                   Wiring: render, mouse control, banners
  data/                    JSON device-profile / toy-cache store (gitignored)
```
