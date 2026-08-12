# Phase 8 live mission runtime handoff

Chunk ID and status: `phase-8-live-runtime`; complete as the third of five
planned Phase 8 slices, covering the live Godot portion of items 8.1 through
8.8. Phase 8 remains in progress.

Source revision / Godot revision: frozen browser reference
`44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Phase 8 dialogue/result
revision `8bfffda`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Objective and non-goals: compose the renderer-free mission, dialogue,
interaction, lifecycle, and result authorities into the disposable live session.
This slice binds authored mission offers to live controlled vehicles, scheduler
ticks, shared interaction priority, Dialogue pause/input, bounded markers, HUD,
atomic outcome cleanup, alerts, and RESULT presentation. Persistence/recovery,
restart soak coverage, failure/playthrough matrices, and final Phase 8 exit
evidence remain for the next slices.

Runtime ownership: `MissionRuntime` is the sole live mission coordinator and is
owned by `SessionShell`. It uses the existing gameplay scheduler, runtime state
machine, pause authority, input host, shared `InteractionService`, city outcome
service, and alert service. Session shutdown unregisters mission candidates,
releases any Dialogue hold, clears mission context, and frees presentation nodes
before the services they reference are disposed.

Interaction and control: mission pickup/detail and Sabotage objective candidates
register as the third provider in the existing shared service. The vehicle
publisher refreshes that service once per physics frame and still resolves only
the canonical primary candidate on Interact. Accepted missions bind the exact
stable live vehicle ID/type. Mission criticality rejects mode escape through the
transition authority and makes controlled-vehicle release visibly ineligible
with the same reason; entry into unrelated vehicles remains unchanged.

Presentation: `MissionMarkerPresenter` reuses one mesh/material pair for bounded
offer nodes and one objective node. Normal MVP scope shows exactly nine offer
markers while idle, no offers while occupied, and at most one active objective.
`MissionPresentation` adds one programmatic CanvasLayer subtree for the shared
prompt, objective/timer HUD, stable-node dialogue choices, and receipt-backed
result sections. Dialogue owns one `PauseReason.Dialogue` hold and selects the
Dialogue input context without invoking Pause-menu routing.

Cleanup and result: live completion advances lifecycle cleanup, creates one
stable mission outcome transaction, applies it once through `MissionOutcomeService`,
commits cleanup once, publishes an alert keyed by the receipt transaction ID,
and only then enters RESULT. The result view is projected from that committed
receipt. Duplicate commit calls cannot duplicate Capital, consequences, history,
cleanup, markers, or alerts. Acknowledgement resets mission ownership and returns
to clean Management/IDLE state.

Tests and verification:

```text
dotnet test godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.csproj --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
```

The complete domain suite passes 336/336. The Godot solution builds with zero
warnings/errors and format verification reports no changes. The headless live
suite passes all three startup scenarios with 179 new-game assertions, 179
continue assertions, and 183 recovery-seed assertions. Each scenario records one
mission receipt, one cleanup commit, nine restored idle offer markers, and three
shared interaction providers.

Next safe task: add save capture/restore for active checkpoint and RESULT
ownership, reacquire the saved controlled entity before active mission restore,
and exercise retry/recovery across repeated session reconstruction. Do not infer
live result explanations after restore or create another outcome/interaction
authority.
