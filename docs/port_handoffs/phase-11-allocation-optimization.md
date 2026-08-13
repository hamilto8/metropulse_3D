# Phase 11 allocation optimization handoff

Chunk ID and status: `phase-11-allocation-optimization`; complete as the third
Phase 11 slice and first measured optimization pass.

Source revision / Godot revision: branch base `ed27a06` plus this slice; frozen
browser source `44a286a74557adfe4fabd3a6e16b9006079eba32`; Godot 4.6 stable
.NET `89cea1439`.

Objective and explicit non-goals: Reduce proven steady-state managed allocation
without lowering simulation frequency, populations, collision meaning, or
feedback. This slice does not batch dynamic draw calls, change the 120 Hz
physics decision, or claim final soak/platform acceptance.

Root cause: `TrafficPopulationSimulation.RefreshGraphNodes` built an immutable
snapshot containing 480 nodes and 834 directed edges before checking whether
the graph revision had changed. At 120 Hz this dominated allocation. Spatial
hash rebuild/query also allocated duplicate-ID sets, cell lists, entry objects,
match lists, and result arrays continuously. Traffic, pedestrians, audio,
effects, and minimap each requested additional immutable population snapshots.

Behavior implemented:

- road revision is checked before snapshot construction, with a diagnostic
  refresh count and a 240-tick regression test;
- spatial buckets, duplicate-ID sets, entry structs, and caller-owned query
  buffers are reused while stable-ID ordering and bounded candidate counts stay
  exact;
- traffic/pedestrian runtime snapshots are published once per presentation
  update and shared by audio, effects, minimap, and interaction adapters;
- actor reconciliation reuses ID/removal buffers and traffic-control lookup is
  built once because authored controls are stable;
- simulation remains 120 Hz, while agent presentation is capped at 60 Hz and
  uses project interpolation rather than resetting interpolation every update;
- audio/effect state observation is capped at 10 Hz with authoritative captions
  and events retained;
- capture reports total managed allocated bytes as well as live memory and GC.

Verification:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
/Applications/Godot_mono.app/Contents/MacOS/Godot --headless --path godot/MetroPulse.Godot -- --run-integration-tests --boot-action=NEW_GAME
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/capture-performance.sh <absolute-path> 8 2 HIGH
```

The domain suite, zero-warning build, formatting gate, and all 179 engine
assertions pass. The 50 control-mode cycles, 10 mission restarts, exact 48/12
traffic and 60-citizen floors, bounded local queries, collisions, effects,
captions, and cleanup remain covered.

Measured result: On the only available host (base M1 Pro, 1280x720, Forward+
Metal, high quality, default feature-off Management, 120 Hz Jolt), otherwise
equivalent 2-second-warmup/8-second debug captures changed as follows:

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Managed allocated bytes | 896.6 MiB | 199.7 MiB | -77.7% |
| Gen-0 collections | 151 | 33 | -78.1% |
| Gen-1 collections | 28 | 2 | -92.9% |
| p99 frame time | 10.20 ms | 8.90 ms | -12.7% |
| Average FPS | 119.7 | 119.8 | stable at cap |

Raw captures remain ignored under `godot/artifacts/performance`. Short debug
captures show direction and regression sensitivity; they are not a two-hour
soak or exported-release acceptance result. Windows/Linux were unavailable.

Known defects and next safe task: roughly 20 MiB/s of managed allocation remains
in simulation/presentation paths, and high-quality draw calls remain far above
the provisional 500-call guardrail. Batch traffic/pedestrian visuals into
dynamic MultiMeshes while retaining their individual collision/audio/identity
owners, then repeat the exact capture and integration gates.
