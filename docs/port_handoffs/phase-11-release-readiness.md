# Phase 11 migration and release-export handoff

Date: 2026-08-13

Objective and explicit non-goals: Complete the feasible save-migration and
release-export work on the available M1 Pro macOS host. This slice does not
claim native Windows/Linux execution, distribution signing, notarization, or a
release-candidate freeze.

Save migration: `docs/SAVE_MIGRATION_GUIDE.md` now gives the browser export,
non-mutating preview, explicit confirmation, platform storage paths, exact-byte
backup retry, rotating recovery, and failure preservation flow. The previously
implemented migration fault matrix remains authoritative. The macOS release
artifact rendered the controlled-entity fixture preview and classified the
expected `IMPORT_CONFIRMATION_REQUIRED`; confirmed mutation remains covered by
the isolated editor integration scenario because release confirmation would
otherwise alter the developer's production `user://` data. Smoke-mode boot
failures now exit nonzero so this release preview is automatable.

Release construction: `release-export.sh all` constructed the Linux x86-64,
Windows x86-64, and macOS Universal 2 .NET release outputs from Godot
4.6.stable.mono.official.89cea1439. It clears only each generated release output
before construction, executes a native headless smoke where host-compatible,
and produces a sorted per-file SHA-256 manifest with source/toolchain/license,
signing, symbols, and host-validation state. Linux and Windows cross-exports
each contained 190 entries and are labeled build-only; the macOS app contained
385 entries, passed headless New Game boot, and passed strict verification of
its Godot-generated ad-hoc signature. The app executable is Universal 2
x86-64/arm64. Godot-generated script UID sidecars are committed for every
exported C# resource, so a clean release scan no longer creates untracked
identity files. An existing generic `ObjectDB instances leaked at exit` warning
still appears after the otherwise successful macOS smoke and remains a release
classification item from the soak slice.

Credential boundary: normal presets remain committed while
`.godot/export_credentials.cfg` stays ignored. Preset validation now rejects a
committed credentials file or non-empty credential-like preset fields. No
credential or identity was read, added, or requested. The official Godot 4.6
export flow and signing boundaries are documented in `docs/RELEASE_EXPORTS.md`.

Verification commands:

```sh
./godot/scripts/validate-export-presets.sh
bash -n godot/scripts/release-export.sh godot/scripts/validate-export-presets.sh
node --check godot/scripts/release-manifest.mjs
GODOT_BIN=/Applications/Godot_mono.app/Contents/MacOS/Godot ./godot/scripts/release-export.sh all
```

Deferred target-host work: execute install/launch, input, graphics/backend,
save preview/confirmation/recovery, permissions, screen reader, and representative
gameplay checks on Windows and Linux; obtain release credentials; perform
Windows Authenticode and macOS Developer ID signing/notarization; regenerate
post-sign checksums; archive artifacts/symbols/licenses/logs; and secure the
independent product, art, animation, audio, writing, balance, UX, accessibility,
privacy, licensing, QA, and release signoffs. Cross-export success is not a
substitute for any of those gates.
