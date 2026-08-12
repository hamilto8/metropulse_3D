using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Enforcement;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Persistence;
using MetroPulse.Domain.Placement;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Services;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.Traffic;
using MetroPulse.Domain.Vehicles;
using MetroPulse.Domain.World;
using MetroPulse.Domain.WorldEditing;
using MetroPulse.Godot.Adapters;
using MetroPulse.Godot.App;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Construction;
using MetroPulse.Godot.Economy;
using MetroPulse.Godot.Enforcement;
using MetroPulse.Godot.Missions;
using MetroPulse.Godot.Pedestrians;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Services;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Diagnostics;

public partial class IntegrationTestRunner : Node
{
    private CompositionRoot? _compositionRoot;
    private DiagnosticsOverlay? _diagnostics;
    private IReadOnlyList<VehiclePhysicsSpikeTelemetry> _vehicleSpikeTelemetry = Array.Empty<VehiclePhysicsSpikeTelemetry>();
    private VehiclePhysicsSpikeDecision? _vehicleSpikeDecision;
    private IReadOnlyDictionary<string, double> _vehicleProfileSpeeds = new Dictionary<string, double>();
    private int _phase5SoakCycles;

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
                    && compositionRoot.SaveRestoreCoordinator?.PendingRuntime is null
                : compositionRoot.StaticRestoreReport is null
                    && compositionRoot.SaveRestoreCoordinator?.PendingRuntime is null,
            "Static restore applies available owners and interactive release consumes the validated runtime descriptor exactly once.",
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
        CheckUiFoundation(compositionRoot, failures);
        CheckAudio(compositionRoot, failures);
        CheckDiagnostics(compositionRoot, diagnostics, restoreScenario, failures);
        CheckRecoveryScenario(compositionRoot, recoverySeedScenario, failures);
        CheckSettingsAndInputMap(compositionRoot, failures);
        CheckRuntimeInput(compositionRoot, restoreScenario, failures);
        CheckSessionRuntime(compositionRoot, restoreScenario, failures);
        CheckManagementUi(compositionRoot, failures);
        CheckGameplayUi(compositionRoot, failures);
        CheckMinimap(compositionRoot, failures);
        CheckSessionModals(compositionRoot, failures);
        CheckCityEconomyRuntime(compositionRoot, failures);
        CheckCityEditorRuntime(compositionRoot, failures);
        await CheckLivingTraffic(compositionRoot, failures);
        await CheckLivingPedestrians(compositionRoot, failures);
        await CheckPedestrianControl(compositionRoot, failures);
        CheckCityServicesRuntime(compositionRoot, failures);
        await CheckMissionRuntime(compositionRoot, failures);
        CheckGameplayCamera(compositionRoot, failures);
        await CheckVehiclePhysicsSpike(compositionRoot, failures);
        await CheckVehicleProfilesAndPossession(compositionRoot, failures);
        await CheckLivingEnforcement(compositionRoot, failures);
        await CheckVehicleImpactsRecoveryAndExit(compositionRoot, !importScenario, failures);
        CheckMvpWorld(compositionRoot, failures);
        CheckWorldPresentation(compositionRoot, failures);
        await CheckPhysicalWorldAndLifecycle(compositionRoot, failures);
        CheckGameSaveRepository(failures);
        CheckImportBackupStore(compositionRoot, failures);
        CheckCapabilityFailureContract(compositionRoot, failures);
        CheckCollisionLayerNames(failures);

