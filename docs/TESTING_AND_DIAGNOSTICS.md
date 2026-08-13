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
| `unavailableCapabilities=webgl2,localStorage,indexedDB` | Development-only capability-failure fixture for boot acceptance tests. |
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

Unavailable counters are reported as `null`; the panel does not manufacture
precision. The Phase 1 scheduler diagnostic reports its authoritative clock
policy, all six clocks, fixed/city cadence, accumulator remainder, and per-frame
step counts.

### Godot Phase 3 diagnostics

Godot debug builds render `DiagnosticsLayer` from a typed immutable
`DiagnosticSnapshot`. It reports engine/renderer/physics identity; the current
game, clock, and transition state; controlled entity and mission descriptors;
validated current/recovery state and pending restore; live scene/world/physics
counts; saved entity counts; FPS, frame time, draw calls, primitives, and video
memory; feature flags; and scenario/seed metadata. An owner that does not exist
in the empty Phase 3 session is labeled `EMPTY_SESSION_NO_SIMULATION_CLOCK` or
`DEFERRED_RESTORE`; it is never represented as live state.

The overlay and scenario hooks are debug-only. Release parsing rejects
`--run-integration-tests`, `--deterministic-test`, `--seed`, and `--low-tick`.
Release-safe recovery options such as `--boot-action`, `--import-save`, and
`--confirm-import` remain available.

### Godot Phase 11 native performance capture

Run an uncapped, native-window capture after closing unrelated GPU-heavy work:

```bash
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot \
  ./godot/scripts/capture-performance.sh \
  "$PWD/godot/artifacts/performance/native-high-debug.json" 20 5 HIGH
```

The final arguments are measured duration, warmup seconds, and the
`HIGH`/`MEDIUM`/`LOW` quality profile. The output path must be absolute. Capture
mode hides the debug overlay to avoid measuring its
scene-tree traversal and JSON serialization. It samples at 10 Hz and exits
automatically, writing through a temporary file before atomically replacing the
requested JSON report.

The report contains boot-to-interactive time; average and tail frame, process,
physics, navigation, CPU-render, and GPU-render timing; FPS; render counts;
Godot/static/managed/video memory; live objects/resources/nodes/orphans;
physics activity; audio voices; managed allocated bytes; and GC collection
deltas. A backend that cannot
publish measured GPU timestamps reports zero values with
`availability.gpuTiming=false`; consumers must not interpret those zeros as
free GPU work. Host data is limited to OS/runtime/hardware descriptors and does
not include user names, host names, paths, saves, dialogue, or device serials.

Run the Phase 3 native scenarios with:

```bash
GODOT_BIN=/path/to/Godot ./godot/scripts/test-integration.sh
```

The script proves clean New Game, imported Continue, recovery promotion,
corrupt-save rejection, future-version rejection, unconfirmed preview, and a
corrected confirmed retry. Successful runs contain 84, 84, and 88 assertions;
expected failures must exit nonzero with their stable error code.

## Smoke acceptance

The smoke test uses a clean profile, verifies that the world remains absent and
the game root inert at the boot menu, selects New Game, and then asserts
successful HTTP/WebGL startup, IndexedDB availability, deterministic fixture
values, finite entity/resource counts, keyboard mode switching, hidden
post-MVP controls, diagnostics output, and the absence of uncaught errors,
unhandled rejections, failed requests, fatal panels, or contradictory mode
state. Separate flows cover compatibility blocking plus Continue/Recover slot
eligibility.
