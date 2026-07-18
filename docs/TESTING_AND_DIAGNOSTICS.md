# Phase 0 Testing and Diagnostics Harness

## Commands

```bash
npm test
npm run build
npm run test:browser
npm run verify
```

The browser suite uses Playwright against a Vite server and a real WebGL canvas.
In CI, Chromium and its OS dependencies are installed before the smoke test. On
a workstation with Chrome already installed, run
`PLAYWRIGHT_CHANNEL=chrome npm run test:browser`.

## Deterministic test mode

Test mode is accepted only by Vite development builds or a build created with
`VITE_ENABLE_TEST_MODE=true`. Production defaults and production URL behavior
are unchanged. Example:

```text
/?testMode=1&profile=clean&seed=scenario-a&traffic=12&pedestrians=16&time=9.25&weather=rain&mission=mission_executive&quality=low
```

| Parameter | Purpose |
|---|---|
| `seed` | Installs deterministic randomness before world and agent creation. |
| `traffic` | Bounded moving-traffic target, 0–48. |
| `pedestrians` | Bounded pedestrian target, 0–60. |
| `time` | Initial time, clamped to 0–24. |
| `weather` | Initial canonical weather state; dynamic cycling is disabled. |
| `mission` | Selects one validated authored mission fixture. |
| `profile=clean` | Clears the local test profile before boot. |
| `quality` | Locks the existing renderer quality tier. |

The read-only `window.__METROPULSE_TEST__` bridge exposes snapshots and narrow
domain operations for time, weather, and mission selection. It is absent from
normal production sessions.

## Diagnostics

`?diagnostics=1` in development—or any deterministic test session—shows a
compact diagnostics panel and exposes the same immutable snapshot to tests. It
reports:

- game state/revision and active transition;
- scheduler owner, pause, and city-clock pause;
- controlled entity and active mission;
- save status, pending write, last save, and error;
- vehicles, pedestrians, aircraft, physics bodies, and scene objects;
- FPS/frame time, quality tier, draw calls, triangles, geometries, textures,
  programs, and browser heap counters where the browser exposes them;
- effective feature flags and deterministic scenario metadata.

Unavailable counters are reported as `null` or with an explicit legacy owner;
the panel does not manufacture precision. Phase 1 will replace the
`legacy-frame-loop` diagnostic with the authoritative scheduler.

## Smoke acceptance

The smoke test uses a clean profile and asserts successful HTTP/WebGL boot,
IndexedDB availability, deterministic fixture values, finite entity/resource
counts, keyboard mode switching, hidden post-MVP controls, diagnostics output,
and the absence of uncaught errors, unhandled rejections, failed requests,
fatal panels, or contradictory mode state.

