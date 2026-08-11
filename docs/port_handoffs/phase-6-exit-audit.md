# Phase 6 Exit Audit Handoff

Chunk ID and status: `phase-6-exit-audit`; complete as the fifth and final Phase 6 slice. All work items 6.1–6.9 and all five exit gates are complete.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `243f528`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Objective and non-goals: Close the living-city phase with a deterministic 30-minute headless stress scenario and machine-checked evidence. This does not promote placeholder meshes/audio to authored assets, connect visible density to the Phase 7 aggregate economy, or build the Phase 9 Heat HUD.

Soak configuration and result: `Phase6LivingCitySoakTests` advances traffic and pedestrians for 1,800 simulated seconds in 18,000 deterministic 0.1-second steps while rotating the focus across city, bridge, countryside, and LOD regions. Every ten steps it validates 48 unique moving IDs, 12 separate parked IDs, 60 unique citizens, finite state, and the bounded lane/intersection envelope. The run completes with exact stable floors and no unhandled exception.

Lifecycle stress: The soak performs 10 traffic culls, 15 citizen culls, 12 exact-ID possession/ejection cycles, 10 knockdown/hit-and-run cycles, and 10 Heat/enforcement response cycles. Monotonic replacement IDs preserve every floor. The response owner clears all player Heat, incidents, assignments, pursuits, sirens, controlled proxies, and test knockdowns before exit. The soak exposed and fixed a route handoff gap: player release and edge advancement now clamp immediately to the selected new corridor instead of waiting for a later LOD update.

Reference behavior and congestion: The production graph and focused route tests retain all 480 authored nodes, primary-bridge routing, overshoot safety, turn limits, and corridor correction. The soak observes bridge traversal, turning, and stop/congestion samples. Focused traffic/pedestrian suites retain canonical 9/2/1 signals, 1.1-second four-way ordering, 39/48 compliant drivers, 20% impatience, speed-aware braking, one-shot horns, 60-citizen archetype distribution, and bounded pursuit cleanup.

Profiler/query capture: Routine live neighbor/interaction updates inspect at most six traffic and four pedestrian candidates, not the 48/60 populations. Initial enforcement dispatch is explicitly non-routine and inspected 35 of 48 through a bounded 500-metre grid query; later response updates touch only assigned responders. Simulation LOD remains 1/2/8 ticks at 130/340 metres for both populations. Render LOD remains independent at traffic 160/400 metres and pedestrian 120/320 metres.

Evidence and verification: The canonical audit is `docs/port_evidence/phase6/exit-audit.json`, validated by `Tools/Phase6Audit/validate-audit.mjs` from both the local Godot verifier and Linux CI. The domain suite passes 280/280 including the soak. Clean/import/recovery Godot integration passes 155/155/159 assertions. The complete `godot/scripts/verify.sh` gate validates content, every Phase 2–6 audit, build, domain tests, Godot import, and all three integration paths.

Ownership and cleanup: `TrafficRoadGraph`, `TrafficPopulationSimulation`, `TrafficControlCoordinator`, `PedestrianSidewalkGraph`, `PedestrianPopulationSimulation`, `HeatEnforcementModel`, and their session runtimes remain the single authorities described in the preceding handoffs. Session shutdown owns every runtime root, actor, collider, empty audio player, and response assignment. No save schema, collision bit, input action, canonical content ID, or browser implementation changed in this exit slice.

Remaining placeholders: Full/low vehicle and pedestrian primitives remain Phase 9 art work; horn, siren, ambience, and citizen voice streams remain Phase 10 audio work; the Heat/enforcement HUD remains Phase 9; aggregate-condition-driven density remains Phase 7. These have explicit later owners and do not block the Phase 6 behavior/runtime exit.

Next safe task: Begin Phase 7 from its plan read-first list by binding aggregate economy and Builder decisions to the now-stable road and living-city adapters. Do not make visible agent counts authoritative for congestion or productivity.
