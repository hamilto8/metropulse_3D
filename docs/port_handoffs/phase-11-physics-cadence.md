# Phase 11 physics-cadence handoff

Date: 2026-08-13

Objective: Compare 60, 90, and 120 Hz with actual native telemetry and the same
handling/contact checks, then make one release decision. The accepted decision
is `docs/adr/0002-retain-120-hz-physics-cadence.md`.

Implementation: `--physics-ticks=60|90|120` is a debug-only bounded comparison
option. Release parsing rejects it, and it conflicts with the legacy 30 Hz
low-tick test. Integration now asserts the configured cadence rather than
hard-coding 120, allowing the identical scenario to run at each candidate.
Performance capture builds the latest Debug assembly before launch and asserts
that the report's cadence equals the requested cadence. This check rejected an
initial stale-assembly comparison where all three files self-reported 120 Hz;
those invalid numbers were discarded and the measured runs were repeated.

Verification:

- 433 domain tests passed.
- 60, 90, and 120 Hz each passed the full 179-assertion native scenario,
  including interpolation, six-profile handling, impacts, bridge/terrain
  contacts, weather, recovery/ejection, control transfer, and ownership soaks.
- Matched eight-second high-quality native-window captures passed their cadence
  self-checks and all 60 FPS/30 FPS/33 ms gates on the base M1 Pro MacBook Pro.
- 120 Hz retained approximately 120 FPS with 8.34 ms average/8.47 ms P99 frame
  time. Its 5.03 ms average physics counter and 210,573,816 allocated bytes over
  the measured window remain optimization evidence, not a waiver.

Cross-platform boundary: Windows/Linux execution and minimum/recommended target
hardware are unavailable. Do not generalize this result beyond the tested Mac.
Reopen the ADR under its recorded target-host, tail-frame, latency, or Godot/Jolt
change criteria.
