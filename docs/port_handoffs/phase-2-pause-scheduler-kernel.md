# Phase 2 Pause and Scheduler Kernel Handoff

Chunk ID and status: `phase-2-pause-scheduler-kernel`; complete as the fifth Phase 2 slice. Phase 2.5 dependency items 1–4 are complete; Phase 2 overall remains in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation based on Godot revision `ab8aef1` targeting Godot 4.6 stable .NET.

Objective and non-goals: Port nested pause-hold ownership, transition-coordinator/runtime boundaries and canonical phase ordering, plus deterministic scheduler clock math and ordered task registration. This chunk does not implement the mutable game-state lifecycle/coordinator, a Godot transition runtime, SceneTree pause policy, engine process callbacks, economy behavior, persistence, UI, audio, or input bindings.

Authorities and evidence: Read `src/core/PauseManager.js`, `TransitionCoordinator.js`, `GameTransition.js`, `SimulationScheduler.js`, their JavaScript tests, `Tools/BaselineCapture/baseline-fixtures.mjs`, `game-state.json`, and `simulation-scheduler.json`. Scheduler clocks, stages, frames, task calls, policy snapshots, accumulators, and floating-point results are compared exactly to Phase 0. Pause and coordinator phase behavior were not included in a dedicated JSON fixture, so their existing deterministic source-test contracts are mirrored in xUnit without altering Phase 0 evidence.

Files and ownership: Added `Core/SimulationScheduler.cs` and `Core/PauseTransitionContracts.cs`; added `SimulationSchedulerTests` and `PauseTransitionContractTests`; embedded the unchanged scheduler fixture in the test assembly; and updated the plan, parity matrix, and this handoff. The domain assembly remains free of Godot references.

Public contracts: Added six named clock domains, seven ordered simulation stages, immutable clock/frame/scheduler snapshots, `SimulationScheduler`, task registration/removal, timestamp and explicit-delta advancement, city-scale policy, `PauseReason`, `PauseHold`, `PauseSnapshot`, pause events, `PauseManager`, `IGameTransitionCoordinator`, `ITransitionRuntime`, canonical `TransitionPhase` ordering, runtime context/result records, and transition request metadata.

Behavior: Render tracks unclamped real time; UI and gameplay use bounded deltas; physics and city clocks use retained fixed-step accumulators and bounded catch-up budgets; Street forces city time to 1x while City/Builder permit the requested multiplier; stopped policies keep input/presentation/camera/render live; input-stage policy changes gate the same frame. Task IDs are unique, failures are atomic, ordering is order-then-registration, predicates gate calls, and unregister is idempotent. Pause supports nested menu/dialogue/system holds, exact source-state resume, menu idempotence, stale-release safety, held-action clearing, listener isolation, and hold restoration after a failed final resume.

Tests and results: Added 14 xUnit cases, bringing the domain suite to 49. The scheduler fixture comparison covers four sequential frames, all eight clock policies, 38 task invocations, six clocks, seven stages, remainders, ticks, and exact numeric output. The unchanged baseline and ten-artifact extraction checks report zero drift; formatting passes; the complete `verify.sh` gate passes with a deterministic zero-warning build, 49/49 domain tests in 93 ms, Godot 4.6 headless import, and 18/18 foundation integration assertions. Artifacts remain under `godot/artifacts/test-results/`.

Performance/resources: No nodes, bodies, timers, engine callbacks, or subscriptions outside explicitly owned in-memory delegates were added. Snapshot and clock dictionaries are copied for immutable publication. Scheduler task execution is bounded by configured physics/city catch-up limits; registration sorting occurs only when tasks are added.

Known deviations and defects: No defects found. `IGameTransitionCoordinator` and `ITransitionRuntime` intentionally define the Phase 2 boundary without inventing a mutable authority before its transaction/rollback implementation is ported. The C# pause manager is therefore tested with a fake coordinator; Godot runtime integration remains explicitly unclaimed.

Next safe task: Continue Phase 2.5 item 5 by porting the pure economy system against `economy.json`, using the already canonical `EconomyBalanceDefinition`. Preserve atomic transaction/failure behavior and keep alert/UI adapters out until item 6.
