# Phase 4 Exit Audit Handoff

Chunk ID and status: `phase-4-exit-audit`; complete as the fourth and final Phase 4 slice, covering work item 4.10 and all five Phase 4 exit gates.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `a812a54` and targets Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Close Phase 4 with executable coordinate, physics, visual, resource-budget, and teardown evidence. This slice does not add dynamic agents, player control, traffic, gameplay camera transitions, product UI, post-MVP districts, or release-platform certification.

Documents and source files read: Phase 4 plan and prior Phase 4 handoffs; Phase 0 world and browser screenshot manifests; browser `CityBuilder`, camera, mission, district, bridge, and street-furniture sources; generated layout/collision/session owners; Phase 2/3 audit patterns; verifier and CI workflow.

Files/scenes/resources added or changed: Added browser-source landmark capture/check tooling and fixture; four golden xUnit cases; a 14-waypoint physical traversal route; live support/obstacle/collider/lifecycle checks; fixed screenshot capture and manifest tooling; three Godot PNGs paired to Phase 0 references; per-chunk performance evidence; the ten-requirement/five-gate Phase 4 audit; local/CI integration; completed plan/parity records; and this handoff.

Authoritative owners touched: Browser frozen sources remain coordinate reference inputs. `MvpWorldLayout`, `WorldSurfaceModel`, canonical content/mission/camera records, and the live Godot collision registry remain runtime owners. Evidence generators own reproducible fixtures/manifests only; the audit validates evidence and does not become gameplay authority.

Public APIs, signals, events, input actions, collision layers: Added debug-only screenshot argument handling and `Phase4ScreenshotCapture`; expanded debug traversal waypoints; added structured event `phase4.exit.passed` and per-chunk world telemetry. No gameplay signal, action, layer, schema, or canonical record changed.

Stable IDs/schema/content changes: Golden evidence includes all 23 building plot centers, ten scoped mission pickup IDs, three MVP district IDs, bridge stable definitions, and exact camera IDs. Evidence documents use local schema version 1. No save or gameplay content schema changed.

Behavior implemented: The debug capsule route crosses West Core, the primary bridge and east corridor, returns along supported roads, and enters Central Park. Live physics samples every route segment at 2.5-metre spacing for support and obstacle clearance. Five representative ray samples prove visual/collider stable-ID alignment. An isolated generated world constructs nodes/resources/colliders and returns all owned counts to zero on shutdown.

Golden landmark report: `world-landmarks.json` is regenerated directly from the frozen JS camera/district/mission/bridge/road definitions plus source-parsed block/park constants. Tests compare it to Godot layout, surface, mission, camera, and content owners. It covers 23 plots, eight road X/five road Z coordinates, deck/two barriers/nine cable samples, ten pickups, park, eight production camera poses, eight terrain samples, and three districts.

Visual evidence and deviations: Fixed 1280×720 seed-424242 captures pair day/clear, dusk/rain, and night/clear with their Phase 0 browser images. The implementation review accepts geometry, palette, lighting, and readability. Native output intentionally lacks Phase 9 product UI, uses low-poly deterministic towers, native procedural sky/particles/text, static cyan water, and a renderer-unit fog scale of 0.18; pixel identity is not required.

Performance/resource counts by chunk: WestCore 38 objects/20 colliders/800 instances; RiverCorridor 4/3/0; PrimaryBridge 22/19/234 segments; CentralPark 14/11/16; BuildingPlots 24/24/0; StreetFurniture 158/158/292; InitialSkyline 23/23/4,392. Totals are 283 objects, 258 colliders, 5,500 instance records, 234 segment records, 87 MultiMesh cells, 58 meshes, 51 materials, and 44 shapes, all within recorded budgets. Shutdown returns owned counts to zero.

Tests added and exact commands: Four golden/performance xUnit cases; five live physical/lifecycle assertions in addition to the existing 12 world and 15 presentation assertions; three fixed screenshot captures; and an executable audit. Commands: `npm run godot:phase4:surface:check`; `npm run godot:phase4:landmarks:check`; `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/capture-phase4-screenshots.sh`; `npm run godot:phase4:screenshots:check`; `npm run godot:phase4:audit`; `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/verify.sh`.

Test results and artifact paths: Browser tests pass 391/391 and domain tests pass 232/232. Successful headless action scenarios retain 84/84/88 shell assertions and each publishes 12/12 world, 15/15 presentation, and 5/5 exit assertions. Golden fixtures are under `test/fixtures/godot-port/phase4/`; screenshots, hashes/signoff, performance counts, and audit are under `docs/port_evidence/phase4/`; Godot logs/TRX remain under `godot/artifacts/test-results/`.

Manual checks performed: Visually inspected all three native captures beside their Phase 0 pairs. City block/road/river/bridge/park composition is recognizable across all states; day colors, dusk/rain separation, night emissive readability, bridge silhouette, and cyan river corridor remain legible. The renderer-unit fog conversion was tuned from an initially washed-out capture and recaptured before signoff.

Open defects with severity and reproduction: None blocking Phase 4. Known accepted deviations are listed above. Dynamic-agent traversal and full product-UI visual acceptance intentionally begin in Phases 5 and 9.

Compatibility adapters and removal conditions: Keep the landmark source generator while browser files are reference authority. Keep screenshot pairs until Phase 11 release visual policy supersedes them. Keep `WorldCollisionRegistry.CameraObstacles` until all live editable/dynamic obstacle publishers use the same metadata/query contract. Debug capture/traversal must remain excluded from release behavior.

Next safe task: Begin Phase 5 with transactional camera/player ownership and the first Management → on-foot → vehicle → Management controllable slice, consuming the now-verified surface/collider/camera contracts.

Unsafe/blocked tasks and required decision: Do not collapse later transition, agent, mission, or UI ownership into the static Phase 4 world; do not enable post-MVP cameras without their feature owners. No external decision blocks Phase 5.
