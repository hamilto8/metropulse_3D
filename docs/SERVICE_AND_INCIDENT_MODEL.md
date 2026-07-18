# MVP Services and Incidents

> **Status:** P4.3 implementation contract  
> **Capacity owner:** `EconomySystem`  
> **Incident/outage/work owner:** `MissionOutcomeService`  
> **Read model:** `CityServiceModel`  
> **Response coordinator:** `IncidentResponseService`

## Product model

The MVP exposes two primary service decisions:

- **Energy** is the power capacity, access, and outage model.
- **Safety and repair** combines fire-response reach, infrastructure condition,
  funded cleanup, and field repair.

Water remains a compatibility and placement prerequisite because existing
buildings and saves depend on it. It is still included in aggregate snapshots,
but it is not a third full incident-response game for MVP.

This is deliberately not a utility-network simulator. A local reading combines:

1. aggregate capacity and demand from `EconomySystem`;
2. a documented district backbone access factor;
3. the strongest nearby constructed facility reach;
4. active district or radius-based outage modifiers.

The result is sufficient to make facility placement and incident location
matter without pathfinding through pipes, wires, substations, or per-building
flow graphs. A full network graph requires a later playtest-backed design
decision.

## Ownership and data flow

`CityServiceModel` owns no mutable gameplay state. It composes immutable
readings from the two existing authorities:

```text
EconomySystem buildings/capacity ─┐
                                  ├─ CityServiceModel ─ conditions, City Pulse, services panel
MissionOutcomeService outages ────┘
```

`IncidentResponseService` also owns no parallel ledger. It translates a
management or street action into one atomic, idempotent outcome transaction.
This preserves the Phase 3 consequence contract and existing save domain.

World markers, alerts, UI cards, and interaction prompts are projections. They
may be rebuilt after reload and never determine whether an incident is active.

## Facility reach

An economy building service entry supports:

```js
{
  capacity: 90,
  demand: 0,
  reach: 220
}
```

`BuildingEconomyAdapter` is the only catalog-to-economy translator. Authored
`powerReach`, `waterReach`, and `fireReach` values become canonical `reach`
fields. Capacity facilities without an explicit radius receive conservative
service-specific defaults. Buildings without capacity keep zero reach.

At a world position, the strongest in-range operational facility can improve
district backbone access. It cannot increase coverage above the aggregate
capacity limit. Demolished or non-operational facilities contribute neither
capacity nor reach.

## Local outages

`SERVICE_OUTAGE_SET` retains its Phase 3 district/global behavior and adds
optional fields:

- stable target ID and plain-language cause;
- world position and influence radius;
- severity and coverage multiplier.

At the outage origin the complete multiplier applies. Its loss falls off
linearly to zero at the radius. District and city summaries use a bounded
weighted impact so a local fault is visible without pretending the whole city
is dark.

`CityConditionService.getServiceCoverage()` delegates to `CityServiceModel`
when composed in production. Mission requirements therefore observe the same
local readings shown to the player.

## Incident and work-order lifecycle

An incident report is one transaction containing any required combination of:

- `INCIDENT_RECORDED`;
- damaged `INFRASTRUCTURE_STATE_SET`;
- active spatial `SERVICE_OUTAGE_SET`;
- cleanup and repair `REPAIR_SET` work orders.

The response lifecycle is:

```text
Reported → Management funds response → Cleanup → Repair → Resolved
```

Cleanup and repair are both stored in the existing repairs collection. The
extended work-order fields are `workType`, label, incident/outage/infrastructure
references, prerequisite target, district, position, interaction radius, and
whether completion resolves the incident. Older repair records remain valid
and default to `REPAIR`.

Funding debits total response cost and schedules every pending work order in
one transaction. Insufficient Capital leaves both money and work orders
unchanged. Repeating a funded decision is idempotent.

Street work uses the canonical interaction service. It is available only near
the marked site, on foot, outside a mission-critical lifecycle, and after its
prerequisite. Cleanup blocks repair. Completion atomically closes the outage,
restores infrastructure, resolves the incident, updates alerts, and removes
the derived marker.

## Persistence and recovery

No new save domain is introduced. The richer commands, effects, outage records,
and work-order records serialize under `save.data.missions.contracts`.
Optional extension fields preserve the normalized shape and fingerprint of
older Phase 3 receipts. Restore publishes one domain event so the service
panel and Three.js markers rebuild from the ledger.

Required persistence cases are:

- reported but unfunded;
- funded and awaiting cleanup;
- cleanup complete and repair partially complete;
- fully resolved;
- duplicate funding or field-action retry.

## Extension rules

1. Add a service only when it changes a management and street decision.
2. Keep capacity/demand in `EconomySystem`; do not add a UI-owned counter.
3. Keep incidents, outages, and work progress in outcome commands.
4. Add renderer concerns only as projections over stable IDs and positions.
5. Preserve command fingerprint compatibility when extending optional fields.
6. Add a full network topology only after measured playtest evidence and a new
   accepted design decision.
