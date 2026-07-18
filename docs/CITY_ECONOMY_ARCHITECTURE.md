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
- optional power, water, and fire reach for capacity-providing facilities;
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
but cannot create invalid negative treasury state. P4.5 defines `STABLE`,
`DEFICIT`, `INSOLVENT`, and `RECOVERY`, exposes deterministic runway, and gates
risky discretionary debits through one immutable pre-spend policy. Essential
repair and cleanup remain available. Insolvency offers a persisted bounded
stabilization grant and recovery restrictions rather than an unrecoverable game
over. `ECONOMY_RECOVERY_AND_BALANCE.md` is the complete rule and tuning
contract.

Demographics derive a 62% workforce from population. Explicit job capacity
produces employment, unemployment, vacancies, and a happiness penalty when
residents cannot find work. Housing and job availability feed visible
residential, commercial, and operations demand scores.

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

The MVP has exactly three development-zone IDs: `RESIDENTIAL`, `COMMERCIAL`,
and `OPERATIONS`. Utility, safety, and civic capacity comes from constructed
`FACILITIES`, not additional player-facing zone types. Save schema 2 normalizes
legacy `INDUSTRIAL` parcels to `OPERATIONS` and `OFFICE` parcels to
`COMMERCIAL` while preserving their stable parcel keys and numeric effects.

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

Future depth should prioritize gradual occupancy and migration, a fixed-point
transaction ledger, and save migrations before adding further scalar bonuses.

P4.3 implements the first localized layer without changing economy ownership.
`CityServiceModel` combines these aggregate readings with facility reach and
outcome-owned spatial outages. `SERVICE_AND_INCIDENT_MODEL.md` is the extension
contract for service reach, response funding, cleanup, repair, and street work.

P4.4 implements traffic/productivity feedback through the renderer-independent
`TrafficProductivityModel`. It supplies a validated mobility feedback record to
the economy rather than mutating City Pulse fields directly. Utility and
mobility productivity multiply, management-policy cost remains itemized, and
filled versus traffic-accessible employment remain separate explainable facts.
`TRAFFIC_AND_PRODUCTIVITY_FEEDBACK.md` is the extension contract for aggregate
congestion, road capacity, bridge policy, missions, sampled agents, alerts, and
street presentation.

P4.5 centralizes starting funds, base income, mission scale, incident costs,
fines, construction recovery, and progression prices in `EconomyBalance`.
`EconomyScenarioSimulator` advances the real economy at explicit 15-, 30-, 60-,
and 120-minute horizons; it must never become an alternate mutable simulation.
