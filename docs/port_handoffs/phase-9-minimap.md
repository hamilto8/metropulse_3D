# Phase 9 minimap slice

This slice adds the gameplay minimap and its pure projection contract. Audio,
effects, and final manual evidence remain before the complete Phase 9 exit gate.

## Scene and ownership map

```text
PlayerInterface/SafeArea/Chrome/Minimap
  Layout/MapCanvas
  Text-and-shape legend
```

`MinimapHud` reads the immutable road graph, moving and parked traffic,
pedestrian population, controlled player target, traffic congestion, active
mission route, actionable service work orders, and enforcement response.
`MinimapViewModel` deduplicates and normalizes that data; `MinimapCanvas` only
draws the resulting snapshot.

## Visual vocabulary

- Authored roads are gray, player roads are thicker magenta, and congestion
  uses yellow/orange while retaining road width as a non-color cue.
- Both production water corridors are filled cyan-blue beneath road geometry.
- Player uses a heading triangle; moving vehicles use dots; parked vehicles use
  hollow circles; pedestrians use smaller dots.
- Emergency responders use a square with a white cross.
- Pickup uses an outlined square, checkpoint a diamond, objective a ring, and
  service work an orange filled square.
- Remaining mission route segments use a cyan dash pattern.

The on-screen legend and `AccessibilityDescription` summarize the same
vocabulary without relying on color.

## Correctness filters

- Reverse directed road edges collapse to one rendered segment.
- Coordinates clamp to the canonical `ContentDefinitions.WorldBounds`.
- Only moving response IDs count as Heat responders; parked police can remain
  visible as parked vehicles but never become Heat markers.
- Survival objectives remove route and destination markers, preventing an
  irrelevant destination from appearing.
- Completed route points are excluded; actionable work orders require an
  authoritative position.

## Automated coverage

`MinimapViewModelTests` covers edge deduplication, projection bounds,
congestion, route segments, distinct player/emergency/objective/work icons,
parked responder exclusion, and survival filtering. Live integration verifies
834 production road segments after deduplication, more than 100 live agent and
player icons, shared-chrome ownership, accessible summary text, and state-based
visibility in clean, import, and recovery scenarios.
