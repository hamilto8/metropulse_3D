# Phase 10 East-side Development handoff

## Scope delivered

`eastSideDevelopment` is now a complete independent, default-off Godot 4.6 feature package. The existing east-bank skyline, authored roads, and primary bridge remain retained world scenery when the feature is disabled; the package itself creates no runtime, UI, scheduler task, collider, input action, or save field.

When enabled, the package adds an accessible district-status and unlock control backed by the existing canonical economy authority. East Cyber-Metropolis costs exactly $1,000,000 Capital, reports the shared spending-policy reason and remedy while unaffordable, commits once, and persists through the existing economy save state. The mission condition service observes the same district record, so current and future canonical mission requirements receive the unlock immediately without a duplicate progression authority.

The city editor now treats feature availability and persistent unlock as separate requirements across the browser-aligned east-bank development band (`x = 185..420`). An unlocked save loaded without the package remains valid, but construction stays unavailable and no feature presentation is created. With the package enabled, construction remains locked until the economy transaction succeeds.

No new mission was invented for this slice: all fifteen extracted source missions remain assigned to West Core, the primary bridge corridor, or Central Park. Mission integration therefore uses the canonical district-condition service rather than adding unsupported content.

## Cleanup and persistence

- Feature shutdown removes its economy subscription and accessible UI owner.
- A fresh enabled new game returns to the locked $1,000,000 district baseline without adding world or collision owners.
- The unlock is durable economy progression and intentionally survives ordinary save/restore.
- An unlocked economy save remains valid when the feature package is unavailable; its progress is retained, while UI and editor access stay inert.
- Retained east-bank scenery continues to use the shared authored world and does not depend on the feature package.

## Verification

- Domain suite: 404 tests, including unavailable, locked, ready, exact one-time debit, persistent unlocked projection, bounds, and construction feature-gating behavior.
- Godot build and formatting: zero warnings/errors and no formatting differences.
- Enabled headless integration: `phase10.east-side-development.passed` plus the full 179-assertion integration suite.
- Integration covers feature-off absence, locked UI, spending-policy activation, exact debit and idempotence, editor access, mission-condition visibility, fresh-session baseline, shutdown cleanup, and unavailable-package save behavior.
- Default-off matrix: clean new game (179 assertions), confirmed import (179), recovery rotation (183), plus expected confirmation-required, invalid-save, and future-version rejections.

Run the focused enabled scenario with:

```sh
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot godot/scripts/test-phase10-feature.sh eastSideDevelopment
```
