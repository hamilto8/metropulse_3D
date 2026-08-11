# Phase 6 Road Graph and Spatial Query Handoff

Chunk ID and status: `phase-6-road-graph-spatial`; complete as the first of five Phase 6 slices, covering work items 6.1 and 6.8. Phase 6 remains in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `6e8f59a`; targets Godot 4.6 stable .NET, Jolt, and the existing 120 Hz physics policy.

Objective and explicit non-goals: Establish one authoritative road topology and one reusable bounded local-query primitive before adding ambient agents. This slice does not spawn traffic or pedestrians, mutate Godot nodes or physics bodies, implement signal visuals, run enforcement, or claim any population/soak exit gate.

Documents and source files read: `docs/GODOT_4_6_CSHARP_PORT_PLAN.md`, `docs/GODOT_PORT_PARITY_MATRIX.md`, the Phase 2 traffic-kernel and Phase 5 exit handoffs, `src/systems/TrafficSystem.js`, `TrafficNavigation.js`, `SpatialObstacles.js`, `PerformanceSystem.js`, their browser tests, and the Phase 4 world/bridge layout.

Files/scenes/resources added or changed: Added `Simulation/SpatialHashGrid.cs`, `Traffic/TrafficRoadGraph.cs`, `Traffic/TrafficObstacleModel.cs`, `SpatialHashGridTests.cs`, and `TrafficRoadGraphTests.cs`; updated the port plan and this handoff. No scene, collision layer, input action, canonical content file, save schema, or browser source changed.

Authoritative owners touched: `TrafficRoadGraph` is the sole mutable topology owner and publishes detached, stable-ID-sorted snapshots. `SpatialHashGrid<T>` owns deterministic XZ cell membership for routine local queries. `TrafficObstacleIndex` owns active oriented-obstacle snapshots and bounded obstacle-ahead selection. The earlier `TrafficNavigationModel` remains the pure segment projection, target-plane reach, and turn-speed owner.

Public APIs, signals, events, input actions, collision layers: Added production graph creation/snapshot, validated user-road register/unregister, overshoot-safe seeded route advancement, corridor enforcement, nearest-routable recovery, generic grid rebuild/query with query-work telemetry, and obstacle-index rebuild/ahead query. No engine signal, input action, or collision-layer value changed.

Stable IDs/schema/content changes: Preserved all 12 X coordinates, 5 Z coordinates, 8 directional approach/departure nodes per intersection, the `EB/WB/NB/SB_IN/OUT:x,z` vocabulary, 3.5-metre lane offset, 38-metre user-road connection radius, `USER_ROAD:<road>:<endpoint>` IDs, the only primary-river crossing at Z=0, and Phase 2 navigation constants. Graph snapshots are runtime publications, not save-envelope schema.

Road graph schema:

```text
TrafficRoadGraphSnapshot(revision, baseNodeCount, nodes, edges, userRoadIds)
  node(id, position[x,z], nextNodeIds, source, roadId?)
  edge(id=from->to, fromNodeId, toNodeId, length,
       hasBridgePriority, source, roadId?)
```

Behavior implemented: The production graph builds 480 authored nodes and deterministic directed adjacency, omits non-bridge river crossings, retains all five countryside crossings, and guarantees no dead ends. User roads add a center plus two or four rotated endpoints, connect each endpoint to the two nearest graph nodes within 38 metres, publish connectivity, reject duplicate/invalid IDs and geometry, and remove all reverse links on unregister. Advancement detects both proximity and target-plane overshoot, avoids immediate U-turns when alternatives exist, and draws only from `TrafficBehavior`. Corridor enforcement limits AI positions by both configured and vehicle-width geometric clearance. Obstacle selection queries only nearby cells, projects rotated boxes onto forward/lateral axes, and selects the stable closest blocker.

Random stream use: Only route choice draws from the injected named `TrafficBehavior` stream. Graph construction, registration, publication, spatial rebuilds, and obstacle selection consume no randomness.

Tests added and exact commands: Eight focused xUnit cases cover positive/negative cell boundaries, stable ordering, duplicate/nonfinite grid inputs, exact 480-node production topology, no dead ends, primary and countryside bridge rules, seeded overshoot advancement, lane correction, user-road lifecycle/immutable publication, stable nearest-node recovery, invalid inputs, and bounded obstacle selection. Commands: `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore --filter "FullyQualifiedName~SpatialHashGridTests|FullyQualifiedName~TrafficRoadGraphTests"`, full domain tests, `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`, and `godot/scripts/verify.sh`.

Test results and artifact paths: Focused tests pass 8/8 and the full domain suite passes 263/263. The complete Godot verification gate exits 0 with build/format/content/baseline/audits clean and the clean/import/recovery headless scenarios retaining 134/134/138 assertions. Domain TRX remains `godot/artifacts/test-results/domain-tests.trx`; no new binary evidence artifact is needed for this pure slice.

Performance/resource counts before and after: Runtime node/body/subscription counts remain zero. The base graph contains 480 nodes. Grid rebuild is O(n) plus per-cell stable sort; a local query visits only overlapping cells and returns candidate-test telemetry. User-road nearest attachment and recovery may scan graph nodes because they are explicit edit/recovery operations, never routine per-agent updates.

Manual checks performed: None; the slice has no rendered surface. The graph coordinates and bridge metadata were compared directly with the frozen browser implementation and Phase 4 bridge geometry.

Open defects with severity and reproduction: None found in the implemented surface.

Compatibility adapters and removal conditions: Phase 2's injected road-network snapshot can now consume `TrafficRoadGraph.Snapshot()` through the future session adapter; it remains intentionally detached until the Phase 7 builder exists. Godot physics collider extraction must rebuild `TrafficObstacleIndex` at a bounded cadence and must never duplicate obstacle geometry formulas in actors.

Next safe task: Build the traffic population/runtime owner over this graph, seeded spawn profiles, moving/parked separation, control handoff, rule/control state, behavior components, damage/fire state, LOD cadence, and spatially bounded vehicle queries.

Unsafe/blocked tasks and required decision: Do not let ambient traffic overwrite the Phase 5 player-control authority or aggregate productivity. Do not use a visible vehicle count as economy congestion. No external decision blocks the next slice.
