# Phase 10 aircraft slice

This slice completes the independently gated aircraft package from Phase 10 of
the Godot 4.6 C# port plan. The frozen browser reference remains
`44a286a74557adfe4fabd3a6e16b9006079eba32`; the target remains Godot 4.6
stable .NET `89cea1439`, Jolt, and the canonical 120 Hz runtime.

## Gate contract

Debug builds may enable the package with `--features=aircraft`. Release builds
reject feature overrides. With the flag off, the session creates no aircraft
runtime, actor, airfield nodes, flight HUD, aircraft InputMap actions, or new
save requirement. The save validator continues to accept the stable
`AIRCRAFT` control kind; an unavailable aircraft save falls back to safe
Management ownership instead of invalidating the city.

With the flag on, `AircraftRuntime` owns one `AircraftActor`, the Northwind
Municipal Airfield, three surface colliders, three obstacle colliders, input
edges, and teardown. Session shutdown unregisters all six colliders and frees
the actor and airfield roots.

## Runtime ownership

```text
SessionRoot/RuntimeServices/AircraftRuntime
└─ NorthwindMunicipalAirfield
   ├─ ground, runway, apron (Surface)
   ├─ hangar, tower, fuel depot (StaticObstacle)
   └─ runway centerline visuals

SessionRoot/WorldRoot/AgentRoot/NorthwindSparrow
├─ fuselage, wings, tail, cockpit, propeller
└─ PropellerAudio -> Vehicle bus
```

`AircraftFlightModel` remains the deterministic metre/second authority.
`AircraftActor` adapts its immutable state to a `Node3D` transform only during
the physics callback. `AircraftLandingSurfaceModel` samples the complete
rotated footprint against runway, authored roads, countryside, bridges, water,
and terrain grade. Airspace reflection, static-obstacle collision, hard/unsafe
landing, ditching, and the 2.2-second runway recovery are bounded by the
aircraft owner.

## Control, camera, UI, and audio

`PlayerControlRuntime` remains the sole controlled-entity authority. Boarding
prepares a pedestrian-to-aircraft handoff and commits through the existing
`STREET_VEHICLE` transition. Exit requires a landed aircraft at no more than
3 m/s and restores the same suspended pedestrian at a terrain-safe lateral
pose. Pause suspends the aircraft without changing authority.

The actor publishes `CameraTargetTypes.Aircraft`, activating the already-tested
wide/elevated chase pose, forward look-ahead, and aircraft FOV curve. The
feature-owned HUD reports speed, altitude, throttle, mode, and textual stall
status. Propeller sound uses one cached spatial loop on the Vehicle bus, driven
by `AircraftAudioModel`, and publishes `[propeller engine running]` through the
shared caption/live-region policy.

## Persistence and accounting

Transition rollback snapshots include the full flight state, control and pause
flags, crash recovery remainder, and telemetry counters. Runtime save restore
accepts `AIRCRAFT`, restores pose/heading/speed, and reacquires aircraft control
when the package is enabled. When it is disabled, the same validated save opens
in Management with no controlled entity. `PilotPopulation` is exactly one only
while aircraft authority is held and returns to zero on exit.

## Verification

- Pure C# suite: 393/393 passing.
- Solution build: zero warnings and zero errors.
- Format verification: no changes.
- Enabled headless scenario: publishes `phase10.aircraft.passed`; verifies one
  actor, six airfield colliders, handoff, aircraft input, flight HUD, airborne
  stepping, chase telemetry, enabled and unavailable save restore, snapshot
  round trip, and return to the same pedestrian.
- Default-off clean/import/recovery matrix: all expected success scenarios
  pass; invalid, future, and unconfirmed imports retain their expected errors.

Reproduction:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-phase10-feature.sh aircraft
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
```

The next safe Phase 10 slice is Temporary Mayhem. It must use a reversible
transaction boundary for destruction, roads, colliders, economy, mission
survival state, and save isolation; it may reuse Phase 9 presentation pools but
must not give those pools gameplay authority.
