# Pause and Modal Behavior

This document is the operational contract for Phase 1, P1.4. It complements
`GAME_STATE_MACHINE.md` and `SIMULATION_SCHEDULER.md`; those documents remain
authoritative for state transitions and clock policy.

## Ownership

- `GameManager` owns the canonical `PAUSED` state and exact `resumeState`.
- `SimulationScheduler` owns whether gameplay, fixed physics, and city logical
  time advance. There is no feature-local gameplay pause flag or time scale.
- `PauseManager` owns pause intent. It converts the first pause hold into a
  coordinated transition to `PAUSED` and restores the exact source state only
  after the final hold is released.
- `PauseMenu` owns pause-menu DOM, focus trapping, visible focus, and keyboard
  dismissal. It never changes game state directly.
- `DialogueOverlay` owns one `DIALOGUE` pause hold for its visible lifetime.
- `InputManager` owns transient keyboard/gamepad state, held-input quarantine,
  device switching, modal gamepad navigation, and world combat clicks.

## Nested modal rule

Pause is reference-held rather than boolean-toggled. Dialogue and the pause
menu may both hold the same canonical pause:

1. Opening dialogue acquires a `DIALOGUE` hold and enters `PAUSED`.
2. Opening the pause menu over dialogue acquires a `MENU` hold without a second
   state transition.
3. Closing the menu removes only its hold; dialogue remains visible and the
   session remains paused.
4. Closing dialogue removes the final hold and resumes the exact state that was
   active before dialogue opened.

Stale releases are idempotent. A failed resume restores its hold so the
session cannot become a paused state with no owner or recovery action.

## Clock behavior

While `PAUSED`:

- mission countdowns and cooldowns stop;
- pedestrian Heat, wanted escape, AI decisions, and combat simulation stop;
- vehicle/character physics authority and fixed steps stop;
- dynamic weather, wet-surface, lightning, and thunder clocks stop;
- city logical time and economy updates stop;
- Mayhem effects, countdowns, and gameplay-derived presentation values stop;
- UI, accessibility navigation, camera presentation, diagnostics, minimap,
  frame metrics, and rendering remain responsive.

World presentation tasks that consume gameplay time are explicitly gated.
The pause menu animation uses CSS/UI time and honors `prefers-reduced-motion`.
World audio is ducked while paused and restored by the coordinated transition.

## Input quarantine

Transient input is cleared at pause/resume transition boundaries, on focus or
visibility loss, and when the active input interface changes.

- Keyboard actions that were held at a boundary are ignored until their
  matching key-up event.
- Gamepad actions and axes are ignored until the controller returns to neutral.
- Transition input suspension is token-based, so nested transition cleanup
  cannot resume an unrelated suspension.
- During pause, only modal navigation, confirm, back, and pause-menu actions
  are sampled. Gameplay keyboard, analog, and world-click combat actions are
  rejected.

This prevents a held throttle, steering axis, handbrake, attack, or placement
action from leaking into the first resumed gameplay frame.

## Player-facing controls

- Keyboard: `Escape` opens or closes the pause menu. Inside dialogue it closes
  the dialogue modal and releases that modal's pause hold.
- Gamepad: Menu opens/closes the pause menu; B dismisses the active modal; A
  activates the focused control; D-pad navigates.
- Pause-menu focus is trapped within the modal and restored to the prior
  control or gameplay surface when the menu closes.

The P1.4 pause menu intentionally exposes Resume and its input help. Settings,
retry/restart, save/exit, and new-game actions depend on the Phase 2 settings,
save, boot, and recovery services and remain tracked under `UX-010`.

## Verification

- `test/PauseManager.test.js` covers all pausable states, exact resume policy,
  nested holds, rapid toggles, stale releases, invalid source states, and
  Mayhem preservation.
- `test/InputManager.test.js` covers focus loss, held-state clearing, device
  changes, gamepad neutral quarantine, pause routing, and modal priority.
- `test/SimulationScheduler.test.js` covers clock isolation, same-frame pause
  gating, fixed/city accumulator behavior, and the production schedule.
- `test/browser/smoke.spec.js` covers real DOM/keyboard pause flows during
  management, builder placement, walking, driving, combat, dialogue, mission
  result, active mission/Heat/weather clocks, and Mayhem.