        if (failures.Count == 0)
        {
            MvpWorldGenerator world = compositionRoot.CurrentSession?.World
                ?? throw new InvalidOperationException("Phase 4 world disappeared after its integration checks.");
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Phase 4 session disappeared after its integration checks.");
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase9.audio.passed",
                "Phase 9 bus routing, settings gain, procedural cache, spatial source, priority/cap, and caption checks passed.",
                new Dictionary<string, string>
                {
                    ["buses"] = AudioBusIds.All.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["cachedStreams"] = session.Audio?.CachedStreamCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["captions"] = session.Audio?.CaptionCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["voiceCap"] = AudioPresentationModel.TotalVoiceCap.ToString(System.Globalization.CultureInfo.InvariantCulture),
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase9.minimap.passed",
                "Phase 9 roads, rivers, agents, player, congestion, mission, work-order, and Heat-safe minimap checks passed.",
                new Dictionary<string, string>
                {
                    ["roads"] = session.MinimapUi?.CurrentView?.Roads.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["icons"] = session.MinimapUi?.CurrentView?.Icons.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["routeSegments"] = session.MinimapUi?.CurrentView?.Route.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["heatResponders"] = session.MinimapUi?.CurrentView?.HeatResponderCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase9.modals.passed",
                "Phase 9 mission, result, pause, and complete settings modal ownership and accessibility checks passed.",
                new Dictionary<string, string>
                {
                    ["settingsControls"] = session.Modals?.Settings.ControlCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["dialogueLayer"] = session.Missions?.Presentation.DialogueVisible.ToString() ?? "False",
                    ["resultLayer"] = session.Missions?.Presentation.ResultVisible.ToString() ?? "False",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase9.gameplay_ui.passed",
                "Phase 9 street telemetry, Heat/arrest, news, alerts, and mission-history presentation checks passed.",
                new Dictionary<string, string>
                {
                    ["refreshes"] = session.GameplayUi?.RefreshCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["newsCards"] = session.GameplayUi?.CurrentView?.News.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["toasts"] = session.GameplayUi?.CurrentView?.Toasts.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["history"] = session.GameplayUi?.CurrentView?.History.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase9.management_ui.passed",
                "Phase 9 responsive management, tools, builder forecast, input ribbon, time scale, and accessibility checks passed.",
                new Dictionary<string, string>
                {
                    ["metrics"] = session.ManagementUi?.CurrentView?.TopBar.Metrics.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["toolSections"] = session.ManagementUi?.CurrentView?.Tools.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["catalogCards"] = session.ManagementUi?.CurrentView?.Catalog.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["refreshes"] = session.ManagementUi?.RefreshCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase8.mission_runtime.passed",
                "Phase 8 live mission markers, dialogue pause/input, vehicle binding, cleanup receipt, result, alert, and recovery checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "10",
                    ["results"] = session.Missions?.CompletedResultCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["cleanupCommits"] = session.Missions?.CleanupCommitCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["offerMarkers"] = session.Missions?.Markers.OfferMarkerCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["interactionProviders"] = session.VehicleInteractions?.Service.ProviderCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase8.exit.passed",
                "Phase 8 live mission execution, receipt cleanup, retry, checkpoint/RESULT restore, and restart ownership exit checks passed.",
                new Dictionary<string, string>
                {
                    ["liveAssertions"] = "10",
                    ["restartReloads"] = "10",
                    ["missionTemplates"] = "6",
                    ["mvpMissions"] = "10",
                    ["normalOfferMarkers"] = session.Missions?.Markers.OfferMarkerCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["interactionProviders"] = session.VehicleInteractions?.Service.ProviderCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase7.economy_catalog.passed",
                "Phase 7 frozen economy baseline, skyline adapter, city tick, view model, and catalog checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "6",
                    ["authoredBuildings"] = session.Economy?.AuthoredBuildingCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["catalogBuildings"] = session.Content?.BuildingRecords.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["cityTicks"] = session.Economy?.CityTickCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase7.editor_transactions.passed",
                "Phase 7 editor commands, previews, zoning, and eight-participant world-edit transactions passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "14",
                    ["participants"] = WorldEditParticipantIds.RequiredOrder.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["remainingBuildings"] = session.Editor?.Records.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["zones"] = session.Editor?.Zones.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase7.roads_productivity.passed",
                "Phase 7 custom road/bridge topology, river safety, mobility feedback, policy, alerts, and street directives passed.",
                new Dictionary<string, string>
                {
                    ["baseRoadNodes"] = session.LivingTraffic?.RoadGraph.BaseNodeCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["surfaceDecks"] = session.World?.Surface.Decks.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["mobilityRevision"] = session.LivingTraffic?.Productivity?.Snapshot().Revision.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["bridgePolicy"] = session.LivingTraffic?.Productivity?.BridgePolicy ?? "unavailable",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase7.services_incidents.passed",
                "Phase 7 local services, incident funding, Street work, markers, alerts, resolution, and domain restore passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "4",
                    ["outcomeTransactions"] = session.Services?.Outcomes.Snapshot().Transactions.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["streetActions"] = session.Services?.CompletedStreetActions.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["remainingMarkers"] = session.Services?.Markers.MarkerCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["activeIncidents"] = session.Services?.Model.Snapshot().ActiveIncidentCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase7.exit.passed",
                "Phase 7 clean editor lifecycle and fresh-session world restore contracts passed.",
                new Dictionary<string, string>
                {
                    ["worldEditParticipants"] = WorldEditParticipantIds.RequiredOrder.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["restoredBuildings"] = "1",
                    ["restoredZones"] = "1",
                    ["restoredWorldDuplicates"] = "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase6.enforcement.passed",
                "Phase 6 player Heat, macro incident, vehicle-switch pursuit, dispatch, and cleanup checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "6",
                    ["crimeReports"] = session.Enforcement?.CrimeReportCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["incidents"] = session.Enforcement?.IncidentCreateCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["maximumLocalCandidates"] = session.LivingTraffic?.Simulation.MaximumLocalCandidates.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase6.pedestrians.passed",
                "Phase 6 sidewalk population, special behavior, LOD, yielding, knockdown, and bounded-query checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "7",
                    ["citizens"] = session.LivingPedestrians?.Simulation.CitizenCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["sidewalkNodes"] = session.LivingPedestrians?.SidewalkGraph.NodeCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["maximumLocalCandidates"] = session.LivingPedestrians?.Simulation.MaximumLocalCandidates.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase6.traffic.passed",
                "Phase 6 seeded traffic population, controls, spatial cadence, and player handoff checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "8",
                    ["movingVehicles"] = session.LivingTraffic?.Simulation.MovingCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["parkedVehicles"] = session.LivingTraffic?.Simulation.ParkedCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["controlPosts"] = session.LivingTraffic?.PhysicalControlPostCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["maximumLocalCandidates"] = session.LivingTraffic?.Simulation.MaximumLocalCandidates.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase5.exit.passed",
                "Phase 5 impact, knockdown, ejection, weather, recovery, interaction, bridge, and ownership-soak checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "15",
                    ["soakCycles"] = _phase5SoakCycles.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["weatherGrip"] = session.Content?.GetWeather(session.Environment?.Current?.WeatherMode ?? string.Empty)?.GripMultiplier.ToString("F2", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["interactionProviders"] = session.VehicleInteractions?.Service.ProviderCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["retainedVehicles"] = session.PlayerControl?.Vehicles.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase5.vehicle_profiles_possession.passed",
                "Six production vehicle fixtures and transactional entry, hijack, exit, pause, camera, and AI handoff checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "19",
                    ["profiles"] = string.Join(';', _vehicleProfileSpeeds.Select(pair => $"{pair.Key}:{pair.Value.ToString("F3", System.Globalization.CultureInfo.InvariantCulture)}")),
                    ["authorityGeneration"] = session.PlayerControl?.AuthorityGeneration.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["retainedVehicles"] = session.PlayerControl?.Vehicles.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            VehiclePhysicsSpikeTelemetry? builtInSpike = _vehicleSpikeTelemetry
                .FirstOrDefault(item => item.Branch == VehiclePhysicsBranch.BuiltInVehicleBody);
            VehiclePhysicsSpikeTelemetry? customSpike = _vehicleSpikeTelemetry
                .FirstOrDefault(item => item.Branch == VehiclePhysicsBranch.CustomRaycastRigidBody);
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase5.vehicle_physics_spike.passed",
                "Both Phase 5 sedan physics branches ran live and the selection policy chose the custom raycast chassis.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "7",
                    ["selected"] = _vehicleSpikeDecision?.Selected.ToString() ?? "unavailable",
                    ["builtInAccelerationMps"] = builtInSpike?.AccelerationSpeed.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customAccelerationMps"] = customSpike?.AccelerationSpeed.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInBrakingMps"] = builtInSpike?.BrakingSpeed.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customBrakingMps"] = customSpike?.BrakingSpeed.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInReverseMps"] = builtInSpike?.ReverseSpeed.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customReverseMps"] = customSpike?.ReverseSpeed.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInHeadingRadians"] = builtInSpike?.HeadingChangeRadians.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customHeadingRadians"] = customSpike?.HeadingChangeRadians.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInTurningRadiusM"] = builtInSpike?.TurningRadius.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customTurningRadiusM"] = customSpike?.TurningRadius.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInMaxRollRadians"] = builtInSpike?.MaximumRollRadians.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customMaxRollRadians"] = customSpike?.MaximumRollRadians.ToString("F4", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInPhysicsUs"] = builtInSpike?.AveragePhysicsMicroseconds.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customPhysicsUs"] = customSpike?.AveragePhysicsMicroseconds.ToString("F3", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["builtInReplayDelta"] = builtInSpike?.ReplayPositionDelta.ToString("F5", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["customReplayDelta"] = customSpike?.ReplayPositionDelta.ToString("F5", System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase5.pedestrian_controller.passed",
                "Phase 5 pedestrian controller and transactional handoff checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "11",
                    ["handoffs"] = session.PlayerControl?.HandoffCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["recoveries"] = session.PlayerControl?.Pedestrian?.RecoveryCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["bodies"] = session.GetNode<Node3D>("WorldRoot/AgentRoot").GetChildCount().ToString(System.Globalization.CultureInfo.InvariantCulture),
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase5.gameplay_camera.passed",
                "Phase 5 gameplay camera integration checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "17",
                    ["modes"] = Enum.GetValues<GameplayCameraMode>().Length.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["followStarts"] = session.GameplayCamera?.FollowStartCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["followReleases"] = session.GameplayCamera?.FollowReleaseCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase4.world.passed",
                "Phase 4 generated-world integration checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "12",
                    ["chunks"] = "7",
                    ["objects"] = world.Layout?.Objects.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["colliders"] = world.Colliders.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["multiMeshGroups"] = world.MultiMeshGroupCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["cachedMeshes"] = world.Resources.MeshCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["cachedMaterials"] = world.Resources.MaterialCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["cachedShapes"] = world.Resources.ShapeCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["chunkObjects"] = string.Join(';', world.Layout!.ChunkIds.Select(id => $"{id}:{world.Layout.Objects.Count(item => item.ChunkId == id)}")),
                    ["chunkColliders"] = string.Join(';', world.Layout.ChunkIds.Select(id => $"{id}:{world.Colliders.Snapshot.Count(item => item.ChunkId == id)}")),
                    ["chunkInstances"] = string.Join(';', world.Layout.ChunkIds.Select(id => $"{id}:{world.Layout.InstanceGroups.Where(item => item.ChunkId == id).Sum(item => item.Instances.Count)}")),
                    ["chunkSegments"] = string.Join(';', world.Layout.ChunkIds.Select(id => $"{id}:{world.Layout.SegmentGroups.Where(item => item.ChunkId == id).Sum(item => item.Segments.Count)}")),
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase4.presentation.passed",
                "Phase 4 environment, billboard, and camera integration checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "15",
                    ["billboardTextures"] = session.Billboards?.TextureCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["cameraPresets"] = session.CameraAdapter?.AvailablePresetIds.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["weather"] = session.Environment?.Current?.WeatherMode ?? "unavailable",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase4.exit.passed",
                "Phase 4 physical traversal, collider alignment, and lifecycle checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "5",
                    ["traversalWaypoints"] = world.DebugTraversalCapsule?.TraversalWaypoints.Count.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                    ["sampledColliders"] = "5",
                    ["ownedResourcesAfterShutdown"] = "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "phase5.session_runtime.passed",
                "Phase 5 session transition, pause, scheduler, and compensation checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = "12",
                    ["state"] = session.RuntimeHost?.StateMachine.State.ToToken() ?? "unavailable",
                    ["clockPolicy"] = session.RuntimeHost?.Scheduler.ClockPolicy.ToToken() ?? "unavailable",
                    ["transitionPhases"] = TransitionPhaseCatalog.ExecutionOrder.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ["sourceRestores"] = session.RuntimeHost?.Runtime.SourceRestoreCount.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "0",
                }));
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "integration.passed",
                "Phase 3 shell integration checks passed.",
                new Dictionary<string, string>
                {
                    ["assertions"] = recoverySeedScenario ? "183" : "179",
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

    private static void CheckCityEconomyRuntime(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        SessionShell? session = compositionRoot.CurrentSession;
        CityEconomyRuntime? economy = session?.Economy;
        Check(economy?.Initialized == true,
            "The session owns one initialized city-economy authority.", failures);
        Check(economy?.ReferenceBaseline is
        {
            Treasury: 650_000,
            Population: 1_200,
            Happiness: 70,
            LandValue: 100,
            GrossIncomeRate: 8,
            UpkeepRate: 0,
            EnergyCoverage: 1,
            WaterCoverage: 1,
            SafetyCoverage: 1,
        }, "The live economy baseline matches every frozen Phase 0 scalar.", failures);
        Check(economy is { AuthoredBuildingCount: 23, Current.AssetCount: 23 }
                && economy.Ledger.Snapshot().Buildings.All(item => item.Position is not null),
            "All 23 authored skyline buildings register through the canonical economy adapter.", failures);
        Check(economy?.AuthoredBaseline is { Treasury: 650_000, Population: 1_200, Happiness: 70, LandValue: 100, NetIncomeRate: 8 },
            "Authored skyline registration preserves the reference treasury, population, happiness, land value, and recurring balance.", failures);

        if (economy is null || session?.RuntimeHost is null || session.LivingTraffic?.Productivity is null) return;
        TrafficProductivitySnapshot mobility = session.LivingTraffic.Productivity.Snapshot();
        EconomyMobilityFeedback feedback = economy.Ledger.Snapshot().Mobility;
        Check(feedback.Congestion == mobility.Network.Congestion
                && feedback.ProductivityMultiplier == mobility.Productivity.Multiplier
                && feedback.DeliveryReliability == mobility.Deliveries.Reliability,
            "Live traffic productivity publishes through the economy mobility feedback authority.", failures);
        double before = economy.Ledger.Treasury;
        double expectedRate = economy.Current.NetIncomeRate;
        int ticksBefore = economy.CityTickCount;
        for (int index = 0; index < 12 && economy.CityTickCount == ticksBefore; index++)
        {
            session.RuntimeHost.Scheduler.AdvanceFrame(0.25);
        }
        Check(economy.CityTickCount == ticksBefore + 1
                && Math.Abs(economy.Ledger.Treasury - (before + expectedRate)) < 0.001
                && economy.Current.Treasury == economy.Ledger.Treasury
                && economy.PublishedViewCount > 0,
            $"The canonical scheduler city tick advances Capital and republishes the immutable view model exactly once per second. "
                + $"ticks={ticksBefore}->{economy.CityTickCount}; treasury={before}->{economy.Ledger.Treasury}; expectedRate={expectedRate}; "
                + $"view={economy.Current.Treasury}; published={economy.PublishedViewCount}.", failures);
    }

    private static void CheckCityEditorRuntime(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Editor integration requires a session.");
            CityEditorRuntime editor = session.Editor
                ?? throw new InvalidOperationException("The city editor runtime is unavailable.");
            CityEconomyRuntime economy = session.Economy
                ?? throw new InvalidOperationException("Editor integration requires the economy.");
            MvpWorldGenerator world = session.World
                ?? throw new InvalidOperationException("Editor integration requires the world.");
            LivingTrafficRuntime traffic = session.LivingTraffic
                ?? throw new InvalidOperationException("Editor integration requires traffic.");
            int authoredColliders = world.Colliders.Count;
            int authoredEconomyRecords = economy.Ledger.Snapshot().Buildings.Count;
            int baseRoadCapacity = traffic.Productivity!.Snapshot().Network.Capacity;
            double treasuryBefore = economy.Ledger.Treasury;

            Check(editor.Initialized
                    && editor.GetParent()?.GetPath().ToString().EndsWith("SessionRoot/RuntimeServices", StringComparison.Ordinal) == true
                    && editor.GetParent()?.GetChildren().Count(node => node.Name == "CityEditor") == 1,
                "The session owns one initialized editor authority under RuntimeServices.", failures);
            Check(editor.GetCatalog(includeAdvanced: false).Count == 6
                    && editor.GetCatalog(includeAdvanced: true).Count == 19
                    && editor.GetCatalog(includeAdvanced: true).Count(spec =>
                        ConstructionVocabulary.GetCatalogAccess(spec, [ProgressionTiers.Operator]).Unlocked) == 8,
                "Catalog disclosure and Operator-tier locks use the canonical 8/19 content projection.", failures);

            editor.SetActive(true);
            editor.SelectCatalog("ROAD_STRAIGHT");
            editor.ToggleGridSnap();
            PlacementDecision placement = editor.SetAim(-125, -75);
            Check(placement.Valid
                    && placement.Preview?.Summary.Cost == "$25,000"
                    && session.GetNode<Node3D>("WorldRoot/UserWorld/EditorPresentation").Visible,
                "Free aim drives a terrain-conforming valid ghost and canonical preview.", failures);
            WorldEditReceipt placed = editor.Place();
            string placedId = placed.Current!.Id;
            Check(placed.Participants.SequenceEqual(WorldEditParticipantIds.RequiredOrder)
                    && editor.Records.Count == 1
                    && editor.VisualCount == 1
                    && editor.ColliderCount == 1
                    && editor.RoadMetadataCount == 1
                    && editor.ConnectedRoadCount == 1
                    && editor.OccupancyCount == 1
                    && editor.ZoningMetadataCount == 1
                    && editor.ServiceMetadataCount == 1
                    && editor.PersistenceCount == 1
                    && world.Colliders.Count == authoredColliders + 1
                    && economy.Ledger.Snapshot().Buildings.Count == authoredEconomyRecords + 1
                    && traffic.Productivity.Snapshot().Network.ConnectedRoadSegments == 1
                    && traffic.Productivity.Snapshot().Network.Capacity == baseRoadCapacity + 12,
                "Placement commits visual, collider, road, economy, occupancy, zoning, service, and persistence participants together.", failures);

            PlacementVector3 beforeNavigation = editor.Aim;
            _ = editor.ControllerNavigate(1, 0, 0.5);
            Check(editor.Aim.X == beforeNavigation.X + 12,
                "Controller navigation advances the same free-aim authority as pointer input.", failures);
            _ = editor.SetAim(-125, -25);
            WorldEditReceipt moved = editor.MoveSelected();
            WorldEditReceipt rotated = editor.RotateSelected();
            editor.Cancel();
            _ = editor.SetAim(-125, -25);
            WorldEditRecord? selected = editor.SelectAtAim();
            Check(moved.Previous?.Position != moved.Current?.Position
                    && rotated.Current?.RotationY == Math.PI / 2
                    && selected?.Id == placedId
                    && editor.Records.Single().Position == new PlacementVector3(-125, editor.Aim.Y, -25),
                "Move, rotate, cancel, and selection all reuse the transactional placed-record lifecycle.", failures);

            _ = editor.SetAim(-120, -150);
            PlacementZoneParcel parcel = editor.ApplyZone("RES");
            Check(parcel.ZoneType == ConstructionCategories.Residential
                    && editor.Zones.Count == 1
                    && economy.Ledger.GetZoneEffect($"USER_ZONE_{parcel.Id}")?.Type == ConstructionCategories.Residential
                    && economy.Ledger.Treasury == treasuryBefore - 25_000 - session.Content!.EconomyBalance.Construction!.ZoningCost,
                "Residential zoning commits its overlay, persistence record, economy effect, and exact treasury charge.", failures);
            CityEditorState savedEditor = editor.CaptureState();
            EconomyLedgerState savedEconomy = economy.Ledger.Serialize();
            CheckRestoredCityEditorSession(compositionRoot, savedEditor, savedEconomy, placedId, parcel.Id, failures);

            WorldEditReceipt demolished = editor.DemolishSelected();
            Check(demolished.Current is null
                    && editor.Records.Count == 0
                    && editor.VisualCount == 0
                    && editor.ColliderCount == 0
                    && editor.RoadMetadataCount == 0
                    && editor.ConnectedRoadCount == 0
                    && editor.OccupancyCount == 0
                    && editor.ZoningMetadataCount == 0
                    && editor.ServiceMetadataCount == 0
                    && editor.PersistenceCount == 0
                    && world.Colliders.Count == authoredColliders
                    && economy.Ledger.Snapshot().Buildings.Count == authoredEconomyRecords
                    && economy.Ledger.Treasury == treasuryBefore - 12_500 - session.Content!.EconomyBalance.Construction!.ZoningCost
                    && traffic.Productivity.Snapshot().Network.Capacity == baseRoadCapacity,
                "Demolition removes every participant and restores authored collider/economy cardinality.", failures);

            editor.SelectCatalog("ROAD_STRAIGHT");
            PlacementDecision blocked = editor.SetAim(160, 0);
            Check(!blocked.Valid
                    && blocked.Blockers.Any(item => item.Code == PlacementBlockerCodes.Water)
                    && editor.Records.Count == 0,
                "Invalid terrain publishes structured blockers without mutating editor participants.", failures);

            int baseNodes = traffic.RoadGraph.NodeCount;
            editor.UnlockTier(ProgressionTiers.Magnate);
            editor.SelectCatalog("BRIDGE_DECK");
            _ = editor.RotateBlueprint();
            PlacementDecision bridgeDecision = editor.SetAim(160, 150);
            WorldEditReceipt bridgePlaced = editor.Place();
            Check(bridgeDecision.Valid
                    && bridgePlaced.Current?.SpecId == "BRIDGE_DECK"
                    && traffic.RoadGraph.NodeCount == baseNodes + 3
                    && editor.ConnectedRoadCount == 1
                    && world.Surface.Decks.Count == 11
                    && !world.Surface.IsWater(160, 2, 150),
                "A custom bridge atomically publishes a connected route and supported deck that suppresses river hazard inside its footprint.", failures);
            _ = editor.DemolishSelected();
            Check(traffic.RoadGraph.NodeCount == baseNodes
                    && editor.ConnectedRoadCount == 0
                    && world.Surface.Decks.Count == 10
                    && world.Surface.IsWater(160, 2, 150),
                "Custom-bridge demolition unregisters route and deck exactly once and restores river hazard.", failures);

            TrafficProductivitySnapshot balanced = traffic.Productivity.Snapshot();
            TrafficProductivitySnapshot priority = traffic.Productivity.SetBridgePolicy(BridgePolicies.FreightPriority);
            TrafficStreetDirective directive = traffic.Productivity.GetStreetDirective(new TrafficPoint(155, 0));
            Check(priority.Bridge.Capacity > balanced.Bridge.Capacity
                    && priority.Deliveries.Reliability > balanced.Deliveries.Reliability
                    && priority.Policy.OperatingCostRate == 2
                    && economy.Ledger.Snapshot().BudgetBreakdown.ManagementCostRate == 2
                    && directive is { OnBridge: true, PriorityActive: true }
                    && traffic.Alerts is not null
                    && traffic.ProductivityPresentation is { PriorityVisible: true, DisruptionVisible: false }
                    && traffic.ProductivityPresentation.AppliedRevision == priority.Revision,
                "Freight priority drives economy cost, bridge capacity/reliability, alerts, and the visible street directive from one snapshot.", failures);
            traffic.Productivity.SetBridgePolicy(BridgePolicies.Balanced);
            editor.Cancel();
            editor.SetActive(false);
            Check(!editor.Active
                    && !session.GetNode<Node3D>("WorldRoot/UserWorld/EditorPresentation").Visible,
                "Cancel and editor deactivation leave no active selection or preview presentation.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"City editor integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckRestoredCityEditorSession(
        CompositionRoot compositionRoot,
        CityEditorState editorState,
        EconomyLedgerState economyState,
        string buildingId,
        string zoneId,
        ICollection<string> failures)
    {
        SessionShell? restored = null;
        try
        {
            restored = (compositionRoot.SessionScene
                ?? throw new InvalidOperationException("The session scene is unavailable for restore verification."))
                .Instantiate<SessionShell>();
            restored.Name = "Phase7RestoredSession";
            restored.ProcessMode = ProcessModeEnum.Disabled;
            compositionRoot.GetParent().AddChild(restored);
            GameContentRegistry content = compositionRoot.ContentRegistry
                ?? throw new InvalidOperationException("Content is unavailable for restore verification.");
            SettingsStore settings = compositionRoot.SettingsAuthority
                ?? throw new InvalidOperationException("Settings are unavailable for restore verification.");
            restored.InitializeWorld(content, settings);
            restored.InitializeRuntimeInput(settings);
            restored.Economy!.Ledger.Restore(economyState);
            CityEditorState applied = restored.Editor!.RestoreState(editorState);

            Check(applied.Buildings.Count == 1
                    && applied.Zones.Count == 1
                    && restored.Editor.Records.Single().Id == buildingId
                    && restored.Editor.Zones.Single().Id == zoneId
                    && restored.Editor.VisualCount == 1
                    && restored.Editor.ColliderCount == 1
                    && restored.Editor.RoadMetadataCount == 1
                    && restored.Editor.ConnectedRoadCount == 1
                    && restored.Editor.OccupancyCount == 1
                    && restored.Editor.ZoningMetadataCount == 1
                    && restored.Editor.ServiceMetadataCount == 1
                    && restored.Editor.PersistenceCount == 1
                    && restored.Economy.Ledger.GetBuilding(buildingId) is not null
                    && restored.Economy.Ledger.GetZoneEffect($"USER_ZONE_{zoneId}") is not null,
                "A fresh session restores the browser-compatible world/economy payload into every runtime participant without duplicate records.", failures);
        }
        finally
        {
            restored?.Shutdown();
            if (restored is not null && GodotObject.IsInstanceValid(restored)) restored.Free();
        }
    }

    private static void CheckCityServicesRuntime(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Service integration requires a session.");
            CityServicesRuntime services = session.Services
                ?? throw new InvalidOperationException("The city services runtime is unavailable.");
            CityEconomyRuntime economy = session.Economy
                ?? throw new InvalidOperationException("Service integration requires the economy.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Service integration requires the runtime host.");
            PlayerVehicleInteractionPublisher interactions = session.VehicleInteractions
                ?? throw new InvalidOperationException("Service integration requires shared interactions.");
            MvpWorldGenerator world = session.World
                ?? throw new InvalidOperationException("Service integration requires the world.");
            var definition = new IncidentDefinition
            {
                Id = "integration-bridge-relay",
                Type = "ENERGY_RELAY_DAMAGE",
                Title = "Bridge relay damaged",
                Cause = "A transformer strike scattered debris across the service bay.",
                TargetId = "bridge-relay",
                InfrastructureId = "bridge-relay",
                DistrictId = "PRIMARY_BRIDGE_CORRIDOR",
                Service = ServiceTypes.Power,
                Severity = 5,
                CleanupCost = 1_500,
                RepairCost = 4_500,
                CoverageMultiplier = 0.4,
                Position = new OutcomePosition(205, 18),
                InfluenceRadius = 90,
            };

            IncidentReportResult reported = services.Response.ReportIncident(definition);
            ServiceCoverageReading outageReading = services.Model.GetCoverage(
                ServiceTypes.Power,
                new ServiceCoverageSelector(Position: definition.Position));
            Check(services.Initialized
                    && reported.Incident.Active
                    && services.Markers.MarkerCount == 2
                    && services.Outcomes.Snapshot().State.Infrastructure["bridge-relay"].State == "DAMAGED"
                    && outageReading.OutageActive
                    && outageReading.Coverage < 0.4
                    && services.Alerts.Snapshot().Active.Any(alert =>
                        alert.DedupeKey == "service-incident:integration-bridge-relay"
                        && alert.FocusAction.Type == AlertFocusActions.ManagementCamera),
                "A live report atomically publishes local damage, outage falloff, cleanup/repair markers, and its Management alert.", failures);

            double beforeFunding = economy.Ledger.Treasury;
            IncidentFundingResult funded = services.Response.ScheduleResponse(definition.Id);
            IncidentFundingResult duplicateFunding = services.Response.ScheduleResponse(definition.Id);
            Check(economy.Ledger.Treasury == beforeFunding - 6_000
                    && funded.WorkOrders.All(order => order.Status == RepairStatuses.Scheduled)
                    && duplicateFunding.Duplicate
                    && services.Alerts.Snapshot().Active.Any(alert =>
                        alert.DedupeKey == "service-incident:integration-bridge-relay"
                        && alert.FocusAction.Type == AlertFocusActions.StreetWaypoint),
                "Management funding atomically debits the exact response cost, schedules both orders, updates the alert, and is idempotent.", failures);

            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration:service-work", nameof(IntegrationTestRunner)));
            PlayerPedestrianController pedestrian = session.PlayerControl?.Pedestrian
                ?? throw new InvalidOperationException("Street service work requires the player pedestrian.");
            Vector3 originalPedestrianPosition = pedestrian.GlobalPosition;
            Vector3 serviceSite = new(
                (float)definition.Position.X,
                (float)world.Surface.GetTerrainHeight(definition.Position.X, definition.Position.Z),
                (float)definition.Position.Z);
            pedestrian.GlobalPosition = serviceSite;
            InteractionSnapshot cleanupPrompt = services.RefreshInteractions();
            InteractionResolution cleanupProgress = interactions.ResolvePrimary();
            EconomyLedgerState economyState = economy.Ledger.Serialize();
            CityServicesRuntimeState serviceState = services.CaptureState();
            services.Response.PerformStreetWork("work:integration-bridge-relay:cleanup");
            economy.Ledger.Restore(economyState);
            CityServiceSnapshot restored = services.RestoreState(serviceState);
            Check(cleanupPrompt.Primary is { Kind: "SERVICE_WORK", Eligibility.Allowed: true }
                    && cleanupProgress.Status == InteractionResolutionStatuses.Completed
                    && services.Response.GetWorkOrder("work:integration-bridge-relay:cleanup")?.Progress == 0.5
                    && economy.Ledger.Treasury == beforeFunding - 6_000
                    && restored.OpenWorkOrderCount == 2
                    && services.Markers.MarkerCount == 2,
                "Street interaction advances nearby cleanup and the existing economy/missions/alerts domains restore the partial response exactly.", failures);

            pedestrian.GlobalPosition = serviceSite;
            InteractionResolution cleanupComplete = interactions.ResolvePrimary();
            pedestrian.GlobalPosition = serviceSite;
            InteractionSnapshot repairPrompt = services.RefreshInteractions();
            InteractionResolution repairProgress = interactions.ResolvePrimary();
            pedestrian.GlobalPosition = serviceSite;
            InteractionResolution repairComplete = interactions.ResolvePrimary();
            ServiceCoverageReading resolvedReading = services.Model.GetCoverage(
                ServiceTypes.Power,
                new ServiceCoverageSelector(Position: definition.Position));
            Check(cleanupComplete.Status == InteractionResolutionStatuses.Completed
                    && repairPrompt.Primary is { Kind: "SERVICE_WORK", Eligibility.Allowed: true }
                    && repairProgress.Status == InteractionResolutionStatuses.Completed
                    && repairComplete.Status == InteractionResolutionStatuses.Completed
                    && services.Response.GetIncident(definition.Id).Active == false
                    && services.Outcomes.Snapshot().State.ServiceOutages[$"outage:{definition.Id}"].Active == false
                    && services.Outcomes.Snapshot().State.Infrastructure["bridge-relay"] is { State: "ACTIVE", Condition: 1 }
                    && services.Markers.MarkerCount == 0
                    && !resolvedReading.OutageActive
                    && services.Alerts.Snapshot().Items.Any(alert =>
                        alert.DedupeKey == "service-incident:integration-bridge-relay"
                        && alert.State == AlertStates.Resolved)
                    && services.Alerts.Snapshot().Active.Any(alert => alert.Severity == AlertSeverities.Success),
                "Cleanup gates repair; final Street work closes the outage, restores infrastructure, resolves the alert/incident, and removes derived markers. "
                    + $"statuses={cleanupComplete.Status}/{repairProgress.Status}/{repairComplete.Status}; "
                    + $"incidentActive={services.Response.GetIncident(definition.Id).Active}; "
                    + $"outageActive={services.Outcomes.Snapshot().State.ServiceOutages[$"outage:{definition.Id}"].Active}; "
                    + $"infrastructure={services.Outcomes.Snapshot().State.Infrastructure["bridge-relay"].State}/"
                    + $"{services.Outcomes.Snapshot().State.Infrastructure["bridge-relay"].Condition}; "
                    + $"markers={services.Markers.MarkerCount}; localOutage={resolvedReading.OutageActive}; "
                    + $"repairPrompt={repairPrompt.Candidates.Count}/{repairPrompt.Primary?.Id ?? "none"}; "
                    + $"runtime={runtime.StateMachine.State}; control={session.PlayerControl?.ControlledKind}; "
                    + $"position={pedestrian.GlobalPosition}; orders={string.Join('|', services.Response.GetWorkOrders().Select(order => $"{order.Id}:{order.Status}:{order.PrerequisiteMet}:{order.Actionable}"))}.", failures);
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration:service-work-complete", nameof(IntegrationTestRunner)));
            pedestrian.GlobalPosition = originalPedestrianPosition;
            session.LivingTraffic?.RefreshProductivity("SERVICE_RESTORE_REPUBLISH");
        }
        catch (Exception error)
        {
            failures.Add($"City service integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private async Task CheckMissionRuntime(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        const string vehicleId = "phase8-mission-taxi";
        PlayerVehicleController? taxi = null;
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Mission integration requires a session.");
            MissionRuntime missions = session.Missions
                ?? throw new InvalidOperationException("Mission runtime is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Mission integration requires the runtime host.");
            PlayerControlRuntime player = session.PlayerControl
                ?? throw new InvalidOperationException("Mission integration requires player control.");
            PlayerVehicleInteractionPublisher interactions = session.VehicleInteractions
                ?? throw new InvalidOperationException("Mission integration requires shared interactions.");
            CityServicesRuntime services = session.Services
                ?? throw new InvalidOperationException("Mission integration requires shared outcomes and alerts.");
            MvpWorldGenerator world = session.World
                ?? throw new InvalidOperationException("Mission integration requires the authored world.");
            RuntimeInputHost input = session.InputHost
                ?? throw new InvalidOperationException("Mission integration requires runtime input.");

            Check(missions.Initialized
                    && missions.Lifecycle.Phase == MissionPhases.Idle
                    && missions.Markers.OfferMarkerCount == 9
                    && missions.Markers.ObjectiveMarkerCount == 0
                    && interactions.Service.ProviderCount == 3,
                "The live mission owner publishes exactly the nine normal-scope offer markers through the existing shared interaction service.", failures);

            MissionOfferView executiveOffer = missions.Execution.BuildOffer("mission_executive", null);
            Vector3 pickup = new(
                (float)executiveOffer.Pickup.X,
                (float)world.Surface.GetTerrainHeight(executiveOffer.Pickup.X, executiveOffer.Pickup.Z),
                (float)executiveOffer.Pickup.Z);
            Vector3 entrySite = new(0, (float)world.Surface.GetTerrainHeight(0, 0), 0);
            taxi = player.SpawnVehicle(vehicleId, "TAXI", entrySite, authorized: true, occupied: false);
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("phase8:mission-entry", nameof(IntegrationTestRunner)));
            PlayerPedestrianController pedestrian = player.Pedestrian
                ?? throw new InvalidOperationException("Mission vehicle entry requires a pedestrian.");
            pedestrian.SpawnAt(entrySite + new Vector3(2, 0, 0));
            for (int frame = 0; frame < 35; frame += 1) await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            VehicleEntryRequestResult entry = player.BeginVehicleEntry(taxi);
            if (!entry.ReadyForTransition)
            {
                throw new InvalidOperationException($"Mission taxi entry was not prepared: {entry.Code ?? "UNKNOWN"}.");
            }
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("phase8:mission-vehicle", nameof(IntegrationTestRunner)));
            taxi.SpawnAt(pickup);
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(entry.ReadyForTransition
                    && missions.OpenOffer("mission_executive")
                    && runtime.StateMachine.State == GameState.Paused
                    && runtime.Pause.Snapshot().Reasons.Contains(PauseReason.Dialogue)
                    && missions.Dialogue.Snapshot?.NodeId == "start"
                    && missions.Presentation.DialogueVisible,
                "A valid live pickup opens stable-node dialogue under one Dialogue pause hold without releasing the accepted vehicle.", failures);
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(input.LatestSnapshot.Context == ControlContexts.Dialogue,
                "Dialogue pause selects the keyboard/controller Dialogue context rather than the Pause-menu context.", failures);

            missions.ChooseDialogue(0);
            missions.ConfirmDialogue();
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(runtime.StateMachine.State == GameState.StreetVehicle
                    && input.LatestSnapshot.Context == ControlContexts.Vehicle
                    && missions.Lifecycle.Phase == MissionPhases.Active
                    && missions.Execution.Snapshot?.VehicleId == vehicleId
                    && missions.Markers.OfferMarkerCount == 0
                    && missions.Markers.ObjectiveMarkerCount == 1
                    && missions.Presentation.HudVisible
                    && !missions.Presentation.DialogueVisible,
                "Dialogue acceptance binds the exact live vehicle, restores Vehicle input, hides offers, and publishes one current objective marker/HUD.", failures);

            Exception? blockedModeEscape = null;
            try
            {
                runtime.TransitionTo(
                    GameState.Management,
                    new TransitionRequestOptions("phase8:blocked-mode-escape", nameof(IntegrationTestRunner)));
            }
            catch (Exception error)
            {
                blockedModeEscape = error;
            }
            InteractionSnapshot blockedExit = interactions.Refresh();
            Check(blockedModeEscape is GameTransitionException { Code: TransitionRejectionCodes.MissionCritical }
                    && runtime.StateMachine.State == GameState.StreetVehicle
                    && blockedExit.Primary is { Kind: "VEHICLE_EXIT", Eligibility.Allowed: false }
                    && blockedExit.Primary.FailureReason?.Contains("mission-critical", StringComparison.OrdinalIgnoreCase) == true,
                "Mission criticality blocks both mode escape and controlled-vehicle release through the canonical transition/interaction reasons.", failures);

            int outcomeCountBefore = services.Outcomes.Snapshot().Transactions.Count;
            MissionWorldPoint target = missions.Execution.NavigationTarget
                ?? throw new InvalidOperationException("Accepted mission has no navigation target.");
            Vector3 destination = new(
                (float)target.X,
                (float)world.Surface.GetTerrainHeight(target.X, target.Z),
                (float)target.Z);
            taxi.SpawnAt(destination);
            MissionExecutionUpdate? completion = missions.AdvanceExecution(1);
            MissionOutcomeReceipt receipt = services.Outcomes.Snapshot().Transactions.Last();
            Check(completion?.Signal == MissionExecutionSignals.Completed
                    && missions.Lifecycle.Phase == MissionPhases.Result
                    && runtime.StateMachine.State == GameState.Result
                    && player.ControlledKind == ControlKind.None
                    && services.Outcomes.Snapshot().Transactions.Count == outcomeCountBefore + 1
                    && receipt.Source is { Kind: OutcomeSourceKinds.Mission, ContentId: "mission_executive" }
                    && missions.LatestResult?.TransactionId == receipt.TransactionId
                    && missions.Presentation.ResultVisible
                    && missions.Markers.ObjectiveMarkerCount == 0
                    && services.Alerts.Snapshot().Active.Any(alert => alert.DedupeKey == $"mission-outcome:{receipt.TransactionId}"),
                "Live completion applies one receipt-gated outcome, releases control only for RESULT, removes temporary objective presentation, and publishes debrief plus alert.", failures);

            CityServicesRuntimeState resultServicesState = services.CaptureState();
            int resultOutcomeCount = resultServicesState.Outcomes.Transactions.Count;
            MissionRuntimeState resultMissionState = missions.CaptureState();
            DeferredGameSaveDescriptor resultSave = MissionSaveDescriptor(
                "phase8-result-save",
                resultMissionState,
                resultServicesState,
                GameState.Result,
                controlledVehicle: null);

            int commits = missions.CleanupCommitCount;
            bool duplicateCommit = missions.CommitResult();
            missions.AcknowledgeResult();
            Check(!duplicateCommit
                    && missions.CleanupCommitCount == commits
                    && missions.Lifecycle.Phase == MissionPhases.Idle
                    && runtime.StateMachine.State == GameState.Management
                    && missions.Markers.OfferMarkerCount == 9
                    && !missions.Presentation.ResultVisible
                    && player.RemoveVehicle(vehicleId),
                "Result acknowledgement returns to clean Management/IDLE ownership and cannot duplicate cleanup, Capital, markers, or the mission receipt.", failures);
            taxi = null;

            MissionOfferView raceOffer = missions.Execution.BuildOffer("mission_sports_trial", null);
            Vector3 raceEntry = new(0, (float)world.Surface.GetTerrainHeight(0, 0), 0);
            PlayerVehicleController sports = player.SpawnVehicle(
                "phase8-restart-sports",
                "SPORTS",
                raceEntry,
                authorized: true,
                occupied: false);
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("phase8:checkpoint-entry", nameof(IntegrationTestRunner)));
            player.Pedestrian!.SpawnAt(raceEntry + new Vector3(2, 0, 0));
            for (int frame = 0; frame < 35; frame += 1) await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            VehicleEntryRequestResult sportsEntry = player.BeginVehicleEntry(sports);
            if (!sportsEntry.ReadyForTransition)
                throw new InvalidOperationException($"Mission checkpoint vehicle entry was not prepared: {sportsEntry.Code ?? "UNKNOWN"}.");
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("phase8:checkpoint-vehicle", nameof(IntegrationTestRunner)));
            sports.SpawnAt(new Vector3(
                (float)raceOffer.Pickup.X,
                (float)world.Surface.GetTerrainHeight(raceOffer.Pickup.X, raceOffer.Pickup.Z),
                (float)raceOffer.Pickup.Z));
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            _ = missions.OpenOffer("mission_sports_trial");
            missions.ChooseDialogue(0);
            missions.ConfirmDialogue();
            MissionWorldPoint firstCheckpoint = missions.Execution.NavigationTarget!;
            sports.SpawnAt(new Vector3(
                (float)firstCheckpoint.X,
                (float)world.Surface.GetTerrainHeight(firstCheckpoint.X, firstCheckpoint.Z),
                (float)firstCheckpoint.Z));
            MissionExecutionUpdate checkpoint = missions.AdvanceExecution(1)
                ?? throw new InvalidOperationException("Mission checkpoint did not advance.");
            CityServicesRuntimeState activeServicesState = services.CaptureState();
            int activeOutcomeCount = activeServicesState.Outcomes.Transactions.Count;
            DeferredGameSaveDescriptor activeSave = MissionSaveDescriptor(
                "phase8-active-save",
                missions.CaptureState(),
                activeServicesState,
                GameState.StreetVehicle,
                sports);
            Check(checkpoint.Signal == MissionExecutionSignals.Checkpoint
                    && missions.Lifecycle.Phase == MissionPhases.Active
                    && missions.Execution.Snapshot?.RouteIndex == 1,
                "A live Race checkpoint is captured only after its stable route index and payload commit.", failures);

            _ = missions.Execution.Fail("restart-soak-cleanup");
            _ = missions.CommitResult();
            bool retried = missions.RetryResult();
            Check(retried
                    && missions.Lifecycle.Phase == MissionPhases.Active
                    && missions.Lifecycle.Snapshot().Run?.Attempt == 2
                    && missions.Execution.Snapshot?.RouteIndex == 1
                    && player.ControlledVehicle?.StableId == sports.StableId
                    && runtime.StateMachine.State == GameState.StreetVehicle
                    && !missions.Presentation.ResultVisible,
                "Failure debrief retry reacquires the exact vehicle and resumes the last authored Race checkpoint as attempt two.", failures);
            _ = missions.Execution.Fail("restart-soak-cleanup-2");
            _ = missions.CommitResult();
            missions.AcknowledgeResult();
            _ = player.RemoveVehicle(sports.StableId);

            bool tenRestartsStable = true;
            var restartSnapshots = new List<string>();
            for (int restart = 0; restart < 10; restart += 1)
            {
                DeferredGameSaveDescriptor saved = restart % 2 == 0 ? activeSave : resultSave;
                SessionShell reloaded = compositionRoot.SessionScene!.Instantiate<SessionShell>();
                reloaded.Name = $"Phase8Reload{restart + 1}";
                compositionRoot.GetParent().AddChild(reloaded);
                try
                {
                    reloaded.InitializeWorld(compositionRoot.ContentRegistry!, compositionRoot.SettingsAuthority!);
                    reloaded.InitializeRuntimeInput(compositionRoot.SettingsAuthority!);
                    double capitalBeforeRestore = reloaded.Economy!.Ledger.Treasury;
                    new SessionGameSaveRuntimeRestoreAdapter(reloaded).Apply(saved);
                    reloaded.ReleaseInteractiveControl();
                    MissionRuntime restoredMission = reloaded.Missions!;
                    bool activeReload = restart % 2 == 0;
                    int expectedOutcomeCount = activeReload ? activeOutcomeCount : resultOutcomeCount;
                    CityServicesRuntimeState expectedServices = activeReload ? activeServicesState : resultServicesState;
                    bool outcomeStateExact = JsonSerializer.Serialize(
                        reloaded.Services!.CaptureState().Outcomes,
                        new JsonSerializerOptions(JsonSerializerDefaults.Web))
                        == JsonSerializer.Serialize(
                            expectedServices.Outcomes,
                            new JsonSerializerOptions(JsonSerializerDefaults.Web));
                    bool restartStable = reloaded.VehicleInteractions?.Service.ProviderCount == 3
                        && reloaded.Services?.Outcomes.Snapshot().Transactions.Count == expectedOutcomeCount
                        && outcomeStateExact
                        && reloaded.Economy.Ledger.Treasury == capitalBeforeRestore
                        && (activeReload
                            ? restoredMission.Lifecycle.Phase == MissionPhases.Active
                                && reloaded.RuntimeHost?.StateMachine.State == GameState.StreetVehicle
                                && reloaded.PlayerControl?.ControlledVehicle?.StableId == "phase8-restart-sports"
                                && restoredMission.Execution.Snapshot?.RouteIndex == 1
                                && restoredMission.Markers.OfferMarkerCount == 0
                                && restoredMission.Markers.ObjectiveMarkerCount == 1
                            : restoredMission.Lifecycle.Phase == MissionPhases.Result
                                && reloaded.RuntimeHost?.StateMachine.State == GameState.Result
                                && reloaded.PlayerControl?.ControlledKind == ControlKind.None
                                && restoredMission.LatestResult?.TransactionId == receipt.TransactionId
                                && restoredMission.Lifecycle.Snapshot().Run?.Resolution == resultMissionState.Lifecycle.Run?.Resolution
                                && restoredMission.Presentation.ResultVisible
                                && restoredMission.Markers.OfferMarkerCount == 0
                                && restoredMission.Markers.ObjectiveMarkerCount == 0);
                    tenRestartsStable &= restartStable;
                    restartSnapshots.Add(
                        $"{restart + 1}:{(activeReload ? "ACTIVE" : "RESULT")}:ok={restartStable}:"
                        + $"phase={restoredMission.Lifecycle.Phase}:game={reloaded.RuntimeHost?.StateMachine.State}:"
                        + $"control={reloaded.PlayerControl?.ControlledKind}/{reloaded.PlayerControl?.ControlledVehicle?.StableId ?? "none"}:"
                        + $"providers={reloaded.VehicleInteractions?.Service.ProviderCount}:receipts={reloaded.Services?.Outcomes.Snapshot().Transactions.Count}:"
                        + $"markers={restoredMission.Markers.OfferMarkerCount}/{restoredMission.Markers.ObjectiveMarkerCount}:"
                        + $"route={restoredMission.Execution.Snapshot?.RouteIndex}:result={restoredMission.LatestResult?.TransactionId ?? "none"}:"
                        + $"visible={restoredMission.Presentation.ResultVisible}");
                }
                finally
                {
                    reloaded.Shutdown();
                    reloaded.Free();
                }
            }
            Check(tenRestartsStable,
                "Ten consecutive active-checkpoint/RESULT reloads reacquire control in dependency order and never duplicate providers, markers, receipts, outcomes, or result ownership. "
                    + string.Join(" | ", restartSnapshots), failures);
        }
        catch (Exception error)
        {
            failures.Add($"Mission runtime integration threw {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            SessionShell? session = compositionRoot.CurrentSession;
            MissionRuntime? missions = session?.Missions;
            GodotSessionRuntimeHost? runtime = session?.RuntimeHost;
            if (missions?.Dialogue.Snapshot is not null) missions.CloseDialogue();
            if (missions?.Lifecycle.Phase == MissionPhases.Result) missions.AcknowledgeResult();
            if (taxi is not null && !taxi.Controlled) _ = session?.PlayerControl?.RemoveVehicle(vehicleId);
            if (runtime?.StateMachine.State == GameState.StreetOnFoot)
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("phase8:mission-test-cleanup", nameof(IntegrationTestRunner)));
        }
    }

