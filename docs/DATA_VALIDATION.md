# Game Data Validation

## Purpose

P2.4 establishes one fail-closed boundary for authored content and persisted
content references. MetroPulse validates the complete content graph before it
offers a session action or constructs world, renderer, input, mission, or save
runtime services.

The boundary covers missions and embedded dialogue, buildings, zones,
districts, factions, progression, weather, MVP scope, and save data.

## Authorities

- `src/data/ContentDefinitions.js` owns stable district, zone, faction,
  progression, vehicle-content, and world-bound definitions.
- `src/world/BuildingCatalog.js` remains the building authority.
- `src/systems/Weather.js` remains the weather authority. Every weather record
  carries the stable ID used by the definition map.
- `src/data/missions.json` remains the mission and dialogue authority. Authored
  locations carry a stable `districtId`; `district` remains player-facing copy.
- `src/data/MissionDataValidator.js` validates mission and dialogue structure.
- `src/data/GameDataValidator.js` composes validators, validates cross-record
  references and scope, detects prerequisite cycles, and returns an immutable
  `ContentRegistry`.
- `src/save/SaveGameState.js` validates save shape and content compatibility
  before restore. Storage mechanics remain in `SaveService` and the IndexedDB
  repository.

Zone metadata was moved out of `CityEditorSystem` into the shared content
definitions. The editor resolves aliases through `getZoneDefinition`, so the
validator, editor, and save loader no longer maintain competing zone tables.

## Boot order and failure behavior

The boot pipeline runs in this order:

1. Browser/storage capability checks.
2. Complete game-data validation and immutable registry construction.
3. Settings load.
4. Save discovery using that exact registry.
5. Core asset preparation.
6. Session-action presentation.

An authored-data failure throws `DataValidationError`. It includes a stable
error code plus `source`, `recordId`, `field`, and `path`, for example:

```text
missions[mission_executive].pickup.districtId:
references missing districts record REMOVED_DISTRICT.
```

`BootStageError` preserves the actionable message and prevents later stages
from running. An incompatible save is isolated to its slot: Continue or Recover
is hidden for that invalid slot, the boot warning names the exact save path,
and New Game remains available. No save domain or runtime owner is mutated.

## Validation rules

All authored record collections are non-empty, use stable non-empty IDs, and
reject duplicates. References resolve in the same validated registry.

- Mission objectives, vehicle types, dialogue actions, building categories,
  generator types, road types, zone kinds, and release scopes are enums.
- Mission locations and district bounds use finite coordinates inside the
  supported world bounds.
- Dialogue node keys are stable IDs; `start` is required; every choice target
  exists; and every node is reachable from `start`.
- Race missions require valid checkpoints and rivals. Sabotage missions require
  an authored action and positive duration.
- Building footprints, dimensions, costs, colors, and simulation values are
  type/range checked.
- Zone aliases may not collide with another alias or stable zone ID.
- Progression ranks are unique; every prerequisite exists; and the complete
  graph is acyclic.
- Weather values are bounded and the default mode resolves.
- Frozen MVP missions, activity families, districts, and zone labels resolve
  and agree with the content catalog.

Save validation additionally rejects duplicate instance IDs/zone keys,
out-of-bounds transforms, unknown building/zone/weather/mission/dialogue/
faction/progression IDs, malformed mission run counts, and invalid faction or
progression values. Live controlled-entity availability is checked again after
runtime population exists.

## Extension rules

1. Add or change data only in its existing authority; do not add a second
   validation-only copy.
2. Treat stable IDs as persisted API. Renaming or removing one requires an
   explicit save/content migration.
3. Add the domain validator before adding a consumer for a new authored field.
4. Validate local shape first, then cross-record references, then graph-wide
   invariants.
5. Error at the narrowest useful field path and include the referenced ID.
6. Add fixtures for the normal record plus missing, duplicate, invalid-enum,
   impossible-range, missing-reference, and cycle cases that apply.
7. Validate new persisted content references during discovery and again
   against live availability when runtime population is required.
8. Never normalize an unknown enum or missing persisted reference into a
   plausible value during load. Migrations must be explicit and test-covered.

## Verification

`test/DataValidation.test.js` covers production content, immutable registry
lookups, duplicates, missing district/dialogue references, invalid enums,
impossible coordinates, missing prerequisites, and circular prerequisites.
`test/PersistenceSystem.test.js` covers incompatible references across weather,
missions, dialogue, zones, factions, and progression. `test/BootFlow.test.js`
verifies that incompatible save content disables Continue with the exact
failing path. The Playwright boot flow verifies the same visible outcome before
runtime composition.

