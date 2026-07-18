# MetroPulse 3D Completion Roadmap

> **Status:** Active implementation roadmap  
> **Created:** 2026-07-17  
> **Design authority:** `Metropulse_3D_Comprehensive_GDD_v3.docx`  
> **Applies to:** The browser-based single-player MetroPulse 3D MVP and its release-quality completion  
> **Audience:** Engineers, designers, content authors, QA, and AI agents working in this repository

## 1. Purpose

This document turns the revised MetroPulse 3D GDD and the 2026-07-17 codebase
evaluation into an implementation plan. It is the execution roadmap for taking
the current systems prototype to a complete, polished game.

The project already contains valuable simulation, rendering, physics, traffic,
economy, mission, and interface foundations. The plan therefore assumes an
**incremental refactor**, not a rewrite. New work must preserve functioning
systems while replacing weak ownership boundaries in controlled stages.

The central product requirement is not the number of systems in the project.
It is the quality of the two-scale loop:

1. The player makes a consequential city-management decision.
2. That decision changes the playable street world.
3. The player undertakes a street-level activity or mission in that changed
   world.
4. The outcome creates visible, understandable, persistent city consequences.
5. Those consequences create the next meaningful management decision.

No phase is complete merely because its UI, data, or isolated mechanic exists.
It is complete only when its intended player-facing loop passes the acceptance
criteria defined here.

## 2. Authority and document hierarchy

When documents disagree, use this order:

1. **Revised GDD v3** — product vision, MVP scope, player experience, and
   acceptance intent.
2. **This roadmap** — implementation order, dependency plan, scope controls,
   engineering gates, and completion criteria.
3. `CITY_ECONOMY_ARCHITECTURE.md` — current economy ownership and extension
   rules where it does not conflict with the revised GDD.
4. Source code and tests — evidence of current behavior, not authority for
   retaining accidental product behavior.
5. `GDD_COMPLIANCE_AUDIT.md` — historical audit of GDD v2.1. It is useful
   background but is **not** evidence of compliance with GDD v3.

If a requirement remains ambiguous after consulting the GDD and this roadmap,
record the decision in a design-decision log before implementing it. Do not let
individual systems silently invent competing rules.

## 3. Current baseline

As of 2026-07-17:

- The production build succeeds.
- All 231 Node tests pass.
- Management, builder, on-foot, vehicle, traffic, pedestrian, weather,
  economy, mission, Mayhem, and basic persistence systems exist.
- The economy, traffic, vehicle physics, weather integration, and procedural
  city presentation are the strongest foundations.
- The game is a substantial pre-alpha systems prototype, not a complete
  vertical slice.
- The largest gaps are cross-mode consequences, state-transition ownership,
  persistence safety, onboarding, factions, progression, accessibility,
  release UX, integration tests, performance evidence, and content polish.
- A runtime review reproduced a transition defect in which entering the city
  editor after on-foot control retained an obstructed street-level camera.
  This is a representative failure of distributed transition ownership.

The baseline must remain buildable and testable throughout the roadmap.

## 4. Definition of a complete MVP

MetroPulse 3D is MVP-complete only when all of the following are true.

### 4.1 Product loop

- [ ] A new player can start, learn, and complete the first management-to-street
  loop without external instructions.
- [ ] Management conditions materially affect street missions in at least
  three clearly communicated ways.
- [ ] Street outcomes materially affect the city in at least three clearly
  communicated ways.
- [ ] The player can explain why a city metric changed and what action can
  improve it.
- [ ] Missions have preparation, approach, execution, resolution, cleanup,
  and debrief states.
- [ ] Failure leads to a bounded retry, checkpoint, recovery, or explicit
  consequence rather than a confusing reset.

### 4.2 Content

- [ ] The MVP contains 8–12 polished authored missions.
- [ ] It uses 5–7 reusable street-activity templates without making all
  missions feel interchangeable.
- [ ] A playable prologue and one complete district arc exist.
- [ ] Three or four faction/reputation tracks create meaningful tradeoffs.
- [ ] Operator, Broker, and Magnate progression tiers unlock capabilities,
  not merely larger numbers.
- [ ] West Core, Central Park, and the primary bridge form a polished,
  navigable MVP world.
- [ ] East-side expansion and other post-MVP areas are hidden, gated, or
  explicitly labeled as non-MVP content.

### 4.3 Platform and usability

- [ ] The player can start a new game, resume a valid save, recover from a bad
  save, and understand when saving is in progress.
- [ ] Keyboard and mouse controls are fully remappable.
- [ ] Required accessibility options work in real gameplay, not only menus.
- [ ] Pause stops all gameplay-relevant simulation and does not corrupt timers,
  missions, input state, or physics.
- [ ] The game communicates minimum-browser incompatibility before entering a
  broken session.
- [ ] The MVP is playable at 30 FPS on the defined minimum target and targets
  60 FPS on the recommended target.

### 4.4 Quality

- [ ] Fifty repeated mode-transition cycles complete without camera, input,
  ownership, audio, entity, or memory corruption.
- [ ] A two-hour soak completes without an unbounded resource increase or
  simulation degradation.
- [ ] Save migration, corruption recovery, and interrupted-write tests pass.
- [ ] Critical game flows have browser-level integration coverage.
- [ ] The release candidate has no open P0 or P1 defects and no knowingly
  misleading interface state.
- [ ] Art, audio, animation, writing, balance, and interface review have each
  received a dedicated polish pass.

## 5. Non-negotiable production principles

### 5.1 Extend; do not rewrite

No missing GDD v3 feature currently requires a complete rewrite. Work should
use a strangler-style approach:

- Introduce the new interface or owner beside the old path.
- Move one tested behavior at a time.
- Keep compatibility adapters only while they are required.
- Delete an old path only after its replacement passes integration tests.
- Avoid whole-project abstractions introduced without a concrete consumer.

A new engine, full ECS conversion, or wholesale replacement of Three.js,
Cannon, the economy, traffic, or procedural world is out of scope.

### 5.2 One authoritative owner per concept

There must be one owner for each of the following:

| Concept | Intended authority |
|---|---|
| Game/session state | `GameManager` or a successor game-session state machine |
| Mode-transition orchestration | A dedicated transition coordinator owned by the game session |
| Simulation timing and pause | A central simulation scheduler |
| Input sampling and action resolution | `InputManager` plus an action/interaction service |
| City economy | `EconomySystem` |
| Save format and persistence | A new `SaveService` |
| Settings and bindings | A new renderer-independent settings store |
| Mission rules and lifecycle | Mission domain/controller layer, separate from DOM and Three.js |
| UI presentation | UI modules consuming snapshots/events, not owning game rules |
| Physics integration | `PhysicsWorld` behind a narrow adapter boundary |

No UI module may create a second truth for money, mode, mission status,
weather, Heat, progression, or save state.

### 5.3 Scope before breadth

Until Phase 8 is exited, do not add:

- New districts beyond the approved MVP footprint.
- Additional mission-template families beyond the approved 5–7.
- New vehicle classes without a mission, progression, or accessibility need.
- Multiplayer, cloud saves, mobile-specific gameplay, interiors, mod support,
  or platform-account features.
- More aircraft, rocket, countryside, or East-side content.
- New scalar city systems that do not change a player decision.

Existing post-MVP systems may remain in the repository, but they must be
feature-flagged or excluded from the first-session experience if they distract
from the MVP.

### 5.4 Acceptance over presence

The following do **not** count as completion by themselves:

- A button exists.
- Data contains a field.
- A unit test covers an isolated helper.
- A system can be triggered through developer tools.
- A mechanic works only in a fresh session.
- A mechanic is present but has no onboarding, feedback, recovery, or save
  behavior.

Every player-facing feature needs normal-path, failure-path, persistence,
transition, accessibility, and performance consideration proportional to its
risk.

## 6. Delivery overview

The roadmap uses nine phases. Some work may overlap, but no phase may bypass
the exit gate of a dependency it relies on.

| Phase | Goal | Indicative duration, small team | Critical dependency |
|---|---|---:|---|
| 0 | Scope lock, traceability, and delivery harness | 1–3 weeks | None |
| 1 | Authoritative game kernel and safe transitions | 4–7 weeks | Phase 0 |
| 2 | Boot, saves, settings, and platform safety | 5–9 weeks | Phase 1 interfaces |
| 3 | Golden cross-mode vertical slice | 6–10 weeks | Phases 1–2 core paths |
| 4 | Complete city-management decision layer | 6–10 weeks | Phase 3 contracts |
| 5 | Complete street gameplay and enforcement | 8–12 weeks | Phases 1 and 3 |
| 6 | Narrative, factions, progression, and content | 10–16 weeks | Phases 3–5 |
| 7 | Onboarding, accessibility, presentation, and polish | 8–12 weeks | Phases 2–6 |
| 8 | Performance, compatibility, QA, and release candidate | 10–14 weeks | All earlier phases |

