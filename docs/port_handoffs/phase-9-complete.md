# Phase 9 completion handoff

Phase 9 is complete in eight independently verified slices on
`codex/godot_port`:

1. `9aa3078` — shared theme, responsive layout, and accessibility foundation.
2. `3e58458` — management, City Tools, builder, inspector, and control ribbon.
3. `c4cb7f4` — street/vehicle HUD, arrest, news, alerts, and mission history.
4. `2ddc2b1` — mission, result, pause, and complete settings surfaces.
5. `0dd6159` — data-driven minimap and marker filtering.
6. `b63f3e3` — audio buses, cached procedural sources, voice policy, and captions.
7. `bd93870` — fixed effect pools, weather reuse, and accessible reductions.
8. `Complete Phase 9 exit gate` — live settings consumers, modal containment,
   complete control audit, deterministic visual evidence, and this handoff.

The frozen browser source revision remains
`44a286a74557adfe4fabd3a6e16b9006079eba32`. The target remains Godot 4.6
stable .NET `89cea1439`, Jolt, and the canonical 120 Hz scheduler.

## Scene and view-model map

```text
Main
├─ BootLayer/BootStatusPresenter       <- BootPresentationModel
└─ SessionRoot/HUD/PlayerInterface
   ├─ SafeArea/Chrome
   │  ├─ ManagementHud                <- ManagementUiViewModel
   │  │  ├─ TopCityBar
   │  │  ├─ CityToolsPanel
   │  │  ├─ BuilderPanel
   │  │  └─ ControlRibbon
   │  ├─ GameplayHud                  <- GameplayHudViewModel
   │  ├─ MinimapHud/MinimapCanvas     <- MinimapViewModel
   │  └─ MissionPresentation          <- Phase 8 mission snapshots
   ├─ ModalLayer
   │  ├─ ModalScrim
   │  ├─ SessionModalController
   │  │  ├─ PauseMenu
   │  │  └─ SettingsPanel             <- SettingsUiCatalog
   │  ├─ MissionDialogue
   │  └─ MissionResult
   └─ LiveAnnouncements               <- polite/assertive AccessKit region
```

All controls are projections or command adapters. Economy, services, traffic,
construction, missions, results, settings, player state, input context, roads,
and environment state remain owned by their existing authorities.

## Theme and responsive contract

`UiThemeTokens` owns the Standard, High Contrast, and Dark palettes. The
standard dark-glass palette uses background `#07101B`, glass `#132536E8`,
strong glass `#193247F5`, text `#F4FAFF`, muted text `#AAC0D0`, cyan
`#42E8E0`, amber `#FFC857`, success `#6BE6A8`, danger `#FF6B7A`, focus
`#F6E05E`, and outline `#3B6A82`. Focus is a three-pixel ring; controls have a
42-pixel base height and ten-pixel base radius. Automated ratios require at
least 7:1 primary text/background, 4.5:1 muted text/background, and 3:1
focus/background.

Godot uses native responsive window sizing rather than a fixed canvas stretch.
Containers measure their real minimum height before the management and builder
panels are placed. Text scale participates in breakpoint selection.

| Viewport | Text scale | Effective breakpoint | Evidence/result |
| --- | ---: | --- | --- |
| 1024×576 | 1.5 | Compact | stacked stats, bounded scrollable tools, two-row ribbon |
| 1280×720 | 1.0 | Standard | management, modal, dialogue, and result captures |
| 1920×800 | 0.8 | Wide | street HUD and minimap capture |
| 1920×1080 | 1.5 | Standard | builder catalog/inspector capture without overlap |
| 1920×1200 | 1.5 | Standard | pure layout acceptance test |
| 2560×1080 | 1.5 | Standard | ultrawide pure layout acceptance test |

The supported floor is 1024×576 and the supported text range is 0.8–1.5.

## Focus and accessibility results

- All 78 live interactive controls are mouse-operable, use `FocusMode.All`,
  carry non-empty AccessKit names/descriptions, and have explicit previous/next
  focus neighbors.
- Dialogue, result, pause, settings, history, builder, City Tools, and speed
  controls have contained logical focus graphs. Closing a child surface restores
  its invoker or the documented default.
- One shared modal scrim consumes background pointer input while pause,
  dialogue, or result ownership is active. The canonical pause hold still owns
  simulation suspension and exact-state resume.
- The polite/assertive live region publishes actions, errors, mission speech,
  results, arrests, audio captions, and effect captions.
- Status never relies on color alone: minimap and gameplay states use text,
  width, line pattern, and distinct shapes; the color-safe preference is
  projected live.
- Project accessibility remains `Auto`, allowing Godot 4.6 AccessKit to activate
  with a detected native screen reader.

The macOS headless runner cannot truthfully execute NVDA, interactive VoiceOver,
or Orca. Their Windows/macOS/Linux host smoke matrix is retained as Phase 11
release validation, consistent with the port plan's platform-matrix boundary.
This is a host-signoff item, not an unimplemented Phase 9 control contract.

## Live settings map

