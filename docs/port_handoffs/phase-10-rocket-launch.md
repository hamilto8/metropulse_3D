# Phase 10 Rocket Launch handoff

## Scope delivered

`rocketLaunch` is now a complete independent, default-off Godot 4.6 feature package. When disabled it creates no facility, colliders, scheduler task, UI, input action, save state, or camera availability. The existing placement reservations remain the only retained off-state contract.

When enabled, the package creates the launch pad, gantry, mission-control building, staged rocket, flame, and a fixed pool of twenty vapor visuals. The three physical facility elements register through the shared world-collider authority. `RocketLaunchModel` owns the source-aligned five-minute countdown, idempotent immediate launch, 45 m/s² vertical acceleration, and exact pad reset. The gameplay scheduler owns time, so the countdown and ascent freeze under Pause.

The feature adds an accessible countdown/launch/reset panel and makes the canonical `rocket` camera preset available only for that session. During ascent the camera tracks the authored launch framing. Flame pulsing honors flash-intensity preferences, reduced motion suppresses vapor motion, spatial launch audio publishes its closed caption, and reset clears all pooled presentation state.

## Cleanup and persistence

- Reset returns countdown, altitude, velocity, flame/vapor presentation, and UI to the feature baseline without rebuilding nodes.
- Feature shutdown unregisters all three facility colliders, removes the scheduler task, and frees the facility and UI trees.
- A fresh enabled session always starts unlaunched at T-5:00.
- A new game with the package unavailable remains valid, contains no rocket state, and rejects the optional camera preset.
- No launch/countdown/altitude state is serialized, so older/current browser-compatible saves require no new fields and cannot restore an unavailable package.

## Verification

- Domain suite: 401 tests, including countdown, automatic/immediate launch, acceleration, idempotence, reset, and invalid-delta behavior.
- Godot build: zero warnings/errors.
- Enabled headless integration: `phase10.rocket-launch.passed` plus the full 179-assertion integration suite.
- Integration covers feature-off absence, facility/collider/pool counts, pause freeze, countdown UI, immediate launch, motion, dynamic camera, caption, reset, fresh-session baseline, shutdown cleanup, and unavailable-package behavior.
- Default-off clean/import/recovery and rejected-import cases remain covered by the standard integration matrix.

Run the focused enabled scenario with:

```sh
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-phase10-feature.sh rocketLaunch
```
