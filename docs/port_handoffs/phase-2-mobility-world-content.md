# Phase 2 Mobility and World Content Handoff

Chunk ID and status: `phase-2-mobility-world-content`; complete as the third Phase 2 slice. Phase 2 overall remains in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation based on Godot revision `852f580` targeting Godot 4.6 stable .NET.

Objective and explicit non-goals: Canonicalize the engine-neutral vehicle profile/chassis layout, pedestrian archetype mix, camera preset coordinates, and primary suspension-bridge layout. Load, validate, and publish them through the typed production registry with exact Phase 0 fixture parity. This chunk does not implement vehicle physics, pedestrian spawning, camera control, bridge rendering/collision, countryside placement, street furniture, economy, deterministic random streams, or mutable runtime authority.

Authorities and evidence read: `src/data/ContentDefinitions.js`, `src/entities/VehicleProfiles.js`, `src/entities/PedestrianArchetypes.js`, `src/camera/CameraPresets.js`, `src/world/SuspensionBridge.js`, `Tools/BaselineCapture/baseline-fixtures.mjs`, `world-landmarks.json`, and `seeded-agents-navigation.json`.

Files/resources added or changed: Extended `Tools/GodotContentExtraction/extract-content.mjs`; added `vehicle-profiles.json`, `pedestrian-archetypes.json`, `camera-presets.json`, and `suspension-bridge.json`; added typed models and family validation; extended strict embedded loading and `GameContentRegistry`; embedded the two Phase 0 fixtures in the test assembly; added `MobilityWorldContentTests`; and updated the port plan and parity matrix. No browser authority, authored scalar, scene, input action, collision layer, or save schema changed.

Ownership and public API: Frozen JavaScript modules remain extraction inputs during the dual-engine port. Generated JSON is the C# compatibility artifact. `CanonicalContentLoader` now loads the four documents; `CanonicalContentValidator` validates complete vehicle IDs/profiles, pedestrian references, camera vectors, bridge ordering, and derived cable samples; `GameContentRegistry` publishes immutable records and adds vehicle, pedestrian, and camera lookups.

Stable IDs/schema/content: Schema version remains 1 and source revision remains pinned. The registry adds all 11 vehicle IDs/profiles (including `SPORTS_CAR` alias behavior), 6 pedestrian archetypes with the 20-entry population sequence, 9 camera presets, 13 bridge layout scalars, and 9 cable samples. SHA-256: `a22c04fd040049a0e6f3d19e735936d61c8d326ab0ad2ba17488c00e9fd2d3d9` (`vehicle-profiles.json`), `b20da9a3ff2b1c48a49b598e585315778d2ab6314397ff762be80104e1409f17` (`pedestrian-archetypes.json`), `0cedf0d661aa53c118738f1952f45945fb572cd0aa63c683715bb394deed6df0` (`camera-presets.json`), and `d7e9bc31b890de17b17a06ccaff94b688e589446f3069b6ff5d84c5b8f5b6cfd` (`suspension-bridge.json`).

Behavior and validation: Extraction deep-compares the 11 vehicle IDs, all fixture-selected vehicle/profile/layout scalars, all pedestrian profiles and sequence entries, all camera vectors, the complete bridge layout, and every frozen cable sample before emitting deterministic JSON. C# validation rejects incomplete vehicle record sets, invalid physical ranges/derived wheel layout, missing pedestrian references, malformed camera vectors, invalid bridge coordinate ordering, and cable samples inconsistent with the canonical suspension curve. Publication only occurs after all seven canonical documents and missions validate.

Tests and results: Added five xUnit cases, bringing the domain suite to 30 tests. `npm run godot:content:check` and `npm run baseline:check` report zero mismatches; formatting verification passes; the complete `verify.sh` gate passes with a deterministic zero-warning build, 30/30 domain tests in 77 ms, Godot 4.6 headless import, and 18/18 foundation integration assertions. Results remain under `godot/artifacts/test-results/`.

Performance/resources: Data-only work; no Godot nodes, bodies, timers, subscriptions, or per-frame work were added. The new registry materializes 11 vehicle records, 6 pedestrian records, 9 camera records, one bridge layout, and 9 cable samples once per construction.

Known deviations and defects: None. Extracted vehicle chassis values remain browser/cannon-es compatibility inputs; Phase 5 must measure and approve their mapping to Godot/Jolt rather than assuming identical solver behavior.

Next safe task: Complete Phase 2.4 with economy balance, countryside plan, and street-furniture layout extraction, then begin Phase 2.5 pause-hold/transition-coordinator interfaces and scheduler clock math. Do not wire renderer or physics behavior from these DTOs until their later phase acceptance tests and telemetry exist.
