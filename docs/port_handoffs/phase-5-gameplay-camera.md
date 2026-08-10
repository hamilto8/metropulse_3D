# Phase 5 Gameplay Camera Handoff

Chunk ID and status: `phase-5-gameplay-camera`; complete as the second Phase 5 slice, covering work item 5.2.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `345843a` and targets Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Add the one live gameplay camera owner for Management orbit/pan, street look, pedestrian/vehicle chase, safe transitions, release, and accessibility-scaled shake. This slice does not create player entities, physics, possession, interactions, camera UI buttons, touch gestures, or subjective vehicle-camera playtest signoff.

Documents and source files read: Phase 5 and verification sections of the port plan; Phase 4 camera and Phase 5 session-runtime handoffs; browser `SceneManager`, `CameraRig`, `StreetLevelCameraController`, ground constraint and clearance sources; Godot camera-world adapter; pure C# preset, chase, street, ground, clearance, settings, input, transition, and scheduler owners.

Files/scenes/resources added or changed: Added `GameplayCameraContracts` and `GameplayCameraRig`; extended the world-camera adapter with target/surface/resolve APIs; added the camera-stage scheduler registration, transition snapshot/restore, destination camera bridge, input-context synchronization, session lifecycle/readiness wiring, seventeen live assertions, plan/parity updates, and this handoff.

Authoritative owners touched: `GameplayCameraRig` is the sole mutable session camera owner. Pure `ChaseCameraModel`, `StreetCameraModel`, `CameraGroundConstraintModel`, and `CameraClearanceQuery` remain geometry authorities. `GodotCameraWorldAdapter` remains the world-query/preset adapter. `GodotTransitionRuntime` selects destination ownership and restores snapshots; actors publish immutable target snapshots through `IGameplayCameraTarget` and cannot move the camera directly.

Public APIs, signals, events, input actions, collision layers: Added five stable internal modes (`OrbitMacro`, `PresetTransition`, `StreetLook`, `SwoopToStreet`, `ChaseMicro`); camera/follow snapshot records; target snapshot/interface; immediate/animated preset, follow/release, look, pan, shake, advance, capture/restore, and shutdown APIs. Extended `IPlayerControlTransitionBridge` with its controlled camera target. No signal, input action, collision layer, save schema, or content record changed.

Camera state flow:

```text
OrbitMacro ── preset ground/street ──> PresetTransition ──> StreetLook
     │
     └── controlled entity ──> SwoopToStreet ──> ChaseMicro
                                      │                │
                                      └── release <────┘ ──> OrbitMacro at local pose
```

Behavior implemented: Macro input uses the canonical Management PAN slots, mouse pointer delta, right stick, sensitivity, normal/fast speed, a 5–350 metre orbit radius, and bounded pitch. Street mode keeps a 0.75-metre local pivot with bounded yaw/pitch. Entity chase reads stable ID, type, position, planar heading, speed, and physics/control flags; pedestrian and vehicle framing use the frozen pure model, with quintic swoop, smoothed chase, trajectory look-ahead, and speed FOV. Invalid presets/targets fail atomically. Losing clearance retains the last safe pose. Pause/result policies keep camera presentation advancing but gate gameplay camera input.

Clearance and shake: Preset, orbit, pan, swoop, and chase origins consume the Phase 4 terrain/water/static-obstacle query. Persistent poses enforce terrain ground clearance. Shake uses deterministic cosmetic samples, applies only after the persistent pose, clamps its visible Y offset above the surface, removes the previous offset before every update/snapshot, honors `motion.cameraShake`, and never random-walks the base transform.

Known deviations and ADR links: The browser uses OrbitControls damping; the native rig uses direct bounded orbit/pan because Godot has no equivalent built-in ownership object. Mouse wheel zoom and touch gestures are not present in the canonical C# input contract and remain later UX work. Dynamic actor obstacles will join the shared clearance query with the entity slices. No ADR is required.

Tests added and exact commands: Seventeen headless assertions cover lifecycle ownership, boot preset, orbit, pan, clear origins, bounded preset interpolation, street pivot/yaw/pitch, target swoop, chase ownership, independent look offsets, target following, speed FOV, removable terrain-safe shake, local release, idempotency, full snapshot restoration, atomic feature-gated preset rejection, and malformed target rejection. Existing pure camera tests continue to cover all numeric models. Commands: `dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore`; and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`.

Test results and artifact paths: Native build completes with zero warnings/errors. Domain tests remain 246/246. All valid headless boot/import/recovery scenarios publish `phase5.gameplay_camera.passed` with 17/17 assertions; rejected import scenarios retain their expected failure codes. Logs remain under `godot/artifacts/test-results/`.

Performance/resource counts before and after: Adds one session-owned Node and one scheduler callback; no camera, viewport, render resource, body, shape, mesh, material, signal, or timer is duplicated. Shutdown unregisters the camera task and clears target/input/settings references. Chase currently creates small immutable request/snapshot records per camera frame; Phase 11 profiling may replace those allocations without changing the contract.

Manual checks performed: Headless Godot exercised every rig mode against the live authored world and real camera node. The fixture sedan moved during chase, widened FOV above 60 degrees, accepted independent yaw/pitch, retained clear origins, removed shake before capture, restored its exact Management snapshot, and disposed without engine leak warnings.

Open defects with severity and reproduction: None blocking this slice. Mouse-wheel zoom, touch gestures, product camera controls, and subjective chase feel remain unimplemented by explicit later ownership.

Compatibility adapters and removal conditions: `IGameplayCameraTarget` is the stable actor-to-camera boundary and should remain. `GodotCameraWorldAdapter` retains its Phase 4 production preset allow-list until feature owners explicitly enable optional cameras. Browser camera comparison remains until final parity/playtest signoff.

Next safe task: Add the `CharacterBody3D` pedestrian entity/controller, implement spawn/recovery and animation state, then register it as the first `IPlayerControlTransitionBridge` and `IGameplayCameraTarget` owner.

Unsafe/blocked tasks and required decision: Do not let pedestrian or vehicle scripts set the session camera transform, sample separate input, or implement local camera shake. Do not add dynamic obstacles outside the shared camera query. No external decision blocks the pedestrian slice.
