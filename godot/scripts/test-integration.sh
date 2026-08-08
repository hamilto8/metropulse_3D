#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

GODOT_EXECUTABLE="$(resolve_godot_bin)"
mkdir -p "${GODOT_ROOT}/artifacts/test-results"
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- --run-integration-tests 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-integration.log"
