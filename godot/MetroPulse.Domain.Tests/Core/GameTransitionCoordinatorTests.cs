using MetroPulse.Domain.Core;
using Xunit;

namespace MetroPulse.Domain.Tests.Core;

public sealed class GameTransitionCoordinatorTests
{
    [Fact]
    public void SuccessfulTransitionRunsCanonicalOrderAndCommits()
    {
        TransitionContext context = new();
        var runtime = new RecordingRuntime();
        var machine = new GameStateMachine(GameState.Management, () => context);
        var coordinator = new GameTransitionCoordinator(machine, runtime);
        var events = new List<TransitionCoordinatorEventType>();
        coordinator.Subscribe(item => events.Add(item.Type));

        coordinator.TransitionTo(GameState.Builder, new TransitionRequestOptions("test", "unit"));

        Assert.Equal(GameState.Builder, coordinator.State);
        Assert.Equal(
            TransitionPhaseCatalog.ExecutionOrder,
            runtime.Executed);
        Assert.Equal(
            [
                TransitionCoordinatorEventType.Started,
                .. Enumerable.Repeat(
                    TransitionCoordinatorEventType.PhaseCompleted,
                    TransitionPhaseCatalog.ExecutionOrder.Count),
                TransitionCoordinatorEventType.Committed,
            ],
            events);
        Assert.Equal(GameTransitionStatus.Committed, coordinator.LastTransition?.Status);
        Assert.Equal(2, machine.Revision);
    }

    [Theory]
    [MemberData(nameof(RuntimePhases))]
    public void EveryRuntimePhaseFailureCompensatesInReverseAndCleansUp(TransitionPhase failingPhase)
    {
        var runtime = new RecordingRuntime { FailingPhase = failingPhase };
        var machine = new GameStateMachine(GameState.Management);
        var coordinator = new GameTransitionCoordinator(machine, runtime);

        GameTransitionException error = Assert.Throws<GameTransitionException>(() =>
            coordinator.TransitionTo(GameState.Builder));

        Assert.Equal("SYNTHETIC_PHASE_FAILURE", error.Code);
        Assert.Equal(GameState.Management, coordinator.State);
        Assert.Equal(GameTransitionStatus.Failed, coordinator.LastTransition?.Status);
        int successfulPhases = Array.IndexOf(TransitionPhaseCatalog.ExecutionOrder.ToArray(), failingPhase);
        var registeredCompensations = Enumerable.Range(1, successfulPhases).ToList();
        if (successfulPhases > Array.IndexOf(
            TransitionPhaseCatalog.ExecutionOrder.ToArray(),
            TransitionPhase.CaptureSource))
        {
            registeredCompensations.Insert(2, 0);
        }
        registeredCompensations.Reverse();
        Assert.Equal(registeredCompensations, runtime.Compensated);
        Assert.Equal(runtime.CleanupRegistered, runtime.CleanedUp.Count);
    }

    [Fact]
    public void CommitOwnershipFailureAlsoCompensatesBeforeSafeRecovery()
    {
        TransitionContext context = new();
        var runtime = new RecordingRuntime
        {
            OnPhase = phase =>
            {
                if (phase == TransitionPhase.ValidateDestination)
                {
                    context = new TransitionContext(ControlledEntityCount: 1, ControlledEntityKind: ControlKind.Vehicle);
                }
            },
        };
        var machine = new GameStateMachine(GameState.Management, () => context);
        var coordinator = new GameTransitionCoordinator(machine, runtime);

        GameTransitionException error = Assert.Throws<GameTransitionException>(() =>
            coordinator.TransitionTo(GameState.Builder));

        Assert.Equal(TransitionRejectionCodes.ControlledEntityActive, error.Code);
        Assert.Equal(GameState.Menu, coordinator.State);
        Assert.NotEmpty(runtime.Compensated);
    }

