# MetroPulse 3D GDD Compliance Audit

> **HISTORICAL — GDD v2.1 ONLY.** This document is retained as implementation
> history and must not be used as evidence of GDD v3 or MVP completion. Current
> authority and status live in `METROPULSE_3D_COMPLETION_ROADMAP.md` and
> `REQUIREMENT_TRACEABILITY.md`.

> **2026-07-15 follow-up:** The city simulation has since gained a canonical
> building-economy adapter, explicit operating upkeep, fiscal states,
> housing/jobs/employment and R/C/I demand, an explainable happiness breakdown,
> paid reversible zoning with build compatibility, simulation-clock cash flow,
> and restore hardening for IDs, rotated colliders, unknown specs, and economy
> ghosts. See `CITY_ECONOMY_ARCHITECTURE.md`. Historical test counts and the
> builder-depth limitations below describe the earlier 2026-07-11 audit tree.

## Audit identity

| Field | Value |
|---|---|
| Design source | `/Users/michaelhamilton/Downloads/__Metropulse 3D – Comprehensive Game Design Document (v2.md` |
| Internal document title | **Metropulse 3D – Comprehensive Game Design Document (v2.1)** |
| Design date | July 2026 |
| Source size | 157 lines, 8,553 bytes |
| Source SHA-256 | `b066469ef55e63ee6e3f7e9fc587aa79d32151283f855bc19bc521424e64419e` |
| Code audited | Final remediation working tree on branch `ui-enhancements`, based on `c5f2df0` |
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

> **Verification boundary:** the final remediation tree completed headless Chrome WebGL startup/render checks at 1440×1000 and 900×700. The resulting screenshots were visually inspected, and the dumped live DOM confirmed a Three.js r185 canvas, 64 vehicles, 60 pedestrians, and an initially collapsed inspector. The first screenshot exposed excessive orbital-view fog and an obstructive empty inspector; both were fixed and recaptured. The in-app browser's required automation surface was unavailable, so no click-driven browser play path, WebAudio exercise, mission completion, or cross-browser matrix is claimed. Interactive mechanics are covered by deterministic Node tests and code inspection, not a manual end-to-end playtest.

## Executive assessment

The working tree is a substantial hybrid-game prototype rather than the original static city showcase. The core mode model, shared treasury, physics takeover, pedestrian control, combat, police response, weather integration, Mayhem effects, mission state machine, builder transactions, zoning, City Pulse UI, heat maps, and minimum living-agent populations all have direct code evidence. Automated tests cover the most failure-prone domain and integration logic.

The direct functional P0–P3 contract now has implementation and rendered-startup evidence. In addition to the economy, world, control, and presentation work described below, Race now uses ordered checkpoints and an authored rival roster; Sabotage requires a stopped, proximity-gated disruption interaction; one `InputManager` owns keyboard state and contextual action priority; and a tested performance policy supplies spatial hashes, high/medium/low detail tiers, low-poly vehicle/pedestrian proxies, distance-tier animation cadence, and cheaper far-agent terrain alignment. Final runtime compliance still requires an interactive acceptance pass. Remaining risks are subjective handling/feel, recommended whole-application ECS/MVVM deviations, and the absence of a measured performance budget. The explicitly future P4 campaign, combat polish, additional content, and modding work remains deferred.

**Matrix outcome:** 71 requirements are **Met**, 4 are **Partial** (subjective experience acceptance, whole-application ECS/MVVM recommendations, and measured performance acceptance), and 5 explicitly future P4 requirements are **Deferred**.

### Post-review compliance remediation (2026-07-11)

An independent engineering/UI review found release-quality gaps outside the original startup-only verification boundary. The current working tree now includes the following additional remediation:

