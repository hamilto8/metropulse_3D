#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GODOT_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
REPOSITORY_ROOT="$(cd -- "${GODOT_ROOT}/.." && pwd)"
PROJECT_ROOT="${GODOT_ROOT}/MetroPulse.Godot"
SOLUTION_PATH="${PROJECT_ROOT}/MetroPulse.Godot.sln"

resolve_godot_bin() {
  if [[ -n "${GODOT_BIN:-}" && -x "${GODOT_BIN}" ]]; then
    printf '%s\n' "${GODOT_BIN}"
    return 0
  fi

  local candidate
  for candidate in godot4-mono godot-mono godot4 godot; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      command -v "${candidate}"
      return 0
    fi
  done

  printf '%s\n' "Godot 4.6 .NET was not found. Set GODOT_BIN to the executable path." >&2
  return 127
}
