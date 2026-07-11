# MetroPulse 3D GDD Compliance Audit

## Audit identity

| Field | Value |
|---|---|
| Design source | `/Users/michaelhamilton/Downloads/__Metropulse 3D – Comprehensive Game Design Document (v2.md` |
| Internal document title | **Metropulse 3D – Comprehensive Game Design Document (v2.1)** |
| Design date | July 2026 |
| Source size | 157 lines, 8,553 bytes |
| Source SHA-256 | `b066469ef55e63ee6e3f7e9fc587aa79d32151283f855bc19bc521424e64419e` |
| Code audited | Current working tree on branch `ui-enhancements`, based on `004eb46dfe6a35ce02e336aaeade4001cda449c3` |
| Audit date | 2026-07-11 |

The code target contains uncommitted changes and new files. The base commit identifies the starting revision; this report evaluates the complete working tree visible at audit time, not the base commit alone.

## Scope and status policy

The GDD mixes product declarations, examples, recommendations, phased roadmap items, and explicitly deferred work. For this audit:

- **P0–P3 are normative.** They include the core product contract, roadmap Phases 1–4, and declared world/UI/content requirements needed for a full v2.1 implementation.
- **P4 is future/deferred.** This includes the full reverse-chronology campaign, combat polish beyond the implemented base, unspecified additional content, modding support, and any future distribution/expansion packaging. The GDD's free/open-source licensing objective is already **Met** by the repository's MIT license and is not counted as deferred work.
- Recommended architecture is evaluated by intent and separation of concerns. Exact filenames are not treated as mandatory when an equivalent design exists.
- Mission-table entries are audited because the current implementation has promoted Taxi, Courier, Race, Delivery, Sabotage, and Mayhem Survival into shipped data and runtime logic.

Status meanings:

- **Met** — implementation evidence covers the stated behavior, subject to the verification limits below.
- **Partial** — some implementation exists, but a material acceptance criterion is absent, shallower than specified, or not sufficiently verified.
- **Deferred** — the GDD explicitly assigns the item to future scope, and it is not a v2.1 release gate under this interpretation.

> **Verification boundary:** no interactive browser play session was executed for this audit. An earlier working-tree revision completed one headless Chrome startup-only WebGL smoke and produced a screenshot, but that run preceded the final implementation changes and did not click controls, drive, walk, complete a mission, exercise audio, or validate an end-to-end play path. A final-tree browser/WebGL rerun was requested but could not be executed because the browser approval service had reached its usage limit. The final tree is therefore verified by automated tests, production build, syntax/static checks, and code inspection—not by a current interactive or rendered browser acceptance run.

## Executive assessment

The working tree is a substantial hybrid-game prototype rather than the original static city showcase. The core mode model, shared treasury, physics takeover, pedestrian control, combat, police response, weather integration, Mayhem effects, mission state machine, builder transactions, zoning, City Pulse UI, heat maps, and minimum living-agent populations all have direct code evidence. Automated tests cover the most failure-prone domain and integration logic.

The direct functional P0–P3 contract now has implementation evidence: aggregate Power/Water shortages reduce passive income; Power/Water/Fire coverage affects happiness and land value; amenity and Mayhem modifiers use position/radius falloff; paid infrastructure and landmark expansion uses the shared treasury; and the final tree includes a tested 0.6-second hijack approach, right-drag street mouse-look, deterministic hand-inked portraits, a real `THREE.OrthographicCamera` for minimap projection, and custom bridge-deck traversal. Final runtime compliance still requires an interactive acceptance pass. Remaining risks are unmeasured handling and visual feel, generic mechanics for the optional Race/Sabotage examples, recommended-architecture deviations, and no LOD/proximity strategy or measured performance budget. The explicitly future P4 campaign, combat polish, additional content, and modding work remains deferred.

**Matrix outcome:** 69 requirements are **Met**, 6 are **Partial** (subjective experience acceptance, optional mission depth, and architecture/performance recommendations), and 5 explicitly future P4 requirements are **Deferred**.

## Requirement-to-implementation matrix

