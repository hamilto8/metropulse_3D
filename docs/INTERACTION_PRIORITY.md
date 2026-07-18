# Interaction Priority Contract

`InteractionService` is the authoritative owner of primary interaction
selection and resolution. `InputManager` samples keyboard/gamepad input but
does not know about missions, vehicles, pedestrians, aircraft, doors, or any
future interactable type.

## Ownership

- Domain systems publish candidates through `getInteractionCandidates()`.
- `src/app/MetroPulseInteractions.js` is the production composition root. It
  registers publishers and blocks world interactions during Builder, Dialogue,
  and Pause contexts.
- `InteractionService` validates candidates, creates an immutable snapshot,
  selects exactly one primary candidate, and resolves its action.
- `InteractionPrompt` is the only primary-prompt DOM owner. It consumes the
  service snapshot and renders the current keyboard/gamepad binding.
- `InputManager.handlePrimaryAction()` delegates only to
  `InteractionService.resolvePrimary()`.

## Candidate contract

Every published candidate must provide:

| Field | Contract |
|---|---|
| `id` | Stable, non-empty ID namespaced by interaction type. |
| `kind` | Stable category used by presentation, tests, and diagnostics. |
| `eligibility` | Boolean or `{ allowed, reason }`. An ineligible candidate must include a player-facing reason. |
| `priority` | Finite numeric design priority. Do not derive it from array or spawn order. |
| `prompt` | Concise visible action phrase, excluding the input binding. |
| `action` | Function that attempts only this candidate's domain action. |
| `failureReason` | Player-facing reason when the action is unavailable. |
| `distance` | Non-negative world distance or `Infinity` for non-spatial UI selections. |
| `accessibilityLabel` | Standalone descriptive label that does not rely on icon or color. |

Optional `metadata` may contain stable IDs or categories for diagnostics. It
must not become a second owner of domain state.

## Deterministic order

Candidates use one stable total order:

1. Eligible before ineligible.
2. Higher design priority.
3. Shorter distance.
4. Lexicographically smaller stable candidate ID.
5. Lexicographically smaller provider ID as a final defensive tie-break.

The production priority bands are:

1. Active mission objective.
2. Mission pickup/details.
3. Aircraft boarding.
4. Vehicle hijack.
5. NPC conversation.
6. Controlled vehicle/aircraft exit.
7. Selected management entity fallback.

When every candidate is ineligible, the highest-priority candidate remains
primary and reports its failure reason. Controlled vehicle/aircraft exits also
publish mission-critical eligibility, so an active objective cannot silently
fall through to an invalid exit.

## Failure behavior

- No candidate: input is unhandled and no primary prompt is visible.
- Ineligible primary: its action is not called; the shared failure presenter
  reports the published reason.
- Action returns `false`: resolution is handled but recorded as rejected; a
  different candidate is not attempted.
- Provider/action exception: the error is isolated and reported without
  falling through to a different world action.
- Reentrant resolution: rejected while the current action owns resolution.

## Adding an interactable

1. Add `getInteractionCandidates()` to the narrow domain owner, or create a
   focused adapter if the owner should remain unaware of interactions.
2. Publish the complete contract using a stable ID and an existing priority
   band when possible.
3. Register the publisher in `MetroPulseInteractions.js`.
4. Add deterministic overlap, eligibility/failure, action, and prompt tests.
5. Do not add keyboard listeners, input branches, or a second prompt element.

Doors are intentionally supported by the generic contract and deterministic
tests even though the current MVP footprint has no authored door interaction.

## Verification

- `test/InteractionService.test.js` covers validation, immutable snapshots,
  mission/vehicle/NPC/door overlaps, all tie-breakers, ineligible actions,
  provider/action failure isolation, and registration cleanup.
- `test/InteractionPublishers.test.js` covers production mission, aircraft,
  traffic, vehicle, and NPC candidate publication.
- `test/InputManager.test.js` proves keyboard/gamepad primary actions have one
  route.
- `test/browser/smoke.spec.js` proves one visible prompt, binding-to-action
  agreement, vehicle exit resolution, and pause/dialogue clearing in WebGL.
