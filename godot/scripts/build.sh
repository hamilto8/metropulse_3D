#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

for project in \
  "${GODOT_ROOT}/MetroPulse.Domain/MetroPulse.Domain.csproj" \
  "${GODOT_ROOT}/MetroPulse.Domain.Tests/MetroPulse.Domain.Tests.csproj"; do
  dotnet restore "${project}" --locked-mode --disable-parallel -p:NuGetAudit=false
done
dotnet restore "${GODOT_ROOT}/MetroPulse.Godot/MetroPulse.Godot.csproj" --disable-parallel -p:NuGetAudit=false
dotnet build "${SOLUTION_PATH}" --configuration Debug --no-restore --disable-build-servers -m:1