### 1. Product concept and dual-loop contract

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **PLAT-01** — Browser game using Three.js and Vite (GDD L5–6) | P0 | Met | `package.json`, `vite.config.js`, `src/main.js`, `src/world/SceneManager.js` | `npm run build` succeeds. An earlier revision completed a startup-only headless render smoke, but the final-tree rerun could not be authorized after the browser approval service reached its usage limit; no interactive browser flow was performed. |
| **LOOP-01/02** — Builder/Management and Action/Street modes share one city session (L14–17) | P0 | Met | `src/core/GameManager.js` defines `MANAGEMENT`, `BUILDER`, and `ACTION`; `src/main.js` owns one world and the shared stores; control systems update the canonical mode. | State transitions have Node tests. Persistence across real camera/control interactions remains browser-unverified. |
| **LOOP-03** — Orbital builder supports zoning, infrastructure, economy, and growth (L16, L29–33) | P0 | Met | `src/world/CityEditorSystem.js`, `src/ui/CityEditorUI.js`, `src/world/BuildingCatalog.js`, `EconomySystem`, and OrbitControls with a startup bird's-eye preset in `src/world/SceneManager.js`. | Placement, rezoning, paid expansion, service consequences, local land value, district gates, and traffic tools are implemented. Pointer/raycast flow remains browser-unverified. |
| **LOOP-04** — Street mode supports walking, vehicles, missions, exploration, combat, and chaos (L17, L35–38) | P0 | Met | `src/systems/PedestrianSystem.js`, `src/systems/TrafficSystem.js`, `src/entities/PlayerVehicle.js`, `src/systems/MissionSystem.js`. | Static/integration tests cover key control and police flows; complete browser play path is not verified. |
| **ECO-01** — Macro growth generates passive income (L19) | P0 | Met | Deterministic rates and `update(deltaSeconds)` in `src/systems/EconomySystem.js`; live one-second accumulation in `src/main.js`; buildings contribute rates. | Covered by `test/EconomySystem.test.js`. |
| **ECO-02/03** — Missions pay burst income/narrative progress into the same treasury used for building (L19, L42, L146) | P0/P2 | Met | `MissionSystem.completeMission()` calls `EconomySystem.recordMissionCompletion()`; `CityEditorSystem` calls the same store's `canAfford`, `spend`, and `earn`. | Mission payout, duplicate protection, narrative delta, and treasury debit tests pass. |
| **IMPACT-01** — Street actions feed back into macro congestion, alerts, reputation, happiness, and land value (L21–23, L38) | P0 | Met | Crime incidents in `src/systems/PedestrianSystem.js`; destruction incidents in `src/world/BuildingFactory.js`; traffic weighting in `src/systems/TrafficHeatmapSystem.js`; aggregation in `EconomySystem`. | Incident creation/resolution and police dispatch have Node tests. UI/render feedback is browser-unverified. |
| **MODE-01/02** — Contextual actions and smooth orbital/chase transitions (L40–41, L124, L137) | P1 | Met | Context actions in `src/ui/UIManager.js`; `CameraRig` state machine and interpolation in `src/camera/CameraRig.js`; follow integration in `src/world/SceneManager.js`. | Code path is direct; transition quality and interruption behavior require interactive verification. |
| **MAYHEM-01/02** — Toggleable Mayhem in both modes with comets, destruction, rubble, and sirens (L44) | P0/P3 | Met | Independent overlay in `GameManager`; UI toggle in `UIManager`; `CometManager`, `ExplosionManager`, `BuildingFactory.destroyBuilding/restoreAllBuildings`, and Mayhem audio. | Collider restoration and camera-shake routing have tests. Full destructive/reset loop is not browser-tested. |
| **TONE-01** — Satirical pro-capitalist messaging in chyron, dialogue, branding, and mechanics (L19, L55) | P3 | Met | News chyron in `index.html`; corporate missions in `src/data/missions.json`; pedestrian dialogue and profit-oriented catalog copy. | Content presence verified statically; tone effectiveness requires editorial/playtest review. |
| **EXPERIENCE-01** — Relaxed macro play, thrilling street bursts, and high replayability (L23) | P3 | Partial | Multiple control paths, 15 replayable missions, dynamic weather, Mayhem, and repeat-run payout logic exist. | “Relaxed,” “thrilling,” and “high replayability” have no defined KPI or completed playtest evidence. |

### 2. Builder, economy, and city management

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **BUILD-01/03** — Zoning/building tools and block rezoning (L30, L63, L147) | P2 | Met | `CityEditorSystem.setZoningMode`, parcel validation, visible zone overlays, replacement of previous modifiers, and persistent in-session `zoneParcels`. | Logic is evidence-backed; pointer/raycast interaction is browser-unverified. |
| **BUILD-02** — Infrastructure tools (L30, L64, L96) | P2 | Met | Road, bridge, power, water, fire, industrial, and landmark catalog entries; filtered City Editor palette; placement colliders; editor roads register/unregister with the live traffic graph; custom intact bridge decks are recognized by terrain/water queries. | Road-graph lifecycle and custom bridge traversal/destruction restoration have tests. Service coverage is managed as a city-wide capacity/demand system. |
| **BUILD-04** — Buildings are data objects with value, employees, and status (L62) | P2 | Met | Catalog fields and normalized live records in `src/world/BuildingCatalog.js`, `src/main.js`, `src/world/CityEditorSystem.js`, and `EconomySystem`. | Registration/removal and aggregation are tested. |
| **BUILD-05** — Credits purchase infrastructure and landmarks (L64) | P2 | Met | Costs in `BuildingCatalog`; affordability/debit/refund transaction in `CityEditorSystem`; Aether landmark and infrastructure entries. | Treasury behavior is tested; complete UI placement is browser-unverified. |
| **EXPAND-01** — Spend credits on infrastructure and landmarks (L64) | P2 | Met | Infrastructure, bridges, utilities, and the Aether landmark have explicit costs and are placed through the shared treasury's atomic debit/refund path. | The GDD labels this bullet “Upgrades & Expansion” but specifies paid infrastructure/landmark expansion; it does not define or require an existing-asset upgrade tree. |
| **CITY-01** — Manage bridge/river traffic (L31) | P2 | Met | Cross-river road graph, bridge-specific congestion metrics, live heat display, and a Bridge Priority control that changes bridge AI target speed/status in `TrafficSystem`; player-built bridge decks participate in traversal/water-hazard checks. | State, bridge targeting, congestion metrics, intact bridge traversal, and destroyed-bridge hazard restoration are tested. The management model is one lever rather than a full lane/signal/routing toolset. |
| **CITY-02** — Simulate and display land value (L31, L63) | P2 | Met | Authoritative city-wide land value plus renderer-independent `getLandValueAt()`/`getLandValueBreakdownAt()` parcel APIs in `EconomySystem`; zoning/building/destruction adapters; City Pulse and live selected-building parcel readings in `UIManager`/`index.html`. | Arithmetic, spatial falloff, and inspector-adapter invariants are tested. A separate land-value heat layer is optional future visualization depth. |
| **CITY-03** — Amenity proximity raises and Mayhem zones lower land value (L63) | P2 | Met | Positioned amenity records retain `amenityRadius`; active destroyed-building and crime incidents retain world positions/influence radii; `EconomySystem` applies deterministic linear falloff, and the inspector exposes local value plus amenity/Mayhem influence. | Economy, builder-adapter, crime-adapter, and inspector regressions cover near/far and active/resolved effects. Final in-browser presentation remains unverified. |
| **CITY-04** — Power, Water, and Fire services are manageable (L31) | P2 | Met | Capacity, demand, surplus, coverage, utility buildings, and UI display exist in `EconomySystem`, catalog, and City Pulse. The lower of aggregate Power/Water coverage scales passive income; aggregate Power/Water/Fire shortages reduce happiness and land value. | The stated aggregate management consequences are tested. Local outage/fire-risk simulation would be additional depth, not a requirement defined by this GDD. |
| **CITY-05** — City Pulse displays budget, energy, population, and happiness (L32) | P2 | Met | Live subscriptions and fields in `src/ui/UIManager.js`, `index.html`, and `EconomySystem.snapshot()`. Land value, services, and reputation are also shown. | Store behavior is tested; rendered updates are not browser-tested. |
| **CITY-06/07** — Capital-gated East Cyber-Metropolis unlock (L33) | P2 | Met | Configured $500,000 cost in `src/main.js`; atomic unlock in `EconomySystem`; east-coordinate placement gate in `CityEditorSystem`; UI action/status. | Affordability, exact debit, alias, and idempotency tests pass. No save persistence exists. |

