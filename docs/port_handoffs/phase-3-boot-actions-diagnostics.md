# Phase 3 Boot Actions, Diagnostics, and Scenario Handoff

Chunk ID and status: `phase-3-boot-actions-diagnostics`; complete as the seventh Phase 3 slice. Phase 3 remains in progress pending its exit audit.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation continues from Godot revision `b3c6979` and targets Godot 4.6 stable .NET.

Objective and explicit non-goals: Complete explicit New Game/Continue/Recover boot selection, actionable Retry presentation, truthful Phase 3 diagnostics, and every declared headless save/boot scenario. This slice does not fabricate a world, simulation clock, gameplay entity, live mission owner, graphical import picker, or runtime restore adapter that belongs to later phases.

Files/scenes/resources added or changed: Expanded `RuntimeConfiguration`, `BootStatusPresenter`, `CompositionRoot`, `DiagnosticsOverlay`, `DiagnosticSnapshot`, `IntegrationTestRunner`, `Main.tscn`, native integration/smoke scripts, configuration tests, the port plan, diagnostics guide, parity matrix, and this handoff. No save schema, content record, InputMap action, collision layer, or canonical fixture changed.

Authoritative owners touched: `GameSaveDiscoveryReport.Actions` alone determines action eligibility. `CompositionRoot` selects an explicit release-safe CLI action or delegates to `BootStatusPresenter`; headless boot fails closed without one. `GameSaveDiscovery` and the repository remain the only action/application and slot-mutation authorities. `DiagnosticsOverlay` reads composition/session authorities and never becomes gameplay state.

Public APIs, IDs, and behavior: Added `--boot-action=NEW_GAME|CONTINUE|RECOVER`, `BOOT_ACTION_REQUIRED`, and `BOOT_ACTION_UNAVAILABLE`. The boot layer exposes New Game always, Continue only for valid current, Recover only for valid recovery, save dates/reasons, and Retry after fatal failure. Invalid and future import validation now retains stable `INVALID_SAVE` and `FUTURE_SAVE_VERSION` error codes through the boot boundary. Headless smoke explicitly chooses New Game.

Diagnostics contract: `DiagnosticSnapshot` now includes runtime state/clock policy/transition, controlled entity, mission, save state, scene/world/physics and saved/content counts, FPS/frame time, renderer counters, feature flags, and scenario metadata. Empty owners are labeled `EMPTY_SESSION_NO_SIMULATION_CLOCK`; retained world/entity data is labeled `DEFERRED_RESTORE`. Debug test hooks are reported only in debug builds, and parsing continues to reject integration/deterministic/seed/low-tick options in release.

Tests and results: Runtime configuration has explicit action acceptance/rejection coverage. The Godot integration runner verifies action availability and one-shot selection, Retry, every diagnostics group, slot state, deferred controlled-entity data, and recovery promotion/static preparation. `godot/scripts/test-integration.sh` runs successful clean New Game (84 assertions), confirmed Continue (84), and imported-New-Game plus Recover (88); it also requires nonzero unconfirmed-preview, corrupt, and future-version runs with stable error codes. The corrected Continue run is the retry after rejected fixtures. The browser suite passes 391/391, Vite production build passes, the native suite passes 220/220, formatting is clean, the native build has zero warnings/errors, and the complete `godot/scripts/verify.sh` gate exits 0 on Godot 4.6 stable .NET.

Performance/resource behavior: The debug overlay refreshes presentation at 4 Hz and samples real rendering counters; release builds hide it. Action selection adds only boot-layer Controls and one temporary task completion source while visible. No gameplay `_Process`/physics owner, body, timer, save writer, or persistent listener was added.

Open defects and next safe task: No defect was found in this slice. Runtime restore remains intentionally pending until its owners exist. The next safe task is the complete Phase 3 requirement/exit audit, followed by one full browser/native/build/format verification gate.

Unsafe/blocked tasks: Do not enable actions from slot presence without validation, auto-select a graphical boot action, hide a fatal error without a remedy, expose deterministic hooks in release, report deferred save data as a live entity, or clear the runtime descriptor before a real adapter succeeds. No external decision blocks the exit audit.
