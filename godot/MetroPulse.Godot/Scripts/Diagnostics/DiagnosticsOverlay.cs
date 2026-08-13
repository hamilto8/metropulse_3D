using System.Reflection;
using System.Text.Json;
using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Persistence;
using MetroPulse.Godot.App;
using MetroPulse.Godot.Runtime;

namespace MetroPulse.Godot.Diagnostics;

public partial class DiagnosticsOverlay : CanvasLayer
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private RuntimeConfiguration? _configuration;
    private CompositionRoot? _compositionRoot;
    private bool _sessionLoaded;
    private string? _fatalErrorCode;
    private Label? _snapshotLabel;
    private double _frameMilliseconds;
    private double _renderCountdown;
    private bool _performanceCaptureActive;

    public DiagnosticSnapshot CurrentSnapshot => CaptureSnapshot();

    public DiagnosticPerformance CurrentPerformance => CapturePerformance();

    public override void _Ready()
    {
        _snapshotLabel = GetNode<Label>("Panel/Snapshot");
        Visible = OS.IsDebugBuild();
        RenderingServer.ViewportSetMeasureRenderTime(GetViewport().GetViewportRid(), true);
    }

    public override void _Process(double delta)
    {
        _frameMilliseconds = Math.Max(0, delta) * 1000;
        if (!OS.IsDebugBuild() || _performanceCaptureActive) return;
        _renderCountdown -= delta;
        if (_renderCountdown <= 0)
        {
            _renderCountdown = 0.25;
            RenderSnapshot();
        }
    }

    public void Initialize(
        RuntimeConfiguration configuration,
        bool sessionLoaded,
        CompositionRoot? compositionRoot = null)
    {
        _configuration = configuration;
        _sessionLoaded = sessionLoaded;
        _compositionRoot = compositionRoot;
        RenderSnapshot();
    }

    public void SetFatalError(string errorCode)
    {
        _fatalErrorCode = errorCode;
        RenderSnapshot();
    }

    public void BeginPerformanceCapture()
    {
        _performanceCaptureActive = true;
        Visible = false;
    }

    private DiagnosticSnapshot CaptureSnapshot()
    {
        string informationalVersion = typeof(DiagnosticsOverlay).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion ?? "unknown";
        string sourceRevision = System.Environment.GetEnvironmentVariable("METROPULSE_SOURCE_REVISION") ?? "unavailable";
        string engineVersion = Engine.GetVersionInfo()["string"].AsString();
        string renderer = RenderingServer.GetCurrentRenderingDriverName();
        string physicsEngine = ProjectSettings.GetSetting("physics/3d/physics_engine", "unknown").AsString();

        DiagnosticSaveData saveData = ReadSaveData();
        GameSaveDiscoveryReport? discovery = _compositionRoot?.SaveDiscoveryReport;
        DeferredGameSaveDescriptor? pendingRuntime = _compositionRoot?.SaveRestoreCoordinator?.PendingRuntime;
        GodotSessionRuntimeHost? sessionRuntime = _compositionRoot?.CurrentSession?.RuntimeHost;
        string action = _compositionRoot?.PreparedSave?.Action ?? _configuration?.BootAction ?? "UNSELECTED";
        string saveStatus = _fatalErrorCode is not null
            ? "ERROR"
            : pendingRuntime is not null
                ? "RESTORE_DEFERRED"
                : _sessionLoaded
                    ? "READY"
                    : "BOOTING";

        return new DiagnosticSnapshot(
            informationalVersion,
            sourceRevision,
            engineVersion,
            string.IsNullOrWhiteSpace(renderer) ? "headless" : renderer,
            physicsEngine,
            Engine.PhysicsTicksPerSecond,
            ProjectSettings.GetSetting("physics/common/physics_interpolation", false).AsBool(),
            _sessionLoaded,
            _fatalErrorCode,
            new DiagnosticRuntimeState(
                pendingRuntime is not null
                    ? saveData.GameState ?? "MANAGEMENT"
                    : sessionRuntime?.StateMachine.State.ToToken() ?? saveData.GameState ?? "MANAGEMENT",
                pendingRuntime is not null
                    ? "DEFERRED_RESTORE"
                    : sessionRuntime?.Scheduler.ClockPolicy.ToToken() ?? "EMPTY_SESSION_NO_SIMULATION_CLOCK",
                pendingRuntime is not null
                    ? "RUNTIME_RESTORE_PENDING"
                    : sessionRuntime?.Transitions.ActivePhase?.ToToken() ?? "STABLE",
                saveData.MayhemEnabled),
            saveData.ControlledEntity,
            new DiagnosticMissionState(saveData.MissionId, saveData.MissionPhase, saveData.Checkpoint),
            new DiagnosticSaveState(
                action,
                saveStatus,
                discovery?.Current.Valid == true,
                discovery?.Recovery.Valid == true,
                pendingRuntime is not null,
                _compositionRoot?.PreparedSave?.SaveDocument?.SaveId,
                _compositionRoot?.PreparedSave?.SaveDocument?.SavedAt,
                _fatalErrorCode),
            CaptureCounts(saveData),
            CapturePerformance(),
            _configuration?.Features.Snapshot() ?? new FeatureFlagSet().Snapshot(),
            new DiagnosticScenarioMetadata(
                _configuration?.DeterministicTestMode ?? false,
                _configuration?.ScenarioSeed,
                _configuration?.BootAction,
                _configuration?.ImportSavePath is not null,
                _configuration?.ConfirmImport ?? false,
                OS.IsDebugBuild()));
    }

    private DiagnosticCounts CaptureCounts(DiagnosticSaveData saveData)
    {
        Node root = GetTree().Root;
        Node? world = _compositionRoot?.CurrentSession?.GetNodeOrNull<Node>("WorldRoot");
        int contentMissions = _compositionRoot?.ContentRegistry?.Counts.Missions ?? 0;
        int contentBuildings = _compositionRoot?.ContentRegistry?.Counts.Buildings ?? 0;
        return new DiagnosticCounts(
            CountNodes(root),
            world is null ? 0 : CountNodes(world),
            CountNodes<CollisionObject3D>(root),
            GetTree().GetNodesInGroup("vehicles").Count,
            GetTree().GetNodesInGroup("pedestrians").Count,
            GetTree().GetNodesInGroup("aircraft").Count,
            saveData.SavedBuildings,
            saveData.SavedZones,
            saveData.SavedAlerts,
            contentMissions,
            contentBuildings);
    }

    private DiagnosticSaveData ReadSaveData()
    {
        string? dataJson = _compositionRoot?.SaveRestoreCoordinator?.PendingRuntime?.DataJson
            ?? _compositionRoot?.PreparedSave?.SaveDocument?.DataJson;
        if (string.IsNullOrWhiteSpace(dataJson)) return new DiagnosticSaveData();
        try
        {
            using JsonDocument parsed = JsonDocument.Parse(dataJson);
            JsonElement root = parsed.RootElement;
            JsonElement game = Property(root, "game");
            JsonElement player = Property(root, "player");
            JsonElement missions = Property(root, "missions");
            JsonElement world = Property(root, "world");
            JsonElement alerts = Property(root, "alerts");
            JsonElement controlled = Property(player, "controlled");
            JsonElement activeMission = Property(missions, "active");
            JsonElement lifecycle = Property(missions, "lifecycle");
            JsonElement lifecycleRun = Property(lifecycle, "run");
            DiagnosticControlledEntity? entity = controlled.ValueKind == JsonValueKind.Object
                ? new DiagnosticControlledEntity(
                    Text(controlled, "kind") ?? "UNKNOWN",
                    Text(controlled, "contentId") ?? "UNKNOWN",
                    Text(controlled, "typeId") ?? "UNKNOWN",
                    Numbers(controlled, "position"),
                    Number(controlled, "speed"))
                : null;
            return new DiagnosticSaveData
            {
                GameState = Text(game, "state"),
                MayhemEnabled = Boolean(game, "mayhemEnabled"),
                ControlledEntity = entity,
                MissionId = Text(activeMission, "contentId") ?? Text(lifecycle, "selectedMissionId"),
                MissionPhase = Text(lifecycle, "phase") ?? Text(activeMission, "state"),
                Checkpoint = Text(lifecycleRun, "checkpoint"),
                SavedBuildings = ArrayLength(world, "buildings"),
                SavedZones = ArrayLength(world, "zones"),
                SavedAlerts = ArrayLength(alerts, "items"),
            };
        }
        catch (JsonException)
        {
            return new DiagnosticSaveData();
        }
    }

    private static JsonElement Property(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object && parent.TryGetProperty(name, out JsonElement value)
            ? value
            : default;

    private static string? Text(JsonElement parent, string name)
    {
        JsonElement value = Property(parent, name);
        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static bool Boolean(JsonElement parent, string name)
    {
        JsonElement value = Property(parent, name);
        return value.ValueKind is JsonValueKind.True or JsonValueKind.False && value.GetBoolean();
    }

    private static double Number(JsonElement parent, string name)
    {
        JsonElement value = Property(parent, name);
        return value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out double number) ? number : 0;
    }

    private static IReadOnlyList<double> Numbers(JsonElement parent, string name)
    {
        JsonElement value = Property(parent, name);
        return value.ValueKind == JsonValueKind.Array
            ? Array.AsReadOnly(value.EnumerateArray().Select(item => item.TryGetDouble(out double number) ? number : 0).ToArray())
            : Array.Empty<double>();
    }

    private static int ArrayLength(JsonElement parent, string name)
    {
        JsonElement value = Property(parent, name);
        return value.ValueKind == JsonValueKind.Array ? value.GetArrayLength() : 0;
    }

    private static int CountNodes(Node node) => 1 + node.GetChildren().Sum(CountNodes);

    private static int CountNodes<T>(Node node) where T : Node =>
        (node is T ? 1 : 0) + node.GetChildren().Sum(CountNodes<T>);

    private DiagnosticPerformance CapturePerformance() => new(
        Engine.GetFramesPerSecond(),
        _frameMilliseconds,
        MonitorMilliseconds(Performance.Monitor.TimeProcess),
        MonitorMilliseconds(Performance.Monitor.TimePhysicsProcess),
        MonitorMilliseconds(Performance.Monitor.TimeNavigationProcess),
        RenderingServer.ViewportGetMeasuredRenderTimeCpu(GetViewport().GetViewportRid())
            + RenderingServer.GetFrameSetupTimeCpu(),
        RenderingServer.ViewportGetMeasuredRenderTimeGpu(GetViewport().GetViewportRid()),
        RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame),
        RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalPrimitivesInFrame),
        RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalObjectsInFrame),
        RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.VideoMemUsed),
        MonitorUnsigned(Performance.Monitor.MemoryStatic),
        GC.GetTotalMemory(forceFullCollection: false),
        GC.GetTotalAllocatedBytes(precise: false),
        MonitorUnsigned(Performance.Monitor.ObjectCount),
        MonitorUnsigned(Performance.Monitor.ObjectResourceCount),
        MonitorUnsigned(Performance.Monitor.ObjectNodeCount),
        MonitorUnsigned(Performance.Monitor.ObjectOrphanNodeCount),
        MonitorUnsigned(Performance.Monitor.Physics3DActiveObjects),
        MonitorUnsigned(Performance.Monitor.Physics3DCollisionPairs),
        MonitorUnsigned(Performance.Monitor.Physics3DIslandCount),
        _compositionRoot?.CurrentSession?.Audio?.ActiveVoiceCount ?? 0,
        GC.CollectionCount(0),
        GC.CollectionCount(1),
        GC.CollectionCount(2));

    private static double MonitorMilliseconds(Performance.Monitor monitor) =>
        Math.Max(0, Performance.GetMonitor(monitor)) * 1000;

    private static ulong MonitorUnsigned(Performance.Monitor monitor) =>
        (ulong)Math.Max(0, Performance.GetMonitor(monitor));

    private void RenderSnapshot()
    {
        Label snapshotLabel = _snapshotLabel ??= GetNode<Label>("Panel/Snapshot");
        snapshotLabel.Text = JsonSerializer.Serialize(CaptureSnapshot(), SerializerOptions);
    }

    private sealed record DiagnosticSaveData
    {
        public string? GameState { get; init; }
        public bool MayhemEnabled { get; init; }
        public DiagnosticControlledEntity? ControlledEntity { get; init; }
        public string? MissionId { get; init; }
        public string? MissionPhase { get; init; }
        public string? Checkpoint { get; init; }
        public int SavedBuildings { get; init; }
        public int SavedZones { get; init; }
        public int SavedAlerts { get; init; }
    }
}
