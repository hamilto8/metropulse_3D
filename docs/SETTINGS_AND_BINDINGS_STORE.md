# Settings and Bindings Store

> **Authority:** `METROPULSE_3D_COMPLETION_ROADMAP.md`, P2.3  
> **Implemented:** 2026-07-18

## Ownership

`SettingsStore` is the single renderer-independent owner of player preferences
and keyboard/mouse binding overrides. DOM, Three.js, audio, input, and save
modules consume snapshots or events; none of them owns a second settings copy.

The persisted document is deliberately small plain data:

```text
{
  version: 2,
  settings: { ...validated preference groups },
  bindings: { [context]: { [action]: [inputCode, ...] } }
}
```

It is stored under `metropulse3d:settings:v1`. The key remains stable while the
document's independent `version` drives schema migration. The original P2.1
`{ version: 1, reducedMotion, textScale }` payload migrates to version 2 on
load. Unsupported future versions and invalid documents fall back to defaults
with a boot warning; they are never partially applied.

## Preference contract

`SettingsSchema` owns defaults and validation for:

- mouse sensitivity and separate orbit, on-foot, and vehicle camera sensitivity;
- master, music, effects, ambience, and dialogue audio channels;
- subtitles, speaker labels, and non-dialogue sound captions;
- text scale, standard/high/dark contrast, and color-safe patterns;
- system/reduced/full motion, camera shake, flashes, and bloom;
- hold/toggle choices for sprint, braking, and repeated actions;
- steering mode, automatic vehicle recovery, and braking assist;
- relaxed/standard/expert action difficulty and mission timer leniency.

Every mutation creates and validates a complete candidate document before the
single LocalStorage write. Storage failure leaves the live snapshot unchanged.
Subscribers receive immutable previous/current snapshots after commit, and one
bad subscriber cannot interrupt another.

## Binding model

Bindings are contextual: the same key may serve different actions in Management,
Builder, Vehicle, Aircraft, Pedestrian, Dialogue, and Pause. A duplicate within
one context is rejected, except the deliberate Management left-click distinction
between selection and orbit drag.

The schema also rejects:

- unknown contexts or actions;
- empty, duplicate, or malformed input lists;
- browser-reserved `F1`, `F3`, `F5`, `F6`, `F7`, `F10`, `F11`, and `F12` bindings;
- keyboard inputs for mouse-only select/place/attack/camera actions;
- mouse inputs for keyboard actions;
- changes to the fixed analog pointer-movement source.

Directional action arrays have stable slot semantics. For example, the
Pedestrian `MOVE` slots are forward, back, left, right, followed by their arrow
alternatives. Rebinding one slot preserves the other directions. Reset may
target one context, all bindings, or the entire settings document.

Gamepad bindings are fixed for the MVP. They still use the same context catalog,
adaptive controls, interaction route, pause quarantine, and prompt rendering;
keyboard/mouse remapping never mutates controller state.

## Runtime application

`SettingsRuntime` applies committed snapshots immediately. It owns DOM theme
attributes/text scale, audio preference handoff, camera rotation speed, bloom,
and prompt refresh. Domain consumers read the store for values that matter at
the moment of action: mission timer leniency, lightning flash strength, camera
shake, pointer sensitivity, and automatic vehicle recovery.

`InputManager` reads binding slots for both discrete and continuous actions. On
any settings/binding event it clears and quarantines held inputs before updating
prompts. This prevents a remapped key from leaving throttle, braking, movement,
or an action latched under the old mapping.

The pause settings UI is a presenter over the store. It never validates or
persists independently. Failed capture shows the store's conflict reason and
retains the last valid binding.

## Save integration

Settings are global browser preferences, but P2.2 save envelopes also retain a
snapshot for complete session recovery. `SaveGameState` captures values and
overrides directly from `SettingsStore`. Restore combines the two save fields,
validates/migrates them through `SettingsSchema`, then asks the store to replace
its document. Legacy P2.2 saves containing only the old bootstrap preferences
remain supported.

## Extension rules

To add a preference:

1. Add its default and validator to `SettingsSchema`.
2. Add one settings UI field if it is player-facing.
3. Connect a live consumer through `SettingsRuntime` or a direct read at the
   domain decision point.
4. Add validation, immediate-application, persistence, and reload tests.

To add an action:

1. Add its presentation record and context membership in `ControlBindings`.
2. Add complete default keyboard/mouse slots and fixed gamepad tokens.
3. Consume it through `InputManager` or its mouse-binding helper.
4. Add context-conflict, prompt, action, reset, and reload coverage.

Do not add raw key comparisons or static prompt labels in feature code.

## Verification

- `test/SettingsStore.test.js` covers migration, validation, immutability,
  atomic persistence, subscriptions, conflicts, reserved/device checks, reset
  scopes, directional remapping, and live runtime application.
- `test/InputManager.test.js`, `test/BootFlow.test.js`, and
  `test/PersistenceSystem.test.js` cover compatibility seams.
- `test/browser/smoke.spec.js` performs a real pause-menu edit, rejects a
  conflicting binding, proves the old key no longer acts and the new key does,
  checks prompt/text-scale updates, and verifies reload persistence in Chrome
  WebGL.
