# Phase 11 performance instrumentation handoff

Chunk ID and status: `phase-11-performance-instrumentation`; complete as the
first Phase 11 slice.

Source revision / Godot revision: frozen browser source
`44a286a74557adfe4fabd3a6e16b9006079eba32`; Godot 4.6 stable .NET
`89cea1439`.

Objective and explicit non-goals: Add a reproducible, bounded native profiler
and fill the missing Phase 11 counters before optimization. This slice does not
select quality tiers, change simulation cadence, claim a minimum hardware
profile, sign a release, or manufacture unavailable GPU timing.

Documents and source files read: `docs/GODOT_4_6_CSHARP_PORT_PLAN.md`,
`docs/GODOT_PORT_TARGET_HARDWARE_MATRIX.md`,
`docs/PERFORMANCE_BASELINE_2026-07-17.md`,
`docs/TESTING_AND_DIAGNOSTICS.md`, diagnostics, session audio, runtime
configuration, project settings, export scripts, and Godot 4.6 C# API XML.

Files/scenes/resources added or changed: `DiagnosticPerformance` now carries
CPU/physics/navigation/render timing, render/resource/object/memory/physics/
audio/GC counters. `PerformanceStatistics` owns deterministic tail summaries.
`PerformanceCaptureRunner` writes an atomic schema-1 report. Runtime parsing and
`capture-performance.sh` expose a release-safe explicit capture flow. No scene,
content, save schema, input action, collision layer, or gameplay authority
changed.

Authoritative owners touched: `CompositionRoot` measures boot-to-interactive;
`DiagnosticsOverlay` reads Godot counters; `SessionAudioRuntime` reports its
active fixed-budget voices. Capture mode disables overlay rendering so the
measurement does not include recursive diagnostic serialization overhead.

Behavior implemented: An absolute output path plus bounded warmup/duration
starts a native-window 10 Hz sample, records privacy-safe engine/host/scenario
identity, summarizes average/p95/p99/extrema, evaluates provisional FPS/frame/
load gates, writes atomically, and exits. Invalid, relative, unbounded, or
conflicting capture arguments fail before session construction. Unsupported GPU
timestamps remain explicitly unavailable.

Tests added and exact commands:

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/capture-performance.sh <absolute-json-path> 12 3
```

Test result and artifact policy: all domain tests pass, the Godot C# solution
builds with zero warnings/errors, formatting is clean, and a native macOS
capture emits `phase11.performance-capture.passed`. Raw workstation captures
remain under ignored `godot/artifacts/performance/`; reviewed evidence will be
copied into `docs/port_evidence/phase11` only when its scenario and revision are
frozen.

Performance/resource counts before and after: the prior Godot diagnostic had
FPS, last-frame delta, draw calls, primitives, video memory, and recursive scene
counts. The new capture adds the counters listed above; this slice deliberately
does not claim an optimized after-state.

Manual checks performed: Native Forward+ Metal capture on a base M1 Pro MacBook
Pro at 1280x720, with the default feature-off Management scene and 120 Hz Jolt.
No Windows or Linux host test was available.

Open defects and next safe task: High-profile debug evidence exceeds the
provisional 500-draw-call guardrail and Metal currently reports GPU timestamp
unavailable through this API. Implement and compare explicit high/medium/low
quality profiles, then freeze longer debug and exported-release measurements.
