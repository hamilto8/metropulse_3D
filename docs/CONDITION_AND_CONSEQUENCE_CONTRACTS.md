# Condition and Consequence Contracts

> **Status:** P3.1 implementation contract  
> **Owners:** `CityConditionService` for reads; `MissionOutcomeService` for writes  
> **Persistence:** `save.data.missions.contracts`, with faction/progression compatibility views

## Purpose

P3.1 creates a renderer-independent boundary between city simulation and
mission rules. Mission code and authored content can ask what is true about the
city and can submit a declared outcome without reading Three.js objects,
mutating DOM, or issuing one-off writes across unrelated systems.

The boundary has two parts:

- `CityConditionService` composes immutable condition snapshots from existing
  authorities and durable outcome state.
- `MissionOutcomeService` validates and applies a complete consequence
  transaction once, then stores an immutable receipt with source and
  before/after facts.

Neither service owns presentation. P3.2 lifecycle code and later debrief UI are
consumers of these contracts.

## Ownership

| Concept | Authority | Contract behavior |
|---|---|---|
| Capital, base services, buildings, parcel land value | `EconomySystem` | Queried directly; Capital outcome deltas use its validated credit/debit API. |
| Live congestion | `TrafficSystem` | Read through a plain-data provider and combined with authored traffic policy. |
| Current weather | `Environment`/weather owner | Read through a callback as plain data. |
| Outcome transactions and authored cross-mode state | `MissionOutcomeService` | One durable ledger and state snapshot. |
| Mission-facing city reads | `CityConditionService` | One immutable facade; never a second mutable truth. |
| UI | UI modules | Consume condition snapshots and transaction explanations only. |

Faction and progression values in their legacy save domains are derived
compatibility views of the outcome state. Save validation rejects a document if
those views disagree with `missions.contracts`, preventing two persisted truths.

## City-condition queries

Every query returns a deeply immutable object with this common shape:

```js
{
  type: 'BRIDGE',
  subjectId: 'primary-bridge',
  value: { /* rule-facing value */ },
  facts: { /* base readings and modifiers that explain the value */ },
  sources: [{ transactionId, summary }],
  revision: 4
}
```

Built-in query types are:

| Type | Required selector | Important result fields |
|---|---|---|
| `TRAFFIC` | `scopeId`; optional `districtId` | congestion, density multiplier, access, enforcement, hazard |
| `BRIDGE` | `bridgeId` | state, access, condition, safety, repair state, congestion |
| `SERVICE_COVERAGE` | `service`; optional `districtId` | coverage, percentage, adequacy, outage state |
| `SAFETY` | optional `districtId` | score, rating, active incidents |
| `REPAIR` | `targetId` | status, progress, estimated cost |
| `LAND_VALUE` | optional `x` and `z`, or `districtId` | effective value and resolved district |
| `WEATHER` | none | mode, severity, visibility, road grip |
| `DISTRICT` | `districtId` | scope, unlock, stable/disrupted state, incident count |
| `AUTHORED_FLAG` | `flagId` | scalar value plus whether it was explicitly set |

Authored prerequisite checks use `evaluate()` or `evaluateAll()` rather than
duplicating comparison logic. Supported operators are equality, inequality,
numeric comparisons, `IN`, `CONTAINS`, `TRUTHY`, and `FALSY`. `evaluateAll`
supports explicit `ALL` and `ANY` composition and returns every underlying
condition result so a failed offer can explain its blocker.

Additional condition families may be registered with `registerResolver`. A
custom resolver receives a cloned request and an immutable context. Built-in
types cannot be replaced.

## Mission outcome transactions

Call `MissionOutcomeService.apply()` with a stable transaction ID, structured
source, player-facing summary, and one or more commands:

```js
outcomes.apply({
  transactionId: 'mission:bridge-response:run-1:success',
  source: {
    kind: 'MISSION',
    contentId: 'mission_bridge_response',
    outcome: 'SUCCESS',
    runId: 'run-1',
    reason: 'The emergency lane was restored before rush hour.'
  },
  summary: {
    title: 'Bridge response succeeded',
    description: 'Rapid response restored access and public confidence.'
  },
  commands: [
    { type: 'CAPITAL_ADJUSTED', amount: 2500 },
    {
      type: 'TRAFFIC_SET',
      scopeId: 'primary-bridge',
      districtId: 'PRIMARY_BRIDGE_CORRIDOR',
      densityMultiplier: 0.75,
      access: 'OPEN',
      enforcement: 0.8,
      hazardLevel: 0.1
    }
  ]
});
```

