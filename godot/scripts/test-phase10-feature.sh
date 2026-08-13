#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

if [[ $# -ne 1 || -z "$1" ]]; then
  printf '%s\n' "Usage: $0 <comma-separated-feature-ids>" >&2
  exit 64
fi

GODOT_EXECUTABLE="$(resolve_godot_bin)"
FEATURES="$1"
mkdir -p "${GODOT_ROOT}/artifacts/test-results"
SAFE_NAME="${FEATURES//,/--}"
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  --boot-action=NEW_GAME \
  "--features=${FEATURES}" 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-phase10-${SAFE_NAME}.log"
