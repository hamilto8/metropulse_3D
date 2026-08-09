using System.Text.Json;
using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Persistence;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Adapters;
using MetroPulse.Godot.App;
using MetroPulse.Godot.Runtime;

namespace MetroPulse.Godot.Diagnostics;

public partial class IntegrationTestRunner : Node
{
    private CompositionRoot? _compositionRoot;
    private DiagnosticsOverlay? _diagnostics;

    public void Begin(CompositionRoot compositionRoot, DiagnosticsOverlay diagnostics)
    {
        _compositionRoot = compositionRoot;
        _diagnostics = diagnostics;
        CallDeferred(MethodName.Run);
    }

    private async void Run()
    {
        await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
        await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        List<string> failures = [];
        CompositionRoot compositionRoot = _compositionRoot ?? throw new InvalidOperationException("Test runner was not initialized.");
        DiagnosticsOverlay diagnostics = _diagnostics ?? throw new InvalidOperationException("Test runner was not initialized.");

        Check(compositionRoot.CurrentSession is not null, "Main.tscn creates the disposable SessionRoot.", failures);
        Check(compositionRoot.CurrentSession?.IsInsideTree() == true, "SessionRoot enters the scene tree.", failures);
        Check(compositionRoot.CurrentSession?.GetNodeOrNull<Node3D>("WorldRoot") is not null, "SessionRoot owns WorldRoot.", failures);
        Check(compositionRoot.CurrentSession?.GetNodeOrNull<Camera3D>("CameraRig/MainCamera") is not null, "SessionRoot owns MainCamera.", failures);
        Check(compositionRoot.CurrentSession?.IsInteractiveReleased == true, "Boot releases session input only after readiness.", failures);
        Check(Engine.PhysicsTicksPerSecond == RuntimeConfiguration.DefaultPhysicsTicksPerSecond, "Physics cadence is 120 Hz.", failures);
        Check(ProjectSettings.GetSetting("physics/common/physics_interpolation", false).AsBool(), "Physics interpolation is enabled.", failures);
        Check(ProjectSettings.GetSetting("physics/3d/physics_engine", string.Empty).AsString() == "Jolt Physics", "Jolt Physics is explicit.", failures);
        Check(diagnostics.CurrentSnapshot.SessionLoaded, "Diagnostics report the loaded session.", failures);
        Check(diagnostics.CurrentSnapshot.DeterministicTestMode, "Integration tests run deterministically.", failures);
        Check(compositionRoot.LastBootResults is not null, "Boot publishes its immutable stage results.", failures);
        Check(
            compositionRoot.LastBootResults?.Keys.SequenceEqual(
            [
                BootStageIds.CapabilityChecks,
                BootStageIds.SettingsBootstrap,
                BootStageIds.ContentValidation,
                BootStageIds.SaveDiscovery,
                BootStageIds.ActionSelection,
                BootStageIds.SessionConstruction,
                BootStageIds.SaveApplication,
                BootStageIds.FinalReadiness,
                BootStageIds.InteractiveRelease,
            ]) == true,
            "Initial Phase 3 boot stages run in the declared order.",
            failures);
        Check(compositionRoot.BootProgressEvents.Count == 18, "Each initial boot stage reports running and complete states.", failures);
        Check(
            compositionRoot.BootProgressEvents
                .Select((progress, index) => (progress, index))
                .All(item => item.progress.Status == (item.index % 2 == 0 ? BootStageStatus.Running : BootStageStatus.Complete)),
            "Boot progress contains no skipped or failed stage.",
            failures);
        Check(compositionRoot.CapabilityReport?.Compatible == true, "Desktop capability probes pass before session construction.", failures);
        Check(
            compositionRoot.ContentRegistry?.Counts is { Missions: 15, Buildings: 19 },
            "Canonical content validation completes during boot.",
            failures);
        bool importScenario = compositionRoot.Configuration?.ImportSavePath is not null;
        string expectedAction = compositionRoot.Configuration?.BootAction
            ?? throw new InvalidOperationException("Headless integration requires an explicit boot action.");
        bool restoreScenario = expectedAction is BootActionIds.Continue or BootActionIds.Recover;
        bool recoverySeedScenario = importScenario && expectedAction == BootActionIds.NewGame;
        Check(
            string.Equals(
                compositionRoot.LastBootResults?[BootStageIds.ActionSelection] as string,
                expectedAction,
                StringComparison.Ordinal),
            "Action selection matches the explicit validated boot action.",
            failures);
        Check(compositionRoot.SaveValidator is not null, "Boot owns the production game-save validator.", failures);
        Check(
            compositionRoot.SaveRepository?.DirectoryPath.StartsWith("user://integration/saves-", StringComparison.Ordinal) == true,
            "Headless integration isolates the boot save repository under user://integration.",
            failures);
        Check(
            compositionRoot.SaveImportService is not null
                && compositionRoot.ImportBackupStore?.DirectoryPath.StartsWith("user://integration/import-backups-", StringComparison.Ordinal) == true,
            "Boot owns the browser-save import service and an isolated backup directory.",
            failures);
        Check(
            importScenario
                ? compositionRoot.ImportPreview is { ControlledKind: "VEHICLE", ControlledTypeId: "SEDAN" }
                    && compositionRoot.ImportResult is { Imported: true, BackupPath: not null }
                    && global::Godot.FileAccess.FileExists(compositionRoot.ImportResult.BackupPath)
                : compositionRoot.ImportPreview is null && compositionRoot.ImportResult is null,
            "Import preview/result exist only for an explicitly confirmed import.",
            failures);
        Check(
            importScenario
                ? compositionRoot.SaveDiscoveryReport is { Current.Valid: true, Recovery.Present: false }
                : compositionRoot.SaveDiscoveryReport is { Current.Present: false, Recovery.Present: false },
            "Discovery reports the expected clean/import persistent slots.",
            failures);
        Check(
            compositionRoot.SaveDiscoveryReport?.Actions.SequenceEqual(new Dictionary<string, bool>(StringComparer.Ordinal)
            {
                [BootActionIds.NewGame] = true,
                [BootActionIds.Continue] = importScenario,
                [BootActionIds.Recover] = false,
            }) == true,
            "Discovery exposes only actions backed by validated save slots.",
            failures);
        Check(
            restoreScenario
                ? compositionRoot.PreparedSave is { Restore: true, SaveDocument: not null }
                    && compositionRoot.PreparedSave.Action == expectedAction
                : compositionRoot.PreparedSave is { Action: BootActionIds.NewGame, Restore: false, SaveDocument: null },
            "Save application prepares the selected validated action.",
            failures);
        Check(
            ReferenceEquals(compositionRoot.LastBootResults?[BootStageIds.SaveApplication], compositionRoot.PreparedSave),
            "Boot publishes the retained save-application descriptor.",
            failures);
        Check(
            compositionRoot.SaveRestoreCoordinator is not null,
            "Save application constructs the split static/runtime restore coordinator.",
            failures);
        Check(
            restoreScenario
                ? compositionRoot.StaticRestoreReport is { PendingRuntime: not null }
                    && compositionRoot.StaticRestoreReport.AppliedDomains.SequenceEqual(
                        [GameSaveDomainIds.Settings, GameSaveDomainIds.Bindings])
                    && ReferenceEquals(
                        compositionRoot.StaticRestoreReport.PendingRuntime,
                        compositionRoot.SaveRestoreCoordinator?.PendingRuntime)
                : compositionRoot.StaticRestoreReport is null
                    && compositionRoot.SaveRestoreCoordinator?.PendingRuntime is null,
            "Static restore applies available owners and retains runtime only for restore actions.",
            failures);
        Check(
            restoreScenario
                ? compositionRoot.SaveRepository?.ReadSlots() is { Current: not null, Recovery: null }
                : recoverySeedScenario
                    ? compositionRoot.SaveRepository?.ReadSlots() is { Current: null, Recovery: not null }
                    : compositionRoot.SaveRepository?.ReadSlots() == new GameSaveSlots(null, null),
            "Save application leaves the expected action-specific slot state.",
            failures);
        await CheckBootActionPresentation(compositionRoot, failures);
        CheckDiagnostics(compositionRoot, diagnostics, restoreScenario, failures);
        CheckRecoveryScenario(compositionRoot, recoverySeedScenario, failures);
        CheckSettingsAndInputMap(compositionRoot, failures);
        CheckRuntimeInput(compositionRoot, failures);
        CheckGameSaveRepository(failures);
        CheckImportBackupStore(compositionRoot, failures);
        CheckCapabilityFailureContract(compositionRoot, failures);
        CheckCollisionLayerNames(failures);

        if (failures.Count == 0)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "integration.passed",
                "Phase 3 shell integration checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = recoverySeedScenario ? "88" : "84",
                    ["bootAction"] = expectedAction,
                }));
            GetTree().Quit(0);
            return;
        }

        foreach (string failure in failures)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Error,
                "integration.failed",
                failure));
        }

        GetTree().Quit(1);
    }

    private static void Check(bool condition, string assertion, ICollection<string> failures)
    {
        if (!condition)
        {
            failures.Add(assertion);
        }
    }

    private async ValueTask CheckBootActionPresentation(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        BootStatusPresenter boot = compositionRoot.GetNode<BootStatusPresenter>("../BootLayer");
        GameSaveDiscoveryReport report = compositionRoot.SaveDiscoveryReport
            ?? throw new InvalidOperationException("Save discovery report is unavailable.");
        ValueTask<string> selection = boot.SelectActionAsync(report);
        await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
        Button newGame = boot.GetNode<Button>("Margin/Content/Actions/NewGame");
        Button continueButton = boot.GetNode<Button>("Margin/Content/Actions/Continue");
        Button recover = boot.GetNode<Button>("Margin/Content/Actions/Recover");
        Check(
            boot.ActionSelectionVisible && !newGame.Disabled,
            "Interactive boot presents an enabled New Game action.",
            failures);
        Check(
            continueButton.Disabled != report.Actions[BootActionIds.Continue]
                && recover.Disabled != report.Actions[BootActionIds.Recover],
            "Interactive boot enables Continue and Recover only for validated slots.",
            failures);
        newGame.EmitSignal(BaseButton.SignalName.Pressed);
        Check(
            await selection == BootActionIds.NewGame && !boot.ActionSelectionVisible,
            "Interactive action selection resolves once and hides its controls.",
            failures);
        boot.ShowFatal("INTEGRATION_RETRY", "Correct the fixture, then retry.");
        Check(boot.RetryAvailable, "Actionable boot failure presentation exposes Retry.", failures);
        boot.ShowReady();
    }

    private static void CheckDiagnostics(
        CompositionRoot compositionRoot,
        DiagnosticsOverlay diagnostics,
        bool restoreScenario,
        ICollection<string> failures)
    {
        DiagnosticSnapshot snapshot = diagnostics.CurrentSnapshot;
        Check(
            snapshot.Runtime.GameState == (restoreScenario ? "STREET_VEHICLE" : "MANAGEMENT")
                && snapshot.Runtime.Transition == (restoreScenario ? "RUNTIME_RESTORE_PENDING" : "STABLE"),
            "Diagnostics report the authoritative or explicitly deferred game state and transition.",
            failures);
        Check(
            snapshot.Save.Action == compositionRoot.Configuration?.BootAction
                && snapshot.Save.Status == (restoreScenario ? "RESTORE_DEFERRED" : "READY")
                && snapshot.Save.RuntimeRestorePending == restoreScenario,
            "Diagnostics report boot action, save-slot state, and deferred runtime restore truthfully.",
            failures);
        Check(
            restoreScenario
                ? snapshot.ControlledEntity is { Kind: "VEHICLE", TypeId: "SEDAN", Speed: 12.5 }
                : snapshot.ControlledEntity is null,
            "Diagnostics expose a controlled-entity descriptor only when one is retained.",
            failures);
        Check(
            snapshot.Counts is { SceneNodes: > 0, WorldNodes: > 0, ContentMissions: 15, ContentBuildings: 19 },
            "Diagnostics publish live scene/world and canonical content counts.",
            failures);
        Check(
            snapshot.Performance.Fps >= 0
                && snapshot.Performance.FrameMilliseconds >= 0
                && !string.IsNullOrWhiteSpace(snapshot.Renderer),
            "Diagnostics publish bounded frame timing and renderer statistics.",
            failures);
        Check(
            snapshot.FeatureFlags.Count > 0
                && snapshot.Scenario is { Deterministic: true, Seed: 1, TestHooksAvailable: true },
            "Diagnostics publish immutable feature flags and debug-only scenario metadata.",
            failures);
    }

    private static void CheckRecoveryScenario(
        CompositionRoot compositionRoot,
        bool recoverySeedScenario,
        ICollection<string> failures)
    {
        if (!recoverySeedScenario) return;
        try
        {
            GodotGameSaveRepository repository = compositionRoot.SaveRepository
                ?? throw new InvalidOperationException("Save repository is unavailable.");
            GameSaveDocumentValidator validator = compositionRoot.SaveValidator
                ?? throw new InvalidOperationException("Save validator is unavailable.");
            GameSaveDiscovery discovery = new(repository, validator);
            GameSaveDiscoveryReport report = discovery.Discover();
            Check(
                report is { Current.Valid: false, Recovery.Valid: true }
                    && report.Actions[BootActionIds.Recover],
                "New Game preserves the imported known-good current as an eligible recovery.",
                failures);
            PreparedBootSave prepared = discovery.Prepare(BootActionIds.Recover, report);
            Check(
                prepared is { Action: BootActionIds.Recover, Restore: true, SaveDocument: not null },
                "Recover selects the validated recovery document.",
                failures);
            Check(
                repository.ReadSlots() is { Current: not null, Recovery: not null },
                "Recover promotes the selected recovery into current without deleting recovery.",
                failures);
            GameSaveStaticRestoreReport restored = compositionRoot.SaveRestoreCoordinator?.RestoreStatic(
                prepared.SaveDocument!.Json)
                ?? throw new InvalidOperationException("Save restore coordinator is unavailable.");
            Check(
                restored.PendingRuntime.DomainIds.Contains(GameSaveDomainIds.Player, StringComparer.Ordinal)
                    && ReferenceEquals(restored.PendingRuntime, compositionRoot.SaveRestoreCoordinator?.PendingRuntime),
                "Recovered static state retains its runtime entity descriptor for the future adapter.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Recover scenario integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckCollisionLayerNames(ICollection<string> failures)
    {
        string[] expectedNames =
        [
            "Surface",
            "StaticObstacle",
            "Traffic",
            "Player",
            "Pedestrian",
            "Interaction",
            "MissionTrigger",
            "Effect",
            "CameraQuery",
        ];

        for (int index = 0; index < expectedNames.Length; index++)
        {
            string setting = $"layer_names/3d_physics/layer_{index + 1}";
            Check(
                ProjectSettings.GetSetting(setting, string.Empty).AsString() == expectedNames[index],
                $"Collision layer {index + 1} is named {expectedNames[index]}.",
                failures);
        }
    }

    private static void CheckRuntimeInput(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        try
        {
            RuntimeInputHost input = compositionRoot.CurrentSession?.InputHost
                ?? throw new InvalidOperationException("Runtime input owner is unavailable.");
            RuntimeInputSnapshot snapshot = input.LatestSnapshot;

            Check(input.Initialized, "SessionRoot initializes its runtime input owner before release.", failures);
            Check(
                input.GetParent()?.GetPath().ToString().EndsWith("SessionRoot/RuntimeServices", StringComparison.Ordinal) == true,
                "Runtime input is owned by SessionRoot/RuntimeServices.",
                failures);
            Check(
                input.ProcessPhysicsPriority == RuntimeInputHost.InputPhysicsPriority,
                "Runtime input samples before gameplay physics consumers.",
                failures);
            Check(
                input.PhysicsSnapshotCount > 0 && snapshot.PhysicsTick == input.PhysicsSnapshotCount,
                "Interactive release publishes exactly one canonical snapshot per physics callback.",
                failures);
            Check(
                snapshot.Context == ControlContexts.Management
                    && snapshot.ActiveInterface == InputInterfaces.Keyboard,
                "The empty session starts with Management keyboard authority.",
                failures);
            Check(
                snapshot.Prompts.GetValueOrDefault("BUILD") == "F",
                "Contextual prompt metadata reads the validated binding authority.",
                failures);
            Check(
                snapshot.Actions.ContainsKey(RuntimeInputActionIds.Slot("PAN", 0)),
                "Canonical snapshots retain stable per-binding directional slots.",
                failures);
            Check(
                GodotInputMapAdapter.TryGetKeyboardMouseToken(
                    new InputEventKey { PhysicalKeycode = Key.E },
                    out string keyToken)
                    && keyToken == KeyboardMouseInputs.KeyE
                    && GodotInputMapAdapter.TryGetKeyboardMouseToken(
                        new InputEventMouseButton { ButtonIndex = MouseButton.Right },
                        out string mouseToken)
                    && mouseToken == KeyboardMouseInputs.MouseSecondary,
                "Godot events round-trip to browser-compatible physical input tokens.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Runtime input integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckGameSaveRepository(ICollection<string> failures)
    {
        string directory = $"user://integration/save-repository-{OS.GetProcessId()}";
        var validator = new IntegrationSaveValidator();
        var repository = new GodotGameSaveRepository(validator, directory);
        repository.DeleteOwnedFiles();

        try
        {
            Check(
                repository.CurrentPath == $"{directory}/current.json"
                    && repository.RecoveryPath == $"{directory}/recovery.json"
                    && repository.TemporaryPath == $"{directory}/transaction.tmp",
                "The game-save repository exposes explicit current, recovery, and transaction paths.",
                failures);

            string first = SaveFixture("first");
            string second = SaveFixture("second");
            string third = SaveFixture("third");
            repository.CommitCurrent(first);
            GameSaveSlots firstSlots = repository.ReadSlots();
            Check(firstSlots.Current == first && firstSlots.Recovery is null, "The first save creates only current.", failures);

            repository.CommitCurrent(second);
            GameSaveSlots rotated = repository.ReadSlots();
            Check(
                rotated.Current == second && rotated.Recovery == first,
                "A subsequent save rotates the prior known-good current into recovery.",
                failures);

            bool everyStageRolledBack = true;
            foreach (GameSaveRepositoryFault fault in Enum.GetValues<GameSaveRepositoryFault>().Where(value => value != GameSaveRepositoryFault.None))
            {
                repository.InjectedFault = fault;
                try
                {
                    repository.CommitCurrent(third);
                    everyStageRolledBack = false;
                }
                catch (IOException)
                {
                    GameSaveSlots afterFault = repository.ReadSlots();
                    everyStageRolledBack &= afterFault == rotated
                        && !global::Godot.FileAccess.FileExists(repository.TemporaryPath);
                }
                finally
                {
                    repository.InjectedFault = GameSaveRepositoryFault.None;
                }
            }
            Check(everyStageRolledBack, "Every injected write boundary restores both committed slots exactly.", failures);

            var interrupted = new GodotGameSaveRepository(
                validator,
                directory,
                GameSaveRepositoryFault.BeforeCurrentPromote,
                simulateProcessInterruption: true);
            try
            {
                interrupted.CommitCurrent(third);
            }
            catch (IOException)
            {
                // A new repository instance below represents process restart.
            }
            GameSaveSlots repaired = new GodotGameSaveRepository(validator, directory).ReadSlots();
            Check(
                repaired.Current == third && repaired.Recovery == second
                    && !global::Godot.FileAccess.FileExists(repository.TemporaryPath),
                "Startup repair completes a validated transaction interrupted after recovery rotation.",
                failures);

            GameSaveSlots beforeInvalid = repository.ReadSlots();
            bool invalidRejected = false;
            try
            {
                repository.CommitCurrent("{not-json");
            }
            catch (InvalidDataException)
            {
                invalidRejected = true;
            }
            Check(
                invalidRejected && repository.ReadSlots() == beforeInvalid,
                "An invalid candidate cannot mutate current or recovery.",
                failures);

            WriteGodotText(repository.CurrentPath, "{corrupt-current");
            repository.CommitCurrent(SaveFixture("fourth"));
            GameSaveSlots afterCorruptCurrent = repository.ReadSlots();
            Check(
                afterCorruptCurrent.Current == SaveFixture("fourth")
                    && afterCorruptCurrent.Recovery == second,
                "A corrupt current save is replaced without overwriting known-good recovery.",
                failures);

            WriteGodotText(repository.CurrentPath, "{corrupt-current");
            Check(
                repository.PromoteRecovery() == second
                    && repository.ReadSlots() == new GameSaveSlots(second, second),
                "Recovery promotion never rotates a corrupt current over the selected recovery.",
                failures);

            repository.CommitCurrent(SaveFixture("fifth"));
            repository.ClearCurrent();
            Check(
                repository.ReadSlots() == new GameSaveSlots(null, SaveFixture("fifth")),
                "New Game clearing preserves a valid current document as recovery.",
                failures);

            repository.PutRecovery(SaveFixture("sixth"));
            Check(
                repository.ReadSlots() == new GameSaveSlots(null, SaveFixture("sixth")),
                "Explicit recovery writes validate and replace only the recovery slot.",
                failures);

            var interruptedRecovery = new GodotGameSaveRepository(
                validator,
                directory,
                GameSaveRepositoryFault.AfterTemporaryFlush,
                simulateProcessInterruption: true);
            try
            {
                interruptedRecovery.PutRecovery(SaveFixture("seventh"));
            }
            catch (IOException)
            {
                // Restart cleanup below must abort this incomplete recovery-only write.
            }
            GameSaveSlots afterRecoveryInterruption = new GodotGameSaveRepository(validator, directory).ReadSlots();
            Check(
                afterRecoveryInterruption == new GameSaveSlots(null, SaveFixture("sixth"))
                    && !global::Godot.FileAccess.FileExists(repository.RecoveryTemporaryPath),
                "An interrupted recovery-only write is discarded without inventing a current save.",
                failures);

            repository.ClearCurrent(preserveAsRecovery: false);
            Check(
                repository.ReadSlots().Recovery == SaveFixture("sixth"),
                "Clearing an absent current without preservation leaves recovery unchanged.",
                failures);

            repository.DeleteOwnedFiles();
            Check(
                !global::Godot.FileAccess.FileExists(repository.CurrentPath)
                    && !global::Godot.FileAccess.FileExists(repository.RecoveryPath)
                    && !global::Godot.FileAccess.FileExists(repository.TemporaryPath),
                "Integration cleanup removes every repository-owned file.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Game-save repository integration threw {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            repository.InjectedFault = GameSaveRepositoryFault.None;
            repository.SimulateProcessInterruption = false;
            repository.DeleteOwnedFiles();
        }
    }

    private static void CheckImportBackupStore(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        try
        {
            GodotGameSaveImportBackupStore store = compositionRoot.ImportBackupStore
                ?? throw new InvalidOperationException("Import backup store is unavailable.");
            byte[] original = "{\"schemaVersion\":1,\"original\":true}\n"u8.ToArray();
            string path = store.StoreOriginal(
                original,
                "fixture/import",
                DateTimeOffset.Parse("2026-08-09T14:30:00Z"));
            Check(
                path.StartsWith(store.DirectoryPath, StringComparison.Ordinal)
                    && path.EndsWith("-fixture-import.json", StringComparison.Ordinal),
                "Import backup paths retain a stable timestamp and sanitized save ID.",
                failures);
            Check(
                global::Godot.FileAccess.GetFileAsBytes(path).SequenceEqual(original),
                "Import backup storage preserves the exact original bytes.",
                failures);
            store.DeleteOwnedFiles();
            Check(
                !System.IO.Directory.Exists(ProjectSettings.GlobalizePath(store.DirectoryPath)),
                "Integration cleanup removes the import-backup directory.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Import backup integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static string SaveFixture(string id) => $"{{\"format\":\"integration-save\",\"id\":\"{id}\"}}";

    private static void WriteGodotText(string path, string text)
    {
        using global::Godot.FileAccess? writer = global::Godot.FileAccess.Open(path, global::Godot.FileAccess.ModeFlags.Write);
        if (writer is null) throw new IOException($"Could not write integration fixture {path}.");
        writer.StoreString(text);
        writer.Flush();
    }

    private sealed class IntegrationSaveValidator : IGameSaveDocumentValidator
    {
        public string ValidateAndNormalize(string document)
        {
            try
            {
                using JsonDocument parsed = JsonDocument.Parse(document);
                if (parsed.RootElement.ValueKind != JsonValueKind.Object
                    || !parsed.RootElement.TryGetProperty("format", out JsonElement format)
                    || format.GetString() != "integration-save"
                    || !parsed.RootElement.TryGetProperty("id", out JsonElement id)
                    || string.IsNullOrWhiteSpace(id.GetString()))
                {
                    throw new InvalidDataException("The integration save fixture is incomplete.");
                }
                return JsonSerializer.Serialize(parsed.RootElement);
            }
            catch (JsonException error)
            {
                throw new InvalidDataException("The integration save fixture is not valid JSON.", error);
            }
        }
    }

    private static void CheckCapabilityFailureContract(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        DesktopCapabilityReport forcedFailure = new DesktopCapabilityChecker(
            compositionRoot.SessionScene,
            [DesktopCapabilityIds.ProjectResources]).Check();
        Check(
            !forcedFailure.Compatible
                && forcedFailure.Failures.Any(failure => failure.Id == DesktopCapabilityIds.ProjectResources),
            "A failed required-resource probe makes the desktop report incompatible.",
            failures);

        try
        {
            forcedFailure.AssertCompatible(BootStageIds.CapabilityChecks, "Check desktop capabilities");
            Check(false, "An incompatible desktop report fails the responsible boot stage.", failures);
        }
        catch (BootStageException error)
        {
            Check(
                error.Code == "INCOMPATIBLE_DESKTOP" && error.Actions.Count > 0,
                "An incompatible desktop report fails actionably before session construction.",
                failures);
        }
    }

    private static void CheckSettingsAndInputMap(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        try
        {
            SettingsStore settings = compositionRoot.SettingsAuthority
                ?? throw new InvalidOperationException("Settings authority is unavailable.");
            GodotSettingsStorage storage = compositionRoot.SettingsStorage
                ?? throw new InvalidOperationException("Settings storage is unavailable.");
            GodotInputMapAdapter adapter = compositionRoot.InputMapAdapter
                ?? throw new InvalidOperationException("InputMap adapter is unavailable.");

            Check(settings.Loaded, "Settings bootstrap loads the validated domain authority.", failures);
            Check(
                storage.CurrentPath.StartsWith("user://integration/settings-", StringComparison.Ordinal),
                "Headless integration isolates its settings file under user://integration.",
                failures);
            Check(adapter.Started && adapter.OwnedActionCount == 111, "InputMap publishes 45 aggregate and 66 stable-slot actions.", failures);
            Check(
                ControlContexts.All.All(context =>
                    ControlBindingCatalog.DefaultBindings[context].Keys.All(action =>
                        InputMap.HasAction(GodotInputMapAdapter.GetActionName(context, action)))),
                "Every action in all seven contexts has a namespaced InputMap owner.",
                failures);

            StringName vehicleInteract = GodotInputMapAdapter.GetActionName(ControlContexts.Vehicle, "INTERACT");
            Check(
                HasPhysicalKey(vehicleInteract, Key.E) && HasJoyButton(vehicleInteract, JoyButton.Y),
                "Vehicle Interact combines the validated E key with fixed gamepad Y.",
                failures);
            StringName builderAim = GodotInputMapAdapter.GetSlotActionName(ControlContexts.Builder, "AIM", 0);
            Check(
                InputMap.ActionGetEvents(builderAim).Count == 0,
                "Fixed pointer motion remains an analog source instead of a false button event.",
                failures);

            settings.SetBinding(ControlContexts.Vehicle, "INTERACT", "KeyG");
            Check(
                HasPhysicalKey(vehicleInteract, Key.G) && !HasPhysicalKey(vehicleInteract, Key.E),
                "A committed binding update reapplies InputMap immediately.",
                failures);
            SettingsLoadResult restarted = new SettingsStore(storage).Load();
            Check(
                restarted.Bindings[ControlContexts.Vehicle]["INTERACT"][0] == "KeyG",
                "Settings and bindings survive a fresh authority load from user://.",
                failures);

            var faultStorage = new GodotSettingsStorage(storage.CurrentPath, SettingsStorageFault.BeforePromote);
            var faultStore = new SettingsStore(faultStorage);
            faultStore.Load();
            double priorScale = faultStore.Get<double>("textScale");
            bool interrupted = false;
            try
            {
                faultStore.Set("textScale", 1.1);
            }
            catch (IOException)
            {
                interrupted = true;
            }
            Check(
                interrupted && faultStore.Get<double>("textScale") == priorScale,
                "An interrupted settings promotion cannot mutate the live snapshot.",
                failures);
            SettingsLoadResult afterInterruption = new SettingsStore(storage).Load();
            Check(
                afterInterruption.Bindings[ControlContexts.Vehicle]["INTERACT"][0] == "KeyG"
                    && !global::Godot.FileAccess.FileExists(storage.TemporaryPath),
                "An interrupted settings promotion preserves current and removes its temporary file.",
                failures);

            settings.ResetContext(ControlContexts.Vehicle);
            Check(
                HasPhysicalKey(vehicleInteract, Key.E) && !HasPhysicalKey(vehicleInteract, Key.G),
                "Resetting one context restores its default InputMap events.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Settings/InputMap integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static bool HasPhysicalKey(StringName action, Key key) =>
        InputMap.ActionGetEvents(action)
            .OfType<InputEventKey>()
            .Any(input => input.PhysicalKeycode == key);

    private static bool HasJoyButton(StringName action, JoyButton button) =>
        InputMap.ActionGetEvents(action)
            .OfType<InputEventJoypadButton>()
            .Any(input => input.ButtonIndex == button);
}
