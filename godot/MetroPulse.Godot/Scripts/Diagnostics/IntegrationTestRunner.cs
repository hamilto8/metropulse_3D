using Godot;
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
        Check(Engine.PhysicsTicksPerSecond == RuntimeConfiguration.DefaultPhysicsTicksPerSecond, "Physics cadence is 120 Hz.", failures);
        Check(ProjectSettings.GetSetting("physics/common/physics_interpolation", false).AsBool(), "Physics interpolation is enabled.", failures);
        Check(ProjectSettings.GetSetting("physics/3d/physics_engine", string.Empty).AsString() == "Jolt Physics", "Jolt Physics is explicit.", failures);
        Check(diagnostics.CurrentSnapshot.SessionLoaded, "Diagnostics report the loaded session.", failures);
        Check(diagnostics.CurrentSnapshot.DeterministicTestMode, "Integration tests run deterministically.", failures);
        CheckCollisionLayerNames(failures);

        if (failures.Count == 0)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "integration.passed",
                "Foundation integration checks passed.",
                new Dictionary<string, string> { ["assertions"] = "18" }));
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
}
