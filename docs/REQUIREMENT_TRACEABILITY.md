# MetroPulse 3D MVP Requirement Traceability

> **Baseline:** GDD v3.0, July 2026  
> **Source SHA-256:** `6fb1f6f8c7f8cd7763fe6a700f379358a0ee03588d9f0f036f33546b0c272c70`  
> **Established:** 2026-07-17  
> **Change policy:** IDs are permanent. Requirements may be clarified, split by adding
> a suffixed ID, or superseded through `DESIGN_DECISIONS.md`; IDs are never reused.

This matrix converts the normative MVP and vertical-slice acceptance language in
GDD v3 into an engineering contract. It deliberately tracks outcomes rather than
buttons, fields, or isolated mechanics.

## Status and test policy

| State | Meaning |
|---|---|
| Not Started | No acceptance-relevant implementation exists. |
| In Progress | A partial path exists, but one or more material acceptance conditions are absent. |
| Implemented | The intended behavior exists but has not passed the required verification level. |
| Verified | The required automated/manual evidence exists and is repeatable. |
| Deferred | A design decision explicitly moved the item outside MVP. |

Test levels are `Unit`, `Integration`, `Browser`, `Scenario`, `Performance`,
`Playtest`, and `Release`. The named verification owner owns evidence and signoff;
the responsible system owns implementation.

## Game loop

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| GL-001 | Builder decisions and Street play operate on one recognizable persistent city. | Game session / world | Browser + Scenario | Gameplay Lead | In Progress |
| GL-002 | At least three city conditions materially alter Street routes, hazards, opportunities, or rewards. | Consequence contracts | Scenario + Playtest | Systems Designer | In Progress |
| GL-003 | At least three Street outcomes materially alter Capital, traffic, services, safety, reputation, or damage. | Consequence contracts | Scenario + Playtest | Systems Designer | In Progress |
| GL-004 | A player can explain what changed, why, and the next useful response. | Debrief / City Pulse | Playtest | UX Lead | Not Started |
| GL-005 | A new player completes Builder → Street → Builder without external help. | Onboarding controller | Browser + Playtest | UX Lead | Not Started |
| GL-006 | Mode entry validates a safe target and offers a safe alternative when invalid. | Transition coordinator | Integration + Browser | Tech Lead | Not Started |
| GL-007 | Builder-to-Street takes ≤1.5 s warm on target and ≤3 s minimum profile. | Transition coordinator | Performance | Performance Lead | Not Started |
| GL-008 | Street failure returns to a safe checkpoint with a bounded, disclosed consequence. | Recovery controller | Scenario + Browser | Gameplay Lead | Implemented |
| GL-009 | Insolvency offers a recovery contract/restrictions instead of an unrecoverable game over. | Economy / missions | Scenario + Browser | Systems Designer | Verified |
| GL-010 | Exactly one primary mode owns camera and high-level input at a time. | GameManager / input | Integration + 50-cycle soak | Tech Lead | In Progress |

