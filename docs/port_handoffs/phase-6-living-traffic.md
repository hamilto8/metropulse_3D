# Phase 6 Living Traffic Handoff

Chunk ID and status: `phase-6-living-traffic`; complete as the second of five Phase 6 slices, covering item 6.2, item 6.4, and the traffic portions of 6.3 and 6.9. Phase 6 remains in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `72e3d53`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Objective and explicit non-goals: Add a seeded living traffic population around the Phase 5 control slice without creating a second player or aggregate-congestion authority. This slice excludes pedestrian yielding/impacts, Heat/pursuit, final long soak, polished vehicle assets, and authored audio streams.

Documents and source files read: Port plan/parity matrix, Phase 2 traffic and Phase 5 exit handoffs, `TrafficSystem.js`, `TrafficControlSystem.js`, `TrafficRules.js`, `PerformanceSystem.js`, `HitAndRunPursuit.js`, vehicle content, `SessionShell`, `PlayerControlRuntime`, `PlayerVehicleController`, and existing integration scenarios.

Files/scenes/resources added or changed: Added domain `TrafficControlCoordinator.cs` and `TrafficPopulationSimulation.cs`; added their xUnit suite; added Godot `LivingTrafficRuntime.cs`, `TrafficVehicleActor.cs`, and `TrafficControlPostActor.cs`; wired session ownership/readiness/shutdown; expanded integration verification; updated the plan, parity matrix, and this handoff. No canonical content, save schema, input action, browser source, or collision-layer number changed.

Authoritative owners touched: `TrafficPopulationSimulation` is the only moving/parked traffic lifecycle and AI-state owner. `TrafficControlCoordinator` exclusively owns live signal time and stop queues. `LivingTrafficRuntime` owns session/node adaptation, stable-ID promotion, and cleanup. `TrafficVehicleActor` owns only lightweight render/collision/audio presentation. `PlayerControlRuntime` and `PlayerVehicleController` remain the only player/body authority after promotion. Aggregate `TrafficProductivityModel` remains independent of visible samples.

Agent lifecycle:

```text
TrafficSpawn stream -> moving proxy (stable traffic-moving-NNNN, AI)
  -> near/medium/far simulation + independent render tier
  -> promote same ID -> Phase 5 PlayerVehicleController (proxy hidden)
  -> release pose -> nearest road rejoin -> same moving proxy AI
  -> impact -> damaged -> optional on-fire -> disabled
  -> cull/despawn -> retired ID + immediate seeded replacement

Parked spawn -> traffic-parked-NNNN -> render/collision proxy only
             -> never moving, routing, congestion, or population-floor input
```

Public APIs, signals, events, input actions, collision layers: Added immutable population/agent/control/post snapshots; population advance/cull/damage/player-pose APIs; live control advance/arrival/proceed/depart APIs; session promotion/release/shutdown APIs; and actor detail/collision diagnostics. Traffic actors publish Traffic and consume Player/Traffic/Pedestrian/StaticObstacle; posts publish StaticObstacle and consume Player/Traffic/Pedestrian. No new input action or Godot signal is authoritative.

Stable IDs/schema/content changes: Moving IDs are monotonic `traffic-moving-0001...`; parked IDs are `traffic-parked-0001...`; control IDs remain `SIGNAL:x,z` and `STOP:x,z`; post IDs append `:N/:S/:E/:W`. Profiles draw only from the production SEDAN/SPORTS/BUS/TRUCK/POLICE/MOTORBIKE records. These are runtime identities and do not change the save envelope.

Behavior implemented: The floor starts and remains at 48 moving agents, with 12 separately published parked proxies. Spawn selects routable departure, target, profile, speed, and disposition from named streams. Agent movement consumes road-graph advancement/corridor rules, turn speed, signal/stop state, a bounded 18-metre neighbor query, speed-aware following, impatient one-shot horns, emergency bypass/speed, and four-second stuck recovery. Damage is bounded through healthy/damaged/on-fire/disabled. Promotion creates the selected custom-raycast production controller under the same stable ID, freezes the proxy, and publishes physics pose back until AI resumes. All 60 controls use the canonical 9/2/1 cycle or countryside four-way queues; 240 post colliders are live.

Simulation and render cadence:

| Concern | Near | Medium | Far |
|---|---:|---:|---:|
| Simulation distance | <=130 m | <=340 m | >340 m |
| Simulation cadence | every tick | every 2 ticks | every 8 ticks |
| Physical proxy collision | enabled | disabled | disabled |
| Render distance | <=160 m | <=400 m | >400 m |
| Render body | full box + shadows | full box, no shadows | low proxy |

Simulation and render thresholds are deliberately independent. Stable identity, route, damage, and disposition remain present at every tier.

Random stream use: `TrafficSpawn` selects starting nodes, next edges, profiles, and speed variation. `TrafficBehavior` selects impatience and subsequent route branches. Control timing, 80% serial compliance, LOD, damage, culling identity, visuals, and player handoff consume no random draws.

Population invariants: Moving count is never below 48 after a public mutation or tick; parked count is excluded; IDs never reuse; no duplicate player/AI authority exists; promotion does not alter either floor; culling a promoted identity is rejected by call ordering; visible counts never feed aggregate productivity; every local vehicle query uses `SpatialHashGrid` telemetry.

Tests added and exact commands: Five pure cases cover exact seeded replay, 48/12 separation, 39/48 compliance, cull/handoff floor preservation, canonical signal timing, stable four-way order, 240 post definitions, 1/2/8 simulation LOD, bounded neighbor candidate counts, damage/fire transition, and invalid inputs. Eight live assertions cover runtime ownership, 60 actors, 60 controls/240 colliders, stable IDs, exact-ID player promotion/release, and cull replacement. Commands: focused xUnit filter, full domain suite, format/build, and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`.

Test results and artifact paths: Focused traffic tests pass 5/5. Clean/import/recovery headless scenarios pass 142/142/146 assertions and each publishes `phase6.traffic.passed` with 48 moving, 12 parked, 240 posts, and a maximum of six local candidates in the exercised run. Logs are under `godot/artifacts/test-results/godot-integration*.log`.

Performance/resource counts before and after: Session adds one runtime owner, one `AmbientTraffic` root with 60 actors, and one `TrafficControls` root with 240 physical posts. Only near traffic retains collision. Agent routine queries inspect local grid candidates; the measured integration maximum is six, not the 48-agent population. No agent owns a timer or subscription.

Manual checks performed: None; headless presentation construction and collider ownership were verified. Vehicle art and sound remain explicit placeholders.

Open defects with severity and reproduction: None found in the implemented boundary. Signal faces and AI both consume the post/approach axis; authored meshes and sounds remain planned presentation replacement rather than defects.

Compatibility adapters and removal conditions: Promotion is the compatibility bridge from a lightweight ambient actor to `PlayerVehicleController`; it remains until a pooled chassis can retain the selected vehicle's exact physics resources without 48 full rigid bodies. Placeholder meshes and empty horn players are removed when authored vehicle/audio assets land. Neither adapter may duplicate AI or player authority.

Next safe task: Add the 60-citizen pedestrian population, all canonical archetypes/behaviors, pedestrian graph, bounded LOD, traffic yielding/knockdown/hit-and-run state, nearby police selection, and cleanup.

Unsafe/blocked tasks and required decision: Do not register all 48 proxies as full raycast chassis, run all-agent proximity scans, treat parked inventory as congestion, or let AI mutate a promoted body. No external decision blocks the pedestrian slice.
