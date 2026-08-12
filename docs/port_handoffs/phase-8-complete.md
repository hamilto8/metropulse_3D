# Phase 8 completion handoff

Phase 8 is complete in five independently verified slices on
`codex/godot_port`:

1. `d7de5bb` — deterministic execution state and all six templates.
2. `8bfffda` — dialogue, shared interaction, receipt-backed results/history.
3. `582ec2e` — live Godot markers, HUD, input/pause, cleanup, and alerts.
4. `e20c1b9` — checkpoint/RESULT persistence, entity recovery, retry, and soak.
5. `Complete Phase 8 mission exit gate` — ten playthroughs, failure matrix,
   version/plan closeout, and this handoff.

The frozen browser source revision remains
`44a286a74557adfe4fabd3a6e16b9006079eba32`. The Godot target remains 4.6
stable .NET `89cea1439`, Jolt, and the canonical 120 Hz scheduler.

## Content validation and scope

| Artifact | SHA-256 |
| --- | --- |
| `src/data/missions.json` | `bdd7a9ce95af4bb4b0eaa84ff67843d57d0083bc2a69a6f4961fc93f34377a46` |
| `godot/MetroPulse.Domain/Content/Data/mission-weather-policies.json` | `aedefc311f99cbc753554b3bb5defb6d3c2aae674a1c0fc3c18a7891bb637556` |
| `test/fixtures/godot-port/phase0/missions.json` | `e9a2a7984b1121505e4ed3192969b85b022d392b681a81cb7f39e81ccde21914` |

All 15 canonical records validate stable IDs, vehicle types, pickup/dropoff and
checkpoint locations, dialogue edges/actions, weather policy, retry policy,
prerequisites, and objective-specific fields. Normal MVP scope publishes the
first nine records below. The authorized temporary-Mayhem harness adds Survival.
`mission_cyberdj`, `mission_tourist`, `mission_bus_tour`,
`mission_truck_goods`, and `mission_sedan_testing` validate but publish neither
markers nor interactions in normal scope.

## Lifecycle and ownership

```text
IDLE -> PREPARATION -> BRIEFING -> APPROACH -> ACTIVE <-> CHECKPOINT
                                                |             |
                                                +--> COMPLETION/FAILURE
                                                          |
                                                       CLEANUP
                                                          |
                                                        RESULT
                                                          |
                                                       RECOVERY
                                                     /          \
                                                  IDLE       APPROACH -> ACTIVE
                                                               (retry)
```

`MissionLifecycleController` owns phases, run/attempt IDs, checkpoint, resolution,
transaction ID, receipt, progress, retry, and save gating. `MissionExecutionModel`
owns the accepted stable vehicle, route, timer, payout, Race/Sabotage/Survival
facts, and typed checkpoint payload. `MissionRuntime` is the sole Godot adapter;
markers and controls are projections only. IDLE, ACTIVE/CHECKPOINT, and RESULT
are save-safe. PREPARATION, BRIEFING, COMPLETION, FAILURE, CLEANUP, and RECOVERY
block saving.

RESULT remains mission-critical and mission-owned until the matching outcome
receipt exists and the player either acknowledges recovery or starts an allowed
retry. Mode escape and controlled-vehicle release use the same transition and
interaction rejection reason.

## Marker and interaction ownership

The live `MissionMarkerPresenter` owns nine reusable offer nodes in normal scope
and at most one objective node. It removes offer nodes as soon as lifecycle is
occupied and never creates a Survival destination. Mission, city-service, and
vehicle candidates share one `InteractionService`, refreshed once per physics
frame and resolved only through the canonical Interact action.

| Priority | Candidate | Live provider/status |
| ---: | --- | --- |
| 1000 | Mission objective/Sabotage action | `missions`, live |
| 950 | Service work | `city-service-work`, live |
| 900 | Mission pickup/details | `missions`, live |
| 800 | Aircraft boarding | reserved, aircraft feature off |
| 700 | Vehicle entry/hijack | `player-vehicle`, live |
| 600 | NPC conversation/control | reserved for scoped provider |
| 500 | Controlled entity exit | `player-vehicle`, live |
| 100 | Selected entity/door/future action | deterministic reserved fallback |

Stable priority, distance, provider ID, and candidate ID break ties. An
ineligible winner remains primary and supplies its exact reason to the shared
prompt; a lower-priority eligible action cannot silently replace it.

## Dialogue, result, and history

Dialogue reads the canonical JSON tree by stable node ID. Choice IDs, speaker,
role, FNV-1a portrait seed, focus index/wrap, authored action, and exact history
edge are deterministic. One `PauseReason.Dialogue` hold selects the Dialogue
input context and releases only after accept/decline/close.

