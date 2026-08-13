# Godot 4.6 Port Initial Target Hardware Matrix

> **Status:** Phase 0 targets accepted; one recommended-class Mac has partial
> Phase 11 measurements, while minimum Mac and all Windows/Linux profiles remain
> unverified.
>
> **Reference revision:** `44a286a74557adfe4fabd3a6e16b9006079eba32`  
> **Platform decision:** `DD-016` (accepted 2026-08-07)

## Release targets

The Godot 4.6 C# port targets native Windows, macOS, and Linux desktop builds.
The browser implementation remains the behavioral reference and legacy build;
it is not an export target for the C# project. Mobile is excluded from the
initial release matrix.

These accepted targets are not measured compatibility claims. Phase 11 must
replace every `Target` result below with evidence from exported binaries before
release.

| Profile | OS / architecture | CPU target | Memory target | Graphics target | Display | Renderer coverage | Current result |
|---|---|---|---:|---|---|---|---|
| Windows minimum | Windows 11 x64 | 4 physical cores | 8 GB | Hardware Vulkan 1.2 or D3D12-class GPU, 4 GB VRAM | 1280×720 | Forward+ primary; Compatibility fallback probe | Target only |
| Windows recommended | Windows 11 x64 | 6 physical cores | 16 GB | Discrete hardware GPU, 6 GB VRAM | 1920×1080 | Forward+ | Target only |
| macOS minimum | macOS Apple silicon | Apple M1-class | 8 GB unified | Metal-capable integrated GPU | 1280×720 | Forward+ through Metal | Target only |
| macOS recommended | macOS Apple silicon | Apple M1 Pro-class or newer | 16 GB unified | Metal-capable Apple GPU | 1920×1080 | Forward+ through Metal | Partial: M1 Pro debug Management capture passes; exported/full-mode acceptance pending |
| Linux minimum | Current supported x86_64 distribution | 4 physical cores | 8 GB | Hardware Vulkan 1.2 GPU, 4 GB VRAM | 1280×720 | Forward+ primary; Compatibility fallback probe | Target only |
| Linux recommended | Current supported x86_64 distribution | 6 physical cores | 16 GB | Discrete hardware Vulkan GPU, 6 GB VRAM | 1920×1080 | Forward+ | Target only |

## Phase 0 reference workstation

The browser evidence was captured on a MacBook Pro (`MacBookPro18,3`) with an
Apple M1 Pro and 16 GB unified memory, macOS 26.6 build 25G72, Node 24.15.0,
npm 11.12.1, Playwright 1.61.1, and the installed Chrome channel. The exact
machine-readable record is
`docs/port_evidence/phase0/environment.json`; the browser atlas manifest also
records its user agent, WebGL renderer, viewport, quality profile, entity
targets, scenario seed, and effective feature flags.

## Acceptance measurements

Every target profile must run exported debug and release builds and record:

- boot-to-interactive time and truthful progress presentation;
- average, 1% low, and worst routine frame time in Management, Builder, on
  foot, driving, and one active mission;
- renderer/backend, driver, resolution, quality tier, draw calls, visible
  geometry, physics bodies, and detailed agent counts;
- 50 cross-mode cycles, repeated save/recover/import, and a 30-minute living
  city soak;
- keyboard/mouse behavior, file permissions, upgrade paths, and controller
  results where a controller is present;
- whether Compatibility rendering is viable or must fail with an actionable
  minimum-requirement message.

The performance gates remain at least 30 FPS on minimum, a 60 FPS target on
recommended, routine frame time no worse than 33 ms, and useful staged progress
when initial interactive load cannot remain below the accepted budget.

## Phase 11 measured Mac evidence

One base `MacBookPro18,3` with an 8-core/14-GPU-core Apple M1 Pro, 16 GB unified
memory, and macOS 26.6.1 ran Godot 4.6 .NET `89cea1439`, Forward+ over Metal,
Jolt at the accepted fixed 120 Hz, interpolation enabled, default-off features,
and the high quality profile. A 1920×1080 native-window debug Management
capture used a three-second warmup and twelve-second measurement:

| Metric | Observed |
|---|---:|
| Average FPS | 120.0 |
| Average / P99 frame time | 8.33 / 8.33 ms |
| Average / P99 physics counter | 4.06 / 5.90 ms |
| Average / P99 CPU-render counter | 1.11 / 1.29 ms |
| Boot to interactive | 696.7 ms |
| Average draw calls / primitives | 1,938 / 3.70 million |
| Scene nodes / physics bodies | 3,263 / 619 |
| Managed / static / video memory at finish | 14.2 / 137.1 / 339.3 MB |
| Managed allocation during 12-second sample | 314.1 MB |
| Active audio voices | 2 |

The measured FPS, routine-frame, and initial-load gates pass for this one
scenario. GPU viewport timing is unavailable on this Metal backend, so the
capture reports it as unavailable rather than zero-cost. The high draw-call
count exceeds the provisional 500-call guardrail, and steady allocation remains
an optimization target. This result is not minimum-Mac acceptance and does not
cover Builder, on-foot, driving, active-mission, save-hitch, Compatibility,
long-soak, input-device, or screen-reader requirements. Raw machine-local
captures remain ignored under `godot/artifacts/performance`; the durable summary
is in the Phase 11 handoffs and cadence ADR.

## Remaining Phase 11 decisions

- Exact supported OS version floors at release-candidate freeze.
- Measured minimum/recommended GPU models and driver floors.
- Whether the Compatibility renderer meets gameplay readability and
  performance requirements on any minimum profile.
- Controller models retained in the release support matrix after device-lab
  testing.
