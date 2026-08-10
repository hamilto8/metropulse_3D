#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

"${SCRIPT_DIR}/validate-export-presets.sh"
"${SCRIPT_DIR}/validate-content-extraction.sh"
node "${REPOSITORY_ROOT}/Tools/Phase2Audit/validate-audit.mjs"
node "${REPOSITORY_ROOT}/Tools/Phase3Audit/validate-audit.mjs"
node "${REPOSITORY_ROOT}/Tools/Phase4WorldFixtures/capture-world-surface.mjs" --check
node "${REPOSITORY_ROOT}/Tools/Phase4WorldFixtures/capture-landmarks.mjs" --check
node "${REPOSITORY_ROOT}/Tools/Phase4WorldFixtures/build-screenshot-manifest.mjs" --check
node "${REPOSITORY_ROOT}/Tools/Phase4Audit/validate-audit.mjs"
"${SCRIPT_DIR}/build.sh"
"${SCRIPT_DIR}/test-domain.sh"
"${SCRIPT_DIR}/validate-headless.sh"
"${SCRIPT_DIR}/test-integration.sh"
