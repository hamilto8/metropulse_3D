using Godot;
using MetroPulse.Domain.Boot;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Adapters;
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
                BootStageIds.SettingsBootstrap,
                BootStageIds.ContentValidation,
                BootStageIds.ActionSelection,
                BootStageIds.SessionConstruction,
                BootStageIds.FinalReadiness,
                BootStageIds.InteractiveRelease,
            ]) == true,
            "Initial Phase 3 boot stages run in the declared order.",
            failures);
        Check(compositionRoot.BootProgressEvents.Count == 14, "Each initial boot stage reports running and complete states.", failures);
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
        CheckSettingsAndInputMap(compositionRoot, failures);
        CheckCapabilityFailureContract(compositionRoot, failures);
        CheckCollisionLayerNames(failures);

        if (failures.Count == 0)
        {
            AppLog.Write(new StructuredLogEvent(
                LogCategory.Test,
                LogSeverity.Information,
                "integration.passed",
                "Foundation integration checks passed.",
                new Dictionary<string, string> { ["assertions"] = "39" }));
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
