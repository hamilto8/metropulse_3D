# Phase 11 exit audit

Date: 2026-08-13

Decision: **Phase 11 is materially advanced but not complete, and the release
candidate is not frozen.** This is the maximum safe status on the available base
M1 Pro MacBook Pro. Target-host work, long interactive observation, independent
signoffs, and release credentials cannot be replaced by local automation.

## Work-item disposition

| Item | Status | Evidence and remaining gate |
|---|---|---|
| 11.1 hardware profiles/counters | Partial | Privacy-safe capture covers requested counter families and one recommended-class M1 Pro Management scenario at 720p/1080p. Minimum Mac, Windows/Linux, other modes/mission, save hitch, Compatibility and GPU timing remain. |
| 11.2 profile/optimize | Partial | Road-snapshot/spatial/presentation work cut matched managed allocation about 77.7% with exact behavior. At 1080p high, ~1,938 draw calls exceeds the provisional 500 guardrail and ~26 MB/s managed allocation remains. |
| 11.3 quality profiles | Implemented | High/medium/low scale presentation only; low passes all 179 integration assertions with identical populations, collision, mission, input and save authority. Target-host tuning remains part of 11.1. |
| 11.4 physics cadence | Accepted | Matched 60/90/120 captures plus contact/handling integration retain fixed 120 Hz; see ADR 0002. |
| 11.5 resource soaks | Partial | All feasible automated cycles/faults pass, including simulated 30-minute living city. Required two-hour representative interactive RC soak is not run. Generic `ObjectDB instances leaked at exit` warning needs engine/project classification. |
| 11.6 migration | Partial | Browser export, strict preview, confirmation, exact backup, recovery and player guide exist. macOS release preview passes; confirmed release import and all native Windows/Linux flows remain. |
| 11.7 exports | Partial | All presets cross-build, manifests/checksums/symbol inventory are automated, credentials are excluded, and macOS Universal 2 ad-hoc smoke passes. Developer ID/notarization, Authenticode, channel signing and native Windows/Linux tests remain. |
| 11.8 signoffs | Pending | Exact owner checklist exists in `docs/PHASE_11_RELEASE_SIGNOFF_CHECKLIST.md`; no automation is treated as owner approval. |
| 11.9 RC freeze | Not eligible | Final parity dispositions, target matrix, signed artifacts, two-hour soak, defect classification and signoffs are incomplete. Browser reference/fixtures remain retained. |

## Completed pushed slices

1. `3dce41c` — native performance capture and counters;
2. `ed27a06` — semantic-safe quality profiles;
3. `7121659` — measured allocation optimization;
4. `7f50033` — consolidated resource/fault soak gate;
5. `dac6cff` — migration and release-export readiness; and
6. `a2dd7e2` — telemetry-backed 120 Hz cadence ADR.

## Verification completed on this host

- domain suite: 433 tests pass;
- clean/default, low-quality, import and recovery integration: 179/179/179/183
  assertions with expected preview/corrupt/future failures;
- 60, 90 and 120 Hz: 179 assertions each, including handling, impacts,
  bridge/terrain contacts and interpolation;
- automated Phase 11 resource/fault soaks pass;
- 1920×1080 high-quality M1 Pro capture: 120 FPS average, 8.33 ms P99
  frame, 696.7 ms boot-to-interactive;
- Linux x86-64 and Windows x86-64 release cross-exports construct; macOS
  Universal 2 release constructs, passes headless New Game smoke, and verifies
  its ad-hoc signature; and
- macOS release save preview reports the expected
  `IMPORT_CONFIRMATION_REQUIRED` summary and exits nonzero in smoke mode.

## Release blockers / no-claim boundaries

- No Windows or Linux host, minimum M1/8 GB Mac, discrete PC GPU, physical
  controller matrix, or Compatibility-renderer acceptance was available.
- No distribution certificate, notarization credential, store/channel signing,
  installed-package test, or final archive was authorized or available.
- No two-hour representative interactive soak or independent manual discipline
  signoff was performed.
- The parity matrix still contains pending/manual owner dispositions; the final
  gate requiring every MVP row to pass or hold an approved deviation is not met.
- High draw calls, remaining per-tick allocation, unavailable Metal GPU timing,
  and the generic exit leak warning require explicit release disposition.
- This audit does not invent OS/version/driver floors, certify untested
  accessibility technology, mutate production saves, or claim a release-ready
  binary.

## Next safe release sequence

Cut no RC yet. First classify the exit warning and either reduce or approve an
evidence-backed draw-call budget. Then run exported release performance and the
two-hour interactive soak on the candidate Mac revision. Acquire Windows/Linux
hosts and credentials, execute the native compatibility/migration/accessibility
matrix, sign and checksum final bytes, reconcile parity/deviations, collect the
named owner signoffs, and only then freeze one immutable release-candidate
revision.