| Preference | Runtime consumer |
| --- | --- |
| pointer + orbit/on-foot/vehicle sensitivity | `GameplayCameraRig`, multiplicative and bounded |
| sprint/braking hold or toggle | `RuntimeInputHost`, press-edge keyboard/controller model |
| repeated actions hold or toggle | shared preference projection, matching the browser's latent MVP hook |
| steering assist | player-vehicle input response curve |
| automatic recovery | player-vehicle unsafe/stuck recovery gate |
| braking assist | player-vehicle brake force ×1.25 |
| five audio categories | named audio buses, applied immediately |
| subtitles, speaker labels, captions | dialogue labels/announcements and caption publisher |
| text scale and contrast | shared layout and theme rebuilt immediately |
| color-safe patterns | shared presentation/accessibility policy |
| reduced motion, shake, flash, bloom | camera, weather, and pooled-effect owners |
| timer leniency | mission execution time-limit construction |
| difficulty | live gameplay preference projection, matching the browser's MVP presentation hook |

Every one of the 27 serialized preference leaves has exactly one settings
control; the catalog/schema equality test fails if either side gains a leaf.

## Audio layout and caption events

```text
Master                 <- audio.master
├─ Music               <- audio.music
├─ Effects             <- audio.effects
│  ├─ Vehicle
│  ├─ Emergency
│  └─ UI
├─ Ambience            <- audio.ambience
└─ Dialogue            <- audio.dialogue
```

Saved linear gain converts with `20 * log10(linear)` and clamps at −80 dB.
Zero mutes while retaining the last audible dB; raising the value restores the
exact computed gain. The procedural cache owns 13 current streams at 22.05 kHz
mono. The voice budget is 64, allocated by priority, listener distance, and
stable ID; effects use 12 reusable spatial one-shot players.

Closed-caption events are `[city music]`, `[city ambience]`, `[rain falling]`,
`[engine revving]`, `[vehicle impact]`, `[vehicle horn]`,
`[police siren approaching]`, `[thunder]`, `[explosion]`,
`[fire crackling]`, `[rubble falling]`, `[comet streaks overhead]`, and
`[confirmation tone]`. Live exit scenarios observe 17 publications because
some source events repeat during the exercised flow.

## Effect budget and authority boundary

| Pool | Roots | Lifetime | Cap behavior |
| --- | ---: | ---: | --- |
| Explosion | 8 | 1.1 s | reuse oldest transient lease |
| Fire | 12 | persistent by stable source | deduplicate/release keyed lease |
| Rubble | 24 | 12 s | reuse oldest transient lease |
| Comet | 4 | 3.5 s | reuse oldest; suppress under reduced motion |

All 48 roots are allocated once. They contain no collision objects and cannot
mutate the road graph or economy. The live audit activates every family,
verifies unchanged authoritative revisions, returns transient/persistent
fixtures to baseline, retains one reusable rain emitter, and applies reduced
motion, shake, flash, and bloom policy. Collision unregister/restore, road
restoration, and incident resolution remain with the Phase 7 authorities; the
presentation layer does not duplicate them.

## Visual evidence

`godot/scripts/capture-phase9-screenshots.sh` deterministically regenerates the
ten reviewed PNGs in `docs/port_evidence/phase9/screenshots`:

- management at day/clear, dusk/rain, and night/thunderstorm;
- management Compact at 1024×576 and 1.5 text scale;
- builder at 1920×1080 and 1.5 text scale;
- street at 1920×800 and 0.8 text scale;
- pause, complete settings, authored dialogue, and committed result.

The visual review confirmed bounded panels, readable top/ribbon separation,
scroll access at large text, visible focus, modal dimming/input containment,
and correct mode ownership. `exit-audit.json` is the machine-readable index.

## Verification

```text
dotnet test godot/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj --no-restore
dotnet build godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore
dotnet format godot/MetroPulse.Godot/MetroPulse.Godot.sln --no-restore --verify-no-changes
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-integration.sh
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/capture-phase9-screenshots.sh
```

The final pure C# suite passes 389/389. The solution builds with zero warnings
or errors and format verification reports no changes. Clean, confirmed-import,
and recovery live scenarios publish `phase9.settings_accessibility.passed` and
`phase9.effects.passed`; they report 179/179/183 assertions respectively.
Invalid imports continue to fail under their expected boot codes.

## Unresolved UX differences and deferred gates

- Native screen-reader interaction on NVDA, VoiceOver, and Orca is a Phase 11
  host-matrix signoff item because those three OS environments are not present
  in this workspace.
- Aircraft flight instruments and propeller priority remain latent/gated with
  the aircraft package in Phase 10; Phase 9 supplies the tested HUD/audio hooks.
- Full temporary-Mayhem collision, destruction, restoration, and incident
  behavior remains independently gated in Phase 10. Phase 9 includes only the
  bounded comet presentation contract used by its authorized test mode.
- Godot native font shaping and widget metrics are intentionally not
  pixel-identical to browser CSS. Information hierarchy, focus, commands,
  settings, and accessibility semantics are the parity contract.

Phase 10 may activate aircraft and temporary Mayhem through the existing latent
HUD, audio, and effect hooks. It must not bypass the Phase 9 theme, focus,
caption, setting, pooling, modal, or authority boundaries.
