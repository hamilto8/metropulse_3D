# Phase 5 Vehicle Physics Spike Handoff

Chunk ID and status: `phase-5-vehicle-physics-spike`; complete as the fourth Phase 5 slice, covering work item 5.4.

Source/Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `f646a32`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Outcome: Both required live sedan branches exist and run from the same canonical profile/control record. The pure `VehiclePhysicsSpikeModel` validates finite unique telemetry, applies mandatory capability blockers, and selects one branch deterministically. [ADR 0001](../adr/0001-select-custom-raycast-vehicle-physics.md) selects the custom raycast `RigidBody3D` for production.

Files/owners: Added `BuiltInSedanPhysicsPrototype`, `CustomSedanPhysicsPrototype`, common prototype contracts, pure telemetry/decision records, unit tests, seven live integration checks, the ADR, plan/parity changes, and this handoff. Prototypes are integration-owned comparison bodies and are synchronously freed after each run; they do not join session control authority. `PlayerControlRuntime` remains the future production possession owner.

Shared chassis contract: Traffic layer/mask; canonical SEDAN mass/dimensions/layout/drive/dynamics; box chassis collider and separate visual body; four wheels/probes; one clamped throttle/brake/steering/grip record; speed, heading, grounded-wheel, callback-cost telemetry. Built-in uses four `VehicleWheel3D` nodes and runtime wheel slip. Custom applies per-ray spring/damper, driven-axle force, steered front-wheel force, lateral tire force, braking, downforce, speed bounds, and low centre of mass.

Evaluation protocol/results: Four bodies settle in isolated west-ground lanes; identical branch peers receive 75 acceleration, 60 braking, and 65 reverse/steer ticks. Both accelerate, brake, reverse, steer, stay grounded, respond through Jolt collision, and reproduce paired displacement with zero observed delta. Built-in/custom measured acceleration speeds are 5.245/1.542 m/s; braking speeds 1.443/1.160 m/s; reverse speeds 2.150/0.722 m/s; heading changes 0.0242/0.0051 rad; derived turning radii 17.229/17.346 m; roll maxima 0.0500/0.0123 rad; representative callback costs 5.357/22.481 µs. Exact values are diagnostic baselines, not signed final tuning targets.

Capability conclusions: Both branches provisionally support ordinary bridge/curb/slope geometry through suspension travel and canonical surface/static collision. Both support basic weather friction. Only the custom branch can keep explicit tire, angular, lean, rider/ejection, and recovery ownership under one controller for all six major profiles. Full selected-branch traversal, rain, impact, and subjective signoff remain mandatory in items 5.5–5.7.

Verification: Domain tests pass 250/250. The valid New Game, confirmed Continue import, and recovery-seed scenarios all publish `phase5.vehicle_physics_spike.passed`; expected invalid imports and transition fault injection remain fail-closed. Commands are the standard solution build, format check, domain tests, `godot/scripts/test-integration.sh`, and `godot/scripts/verify.sh`.

Next safe task: Convert the selected custom prototype into one production profile-driven vehicle scene/component family, instantiate sedan, sports, bus, truck, emergency, and motorbike fixtures, then tune and lock per-profile telemetry before wiring possession.
