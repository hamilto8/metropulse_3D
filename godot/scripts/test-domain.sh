#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

dotnet test "${GODOT_ROOT}/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj" \
  --configuration Debug \
  --no-build \
  --logger "trx;LogFileName=domain-tests.trx" \
  --results-directory "${GODOT_ROOT}/artifacts/test-results"
