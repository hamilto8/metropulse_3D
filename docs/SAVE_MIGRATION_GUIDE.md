# Browser-to-Godot save migration

## Export from the browser build

Open the browser sidebar and choose **Export City Save**. Keep the downloaded
`metropulse-city-*.json` file unchanged until the native import succeeds. The
export contains gameplay state only; it does not contain account credentials,
renderer state, or operating-system data.

## Preview, then confirm on desktop

Use an absolute path. The first command validates the complete save and prints
its city, mission, and controlled-entity preview without changing native data:

```sh
/path/to/MetroPulse --headless -- --import-save="/absolute/path/metropulse-city-save.json"
```

The graphical build keeps its actionable preview on screen. When running
headlessly for release automation, add `--smoke-boot`; the expected preview
then exits nonzero with `IMPORT_CONFIRMATION_REQUIRED`. Review that preview,
then repeat with explicit confirmation:

```sh
/path/to/MetroPulse --headless -- --import-save="/absolute/path/metropulse-city-save.json" --confirm-import
```

For the macOS application bundle, the executable is
`MetroPulse.app/Contents/MacOS/MetroPulse 3D`. A confirmed import retains the
exact source bytes before migration, writes the normalized document through the
rotating native repository, and enters Continue. Import is never implicit.

## Backup and rollback locations

Godot resolves `user://` into the platform's per-user application-data folder.
The MetroPulse subdirectory is named `MetroPulse 3D`. Important children are:

- `saves/current.json` — the current native city;
- `saves/recovery.json` — the prior known-good native city; and
- `import-backups/*.json` — exact browser files retained before confirmed
  import.

Typical roots are:

- macOS: `~/Library/Application Support/Godot/app_userdata/MetroPulse 3D/`
- Windows: `%APPDATA%\Godot\app_userdata\MetroPulse 3D\`
- Linux: `~/.local/share/godot/app_userdata/MetroPulse 3D/`

To roll back an import, close MetroPulse first. Preserve the whole `saves`
directory somewhere safe, then start MetroPulse and choose **Recover** when it
is offered. To retry an exact import backup, use its absolute path with the same
preview-and-confirm commands above. Never manually replace `current.json` while
the game is running.

## Failure recovery

- `IMPORT_CONFIRMATION_REQUIRED` is the expected non-mutating preview stop.
- Invalid UTF-8, corrupt JSON, unknown content, and unsupported future versions
  fail before a backup or save-slot write. Keep the export and use a matching or
  newer MetroPulse release.
- A storage failure after backup can leave the exact file in
  `import-backups`; the prior current and recovery slots remain unchanged.
- If Continue is unavailable but Recover is offered, Recover promotes the
  validated recovery slot without rotating a corrupt current over it.
- If neither slot is valid, copy the full application-data directory for
  diagnosis before choosing New Game.

The import implementation and its fault matrix are specified in
`docs/VERSIONED_SAVE_SERVICE.md`. Release acceptance still requires importing
real fixtures in native exported builds on macOS, Windows, and Linux; a
cross-export produced on another host is build evidence, not a platform test.