The durations describe effort bands, not a promise. With overlap, the expected
calendar range is approximately 9–14 months for a small experienced team or
20–30 months for one full-time senior generalist.

## 7. Phase 0 — Scope lock and delivery harness

### Objective

Create one agreed MVP target and the verification tools needed to change the
game safely. This phase prevents the project from continuing to accumulate
impressive but disconnected systems.

### Deliverables

#### P0.1 Requirement traceability

- [x] Convert GDD v3 acceptance requirements into stable IDs grouped by game
  loop, city, street, mission, narrative, UX, accessibility, persistence,
  performance, and release.
- [x] Create a traceability table linking each requirement to its responsible
  system, test level, and current state: `Not Started`, `In Progress`,
  `Implemented`, `Verified`, or `Deferred`.
- [x] Mark the old v2.1 audit as historical at its top to prevent future agents
  from using its completion claims as current truth.
- [x] Record unresolved product decisions in a design-decision log with an
  owner and deadline.

#### P0.2 MVP scope controls

- [x] Define feature flags for aircraft, rocket launch, East-side development,
  Mayhem variants, and other post-MVP breadth.
- [x] Decide which existing non-MVP systems are hidden, retained as optional
  extras, or deferred from release testing.
- [x] Freeze the target mission count at 8–12 and activity-template count at
  5–7.
- [x] Freeze the MVP world footprint at West Core, Central Park, and the primary
  bridge unless a written GDD amendment says otherwise.
- [x] Replace Industrial with Operations in the MVP product vocabulary, or
  record a deliberate design amendment if Industrial remains.

#### P0.3 Test and diagnostics foundation

- [x] Add a browser integration test framework suitable for WebGL startup,
  DOM interaction, local IndexedDB, keyboard input, and deterministic test
  hooks.
- [x] Add a deterministic test mode that can seed traffic, pedestrians,
  weather, mission data, and time without changing production defaults.
- [x] Add development diagnostics for current state, active transition,
  scheduler pause, controlled entity, active mission, save status, entity
  counts, renderer statistics, and memory/resource counters where available.
- [x] Capture a reproducible baseline for load time, FPS, frame time, draw
  calls, triangles, active physics bodies, and core bundle sizes.
- [x] Add a smoke test that boots a clean profile and asserts no uncaught
  errors, rejected promises, or invalid UI states.

### Exit gate

- The MVP scope and deferred features are explicit.
- Every GDD v3 MVP requirement has a stable ID and verification owner.
- A clean browser session can be booted and smoke-tested automatically.
- Baseline performance and bundle measurements are recorded.
- Existing Node tests and production build remain green.

### Phase 0 completion record — 2026-07-17

- Requirements and verification ownership: `REQUIREMENT_TRACEABILITY.md`.
- Executable and documented scope: `MVP_SCOPE.md`, `src/config/MvpScope.js`,
  and `src/config/FeatureFlags.js`.
- Open and accepted decisions: `DESIGN_DECISIONS.md`.
- Deterministic browser/diagnostics contract: `TESTING_AND_DIAGNOSTICS.md`.
- Measured baseline, including the over-budget draw-call risk:
  `PERFORMANCE_BASELINE_2026-07-17.md`.
- Automated evidence: Node unit/integration suite, Playwright clean-profile
  WebGL smoke, production build, and CI gates.

## 8. Phase 1 — Authoritative game kernel and safe transitions

### Objective

Make game state, time, input, entity ownership, camera ownership, and UI
presentation transition together as one recoverable operation.

### Intended state model

At minimum, represent these states explicitly:

- `BOOT`
- `LOAD`
- `MANAGEMENT`
- `BUILDER`
- `TRANSITION`
- `STREET_ON_FOOT`
- `STREET_VEHICLE`
- `RESULT`
- `PAUSED`
- `MENU`

Mayhem remains an overlay/modifier rather than an exclusive primary mode.
Dialogue may be a modal substate when its pause and input behavior are explicit.

### Deliverables

#### P1.1 State-machine expansion

- [x] Extend `GameManager` without replacing its renderer-independent event
  model.
- [x] Define legal transitions, guards, rejection reasons, and transition
  metadata.
- [x] Prevent direct builder entry while a street handoff or mission-critical
  state is unresolved.
- [x] Define what happens to the active mission, Heat, controlled entity,
  camera, and simulation clock on every legal transition.
- [x] Make transition failure recover to a known safe state.

P1.1 completion evidence (2026-07-17):

- `src/core/GameState.js` owns the complete state catalog, legal request graph,
  and destination contracts for mission, Heat, controlled entity, camera, and
  simulation-clock behavior.
- `src/core/GameTransition.js` owns normalized transition inputs, destination
  invariants, rejection codes, and typed errors. `src/core/GameManager.js` owns
  request/commit/failure lifecycle, runtime and custom guards, immutable
  metadata, pause resume targets, restore validation, and recovery.
- Runtime control systems now request `STREET_ON_FOOT` or `STREET_VEHICLE`
  explicitly. Builder eligibility delegates to `GameManager`; it no longer
  duplicates mission/control guard policy in the editor UI.
- `test/GameManager.test.js` covers the complete state catalog and omitted
  edges, ownership contracts, builder blockers, mission-critical exits,
  metadata/effects, custom guards, pause/resume, restore, observer isolation,
  and both source-state and safe-fallback recovery.
- Verification at completion: 247 Node tests, production build, and the
  deterministic Playwright WebGL smoke test pass. The operational contract is
  documented in `GAME_STATE_MACHINE.md`.

#### P1.2 Transition coordinator

- [x] Implement a coordinator that executes transition steps in a defined
  order: validate, suspend input, clear held actions, capture source state,
  hand off entity ownership, position camera, configure simulation, configure
  UI/audio, validate destination, then commit.
- [x] Make partial transitions compensatable or idempotent.
- [x] Ensure the source controlled entity cannot be orphaned or controlled by
  two systems.
- [x] Ensure vehicle-to-pedestrian, pedestrian-to-vehicle, management-to-street,
  street-to-management, and management-to-builder handoffs preserve valid
  transforms.
- [x] Add safe camera spawn/clearance queries so a camera cannot begin inside a
  tree, building, vehicle, terrain, or water volume.

P1.2 completion evidence (2026-07-17):

- `src/core/TransitionCoordinator.js` owns the ordered synchronous transaction,
  reentrancy guard, compensation stack, unconditional cleanup, events, and
  destination-contract validation. `src/app/MetroPulseTransitionRuntime.js`
  adapts entity, camera, simulation-policy, UI, and ownership-driven audio
  effects without moving renderer concerns into `GameManager`.
- Traffic, pedestrian, aircraft, mission, camera-preset, and city-editor entry
  paths request the production coordinator. Narrow coordinated domain methods
  prevent nested transitions while preserving existing AI/physics handoffs.
- `src/camera/CameraClearanceQuery.js` and `CameraRig` share deterministic
  terrain, water, building, scenery/tree, vehicle, pedestrian, and aircraft
  clearance for both spawn and continuous chase poses.
- Unit coverage verifies exact phase order, held-input cleanup, compensation,
  destination ownership, idempotency, reentrancy, slopes, obstacle classes,
  water, and fail-closed camera search. The Playwright smoke flow performs 50
  complete management/builder/on-foot/vehicle cycles and checks transforms,
  ownership, camera clearance, input, physics bodies, and scene objects.
- Verification at completion: 258 Node tests, production build, and the
  deterministic Playwright WebGL transition soak pass. The operational
  contract is documented in `TRANSITION_COORDINATOR.md` and
  `GAME_STATE_MACHINE.md`.

#### P1.3 Simulation scheduler

- [x] Replace the monolithic per-render-frame update policy with an explicit
  scheduler.
- [x] Separate render time, real-time gameplay, fixed physics time, city logical
  time, UI time, and paused time.
- [x] Run the authoritative city simulation at a fixed logical cadence,
  initially 1 Hz unless a system has a justified different rate.
- [x] Preserve accumulator remainder rather than discarding time after each
  economy update.
- [x] Gate systems by state and pause policy.
- [x] Define a stable update order and document why each stage occurs there.
- [x] Ensure Street Mode cannot use city speed multipliers unless explicitly
  allowed by a designed assist.

P1.3 completion evidence (2026-07-17):

- `src/core/SimulationScheduler.js` owns six clock domains, state-clock gates,
  fixed physics and city accumulators, catch-up budgets, immutable diagnostics,
  unique task registration, and deterministic stage/task order without a
  renderer, physics-engine, DOM, or game-system dependency.
