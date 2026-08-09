#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

GODOT_EXECUTABLE="$(resolve_godot_bin)"
mkdir -p "${GODOT_ROOT}/artifacts/test-results"
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- --run-integration-tests 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-integration.log"

IMPORT_FIXTURE="$(mktemp "${TMPDIR:-/tmp}/metropulse-import.XXXXXX")"
trap 'rm -f -- "${IMPORT_FIXTURE}"' EXIT
node --input-type=module -e \
  'import fs from "node:fs"; const wrapper = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[2], JSON.stringify(wrapper.data));' \
  "${REPOSITORY_ROOT}/test/fixtures/godot-port/phase0/save-controlled-entity.json" \
  "${IMPORT_FIXTURE}"
if "${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  "--import-save=${IMPORT_FIXTURE}" 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-import-preview.log"; then
  echo "Unconfirmed save import unexpectedly succeeded." >&2
  exit 1
fi
rg -q 'IMPORT_CONFIRMATION_REQUIRED' "${GODOT_ROOT}/artifacts/test-results/godot-import-preview.log"
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  "--import-save=${IMPORT_FIXTURE}" \
  --confirm-import 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-integration-import.log"
