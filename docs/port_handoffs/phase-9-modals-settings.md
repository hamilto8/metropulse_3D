# Phase 9 mission and settings modal slice

This slice completes the mission/dialogue/result, pause, and settings surfaces.
It remains an intermediate Phase 9 handoff; minimap, audio, effects, and final
manual evidence still follow.

## Scene and ownership map

```text
PlayerInterface/SafeArea/Chrome/MissionPresentation
  PrimaryInteractionPrompt
  MissionHud

PlayerInterface/ModalLayer
  MissionDialogue
  MissionResult
  SessionModals
    PauseMenu
    SettingsPanel
```

Mission execution and results remain owned by `MissionRuntime`. Dialogue and
result panels are attached to the shared modal layer while the interaction and
objective HUD remain in non-modal chrome. Pause uses `PauseManager` holds and
therefore resumes the exact source state. Settings writes go only through the
validated, persistent `SettingsStore`.

## Complete settings surface

`SettingsUiCatalog` declares one ordered control for every leaf of
`SettingsPreferences`:

- Controls: pointer and three camera sensitivities, hold/toggle behavior, and
  three driving assists.
- Audio: master, music, effects, ambience, and dialogue.
- Accessibility: subtitles, speaker labels, closed captions, text scale,
  contrast, color-safe patterns, reduced motion, camera shake, flash, and bloom.
- Gameplay: difficulty and mission timer leniency.

There are 27 controls. `SettingsUiCatalogTests` recursively compares the
catalog paths with the serialized settings schema, so a future preference leaf
cannot silently ship without a settings control.

## Focus and announcements

- Dialogue choices wrap inside the dialogue panel and announce speaker/text.
- Result actions wrap horizontally, default to Retry when allowed, otherwise
  Return to Management, and announce the committed result assertively.
- Pause defaults to Resume. Settings Back returns to the Settings invoker; the
  pause hold is released only when the pause menu itself closes.
- Every setting control has an explicit accessible label and description.

## Responsive behavior and coverage

Mission, dialogue, result, pause, and settings widths use the shared modal
maximum. Settings scrolls within the safe vertical bound at the minimum desktop
height and large text scales.

The live integration runner checks modal-layer ownership, all 27 settings
controls, pause/resume state preservation, pause-to-settings replacement,
immediate responsive text-scale propagation, settings-to-pause restoration,
and hold cleanup in clean, import, and recovery scenarios. Existing Phase 8
mission integration continues to exercise authored dialogue, result, retry,
continue, and restored-result paths after the presentation move.