- City Tools collapses to a persistent, keyboard-focusable rail instead of translating its reopen control off-screen; `aria-expanded`, labels, and titles remain synchronized.
- Keyboard E and gamepad Y share one mission-first contextual action route, including Sabotage and nearby mission acceptance.
- The City Editor now provides honest Place/Move/Rotate/Delete tools. Moving or rotating a user structure synchronizes its Three.js transform, footprint, physics collider, traffic-road registration, economy position, selection affordance, and saved state.
- Catalog cards and carousel pages are semantic buttons with pressed state; camera presets have descriptive accessible names; accordions are real disclosure buttons; range inputs retain visible focus; dialogue is a labelled modal with Escape, focus containment, and focus restoration; reduced-motion preferences are honored.
- The 375×812 editor uses a dedicated compact layout. Browser measurement reports `scrollWidth === clientWidth === 375`, with the catalog tray and transform toolbar entirely inside the viewport.
- Dynamic alerts, mission prompts, and pedestrian prompts construct text nodes instead of interpolating runtime values into `innerHTML`. A restrictive browser Content Security Policy and referrer policy are declared in `index.html`.
- A versioned local persistence layer restores treasury/economy records, user buildings, zoning, district unlocks, mission narrative/run state, time, weather, Mayhem, and heat-map settings. It provides automatic bounded writes plus explicit Save City and Start New City controls.
- Initialization/unhandled-operation recovery now presents an actionable alert and preserves the local city session.
- The HUD now uses a context-aware command ribbon instead of hard-coded mixed-device prose. It switches live between keyboard/mouse and Xbox glyphs for management, builder, driving, on-foot, and dialogue contexts.
- Xbox support now extends beyond vehicle physics: D-Pad UI navigation, A/B activation/back behavior, analog pedestrian movement, modal navigation, contextual combat/interact actions, and a controller-driven City Builder placement reticle all share the centralized input owner. Activity hysteresis rejects ordinary stick drift and button releases are sampled every frame, so switching and repeated presses remain reliable.
- Management chrome was streamlined into a single progressive-disclosure City Tools surface, removing duplicate obstructive City Pulse/alert cards. Action mode now hides management-only chrome and the inspector after takeover, while mobile starts with a compact tools rail and retains a no-overflow editor.
- Follow-up HUD remediation replaces competing absolute bottom offsets with an explicit command stack for Mayhem news, adaptive controls, and simulation time. The right telemetry rail reflows market, inspector, minimap, and speedometer states; direct control retains an expandable labelled City Tools rail; Builder and mobile variants suppress or substitute contextually redundant overlays instead of allowing them to collide.

Verification after remediation: **55 Node tests pass**, production build succeeds (50 modules), full-project syntax and whitespace checks pass, `npm audit` reports **0 vulnerabilities**, and interactive browser checks pass for the streamlined desktop hierarchy, keyboard Builder transition, immersive on-foot transition, context prompt changes, sidebar collapse/reopen, 390×844 no-overflow management/editor layouts, semantic catalog controls, explicit save, and reload restore with no console warnings or errors. Physical Xbox hardware and the cross-browser street/mission matrix remain final device-lab acceptance work. The Three.js core chunk remains above Vite's advisory threshold.

## Requirement-to-implementation matrix

