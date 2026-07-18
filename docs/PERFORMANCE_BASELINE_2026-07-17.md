# MetroPulse 3D Phase 0 Performance Baseline

> **Captured:** 2026-07-17 (America/Chicago)  
> **Commit baseline:** `ef126c6` plus the Phase 0 working tree  
> **Purpose:** Reproducible comparison point, not a performance acceptance pass.

## Environment and scenario

| Item | Value |
|---|---|
| OS | macOS 26.5.2 |
| Runtime used for build/tests | Node 24.15.0, npm 11.12.1 |
| Browser/GPU | Codex in-app Chromium; ANGLE Metal; Apple M1 Pro |
| Viewport | 1280 × 720 browser capture |
| URL profile | deterministic seed `phase-0-baseline`, high quality, clear 14:30 |
| World load | 48 moving traffic target (64 total including parked), 60 pedestrian target |
| Optional breadth | Aircraft, rocket, East development, countryside physics, and all Mayhem flags off |
| Sample | Management bird's-eye scene after a six-second warmup |

Numbers vary with browser state and hardware. Future comparisons must use the
same deterministic URL and report any environment difference.

## Runtime baseline

| Metric | Baseline | GDD guardrail | Assessment |
|---|---:|---:|---|
| App interactive, local dev server | 258 ms | <10 s typical broadband | Local-only reference; network delivery still unmeasured |
| Sampled FPS | 50.0 | 60 target / 30 minimum | Above minimum; below target |
| Sampled frame time | 20.0 ms | ≤16.7 ms target / ≤33 ms minimum | Above target; below minimum ceiling |
| Draw calls | 3,865 | <500 initial high-profile guardrail | **Material over-budget risk** |
| Triangles | 298,442 | Budget not yet fixed | Baseline established |
| Points | 13,200 | Budget not yet fixed | Baseline established |
| Three.js geometries | 3,171 | Must remain bounded | Baseline established; ownership audit needed |
| Three.js textures | 20 | Must remain bounded | Baseline established |
| Shader programs | 21 | Must remain bounded | Baseline established |
| Physics bodies | 613 | Budget not yet fixed | Includes retained-world safety colliders; high for MVP footprint |
| Scene objects | 5,736 | Budget not yet fixed | Baseline established |
| JS heap used | 249 MiB | Two-hour bounded-growth gate | Chrome-only point sample, not a leak result |

The draw-call count is a Phase 8 performance risk and is intentionally not
hidden by this baseline. Phase 0 requires evidence; it does not declare the
existing scene compliant. Instancing/material consolidation and a physically
bounded MVP footprint should be profiled before content expansion.

## Production bundle baseline

Measured by Vite 8.1.3 after minification.

| Asset | Raw | Gzip |
|---|---:|---:|
| HTML | 25.46 kB | 6.05 kB |
| CSS | 68.24 kB | 13.93 kB |
| App/gameplay chunk | 508.91 kB | 145.91 kB |
| Three.js core | 559.34 kB | 140.44 kB |
| Three.js addons | 35.31 kB | 8.06 kB |
| cannon-es | 99.00 kB | 28.66 kB |
| **Total listed startup payload** | **1,296.26 kB** | **343.05 kB** |

Vite reports the app and Three.js core chunks above its 500 kB advisory. The
application already isolates Three.js addons and physics; mission/post-MVP
content lazy-loading remains a future optimization.

## Reproduction

1. Run `npm run build` and record Vite's raw/gzip table.
2. Run `npm run dev -- --host 127.0.0.1 --port 4173`.
3. Open:
   `/?testMode=1&profile=clean&seed=phase-0-baseline&traffic=48&pedestrians=60&time=14.5&weather=clear&mission=mission_executive&diagnostics=1&quality=high`
4. Wait six seconds after `data-app-state="ready"`.
5. Record the immutable JSON in the diagnostics panel's `data-snapshot`.
6. Note viewport, GPU renderer string, optional flags, browser, and deviations.
