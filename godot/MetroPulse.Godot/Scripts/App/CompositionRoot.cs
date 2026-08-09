using System.Collections.ObjectModel;
using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Adapters;
using MetroPulse.Godot.Diagnostics;

namespace MetroPulse.Godot.App;

public partial class CompositionRoot : Node
{
    private readonly List<BootProgress> bootProgress = [];
    private ReadOnlyCollection<BootProgress>? publishedBootProgress;

    [Export]
    public PackedScene? SessionScene { get; set; }

    public SessionShell? CurrentSession { get; private set; }

    public RuntimeConfiguration? Configuration { get; private set; }

    public DesktopCapabilityReport? CapabilityReport { get; private set; }

    public GameContentRegistry? ContentRegistry { get; private set; }

    public GodotSettingsStorage? SettingsStorage { get; private set; }

    public SettingsStore? SettingsAuthority { get; private set; }

    public GodotInputMapAdapter? InputMapAdapter { get; private set; }

    public IReadOnlyDictionary<string, object?>? LastBootResults { get; private set; }

    public IReadOnlyList<BootProgress> BootProgressEvents =>
        publishedBootProgress ??= bootProgress.AsReadOnly();

    public override void _Ready()
    {
        CallDeferred(nameof(Initialize));
    }

    private async void Initialize()
    {
        BootStatusPresenter boot = GetNode<BootStatusPresenter>("../BootLayer");
        DiagnosticsOverlay diagnostics = GetNode<DiagnosticsOverlay>("../DiagnosticsLayer");

        try
        {
            Configuration = RuntimeConfiguration.Parse(OS.GetCmdlineUserArgs(), OS.IsDebugBuild());
            Engine.PhysicsTicksPerSecond = Configuration.PhysicsTicksPerSecond;
            diagnostics.Initialize(Configuration, sessionLoaded: false);

            var pipeline = new BootPipeline(CreateInitialStages(), progress =>
            {
                bootProgress.Add(progress);
                boot.ShowProgress(progress);
                AppLog.Write(new StructuredLogEvent(
                    LogCategory.Boot,
                    progress.Status == BootStageStatus.Failed ? LogSeverity.Error : LogSeverity.Information,
                    $"boot.{progress.StageId}.{progress.Status.ToString().ToLowerInvariant()}",
                    $"{progress.Label}: {progress.Status}.",
                    new Dictionary<string, string>
                    {
                        ["completed"] = progress.Completed.ToString(System.Globalization.CultureInfo.InvariantCulture),
                        ["total"] = progress.Total.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    }));
            });

            LastBootResults = await pipeline.RunAsync();
            diagnostics.Initialize(Configuration, CurrentSession?.IsInteractiveReleased == true);
            boot.ShowReady();

            AppLog.Write(new StructuredLogEvent(
                LogCategory.Boot,
                LogSeverity.Information,
                "phase3.boot.ready",
                "The validated empty Management session is ready for interactive input.",
                new Dictionary<string, string>
                {
                    ["physicsTicksPerSecond"] = Configuration.PhysicsTicksPerSecond.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["deterministicTestMode"] = Configuration.DeterministicTestMode.ToString(),
                    ["bootAction"] = (string)LastBootResults[BootStageIds.ActionSelection]!,
                }));

            if (Configuration.RunIntegrationTests)
            {
                IntegrationTestRunner runner = new();
                AddChild(runner);
                runner.Begin(this, diagnostics);
            }
            else if (Configuration.SmokeBoot)
            {
                GetTree().Quit(0);
            }
        }
        catch (Exception error)
        {
            DisposeSession();
            DisposeSettingsRuntime();
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Boot,
                LogSeverity.Fatal,
                "phase3.boot.failed",
                error.Message));

            BootStageException? bootError = error as BootStageException;
            string errorCode = bootError?.Code ?? "PHASE3_BOOT_FAILED";
            string remedy = bootError is null
                ? "Verify the Godot 4.6 .NET runtime and project files, then restart. See the structured log for details."
                : string.Join('\n', new[] { bootError.UserMessage }.Concat(bootError.Actions));
            diagnostics.Initialize(
                Configuration ?? RuntimeConfiguration.Parse([], OS.IsDebugBuild()),
                sessionLoaded: false);
            diagnostics.SetFatalError(errorCode);
            boot.ShowFatal(errorCode, remedy);

