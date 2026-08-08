namespace MetroPulse.Domain.Core;

public enum PauseReason
{
    Menu,
    Dialogue,
    System,
}

public enum PauseEventType
{
    Changed,
    Paused,
    Resumed,
}

public enum TransitionPhase
{
    ValidateRequest,
    SuspendInput,
    ClearHeldActions,
    CaptureSource,
    HandoffEntity,
    PositionCamera,
    ConfigureSimulation,
    ConfigurePresentation,
    ValidateDestination,
    Commit,
}

public static class TransitionPhaseCatalog
{
    public static readonly IReadOnlyList<TransitionPhase> ExecutionOrder = Array.AsReadOnly([
        TransitionPhase.SuspendInput,
        TransitionPhase.ClearHeldActions,
        TransitionPhase.CaptureSource,
        TransitionPhase.HandoffEntity,
        TransitionPhase.PositionCamera,
        TransitionPhase.ConfigureSimulation,
        TransitionPhase.ConfigurePresentation,
        TransitionPhase.ValidateDestination,
    ]);

    public static string ToToken(this TransitionPhase phase) => phase switch
    {
        TransitionPhase.ValidateRequest => "VALIDATE_REQUEST",
        TransitionPhase.SuspendInput => "SUSPEND_INPUT",
        TransitionPhase.ClearHeldActions => "CLEAR_HELD_ACTIONS",
        TransitionPhase.CaptureSource => "CAPTURE_SOURCE",
        TransitionPhase.HandoffEntity => "HANDOFF_ENTITY",
        TransitionPhase.PositionCamera => "POSITION_CAMERA",
        TransitionPhase.ConfigureSimulation => "CONFIGURE_SIMULATION",
        TransitionPhase.ConfigurePresentation => "CONFIGURE_PRESENTATION",
        TransitionPhase.ValidateDestination => "VALIDATE_DESTINATION",
        TransitionPhase.Commit => "COMMIT",
        _ => throw new ArgumentOutOfRangeException(nameof(phase), phase, null),
    };
}

public static class PauseTokens
{
    public static string ToToken(this PauseReason reason) => reason.ToString().ToUpperInvariant();

    public static string ToToken(this PauseEventType eventType) => eventType.ToString().ToUpperInvariant();
}

public sealed record TransitionRequestOptions(
    string? Reason = null,
    string? Source = null,
    string? CorrelationId = null,
    object? Target = null);

public interface IGameTransitionCoordinator
{
    GameState State { get; }

    GameState? ResumeState { get; }

    TransitionEvaluation EvaluateTransition(GameState destination, TransitionRequestOptions? options = null);

    void TransitionTo(GameState destination, TransitionRequestOptions? options = null);
}

public sealed record TransitionRuntimeContext(
    string TransitionId,
    GameState From,
    GameState To,
    TransitionRequestOptions Options,
    object? SourceState,
    IReadOnlyList<TransitionPhase> CompletedPhases);

public sealed record TransitionPhaseResult(
    bool Ok = true,
    string? Code = null,
    string? Reason = null,
    object? SourceState = null,
    Action? Compensate = null,
    Action? Cleanup = null);

public interface ITransitionRuntime
{
    TransitionPhaseResult Execute(TransitionPhase phase, TransitionRuntimeContext context);

    void RestoreSourceState(TransitionRuntimeContext context);
}

public sealed record PauseHold(string Id, PauseReason Reason, string Source);

public sealed record PauseSnapshot(
    bool Paused,
    GameState? ResumeState,
    bool MenuOpen,
    IReadOnlyList<PauseReason> Reasons,
    int HoldCount);

public sealed record PauseChangedEvent(
    PauseEventType Type,
    PauseSnapshot Previous,
    PauseSnapshot Current,
    PauseReason Reason);

public sealed class PauseManager
{
    private static readonly HashSet<GameState> PausableStates =
        [GameState.Management, GameState.Builder, GameState.StreetOnFoot, GameState.StreetVehicle, GameState.Result];

    private readonly IGameTransitionCoordinator transitionCoordinator;
    private readonly Action clearHeldActions;
    private readonly Dictionary<string, PauseHold> holds = new(StringComparer.Ordinal);
    private readonly List<Action<PauseChangedEvent>> listeners = [];
    private long serial;
    private PauseHold? menuToken;

