# Phase 5 Session Runtime Handoff

Chunk ID and status: `phase-5-session-runtime`; complete as the first Phase 5 slice, covering work item 5.1.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `8845aeb` and targets Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Connect the existing pure state, transition-policy, pause, input, and scheduler contracts to one live Godot session owner with compensatable engine phases. This slice does not create the gameplay camera rig, pedestrian/vehicle entities, physics, interactions, product pause UI, or the final 50-cycle cross-mode soak.

Documents and source files read: Phase 5 and cross-cutting sections of the port plan; the Phase 4 exit handoff; `GAME_STATE_MACHINE.md`; `TRANSITION_COORDINATOR.md`; `SIMULATION_SCHEDULER.md`; `PAUSE_AND_MODAL_BEHAVIOR.md`; browser `GameManager`, `TransitionCoordinator`, `MetroPulseTransitionRuntime`, and schedule sources; C# state policy, pause, scheduler, runtime input, camera-world adapter, session shell, diagnostics, and integration owners.

Files/scenes/resources added or changed: Added pure `GameStateMachine` and `GameTransitionCoordinator`; fourteen transition cases; the Godot player-control bridge boundary, transition runtime, and session runtime host; session/readiness/disposal wiring; authoritative runtime diagnostics; twelve headless assertions; plan/parity updates; and this handoff. Updated the Godot assembly marker to `0.1.0-phase5`.

Authoritative owners touched: `GameStateMachine` is the sole mutable primary-state owner. `GameTransitionCoordinator` is the sole cross-mode transaction owner. `PauseManager` owns reference-held pause intent. `SimulationScheduler` remains the clock/order authority. `RuntimeInputHost`, `GodotCameraWorldAdapter`, and the future `IPlayerControlTransitionBridge` remain narrow engine/entity adapters; none may request nested state changes.

Public APIs, signals, events, input actions, collision layers: Added state snapshots, transition descriptors/status/errors, coordinator subscription and live transition APIs, `GodotSessionRuntimeHost`, `GodotTransitionRuntime`, and `IPlayerControlTransitionBridge`. Structured session transition events now publish stable transition ID, phase, source, destination, and failure code. No input action, signal, collision layer, save schema, or content record changed.

Session ownership tree:

```text
SessionRoot
└── RuntimeServices
    ├── RuntimeInputHost
    └── SessionRuntime (GodotSessionRuntimeHost)
        ├── GameStateMachine
        ├── GameTransitionCoordinator
        ├── PauseManager
        ├── SimulationScheduler
        └── GodotTransitionRuntime
```

Transition order and compensation: Every non-idempotent request enters `TRANSITION`, then runs suspend input, clear held actions, capture source, entity handoff, camera placement, simulation configuration, presentation configuration, destination validation, and commit. Capture stores entity-adapter state, exact camera transform/preset, and clock policy. Failure runs registered compensation in reverse, restores the captured source, selects a safe stable recovery state, and finally releases the matching opaque input token. Reentrant requests cannot replace the active transaction.

Stable IDs/schema/content changes: Transition IDs are session-local `transition-<serial>` diagnostics IDs and are not persistence IDs. Existing uppercase state, clock, phase, rejection, and input-suspension tokens remain unchanged. No schema/content change occurred.

Behavior implemented: The live session enters authoritative `MANAGEMENT` with `CITY` clock policy after boot. Management/Builder transitions change safe camera presets and scheduler policy transactionally. Nested pause holds retain the exact source and resume only after the final release. The scheduler advances from the Godot process loop while preserving its existing 120 Hz fixed-step model and clock gates. Street entry fails closed with `CONTROL_RUNTIME_UNAVAILABLE` until the entity bridge is installed; that failure restores camera, clock, source state, and input.

Known deviations and ADR links: Godot physics callbacks remain the engine authority for future physical movement; the pure scheduler currently owns clock/order accounting and policy but has no Phase 5 entity tasks registered yet. Presentation configuration is intentionally a no-op until product UI/audio owners arrive. No ADR is required for this boundary.

Tests added and exact commands: Fourteen xUnit cases cover successful order, every one of eight runtime-phase failures, reverse compensation, cleanup, commit ownership failure, safe recovery, reentrancy, exact pause/resume, idempotency, listener isolation, and malformed initial state. Twelve live assertions cover ownership location, initial policy, scheduler advancement, Management/Builder/pause/resume, unavailable Street failure, camera/clock/source restoration, input cleanup, and phase order. Commands: `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore`; `dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`.

Test results and artifact paths: Domain tests pass 246/246. Native build completes with zero warnings/errors. All New Game, confirmed import/Continue, and imported-recovery/New Game headless scenarios publish `phase5.session_runtime.passed` with 12/12 assertions; invalid/unconfirmed import scenarios still fail with their expected codes. Logs remain under `godot/artifacts/test-results/`.

Performance/resource counts before and after: The slice adds one session-owned Godot `Node`, no physics body, render object, mesh, material, shape, viewport, signal, or per-entity allocation. Session shutdown unregisters its one transition subscription and stops its process callback. Full ownership-growth measurement remains the Phase 5 exit soak.

Manual checks performed: Headless Godot exercised the live transaction against the authored camera/world and real runtime input owner at 120 physics ticks per second. The expected unavailable-Street fault was inspected in structured logs and returned to `MANAGEMENT`/`CITY` with one source restore and no suspended input.

Open defects with severity and reproduction: None blocking this slice. Street transitions intentionally reject until the Phase 5 entity owner is registered; this is a fail-closed dependency, not a completed player-control path.

Compatibility adapters and removal conditions: `IPlayerControlTransitionBridge` is the sole temporary seam for the upcoming pedestrian/vehicle owner and remains as the stable entity boundary afterward. The save diagnostics retain deferred imported runtime state until a later restore adapter consumes it. Remove neither boundary from presentation or actor code.

Next safe task: Implement the gameplay camera rig and connect it to transition camera ownership while continuing to use `GodotCameraWorldAdapter` for world clearance and macro presets.

Unsafe/blocked tasks and required decision: Do not add actor-local state transitions, pause flags, input sampling, camera ownership, or clocks. Do not make Street entry succeed before it produces exactly one validated controlled entity. No external decision blocks the camera slice.
