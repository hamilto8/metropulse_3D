# Phase 5 Exit Audit Handoff

Chunk ID and status: `phase-5-exit-audit`; complete as the sixth and final Phase 5 slice, covering work items 5.7–5.8 and all five Phase 5 exit gates.

Source/Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `0e8bdce`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Outcome: The Management → on-foot → vehicle → on-foot → Management slice is complete. It has one transactional control/camera/input authority; orbit, street, pedestrian, and vehicle camera modes; a reusable pedestrian; six profile-driven production vehicle fixtures; selected custom raycast physics; possession and timed hijack; collision, knockdown, ejection, weather, recovery, and reset contracts; deterministic interaction publication; and a 50-cycle no-growth audit.

Final-slice owners: `VehicleImpactRecoveryModel` owns finite impact/debounce/ejection/recovery decisions. `PlayerVehicleController` owns contact monitoring, supported pose, Jolt response, stuck tracking, reset, and rider impact publication. `PlayerPedestrianController` adapts the existing pure knockdown state to its visual/body pose. `PlayerControlRuntime` prepares ejection and restores pedestrian authority. `SessionShell` defers physics-callback ejection through the transition coordinator and owns weather subscription lifetime. `PlayerVehicleInteractionPublisher` is the sole vehicle provider for `InteractionService`. `WorldEnvironmentController` publishes immutable weather state to subscribers.

Full control/camera state diagram:

```text
Management (no body, macro camera, Management input)
  └─ coordinated handoff ─> StreetOnFoot (one pedestrian, pedestrian chase/input)
       ├─ Enter candidate ─> prepared vehicle ─> StreetVehicle (vehicle chase/input)
       ├─ Hijack candidate ─> 1.25 s eligible approach ─> StreetVehicle
       └─ no actor-owned input path
StreetVehicle
  ├─ safe Exit candidate ─> same pedestrian at accepted lateral pose + vehicle AI
  ├─ motorbike ejection ─> deferred prepared recovery pose + knocked-down pedestrian + vehicle AI
  ├─ Pause ─> frozen body/camera retained ─> exact StreetVehicle resume
  └─ Management ─> all entity/camera/input gameplay authority released
```

Input actions: `RuntimeInputHost` remains the only sampler. Camera uses the canonical camera actions and contextual sensitivity. Pedestrian uses `MOVE`, `SPRINT`, and `JUMP`. Vehicle uses `DRIVE`, `THROTTLE`, `BRAKE`, and `HANDBRAKE`; `VEHICLE_RESET` directly invokes `RecoverIfUnsafe(forced: true)`. The interaction publisher alone consumes the canonical `INTERACT` edge and advances active hijack timing. Actors contain no raw keyboard or `E` handling.

Entity scene contracts:

```text
SessionRoot/WorldRoot/AgentRoot
├── PlayerPedestrian (CharacterBody3D; reused, suspended while driving)
└── Vehicle_<stable-id> (PlayerVehicleController : RigidBody3D)
    ├── ChassisCollision
    ├── VisualBody
    ├── Wheel1..Wheel6 (ray + visual)
    ├── Lights
    ├── Occupant (driver/rider; ejection visibility)
    ├── Audio (engine + impact emitter)
    └── GameplayState (authorized/occupied/player/AI/generation)
```

Collision masks: Pedestrian bodies publish Player + Pedestrian and consume the canonical pedestrian mask. Vehicle chassis publish Traffic and consume `CollisionMasks.Traffic`; contact reporting is enabled with eight bounded contacts. Suspension probes consume Surface + StaticObstacle. Exit and recovery query the shared `WorldSurfaceModel`, including bridge-over-water precedence. Static world ownership remains Phase 4; traffic/NPC publishers remain Phase 6.

Impact and recovery behavior: Impacts below 1.5 m/s do not publish, repeated contacts inside 0.2 seconds debounce, and response impulse is clamped to 4.5 velocity-equivalent units for forgiving contact. Pedestrian knockdown begins at 4 m/s. Motorbike ejection begins at 8 m/s and cannot transfer authority inside the physics callback; it prepares a last-supported lateral pose and defers the standard transition. Supported transforms update only while grounded, in bounds, out of water, and within 0.85 rad pitch/roll. Water, bounds, a 2 m surface drop, roll, 2.5 seconds of commanded grounded stuck state, or explicit reset recover with zero motion and interpolation reset.

