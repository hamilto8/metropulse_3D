# Phase 4 World Surface Kernel Handoff

Chunk ID and status: `phase-4-world-surface-kernel`; complete as the first Phase 4 slice.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implemented after Godot revision `d1ec17f` for Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Establish one engine-neutral authority for terrain, water, bounds, and built-in deck queries before any Phase 4 node constructs visual or physical geometry. This slice does not create Godot world nodes, physics bodies, meshes, materials, runtime editable roads, camera nodes, weather presentation, or screenshots.

Documents and source files read: `docs/GODOT_4_6_CSHARP_PORT_PLAN.md`, `docs/GODOT_PORT_PHASE_1_FOUNDATION.md`, `docs/MVP_SCOPE.md`, `docs/PLACEMENT_INTELLIGENCE.md`, `docs/TRANSITION_COORDINATOR.md`, `docs/port_handoffs/phase-3-exit-audit.md`, `src/world/CityBuilder.js`, `src/world/CountrysidePlan.js`, `src/world/SuspensionBridge.js`, `src/world/CompactSuspensionBridge.js`, `src/world/BridgeSafety.js`, `src/data/ContentDefinitions.js`, and the Phase 0 world fixtures.

Files/scenes/resources added or changed: Added `WorldSurfaceModel`, its xUnit suite, the generated Phase 4 dense fixture, and its browser-source capture/check tool. Added the fixture as an embedded test resource and integrated drift checking into native verification. Updated the Phase 4 plan item and npm commands.

Authoritative owners touched: `WorldSurfaceModel` is the single engine-neutral owner of height/water/bounds calculations and immutable deck snapshots. `ContentDefinitions.WorldBounds` remains the stable authored world-bound owner. Visual and physical Godot owners must consume this model.

Public APIs, signals, events, input actions, collision layers: Added `GetHillHeightRaw`, `GetIntersectionHeight`, `GetHillHeight`, `GetTerrainHeight`, `GetBridgeDeckHeight`, `IsWater`, `IsWithinWorldBounds`, `IsWithinDrivableBounds`, immutable `Decks`, `SurfaceDeck`, and `SurfaceBounds`. No signals, events, actions, layers, masks, or serialized state changed.

Stable IDs/schema/content changes: Production deck IDs preserve `grand-suspension`, `urban-0` through `urban-3`, and `countryside-0` through `countryside-4`. Fixture schema 1 is test evidence only. No production content or save schema changed.

Behavior implemented: Exact browser hill and roadbed profiling includes the rolling countryside, intersections, graded roads, retained rocket-access safety surface, city road/block/park precedence, river beds, both river classifications, bridge deck precedence, frozen world bounds, and wider recovery/drivable bounds. Nonfinite inputs fail safely instead of propagating unusable values.

Known deviations and ADR links: The typed model returns safe zero/false/null results for nonfinite inputs; ordinary finite inputs match browser fixtures within `1e-9` metres. This hardening does not require an ADR. User-built bridge decks will be supplied as immutable snapshots by the Phase 4 world owner rather than queried through JavaScript object graphs.

Tests added and exact commands: Added three xUnit cases comparing 7,979 ten-metre grid points and 26 boundary/deck points, invalid inputs, immutable publication, and custom-deck precedence. Commands: `npm run godot:phase4:surface:check`, `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore --filter FullyQualifiedName~WorldSurfaceModelTests`, `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore`, `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`, and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/verify.sh`.

Test results and artifact paths: Focused tests pass 3/3; the domain suite passes 223/223 and writes `godot/artifacts/test-results/domain-tests.trx`; browser tests pass 391/391; Vite production build succeeds with the known chunk-size advisory; deterministic .NET/Godot builds have zero warnings/errors; and all Phase 3 headless scenarios retain their expected 84/84/88 successful assertions and stable expected-failure codes.

Performance/resource counts before and after: The pure query model creates zero Godot nodes/resources and publishes 10 immutable production deck records. Resource counts are unchanged.

Manual checks performed: None; this slice has no rendered surface.

Open defects with severity and reproduction: None found in the implemented query surface.

Compatibility adapters and removal conditions: The dense fixture is generated directly through `CityBuilder` and remains compatibility evidence. Later Godot world/camera/placement adapters must delegate to `WorldSurfaceModel`; the browser query methods remain until world, vehicle, placement, and camera parity exit their later phases.

Next safe task: Build Phase 4 MVP Godot world chunks from shared geometry/collision definitions and use this query model for terrain meshes, deck surfaces, water metadata, and debug traversal.

Unsafe/blocked tasks and required decision: Do not copy height or water formulas into Godot scene scripts; do not treat disabled expansion geometry as MVP gameplay; do not mutate the immutable production deck list. No external decision blocks the next slice.
