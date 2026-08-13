#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

OUTPUT_PATH="${1:-${GODOT_ROOT}/artifacts/performance/native-high-debug.json}"
DURATION_SECONDS="${2:-20}"
WARMUP_SECONDS="${3:-5}"
QUALITY_PROFILE="${4:-HIGH}"
PHYSICS_TICKS="${5:-}"

if [[ "${OUTPUT_PATH}" != /* ]]; then
  printf '%s\n' "Performance capture output must be an absolute path." >&2
  exit 64
fi

mkdir -p "$(dirname -- "${OUTPUT_PATH}")"
GODOT_EXECUTABLE="$(resolve_godot_bin)"
SOURCE_REVISION="${METROPULSE_SOURCE_REVISION:-$(git -C "${REPOSITORY_ROOT}" rev-parse HEAD)}"
EXTRA_ARGUMENTS=()
if [[ -n "${PHYSICS_TICKS}" ]]; then
  EXTRA_ARGUMENTS+=("--physics-ticks=${PHYSICS_TICKS}")
fi

dotnet build "${SOLUTION_PATH}" --configuration Debug --no-restore \
  --disable-build-servers -m:1 >/dev/null

METROPULSE_SOURCE_REVISION="${SOURCE_REVISION}" "${GODOT_EXECUTABLE}" --path "${PROJECT_ROOT}" -- \
  "--performance-capture=${OUTPUT_PATH}" \
  "--performance-duration=${DURATION_SECONDS}" \
  "--performance-warmup=${WARMUP_SECONDS}" \
  "--quality=${QUALITY_PROFILE}" \
  "${EXTRA_ARGUMENTS[@]}" \
  --boot-action=NEW_GAME

if [[ -n "${PHYSICS_TICKS}" ]]; then
  node --input-type=module -e '
    import fs from "node:fs";
    const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const requested = Number(process.argv[2]);
    if (report.engine?.physicsTicksPerSecond !== requested) {
      console.error(`Capture cadence mismatch: requested ${requested}, reported ${report.engine?.physicsTicksPerSecond}.`);
      process.exit(1);
    }
  ' "${OUTPUT_PATH}" "${PHYSICS_TICKS}"
fi