### 1. Product concept and dual-loop contract

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **PLAT-01** — Browser game using Three.js and Vite (GDD L5–6) | P0 | Met | `package.json`, `vite.config.js`, `src/main.js`, `src/world/SceneManager.js` | `npm run build` succeeds. Final-tree headless Chrome rendered the Three.js r185 canvas at desktop and narrow viewports; no click-driven browser flow was performed. |
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
| **CITY-05** — City Pulse displays budget, energy, population, and happiness (L32) | P2 | Met | Live subscriptions and fields in `src/ui/UIManager.js`, `index.html`, and `EconomySystem.snapshot()`. Land value, services, and reputation are also shown. | Store behavior is tested; final desktop screenshot/live DOM confirm populated startup values render. |
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
| **MISSION-01/02/03** — Trigger zones, timers, waypoints, lifecycle (L141) | P2 | Met | Validated pickup rings, proximity eligibility, explicit states, timers, destination beacon/HUD/minimap markers, completion/failure/cooldown in `MissionSystem`. | Focused mission-system tests cover validation, eligibility, state, timers, Race, Sabotage, payout, and congestion. Startup markers render; active mission flow is not click-verified. |
| **MISSION-04/05/06** — Taxi A→B, time pressure, traffic satisfaction, branching clues (L76, L143) | P2 | Met | Taxi content, time limits, congestion sampling, satisfaction-scaled payout, and dialogue trees in mission data/runtime. | Adjusted payout and satisfaction are tested. Dialogue DOM choices are not browser-tested. |
| **MISSION-07/08** — Courier bridge/district runs and rival-corporation plot (L77, L143) | P2 | Met | Multiple timed Courier missions cross districts/bridge and include Quantum/Aether and NeoTech/Orbital conflict. | Courier uses the shared delivery objective rather than a separate rival-racer AI system. The GDD only requires racing against ambient AI traffic, which is present. |
| **MISSION-09/10** — Mayhem Survival climax with hazards and high-tier vehicle (L78) | P3 | Met | `mission_mayhem_escape` is `SURVIVAL`, requires a sports vehicle, enables Mayhem, completes when its timer expires, and suppresses destination beacons/minimap dropoff markers that do not apply to survival. | Survival timer behavior is tested; live comet evasion is not. |
| **MISSION-11** — Race, delivery, and sabotage content (L79) | P3 | Met | Delivery retains the destination flow; Race uses validated ordered checkpoints, authored named rivals, rival finish pressure, checkpoint HUD/minimap routing, and a loss state; Sabotage requires arrival, a stopped vehicle, an E-triggered jammer action, and an uninterrupted hold period. | Distinct Race/Sabotage state-machine paths and validation are covered by `test/MissionSystem.test.js`. Rival progress is deterministic rather than represented by physical rival vehicles. |
| **DIALOGUE-01/02** — JSON branching parser and overlay (L122, L142) | P2 | Met | Branching trees in `src/data/missions.json`; structural validation in `MissionSystem`; node/choice renderer in `DialogueOverlay`; HTML overlay. | Broken references are tested. Actual choice clicking/typewriter presentation is not browser-tested. |
| **NARR-01** — Corporate cyber-crime thriller involving named corporations (L82) | P3 | Met | Mission dialogue explicitly connects Quantum Dynamics, Aether Skyspire, NeoTech, Orbital Systems, and the comet-guidance conspiracy. | Content is present; full narrative coherence has not been playtested. |
| **NARR-02/03** — Begin at the Mayhem climax and reveal the campaign in reverse chronology (L83, L149) | P4 | Deferred | Chapters 1–5 and the climax premise exist in mission data; `narrativeState` records progress. | Missions are all available and no campaign sequencer enforces reverse chronology. This remains an explicit future-phase deliverable. |

### 6. UI, HUD, controls, and art direction

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **ART-01/03** — Low-poly neon world and dark glassmorphic UI (L90–91) | P3 | Met | Procedural low-poly geometry/emissive accents; extensive glass-panel/neon styling in `src/index.css` and `index.html`; ACES tone mapping. | Visual consistency/readability was not reviewed in a browser or against the referenced screenshot. |
| **ART-02** — Bloom (L90) | P3 | Met | `SceneManager` renders through `EffectComposer`, `RenderPass`, and a restrained `UnrealBloomPass`; resize handling updates the composer. | The pass is wired into production rendering, but its visual balance has not been reviewed in a browser. |
| **ART-04** — Hand-drawn/sketchy dialogue portraits (L92) | P3 | Met | `DialogueOverlay.renderSketchPortrait()` deterministically draws seeded, multi-pass ink outlines, hatching, face details, and role-specific accents into an accessible canvas for each character. | The procedural implementation satisfies the sketch style in code; final visual composition/readability remains browser-unverified. |
| **UI-01/02/03/04** — Top bar stats, time/weather, mode toggle, and alert feed (L95) | P2 | Met | `index.html` and `UIManager` expose and update all named elements, plus happiness/FPS; `TimeManager.getFormattedTime()` supplies live timestamps; responsive dashboard rules separate the top, side, bottom, minimap, and Action HUD regions. | Desktop and narrow headless screenshots plus live DOM confirm populated startup rendering and primary-region separation; interaction states remain click-unverified. |
| **UI-05/06/07** — CITY TOOLS sidebar for zoning, infrastructure, atmosphere, overlays, heat map, and modes (L96) | P2 | Met | Named controls and handlers in `index.html`, `UIManager`, and `CityEditorUI`. | Bridge Priority is a live control, although its management depth is limited to the single lever described under CITY-01. |
| **UI-08/09** — Context inspector with Take Control, Hijack, Combat, and Follow (L97) | P1/P2 | Met | `InspectorHUD` registration and contextual actions in `UIManager`; eligibility-specific labels/visibility. | Click behavior and the timed hijack presentation are not browser-tested. |
| **HUD-01** — Street minimap using a secondary orthographic camera (L98) | P2 | Met | `MinimapHUD` owns a real `THREE.OrthographicCamera`, updates it around the current focus, and projects roads, rivers, agents, player, congestion, pickups, and waypoints through it. | Projection uses the specified camera type while drawing the resulting schematic into a 2D canvas rather than a second WebGL scene render. Final screenshots confirm readable startup canvas output. |
| **HUD-02/03/04** — Speedometer, mission ticker, and dialogue overlay (L98) | P2 | Met | Live speed/gear UI, mission objective/timer/fare HUD, and branching dialogue DOM are present. | Browser rendering and input focus were not verified. |
| **HUD-05/06** — Minimap markers and satirical news chyron (L99) | P2 | Met | Mission/player/agent markers in `MinimapHUD`; reactive/static satire in the news chyron and mission payout updates. | Rendering is not browser-verified. |

