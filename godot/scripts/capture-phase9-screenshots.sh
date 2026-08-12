#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

GODOT_EXECUTABLE="$(resolve_godot_bin)"
OUTPUT_DIRECTORY="${REPOSITORY_ROOT}/docs/port_evidence/phase9/screenshots"
mkdir -p "${OUTPUT_DIRECTORY}"
"${GODOT_EXECUTABLE}" --path "${PROJECT_ROOT}" -- \
  --deterministic-test \
  --seed=424242 \
  --boot-action=NEW_GAME \
  "--capture-phase9-screenshots=${OUTPUT_DIRECTORY}"