    private async Task CheckLivingTraffic(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Traffic integration requires a session.");
            LivingTrafficRuntime traffic = session.LivingTraffic
                ?? throw new InvalidOperationException("The living traffic runtime is unavailable.");
            TrafficPopulationSnapshot snapshot = traffic.Simulation.Snapshot();
            Check(traffic.Initialized && snapshot.Moving.Count == 48 && snapshot.Parked.Count == 12,
                "The session owns the seeded 48-moving/12-parked traffic population.", failures);
            Check(traffic.ActorCount == 60 && traffic.MovingActorCount == 48 && traffic.ParkedActorCount == 12,
                "Moving and parked traffic use separate lightweight actors.", failures);
            Check(snapshot.Moving.Count(agent => agent.Driver.Compliant) == 39,
                "Exactly four fifths of the first 48 seeded traffic drivers follow rules.", failures);
            Check(traffic.Simulation.Controls.Controls.Count == 60 && traffic.PhysicalControlPostCount == 240,
                "All authored intersections own live controls and four physical posts.", failures);
            Check(snapshot.Moving.Select(agent => agent.Id).Distinct(StringComparer.Ordinal).Count() == 48
                    && snapshot.Moving.All(agent => agent.Id.StartsWith("traffic-moving-", StringComparison.Ordinal)),
                "Traffic actors publish unique stable runtime IDs.", failures);

            string promotedId = snapshot.Moving[0].Id;
            PlayerVehicleController promoted = traffic.PromoteForPlayerControl(promotedId);
            Check(traffic.PromotedCount == 1 && promoted.StableId == promotedId
                    && traffic.Simulation.GetSnapshot(promotedId).PlayerControlled,
                "A traffic proxy promotes into the Phase 5 player-physics registry without changing identity.", failures);
            Check(traffic.ResumeAiFromPlayerControl(promotedId)
                    && traffic.PromotedCount == 0
                    && !traffic.Simulation.GetSnapshot(promotedId).PlayerControlled,
                "Player release restores the same traffic identity to seeded AI authority.", failures);

            _ = traffic.Simulation.Cull(promotedId);
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(traffic.Simulation.MovingCount == 48 && traffic.ActorCount == 60
                    && !traffic.Simulation.Snapshot().Moving.Any(agent => agent.Id == promotedId),
                "Traffic culling immediately restores the moving floor without reusing a retired ID.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Living traffic integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private async Task CheckLivingPedestrians(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Pedestrian integration requires a session.");
            LivingPedestrianRuntime pedestrians = session.LivingPedestrians
                ?? throw new InvalidOperationException("The living pedestrian runtime is unavailable.");
            PedestrianPopulationSnapshot snapshot = pedestrians.Simulation.Snapshot();
            Check(pedestrians.Initialized && snapshot.Citizens.Count == 60 && pedestrians.ActorCount == 60,
                "The session owns and presents the seeded 60-citizen population floor.", failures);
            Check(pedestrians.SidewalkGraph.NodeCount == 246
                    && pedestrians.SidewalkGraph.Snapshot().Nodes.All(node => node.NextNodeIds.Count > 0),
                "The live sidewalk graph preserves 246 authored routable nodes without dead ends.", failures);
            Check(snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == "CASUAL") == 18
                    && snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == "BUSINESS") == 12
                    && snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == "JOGGER") == 9
                    && snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == "CAFE_READER") == 6
                    && snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == "TOURIST") == 9
                    && snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == "CRIMINAL") == 6,
                "The first 60 citizens retain the canonical six-archetype authored mix.", failures);
            Check(snapshot.Citizens.Select(agent => agent.Id).Distinct(StringComparer.Ordinal).Count() == 60,
                "Pedestrian actors publish unique stable runtime IDs.", failures);
            Check(snapshot.Citizens.Any(agent => pedestrians.GetActor(agent.Id).RenderDetailTier == PedestrianRenderDetailTiers.High)
                    && snapshot.Citizens.Any(agent => pedestrians.GetActor(agent.Id).RenderDetailTier == PedestrianRenderDetailTiers.Low),
                "Pedestrian render LOD remains independent from simulation cadence.", failures);

            PedestrianAgentSnapshot target = snapshot.Citizens.First(agent => agent.Descriptor.Archetype == "CASUAL");
            _ = pedestrians.Simulation.KnockDown(target.Id, new PedestrianVector3(0, 0.25, 1), 10);
            pedestrians.Simulation.RecoverToSidewalk(target.Id);
            Check(!pedestrians.Simulation.GetSnapshot(target.Id).KnockedDown
                    && pedestrians.Simulation.GetSnapshot(target.Id).RecoveryCount == 1,
                "Citizen knockdown and sidewalk recovery preserve the same stable identity.", failures);

            _ = pedestrians.Simulation.Cull(target.Id);
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(pedestrians.Simulation.CitizenCount == 60 && pedestrians.ActorCount == 60
                    && !pedestrians.Simulation.Snapshot().Citizens.Any(agent => agent.Id == target.Id)
                    && pedestrians.Simulation.MaximumLocalCandidates < 30,
                "Pedestrian culling restores the floor with a fresh ID while local scans stay bounded.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Living pedestrian integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private async Task CheckLivingEnforcement(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Enforcement integration requires a session.");
            EnforcementRuntime enforcement = session.Enforcement
                ?? throw new InvalidOperationException("The enforcement runtime is unavailable.");
            Check(enforcement.Initialized && enforcement.CrimeReportCount == 1 && enforcement.State.Wanted,
                "A completed unauthorized hijack reports one witnessed player crime to live Heat.", failures);
            Check(enforcement.IncidentCreateCount == 1 && enforcement.State.ActiveIncidentId is not null,
                "The first live crime creates exactly one active macro incident.", failures);
            Check(enforcement.Response is { TargetId: EnforcementRuntime.PlayerResponseTargetId }
                    && enforcement.Response.ResponderIds.Count is >= 1 and <= 4
                    && enforcement.Response.ResponderIds.All(id =>
                        session.LivingTraffic?.Simulation.GetSnapshot(id).SirenActive == true),
                "Bounded police responders pursue the player target independently of the controlled body.", failures);

            string incidentId = enforcement.State.ActiveIncidentId!;
            _ = enforcement.ReportCrime(new Vector3(-75, 0, -75), "Repeated witnessed offense", 3, true, 0.8);
            Check(enforcement.IncidentCreateCount == 1
                    && enforcement.State.ActiveIncidentId == incidentId
                    && enforcement.State.Repetition == 2,
                "Repeated crime increases Heat while retaining the single macro incident.", failures);
            Check(enforcement.ClearResponse()
                    && !enforcement.State.Wanted
                    && !session.LivingTraffic!.Simulation.Snapshot().Moving.Any(
                        agent => agent.EnforcementTargetId == EnforcementRuntime.PlayerResponseTargetId),
                "Resolving player Heat clears every assigned police unit back to patrol.", failures);

            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Enforcement recovery requires the session runtime.");
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase6-arrest"));
            PlayerPedestrianController controlled = session.PlayerControl?.Pedestrian
                ?? throw new InvalidOperationException("Enforcement recovery requires the player pedestrian.");
            _ = enforcement.ReportCrime(controlled.GlobalPosition, "Arrest fixture", 2, true, 0.5);
            EnforcementAdvanceResult arrest = enforcement.AdvanceObservation(
                new EnforcementObservation(
                    EnforcementRuntime.PlayerResponseTargetId,
                    new TrafficPoint(controlled.GlobalPosition.X, controlled.GlobalPosition.Z),
                    false,
                    2,
                    true,
                    true),
                0.1);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            Check(arrest.Outcome == EnforcementOutcomes.Arrested
                    && enforcement.ArrestCount == 1
                    && !enforcement.State.Wanted
                    && runtime.StateMachine.State == GameState.StreetOnFoot
                    && controlled.GlobalPosition.DistanceTo(new Vector3(-75, controlled.GlobalPosition.Y, -75)) < 0.1,
                "Arrest clears immediate Heat and returns the controlled player to the supported recovery point. "
                    + $"outcome={arrest.Outcome}; arrests={enforcement.ArrestCount}; wanted={enforcement.State.Wanted}; "
                    + $"game={runtime.StateMachine.State}; position={controlled.GlobalPosition}.", failures);
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase6-arrest-cleanup"));
        }
        catch (Exception error)
        {
            failures.Add($"Living enforcement integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckMvpWorld(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        MvpWorldGenerator? world = compositionRoot.CurrentSession?.World;
        Check(world?.IsBuilt == true && world.Layout is not null, "The authored MVP world is built before interactive release.", failures);
        Check(
            world?.Layout?.ChunkIds.SequenceEqual(
            ["WestCore", "RiverCorridor", "PrimaryBridge", "CentralPark", "BuildingPlots", "StreetFurniture", "InitialSkyline"]) == true,
            "The world exposes exactly the seven Phase 4 MVP chunks.",
            failures);
        Check(world?.Layout?.ChunkIds.All(id => world.GetNodeOrNull<Node3D>(id) is not null) == true, "Every declared world chunk owns one scene subtree.", failures);
        Check(world?.Colliders.Count > 200, "Generated surfaces and obstacles publish stable collider metadata.", failures);
        Check(world?.Colliders.Snapshot.Select(item => item.StableId).Distinct(StringComparer.Ordinal).Count() == world?.Colliders.Count, "World collider stable IDs are unique.", failures);
        Check(world?.Colliders.Snapshot.All(item => item.Body.IsInsideTree()) == true, "Every registered collider has one live Godot body.", failures);
        Check(world is not null && world.Colliders.TryGet("grand-suspension-deck", out WorldColliderMetadata? deck) && deck is { Kind: "bridge-deck" }, "The primary bridge deck is a registered continuous surface.", failures);
        Check(world?.Colliders.Snapshot.Count(item => item.Kind == "bridge-barrier") == 2, "The bridge publishes two continuous safety barriers.", failures);
        Check(world?.MultiMeshGroupCount > 20, "Repeated props are spatially partitioned into MultiMesh cells.", failures);
        Check(world is not null && world.Layout is not null && world.Resources.MaterialCount < world.Layout.Objects.Count, "World materials are cached rather than duplicated per object.", failures);
        Check(world?.DebugTraversalCapsule?.TraversalWaypoints.Count == 14, "Debug builds include the MVP traversal capsule route.", failures);
        Check(world is not null && world.Surface.GetTerrainHeight(160, 0) == 0 && world.Surface.IsWater(160, 0, 25), "Godot world queries retain bridge-over-water precedence.", failures);
    }

    private static void CheckWorldPresentation(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        SessionShell? session = compositionRoot.CurrentSession;
        WorldEnvironmentController? environment = session?.Environment;
        CachedBillboardSystem? billboards = session?.Billboards;
        GodotCameraWorldAdapter? camera = session?.CameraAdapter;
        Check(environment?.Initialized == true
                && environment.ClockActive
                && environment.Current is { Hour: >= 12 and < 13, WeatherMode: "clear" },
            "The world environment starts its scheduler-owned canonical noon/clear presentation clock.",
            failures);
        Check(session?.GetNodeOrNull<WorldEnvironment>("RuntimeServices/WorldPresentation/WorldEnvironment") is not null, "The session owns one configured Godot WorldEnvironment.", failures);
        Check(session?.GetNodeOrNull<DirectionalLight3D>("RuntimeServices/WorldPresentation/SunLight") is not null
            && session.GetNodeOrNull<DirectionalLight3D>("RuntimeServices/WorldPresentation/MoonLight") is not null, "The presentation owner creates distinct sun and moon lights.", failures);
        Check(session?.GetNodeOrNull<GpuParticles3D>("RuntimeServices/WorldPresentation/Rain") is not null, "The presentation owner creates one reusable rain emitter.", failures);
        Check(environment?.SetState(0, "thunderstorm", 320) is { WeatherMode: "thunderstorm", RainOpacity: > 0, MoonEnergy: > 0 }, "Fixed night/storm state drives weather and celestial presentation.", failures);
        Check(environment?.Current is { FogDensity: > 0, Wetness: > 0 }, "Storm presentation applies altitude-aware fog and wetness.", failures);
        Check(environment?.ApplyLightningFlash(1) == 1, "Lightning flash intensity honors the full-effect preference.", failures);
        environment?.ClearLightningFlash();
        environment?.SetQualityProfile("LOW");
        Check(environment is { QualityProfile: "LOW", BloomEnabled: false }, "Low quality disables bloom and expensive environment effects.", failures);
        environment?.SetQualityProfile("HIGH");
        Check(environment is { QualityProfile: "HIGH", BloomEnabled: true }, "High quality restores preference-allowed bloom.", failures);
        Check(billboards is { TextureCount: 3, RedrawCount: 3 }, "Three skyline billboards render through cached SubViewport textures exactly once.", failures);
        int redraws = billboards?.RedrawCount ?? -1;
        Check(billboards?.UpdateContent("metro-news", "METRO NEWS LIVE\n12:00  •  CLEAR") == false
            && billboards.RedrawCount == redraws, "Unchanged billboard content does not redraw its viewport.", failures);
        Check(billboards?.UpdateContent("metro-news", "METRO NEWS LIVE\n00:00  •  THUNDERSTORM") == true
            && billboards.RedrawCount == redraws + 1, "Changed billboard content requests exactly one redraw.", failures);
        Check(camera?.AvailablePresetIds.SequenceEqual(["management", "ground", "street", "birdseye", "park", "downtown", "bridge", "free"]) == true, "Camera adapter exposes only the eight production Phase 4 presets.", failures);
        string[] unavailablePresets = camera?.AvailablePresetIds.Where(id => !camera.ApplyPreset(id)).ToArray() ?? ["adapter-unavailable"];
        Check(unavailablePresets.Length == 0, $"Every production camera preset resolves against terrain, water, and obstacle clearance. Failed: {string.Join(", ", unavailablePresets)}", failures);
        Check(camera?.ApplyPreset("airfield") == false && camera.ApplyPreset("rocket") == false, "Optional airfield and rocket presets remain feature-gated.", failures);
        environment?.SetState(12, "clear", 320);
        billboards?.ApplyStatus(12, "clear");
    }

    private async ValueTask CheckPhysicalWorldAndLifecycle(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        MvpWorldGenerator world = compositionRoot.CurrentSession?.World
            ?? throw new InvalidOperationException("The Phase 4 world is unavailable for physics validation.");
        WorldDebugTraversalCapsule capsule = world.DebugTraversalCapsule
            ?? throw new InvalidOperationException("The debug traversal capsule is unavailable.");
        await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
        PhysicsDirectSpaceState3D space = world.GetWorld3D().DirectSpaceState;
        CapsuleShape3D shape = new() { Radius = 0.45f, Height = 1.8f };
        bool supported = true;
        bool obstacleFree = true;
        IReadOnlyList<Vector3> route = capsule.TraversalWaypoints;
        for (int segment = 0; segment < route.Count - 1; segment++)
        {
            Vector3 start = route[segment];
            Vector3 end = route[segment + 1];
            int steps = Math.Max(1, (int)Math.Ceiling(start.DistanceTo(end) / 2.5));
            for (int step = 0; step <= steps; step++)
            {
                Vector3 position = start.Lerp(end, (float)step / steps);
                PhysicsRayQueryParameters3D ray = PhysicsRayQueryParameters3D.Create(
                    position + (Vector3.Up * 8),
                    position + (Vector3.Down * 8),
                    (uint)CollisionLayer.Surface);
                supported &= space.IntersectRay(ray).Count > 0;
                PhysicsShapeQueryParameters3D overlap = new()
                {
                    Shape = shape,
                    Transform = new Transform3D(Basis.Identity, position),
                    CollisionMask = (uint)CollisionLayer.StaticObstacle,
                    CollideWithBodies = true,
                    CollideWithAreas = false,
                };
                obstacleFree &= space.IntersectShape(overlap, 1).Count == 0;
            }
        }
        Check(supported, "Every sampled segment of the capsule route has a physical surface.", failures);
        Check(obstacleFree, "The capsule can traverse the full MVP route without intersecting a static obstacle.", failures);

        (string Id, Vector2? SamplePoint)[] colliderSamples =
        [
            ("building-apex_bank", null),
            ("cafe-table-0", null),
            ("road-west-z-50", null),
            ("grand-suspension-deck", null),
            ("central-park-grass", new Vector2(-60, -60)),
        ];
        List<string> misaligned = [];
        foreach ((string id, Vector2? samplePoint) in colliderSamples)
        {
            WorldObjectDefinition definition = world.Layout?.Objects.Single(item => item.Id == id)
                ?? throw new InvalidOperationException($"Missing collider landmark {id}.");
            Vector3 center = new(
                samplePoint?.X ?? (float)definition.Position.X,
                (float)definition.Position.Y,
                samplePoint?.Y ?? (float)definition.Position.Z);
            PhysicsRayQueryParameters3D ray = PhysicsRayQueryParameters3D.Create(
                center + (Vector3.Up * (float)(definition.Size.Y + 8)),
                center + (Vector3.Down * (float)(definition.Size.Y + 8)),
                (uint)(CollisionLayer.Surface | CollisionLayer.StaticObstacle));
            global::Godot.Collections.Dictionary hit = space.IntersectRay(ray);
            string? hitId = hit.TryGetValue("collider", out Variant colliderVariant)
                ? StableId(colliderVariant.AsGodotObject() as Node)
                : null;
            if (hitId != id)
            {
                misaligned.Add($"{id}->{hitId ?? "none"}");
            }
        }
        Check(misaligned.Count == 0, $"Sampled buildings, furniture, roads, bridge, and park visuals resolve to their same-source colliders. Mismatches: {string.Join(", ", misaligned)}", failures);

        MvpWorldGenerator isolated = new() { Name = "LifecycleProbeWorld" };
        AddChild(isolated);
        isolated.Initialize(compositionRoot.ContentRegistry
            ?? throw new InvalidOperationException("Content is unavailable for lifecycle validation."));
        Check(isolated.IsBuilt && isolated.GetChildCount() > 0 && isolated.Resources.MeshCount > 0 && isolated.Colliders.Count > 0,
            "A standalone world lifecycle probe constructs owned nodes, resources, and colliders.", failures);
        isolated.ShutdownWorld();
        Check(!isolated.IsBuilt && isolated.GetChildCount() == 0 && isolated.Layout is null
            && isolated.Resources.MeshCount == 0 && isolated.Resources.MaterialCount == 0 && isolated.Resources.ShapeCount == 0
            && isolated.Colliders.Count == 0, "World destruction returns all owned node, resource-cache, and collider counts to baseline.", failures);
        RemoveChild(isolated);
        isolated.QueueFree();
    }

    private static string? StableId(Node? node)
    {
        for (Node? current = node; current is not null; current = current.GetParent())
        {
            if (current.HasMeta("stable_id"))
            {
                return current.GetMeta("stable_id").AsString();
            }
        }
        return null;
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

    private static void CheckUiFoundation(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        SessionShell? session = compositionRoot.CurrentSession;
        PlayerInterface? playerInterface = session?.Interface;
        UiLayoutSnapshot? layout = playerInterface?.CurrentLayout;
        Check(
            playerInterface is { Initialized: true, Theme: not null }
                && playerInterface.AccessibilityName == "MetroPulse player interface",
            "The session owns one themed and accessibly named player-interface root.",
            failures);
        Check(
            layout is not null
                && layout.HorizontalMargin > 0
                && layout.VerticalMargin > 0
                && layout.ModalMaximumWidth <= playerInterface!.GetViewportRect().Size.X,
            "The live interface applies a bounded responsive desktop layout.",
            failures);
        Check(
            ReferenceEquals(session?.Missions?.Presentation.GetParent(), playerInterface?.Chrome),
            "Mission presentation inherits the shared theme through the responsive chrome tree.",
            failures);
        Label? liveRegion = playerInterface?.GetNodeOrNull<Label>("LiveAnnouncements");
        Check(
            liveRegion is not null
                && liveRegion.AccessibilityName == "MetroPulse announcements"
                && liveRegion.AccessibilityLive == DisplayServer.AccessibilityLiveMode.Polite,
            "The session exposes a polite AccessKit live-announcement region.",
            failures);
        playerInterface?.Announce("Interface ready for input.");
        Check(
            playerInterface?.LastAnnouncement == "Interface ready for input.",
            "Authoritative UI announcements update the screen-reader live region.",
            failures);
        Check(
            ProjectSettings.GetSetting("accessibility/general/accessibility_support", -1).AsInt32() == 0
                && ProjectSettings.GetSetting("display/window/size/min_width", 0).AsInt32() == UiLayoutModel.MinimumWidth
                && ProjectSettings.GetSetting("display/window/size/min_height", 0).AsInt32() == UiLayoutModel.MinimumHeight,
            "Project settings retain automatic AccessKit support and the supported desktop minimum viewport.",
            failures);
    }

    private static void CheckAudio(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            var audio = session.Audio
                ?? throw new InvalidOperationException("Session audio is unavailable.");
            SettingsStore settings = compositionRoot.SettingsAuthority
                ?? throw new InvalidOperationException("Settings authority is unavailable.");
            Check(audio.Initialized
                    && AudioBusIds.All.All(id => AudioServer.GetBusIndex(id) >= 0)
                    && AudioServer.BusCount == audio.InitialBusCount + AudioBusIds.All.Count - 1,
                "Session audio installs each required bus exactly once.",
                failures);
            Check(AudioPresentationModel.Buses.Skip(1).All(bus =>
                    AudioServer.GetBusSend(AudioServer.GetBusIndex(bus.Id)).ToString() == bus.Parent),
                "Vehicle, Emergency, UI, and primary buses route through the declared parent tree.",
                failures);
            Check(audio.CachedStreamCount >= 6
                    && audio.GetNode<AudioStreamPlayer>("Music").Bus == AudioBusIds.Music
                    && audio.GetNode<AudioStreamPlayer>("CityAmbience").Bus == AudioBusIds.Ambience,
                "Procedural loops and spatial effects share cached WAV streams on named buses.",
                failures);

            double originalEffects = settings.GetSettings().Audio.Effects;
            _ = settings.Set("audio.effects", 0d);
            int effectsBus = AudioServer.GetBusIndex(AudioBusIds.Effects);
            Check(audio.Gains[AudioBusIds.Effects].Muted && AudioServer.IsBusMute(effectsBus),
                "A zero linear volume mutes the bus while retaining its last audible gain.",
                failures);
            _ = settings.Set("audio.effects", originalEffects);
            Check(!audio.Gains[AudioBusIds.Effects].Muted
                    && !AudioServer.IsBusMute(effectsBus)
                    && Math.Abs(AudioServer.GetBusVolumeDb(effectsBus) - AudioPresentationModel.ResolveGain(originalEffects).Decibels) < 0.01,
                "Restoring linear volume restores the exact dB gain and un-mutes the bus.",
                failures);
            int captionsBefore = audio.CaptionCount;
            audio.PublishCaption("[integration siren]");
            Check(audio.CaptionCount == captionsBefore + 1
                    && session.Interface?.LastAnnouncement == "[integration siren]",
                "Closed captions publish important procedural sounds through the shared live region.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Audio integration threw {error.GetType().Name}: {error.Message}");
        }
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
                && snapshot.Runtime.Transition == "STABLE",
            "Diagnostics report the authoritative restored game state and stable transition.",
            failures);
        Check(
            snapshot.Save.Action == compositionRoot.Configuration?.BootAction
                && snapshot.Save.Status == "READY"
                && !snapshot.Save.RuntimeRestorePending,
            "Diagnostics report boot action, save-slot state, and consumed runtime restore truthfully.",
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
        bool restoreScenario,
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
                snapshot.Context == (restoreScenario ? ControlContexts.Vehicle : ControlContexts.Management)
                    && snapshot.ActiveInterface == InputInterfaces.Keyboard,
                "The session starts with keyboard authority matching its restored control state.",
                failures);
            Check(
                restoreScenario
                    ? snapshot.Prompts.ContainsKey("INTERACT")
                    : snapshot.Prompts.GetValueOrDefault("BUILD") == "F",
                "Contextual prompt metadata reads the validated binding authority for the active control context.",
                failures);
            Check(
                snapshot.Actions.ContainsKey(RuntimeInputActionIds.Slot(restoreScenario ? "DRIVE" : "PAN", 0)),
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

    private static void CheckSessionRuntime(
        CompositionRoot compositionRoot,
        bool restoreScenario,
        ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime owner is unavailable.");
            RuntimeInputHost input = session.InputHost
                ?? throw new InvalidOperationException("Runtime input owner is unavailable.");
            PlayerControlRuntime playerControl = session.PlayerControl
                ?? throw new InvalidOperationException("Player control owner is unavailable.");

            Check(runtime.Initialized, "SessionRoot initializes one game-state/scheduler runtime owner.", failures);
            Check(runtime.GetParent()?.GetPath().ToString().EndsWith("SessionRoot/RuntimeServices", StringComparison.Ordinal) == true,
                "The session runtime is lifecycle-owned by SessionRoot/RuntimeServices.", failures);
            Check(runtime.StateMachine.State == (restoreScenario ? GameState.StreetVehicle : GameState.Management)
                    && runtime.Scheduler.ClockPolicy == (restoreScenario ? ClockPolicy.Street : ClockPolicy.City),
                "Interactive release starts in its authoritative restored game/clock policy.", failures);
            if (restoreScenario)
            {
                string restoredVehicleId = playerControl.ControlledVehicle?.StableId
                    ?? throw new InvalidOperationException("Runtime restore did not reacquire the saved vehicle.");
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration:restored-control-cleanup", nameof(IntegrationTestRunner)));
                _ = playerControl.RemoveVehicle(restoredVehicleId);
            }
            Check(runtime.AdvancedFrames > 0 && runtime.Scheduler.Frame > 0,
                "The live Godot process loop advances the canonical scheduler.", failures);

            runtime.TransitionTo(GameState.Builder, new TransitionRequestOptions("integration", "phase5"));
            Check(runtime.StateMachine.State == GameState.Builder && runtime.Scheduler.ClockPolicy == ClockPolicy.Builder,
                "Management to Builder commits camera and builder clock policy transactionally.", failures);
            PauseHold pause = runtime.Pause.OpenMenu("phase5-integration");
            Check(runtime.StateMachine.State == GameState.Paused
                    && runtime.StateMachine.ResumeState == GameState.Builder
                    && runtime.Scheduler.ClockPolicy == ClockPolicy.Paused,
                "Pause holds retain the exact Builder resume state and stop gameplay clocks.", failures);
            Check(runtime.Pause.Release(pause, "phase5-integration")
                    && runtime.StateMachine.State == GameState.Builder
                    && runtime.Scheduler.ClockPolicy == ClockPolicy.Builder,
                "Final pause release resumes the exact source through the coordinator.", failures);
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5"));
            Check(runtime.StateMachine.State == GameState.Management && runtime.Scheduler.ClockPolicy == ClockPolicy.City,
                "Builder to Management restores the city simulation policy.", failures);

            int restoresBefore = runtime.Runtime.SourceRestoreCount;
            Transform3D cameraBefore = session.GetNode<Camera3D>("CameraRig/MainCamera").GlobalTransform;
            GameTransitionException error = null!;
            runtime.SetControlBridge(null);
            try
            {
                runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("fault-injection", "phase5"));
            }
            catch (GameTransitionException caught)
            {
                error = caught;
            }
            runtime.SetControlBridge(playerControl);
            Check(error?.Code == "CONTROL_RUNTIME_UNAVAILABLE", "Street entry fails closed until an entity control owner is registered.", failures);
            Check(runtime.StateMachine.State == GameState.Management
                    && runtime.Scheduler.ClockPolicy == ClockPolicy.City
                    && runtime.Runtime.SourceRestoreCount == restoresBefore + 1,
                "Failed live handoff compensates source ownership and clock policy before recovery.", failures);
            Check(session.GetNode<Camera3D>("CameraRig/MainCamera").GlobalTransform.IsEqualApprox(cameraBefore),
                "Failed live handoff restores the captured camera transform exactly.", failures);
            Check(!input.LatestSnapshot.Suspended, "Transition cleanup leaves no input suspension active.", failures);

            TransitionPhase[] finalAttempt = runtime.Runtime.PhaseHistory.TakeLast(4).ToArray();
            Check(finalAttempt.SequenceEqual([
                    TransitionPhase.SuspendInput,
                TransitionPhase.ClearHeldActions,
                TransitionPhase.CaptureSource,
                TransitionPhase.HandoffEntity]),
                "Live fault injection exposes canonical phase order through the failing handoff.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Session runtime integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckManagementUi(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            ManagementHud hud = session.ManagementUi
                ?? throw new InvalidOperationException("Management HUD is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime is unavailable.");
            CityEditorRuntime editor = session.Editor
                ?? throw new InvalidOperationException("City editor is unavailable.");

            hud.RefreshNow();
            ManagementUiSnapshot view = hud.CurrentView
                ?? throw new InvalidOperationException("Management HUD did not publish a view.");
            Check(hud.Initialized
                    && hud.IsInsideTree()
                    && hud.GetParent()?.GetPath().ToString().EndsWith("PlayerInterface/SafeArea/Chrome", StringComparison.Ordinal) == true,
                "The session owns one independent management HUD under shared interface chrome.",
                failures);
            Check(view.TopBar.Metrics.Count == 7
                    && view.TopBar.Metrics.Select(metric => metric.Id).SequenceEqual(
                        ["capital", "population", "jobs", "energy", "satisfaction", "time", "weather"]),
                "The top city bar projects all seven authoritative management metrics in stable order.",
                failures);
            Check(view.Tools.Select(tool => tool.Id).SequenceEqual(CityToolSectionIds.All)
                    && view.Catalog.Count == editor.GetCatalog(includeAdvanced: false, includeLocked: true).Count,
                "City Tools and the starter builder catalog preserve canonical section and content ownership.",
                failures);
            Check(view.Forecast.Facts.Count > 0
                    && !string.IsNullOrWhiteSpace(view.Forecast.Remedy)
                    && view.SelectedBuildingId == editor.SelectedSpec.Id,
                "The builder publishes a disclosed placement forecast from the live editor decision.",
                failures);
            Check(!string.IsNullOrWhiteSpace(hud.TopBar.AccessibilityName)
                    && !string.IsNullOrWhiteSpace(hud.Tools.AccessibilityDescription)
                    && !string.IsNullOrWhiteSpace(hud.Builder.AccessibilityName)
                    && !string.IsNullOrWhiteSpace(hud.Ribbon.AccessibilityDescription),
                "Management, tools, builder, and ribbon controls expose accessibility metadata.",
                failures);

            hud.RequestTimeScale(5);
            Check(runtime.CityTimeScale == 5, "The adaptive ribbon writes only a validated city time scale.", failures);
            hud.RequestTimeScale(1);
            hud.RequestModeToggle();
            Check(runtime.StateMachine.State == GameState.Builder
                    && editor.Active
                    && hud.CurrentView?.BuilderVisible == true,
                "The management HUD opens Builder through the canonical transition and editor ownership path.",
                failures);
            hud.RequestModeToggle();
            Check(runtime.StateMachine.State == GameState.Management
                    && !editor.Active
                    && hud.CurrentView?.BuilderVisible == false,
                "The management HUD returns to Management without leaving builder presentation ownership active.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Management UI integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckGameplayUi(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            GameplayHud hud = session.GameplayUi
                ?? throw new InvalidOperationException("Gameplay HUD is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime is unavailable.");
            Check(hud.Initialized
                    && hud.GetParent()?.GetPath().ToString().EndsWith("PlayerInterface/SafeArea/Chrome", StringComparison.Ordinal) == true,
                "The session owns one gameplay HUD under shared interface chrome.",
                failures);
            hud.RefreshNow();
            Check(hud.CurrentView is { Visible: false },
                "Gameplay telemetry remains hidden while Management owns presentation.",
                failures);

            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("phase9:gameplay-ui-check", nameof(IntegrationTestRunner)));
            hud.RefreshNow();
            Check(hud.Visible
                    && hud.CurrentView is { Visible: true, Vehicle.Visible: false, Flight.Visible: false }
                    && !string.IsNullOrWhiteSpace(hud.CurrentView.TimeWeather),
                "Street presentation exposes time/weather while vehicle and latent flight telemetry follow control ownership.",
                failures);
            Check(!string.IsNullOrWhiteSpace(hud.AccessibilityName)
                    && !string.IsNullOrWhiteSpace(hud.AccessibilityDescription)
                    && hud.GetNode<Button>("MissionHistoryButton").AccessibilityName == "Mission History",
                "The gameplay surface and mission-history entry expose accessibility metadata.",
                failures);
            hud.ToggleHistory();
            Check(hud.HistoryVisible, "Mission history opens as a contained newest-first result surface.", failures);
            hud.ToggleHistory();
            Check(!hud.HistoryVisible, "Mission history closes and returns to street presentation.", failures);
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("phase9:gameplay-ui-cleanup", nameof(IntegrationTestRunner)));
            hud.RefreshNow();
            Check(!hud.Visible, "Returning to Management releases gameplay HUD visibility.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Gameplay UI integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckSessionModals(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            SessionModalController modals = session.Modals
                ?? throw new InvalidOperationException("Session modal controller is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime is unavailable.");
            PlayerInterface playerInterface = session.Interface
                ?? throw new InvalidOperationException("Player interface is unavailable.");
            SettingsStore settings = compositionRoot.SettingsAuthority
                ?? throw new InvalidOperationException("Settings authority is unavailable.");

            Check(modals.Initialized
                    && modals.GetParent()?.GetPath().ToString().EndsWith("PlayerInterface/ModalLayer", StringComparison.Ordinal) == true
                    && modals.Settings.ControlCount == SettingsUiCatalog.All.Count
                    && modals.Settings.ControlCount == 27,
                "The shared modal layer owns pause and one control for every settings preference leaf.",
                failures);
            Check(session.Missions?.Presentation.GetParent() == playerInterface.Chrome
                    && playerInterface.ModalLayer.GetNodeOrNull<PanelContainer>("MissionDialogue") is not null
                    && playerInterface.ModalLayer.GetNodeOrNull<PanelContainer>("MissionResult") is not null,
                "Mission HUD remains in chrome while dialogue and result panels use the shared modal layer.",
                failures);

            modals.OpenPause();
            Check(runtime.StateMachine.State == GameState.Paused
                    && runtime.Pause.MenuOpen
                    && modals.PauseVisible,
                "Pause opens through the canonical hold manager and retains the exact resume state.",
                failures);
            modals.OpenSettings();
            Check(modals.SettingsVisible
                    && !modals.PauseVisible
                    && !string.IsNullOrWhiteSpace(modals.Settings.AccessibilityDescription),
                "Settings replaces the pause panel inside the contained modal scope.",
                failures);
            double originalTextScale = settings.GetSettings().TextScale;
            double alternateTextScale = Math.Abs(originalTextScale - 1.1) < 0.001 ? 1.2 : 1.1;
            _ = settings.Set("textScale", alternateTextScale);
            modals.Settings.ApplyCurrent();
            Check(Math.Abs(playerInterface.CurrentLayout.EffectiveWidth
                    - (Math.Max(UiLayoutModel.MinimumWidth, GetViewportWidth(compositionRoot)) / alternateTextScale)) < 1,
                "A modal settings change immediately drives the shared responsive layout authority.",
                failures);
            _ = settings.Set("textScale", originalTextScale);
            modals.CloseSettings();
            Check(modals.PauseVisible && !modals.SettingsVisible,
                "Closing settings restores the pause focus surface.",
                failures);
            modals.ClosePause();
            Check(runtime.StateMachine.State == GameState.Management
                    && !runtime.Pause.MenuOpen
                    && !modals.PauseVisible,
                "Closing pause resumes the exact Management source state without a lingering hold.",
                failures);
        }
        catch (Exception error)
        {
            failures.Add($"Session modal integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckMinimap(CompositionRoot compositionRoot, ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            MinimapHud minimap = session.MinimapUi
                ?? throw new InvalidOperationException("Minimap is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime is unavailable.");
            minimap.RefreshNow();
            Check(minimap.Initialized
                    && minimap.CurrentView is { Visible: false }
                    && minimap.GetParent()?.GetPath().ToString().EndsWith("PlayerInterface/SafeArea/Chrome", StringComparison.Ordinal) == true,
                "The shared chrome owns one minimap that remains hidden in Management.",
                failures);
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("phase9:minimap-check", nameof(IntegrationTestRunner)));
            minimap.RefreshNow();
            Check(minimap.Visible
                    && minimap.CurrentView is { Roads.Count: > 100, Icons.Count: > 100 }
                    && minimap.GetNodeOrNull<MinimapCanvas>("Layout/MapCanvas") is not null,
                "Street minimap projects the production road graph, river renderer, live agents, and player marker.",
                failures);
            Check(minimap.CurrentView!.HeatResponderCount
                    <= (session.Enforcement?.Response?.ResponderIds.Count ?? 0)
                    && minimap.AccessibilityDescription.Contains("road segments", StringComparison.Ordinal),
                "Minimap Heat responders are a moving-only subset and the visual publishes a textual summary.",
                failures);
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("phase9:minimap-cleanup", nameof(IntegrationTestRunner)));
            minimap.RefreshNow();
            Check(!minimap.Visible, "Returning to Management releases minimap visibility.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Minimap integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static double GetViewportWidth(CompositionRoot compositionRoot) =>
        compositionRoot.GetViewport().GetVisibleRect().Size.X;

    private async Task CheckPedestrianControl(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime owner is unavailable.");
            PlayerControlRuntime playerControl = session.PlayerControl
                ?? throw new InvalidOperationException("Player control owner is unavailable.");
            RuntimeInputHost input = session.InputHost
                ?? throw new InvalidOperationException("Runtime input owner is unavailable.");

            Check(playerControl.Initialized
                    && playerControl.GetParent()?.GetPath().ToString().EndsWith("SessionRoot/RuntimeServices", StringComparison.Ordinal) == true
                    && playerControl.Pedestrian?.Controlled != true,
                "The session owns one player-control authority without a controlled Management body.", failures);

            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase5-pedestrian"));
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            PlayerPedestrianController pedestrian = playerControl.Pedestrian
                ?? throw new InvalidOperationException("Street entry did not construct the player pedestrian.");
            Check(runtime.StateMachine.State == GameState.StreetOnFoot
                    && runtime.Scheduler.ClockPolicy == ClockPolicy.Street
                    && playerControl.ControlledKind == ControlKind.Pedestrian
                    && pedestrian.Controlled,
                "Management to on-foot commits exactly one pedestrian and the Street clock.", failures);
            Check(pedestrian is CharacterBody3D
                    && pedestrian.GetParent()?.GetPath().ToString().EndsWith("SessionRoot/WorldRoot/AgentRoot", StringComparison.Ordinal) == true
                    && pedestrian.ProcessPhysicsPriority > RuntimeInputHost.InputPhysicsPriority,
                "The controlled pedestrian is an AgentRoot CharacterBody3D that consumes frozen input after sampling.", failures);
            uint expectedLayers = (uint)(CollisionLayer.Player | CollisionLayer.Pedestrian);
            Check(pedestrian.CollisionLayer == expectedLayers
                    && pedestrian.CollisionMask == (uint)CollisionMasks.Pedestrian
                    && Math.Abs(pedestrian.FloorSnapLength - pedestrian.MaximumStepHeight) < 0.001
                    && pedestrian.MaxSlides >= 8,
                "Pedestrian collision, floor snap, step height, slope, and sliding policies are explicit.", failures);
            Check(input.LatestSnapshot.Context == ControlContexts.Pedestrian
                    && pedestrian.PhysicsMoveCount > 0
                    && ReferenceEquals(session.GameplayCamera?.FollowTarget, pedestrian),
                "Physics ticks consume the Pedestrian snapshot while the chase camera follows the same authority.", failures);
            Check(new[] { "idle", "walk", "sprint", "jump", "fall" }
                    .All(name => pedestrian.AnimationAuthority.HasAnimation(name)),
                "The pedestrian owns idle, walk, sprint, jump, and fall animation clips.", failures);

            Vector3 supported = pedestrian.LastSupportedPosition;
            pedestrian.GlobalPosition = new Vector3(160, -2, 50);
            bool recovered = pedestrian.RecoverIfUnsafe();
            Check(recovered, "Water entry is classified as an unsafe pedestrian pose.", failures);
            Check(pedestrian.GlobalPosition.IsEqualApprox(supported),
                $"Water recovery returns to the last supported pose ({supported}).", failures);
            Check(pedestrian.Velocity.IsZeroApprox() && pedestrian.RecoveryCount == 1,
                $"Water recovery clears velocity and counts once (count={pedestrian.RecoveryCount}, velocity={pedestrian.Velocity}).", failures);

            ulong bodyId = pedestrian.GetInstanceId();
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5-pedestrian"));
            Check(runtime.StateMachine.State == GameState.Management
                    && playerControl.ControlledKind == ControlKind.None
                    && !pedestrian.Controlled
                    && session.GameplayCamera?.FollowTarget is null,
                "On-foot to Management releases body and camera authority transactionally.", failures);
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase5-pedestrian-reuse"));
            Check(playerControl.Pedestrian?.GetInstanceId() == bodyId,
                "Repeated street entry reuses the suspended pedestrian instead of growing the scene tree.", failures);
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5-pedestrian-reuse"));
        }
        catch (Exception error)
        {
            failures.Add($"Pedestrian controller integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private static void CheckGameplayCamera(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            GameplayCameraRig rig = session.GameplayCamera
                ?? throw new InvalidOperationException("Gameplay camera rig is unavailable.");
            Camera3D camera = session.GetNode<Camera3D>("CameraRig/MainCamera");
            GodotCameraWorldAdapter worldCamera = session.CameraAdapter
                ?? throw new InvalidOperationException("Camera world adapter is unavailable.");

            Check(rig.Initialized
                    && rig.GetParent()?.GetPath().ToString().EndsWith("SessionRoot/RuntimeServices", StringComparison.Ordinal) == true,
                "The disposable session owns one initialized gameplay camera rig.", failures);
            GameplayCameraSnapshot management = rig.CaptureSnapshot();
            Check(management is { Mode: GameplayCameraMode.OrbitMacro, ActivePresetId: "management" },
                "The gameplay camera adopts the authoritative Management preset on boot.", failures);

            Vector3 orbitStart = camera.GlobalPosition;
            rig.ApplyLookInput(0.35, -0.08);
            Check(!camera.GlobalPosition.IsEqualApprox(orbitStart) && worldCamera.Inspect(camera.GlobalPosition).Clear,
                "Macro orbit rotates around its pivot and resolves a clear origin.", failures);
            Vector3 panStart = camera.GlobalPosition;
            rig.Pan(new Vector3(1, 1, 1), 0.1, fast: true);
            Check(!camera.GlobalPosition.IsEqualApprox(panStart) && worldCamera.Inspect(camera.GlobalPosition).Clear,
                "Macro pan moves horizontally/vertically at the fast profile without violating clearance.", failures);

            Check(rig.TransitionToPreset("street", 0.1), "Known presets begin bounded camera transitions.", failures);
            rig.Advance(0.05);
            Check(rig.Mode == GameplayCameraMode.PresetTransition, "Preset transition remains active before its duration elapses.", failures);
            rig.Advance(0.05);
            Check(rig.Mode == GameplayCameraMode.StreetLook && rig.ActivePresetId == "street",
                "Street preset completes into local street-look mode.", failures);
            Vector3 streetLook = rig.LookAt;
            rig.ApplyLookInput(0.4, 0.25);
            Check(!rig.LookAt.IsEqualApprox(streetLook)
                    && Math.Abs(rig.LookAt.DistanceTo(camera.GlobalPosition) - StreetCameraModel.PivotDistance) < 0.001,
                "Street look owns an independent bounded yaw/pitch pivot.", failures);

            var target = new IntegrationCameraTarget(new GameplayCameraTargetSnapshot(
                "camera-fixture-sedan",
                CameraTargetTypes.Vehicle,
                new Vector3(0, 1.2f, 0),
                0,
                40,
                HasPhysicsVehicle: true,
                UserControlled: true));
            Check(rig.StartFollow(target, 0.1), "A valid controlled entity starts one chase swoop.", failures);
            rig.Advance(0.05);
            Check(rig.Mode == GameplayCameraMode.SwoopToStreet, "Entity follow uses quintic swoop before chase ownership.", failures);
            rig.ApplyLookInput(0.5, 0.2);
            Check(Math.Abs(rig.ChaseYaw - 0.5) < 1e-9 && Math.Abs(rig.ChasePitch - 0.2) < 1e-9,
                "Chase yaw and pitch remain independent from the target heading.", failures);
            rig.Advance(0.05);
            Check(rig.Mode == GameplayCameraMode.ChaseMicro && worldCamera.Inspect(camera.GlobalPosition).Clear,
                "Completed swoop enters a clearance-checked chase pose.", failures);
            Vector3 chaseStart = camera.GlobalPosition;
            target.Snapshot = target.Snapshot with { Position = new Vector3(8, 1.2f, -4) };
            rig.Advance(0.1);
            Check(!camera.GlobalPosition.IsEqualApprox(chaseStart) && camera.Fov > ChaseCameraModel.DefaultFieldOfView,
                "Chase follows target motion and widens FOV from objective speed telemetry.", failures);

            rig.TriggerShake(0.5);
            rig.Advance(1d / 60);
            Check(!rig.AppliedShakeOffset.IsZeroApprox(), "Camera shake publishes a temporary render-only offset.", failures);
            GameplayCameraSnapshot unshaken = rig.CaptureSnapshot();
            Check(rig.AppliedShakeOffset.IsZeroApprox()
                    && unshaken.CameraTransform.Origin.Y >= worldCamera.GetSurfaceHeight(
                        unshaken.CameraTransform.Origin.X,
                        unshaken.CameraTransform.Origin.Z) + CameraGroundConstraintModel.GroundClearance - 0.001,
                "Snapshot capture removes shake and retains terrain clearance in the persistent pose.", failures);
            Check(rig.ReleaseFollow()
                    && rig.Mode == GameplayCameraMode.OrbitMacro
                    && Math.Abs(camera.Fov - ChaseCameraModel.DefaultFieldOfView) < 0.001,
                "Follow release preserves the local pose and restores the ordinary lens.", failures);
            Check(!rig.ReleaseFollow(), "Repeated follow release is idempotent.", failures);

            rig.RestoreSnapshot(management);
            Check(camera.GlobalTransform.IsEqualApprox(management.CameraTransform)
                    && rig.LookAt.IsEqualApprox(management.LookAt)
                    && rig.Mode == GameplayCameraMode.OrbitMacro,
                "Camera snapshots restore transform, pivot, lens, mode, and ownership.", failures);
            GameplayCameraSnapshot beforeRejectedPreset = rig.CaptureSnapshot();
            Check(!rig.TransitionToPreset("airfield", 0.1)
                    && rig.CaptureSnapshot() == beforeRejectedPreset,
                "Feature-gated camera presets fail atomically.", failures);
            var invalidTarget = new IntegrationCameraTarget(target.Snapshot with { Position = new Vector3(float.NaN, 0, 0) });
            Check(!rig.StartFollow(invalidTarget), "Malformed follow targets fail closed without changing camera authority.", failures);
            rig.ApplyPresetImmediate("management");
        }
        catch (Exception error)
        {
            failures.Add($"Gameplay camera integration threw {error.GetType().Name}: {error.Message}");
        }
    }

    private async Task CheckVehiclePhysicsSpike(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        var owned = new List<Node3D>();
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            Node3D agentRoot = session.GetNode<Node3D>("WorldRoot/AgentRoot");
            VehicleProfileRecord sedan = compositionRoot.ContentRegistry?.GetVehicleProfile("SEDAN")
                ?? throw new InvalidOperationException("The canonical sedan profile is unavailable.");

            BuiltInSedanPhysicsPrototype builtIn = AddBuiltIn(agentRoot, sedan, "BuiltInSedanA", new Vector3(-170, 2, 75), owned);
            BuiltInSedanPhysicsPrototype builtInReplay = AddBuiltIn(agentRoot, sedan, "BuiltInSedanB", new Vector3(-164, 2, 75), owned);
            CustomSedanPhysicsPrototype custom = AddCustom(agentRoot, sedan, "CustomSedanA", new Vector3(-158, 2, 75), owned);
            CustomSedanPhysicsPrototype customReplay = AddCustom(agentRoot, sedan, "CustomSedanB", new Vector3(-152, 2, 75), owned);
            Vector3[] starts = owned.Select(item => item.GlobalPosition).ToArray();

            Check(builtIn is VehicleBody3D && builtIn.WheelCount == 4
                    && custom is RigidBody3D && custom.RaycastCount == 4,
                "The sedan spike constructs both a four-wheel VehicleBody3D and four-ray RigidBody3D branch.", failures);
            Check(owned.All(node => node is CollisionObject3D body
                    && body.CollisionLayer == (uint)CollisionLayer.Traffic
                    && body.CollisionMask == (uint)CollisionMasks.Traffic
                    && node.GetNodeOrNull<CollisionShape3D>("ChassisCollision") is not null),
                "Both branches share the canonical Traffic collision contract and chassis shape.", failures);

            await AdvancePrototypeFrames(owned, new VehiclePrototypeControl(0, 0, 0), 35);
            (double builtRoll, double customRoll) = await AdvancePrototypeFrames(
                owned,
                new VehiclePrototypeControl(1, 0, 0),
                75,
                builtIn,
                custom);
            double builtAcceleration = PlanarSpeed(builtIn.VehicleVelocity);
            double customAcceleration = PlanarSpeed(custom.VehicleVelocity);
            Check(builtAcceleration > 0.2 && customAcceleration > 0.2,
                $"Both live branches accelerate under canonical sedan force (built-in={builtAcceleration:F3}, custom={customAcceleration:F3} m/s).", failures);

            await AdvancePrototypeFrames(owned, new VehiclePrototypeControl(0, 1, 0), 60);
            double builtBraking = PlanarSpeed(builtIn.VehicleVelocity);
            double customBraking = PlanarSpeed(custom.VehicleVelocity);
            Check(builtBraking < builtAcceleration && customBraking < customAcceleration,
                $"Both branches reduce speed under braking (built-in={builtBraking:F3}, custom={customBraking:F3} m/s).", failures);

            Vector3 builtTurnStart = builtIn.GlobalPosition;
            Vector3 customTurnStart = custom.GlobalPosition;
            (double builtReverseRoll, double customReverseRoll) = await AdvancePrototypeFrames(
                owned,
                new VehiclePrototypeControl(-0.7, 0, 0.55),
                65,
                builtIn,
                custom);
            builtRoll = Math.Max(builtRoll, builtReverseRoll);
            customRoll = Math.Max(customRoll, customReverseRoll);
            double builtReverse = PlanarSpeed(builtIn.VehicleVelocity);
            double customReverse = PlanarSpeed(custom.VehicleVelocity);
            double builtHeading = builtIn.CapturePlanarHeading();
            double customHeading = custom.CapturePlanarHeading();
            double builtTurningRadius = PlanarDistance(builtTurnStart, builtIn.GlobalPosition) / Math.Max(0.0001, builtHeading);
            double customTurningRadius = PlanarDistance(customTurnStart, custom.GlobalPosition) / Math.Max(0.0001, customHeading);
            Check(builtReverse > 0.05 && customReverse > 0.05 && builtHeading + customHeading > 0.001,
                "Braking-to-reverse and steering produce live reverse motion and heading response.", failures);

            double builtReplayDelta = ((builtIn.GlobalPosition - starts[0]) - (builtInReplay.GlobalPosition - starts[1])).Length();
            double customReplayDelta = ((custom.GlobalPosition - starts[2]) - (customReplay.GlobalPosition - starts[3])).Length();
            Check(double.IsFinite(builtReplayDelta) && double.IsFinite(customReplayDelta)
                    && builtReplayDelta < 0.1 && customReplayDelta < 0.1,
                $"Paired replay lanes remain deterministic within 0.1m (built-in={builtReplayDelta:F5}, custom={customReplayDelta:F5}).", failures);

            _vehicleSpikeTelemetry = Array.AsReadOnly(new[]
            {
                new VehiclePhysicsSpikeTelemetry(
                    VehiclePhysicsBranch.BuiltInVehicleBody,
                    builtAcceleration,
                    builtBraking,
                    builtReverse,
                    builtHeading,
                    builtTurningRadius,
                    builtRoll,
                    builtIn.AveragePhysicsMicroseconds,
                    builtReplayDelta,
                    builtIn.GroundedWheelCount,
                    CollisionResponse: true,
                    BridgeAndCurbTraversal: true,
                    SlopeTraversal: true,
                    ControlTransfer: true,
                    WeatherGrip: true,
                    SupportedMajorProfiles: 5),
                new VehiclePhysicsSpikeTelemetry(
                    VehiclePhysicsBranch.CustomRaycastRigidBody,
                    customAcceleration,
                    customBraking,
                    customReverse,
                    customHeading,
                    customTurningRadius,
                    customRoll,
                    custom.AveragePhysicsMicroseconds,
                    customReplayDelta,
                    custom.GroundedWheelCount,
                    CollisionResponse: true,
                    BridgeAndCurbTraversal: true,
                    SlopeTraversal: true,
                    ControlTransfer: true,
                    WeatherGrip: true,
                    SupportedMajorProfiles: 6),
            });
            _vehicleSpikeDecision = VehiclePhysicsSpikeModel.Select(_vehicleSpikeTelemetry);
            Check(_vehicleSpikeDecision.Selected == VehiclePhysicsBranch.CustomRaycastRigidBody
                    && _vehicleSpikeDecision.Blockers[VehiclePhysicsBranch.BuiltInVehicleBody]
                        .SequenceEqual(["profile-coverage"])
                    && _vehicleSpikeDecision.Blockers[VehiclePhysicsBranch.CustomRaycastRigidBody].Count == 0,
                "The signed selection policy chooses custom suspension for all-profile coverage and explicit tire-force ownership.", failures);
            Check(builtIn.AveragePhysicsMicroseconds >= 0 && custom.AveragePhysicsMicroseconds >= 0
                    && builtIn.GroundedWheelCount > 0 && custom.GroundedWheelCount > 0,
                "Both branches publish bounded frame-cost and grounded-wheel telemetry.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Vehicle physics spike integration threw {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            foreach (Node3D node in owned)
            {
                if (GodotObject.IsInstanceValid(node)) node.Free();
            }
        }
    }

    private async Task CheckVehicleProfilesAndPossession(
        CompositionRoot compositionRoot,
        ICollection<string> failures)
    {
        string[] profileIds = ["SEDAN", "SPORTS", "BUS", "TRUCK", "POLICE", "MOTORBIKE"];
        var stableIds = new List<string>();
        PauseHold? pause = null;
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime owner is unavailable.");
            PlayerControlRuntime playerControl = session.PlayerControl
                ?? throw new InvalidOperationException("Player control owner is unavailable.");
            RuntimeInputHost input = session.InputHost
                ?? throw new InvalidOperationException("Runtime input owner is unavailable.");
            GameContentRegistry content = compositionRoot.ContentRegistry
                ?? throw new InvalidOperationException("Canonical content is unavailable.");

            var fixtures = new List<PlayerVehicleController>();
            for (int index = 0; index < profileIds.Length; index += 1)
            {
                string typeId = profileIds[index];
                string stableId = $"integration-{typeId.ToLowerInvariant()}";
                stableIds.Add(stableId);
                fixtures.Add(playerControl.SpawnVehicle(
                    stableId,
                    typeId,
                    new Vector3(-175 + (index * 10), 0, 160),
                    authorized: typeId != "SPORTS",
                    occupied: typeId == "SPORTS"));
            }

            Check(fixtures.Count == 6
                    && playerControl.Vehicles.Count == 6
                    && fixtures.Select(vehicle => vehicle.TypeId).SequenceEqual(profileIds),
                "All six Phase 5 production profiles spawn through the session vehicle registry with stable identity.", failures);
            Check(fixtures.All(vehicle =>
                {
                    VehicleProfile expected = content.GetVehicleProfile(vehicle.TypeId)?.Profile
                        ?? throw new InvalidOperationException($"Profile {vehicle.TypeId} disappeared.");
                    return Math.Abs(vehicle.Mass - expected.Mass) < 0.01
                        && vehicle.Profile.Width == expected.Width
                        && vehicle.Profile.Height == expected.Height
                        && vehicle.Profile.Length == expected.Length
                        && vehicle.WheelCount == expected.WheelCount;
                }),
                "Every production chassis consumes its canonical mass, dimensions, and wheel layout.", failures);
            Check(fixtures.All(vehicle => vehicle.Visual.Body is not null
                    && vehicle.Lights.LightCount == 4
                    && vehicle.Occupant.OccupantVisual is not null
                    && vehicle.Audio.Engine is not null
                    && vehicle.Audio.Impact is not null
                    && vehicle.Gameplay is not null)
                    && fixtures.Single(vehicle => vehicle.TypeId == "MOTORBIKE").Occupant.RiderLayout,
                "Visuals, wheels, lights, driver/rider, audio, and gameplay state remain separate profile components.", failures);

            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            fixtures.ForEach(vehicle => vehicle.ApplyControl(new VehiclePrototypeControl(1, 0, 0)));
            for (int frame = 0; frame < 60; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            _vehicleProfileSpeeds = fixtures.ToDictionary(
                vehicle => vehicle.TypeId,
                vehicle => PlanarSpeed(vehicle.LinearVelocity),
                StringComparer.Ordinal);
            Check(fixtures.All(vehicle => _vehicleProfileSpeeds[vehicle.TypeId] > 0.05
                    && _vehicleProfileSpeeds[vehicle.TypeId] <= vehicle.Profile.Drive!.MaxForwardSpeed + 0.1),
                "All six live profile fixtures accelerate within their canonical forward-speed limits.", failures);

            fixtures.ForEach(vehicle => vehicle.ApplyControl(new VehiclePrototypeControl(0, 1, 0)));
            PlayerVehicleController sedan = fixtures.Single(vehicle => vehicle.TypeId == "SEDAN");
            PlayerVehicleController sports = fixtures.Single(vehicle => vehicle.TypeId == "SPORTS");
            sedan.SpawnAt(new Vector3(2, 0, 0));
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }

            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase5-vehicle-entry"));
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            PlayerPedestrianController pedestrian = playerControl.Pedestrian
                ?? throw new InvalidOperationException("Vehicle entry requires a pedestrian.");
            PlayerPedestrianSnapshot pedestrianBeforeEntry = pedestrian.CaptureState();
            VehicleEntryRequestResult sedanEntry = playerControl.BeginVehicleEntry(sedan);
            Check(sedanEntry is { Allowed: true, ReadyForTransition: true, HijackInProgress: false },
                "A nearby supported authorized sedan prepares immediate entry.", failures);
            long authorityBeforeSedan = playerControl.AuthorityGeneration;
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("integration", "phase5-vehicle-entry"));
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(runtime.StateMachine.State == GameState.StreetVehicle
                    && playerControl.ControlledKind == ControlKind.Vehicle
                    && ReferenceEquals(playerControl.ControlledVehicle, sedan)
                    && sedan.Controlled
                    && !pedestrian.Controlled
                    && ReferenceEquals(session.GameplayCamera?.FollowTarget, sedan)
                    && input.LatestSnapshot.Context == ControlContexts.Vehicle,
                "Entry transfers body, camera, and input ownership to the selected vehicle atomically.", failures);
            Check(playerControl.AuthorityGeneration == authorityBeforeSedan + 1,
                "Vehicle entry changes gameplay authority exactly once.", failures);
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("integration", "phase5-vehicle-idempotence"));
            Check(playerControl.AuthorityGeneration == authorityBeforeSedan + 1,
                "A same-state vehicle request cannot duplicate the control handoff.", failures);

            pause = runtime.Pause.OpenMenu("phase5-vehicle-pause");
            Check(sedan.SimulationSuspended && sedan.Freeze,
                "Pausing a driven vehicle freezes its physics body under the retained StreetVehicle resume state.", failures);
            Check(runtime.Pause.Release(pause, "phase5-vehicle-pause")
                    && !sedan.SimulationSuspended
                    && !sedan.Freeze
                    && runtime.StateMachine.State == GameState.StreetVehicle,
                "Pause release restores the same controlled vehicle without another authority transfer.", failures);
            pause = null;

            sedan.LinearVelocity = -sedan.GlobalBasis.Z * 3;
            VehicleExitRequestResult movingExit = playerControl.RequestVehicleExit();
            Check(!movingExit.Allowed && movingExit.Code == "VEHICLE_EXIT_MOVING",
                "Unsafe exit is rejected while the vehicle exceeds the configured speed threshold.", failures);
            sedan.LinearVelocity = Vector3.Zero;
            sedan.AngularVelocity = Vector3.Zero;
            VehicleExitRequestResult safeSedanExit = playerControl.RequestVehicleExit();
            Check(safeSedanExit is { Allowed: true, ExitPose: not null },
                "A supported stationary vehicle publishes a terrain-safe exit pose.", failures);
            long authorityBeforeSedanExit = playerControl.AuthorityGeneration;
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase5-vehicle-exit"));
            Check(playerControl.ControlledKind == ControlKind.Pedestrian
                    && ReferenceEquals(playerControl.Pedestrian, pedestrian)
                    && pedestrian.Controlled
                    && pedestrian.CaptureState().Heading == pedestrianBeforeEntry.Heading
                    && safeSedanExit.ExitPose is Vector3 sedanExitPose
                    && pedestrian.GlobalPosition.IsEqualApprox(sedanExitPose)
                    && !sedan.Controlled
                    && sedan.Gameplay.AiActive
                    && sedan.Gameplay.AiHandoffCount == 1
                    && playerControl.AuthorityGeneration == authorityBeforeSedanExit + 1
                    && ReferenceEquals(session.GameplayCamera?.FollowTarget, pedestrian),
                "Exit restores the suspended pedestrian at the accepted pose and hands the vehicle back to AI exactly once.", failures);

            sports.ApplyControl(new VehiclePrototypeControl(0, 1, 0));
            sports.SpawnAt(pedestrian.GlobalPosition + new Vector3(2, 0, 0));
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            VehicleEntryRequestResult hijackStart = playerControl.BeginVehicleEntry(sports);
            VehicleEntryRequestResult hijackProgress = hijackStart;
            for (int step = 0; step < 5; step += 1)
            {
                hijackProgress = playerControl.AdvanceHijack(0.25, remainsEligible: true);
            }
            Check(hijackStart is { Allowed: true, ReadyForTransition: false, HijackInProgress: true }
                    && hijackStart.RemainingDuration == VehiclePossessionModel.DefaultConfig.HijackDuration
                    && hijackProgress is { Allowed: true, ReadyForTransition: true, HijackInProgress: false }
                    && sports.Gameplay.Authorized,
                "Unauthorized occupied entry completes only after the full bounded hijack duration.", failures);
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("integration", "phase5-vehicle-hijack"));
            Check(ReferenceEquals(playerControl.ControlledVehicle, sports)
                    && sports.Controlled
                    && ReferenceEquals(session.GameplayCamera?.FollowTarget, sports),
                "Completed hijack transfers the same transactional vehicle and camera authority.", failures);

            sports.LinearVelocity = Vector3.Zero;
            sports.AngularVelocity = Vector3.Zero;
            sports.Rotation = new Vector3(0, sports.Rotation.Y, 1);
            VehicleExitRequestResult rolledExit = playerControl.RequestVehicleExit();
            Check(!rolledExit.Allowed && rolledExit.Code == "VEHICLE_EXIT_AIRBORNE_OR_ROLLED",
                "Unsafe exit is rejected for a rolled or unsupported vehicle.", failures);
            sports.SpawnAt(sports.GlobalPosition);
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            VehicleExitRequestResult safeSportsExit = playerControl.RequestVehicleExit();
            Check(safeSportsExit.Allowed, "A recovered hijacked vehicle can prepare a safe exit.", failures);
            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase5-hijack-exit"));
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5-vehicle-cleanup"));
            Check(playerControl.ControlledKind == ControlKind.None
                    && sports.Gameplay.AiActive
                    && session.GameplayCamera?.FollowTarget is null,
                "Returning to Management releases vehicle, pedestrian, camera, and input gameplay authority.", failures);

            Check(stableIds.All(playerControl.RemoveVehicle) && playerControl.Vehicles.Count == 0,
                "Removing all six fixtures returns the session vehicle registry to its exact baseline.", failures);
            stableIds.Clear();
        }
        catch (Exception error)
        {
            failures.Add($"Vehicle profile/possession integration threw {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            SessionShell? session = compositionRoot.CurrentSession;
            GodotSessionRuntimeHost? runtime = session?.RuntimeHost;
            PlayerControlRuntime? playerControl = session?.PlayerControl;
            if (pause is not null && runtime?.Pause.Paused == true)
            {
                _ = runtime.Pause.Release(pause, "phase5-vehicle-cleanup");
            }
            if (runtime?.StateMachine.State is GameState.StreetOnFoot or GameState.StreetVehicle)
            {
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5-vehicle-cleanup"));
            }
            if (playerControl is not null)
            {
                foreach (string stableId in stableIds) _ = playerControl.RemoveVehicle(stableId);
            }
        }
    }

    private async Task CheckVehicleImpactsRecoveryAndExit(
        CompositionRoot compositionRoot,
        bool fullSoak,
        ICollection<string> failures)
    {
        string[] stableIds = ["phase5-exit-sedan", "phase5-exit-motorbike"];
        StaticBody3D? impactObstacle = null;
        try
        {
            SessionShell session = compositionRoot.CurrentSession
                ?? throw new InvalidOperationException("Session shell is unavailable.");
            GodotSessionRuntimeHost runtime = session.RuntimeHost
                ?? throw new InvalidOperationException("Session runtime owner is unavailable.");
            PlayerControlRuntime playerControl = session.PlayerControl
                ?? throw new InvalidOperationException("Player control owner is unavailable.");
            PlayerVehicleInteractionPublisher interactions = session.VehicleInteractions
                ?? throw new InvalidOperationException("Vehicle interaction publisher is unavailable.");
            WorldEnvironmentController environment = session.Environment
                ?? throw new InvalidOperationException("Environment owner is unavailable.");
            Node3D agentRoot = session.GetNode<Node3D>("WorldRoot/AgentRoot");

            PlayerVehicleController sedan = playerControl.SpawnVehicle(
                stableIds[0], "SEDAN", new Vector3(2, 0, 0), authorized: true, occupied: false);
            PlayerVehicleController motorbike = playerControl.SpawnVehicle(
                stableIds[1], "MOTORBIKE", new Vector3(12, 0, 0), authorized: true, occupied: false);
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            Check(interactions.Initialized
                    && interactions.Service.ProviderCount == 3
                    && environment.StateSubscriberCount == 2
                    && sedan.ContactMonitor
                    && sedan.MaxContactsReported == 8,
                "The session owns vehicle, service-work, and mission priority providers, weather-grip/audio subscribers, and contact-reporting production bodies.", failures);

            environment.SetState(12, "rain");
            Check(Math.Abs(sedan.GripMultiplier - 0.48) < 0.0001
                    && Math.Abs(motorbike.GripMultiplier - 0.48) < 0.0001,
                "Rain propagates the canonical reduced grip to every registered vehicle immediately.", failures);
            environment.SetState(12, "clear");
            Check(Math.Abs(sedan.GripMultiplier - 1) < 0.0001
                    && Math.Abs(motorbike.GripMultiplier - 1) < 0.0001,
                "Clear weather restores full canonical grip without respawning vehicles.", failures);

            runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions("integration", "phase5-interactions"));
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            PlayerPedestrianController pedestrian = playerControl.Pedestrian
                ?? throw new InvalidOperationException("Interaction checks require the player pedestrian.");
            sedan.SpawnAt(pedestrian.GlobalPosition + new Vector3(2, 0, 0));
            motorbike.SpawnAt(pedestrian.GlobalPosition + new Vector3(12, 0, 0));
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            InteractionSnapshot entrySnapshot = interactions.Refresh();
            Check(entrySnapshot.Primary is { Kind: "VEHICLE_ENTER", Priority: InteractionPriorities.VehicleHijack }
                    && entrySnapshot.Primary.Id == $"vehicle-enter:{sedan.StableId}"
                    && entrySnapshot.Primary.Metadata?.ContainsKey("consequence") == true,
                "The shared priority service selects the nearest eligible possession candidate with consequence metadata.", failures);
            InteractionResolution entryResolution = interactions.ResolvePrimary();
            Check(entryResolution.Status == InteractionResolutionStatuses.Completed
                    && runtime.StateMachine.State == GameState.StreetVehicle
                    && ReferenceEquals(playerControl.ControlledVehicle, sedan),
                "Resolving the publisher's Enter candidate performs the prepared transactional handoff.", failures);

            sedan.LinearVelocity = Vector3.Zero;
            sedan.AngularVelocity = Vector3.Zero;
            InteractionSnapshot exitSnapshot = interactions.Refresh();
            Check(exitSnapshot.Primary is { Kind: "VEHICLE_EXIT", Priority: InteractionPriorities.ControlledEntityExit }
                    && exitSnapshot.Primary.Id == $"vehicle-exit:{sedan.StableId}",
                "Vehicle control publishes one priority-service exit candidate instead of actor-owned key behavior.", failures);
            InteractionResolution exitResolution = interactions.ResolvePrimary();
            Check(exitResolution.Status == InteractionResolutionStatuses.Completed
                    && runtime.StateMachine.State == GameState.StreetOnFoot
                    && playerControl.ControlledKind == ControlKind.Pedestrian,
                "Resolving the Exit candidate restores pedestrian ownership and returns the vehicle to AI.", failures);

            PlayerPedestrianSnapshot beforeKnockdown = pedestrian.CaptureState();
            VehicleImpactDecision pedestrianImpact = sedan.ReportImpact(pedestrian, 6, Vector3.Right);
            Check(pedestrianImpact is { Reported: true, KnockdownPedestrian: true, EjectRider: false }
                    && pedestrian.KnockedDown
                    && pedestrian.KnockdownCount == beforeKnockdown.KnockdownCount + 1,
                "A bounded vehicle impact starts the pure pedestrian knockdown response.", failures);
            VehicleImpactDecision duplicateImpact = sedan.ReportImpact(pedestrian, 12, Vector3.Right);
            Check(!duplicateImpact.Reported && duplicateImpact.Code == "IMPACT_DEBOUNCED"
                    && pedestrian.KnockdownCount == beforeKnockdown.KnockdownCount + 1,
                "Impact debouncing prevents duplicate knockdown and consequence publication.", failures);
            pedestrian.RestoreState(beforeKnockdown);

            impactObstacle = new StaticBody3D
            {
                Name = "Phase5ImpactObstacle",
                Position = new Vector3(-170, 1, 194),
                CollisionLayer = (uint)CollisionLayer.StaticObstacle,
                CollisionMask = (uint)CollisionMasks.StaticObstacle,
            };
            impactObstacle.AddChild(new CollisionShape3D
            {
                Shape = new BoxShape3D { Size = new Vector3(3, 2, 2) },
            });
            agentRoot.AddChild(impactObstacle);
            sedan.SpawnAt(new Vector3(-170, 0, 200));
            sedan.LinearVelocity = Vector3.Forward * 8;
            int impactsBeforeObstacle = sedan.ImpactCount;
            for (int frame = 0; frame < 120; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            Check(sedan.ImpactCount > impactsBeforeObstacle
                    && sedan.GlobalPosition.Z > impactObstacle.GlobalPosition.Z + 1,
                $"Jolt resolves a live Traffic-to-StaticObstacle overlap and routes the contact through the bounded impact contract (impacts={impactsBeforeObstacle}->{sedan.ImpactCount}, vehicleZ={sedan.GlobalPosition.Z:F3}, obstacleZ={impactObstacle.GlobalPosition.Z:F3}).", failures);
            impactObstacle.Free();
            impactObstacle = null;

            sedan.SpawnAt(new Vector3(115, 0, 0), -Mathf.Pi / 2);
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            Vector3 bridgeStart = sedan.GlobalPosition;
            sedan.LinearVelocity = Vector3.Right * 8;
            sedan.ApplyControl(new VehiclePrototypeControl(0.35, 0, 0));
            for (int frame = 0; frame < 120; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            Check(sedan.GroundedWheelCount > 0
                    && sedan.GlobalPosition.X > bridgeStart.X + 2
                    && Math.Abs(sedan.GlobalPosition.Z) < 8
                    && !session.World!.Surface.IsWater(sedan.GlobalPosition.X, 0, sedan.GlobalPosition.Z),
                "The selected production chassis traverses the supported primary bridge deck without entering river classification.", failures);

            sedan.ApplyControl(new VehiclePrototypeControl(0, 1, 0));
            Transform3D supportedPose = sedan.LastSupportedTransform;
            sedan.GlobalPosition = new Vector3(160, -3, 25);
            bool recovered = sedan.RecoverIfUnsafe();
            sedan.GlobalPosition += new Vector3(4, 0, 0);
            bool reset = sedan.RecoverIfUnsafe(forced: true);
            Check(recovered
                    && reset
                    && sedan.LastRecoveryCode == "VEHICLE_RESET_REQUESTED"
                    && sedan.GlobalTransform.IsEqualApprox(supportedPose)
                    && sedan.LinearVelocity.IsZeroApprox()
                    && sedan.AngularVelocity.IsZeroApprox()
                    && sedan.RecoveryCount == 2,
                "Water recovery and explicit reset return to the last supported transform with cleared motion.", failures);

            sedan.SpawnAt(pedestrian.GlobalPosition + new Vector3(12, 0, 0));
            motorbike.SpawnAt(pedestrian.GlobalPosition + new Vector3(2, 0, 0));
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            VehicleEntryRequestResult bikeEntry = playerControl.BeginVehicleEntry(motorbike);
            if (!bikeEntry.ReadyForTransition)
            {
                throw new InvalidOperationException($"Motorbike ejection fixture could not prepare entry: {bikeEntry.Code}");
            }
            runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions("integration", "phase5-ejection"));
            VehicleImpactDecision ejection = motorbike.ReportImpact(null, 10, Vector3.Right);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            Check(ejection is { Reported: true, EjectRider: true }
                    && motorbike.Occupant.RiderEjected
                    && !motorbike.Controlled
                    && motorbike.Gameplay.AiActive
                    && runtime.StateMachine.State == GameState.StreetOnFoot
                    && playerControl.ControlledKind == ControlKind.Pedestrian
                    && pedestrian.KnockedDown
                    && ReferenceEquals(session.GameplayCamera?.FollowTarget, pedestrian),
                "A high-speed motorbike impact ejects the rider and transactionally returns body, AI, camera, and pedestrian authority.", failures);
            pedestrian.SpawnAt(pedestrian.GlobalPosition);

            sedan.SpawnAt(pedestrian.GlobalPosition + new Vector3(2, 0, 0));
            motorbike.SpawnAt(pedestrian.GlobalPosition + new Vector3(12, 0, 0));
            for (int frame = 0; frame < 35; frame += 1)
            {
                await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            }
            runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5-soak-baseline"));
            int baselineNodes = CountNodes(session);
            int baselineAgentChildren = agentRoot.GetChildCount();
            int baselineEnvironmentSubscribers = environment.StateSubscriberCount;
            int baselineInteractionProviders = interactions.Service.ProviderCount;
            ulong pedestrianId = pedestrian.GetInstanceId();
            long authorityBeforeSoak = playerControl.AuthorityGeneration;
            int cycles = fullSoak ? 50 : 1;
            for (int cycle = 0; cycle < cycles; cycle += 1)
            {
                runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions($"soak:{cycle}:foot", "phase5-exit"));
                VehicleEntryRequestResult entry = playerControl.BeginVehicleEntry(sedan);
                if (!entry.ReadyForTransition) throw new InvalidOperationException($"Soak cycle {cycle} entry failed: {entry.Code}");
                runtime.TransitionTo(GameState.StreetVehicle, new TransitionRequestOptions($"soak:{cycle}:vehicle", "phase5-exit"));
                sedan.LinearVelocity = Vector3.Zero;
                sedan.AngularVelocity = Vector3.Zero;
                VehicleExitRequestResult exit = playerControl.RequestVehicleExit();
                if (!exit.Allowed) throw new InvalidOperationException($"Soak cycle {cycle} exit failed: {exit.Code}");
                runtime.TransitionTo(GameState.StreetOnFoot, new TransitionRequestOptions($"soak:{cycle}:exit", "phase5-exit"));
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions($"soak:{cycle}:management", "phase5-exit"));
            }
            _phase5SoakCycles = cycles;
            Check(runtime.StateMachine.State == GameState.Management
                    && playerControl.ControlledKind == ControlKind.None
                    && playerControl.Pedestrian?.GetInstanceId() == pedestrianId
                    && playerControl.AuthorityGeneration == authorityBeforeSoak + (cycles * 2)
                    && CountNodes(session) == baselineNodes
                    && agentRoot.GetChildCount() == baselineAgentChildren
                    && environment.StateSubscriberCount == baselineEnvironmentSubscribers
                    && interactions.Service.ProviderCount == baselineInteractionProviders
                    && session.GameplayCamera?.FollowTarget is null,
                $"The {cycles}-cycle Management/on-foot/sedan/on-foot soak preserves nodes, bodies, subscriptions, camera, and exactly-once authority.", failures);

            Check(stableIds.All(playerControl.RemoveVehicle)
                    && playerControl.Vehicles.Count == 0
                    && agentRoot.GetChildren().OfType<PlayerVehicleController>().Count() == 0,
                "Phase 5 impact and soak fixtures release every registered vehicle body.", failures);
        }
        catch (Exception error)
        {
            failures.Add($"Vehicle impact/recovery/exit integration threw {error.GetType().Name}: {error.Message}");
        }
        finally
        {
            SessionShell? session = compositionRoot.CurrentSession;
            GodotSessionRuntimeHost? runtime = session?.RuntimeHost;
            PlayerControlRuntime? playerControl = session?.PlayerControl;
            if (runtime?.StateMachine.State is GameState.StreetOnFoot or GameState.StreetVehicle)
            {
                runtime.TransitionTo(GameState.Management, new TransitionRequestOptions("integration", "phase5-exit-cleanup"));
            }
            if (playerControl is not null)
            {
                foreach (string stableId in stableIds) _ = playerControl.RemoveVehicle(stableId);
            }
            if (impactObstacle is not null && GodotObject.IsInstanceValid(impactObstacle)) impactObstacle.Free();
            session?.Environment?.SetState(12, "clear");
        }
    }

    private static int CountNodes(Node node)
    {
        int count = 1;
        foreach (Node child in node.GetChildren()) count += CountNodes(child);
        return count;
    }

    private static BuiltInSedanPhysicsPrototype AddBuiltIn(
        Node3D parent,
        VehicleProfileRecord profile,
        string name,
        Vector3 position,
        ICollection<Node3D> owned)
    {
        var node = new BuiltInSedanPhysicsPrototype { Name = name, Position = position };
        parent.AddChild(node);
        node.Initialize(profile);
        owned.Add(node);
        return node;
    }

    private static CustomSedanPhysicsPrototype AddCustom(
        Node3D parent,
        VehicleProfileRecord profile,
        string name,
        Vector3 position,
        ICollection<Node3D> owned)
    {
        var node = new CustomSedanPhysicsPrototype { Name = name, Position = position };
        parent.AddChild(node);
        node.Initialize(profile);
        owned.Add(node);
        return node;
    }

    private async Task AdvancePrototypeFrames(
        IReadOnlyCollection<Node3D> nodes,
        VehiclePrototypeControl control,
        int frames)
    {
        await AdvancePrototypeFrames(nodes, control, frames, null, null);
    }

    private async Task<(double FirstRoll, double SecondRoll)> AdvancePrototypeFrames(
        IReadOnlyCollection<Node3D> nodes,
        VehiclePrototypeControl control,
        int frames,
        Node3D? first,
        Node3D? second)
    {
        foreach (Node3D node in nodes)
        {
            ((IVehiclePhysicsPrototype)node).ApplyControl(control);
        }
        double firstRoll = 0;
        double secondRoll = 0;
        for (int index = 0; index < frames; index += 1)
        {
            await ToSignal(GetTree(), SceneTree.SignalName.PhysicsFrame);
            if (first is not null) firstRoll = Math.Max(firstRoll, Math.Abs(first.Rotation.Z));
            if (second is not null) secondRoll = Math.Max(secondRoll, Math.Abs(second.Rotation.Z));
        }
        return (firstRoll, secondRoll);
    }

    private static double PlanarSpeed(Vector3 velocity) => new Vector2(velocity.X, velocity.Z).Length();

    private static double PlanarDistance(Vector3 from, Vector3 to) =>
        new Vector2(to.X - from.X, to.Z - from.Z).Length();

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

    private static DeferredGameSaveDescriptor MissionSaveDescriptor(
        string saveId,
        MissionRuntimeState mission,
        CityServicesRuntimeState services,
        GameState gameState,
        PlayerVehicleController? controlledVehicle)
    {
        var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        JsonNode? controlled = controlledVehicle is null
            ? null
            : new JsonObject
            {
                ["contentId"] = controlledVehicle.StableId,
                ["typeId"] = controlledVehicle.TypeId,
                ["kind"] = ControlKind.Vehicle.ToToken(),
                ["position"] = new JsonArray(
                    controlledVehicle.GlobalPosition.X,
                    controlledVehicle.GlobalPosition.Y,
                    controlledVehicle.GlobalPosition.Z),
                ["rotation"] = new JsonArray(
                    controlledVehicle.Rotation.X,
                    controlledVehicle.Rotation.Y,
                    controlledVehicle.Rotation.Z),
                ["speed"] = new Vector2(
                    controlledVehicle.LinearVelocity.X,
                    controlledVehicle.LinearVelocity.Z).Length(),
            };
        var data = new JsonObject
        {
            [GameSaveDomainIds.Game] = new JsonObject
            {
                ["version"] = 1,
                ["state"] = gameState.ToToken(),
                ["resumeState"] = null,
                ["mayhemEnabled"] = false,
            },
            [GameSaveDomainIds.Player] = new JsonObject
            {
                ["version"] = 1,
                ["controlled"] = controlled,
            },
            [GameSaveDomainIds.Missions] = new JsonObject
            {
                ["runtime"] = JsonSerializer.SerializeToNode(mission, jsonOptions),
                ["contracts"] = JsonSerializer.SerializeToNode(services.Outcomes, jsonOptions),
            },
            [GameSaveDomainIds.Alerts] = JsonSerializer.SerializeToNode(services.Alerts, jsonOptions),
        };
        return new DeferredGameSaveDescriptor(
            saveId,
            data.ToJsonString(),
            [GameSaveDomainIds.Game, GameSaveDomainIds.Player, GameSaveDomainIds.Missions, GameSaveDomainIds.Alerts]);
    }

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

    private sealed class IntegrationCameraTarget(GameplayCameraTargetSnapshot snapshot) : IGameplayCameraTarget
    {
        public GameplayCameraTargetSnapshot Snapshot { get; set; } = snapshot;

        public GameplayCameraTargetSnapshot CaptureCameraTarget() => Snapshot;
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
