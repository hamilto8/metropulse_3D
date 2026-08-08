# Phase 1 Foundation Handoff

Chunk ID and status: `phase-1-foundation`; Complete — exited 2026-08-07

Source revision / Godot revision: Browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation began from `fc1e4651aa898740cb32b9e9b2b1a6095a5b4d35`; Godot target 4.6 stable .NET.

Objective and explicit non-goals: Establish the buildable three-project workspace, empty disposable runtime shell, diagnostics, deterministic debug hooks, collision vocabulary, test entry points, and export presets. No gameplay, content port, economy, missions, persistence, world generation, player control, or production UI is implemented.

Documents and source files read: `docs/GODOT_4_6_CSHARP_PORT_PLAN.md`, `docs/GODOT_PORT_PHASE_0_EXIT_REPORT.md`, `docs/DESIGN_DECISIONS.md`, `docs/GODOT_PORT_TARGET_HARDWARE_MATRIX.md`, `docs/GODOT_PORT_PARITY_MATRIX.md`, `docs/TESTING_AND_DIAGNOSTICS.md`, `.github/workflows/ci.yml`, `.gitignore`, `package.json`, and the Phase 0 fixture inventory.

Files/scenes/resources added or changed: `global.json`, `.editorconfig`, `.gitignore`, `godot/Directory.Build.props`, `godot/MetroPulse.Godot/MetroPulse.Godot.sln`, all three project directories, `Main.tscn`, `SessionShell.tscn`, runtime/diagnostic scripts, export presets, command scripts, CI, parity matrix, Phase 1 evidence, this handoff, and `docs/GODOT_PORT_PHASE_1_FOUNDATION.md`.

Authoritative owners touched: `CompositionRoot` owns session construction/disposal; `SessionShell` owns empty per-session nodes; `RuntimeConfiguration` owns debug/test option validation; `DiagnosticsOverlay` publishes the foundation snapshot. No gameplay authority or autoload was created.

Public APIs, signals, events, input actions, collision layers: Public foundation methods are `CompositionRoot.StartSession`, `CompositionRoot.DisposeSession`, `SessionShell.Shutdown`, `RuntimeConfiguration.Parse`, `DiagnosticsOverlay.Initialize`, and `DiagnosticsOverlay.SetFatalError`. No signals or input actions are defined. Physics layer bits 1–9 are Surface, StaticObstacle, Traffic, Player, Pedestrian, Interaction, MissionTrigger, Effect, and CameraQuery.

Stable IDs/schema/content changes: Stable diagnostic event IDs added: `foundation.ready`, `foundation.boot_failed`, `session.created`, `session.disposed`, `integration.passed`, and `integration.failed`. No save schema or content IDs changed.

Behavior implemented: Debug boot validates options, applies the 120 Hz or debug-only 30 Hz cadence, creates the empty session shell, publishes structured diagnostics, hides the boot layer on success, and presents an actionable fatal screen on failure. Integration-test mode is deterministic and exits explicitly.

Known deviations and ADR links: No gameplay parity deviation. Forward+ remains the primary renderer target; Compatibility fallback evidence remains Phase 11 work. `DD-016` governs platform scope. Linux remains a release target. One foundation boot passed in automatically triggered run `31230939599` before the smoke step was removed; further Linux host validation is deferred to the Phase 11 release-platform matrix by Project Owner direction.

Tests added and exact commands: Six `RuntimeConfigurationTests` and two collision-contract tests via `./godot/scripts/build.sh` and `./godot/scripts/test-domain.sh`; export identifiers via `./godot/scripts/validate-export-presets.sh`; eighteen engine assertions via `./godot/scripts/validate-headless.sh` and `./godot/scripts/test-integration.sh`; exported shell boot via `./godot/scripts/smoke-export.sh <host> <kind>`.

Test results and artifact paths: Local macOS arm64 verification passes: deterministic build with zero warnings, formatting check with zero changes, eight domain tests, headless import, eighteen engine assertions, ad-hoc-signed macOS debug/release export smoke, and corrected Linux x86-64 cross-export. The local Linux ELF is 71,211,584 bytes with SHA-256 `d78cf9c784ae7e8de19b1720a7f12ce142c1eafa9349e06cbbbc899ef0b15db5`. GitHub `godot-foundation` run `31230939599` passed and uploaded artifact `godot-foundation-31230939599` (`9013805654`, SHA-256 `a4ee55ef8dba91b434bb550de2898cbde18522bf65cc883e18fd81d8206fb694`). Machine-readable summary: `docs/port_evidence/phase1/local-verification.json`. Domain TRX output is `godot/artifacts/test-results/domain-tests.trx`; generated local exports are intentionally ignored.

Performance/resource counts before and after: Foundation only; one session root, five empty world sub-roots, one runtime services node, one camera rig/camera, one HUD layer, and two process-wide CanvasLayers. No performance claim made.

Manual checks performed: Reviewed scene ownership and output bundle contents; confirmed both universal macOS app bundles contain `MetroPulse.Godot.dll` and reach the structured `foundation.ready` event at 120 Hz. Interactive review of the debug shell confirmed a clean 1280×720 empty boot window, Metal/Forward+, Jolt Physics, interpolation enabled, a loaded session, no fatal error, and the debug-only 30 Hz profile. Screenshot: `docs/port_evidence/phase1/macos-low-tick-visual.png`.

Open defects with severity and reproduction: None blocking Phase 1 exit. `P1-CI-001` is resolved: initial GitHub Actions run `31230152731` exposed the invalid `platform="Linux/BSD"` identifier; run `31230939599` passed with `platform="Linux/X11"`, the preflight validator, Linux export, and the old smoke step. Future Linux host smoke is removed from Phase 1 and deferred to Phase 11. `P1-VIS-001` is resolved by the recorded debug-shell review.

Compatibility adapters and removal conditions: `METROPULSE_SOURCE_REVISION` is a build-time metadata adapter and remains until build metadata is generated into the assembly. JSON compatibility work has not started.

Next safe task: Commit the Phase 1 status and CI deferral update, then begin Phase 2 content validation and pure-domain work.

Unsafe/blocked tasks and required decision: Do not treat the single foundation boot as full Linux runtime compatibility acceptance; that remains a Phase 11 matrix decision. Phase 2 may begin after the completed foundation changes are reviewed; it must keep content and rules engine-neutral and must not introduce gameplay authority into the shell prematurely.
