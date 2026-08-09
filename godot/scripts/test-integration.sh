#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

GODOT_EXECUTABLE="$(resolve_godot_bin)"
mkdir -p "${GODOT_ROOT}/artifacts/test-results"
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  --boot-action=NEW_GAME 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-integration.log"

IMPORT_FIXTURE="$(mktemp "${TMPDIR:-/tmp}/metropulse-import.XXXXXX")"
CORRUPT_FIXTURE="$(mktemp "${TMPDIR:-/tmp}/metropulse-corrupt.XXXXXX")"
FUTURE_FIXTURE="$(mktemp "${TMPDIR:-/tmp}/metropulse-future.XXXXXX")"
trap 'rm -f -- "${IMPORT_FIXTURE}" "${CORRUPT_FIXTURE}" "${FUTURE_FIXTURE}"' EXIT

extract_fixture() {
  node --input-type=module -e \
    'import fs from "node:fs"; const wrapper = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); fs.writeFileSync(process.argv[2], JSON.stringify(wrapper.data));' \
    "$1" \
    "$2"
}

expect_import_failure() {
  local fixture="$1"
  local error_code="$2"
  local log_name="$3"
  if "${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
    --run-integration-tests \
    "--import-save=${fixture}" \
    --confirm-import \
    --boot-action=CONTINUE 2>&1 \
    | tee "${GODOT_ROOT}/artifacts/test-results/${log_name}"; then
    echo "Invalid save import unexpectedly succeeded: ${error_code}." >&2
    exit 1
  fi
  rg -q "${error_code}" "${GODOT_ROOT}/artifacts/test-results/${log_name}"
}

extract_fixture \
  "${REPOSITORY_ROOT}/test/fixtures/godot-port/phase0/save-controlled-entity.json" \
  "${IMPORT_FIXTURE}"
extract_fixture \
  "${REPOSITORY_ROOT}/test/fixtures/godot-port/phase0/save-corrupt.json" \
  "${CORRUPT_FIXTURE}"
extract_fixture \
  "${REPOSITORY_ROOT}/test/fixtures/godot-port/phase0/save-future.json" \
  "${FUTURE_FIXTURE}"
if "${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  "--import-save=${IMPORT_FIXTURE}" \
  --boot-action=CONTINUE 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-import-preview.log"; then
  echo "Unconfirmed save import unexpectedly succeeded." >&2
  exit 1
fi
rg -q 'IMPORT_CONFIRMATION_REQUIRED' "${GODOT_ROOT}/artifacts/test-results/godot-import-preview.log"

expect_import_failure "${CORRUPT_FIXTURE}" "INVALID_SAVE" "godot-integration-corrupt.log"
expect_import_failure "${FUTURE_FIXTURE}" "FUTURE_SAVE_VERSION" "godot-integration-future.log"

# This corrected confirmed import is also the automated retry after the rejected fixtures.
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  "--import-save=${IMPORT_FIXTURE}" \
  --confirm-import \
  --boot-action=CONTINUE 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-integration-import.log"

# Starting New Game rotates the imported current into recovery; the runner then
# discovers, promotes, validates, and statically restores it through RECOVER.
"${GODOT_EXECUTABLE}" --headless --path "${PROJECT_ROOT}" -- \
  --run-integration-tests \
  "--import-save=${IMPORT_FIXTURE}" \
  --confirm-import \
  --boot-action=NEW_GAME 2>&1 \
  | tee "${GODOT_ROOT}/artifacts/test-results/godot-integration-recovery.log"
