# Phase 7 completion handoff

Phase 7 is complete in five independently verified slices on
`codex/godot_port`:

1. `982fba8` — economy, authored skyline, catalog, and construction vocabulary.
2. `36f0eb2` — editor commands, placement intelligence, zoning, and atomic edits.
3. `ee54cba` — live custom roads/bridges and traffic productivity.
4. `938a137` — city services, incidents, alerts, and Street response work.
5. `Complete Phase 7 fiscal parity and exit gate` — fiscal parity, versioned
   world restore, management soak, final regression matrix, and this handoff.

The frozen browser source revision remains
`44a286a74557adfe4fabd3a6e16b9006079eba32`. The Godot target remains 4.6
stable .NET `89cea1439` with Jolt and the existing scheduler/collision policies.

## Content identity

SHA-256 values used for the exit audit:

| Artifact | SHA-256 |
| --- | --- |
| `src/world/BuildingCatalog.js` | `00d16bbab25e7aeaae0a4068a824aea7687d5ffb343b57ed0f616400a109e2b7` |
| `src/systems/EconomyBalance.js` | `040e2139df358394d952704cad68cf4009bb43f32b8c88239806a43ea7588996` |
| `test/fixtures/godot-port/phase0/economy.json` | `ce9d234c1f49e6beafb4b59cdd9e402f3299ff3f97f53751ce3e2f86dcf70bae` |
| `godot/MetroPulse.Domain/Content/Data/buildings.json` | `a750b5257b982009454dffb2de6e46121af880e8326dd3cd661ee45cffb9004e` |
| `godot/MetroPulse.Domain/Content/Data/economy-balance.json` | `a7bdc54e1cced304c3dd57b9f7bfb431df406e2d41de10f253bd8d7498e24dd2` |

All 19 canonical catalog records, three development zones, five construction
categories, six starter disclosures, and progression locks remain content-owned.
No canonical content JSON was changed during Phase 7.

## Editor command and transaction contract

The session-owned `CityEditorRuntime` is the single Godot command boundary. Its
public command surface is `SetActive`, `SetTool`, `SelectCatalog`, `SetAim`,
`ControllerNavigate`, `ToggleGridSnap`, `RotateBlueprint`, `Place`, `SelectAtAim`,
`MoveSelected`, `RotateSelected`, `DemolishSelected`, `ApplyZone`, `Cancel`,
`CaptureState`, and `RestoreState`. Preview and mutation consume the same pure
`PlacementDecision`; scene nodes remain presentation only.

Every building lifecycle command uses this exact participant order:

1. `visual-node`
2. `collider`
3. `road-graph`
4. `economy-record`
5. `occupancy`
6. `zoning-metadata`
7. `service-metadata`
8. `persistence-record`

Compensation is registered before each possibly partial mutation and runs in
strict reverse order. Tests cover failure at every placement participant, a late
move failure, and restore failure after static economy restoration. The latter
compensates runtime participants without deleting the already restored economy
record.

Placement blockers are stable-sorted in this order (lower number wins):
`INVALID_INPUT` 0, `CONTENT_LOCKED` 10, `DISTRICT_LOCKED` 20,
`OUT_OF_BOUNDS` 30, `PROTECTED_LANDMARK` 40, `WATER` 50, `SLOPE` 60,
`PLAYER_OCCUPIED` 70, `ROAD_OVERLAP` 80, `COLLISION` 90,
`ZONE_RESTRICTION` 100, `ROAD_ACCESS` 110, `SERVICE_SHORTAGE` 120,
`FISCAL_RESTRICTION` 125, and `INSUFFICIENT_FUNDS` 130. The primary blocker
owns the displayed message and remedy.

## Building and zone persistence

`CityEditorState` is the browser-compatible versioned payload for
`save.data.world`:

