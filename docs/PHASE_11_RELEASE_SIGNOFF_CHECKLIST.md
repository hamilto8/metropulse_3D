# Phase 11 release signoff checklist

This checklist is a release gate, not a declaration that the named reviewers
have approved the build. A signoff is valid only when its owner records the
release-candidate revision, target artifacts, evidence, decision, date, and any
approved deviation. Automation may prepare evidence but may not impersonate a
discipline owner.

| Discipline | Required release-candidate review | Current state |
|---|---|---|
| Product / scope | First-session MVP scope, hidden deferred breadth, parity-matrix dispositions, cut/deviation decisions | Pending owner |
| Engineering | Clean revision, authority/lifecycle review, no duplicate transaction paths, open-defect classification | Pending owner |
| Performance | Minimum/recommended native matrix, modes/mission/save hitch, draw-call/allocation disposition, two-hour soak | Pending target hardware and owner |
| Platform compatibility | Installed signed artifacts on supported Windows, macOS, and Linux; renderer, permissions, input, upgrade/import | macOS smoke only; pending owner/matrix |
| Save migration | Real browser exports previewed, confirmed, recovered, and rolled back in each native target artifact | Automated/editor + macOS preview only |
| Accessibility | Keyboard-only, scaling/contrast/reduced motion, captions, focus, and NVDA/VoiceOver/Orca interaction | Automated Phase 9 evidence; native screen-reader matrix pending |
| UX | New player Builder → Street → Builder, boot/error/recovery comprehension, settings/pause/help, truthful feedback | Pending owner/playtest |
| Art | World/character/vehicle readability, LOD transitions, clipping, lighting/weather, quality tiers | Pending owner |
| Animation | Locomotion/vehicle/recovery/mission transitions and reduced-motion behavior | Pending owner |
| Audio | Mix, captions/text alternatives, voice caps, pause/focus/device behavior | Pending owner |
| Writing / narrative | Mission/dialogue clarity, tone, content references, spelling/localization readiness | Pending owner |
| Balance / gameplay | Economy, mission rewards/failures, traffic/hazards, handling and assists across profiles | Pending owner/playtest |
| Privacy | Diagnostic fields, no default PII/save/dialogue collection, no mandatory account/analytics/network service | Pending owner |
| Licensing | Repository and shipped third-party asset/runtime licenses, notices, attribution, distribution obligations | MIT file present; shipped-artifact audit pending |
| Release operations | Versioning, symbols, checksums, credentials boundary, signing/notarization logs, archive and rollback drill | Automation ready; credentials/archive pending |

Required attachments for a final approval package:

1. immutable source revision and CI run;
2. signed artifact identity/checksum/manifest for every target;
3. target-hardware matrix and native migration logs;
4. performance/soak reports and open-defect/deviation list;
5. completed discipline decisions above; and
6. rollback location for the browser reference, fixtures, native artifacts,
   symbols, saves, and release notes.