### 3. World, atmosphere, and living simulation

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **WORLD-01** — River-divided districts and grand suspension bridge (L50) | P3 | Met | `CityBuilder.createRiverAndBridge()` creates river basins, a suspension bridge, secondary bridges, roads, and east/west land. | Static implementation evidence only; traversability requires browser play. |
| **WORLD-02/03** — Central Park and commercial storefronts (L50) | P3 | Met | Central Park geometry/path network in `CityBuilder`; shops and storefront detail generators in `BuildingFactory`; commercial catalog. | Presence verified in code. Visual composition is not reviewed interactively. |
| **WORLD-04** — Skyscrapers with procedural illumination (L50) | P3 | Met | Procedural building generation and instanced window grids in `BuildingFactory`; night-light registry driven by `TimeManager`. | Rendering result is not visually verified. |
| **WEATHER-01** — Clear → Mist → Rain → Thunderstorm cycle (L52) | P3 | Met | Explicit ordered sequence, per-state durations, manual controls, and dynamic cycling in `src/world/Environment.js` and `index.html`. | Timer logic was inspected but does not yet have a direct unit test. |
| **WEATHER-02** — Rain/storm reduce player-vehicle friction in real time (L52, L70) | P1/P3 | Met | `Environment.syncWeatherIntegration`, `PhysicsWorld.setWeatherFriction`, and RaycastVehicle grip propagation. | Explicit rain-to-dry grip restoration is tested in `GameplaySystems.test.js`. |
| **WEATHER-03** — Weather changes visibility (L52) | P3 | Met | Per-state fog density, sky tint, rain opacity, and storm lighting in `Environment`. | Visual magnitude/readability is browser-unverified. |
| **WEATHER-04** — Weather changes pedestrian behavior (L52) | P3 | Met | Rain state is passed into pedestrians; procedural shield/umbrella/normal behavior and animation are implemented. | Behavior branches are not directly unit-tested or visually reviewed. |
| **WEATHER-05/06/07** — Weather audio, wet surfaces, and lightning (L52) | P3 | Met | Rain/wind gains and thunder in `AudioSystem`; wet material interpolation and lightning/thunder sequencing in `Environment`. | WebAudio and materials are browser-only paths and were not exercised here. |
| **DAY-01/02/03** — Day/night orbit lighting, automatic illumination, and atmospheric transitions (L53) | P3 | Met | Time progression, sun/moon/ambient changes, dawn/dusk sky interpolation, building/street/vehicle lighting in `TimeManager` and `Environment`. | No visual regression or full-cycle browser run was performed. |
| **AGENT-01/02** — At least 48 moving AI vehicles and 60 pedestrians on graphs/paths (L54) | P3 | Met | Target counts and population-floor repair in `TrafficSystem` and `PedestrianSystem`; road and sidewalk graphs. | `GameplaySystems.test.js` verifies both floors after removing agents. |
| **AGENT-03** — Player takeover cleanly overrides AI (L54) | P3 | Met | Vehicle AI-to-physics authority transfer/cleanup in `TrafficSystem`; pedestrian control ownership; mutual release guards. | Physics cleanup and vehicle exit are tested. Full animation/camera sequence is browser-unverified. |
| **AGENT-04/05** — Crashes/destruction cause congestion visible on a heat map (L54, L99) | P2/P3 | Met | Crashed/stopped moving vehicles obstruct routing and receive stronger weights in `TrafficHeatmapSystem` and minimap heat rendering; parked cars are excluded from congestion heat. | Congestion estimator crash weighting and parked-traffic exclusion in metrics are tested; the rendered overlay is not. |

