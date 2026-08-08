namespace MetroPulse.Domain.Core;

public static class TransitionRejectionCodes
{
    public const string SameState = "SAME_STATE";
    public const string IllegalEdge = "ILLEGAL_EDGE";
    public const string TransitionInProgress = "TRANSITION_IN_PROGRESS";
    public const string HandoffUnresolved = "HANDOFF_UNRESOLVED";
    public const string MissionCritical = "MISSION_CRITICAL";
    public const string ControlledEntityActive = "CONTROLLED_ENTITY_ACTIVE";
    public const string ControlledEntityRequired = "CONTROLLED_ENTITY_REQUIRED";
    public const string MultipleControlledEntities = "MULTIPLE_CONTROLLED_ENTITIES";
    public const string InvalidResumeTarget = "INVALID_RESUME_TARGET";
}

public sealed record TransitionContext(
    bool MissionActive = false,
    bool MissionCritical = false,
    string MissionState = "IDLE",
    bool HandoffPending = false,
    int ControlledEntityCount = 0,
    ControlKind ControlledEntityKind = ControlKind.None,
    bool HeatActive = false);

public sealed record TransitionEvaluation(bool Allowed, string? Code = null, string? Reason = null)
{
    public static readonly TransitionEvaluation Success = new(true);
}

public static class GameTransitionPolicy
{
    public static TransitionEvaluation EvaluateRequest(
        GameState source,
        GameState destination,
        TransitionContext? context = null,
        GameState? resumeState = null)
    {
        context ??= new TransitionContext();
        if (source == GameState.Transition)
        {
            return new TransitionEvaluation(false, TransitionRejectionCodes.TransitionInProgress);
        }

        if (destination == GameState.Transition)
        {
            return Reject(TransitionRejectionCodes.IllegalEdge, "TRANSITION is owned by GameManager and cannot be requested directly.");
        }

        if (destination == source)
        {
            return Reject(TransitionRejectionCodes.SameState, $"{destination.ToToken()} is already active.");
        }

        if (destination == GameState.Builder)
        {
            if (context.HandoffPending)
            {
                return Reject(TransitionRejectionCodes.HandoffUnresolved, "Builder entry is unavailable while a street handoff is unresolved.");
            }

            TransitionEvaluation destinationResult = ValidateDestination(destination, context);
            if (!destinationResult.Allowed)
            {
                return destinationResult;
            }
        }

        IReadOnlyList<GameState> legalDestinations = source == GameState.Paused && resumeState.HasValue
            ? Array.AsReadOnly([resumeState.Value, GameState.Menu])
            : GameStateCatalog.Transitions[source];
        if (!legalDestinations.Contains(destination))
        {
            string code = source == GameState.Paused
                ? TransitionRejectionCodes.InvalidResumeTarget
                : TransitionRejectionCodes.IllegalEdge;
            return Reject(code, $"Illegal game-state transition: {source.ToToken()} -> {destination.ToToken()}");
        }

        if (GameStateCatalog.IsStreetState(source)
            && context.MissionCritical
            && destination is not GameState.Result and not GameState.Paused)
        {
            return Reject(TransitionRejectionCodes.MissionCritical, "The active mission must resolve before leaving street gameplay.");
        }

        return TransitionEvaluation.Success;
    }

    public static TransitionEvaluation ValidateDestination(GameState destination, TransitionContext context)
    {
        if (context.ControlledEntityCount > 1)
        {
            return Reject(TransitionRejectionCodes.MultipleControlledEntities, "More than one entity currently has player control.");
        }

        if (destination is GameState.Boot or GameState.Load or GameState.Management or GameState.Builder or GameState.Result)
        {
            if (context.ControlledEntityCount != 0)
            {
                return Reject(TransitionRejectionCodes.ControlledEntityActive, $"{destination.ToToken()} requires player entity control to be released.");
            }
        }

        if (destination is GameState.Boot or GameState.Load && (context.MissionActive || context.MissionCritical))
        {
            return Reject(TransitionRejectionCodes.MissionCritical, $"{destination.ToToken()} cannot own an active mission.");
        }

        if (destination is GameState.Management or GameState.Builder && context.MissionCritical)
        {
            return Reject(TransitionRejectionCodes.MissionCritical, $"{destination.ToToken()} is unavailable until the mission reaches a resolved state.");
        }

        if (destination == GameState.StreetOnFoot
            && (context.ControlledEntityCount != 1 || context.ControlledEntityKind != ControlKind.Pedestrian))
        {
            return Reject(TransitionRejectionCodes.ControlledEntityRequired, "STREET_ON_FOOT requires exactly one controlled pedestrian.");
        }

        if (destination == GameState.StreetVehicle
            && (context.ControlledEntityCount != 1
                || context.ControlledEntityKind is not ControlKind.Vehicle and not ControlKind.Aircraft))
        {
            return Reject(TransitionRejectionCodes.ControlledEntityRequired, "STREET_VEHICLE requires exactly one controlled vehicle or aircraft.");
        }

        return TransitionEvaluation.Success;
    }

    private static TransitionEvaluation Reject(string code, string reason) => new(false, code, reason);
}
