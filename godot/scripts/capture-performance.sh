#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

OUTPUT_PATH="${1:-${GODOT_ROOT}/artifacts/performance/native-high-debug.json}"
DURATION_SECONDS="${2:-20}"
WARMUP_SECONDS="${3:-5}"
QUALITY_PROFILE="${4:-HIGH}"

if [[ "${OUTPUT_PATH}" != /* ]]; then
  printf '%s\n' "Performance capture output must be an absolute path." >&2
  exit 64
fi

mkdir -p "$(dirname -- "${OUTPUT_PATH}")"
GODOT_EXECUTABLE="$(resolve_godot_bin)"
SOURCE_REVISION="${METROPULSE_SOURCE_REVISION:-$(git -C "${REPOSITORY_ROOT}" rev-parse HEAD)}"

METROPULSE_SOURCE_REVISION="${SOURCE_REVISION}" "${GODOT_EXECUTABLE}" --path "${PROJECT_ROOT}" -- \
  "--performance-capture=${OUTPUT_PATH}" \
  "--performance-duration=${DURATION_SECONDS}" \
  "--performance-warmup=${WARMUP_SECONDS}" \
  "--quality=${QUALITY_PROFILE}" \
  --boot-action=NEW_GAME