### 4. Street movement, driving, hijacking, and combat

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **PHYS-01/02** — `cannon-es` RaycastVehicle player physics with suspension (L67, L123, L133) | P1 | Met | Dependency in `package.json`; `PhysicsWorld`; `PlayerVehicle` chassis, wheel, and suspension configuration. | Construction, registration, grip, and idempotent destruction are tested. |
| **PHYS-03** — Acceleration, steering, braking, reverse, and handbrake (L67, L103) | P1 | Met | Unified keyboard/gamepad state in `InputManager`; forces and brakes in `PlayerVehicle.applyInput`. | Input-to-force path is statically evidenced; driving feel is not browser-tested. |
| **PHYS-04** — Drifting (L67) | P1 | Met | Handbrake input removes the normal lateral anti-drift stabilization while applying strong braking; wheel slip, speed-sensitive steering, and weather grip reduction preserve lateral slide in the RaycastVehicle model. | The mechanics are explicit in code; drift balance and feel remain interactive acceptance items. |
| **PHYS-05/06** — Collisions and suspension behavior (L67) | P1 | Met | Cannon world/static colliders, AI collision response, ramming, wheel/suspension parameters, and fixed-step physics. | Collider lifecycle is tested; collision/suspension feel and tunneling limits are not measured. |
| **PHYS-07/08** — AI stays kinematic and player spline control is disabled (L67, L123, L134) | P1 | Met | AI gets kinematic colliders and graph updates; takeover creates one `PlayerVehicle`; release destroys it and restores the AI collider/route. | Cleanup and re-entry paths have focused tests. |
| **PHYS-09/CAMERA-01** — Chase camera tracks controlled street entity (L134, L137) | P1 | Met | `CameraRig` swoop/chase/ascend state machine and `SceneManager.startFollowTarget`; shake is applied as a render-only offset and removed before the next base-pose update. | Non-accumulating shake is tested. Camera transition quality is not interactively verified. |
| **WALK-01** — “Take Walk Control” pedestrian possession (L36, L138) | P1 | Met | Context action, `PedestrianSystem.toggleUserControl`, WASD movement, sprint, jump, terrain recovery, and camera follow. | Control lifecycle is code-evidenced; no browser input test. |
| **HIJACK-01/02** — Proximity-gated hijacking with animation (L36, L69) | P1 | Met | A 3.5 m target gate and E action begin a 0.6-second smoothstep approach to the vehicle door with facing/arm posing before rider removal or mounting, authority transfer, and camera follow in `PedestrianSystem`. | A regression test proves control is not transferred until the timed approach completes. Animation quality and live input timing remain browser-unverified. |
| **EXPLORE-01** — Free street exploration (L17, L37) | P0 | Met | Walking/driving are not mission-gated; world terrain, bridge, collision, water rescue, and free exit/re-entry paths exist. | Reachability and bounds require browser play. |
| **COMBAT-01/02** — Melee weapons and attacks on NPCs/vehicles (L37, L68) | P0/P3 | Met | Bat pickups, swing animation, cone hit detection, vehicle damage/fire, NPC fear/knockdown, contextual combat action. | This meets the GDD's named bat/attack baseline. Broader improvised weapons, health depth, AI combat, and polish are explicitly assigned to P4. |
| **COMBAT-03** — Vehicle ramming as combat/damage (L68) | P3 | Met | High-speed vehicle/pedestrian impacts, crime reports, bounce/knockdown, and Mayhem crash/destruction paths in `TrafficSystem`. | Damage balance is not tested interactively. |
| **COMBAT-04/05** — Police response and city alerts (L68) | P3 | Met | Wanted state, dispatch, pursuit after pedestrian/vehicle switching, sirens, escape/arrest, alerts, and macro crime incident. | Police vehicle-switch pursuit and one-incident crime feed are tested. |
| **INPUT-01/04** — Builder mouse orbit/tool selection and street WASD + mouse (L102–103) | P0/P1 | Met | OrbitControls/tool pointer input and WASD walking/driving exist. In street chase states, holding the right mouse button captures pointer motion and applies bounded independent yaw/pitch in `CameraRig`. | Chase-pose yaw has a unit regression test. Pointer capture, context-menu suppression, and handling feel remain browser-unverified. |
| **INPUT-02** — Combat bindings (L103) | P3 | Met | Left-click bat swing and contextual Combat Action button; inputs ignore form controls. | Binding discoverability/accessibility is limited; no rebind support is specified. |
| **INPUT-03** — Quick mode switch (L103) | P1 | Met | M key/top toggle switches Management/Builder; control/exit paths transition Action/Management; gamepad editor action exists. | End-to-end focus/pointer conflicts need browser verification. |

