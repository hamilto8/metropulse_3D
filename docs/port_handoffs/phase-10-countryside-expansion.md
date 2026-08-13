# Phase 10 Countryside Expansion handoff

## Scope delivered

`countrysideExpansion` is now a complete independent, default-off Godot 4.6 feature package. When disabled it creates no terrain, scenery, road/bridge visuals, collision owners, tasks, input actions, UI, or save fields. The pure source-derived surface, traffic, sidewalk, reservation, and landing definitions remain shared safety/navigation data; rural construction remains unavailable at the editor boundary.

When enabled, the package builds source-aligned rolling terrain from `x = 420..800`, the second river and retaining walls, five guarded compact bridge decks, the four-by-five rural road grid, rocket access road, and mission-control spur. The terrain mesh uses the canonical hill-height authority for both rendering and trimesh physics. Road ribbons follow that same height model, while all five bridge decks and ten barriers register through the shared collision authority.

`CountrysideExpansionModel` deterministically projects all fourteen reservations, all seventeen valid suburban parcels, and a bounded ninety-attempt nature pass. Houses and tree trunks publish stable collider and occupancy IDs. Live editor placement therefore sees procedural scenery through the same world query as authored city obstacles. Browser-compatible legacy construction restores by removing only the overlapping procedural house/tree owner before attaching the saved user construction.

The package reuses the existing canonical navigation and aviation authorities: the 480-node traffic graph carries all five road crossings and the countryside grid; the 246-node sidewalk graph includes rural paths and the center bridge walkway; `AircraftLandingSurfaceModel` classifies and grade-checks clear countryside using the same rolling terrain authority. No duplicate path or landing models were introduced.

## Cleanup and persistence

- Feature shutdown detaches the editor occupancy owner, unregisters every terrain, riverbank, bridge, house, and tree collider, and frees the complete package tree.
- A fresh enabled session regenerates the same deterministic parcels and nature occupancy without save requirements.
- User construction restored over older procedural scenery clears only its direct scenery conflicts.
- The same user-content save remains valid when the package is unavailable; restored user buildings remain, while new rural construction stays feature-gated.
- No procedural scenery or package state is serialized.

## Verification

- Browser source suites: countryside planning, terrain physics, landing surface, and traffic-control contracts.
- Domain suite: 406 tests, including deterministic reservations/scenery, collision-free parcels, unique occupancy, and the independent construction feature gate.
- Godot build and formatting: zero warnings/errors and no formatting differences.
- Enabled headless integration: `phase10.countryside-expansion.passed` plus the full 179-assertion integration suite.
- Integration covers feature-off absence, exact package counts, terrain/bridge physics rays, traffic and pedestrian crossings, countryside landing, scenery collision, legacy restore replacement, unavailable-package saves, and full collider/node cleanup.
- The default-off clean/import/recovery matrix remains the final Phase 10 exit-audit responsibility after all five packages are combined.

Run the focused enabled scenario with:

```sh
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-phase10-feature.sh countrysideExpansion
```
