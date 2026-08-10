namespace MetroPulse.Domain.Core;

public enum TransitionCoordinatorEventType
{
    Started,
    PhaseCompleted,
    Committed,
    Failed,
}

public sealed record TransitionCoordinatorEvent(
    TransitionCoordinatorEventType Type,
    GameTransitionDescriptor Transition,
    TransitionPhase Phase,
    IReadOnlyList<TransitionPhase> CompletedPhases,
    Exception? Error = null);

public sealed class GameTransitionCoordinator : IGameTransitionCoordinator
{
    private readonly GameStateMachine stateMachine;
    private readonly ITransitionRuntime runtime;
    private readonly List<Action<TransitionCoordinatorEvent>> listeners = [];
    private TransitionExecution? activeExecution;

    public GameTransitionCoordinator(GameStateMachine stateMachine, ITransitionRuntime runtime)
    {
        this.stateMachine = stateMachine ?? throw new ArgumentNullException(nameof(stateMachine));
        this.runtime = runtime ?? throw new ArgumentNullException(nameof(runtime));
    }

    public GameState State => stateMachine.State;

    public GameState? ResumeState => stateMachine.ResumeState;

    public GameTransitionDescriptor? ActiveTransition => stateMachine.ActiveTransition;

    public GameTransitionDescriptor? LastTransition => stateMachine.LastTransition;

    public TransitionPhase? ActivePhase => activeExecution?.Phase;

    public TransitionEvaluation EvaluateTransition(GameState destination, TransitionRequestOptions? options = null) =>
        stateMachine.EvaluateTransition(destination, options);

    public Func<bool> Subscribe(Action<TransitionCoordinatorEvent> listener)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        bool active = true;
        return () =>
        {
            if (!active) return false;
            active = false;
            return listeners.Remove(listener);
        };
    }

    public void TransitionTo(GameState destination, TransitionRequestOptions? options = null)
    {
        if (destination == State && activeExecution is null)
        {
            return;
        }
        if (activeExecution is not null)
        {
            throw new GameTransitionException(
                TransitionRejectionCodes.TransitionInProgress,
                "Another coordinated transition is already in progress.");
        }

        GameTransitionDescriptor transition = stateMachine.BeginTransition(destination, options);
        var execution = new TransitionExecution(transition);
        activeExecution = execution;
        Emit(TransitionCoordinatorEventType.Started, execution);

        try
        {
            foreach (TransitionPhase phase in TransitionPhaseCatalog.ExecutionOrder)
            {
                ExecutePhase(execution, phase);
            }

            execution.Phase = TransitionPhase.Commit;
            stateMachine.CommitTransition();
            execution.CompletedPhases.Add(TransitionPhase.Commit);
            Emit(TransitionCoordinatorEventType.Committed, execution);
        }
        catch (Exception cause)
        {
            var transitionError = cause as GameTransitionException
                ?? new GameTransitionException(
                    "TRANSITION_STEP_FAILED",
                    $"Transition failed during {execution.Phase.ToToken()}: {cause.Message}",
                    cause);
            Compensate(execution, transitionError);
            if (stateMachine.ActiveTransition is not null)
            {
                stateMachine.FailTransition();
            }
            Emit(TransitionCoordinatorEventType.Failed, execution, transitionError);
            throw transitionError;
        }
        finally
        {
            Cleanup(execution);
            activeExecution = null;
        }
    }

    private void ExecutePhase(TransitionExecution execution, TransitionPhase phase)
    {
        execution.Phase = phase;
        TransitionRuntimeContext context = CreateContext(execution);
        if (phase == TransitionPhase.ValidateDestination)
        {
            TransitionEvaluation validation = GameTransitionPolicy.ValidateDestination(
                execution.Transition.To,
                stateMachine.GetContext());
            if (!validation.Allowed)
            {
                throw new GameTransitionException(
                    validation.Code ?? TransitionRejectionCodes.IllegalEdge,
                    validation.Reason ?? "Destination ownership validation failed.");
            }
        }

        TransitionPhaseResult result = runtime.Execute(phase, context)
            ?? throw new InvalidOperationException($"Runtime returned no result for {phase.ToToken()}.");
        if (!result.Ok)
        {
            throw new GameTransitionException(
                result.Code ?? "TRANSITION_STEP_FAILED",
                result.Reason ?? $"Runtime phase {phase.ToToken()} failed.");
        }

        if (phase == TransitionPhase.CaptureSource)
        {
            execution.SourceState = result.SourceState;
            execution.Compensations.Add(() => runtime.RestoreSourceState(CreateContext(execution)));
        }
        if (result.Compensate is not null) execution.Compensations.Add(result.Compensate);
        if (result.Cleanup is not null) execution.Cleanup.Add(result.Cleanup);
        execution.CompletedPhases.Add(phase);
        Emit(TransitionCoordinatorEventType.PhaseCompleted, execution);
    }

    private static TransitionRuntimeContext CreateContext(TransitionExecution execution) =>
        new(
            execution.Transition.Id,
            execution.Transition.From,
            execution.Transition.To,
            execution.Transition.Options,
            execution.SourceState,
            Array.AsReadOnly(execution.CompletedPhases.ToArray()));

    private static void Compensate(TransitionExecution execution, Exception transitionError)
    {
        List<Exception> errors = [];
        for (int index = execution.Compensations.Count - 1; index >= 0; index--)
        {
            try
            {
                execution.Compensations[index]();
            }
            catch (Exception error)
            {
                errors.Add(error);
            }
        }
        if (errors.Count > 0)
        {
            transitionError.Data["compensationErrors"] = errors.AsReadOnly();
        }
    }

    private static void Cleanup(TransitionExecution execution)
    {
        for (int index = execution.Cleanup.Count - 1; index >= 0; index--)
        {
            try
            {
                execution.Cleanup[index]();
            }
            catch
            {
                // Cleanup is best-effort and must not replace the transition outcome.
            }
        }
    }

    private void Emit(
        TransitionCoordinatorEventType type,
        TransitionExecution execution,
        Exception? error = null)
    {
        var transitionEvent = new TransitionCoordinatorEvent(
            type,
            execution.Transition,
            execution.Phase,
            Array.AsReadOnly(execution.CompletedPhases.ToArray()),
            error);
        foreach (Action<TransitionCoordinatorEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(transitionEvent);
            }
            catch
            {
                // Listener isolation is part of the transition contract.
            }
        }
    }

    private sealed class TransitionExecution(GameTransitionDescriptor transition)
    {
        public GameTransitionDescriptor Transition { get; } = transition;
        public TransitionPhase Phase { get; set; } = TransitionPhase.ValidateRequest;
        public object? SourceState { get; set; }
        public List<TransitionPhase> CompletedPhases { get; } = [TransitionPhase.ValidateRequest];
        public List<Action> Compensations { get; } = [];
        public List<Action> Cleanup { get; } = [];
    }
}
