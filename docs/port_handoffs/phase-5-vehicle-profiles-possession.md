# Phase 5 Vehicle Profiles and Possession Handoff

Chunk ID and status: `phase-5-vehicle-profiles-possession`; complete as the fifth Phase 5 slice, covering work items 5.5 and 5.6.

Source/Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `fddd019`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Outcome: The ADR-selected custom raycast `RigidBody3D` is now the production profile-driven vehicle family. The session owns stable vehicle identity and the only pedestrian/vehicle possession authority. Six live fixtures prove canonical profile construction, motion, entry, timed hijack, pause, safe exit, camera/input transfer, pedestrian restoration, and AI handoff.

Files and owners: `PlayerVehicleController` owns chassis physics and immutable camera-target publication. `VehicleComponents` separates the visual body, wheel ray/mesh, four lights, driver/rider, engine/impact emitters, and gameplay/AI state. `PlayerControlRuntime` owns the registry, entry/hijack preparation, controlled entity, suspended pedestrian snapshot, accepted exit pose, handoff generation, capture/restore, and cleanup. `VehiclePossessionModel` owns finite proximity, duration, speed, support, roll, and pose decisions without Godot dependencies. `SessionShell` supplies canonical content and lifecycle ownership.

Production scene contract:

```text
AgentRoot/Vehicle_<stable-id> (PlayerVehicleController : RigidBody3D)
├── ChassisCollision (CollisionShape3D)
├── VisualBody (VehicleVisualComponent)
├── Wheel1..Wheel6 (VehicleWheelComponent: RayCast3D + mesh)
├── Lights (VehicleLightsComponent)
├── Occupant (VehicleOccupantComponent: driver or rider)
├── Audio (VehicleAudioComponent: engine + impact)
└── GameplayState (VehicleGameplayStateComponent: authorization/AI/authority)
```

Control/camera state flow:

```text
Management --transaction--> StreetOnFoot[pedestrian + chase + Pedestrian input]
StreetOnFoot --prepared entry/hijack--> StreetVehicle[vehicle + chase + Vehicle input]
StreetVehicle --accepted safe exit--> StreetOnFoot[same pedestrian at exit pose; vehicle AI]
StreetOnFoot --transaction--> Management[no controlled body; macro camera]
```

Profile results: SEDAN, SPORTS, BUS, TRUCK, POLICE (the MVP emergency fixture), and MOTORBIKE construct from the canonical registry. Representative 60-tick acceleration speeds were 2.491, 4.882, 2.263, 2.191, 2.491, and 1.547 m/s respectively. These prove live profile differentiation and bounded response; final flat/turn/bridge/rain/collision/recovery tuning and subjective signoff remain item 5.7 and the exit gate.

Possession contract: Entry requires pedestrian ownership, registry membership, distance at most 3 m, and wheel support. Authorized/unoccupied entry prepares immediately. Unauthorized occupied entry retains pedestrian ownership until five clamped 0.25-second advances complete the 1.25-second approach; interruption cancels without transfer. Exit requires planar speed at most 1.5 m/s, support, absolute roll at most 0.7 rad, and a terrain-safe lateral pose. Transition validation performs the actual handoff only after preparation.

Exactly-once evidence: The live sedan path increments `PlayerControlRuntime.AuthorityGeneration` once on entry and once on exit; the sports hijack does the same. Same-state transition requests and pause/resume do not increment it. Each vehicle also retains its local authority generation and AI handoff count. Exit restores the same pedestrian instance and heading at the accepted pose, and the vehicle remains at its pose under AI authority.

Input and collision: The vehicle consumes only the frozen `Vehicle` context (`DRIVE`, `THROTTLE`, `BRAKE`, and `HANDBRAKE`) after `RuntimeInputHost` sampling. The camera consumes `IGameplayCameraTarget`; actors never mutate it. Vehicle bodies use Traffic layer/mask, while wheel probes query Surface and StaticObstacle. No raw `E` handling exists in the actor; item 5.8 will publish candidates through `InteractionService`.

Spawn/teleport checklist: resolve a canonical type and unique stable ID; add the body beneath session `AgentRoot`; initialize components before spawning; query the shared terrain height; apply settled ride height; zero linear/angular velocity; reset rotation and physics interpolation; wait for grounded probes before entry; reject water/out-of-bounds exit poses; preserve full transform and velocity in transition snapshots; never free a controlled, pending, or hijack target.

Verification: Solution build passes without warnings, 253/253 domain tests pass, and all headless boot/action scenarios publish `phase5.vehicle_profiles_possession.passed`. The clean run reports all six speeds, four exactly-once authority changes, and zero retained fixture vehicles. The standard `godot/scripts/verify.sh` remains the aggregate command.

Known gaps and next safe task: Add impact debouncing and response, pedestrian knockdown, motorbike rider ejection, rain-to-clear grip propagation, supported/stuck recovery, and explicit reset. Then connect possession/exit candidates through the existing deterministic interaction priority service and complete the 50-cycle exit soak and subjective profile signoff.