### 5. Missions and narrative

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **MISSION-01/02/03** — Trigger zones, timers, waypoints, lifecycle (L141) | P2 | Met | Validated pickup rings, proximity eligibility, explicit states, timers, destination beacon/HUD/minimap markers, completion/failure/cooldown in `MissionSystem`. | Six mission-system tests cover validation, eligibility, state, timers, and congestion. Rendering is browser-unverified. |
| **MISSION-04/05/06** — Taxi A→B, time pressure, traffic satisfaction, branching clues (L76, L143) | P2 | Met | Taxi content, time limits, congestion sampling, satisfaction-scaled payout, and dialogue trees in mission data/runtime. | Adjusted payout and satisfaction are tested. Dialogue DOM choices are not browser-tested. |
| **MISSION-07/08** — Courier bridge/district runs and rival-corporation plot (L77, L143) | P2 | Met | Multiple timed Courier missions cross districts/bridge and include Quantum/Aether and NeoTech/Orbital conflict. | Courier uses the shared delivery objective rather than a separate rival-racer AI system. The GDD only requires racing against ambient AI traffic, which is present. |
| **MISSION-09/10** — Mayhem Survival climax with hazards and high-tier vehicle (L78) | P3 | Met | `mission_mayhem_escape` is `SURVIVAL`, requires a sports vehicle, enables Mayhem, completes when its timer expires, and suppresses destination beacons/minimap dropoff markers that do not apply to survival. | Survival timer behavior is tested; live comet evasion is not. |
| **MISSION-11** — Race, delivery, and sabotage content (L79) | P3 | Partial | Mission data includes `RACE`, `DELIVERY`, and `SABOTAGE`; runtime validates all objective types. | Most share the same timed destination mechanic. Sabotage lacks a distinct sabotage interaction, and Race has no authored rival racers. |
| **DIALOGUE-01/02** — JSON branching parser and overlay (L122, L142) | P2 | Met | Branching trees in `src/data/missions.json`; structural validation in `MissionSystem`; node/choice renderer in `DialogueOverlay`; HTML overlay. | Broken references are tested. Actual choice clicking/typewriter presentation is not browser-tested. |
| **NARR-01** — Corporate cyber-crime thriller involving named corporations (L82) | P3 | Met | Mission dialogue explicitly connects Quantum Dynamics, Aether Skyspire, NeoTech, Orbital Systems, and the comet-guidance conspiracy. | Content is present; full narrative coherence has not been playtested. |
| **NARR-02/03** — Begin at the Mayhem climax and reveal the campaign in reverse chronology (L83, L149) | P4 | Deferred | Chapters 1–5 and the climax premise exist in mission data; `narrativeState` records progress. | Missions are all available and no campaign sequencer enforces reverse chronology. This remains an explicit future-phase deliverable. |

### 6. UI, HUD, controls, and art direction

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **ART-01/03** — Low-poly neon world and dark glassmorphic UI (L90–91) | P3 | Met | Procedural low-poly geometry/emissive accents; extensive glass-panel/neon styling in `src/index.css` and `index.html`; ACES tone mapping. | Visual consistency/readability was not reviewed in a browser or against the referenced screenshot. |
| **ART-02** — Bloom (L90) | P3 | Met | `SceneManager` renders through `EffectComposer`, `RenderPass`, and a restrained `UnrealBloomPass`; resize handling updates the composer. | The pass is wired into production rendering, but its visual balance has not been reviewed in a browser. |
| **ART-04** — Hand-drawn/sketchy dialogue portraits (L92) | P3 | Met | `DialogueOverlay.renderSketchPortrait()` deterministically draws seeded, multi-pass ink outlines, hatching, face details, and role-specific accents into an accessible canvas for each character. | The procedural implementation satisfies the sketch style in code; final visual composition/readability remains browser-unverified. |
| **UI-01/02/03/04** — Top bar stats, time/weather, mode toggle, and alert feed (L95) | P2 | Met | `index.html` and `UIManager` expose and update all named elements, plus happiness/FPS; `TimeManager.getFormattedTime()` supplies live timestamps; responsive dashboard rules separate the top, side, bottom, minimap, and Action HUD regions. | DOM update and non-overlap behavior are not browser-tested. |
| **UI-05/06/07** — CITY TOOLS sidebar for zoning, infrastructure, atmosphere, overlays, heat map, and modes (L96) | P2 | Met | Named controls and handlers in `index.html`, `UIManager`, and `CityEditorUI`. | Bridge Priority is a live control, although its management depth is limited to the single lever described under CITY-01. |
| **UI-08/09** — Context inspector with Take Control, Hijack, Combat, and Follow (L97) | P1/P2 | Met | `InspectorHUD` registration and contextual actions in `UIManager`; eligibility-specific labels/visibility. | Click behavior and the timed hijack presentation are not browser-tested. |
| **HUD-01** — Street minimap using a secondary orthographic camera (L98) | P2 | Met | `MinimapHUD` owns a real `THREE.OrthographicCamera`, updates it around the current focus, and projects roads, rivers, agents, player, congestion, pickups, and waypoints through it. | Projection uses the specified camera type while drawing the resulting schematic into a 2D canvas rather than a second WebGL scene render. Canvas output remains browser-unverified. |
| **HUD-02/03/04** — Speedometer, mission ticker, and dialogue overlay (L98) | P2 | Met | Live speed/gear UI, mission objective/timer/fare HUD, and branching dialogue DOM are present. | Browser rendering and input focus were not verified. |
| **HUD-05/06** — Minimap markers and satirical news chyron (L99) | P2 | Met | Mission/player/agent markers in `MinimapHUD`; reactive/static satire in the news chyron and mission payout updates. | Rendering is not browser-verified. |

