using System.Collections.ObjectModel;
using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Persistence;
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

    public GameSaveDocumentValidator? SaveValidator { get; private set; }

    public GodotGameSaveRepository? SaveRepository { get; private set; }

    public GameSaveDiscoveryReport? SaveDiscoveryReport { get; private set; }

    public PreparedBootSave? PreparedSave { get; private set; }

    public GameSaveRestoreCoordinator? SaveRestoreCoordinator { get; private set; }

    public GameSaveStaticRestoreReport? StaticRestoreReport { get; private set; }

    public GodotGameSaveImportBackupStore? ImportBackupStore { get; private set; }

    public GameSaveImportService? SaveImportService { get; private set; }

    public GameSaveImportPreview? ImportPreview { get; private set; }

    public GameSaveImportResult? ImportResult { get; private set; }

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
            DisposePersistenceRuntime();
            BootStageException? bootError = error as BootStageException;
            string errorCode = bootError?.Code ?? "PHASE3_BOOT_FAILED";
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Boot,
                LogSeverity.Fatal,
                "phase3.boot.failed",
                error.Message,
                new Dictionary<string, string>
                {
                    ["errorCode"] = errorCode,
                    ["stageId"] = bootError?.StageId ?? "application",
                }));

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
        DisposePersistenceRuntime();
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

    private void DisposePersistenceRuntime()
    {
        if (Configuration?.RunIntegrationTests == true)
        {
            SaveRepository?.DeleteOwnedFiles();
            ImportBackupStore?.DeleteOwnedFiles();
        }
        ImportResult = null;
        ImportPreview = null;
        SaveImportService = null;
        ImportBackupStore = null;
        PreparedSave = null;
        StaticRestoreReport = null;
        SaveRestoreCoordinator?.ClearPending();
        SaveRestoreCoordinator = null;
        SaveDiscoveryReport = null;
        SaveRepository = null;
        SaveValidator = null;
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
            new(BootStageIds.SaveDiscovery, "Discovering validated city saves", (_, _) =>
            {
                RuntimeConfiguration configuration = Configuration
                    ?? throw new InvalidOperationException("Runtime configuration must precede save discovery.");
                GameContentRegistry content = ContentRegistry
                    ?? throw new InvalidOperationException("Content validation must precede save discovery.");
                SaveValidator = new GameSaveDocumentValidator(content);
                string saveDirectory = configuration.RunIntegrationTests
                    ? $"user://integration/saves-{OS.GetProcessId()}"
                    : GodotGameSaveRepository.ProductionDirectory;
                SaveRepository = new GodotGameSaveRepository(SaveValidator, saveDirectory);
                string importBackupDirectory = configuration.RunIntegrationTests
                    ? $"user://integration/import-backups-{OS.GetProcessId()}"
                    : GodotGameSaveImportBackupStore.ProductionDirectory;
                ImportBackupStore = new GodotGameSaveImportBackupStore(importBackupDirectory);
                SaveImportService = new GameSaveImportService(SaveValidator, SaveRepository, ImportBackupStore);
                if (configuration.ImportSavePath is not null)
                {
                    if (!System.IO.File.Exists(configuration.ImportSavePath))
                    {
                        throw new FileNotFoundException("The selected city save import file does not exist.", configuration.ImportSavePath);
                    }
                    PreparedGameSaveImport preparedImport = SaveImportService.Prepare(
                        System.IO.File.ReadAllBytes(configuration.ImportSavePath));
                    ImportPreview = preparedImport.Preview;
                    if (!configuration.ConfirmImport)
                    {
                        throw new BootStageException(
                            BootStageIds.SaveDiscovery,
                            "Discovering validated city saves",
                            "IMPORT_CONFIRMATION_REQUIRED",
                            ImportSummary(ImportPreview),
                            [$"Review this preview, then rerun with --import-save=\"{configuration.ImportSavePath}\" --confirm-import."]);
                    }
                    ImportResult = SaveImportService.Confirm(preparedImport, confirmed: true);
                }
                SaveDiscoveryReport = new GameSaveDiscovery(SaveRepository, SaveValidator).Discover();
                return ValueTask.FromResult<object?>(SaveDiscoveryReport);
            }),
            new(BootStageIds.ActionSelection, "Selecting startup action", (results, _) =>
            {
                GameSaveDiscoveryReport discovery = (GameSaveDiscoveryReport)results[BootStageIds.SaveDiscovery]!;
                string action = discovery.Actions[BootActionIds.Continue]
                    ? BootActionIds.Continue
                    : discovery.Actions[BootActionIds.Recover]
                        ? BootActionIds.Recover
                        : BootActionIds.NewGame;
                return ValueTask.FromResult<object?>(action);
            }),
            new(BootStageIds.SessionConstruction, "Constructing empty Management session", (_, _) =>
            {
                SessionShell session = StartSession();
                session.InitializeRuntimeInput(SettingsAuthority
                    ?? throw new InvalidOperationException("Settings authority must precede session construction."));
                return ValueTask.FromResult<object?>(session);
            }),
            new(BootStageIds.SaveApplication, "Preparing validated city state", (results, _) =>
            {
                string action = (string)results[BootStageIds.ActionSelection]!;
                GameSaveDiscoveryReport discovery = (GameSaveDiscoveryReport)results[BootStageIds.SaveDiscovery]!;
                GodotGameSaveRepository repository = SaveRepository
                    ?? throw new InvalidOperationException("Save discovery must precede save application.");
                GameSaveDocumentValidator validator = SaveValidator
                    ?? throw new InvalidOperationException("Save validation must precede save application.");
                PreparedSave = new GameSaveDiscovery(repository, validator).Prepare(action, discovery);
                SettingsStore settings = SettingsAuthority
                    ?? throw new InvalidOperationException("Settings authority must precede save application.");
                SaveRestoreCoordinator = new GameSaveRestoreCoordinator(
                    validator,
                    [new SettingsSaveRestoreParticipant(settings)]);
                StaticRestoreReport = PreparedSave.SaveDocument is null
                    ? null
                    : SaveRestoreCoordinator.RestoreStatic(PreparedSave.SaveDocument.Json);
                return ValueTask.FromResult<object?>(PreparedSave);
            }),
            new(BootStageIds.FinalReadiness, "Verifying session readiness", (results, _) =>
            {
                SessionShell session = (SessionShell)results[BootStageIds.SessionConstruction]!;
                if (!session.IsInsideTree()
                    || session.GetNodeOrNull<Node3D>("WorldRoot") is null
                    || session.GetNodeOrNull<Camera3D>("CameraRig/MainCamera") is null
                    || session.InputHost?.Initialized != true)
                {
                    throw new BootStageException(
                        BootStageIds.FinalReadiness,
                        "Verifying session readiness",
                        "SESSION_NOT_READY",
                        "The Management session did not construct its required world, camera, and input owners.",
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

    private static string ImportSummary(GameSaveImportPreview preview)
    {
        string mission = preview.MissionId is null
            ? "no active mission"
            : $"mission {preview.MissionId} ({preview.MissionPhase ?? "saved"})";
        string controlled = preview.ControlledKind is null
            ? "no controlled entity"
            : $"{preview.ControlledKind} {preview.ControlledTypeId}";
        return $"Import preview for {preview.SaveId}: saved {preview.SavedAt}, state {preview.GameState}, "
            + $"{preview.BuildingCount} user buildings, {preview.ZoneCount} zones, {mission}, {controlled}.";
    }
}
