namespace MetroPulse.Domain.Diagnostics;

public sealed record DiagnosticRuntimeState(
    string GameState,
    string ClockPolicy,
    string Transition,
    bool MayhemEnabled);

public sealed record DiagnosticControlledEntity(
    string Kind,
    string ContentId,
    string TypeId,
    IReadOnlyList<double> Position,
    double Speed);

public sealed record DiagnosticMissionState(
    string? MissionId,
    string? Phase,
    string? Checkpoint);

public sealed record DiagnosticSaveState(
    string Action,
    string Status,
    bool CurrentValid,
    bool RecoveryValid,
    bool RuntimeRestorePending,
    string? SaveId,
    string? LastSavedAt,
    string? Error);

public sealed record DiagnosticCounts(
    int SceneNodes,
    int WorldNodes,
    int PhysicsBodies,
    int Vehicles,
    int Pedestrians,
    int Aircraft,
    int SavedBuildings,
    int SavedZones,
    int SavedAlerts,
    int ContentMissions,
    int ContentBuildings);

public sealed record DiagnosticPerformance(
    double Fps,
    double FrameMilliseconds,
    double ProcessMilliseconds,
    double PhysicsMilliseconds,
    double NavigationMilliseconds,
    double RenderCpuMilliseconds,
    double RenderGpuMilliseconds,
    ulong DrawCalls,
    ulong Primitives,
    ulong RenderedObjects,
    ulong VideoMemoryBytes,
    ulong StaticMemoryBytes,
    long ManagedMemoryBytes,
    long TotalAllocatedBytes,
    ulong GodotObjectCount,
    ulong ResourceCount,
    ulong NodeCount,
    ulong OrphanNodeCount,
    ulong PhysicsActiveObjects,
    ulong PhysicsCollisionPairs,
    ulong PhysicsIslandCount,
    int ActiveAudioVoices,
    int Gen0Collections,
    int Gen1Collections,
    int Gen2Collections);

public sealed record DiagnosticScenarioMetadata(
    bool Deterministic,
    ulong? Seed,
    string? BootAction,
    bool ImportRequested,
    bool ImportConfirmed,
    bool TestHooksAvailable);

public sealed record DiagnosticSnapshot(
    string ApplicationVersion,
    string SourceRevision,
    string EngineVersion,
    string Renderer,
    string PhysicsEngine,
    int PhysicsTicksPerSecond,
    bool PhysicsInterpolationEnabled,
    bool SessionLoaded,
    string? FatalErrorCode,
    DiagnosticRuntimeState Runtime,
    DiagnosticControlledEntity? ControlledEntity,
    DiagnosticMissionState Mission,
    DiagnosticSaveState Save,
    DiagnosticCounts Counts,
    DiagnosticPerformance Performance,
    IReadOnlyDictionary<string, bool> FeatureFlags,
    DiagnosticScenarioMetadata Scenario)
{
    public bool DeterministicTestMode => Scenario.Deterministic;

    public ulong? ScenarioSeed => Scenario.Seed;
}
