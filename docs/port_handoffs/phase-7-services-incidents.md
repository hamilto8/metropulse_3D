# Phase 7 services and incidents handoff

Phase 7.8 is complete. `CityServiceModel` is a read-only projection over
`EconomyLedger` capacity/buildings and `MissionOutcomeService` outages. It
preserves the browser formulas for district backbone access, strongest nearby
facility reach, aggregate capacity limiting, linear spatial outage falloff,
health bands, and explanation text. `CityConditionService` delegates local
service requirements to this same projection when it is composed.

`IncidentResponseService` owns no parallel ledger. Reporting produces one
idempotent outcome transaction containing the incident, optional damaged
infrastructure and outage, and cleanup/repair work orders. Management funding
uses one outcome transaction with the Capital debit and every pending work
order, so insufficient funds change neither authority. Street work retains
stable progress transaction IDs, blocks repair on incomplete cleanup, and on
final completion closes the outage, restores infrastructure, resolves the
incident, resolves the standing alert, and publishes a timed success alert.

The session-owned `CityServicesRuntime` shares the traffic-created
`AlertService` and the canonical `InteractionService`. Service work has priority
950, is offered only on foot near the persisted site, publishes a reason when
unfunded or prerequisite-blocked, and advances by 50 percent per interaction.
`CityServiceMarkerPresenter` derives cleanup and repair beacons from open work
orders under `WorldRoot/EffectRoot`; it owns no gameplay truth and removes them
after completion.

Persistence remains in the existing authorities: Capital and buildings use
`EconomyLedgerState`, incident/outage/work/receipt state uses
`MissionOutcomeStateDocument`, and notifications use `AlertStateDocument`.
`CityServicesRuntimeState` groups only the missions/alerts projections for live
application; it introduces no save domain. The integration scenario captures
all three existing states after 50 percent cleanup, mutates forward, restores,
and then completes cleanup and repair through Street interactions at the same
treasury.

Verification commands:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
```

The browser parity cases are mirrored in
`MetroPulse.Domain.Tests/Services/CityServiceModelTests.cs` and
`IncidentResponseServiceTests.cs`. The live test emits
`phase7.services_incidents.passed` and covers report, local outage, markers,
funding and duplicate funding, shared interaction selection, partial restore,
cleanup, repair, resolution, alert replacement, and marker cleanup.
