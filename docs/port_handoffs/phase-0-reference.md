# Phase 0 Reference Handoff

**Chunk ID and status:** Phase 0 reference oracle; automated evidence complete,
phase exit pending product/manual signoff.

**Source revision / Godot revision:** Browser
`44a286a74557adfe4fabd3a6e16b9006079eba32`; no Godot project/revision exists
yet.

**Objective and explicit non-goals:** Freeze browser behavior, produce
deterministic cross-engine fixtures, archive repeatable browser evidence, and
plan ownership for every MVP requirement. This chunk does not scaffold Godot,
port gameplay, approve product policy, certify hardware, or change browser
runtime behavior.

**Documents and source files read:** `README.md`, `docs/MVP_SCOPE.md`,
`docs/REQUIREMENT_TRACEABILITY.md`, `docs/GAME_STATE_MACHINE.md`,
`docs/SIMULATION_SCHEDULER.md`, `docs/VERSIONED_SAVE_SERVICE.md`,
`docs/MISSION_LIFECYCLE.md`, `docs/TESTING_AND_DIAGNOSTICS.md`,
`docs/GODOT_4_6_CSHARP_PORT_PLAN.md`, `src/app/RuntimeConfig.js`,
`src/testing/BrowserTestBridge.js`, `test/browser/smoke.spec.js`, and the domain,
content, save, world, agent, camera, settings, alert, mission, and economy
sources imported by `Tools/BaselineCapture/baseline-fixtures.mjs`.

**Files/scenes/resources added or changed:** Baseline capture/generation tools
under `Tools/BaselineCapture/`; 18 JSON fixtures and manifest under
`test/fixtures/godot-port/phase0/`; deterministic fixture tests; 36 browser
screenshots, telemetry manifest, environment and verification reports under
`docs/port_evidence/phase0/`; parity matrix, target hardware matrix, this exit
report/handoff; `DD-016`; npm scripts. No scenes or runtime assets changed.

**Authoritative owners touched:** Read-only use of GameManager,
SimulationScheduler, EconomySystem, content validation, mission lifecycle,
AlertService, SettingsStore, SaveSchema/SaveGameState, TrafficSystem,
CityBuilder terrain, camera presets, and vehicle/pedestrian definitions. No
runtime authority changed.

**Public APIs, signals, events, input actions, collision layers:** No production
API, signal, event, input action, or collision-layer changes. Tool entry points
are `baseline:capture`, `baseline:check`, `baseline:capture:browser`,
`baseline:capture:environment`, `baseline:matrix`, and
`baseline:verify:reference`.

**Stable IDs/schema/content changes:** None. Fixture envelope schema is version
1 and references the existing save schema 2 / feature version 2. All production
stable IDs are copied from the frozen browser source.

**Behavior implemented:** Deterministic capture and verification tooling only.
The browser product behavior is unchanged.

**Known deviations and ADR links:** No parity deviation. `DD-016` records the
provisional desktop-first platform choice and remains unsigned.

**Tests added and exact commands:** `test/BaselineCapture.test.js` checks
same-process determinism and checked-in fixture identity. Exact commands:
`npm run baseline:capture`, `npm run baseline:check`,
`PLAYWRIGHT_CHANNEL=chrome npm run baseline:capture:browser`,
`npm run baseline:capture:environment`, `npm run baseline:matrix`, and
`PLAYWRIGHT_CHANNEL=chrome npm run baseline:verify:reference`.

**Test results and artifact paths:** 389/389 Node tests pass; production build
passes with 143 modules; 9/9 Chrome smoke scenarios pass; 1/1 browser atlas
capture passes; 18 fixture files reproduce with no mismatch. Machine-readable
results are under `docs/port_evidence/phase0/verification/`; exact fixture and
screenshot hashes are in their manifests.

**Performance/resource counts before and after:** No browser runtime code
changed, so there is no before/after product delta. The low-quality reference
atlas records live renderer/entity/resource counters per scenario. The current
build remains 854.63 kB raw for application code and 559.34 kB for Three.js
core; these are existing advisories.

**Manual checks performed:** Visually inspected the generated Management
reference at 1280×720 for a rendered city, visible HUD/tools, diagnostics, and
nonblank WebGL content. The capture test asserts visible boot/runtime/modal
states and successful domain operations. This is not a full human playtest.

**Open defects with severity and reproduction:** P1 process blocker: `DD-016`
needs Product Lead signoff. P1 evidence gap: manual interaction/vehicle atlas
items listed in `GODOT_PORT_PHASE_0_EXIT_REPORT.md` are not captured. P2 known
build risk: app and Three.js core chunks exceed Vite's 500 kB advisory; run
`npm run build`.

**Compatibility adapters and removal conditions:** The browser build itself is
the Phase 0 compatibility oracle. Keep it available until every parity-matrix
row passes or has an approved deviation ADR and browser-save import is released
or explicitly excluded.

**Next safe task:** Obtain platform/save-policy signoff, complete the manual
capture atlas, then mark Phase 0 exited. After that, scaffold the Phase 1
three-project Godot/.NET workspace against the checked fixtures.

**Unsafe/blocked tasks and required decision:** Do not claim C# web export,
delete the browser reference, choose a different stable ID/save vocabulary, or
begin final cutover. Those actions require a superseding product decision and
updated parity evidence.
