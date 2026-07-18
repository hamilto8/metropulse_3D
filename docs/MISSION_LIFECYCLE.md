# Mission Lifecycle Contract

> **Status:** P3.2 implementation contract  
> **Authority:** `MissionLifecycleController` owns mission rules; `MissionSystem`
> is the Three.js, audio, input, and DOM adapter.

## Ownership

`src/missions/MissionLifecycleController.js` is renderer-free and owns:

- mission availability and prerequisite evaluation;
- weather compatibility and locked-in adaptations;
- preparation, briefing, approach, execution, checkpoint, resolution, cleanup,
  result, and recovery phases;
- stable run and attempt identities;
- template retry limits and checkpoint selection;
- completed mission IDs, dialogue choices, chronology, and run counts;
- whether the mission domain is safe to serialize.

`MissionSystem` may detect world events and render a lifecycle snapshot. It may
not clear a run, award Capital, or invent a retry outside the controller.
`MissionOutcomeService` remains the atomic consequence and Capital transaction
owner. `SaveService` persists only validated lifecycle snapshots.

## State machine

The normal path is:

```text
IDLE -> PREPARATION -> BRIEFING -> APPROACH -> ACTIVE
ACTIVE -> CHECKPOINT -> ACTIVE
ACTIVE -> COMPLETION | FAILURE -> CLEANUP -> RESULT
RESULT -> RECOVERY -> IDLE
RESULT -> RECOVERY -> APPROACH -> ACTIVE  (bounded retry)
```

`PREPARATION`, `BRIEFING`, `COMPLETION`, `FAILURE`, `CLEANUP`, and `RECOVERY`
are commit-sensitive phases. Saves are refused in those phases. Active,
checkpoint, and committed result snapshots are safe to persist.

An objective resolution does not clear `activeMission`. It first receives a
stable transaction ID:

```text
mission:<mission-id>:run-<n>:attempt-<n>:<SUCCESS|FAILURE>
```

Cleanup applies that transaction through `MissionOutcomeService`. Only its
matching receipt can move the lifecycle to `RESULT`. A failed cleanup remains
mission-critical in `CLEANUP`, keeps the mission owned, blocks mode escape, and
blocks saving. Exact transaction replay is idempotent through the outcome
ledger.

## Availability and prerequisites

Every authored mission declares `prerequisites`, even when the array is empty.
Supported prerequisite forms are:

- a mission ID shorthand, meaning that mission must be completed;
- `MISSION_COMPLETED`;
- `FOLLOW_UP_STATUS`, evaluated against committed outcome state;
- `CITY_CONDITION`, evaluated by `CityConditionService`.

The result contains an immutable status, all evaluated requirements, and
player-facing failure reasons. Mission references are validated at boot and
the prerequisite graph must remain acyclic. Non-repeatable completed missions
and outcome-owned `LOCKED`, `FAILED`, or `EXPIRED` follow-ups are unavailable.

## Weather compatibility

Every mission references a shared policy from
`MissionPolicyDefinitions.js`. A policy produces one explicit disposition:

| Disposition | Start allowed | Behavior |
|---|---:|---|
| `ALLOWED` | Yes | Authored timing and reward are unchanged. |
| `ADAPTED` | Yes | Time/reward multipliers and an explanation are locked into the run. |
| `DELAYED` | No | The marker is unavailable until conditions change. |
| `BLOCKED` | No | The activity is incompatible and exposes a clear reason. |

The accepted decision is stored in the run. A later dynamic-weather change
does not silently rewrite the contract already shown to the player.

## Checkpoints and retry

Default retry rules are centralized by activity template:

| Template | Strategy | Attempts |
|---|---|---:|
| Taxi, Courier, Delivery | Restart approach | 3 |
| Race | Latest cleared route checkpoint | 3 |
| Sabotage | Latest target-arrival checkpoint | 3 |
| Survival | Restart activity | 2 |

Authored `retryPolicy` may override these bounds after validation. Race
checkpoints capture route index, elapsed rival time, timer, payout, and
congestion samples. Sabotage captures safe target arrival but resets the hold
interaction. Restart templates never reuse incidental world progress. Every
retry increments `attempt`; it never creates a duplicate narrative run or
reuses an earlier attempt transaction ID.

## Save and transition rules

- `SaveService` asks `lifecycle.canSave()` before scheduling, snapshotting, or
  writing. A commit-sensitive phase returns `MISSION_COMMIT_IN_PROGRESS`.
- Every newly captured save is domain- and reference-validated before the
  repository write.
- Static restore applies mission progress only. The accepted run is restored
  after the boot transition has reacquired its saved entity, preventing an
  active mission from blocking its own load path.
- `RESULT` saves retain the mission vehicle as a recovery descriptor even
  though result mode correctly owns no live player control.
- `GameManager` continues to allow a mission-critical street state to enter
  only `RESULT` or pause. Management and Builder require recovery to finish.
- Mission presentation is removed only after the committed result is
  acknowledged and the Management transition succeeds.

## Extension checklist

When adding a mission or activity behavior:

1. Add stable prerequisites and a shared weather-policy ID.
2. Use an existing activity template unless the frozen MVP scope is amended.
3. Define checkpoint payloads as renderer-free serializable data.
4. Select a bounded retry strategy; never infer unlimited retry.
5. Express city effects as `MissionOutcomeService` commands.
6. Keep UI copy derived from availability, weather, result, and retry snapshots.
7. Cover normal, failed, retry-exhausted, cleanup-failure, save/restore, and
   transition behavior.
