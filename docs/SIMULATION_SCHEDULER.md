# MetroPulse 3D Simulation Scheduler

> **Status:** P1.3 production contract  
> **Owner:** `src/core/SimulationScheduler.js`  
> **Production schedule:** `src/app/MetroPulseSimulationSchedule.js`

## Purpose

`SimulationScheduler` is the sole owner of frame timing, fixed-step
accumulation, city cadence, update order, and state-based simulation gates.
`main.js` remains the composition root and animation-frame driver; it does not
advance individual systems or maintain gameplay accumulators.

The core scheduler is renderer-independent. It does not import Three.js,
cannon-es, DOM APIs, or game systems. MetroPulse registers its systems in the
app-specific schedule, which keeps timing policy testable without creating a
second domain owner.

## Clock domains

| Clock | Meaning | Scaling and gating |
|---|---|---|
| `RENDER` | Browser time received from `requestAnimationFrame` | Never game-speed scaled. Records the full non-negative frame interval. |
| `GAMEPLAY_REAL_TIME` | Timers, AI, weather, effects, missions, and world audio | Clamped to 100 ms per frame and active only in City, Builder, or Street clock policies. |
| `PHYSICS_FIXED` | cannon-es authority | Fixed at 1/120 s. Uses an accumulator and at most 10 catch-up steps per render frame. |
| `CITY_LOGICAL` | Economy and time-of-day authority | Fixed 1 s logical ticks. City/Builder may use the selected city multiplier; Street is exactly 1x. |
| `UI` | DOM presentation, menu input, HUD animation, and accessibility navigation | Clamped for animation safety, never game-speed scaled, and remains active while gameplay is stopped. |
| `PAUSED` | Time spent in the explicit `PAUSED` policy | Records full browser time while gameplay, physics, and city clocks remain stopped. |

Clamping protects gameplay from a tab suspension or debugger stop. It does not
change the render and paused elapsed-time records. Fixed-physics and city
accumulator remainders are retained; catch-up budgets postpone excess work
instead of deleting elapsed simulation time.

## Stable update order

Every frame follows this order:

1. **Input** — sample the current device before systems consume actions. This
   stage uses UI time so menu input can remain responsive when gameplay stops.
   The clock policy is re-read after input, so a pause request gates the same
   frame instead of leaking one last gameplay/physics update.
2. **Fixed physics** — integrate zero or more complete 1/120 s intervals before
   variable world simulation reads physics results.
3. **Gameplay** — refresh spatial indices, then update traffic, pedestrians,
   aircraft, effects, overlays, audio, mission rules, and authored world motion.
4. **City** — run zero or more complete 1 s logical ticks. Time-of-day advances
   before economy so both observe one authoritative logical instant.
5. **Presentation** — update time/weather visuals and DOM HUDs after domain
   state has settled. Menu/HUD presentation uses UI time rather than city time.
6. **Camera** — resolve the final camera pose after controlled entities move.
7. **Render** — draw exactly once from the completed frame state.

Tasks within a stage use explicit numeric order. Equal-order tasks retain
registration order. Task IDs are unique, and registration returns an idempotent
unregister function for feature or lifecycle cleanup.

## State and pause policy

Game-state destination contracts select one of the scheduler policies through
`MetroPulseTransitionRuntime.configureSimulation`. Failed transitions restore
the captured source policy as part of compensation.

| Clock policy | Gameplay | Fixed physics | City logical | UI / camera / render |
|---|---:|---:|---:|---:|
| `CITY` | Yes | Yes | Yes, selected 0.5x/1x/5x/15x | Yes |
| `BUILDER` | Yes | Yes | Yes, selected 0.5x/1x/5x/15x | Yes |
| `STREET` | Yes | Yes | Yes, forced 1x | Yes |
| `RESULT` | No | No | No | Yes |
| `PAUSED` | No | No | No | Yes |
| `STOPPED`, `HANDOFF`, `MENU` | No | No | No | Yes |

The Time Manager's play/pause control is a city-clock control, not the session
pause state. When it is off, city ticks stop in every primary mode. When it is
on, a speed selected in management remains stored but cannot accelerate or slow
Street gameplay, missions, physics, AI, weather, or Street city ticks.

P1.3 provides the scheduler-level pause contract and clock isolation. P1.4 owns
the player-facing pause menu, focus/input quarantine, and per-modal behavior.

## Adding a system

1. Choose the clock that represents the system's domain; do not multiply a
   supplied delta again.
2. Register one small task in `MetroPulseSimulationSchedule.js` at the stage
   where its inputs are stable and before its consumers run.
3. Use a fixed stage only for deterministic authoritative work. Rendering and
   UI animation must not run once per physics or city catch-up tick.
4. Add a unique task ID, an order with space around adjacent tasks, and an
   `enabled` predicate only for feature-specific gating.
5. Test pause/state gating, a partial accumulator interval, and any designed
   time scaling. Never create a local pause flag, frame clock, or accumulator
   to bypass the scheduler.

Compatibility `update`/`step` methods may remain for isolated tests or legacy
callers, but production frame ownership belongs to the scheduler.

## Verification

`test/SimulationScheduler.test.js` covers:

- canonical stage order and within-stage priority;
- all six clock domains;
- stopped and paused policy gates;
- same-frame pause/resume policy changes without a leaked gameplay update;
- fixed-physics and city remainder preservation;
- bounded catch-up without discarded backlog;
- exact 1x Street city time and management multipliers;
- task uniqueness, predicates, and removal;
- browser timestamp conversion and simulation clamping;
- production schedule delivery of one-second time/economy ticks.

The Playwright smoke test verifies the production diagnostics owner, City clock
policy, one-second logical cadence, and normal operation through the existing
50-cycle mode-transition soak.