### 7. Architecture, engineering, and performance

| Requirement | Pri | Status | Implementation evidence | Verification and remaining gap |
|---|---:|---|---|---|
| **ARCH-01/02/03** — Central state, input handling, and physics ownership (L113–114, L124) | REC/P1 | Met | DOM-free `GameManager` and `EconomySystem`; one `InputManager`; `PhysicsWorld`; root composition in `src/main.js`. | Duplicate Traffic/Mission keyboard listeners were removed. Contextual E priority, exit, pedestrian action, horn/siren, movement state, and gamepad routing now share `InputManager`; routing priority has focused tests. |
| **ARCH-04/05/06/07/08** — Separated entity/system/UI/data responsibilities (L114–117) | REC | Met | Dedicated player/AI entity classes, mission/dialogue/traffic/economy systems, UI modules, and JSON mission content. | Exact recommended folder layout differs, but functional boundaries exist. |
| **ARCH-09** — Entity-component style separating rendering and logic (L120) | REC | Partial | Some domain stores are renderer-free and player physics sync is explicit. | Vehicle/Pedestrian and large system classes still combine meshes, AI, input, audio, and DOM interactions; there is no general ECS/component composition. |
| **ARCH-10** — Central tick updates physics before Three.js transforms (L120) | REC | Met | `src/main.js` orders input, physics, simulation systems, UI, camera, and rendering; `PlayerVehicle.syncMesh()` copies physics authority to rendering. | Ordering is code-evidenced; frame behavior is not profiled. |
| **ARCH-11** — MVVM-like UI separation (L121) | REC | Partial | Observable immutable stores feed UI subscriptions, which is a meaningful ViewModel boundary. | `UIManager`, mission, pedestrian, and traffic systems still manipulate DOM directly and read the root app graph. |
| **ARCH-12** — Nearby player detail with bounded lifecycle (L123, L126) | P3/REC | Met | `PerformanceSystem` maintains vehicle/pedestrian spatial hashes around a controlled-entity/orbit focus, assigns high/medium/low detail tiers, throttles distant limb/wheel animation, and bounds local collision/proximity queries. Physics resources and ambient audio retain explicit distance/lifecycle controls. | Movement stays continuous at every tier; only expensive detail work is reduced. Spatial-query and tier behavior are tested. |
| **PERF-01** — Instancing (L126) | P3/REC | Met | Instanced crosswalk stripes and thousands of skyscraper windows in `CityBuilder` and `BuildingFactory`. | Draw-call counts were not measured in this audit. |
| **PERF-02/03/04** — LODs, culling, and near-player detailed simulation (L126) | P3/REC | Partial | Authored low-poly vehicle boxes and pedestrian capsules replace high-detail child meshes at the far tier; medium/far agents reduce shadow and animation work; spatial hashing replaces common full-population collision/proximity scans; renderer frustum culling and distance-limited audio remain active. | Policy and proxy transitions have deterministic tests, but no target-device FPS percentile, memory/load budget, or repeatable browser performance harness exists. |
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
| Renderer configuration used the deprecated `PCFSoftShadowMap` constant. | `SceneManager` now uses supported `THREE.PCFShadowMap` while retaining explicit shadow-map setup. | Production build/JS syntax checks pass and final startup WebGL rendering completes; detailed shadow-quality grading remains subjective. |
| Initial management view and fixed dashboard positioning could obscure the intended orbital overview or overlap HUD regions. | `SceneManager` starts at the bird's-eye preset; responsive CSS establishes separate desktop/Action/narrow-screen dashboard regions. | Final 1440×1000 and 900×700 headless screenshots confirm the primary startup regions render without overlap. |
| Contextual actions were split across `InputManager`, `TrafficSystem`, and `MissionSystem` keyboard listeners, making E/Shift priority order fragile. | Removed the duplicate keyboard map/listeners and centralized mission interaction, vehicle exit, pedestrian action, horn/siren, movement, and gamepad routing in `InputManager`; mission interaction explicitly wins over vehicle exit. | `test/InputManager.test.js`; existing gameplay/input-path tests. |
| Race and Sabotage data were promoted as shipped objectives but reused generic destination completion. | Race now advances ordered checkpoints against authored rivals and exposes the current target to HUD/minimap; Sabotage now requires stopped, in-range activation and a maintained disruption timer, with movement resetting progress. | Race/Sabotage state-machine and validation regressions in `test/MissionSystem.test.js`. |
| Common vehicle/pedestrian scans were quadratic and all agents retained full render/animation detail. | Added reusable XZ spatial hashes, controlled-entity/orbit-focused detail tiers, low-poly vehicle/pedestrian proxies, distance-tier animation cadence, shadow reduction, and one-sample far-agent terrain alignment. | `test/PerformanceSystem.test.js`; 48/60 population-floor and gameplay suites remain green. |
| The single application bundle reduced cache efficiency and remained above the build warning threshold. | Rolldown groups Three.js core, Three.js addons, cannon-es, and application code independently; the application chunk fell from about 1,000 kB to 336.16 kB, with stable framework and physics code separately cacheable. | Production build reports application 336.16 kB, physics 99.01 kB, Three.js addons 35.32 kB, and Three.js core 541.49 kB. The single-module Three.js core chunk remains slightly above 500 kB. |
| Desktop rendered acceptance exposed an overly fogged orbital overview and an empty inspector obscuring the city. | Fog density now fades with camera altitude while preserving weather visibility ratios; the inspector starts collapsed and opens on selection; close controls received accessible names; inspector values use safe text nodes. | Final 1440×1000 and 900×700 headless Chrome screenshots plus live DOM dump. |

