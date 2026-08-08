#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

node "${REPOSITORY_ROOT}/Tools/GodotContentExtraction/extract-content.mjs" --check
