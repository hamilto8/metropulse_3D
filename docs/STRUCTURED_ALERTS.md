# Structured Alerts

> **Status:** P3.4 implementation contract  
> **Domain owner:** `AlertService`  
> **Action owner:** `AlertActionController`  
> **Presentation owner:** `UIManager`

## Purpose and ownership

Alerts are durable city facts with a lifecycle, not strings owned by the DOM.
`AlertService` is renderer-free and is the only authority for publishing,
updating, resolving, superseding, expiring, validating, and serializing alert
records. `UIManager.addAlert()` remains a compatibility adapter for older
producers: it converts a message and legacy tone into a complete structured
record before the UI sees it.

```text
Gameplay / mission / city producer
                 |
                 v
          AlertService record
             /          \
            v            v
     UIManager view   SaveService alerts domain
            |
            v
  AlertActionController -> management camera / street waypoint
```

The DOM never serves as save input when `AlertService` is present. Rendering,
collapsing the Recent Activity accordion, or removing a visible row cannot
delete domain history.

## Record contract

Every record contains:

| Field | Contract |
|---|---|
| `id` / `dedupeKey` | Stable instance identity and active-condition identity |
| `type` | Extensible uppercase category such as `MISSION`, `CRIME`, or `TRAFFIC` |
| `severity` | `INFO`, `SUCCESS`, `WARNING`, or `CRITICAL` |
| `title` / `cause` | Short scan label and plain-language reason |
| `location` | Label, optional district ID, and optional finite world position |
| `startTime` / `lastObservedAt` | ISO timestamps for first and latest observation |
| `duration` | Timed, until resolved, or persistent policy |
| `state` | `ACTIVE`, `RESOLVED`, or `SUPERSEDED` |
| `recommendation` | A player-readable remedy or next step |
| `relatedEntityIds` | Stable domain/content IDs, never renderer UUIDs |
| `focusAction` | None, management-camera focus, or street waypoint |
| `occurrences` | Number of reports collapsed into the active record |
| resolution fields | Resolution time/reason and replacement ID when superseded |

Returned records, snapshots, locations, actions, and ID arrays are deeply
immutable. Invalid coordinates, dates, enums, timed durations, and actionable
records without a position fail before mutation.

## Lifecycle and duplicate policy

- A producer assigns one semantic `dedupeKey` per live condition. Publishing
  that key again updates the same record, preserves its original start time,
  refreshes `lastObservedAt`, and increments `occurrences`.
- A condition owner calls `resolve(key, reason)` when the condition ends.
- A replacement record lists prior alert IDs in `supersedes`; those records are
  retained as `SUPERSEDED` and point to the replacement.
- Timed records expire after their latest observation. Persistent and
  until-resolved records require an explicit lifecycle transition.
- Resolved history is pruned oldest-first at the configured bound. Active
  conditions are never discarded to make room, and repeated reports never
  grow the collection.

Mission attempts use their idempotent outcome transaction as the dedupe key.
A newer attempt supersedes the prior active alert for that mission. This keeps
one current mission result in City Alerts while the complete immutable attempt
history remains in the Outcome Log.

## Focus actions

`AlertActionController` executes only the action carried by the selected active
record:

- `MANAGEMENT_CAMERA` uses `SceneManager.focusWorldPosition()` and is rejected
  outside Management or Builder, avoiding mission/control bypasses.
- `STREET_WAYPOINT` owns one alert waypoint rendered by `MinimapHUD`. A newer
  waypoint replaces the previous one, and resolution/supersession clears it.
- `NONE` is explicit; the UI does not invent an action from location data.

The action result is returned as `{ ok, message }` and announced with the
existing accessible toast. Action buttons include alert title and location in
their accessible names.

## Persistence and migration

The alerts save domain is version 2 and serializes authoritative records plus
the domain sequence. Restore validates every record and rejects duplicate IDs
or duplicate active dedupe keys before replacing live state. Version-1
`{time,message,type}` feeds remain valid migration input and are normalized to
complete records on restore.

The active street waypoint and camera interpolation are presentation state and
remain intentionally transient. The persisted alert retains its action and
position, so the player can recreate either action after reload.

## Extension rules

1. Publish stable causes, locations, and related entity IDs at the producer;
   do not parse rendered text to recover them later.
2. Reuse a semantic dedupe key for observations of one condition and resolve
   it from the same domain owner that ends the condition.
3. Add a new uppercase `type` without changing the service. Add a new severity,
   duration, state, or focus action only with validation, UI, save, and action
   tests in the same change.
4. Keep focus effects in `AlertActionController`/world adapters. `AlertService`
   must remain usable in Node without Three.js or the DOM.
5. Keep recommendations plain, specific, and actionable; alerts may reinforce
   an objective but may not become its only source.

