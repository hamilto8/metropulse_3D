# Phase 10 Temporary Mayhem handoff

## Scope delivered

Temporary Mayhem is now a debug-selectable, default-off Godot 4.6 feature package. `temporaryMayhem` creates no runtime, scheduler task, UI, mission offer, or save obligation when disabled. When enabled it adds one accessible control, an explicit destructive/sensory-content warning, a deterministic capped comet timeline, and the existing Survival mission to the normal offer set.

The live package holds one open `WorldEditTransaction` for the complete Mayhem run. Each impact transactionally suspends an authored skyline visual and collider, removes its economy record, records a local `BUILDING_DESTROYED` incident, and adds a bounded non-persistent traffic-road closure. Presentation is delegated to the Phase 9 fixed pools and audio owners for comet, explosion, rubble, fire, police-siren captioning, panic announcements, and emergency-news alerts. Nearby targets can enter the same capped path as chain reactions.

Ending Mayhem or shutting down the session rolls the transaction back in strict LIFO order. It restores authored colliders and visibility, economy buildings and reputation, removes the temporary incident records and road closures, releases feature-owned effects, resolves feature alerts, and clears comet/destruction state. A repeated enable/disable cycle returns the same authoritative counts to baseline.

## Ownership and persistence

- `TemporaryMayhemModel` owns only the deterministic active/comet/target/cap timeline.
- `TemporaryMayhemRuntime` owns the feature lifecycle and cross-authority compensation boundary.
- `MvpWorldGenerator`, `EconomyLedger`/`CityEconomyRuntime`, and `TrafficRoadGraph` remain the sole world, economy, and topology authorities.
- `SessionEffectRuntime`, `SessionAudioRuntime`, `AlertService`, and `PlayerInterface` remain presentation/accessibility owners.
- `MissionRuntime` receives the feature scope at construction, so `mission_mayhem_escape` is unavailable when the package is off and available when it is on.
- The browser-compatible `game.mayhemEnabled` field is validated but deliberately does not reactivate Temporary Mayhem during restore. Destruction, road closures, active comets, warning acknowledgement, and feature UI state are never serialized.

Persistent Mayhem and Mayhem variants remain disabled and unimplemented, as required by the Phase 10 safety/persistence boundary.

## Verification

- Domain suite: 398 tests, including deterministic timing, warning enforcement, caps, reset, temporary-road closure restoration, economy incident compensation, and transaction failure behavior.
- Godot build: clean with zero warnings/errors.
- Formatting: `dotnet format ... --verify-no-changes` clean.
- Enabled headless integration: `phase10.temporary-mayhem.passed` and the full 179-assertion integration suite pass with `--features=temporaryMayhem`.
- Enabled integration covers the modal warning, pause freeze, impact authorities, effects/audio/alerts, Survival scope, exact stop baseline, repeated cycle, and save isolation.
- Default-off coverage is provided by the normal clean/import/recovery integration matrix and explicitly asserts that no Temporary Mayhem runtime or UI exists and Survival remains outside active feature scope.

Run the focused enabled scenario with:

```sh
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-phase10-feature.sh temporaryMayhem
```
