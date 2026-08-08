#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PRESET_FILE="${PROJECT_ROOT}/export_presets.cfg"

assert_preset_platform() {
  local preset_name="$1"
  local expected_platform="$2"
  local actual_platform

  actual_platform="$(
    awk -v target="${preset_name}" '
      /^\[preset\.[0-9]+\]$/ {
        in_preset = 1
        name = ""
        next
      }

      /^\[/ {
        in_preset = 0
        name = ""
        next
      }

      in_preset && /^name=/ {
        name = $0
        sub(/^name="/, "", name)
        sub(/"$/, "", name)
        next
      }

      in_preset && name == target && /^platform=/ {
        platform = $0
        sub(/^platform="/, "", platform)
        sub(/"$/, "", platform)
        print platform
      }
    ' "${PRESET_FILE}"
  )"

  if [[ "${actual_platform}" != "${expected_platform}" ]]; then
    printf '%s\n' \
      "Export preset '${preset_name}' must target '${expected_platform}', found '${actual_platform:-missing}'." >&2
    return 1
  fi
}

assert_preset_platform "Linux" "Linux/X11"
assert_preset_platform "Windows" "Windows Desktop"
assert_preset_platform "macOS" "macOS"

printf '%s\n' "Validated Linux, Windows, and macOS export preset platform identifiers."