## City

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| CITY-001 | MVP world is West Core, Central Park, and the primary bridge corridor. | MVP scope config / world | Unit + Browser | Product Lead | Verified |
| CITY-002 | Residential, Commercial, and Operations are the three player-facing zones. | City editor / catalog | Unit + Browser | Systems Designer | Verified |
| CITY-003 | Placement previews cost, maintenance, projected effect, prerequisites, and blockers before commit. | City editor UI/domain | Integration + Browser | UX Lead | Verified |
| CITY-004 | Placement requires valid road access and always supports cancel before confirmation. | City editor domain | Unit + Browser | Gameplay Lead | Verified |
| CITY-005 | Capital is one shared account with itemized recurring and burst sources/sinks. | EconomySystem | Unit + Scenario | Systems Designer | Verified |
| CITY-006 | Passive income supports a healthy city without trivially funding every expansion. | Economy balance data | Simulation + Playtest | Systems Designer | Implemented |
| CITY-007 | Population/jobs use aggregate capacity and expose demand, employment, and top satisfaction causes. | EconomySystem / TrafficProductivityModel / UI | Unit + Browser | Systems Designer | Verified |
| CITY-008 | MVP energy shortages visibly affect productivity and selected Street lights/traffic systems. | Energy / consequence adapter | Scenario + Browser | Gameplay Lead | Not Started |
| CITY-009 | Simplified safety/repair clears blockers and damage within bounded time. | Incident / repair service | Scenario | Systems Designer | In Progress |
| CITY-010 | One road graph supplies aggregate congestion, AI routing, missions, overlays, and bridge routing. | TrafficSystem / TrafficProductivityModel | Integration + Scenario + Browser | AI Lead | Verified |
| CITY-011 | Local player damage creates temporary graph blockers and cannot permanently gridlock traffic. | Damage / traffic adapter | Integration + Soak | AI Lead | In Progress |
| CITY-012 | Land value reads access, amenities, energy, employment, congestion, damage, and district modifiers and lists causes. | EconomySystem / inspector | Unit + Browser | Systems Designer | In Progress |
| CITY-013 | Alerts contain severity, location, cause, duration, and remedy; duplicate low alerts collapse. | AlertService / AlertActionController / UI | Unit + Browser | UX Lead | Verified |
| CITY-014 | Day/night and four authored weather states affect density, availability, ambience, visibility, and accessible grip without invalidating critical missions. | Time / weather / missions | Scenario + Browser | Gameplay Lead | In Progress |
| CITY-015 | Visible agents are seeded proxies of aggregate city conditions, with persistent exceptions only for named characters. | Spawn director / city model | Scenario | Tech Lead | Not Started |

## Street

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| STR-001 | On-foot supports responsive walk, sprint, jump/vault, interact, evade, melee, vehicle entry, and look. | Pedestrian controller | Integration + Playtest | Gameplay Lead | In Progress |
| STR-002 | Safe-position recovery prevents slopes, curbs, obstacles, and out-of-bounds falls from trapping the player. | Pedestrian controller | Integration + Scenario | Gameplay Lead | Implemented |
| STR-003 | One deterministic prompt selects the highest-priority eligible interaction and states important consequences. | Interaction service | Integration + Browser | Tech Lead | Verified |
| STR-004 | Driving is readable arcade handling with recoverable slides, grip feedback, body motion, and forgiving low-speed collisions. | Vehicle controller | Scenario + Playtest | Gameplay Lead | In Progress |
| STR-005 | Owned/mission vehicles use Enter; unauthorized entry uses Hijack and adds Heat. | Vehicle interaction / Heat | Integration + Browser | Gameplay Lead | In Progress |
| STR-006 | MVP contains 3–4 handling archetypes backed by data rather than many one-off vehicles. | Vehicle profiles | Unit + Playtest | Gameplay Lead | In Progress |
| STR-007 | Damage transitions through healthy, damaged, disabled, and recovered; contact damage is clamped/debounced. | Damage system | Unit + Scenario | Gameplay Lead | In Progress |
| STR-008 | Player damage writes bounded repair cost, blockage, Heat, and reputation consequences. | Damage consequence adapter | Integration + Scenario | Systems Designer | In Progress |
| STR-009 | Minimal combat includes light/heavy strike, evade, hit reaction, tool modifier, and vehicle ramming without gore. | Combat system | Integration + Playtest | Gameplay Lead | In Progress |
| STR-010 | Encounters cap enemies/duration and expose timing/damage assists. | Combat director / settings | Scenario + A11y | Accessibility Lead | Not Started |
| STR-011 | Heat uses witness/severity/security/repetition and decays only in a safe unseen state. | Heat director | Unit + Scenario | Gameplay Lead | In Progress |
| STR-012 | Capture/incapacitation applies a bounded result, clears immediate Heat, and returns safely. | Enforcement / recovery | Scenario + Browser | Gameplay Lead | In Progress |