Supported commands cover the complete P3.1 requirement:

| Command | Durable effect |
|---|---|
| `CAPITAL_ADJUSTED` | Signed shared-Capital delta; cannot make Capital negative. |
| `BUILDING_STATE_SET` | Validated building state and operational status. |
| `INFRASTRUCTURE_STATE_SET` | State, access, condition, and safety of a stable infrastructure ID. |
| `INCIDENT_RECORDED` / `INCIDENT_RESOLVED` | Persistent incident lifecycle and spatial modifiers. |
| `REPAIR_SET` | Repair status, normalized progress, and estimated cost. |
| `SERVICE_OUTAGE_SET` | District/global outage and coverage multiplier. |
| `TRAFFIC_SET` | Scoped density, access, enforcement, and hazard policy. |
| `FACTION_REPUTATION_ADJUSTED` | Authored-faction delta clamped to its declared range. |
| `PROGRESSION_SET` | Stable Operator/Broker/Magnate progression state. |
| `UNLOCK_SET` | Generic stable capability/district unlock state. |
| `NEWS_PUBLISHED` | Stable news item with headline, body, and priority. |
| `FOLLOW_UP_MISSION_SET` | Validated mission ID and availability/lifecycle status. |
| `AUTHORED_FLAG_SET` | String, finite number, boolean, or null authored flag. |

Faction, progression, follow-up mission, and district references fail closed
against the validated content registry when one is supplied. Building commands
fail before mutation when the economy owner does not contain the stable building
ID. Numeric bounds and enums are normalized in one implementation rather than
inside mission scripts.

## Idempotency and atomicity

The transaction ID is the idempotency key.

1. The service normalizes the source, summary, every command, and every stable
   reference before mutating anything.
2. It reduces all commands against a cloned state and checks the projected
   Capital balance.
3. It commits the validated Capital delta and replaces the durable outcome
   state.
4. It records one receipt and publishes one event.

Reapplying byte-equivalent normalized content under the same ID returns the
original receipt with `duplicate: true` and performs no write. Reusing the ID
with different content throws `OutcomeConflictError`. A malformed late command
or unaffordable debit leaves both Capital and outcome state unchanged.

Mission lifecycle code must derive transaction IDs from stable run/checkpoint
identity, never from wall-clock time. Recommended forms are:

- `mission:<mission-id>:<run-id>:success`
- `mission:<mission-id>:<run-id>:partial`
- `mission:<mission-id>:<run-id>:failure`
- `management:<decision-id>:<decision-instance-id>`

## Explanation contract

Each receipt stores:

- stable transaction and command IDs;
- source kind, content ID, outcome, run, actor, and reason;
- player-facing title and description;
- normalized commands;
- per-command subject, before value, after value, and explanation;
- deterministic application sequence.

`explain(transactionId)` returns the UI-safe immutable projection. Result and
news UI must consume this projection instead of reconstructing causes from the
current city snapshot, which may have changed since the outcome occurred.

## Persistence and recovery

`SaveGameState` captures the outcome ledger under
`save.data.missions.contracts`. Restore validates the complete save before any
live owner is mutated, restores `EconomySystem`, then restores the outcome state
without replaying commands. This prevents Capital, reputation, damage, or
unlocks from duplicating on Continue or recovery-slot load.

Older saves without `missions.contracts` create an empty ledger and import the
validated faction/progression compatibility views. The contract is plain data;
it never serializes providers, callbacks, DOM, Three.js objects, or listeners.

## Extension rules

When adding a consequence family:

1. Confirm there is a concrete mission/management consumer and one authoritative
   domain owner.
2. Add one command constant, normalization branch, reducer branch, persistence
   validation, and focused tests.
3. Add or extend a condition resolver if mission rules must read the result.
4. Store stable IDs and source transaction IDs in durable records.
5. Test valid application, invalid late command, duplicate replay, conflicting
   replay, save/restore, and plain-language explanation.
6. Do not let UI code, mission presentation objects, or renderer state become a
   command handler or condition authority.

P3.2 should consume these APIs while adding lifecycle states. P3.3 and later
work should project the same receipts into debrief, news, visible traffic,
closures, hazards, and follow-up offers rather than introducing parallel paths.
