# Phase 8 mission persistence and recovery handoff

Chunk ID and status: `phase-8-persistence-recovery`; complete as the fourth of
five planned Phase 8 slices, covering items 8.6, 8.7, 8.8, and 8.9 plus the
required ten-restart soak. Phase 8 remains in progress pending its final
playthrough/failure matrix and exit audit.

Source revision / Godot revision: frozen browser reference
`44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Phase 8 live-runtime
revision `582ec2e`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Save contract: `MissionRuntimeState` persists one validated lifecycle/execution
pair. Only IDLE, ACTIVE/CHECKPOINT, and RESULT are save-safe. IDLE cannot retain
execution; active state cannot retain a result transaction; RESULT requires the
same transaction ID in runtime ownership, lifecycle, and the committed receipt.
Preparation, briefing, completion, failure, cleanup, and recovery remain blocked
so a save cannot split a transaction boundary.

Restore order: `SessionGameSaveRuntimeRestoreAdapter` consumes the coordinator's
validated runtime descriptor once during interactive release. It restores shared
outcomes/alerts first, validates game/player/mission cross-domain ownership,
recreates or resolves the saved stable vehicle, transfers direct control, and
only then restores active mission execution. RESULT restoration requires the
saved committed outcome receipt before reconstructing the debrief and entering
RESULT. A failed apply restores service state and releases/removes any provisional
vehicle rather than clearing the coordinator's pending descriptor.

Controlled entity recovery: generic saved STREET_VEHICLE sessions now reacquire
their saved stable vehicle before interactive release. Active missions add the
stricter requirement that saved player content ID and type exactly match the
mission execution vehicle ID/type. Missing, exchanged, or type-changed vehicles
fail closed before mission state publication.

Retry: failed result views now invoke the existing retry action. Retry first
reacquires the exact released mission vehicle, then advances lifecycle recovery.
RESTART resets execution to its initial timer/route facts; LAST_CHECKPOINT reads
the typed checkpoint payload and restores timer, payout, route index, race time,
and congestion facts. The new attempt keeps prior outcome receipts/history and
uses a distinct attempt/transaction ID.

Soak evidence: the headless live integration captures a Race state immediately
after route checkpoint one and an Executive Taxi RESULT after its receipt commit.
It alternates those documents through ten freshly constructed session shells.
Every active reload owns route index one, exact SPORTS control, zero offer markers,
one objective marker, three interaction providers, and the persisted outcome
count. Every RESULT reload owns no entity, no markers, the matching debrief, the
same three providers, and the same persisted outcome count. Every shell is then
fully shut down and freed.

Tests and verification:

```text
dotnet test godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.csproj --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
```

The focused mission persistence/execution suite passes 15/15 and the complete
domain suite passes 340/340. The Godot project builds with zero warnings/errors
and format verification reports no changes. The headless suite passes all three supported startup scenarios, including actual
controlled-vehicle Continue restore and the ten-restart mission soak in each
scenario. Deliberately corrupt, future-version, and unconfirmed-import fixtures
still fail with their expected boot classifications.

Next safe task: execute and record the final ten-playthrough matrix across all
six templates and temporary Mayhem, cover timeout/vehicle loss/arrest/cancel and
invalid pickup prerequisites, reconcile every Phase 8 exit criterion, update the
port plan/version evidence, and close Phase 8. Do not weaken the save-safe phase
gate or derive restored RESULT explanations from current city state.