## Mission

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| MIS-001 | MVP release set is frozen at 10 authored missions and 6 activity templates. | MVP scope config | Unit | Product Lead | Verified |
| MIS-002 | Templates define prerequisites, valid tagged locations, route logic, fail conditions, modifiers, rewards, and city consequences. | Mission schema | Validation + Scenario | Content Lead | In Progress |
| MIS-003 | Every mission implements Offer, Accept, Brief, Execute, Resolve, Debrief, and Cleanup. | Mission controller | Integration + Browser | Gameplay Lead | In Progress |
| MIS-004 | Offers disclose objective, reward range, risks, city conditions, and prerequisites. | Mission UI/domain | Browser + UX | UX Lead | Not Started |
| MIS-005 | Execution uses 2–4 beats built from shared mechanics. | Mission content | Content validation + Playtest | Content Lead | In Progress |
| MIS-006 | Debrief plainly itemizes performance, damage, Heat, reputation, city effects, and unlocks. | Result/debrief UI | Browser + Playtest | UX Lead | Implemented |
| MIS-007 | Cleanup releases temporary entities and applies/persists results exactly once. | Mission transactions | Integration + restart soak | Tech Lead | In Progress |
| MIS-008 | Failure provides checkpoint/retry/recovery and cannot duplicate reward or persistent damage. | Mission recovery | Integration + Browser | Tech Lead | Verified |
| MIS-009 | A designer can author a second mission from templates without core-system code changes. | Content pipeline | Content exercise | Content Lead | In Progress |
| MIS-010 | Generated activities choose only authored valid locations and never impossible routes. | Activity generator / graph | Scenario | AI Lead | Not Started |

## Narrative and progression

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| NAR-001 | MVP contains a playable prologue, one complete district arc, and finale/cliffhanger. | Narrative content | Browser + Playtest | Narrative Lead | Not Started |
| NAR-002 | Reverse chronology is limited to flash-forward framing; chapters otherwise move forward. | Narrative controller | Content review | Narrative Lead | In Progress |
| NAR-003 | Quantum Dynamics, Aether Skyspire, residents, and operations form 3–4 meaningful reputation tracks. | Reputation system | Unit + Scenario | Narrative Lead | Not Started |
| NAR-004 | Reputation changes rewards, dialogue, contracts, and selected upgrade access without branching the whole simulation. | Reputation adapters | Scenario | Systems Designer | Not Started |
| NAR-005 | Choices create disclosed tradeoffs rather than a binary morality meter. | Mission/narrative content | Playtest | Narrative Lead | Not Started |
| NAR-006 | Operator, Broker, and Magnate unlock new capabilities one meaningful option at a time. | Progression system | Scenario + Playtest | Systems Designer | Not Started |
| NAR-007 | Dialogue data has stable node IDs, conditions/effects, history, and validated references. | Dialogue schema/controller | Validation + Browser | Content Lead | In Progress |
| NAR-008 | Satire targets power and incentives, stays non-graphic, avoids real brands, and keeps action lines short. | Content guidelines | Editorial review | Narrative Lead | In Progress |

## UX

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| UX-001 | Every consequential action uses preview, confirmation, immediate feedback, and a persistent result. | Command/UI pattern | Browser + UX | UX Lead | In Progress |
| UX-002 | Errors state the blocker and a practical remedy; boot/save/compatibility failures never leave a blank canvas. | Error presentation | Browser | UX Lead | In Progress |
| UX-003 | Mode shifts preserve spatial context and expose a valid return-to-Builder action. | Camera / HUD | Browser + Playtest | UX Lead | In Progress |
| UX-004 | Builder top bar presents Capital, population, jobs, energy, satisfaction, time, weather, mode, and priority alert. | Builder HUD | Browser + visual | UX Lead | In Progress |
| UX-005 | Builder tool rail and inspector cover scoped tools, causes, costs, upgrades, and actions without competing modals. | Builder UI | Browser + visual | UX Lead | In Progress |
| UX-006 | Street HUD presents route/objective/Heat/safe return plus context-specific timer, speed/condition, or health/stamina. | Street HUD | Browser + visual | UX Lead | In Progress |
| UX-007 | Critical news/radio never obscures controls or becomes the sole source of objectives. | News/audio UI | Browser + A11y | Accessibility Lead | In Progress |
| UX-008 | Onboarding is playable, skippable in explanation only, replayable from Help, and initializes all required state. | Onboarding controller | Browser + Playtest | UX Lead | Not Started |
| UX-009 | Interaction, mission, save, and alert status use one authoritative domain snapshot rather than UI-owned truth. | UI view models | Integration | Tech Lead | In Progress |
| UX-010 | A pause menu exposes resume, settings, help, restart/retry where valid, and safe exit/new-game choices. | Pause/menu controller | Browser | UX Lead | In Progress |

