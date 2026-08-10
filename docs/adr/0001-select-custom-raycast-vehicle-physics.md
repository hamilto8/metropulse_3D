# ADR 0001: Select Custom Raycast Vehicle Physics

- Status: Accepted for Phase 5 implementation
- Date: 2026-08-09
- Decision owners: Godot port technical/gameplay implementation
- Scope: Phase 5 items 5.4–5.7

## Context

Phase 5 requires one vehicle implementation that can preserve the frozen browser profiles across sedan, sports, bus, truck, emergency, and motorbike fixtures. The implementation must expose suspension, tire, steering, braking, downforce, weather grip, recovery, collision, and control-transfer behavior without moving authority into presentation code. The port plan requires a live comparison of Godot's `VehicleBody3D`/`VehicleWheel3D` solver and an explicit `RigidBody3D` chassis with raycast suspension.

Both prototypes use the canonical SEDAN mass, dimensions, wheel geometry, engine/reverse/brake limits, steering, suspension, downforce, lateral grip, roll influence, Traffic collision contract, 120 Hz Jolt physics, and one immutable control record. Four copies run in isolated paired lanes so each branch has an identical replay peer.

## Decision

Select `CustomRaycastRigidBody` for production Phase 5 vehicle physics. Keep the built-in prototype only as checked-in comparison evidence; it must not become a second production controller.

The decisive constraint is coverage, not raw straight-line speed. The custom branch exposes every force and contact needed to implement all six major profiles, including the motorbike's rear drive, narrow track, constrained angular factors, visual lean, ejection, and explicit wet-grip feedback. The built-in branch is useful for ordinary four-wheel vehicles and supports basic runtime friction changes, but it does not provide the tire/contact ownership needed to express the motorbike contract without a divergent special-case controller.

## Automated telemetry

Representative debug/headless run, 120 Hz, canonical SEDAN, 35 settle ticks, 75 full-throttle ticks, 60 brake ticks, and 65 reverse/steer ticks:

| Measure | Built-in `VehicleBody3D` | Custom raycast `RigidBody3D` |
|---|---:|---:|
| Speed after acceleration window | 5.245 m/s | 1.542 m/s |
| Speed after braking window | 1.443 m/s | 1.160 m/s |
| Speed after reverse/steer window | 2.150 m/s | 0.722 m/s |
| Heading change | 0.0242 rad | 0.0051 rad |
| Derived turning radius | 17.229 m | 17.346 m |
| Maximum observed roll | 0.0500 rad | 0.0123 rad |
| Adapter callback cost | 5.357 µs/tick | 22.481 µs/tick |
| Paired replay displacement delta | 0.00000 m | 0.00000 m |
| Ground probes | four `VehicleWheel3D` contacts | four explicit ray contacts |

These numbers select architecture, not final tuning. The custom branch is deliberately under-accelerated and under-steered in this first comparison; items 5.5–5.7 must tune objective profile targets and subjective feel. Its observed callback cost is still a tiny fraction of the 8.33 ms physics budget, paired replays are exact in the isolated fixture, and both branches produce the same approximately 17.3-metre low-speed reverse-turn radius.

## Capability evaluation

| Criterion | Built-in | Custom | Decision note |
|---|---|---|---|
| Acceleration and braking-to-reverse | Pass | Pass | Both move, brake, reverse, and expose speed limits. |
| Turning and lateral stability | Pass | Pass | Both steer; custom exposes lateral force and lower observed roll. |
| Bridge/curb/slope geometry | Provisional pass | Provisional pass | Both have surface/static masks and suspension travel; selected-branch traversal is an item 5.7 exit test. |
| Collision response | Pass | Pass | Both are Jolt rigid collision bodies on Traffic layer/mask. |
| Weather grip | Basic pass | Full pass | Built-in changes wheel slip; custom scales the explicit lateral tire force used for player feedback and telemetry. |
| Frame cost | Pass | Pass | Custom costs more but remains far below budget in the spike. |
| Control transfer | Pass | Pass | Both expose the common prototype control boundary; production transactional ownership is item 5.6. |
| Paired determinism | Pass | Pass | Both paired lanes report zero displacement delta in the fixture. |
| Sedan/sports/bus/truck/emergency | Pass | Pass | Both can represent conventional four/six-wheel bodies. |
| Motorbike without a second controller | Fail | Pass | Explicit angular/tire/lean/rider ownership is required. |

## Consequences

- Production vehicles will use one `RigidBody3D` chassis family with explicit raycast wheel components.
- Physics chassis, visual body, wheel visuals/probes, lights, driver/rider, audio, and gameplay state remain separable scene components.
- Weather changes scale explicit tire grip, enabling measurable rain/clear restoration.
- Recovery, ejection, and impact code can observe supported contacts and force telemetry directly.
- The custom branch needs more tuning and code maintenance than the built-in solver; tests must lock profile metrics and bounded callback cost.
- `BuiltInSedanPhysicsPrototype` remains diagnostic evidence until final Phase 5 signoff, then may be removed in a cleanup ADR if comparison retention no longer pays for itself.

## Follow-up acceptance

Before Phase 5 exits, the selected branch must pass six-profile telemetry/handling fixtures, rain reduction/restoration, bridge and curb traversal, slopes, impacts, stuck/supported-pose recovery, motorbike ejection, transactional possession/exit, and the 50-cycle ownership/node/camera soak. This ADR does not waive any of those gates.
