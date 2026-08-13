# Phase 11 soak automation handoff

Chunk ID and status: `phase-11-soak-automation`; complete for automatable soak
coverage, with the two-hour interactive playtest explicitly deferred.

Source revision / Godot revision: branch base `7121659` plus this slice; frozen
browser source `44a286a74557adfe4fabd3a6e16b9006079eba32`; Godot 4.6 stable
.NET `89cea1439`.

Objective and explicit non-goals: Consolidate the Phase 11 leak/resource stress
gate, increase world-edit stress to the specified counts, and expose long-run
resource growth. This does not represent a two-hour human playtest, Windows or
Linux host coverage, or a release signoff.

Behavior and tests:

- `Phase6LivingCitySoakTests` advances 1,800 simulated seconds in 18,000 steps
  with exact 48/12 traffic and 60 citizen floors, LOD regions, handoffs,
  knockdowns, enforcement, bridge traversal, turns, and finite state;
- `Phase7ManagementSoakTests` now performs 100 successful place/move/rotate/
  demolish plus incident cleanup/repair cycles, preserving exact treasury and
  zero runtime residue;
- a new 100-cycle late-persistence failure soak forces maximum-depth world-edit
  compensation and proves empty coordinator/visual/collider/road/occupancy/
  zoning/service/persistence stores, empty economy buildings, exact treasury,
  and zero rollback errors after every failure;
- the existing live engine gate performs 50 Management/on-foot/vehicle/on-foot
  cycles and 10 active/result mission session reloads, while the standard
  integration script repeats clean/import/recovery and rejected preview/
  corrupt/future save paths;
- native performance reports now include signed static/managed/video/object/
  resource/node/orphan growth from the post-warmup baseline;
- `test-phase11-soaks.sh` is the aggregate automated command and
  `run-management-soak.sh` is a bounded 30-minute-by-default native observer.

Exact verification:

```text
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/test-phase11-soaks.sh
```

The focused domain soak/transaction families pass, followed by the full Godot
clean/import/recovery matrix and expected import failures. The normal engine run
publishes `integration.passed` with 179 assertions. No raw user data enters the
reports. Existing Godot shutdown logs can still emit the already-known generic
`ObjectDB instances leaked at exit` warning even when the explicit session,
node, collider, resource-cache, subscription, task, and owner baselines pass;
Phase 11 should eliminate or formally classify that engine-level warning before
release freeze.

Manual/deferred work: The two-hour representative interactive soak requires
active play across Management, Builder, on foot, driving, and a mission; it was
not realistically runnable as an unattended coding-session check. Windows and
Linux exported-host soaks are also deferred to their actual platform matrix.

Next safe task: Complete migration/release packaging automation and signed
artifact metadata, then run the final feasible macOS release-candidate audit.
