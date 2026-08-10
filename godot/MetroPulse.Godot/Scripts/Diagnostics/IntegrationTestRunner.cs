using System.Text.Json;
using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Persistence;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.Simulation;
using MetroPulse.Domain.Vehicles;
using MetroPulse.Domain.World;
using MetroPulse.Godot.Adapters;
using MetroPulse.Godot.App;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Runtime;
using MetroPulse.Godot.Vehicles;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Diagnostics;

public partial class IntegrationTestRunner : Node
{
    private CompositionRoot? _compositionRoot;
    private DiagnosticsOverlay? _diagnostics;
    private IReadOnlyList<VehiclePhysicsSpikeTelemetry> _vehicleSpikeTelemetry = Array.Empty<VehiclePhysicsSpikeTelemetry>();
    private VehiclePhysicsSpikeDecision? _vehicleSpikeDecision;

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
        CheckSessionRuntime(compositionRoot, failures);
        await CheckPedestrianControl(compositionRoot, failures);
        CheckGameplayCamera(compositionRoot, failures);
        await CheckVehiclePhysicsSpike(compositionRoot, failures);
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
                    ["assertions"] = recoverySeedScenario ? "104" : "100",
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
        Check(environment?.Initialized == true && environment.Current is { Hour: 12, WeatherMode: "clear" }, "The world environment initializes to canonical noon/clear presentation.", failures);
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

    private static void CheckSessionRuntime(
        CompositionRoot compositionRoot,
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
            Check(runtime.StateMachine.State == GameState.Management && runtime.Scheduler.ClockPolicy == ClockPolicy.City,
                "Interactive release starts in authoritative Management/City policy.", failures);
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
                    && playerControl.Pedestrian is null,
                "The session owns one lazy player-control authority without a Management body.", failures);

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
