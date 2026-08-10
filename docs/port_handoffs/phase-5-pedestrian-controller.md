# Phase 5 Pedestrian Controller Handoff

Chunk ID and status: `phase-5-pedestrian-controller`; complete as the third Phase 5 slice, covering work item 5.3.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `09bc279` and targets Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Deliver a live on-foot player body and the first real transactional entity-control owner. This slice covers locomotion, collision, chase publication, animation state, safe spawn/recovery, Management/on-foot handoff, and body reuse. Vehicle entry, hijacking, attacks, NPC pedestrians, health, knockdown, interaction prompts, and mission checkpoints retain their later Phase 5/6/8 owners.

Files and owners: Added pure `PedestrianLocomotionModel`; added Godot `PlayerPedestrianController` and `PlayerControlRuntime`; wired player control into `SessionShell`, readiness, transitions, diagnostics, and parity documentation. `PlayerControlRuntime` is the sole mutable player-entity authority. `PlayerPedestrianController` owns one engine body but does not own input sampling, camera transforms, transitions, or session state. `RuntimeInputHost`, `GameplayCameraRig`, and `GameTransitionCoordinator` remain their existing authorities.

Entity scene contract:

```text
SessionRoot/WorldRoot/AgentRoot
└── PlayerPedestrian : CharacterBody3D (created lazily, then reused)
    ├── Collision : CollisionShape3D / CapsuleShape3D
    ├── VisualRoot : Node3D
    │   └── Body : MeshInstance3D / CapsuleMesh
    └── AnimationPlayer : idle, walk, sprint, jump, fall
```

Control and camera flow:

```text
Management (0 controlled bodies)
  -> HANDOFF_ENTITY: enable/reuse PlayerPedestrian
  -> POSITION_CAMERA: chase immutable pedestrian snapshot
  -> VALIDATE_DESTINATION: exactly one pedestrian
StreetOnFoot
  -> HANDOFF_ENTITY: suspend body, clear velocity
  -> POSITION_CAMERA: release chase/apply Management preset
  -> VALIDATE_DESTINATION: zero controlled bodies
Management (same retained node, hidden/collision-disabled)
```

Input actions and cadence: The controller consumes only the canonical `PEDESTRIAN` snapshot after `RuntimeInputHost` at physics priority -900: `MOVE` slots (W/S/A/D and arrow equivalents) or left stick, `SPRINT`, and edge-triggered `JUMP`. Direction is resolved from the session camera origin. Pure tuning is 4.5 m/s walk, 7.5 m/s sprint, 30 m/s² ground acceleration, 8 m/s² air acceleration, 24 m/s² ground friction, 6.5 m/s jump, 19.6 m/s² gravity, and 45 m/s terminal fall. Velocity is assigned directly in metres/second; only test motion for step clearance uses `velocity * delta`, and `MoveAndSlide()` performs body integration.

Collision and traversal: The capsule publishes both Player and Pedestrian layers and consumes `CollisionMasks.Pedestrian` (surface, static obstacle, traffic, player, interaction, and mission trigger). Grounded motion uses 46-degree maximum slope, 0.45-metre floor snap/step assist, eight slides, a 0.02 safe margin, and tangential `MoveAndSlide()` collision. The body is under `AgentRoot`, never under the camera or a global singleton.

Spawn/teleport/recovery checklist: Resolve terrain height; add capsule-centre clearance; set position and heading; clear velocity; record the supported pose; reset interpolation; enable collision only after ownership commits. Each physics tick updates the supported pose only while grounded, in bounds, and outside water. Non-finite, below -3 metres, outside-world, or water poses restore the last supported position, clear velocity, reset animation/interpolation, and increment one recovery counter.

Animations and presentation: One session-owned `AnimationPlayer` has idle, walk, sprint, jump, and fall clips. Locomotion state is classified in the pure model; visuals rotate toward planar velocity and apply only cosmetic bob/tilt. Collision and authority do not depend on animation playback.

Transaction/cleanup behavior: `PlayerControlRuntime` snapshots body existence, transform, velocity, heading, supported pose, animation, and control kind. Reverse compensation removes a body created by a failed first entry or restores the exact retained source body. Successful Management transitions suspend rather than recreate the body, preventing scene-tree growth. Shutdown synchronously frees the retained body and clears all long-lived references.

Tests and results: Added two pure locomotion cases covering bounded acceleration/speeds, jump/gravity, animation classification, water, bounds, and invalid data. Domain tests pass 248/248. Eleven headless checks cover lazy ownership, transactional entry/exit, `CharacterBody3D` placement, input ordering, collision/slope/step/slide policy, chase identity, live physics ticks, five animations, water recovery, zero velocity, exactly-once recovery, and same-instance reuse. All three valid boot/import/recovery scenarios pass and publish `phase5.pedestrian_controller.passed` with one retained AgentRoot body; expected invalid import/fault-injection scenarios remain fail-closed.

Exact verification commands: `dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore`; `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`; and the repository `godot/scripts/verify.sh` wrapper.

Known gaps and next safe task: Step assist is deliberately conservative and awaits subjective curb/bridge traversal tuning alongside vehicles. Procedural placeholder visuals/animations must later bind to authored character assets without changing physics ownership. Next, build both representative sedan branches, collect objective telemetry, record the selection ADR, and retain `PlayerControlRuntime` as the common handoff authority.