- `src/app/MetroPulseSimulationSchedule.js` is the sole production schedule.
  `main.js` now only supplies animation-frame timestamps; it no longer advances
  systems or owns economy timing. `PhysicsWorld.stepFixed` exposes one narrow
  integration interval while its compatibility `step` path remains available.
- Economy and time-of-day receive exact one-second logical ticks. Fractional
  and budget-deferred remainders persist. City and Builder use the selected
  city speed; Street forces a running city clock to exactly 1x, so multipliers
  never affect Street missions, physics, AI, weather, or logical city time.
- Transition configuration and compensation set or restore the scheduler's
  authoritative clock policy. Paused/stopped policies halt gameplay, physics,
  and city tasks while input, UI, camera, and rendering remain responsive for
  P1.4's menu and accessibility work.
- Unit coverage verifies clock separation, exact order, state/pause gates,
  retained remainders/backlog, multiplier isolation, extensible registration,
  timestamp clamping, and the production economy/time schedule. The operational
  contract is documented in `SIMULATION_SCHEDULER.md`.
- Verification at completion: 269 Node tests, production build, and the
  deterministic Playwright WebGL transition soak pass.

#### P1.4 Pause and modal behavior

- [x] Implement a true pause state and pause menu.
- [x] Stop mission timers, Heat decay, physics authority, AI decisions, weather
  clocks, and city simulation according to the pause contract.
- [x] Keep menu animation and accessibility navigation responsive.
- [x] Clear or quarantine held inputs when pausing, resuming, losing focus, or
  changing device.
- [x] Test pause during driving, walking, combat, dialogue, mission result,
  builder placement, and Mayhem.

P1.4 completion evidence (2026-07-17):

- `src/core/PauseManager.js` owns reference-held pause intent on top of
  `GameManager`'s canonical `PAUSED` state. Nested dialogue and menu holds cannot
  resume each other, stale releases are idempotent, and failed resumes retain a
  recoverable hold.
- `src/ui/PauseMenu.js` and the static pause markup provide a labelled modal,
  focus trap, visible focus, keyboard/gamepad operation, reduced-motion support,
  and exact resume-state feedback. `DialogueOverlay` acquires its own modal
  pause hold for its visible lifetime.
- `InputManager` clears and quarantines keyboard, analog, and button state at
  transition, focus-loss, visibility-loss, resume, and device-change boundaries.
  World-click combat input moved under the same owner so it cannot bypass pause.
- The production schedule stops mission, Heat/AI, physics, weather, city,
  economy, Mayhem, alert, and gameplay-derived presentation time while UI,
  accessibility navigation, camera, diagnostics, and rendering remain live.
- Unit coverage verifies every pausable state, nested/rapid modal operations,
  exact clock policy, Mayhem preservation, and held-device quarantine. The
  Playwright WebGL flow verifies management, builder, walking, driving, combat,
  dialogue, result, active mission, Heat, weather, physics pose, city economy,
  and Mayhem pause behavior with real DOM and keyboard input.
- Verification at completion: 277 Node tests, production build, and the
  deterministic Playwright WebGL smoke/transition/pause acceptance flow pass.
  The operational contract is documented in `PAUSE_AND_MODAL_BEHAVIOR.md`.

#### P1.5 Interaction priority

- [x] Replace hard-coded mission/vehicle/pedestrian branching with an
  interaction service.
- [x] Let interactables publish eligibility, priority, prompt, action,
  failure reason, distance, and accessibility label.
- [x] Guarantee one primary interaction prompt at a time.
- [x] Make action resolution deterministic when multiple vehicles, NPCs,
  mission points, or doors overlap.

P1.5 completion evidence (2026-07-17):

- `src/systems/InteractionService.js` owns the renderer-independent candidate
  contract, immutable snapshots, provider registry, deterministic total order,
  reentrancy guard, and isolated failure/action resolution. `InputManager`
  now has one keyboard/gamepad primary-action route with no domain branching.
- Mission, aircraft, traffic, pedestrian, and selected-entity owners publish
  eligibility, priority, prompt, action, failure reason, distance,
  accessibility label, and stable metadata through the production composition
  in `src/app/MetroPulseInteractions.js`.
- `src/ui/InteractionPrompt.js` is the only primary prompt presenter. It shows
  the active keyboard/gamepad binding, publishes an accessible live-region
  label, exposes eligibility without color-only meaning, and clears in Builder,
  Pause, and Dialogue contexts.
- Unit coverage verifies contract validation, immutable snapshots, mission /
  vehicle / NPC / door overlaps, every tie-break, blocking failure reasons,
  action/provider exceptions, publisher output, and keyboard/gamepad routing.
  The Playwright WebGL flow verifies one prompt, prompt/action agreement,
  vehicle exit, and prompt clearing during pause and dialogue.
- The operational and extension contract is documented in
  `INTERACTION_PRIORITY.md`.
- Verification at completion: 287 Node tests, the production build, and the
  deterministic Playwright WebGL smoke/transition/pause/interaction acceptance
  flow pass.

### Required tests

- State transition table tests for every legal and illegal edge.
- Fifty-cycle transition soak covering management, builder, on-foot, and
  vehicle states.
- Held-key, focus-loss, rapid-toggle, and interrupted-transition tests.
- Camera-clearance tests near buildings, trees, bridges, water, and slopes.
- Ownership invariants: one controlled entity or none, never more than one.
- Pause tests for every gameplay clock.
- Browser regression for the previously observed obstructed editor-camera flow.

### Exit gate

- No feature writes game mode outside the state-machine API.
- No feature independently owns a conflicting pause or time-scale flag.
- The reproduced camera/state handoff defect is fixed and browser-tested.
- Fifty automated transition cycles complete without state, camera, input,
  audio, entity, or resource leakage.
- The scheduler and update order are documented and covered by tests.

## 9. Phase 2 — Boot, persistence, settings, and platform safety

### Objective

Create a safe session lifecycle. Players must be able to start, resume, save,
recover, configure, and pause the game without relying on browser internals.

### Deliverables

#### P2.1 Boot and load flow

- [x] Add a boot screen that performs capability checks, data validation,
  settings load, save discovery, and initial asset preparation.
- [x] Offer `New Game`, `Continue`, and `Recover Previous Save` only when each
  action is valid.
- [x] Show actionable compatibility errors for missing WebGL or storage
  capabilities.
- [x] Show progress for operations long enough to be perceived as loading.
- [x] Never enter an interactive state before required world, input, save, and
  mission services are ready.

P2.1 completion evidence (2026-07-18):

- `src/boot/BootPipeline.js` runs the fail-closed capability, mission-data,
  bootstrap-settings, save-discovery, and asset-preparation stages before any
  world service is constructed. Stage progress and failures are immutable,
  observable contracts rather than DOM-owned rules.
- The static, accessible boot surface and `src/ui/BootScreen.js` keep the game
  root inert until a session action completes. New, Continue, and Recover are
  derived from validated discovery results; starting over preserves the valid
  current city as a recovery source.
- Hardware WebGL 2 plus real LocalStorage and transactional IndexedDB writes are
  required. Missing capabilities produce targeted remediation while keeping
  WebGL, world, input, save, and mission services unconstructed.
- `GameManager` owns the complete `BOOT -> LOAD -> MENU -> LOAD -> MANAGEMENT`
  lifecycle. `MetroPulseApp.assertReady()` releases interaction only after the
  renderer/world, input, persistence, mission, scheduler, and transition
  services exist and the authoritative state reaches Management.
- Mission validation moved to `src/data/MissionDataValidator.js` so boot and the
  mission domain share one validation implementation. The legacy v1 save and
  narrow settings readers are replaceable adapters for P2.2 and P2.3, not new
  persistence authorities.
- Verification at completion: 293 Node tests, production build, and three
  Playwright WebGL flows pass. Coverage includes clean New Game boot, disabled
  invalid actions, current/recovery discovery, recoverable New Game behavior,
  actionable capability failure, and the complete prior transition/pause/
  interaction regression suite. The operational contract is documented in
  `BOOT_AND_LOAD_FLOW.md`.

#### P2.2 Versioned SaveService

- [x] Introduce an IndexedDB-backed `SaveService` with an explicit schema
  version independent of feature versions.
- [x] Preserve the existing LocalStorage v1 loader as a one-time migration
  source.
- [x] Save game state, economy, world edits, controlled entity, player pose,
  current mode, time, weather, missions, active mission/checkpoint, factions,
  progression, Heat, settings, bindings, alerts, and stable content IDs.
- [x] Use transactional writes and retain a previous-known-good recovery slot.
- [x] Validate data before applying it to live systems.
- [x] Add forward migration functions and reject unsupported future saves with
  a clear message rather than partial restoration.
- [x] Define what is intentionally not saved, such as transient particle state.
- [x] Add autosave reasons, debounce policy, checkpoints, and a visible saving
  indicator.
