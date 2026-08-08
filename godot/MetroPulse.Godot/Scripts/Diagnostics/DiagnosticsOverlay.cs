using System.Reflection;
using System.Text.Json;
using Godot;
using MetroPulse.Domain.Diagnostics;

namespace MetroPulse.Godot.Diagnostics;

public partial class DiagnosticsOverlay : CanvasLayer
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private RuntimeConfiguration? _configuration;
    private bool _sessionLoaded;
    private string? _fatalErrorCode;
    private Label? _snapshotLabel;

    public DiagnosticSnapshot CurrentSnapshot => CaptureSnapshot();

    public override void _Ready()
    {
        _snapshotLabel = GetNode<Label>("Panel/Snapshot");
        Visible = OS.IsDebugBuild();
    }

    public void Initialize(RuntimeConfiguration configuration, bool sessionLoaded)
    {
        _configuration = configuration;
        _sessionLoaded = sessionLoaded;
        RenderSnapshot();
    }

    public void SetFatalError(string errorCode)
    {
        _fatalErrorCode = errorCode;
        RenderSnapshot();
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

        return new DiagnosticSnapshot(
            informationalVersion,
            sourceRevision,
            engineVersion,
            string.IsNullOrWhiteSpace(renderer) ? "headless" : renderer,
            physicsEngine,
            Engine.PhysicsTicksPerSecond,
            ProjectSettings.GetSetting("physics/common/physics_interpolation", false).AsBool(),
            _configuration?.DeterministicTestMode ?? false,
            _configuration?.ScenarioSeed,
            _sessionLoaded,
            _fatalErrorCode);
    }

    private void RenderSnapshot()
    {
        Label snapshotLabel = _snapshotLabel ??= GetNode<Label>("Panel/Snapshot");
        snapshotLabel.Text = JsonSerializer.Serialize(CaptureSnapshot(), SerializerOptions);
    }
}
