# MetroPulse Boot and Load Flow

> **Status:** P2.1 implementation contract  
> **Authority:** `METROPULSE_3D_COMPLETION_ROADMAP.md`, Phase 2  
> **Session owner:** `GameManager`  
> **Pipeline owner:** `BootPipeline`

## Player-facing contract

MetroPulse begins on a noninteractive boot screen. The game HUD is inert and
hidden from assistive technology until the selected session passes its final
runtime readiness gate. The player sees progress while checks run and is then
offered only valid actions:

| Action | Availability | Behavior |
|---|---|---|
| `New Game` | All compatible, validated profiles | Preserves a valid current save as the recovery slot, clears the active legacy slot, and starts a clean session. |
| `Continue` | A structurally valid current legacy v1 save exists | Restores the current save before entering Management. |
| `Recover Previous Save` | A structurally valid recovery legacy v1 save exists | Promotes the known-good recovery data into the current slot, then restores it. |

Corrupt save data does not block a new game or a valid recovery. It disables
only the unsafe action and explains why Continue is unavailable.

## Authoritative state sequence

`GameManager` exists before runtime services and remains the sole session-state
owner throughout startup:

```text
BOOT -> LOAD -> MENU -> LOAD -> MANAGEMENT
        checks   choice   runtime ready
```

The renderer-free `BOOT`, `LOAD`, and pre-runtime `MENU` handoffs use
`GameManager` directly because `TransitionCoordinator` cannot exist before the
world and input runtime. After runtime composition, all state changes—including
the final `LOAD` to `MANAGEMENT` handoff—use `TransitionCoordinator`.

`body[data-app-state]` is presentation/test diagnostics only. It is not a
second game-state owner.

## Pipeline stages

The stages run in a fixed order and fail closed. A failed stage prevents all
later stages and prevents runtime construction.

1. **Capabilities** — verifies a real hardware WebGL 2 context, a writable
   LocalStorage round trip, and a transactional IndexedDB write.
2. **City data** — validates mission content, stable IDs, supported objectives,
   coordinates, dialogue references, and objective-specific requirements.
3. **Player settings** — loads the complete P2.3 versioned settings and bindings
   store, migrates the P2.1 schema, and safely falls back to defaults when local
   data is corrupt.
4. **Save discovery** — parses current and recovery legacy v1 save envelopes
   without applying either to live systems.
5. **Core assets** — decodes the required boot visual and waits for fonts when
   available. System-font fallback keeps external font failure noncritical.

Every stage is renderer-independent except the browser capability probe and
asset decoder. Stage results are immutable snapshots passed to subsequent
stages.

## Compatibility failures

WebGL 2, LocalStorage, and IndexedDB are required. If any is missing, the boot
screen keeps the game inert and displays capability-specific remediation:

- enable hardware acceleration or update the browser/graphics driver;
- allow local site data and leave restrictive private browsing;
- allow persistent IndexedDB storage.

The player may rerun the checks without world construction. A failure after
runtime construction begins requires a reload because partially created WebGL,
physics, and event resources are not safe to reuse.

## Final readiness gate

`MetroPulseApp.assertReady()` must pass before the boot screen releases focus
and removes `inert` from the game. It requires:

- a renderer-backed world and built city;
- the canonical input owner;
- persistence and mission services;
- the simulation scheduler;
- transition coordinator and runtime;
- authoritative `MANAGEMENT` state.

Save restore happens before this gate. A save that passed discovery but fails
domain restoration never reaches interactive gameplay.

## Compatibility boundary with P2.2 and P2.3

P2.1 deliberately did not introduce a competing save or settings authority.
The legacy save reader is now a one-time migration source for P2.2, and the
bootstrap settings reader is the complete settings document and bindings store
introduced by P2.3. The boot pipeline and UI action contract remain stable.

## Verification

- `test/BootFlow.test.js` covers stage ordering, fail-closed behavior,
  capability round trips, settings fallback, save eligibility, safe New Game,
  and recovery promotion.
- `test/browser/smoke.spec.js` verifies the real WebGL boot screen stays inert,
  releases only after New Game readiness, blocks a missing capability with
  actionable guidance, and exposes Continue/Recover only for valid slots.
- The original deterministic transition, interaction, and pause acceptance
  flow runs after the new boot gate to guard against startup regressions.
- Current regression evidence: 306 Node tests, the production build, and four
  Chrome WebGL boot/transition/pause/interaction/save/settings flows pass.