- [x] Ensure a failed save does not destroy the previous valid save.

P2.2 completion evidence (2026-07-18):

- `src/save/SaveService.js` owns save policy, full-document validation,
  restoration staging, status publication, autosave coalescing, and named
  checkpoints. `src/save/SaveGameState.js` keeps domain capture and restore
  logic out of storage mechanics.
- `src/save/IndexedDbSaveRepository.js` writes current and previous-known-good
  recovery slots atomically. Recovery promotion never rotates a corrupt current
  value over the selected recovery source, and interrupted writes preserve both
  committed slots.
- The envelope schema, independent schema/feature/domain versions, sequential
  migration registry, LocalStorage v1 conversion, future-version rejection,
  stable content-reference checks, and explicit transient exclusions live in
  `src/save/SaveSchema.js`.
- Boot discovery now reads IndexedDB asynchronously, uses LocalStorage only as
  an absent-slot migration source, and supplies the validated selected document
  to runtime composition. Static domains restore before interactivity; player
  authority, pose, active mission, current mode, and pause restore only after
  `TransitionCoordinator` and `PauseManager` are ready.
- The management UI exposes an accessible live saving indicator. Manual saves,
  debounced reasons, checkpoint IDs, page-hide saves, and failure messaging all
  use the same service contract.
- Unit fixtures cover schema migration, unsupported future data, legacy
  conversion, full-domain envelopes, validation-before-mutation, recovery
  rotation, corrupt references, coalesced autosave reasons, checkpoints, and
  interrupted writes. The operational and extension contract is documented in
  `VERSIONED_SAVE_SERVICE.md`.
- Verification at completion: 298 Node tests, the production build, and all
  three Playwright WebGL boot/transition/pause/interaction/save flows pass,
  including real IndexedDB migration, manual save, reload, and Continue.

#### P2.3 Settings and bindings store

- [x] Create one renderer-independent settings schema with defaults, validation,
  versioning, and persistence.
- [x] Support remapping for every required keyboard/mouse action.
- [x] Detect binding conflicts and provide reset-to-default by context and
  globally.
- [x] Store mouse sensitivity, camera sensitivity, audio channels, subtitle
  preferences, text scale, contrast mode, color-safe patterns, motion settings,
  toggle/hold choices, driving assists, difficulty, and timer leniency.
- [x] Make UI prompts render the current binding rather than static labels.
- [x] Keep controller support only if it meets the same state and prompt
  correctness; otherwise classify it as post-MVP rather than blocking core
  keyboard/mouse completion.

P2.3 completion evidence (2026-07-18):

- `src/settings/SettingsStore.js` is the renderer-independent authority for a
  versioned settings document, atomic LocalStorage persistence, immutable
  snapshots/events, schema-v1 migration, scoped/global reset, and validated
  save restoration. `src/settings/SettingsSchema.js` owns all defaults, ranges,
  enums, and the complete preference contract.
- `ControlBindings` now defines every required keyboard/mouse action by control
  context. Overrides are validated against known contexts/actions and compatible
  input kinds; same-context conflicts, duplicates, browser-reserved keys, and
  invalid pointer/keyboard substitutions fail before persistence. Controller
  bindings remain fixed and continue to use the same context and prompt paths.
- `InputManager`, selection, Builder placement, orbit/street/chase camera input,
  adaptive controls, mission hints, and the primary interaction prompt resolve
  live bindings from the store. Binding changes clear held input and refresh
  visible prompts immediately; toggle/hold braking and sprint share the same
  authoritative input state.
- The accessible pause settings surface edits every required preference and
  binding, captures keyboard/mouse inputs, reports conflicts without overwriting
  the valid binding, resets one context or all bindings, and supports complete
  preference reset. Text scale, contrast/color patterns, motion reduction,
  camera sensitivity/shake, bloom/flashes, master/ambience audio, timer leniency,
  and vehicle auto-recovery are connected to live consumers without reload.
- Save capture and restore use the store snapshot rather than parallel
  `app.settings` or `bindingOverrides` truths. Older P2.1/P2.2 settings payloads
  migrate through the same validator before any live restore mutation.
- Verification at completion: 306 Node tests, the production build, and all
  four Chrome WebGL acceptance flows pass. Browser coverage proves immediate
  remapping, prompt correctness, conflict rejection, old/new action behavior,
  live text scaling, persistence, and reload restoration. The operational and
  extension contract is documented in `SETTINGS_AND_BINDINGS_STORE.md`.

#### P2.4 Data validation

- [x] Validate missions, dialogue, buildings, zones, districts, factions,
  progression, weather, and save data at load time.
- [x] Use stable IDs and reject duplicates.
- [x] Fail closed with a useful error that identifies the source record and
  field.
- [x] Add fixture tests for missing references, invalid enums, impossible
  coordinates, circular prerequisites, and incompatible save content.

P2.4 completion evidence (2026-07-18):

- `src/data/GameDataValidator.js` composes domain validation into one immutable
  stable-ID registry. `ContentDefinitions.js` is the renderer-free authority
  for districts, zones, factions, progression tiers, supported world bounds,
  and vehicle content IDs; the city editor consumes the same zone definitions
  instead of maintaining a parallel table.
- Mission and embedded dialogue validation enforce stable mission/node IDs,
  reachable choice references, objective/vehicle enums, objective-specific
  fields, finite in-world locations, and stable district references. Building,
  zone, district, faction, progression, weather, and executable MVP-scope data
  receive type, range, duplicate, reference, and graph validation.
- Boot validates the complete content graph before settings, save discovery,
  assets, or runtime composition. `DataValidationError` identifies the source,
  record ID, field path, and failure code; `BootStageError` preserves the useful
  remediation message and stops later stages.
- Save discovery validates current, recovery, and migrated LocalStorage slots
  against that exact registry. Unknown building, zone, weather, mission,
  dialogue-node, faction, or progression IDs, duplicate instance IDs, and
  impossible transforms disable only the affected load action before any live
  owner is mutated. New Game remains available.
- Fixture coverage includes missing cross-record/dialogue/prerequisite
  references, invalid enums, duplicate stable IDs, impossible coordinates,
  circular progression prerequisites, and six incompatible-save domains. The
  Chrome WebGL flow verifies the visible fail-closed warning and confirms no
  runtime world is composed for an incompatible save.
- Verification at completion: 313 Node tests, the production build, and all
  five Chrome WebGL acceptance flows pass. The operational and extension
  contract is documented in `DATA_VALIDATION.md`.

### Exit gate

- New, continue, autosave, manual save, reload, migration, recovery, and corrupt
  save flows pass browser integration tests.
- Every action prompt reflects the active binding.
- Settings changes take effect without requiring undocumented reloads.
- Required gameplay state survives save/reload at management, builder,
  on-foot, vehicle, and mission-checkpoint boundaries.
- No save operation blocks a render frame with synchronous serialization work.

## 10. Phase 3 — Golden cross-mode vertical slice

### Objective

Prove the complete game in one small, polished district arc before expanding
management depth or mission count.

### Vertical-slice scenario

Choose one West Core or bridge-adjacent problem that naturally connects both
scales. A recommended structure is:

1. A bridge/service/traffic problem is visible in management mode.
2. The player chooses between two city responses with different cost and
   faction implications.
3. The choice modifies street traffic, access, enforcement, hazards, or mission
   timing.
4. The player enters Street Mode and completes a mission that reads the chosen
   conditions.
5. Success, partial success, and failure each create a different persistent
   result.
6. A result screen explains Capital, infrastructure, population/jobs,
   satisfaction, faction, Heat, and unlock changes.
7. The city visibly reflects the outcome and presents a meaningful next action.

### Deliverables

#### P3.1 Condition and consequence contracts

- [x] Define renderer-independent city-condition queries for traffic,
  bridge state, service coverage, safety, repair status, land value, weather,
  district state, and authored flags.
- [x] Define mission outcome commands for Capital, building/infrastructure
  state, incidents, repairs, service outages, traffic, factions, progression,
  unlocks, news, and follow-up missions.
- [x] Make every consequence idempotent through a transaction/outcome ID.
- [x] Store sufficient source information to explain the result to the player.

P3.1 completion evidence (2026-07-18):

- `src/missions/CityConditionService.js` provides immutable, renderer-free
  traffic, bridge, service, safety, repair, land-value, weather, district, and
  authored-flag snapshots. Authored rules share one path/operator evaluator,
  and extension resolvers cannot replace built-in authorities.
- `src/missions/MissionOutcomeService.js` validates all required consequence
  families as one transaction, reduces them against cloned state, preserves
  the authoritative EconomySystem Capital account, rejects unaffordable or
  partially invalid transactions before mutation, and publishes one immutable
  receipt.
