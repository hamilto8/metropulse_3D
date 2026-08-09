# Phase 4 Generated MVP World Handoff

Chunk ID and status: `phase-4-generated-mvp-world`; complete as the second Phase 4 slice, covering work items 4.2 through 4.6 for authored MVP geometry.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `2df3150` and targets Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Construct the recognizable, collision-owned MVP world from shared immutable definitions, spatially instance repeated geometry, and prove live Godot ownership before camera/agent work. This slice does not add runtime editor placement, full East/countryside/airfield/rocket gameplay, traffic, pedestrians, vehicle physics, environment/weather presentation, product UI, screenshot signoff, or release hardware certification.

Documents and source files read: Phase 4 plan and Phase 1 collision contract; `MVP_SCOPE.md`; `CityBuilder.js`; `BuildingFactory.js`; `SuspensionBridge.js`; `CompactSuspensionBridge.js`; `BridgeSafety.js`; `StreetFurnitureLayout.js`; `CafeSeating.js`; the canonical suspension-bridge/street-furniture documents; Phase 0 world fixtures; and the Phase 3/session composition code.

Files/scenes/resources added or changed: Added the pure `MvpWorldLayout` and tests; Godot `MvpWorldGenerator`, `WorldResourceCache`, `WorldCollisionRegistry`, and `WorldDebugTraversalCapsule`; attached the generator to `SessionShell.tscn`; initialized/disposed it through the boot/session owner; added twelve live integration assertions and resource telemetry; advanced native informational version to Phase 4; and updated the plan/parity evidence.

Authoritative owners touched: `MvpWorldLayout` is the immutable authored geometry source. `MvpWorldGenerator` owns the live `AuthoredWorld` lifecycle. `WorldCollisionRegistry` owns the live static metadata snapshot. `WorldResourceCache` owns deduplicated Godot resources. `WorldSurfaceModel` remains the height/water/bounds authority. `UserWorld` remains separate and empty until the later builder adapter.

Public APIs, signals, events, input actions, collision layers: Added `MvpWorldLayout.CreateProduction`, `CableHeight`, `MvpWorldGenerator.Initialize/ShutdownWorld`, cache getters/counts, collision lookup/snapshot/camera-obstacle projection, surface/layout/resource/collider properties, and the disabled debug capsule's eight traversal waypoints. No signals, input actions, save schema, or collision layers changed. Surfaces use layer 1/mask contract; obstacles use layer 2/mask contract; the debug capsule uses the Phase 1 Player contract.

World scene tree:

```text
SessionRoot/WorldRoot/AuthoredWorld (MvpWorldGenerator)
├── WestCore
├── RiverCorridor
├── PrimaryBridge
├── CentralPark
├── BuildingPlots
├── StreetFurniture
├── InitialSkyline
└── DebugTraversalCapsule (debug builds only, processing disabled)
```

Stable IDs/schema/content changes: Every authored visual/collider definition has one unique stable ID. Browser bridge IDs, all 146 canonical lamp positions, 23 ordered business-type skyline IDs, park/river/road identities, and cafe furniture indices are preserved. No production schema/content document or save schema changed. The eight post-MVP chunk families are not created.

Behavior implemented: The session now constructs roads, plots, sidewalks, river basin/water/retaining walls, Central Park paths/fountain/trees, cafe chairs/tables, skyline, primary bridge deck/sidewalks/towers/anchors/cables/hangers/barriers, and retained safe corridor ground before interactive release. Visual and collision construction consume the same records. Windows, crosswalks, trees, lamps, cables, and hangers are spatially partitioned MultiMeshes. Shutdown removes all chunk nodes and clears cache/registry ownership.

Known deviations and ADR links: Low-poly forms and palette are retained, but the final eight browser fallback towers use deterministic port heights/colors instead of browser runtime randomness, window omission randomness is intentionally removed, water uses a static transparent/emissive material until the environment slice, and smaller decorative bridge caps/ribs are deferred to visual polish. These presentation differences are within the Phase 4 recognizable-not-pixel-identical contract and require no ADR.

Tests added and exact commands: Three xUnit cases validate seven chunks, unique IDs, canonical lamp/plot/cafe counts, Phase 1 layer/masks, continuous deck/barriers, and cable/hanger symmetry/intersection. Twelve Godot assertions validate live chunks, unique/live collider bodies, bridge metadata/barriers, spatial MultiMeshes, cache reuse, debug traversal route, and surface query precedence. Commands: `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore --filter FullyQualifiedName~MvpWorldLayoutTests`, `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`, and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`.

Test results and artifact paths: Focused layout tests pass 3/3; the domain suite passes 226/226; browser tests pass 391/391; Vite production build succeeds with its known size advisory; native build completes with zero warnings/errors; and all successful boot scenarios publish `phase4.world.passed` with 12/12 assertions while retaining Phase 3's 84/84/88 scenario baselines. TRX and raw Godot output remain under `godot/artifacts/test-results/`.

Performance/resource counts before and after: Before this slice the authored world owned zero gameplay nodes/resources. The verified live baseline is 283 authored objects, 258 colliders, and 87 spatial MultiMesh cell groups backed by 56 cached meshes, 49 cached materials, and 44 cached shapes. All ownership references are cleared by session shutdown.

Manual checks performed: Headless scene construction and disposal were exercised. Visual screenshot grading remains the Phase 4 exit slice.

Open defects with severity and reproduction: None found in authored geometry construction or live metadata. Fixed-time visual grading is intentionally not claimed yet.

Compatibility adapters and removal conditions: `WorldCollisionRegistry.CameraObstacles` projects static Godot ownership into the existing pure camera query record. Browser world generators remain visual/reference evidence until Phase 4 screenshots and later vehicle/pedestrian traversal pass. User-editable placement must enter through `UserWorld` and publish the same metadata contract.

Next safe task: Add the WorldEnvironment/weather/quality owner, emissive presentation updates, cached billboard owner, and live camera surface/clearance adapter/presets without duplicating domain formulas.

Unsafe/blocked tasks and required decision: Do not attach agents directly under authored chunks, generate post-MVP gameplay with its flags off, bypass the collision registry, instantiate per-window/lamp materials, or make the debug capsule available in release. No external decision blocks the environment/camera slice.
