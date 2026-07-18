# Result and Explanation UI

> **Status:** P3.3 implementation contract  
> **Domain sources:** `MissionLifecycleController` and `MissionOutcomeService`  
> **Presentation owners:** `MissionResultViewModel` and `MissionResultScreen`

## Purpose

The mission debrief explains the committed result without becoming another
mission, economy, progression, or persistence authority. It answers four player
questions in order:

1. What happened?
2. Why did it happen?
3. What changed?
4. What can I do next?

The debrief is shown only for a lifecycle `RESULT` with a matching committed
outcome receipt. A missing receipt is not reconstructed from current city state,
because the city may have changed since the transaction was applied.

## Ownership and data flow

```text
MissionLifecycleController RESULT snapshot
                 +
MissionOutcomeService explanation receipt
                 |
                 v
MissionResultViewModel (pure, renderer-free projection)
                 |
                 v
MissionResultScreen (DOM rendering, focus, announcements, actions)
```

- The lifecycle snapshot owns status, reason, performance, attempt, weather,
  and retry eligibility.
- The outcome explanation owns the title, description, and immutable
  before/after effects.
- `MissionResultViewModel` classifies and formats those facts. It never mutates
  them and never queries the live economy or city to reconstruct the past.
- `MissionResultScreen` creates text-only DOM nodes, manages focus, and delegates
  Retry and Continue to `MissionSystem`.
- The existing `MissionOutcomeService` transaction ledger is the persistent
  result log. No parallel UI history store exists.

## Result taxonomy

The presentation taxonomy supports these outcomes:

| Result | Domain signal |
|---|---|
| Success | `SUCCESS`, `COMPLETE`, or `COMPLETED` outcome |
| Partial success | `PARTIAL` or `PARTIAL_SUCCESS` outcome |
| Failure | Failed outcome without a more specific reason |
| Abandonment | `cancelled`, `canceled`, or `abandoned` reason/outcome |
| Arrest | `arrest`, `arrested`, or `captured` reason/outcome |
| Vehicle loss | `vehicle_lost`, `vehicle_destroyed`, or equivalent outcome |

Specific failure reasons take precedence over the generic failure outcome. This
lets existing failure transactions render a precise debrief without weakening
the lifecycle's transaction rules. Adding a gameplay producer for a supported
result does not require DOM changes.

## Consequence sections

Every debrief always renders four stable sections, including an explicit empty
state when no effect was committed:

| Section | Receipt data |
|---|---|
| Reward & performance | Capital adjustments plus lifecycle satisfaction, damage, and Heat metrics when present |
| City consequences | Buildings, infrastructure, incidents, repairs, outages, traffic, news, and authored city state |
| Faction consequences | Faction reputation adjustments |
| Progression & unlocks | Progression tiers, capabilities, and follow-up missions |

Unknown future command types fall into City consequences with safe, humanized
labels. New command-specific formatting should be added to the pure view model,
not to the DOM controller.

## Persistent outcome log

The Recent Activity panel exposes an Outcome Log button once at least one
mission receipt exists. The log:

- reads only mission receipts from the persisted outcome transaction ledger;
- sorts by deterministic application sequence, newest first;
- displays the original receipt-time explanation and before/after effects;
- remains available after the current result is acknowledged;
- survives save/reload through the existing mission-contract save domain; and
- never applies a transaction or changes current city values.

The sequence is deliberately used instead of inventing a wall-clock timestamp
that the receipt contract does not store.

## Accessibility behavior

- The debrief and log use labelled modal-dialog semantics.
- On open, focus moves into the active panel; Tab and Shift+Tab remain within
  the modal.
- Escape closes the log, but it does not silently acknowledge a mission result.
- Result status, summary, change count, and next action are announced through an
  atomic assertive live region once per transaction.
- Result states use both text labels and stable visual treatments; meaning is
  not conveyed only by color.
- All dynamic values are assigned through `textContent` or text nodes.
- The layout collapses to a single column on narrow viewports and honors the
  global reduced-motion, contrast, and UI-scale settings.

## Extension checklist

When extending the debrief:

1. Add domain facts to the lifecycle result or outcome receipt authority first.
2. Add classification, categorization, or formatting in
   `MissionResultViewModel` with focused unit coverage.
3. Keep Retry and Continue as delegated domain actions.
4. Do not read current city state to explain a historical receipt.
5. Do not store a second result log in DOM, LocalStorage, or UI state.
6. Cover new outcomes in the reload path and keyboard-accessible browser flow.

