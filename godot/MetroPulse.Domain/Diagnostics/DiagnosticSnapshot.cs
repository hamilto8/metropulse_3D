namespace MetroPulse.Domain.Diagnostics;

public sealed record DiagnosticSnapshot(
    string ApplicationVersion,
    string SourceRevision,
    string EngineVersion,
    string Renderer,
    string PhysicsEngine,
    int PhysicsTicksPerSecond,
    bool PhysicsInterpolationEnabled,
    bool DeterministicTestMode,
    ulong? ScenarioSeed,
    bool SessionLoaded,
    string? FatalErrorCode);