### 7. Architecture, engineering, and performance

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **ARCH-01/02/03** — Central state, input handling, and physics ownership (L113–114, L124) | REC/P1 | Met | DOM-free `GameManager` and `EconomySystem`; `InputManager`; `PhysicsWorld`; root composition in `src/main.js`. | `TrafficSystem` still retains a second keyboard map/listeners, so input ownership is not completely centralized. |
| **ARCH-04/05/06/07/08** — Separated entity/system/UI/data responsibilities (L114–117) | REC | Met | Dedicated player/AI entity classes, mission/dialogue/traffic/economy systems, UI modules, and JSON mission content. | Exact recommended folder layout differs, but functional boundaries exist. |
| **ARCH-09** — Entity-component style separating rendering and logic (L120) | REC | Partial | Some domain stores are renderer-free and player physics sync is explicit. | Vehicle/Pedestrian and large system classes still combine meshes, AI, input, audio, and DOM interactions; there is no general ECS/component composition. |
| **ARCH-10** — Central tick updates physics before Three.js transforms (L120) | REC | Met | `src/main.js` orders input, physics, simulation systems, UI, camera, and rendering; `PlayerVehicle.syncMesh()` copies physics authority to rendering. | Ordering is code-evidenced; frame behavior is not profiled. |
| **ARCH-11** — MVVM-like UI separation (L121) | REC | Partial | Observable immutable stores feed UI subscriptions, which is a meaningful ViewModel boundary. | `UIManager`, mission, pedestrian, and traffic systems still manipulate DOM directly and read the root app graph. |
| **ARCH-12** — Nearby player detail with bounded lifecycle (L123, L126) | P3/REC | Partial | Physics vehicles/colliders and heat-map resources have explicit cleanup; ambient audio is distance-limited. | AI movement/collision logic still updates the full population, including quadratic scans; no proximity-tier simulation design is present. |
| **PERF-01** — Instancing (L126) | P3/REC | Met | Instanced crosswalk stripes and thousands of skyscraper windows in `CityBuilder` and `BuildingFactory`. | Draw-call counts were not measured in this audit. |
| **PERF-02/03/04** — LODs, culling, and near-player detailed simulation (L126) | P3/REC | Partial | Renderer frustum culling and distance-limited audio provide baseline savings. | No authored LOD assets/system, distance-tier AI simulation, performance test, or target device/frame-time budget was found. |
| **BASE-01** — Claimed Three.js, entity, UI, AI, weather, audio, and Fun Mode foundation (L109–110) | Audit | Met | All named foundation areas are present under `src/` and composed by `src/main.js`. | Presence is established; interactive integration remains unverified. |

### 8. Explicit future and delivery scope

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **FUT-01** — Combat polish (L149) | P4 | Deferred | A functional bat/ramming/police base exists. | Animation quality, broader weapons, health/damage depth, balance, and AI combat are future work. |
| **FUT-02** — Complete reverse-chronology campaign and more content (L149) | P4 | Deferred | Narrative chapters and 15 missions establish a content base. | No campaign sequencing, authored ending, or defined content-completion target. |
| **FUT-03** — Modding support (L149) | P4 | Deferred | Mission/building content is data-oriented. | No supported mod API, loader, validation boundary, documentation, or example mod. |
| **SCOPE-01** — Free/open-source core (L155) | P4 | Met | Repository-level `LICENSE` grants the MIT License and `README.md` identifies it. | Legal suitability of third-party and authored asset licensing was not separately audited. |
| **SCOPE-02** — Potential expansions (L155) | P4 | Deferred | Data-oriented mission/building catalogs and separated systems provide extension points. | No expansion packaging/versioning contract is required or implemented yet. |

## Defects fixed or hardened in the current working tree

These are concrete corrections evidenced by the current diff and regression tests, not claims based only on comments.

