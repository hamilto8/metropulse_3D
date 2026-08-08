#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' "Usage: $0 <linux|windows|macos> [debug|release]" >&2
  exit 64
fi

BUILD_KIND="${2:-release}"
if [[ "${BUILD_KIND}" != "debug" && "${BUILD_KIND}" != "release" ]]; then
  printf '%s\n' "Unknown build kind '${BUILD_KIND}'. Expected debug or release." >&2
  exit 64
fi

"${SCRIPT_DIR}/validate-export-presets.sh"

OUTPUT_SUFFIX=""
EXPORT_FLAG="--export-release"
if [[ "${BUILD_KIND}" == "debug" ]]; then
  OUTPUT_SUFFIX="-debug"
  EXPORT_FLAG="--export-debug"
fi

case "$1" in
  linux)
    PRESET="Linux"
    OUTPUT="${GODOT_ROOT}/artifacts/exports/linux/MetroPulse${OUTPUT_SUFFIX}.x86_64"
    ;;
  windows)
    PRESET="Windows"
    OUTPUT="${GODOT_ROOT}/artifacts/exports/windows/MetroPulse${OUTPUT_SUFFIX}.exe"
    ;;
  macos)
    PRESET="macOS"
    OUTPUT="${GODOT_ROOT}/artifacts/exports/macos/MetroPulse${OUTPUT_SUFFIX}.app"
    ;;
  *)
    printf '%s\n' "Unknown platform '$1'. Expected linux, windows, or macos." >&2
    exit 64
    ;;
esac

mkdir -p "$(dirname -- "${OUTPUT}")"
GODOT_EXECUTABLE="$(resolve_godot_bin)"
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" "${EXPORT_FLAG}" "${PRESET}" "${OUTPUT}"
