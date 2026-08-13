#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

dotnet test "${GODOT_ROOT}/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj" \
  --no-restore \
  --filter 'FullyQualifiedName~Phase6LivingCitySoakTests|FullyQualifiedName~Phase7ManagementSoakTests|FullyQualifiedName~WorldEditTransactionTests'

"${SCRIPT_DIR}/test-integration.sh"
