#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

GODOT_EXECUTABLE="$(resolve_godot_bin)"
"${GODOT_EXECUTABLE}" --path "${PROJECT_ROOT}" -- --low-tick