## Verification record

Commands executed from the repository root on 2026-07-11:

| Command | Result | What it establishes |
|---|---|---|
| `npm test` | **48 tests passed, 0 failed** | Existing state/economy/gameplay coverage plus central input priority, Race checkpoints/rival loss, Sabotage activation/hold behavior, spatial-hash locality, detail-tier policy, and low-poly proxy transitions. |
| `npm run build` | **Succeeded; 47 modules transformed; app 336.16 kB / 92.38 kB gzip; physics 99.01 kB / 28.48 kB gzip; Three.js addons 35.32 kB / 8.08 kB gzip; Three.js core 541.49 kB / 136.01 kB gzip** | Vite/Rolldown parses, links, and produces separately cacheable gameplay, physics, addon, and rendering chunks. |
| `node --check` across project/test JS | **42 files passed** | All repository JavaScript outside generated/dependency directories passes Node syntax parsing. |
| HTML ID uniqueness check | **89 IDs; 89 unique** | `index.html` contains no duplicate element IDs, reducing ambiguous DOM lookups. |
| `git diff --check` | **Succeeded** | No whitespace-error diagnostics in tracked changes. |
| Final-tree headless Chrome WebGL, 1440×1000 | **Rendered and recaptured after remediation** | Desktop startup canvas/HUD composition is current-tree evidence. The initial capture exposed fog/inspector issues; the post-fix image shows improved city contrast and no empty inspector obstruction. |
| Final-tree headless Chrome WebGL, 900×700 | **Rendered successfully** | Narrow layout keeps primary header, city tools, minimap, and time controls readable; contextual inspector remains closed until selection. |
| Final-tree live DOM dump | **Three.js r185 canvas; 64 vehicles; 60 pedestrians; inspector hidden** | Confirms the screenshot is a live initialized simulation rather than static HTML. This is startup evidence, not an interactive play path. |

Test suites:

