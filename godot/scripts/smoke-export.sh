#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' "Usage: $0 <linux|macos> [debug|release]" >&2
  exit 64
fi

PLATFORM="$1"
BUILD_KIND="${2:-release}"
SUFFIX=""
if [[ "${BUILD_KIND}" == "debug" ]]; then
  SUFFIX="-debug"
elif [[ "${BUILD_KIND}" != "release" ]]; then
  printf '%s\n' "Unknown build kind '${BUILD_KIND}'. Expected debug or release." >&2
  exit 64
fi

case "${PLATFORM}" in
  linux)
    EXECUTABLE="${GODOT_ROOT}/artifacts/exports/linux/MetroPulse${SUFFIX}.x86_64"
    ;;
  macos)
    APP_BUNDLE="${GODOT_ROOT}/artifacts/exports/macos/MetroPulse${SUFFIX}.app"
    EXECUTABLE="$(find "${APP_BUNDLE}/Contents/MacOS" -maxdepth 1 -type f -perm -111 | head -n 1)"
    ;;
  *)
    printf '%s\n' "Smoke execution is supported only for the host-compatible linux or macos export." >&2
    exit 64
    ;;
esac

if [[ ! -x "${EXECUTABLE}" ]]; then
  printf '%s\n' "Exported executable not found at ${EXECUTABLE}. Run export.sh first." >&2
  exit 66
fi

"${EXECUTABLE}" --headless -- --smoke-boot --boot-action=NEW_GAME