    public PauseManager(IGameTransitionCoordinator transitionCoordinator, Action? clearHeldActions = null)
    {
        this.transitionCoordinator = transitionCoordinator ?? throw new ArgumentNullException(nameof(transitionCoordinator));
        this.clearHeldActions = clearHeldActions ?? (() => { });
    }

    public bool Paused => transitionCoordinator.State == GameState.Paused;

    public bool MenuOpen => menuToken is not null;

    public int HoldCount => holds.Count;

    public PauseSnapshot Snapshot()
    {
        PauseReason[] reasons = holds.Values
            .Select(hold => hold.Reason)
            .Distinct()
            .ToArray();
        return new PauseSnapshot(
            Paused,
            transitionCoordinator.ResumeState,
            reasons.Contains(PauseReason.Menu),
            Array.AsReadOnly(reasons),
            holds.Count);
    }

    public Func<bool> Subscribe(Action<PauseChangedEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent)
        {
            PauseSnapshot current = Snapshot();
            listener(new PauseChangedEvent(PauseEventType.Changed, current, current, PauseReason.System));
        }

        bool active = true;
        return () =>
        {
            if (!active) return false;
            active = false;
            return listeners.Remove(listener);
        };
    }

    public PauseHold Acquire(PauseReason reason, string source = "PauseManager")
    {
        if (!Enum.IsDefined(reason)) throw new ArgumentOutOfRangeException(nameof(reason));
        PauseSnapshot previous = Snapshot();
        GameState state = transitionCoordinator.State;
        if (state != GameState.Paused && !PausableStates.Contains(state))
        {
            throw new InvalidOperationException($"Cannot pause from {state.ToToken()}.");
        }

        clearHeldActions();
        if (state != GameState.Paused)
        {
            transitionCoordinator.TransitionTo(
                GameState.Paused,
                new TransitionRequestOptions($"pause:{reason.ToToken().ToLowerInvariant()}", source));
        }

        var token = new PauseHold($"pause-hold-{++serial}", reason, source);
        holds.Add(token.Id, token);
        if (reason == PauseReason.Menu) menuToken = token;
        Emit(previous.Paused ? PauseEventType.Changed : PauseEventType.Paused, previous, reason);
        return token;
    }

    public bool Release(PauseHold? token, string source = "PauseManager")
    {
        if (token is null || !holds.TryGetValue(token.Id, out PauseHold? hold)) return false;
        PauseSnapshot previous = Snapshot();
        holds.Remove(token.Id);
        if (menuToken?.Id == hold.Id) menuToken = null;
        clearHeldActions();

        try
        {
            if (holds.Count == 0 && transitionCoordinator.State == GameState.Paused)
            {
                GameState resumeState = transitionCoordinator.ResumeState
                    ?? throw new InvalidOperationException("Paused session has no valid resume state.");
                transitionCoordinator.TransitionTo(
                    resumeState,
                    new TransitionRequestOptions($"resume:{hold.Reason.ToToken().ToLowerInvariant()}", source));
            }
        }
        catch
        {
            holds.Add(hold.Id, hold);
            if (hold.Reason == PauseReason.Menu) menuToken = hold;
            throw;
        }

        Emit(Paused ? PauseEventType.Changed : PauseEventType.Resumed, previous, hold.Reason);
        return true;
    }

    public PauseHold OpenMenu(string source = "PauseManager") =>
        menuToken ?? Acquire(PauseReason.Menu, source);

    public bool CloseMenu(string source = "PauseManager") =>
        menuToken is not null && Release(menuToken, source);

    public bool ToggleMenu(string source = "PauseManager")
    {
        if (menuToken is not null)
        {
            CloseMenu(source);
            return false;
        }
        OpenMenu(source);
        return true;
    }

    private void Emit(PauseEventType type, PauseSnapshot previous, PauseReason reason)
    {
        var pauseEvent = new PauseChangedEvent(type, previous, Snapshot(), reason);
        foreach (Action<PauseChangedEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(pauseEvent);
            }
            catch
            {
                // Listener isolation is part of the browser contract.
            }
        }
    }
}