| Defect or risk addressed | Current correction | Regression evidence |
|---|---|---|
| Mode and Mayhem state could diverge across ad hoc UI/runtime flags. | Added validated, observable `GameManager` with legal transitions, immutable snapshots, restore, and independent Mayhem overlay; UI subscribes to canonical events. | `test/GameManager.test.js` |
| Mission earnings and builder spending were not one authoritative economy, and service coverage was informational only. | Added `EconomySystem`, registered live buildings, wired passive ticks, mission rewards, placement debits/refunds, City Pulse, incidents, and district unlocks to one treasury; aggregate Power/Water shortages now reduce passive income and service deficits reduce happiness/land value. | `test/EconomySystem.test.js`, `test/MissionSystem.test.js` |
| Amenity and Mayhem land-value modifiers were city-wide despite the GDD's proximity requirement. | Added validated world positions/radii and deterministic parcel-level linear falloff; building/editor adapters preserve amenity locations, destruction/crime incidents create spatial influence zones, and the live building inspector exposes the result. | `test/EconomySystem.test.js`, `test/BuilderEconomyIntegration.test.js`, `test/GameplaySystems.test.js`, `test/UIManagerEconomy.test.js` |
| Duplicate mission completion could duplicate narrative progression or mishandle replay rewards. | Economy rejects duplicate completion IDs; MissionSystem assigns repeat-run IDs while setting repeat narrative delta to zero. | Mission completion/repeat-run tests in both economy and mission suites. |
| Mission content could contain broken IDs, unsupported objectives, invalid timers/coordinates, or dangling dialogue links. | Added startup mission-data validation with explicit supported objectives and structural checks. | `MissionSystem.test.js` validation cases. |
| Player RaycastVehicle weather grip did not have an explicit restoration/cleanup contract. | Physics weather changes propagate to wheel `frictionSlip`; player bodies/vehicle registration are removed idempotently. | `GameplaySystems.test.js` weather-grip and cleanup test. |
| Mayhem rubble could leave colliders/roads removed or duplicated after restoration, and elevated structures could spawn rubble at world Y=0. | Added explicit collider and traffic-road unregister/restore lifecycles with duplicate guards; restoration re-registers economy data/resolves its incident; rubble uses the source plot/terrain elevation. | Static-collider and user-road lifecycle tests; rubble elevation is code-reviewed. |
| Vehicle UI mixed internal speed units and allowed lower-priority status to overwrite crash/control/fire state. | Internal m/s is converted to km/h for display and status precedence is preserved. | Vehicle speed/status test. |
| Wanted police could lose the player when control moved from pedestrian to vehicle. | Pursuit target resolves either controlled pedestrian or controlled vehicle and maintains emergency target/siren state. | Wanted vehicle-switch test. |
| Repeated crime reports could create duplicate macro incidents and dispatch state. | `reportCrime` creates one active incident and resolution clears it; repeat reports preserve the active record. | Crime-to-economy test. |
| River/out-of-bounds recovery could permanently reduce the promised 48/60 ambient populations. | Agents are recovered to valid graphs and periodic population floors replace missing moving vehicles/pedestrians. | 48/60 population-floor test. |
| Vehicle exit risked duplicate release and invalid spawn height. | Exit delegates terrain height and transfers control exactly once to a spawned/reused pedestrian. | Vehicle-exit test. |
| Comet earthquake calls could bypass the cinematic rig, and repeated shake offsets could random-walk the camera's authoritative orbit/chase pose. | `SceneManager.earthquakeShake` forwards into `CameraRig`; the rig removes each prior render-only offset before updating/applying the next one. | Camera-shake routing test and `test/CameraRig.test.js`. |
| Parked cars could appear as congestion and Survival could display a false delivery marker. | Minimap heat rendering skips parked traffic and suppresses dropoff markers for the `SURVIVAL` objective. | Code-path review; minimap canvas output is not browser-tested. |
| Bridge management was a UI-only affordance, user roads did not affect live routing, and a custom bridge could still be treated as river water. | Added stateful bridge priority with a bridge speed boost/metrics, dynamic road-segment graph registration/removal, and intact custom bridge-deck traversal/water-height recognition with destroyed-deck hazard restoration. | `test/TrafficManagement.test.js` |
| Hijacking transferred control immediately with no approach animation. | Added a cancellable 0.6-second smoothstep approach to the vehicle door, including facing/arm pose and delayed authority transfer. | Timed hijack regression in `test/GameplaySystems.test.js` |
| Street chase view had no mouse camera input. | Added right-button pointer capture, bounded chase yaw/pitch, context-menu suppression, and reset on mode transition in `CameraRig`. | Chase-pose regression in `test/CameraRig.test.js` |
| Dialogue avatars and minimap projection did not meet their stated presentation techniques. | Added seeded procedural hand-inked canvas portraits and a real `THREE.OrthographicCamera` for minimap world projection while retaining efficient canvas drawing. | Code-path review; final canvas rendering still requires browser acceptance. |
| Builder mode could be opened while direct street control or a mission remained active, creating conflicting primary modes. | Both `UIManager.toggleCityEditor` and `CityEditorUI.show` now reject entry until Action control/mission state returns to Management. | Code-path review; browser key/button coverage is still needed. |
| Building placement failures could debit funds or leave partial world/economy/collider state. | City editor validates again before placement and performs economy, physics, scene, and registry rollback plus refund on failure. | Code-path review; no DOM/WebGL integration test yet. |
| Deprecated `Clock` usage and a second elapsed-time read could skew frame-derived timing. | `src/main.js` uses `THREE.Timer`, consumes one delta per frame, maintains one explicit `elapsedTime += delta` accumulator, and passes it to the minimap. | Code-path review; frame timing is not browser-profiled. |
| Renderer configuration used the deprecated `PCFSoftShadowMap` constant. | `SceneManager` now uses supported `THREE.PCFShadowMap` while retaining explicit shadow-map setup. | Production build and JS syntax checks pass; visual shadow quality needs browser review. |
| Initial management view and fixed dashboard positioning could obscure the intended orbital overview or overlap HUD regions. | `SceneManager` starts at the bird's-eye preset; responsive CSS establishes separate desktop/Action/narrow-screen dashboard regions. | Code/CSS review only; viewport screenshots remain required. |

## Verification record

Commands executed from the repository root on 2026-07-11:

