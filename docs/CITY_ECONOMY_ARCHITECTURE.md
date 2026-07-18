# City Economy Architecture

## Ownership and data flow

`EconomySystem` is the authoritative, renderer-independent city store. World
objects never update HUD counters directly. The supported flow is:

1. `BuildingEconomyAdapter` converts an authored or player-built structure to
   one canonical economy record.
2. `CityEditorSystem` performs the treasury transaction and world placement,
   then registers that record. A failed placement rolls the world and payment
   back.
3. `EconomySystem` derives services, cash flow, demographics, demand,
   happiness, land value, and fiscal state from registered records, incidents,
   and zone policies.
4. `UIManager` and `SaveService` subscribe to immutable economy events.

This boundary keeps Three.js meshes, Cannon bodies, DOM state, and simulation
math independent.

## Building economy contract

Every building record can provide:

- `grossIncomeRate` and `operatingCostRate` in credits per simulation second;
- `population`, `housingCapacity`, `employees`, and `jobCapacity`;
- power, water, and fire capacity/demand;
- global happiness/land-value effects or a positioned amenity radius;
- an operational lifecycle flag.

Legacy `passiveIncomeRate` remains a supported revenue alias for version-1
saves. New integrations should use the explicit gross and cost fields.

Catalog `incomePerMinute` is treated as a compact net authoring field: positive
values become revenue and negative values become upkeep. The adapter is the
only place where that compatibility rule lives.

## Derived simulation

The budget model applies the lowest power/water coverage as a productivity
multiplier to revenue, then subtracts upkeep. Recurring costs can exhaust cash
but cannot create invalid negative treasury state. Fiscal state is `STABLE`,
`DEFICIT`, or `INSOLVENT`.

Demographics derive a 62% workforce from population. Explicit job capacity
produces employment, unemployment, vacancies, and a happiness penalty when
residents cannot find work. Housing and job availability feed visible
residential, commercial, and industrial demand scores.

Happiness is reported as an explainable breakdown:

- baseline;
- operational buildings and amenities;
- zoning policy;
- active incidents;
- utility/fire coverage;
- employment.

Each component remains independent until the final 0–100 clamp, so replacing
or removing a zone is reversible even near the bounds.

## Zoning rules

Zones are persistent 30-metre parcels with stable IDs. Rezoning costs credits,
replaces the previous policy atomically, and is stored as an explicit economy
effect. A zoned parcel constrains incompatible new development; infrastructure
remains allowed so roads and service connections can cross district types.

## Simulation clock

Economy time follows the city clock. Pausing time pauses recurring cash flow,
and the 0.5×/1×/5×/15× controls scale it alongside the visible day/night cycle.
Direct action systems retain their real-time deltas.

## Extension points

- Add authored buildings through `BuildingCatalog` and map new fields only in
  `BuildingEconomyAdapter`.
- Add derived metrics to `EconomySystem.snapshot()` and consume snapshots in
  the UI; do not introduce a second mutable counter.
- Add zone behavior through explicit zone records rather than mutating base
  happiness or land value.
- Add lifecycle transitions as economy commands/events, keeping placement,
  demolition, destruction, and restore idempotent.

Future depth should prioritize localized service networks, gradual occupancy
and migration, traffic/productivity feedback, a fixed-point transaction ledger,
and save migrations before adding further scalar bonuses.
