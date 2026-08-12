# Phase 9 gameplay UI slice

This slice adds the street/vehicle status and event surfaces. Mission dialogue,
results, pause, and settings are intentionally left to the next modal slice, so
this handoff does not claim the complete Phase 9 exit gate.

## Scene and ownership map

```text
SessionRoot/HUD/PlayerInterface/SafeArea/Chrome/GameplayHud
  TimeWeather             -> environment presentation snapshot
  VehicleSpeedometer      -> controlled vehicle linear velocity and type
  HeatStatus              -> player Heat and enforcement response
  ArrestStatus            -> enforcement outcome and safe-recovery state
  NewsCards               -> committed mission-outcome news
  AlertToasts             -> active city alert snapshot
  MissionHistoryButton
  MissionHistory          -> committed mission receipts, newest first
```

`GameplayHudViewModel` is renderer-independent and immutable. It converts m/s
to km/h for display, preserves the underlying unit in the accessible
description, and projects Heat, responder distance, environment, news, alerts,
and mission receipts without becoming a second gameplay authority.

## Flight telemetry

The flight strip has a tested projection contract for speed, altitude,
throttle, and mode. It remains hidden because the canonical content registry
feature-gates aircraft and the current Godot session has no aircraft control
owner. Enabling the feature later requires supplying authoritative
`FlightTelemetryView` data; no UI redesign or fabricated placeholder values are
required.

## Accessibility and responsive behavior

- Speed, Heat, arrest, news, alerts, and history cards carry explicit names and
  descriptions; arrest recovery uses the assertive shared live region.
- Vehicle and flight surfaces follow `ControlKind` ownership rather than scene
  visibility guesses.
- Mission history returns focus to its invoking button when closed.
- Compact layouts move news to the left safe-area edge; Standard/Wide layouts
  leave the existing mission HUD column unobstructed.

## Automated coverage

`GameplayHudViewModelTests` covers vehicle unit conversion, response counts and
distance, textual Heat tiers, latent aircraft telemetry, arrest text, committed
news, active alert toasts, and mission history. The live integration runner
checks shared scene ownership, Management hiding, Street activation, telemetry
ownership, accessibility metadata, history open/close, and cleanup in clean,
import, and recovery boot scenarios.
