# Phase 0 Manual Interaction and Vehicle Evidence

This directory contains the reviewer-driven complement to the reproducible
browser atlas. `manual-manifest.json` is the authoritative inventory: it records
43 screenshot hashes, per-scenario telemetry, review status, capture context,
and the aggregate pass assertions.

The evidence covers Builder move/rotate/demolish; on-foot collision, jump, bat
contact, timed hijack, and vehicle exit; five vehicle classes across flat,
turn, bridge, rain, contact, and reset conditions; race checkpoint, sabotage
hold, minimap, police pursuit, and applied recovery restore.

## Repeating the capture

1. Start the development server at `http://127.0.0.1:4173/`.
2. Open a development/test URL with `testMode=1`, `profile=clean`,
   `seed=metropulse-phase-0`, `traffic=48`, `pedestrians=60`, `quality=low`,
   `diagnostics=1`, and `manualCapture=1`.
3. Choose the mission-specific `mission` query value for race or sabotage
   captures.
4. Invoke the semantic scenario controls installed by
   `src/testing/ManualCaptureHarness.js`, visually inspect the 1280×720 frame,
   and retain the body telemetry only when `data-phase0-status="passed"`.
5. Recompute every screenshot SHA-256 and update `manual-manifest.json`.

The harness is inert unless both development test mode and the explicit
`manualCapture=1` parameter are active. It does not change normal play.

