# MetroPulse 3D Godot 4.6 C# Port Plan

> **Status:** Proposed execution plan and audited source map
> **Audit date:** 2026-08-07
> **Audited source revision:** `31eef98eee66` on `codex/godot_port`
> **Source application:** Three.js r185, cannon-es 0.20, vanilla JavaScript, Vite 8
> **Target application:** Godot 4.6 .NET edition, C#, desktop-first
> **Audience:** Engineers, technical artists, designers, QA, release engineers, and AI agents joining the port with no earlier project context

## 1. Purpose and how to use this guide

This is the execution authority for porting the current MetroPulse 3D browser
game to Godot 4.6 using C#. It is deliberately self-contained. A team starting
any phase should be able to identify the existing behavior, the target Godot
design, the files and contracts it depends on, the work it owns, the evidence
it must produce, and the exact handoff required for the next team.

This is an engine port, not permission to redesign the game. Preserve existing
stable IDs, domain rules, game-state invariants, save semantics, content, and
player-visible behavior unless a recorded design decision explicitly changes
them. Engine-specific implementation details may change when required by
Godot, but changes must be measured and documented.

Every implementation chunk must follow this sequence:

1. Read this document's audit, invariants, target architecture, and the complete
   phase being attempted.
2. Read the source files and existing contract documents named by that phase.
3. Confirm the previous phase's exit report and automated checks.
4. Implement only the owned slice; avoid introducing a second authority for a
   concept already assigned elsewhere.
5. Add automated parity evidence before deleting or bypassing a compatibility
   adapter.
6. Produce the handoff packet in section 17 even if the phase is incomplete.

## 2. Critical platform decision

