# Phase 4 Environment, Billboard, and Camera Handoff

Chunk ID and status: `phase-4-environment-camera`; complete as the third Phase 4 slice, covering work items 4.7 through 4.9.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `8e3bd4f` and targets Godot 4.6 stable .NET `89cea1439`.

Objective and explicit non-goals: Rebuild the browser presentation baseline as session-owned Godot resources and connect production cameras to the authored world. This slice does not add simulation-driven clock advancement, traffic weather effects, gameplay camera transitions, optional districts, UI, or Phase 4 screenshot signoff.

Documents and source files read: Phase 4 plan; `Environment.js`; `TimeOfDayVisuals.js`; `BillboardCanvas.js`; canonical weather/camera records; the pure time, celestial, settings, surface, and clearance owners; and the generated-world handoff.

Files/scenes/resources added or changed: Added `EnvironmentPresentationModel` and two deterministic matrix tests; `WorldEnvironmentController`; `CachedBillboardSystem`; `GodotCameraWorldAdapter`; scene/session composition; fifteen headless presentation assertions; and plan/parity updates.

Authoritative owners touched: Pure time/weather/celestial/settings/surface/camera models remain formula and policy authorities. `WorldEnvironmentController` owns native presentation resources and its settings subscription. `CachedBillboardSystem` owns three cached viewport textures. `GodotCameraWorldAdapter` owns the single session camera pose while querying `WorldCollisionRegistry` rather than reconstructing geometry.

Public APIs, signals, events, input actions, collision layers: Added deterministic environment snapshots and evaluate API; environment state/quality/flash APIs; billboard cache/update/status APIs and counters; camera initialization, preset selection, inspection, and published preset IDs. Added structured event `phase4.presentation.passed`. No signal, input action, collision layer, save schema, or canonical content changed.

World scene tree additions:

```text
SessionRoot
├── RuntimeServices/WorldPresentation
│   ├── WorldEnvironment
│   ├── SunLight + Sun
│   ├── MoonLight + Moon
│   └── Rain
├── RuntimeServices/BillboardSystem
│   └── viewport-{neotech,metro-news,cinema}
└── CameraRig (GodotCameraWorldAdapter)
    └── MainCamera
```

Stable IDs/schema/content changes: Billboard IDs are `neotech`, `metro-news`, and `cinema`. Camera publication is exactly `management`, `ground`, `street`, `birdseye`, `park`, `downtown`, `bridge`, and `free`; Management aliases the canonical bird's-eye pose. Airfield and rocket remain rejected. No schema/content changes.

Behavior implemented: Fixed time/weather evaluates browser-equivalent sky palettes and weather tints, altitude-aware fog, rain/wetness, exposure/bloom, ambient/sun/moon energy, and celestial visibility. Godot applies filmic tone mapping, quality-gated shadows/volumetric fog/bloom, accessible flash/camera-shake scales, emissive window/lamp night response, and cached resources. Billboard content redraws only on change. Every production camera pose resolves through terrain, water, and live static-obstacle clearance; the far plane is 2,200 units.

Known deviations and ADR links: Rain is a lightweight reusable particle field rather than the browser line field. Godot procedural sky replaces the browser shader gradient, and billboards use native text rather than Canvas2D. These preserve the recognizable-not-pixel-identical contract; no ADR is required. Gameplay time/weather wiring remains later-phase ownership.

Tests added and exact commands: Two xUnit cases exercise the 4-by-4 fixed time/weather matrix, deterministic colors, bounds, altitude fog, night readability, and invalid fallback. Fifteen Godot assertions exercise native node ownership, storm application, quality/accessibility controls, cache redraw behavior, exact preset gating, and all-preset clearance. Commands: `dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore --filter FullyQualifiedName~EnvironmentPresentationModelTests`; `dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes`; and `GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-integration.sh`.

Test results and artifact paths: Focused presentation tests pass 2/2 and the domain suite passes 228/228. Native build has zero warnings/errors. Successful Godot boot scenarios publish `phase4.presentation.passed` with 15/15 assertions and preserve the Phase 3 scenario baselines. Logs remain under `godot/artifacts/test-results/`.

Performance/resource counts before and after: The presentation adds two cached sphere meshes/materials, one environment resource, two lights, two celestial meshes, one reusable 2,000-particle rain emitter, three 512×256 SubViewports, and three billboard quads. World cache totals move from 56/49/44 to 58 meshes, 51 materials, and 44 shapes. Static billboard content performs zero per-frame redraws.

Manual checks performed: Headless Godot constructed, mutated, and disposed every presentation resource and applied every production camera preset. Visual screenshot grading remains the Phase 4 exit slice.

Open defects with severity and reproduction: None found. A ground-preset validation mismatch was fixed by inspecting the resolved position with the same 0.45 radius/0.75 clearance options used to resolve it.

Compatibility adapters and removal conditions: The Godot environment and camera adapters intentionally consume pure domain snapshots. Browser presentation remains reference evidence until fixed screenshot pairs pass; remove that comparison obligation only at Phase 4 exit. Optional preset admission must remain tied to later feature ownership.

Next safe task: Add golden landmark fixtures, physical traversal/collider/lifecycle checks, fixed reference/Godot screenshot pairs, performance evidence, and the Phase 4 exit audit.

Unsafe/blocked tasks and required decision: Do not advance simulation time from this presentation owner, enable optional presets directly, mutate canonical weather/camera data, or add gameplay transition authority here. No external decision blocks the exit slice.
