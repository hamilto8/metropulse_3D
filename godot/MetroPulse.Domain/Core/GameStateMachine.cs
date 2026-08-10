namespace MetroPulse.Domain.Core;

public enum GameTransitionStatus
{
    Active,
    Committed,
    Failed,
}

public sealed record GameTransitionDescriptor(
    string Id,
    GameState From,
    GameState To,
    TransitionRequestOptions Options,
    TransitionEffects Effects,
    GameTransitionStatus Status,
    long Revision);

public sealed record GameSessionStateSnapshot(
    GameState State,
    GameState? ResumeState,
    long Revision,
    GameTransitionDescriptor? ActiveTransition,
    GameTransitionDescriptor? LastTransition);

/// <summary>
/// Sole mutable authority for the high-level game state. Engine effects are
/// deliberately delegated to <see cref="GameTransitionCoordinator"/>.
/// </summary>
public sealed class GameStateMachine
{
    private readonly Func<TransitionContext> contextProvider;
    private long transitionSerial;

    public GameStateMachine(
        GameState initialState = GameState.Boot,
        Func<TransitionContext>? contextProvider = null,
        GameState? resumeState = null)
    {
        if (!Enum.IsDefined(initialState) || initialState == GameState.Transition)
        {
            throw new ArgumentOutOfRangeException(nameof(initialState));
        }
        if ((resumeState.HasValue && (!Enum.IsDefined(resumeState.Value) || resumeState == GameState.Transition))
            || (initialState == GameState.Paused) != resumeState.HasValue)
        {
            throw new ArgumentException("Only a paused state may have one stable resume target.", nameof(resumeState));
        }

        State = initialState;
        ResumeState = resumeState;
        this.contextProvider = contextProvider ?? (() => new TransitionContext());
    }

    public GameState State { get; private set; }

    public GameState? ResumeState { get; private set; }

    public long Revision { get; private set; }

    public GameTransitionDescriptor? ActiveTransition { get; private set; }

    public GameTransitionDescriptor? LastTransition { get; private set; }

    public TransitionContext GetContext() => contextProvider();

    public TransitionEvaluation EvaluateTransition(
        GameState destination,
        TransitionRequestOptions? options = null)
    {
        _ = options;
        return GameTransitionPolicy.EvaluateRequest(State, destination, GetContext(), ResumeState);
    }

    public GameTransitionDescriptor BeginTransition(
        GameState destination,
        TransitionRequestOptions? options = null)
    {
        if (ActiveTransition is not null)
        {
            throw new GameTransitionException(
                TransitionRejectionCodes.TransitionInProgress,
                "Another game-state transition is already active.");
        }

        TransitionEvaluation evaluation = EvaluateTransition(destination, options);
        if (!evaluation.Allowed)
        {
            throw new GameTransitionException(
                evaluation.Code ?? TransitionRejectionCodes.IllegalEdge,
                evaluation.Reason ?? $"Transition to {destination.ToToken()} was rejected.");
        }

        GameState source = State;
        ActiveTransition = new GameTransitionDescriptor(
            $"transition-{++transitionSerial}",
            source,
            destination,
            options ?? new TransitionRequestOptions(),
            GameStateCatalog.GetTransitionEffects(source, destination),
            GameTransitionStatus.Active,
            Revision + 1);
        State = GameState.Transition;
        Revision++;
        return ActiveTransition;
    }

    public GameSessionStateSnapshot CommitTransition()
    {
        GameTransitionDescriptor transition = ActiveTransition
            ?? throw new InvalidOperationException("No active transition can be committed.");
        TransitionEvaluation destination = GameTransitionPolicy.ValidateDestination(transition.To, GetContext());
        if (!destination.Allowed)
        {
            throw new GameTransitionException(
                destination.Code ?? TransitionRejectionCodes.IllegalEdge,
                destination.Reason ?? $"Destination {transition.To.ToToken()} is invalid.");
        }

        if (transition.To == GameState.Paused)
        {
            ResumeState = transition.From;
        }
        else if (transition.From == GameState.Paused)
        {
            ResumeState = null;
        }

        State = transition.To;
        Revision++;
        LastTransition = transition with { Status = GameTransitionStatus.Committed, Revision = Revision };
        ActiveTransition = null;
        return Snapshot();
    }

    public GameSessionStateSnapshot FailTransition()
    {
        GameTransitionDescriptor transition = ActiveTransition
            ?? throw new InvalidOperationException("No active transition can be failed.");
        State = SelectRecoveryState(transition.From, GetContext());
        if (State != GameState.Paused)
        {
            ResumeState = null;
        }
        Revision++;
        LastTransition = transition with { Status = GameTransitionStatus.Failed, Revision = Revision };
        ActiveTransition = null;
        return Snapshot();
    }

    public GameSessionStateSnapshot Snapshot() =>
        new(State, ResumeState, Revision, ActiveTransition, LastTransition);

    private static GameState SelectRecoveryState(GameState source, TransitionContext context)
    {
        if (GameTransitionPolicy.ValidateDestination(source, context).Allowed)
        {
            return source;
        }
        if (GameTransitionPolicy.ValidateDestination(GameState.Management, context).Allowed)
        {
            return GameState.Management;
        }
        return GameState.Menu;
    }
}

public sealed class GameTransitionException : InvalidOperationException
{
    public GameTransitionException(string code, string message, Exception? innerException = null)
        : base(message, innerException) => Code = code;

    public string Code { get; }
}
