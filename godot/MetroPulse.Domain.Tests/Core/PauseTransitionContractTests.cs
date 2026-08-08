using MetroPulse.Domain.Core;
using Xunit;

namespace MetroPulse.Domain.Tests.Core;

public sealed class PauseTransitionContractTests
{
    [Theory]
    [InlineData(GameState.Management)]
    [InlineData(GameState.Builder)]
    [InlineData(GameState.StreetOnFoot)]
    [InlineData(GameState.StreetVehicle)]
    [InlineData(GameState.Result)]
    public void EveryGameplayStatePausesAndResumesToExactSource(GameState initialState)
    {
        var coordinator = new FakeCoordinator(initialState);
        int clears = 0;
        var pause = new PauseManager(coordinator, () => clears++);

        PauseHold hold = pause.Acquire(PauseReason.Menu, "test");
        Assert.Equal(GameState.Paused, coordinator.State);
        Assert.Equal(initialState, coordinator.ResumeState);
        Assert.Equal([PauseReason.Menu], pause.Snapshot().Reasons);

        Assert.True(pause.Release(hold, "test"));
        Assert.Equal(initialState, coordinator.State);
        Assert.Null(coordinator.ResumeState);
        Assert.Equal(2, clears);
    }

    [Fact]
    public void NestedHoldsCannotResumeEachOtherAndEventsStayOrdered()
    {
        var coordinator = new FakeCoordinator(GameState.StreetVehicle);
        var pause = new PauseManager(coordinator);
        var events = new List<PauseEventType>();
        pause.Subscribe(pauseEvent => events.Add(pauseEvent.Type));

        PauseHold dialogue = pause.Acquire(PauseReason.Dialogue);
        PauseHold menu = pause.OpenMenu();
        Assert.Equal([PauseReason.Dialogue, PauseReason.Menu], pause.Snapshot().Reasons);
        Assert.True(pause.Release(menu));
        Assert.Equal(GameState.Paused, coordinator.State);
        Assert.True(pause.Release(dialogue));
        Assert.Equal(GameState.StreetVehicle, coordinator.State);
        Assert.Equal(
            [PauseEventType.Paused, PauseEventType.Changed, PauseEventType.Changed, PauseEventType.Resumed],
            events);
    }

    [Fact]
    public void MenuOperationsAreIdempotentAndStaleReleasesAreHarmless()
    {
        var coordinator = new FakeCoordinator(GameState.Builder);
        var pause = new PauseManager(coordinator);

        PauseHold first = pause.OpenMenu();
        Assert.Same(first, pause.OpenMenu());
        Assert.False(pause.ToggleMenu());
        Assert.Equal(GameState.Builder, coordinator.State);
        Assert.False(pause.Release(first));
        Assert.True(pause.ToggleMenu());
        Assert.False(pause.ToggleMenu());
    }

    [Fact]
    public void FailedFinalResumeRestoresTheReleasedHold()
    {
        var coordinator = new FakeCoordinator(GameState.Management);
        var pause = new PauseManager(coordinator);
        PauseHold hold = pause.Acquire(PauseReason.System);
        coordinator.FailNextTransition = true;

        Assert.Throws<InvalidOperationException>(() => pause.Release(hold));
        Assert.Equal(1, pause.HoldCount);
        Assert.True(pause.Paused);
        Assert.Equal([PauseReason.System], pause.Snapshot().Reasons);
    }

    [Fact]
    public void PauseFailsClosedOutsideStableGameplayStates()
    {
        foreach (GameState state in new[] { GameState.Boot, GameState.Load, GameState.Menu })
        {
            var pause = new PauseManager(new FakeCoordinator(state));
            Assert.Throws<InvalidOperationException>(() => pause.Acquire(PauseReason.Menu));
            Assert.Equal(0, pause.HoldCount);
        }
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            new PauseManager(new FakeCoordinator(GameState.Management)).Acquire((PauseReason)99));
    }

    [Fact]
    public void TransitionPhaseContractPreservesCanonicalOrder()
    {
        Assert.Equal(
            [
                "SUSPEND_INPUT",
                "CLEAR_HELD_ACTIONS",
                "CAPTURE_SOURCE",
                "HANDOFF_ENTITY",
                "POSITION_CAMERA",
                "CONFIGURE_SIMULATION",
                "CONFIGURE_PRESENTATION",
                "VALIDATE_DESTINATION",
            ],
            TransitionPhaseCatalog.ExecutionOrder.Select(phase => phase.ToToken()));
        Assert.Equal("VALIDATE_REQUEST", TransitionPhase.ValidateRequest.ToToken());
        Assert.Equal("COMMIT", TransitionPhase.Commit.ToToken());
    }

    private sealed class FakeCoordinator : IGameTransitionCoordinator
    {
        public FakeCoordinator(GameState state) => State = state;

        public GameState State { get; private set; }

        public GameState? ResumeState { get; private set; }

        public bool FailNextTransition { get; set; }

        public TransitionEvaluation EvaluateTransition(GameState destination, TransitionRequestOptions? options = null) =>
            GameTransitionPolicy.EvaluateRequest(State, destination, resumeState: ResumeState);

        public void TransitionTo(GameState destination, TransitionRequestOptions? options = null)
        {
            if (FailNextTransition)
            {
                FailNextTransition = false;
                throw new InvalidOperationException("Synthetic transition failure.");
            }
            TransitionEvaluation evaluation = EvaluateTransition(destination, options);
            if (!evaluation.Allowed) throw new InvalidOperationException(evaluation.Code);
            if (destination == GameState.Paused)
            {
                ResumeState = State;
                State = destination;
                return;
            }
            State = destination;
            ResumeState = null;
        }
    }
}