Weather and traversal evidence: `WorldEnvironmentController.SetState` propagates the canonical current weather record to every session vehicle. Live rain changes grip from 1.00 to 0.48 and clear restores 1.00 without respawn. A production sedan settles on the primary deck, travels along its supported lane, stays within the barriers, and remains classified as bridge rather than river. Water recovery and explicit reset each return to the last supported bridge transform.

Interaction contract: Candidate IDs are `vehicle-enter:<stable-id>`, `vehicle-hijack:<stable-id>`, and `vehicle-exit:<stable-id>`. Each supplies kind, shared priority, prompt, accessibility label, deterministic distance, eligibility/failure code, stable/type metadata, and a consequence explanation. `InteractionService` retains eligibility-first, priority, distance, stable-ID ordering and its reentrancy/failure isolation. Enter and Exit resolve through preparation plus the transition coordinator; Hijack retains pedestrian authority until its bounded approach completes.

Spawn/teleport checklist: Validate canonical type and unique stable ID; parent beneath session `AgentRoot`; initialize chassis/components and subscribe impact before spawn; resolve shared terrain height and settled ride height; zero velocities, reset yaw/interpolation/stuck state, and seed the supported transform; wait for wheel support before possession; preserve transform/velocity/grip/impact/recovery/ejection/AI/generation state in transaction snapshots; never free a controlled, pending, or hijack target; unsubscribe impact/weather/interaction ownership before session disposal.

Vehicle ADR and telemetry: [ADR 0001](../adr/0001-select-custom-raycast-vehicle-physics.md) remains authoritative. [Vehicle telemetry](../port_evidence/phase5/vehicle-telemetry.json) records the six canonical profile inputs, live 60-tick speeds, clear/rain multipliers, traversal/recovery checks, and the Phase 5 placeholder handling rubric. SEDAN/SPORTS/BUS/TRUCK/POLICE/MOTORBIKE measured 2.491/4.882/2.263/2.191/2.491/1.547 m/s. Earlier two-branch spike telemetry remains in `phase-5-vehicle-physics-spike.md`.

Soak report: The clean scenario runs 50 complete Management → foot → sedan → foot → Management cycles. One pedestrian instance is reused, two test vehicle bodies stay fixed until teardown, authority generation increases exactly 100, and recursive session nodes, AgentRoot children, weather subscribers, interaction providers, controlled count, and final camera target match baseline. Import/recovery scenarios run one representative cycle each. All fixtures are synchronously unregistered and freed afterward.

Fault compensation: Pure tests inject failure at every canonical transition phase and verify reverse compensation/cleanup. Live handoff fault injection removes the control bridge, observes `CONTROL_RUNTIME_UNAVAILABLE`, restores the exact source state/camera/clock, and releases input suspension. Vehicle/pedestrian snapshots now include supported pose, weather grip, impacts, recovery, ejection, knockdown, pending ejection, AI, and authority fields needed for rollback.

Verification: Browser reference remains 391/391. Domain tests pass 255/255. Successful clean/import/recovery headless scenarios publish 134/134/138 total assertions and Phase 5 groups of 12 session-runtime, 17 camera, 11 pedestrian, 7 branch-spike, 19 profile/possession, and 15 exit assertions. The clean log publishes `soakCycles: 50`; import/recovery publish one representative cycle. `godot/scripts/verify.sh` validates content, Phase 2–5 audits, build/format, domain tests, headless import, and all integration scenarios.

Known tuning gaps: Procedural boxes/capsules, silent audio emitters, placeholder animation, gamepad/hardware feel, authored collision shapes, tire-slip feedback, and profile balance need later presentation/release passes. POLICE is the Phase 5 emergency representative; sirens/pursuit begin in Phase 6. Damage/Heat/reputation/blockage consequences, ambient traffic/pedestrians, combat, missions, HUD prompts, and save capture remain with their named later phases. These boundaries do not leave a Phase 5 ownership or physics gate open.

Next safe task: Begin Phase 6 by spawning seeded ambient traffic and pedestrians around this control slice. AI takeover must use `VehicleGameplayStateComponent`, respect the stable vehicle registry and interaction priority service, preserve player authority across pursuit/Heat target switches, and keep the 48/60 population floors outside Phase 5 test-fixture ownership.
