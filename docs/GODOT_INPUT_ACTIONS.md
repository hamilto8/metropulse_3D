# Godot InputMap and Settings Adapter Contract

## Ownership and persistence

`SettingsStore` remains the sole validated authority for the version-2 preference and contextual binding document. `GodotSettingsStorage` maps its one stable storage key to `user://settings-v2.json`; integration runs use a process-isolated file under `user://integration/`. A write validates the full JSON, writes and flushes `<current>.tmp`, validates that closed temporary file again, and promotes it with a same-directory replace. A failed write removes the temporary file and does not mutate the live `SettingsStore` snapshot.

`GodotInputMapAdapter` observes committed `SettingsStore` events. It owns only actions beginning with `metropulse_`, clears held engine action state by replacing that complete owned set, and never changes the settings document. Disposing the adapter unsubscribes it and removes its InputMap actions.

## Action names

Every contextual action has one aggregate InputMap name:

```text
metropulse_<lowercase-context>_<lowercase-action>
```

Every keyboard/mouse binding slot also has a stable independently queryable name:

```text
metropulse_<lowercase-context>_<lowercase-action>_slot_<zero-based-index>
```

The 45 aggregate actions are:

| Context | Aggregate action suffixes |
|---|---|
| Management | `orbit`, `pan`, `select`, `navigate`, `build`, `mode`, `pause_menu` |
| Builder | `aim`, `place`, `rotate`, `delete`, `navigate`, `back` |
| Vehicle | `drive`, `throttle`, `brake`, `interact`, `handbrake`, `vehicle_reset`, `camera`, `horn`, `mode`, `pause_menu` |
| Aircraft | `air_roll`, `air_pitch`, `air_throttle`, `air_brake`, `camera`, `interact`, `air_reset`, `pause_menu` |
| Pedestrian | `move`, `sprint`, `jump`, `interact`, `attack`, `camera`, `mode`, `pause_menu` |
| Dialogue | `navigate`, `confirm`, `back` |
| Pause | `navigate`, `confirm`, `back` |

The default document has 66 stable slot actions, for 111 owned InputMap actions total. Validated overrides may use one to eight slots, retaining the same zero-based naming rule. Slot order is the domain catalog order. Directional groups preserve their browser semantics: forward/back/left/right followed by alternate directions where declared; aircraft roll is left/right, pitch is up/down, and throttle is increase/decrease. `PointerMove` receives an action and slot identity but no false button event because Godot treats mouse motion as raw analog input.

## Input projection

Keyboard bindings use physical keycodes to preserve browser `KeyboardEvent.code` behavior across layouts. Left/right modifier locations are retained. Mouse inputs map to left, middle, and right buttons. The unchanged browser-reserved list remains rejected by the domain validator; no desktop-only key reservation has been introduced.

Standard gamepad events are fixed and are added only to aggregate actions. They preserve the browser contract: A/B/X/Y face-button roles, View/Menu, bumpers, stick clicks, D-pad navigation, left-stick movement, right-stick camera, and left/right triggers for braking/throttle. Analog actions use the browser dead zone of `0.15`. Gamepad remapping remains outside MVP scope.

The later runtime input-state owner must sample these actions at the start of `_PhysicsProcess`, clear held/edge state on focus loss and settings/context/device changes, quarantine held devices until neutral, and keep prompt selection separate from gameplay authority.