| Command | Result | What it establishes |
|---|---|---|
| `npm test` | **41 tests passed, 0 failed** | Deterministic state/economy rules, aggregate service consequences, spatial amenity/Mayhem falloff and adapter/inspector integration, mission validation/lifecycle, weather grip, cleanup, timed hijacking, vehicle status, police/crime integration, camera shake/mouse-look, 48/60 population floors, bridge metrics/priority, custom bridge traversal, and dynamic road graph lifecycle. |
| `npm run build` | **Succeeded; 46 modules transformed; main JS 1,000.45 kB / 261.42 kB gzip** | Vite can parse, link, and produce the production bundle, including the post-processing modules. |
| `node --check` across project/test JS | **38 files passed** | All repository JavaScript outside generated/dependency directories passes Node syntax parsing. |
| HTML ID uniqueness check | **89 IDs; 89 unique** | `index.html` contains no duplicate element IDs, reducing ambiguous DOM lookups. |
| `git diff --check` | **Succeeded** | No whitespace-error diagnostics in tracked changes. |
| Earlier headless Chrome WebGL startup smoke | **Loaded an earlier working-tree revision; no app exception observed** | Startup/render sanity evidence only, not final-tree or interactive acceptance. Its screenshot prompted startup-camera and non-overlapping-layout fixes. |
| Final-tree browser/WebGL rerun | **Not executed; browser approval-service limit reached** | The requested recapture could not be authorized after the earlier smoke. No final-tree browser success is inferred from the automated build. |

Test suites:

- `test/CameraRig.test.js` — shake is render-only and cannot accumulate into the authoritative orbit pose; independent chase mouse-look yaw changes the desired camera pose.
- `test/BuilderEconomyIntegration.test.js` — city-editor economy records preserve placed amenity positions and influence radii.
- `test/GameManager.test.js` — mode validation, transitions, Mayhem independence, restoration, and subscriptions.
- `test/EconomySystem.test.js` — treasury, deterministic passive income, buildings, aggregate service penalties, spatial land-value falloff, missions, incidents, City Pulse, district unlocks, and subscriptions.
- `test/GameplaySystems.test.js` — cannon-es grip/cleanup, colliders, vehicle state, police response, exit control, spatial crime feedback, timed hijacking, camera shake, and population floors.
- `test/MissionSystem.test.js` — content validation, eligibility, vehicle binding, timers, survival, taxi payout/satisfaction, repeat-run narrative semantics, and congestion estimation.
- `test/TrafficManagement.test.js` — bridge priority, bridge/general congestion metrics, user-road graph registration/removal, and custom bridge traversal/destruction behavior.
- `test/UIManagerEconomy.test.js` — the building inspector surfaces local parcel land value and amenity/Mayhem influences while ignoring unrelated entity types.

The build reports a performance warning: the main minified JavaScript chunk is **1,000.45 kB** (**261.42 kB gzip**), above Vite's 500 kB warning threshold. This does not fail the build, but it supports the **Partial** performance status.

## Known residual limitations and acceptance work

1. **No final-tree interactive browser acceptance run.** The earlier headless startup smoke predates the last changes, and the requested final-tree rerun could not be authorized after the browser approval service reached its usage limit. There is no final browser evidence for pointer capture, keyboard focus, WebAudio unlock, camera transitions under input, actual mission completion, builder placement, or Mayhem restoration across Chrome/Safari/Firefox.
2. **No final design-reference verification.** The screenshot referenced by the GDD was not embedded in the Markdown source. An earlier smoke screenshot was inspected for obvious startup/layout issues, but no reference comparison or final-tree screenshot regression was possible.
3. **Builder depth beyond the written contract is compact.** Bridge management is one priority/speed lever and services use city-wide capacity/demand rather than localized outage simulation. Amenity and Mayhem land values are now spatial. The GDD's paid infrastructure/landmark expansion is implemented; it does not define an existing-asset upgrade tree.
4. **Some interaction/content depth remains shallow.** Timed hijacking, right-drag mouse-look, and the specified bat combat baseline are implemented, but intentional drift handling lacks dynamic/browser acceptance and the optional Race/Sabotage examples reuse generic destination mechanics. Broader combat polish is P4.
5. **Visual acceptance remains outstanding.** Procedural hand-inked portraits, bloom, and orthographic-camera minimap projection are implemented, but their final canvas/WebGL composition and readability were not verified on the final tree.
6. **Architecture is improved but not fully ECS/MVVM.** Large simulation classes still own rendering, DOM, input, and audio concerns; some input handling is duplicated between `InputManager` and `TrafficSystem`.
7. **Performance is not acceptance-tested.** There is no target browser/device matrix, FPS percentile, frame-time, memory, load-time, or draw-call budget; no LOD/proximity AI tiers exist; full-population scans remain common.
8. **No persistence layer.** Treasury, unlocked district, zoning, mission/narrative state, and world destruction reset on reload. Persistence was not specified by the GDD, but it is a product-readiness limitation.
9. **P4 remains intentionally incomplete.** Reverse-chronology campaign sequencing, expanded combat/content, modding, and future release/expansion packaging are deferred. The repository itself is already MIT-licensed.

## Recommended acceptance sequence

1. Run a browser smoke matrix covering initial load, both mode transitions, pedestrian control, hijacking, driving, exit, one Taxi mission, one Courier mission, Mayhem Survival, building purchase/refund, East unlock, each weather state, and Mayhem reset.
2. Add DOM/browser integration tests for store subscriptions, City Pulse rendering, editor transactions, mission dialogue choices, and input focus conflicts.
3. If additional depth is desired beyond the current functional contract, add localized service outages, richer bridge controls, and distinct Race/Sabotage mechanics; keep broader combat polish in the separately estimated P4 scope.
4. Establish performance budgets and profile the 48-vehicle/60-pedestrian scenario before adding more content.
5. Treat P4 as a separately estimated campaign/modding/release-packaging milestone; keep the existing MIT license and add a third-party/authored-asset license inventory before distribution.
