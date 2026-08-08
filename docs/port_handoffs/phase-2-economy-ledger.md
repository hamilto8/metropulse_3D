# Phase 2 Economy Ledger Handoff

Chunk ID and status: `phase-2-economy-ledger`; complete as the sixth Phase 2 slice. This is the first coherent part of Phase 2.5 item 5; the item and Phase 2 overall remain in progress.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; implementation based on Godot revision `21848b4` targeting Godot 4.6 stable .NET.

Objective and non-goals: Port the renderer-independent shared-Capital authority, spending and fiscal-recovery policy, atomic building/mission transaction ledger, and deterministic balanced-session simulator. This chunk does not port demographics, utility coverage, land value, happiness, demand, incidents, zones/district unlocks, mobility feedback, serialization/restoration, alert presentation, UI, or Godot nodes.

Authorities and evidence: Read `src/systems/EconomyBalance.js`, `EconomySystem.js`, `EconomyScenarioSimulator.js`, their economy/recovery/simulation tests, and the unchanged Phase 0 `economy.json`. The three frozen spending decisions and every transaction and summary scalar for the 15-, 30-, 60-, and 120-minute balanced sessions are compared exactly, with no tolerance.

Files and ownership: Added `MetroPulse.Domain/Economy/EconomyPolicy.cs`, `EconomyLedger.cs`, and `EconomyScenarioSimulator.cs`, plus `MetroPulse.Domain.Tests/Economy/EconomyLedgerTests.cs`. The existing canonical `EconomyBalanceDefinition` remains the sole balance authority. The domain assembly remains free of Godot references.

Public contracts: Added fiscal-state and spending-category tokens; investment and spending contexts; immutable decisions, receipts, budget/fiscal/recovery snapshots, building and mission records, authority events, scenario events/transactions/results; `EconomyPolicy`; `EconomyLedger`; and `EconomyScenarioSimulator`.

Behavior: Credits, debits, passive income/expense, fines, building registration/removal, mission rewards, narrative progress, reputation, and recovery transitions commit through one revisioned authority. Expected rejections do not mutate state. Duplicate mission IDs cannot pay twice. Deficits clamp at zero. Fines are capped by both the authored maximum and treasury share. Emergency assistance activates restrictions only after exhausted Capital and negative cashflow; recovery exits once cashflow is non-negative and the reserve is rebuilt. Subscribers receive immutable before/after snapshots, and a failing subscriber cannot block later subscribers or roll back authority state.

Tests and results: Added five xUnit cases, bringing the domain suite to 54. Tests cover all frozen spending decisions; all four complete transaction streams and their final treasury, asset, mission, passive-rate, operating-cost, and fiscal-state summaries; atomic insufficient-funds and duplicate-mission failures; deficit clamping; recovery entry/restrictions/exit; bounded fines; and listener isolation. Phase 0 baseline and ten-artifact extraction checks have zero drift. The full `verify.sh` gate passes: export presets validate, the deterministic .NET build has zero warnings, 54/54 domain tests pass, Godot 4.6 completes its headless import, and all 18 foundation integration assertions pass.

Performance/resources: No nodes, bodies, timers, engine callbacks, persistence, or external resources were added. The ledger owns small in-memory dictionaries and explicit subscribers. Snapshots copy published collections; scenario time is advanced explicitly and ordered stably by minute then source order.

Known deviations and defects: No defects found in the ported surface. The ledger deliberately publishes the transaction and fiscal subset rather than presenting a misleading partial clone of the browser's larger City Pulse snapshot. Utility and mobility productivity multipliers remain 1 and management cost remains 0 until their source modules are ported with their own evidence.

Next safe task: Continue Phase 2.5 item 5 with the pure aggregate City Pulse slice: service capacity/demand and utility productivity, population/jobs/housing, happiness and demand breakdowns, land value, mobility feedback, incidents/zones, and snapshot serialization/restoration. Preserve the existing ledger as the sole transaction authority and keep alert/UI adapters out until item 6.
