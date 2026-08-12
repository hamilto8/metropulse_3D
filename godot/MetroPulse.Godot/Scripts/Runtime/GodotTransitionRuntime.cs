using MetroPulse.Domain.Core;
using MetroPulse.Domain.Settings;
using MetroPulse.Godot.Camera;

namespace MetroPulse.Godot.Runtime;

public sealed class GodotTransitionRuntime : ITransitionRuntime
{
    private readonly RuntimeInputHost input;
    private readonly GameplayCameraRig gameplayCamera;
    private readonly SimulationScheduler scheduler;
    private IPlayerControlTransitionBridge? controlBridge;
    private Func<TransitionContext>? missionContextProvider;
    private bool dialogueOpen;

    public GodotTransitionRuntime(
        RuntimeInputHost input,
        GameplayCameraRig gameplayCamera,
        SimulationScheduler scheduler)
    {
        this.input = input ?? throw new ArgumentNullException(nameof(input));
        this.scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
        this.gameplayCamera = gameplayCamera ?? throw new ArgumentNullException(nameof(gameplayCamera));
    }

    public int SourceRestoreCount { get; private set; }

    public IReadOnlyList<TransitionPhase> PhaseHistory => phaseHistory.AsReadOnly();

    private List<TransitionPhase> phaseHistory { get; } = [];

    public void SetControlBridge(IPlayerControlTransitionBridge? bridge) => controlBridge = bridge;

    public void SetMissionContextProvider(Func<TransitionContext>? provider) => missionContextProvider = provider;

    public void SetDialogueOpen(bool open, GameState state)
    {
        dialogueOpen = open;
        ApplyInputContext(state);
    }

    public TransitionContext SnapshotContext()
    {
        TransitionContext control = controlBridge?.SnapshotContext() ?? new TransitionContext();
        TransitionContext mission = missionContextProvider?.Invoke() ?? new TransitionContext();
        return control with
        {
            MissionActive = mission.MissionActive,
            MissionCritical = mission.MissionCritical,
            MissionState = mission.MissionState,
        };
    }

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
            TransitionPhase.ConfigurePresentation => ConfigurePresentation(context),
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
        gameplayCamera.RestoreSnapshot(source.CameraState);
        ApplyInputContext(context.From);
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
            gameplayCamera.CaptureSnapshot(),
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
        if (context.To is GameState.Paused or GameState.Result)
        {
            return new TransitionPhaseResult();
        }
        return gameplayCamera.ApplyTransitionState(context.To, controlBridge?.ControlledCameraTarget)
            ? new TransitionPhaseResult()
            : new TransitionPhaseResult(
                false,
                "CAMERA_PLACEMENT_FAILED",
                $"The {context.To.ToToken()} camera could not resolve a safe pose or follow target.");
    }

    private TransitionPhaseResult ConfigureSimulation(TransitionRuntimeContext context)
    {
        scheduler.SetClockPolicy(GameStateCatalog.Policies[context.To].Clock);
        return new TransitionPhaseResult();
    }

    private TransitionPhaseResult ConfigurePresentation(TransitionRuntimeContext context)
    {
        ApplyInputContext(context.To);
        return new TransitionPhaseResult();
    }

    private void ApplyInputContext(GameState state)
    {
        TransitionContext ownership = SnapshotContext();
        input.SetContextSignals(new ControlContextSignals(
            PauseOpen: state == GameState.Paused && !dialogueOpen,
            DialogueOpen: dialogueOpen,
            BuilderActive: state == GameState.Builder,
            VehicleControlled: ownership.ControlledEntityKind == ControlKind.Vehicle,
            AircraftControlled: ownership.ControlledEntityKind == ControlKind.Aircraft,
            PedestrianControlled: ownership.ControlledEntityKind == ControlKind.Pedestrian));
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
        GameplayCameraSnapshot CameraState,
        object? ControlState);
}