            if (OS.GetCmdlineUserArgs().Contains("--run-integration-tests", StringComparer.Ordinal))
            {
                GetTree().Quit(1);
            }
        }
    }

    public SessionShell StartSession()
    {
        if (CurrentSession is not null && GodotObject.IsInstanceValid(CurrentSession))
        {
            return CurrentSession;
        }

        PackedScene sessionScene = SessionScene ?? throw new InvalidOperationException("The session shell scene is not configured.");
        CurrentSession = sessionScene.Instantiate<SessionShell>();
        CurrentSession.ProcessMode = ProcessModeEnum.Disabled;
        GetParent().AddChild(CurrentSession);
        return CurrentSession;
    }

    public void DisposeSession()
    {
        if (CurrentSession is null)
        {
            return;
        }

        CurrentSession.Shutdown();
        CurrentSession.QueueFree();
        CurrentSession = null;
    }

    public override void _ExitTree()
    {
        DisposeSession();
        DisposeSettingsRuntime();
    }

    private void DisposeSettingsRuntime()
    {
        InputMapAdapter?.Dispose();
        InputMapAdapter = null;
        SettingsAuthority?.Destroy();
        SettingsAuthority = null;
        if (Configuration?.RunIntegrationTests == true)
        {
            SettingsStorage?.DeleteOwnedFiles();
        }
        SettingsStorage = null;
    }

    private IReadOnlyList<BootStageDefinition> CreateInitialStages()
    {
        const string capabilityLabel = "Checking desktop capabilities";
        return
        [
            new(BootStageIds.CapabilityChecks, capabilityLabel, (_, _) =>
            {
                CapabilityReport = new DesktopCapabilityChecker(SessionScene).Check();
                CapabilityReport.AssertCompatible(BootStageIds.CapabilityChecks, capabilityLabel);
                return ValueTask.FromResult<object?>(CapabilityReport);
            }),
            new(BootStageIds.SettingsBootstrap, "Loading settings and input bindings", (_, _) =>
            {
                RuntimeConfiguration configuration = Configuration
                    ?? throw new InvalidOperationException("Runtime configuration must precede settings bootstrap.");
                string settingsPath = configuration.RunIntegrationTests
                    ? $"user://integration/settings-{OS.GetProcessId()}.json"
                    : GodotSettingsStorage.ProductionPath;
                SettingsStorage = new GodotSettingsStorage(settingsPath);
                SettingsAuthority = new SettingsStore(
                    SettingsStorage,
                    onListenerError: error => AppLog.Write(new StructuredLogEvent(
                        LogCategory.Application,
                        LogSeverity.Error,
                        "settings.listener_failed",
                        error.Message)));
                SettingsLoadResult result = SettingsAuthority.Load();
                foreach (string warning in result.Warnings)
                {
                    AppLog.Write(new StructuredLogEvent(
                        LogCategory.Boot,
                        LogSeverity.Warning,
                        "settings.load_warning",
                        warning));
                }

                InputMapAdapter = new GodotInputMapAdapter(SettingsAuthority);
                InputMapAdapter.Start();
                return ValueTask.FromResult<object?>(result);
            }),
            new(BootStageIds.ContentValidation, "Validating canonical content", (_, _) =>
            {
                ContentRegistry = GameContentRegistry.LoadProduction();
                return ValueTask.FromResult<object?>(ContentRegistry.Counts);
            }),
            new(BootStageIds.ActionSelection, "Selecting startup action", (_, _) =>
                ValueTask.FromResult<object?>("NEW_GAME")),
            new(BootStageIds.SessionConstruction, "Constructing empty Management session", (_, _) =>
                ValueTask.FromResult<object?>(StartSession())),
            new(BootStageIds.FinalReadiness, "Verifying session readiness", (results, _) =>
            {
                SessionShell session = (SessionShell)results[BootStageIds.SessionConstruction]!;
                if (!session.IsInsideTree()
                    || session.GetNodeOrNull<Node3D>("WorldRoot") is null
                    || session.GetNodeOrNull<Camera3D>("CameraRig/MainCamera") is null)
                {
                    throw new BootStageException(
                        BootStageIds.FinalReadiness,
                        "Verifying session readiness",
                        "SESSION_NOT_READY",
                        "The Management session did not construct its required world and camera owners.",
                        ["Repair or reinstall MetroPulse, then retry."]);
                }

                return ValueTask.FromResult<object?>(true);
            }),
            new(BootStageIds.InteractiveRelease, "Releasing interactive control", (results, _) =>
            {
                SessionShell session = (SessionShell)results[BootStageIds.SessionConstruction]!;
                session.ReleaseInteractiveControl();
                return ValueTask.FromResult<object?>(session.IsInteractiveReleased);
            }),
        ];
    }
}
