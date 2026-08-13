#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

OUTPUT_PATH="${1:-${GODOT_ROOT}/artifacts/performance/management-soak.json}"
DURATION_SECONDS="${2:-1800}"
QUALITY_PROFILE="${3:-LOW}"

"${SCRIPT_DIR}/capture-performance.sh" \
  "${OUTPUT_PATH}" \
  "${DURATION_SECONDS}" \
  60 \
  "${QUALITY_PROFILE}"
