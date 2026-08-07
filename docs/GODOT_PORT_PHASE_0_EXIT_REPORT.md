# Godot 4.6 Port Phase 0 Exit Report

> **Status:** In progress — automated browser oracle complete; exit gate not yet signed off  
> **Frozen browser reference:** `44a286a74557adfe4fabd3a6e16b9006079eba32` (`codex/godot_port`)  
> **Captured:** 2026-08-07, America/Chicago

## Outcome

The browser reference now has a deterministic, checked-in parity oracle and a
reproducible Chrome evidence atlas. The full unit, build, and nine-scenario
browser smoke suites pass, and their complete outputs are archived as JSON.
All 97 permanent MVP requirement IDs have a planned Godot owner, port phase,
automated test, manual test, deviation, and signoff column.

Phase 0 must not yet be reported as exited. `DD-016` still needs Product Lead
acceptance, the target hardware matrix is a proposal rather than a measured
compatibility result, and several interaction/vehicle screenshots named by the
port plan remain manual capture work.

## Work-item status

| Item | Status | Evidence |
|---|---|---|
| 0.1 Environment and scenario record | Complete | `docs/port_evidence/phase0/environment.json`; browser manifest records actual Chrome version, configured UA, viewport, renderer telemetry, scenario seed, entity targets, quality, and feature flags. |
| 0.2 Unit/build/browser evidence | Complete on the reference workstation | `docs/port_evidence/phase0/verification/summary.json` and per-command JSON reports. |
| 0.3 Deterministic JSON parity fixtures | Complete | 18 fixture files plus SHA-256 manifest under `test/fixtures/godot-port/phase0/`. |
| 0.4 Screenshots and telemetry traces | Partial | 36 screenshot/telemetry scenarios under `docs/port_evidence/phase0/browser/`; manual gaps are listed below. |
| 0.5 Save corpus | Complete for schema/validation parity | Valid, recovery, corrupt, schema 0, schema 1, future, controlled-entity, mid-mission, and RESULT fixtures. |
| 0.6 Requirement parity matrix | Complete | `docs/GODOT_PORT_PARITY_MATRIX.md` contains all 97 IDs. |
| 0.7 Platform decision and hardware targets | Recorded, awaiting signoff/measurement | `DD-016` and `docs/GODOT_PORT_TARGET_HARDWARE_MATRIX.md`. |

## Automated verification result

The archived pass used the workstation Chrome channel because the bundled
Playwright browser is not assumed to be installed locally.

| Check | Result | Duration | Artifact |
|---|---:|---:|---|
| `npm run baseline:check` | Pass | 277 ms | `verification/baseline-fixtures.json` |
| `npm test` | Pass — 389 tests | 3.58 s | `verification/unit.json` |
| `npm run build` | Pass — 143 modules | 456 ms | `verification/build.json` |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- --reporter=json` | Pass — 9 scenarios | 36.20 s | `verification/browser.json` |

The production build remains above Vite's advisory threshold: the application
chunk is 854.63 kB raw and the Three.js core chunk is 559.34 kB raw. This is a
reference fact, not a Godot regression and not a Phase 0 failure.

## Fixture inventory and comparison rules

Run `npm run baseline:capture` to regenerate the corpus and
`npm run baseline:check` to fail on any difference. The manifest records the
byte count and SHA-256 for every file:
`test/fixtures/godot-port/phase0/manifest.json`.

The corpus covers:

- every game-state policy and every requested state pair;
- all six scheduler clocks, policy gates, accumulators, and task order;
- economy initial state, 15/30/60/120-minute scenarios, spending decisions,
  service shortages, and spatial land-value samples;
- complete content records/counts and representative validation failures;
- production mission availability plus success, failure, checkpoint, retry,
  cleanup, receipt, result, and recovery paths;
- alerts, default/custom settings, bindings, and invalid binding behavior;
- road nodes/edges, bridge layout/cable samples, terrain samples, camera
  presets, navigation constants, and representative vehicle profiles;
- seeded pedestrian and traffic descriptors with navigation corrections;
- the complete save corpus and schema 0/1 migration output.

Exact comparison applies to IDs, counts, names, phases, commands,
transactions, serialized fields, and task order. Pure double calculations use
the fixture epsilon (normally `1e-9`). Positions use an initial 0.01 m absolute
tolerance. Physics uses reviewed scenario envelopes. Screenshots are semantic
references for landmarks, composition, color, and readability, not pixel-match
goldens.

## Browser atlas

Run:

```bash
PLAYWRIGHT_CHANNEL=chrome npm run baseline:capture:browser
```

The atlas includes clean boot, New Game, all 16 dawn/day/dusk/night ×
clear/mist/rain/thunderstorm combinations, Builder empty/preview/placement,
on-foot and bat states, vehicle control, Heat, pause, settings, structured
alerts, mission offer/active/failure/retry/success/history, saved state, and
Continue/Recover eligibility. The manifest stores a screenshot hash,
configuration, and selected immutable diagnostics for every scenario.

The actual launched Chrome reports version `151.0.7922.76`. The Playwright
Desktop Chrome device profile supplies a Chrome 149 user-agent string; both
values are retained in the manifest so future runs can distinguish executable
version from emulation metadata.

## Remaining exit-gate work

1. Product Lead must accept or supersede `DD-016` and approve the save-import
   policy. No engineer or automated run can manufacture that signoff.
2. Capture and review Builder move, rotate, and demolish; on-foot collision,
   jump, live bat impact, hijack, and exit; sedan/sports/bus/truck/motorbike
   flat/turn/bridge/rain/collision/reset envelopes; race checkpoint; sabotage
   hold; minimap-specific composition; police pursuit; and an applied recovery
   restore. Existing automated tests remain supporting evidence, not substitutes
   for the named visual/manual captures.
3. Run the browser reference on clean Firefox/WebKit profiles or explicitly
   narrow Phase 0 evidence to Chrome. The current full pass is Chrome-only.
4. Measure at least one minimum and recommended native target per release OS in
   Phase 11; the Phase 0 hardware table is intentionally a target matrix.
5. Obtain named signoff for the parity matrix and screenshot atlas. All Godot
   rows correctly remain `Not Started`.

## Known variability and exclusions

- FPS, heap, renderer counters, and screenshot pixels vary with driver,
  compositor, browser state, and warmup. Configuration and raw telemetry are
  archived; comparisons must use budgets or semantic review.
- A workstation without Chrome must install the pinned Playwright Chromium or
  supply another reviewed channel. A launch failure is an environment failure,
  not a gameplay assertion failure.
- Aircraft, rocket launch, East development, countryside authored gameplay,
  Mayhem variants, persistent Mayhem, mobile, and other post-MVP breadth remain
  excluded/default-off. The fixtures still validate retained authored content
  where the source contract requires it.
- The browser reference is frozen at the revision above. Any later source
  behavior change requires refreshed fixtures, evidence, hashes, and either an
  accepted backport decision or a parity ADR.

## Next safe task

Obtain `DD-016` signoff and finish the manual atlas gaps. Phase 1 scaffolding
may be prepared in parallel only if it treats this report as a non-exited Phase
0 gate and does not claim release-platform acceptance.
