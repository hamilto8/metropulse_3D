# Phase 3 Game-Save Repository Handoff

Chunk ID and status: `phase-3-game-save-repository`; complete as the fourth Phase 3 slice. Phase 3 remains in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation continues from Godot revision `8cd3c2a` and targets Godot 4.6 stable .NET.

Objective and explicit non-goals: Implement crash-repairable, validated current/recovery file mechanics under `user://` with injected failures at every write boundary. This slice does not define the production save envelope, migrations, domain capture/restore, autosave/status service, boot discovery/actions, browser import, or UI.

Documents and source files read: Phase 3 plan and prior handoffs; `VERSIONED_SAVE_SERVICE.md`; browser `IndexedDbSaveRepository.js`, `SaveService.js`, `SaveSchema.js`, `PersistenceSystem.test.js`, and `BootFlow.test.js`; native settings storage, composition root, diagnostics runner, and verification scripts.

Files/scenes/resources added or changed: Added domain `IGameSaveDocumentValidator`, `IGameSaveRepository`, and `GameSaveSlots` contracts; added `GodotGameSaveRepository`; expanded real-filesystem headless integration; updated the Phase 3 plan, versioned-save contract, parity matrix, and this handoff. No browser source, session node, boot stage, or gameplay domain changed.

Authoritative owners touched: A future save-envelope validator remains the document authority and is required by repository construction. `GodotGameSaveRepository` owns storage mechanics and only its four paths. It never interprets gameplay domains. The repository refuses writes the injected validator cannot normalize and rereads temporary bytes through the same validator before promotion.

Public APIs, signals, events, input actions, collision layers: Added `IGameSaveRepository.ReadSlots`, `CommitCurrent`, `PutRecovery`, `PromoteRecovery`, and `ClearCurrent`; `GodotGameSaveRepository.DeleteOwnedFiles`, explicit path properties, `InjectedFault`, and `SimulateProcessInterruption`. Added six injectable boundaries from pre-temporary-write through pre-current-promotion. No Godot signal, boot event, InputMap action, autoload, schema, or collision layer was added.

Stable IDs/schema/content changes: Production paths are `user://saves/current.json`, `recovery.json`, `transaction.tmp`, and `recovery.tmp`. No save schema/version exists natively yet and no content ID changed.

Behavior implemented: Every candidate validates before write, flushes/closes, rereads and validates, then uses same-directory replacement. Valid current rotates to recovery; corrupt current never replaces recovery. Caught faults restore both prior slots exactly. A simulated stop after recovery rotation leaves a recognizable current/recovery/temp relationship that a new repository instance completes safely. A pre-rotation orphan is discarded, while recovery-only temporary bytes are always aborted on restart. Recovery promotion does not rotate current. New Game clearing preserves only a valid current as recovery.

Known deviations and ADR links: No parity deviation requires an ADR. IndexedDB provides a true multi-key transaction; common desktop filesystems provide atomic single-file same-volume replacement, not one transaction across current and recovery. The documented native adapter therefore combines individually atomic moves with deterministic startup repair. This is an implementation difference with equivalent known-good-slot safety, not a player-facing behavior change.

Tests added and exact commands: Expanded native integration from 47 to 60 assertions. Thirteen new checks cover exact paths, first commit, rotation, all six caught fault boundaries, simulated restart completion, invalid candidate rejection, corrupt-current protection, recovery promotion, New Game preservation, recovery-only replacement/interruption, non-preserving clear, and cleanup. Commands: `dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.csproj --no-restore -v:minimal`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`; `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/verify.sh`; and `npm test`.

Test results and artifact paths: Native build succeeds with zero warnings/errors; browser tests pass 389/389; domain tests pass 194/194; formatting passes; and all 60 headless integration assertions pass. The complete `godot/scripts/verify.sh` gate exits 0, including export-preset validation, zero canonical-content drift, the 62-file ownership audit across 73 domain files, build, domain tests, headless import, and integration. Domain TRX and Godot logs remain under `godot/artifacts/test-results/`.

Performance/resource counts before and after: Added no runtime node, listener, timer, body, render resource, collision object, or per-frame work. Repository operations allocate only during explicit reads/writes and are serialized by one process-local gate. Disk ownership grows from zero gameplay-save files to two durable slot files and at most one short-lived temporary per operation.

Manual checks performed: Inspected real `user://integration/` operations through headless Godot and confirmed integration cleanup removes every owned file. No player-facing save UI exists, so visual/accessibility review is deferred.

Open defects with severity and reproduction: None found in this slice. The production envelope validator and service must replace the integration-only fixture validator before repository construction enters boot.

Compatibility adapters and removal conditions: Browser `IndexedDbSaveRepository` remains frozen reference evidence. `GodotGameSaveRepository` is the target desktop adapter. Remove comparison ownership only after production envelope/service, discovery/actions, restore/import, and Phase 3 exit scenarios pass.

Next safe task: Implement the exact versioned save envelope, sequential migrations, future-version rejection, whole-document validation, discovery classifications, and save status/debounce service; then construct this repository with that production validator.

Unsafe/blocked tasks and required decision: Do not store unvalidated JSON, serialize Godot objects, let repository code mutate gameplay domains, rotate a corrupt current over recovery, or treat single-file atomic moves as a multi-file OS transaction. No external decision blocks the next slice.
