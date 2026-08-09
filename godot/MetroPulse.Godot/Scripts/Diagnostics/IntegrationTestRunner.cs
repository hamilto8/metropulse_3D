using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Godot.App;

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

    private void Run()
    {
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
                BootStageIds.ContentValidation,
                BootStageIds.ActionSelection,
                BootStageIds.SessionConstruction,
                BootStageIds.FinalReadiness,
                BootStageIds.InteractiveRelease,
            ]) == true,
            "Initial Phase 3 boot stages run in the declared order.",
            failures);
        Check(compositionRoot.BootProgressEvents.Count == 12, "Each initial boot stage reports running and complete states.", failures);
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
        Check(
            string.Equals(
                compositionRoot.LastBootResults?[BootStageIds.ActionSelection] as string,
                "NEW_GAME",
                StringComparison.Ordinal),
            "The persistence-free initial slice explicitly selects New Game.",
            failures);
        CheckCapabilityFailureContract(compositionRoot, failures);
        CheckCollisionLayerNames(failures);

        if (failures.Count == 0)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "integration.passed",
                "Foundation integration checks passed.",
                new Dictionary<string, string> { ["assertions"] = "28" }));
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
}
