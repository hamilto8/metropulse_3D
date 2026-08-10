using Godot;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Runtime;

public sealed class GodotTransitionRuntime : ITransitionRuntime
{
    private readonly RuntimeInputHost input;
    private readonly GodotCameraWorldAdapter cameraAdapter;
    private readonly Camera3D camera;
    private readonly SimulationScheduler scheduler;
    private IPlayerControlTransitionBridge? controlBridge;

    public GodotTransitionRuntime(
        RuntimeInputHost input,
        GodotCameraWorldAdapter cameraAdapter,
        SimulationScheduler scheduler)
    {
        this.input = input ?? throw new ArgumentNullException(nameof(input));
        this.cameraAdapter = cameraAdapter ?? throw new ArgumentNullException(nameof(cameraAdapter));
        this.scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
        camera = cameraAdapter.GetNode<Camera3D>("MainCamera");
    }

    public int SourceRestoreCount { get; private set; }

    public IReadOnlyList<TransitionPhase> PhaseHistory => phaseHistory.AsReadOnly();

    private List<TransitionPhase> phaseHistory { get; } = [];

    public void SetControlBridge(IPlayerControlTransitionBridge? bridge) => controlBridge = bridge;

    public TransitionContext SnapshotContext() =>
        controlBridge?.SnapshotContext() ?? new TransitionContext();

    public TransitionPhaseResult Execute(TransitionPhase phase, TransitionRuntimeContext context)
    {
        phaseHistory.Add(phase);
        return phase switch
        {
            TransitionPhase.SuspendInput => SuspendInput(context),
            TransitionPhase.ClearHeldActions => ClearHeldActions(),
            TransitionPhase.CaptureSource => CaptureSource(),
            TransitionPhase.HandoffEntity => HandoffEntity(context),
            TransitionPhase.PositionCamera => PositionCamera(context),
            TransitionPhase.ConfigureSimulation => ConfigureSimulation(context),
            TransitionPhase.ConfigurePresentation => new TransitionPhaseResult(),
            TransitionPhase.ValidateDestination => ValidateDestination(context),
            _ => new TransitionPhaseResult(
                false,
                "UNKNOWN_TRANSITION_PHASE",
                $"Godot runtime cannot execute phase {phase.ToToken()}.")
        };
    }

    public void RestoreSourceState(TransitionRuntimeContext context)
    {
        if (context.SourceState is not RuntimeSourceState source)
        {
            throw new InvalidOperationException("The Godot transition source snapshot is unavailable.");
        }

        controlBridge?.RestoreSourceState(source.ControlState);
        scheduler.SetClockPolicy(source.ClockPolicy);
        if (source.PresetId is not null)
        {
            _ = cameraAdapter.ApplyPreset(source.PresetId);
        }
        camera.GlobalTransform = source.CameraTransform;
        camera.ResetPhysicsInterpolation();
        SourceRestoreCount++;
    }

    private TransitionPhaseResult SuspendInput(TransitionRuntimeContext context)
    {
        InputSuspensionToken token = input.Suspend(context.TransitionId);
        return new TransitionPhaseResult(Cleanup: () => input.Resume(token));
    }

    private TransitionPhaseResult ClearHeldActions()
    {
        input.ClearAndQuarantine();
        return new TransitionPhaseResult();
    }

    private TransitionPhaseResult CaptureSource() => new(
        SourceState: new RuntimeSourceState(
            scheduler.ClockPolicy,
            camera.GlobalTransform,
            cameraAdapter.ActivePresetId,
            controlBridge?.CaptureSourceState()));

    private TransitionPhaseResult HandoffEntity(TransitionRuntimeContext context)
    {
        ControlPolicy policy = GameStateCatalog.Policies[context.To].Control;
        if (controlBridge is not null)
        {
            return controlBridge.Handoff(context);
        }
        return policy is ControlPolicy.RequirePedestrian or ControlPolicy.RequireVehicle
            ? new TransitionPhaseResult(
                false,
                "CONTROL_RUNTIME_UNAVAILABLE",
                $"{context.To.ToToken()} requires the Phase 5 entity control owner.")
            : new TransitionPhaseResult();
    }

    private TransitionPhaseResult PositionCamera(TransitionRuntimeContext context)
    {
        string? preset = context.To switch
        {
            GameState.Management => "management",
            GameState.Builder => "birdseye",
            GameState.Load => "management",
            GameState.Menu => "management",
            GameState.StreetOnFoot or GameState.StreetVehicle => "street",
            _ => null,
        };
        if (preset is null)
        {
            return new TransitionPhaseResult();
        }
        return cameraAdapter.ApplyPreset(preset)
            ? new TransitionPhaseResult()
            : new TransitionPhaseResult(
                false,
                "CAMERA_PLACEMENT_FAILED",
                $"The {preset} camera could not resolve a safe pose.");
    }

    private TransitionPhaseResult ConfigureSimulation(TransitionRuntimeContext context)
    {
        scheduler.SetClockPolicy(GameStateCatalog.Policies[context.To].Clock);
        return new TransitionPhaseResult();
    }

    private TransitionPhaseResult ValidateDestination(TransitionRuntimeContext context)
    {
        TransitionEvaluation evaluation = GameTransitionPolicy.ValidateDestination(
            context.To,
            SnapshotContext());
        return evaluation.Allowed
            ? new TransitionPhaseResult()
            : new TransitionPhaseResult(false, evaluation.Code, evaluation.Reason);
    }

    private sealed record RuntimeSourceState(
        ClockPolicy ClockPolicy,
        Transform3D CameraTransform,
        string? PresetId,
        object? ControlState);
}
