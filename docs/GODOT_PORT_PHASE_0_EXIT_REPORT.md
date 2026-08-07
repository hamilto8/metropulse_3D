# Godot 4.6 Port Phase 0 Exit Report

> **Status:** Exited — accepted by the Project Owner on 2026-08-07
> **Frozen browser reference:** `44a286a74557adfe4fabd3a6e16b9006079eba32` (`codex/godot_port`)  
> **Captured:** 2026-08-07, America/Chicago

## Outcome

Phase 0 exited on 2026-08-07. The browser reference has a deterministic,
checked-in parity oracle and reproducible browser and manual evidence atlases.
The full unit, build, and nine-scenario Chrome smoke suites pass with complete
machine-readable output. The Project Owner also attested that clean-profile
Firefox and WebKit runs pass and accepted the parity matrix, both atlases,
`DD-016`, and the target hardware matrix.

All 97 permanent MVP requirement IDs have a planned Godot owner, port phase,
automated test, manual test, deviation, and signoff column. This Phase 0
acceptance freezes the reference and its plan; it does not mark any future
Godot implementation row as passed.

## Work-item status

| Item | Status | Evidence |
|---|---|---|
| 0.1 Environment and scenario record | Complete | `docs/port_evidence/phase0/environment.json`; browser manifest records actual Chrome version, configured UA, viewport, renderer telemetry, scenario seed, entity targets, quality, and feature flags. |
| 0.2 Unit/build/browser evidence | Complete and accepted | `docs/port_evidence/phase0/verification/summary.json` and per-command JSON reports archive Chrome; `docs/port_evidence/phase0/acceptance.json` records the clean-profile Firefox/WebKit attestation. |
| 0.3 Deterministic JSON parity fixtures | Complete | 18 fixture files plus SHA-256 manifest under `test/fixtures/godot-port/phase0/`. |
| 0.4 Screenshots and telemetry traces | Complete | 36 reproducible scenarios under `docs/port_evidence/phase0/browser/` plus 43 reviewed interaction/vehicle scenarios and SHA-256 manifest under `docs/port_evidence/phase0/manual/`. |
| 0.5 Save corpus | Complete for schema/validation parity | Valid, recovery, corrupt, schema 0, schema 1, future, controlled-entity, mid-mission, and RESULT fixtures. |
| 0.6 Requirement parity matrix | Complete | `docs/GODOT_PORT_PARITY_MATRIX.md` contains all 97 IDs. |
| 0.7 Platform decision and hardware targets | Complete for Phase 0 | Accepted `DD-016` and `docs/GODOT_PORT_TARGET_HARDWARE_MATRIX.md`; exported-build measurements remain Phase 11 work. |

## Automated verification result

The archived pass used the workstation Chrome channel because the bundled
Playwright browser is not assumed to be installed locally.

| Check | Result | Duration | Artifact |
|---|---:|---:|---|
| `npm run baseline:check` | Pass | 277 ms | `verification/baseline-fixtures.json` |
| `npm test` | Pass — 389 tests | 3.48 s | `verification/unit.json` |
| `npm run build` | Pass — 144 modules | 427 ms | `verification/build.json` |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:browser -- --reporter=json` | Pass — 9 scenarios | 35.40 s | `verification/browser.json` |

The production build remains above Vite's advisory threshold: the application
chunk is 868.19 kB raw and the Three.js core chunk is 559.34 kB raw. This is a
reference fact, not a Godot regression and not a Phase 0 failure.

## Cross-browser acceptance and signoff

| Subject | Result | Evidence |
|---|---:|---|
| Chromium/Chrome | Pass | Archived machine report with executable version and raw test output. |
| Firefox, clean profile | Pass | Project Owner attestation; executable version and raw logs were not archived. |
| WebKit, clean profile | Pass | Project Owner attestation; executable version and raw logs were not archived. |
| Phase 0 reference package | Accepted | Project Owner signoff recorded in `docs/port_evidence/phase0/acceptance.json`. |

The signoff accepts the parity matrix, browser atlas, manual interaction and
vehicle atlas, target hardware matrix, and `DD-016`. Planned row-level owners
still retain authority over future Godot verification and deviation signoff.

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

## Manual interaction and vehicle atlas

`docs/port_evidence/phase0/manual/manual-manifest.json` records 43/43 reviewed
scenarios and 4,064,225 screenshot bytes. Every screenshot has a checked
SHA-256 and paired telemetry. The pass includes:

- Builder move, rotate, and demolition with committed before/after state;
- on-foot collision blocking, airborne jump, registered bat contact, timed
  hijack, and an exit spawn 1.814 m from the source vehicle;
- sedan, sports, bus, truck, and motorbike captures for flat acceleration,
  turning, bridge travel, rain, resolved vehicle contact, and upright reset;
- a race checkpoint advance, active sabotage hold, readable minimap mission
  composition, four responding police vehicles, and an applied recovery save
  restored to the earlier 07:15 state.

The off-canvas semantic controls used for the run are available only when both
development test mode and `manualCapture=1` are explicit. Normal play is
unchanged.

## Exit-gate closure

1. Browser unit, build, and smoke suites pass; Chrome output is archived and
   Firefox/WebKit clean-profile compatibility is owner-attested.
2. Baseline fixtures are deterministic, checked in, and hash-verified.
3. Browser and manual screenshots identify the frozen source and scenario
   configuration.
4. Every MVP requirement has a planned Godot owner and phase.
5. Platform/save-migration policy, target hardware, parity matrix, and both
   atlases have Project Owner signoff.

All Phase 0 exit gates are closed. All Godot rows correctly remain `Not
Started` until their implementation-phase verification is complete.

Native measurements for minimum and recommended configurations remain required
in Phase 11, but they are not a Phase 0 exit blocker now that the target matrix
is accepted.

## Known variability and exclusions

- FPS, heap, renderer counters, and screenshot pixels vary with driver,
  compositor, browser state, and warmup. Configuration and raw telemetry are
  archived; comparisons must use budgets or semantic review.
- A workstation without Chrome must install the pinned Playwright Chromium or
  supply another reviewed channel. A launch failure is an environment failure,
  not a gameplay assertion failure.
- Firefox and WebKit compatibility is accepted from the Project Owner's
  clean-profile runs. Their executable versions and raw logs were not archived, so
  that result is an attestation rather than a reproducible machine report.
- Aircraft, rocket launch, East development, countryside authored gameplay,
  Mayhem variants, persistent Mayhem, mobile, and other post-MVP breadth remain
  excluded/default-off. The fixtures still validate retained authored content
  where the source contract requires it.
- The browser reference is frozen at the revision above. Any later source
  behavior change requires refreshed fixtures, evidence, hashes, and either an
  accepted backport decision or a parity ADR.

## Next safe task

Begin Phase 1 by scaffolding the three-project Godot/.NET workspace against the
checked Phase 0 fixtures. Do not claim release-platform measurements; native
minimum/recommended hardware validation remains Phase 11 work.