## Accessibility

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| A11Y-001 | All keyboard/mouse actions are remappable and browser-reserved conflicts are validated. | Settings / bindings | Integration + Browser | Accessibility Lead | Implemented |
| A11Y-002 | Orbit, on-foot, and vehicle camera sensitivity are independently adjustable. | Settings / camera | Integration + Browser | Accessibility Lead | Implemented |
| A11Y-003 | Critical audio has subtitles/text alternatives and dialogue history. | Audio/subtitle UI | Browser + manual | Accessibility Lead | Not Started |
| A11Y-004 | UI scale, minimum readable text, and high-contrast mode function in gameplay. | UI settings/theme | Browser + visual | Accessibility Lead | Implemented |
| A11Y-005 | Overlays use colorblind-safe palettes plus icons/patterns, never color alone. | Overlay rendering | Visual + manual | Accessibility Lead | Not Started |
| A11Y-006 | Camera shake, flashes, motion, and bloom can be reduced independently. | Settings / rendering | Browser + visual | Accessibility Lead | Implemented |
| A11Y-007 | Toggle/hold options exist for sprint, braking, and relevant repeated actions. | Input settings | Integration + Browser | Accessibility Lead | In Progress |
| A11Y-008 | Action difficulty, driving assists, and mission timer leniency are adjustable. | Assist settings | Scenario + Browser | Accessibility Lead | In Progress |
| A11Y-009 | Gameplay and dialogue truly pause while menus remain keyboard accessible. | Scheduler / modal UI | Integration + Browser | Accessibility Lead | Verified |
| A11Y-010 | DOM menus provide logical focus order, labels, visible focus, and keyboard operation. | UI components | Browser + axe/manual | Accessibility Lead | In Progress |

## Persistence

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| SAVE-001 | Local IndexedDB saves use a versioned plain-data envelope with seed, city, player, mission, progression, settings reference, and transaction counter. | SaveService | Unit + Browser | Tech Lead | Not Started |
| SAVE-002 | Three.js, DOM, functions, caches, and middleware instances are never serialized. | SaveService serializers | Unit | Tech Lead | Implemented |
| SAVE-003 | Autosave occurs at stable intervals and major transactions; manual save is limited to safe states. | SaveService / session | Integration + Browser | Tech Lead | In Progress |
| SAVE-004 | Saving has a visible in-progress/success/error state without >100 ms gameplay hitch. | Save UI / SaveService | Browser + Performance | UX Lead | In Progress |
| SAVE-005 | A rotating recovery slot protects against corruption and interrupted writes. | SaveService | Integration + fault injection | Tech Lead | Not Started |
| SAVE-006 | Ordered migrations retain originals, reject future versions safely, and offer a new-game recovery path. | Save migrations | Unit + Browser | Tech Lead | Not Started |
| SAVE-007 | Save/load preserves city, player, mission, economy, progression, and controlled-entity state across the support matrix. | SaveService / session | Scenario + Browser | QA Lead | In Progress |
| SAVE-008 | Mission rewards and major transactions cannot duplicate across save/load or retry. | Transaction ledger | Integration | Tech Lead | Verified |
| SAVE-009 | MVP performs no offline income or unbounded background-tab catch-up. | Scheduler / SaveService | Integration + Browser | Tech Lead | In Progress |
| SAVE-010 | A clean profile, valid resume, corrupt-save recovery, and explicit new game are understandable and functional. | Boot flow / SaveService | Browser | UX Lead | In Progress |

