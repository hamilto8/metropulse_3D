using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Diagnostics;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Diagnostics;

namespace MetroPulse.Godot.Runtime;

/// <summary>
/// Live session owner for game state, coordinated transitions, pause intent,
/// and the canonical multi-clock scheduler.
/// </summary>
public partial class GodotSessionRuntimeHost : Node
{
    private Func<bool>? unsubscribeTransitions;
    private Func<bool>? unregisterCameraTask;
    private double cityTimeScale = SimulationTimeModel.DefaultSpeed;

    public bool Initialized { get; private set; }

    public SimulationScheduler Scheduler { get; private set; } = null!;

    public GameStateMachine StateMachine { get; private set; } = null!;

    public GameTransitionCoordinator Transitions { get; private set; } = null!;

    public PauseManager Pause { get; private set; } = null!;

    public GodotTransitionRuntime Runtime { get; private set; } = null!;

    public long AdvancedFrames { get; private set; }

    public double CityTimeScale => cityTimeScale;

    public void Initialize(
        RuntimeInputHost input,
        GameplayCameraRig gameplayCamera)
    {
        if (Initialized)
        {
            throw new InvalidOperationException("The Godot session runtime is already initialized.");
        }

        Scheduler = new SimulationScheduler(
            getCityTimeScale: _ => cityTimeScale,
            initialClockPolicy: ClockPolicy.City);
        Runtime = new GodotTransitionRuntime(input, gameplayCamera, Scheduler);
        StateMachine = new GameStateMachine(GameState.Management, Runtime.SnapshotContext);
        Transitions = new GameTransitionCoordinator(StateMachine, Runtime);
        Pause = new PauseManager(Transitions, input.ClearAndQuarantine);
        unsubscribeTransitions = Transitions.Subscribe(LogTransition);
        unregisterCameraTask = Scheduler.RegisterTask(
            "camera.gameplay",
            SimulationStage.Camera,
            (delta, context) => gameplayCamera.Advance(
                delta,
                context.ClockPolicy is ClockPolicy.City or ClockPolicy.Builder or ClockPolicy.Street));
        ProcessMode = ProcessModeEnum.Always;
        SetProcess(true);
        Initialized = true;
    }

    public void SetControlBridge(IPlayerControlTransitionBridge? bridge)
    {
        EnsureInitialized();
        Runtime.SetControlBridge(bridge);
    }

    public void SetMissionContextProvider(Func<TransitionContext>? provider)
    {
        EnsureInitialized();
        Runtime.SetMissionContextProvider(provider);
    }

    public void SetDialogueOpen(bool open)
    {
        EnsureInitialized();
        Runtime.SetDialogueOpen(open, StateMachine.State);
    }

    public void TransitionTo(GameState destination, TransitionRequestOptions? options = null)
    {
        EnsureInitialized();
        Transitions.TransitionTo(destination, options);
    }

    public double SetCityTimeScale(double scale)
    {
        EnsureInitialized();
        if (!SimulationTimeModel.SpeedOptions.Contains(scale))
        {
            throw new ArgumentOutOfRangeException(nameof(scale), scale, "Unsupported city time scale.");
        }
        cityTimeScale = scale;
        return cityTimeScale;
    }

    public override void _Process(double delta)
    {
        if (!Initialized) return;
        Scheduler.AdvanceFrame(Math.Max(0, delta));
        AdvancedFrames++;
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        _ = unsubscribeTransitions?.Invoke();
        unsubscribeTransitions = null;
        _ = unregisterCameraTask?.Invoke();
        unregisterCameraTask = null;
        Runtime.SetMissionContextProvider(null);
        SetProcess(false);
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void EnsureInitialized()
    {
        if (!Initialized)
        {
            throw new InvalidOperationException("The Godot session runtime is not initialized.");
        }
    }

    private static void LogTransition(TransitionCoordinatorEvent transitionEvent)
    {
        LogSeverity severity = transitionEvent.Type == TransitionCoordinatorEventType.Failed
            ? LogSeverity.Error
            : LogSeverity.Information;
        AppLog.Write(new StructuredLogEvent(
            LogCategory.Session,
            severity,
            $"session.transition.{transitionEvent.Type.ToString().ToLowerInvariant()}",
            $"{transitionEvent.Transition.From.ToToken()} -> {transitionEvent.Transition.To.ToToken()} "
                + $"{transitionEvent.Type.ToString().ToLowerInvariant()} at {transitionEvent.Phase.ToToken()}.",
            new Dictionary<string, string>
            {
                ["transitionId"] = transitionEvent.Transition.Id,
                ["phase"] = transitionEvent.Phase.ToToken(),
                ["from"] = transitionEvent.Transition.From.ToToken(),
                ["to"] = transitionEvent.Transition.To.ToToken(),
                ["errorCode"] = (transitionEvent.Error as GameTransitionException)?.Code ?? string.Empty,
            }));
    }
}
