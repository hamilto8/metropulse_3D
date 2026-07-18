# MetroPulse Game State Machine

> **Status:** P1.1 implementation contract  
> **Authority:** `METROPULSE_3D_COMPLETION_ROADMAP.md`, Phase 1  
> **Owner:** `GameManager`

## Purpose and boundary

`GameManager` is the only authority for game-session state and transition
policy. `TransitionCoordinator` is the only production owner of runtime
transition orchestration. `GameManager` remains renderer-independent: it does
not import Three.js, access the DOM, manipulate entities, operate cameras, or
advance clocks.

`GameState.js` contains immutable policy data, `GameTransition.js` contains
context normalization, destination invariants, rejection records, and the
typed transition error, and `GameManager.js` owns mutable state and lifecycle.
The P1.2 coordinator consumes the declared effect contract through
`MetroPulseTransitionRuntime` and performs handoffs in a compensatable order.

Mayhem remains an independent overlay. It never replaces a primary game state.

## States

| State | Purpose |
|---|---|
| `BOOT` | Process startup before required services are initialized. |
| `LOAD` | World, content, settings, and save preparation. |
| `MANAGEMENT` | Macro city-management interaction. |
| `BUILDER` | City editor interaction with no directly controlled street entity. |
| `TRANSITION` | Machine-owned transient state while a handoff is being validated and committed. |
| `STREET_ON_FOOT` | One pedestrian has player control. |
| `STREET_VEHICLE` | One vehicle or optional aircraft has player control. |
| `RESULT` | Mission outcome presentation before cleanup/debrief commit. |
| `PAUSED` | Gameplay clocks suspended with one recorded resume target. |
| `MENU` | Session/menu presentation with gameplay authority suspended. |

The `mode` snapshot property remains only as a compatibility alias for
`state`. The old ambiguous `ACTION` value no longer exists.

## Legal requested destinations

Every non-idempotent request passes through `TRANSITION`. Callers never request
`TRANSITION` directly.

| Source | Legal requested destinations |
|---|---|
| `BOOT` | `LOAD`, `MENU` |
| `LOAD` | `MANAGEMENT`, `MENU` |
| `MANAGEMENT` | `BUILDER`, `STREET_ON_FOOT`, `STREET_VEHICLE`, `PAUSED`, `MENU` |
| `BUILDER` | `MANAGEMENT`, `PAUSED`, `MENU` |
| `STREET_ON_FOOT` | `STREET_VEHICLE`, `MANAGEMENT`, `RESULT`, `PAUSED`, `MENU` |
| `STREET_VEHICLE` | `STREET_ON_FOOT`, `MANAGEMENT`, `RESULT`, `PAUSED`, `MENU` |
| `RESULT` | `MANAGEMENT`, `STREET_ON_FOOT`, `STREET_VEHICLE`, `PAUSED`, `MENU` |
| `PAUSED` | Its recorded source state, or `MENU` |
| `MENU` | `LOAD`, `MANAGEMENT` |

Re-selecting the current stable state is an idempotent no-op. `TRANSITION` has
no public outgoing request row; only `commitTransition()` or
`failTransition()` may leave it.

## Runtime context and guards

The app supplies a plain renderer-free context snapshot containing:

- active and mission-critical status plus the mission state;
- whether an entity handoff is pending;
- controlled-entity count and kind;
- whether player Heat is active.

Core guards enforce these invariants:

- `BUILDER` rejects an unresolved handoff, mission-critical state, or direct
  entity control.
- `MANAGEMENT`, `BUILDER`, `RESULT`, `LOAD`, and `BOOT` require no directly
  controlled entity at commit.
- `STREET_ON_FOOT` requires exactly one controlled pedestrian.
- `STREET_VEHICLE` requires exactly one controlled vehicle or aircraft.
- More than one controlled entity is always an invariant failure.
- A mission-critical street state may only move to `RESULT` or `PAUSED` until
  mission cleanup resolves it.
