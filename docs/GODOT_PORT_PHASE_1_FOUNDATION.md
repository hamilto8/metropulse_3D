# Godot 4.6 Phase 1 Foundation

> **Status:** In progress
> **Godot target:** 4.6 stable .NET
> **.NET SDK:** 8.0.300 (`global.json`)
> **Platform decision:** `DD-016`, accepted 2026-08-07

## Workspace and dependency policy

The port lives beside the frozen browser implementation under `godot/`:

- `MetroPulse.Domain` is a plain `net8.0` library and never references Godot.
- `MetroPulse.Domain.Tests` uses xUnit 2.8.1 and the Microsoft test SDK 17.10.0.
- `MetroPulse.Godot` uses `Godot.NET.Sdk/4.6.0` and references the domain library.

All C# projects enable nullable reference types, deterministic compilation, and
warnings as errors. Domain and test NuGet graphs are locked. The Godot project
pins `Godot.NET.Sdk/4.6.0` exactly but intentionally disables its lock file:
the SDK conditionally includes `GodotSharpEditor` in Debug and removes it in
ExportRelease, causing those two official configurations to rewrite one lock
file incompatibly. Desktop runtime identifiers are declared up front so export
publishing cannot mutate the domain/test locks. The repository formatting
policy is `.editorconfig`; run
`dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --verify-no-changes`
in review or CI.

The engine integration-test runner is a committed `SceneTree` harness rather
than an addon. `IntegrationTestRunner` is activated only by the debug-only
`--run-integration-tests` user argument, evaluates named assertions after
`Main.tscn` creates the empty session shell, logs structured results, and exits
with status 0 or 1.

## Runtime shell

`Main.tscn` owns only the process boot layer, composition root, and diagnostics
layer. `CompositionRoot` instantiates `SessionShell.tscn` after debug/test
configuration validation. The session owns the empty world roots, runtime
services node, camera rig, camera, and HUD layer; it can be shut down and freed
without creating a global gameplay authority. No autoloads are defined.

Deterministic mode, custom seeds, integration tests, and the 30 Hz interpolation
debug profile are rejected when `OS.IsDebugBuild()` is false. Normal physics
starts at 120 Hz with interpolation enabled. The low-tick profile is a visual
debug aid only and is not a performance or parity target.

## Collision layers

Layer names are pinned in `project.godot`. Masks are assigned by Phase 4–8
entity scenes; the table below is the allowed collision/query contract.

| Bit | Name | Physical/query partners |
|---:|---|---|
| 1 | Surface | Traffic, Player, Pedestrian, CameraQuery |
| 2 | StaticObstacle | Traffic, Player, Pedestrian, CameraQuery |
| 3 | Traffic | Surface, StaticObstacle, Traffic, Player, Pedestrian, Interaction, MissionTrigger |
| 4 | Player | Surface, StaticObstacle, Traffic, Pedestrian, Interaction, MissionTrigger |
| 5 | Pedestrian | Surface, StaticObstacle, Traffic, Player, Interaction, MissionTrigger |
| 6 | Interaction | Traffic, Player, Pedestrian; query-only unless a later ADR says otherwise |
| 7 | MissionTrigger | Traffic, Player, Pedestrian; area/query-only |
| 8 | Effect | No physical response; optional explicit damage/query masks only |
| 9 | CameraQuery | Surface and StaticObstacle queries only |

A later scene must not broaden a mask silently. Any additional layer or pair is
reviewed here and in the owning phase handoff.

## Commands

Set `GODOT_BIN` when the 4.6 .NET executable is not on `PATH`.

```bash
./godot/scripts/build.sh
./godot/scripts/test-domain.sh
./godot/scripts/validate-export-presets.sh
./godot/scripts/validate-headless.sh
./godot/scripts/test-integration.sh
./godot/scripts/launch-debug.sh
./godot/scripts/launch-low-tick.sh
./godot/scripts/export.sh linux
./godot/scripts/export.sh windows
./godot/scripts/export.sh macos
./godot/scripts/export.sh macos debug
./godot/scripts/smoke-export.sh macos release
./godot/scripts/verify.sh
```

`validate-headless.sh` imports and compiles the project without an editor click.
`validate-export-presets.sh` rejects platform identifiers that Godot 4.6 does
not register, before CI downloads the editor and export templates.
`test-integration.sh` loads `Main.tscn`, verifies the session hierarchy, 120 Hz
cadence, interpolation, Jolt, and deterministic diagnostics, then exits.
Both commands retain raw output under `godot/artifacts/test-results/`.
Exports accept the release-safe `--smoke-boot` argument, which exits 0 only
after the empty shell reaches `foundation.ready`; it does not enable any
deterministic or state-mutation test API.

## Build provenance and diagnostics

The Godot SDK NuGet package currently pinned by the project has SHA-256:

```text
281e286bd0ace784e18f7485b7a86607279917fff475f14e47fc5c40e58d9993
```

Official Godot 4.6 stable artifacts are pinned by SHA-512:

```text
macOS universal .NET editor:
85cb900331d6e2c99543b8130ad698c91508e87ec54fedef0a62c1a71b2eceb8d9ededb760109468734da0773c0a8261fda25cfe3345775b31412a944b371dad

Linux x86_64 .NET editor (CI):
a132863e12fe4230eca9259dffefccaf98eeda79d05e082ebb8dd73d44a1a511181ff8f04a15bf4989fb5c91bd480fc21159b0753938c562ed85c2941c7a5777

.NET export templates:
2ddeb6a93366b9270ce7abc87f2e029a2704fcd9d14633dd43d7ebfd65a97172febc465f155798093472a297d71c98b276ee32ae53e15518d445dc668ea1c6c6
```

Runtime log events contain a category, severity, stable event ID, message, and
small allow-listed context map. Diagnostics report build/engine/renderer/
physics configuration, deterministic seed, session state, and fatal error code.
They do not collect player names, file paths, save payloads, dialogue, or other
personal data. `METROPULSE_SOURCE_REVISION` may be injected by CI/export tooling
to identify a build; it is `unavailable` when not supplied.

## Environment gaps before Phase 1 exit

- Rerun `godot-foundation` with the corrected `Linux/X11` preset, retain its
  Linux desktop export and test reports, and inspect the Linux smoke result;
  successful macOS cross-export does not substitute for host execution.
- Windows and Linux preset execution beyond the CI Linux smoke remains part of
  the later release-platform matrix; do not infer compatibility from macOS.