- Stable transaction IDs are normalized into deterministic fingerprints.
  Exact replay returns the original result without mutation; conflicting reuse
  fails closed. Receipts retain structured source/run/outcome identity plus
  per-command before, after, reason, and player-facing summary data.
- Outcome ledgers persist under the mission save domain and restore without
  replay. Faction and progression save domains are validated derived views, so
  mismatched persisted truths are rejected before live restore.
- Focused coverage exercises every command family, condition composition,
  authored-ID rejection, atomic late-command and affordability failures,
  duplicate/conflicting replay, explanation immutability, corruption rejection,
  and save/restore behavior. The operational and extension contract is
  documented in `CONDITION_AND_CONSEQUENCE_CONTRACTS.md`.
- Verification at completion: 327 Node tests, the production build, and all
  five Chrome WebGL boot/transition/settings/save/content-validation flows pass.

#### P3.2 Complete mission lifecycle

- [x] Implement mission availability and prerequisite evaluation.
- [x] Add preparation/briefing, approach, active execution, checkpoint,
  completion/failure, cleanup, result, and recovery states.
- [x] Add checkpoint/retry rules appropriate to each activity template.
- [x] Do not clear an active mission before its cleanup and result transaction
  are committed.
- [x] Prevent mode changes or saves from bypassing mission cleanup.
- [x] Make mission weather compatibility explicit: allowed, adapted, delayed,
  or blocked with a clear reason.

P3.2 completion evidence (2026-07-18):

- `src/missions/MissionLifecycleController.js` is the renderer-free lifecycle
  authority. It publishes immutable availability and phase snapshots, evaluates
  mission/follow-up/city prerequisites, retains stable run/attempt identities,
  and owns progress, checkpoint, result, and bounded recovery rules.
- The complete state path is preparation, briefing, approach, active execution,
  checkpoint, completion/failure, cleanup, result, and recovery. The legacy
  `MissionSystem` now adapts world/Three.js/DOM events to that controller rather
  than clearing or rewarding itself.
- Cleanup creates one attempt-scoped idempotent transaction and requires the
  matching `MissionOutcomeService` receipt before entering Result. Capital is
  awarded only by the outcome authority. Cleanup failure retains mission
  ownership and blocks mode escape and persistence.
- Shared weather policies explicitly produce Allowed, Adapted, Delayed, or
  Blocked decisions with reasons and locked timing/reward adaptations. Every
  authored mission declares prerequisites and a weather policy, validated at
  boot with missing-reference and circular-graph rejection.
- Taxi/Courier/Delivery restart approach, Race and Sabotage restore the latest
  meaningful checkpoint, and Survival restarts with a tighter attempt bound.
  Retry exhaustion is explicit; attempt transaction IDs cannot collide.
- Save capture is lifecycle-gated and fully validated before write. Active,
  checkpoint, and Result snapshots restore safely; boot defers active lifecycle
  ownership until entity/state restoration, and Result retains a recovery
  vehicle descriptor without violating live control ownership.
- Focused unit coverage exercises availability, every phase, weather decisions,
  checkpoint strategies, retry bounds, idempotent cleanup, cleanup failure,
  immutable round-trip state, authoring validation, and save guards. The Chrome
  WebGL flow covers failure, retry, successful consequence commit, Result save
  and reload, and recovery to Management. The operational contract is documented
  in `MISSION_LIFECYCLE.md`.
- Verification at completion: 339 Node tests, the production build, and all six
  Chrome WebGL acceptance flows pass.

#### P3.3 Result and explanation UI

- [x] Show what happened, why it happened, what changed, and what the player can
  do next.
- [x] Separate reward, city consequence, faction consequence, and progression
  sections.
- [x] Support success, partial success, failure, abandonment, arrest, and
  vehicle-loss outcomes.
- [x] Announce results accessibly and preserve them in a reviewable log.

P3.3 completion evidence (2026-07-18):

- `src/ui/MissionResultViewModel.js` is a renderer-free projection of the
  lifecycle Result snapshot and the immutable outcome explanation. It owns the
  six-result presentation taxonomy, plain-language cause mapping, before/after
  formatting, stable consequence categorization, and next-action copy without
  querying or mutating live city state.
- `src/ui/MissionResultScreen.js` renders one responsive debrief with explicit
  What, Why, Changes, and Next Move hierarchy. Reward/performance, city,
  faction, and progression/unlock sections remain distinct and expose useful
  empty states instead of implying an unrecorded change.
- Retry and recovery remain delegated to `MissionSystem` and
  `MissionLifecycleController`. The result UI does not award Capital, infer a
  retry, acknowledge a result, or create a second mission status.
- Result announcements use an atomic assertive live region. The modal moves and
  traps focus, provides labelled controls and visible focus, uses status text in
  addition to color, honors global contrast/reduced-motion/text-scale settings,
  and never lets Escape silently acknowledge a committed outcome.
- The reviewable Outcome Log reads mission receipts directly from the durable,
  idempotent `MissionOutcomeService` ledger, ordered by transaction sequence.
  It therefore preserves original explanations through acknowledgement and
  save/reload without another persistence schema or UI-owned history.
- Focused unit coverage exercises consequence categories, plain-language
  formatting, immutable history, retry guidance, and success, partial,
  failure, abandonment, arrest, and vehicle-loss classification. The Chrome
  WebGL lifecycle flow verifies failure and success debriefs, retry visibility,
  accessible announcement, all four sections, two-attempt log history, Result
  save/reload, and recovery to Management. The operational and extension
  contract is documented in `RESULT_AND_EXPLANATION_UI.md`.
- Verification at completion: 343 Node tests, the production build, and all six
  Chrome WebGL acceptance flows pass.

#### P3.4 Structured alerts

- [x] Replace generic ephemeral feed entries with alert records containing
  type, severity, cause, location, start time, duration/state, recommendation,
  related entity IDs, and focus action.
- [x] Allow relevant alerts to focus the management camera or create a street
  waypoint.
- [x] Resolve or supersede alerts rather than allowing unbounded duplicates.

P3.4 completion evidence (2026-07-18):

- `src/alerts/AlertService.js` is the renderer-free alert authority. Its deeply
  immutable records carry type, severity, plain-language cause, structured
  location, first/latest observation time, duration and lifecycle state,
  recommendation, stable related IDs, occurrence count, and an explicit focus
  action. The legacy `UIManager.addAlert()` entry point is now only a complete-
  record compatibility adapter; save capture no longer scrapes DOM rows.
- One semantic dedupe key updates an active condition in place. Producers can
  resolve it or supersede it with a linked replacement, timed records expire
  after their latest observation, and bounded resolved history is pruned
  without discarding active alerts. Crime response, hit-and-run pursuit,
  aggregate congestion, low valuation, and mission results use those lifecycle
  contracts.
- `AlertActionController` validates action context, delegates world-position
  framing to `SceneManager`, owns one alert street waypoint for `MinimapHUD`,
  and clears that waypoint when its alert resolves or is superseded. The
  accessible Recent Activity projection shows severity, state, location,
  remedy, collapsed-report count, and labelled action controls.
- The version-2 alerts save domain validates structured records and active-key
  uniqueness, round-trips without DOM ownership, and migrates the version-1
  message feed. Mission attempt alerts derive from committed idempotent outcome
  receipts, supersede the prior attempt, and survive Result save/reload.
- Focused coverage exercises record completeness, immutability, invalid input,
  duplicate collapse, resolution, supersession, expiry, history bounds,
  legacy migration, save/restore, camera guards, and waypoint cleanup. The
  Chrome WebGL lifecycle flow verifies failure/success alerts, supersession,
  Result reload, management-camera focus, street-waypoint creation, and cleanup.
  The operational contract is documented in `STRUCTURED_ALERTS.md`.
- Verification at completion: 350 Node tests, the production build, and all six
  Chrome WebGL acceptance flows pass.

### Required tests

- Condition-query tests with deterministic city fixtures.
- Idempotent outcome and save/reload tests.
- Success, failure, partial, cancel, arrest, and checkpoint flows.
- Browser test of the entire management-to-street-to-management arc.
- Plain-language consequence review by someone who did not implement it.
- Performance capture in every state of the slice.

### Exit gate

- One complete district arc is playable from new game through debrief.
- The arc contains at least three real cross-mode links.
- The result survives reload and appears correctly in city state and alerts.
- A player can identify why the street mission differed based on the earlier
  management decision.
- No additional mission content proceeds until this slice passes the gate.

## 11. Phase 4 — Complete city-management decision layer

### Objective

Turn the existing economy and builder into an understandable decision system
that reliably creates street gameplay conditions.

### Deliverables

#### P4.1 MVP zoning and construction vocabulary

