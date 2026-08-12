# Phase 9 management and builder UI slice

This slice supplies the live management and builder surfaces on top of the
shared Phase 9 UI foundation. It is an intermediate handoff and does not claim
the complete Phase 9 exit gate.

## Scene and ownership map

```text
SessionRoot/HUD/PlayerInterface/SafeArea/Chrome/ManagementHud
  TopCityBar       -> seven city metrics, priority alert, mode and device
  CityTools        -> economy, services, traffic, zoning, construction,
                      atmosphere, overlay, and simulation accordions
  BuilderPanel     -> tool rail, starter catalog, inspector, forecast,
                      zoning, grid, rotation, cancel, and confirm controls
  ControlRibbon    -> contextual input prompts, active device, city speed
```

`ManagementHud` is a presentation adapter. It does not retain an economy,
traffic, service, alert, placement, editor, environment, input, or game-state
fact. `ManagementUiViewModel` projects those authoritative snapshots into an
immutable UI snapshot on a bounded cadence.

## Command paths

- Management/Builder switches use `GameTransitionCoordinator` through
  `GodotSessionRuntimeHost`.
- City speed accepts only the canonical 0.5×, 1×, 5×, and 15× values and is
  consumed by the scheduler for City and Builder work.
- The time/weather presentation advances as a scheduler-owned City task.
- Economy assistance, bridge policy, weather cycling, catalog selection,
  placement, selection, move, rotate, demolish, and zoning call their existing
  domain or runtime authorities directly.
- Forecast status, blockers, exact remedies, cost, operating cost, net
  cashflow, capacity, payback, and risks are projected from the current
  `PlacementDecision`; the UI does not recompute them.
- Successful commands and failures are routed through the shared AccessKit
  live region.

## Responsive and accessibility behavior

The top statistics grid uses seven columns at Standard/Wide breakpoints and
four columns at Compact. Builder catalog and inspector columns stack at the
Compact breakpoint. The control ribbon changes to two rows when required by
viewport or text scale. Every tool, catalog, zoning, speed, and command control
has an accessible name/description and explicit relative focus neighbors that
remain valid before and after nodes enter the scene tree.

## Automated coverage

`ManagementUiViewModelTests` verifies stable metric and tool ordering, catalog
projection, severity-ranked alerts, valid placement disclosure, and exact
invalid blocker/remedy preservation. The live integration runner verifies UI
ownership, content counts, accessibility metadata, scheduler-owned time,
validated time scale, and transactional Management/Builder ownership in clean,
import, and recovery scenarios.

Gameplay HUDs and modal flows, the minimap, audio, effects, and final manual
responsive/accessibility evidence remain for later Phase 9 slices.
