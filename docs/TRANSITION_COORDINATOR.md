# MetroPulse Transition Coordinator

> **Status:** P1.2 implementation contract  
> **Owner:** game session (`TransitionCoordinator`)  
> **Policy authority:** `GameManager` and `GameState`

## Responsibility boundary

`GameManager` decides whether a state change is legal and owns the canonical
state. `TransitionCoordinator` executes the runtime effects of that decision.
`MetroPulseTransitionRuntime` adapts the coordinator to the current Three.js,
entity, input, UI, audio, and clock systems. This separation keeps policy tests
renderer-independent and prevents domain systems from independently ordering
cross-mode work.

Production callers request transitions through `app.transitionCoordinator`.
Traffic, pedestrian, and aircraft systems retain narrow `coordinated` methods
for the runtime adapter; those methods mutate only their domain ownership and
must not request a nested state change.

## Ordered transaction

| Order | Phase | Postcondition |
|---:|---|---|
| 1 | Validate request | The edge and request guards pass. |
| 2 | Suspend input | No gameplay action can be sampled mid-handoff. |
| 3 | Clear held actions | Keyboard and analog movement values are neutral. |
| 4 | Capture source | Ownership, transforms, camera, clock policy, and editor presentation are recoverable. |
| 5 | Handoff entity | Exactly the destination entity kind, or none, owns player control. |
| 6 | Position camera | Camera ownership matches the destination and its origin is clearance-safe. |
| 7 | Configure simulation | The declared clock policy is published for P1.3 scheduling. |
| 8 | Configure presentation | Editor/UI and ownership-driven audio agree with runtime state. |
| 9 | Validate destination | Live ownership satisfies the destination contract. |
| 10 | Commit | `GameManager` publishes the stable destination; input resumes in cleanup. |

Every phase is synchronous. Returning a Promise fails closed so a transition
cannot remain half-active across unrelated render frames. Future asset-backed
transitions should introduce an explicit asynchronous state contract rather
than weakening this invariant.

## Compensation and idempotency

The coordinator captures source state before the first ownership mutation.
On failure it executes compensation callbacks in reverse order, asks
`GameManager` to select a safe recovery state, and always runs cleanup. Input
suspension uses opaque tokens, so repeated resume or stale-token calls cannot
unsuspend a different owner.

Requesting the already-active stable state is a no-op. Entity release,
physics cleanup, camera detachment, editor hide, and input cleanup tolerate
repeat calls. Reentrant requests fail with `TRANSITION_IN_PROGRESS` and do not
replace the active transaction.

## Ownership and transform rules

- Macro, builder, load, boot, and result destinations release all direct
  entity control before commit.
- On-foot commits require one controlled pedestrian.
- Vehicle commits require one controlled vehicle or aircraft.
- Vehicle and pedestrian AI handoffs use the existing pose-preserving
  `AiControlHandoff` path.
- Vehicle exit spawns/restores the pedestrian beside the vehicle using its
  final position and heading before changing control.
- Aircraft exit restores the suspended pilot at the aircraft exit pose.
- Runtime validation rejects multiple owners even if a domain system regresses.

## Camera clearance

`CameraClearanceQuery` treats the camera as a clearance sphere. It raises poses
above terrain, rejects low water positions, and checks AABBs published by:

- authored and editor-placed buildings;
- countryside scenery and tree trunks;
- vehicles and pedestrians;
- aircraft and airfield/static scenery.

If the desired pose is obstructed, a deterministic ring search favors the
direction away from the followed entity. The chase rig applies the same query
on every desired chase pose, preventing a safe spawn from drifting into an
obstacle on the next frame.

## Verification

- `TransitionCoordinator.test.js` verifies exact phase order, destination
  validation, compensation, cleanup, idempotency, and reentrancy.
- `CameraClearanceQuery.test.js` verifies terrain/slope lifting, building/tree
  avoidance, vehicle ignore rules, water avoidance, and fail-closed behavior.
- The Playwright smoke flow performs 50 real runtime cycles across management,
  builder, pedestrian, and vehicle states. It asserts final ownership, held
  input, active transition, camera clearance, entity transforms, physics-body
  count, and scene-object count.