- [x] Present Residential, Commercial, and Operations as the primary MVP zones.
- [x] Treat utilities and civic/service assets as facilities rather than
  additional zone types unless the GDD is amended.
- [x] Map or migrate existing Industrial and Office parcels without corrupting
  saves.
- [x] Reduce the first-session catalog to the assets needed for the next
  meaningful decision.
- [x] Retain advanced structures behind progression or optional filters.

Implementation contract: `CONSTRUCTION_VOCABULARY.md`.

#### P4.2 Placement intelligence

- [x] Return structured placement validation results rather than booleans.
- [x] Explain the highest-priority blocker and a possible remedy.
- [x] Require ordinary development to have valid road access.
- [x] Validate service requirements, district restrictions, slope, water,
  collisions, protected landmarks, funds, and content unlocks.
- [x] Preview cost, operating cost, net cashflow, payback category, capacity,
  demand effect, service effect, jobs/residents, happiness, land value, and
  risk where relevant.
- [x] Keep placement, movement, rotation, demolition, economy, physics, traffic,
  save state, and rollback atomic.

Implementation contract: `PLACEMENT_INTELLIGENCE.md`.

P4.2 completion evidence (2026-07-18):

- `PlacementIntelligence` returns one deeply immutable result with stable
  prioritized blocker codes, concrete remedies, and the full financial,
  capacity, demand, service, community, land-value, payback, and risk forecast.
  `CityEditorSystem.isPlacementValid()` remains only a compatibility projection
  for save restoration; preview and commit-time validation consume the complete
  result.
- Ordinary development requires an authored or connected editor road within
  the access threshold. Oriented world bounds, zoning, district ownership,
  terrain slope, water, protected landmarks, scenery/building/player collision,
  projected power/water requirements, progression access, and current treasury
  are checked together and fail closed.
- The accessible construction panel shows the complete forecast plus the
  highest-priority blocker and remedy live. A green ghost cannot commit stale
  state because placement re-evaluates the same contract immediately before
  charging Capital.
- `WorldEditTransaction` now owns LIFO compensation for placement, movement,
  rotation, and demolition across scene/list/inspector state, economy, physics,
  traffic, optional city/game integrations, salvage, and save-facing records.
  Physics collider removal also updates its authoritative static-body registry.
- Verification at completion: 359 Node tests, production build, and all 6
  Chrome Playwright browser flows. Browser acceptance commits a production
  building and verifies treasury, render list, physics, economy registration,
  and serialized world state change together.

#### P4.3 Services and incidents

- [ ] Implement energy and simplified safety/repair as the MVP service model.
- [ ] Model service reach or network access where location should matter.
- [ ] Add local outages, damaged infrastructure, repair tasks, and cleanup
  requirements that can become street objectives.
- [ ] Preserve explainable aggregate metrics for fast management decisions.
- [ ] Avoid introducing a full utility-network simulator unless playtesting
  proves it is needed.

#### P4.4 Traffic and productivity feedback

- [ ] Connect aggregate traffic and bridge congestion to jobs, deliveries,
  mission availability/difficulty, satisfaction, and city alerts.
- [ ] Ensure visible traffic is a sampled presentation of the authoritative
  aggregate model rather than an unrelated number.
- [ ] Add management levers only when each produces a legible tradeoff.
- [ ] Make bridge priority, road changes, and outages visible in Street Mode.

#### P4.5 Economy recovery and balance

- [ ] Define stable, deficit, insolvent, and recovery rules.
- [ ] Prevent a player from entering an unrecoverable economy state without
  warning and a recovery path.
- [ ] Define spending restrictions or emergency assistance deliberately.
- [ ] Balance construction, upkeep, mission rewards, repair costs, fines,
  growth, and progression against target session lengths.
- [ ] Add deterministic economy simulations for 15-, 30-, 60-, and 120-minute
  scenarios.

### Exit gate

- Every build action shows a truthful preview and specific blocker.
- Road access and core service requirements influence placement and operation.
- At least two management systems create street-level changes used by missions.
- The economy has tested recovery rules and no known unavoidable death spiral.
- New players see a focused catalog rather than the complete debug sandbox.

## 12. Phase 5 — Complete street gameplay and enforcement

### Objective

Bring walking, interaction, driving, combat, Heat, and recovery to a consistent
MVP-quality standard.

### Deliverables

#### P5.1 On-foot controller

- [ ] Add walk, sprint, jump, contextual vault, interact, evade, and light melee.
- [ ] Define grounded, airborne, vaulting, attacking, evading, stunned,
  entering-vehicle, and arrested states.
- [ ] Prevent impossible state combinations and animation/input cancellation
  bugs.
- [ ] Add forgiving ledge/obstacle queries and safe landing recovery.
- [ ] Tune acceleration, camera-relative movement, collision response, and
  camera framing through playtest, not constants alone.

#### P5.2 Combat scope

- [ ] Keep combat deliberately minimal: light strike plus one charged/heavy or
  situational option if required by the GDD acceptance target.
- [ ] Define health/damage/stun/recovery behavior for player and relevant NPCs.
- [ ] Add readable hit feedback, invulnerability windows where necessary, and
  non-visual alternatives for critical cues.
- [ ] Ensure combat cannot silently break mission, police, or interaction state.
- [ ] Do not expand into a weapon inventory or deep combat tree for MVP.

#### P5.3 Vehicles

- [ ] Lock the MVP vehicle set to 3–4 distinct archetypes.
- [ ] Audit entry, hijack, exit, control release, damage, fire, destruction,
  repair, impound/recovery, and mission ownership flows.
- [ ] Add repair costs and visible vehicle-condition states.
- [ ] Tune handling under clear, mist, rain, and storm conditions.
- [ ] Provide driving assists and adjustable camera sensitivity.
- [ ] Prevent spawning, exiting, or camera placement inside unsafe geometry.

#### P5.4 Heat and enforcement

- [ ] Replace the boolean wanted state with a bounded Heat model.
- [ ] Derive Heat from witness state, severity, repetition, district security,
  mission rules, and current enforcement attention.
- [ ] Define decay, escalation tiers, search, pursuit, disengagement, arrest,
  fines, vehicle consequences, and recovery.
- [ ] Communicate what raised Heat and what will reduce it.
- [ ] Ensure enforcement is challenging without creating indefinite pursuit or
  unrecoverable mission states.

#### P5.5 Activity-template completion

- [ ] Normalize the approved 5–7 templates behind shared lifecycle contracts.
- [ ] Keep template-specific rules out of DOM code.
- [ ] Add deterministic scoring inputs such as time, damage, detection,
  satisfaction, route efficiency, or collateral cost where appropriate.
- [ ] Add repeat-run modifiers and diminishing narrative/progression rewards.
- [ ] Confirm each template has success, partial, failure, cancellation,
  arrest, save/reload, and incompatible-weather behavior.

### Exit gate

- Walking and driving each feel complete enough to support a ten-minute mission
  without obvious placeholder behavior.
- Heat has multiple understandable tiers and a bounded recovery loop.
- All approved activity templates use the shared lifecycle and result system.
- Street state survives legal save/reload and mode transitions.
- Controller, camera, collision, and animation edge cases pass structured
  playtest checklists.

## 13. Phase 6 — Narrative, factions, progression, and content

### Objective

Turn systems into a coherent campaign-shaped MVP with tradeoffs, pacing, and a
reason to alternate between city and street play.

### Deliverables

#### P6.1 Factions

- [ ] Define three or four faction/reputation tracks, including their values,
  rewards, conflicts, and city/street expression.
- [ ] Give choices at least one meaningful opportunity cost; avoid reputation
  tracks that can all be maximized without tradeoff.
- [ ] Connect faction state to mission availability, prices/rewards, district
  conditions, enforcement, dialogue, and progression where appropriate.
- [ ] Explain reputation changes on the result screen and in the faction UI.

#### P6.2 Progression

- [ ] Implement Operator, Broker, and Magnate tiers.
- [ ] Unlock capabilities, mission families, management tools, and district
  options through progression.
- [ ] Avoid progression that only increases payouts or stat totals.
- [ ] Define a respec/recovery policy only if progression choices can otherwise
  dead-end the player.
- [ ] Save stable unlock IDs and migrate them safely.

#### P6.3 Prologue and district arc

- [ ] Write and implement a playable prologue that teaches the first complete
  loop through action rather than panels.
- [ ] Complete one district arc with setup, escalation, reversal, climax, and
  aftermath.
- [ ] Preserve the intended reverse-chronology flavor without sacrificing
  immediate player comprehension.
- [ ] Ensure every required mission has a reason to occur in the city state,
  not only a map marker.

#### P6.4 Mission-content audit

- [ ] Audit the existing 15 missions against the 8–12 mission MVP budget.
- [ ] Keep, combine, rewrite, or defer missions based on their contribution to
  the core loop, faction tradeoffs, pacing, and template variety.
