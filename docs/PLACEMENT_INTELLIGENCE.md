# Placement Intelligence Contract

> **Roadmap item:** P4.2  
> **Domain authority:** `src/world/PlacementIntelligence.js`  
> **World-edit authority:** `src/world/CityEditorSystem.js` using
> `src/world/WorldEditTransaction.js`

## Decision contract

Every ordinary construction preview and commit-time recheck produces one
deeply immutable result:

```text
{
  valid,
  position,
  blockers: [{ code, priority, message, remedy, detail }],
  primaryBlocker,
  preview
}
```

`primaryBlocker` is the first item after stable priority sorting. The UI never
reconstructs rules or invents its own explanation; it renders this record.
Legacy callers such as save restoration may use `isPlacementValid()`, but that
method is only a boolean projection of the same structured decision.

The current stable blocker vocabulary covers invalid targets, progression
locks, locked districts, world bounds, protected landmarks, water, slope,
player safety clearance, road overlap, world collisions, zoning restrictions,
missing road access, service shortage, and insufficient funds. Every blocker
has a concrete remedy and optional machine-readable detail such as a district
ID, service shortfall, or colliding building ID.

## Validation policy

- Residential, Commercial, and Operations buildings require adjacency within
  12 metres of an authored road corridor or a connected editor road segment.
- Road sockets may meet edge-to-edge, but no structure may overlap active
  travel lanes.
- The complete oriented footprint, including construction clearance, must
  remain inside `WORLD_BOUNDS` and outside protected landmark envelopes.
- Terrain is sampled at all four footprint corners. Ordinary buildings default
  to an 8-degree maximum slope; road segments default to 12 degrees. Content
  may lower or raise this through `maxSlopeDegrees`.
- Open water blocks every structure except authored bridge road segments.
- Live buildings, protected countryside scenery, and the controlled player or
  vehicle are collision/safety blockers. Save migration alone may deliberately
  replace overlapping procedural countryside scenery.
- Existing parcel zoning is enforced when present. Infrastructure remains
  zoning-neutral; facilities retain the P4.1 compatibility policy.
- Power and water are the critical ordinary-development prerequisites in
  P4.2. A placement is evaluated against projected post-build capacity, not
  only current coverage. Content can opt into additional hard requirements
  through `requiredServices`; explicit `fireDemand` becomes a fire-safety
  prerequisite. Broader fire reach and incident policy remain owned by P4.3.
- District and progression checks fail closed if their authority cannot answer
  safely. Treasury is rechecked at commit, so a stale green ghost cannot spend
  funds that no longer exist.

## Forecast policy

`createPlacementPreview()` exposes the same renderer-independent forecast for
catalog inspection and map placement:

- capital cost, gross income, operating cost, and net cashflow;
- Fast, Medium, Long, or No Direct Payback classification;
- resident, job, and traffic capacity;
- current demand and expected relief category;
- projected power, water, and fire capacity/demand/surplus;
- happiness and derived land-value effect;
- service-shortage, satisfaction, and treasury-concentration risks where
  applicable.

The forecast uses `BuildingEconomyAdapter` for land-value and finance semantics,
preventing the blueprint and the committed `EconomySystem` record from drifting.

## Atomic world edits

Placement, movement, rotation, and demolition run synchronously through
`WorldEditTransaction`. Each participant registers compensation before its
mutation. A thrown error reverses the possibly partial step and every earlier
step in strict last-in-first-out order. An explicit `false` means the current
participant rejected without mutation, so earlier applied steps are reversed
without calling an inverse for the rejected step.

| Edit | Transaction participants |
|---|---|
| Place | Treasury, rendered building/list, inspector, physics, economy, optional game/city adapters, traffic graph |
| Move | Old traffic/economy registration, render/plot/physics transform, new economy/traffic registration |
| Rotate | Traffic registration, render/footprint/collider shape, rebuilt traffic registration |
| Demolish | Traffic, city/game adapters, economy, physics, inspector, scene/list, salvage credit |

Save scheduling occurs only after the transaction commits. Save serialization
reads the committed building list, plot, rotation, stable economy ID, and zones,
so it cannot capture a half-applied editor record. Renderer resources are
disposed only after successful demolition, or while rolling back a newly
created building, when no committed owner can need them again.

## Extension rules

- Add a blocker only with a stable code, explicit priority, player-readable
  message/remedy, and deterministic test.
- Add a service prerequisite through content data; do not branch the UI.
- A new subsystem that participates in world edits must expose both apply and
  inverse operations. The transaction fails before using an integration that
  cannot compensate.
- Do not introduce a second placement predicate for UI, restore, AI, or mods.
  Consume the structured result or its boolean compatibility projection.

## Verification

- `test/PlacementIntelligence.test.js` covers blocker ordering/immutability,
  road and service prerequisites, the complete forecast, and LIFO rollback.
- `test/BuilderEconomyIntegration.test.js` covers successful move propagation
  plus participant-rejection rollback across transforms, traffic, and economy.
- `test/browser/smoke.spec.js` finds a valid parcel through production rules,
  renders the complete forecast, checks road and content blockers, commits a
  real structure, and verifies treasury, render list, physics, economy, and
  save-facing state move together.
