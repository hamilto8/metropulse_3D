# Phase 11 quality-profile handoff

Chunk ID and status: `phase-11-quality-profiles`; complete as the second Phase
11 slice.

Source revision / Godot revision: branch base `3dce41c` plus this quality slice;
frozen browser source `44a286a74557adfe4fabd3a6e16b9006079eba32`;
Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Implement high/medium/low presentation
budgets without reducing gameplay meaning. This slice does not change the 120
Hz physics decision, batch dynamic agents, choose platform minimums, persist a
player setting, or claim Windows/Linux compatibility.

Authoritative owners touched: immutable `QualityProfilePolicy`, release-safe
runtime parsing, `SessionShell` composition, world/environment presentation,
traffic/pedestrian render adapters, pooled effects, session audio, and minimap.
No simulation, collision, mission, economy, input, save, content, or feature-
flag authority changed.

Behavior implemented: `HIGH` defaults safely. Medium and low progressively cap
shadow passes, fog/bloom, rain, render-detail distance, collision-free effect
slots, spatial voice slots, and minimap refresh. World MultiMesh shadow policy
is applied after optional feature construction while every authored collider
and gameplay node remains live. Exact budgets and invariants are in
`docs/GODOT_QUALITY_PROFILES.md`.

Verification:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
/Applications/Godot_mono.app/Contents/MacOS/Godot --headless --path godot/MetroPulse.Godot -- --run-integration-tests --boot-action=NEW_GAME --quality=LOW
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/capture-performance.sh <absolute-path> 8 2 <tier>
```

The low-tier engine run passes `integration.passed` with 179 assertions,
including exact 48/12 traffic, 60 citizens, collisions, mission restarts, 50
control cycles, effects/captions, settings/accessibility, and cleanup. Domain
tests, build, and format pass.

Native debug comparison on the only available host (base M1 Pro MacBook Pro,
1280x720, Metal Forward+, default-off Management scene, 120 Hz Jolt) observed:

| Tier | Average FPS | p99 frame | Average draw calls | Scene nodes |
|---|---:|---:|---:|---:|
| High | 119.7 | 12.24 ms | 1,889 | 3,263 |
| Medium | 119.8 | 8.83 ms | 1,400 | 3,230 |
| Low | 119.9 | 11.72 ms | 669 | 3,199 |

These short debug samples validate meaningful scaling, not final acceptance.
All tiers pass the frame/FPS gate on this host; all remain above the provisional
500-draw-call high-profile guardrail. GPU viewport timing is unavailable on the
measured Metal backend. Raw captures remain in ignored `godot/artifacts`.

Known defects and next safe task: Dynamic traffic/pedestrian MeshInstances and
their material instances still dominate draw calls, and steady-state managed
collection counts remain high. Batch agent visuals into quality-aware dynamic
MultiMeshes and reduce duplicate per-frame population snapshots without
changing collision actors or simulation updates.