- [ ] Add prerequisites, availability conditions, fail conditions, outcomes,
  faction effects, city effects, weather policy, checkpoints, and stable tags.
- [ ] Replace deterministic fake race outcomes with convincing world behavior
  or present the abstraction honestly.
- [ ] Ensure repeated missions are mechanically useful without duplicating
  authored narrative progression.

#### P6.5 Writing and dialogue

- [ ] Establish a concise voice guide for corporate satire, resident voices,
  factions, mission briefings, alerts, and news.
- [ ] Review every line for clarity, tone, length, subtitle behavior, and
  accessibility.
- [ ] Remove debug-like copy, misleading promises, and repeated filler.
- [ ] Ensure dialogue choices state or foreshadow consequential tradeoffs.

### Exit gate

- The release set contains 8–12 polished missions and 5–7 proven templates.
- A complete prologue and district arc are playable in sequence.
- Faction and progression state materially change decisions and content.
- Mission availability, consequences, and unlocks survive save migration.
- No required story progression depends on undocumented sandbox actions.

## 14. Phase 7 — Onboarding, accessibility, presentation, and polish

### Objective

Make the complete loop understandable, comfortable, readable, and aesthetically
coherent for first-time and returning players.

### Deliverables

#### P7.1 Playable onboarding

- [ ] Teach camera and selection through a management objective.
- [ ] Teach one zone/facility decision with a truthful preview.
- [ ] Show the resulting city consequence.
- [ ] Transition to on-foot control with a safe camera and minimal prompts.
- [ ] Enter and drive a vehicle.
- [ ] Complete a short activity and read its city consequence.
- [ ] Return to management with a meaningful next decision.
- [ ] Allow replay or reset of onboarding without destroying an established
  city.

#### P7.2 Progressive disclosure

- [ ] Show only controls and systems relevant to the current state and
  progression tier.
- [ ] Keep advanced city tools, developer-like atmosphere controls, rocket,
  aircraft, and post-MVP actions out of the first-session surface.
- [ ] Preserve discoverability through clear categories, unlock notices, and
  an accessible help/reference screen.
- [ ] Ensure management, builder, walking, driving, dialogue, result, and pause
  HUDs do not compete for the same visual region.

#### P7.3 Accessibility completion

- [ ] Full keyboard/mouse remapping and conflict resolution.
- [ ] Text scaling that does not clip critical UI at supported viewport sizes.
- [ ] High-contrast mode and color-safe patterns for status/heat-map meanings.
- [ ] Subtitles for dialogue and important audio, with speaker labels where
  useful.
- [ ] A reviewable transcript/history for missed critical messaging.
- [ ] Reduced motion, reduced camera shake, reduced flashes, and reduced screen
  effects.
- [ ] Toggle/hold alternatives for sprint, aim, interact, and other sustained
  actions.
- [ ] Driving assists, difficulty choices, and mission-timer leniency.
- [ ] Visible focus, logical focus order, modal containment, and screen-reader
  names for all required actions.
- [ ] No critical information conveyed only by color, sound, vibration, or
  rapid motion.

#### P7.4 Camera and animation polish

- [ ] Audit every state entry and camera preset for collision, occlusion,
  horizon, target framing, and motion comfort.
- [ ] Add or improve entry/exit, vault, evade, melee, hit, arrest, and relevant
  NPC animation transitions.
- [ ] Prevent procedural limb animation from conflicting with gameplay states.
- [ ] Tune transition duration and offer reduced-motion alternatives.

#### P7.5 Visual and audio polish

- [ ] Establish environment, building, vehicle, NPC, effect, and UI content
  budgets for the MVP footprint.
- [ ] Improve navigation landmarks, road readability, mission markers, and
  hazard visibility.
- [ ] Balance bloom, fog, rain, lighting, emissive materials, and contrast in
  each weather/time state.
- [ ] Separate master, music, ambience, vehicles, effects, dialogue, news, and
  UI volume where the mix requires it.
- [ ] Add a deliberate music strategy or explicitly approve an ambience-led
  score.
- [ ] Prevent overlapping alerts, sirens, mission audio, and news from becoming
  unintelligible.

### Exit gate

- A first-time player can complete onboarding without developer guidance.
- Required flows pass keyboard-only and remapped-control tests.
- Accessibility review finds no blocker in the core loop.
- Supported desktop viewport sizes have no clipped or overlapping critical UI.
- Camera, animation, visual, audio, and writing polish checklists are complete
  for every release mission and state.

## 15. Phase 8 — Performance, compatibility, QA, and release candidate

### Objective

Demonstrate that the complete game is stable and performant under real release
conditions, not only in isolated unit tests or a fresh development session.

### Deliverables

#### P8.1 Performance budgets

- [ ] Define minimum and recommended test hardware/browser profiles.
- [ ] Target 30 FPS on minimum and 60 FPS on recommended hardware.
- [ ] Record median and worst-percentile frame time in management, builder,
  walking, driving, missions, storm, and Mayhem scenarios.
- [ ] Define budgets for draw calls, triangles, textures, materials, active
  bodies, traffic, pedestrians, particles, audio nodes, and DOM updates.
- [ ] Add a true dormant entity tier where simulation relevance permits it.
- [ ] Expose High, Medium, and Low quality profiles through settings.
- [ ] Respect manual quality selection while offering bounded auto-adjustment.
- [ ] Code-split boot, optional/post-MVP systems, and large noncritical modules
  to address current bundle warnings and improve initial load.

#### P8.2 Resource lifecycle

- [ ] Audit disposal for geometry, materials, textures, render targets, audio
  nodes, physics bodies, event listeners, timers, observers, and DOM nodes.
- [ ] Make create/destroy/restore operations idempotent.
- [ ] Run repeated mission, destruction, builder, save/load, weather, and mode
  cycles while tracking resource counts.
- [ ] Verify optional post-MVP systems do not load or update when disabled.

#### P8.3 Browser and device matrix

- [ ] Test current stable Chrome, Edge, Firefox, and Safari versions approved by
  the compatibility policy.
- [ ] Verify clean profile, existing migrated save, corrupted save, private
  browsing/storage restriction, focus loss, background/resume, resize, and
  reduced-motion environments.
- [ ] Test representative keyboard layouts and high-DPI displays.
- [ ] If controller support remains in MVP, test physical target controllers
  rather than relying only on simulated gamepad input.

#### P8.4 Automated quality matrix

- [ ] Unit tests for deterministic domain rules.
- [ ] Integration tests for system boundaries and transactions.
- [ ] Browser tests for complete player journeys.
- [ ] Visual regression captures for major states, supported viewport sizes,
  weather, time, quality, and accessibility profiles.
- [ ] Save compatibility fixtures for every released schema version.
- [ ] Performance scenarios with recorded budgets and regression thresholds.
- [ ] Fifty-cycle transition soak.
- [ ] Two-hour simulation/gameplay soak.

#### P8.5 Balance and playtesting

- [ ] Run first-time-user tests without coaching.
- [ ] Run focused management, driving, walking, mission, accessibility, and
  recovery sessions.
- [ ] Record completion time, failure reason, confusion point, economy state,
  Heat state, chosen faction path, and reported enjoyment/frustration.
- [ ] Fix systemic causes before tuning individual missions around them.
- [ ] Repeat until the first complete loop, prologue, and district arc meet the
  agreed success criteria.

#### P8.6 Release-candidate discipline

- [ ] Content lock before final regression.
- [ ] No new feature work during release-candidate stabilization without an
  approved exception.
- [ ] Triage all defects by severity, reproducibility, player impact, recovery,
  and save risk.
- [ ] Zero open P0/P1 defects.
- [ ] Update README claims so every advertised feature is available and
  verified in the release build.
- [ ] Document controls, saves, accessibility, minimum requirements, known
  limitations, and recovery steps.
- [ ] Produce a final GDD v3 compliance report based on tested acceptance
  evidence, replacing—not editing around—the historical v2.1 conclusions.

### Exit gate

- All MVP completion criteria in Section 4 are verified.
- Production build, automated suites, browser matrix, transition soak, and
  two-hour soak pass from a clean release candidate.
- Performance meets the approved minimum and recommended targets.
- Save migration and recovery pass against real release-format fixtures.
- No P0/P1 defect remains open.
- Product, design, engineering, accessibility, and QA owners approve release.

## 16. Cross-cutting architecture plan

The phases above should converge on the following dependency direction:

```text
Data + schemas
      ↓
Renderer-independent domain systems
      ↓
Commands, queries, snapshots, and events
      ↓
Game-session coordinator + simulation scheduler
      ↓
Three.js/Cannon adapters, input adapters, and persistence adapters
      ↓
UI, audio, camera, effects, and diagnostics presentation
```

