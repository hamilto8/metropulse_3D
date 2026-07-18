# Traffic and Productivity Feedback

> **Status:** P4.4 implementation contract  
> **Authority:** `METROPULSE_3D_COMPLETION_ROADMAP.md`, P4.4  
> **Implemented:** 2026-07-18

## Ownership

`TrafficProductivityModel` is the renderer-independent authority for aggregate
road demand, network and primary-bridge congestion, reachable jobs, delivery
reliability, traffic productivity, satisfaction pressure, management-policy
cost, mission traffic modifiers, hotspots, and ambient-traffic presentation
targets.

The data flow is deliberately one-way:

1. `EconomySystem`, `MissionOutcomeService`, and the live road graph provide
   workforce/job demand, authored restrictions/outages, and road capacity.
2. `TrafficProductivityModel` calculates one deeply immutable aggregate
   snapshot on the city clock.
3. `EconomySystem` consumes the snapshot through `setMobilityFeedback()`.
4. Missions, alerts, management UI, heat-map presentation, ambient traffic,
   and street markings read that same snapshot.
5. Visible vehicles expose a `PRESENTATION_ONLY` diagnostic sample. Their
   incidental stopped/crashed count never changes the authoritative aggregate.

`TrafficSystem` remains the owner of the road graph, AI routes, and rendered
vehicle agents. `EconomySystem` remains the owner of Capital and City Pulse.
`MissionOutcomeService` remains the owner of persistent outages, access
restrictions, hazards, and infrastructure consequences. P4.4 does not create a
parallel mutable copy of any of those domains.

## Aggregate model

The aggregate model is deterministic for the same ordered inputs. Its named
contributors are:

- commuter demand from workforce and job capacity;
- freight demand from Commercial and Operations demand;
- base road capacity plus connected player-built road segments;
- an explicit penalty for disconnected road segments;
- authored traffic density, access, and hazard policies;
- active service outages, with separate primary-bridge weighting;
- the current bridge policy.

The calculation produces bounded 0–1 network and bridge congestion values.
Those values derive:

- productivity and recurring-revenue multipliers;
- job-access multiplier, reachable jobs, and commute-limited jobs;
- delivery reliability, delayed-delivery percentage, and contract demand;
- an itemized traffic satisfaction modifier;
- management and street hotspot explanations;
- target ambient vehicle count and AI speed multipliers.

The exact tuning constants live only in `TrafficProductivityModel`. Consumers
must use the named snapshot fields rather than reproduce equations.

## Economy feedback

`EconomySystem.setMobilityFeedback()` validates and commits one immutable
feedback record. Utility productivity and mobility productivity multiply; they
do not overwrite one another. The budget breakdown separately exposes:

- `utilityProductivityMultiplier`;
- `mobilityProductivityMultiplier`;
- combined `productivityMultiplier`;
- traffic-policy `managementCostRate`.

Demographics retain filled employment and add accessible employment, so the UI
can explain the difference between a job that exists and one residents can
reliably reach. `happinessBreakdown.traffic` makes congestion and policy effects
independent of services, incidents, and ordinary unemployment.

## Management lever

P4.4 adds one lever because it has a complete, legible tradeoff:

| Policy | Benefit | Cost |
|---|---|---|
| Balanced access | Equal commuter/freight access; no policy cost | No freight advantage |
| Freight priority | +28% bridge capacity and +10 points delivery reliability before clamps | $120/min and −2 satisfaction |

The Traffic & Productivity panel previews and continuously reports the active
tradeoff. The button is keyboard-operable and exposes `aria-pressed`. Policy is
persisted by `TrafficProductivityModel.serialize()` and restored after the road
graph and outcome state are available.

No generic road-budget slider, toll percentage, or unexplained traffic bonus
was added. Future levers must define an equally explicit benefit, cost, street
presentation, persistence rule, and automated acceptance test.

## Mission integration

`getMissionImpact()` provides one mission-facing traffic contract:

- authored primary-bridge routes are unavailable while the bridge is closed;
- local routes remain available when they have no bridge dependency;
- congestion produces `NORMAL`, `BUSY`, `ELEVATED`, or `SEVERE` difficulty;
- time allowance scales with disruption so generated conditions do not create
  impossible authored missions;
- freight/delivery work receives a transparent disruption premium;
- delayed deliveries expose `NORMAL` or `SURGE` contract demand.

Mission acceptance rechecks this contract, and accepted runs persist the
already-adjusted time and reward through the existing lifecycle/checkpoint
state. Save/reload therefore cannot silently reroll a live contract.

## Alerts and player explanation

`TrafficAlertAdapter` publishes structured, deduplicated, resolvable alerts for:

- network congestion that reduces productivity and reachable jobs;
- bridge restrictions/outages and their delivery consequence;
- a delivery backlog that creates higher-value freight work.

Each alert includes severity, location, cause, duration, remedy, related IDs,
and a management-camera focus action where spatially relevant. The adapter
replaces the old UI timer that described congestion as a rendered-car sample.

The management panel exposes network congestion, bridge congestion/access,
productivity, reachable jobs, on-time deliveries, satisfaction, policy, and its
tradeoff. Existing City Pulse tooltips separately expose traffic satisfaction
and policy operating cost.

## Street presentation

Street state is a sampled rendering of the aggregate model:

- ambient moving-vehicle count converges gradually to the aggregate target;
- ordinary and bridge AI speeds consume aggregate speed directives;
- bridge closure stops ambient bridge traffic;
- freight priority draws cyan lane chevrons on the bridge;
- restrictions and outages draw pulsing amber/red bridge beacons;
- player-built road segments receive green connected or amber disconnected
  street rings, while their actual meshes and graph nodes remain authoritative;
- the traffic heat-map renders aggregate hotspots rather than counting visible
  cars.

Player-controlled, mission, crashed, emergency, and pursuit vehicles are never
culled merely to meet an ambient presentation target.

## Persistence and compatibility

New saves include the optional `mobility` feature domain with version 1 and the
bridge policy. Existing schema-2 and legacy saves remain valid; absence of the
domain restores Balanced access. Aggregate values are derived after restore
instead of persisted, preventing stale congestion from disagreeing with
restored roads, outcomes, or economy.

`TrafficSystem.getCongestionMetrics()` remains the compatibility query used by
mission conditions. With the aggregate owner present it returns the aggregate
index, bridge state, productivity/job/delivery facts, and an explicitly nested
`visibleSample`. Older isolated consumers without the model retain the legacy
calculation.

## Verification

Focused Node coverage verifies:

- immutability and deterministic economy feedback;
- connected-road capacity and disconnected-road hotspots;
- complete bridge-policy benefit/cost and save/restore;
- closures, outages, street directives, and mission availability/difficulty;
- aggregate-versus-visible traffic ownership;
- structured productivity, bridge, and delivery alerts.

Chrome WebGL acceptance verifies the live panel, policy tradeoff, economy cost,
priority/outage street markers, aggregate/sample contract, mission modifiers,
structured alert, and policy/outage persistence across save/reload.

