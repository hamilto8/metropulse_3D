# MetroPulse 3D MVP Scope Lock

> **Effective:** 2026-07-17  
> **Authority:** GDD v3 §16, the completion roadmap, and the executable constants
> in `src/config/MvpScope.js` and `src/config/FeatureFlags.js`.

## Locked release target

- World: West Core, Central Park, and the complete primary bridge corridor.
- Zones: Residential, Commercial, and **Operations**. `INDUSTRIAL`, `IND`, and
  `OFFICE` are load/input aliases normalized to canonical zone IDs; they are
  not MVP product vocabulary or newly persisted IDs.
- Authored missions: exactly 10 selected stable IDs, within the frozen 8–12 budget.
- Activity templates: Taxi, Courier, Delivery, Race, Sabotage, and Survival
  (6 families, within the frozen 5–7 budget).
- Narrative: playable prologue, one complete district arc, and a finale or
  cliffhanger.
- Reputation: Quantum Dynamics, Aether Skyspire, residents, and operations,
  with 3–4 tracks retained after content validation.
- Progression: Operator, Broker, and Magnate capability tiers.

The executable mission list is the only release list. The five additional
mission records currently in `missions.json` are retained as authored variants
but excluded from the default first-session runtime and release acceptance.

## Feature disposition

| Feature | Scope status | Default flag | Runtime/release disposition |
|---|---|---:|---|
| Aircraft and airfield gameplay | Post-MVP | Off | Code retained; system, controls, camera preset, HUD, and release tests excluded by default. |
| Rocket launch | Post-MVP spectacle | Off | Scenic geometry may remain; launch control and simulation are inaccessible. |
| East-side development | First post-MVP expansion | Off | Distant skyline may remain as scenery; unlock/build controls and release testing are excluded. |
| Countryside expansion | Post-MVP | Off | Scenic world and safety colliders may remain; authored gameplay and release acceptance are excluded. |
| Temporary Mayhem sandbox | MVP target, incomplete | Off | Must remain hidden until rollback/cleanup, warning, cap, and save-safety requirements pass. |
| Mayhem variants | Post-MVP breadth | Off | No release acceptance or first-session exposure. |
| Persistent Mayhem | Post-MVP | Off | Saves force Mayhem off unless the flag is deliberately enabled in an authorized build. |
| Gamepad | Optional extra | Existing path retained | Not promised by the MVP support matrix; invisible without a connected device and not a release blocker. |
| Water/fire/health/transit depth | Post-MVP modules | Existing shallow data retained | MVP owns energy plus simplified safety/repair only. |
| Additional vehicle classes | Post-MVP unless required by one frozen mission/archetype | N/A | No new class without a written mission/progression/accessibility justification. |

Development builds may override flags through the explicit `features` query for
isolated testing. Production builds ignore URL flag overrides. A flag is not a
claim of completion: enabling an item still requires its traceability rows and
phase gate to pass.

## Scope-change protocol

Any change to the footprint, mission count, activity-family count, three-zone
vocabulary, save policy, or supported platform requires all of the following:

1. A GDD amendment or accepted entry in `DESIGN_DECISIONS.md`.
2. Updated scope constants and unit tests in the same change.
3. Updated requirement traceability and performance/content budgets.
4. Named product and engineering owners.
5. A statement of what is cut, delayed, or made more expensive in exchange.

New districts, mission-template families, vehicles, aircraft, rocket,
countryside, East-side content, persistent Mayhem, multiplayer, cloud saves,
mobile gameplay, interiors, accounts, or mod support may not enter the default
release path through an unreviewed UI or data-only change.
