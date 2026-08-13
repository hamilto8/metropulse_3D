# Godot quality profiles

Phase 11 defines three presentation-only quality profiles. `HIGH` is the safe
default when a value is missing or unknown. Native launches may select a tier
with `--quality=HIGH`, `--quality=MEDIUM`, or `--quality=LOW`; the same value can
be paired with the performance-capture command.

| Budget | High | Medium | Low |
|---|---:|---:|---:|
| Directional shadows | on, 500 m | on, 260 m | off |
| Authored MultiMesh shadows | on | off | off |
| Volumetric fog | on | off | off |
| Preference-allowed bloom | on | on | off |
| Rain particle cap | 2,000 | 1,200 | 600 |
| Traffic high/proxy distance | 160 / 400 m | 120 / 300 m | 80 / 220 m |
| Traffic near shadows | on | on | off |
| Pedestrian high/proxy distance | 120 / 320 m | 90 / 240 m | 60 / 180 m |
| Pedestrian near shadows | on | off | off |
| Effect-pool capacity | 100% (48) | 75% rounded up (37) | 50% (24) |
| Spatial one-shot voices | 12 | 8 | 6 |
| Minimap refresh interval | 0.20 s | 0.30 s | 0.40 s |

Quality never changes the 48 moving and 12 parked traffic targets, the 60
citizen target, simulation LOD/cadence, collision or interaction distances,
road/bridge/hazard state, mission targets, input feedback, captions, physics
ticks, save data, or economy rules. A capped effect or audio pool reuses its
oldest presentation slot; authoritative events and accessible captions still
occur.

## Selection and verification

The tier is a release-safe command-line option because it changes presentation
only. Invalid values fail before session construction. The current Settings UI
does not yet persist a tier; integrating this policy into stored settings is a
separate UX decision because automatic hardware selection and player overrides
need an explicit precedence contract.

Use the native matrix command with the quality tier as its fourth argument:

```bash
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot \
  ./godot/scripts/capture-performance.sh \
  "$PWD/godot/artifacts/performance/native-low-debug.json" 20 5 LOW
```

Every tier must pass the same gameplay integration assertions. Phase 11's first
low-tier wiring audit passed all 179 clean-session assertions with the exact
traffic, pedestrian, physics, mission, accessibility, and cleanup contracts
retained. Windows and Linux host behavior remains unverified.
