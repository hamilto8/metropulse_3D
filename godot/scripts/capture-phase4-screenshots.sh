#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

GODOT_EXECUTABLE="$(resolve_godot_bin)"
OUTPUT_DIRECTORY="${REPOSITORY_ROOT}/docs/port_evidence/phase4/screenshots"
mkdir -p "${OUTPUT_DIRECTORY}"
"${GODOT_EXECUTABLE}" --path "${PROJECT_ROOT}" -- \
  --deterministic-test \
  --seed=424242 \
  --boot-action=NEW_GAME \
  "--capture-phase4-screenshots=${OUTPUT_DIRECTORY}"
node "${REPOSITORY_ROOT}/Tools/Phase4WorldFixtures/build-screenshot-manifest.mjs"