Godot 4.6 C# projects cannot be exported to the web. The official Godot 4.6
[C# platform support documentation](https://docs.godotengine.org/en/4.6/tutorials/scripting/c_sharp/)
supports C# on desktop and describes mobile support as experimental, but
explicitly excludes web export.

The default assumption for this plan is therefore:

- Windows, macOS, and Linux are the release targets.
- The existing browser build remains available as the reference implementation
  until the Godot release passes final parity acceptance.
- Mobile is not a Phase 1 release target.
- Browser saves are imported through an explicit export/import bridge; the
  Godot executable cannot read a browser's IndexedDB directly.

Before Phase 1 exits, the product owner must record one of these decisions in
`docs/DESIGN_DECISIONS.md`:

| Decision | Consequence |
|---|---|
| Desktop-first C# port | Follow this plan as written. Preserve the browser version as a legacy/reference build. |
| Browser delivery remains mandatory | Stop the C# port decision and evaluate a GDScript web port, a non-web C# companion product, or maintaining two implementations. |
| Desktop first, browser later | Complete the C# desktop port, but keep domain/content formats engine-neutral so a later web implementation can reuse them. |

Do not discover this constraint at release time.

## 3. Audited repository baseline

### 3.1 Scale and verification state

The audited tree contains:

- 127 JavaScript modules under `src/` with 245 internal import edges and no
  multi-file import cycles.
- Approximately 63,454 lines across source, tests, styles, data, and docs.
- Large integration owners: `TrafficSystem.js` (2,328 lines), `CityBuilder.js`
  (1,740), `CityEditorSystem.js` (1,663), `UIManager.js` (1,622),
  `PedestrianSystem.js` (1,583), `EconomySystem.js` (1,558),
  `AudioSystem.js` (1,358), and `MissionSystem.js` (1,195).
- A 735-line composition root, `src/main.js`, with 66 internal imports. It is a
  wiring hotspot, not a domain model to translate line by line.
- 37 system modules, 20 world modules, 15 UI modules, 8 entity modules, and
  dedicated core, mission, persistence, settings, camera, boot, alert, data,
  effect, and diagnostics packages.
- 15 authored missions in `src/data/missions.json`; the MVP allow-list names 10
  of them across Taxi, Courier, Delivery, Race, Sabotage, and Survival. With the
  default-off temporary-Mayhem flag, the Survival record is validated but
  filtered out of a normal first session until that feature passes its gate.
- 19 construction catalog entries and 11 stable vehicle content IDs.
- A default ambient target of 48 moving vehicles and 60 pedestrians.
- A save envelope at schema version 2 and feature version 2.
- 387 passing Node tests at audit time.
- A successful Vite production build at audit time. The largest application
  chunk is about 855 KB before gzip and triggers the existing chunk-size
  warning.

The audit commands were:

```bash
npm test
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:browser
```

The intentionally logged `interrupted transaction` stack during the save
suite is fault-injection coverage; the suite still passes.

All nine Playwright smoke scenarios passed through the workstation Chrome
channel in 51.1 seconds. The unqualified `npm run test:browser` command could
not launch in the audit environment because Playwright's bundled Chromium was
not installed; no game assertion ran or failed in that attempt.

### 3.2 Product baseline

MetroPulse is a hybrid city-management and street-action game. The two loops
share one authoritative treasury and consequence model:

- **Management/Builder:** inspect the city, zone Residential/Commercial/
  Operations parcels, place or edit structures and roads, manage services,
  respond to incidents, inspect land value and traffic productivity, and
  unlock progression.
- **Street:** directly control pedestrians, hijack and drive vehicles, fight
  with a baseball bat, trigger Heat and police response, and complete timed
  missions.
- **Persistent city:** save and restore economy, world edits, controlled
  entity, time/weather, mission progress, outcome ledger, settings, bindings,
  Heat, progression compatibility views, and structured alerts.
- **Living presentation:** procedural low-poly city, traffic, pedestrians,
  dynamic day/night and weather, procedural audio, minimap, inspector, HUD,
  dialogue, result screens, and optional Mayhem/aircraft/post-MVP content.

The release scope is not the same as everything present in source. The locked
MVP world is West Core, Central Park, and the primary bridge corridor. Aircraft,
rocket launch, East-side development, Mayhem variants/persistence, and
countryside expansion are default-off feature flags. Preserve those gates.

### 3.3 Existing architecture worth preserving

The browser implementation already established several engine-neutral
boundaries. Port these contracts before porting presentation:

- `GameManager` is the sole authoritative game-session state owner.
- `TransitionCoordinator` applies control, camera, clock, UI, and audio
  handoffs transactionally with reverse-order compensation.
- `SimulationScheduler` owns clock domains and stable update order.
- `EconomySystem`, `MissionLifecycleController`, `MissionOutcomeService`,
  `CityConditionService`, `AlertService`, `InteractionService`, validation,
  settings schemas, and much of traffic/economy math are renderer-free.
- Mission consequences use stable idempotency keys and an atomic outcome
  ledger.
- Saves are versioned plain data and intentionally exclude render, physics,
  input, UI, audio, and transient effect objects.
- Stable content IDs and validation are treated as persistence contracts.
- The source import graph has no cycles, providing a useful boundary to retain
  in C# namespaces/projects.

### 3.4 Porting liabilities and risk hotspots

The port must plan around these facts instead of hiding them:

1. `main.js` knows nearly every runtime owner. Recreating it as one Godot node
   with dozens of mutable public fields would preserve the coupling while
   losing the testability.
2. Traffic, pedestrian, city builder/editor, UI, audio, economy, and mission
   classes are large. Several mix domain rules with Three.js nodes, Cannon
   bodies, direct DOM access, or audio calls. Split by authority during the
   port; do not mechanically transliterate these files.
3. Production visual assets are almost entirely procedural primitives and
   generated materials. The repository has no production 3D model files and no
   audio files. World, vehicle, pedestrian, bridge, billboard, effect, and
   audio generators must be rebuilt or deliberately replaced.
4. The browser uses a 1/120-second Cannon physics step. A change to Godot's
   tick rate or vehicle model can materially alter driving, collision,
   pedestrian impact, bridge traversal, recovery, and missions.
5. Godot's built-in `VehicleBody3D` has documented limitations. The official
   [VehicleBody3D reference](https://docs.godotengine.org/en/stable/classes/class_vehiclebody3d.html)
   recommends custom `CharacterBody3D` or `RigidBody3D` integration for
   advanced behavior. A measured vehicle-physics spike is mandatory.
6. The current deterministic test mode replaces global `Math.random`, but many
   modules still call `Math.random` or wall-clock time directly. All gameplay
   randomness in the port must go through named seeded streams; cosmetic-only
   randomness must be identified explicitly.
7. The UI is a large, highly styled DOM/CSS application with over 130 stable
   element IDs, keyboard focus behavior, modal containment, responsive rules,
   and accessibility semantics. Godot `Control` scenes require a deliberate
   rebuild, not HTML embedding.
8. IndexedDB transaction behavior does not map directly to local files. Atomic
   current/recovery rotation and interrupted-write recovery must be recreated.
9. Existing browser tests validate DOM, WebGL, URL-driven deterministic test
   mode, and IndexedDB. They remain reference acceptance tests; Godot requires
   new headless integration and visual/playtest evidence.
10. Existing documentation includes future roadmap items and some older test
    counts/status labels. Code, current tests, `MVP_SCOPE.md`, and stable domain
    contracts take precedence over stale prose.

## 4. Non-negotiable parity invariants

These invariants are port requirements, not implementation suggestions.

### 4.1 Authority invariants

- Exactly one primary game state owns high-level input and camera behavior.
- Mayhem remains an overlay, never a primary state.
- Exactly zero or one directly controlled entity exists; street states require
  the correct entity type.
- Only the transition coordinator can perform cross-mode runtime handoffs.
- One simulation scheduler owns time accumulation and task ordering.
- One economy owns Capital, passive income, upkeep, services, buildings,
  district unlocks, incidents, and city aggregate outputs.
- One mission lifecycle owns phase, run, attempt, checkpoint, result, and retry.
- One outcome service applies each consequence transaction exactly once.
- UI consumes snapshots/view models; it does not become a second state owner.

### 4.2 Game-state contract

Port all states and their legal transitions exactly:

```text
BOOT, LOAD, MANAGEMENT, BUILDER, TRANSITION,
STREET_ON_FOOT, STREET_VEHICLE, RESULT, PAUSED, MENU
```

Every non-idempotent transition passes through `TRANSITION`. Destination
policies cover mission ownership, Heat, controlled entity, camera, and clock.
Transition execution must remain compensatable and reentrancy-safe.

### 4.3 Clock and order contract

Retain six conceptual clocks even if Godot supplies the underlying loop:

| Clock | Required behavior |
|---|---|
| Render | Full non-negative frame time; never city-speed scaled. |
| Gameplay real time | Bounded to 100 ms per frame and active only in gameplay policies. |
| Fixed physics | Initially 1/120 s with bounded catch-up; any later change requires an ADR and parity evidence. |
| City logical | Fixed one-second ticks; 0.5x/1x/5x/15x in Management/Builder and forced 1x in Street. |
| UI | Unscaled and responsive while gameplay is paused. |
| Paused | Measures pause time while gameplay, city, and physics remain stopped. |

The stable logical order is input, fixed physics, gameplay, city logic,
presentation, camera, render. In Godot, `_PhysicsProcess` should own physical
movement and physics-authoritative AI. `_Process` should own non-authoritative
presentation. Godot's
[physics interpolation guidance](https://docs.godotengine.org/en/4.6/tutorials/physics/interpolation/using_physics_interpolation.html)
requires movement in physics ticks and `ResetPhysicsInterpolation()` after
teleports or respawns.

### 4.4 Coordinate, unit, and identity contract

- Use meters, seconds, kilograms, radians internally, and km/h only for display.
- Preserve X/Y/Z world coordinates. Both implementations are Y-up and use -Z
  as the conventional visual forward axis, but validate yaw signs, triangle
  winding, camera direction, and road-node direction with golden landmarks.
- Preserve world bounds: X `[-190, 810]`, Y `[-100, 2000]`, Z `[-390, 390]`.
- Preserve stable mission, building, vehicle, district, zone, faction,
  progression, alert, incident, road, and persistence IDs.
- Do not use Godot node paths, instance IDs, resource UIDs, or scene names as
  durable gameplay IDs.
- Convert JavaScript `number` values to `double` in domain/save code. Convert to
  Godot `float` only at engine adapter boundaries and compare with declared
  tolerances.

### 4.5 Persistence contract

Preserve `METROPULSE_3D_SAVE`, schema version 2, feature version 2, current and
recovery slots, ordered migrations, content-reference validation, and all
required domains:

```text
game, economy, world, player, timeWeather, missions,
factions, progression, heat, settings, bindings, alerts
```

Preserve the intentionally transient list in `src/save/SaveSchema.js`. Never
serialize nodes, resources, physics objects, solver state, signals/delegates,
input state, UI focus, audio cursors, effects, or scheduler accumulators.

### 4.6 Content and scope contract

- Load and validate all 15 authored missions. Restrict normal release content to
  the 10 IDs in `MVP_MISSION_IDS`; while temporary Mayhem is off, continue to
  suppress its `SURVIVAL` mission without weakening content validation.
- Preserve the six activity templates.
- Preserve 19 construction catalog IDs and all economic/placement fields.
- Preserve 11 vehicle content IDs and profile aliases such as `SPORTS_CAR`.
- Preserve Residential, Commercial, and Operations as player-facing zones;
  compatibility aliases remain load-only.
- Keep all default-off feature flags off until their own phase passes.

## 5. Target Godot architecture

### 5.1 Repository layout

Create the Godot port alongside the browser implementation until final cutover:

```text
godot/
  MetroPulse.Domain/
    MetroPulse.Domain.csproj
    Core/
    Economy/
    Missions/
    Alerts/
    Interaction/
    Content/
    Persistence/
    Settings/
    Simulation/
  MetroPulse.Domain.Tests/
    MetroPulse.Domain.Tests.csproj
  MetroPulse.Godot/
    project.godot
    MetroPulse.Godot.csproj
    Main.tscn
    Assets/
      Data/
      Fonts/
      Images/
      Materials/
    Scenes/
      Boot/
      World/
      Entities/
      UI/
      Effects/
    Scripts/
      App/
      Adapters/
      World/
      Entities/
      Systems/
      Camera/
      UI/
      Diagnostics/
    Tests/
      Integration/
      Fixtures/
      VisualBaselines/
  Tools/
    BrowserSaveExporter/
    SaveImporter/
    BaselineCapture/
```

The exact test framework is selected in Phase 1, but pure domain tests must run
with `dotnet test` without launching the Godot editor. Engine integration tests
must run headless through a committed test runner. Avoid making a third-party
addon a hidden architectural dependency; pin and document any addon selected.

### 5.2 Runtime scene ownership

Recommended top-level scene:

```text
Main (Node)
├── BootLayer (CanvasLayer)
├── SessionRoot (Node; instantiated only after boot validation)
│   ├── WorldRoot (Node3D)
│   │   ├── AuthoredWorld
│   │   ├── UserWorld
│   │   ├── AgentRoot
│   │   ├── EffectRoot
│   │   └── NavigationRoot
│   ├── RuntimeServices (Node)
│   ├── CameraRig (Node3D)
│   ├── MainCamera (Camera3D)
│   └── HUD (CanvasLayer)
└── DiagnosticsLayer (CanvasLayer)
```

Use one `CompositionRoot`/session bootstrap node to construct pure C# services
and inject Godot adapters. It replaces `main.js` without becoming a service
locator. Prefer constructor injection for pure C# objects and explicit exported
node/resource references for scene adapters. Do not let arbitrary nodes call
`GetNode("/root/...")` to discover mutable authorities.

Autoloads are allowed only for truly process-wide, pre-session services such as
a minimal application shell or platform file-path provider. Game state,
economy, missions, world, and player control belong to the session and must be
disposable when returning to the menu or starting a new city.

### 5.3 Domain/engine boundary

`MetroPulse.Domain` must not reference Godot. Use ordinary C# records, enums,
interfaces, collections, and `System.Text.Json` DTOs. Engine adapters convert:

- domain vectors/quaternions ↔ `Godot.Vector3`/`Quaternion`;
- content definitions ↔ scenes/resources/materials;
- domain events ↔ view-model changes and Godot signals;
- physics observations ↔ plain collision/telemetry records;
- input actions ↔ plain sampled input state;
- `user://` file operations ↔ repository interfaces.

Use C# events within pure domain code and Godot signals at scene/UI boundaries.
Always unsubscribe in `_ExitTree` or dispose tokens explicitly. A queued or
freed node must never remain subscribed to a long-lived domain service.

### 5.4 Content representation

Use JSON as the compatibility source during the port. Missions should initially
use the current JSON unchanged. Extract JS-authored catalogs and definitions to
canonical JSON with a reviewed one-time tool, then load them into typed immutable
C# records.

Godot `Resource` wrappers may be generated for designer convenience only after
there is a deterministic JSON ↔ Resource pipeline. Do not fork truth between a
`.tres` and JSON copy. Stable IDs, not resource paths, are the cross-save and
cross-engine contract.

### 5.5 Godot callback and scheduling policy

Do not scatter authoritative updates across arbitrary node callbacks and rely
on scene-tree order. Use one `SimulationHost` to invoke registered systems in
the declared order.

| Godot entry point | Allowed responsibility |
|---|---|
| `_Input` / `_UnhandledInput` | Collect raw device events, UI routing, and edge state. Do not move gameplay bodies here. |
| Start of `_PhysicsProcess` | Freeze one canonical input snapshot and apply state/pause gates. |
| Ordered physics/gameplay schedule | Player commands, AI intent, character movement, physics-facing commands, collision/telemetry consumption, mission/world gameplay. |
| Ordered city accumulator | Time-of-day, traffic productivity, then economy in one-second logical ticks. |
| `_IntegrateForces` | Custom `RigidBody3D` force integration only; publish plain telemetry back to the scheduled owner. |
| `_Process` | Interpolated/non-authoritative visuals, UI view-model application, minimap cadence, diagnostics, and camera presentation after entity state is stable. |
| Engine render | Automatic; no gameplay mutation from render callbacks. |

Disable autonomous processing on child nodes whose update is owned by the
host, or make their callbacks delegate to one narrow registered method. Assign
and document process priorities where Godot-owned callbacks must run. Tests
must detect double updates, unordered registration, paused-frame leakage, and
movement from `_Process`.

## 6. Source-to-target responsibility map

| Browser source | Responsibility | Godot/C# target |
|---|---|---|
| `src/main.js` | Composition and startup wiring | `Main.tscn`, `CompositionRoot.cs`, explicit factories |
| `src/core/GameState.js` | State/policy tables | Domain enums and immutable policy dictionaries |
| `src/core/GameManager.js` | Session state authority | `GameStateMachine` pure service |
| `src/core/GameTransition.js` | Guards/errors/context | Domain transition contracts |
| `src/core/TransitionCoordinator.js` | Transactional handoff | Pure coordinator plus `GodotTransitionRuntime` adapter |
| `src/core/PauseManager.js` | Nested pause holds | Domain pause owner plus `SceneTree.Paused` adapter policy |
| `src/core/SimulationScheduler.js` | Clock domains/order | Domain scheduler driven by `_PhysicsProcess` and `_Process` adapters |
| `src/app/MetroPulseSimulationSchedule.js` | Production task registration | `SimulationSchedule.cs` with explicit task IDs/order |
| `src/app/RuntimeConfig.js` | test/feature runtime config and seeded RNG | CLI/config parser and named `IRandomStream` registry |
| `src/boot/*` | capability/settings/save/content boot stages | `BootDirector`, boot view model, platform probes |
| `src/data/*` | stable content registry and validation | typed DTOs, validators, immutable content registry |
| `src/config/*` | MVP allow-lists and feature flags | immutable feature/scope configuration |
| `src/save/*` | schema, migration, snapshots, IndexedDB | JSON schema/migrations, file repository, runtime restore adapters |
| `src/settings/*` | settings/bindings authority | settings repository, input-map adapter, accessibility/render/audio adapters |
| `src/world/CityBuilder.js` | procedural terrain/city/roads/park/rocket | segmented `WorldGenerator` services and world scenes |
| `src/world/BuildingFactory.js` | authored procedural buildings | cached mesh/material generators or reviewed scene replacements |
| `src/world/BuildingCatalog.js` | buildable catalog | canonical JSON + immutable DTO registry |
| `src/world/CityEditorSystem.js` | tools, placement, editing, transactions | `CityEditorController`, placement domain, preview nodes, edit transaction |
| `src/world/PlacementIntelligence.js` | placement rules/forecast | pure domain service |
| bridge/countryside/airfield modules | geometry and traversal contracts | dedicated generators/scenes with collider/nav metadata |
| `src/physics/PhysicsWorld.js` | collision layers, surfaces, vehicle physics registration | Godot/Jolt layers, bodies, shape builders, physics facade |
| `src/entities/Vehicle*.js` | visuals, profiles, player vehicle | DTO profiles, `VehicleView`, custom vehicle controller |
| `src/entities/Pedestrian*.js` | visuals and agent records | archetype DTOs, `PedestrianActor`, visual factory |
| `src/entities/Aircraft*.js` | optional aircraft/flight model | pure flight model plus `AircraftActor`, gated off initially |
| `src/systems/TrafficSystem.js` | road graph, spawn, AI, collisions, control | split graph, spawn director, AI controller, impact/pursuit adapters |
| traffic helper modules | pure navigation/control models | direct pure C# ports with golden tests |
| `src/systems/PedestrianSystem.js` | crowd AI, player control, crime/combat/hijack | split crowd, controller, crime, combat, and interaction services |
| `src/systems/EconomySystem.js` | authoritative city economy | pure `EconomySystem` C# port |
| economy/service/incident modules | balance and consequences | pure domain ports plus world presentation adapters |
| mission modules | conditions, outcomes, lifecycle | pure C# ports retaining transaction IDs and phase rules |
| `src/systems/MissionSystem.js` | Three/DOM mission adapter | `MissionWorldAdapter`, mission HUD view model, marker nodes |
| alert/interaction modules | structured alerts and priority | pure C# ports; UI adapters only render snapshots |
| `src/world/SceneManager.js`, camera modules | rendering, presets, follow, clearance | `WorldEnvironment`, `CameraRig`, `CameraClearanceService` |
| `src/world/Environment.js`, time/weather modules | sky, lighting, weather, time | `WorldEnvironment`, lights, particles, pure time/weather models |
| `src/systems/AudioSystem.js` | procedural ambience and SFX | bus layout, audio service, generated/cached streams and 3D players |
| `src/effects/*` | explosions/comets | pooled Godot effect scenes; Mayhem-gated |
| `src/ui/*`, `index.html`, `src/index.css` | all interface and accessibility presentation | Control scenes, Theme resources, view models, focus/accessibility metadata |
| `src/debug/*`, `src/testing/*` | diagnostics and deterministic bridge | diagnostics service, debug overlay, CLI/test hooks |
| `test/*.test.js` | behavioral specifications | pure C# parity tests and engine integration scenarios |
| `test/browser/smoke.spec.js` | end-to-end reference acceptance | Godot headless/interactive smoke and visual acceptance |

## 7. Engineering rules for every phase

1. Port behavior from tests and contracts, not from comments alone.
2. Port pure logic before binding it to nodes.
3. Keep domain data immutable at publication boundaries.
4. Use one stable ID vocabulary everywhere; validate unknown IDs at boot.
5. Treat each node, signal subscription, physics body, timer, audio player,
   pooled effect, and spawned agent as an owned resource with a disposal path.
6. Never call `QueueFree()` and assume cleanup is complete in the same frame;
   design tests around Godot's deferred deletion semantics.
7. Never mutate physics-authoritative transforms from `_Process`.
8. Call `ResetPhysicsInterpolation()` after spawn, restore, teleport, reset,
   ejection, or transition placement.
9. Avoid per-frame allocation in agent loops. Cache `StringName`, meshes,
   materials, shapes, query objects, and reusable collections.
10. Keep content coordinates and balance values out of scene scripts.
11. Every compatibility adapter needs a named owner, a removal condition, and a
    test proving when it can be removed.
12. Any deliberate parity change requires an ADR with old behavior, new
    behavior, motivation, affected saves/content/tests, and rollback plan.

## 8. Phase 0 — Freeze the reference and create parity evidence

### Objective

Turn the current browser build into a repeatable behavioral oracle before the
port begins changing implementation assumptions.

### Read first

- `README.md`
- `docs/MVP_SCOPE.md`
- `docs/REQUIREMENT_TRACEABILITY.md`
- `docs/GAME_STATE_MACHINE.md`
- `docs/SIMULATION_SCHEDULER.md`
- `docs/VERSIONED_SAVE_SERVICE.md`
- `docs/MISSION_LIFECYCLE.md`
- `docs/TESTING_AND_DIAGNOSTICS.md`
- `src/app/RuntimeConfig.js`
- `test/browser/smoke.spec.js`

### Work

0.1 Record the exact source commit, Node/npm versions, browser/driver versions,
target OS profiles, viewport, renderer, and feature flags.

0.2 Run `npm test`, `npm run build`, and the browser suite on a clean profile.
Archive machine-readable reports rather than copying console summaries.

0.3 Add a baseline-capture tool that emits plain JSON fixtures for:

- game-state policies and every legal/illegal transition;
- scheduler clock accumulation and task order;
- economy initial state, 15/30/60/120-minute scenarios, spending decisions,
  service shortages, and land-value queries;
- content registry records and validation failures;
- mission availability, lifecycle paths, checkpoints, retries, and outcome
  receipts;
- alert, settings, bindings, save, and migration examples;
- road graph nodes/edges, bridge bounds, terrain samples, camera presets, and
  selected vehicle profiles;
- seeded pedestrian/vehicle descriptors and representative navigation steps.

0.4 Capture reference screenshots and short telemetry traces for:

- clean boot menu and New Game;
- Management at dawn/day/dusk/night in all four weather modes;
- Builder placement preview, valid placement, move, rotate, and demolish;
- on-foot movement, collision, jump, bat, hijack, and exit;
- each major vehicle archetype on flat road, turn, bridge, rain, collision, and
  reset;
- mission offer, active HUD, race checkpoint, sabotage hold, success, failure,
  retry, and result history;
- pause/settings, minimap, alerts, Heat/police, and recovery save.

0.5 Export representative valid, recovery, corrupt, schema-0, schema-1, future,
mid-mission, result, and controlled-entity saves. Never put personal browser
data in fixtures.

0.6 Create `docs/GODOT_PORT_PARITY_MATRIX.md` from the requirement IDs in
`REQUIREMENT_TRACEABILITY.md`. Add columns for browser evidence, Godot owner,
port phase, automated test, manual test, status, deviation ADR, and signoff.

0.7 Record the platform decision from section 2 and the initial target hardware
matrix.

### Exit gate

- Browser unit, build, and smoke suites pass.
- Baseline fixtures are deterministic and checked in.
- Screenshots/traces identify the source commit and scenario configuration.
- Every MVP requirement has a planned Godot owner and phase.
- Platform and save-migration policies are signed off.

### Handoff

List fixture paths, capture commands, expected hashes/tolerances, known flaky
scenarios, excluded post-MVP behavior, and the exact reference revision.

## 9. Phase 1 — Establish the Godot/.NET foundation

### Objective

Create a reproducible Godot 4.6 C# workspace, CI entry points, coding rules,
test harness, and empty runtime shell without porting gameplay prematurely.

### Work

1.1 Install and pin the Godot 4.6 .NET editor and matching export templates.
Pin the .NET SDK version in `global.json` after generating the Godot project.
Record editor and template hashes in the build documentation.

1.2 Create the three-project layout in section 5. `MetroPulse.Domain` must build
without Godot. Enable nullable reference types, warnings as errors for new C#
code, deterministic builds, and a repository formatting policy.

1.3 Create `Main.tscn`, a boot-only scene, a disposable session shell, an empty
3D viewport, a basic camera, and a diagnostics overlay. Do not generate the city
yet.

1.4 Pin Jolt Physics as the project physics backend. Godot 4.6 creates new
projects with Jolt by default, but the setting must be explicit so engine
upgrades cannot silently change it.

1.5 Start with 120 physics ticks per second and physics interpolation enabled to
match the existing fixed integration cadence. Add a low-tick interpolation
debug profile. Do not claim final performance until Phase 11.

1.6 Define collision layers/masks for at least surface, static obstacle,
traffic, player, pedestrian, interaction, mission trigger, effect, and camera
query. Document every bit and its allowed pairs.

1.7 Implement logging categories, structured diagnostic snapshots, build
metadata, fatal-error presentation, and a deterministic test configuration
accepted only in debug/test builds.

1.8 Add commands for:

```text
dotnet build
dotnet test
Godot headless import/compile validation
Godot headless integration tests
debug desktop launch
release export for each desktop target
```

1.9 Add a CI pipeline that restores dependencies, compiles C#, imports the
Godot project headlessly, runs pure tests, runs integration tests, and exports
at least one desktop smoke build. Store artifacts and test reports.

1.10 Decide and document the integration-test runner. If an addon is chosen,
pin its exact version/license and prove C# and headless support. Otherwise use a
small committed `SceneTree` test harness with explicit exit codes.

### Exit gate

- A clean clone builds without manual editor clicks after documented setup.
- `dotnet test` runs a sample pure test.
- headless Godot loads `Main.tscn`, runs a sample engine test, and exits 0.
- debug and release desktop exports boot to the shell.
- no gameplay authority is implemented as a global singleton by convenience.

### Handoff

Record tool versions, commands, environment variables, project settings,
collision table, CI artifact locations, test-runner conventions, and known
platform setup gaps.

## 10. Phase 2 — Port content, validation, and the pure domain kernel

### Objective

Port engine-neutral behavior into C# with fixture parity before any large world
or UI implementation depends on it.

### Read first

- all files under `src/core`, `src/data`, `src/config`, `src/alerts`
- pure helper modules under `src/missions`, `src/systems`, and `src/world`
- matching `test/*.test.js` files
- contract docs named in Phase 0

### Work

2.1 Define C# naming rules while preserving serialized names. Use PascalCase in
C# and explicit camelCase JSON names. Enum serialization must preserve the
existing uppercase/string tokens exactly.

2.2 Port stable data primitives, validation helpers, content types, world
bounds, districts, zones, factions, progression, vehicle IDs, MVP allow-lists,
and feature flags.

2.3 Load `missions.json` unchanged through typed DTOs. Validate every stable ID,
enum, coordinate, dialogue link, prerequisite, weather policy, retry policy,
and acyclic graph. Fail boot with the exact content path and remedy.

2.4 Extract `BuildingCatalog.js`, weather definitions, mission weather policies,
economy balance, vehicle profiles, camera presets, countryside plan, bridge
layout, street furniture layout, and archetype definitions into canonical
data. The extraction tool must compare record count, IDs, and every scalar to
the JavaScript source fixture.

2.5 Port in this dependency order:

1. immutable DTOs, validation, and result/error types;
2. game-state policies and transition evaluation;
3. pause holds and transition coordinator interfaces;
4. scheduler clock math and ordered task registry;
5. economy balance and economy system;
6. alert service and interaction priority service;
7. mission outcome transactions and condition queries;
8. mission lifecycle, availability, weather, checkpoints, and retry;
9. settings/binding validation;
10. pure traffic, pedestrian, camera, weather, time, placement, and flight
    model helpers.

2.6 Introduce named deterministic random streams: `WorldGeneration`,
`TrafficSpawn`, `TrafficBehavior`, `PedestrianSpawn`, `PedestrianBehavior`,
`Weather`, `Mission`, and `Cosmetic`. Persist only streams whose future outcome
is gameplay-relevant. Never use `Random.Shared` in domain code.

2.7 Port tests by behavioral family, comparing C# output to the Phase 0 JSON
fixtures with documented numeric tolerance. Test invalid inputs and atomic
failure, not only happy paths.

### Exit gate

- Every pure browser test family has a C# owner and status in the parity matrix.
- Content counts and scalar values match the reference fixtures.
- The complete production registry validates in C#.
- State, scheduler, economy, alert, interaction, outcome, lifecycle, settings,
  and migration logic pass pure tests without launching Godot.
- No domain assembly references Godot types.

### Handoff

Publish namespace/API docs, canonical content paths, test fixture mappings,
numeric tolerances, known behavior deviations, and a list of JS modules not yet
ported because they require engine adapters.

## 11. Phase 3 — Boot, settings, input, diagnostics, and persistence shell

### Objective

Make a safe, testable Godot application shell that can validate content,
present boot actions, manage settings/bindings, create/rotate saves, and enter
an empty Management session.

### Work

3.1 Recreate the boot stages: capability checks, settings bootstrap, content
validation, save discovery, action selection, world/session construction, save
application, final readiness, interactive release.

3.2 Replace browser capability probes with desktop checks for writable
`user://`, compatible save/content versions, graphics backend, required input
devices, and minimum project resource availability. Provide actionable errors;
never enter a partially constructed world.

3.3 Rebuild settings and bindings using Godot InputMap as the runtime adapter,
but keep the validated domain document as authority. Preserve contexts:
Management, Builder, Vehicle, Aircraft, Pedestrian, Dialogue, and Pause.

3.4 Preserve live keyboard/controller device switching, dead zones, edge
detection, focus-loss clearing, held-device quarantine, contextual prompts, and
binding conflict validation. Browser-reserved keys may become desktop-reserved
keys only through a documented compatibility table.

3.5 Implement a file repository under `user://`. Use explicit current,
recovery, and temporary paths. Write a fully validated temporary document,
flush/close it, rotate current to recovery, and atomically promote the new
document where the OS/API permits. Fault-inject every stage.

3.6 Preserve the exact JSON envelope, sequential migrations, future-version
rejection, whole-document validation before mutation, debounce/coalesced
reasons, stable checkpoints, and save status events. The official Godot
[data-path documentation](https://docs.godotengine.org/en/4.6/tutorials/io/data_paths.html)
requires persistent files under `user://`.

3.7 Split restore into static domain restore and runtime entity/world restore.
At this phase, validate and retain deferred descriptors without pretending to
restore absent world nodes.

3.8 Build the browser save bridge:

1. add an explicit browser-side “Export City Save” action/tool that reads only
   the selected validated slot and downloads JSON;
2. add a Godot import picker/CLI path;
3. validate and copy the original to an import-backup location;
4. migrate through the same schema code;
5. show a preview of city, save time, mission, and controlled entity;
6. import to current only after confirmation;
7. prove failed imports do not alter current or recovery.

3.9 Recreate diagnostics: game state, clock policy, transition, controlled
entity descriptor, mission, save state, counts, FPS/frame time, renderer stats,
feature flags, seed, and scenario metadata. Test hooks must be unavailable in
release builds.

### Exit gate

- New Game, Continue, Recover, corrupt save, future save, and retry checks have
  headless integration coverage.
- Settings and bindings survive restart and apply through adapters.
- Current/recovery rotation survives injected interruption.
- A representative exported browser save validates in Godot and retains all
  domains, even though world/entity application remains deferred.
- Boot releases input only after the empty session readiness gate.

### Handoff

Document save paths, import/export workflow, atomicity guarantees by OS, input
action names, settings adapter ownership, boot-stage events, deferred restore
descriptors, and any schema changes.

## 12. Phase 4 — Rebuild the procedural world and rendering baseline

### Objective

Reproduce the navigable MVP world, visual identity, surface queries, collision
metadata, and camera-safe geometry before adding full agents.

### Work

4.1 Implement terrain and water queries first as pure/adapter services. Port
`getHillHeight`, water classification, drivable bounds, bridge deck height, and
world bounds. Compare a dense grid of samples with reference fixtures.

4.2 Build the MVP world in independent chunks: West Core ground/road grid,
river/retaining walls, primary suspension bridge, Central Park, building plots,
street furniture, cafes, and initial skyline. Keep countryside, airfield,
rocket, and East district gameplay behind their existing flags. Retained scenic
geometry and safety colliders may remain where the source scope contract keeps
them; a disabled expansion must never turn an existing safe road or surface
into a void.

4.3 Prefer reusable scenes for semantically distinct structures and code
generators for repeated parametric geometry. Cache primitive meshes,
`StandardMaterial3D` resources, and shapes. Never construct duplicate materials
for every window, lamp, pedestrian limb, or vehicle.

4.4 Recreate instanced windows, crosswalks, trees, and repeated props with
spatially partitioned `MultiMeshInstance3D` groups. Godot chooses one LOD for a
whole MultiMesh, so split instances into city cells; the official
[mesh LOD guidance](https://docs.godotengine.org/en/4.6/tutorials/3d/mesh_lod.html)
also notes that individual instances are not independently culled.

4.5 Build collision shapes and metadata from the same source definitions as
visual geometry. Every building, lamp, cafe table/chair, bridge barrier, deck,
terrain surface, and user-editable object must have one owner and stable ID.

4.6 Recreate the suspension cable and hanger geometry with the existing
symmetry/intersection tests. Validate continuous physical deck surfaces and
guardrails before vehicle work begins.

4.7 Rebuild sky, sun/moon orbit, environment lighting, fog/mist/rain/storm
presentation, emissive windows/lights, tone mapping, shadows, glow/bloom, and
quality profiles. Preserve the existing accessibility switches for bloom,
flash, and camera shake.

4.8 Rebuild billboards using `SubViewport`/`ViewportTexture` or cached generated
textures. Update text only when content changes, not every frame.

4.9 Implement camera surface and clearance queries against terrain, water, and
registered obstacle shapes. Port Management, ground, street, bird's-eye, park,
downtown, bridge, and free-orbit presets. Optional presets remain feature-gated.

4.10 Add golden landmark tests: plot centers, roads, bridge deck/barriers,
mission pickup coordinates, Central Park, camera presets, terrain samples, and
district bounds. Add reference/Godot screenshot pairs at fixed seed/time/weather.

### Exit gate

- The entire MVP world is traversable by a debug capsule and camera.
- Terrain/water/bridge/collider queries match fixtures within tolerance.
- No visible collider mismatch exists at sampled buildings, furniture, roads,
  bridge, or slopes.
- Fixed screenshots are recognizable and signed off for geometry, palette,
  lighting, and readability; pixel identity is not required.
- World construction/destruction returns owned node/resource counts to baseline.

### Handoff

Provide the world scene tree, generator APIs, coordinate conversion rules,
collision metadata schema, mesh/material caches, landmark fixture report,
visual deviations, and performance counts by world chunk.

## 13. Phase 5 — Camera, player control, pedestrians, and vehicle physics slice

### Objective

Deliver the first end-to-end controllable slice: Management → on foot → vehicle
→ Management, with safe transactional handoff and acceptable arcade physics.

### Work

5.1 Connect the pure game-state machine, scheduler, pause manager, and transition
coordinator to the Godot session. Implement `GodotTransitionRuntime` phases in
the same order as the browser and compensate in reverse on failure.

5.2 Implement the camera rig: orbit/pan, street look pivot, pedestrian chase,
vehicle chase, independent yaw/pitch, clearance correction, shake as a
render-only offset, follow release, and preset transitions.

5.3 Build a `CharacterBody3D` pedestrian controller with walk, sprint, jump,
slope/step behavior, sliding collision, collision layers, water/out-of-bounds
recovery, and animations. Godot's
[CharacterBody3D reference](https://docs.godotengine.org/en/stable/classes/class_characterbody3d.html)
requires velocity in meters/second and `MoveAndSlide()` during physics ticks;
do not multiply velocity by delta before assigning it.

5.4 Implement a representative sedan vehicle physics spike with two branches:

- built-in `VehicleBody3D`/`VehicleWheel3D` tuned to reference profiles;
- custom `RigidBody3D` chassis with raycast suspension, tire forces, steering,
  braking, downforce, weather grip, and recovery.

Evaluate acceleration, braking-to-reverse, turning radius, lateral stability,
bridge/curb traversal, slopes, collisions, frame cost, control transfer,
determinism, and support for bus/truck/motorbike profiles. Select one in an ADR.
The provisional recommendation is the custom rigid-body implementation because
the source has profile-specific raycast suspension and Godot documents built-in
vehicle limitations.

5.5 Port the complete vehicle profile contract and implement sedan, sports,
bus, truck, emergency, and motorbike test fixtures. Separate physics chassis,
visual body, wheels, lights, driver/rider, audio emitters, and gameplay state.

5.6 Implement possession, timed hijack approach, camera-origin control, vehicle
exit, pedestrian suspend/restore, pose-preserving AI handoff, airborne/unsafe
exit rejection, and exactly-once authority changes.

5.7 Implement collision/impact contracts needed by the slice: vehicle overlap,
pedestrian knockdown, motorbike rider ejection, static obstacles, weather grip,
supported-pose recovery, stuck recovery, and reset.

5.8 Add a minimal interaction publisher for pedestrian possession, vehicle
entry/hijack, and vehicle exit. Use the ported priority service; do not hard-code
`E` behavior inside actors.

### Exit gate

- A 50-cycle automated soak traverses Management → on foot → sedan → on foot →
  Management without ownership, body, node, subscription, or camera growth.
- Transition fault injection proves compensation for every phase.
- The selected vehicle implementation passes signed-off objective telemetry and
  subjective handling tests for the six major profiles.
- Rain reduces grip and clear weather restores it.
- Player recovery, bridge traversal, vehicle exit, hijack timing, and motorbike
  ejection have integration tests.

### Handoff

Include the vehicle ADR and telemetry, control/camera state diagrams, input
actions, entity scene contracts, spawn/teleport checklist, collision masks,
known tuning gaps, and soak count report.

## 14. Phase 6 — Living traffic, pedestrians, Heat, and enforcement

### Objective

Recreate the living city simulation around the player without compromising the
authoritative control slice.

### Work

6.1 Port the one authoritative road graph, including authored nodes/edges,
bridge routes, user-road registration interfaces, projection, corridor
enforcement, turn-aware speed limits, overshoot-safe advancement, obstacle
detection, and bridge priority metadata.

6.2 Implement traffic spawn/despawn and the 48-moving-vehicle floor. Spawned
agents use stable runtime IDs and seeded profiles. Parked vehicles are separate
and excluded from moving congestion.

6.3 Split traffic behavior into route following, intersection rules, obstacle
avoidance, pedestrian yielding, disposition/impatience, stuck recovery,
emergency behavior, player-control adapter, damage/fire state, and visual/audio
presentation.

6.4 Port traffic controls: green/yellow/all-red cycle, four-way stop arrival
order, 80% rule-following driver assignment, reckless behavior, and physical
post colliders.

6.5 Implement pedestrian graph/spawning and the 60-citizen floor. Port all
archetypes and special behaviors: residents, professionals, joggers, tourists,
cafe readers, and criminals. Keep visual construction separate from behavior.

6.6 Implement traffic/pedestrian interactions: speed-aware braking, patient and
impatient waiting, one-shot horns, knockdown, hit-and-run offender state,
nearby-police selection, road-aware pursuit, and cleanup back to patrol.

6.7 Port crime reporting, wanted state, police dispatch, pursuit across player
vehicle switches, escape timer, arrest, one macro incident, and safe recovery.

6.8 Rebuild `SpatialHashGrid` or an equivalent deterministic grid for local
queries. Do not use full-population scans in routine per-agent updates.

6.9 Implement simulation LOD separately from render LOD. Near agents receive
full collision/behavior; medium agents reduce animation/query cadence; far
agents use proxies and coarse updates; dormant agents retain aggregate identity
only where design requires it.

### Exit gate

- Traffic remains in lane corridors through turns and the bridge.
- Population floors survive culling, impacts, player possession, ejection, and
  recovery.
- Pedestrian yielding distribution, stop controls, pursuits, and congestion
  metrics match reference scenarios.
- At target counts, no routine update performs an unbounded all-agent scan.
- A 30-minute headless living-city soak has stable counts and no unhandled
  errors.

### Handoff

Publish road graph schema, agent lifecycle diagrams, behavior cadence/LOD table,
random stream use, population invariants, traffic rule fixtures, pursuit cleanup
rules, profiler captures, and remaining visual/audio placeholders.

## 15. Phase 7 — Economy, builder, services, incidents, and world editing

### Objective

Restore the complete Management/Builder loop and connect player decisions to
the already functioning world and street simulation.

### Work

7.1 Bind the pure `EconomySystem` to a view model and city tick. Register the
authored skyline through one building adapter and prove that initial treasury,
population, happiness, land value, service state, income, and upkeep match the
reference.

7.2 Port the building catalog and construction vocabulary exactly. Implement
catalog disclosure/progression locks, zoning, cost/upkeep/income preview,
capacity/demand, road access, services, community impact, risk, and fiscal
recovery restrictions.

7.3 Recreate editor tools: aim/reticle, grid snap, catalog selection, place,
zone, select, move, rotate, demolish, cancel, and controller navigation.

7.4 Use the existing transaction model for every world edit. Participants must
include visual node, collider, road graph, economy record, occupancy, zoning,
service metadata, and persistence record. Roll back in reverse order on any
failure.

7.5 Rebuild terrain-conforming previews and precise placement blockers for
roads, water, core landmarks, occupied plots, scenery, services, zoning, funds,
and district locks. Display the highest-priority blocker and remedy.

7.6 Connect placed roads and bridges to traffic routing. An intact custom bridge
must publish a deck and remove river hazard inside its footprint; destruction
must unregister the route/deck and restore the hazard without duplication.

7.7 Port aggregate traffic productivity, connected-road capacity, freight
priority tradeoff, bridge metrics, congestion feedback, alerts, visible street
directives, and mission modifiers.

7.8 Port CityServiceModel and IncidentResponseService: energy/safety, local
facility reach, spatial outage falloff, damage, cleanup-before-repair, funding,
street work interactions, markers, alerts, resolution, and persistence.

7.9 Port fiscal balance/recovery and deterministic economy scenarios. Preserve
pre-spend reserve rules, bounded fines, assistance idempotency, recovery exit,
and explanation strings.

### Exit gate

- A clean session completes zone → preview → place → earn/upkeep tick → move →
  rotate → demolish with consistent visuals, collisions, roads, economy, and
  save state.
- All world-edit failure points compensate completely.
- Browser and C# economy scenarios match within declared tolerance.
- Custom roads affect live routing; custom bridges are physically safe and
  hazard-correct.
- Incident funding, cleanup, repair, and resolution work across Management and
  Street and survive save/reload.

### Handoff

Include catalog/content hashes, editor command API, transaction participant
list, placement blocker order, building persistence schema, road/service
integration points, economy parity report, and known balancing deviations.

## 16. Phase 8 — Missions, conditions, consequences, interaction, and results

### Objective

Restore all six mission templates and the complete cross-mode mission contract
without duplicating rewards or persistent consequences.

### Work

8.1 Bind the pure mission lifecycle to world markers, vehicle eligibility,
dialogue UI, route guidance, timers, checkpoints, and result presentation.

8.2 Implement pickup markers and eligibility using stable mission IDs, vehicle
type, proximity, prerequisites, follow-up state, city conditions, weather, and
feature scope. Disabled missions must not leave markers or interactions.

8.3 Implement the canonical interaction providers and priority order for
mission offers/actions, service work, aircraft boarding, vehicle entry/exit,
pedestrian talk/control, and doors/future providers. Publish one primary action
snapshot per frame and explain ineligible winners.

8.4 Rebuild dialogue from the current JSON tree, including stable node IDs,
choices, actions, speaker metadata, history, pause ownership, keyboard/controller
focus, close/decline behavior, and deterministic portraits or reviewed assets.

8.5 Implement mission types:

- Taxi/Courier/Delivery: offer, accepted vehicle binding, destination,
  congestion/satisfaction where applicable, timer, payout.
- Race: ordered checkpoints, rival progress pressure, correct marker updates,
  last-checkpoint retry payload, loss state.
- Sabotage: arrival, stopped-vehicle requirement, explicit interact action,
  uninterrupted hold, target-arrival checkpoint.
- Survival: Mayhem-gated activation, timer-as-success, no false destination
  marker, bounded retry.

8.6 Preserve lifecycle phases and save-blocking commit phases. A result remains
mission-owned until the matching outcome receipt commits and the player
acknowledges recovery.

8.7 Apply all outcome commands atomically with stable transaction IDs. Replaying
identical content returns the original receipt; conflicting reuse fails. A late
invalid command or unaffordable debit must mutate nothing.

8.8 Rebuild result/debrief and history from receipt-time explanations. Separate
reward, city, faction, progression, failure cause, retry availability, and next
actions. Do not reconstruct past causes from current city state.

8.9 Complete save/restore at lifecycle checkpoints and RESULT. Reacquire the
saved controlled entity before restoring an active mission so the mission does
not block its own load transition.

### Exit gate

- Every MVP mission starts only under valid conditions and completes/fails by
  its authored template.
- Success, failure, abandonment, arrest, vehicle loss, retry exhaustion, and
  cleanup failure have tests.
- Ten mission restarts and save/reload at every safe phase produce no duplicate
  Capital, outcomes, damage, reputation, or unlocks.
- Mission-critical transitions, pause, and result ownership match the state
  contract.
- All ten MVP missions have a recorded playthrough, with the Survival mission
  exercised in an authorized temporary-Mayhem test build; the five non-MVP
  records validate but remain outside normal scope.

### Handoff

Provide mission/content validation report, lifecycle/state diagram, world marker
ownership, interaction priority table, outcome command coverage, transaction
fixtures, save/retry matrix, and per-mission playthrough status.

## 17. Phase 9 — Complete UI, accessibility, minimap, audio, and effects

### Objective

Replace temporary/debug presentation with the complete player-facing Godot
experience and preserve the browser version's usability contracts.

### Work

9.1 Build a shared Godot `Theme` reproducing the dark glass/neon visual
language. Use containers and anchors rather than absolute viewport assumptions.
Create desktop layout breakpoints and test common aspect ratios and UI scales.

9.2 Rebuild, as independent scenes/view models:

- boot/error/action screen;
- top city stats and current priority alert;
- collapsible City Tools and accordion sections;
- economy recovery, services, traffic/productivity, zoning, construction,
  atmosphere, overlay, and simulation controls;
- inspector and contextual actions;
- adaptive control ribbon and active-device badge;
- time/weather controls;
- speedometer and optional flight instruments;
- mission HUD, dialogue, result/history, pause/settings, arrest, news, toasts;
- builder catalog/preview/forecast UI.

9.3 Rebuild the minimap using a dedicated orthographic projection or a
data-driven custom `Control` draw path. Preserve roads, river, agents, player,
congestion, pickups, route/checkpoint, work order, and objective markers.
Exclude parked vehicles from heat and irrelevant destinations from Survival.

9.4 Configure explicit focus neighbors, logical focus order, keyboard/controller
navigation, focus restoration, modal containment, visible focus, accessible
names/descriptions, and live announcements. Godot 4.6 uses AccessKit for screen
reader integration; follow the official
[accessibility guidance](https://docs.godotengine.org/en/4.6/tutorials/ui/creating_applications.html)
and test NVDA, VoiceOver, and Orca on supported platforms.

9.5 Port all settings effects: independent sensitivities, audio categories,
subtitles/captions, text scale, contrast, color-safe patterns, reduced motion,
shake, flash, bloom, hold/toggle behavior, driving assists, difficulty, and
timer leniency.

9.6 Rebuild audio buses: Master, Music, Effects, Ambience, Dialogue, Vehicle,
Emergency, and UI. Godot's
[audio bus documentation](https://docs.godotengine.org/en/4.6/tutorials/audio/audio_buses.html)
uses decibels, so convert saved linear volume explicitly and test mute/restore.

9.7 Port procedural audio deliberately. Generate and cache noise/impulse/sample
buffers off the hot path, use `AudioStreamPlayer3D` for spatial emitters, cap
polyphony, preserve siren/horn/engine/propeller priority, provide caption events,
and avoid constructing oscillators/streams per frame.

9.8 Port explosions, fire, rubble, camera shake, rain, lightning, and Mayhem
comets using pooled scenes/particles. Preserve cleanup, collision unregister/
restore, road restoration, economy incident resolution, reduced-flash, and
reduced-shake behavior.

### Exit gate

- Every player-facing control works with keyboard/mouse and controller.
- Modal focus and pause behavior pass automated and manual accessibility tests.
- UI remains usable at supported aspect ratios and 0.8–1.5 text scale.
- Critical audio has a text alternative and all volume categories apply live.
- Effects return to pool/baseline counts and obey accessibility settings.
- Visual UX signoff covers all primary modes, weather/time states, and results.

### Handoff

Publish scene/view-model map, theme tokens, focus graph, accessibility test
results, responsive matrix, audio bus/layout and linear↔dB rule, effect pool
budgets, caption event list, and unresolved UX differences.

## 18. Phase 10 — Gated and deferred feature parity

### Objective

Port source-present but default-off features only after the core MVP loop is
stable. Each feature remains independently gated. Temporary Mayhem is an
incomplete MVP target and must either pass its release requirements or receive
a formal scope amendment; the other packages are post-MVP and may be deferred
without weakening the core architecture.

### Work packages

- **Aircraft:** flight model, airfield, takeoff/taxi/stall/landing/crash,
  footprint surface assessment, pilot handoff, controls, chase camera, HUD,
  propeller audio, save/restore, population accounting.
- **Temporary Mayhem:** comet targeting, destruction/rubble, chain reactions,
  sirens/panic/news, mission survival integration, collider/road/economy cleanup,
  restoration, accessibility reductions.
- **Rocket launch:** launch facility, countdown, vapor/flame, launch motion,
  camera and UI, reset, feature visibility.
- **East-side development:** district world/content, unlock, road/bridge access,
  missions and economy integration.
- **Countryside expansion:** terrain, suburb, roads, bridges, reservations,
  placement occupancy, traffic/pedestrian paths, landing surfaces.
- **Persistent Mayhem/variants:** do not implement until a separate persistence
  and safety design is approved.

### Exit gate per feature

- Feature off produces no nodes, tasks, input actions, UI, save requirements,
  or test flakiness beyond declared retained scenery/collision safety.
- Feature on passes its complete source tests and new Godot integration tests.
- Enabling then disabling/new-game cleanup returns all counts and state to
  baseline.
- Save compatibility and content references remain valid when the feature is
  unavailable.

## 19. Phase 11 — Optimization, compatibility, migration, and release

### Objective

Turn a functionally complete port into a measurable release candidate without
trading away simulation correctness or accessibility.

### Work

11.1 Establish recommended and minimum hardware profiles for Windows, macOS,
and Linux. Measure CPU/GPU frame time, memory, load, save hitch, node count,
objects, draw calls, primitives, physics time, navigation time, audio voices,
and garbage collection.

11.2 Profile first; optimize second. Priorities are likely agent simulation,
procedural node count, materials/draw calls, shadows/glow, physics ticks,
minimap redraw, UI layout, and allocation-heavy C#↔Godot calls.

11.3 Implement high/medium/low quality profiles without removing targets,
hazards, traffic meaning, or input feedback. Use cell-based MultiMeshes,
visibility ranges, LOD meshes/proxies, shadow tiers, effect budgets, update
cadence, and capped audio voices.

11.4 Revisit 120 Hz physics only with telemetry. Compare 120 vs 60/90 Hz on
input latency, vehicle behavior, bridge/terrain contacts, impacts, CPU time, and
interpolation. Record the selected value in an ADR and update fixtures.

11.5 Run leak/resource soaks:

- 50 cross-mode cycles;
- 10 mission restarts for every template;
- 100 world-edit transactions with injected rollback;
- repeated New Game/session disposal;
- repeated save/recover/import;
- 30-minute headless living simulation;
- two-hour representative interactive soak.

11.6 Complete the browser-save migration UX, documentation, backup, and failure
recovery. Test imported saves on all desktop platforms.

11.7 Build signed/reproducible export presets. Godot stores normal export
settings in `export_presets.cfg`; never commit export credentials. Automate
release exports using the documented
[command-line export flow](https://docs.godotengine.org/en/4.6/tutorials/export/exporting_projects.html).

11.8 Perform separate art, animation, audio, writing, balance, UX,
accessibility, platform compatibility, save migration, privacy, and licensing
signoffs.

11.9 Freeze the port release candidate. Keep the browser reference and its
fixtures until at least one released Godot version has proven save stability.

### Final exit gate

- All MVP parity-matrix rows are Pass or have an approved deviation ADR.
- All pure, headless integration, scenario, save/migration, visual, input, and
  platform suites pass from a clean clone.
- Target performance is ≥60 FPS recommended and ≥30 FPS minimum with routine
  frame time ≤33 ms on the declared profiles.
- Initial interactive load is below the accepted budget or gives truthful
  staged progress.
- No open P0/P1 defects, misleading UI states, duplicate transaction paths, or
  uncontrolled resource growth remain.
- Browser save import is either released and verified or explicitly excluded
  with player-facing migration guidance.
- Release artifacts, symbols, licenses, checksums, and rollback instructions
  are archived.

## 20. Cross-cutting verification strategy

### 20.1 Test pyramid

| Layer | Runs | Purpose |
|---|---|---|
| Pure domain unit | `dotnet test` | Exact rules, validation, transactions, migrations, scheduler math, deterministic models |
| Golden parity | `dotnet test` | Compare C# outputs with Phase 0 browser fixtures |
| Headless engine integration | Godot headless | Scene wiring, nodes, signals, physics, input actions, save repository, lifecycle cleanup |
| Scenario/soak | headless and interactive | Cross-mode, mission, agent, rollback, save/reload, leak and timing behavior |
| Visual regression | fixed camera/seed/time/weather | Geometry, lighting, UI layout, markers, effects; tolerance-based review |
| Manual playtest | target hardware/input/accessibility | Feel, readability, camera, driving, mission comprehension, screen readers |
| Release matrix | exported binaries | OS, GPU/backend, controller, file permissions, import/export, upgrade |

### 20.2 Numeric parity policy

Declare tolerances by domain instead of using one global epsilon:

- serialized money, counts, IDs, phases, and transaction sequences: exact;
- clock accumulation and pure double math: near-exact, fixture-defined epsilon;
- positions/navigation and terrain queries: centimeter-scale unless the source
  is visibly coarser;
- physics telemetry: scenario envelopes, not frame-by-frame identity;
- screenshots: semantic landmarks/layout/color/readability, not pixel identity
  across renderers.

### 20.3 Required failure testing

Every system must test cancellation, duplicate calls, stale references,
malformed data, future versions, missing content, unavailable resources,
mid-transaction failure, repeated cleanup, and session disposal. Success-only
ports are incomplete.

## 21. Risk register

| Risk | Probability / impact | Mitigation | Stop/escalate condition |
|---|---|---|---|
| C# web export unavailable | Certain / critical if web required | Phase 0 product decision | Web remains a hard requirement with no approved alternative |
| Vehicle handling diverges | High / high | two-branch spike, telemetry, playtest, ADR | Neither approach meets required profiles without engine modification |
| Procedural world creates too many nodes/draw calls | High / high | cache resources, chunked MultiMesh, profiler gates | MVP world misses minimum hardware budget after two optimization passes |
| 120 Hz physics is too expensive | Medium / high | profile 120/90/60 with interpolation | Lower rate breaks parity and 120 misses CPU budget |
| Browser save migration loses data | Medium / critical | unchanged JSON envelope, backups, fixtures, preview, fail closed | Any validated source save mutates or loses a required domain |
| Large JS classes become large Godot nodes | High / high | enforce domain/adapter split and code-review ownership | A node becomes a second authority or cannot be unit tested |
| C# signal/delegate leaks | Medium / high | disposable subscriptions, session disposal tests | count growth in 50-cycle or New Game soak |
| Floating-point differences alter rules | Medium / medium | double domain math, golden tolerances | economy/mission/save exact fields diverge |
| UI loses browser accessibility | High / high | AccessKit labels, focus graph, screen-reader signoff | critical flow cannot be completed by keyboard/controller/screen reader target |
| Feature creep from source-present post-MVP systems | High / medium | preserve feature gates; Phase 10 only | deferred feature blocks an MVP phase |
| Two implementations drift during port | High / medium | freeze reference revision; backport only critical fixes with fixtures | source behavior changes without updated baseline and ADR |
| Third-party test/addon abandonment | Medium / medium | minimal dependencies, pinned versions, fallback runner | addon cannot run C# headlessly on all CI targets |

## 22. Per-chunk handoff packet

Every team or AI must leave a `docs/port_handoffs/<phase>-<chunk>.md` containing:

```text
Chunk ID and status:
Source revision / Godot revision:
Objective and explicit non-goals:
Documents and source files read:
Files/scenes/resources added or changed:
Authoritative owners touched:
Public APIs, signals, events, input actions, collision layers:
Stable IDs/schema/content changes:
Behavior implemented:
Known deviations and ADR links:
Tests added and exact commands:
Test results and artifact paths:
Performance/resource counts before and after:
Manual checks performed:
Open defects with severity and reproduction:
Compatibility adapters and removal conditions:
Next safe task:
Unsafe/blocked tasks and required decision:
```

The packet must be factual. “Works” is not a result; include the scenario,
assertion, platform, and artifact.

## 23. Definition of done for an implementation task

A port task is done only when:

- its source behavior and governing contract are identified;
- its target owner and lifecycle are explicit;
- stable IDs and serialized names are preserved or migrated;
- success, invalid input, failure, duplicate, cleanup, and restore behavior are
  tested as applicable;
- it uses the canonical scheduler, transition, input, economy, interaction,
  mission, alert, and save authorities rather than bypassing them;
- it frees nodes/resources and unsubscribes events safely;
- diagnostics expose enough state to investigate failures without personal data;
- player-facing blocker/remedy text and accessibility behavior exist;
- parity matrix and handoff packet are updated;
- all required commands pass from a clean checkout.

## 24. Recommended first backlog

Do these next, in order:

1. Record the desktop/browser platform decision.
2. Run and archive the full Playwright baseline on the audited revision.
3. Add the Phase 0 JSON baseline-capture tool and fixtures.
4. Create `GODOT_PORT_PARITY_MATRIX.md` from requirement traceability.
5. Scaffold the Godot/.NET three-project workspace and CI.
6. Port content validation and GameState policy as the first pure C# slices.
7. Port scheduler/economy/outcome tests against golden fixtures.
8. Build the boot/save shell.
9. Build terrain/bridge landmark prototypes.
10. Run the vehicle-physics decision spike before committing to the full entity
    architecture.

## 25. Primary source index

Future contributors should start with these repository sources:

- `README.md` — player-visible baseline and controls.
- `docs/MVP_SCOPE.md` — release scope and feature disposition.
- `docs/REQUIREMENT_TRACEABILITY.md` — acceptance IDs and incomplete product
  work that should not be confused with engine-port defects.
- `docs/GAME_STATE_MACHINE.md` and `docs/TRANSITION_COORDINATOR.md` — ownership
  and transition invariants.
- `docs/SIMULATION_SCHEDULER.md` — clock domains and update order.
- `docs/BOOT_AND_LOAD_FLOW.md`, `docs/VERSIONED_SAVE_SERVICE.md`, and
  `docs/SETTINGS_AND_BINDINGS_STORE.md` — startup and persistence contracts.
- `docs/CONDITION_AND_CONSEQUENCE_CONTRACTS.md` and
  `docs/MISSION_LIFECYCLE.md` — cross-mode outcome and mission rules.
- `docs/CITY_ECONOMY_ARCHITECTURE.md`,
  `docs/TRAFFIC_AND_PRODUCTIVITY_FEEDBACK.md`, and
  `docs/SERVICE_AND_INCIDENT_MODEL.md` — city simulation ownership.
- `docs/PLACEMENT_INTELLIGENCE.md`, `docs/INTERACTION_PRIORITY.md`,
  `docs/STRUCTURED_ALERTS.md`, and `docs/PAUSE_AND_MODAL_BEHAVIOR.md` — important
  player-action contracts.
- `src/main.js` and `src/app/MetroPulseSimulationSchedule.js` — actual runtime
  composition and production task schedule.
- `src/data/missions.json`, `src/world/BuildingCatalog.js`,
  `src/entities/VehicleProfiles.js`, and `src/data/ContentDefinitions.js` —
  principal authored data.
- `test/` and `test/browser/smoke.spec.js` — executable behavior specifications.

The official Godot references linked throughout this guide should be checked
against exactly version 4.6 during implementation; do not silently substitute
`latest` documentation after a future engine release.
