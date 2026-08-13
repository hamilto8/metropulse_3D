# Godot 4.6 release exports

## Reproducible inputs and commands

Release exports use the committed `export_presets.cfg`, Godot 4.6 .NET release
templates, the repository-pinned .NET SDK, and one source revision. Build all
desktop targets with:

```sh
./godot/scripts/release-export.sh all
```

The command performs release exports and writes a sorted, per-file SHA-256
manifest under `godot/artifacts/release/<platform>/manifest.json`. Each manifest
records the source revision, dirty-tree state, Godot/template version, .NET SDK,
license checksum, signing state, and whether the result actually passed a
host-compatible headless smoke. Symbols emitted by the .NET export remain in
the platform artifact tree and are included in its manifest.

Bit-for-bit equality is not promised across operating systems or toolchain
installations. The manifest makes the inputs and output bytes inspectable; a
release archive must be created only after the manifest and native host checks
have passed. Do not publish an artifact whose manifest says
`sourceTreeDirty: true` or `build-only-host-incompatible`.

## Signing boundary

`export_presets.cfg` is safe to commit and contains no identity, certificate,
password, or notarization secret. `.godot/export_credentials.cfg` is ignored,
and the preset validator rejects committed credentials or non-empty
credential-like fields. Godot's credentials file or documented environment
variables are the only allowed secret inputs on a controlled release host.

The macOS template produces a Universal 2 application and applies an ad-hoc
signature when no Developer ID is available. `release-export.sh` verifies that
signature on macOS, but ad-hoc signing is not distribution signing or Apple
notarization. Windows Authenticode and macOS Developer ID/notarization must be
performed on credentialed release hosts, followed by native install/launch and
save-import tests. Linux packages should be signed by the selected distribution
channel after the native matrix passes.

## Release-host checklist

1. Start from a clean, reviewed release-candidate revision and install the
   pinned Godot 4.6 .NET templates.
2. Run all tests and `release-export.sh all`.
3. Sign/notarize without copying credentials into the repository.
4. Regenerate checksums after signing because signing changes artifact bytes.
5. On each target OS, install and launch the native artifact, run New Game,
   Continue, Recover, browser-save preview/confirm, and one representative
   gameplay session.
6. Archive artifacts, manifests, symbols, `LICENSE`, sign/notarization logs,
   migration evidence, and rollback instructions together.

The browser build and fixtures remain authoritative rollback/reference material
until at least one released Godot version proves save stability.
