# Phase 3 Settings and InputMap Handoff

Chunk ID and status: `phase-3-settings-inputmap`; complete as the second Phase 3 slice. Phase 3 remains in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation continues from Godot revision `d85035f` and targets Godot 4.6 stable .NET.

Objective and explicit non-goals: Persist the existing validated global settings document under `user://`, project all seven contextual binding maps into Godot InputMap, apply changes live, and prove restart and interrupted-write behavior. This chunk does not implement runtime input sampling, device switching, edge state, focus-loss clearing, held-device quarantine, prompts, settings UI, save-envelope settings snapshots, game-save storage, or boot Continue/Recover.

Documents and source files read: Phase 3 plan and first handoff; `SETTINGS_AND_BINDINGS_STORE.md`; browser `ControlBindings.js`, `InputManager.js`, `SettingsStore.js`, `SettingsSchema.js`, `InputManager.test.js`, `SettingsStore.test.js`; C# settings contracts/catalog/store/validator/tests; native composition root, diagnostics runner, scenes, and verification scripts.

Files/scenes/resources added or changed: Added `GodotSettingsStorage`, `GodotInputMapAdapter`, and `GODOT_INPUT_ACTIONS.md`; inserted `settings-bootstrap` into `CompositionRoot`; expanded `IntegrationTestRunner`; updated the port plan, parity matrix, and this handoff. No browser source or domain settings behavior changed.

Authoritative owners touched: `SettingsStore` remains the only preference/binding document authority. `GodotSettingsStorage` owns one current and one temporary global-settings path and no gameplay state. `GodotInputMapAdapter` owns only `metropulse_` InputMap actions and observes committed settings events. `CompositionRoot` owns adapter construction, subscription lifetime, and integration-test cleanup.

Public APIs, signals, events, input actions, collision layers: Added `GodotSettingsStorage.GetItem`, `SetItem`, `DeleteOwnedFiles`, paths, and injectable write stages; `GodotInputMapAdapter.Start`, `Apply`, `Dispose`, action-name helpers, and action count. Added 45 aggregate and 66 slot action names documented in `GODOT_INPUT_ACTIONS.md`. No Godot signal, autoload, collision layer, or raw gameplay key comparison was added.

Stable IDs/schema/content changes: Settings schema remains version 2 and `SettingsValidator.StorageKey` remains unchanged. Production file paths are `user://settings-v2.json` and `user://settings-v2.json.tmp`. Input action names are deterministically derived from the existing seven context and 45 action IDs. Browser-reserved keys and gamepad mappings are unchanged. No content/save schema changed.

Behavior implemented: The settings boot stage loads defaults, valid version-2 JSON, or migratable version-1 JSON through `SettingsStore`; corrupt/future documents retain the existing fallback/warning behavior. Writes validate, flush, close, reread/validate, then same-directory replace. InputMap receives aggregate actions with keyboard/mouse and fixed standard-gamepad events plus per-slot keyboard/mouse actions. Pointer motion remains raw analog. Committed rebind/reset events rebuild only the owned namespace immediately. Integration uses an isolated per-process file and deletes it at shutdown.

Known deviations and ADR links: No parity deviation requires an ADR. `System.IO.File.Move(source, destination, overwrite: true)` performs the same-directory replace after Godot `FileAccess` writes/flushes the temporary document; the full game-save repository will separately document stronger current/recovery guarantees by OS. Runtime device/edge/quarantine behavior remains deliberately unclaimed and is the next input slice. Physical-key mapping preserves browser `event.code`; fixed gamepad controls remain non-remappable for MVP.

Tests added and exact commands: Expanded native integration from 28 to 39 assertions. It verifies seven-stage order, isolated settings path, 111 default actions, all contexts/actions, keyboard plus gamepad events, pointer-motion treatment, immediate rebinding, reload persistence, injected pre-promotion failure, temporary cleanup, and context reset. Commands: `dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.csproj --no-restore --no-incremental -v:minimal`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`; `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/verify.sh`; and `npm test`.

Test results and artifact paths: The native build succeeds with zero warnings/errors; browser tests pass 389/389; domain tests pass 185/185; format verification passes; and all 39 headless integration assertions pass. The complete `godot/scripts/verify.sh` gate exits 0, including export-preset validation, zero canonical-content drift, the 62-file ownership audit across 71 domain files, build, domain tests, headless import, and integration. Domain TRX output is `godot/artifacts/test-results/domain-tests.trx`; headless import and integration logs are `godot/artifacts/test-results/godot-import.log` and `godot/artifacts/test-results/godot-integration.log`.

Performance/resource counts before and after: Boot stages increase from six to seven and progress events from 12 to 14. InputMap owns 111 small action records: 45 aggregates and 66 stable slots. Settings owns one listener, one current file, and at most one short-lived temporary file. No session node, physics body, timer, audio player, collision layer, or per-frame allocator is added.

Manual checks performed: Inspected structured headless boot order and confirmed settings loads before content/session construction. Verified integration action/event queries for keyboard, mouse, standard gamepad, rebind, reset, and pointer motion. No player-facing settings UI exists yet, so interactive/manual accessibility review is deferred.

Open defects with severity and reproduction: None found in this slice. Runtime focus/device/edge/quarantine requirements and all game-save scenarios remain unimplemented planned work.

Compatibility adapters and removal conditions: Browser settings/input modules remain frozen reference owners until native runtime sampling, settings UI, prompts, and save integration pass. `GodotInputMapAdapter` is the target adapter; remove its browser comparison obligation only after the Phase 3 input-state exit checks and later Phase 9 UI acceptance pass.

Next safe task: Add the scheduled runtime input-state owner for live keyboard/gamepad switching, dead zones, edge detection, focus-loss clearing, held-device quarantine, context gating, and prompt snapshots without adding gameplay movement yet.

Unsafe/blocked tasks and required decision: Do not read raw keys in gameplay nodes, allow InputMap to own settings truth, serialize engine events, add controller remapping, or enable session input before boot readiness. No external decision blocks the next input-state slice.