```text
{
  version: 1,
  buildings: [{
    economyId, specId,
    plot: { x, y, z, width, depth },
    rotationY,
    zoneType?
  }],
  zones: [{
    key, x, z, zoneType,
    happinessModifier, landValueModifier
  }]
}
```

Restore is fresh-runtime-only. It validates unique IDs, finite plots, canonical
oriented footprints, canonical zone keys/modifiers, and exact agreement with a
statically restored `EconomyLedgerState`. It then rebuilds all eight participant
records and visual/collider/road/zone presentation, refreshes productivity, and
reseeds `USER_BUILDING_n` above the highest restored ordinal. The live exit test
captures a moved/rotated road plus zone and restores them into a newly initialized
`SessionShell` with no duplicate records.

## Road, traffic, service, and incident integration

`LivingTrafficRuntime.RoadGraph` is the sole route authority.
`TrafficRoadWorldEditParticipant` adds/removes user roads in the `road-graph`
transaction position. Smart Bridge Deck placement also owns its `SurfaceDeck`;
removal restores the river hazard. Graph revision repairs dynamic agent routes,
while `TrafficProductivityModel` publishes the single economy mobility feedback,
traffic alerts, bridge policy cost/capacity/reliability, Street directives, and
presentation snapshot.

`CityServiceModel` is read-only over the live economy and mission-outcome
authorities. `IncidentResponseService` performs report, funding, cleanup, repair,
outage closure, infrastructure restoration, and incident resolution as stable
outcome transactions. `CityServicesRuntime` shares the session alert and
interaction authorities; service work has priority 950 and marker presentation
derives from persisted work orders. Economy, outcomes, and alerts retain their
existing independent state documents; no duplicate save authority was added.

## Economy parity and balancing deviations

The initial economy remains exact: 650,000 Capital, 1,200 population, 70
happiness, 100 land value, adequate zero-demand services, 8 credits/second
gross/net income, and zero upkeep. Fiscal fixtures mirror browser recovery
scenarios for deficit runway and explanation, insolvency, 100,000 assistance,
assistance idempotency until exhaustion, recovery restrictions and exit,
25,000 reserve protection, cash-positive recovery investment, bounded fines,
and warning/critical alert lifecycle. Money and explanation strings are exact;
general scalar comparisons use 0.001 tolerance.

Declared deviations are limited to two already documented deterministic/runtime
choices:

- The browser assigns random employee counts to eight generic late skyline
  towers. Godot uses the browser fallback of eight employees per height metre.
  This changes only proxy employment/value metadata, not baseline economy values.
- After live traffic productivity binds, recurring income, job access, and
  satisfaction intentionally consume current congestion. Tests therefore use
  the derived current net rate rather than freezing the pre-mobility 8/second.

No authored balance scalar changed. Water remains a compatibility service token;
the Phase 7 service UI focuses on the currently authored energy/safety loop.

## Exit evidence

The final checks are:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
node --test test/EconomyRecovery.test.js test/EconomyBalanceSimulation.test.js test/BuilderEconomyIntegration.test.js test/CityServiceModel.test.js test/IncidentResponseService.test.js
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
```

The 50-cycle pure management soak repeatedly places, moves, rotates, and
demolishes a road, then reports, funds, cleans, repairs, and restores incidents.
It finishes with exact starting treasury, 300 stable outcome transactions, no
open incidents/work, and no world-edit participant residue. The Godot matrix
covers clean boot, confirmed import, recovery, and expected rejection of
unconfirmed/corrupt/future saves; successful runs publish `phase7.exit.passed`.
At completion, the C# suite passes 312/312, the five relevant browser files pass
23/23, and the clean/import/recovery Godot runs pass 179/179, 179/179, and
183/183 assertions respectively. The Godot solution builds with zero warnings
and errors, and format verification reports no changes.

Phase 8 may build on these authorities without changing Phase 7 ownership:
missions should consume the existing economy, outcome, alert, interaction,
road/productivity, service, and versioned world-state contracts rather than
introducing parallel mutable state.