- `test/CameraRig.test.js` — shake is render-only and cannot accumulate into the authoritative orbit pose; independent chase mouse-look yaw changes the desired camera pose.
- `test/BuilderEconomyIntegration.test.js` — city-editor economy records preserve placed amenity positions and influence radii.
- `test/GameManager.test.js` — mode validation, transitions, Mayhem independence, restoration, and subscriptions.
- `test/EconomySystem.test.js` — treasury, deterministic passive income, buildings, aggregate service penalties, spatial land-value falloff, missions, incidents, City Pulse, district unlocks, and subscriptions.
- `test/GameplaySystems.test.js` — cannon-es grip/cleanup, colliders, vehicle state, police response, exit control, spatial crime feedback, timed hijacking, camera shake, and population floors.
- `test/InputManager.test.js` — contextual mission interaction wins over exit, with verified vehicle/pedestrian fall-through behavior.
- `test/MissionSystem.test.js` — content validation, eligibility, vehicle binding, timers, survival, Taxi payout/satisfaction, Race checkpoints/rivals, Sabotage interaction/hold state, repeat-run narrative semantics, and congestion estimation.
- `test/PerformanceSystem.test.js` — spatial-query locality, deterministic detail tiers, animation policy, and interactive-root-preserving vehicle/pedestrian proxies.
- `test/TrafficManagement.test.js` — bridge priority, bridge/general congestion metrics, user-road graph registration/removal, and custom bridge traversal/destruction behavior.
- `test/UIManagerEconomy.test.js` — the building inspector surfaces local parcel land value and amenity/Mayhem influences while ignoring unrelated entity types.

The previous 1,000.45 kB application bundle is now split into 336.16 kB application, 99.01 kB physics, 35.32 kB Three.js addon, and 541.49 kB Three.js core chunks. The single-module Three.js core still crosses Vite's default 500 kB warning threshold, but gameplay/addon changes can now be cached independently. The remaining **Partial** performance status is driven primarily by missing target-device measurements and budgets, not an absence of runtime policy.

## Known residual limitations and acceptance work

1. **The click-driven acceptance run is targeted, not a full gameplay matrix.** Sidebar collapse/reopen, editor entry, semantic controls, 375×812 layout, explicit save, and reload restore are now browser-verified. Pointer capture, WebAudio unlock, full driving feel, actual mission completion, and Mayhem restoration still need a Chrome/Safari/Firefox gameplay matrix.
2. **No design-reference comparison.** The screenshot referenced by the GDD was not embedded in the Markdown source. Current desktop/narrow screenshots were inspected for standalone usability, but not compared with the missing reference.
3. **Builder depth beyond the written contract is compact.** Bridge management is one priority/speed lever and services use city-wide capacity/demand rather than localized outage simulation. Amenity and Mayhem land values are now spatial. The GDD's paid infrastructure/landmark expansion is implemented; it does not define an existing-asset upgrade tree.
4. **Some interaction/content depth remains compact.** Race checkpoints/authored rivals and the Sabotage hold interaction are now distinct and tested, but rivals are deterministic competitors rather than physical AI cars. Intentional drift handling still lacks dynamic/browser acceptance. Broader combat polish is P4.
5. **Mission-only visual acceptance remains outstanding.** The final startup canvas, HUD, bloom, and minimap composition were rendered, but procedural dialogue portraits, mission HUD progression, and action-camera readability were not exercised in the headless startup path.
6. **Architecture is improved but not fully ECS/MVVM.** Keyboard ownership is centralized and performance policy is separated, but large simulation classes still combine mesh construction, AI, audio, and some DOM interactions.
7. **Performance is policy-tested, not acceptance-tested.** Spatial indexing, low-poly proxies, distance tiers, animation cadence, and chunk separation now exist, but there is no target browser/device matrix, FPS percentile, frame-time, memory, load-time, or draw-call budget.
8. **Persistence is implemented locally.** Treasury/economy data, user buildings, zoning, unlocks, mission narrative/run state, time, weather, Mayhem, and heat-map settings survive reload. Cloud synchronization and save migration beyond version 1 are future delivery capabilities rather than GDD requirements.
9. **P4 remains intentionally incomplete.** Reverse-chronology campaign sequencing, expanded combat/content, modding, and future release/expansion packaging are deferred. The repository itself is already MIT-licensed.

## Recommended acceptance sequence

1. Run a browser smoke matrix covering initial load, both mode transitions, pedestrian control, hijacking, driving, exit, one Taxi mission, one Courier mission, Mayhem Survival, building purchase/refund, East unlock, each weather state, and Mayhem reset.
2. Add DOM/browser integration tests for store subscriptions, City Pulse rendering, editor transactions, mission dialogue choices, and input focus conflicts.
3. If additional depth is desired beyond the current functional contract, add localized service outages, richer bridge controls, and physical AI race rivals; keep broader combat polish in the separately estimated P4 scope.
4. Establish performance budgets and profile the 48-vehicle/60-pedestrian scenario before adding more content.
5. Treat P4 as a separately estimated campaign/modding/release-packaging milestone; keep the existing MIT license and add a third-party/authored-asset license inventory before distribution.
