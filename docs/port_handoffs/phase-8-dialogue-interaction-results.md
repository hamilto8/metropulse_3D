# Phase 8 dialogue, interaction, and result handoff

Chunk ID and status: `phase-8-dialogue-interaction-results`; complete as the
second of five planned Phase 8 slices, covering the pure/domain portion of items
8.1, 8.3, 8.4, 8.6, and 8.8. Phase 8 remains in progress.

Source revision / Godot revision: frozen browser reference
`44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Phase 8 execution revision
`d7de5bb`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Objective and non-goals: port the stable dialogue/history contract, mission
candidate publication, offer disclosure, and receipt-backed result/history
projection without adding a second lifecycle, input route, pause authority, or
outcome log. This slice remains engine-independent; Godot controls, markers,
pause holds, and presentation nodes are the next slice.

Dialogue contract: `MissionDialogueModel` reads only validated canonical mission
nodes. It publishes stable choice IDs, speaker/role/avatar metadata, a
deterministic FNV-1a portrait seed and accessible description, keyboard/controller
focus index with wraparound, and explicit Dialogue pause intent. Choice traversal
records the exact mission/node/label/next tuple in lifecycle history. Close and
Decline abandon an unaccepted briefing; the `START_MISSION` terminal returns
authored rush/time facts and closes only after the caller successfully accepts,
so presentation cannot erase accepted ownership.

Offer and interaction contract: `MissionOfferView` discloses objective, contact,
required vehicle, pickup/destination, scaled base reward, time limit, route/
weather risk, failed prerequisites, and the typed eligibility result. The new
`MissionInteractionProvider` registers with the existing shared
`InteractionService` under provider ID `missions`. Pickup/detail candidates use
priority 900; an active Sabotage objective uses priority 1000 and remains the
winner when ineligible so its exact proximity/stopped-vehicle reason is visible.
The provider also exposes mission-critical controlled-entity release eligibility
for the live vehicle/aircraft adapter. Service work remains priority 950,
aircraft is default-off, and generic deterministic support for NPC/door/future
providers remains in the shared service.

Result contract: lifecycle resolutions now optionally retain bounded
satisfaction, damage, and Heat at resolution time. Save validation rejects
non-finite/out-of-range restored performance facts. `MissionResultViewModel`
requires a matching committed `RESULT` receipt for a current debrief, classifies
success/partial/failure/abandonment/arrest/vehicle loss, and always emits Reward,
City, Faction, and Progression sections with explicit empty copy. Retry guidance
comes from `MissionLifecycleController`; the projection never invents retry
authority.

History contract: persistent history is a newest-first projection over the
mission receipts already owned by `MissionOutcomeService`. Titles, descriptions,
before/after values, and explanations come from receipt-time facts. Historical
entries never query current Capital, traffic, services, reputation, progression,
or unlock state.

Tests and verification:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore --filter 'FullyQualifiedName~MissionDialogueAndPresentationTests|FullyQualifiedName~MissionExecutionModelTests'
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
```

The combined Phase 8 focused suite passes 24/24. The complete domain suite
passes 336/336, the Godot solution builds with zero warnings/errors, and format
verification reports no changes. Runtime node/body/timer/input/collision counts
remain unchanged because this slice adds no engine objects.

Next safe task: compose these authorities in one live `MissionRuntime`; register
the mission provider with the existing session interaction service, apply one
Dialogue pause hold, create bounded marker presenters, bind accepted live
vehicles and scheduler ticks, and perform receipt-gated cleanup. Do not add a
second Interact input branch or reconstruct result explanations from live city
state.
