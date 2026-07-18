# MetroPulse 3D Design Decision Log

> Owners are roles so accountability survives personnel changes. Deadlines are
> evidence deadlines, not automatic approval dates. `Accepted` decisions require
> a new entry to supersede them; they are not silently edited.

| ID | Decision | Status | Owner | Evidence deadline | Consequence / next action |
|---|---|---|---|---|---|
| DD-001 | Freeze MVP at West Core, Central Park, and primary bridge; East is the first post-MVP expansion. | Accepted | Product Lead | 2026-07-17 | Enforced by scope constants and a default-off East flag. |
| DD-002 | Use **Operations** as the MVP label; retain `INDUSTRIAL` only as an internal compatibility key. | Accepted | Product Lead | 2026-07-17 | Player-facing labels updated; migration of internal keys is unnecessary and risky. |
| DD-003 | Freeze the release content budget at 10 authored missions and 6 reusable activity families. | Accepted | Product Lead | 2026-07-17 | Default runtime filters the authored pool through stable IDs. |
| DD-004 | Keep cannon-es behind the current physics boundary for MVP instead of funding a second controller immediately. | Accepted with review | Tech Lead | 2026-10-02 | Reopen only if handling playtests or minimum-profile measurements fail. |
| DD-005 | Use close-follow third-person as the current on-foot presentation. | Provisional | Gameplay Lead | 2026-09-11 | Compare control readability, obstruction, and motion comfort with one wider third-person prototype. |
| DD-006 | MVP players upgrade authored road segments; freeform new-road construction is not release-critical. | Provisional | Systems Designer | 2026-10-09 | Validate whether existing editor-road placement is needed by the golden mission; otherwise hide it. |
| DD-007 | Normal free-roam damage persists only after explicit consequence and save-safety rules are implemented. | Unresolved | Systems Designer | 2026-10-23 | Prototype bounded repair/rollback and test save/reload duplication before selecting persistence. |
| DD-008 | Temporary Mayhem is an MVP sandbox target, but stays hidden until rollback/cleanup is safe; persistent Mayhem is post-MVP. | Accepted with gate | Product Lead | 2027-02-05 | Implement transaction boundary, warning, hazard cap, cleanup, and save isolation before enabling. |
| DD-009 | Keyboard/mouse defines the MVP support matrix; existing gamepad support remains an optional extra. | Accepted with review | Accessibility Lead | 2027-01-15 | Hardware-test only after remapping, pause, and keyboard paths pass. |
| DD-010 | Local IndexedDB replaces localStorage as the authoritative save store in Phase 2. | Accepted | Tech Lead | 2026-11-20 | Keep the current persistence adapter only until SaveService migration/recovery coverage exists. |
| DD-011 | The browser minimum/recommended hardware and exact compatibility matrix remain product decisions requiring measured profiles. | Unresolved | Performance Lead | 2026-09-25 | Record CPU/GPU/RAM/viewport/browser profiles and revise budgets from evidence. |
| DD-012 | Faction count is 3–4; operations may merge with residents if the fourth track does not create a distinct tradeoff. | Unresolved | Narrative Lead | 2027-01-08 | Prototype one choice per track and test whether players can predict consequences. |
| DD-013 | MVP accessibility includes all GDD v3 baseline options; none may be relabeled as post-MVP to protect schedule. | Accepted | Product Lead | 2026-07-17 | Scope cuts must come from cosmetics/variants before accessibility. |

## Decision entry template

New entries must state: context, selected option, alternatives considered,
player consequence, technical/save consequence, evidence, owner, deadline, and
the requirement IDs or scope constants affected.

