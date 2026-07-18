# Versioned SaveService contract

## Authority and storage

`src/save/SaveService.js` is the only authority for game-save creation,
validation, restoration, autosave policy, checkpoints, and save status.
`IndexedDbSaveRepository` owns storage mechanics and exposes two logical slots:

- `current`: the document selected by Continue.
- `recovery`: the previous known-good `current` document.

Every ordinary save is one IndexedDB read/write transaction. The prior current
document is copied to recovery and the new current document is written in that
same transaction. An abort commits neither operation. Recover promotes the
recovery document without first rotating a possibly corrupt current document
over it. New Game moves a valid current document to recovery before clearing
the current slot.

LocalStorage key `metropulse3d:city-session:v1` is read-only migration input.
It is converted to the current envelope, copied successfully to IndexedDB, and
then removed. New code must never write game state to LocalStorage.

## Versioning

The envelope has independent version axes:

- `schemaVersion` describes the storage envelope and is migrated sequentially
  by `SAVE_MIGRATIONS`.
- `featureVersion` describes the aggregate game-save feature set.
- Every domain record has its own `version`, so economy, world, mission, and
  future faction/progression schemas can evolve independently.

Unsupported future schema versions fail closed with a player-facing message.
No domain is applied until the complete envelope, every domain shape, stable
content references, and the controlled-entity reference have been validated.

## Saved domains

The schema always contains these records, even when a future system is not yet
enabled:

- authoritative game state/current mode, pause resume target, and Mayhem;
- economy and persistent incidents;
- user world edits, zones, and stable building IDs;
- controlled entity stable ID/type, pose, speed, and player inventory;
- time, playback rate, dynamic-weather restart policy, and current weather;
- narrative state, run counts, active mission, checkpoint/route progress,
  objective timers, payout, race state, and sabotage state;
- faction and progression records (extensible empty versioned records until
  their Phase 6 authorities exist);
- Heat, escape progress, and active incident ID;
- settings snapshot and binding overrides;
- structured alert records, lifecycle state, dedupe identity, remedies, related
  entity IDs, and replayable focus actions (version-1 message feeds migrate to
  the version-2 alert domain on restore).

## Intentionally transient state

The save does not contain renderer/GPU objects, physics contacts or solver
caches, particles, explosions, temporary effects, ambient AI internals, held
input, focus/hover/modal presentation state, audio playback cursors, scheduler
accumulators, or an in-flight transition. These are safely regenerated from
the persistent domain state.

## Save policy and UI

Economy and authoritative game-state changes schedule a five-second debounced
autosave. World systems may call `scheduleSave(reason)` and mission code may
call `saveCheckpoint(stableCheckpointId)`. Multiple events within the debounce
window are coalesced into `metadata.reasons`; the primary reason and optional
checkpoint are also recorded. Page hide requests an immediate best-effort
save. A failed or interrupted write leaves both previously committed slots
unchanged.

`SaveService.subscribe()` publishes `IDLE`, `SCHEDULED`, `SAVING`, `SAVED`,
`LOADING`, and `ERROR`. `UIManager` renders this through the accessible
`#save-status` live region and disables manual Save only during an active save
or load.

## Extension rules

1. Add a domain version and pure capture/validation logic before adding restore
   mutations.
2. Persist stable authored/content IDs, never Three.js UUIDs or array offsets
   as the primary identity.
3. Add a sequential envelope migration when changing `schemaVersion`; never
   branch restore code on arbitrary historical shapes.
4. Validate cross-domain and live-content references before applying any
   owner.
5. Keep storage transactions in the repository and gameplay ownership in the
   domain adapter. UI may observe status but may not write save documents.
6. Add fixtures for current, prior, future, corrupt, interrupted-write, and
   recovery behavior with every persisted schema change.
