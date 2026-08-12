# Phase 8 mission execution and template handoff

Chunk ID and status: `phase-8-execution-templates`; complete as the first of
five planned Phase 8 slices, covering the renderer-free portion of items 8.1,
8.2, 8.5, 8.6, and 8.9. Phase 8 remains in progress.

Source revision / Godot revision: frozen browser reference
`44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot Phase 7 revision
`ad93297`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Objective and non-goals: introduce one deterministic mission execution owner
over the existing `MissionLifecycleController`. This slice covers scoped pickup
markers and eligibility, accepted-vehicle binding, route/timer/checkpoint facts,
and all six activity-template behaviors. It does not create Godot scene nodes,
consume live input, present dialogue/results, apply cleanup transactions, or
bind save documents; those belong to later Phase 8 slices.

Authority and lifecycle: `MissionExecutionModel` owns renderer-free world
execution facts only. It evaluates offers through the existing lifecycle and
feature scope, binds one stable controlled-vehicle ID/type at acceptance, and
uses the lifecycle for every phase transition and checkpoint. It never applies
Capital or consequences. Completion and failure stop at lifecycle
`COMPLETION`/`FAILURE`, leaving the existing outcome authority to perform the
receipt-gated cleanup transition.

Marker contract: normal MVP scope publishes nine stable
`mission-pickup:<mission-id>` records. Temporary Mayhem publishes the tenth
Survival marker only when explicitly enabled. Five non-MVP records and disabled
Mayhem publish no marker. Lifecycle, route, traffic, controlled-vehicle type,
and 16-metre proximity checks provide exact ineligibility reasons; occupied
mission phases publish no offers.

Template contract:

- Taxi applies accepted choice timing/reward, samples bounded congestion,
  computes deterministic satisfaction, and adjusts payout at arrival.
- Courier and Delivery use one authored destination beat and fail on timeout or
  loss of the exact accepted vehicle.
- Race owns ordered authored checkpoints, updates one navigation target, records
  retry payloads, and fails when the deterministic leading rival finishes.
- Sabotage records target arrival, requires an explicit stopped-vehicle action,
  and resets an interrupted hold before it can complete.
- Survival has no route or false destination marker and treats timer expiry as
  success only in the authorized temporary-Mayhem scope.

State and recovery: `MissionExecutionState` version 1 contains only stable IDs
and plain route/timing/payout/checkpoint facts. Restore validates the lifecycle
mission, authored objective, required vehicle type, exact canonical route, and
all numeric bounds before accepting state. The model refuses to discard active
execution before result recovery.

Tests and verification:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore --filter FullyQualifiedName~MissionExecutionModelTests
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
```

The focused suite passes 11/11. The complete domain suite passes 323/323, the
Godot solution builds with zero warnings/errors, and format verification reports
no changes. Runtime node/body/timer/input/collision counts remain unchanged
because this slice adds no engine objects.

Next safe task: add the pure dialogue/history and receipt-backed result
projections, then register mission candidates with the already shared
`InteractionService`. Do not add a mission-specific input path or a second
outcome/history authority.