    [Fact]
    public void ReentrantRequestIsRejectedWithoutReplacingTheActiveTransition()
    {
        GameTransitionCoordinator? coordinator = null;
        GameTransitionException? nestedError = null;
        var runtime = new RecordingRuntime
        {
            OnPhase = phase =>
            {
                if (phase == TransitionPhase.HandoffEntity)
                {
                    nestedError = Assert.Throws<GameTransitionException>(() =>
                        coordinator!.TransitionTo(GameState.Menu));
                }
            },
        };
        var machine = new GameStateMachine(GameState.Management);
        coordinator = new GameTransitionCoordinator(machine, runtime);

        coordinator.TransitionTo(GameState.Builder);

        Assert.Equal(TransitionRejectionCodes.TransitionInProgress, nestedError?.Code);
        Assert.Equal(GameState.Builder, coordinator.State);
    }

    [Fact]
    public void PauseManagerUsesTheSameTransactionalCoordinatorAndExactResumeState()
    {
        var runtime = new RecordingRuntime();
        var machine = new GameStateMachine(GameState.Builder);
        var coordinator = new GameTransitionCoordinator(machine, runtime);
        var pause = new PauseManager(coordinator);

        PauseHold hold = pause.Acquire(PauseReason.Menu);
        Assert.Equal(GameState.Paused, machine.State);
        Assert.Equal(GameState.Builder, machine.ResumeState);
        Assert.True(pause.Release(hold));
        Assert.Equal(GameState.Builder, machine.State);
        Assert.Null(machine.ResumeState);
    }

    [Fact]
    public void SameStateIsIdempotentAndListenerFailuresAreIsolated()
    {
        var runtime = new RecordingRuntime();
        var machine = new GameStateMachine(GameState.Management);
        var coordinator = new GameTransitionCoordinator(machine, runtime);
        coordinator.Subscribe(_ => throw new InvalidOperationException("listener fault"));

        coordinator.TransitionTo(GameState.Management);
        coordinator.TransitionTo(GameState.Builder);

        Assert.Equal(GameState.Builder, coordinator.State);
        Assert.Equal(TransitionPhaseCatalog.ExecutionOrder.Count, runtime.Executed.Count);
    }

    [Fact]
    public void StateAuthorityRejectsTransientOrMalformedInitialSnapshots()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new GameStateMachine(GameState.Transition));
        Assert.Throws<ArgumentOutOfRangeException>(() => new GameStateMachine((GameState)999));
        Assert.Throws<ArgumentException>(() => new GameStateMachine(GameState.Paused));
        Assert.Throws<ArgumentException>(() => new GameStateMachine(GameState.Management, resumeState: GameState.Builder));
        Assert.Throws<ArgumentException>(() => new GameStateMachine(GameState.Paused, resumeState: (GameState)999));
    }

    public static TheoryData<TransitionPhase> RuntimePhases => new(
        TransitionPhase.SuspendInput,
        TransitionPhase.ClearHeldActions,
        TransitionPhase.CaptureSource,
        TransitionPhase.HandoffEntity,
        TransitionPhase.PositionCamera,
        TransitionPhase.ConfigureSimulation,
        TransitionPhase.ConfigurePresentation,
        TransitionPhase.ValidateDestination);

    private sealed class RecordingRuntime : ITransitionRuntime
    {
        private int compensationSerial;

        public TransitionPhase? FailingPhase { get; init; }

        public Action<TransitionPhase>? OnPhase { get; init; }

        public List<TransitionPhase> Executed { get; } = [];

        public List<int> Compensated { get; } = [];

        public List<int> CleanedUp { get; } = [];

        public int CleanupRegistered { get; private set; }

        public TransitionPhaseResult Execute(TransitionPhase phase, TransitionRuntimeContext context)
        {
            _ = context;
            Executed.Add(phase);
            OnPhase?.Invoke(phase);
            if (phase == FailingPhase)
            {
                return new(false, "SYNTHETIC_PHASE_FAILURE", $"Synthetic failure at {phase.ToToken()}.");
            }

            int serial = ++compensationSerial;
            CleanupRegistered++;
            return new(
                SourceState: phase == TransitionPhase.CaptureSource ? "captured" : null,
                Compensate: () => Compensated.Add(serial),
                Cleanup: () => CleanedUp.Add(serial));
        }

        public void RestoreSourceState(TransitionRuntimeContext context)
        {
            Assert.Equal("captured", context.SourceState);
            Compensated.Add(0);
        }
    }
}
