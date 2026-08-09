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

### Godot repository adapter

The native port stores gameplay saves under `user://saves/` through
`GodotGameSaveRepository`. It owns four explicit paths:

- `current.json` — selected by Continue;
- `recovery.json` — the prior validated current document;
- `transaction.tmp` — a validated candidate for current promotion; and
- `recovery.tmp` — an isolated candidate for recovery-only replacement.

The repository requires an `IGameSaveDocumentValidator`; it cannot write an
unvalidated string. Each candidate is normalized before write, flushed and
closed, reread through the same validator, and promoted with a same-directory
replacement. A valid current is copied to recovery before current promotion.
A corrupt current is never allowed to overwrite known-good recovery.

An ordinary caught failure rolls current and recovery back exactly. If a
process stops after recovery rotation, the next repository read recognizes the
validated current/recovery/temp relationship and completes promotion. If it
stops before rotation, the old current remains authoritative and the orphaned
candidate is discarded. A recovery-only temporary file is always aborted on
restart, so it cannot be mistaken for a current save. These are compound
crash-repair guarantees built from atomic same-volume file replacement; the OS
does not provide one transaction spanning both slot names.

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

### Godot envelope and discovery authority

`GameSaveDocumentValidator` is the native envelope authority. It preserves
format `METROPULSE_3D_SAVE`, schema version 2, feature version 2, metadata, and
the complete domain object. Schema 0 and 1 documents migrate sequentially to
schema 2; the schema-1 step canonicalizes legacy zone aliases and records
`P4.1_ZONE_VOCABULARY` in migration history. It rejects future schema or feature
versions, malformed domain shapes, unknown content IDs, invalid settings or
bindings, inconsistent mission data, controlled-entity mismatches, and invalid
structured alerts before returning normalized JSON.

`GameSaveDiscovery` inspects current and recovery independently. New Game is
always available, Continue is offered only for a valid current slot, and
Recover only for a valid recovery slot. Preparing New Game preserves a valid
current as recovery; preparing Recover promotes recovery without rotating a
possibly corrupt current. The native boot pipeline runs discovery before
session construction and retains the selected validated document during save
application. Static domain and runtime world/entity application are separate
later steps; retaining a descriptor is not reported as a completed restore.

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

The native `GameSaveService` preserves the same five-second coalescing policy
without owning a worker timer. Its session host supplies elapsed runtime through
`Advance`, which keeps capture and repository calls on the owning thread and
prevents offline/background catch-up. Checkpoints save immediately, reason IDs
are deduplicated in deterministic order, mission-critical phases can veto a
save, and listener failures cannot corrupt status or committed slots. Native UI
and session capture owners are still responsible for subscribing and supplying
the complete domain snapshot.

## Browser export and native import

The browser sidebar's **Export City Save** action reads exactly one selected
IndexedDB slot, validates the envelope and all domains without mutating live
owners, and downloads UTF-8 JSON named from the stable save ID. Corrupt,
unsupported, or absent selected slots do not download anything and do not touch
current or recovery.

Godot accepts `--import-save=<absolute-path>` as its initial native import path.
Without `--confirm-import`, boot stops at save discovery with error code
`IMPORT_CONFIRMATION_REQUIRED` and a preview containing save time, state, user
building/zone counts, active mission, and controlled entity. Confirmation must
be explicit through `--confirm-import`. A confirmed import:

1. strictly decodes and validates the selected UTF-8 bytes;
2. retains the exact original bytes under `user://import-backups/`;
3. runs the same sequential envelope migrations and whole-document validator;
4. commits normalized JSON to current through the rotating repository; and
5. enters Continue with static owners applied and runtime owners still deferred.

Validation or confirmation failures write neither backup nor save slot. A
repository failure may leave the import backup for diagnosis, but current and
recovery retain their exact pre-import values.

## Native split restore

`GameSaveRestoreCoordinator` separates static owner mutation from runtime
world/entity application. Every static participant prepares against a cloned,
fully validated aggregate before any participant applies. If an apply fails,
already-applied participants roll back in reverse order and no runtime
descriptor is published. The Phase 3 shell applies only global settings and
binding overrides because those are the only constructed static authorities;
economy, time/weather, mission, faction, progression, and mobility records are
named as deferred static data. Game state, world edits, controlled player,
mission runtime, Heat, and alerts remain an immutable pending runtime descriptor.
An adapter failure retains that descriptor for retry and never masquerades as a
completed restore.

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