Presentation may request commands and render snapshots. It must not mutate
domain internals directly. Domain systems must not query DOM state to decide
game rules.

### 16.1 Recommended extractions

These are targeted extractions, not a mandate to create many small files:

| Current pressure point | Incremental target |
|---|---|
| `main.js` owns construction and frame policy | Composition root plus explicit scheduler |
| `MissionSystem` mixes rules, DOM, Three.js, and audio | Mission domain, mission controller, and presentation adapter |
| `InputManager` owns sampling plus hard-coded context branches | Device sampling, action map, and interaction resolution |
| `UIManager` performs presentation and some orchestration | Snapshot-driven views and command dispatch |
| `PedestrianSystem` mixes population, control, crime, combat, and presentation | Keep population system; extract player controller, Heat/crime domain, and interaction adapters where justified |
| `TrafficSystem` mixes graph, population, control handoff, and enforcement | Preserve proven graph/AI; isolate player handoff and enforcement contracts |
| `PersistenceSystem` applies live objects directly | Versioned SaveService plus per-domain serialization adapters |
| Direct Cannon imports in gameplay | Narrow physics facade introduced at changed seams |

### 16.2 Event and command rules

- Commands are requests and may fail with a structured reason.
- Events describe committed facts and are immutable.
- Queries and snapshots do not expose mutable internal collections.
- Every economy, mission outcome, unlock, construction, repair, and save
  transaction receives a stable ID where duplicate application is dangerous.
- Event handlers must tolerate replay or explicitly reject it.
- UI notifications are derived from domain events; they are not the only record
  that an event happened.

## 17. Requirement and work-item conventions

Future roadmap changes should use stable identifiers:

- `KERNEL-*` — state, transitions, scheduler, pause.
- `SAVE-*` — persistence, migration, recovery.
- `SET-*` — settings, bindings, accessibility preferences.
- `CITY-*` — economy, zoning, services, traffic, alerts.
- `STREET-*` — on-foot, vehicles, combat, Heat, enforcement.
- `MISSION-*` — mission lifecycle, templates, conditions, outcomes.
- `NARR-*` — factions, progression, dialogue, campaign.
- `UX-*` — HUD, onboarding, menus, interaction feedback.
- `PERF-*` — performance, quality, resource lifecycle.
- `QA-*` — automated and manual acceptance coverage.

Each implementation issue or agent task should include:

1. Requirement IDs served.
2. Player-facing outcome.
3. In-scope and out-of-scope behavior.
4. Current owner/source of truth.
5. Intended interfaces or data changes.
6. Normal, failure, cancellation, transition, save, and accessibility behavior.
7. Tests required at unit, integration, and browser levels.
8. Performance/resource implications.
9. Migration or compatibility implications.
10. Acceptance evidence required to close the task.

## 18. Definition of done for implementation tasks

A task is done only when applicable items below are satisfied:

- [ ] The player-facing requirement is implemented, not only scaffolding.
- [ ] No second authority or duplicate mutable state was introduced.
- [ ] Normal and failure paths return structured outcomes.
- [ ] State transitions and pause behavior are defined.
- [ ] Save/load/migration behavior is defined.
- [ ] Accessibility and remapped controls are considered.
- [ ] Unit tests cover domain rules.
- [ ] Integration tests cover changed boundaries.
- [ ] Browser tests cover critical visible interaction.
- [ ] Resource creation and disposal are balanced.
- [ ] Performance was measured if the change affects a hot path.
- [ ] Player-facing copy explains failure and recovery.
- [ ] Documentation and requirement traceability are updated.
- [ ] `npm test` passes.
- [ ] `npm run build` succeeds without a new unexplained warning.
- [ ] The change was manually exercised in at least one realistic complete flow.

## 19. Guidance for AI agents

AI agents working from this roadmap must follow these rules:

1. Read the relevant GDD section, this roadmap phase, and the current owner
   modules before proposing changes.
2. Inspect current tests and runtime behavior; do not assume the historical
   audit describes the current tree.
3. Work on the smallest end-to-end slice that produces acceptance evidence.
4. Preserve unrelated user changes and avoid broad mechanical rewrites.
5. Extend current authorities rather than creating parallel managers, stores,
   clocks, input listeners, or save formats.
6. Do not mark an item complete because code compiles or a unit test passes.
7. Add regression coverage for any reproduced defect before or with its fix.
8. Use stable data IDs and explicit migration behavior for persisted changes.
9. Treat new content, districts, vehicles, systems, and UI panels as scope
   expansion requiring explicit approval.
10. Report uncertainty, failed acceptance, and remaining risks plainly.
11. Update this roadmap only when implementation evidence changes status or an
    approved design decision changes scope.
12. Never rewrite the entire project to solve a local ownership problem.

## 20. Risk register

| Risk | Probability | Impact | Mitigation | Trigger for escalation |
|---|---|---|---|---|
| Scope growth continues through attractive side systems | High | Critical | Feature flags, content budgets, Phase 0 scope lock | New district/system requested before golden slice passes |
| Transition ownership remains distributed | High | Critical | Phase 1 coordinator and invariants | Any camera/input/entity handoff fix requires edits in three or more unrelated owners |
| Cross-mode loop remains cosmetic | High | Critical | Golden slice before more missions | Mission consequences remain Capital/reputation-only |
| Save changes corrupt player cities | Medium | Critical | IndexedDB transactions, fixtures, recovery slot, migrations | Schema changes without migration tests |
| Large modules become harder to change safely | High | High | Targeted extractions at changed seams | New feature adds DOM, physics, audio, and economy logic to one class |
| Accessibility is deferred until UI is frozen | High | High | Settings/accessibility foundations in Phase 2 | New input/UI feature lacks remapping and alternative cues |
| Performance work starts too late | Medium | High | Baseline in Phase 0 and budgets per phase | New content raises frame time or resource counts beyond budget |
| Existing unit tests create false confidence | High | High | Browser journeys, soak, visual and device testing | Feature declared complete without visible-flow evidence |
| Procedural presentation looks polished from one camera only | Medium | High | Camera/state visual matrix | Occlusion, clipping, or unreadable effects appear after transitions |
| Economy becomes too complex to explain | Medium | High | Explainable contributors and focused MVP services | Player cannot identify cause/remedy in testing |
| Content quantity outruns systemic quality | High | High | 8–12 mission lock and template acceptance | New mission authored before template failure/retry/save behavior is complete |
| Controller breadth delays keyboard/mouse completion | Medium | Medium | Explicit controller MVP decision | Controller bugs block core KBM state completion |

## 21. Milestone review checklist

At every phase review, answer these questions with evidence:

1. What new player decision is now possible or clearer?
2. Which GDD requirement IDs moved to `Verified`?
3. What complete browser journey proves the change?
4. How does the change behave on failure, cancellation, pause, transition,
   save, reload, and recovery?
5. What accessibility settings or alternative cues apply?
6. What resources are created and destroyed?
7. What performance measurements changed?
8. What old path was removed or narrowed?
9. Did the work add post-MVP scope?
10. What is the next dependency-blocking risk?

If these cannot be answered, the phase is not ready to exit.

## 22. Recommended immediate backlog

The first implementation sequence should be:

1. **KERNEL-001:** Expand the game-state vocabulary and encode legal
   transitions without changing visible behavior.
2. **QA-001:** Add a browser regression for on-foot → management → builder
   camera handoff.
3. **KERNEL-002:** Introduce the transition coordinator and migrate that exact
   flow until the regression passes.
4. **KERNEL-003:** Add scheduler clocks and true pause; migrate economy and
   mission timing first.
5. **SAVE-001:** Define the versioned save envelope and IndexedDB repository.
6. **SAVE-002:** Migrate LocalStorage v1, add previous-good recovery, and test
   the five primary gameplay states.
7. **MISSION-001:** Define city-condition queries and idempotent outcome
   commands for the golden slice.
8. **MISSION-002:** Add full result/cleanup/retry lifecycle to one existing
   mission template.
9. **CITY-001:** Implement one management condition that materially changes
   that mission.
10. **UX-001:** Add result explanation and structured alert presentation.
11. **QA-002:** Automate the complete first cross-mode loop.
12. Only after the golden-slice gate passes, expand the same contracts to the
    remaining city systems and mission templates.

## 23. Final release principle

MetroPulse 3D should ship when its existing breadth has been shaped into one
coherent, reliable, explainable game—not when every experimental feature has
been exposed to the player.

The correct path is to preserve the strong economy, traffic, physics, weather,
and procedural-world foundation; consolidate authority around state,
transitions, timing, persistence, missions, and settings; prove the two-scale
loop; then invest in content, accessibility, performance, and polish.

That path is feasible without a complete rewrite.