## Performance

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| PERF-001 | Representative play targets 60 FPS recommended and sustains ≥30 FPS minimum. | Performance policy | Performance | Performance Lead | In Progress |
| PERF-002 | Routine frame time stays ≤33 ms; transition spikes are measured and bounded. | Scheduler / rendering | Performance | Performance Lead | In Progress |
| PERF-003 | Initial interactive load is <10 s typical or shows useful staged progress. | Boot/assets | Performance + Browser | Performance Lead | In Progress |
| PERF-004 | High profile starts below 500 visible draw calls unless an evidence-backed amendment changes the budget. | Rendering | Performance | Rendering Lead | Implemented |
| PERF-005 | Low/medium/high adjust costly presentation without removing traffic, targets, or hazards. | PerformanceSystem | Unit + Browser | Rendering Lead | In Progress |
| PERF-006 | Simulation LOD has Near, Visible, Distant, and Dormant behavior with bounded detailed agents. | Spawn/LOD systems | Scenario + Performance | AI Lead | In Progress |
| PERF-007 | Assets are split/cached/lazy where appropriate and expensive optional content is not monolithic. | Build/assets | Build analysis | Rendering Lead | In Progress |
| PERF-008 | Temporary effects are pooled and every GPU/DOM/physics/timer/listener resource has an owner/disposal path. | Lifecycle contracts | Soak + code review | Tech Lead | In Progress |
| PERF-009 | Fifty mode cycles and ten mission restarts do not grow owned resource counts. | Transition/mission lifecycle | Automated soak | QA Lead | Not Started |
| PERF-010 | A two-hour representative soak completes without crash, count growth, or progressive major slowdown. | Whole runtime | Performance soak | QA Lead | Not Started |

## Release

| ID | Acceptance requirement | Responsible system | Required test | Verification owner | State |
|---|---|---|---|---|---|
| REL-001 | Static-host build requires no account, private service, mandatory analytics, cloud save, or online economy. | App/deployment | Release | Release Lead | Implemented |
| REL-002 | Current evergreen desktop keyboard/mouse browsers have a documented compatibility matrix. | Compatibility service | Release matrix | QA Lead | Not Started |
| REL-003 | Missing graphics/browser features are detected before play and produce a clear recovery message. | Compatibility service | Browser matrix | QA Lead | Not Started |
| REL-004 | Critical flows have automated browser coverage for WebGL boot, DOM, IndexedDB, keyboard, and deterministic hooks. | Playwright harness | Browser | QA Lead | Verified |
| REL-005 | MVP scope, mission/template budgets, vocabulary, deferred breadth, and feature gates are executable and documented. | Scope config / docs | Unit + review | Product Lead | Verified |
| REL-006 | Production build, unit suite, browser smoke, content validation, and bundle baseline pass repeatably. | CI | CI | QA Lead | Verified |
| REL-007 | Release candidate has no open P0/P1 defects or knowingly misleading UI state. | Defect process | Release review | Release Lead | Not Started |
| REL-008 | Art, animation, audio, writing, balance, interface, accessibility, and compatibility each receive a dedicated signoff pass. | Discipline checklists | Release review | Product Lead | Not Started |
| REL-009 | The first-session experience hides/gates non-MVP breadth and exposes only acceptance-ready features. | Feature flags / boot flow | Browser | Product Lead | Verified |
| REL-010 | Invalid content fails actionably in development and uses a safe production fallback where possible. | Data validation | Validation + Browser | Content Lead | Verified |
| REL-011 | Error reports include mode/content IDs and collect no personal/save/dialogue data by default. | Diagnostics / privacy | Integration + privacy review | Tech Lead | In Progress |
| REL-012 | A release gate may pass, pass conditionally, repeat, or cut scope; defining cross-mode/save/performance contracts cannot be cut. | Production process | Gate review | Product Lead | Verified |
