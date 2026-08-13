#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

PRESET_FILE="${PROJECT_ROOT}/export_presets.cfg"

if [[ -f "${PROJECT_ROOT}/.godot/export_credentials.cfg" ]] \
  && git -C "${REPOSITORY_ROOT}" ls-files --error-unmatch \
    "godot/MetroPulse.Godot/.godot/export_credentials.cfg" >/dev/null 2>&1; then
  printf '%s\n' "Godot export credentials must never be committed." >&2
  exit 1
fi

if awk -F= '
  BEGIN { IGNORECASE = 1 }
  /^[[:space:]]*(password|encryption\/encryption_key|codesign\/identity|codesign\/certificate_file|notarization\/api_key)[[:space:]]*=/ {
    value = $0
    sub(/^[^=]*=/, "", value)
    gsub(/[[:space:]\"]/, "", value)
    if (value != "") found = 1
  }
  END { exit found ? 0 : 1 }
' "${PRESET_FILE}"; then
  printf '%s\n' "export_presets.cfg contains a credential-like value; keep secrets in Godot's ignored credentials file or environment." >&2
  exit 1
fi

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