Cleanup applies through the existing `MissionOutcomeService`. The result view
requires the matching receipt and separates Reward & performance, City,
Faction, and Progression sections, plus failure cause, retry, and next action.
History is newest-first over saved receipts and uses receipt-time before/after
values and explanations; it never queries current mutable city state.

All supported outcome commands retain atomic validation/application coverage:
Capital adjustment; building and infrastructure state; incident record/resolve;
repair; service outage; traffic; faction reputation; progression; unlock; news;
follow-up mission; and authored flags. `MissionOutcomeServiceTests` verifies
identical replay returns the original receipt, conflicting fingerprint reuse
fails, a late invalid command mutates nothing, and an unaffordable debit cannot
partially apply a later flag.

## Save and retry matrix

| State/action | Saved ownership | Restore/retry result |
| --- | --- | --- |
| IDLE | progress only, no execution/result ID | nine normal offers republish |
| ACTIVE/CHECKPOINT | lifecycle + execution + exact player vehicle | outcomes/alerts, vehicle control, mission, then Street state |
| RESULT | lifecycle + execution + transaction/receipt | receipt/debrief restored before RESULT; no controlled entity |
| Commit/recovery phases | none | save rejected with `MISSION_COMMIT_IN_PROGRESS` |
| RESTART retry | released accepted vehicle + prior receipt | exact vehicle reacquired; initial route/timer facts, next attempt |
| LAST_CHECKPOINT retry | typed checkpoint payload + prior receipt | timer/payout/route/race/congestion facts restored, next attempt |
| Retry exhausted | result receipt/history retained | retry unavailable at authored maximum attempt |

`SessionGameSaveRuntimeRestoreAdapter` validates all domains before mission
publication. Active restore fails if the saved player state is not
STREET_VEHICLE or its stable content ID/type differs from execution. It restores
outcomes/alerts, reacquires control, then restores mission state, preventing the
mission from blocking its own load transition. Ten alternating fresh-session
ACTIVE-checkpoint/RESULT reloads retain exact provider, marker, receipt, outcome,
control, route, and result counts.

## Recorded MVP playthroughs

`MissionPhase8ExitTests` records one accepted-to-receipt deterministic
playthrough for each scoped mission:

| Mission | Template | Vehicle | Scope | Status |
| --- | --- | --- | --- | --- |
| Boardroom Emergency (`mission_executive`) | Taxi | TAXI | normal | pass |
| Classified Quantum Data (`mission_scientist`) | Courier | TAXI | normal | pass |
| Bank Heist Response (`mission_police_robbery`) | Sabotage | POLICE | normal | pass |
| Park Patrol Commotion (`mission_police_park`) | Delivery | POLICE | normal | pass |
| Waterfront Time Trial (`mission_sports_trial`) | Race | SPORTS | normal | pass |
| Contraband Courier (`mission_sports_smuggle`) | Courier | SPORTS | normal | pass |
| Waterfront Transit Route (`mission_bus_loop`) | Delivery | BUS | normal | pass |
| Steel Cargo Haul (`mission_truck_delivery`) | Courier | TRUCK | normal | pass |
| Aunt Sarah's Errand (`mission_sedan_grocery`) | Taxi | SEDAN | normal | pass |
| The Last Profitable Quarter (`mission_mayhem_escape`) | Survival | SPORTS | temporary Mayhem | pass |

Taxi records congestion/satisfaction/payout, Courier and Delivery bind one
destination, Race advances all ordered checkpoints before its rival, Sabotage
requires arrival plus explicit uninterrupted stopped hold, and Survival treats
timer expiry as success without a destination. Separate fixtures cover success,
generic failure, cancellation/abandonment, arrest, vehicle loss, retry exhaustion,
and cleanup failure with no published receipt.

## Exit verification

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
```

The final C# suite passes 357/357 and the seven relevant browser test files pass
39/39. The Godot solution builds with zero warnings/errors and format
verification reports no changes. Successful clean/import/recovery live runs
pass 179/179, 179/179, and 183/183 assertions and publish
`phase8.exit.passed`; unconfirmed,
corrupt, and future-version imports still fail under their expected boot codes.
The runtime ends each playthrough with nine normal offers, three shared
interaction providers, one committed cleanup per result, and no duplicate
mission nodes, receipts, Capital, consequences, or control owners.

Phase 9 may restyle and extend the temporary controls, minimap/audio/effects,
and accessibility coverage. It must keep Phase 8 lifecycle, interaction,
transaction, persistence, and receipt-history ownership unchanged.