- A paused session may resume only to the state that was paused.

Feature-specific guards can be registered with `addGuard()`. They run for both
the request and commit phases and return a stable code, reason, and optional
details. Guard exceptions become `GUARD_ERROR` rejections and cannot corrupt
the state machine.

Stable built-in rejection codes are exported as
`TRANSITION_REJECTION_CODES`; presentation code should display or translate
the accompanying reason rather than reconstructing policy.

## Transition lifecycle

The low-level lifecycle is:

1. `evaluateTransition(destination)` returns a non-mutating eligibility result.
2. `beginTransition(destination)` validates the request, records immutable
   metadata/effects, and enters `TRANSITION`.
3. `TransitionCoordinator` suspends input, clears held actions, captures the
   source, hands off ownership, positions a clearance-checked camera,
   configures simulation policy, and synchronizes UI/audio.
4. `commitTransition()` re-samples context, validates destination ownership,
   runs commit guards, and enters the destination.
5. `failTransition(error)` returns to the source when its ownership contract
   still holds. Otherwise it selects `MANAGEMENT` when control and mission
   state are clean, falling back to `MENU` for an unresolved unsafe session.

`GameManager.transitionTo()` remains a low-level compatibility convenience for
isolated policy tests. Production feature code calls
`TransitionCoordinator.transitionTo()` so runtime work always occurs between
`beginTransition()` and `commitTransition()`.

Each transition records an ID, source, destination, recovery state, timestamps,
status, reason/source/correlation metadata, a safe target descriptor, and the
full ownership-effect contract. Live entity references are not retained in
metadata.

## State effect contract

Every state declares policies for five owned concepts:

- mission: require none/resolved, preserve, suspend, or preserve through result;
- Heat: preserve while running or preserve while frozen;
- controlled entity: require none, hand off, require pedestrian/vehicle,
  preserve, or suspend;
- camera: no owner, loading, management, builder, handoff, street, result,
  preserve, or menu;
- simulation clock: stopped, city, builder, handoff, street, result, paused,
  or menu.

`getTransitionEffects(from, to)` produces the immutable before/after contract.
P1.2 executes control, camera, input, UI/audio, and simulation-policy effects;
fixed-cadence clock scheduling remains P1.3.

## Runtime coordinator

The execution order is stable and observable:

1. validate the request;
2. suspend input sampling;
3. clear keyboard/gamepad held actions;
4. capture source ownership, transforms, camera, clock policy, and editor UI;
5. hand off controlled-entity ownership;
6. resolve and position the destination camera;
7. configure the destination simulation-clock policy;
8. synchronize UI and ownership-driven audio;
9. validate the live destination ownership contract;
10. commit the `GameManager` transition and resume input.

If a phase fails, registered compensations run in reverse order before
`GameManager.failTransition()`. Source entity transforms and control sessions,
camera pose/follow ownership, editor visibility, and clock policy are restored.
Cleanup is idempotent and always resumes input. Reentrant transition requests
are rejected while the active execution remains intact.

`CameraClearanceQuery` is shared by initial transition placement and the chase
camera rig. It tests terrain clearance, low water volumes, authored and placed
buildings, scenery/tree colliders, vehicles, pedestrians, and aircraft. An
obstructed desired pose is moved through a deterministic radial search; failure
to find a safe pose fails closed and triggers transition compensation.

## Events and snapshots

Subscribers receive immutable events for transition start, commit, rejection,
failure, state change, Mayhem change, restore, and current snapshot delivery.
One failing listener is isolated and cannot interrupt a commit. Runtime
diagnostics expose the active and most recent transition from `GameManager`.

Serializable snapshots contain `state`, the `mode` compatibility alias,
Mayhem, revision, active/last transition metadata, and the pause resume state.
Restoration rejects transient states and invalid destination ownership before
mutating live state.
