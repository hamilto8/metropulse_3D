#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf '%s\n' "Usage: $0 <linux|windows|macos|all> [release]" >&2
  exit 64
fi
if [[ "${2:-release}" != "release" ]]; then
  printf '%s\n' "Release packaging accepts release exports only." >&2
  exit 64
fi

case "$1" in
  linux|windows|macos) PLATFORMS=("$1") ;;
  all) PLATFORMS=(linux windows macos) ;;
  *)
    printf '%s\n' "Unknown platform '$1'. Expected linux, windows, macos, or all." >&2
    exit 64
    ;;
esac

GODOT_EXECUTABLE="$(resolve_godot_bin)"
GODOT_VERSION="$(${GODOT_EXECUTABLE} --version | head -n 1)"
TEMPLATE_VERSION="$(printf '%s' "${GODOT_VERSION}" | sed -E 's/\.mono.*$/.mono/; s/-/./g')"
MANIFEST_ROOT="${GODOT_ROOT}/artifacts/release"
mkdir -p "${MANIFEST_ROOT}"

for platform in "${PLATFORMS[@]}"; do
  case "${platform}" in
    linux) CLEAN_ROOT="${GODOT_ROOT}/artifacts/exports/linux" ;;
    windows) CLEAN_ROOT="${GODOT_ROOT}/artifacts/exports/windows" ;;
    macos) CLEAN_ROOT="${GODOT_ROOT}/artifacts/exports/macos/MetroPulse.app" ;;
  esac
  rm -rf "${CLEAN_ROOT}"
  "${SCRIPT_DIR}/export.sh" "${platform}" release
  HOST_VALIDATION="build-only-host-incompatible"
  SIGNING_STATUS="unsigned"
  case "${platform}" in
    linux)
      ARTIFACT_ROOT="${GODOT_ROOT}/artifacts/exports/linux"
      if [[ "$(uname -s)" == "Linux" ]]; then
        "${SCRIPT_DIR}/smoke-export.sh" linux release
        HOST_VALIDATION="headless-smoke-passed"
      fi
      ;;
    windows)
      ARTIFACT_ROOT="${GODOT_ROOT}/artifacts/exports/windows"
      ;;
    macos)
      ARTIFACT_ROOT="${GODOT_ROOT}/artifacts/exports/macos/MetroPulse.app"
      if [[ "$(uname -s)" == "Darwin" ]]; then
        "${SCRIPT_DIR}/smoke-export.sh" macos release
        HOST_VALIDATION="headless-smoke-passed"
        if codesign --verify --deep --strict "${ARTIFACT_ROOT}" >/dev/null 2>&1; then
          if codesign -dv --verbose=2 "${ARTIFACT_ROOT}" 2>&1 | grep -q '^Signature=adhoc$'; then
            SIGNING_STATUS="verified-ad-hoc"
          else
            SIGNING_STATUS="verified-identity"
          fi
        fi
      fi
      ;;
  esac

  PLATFORM_MANIFEST_ROOT="${MANIFEST_ROOT}/${platform}"
  mkdir -p "${PLATFORM_MANIFEST_ROOT}"
  METROPULSE_GODOT_VERSION="${GODOT_VERSION}" \
  METROPULSE_TEMPLATE_VERSION="${TEMPLATE_VERSION}" \
  METROPULSE_SIGNING_STATUS="${SIGNING_STATUS}" \
    node "${SCRIPT_DIR}/release-manifest.mjs" \
      "${platform}" release "${ARTIFACT_ROOT}" \
      "${PLATFORM_MANIFEST_ROOT}/manifest.json" "${HOST_VALIDATION}"
done

printf '%s\n' "Release exports and manifests are under ${GODOT_ROOT}/artifacts/."
