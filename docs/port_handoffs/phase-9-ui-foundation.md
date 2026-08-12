# Phase 9 UI foundation slice

This slice establishes the shared player-facing UI contract used by all later
Phase 9 screens. It does not yet claim the Phase 9 exit gate.

## Scene and ownership map

```text
Main/BootLayer
  BootStatusPresenter -> shared theme + responsive action layout + startup focus

SessionRoot/HUD/PlayerInterface
  SafeArea/Chrome      -> non-modal management, builder, and gameplay controls
  ModalLayer           -> pause, settings, dialogue, results, and confirmations
  LiveAnnouncements    -> polite/assertive AccessKit status announcements
```

`SessionShell` creates one `PlayerInterface` after validated settings are
available and before mission presentation is attached. `MissionPresentation`
now inherits the shared theme through `Chrome`; later Phase 9 slices can restyle
or replace its controls without creating a second visual authority.

## Stable contracts

- `UiLayoutModel` owns the Compact, Standard, and Wide desktop breakpoints.
- The supported viewport floor is 1024×576.
- Text scale is supported from 0.8 through 1.5 and participates in breakpoint
  selection rather than being applied after layout.
- `UiThemeTokens` owns Standard, High Contrast, and Dark palettes. Text, muted
  text, and visible-focus tokens have automated contrast checks.
- `MetroPulseThemeFactory` is the single Godot `Theme` construction path. It
  provides dark-glass panels, neon headings/metrics, explicit focus rings, and
  accent/danger button variations.
- `AccessibilityFocusGraph` validates logical order, modal containment, default
  focus, and invoker restoration without depending on Godot.
- `AccessibilityFocus` and `ModalFocusController` project those rules onto live
  `Control` nodes.
- Player controls use `accessibility_name`, `accessibility_description`, and an
  AccessKit live region. Project accessibility support remains Auto so detected
  screen readers enable it without a game-specific toggle.

The engine contracts follow the Godot 4.6 UI, keyboard/controller focus, and
screen-reader guidance:

- <https://docs.godotengine.org/en/4.6/tutorials/ui/>
- <https://docs.godotengine.org/en/4.6/tutorials/ui/gui_navigation.html>
- <https://docs.godotengine.org/en/4.6/tutorials/ui/creating_applications.html#screen-reader-integration>

## Automated coverage

`UiFoundationTests` covers the minimum, 16:9, 16:10, and ultrawide desktop
profiles; the full text-scale range; bounded panels/minimap; palette contrast;
focus wrapping; modal containment; and focus restoration. The live integration
runner checks shared-theme ownership, responsive bounds, the AccessKit live
region, project accessibility settings, and the mission presentation's place in
the shared Control tree.

NVDA, VoiceOver, and Orca remain manual exit-gate checks for the final Phase 9
slice. They cannot be truthfully completed by a headless runner.
