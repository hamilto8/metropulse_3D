using MetroPulse.Domain.Randomness;

namespace MetroPulse.Domain.Pedestrians;

public static class NpcBehaviorModes
{
    public const string SittingReading = "SITTING_READING";
    public const string Walking = "WALKING";
    public const string TakingPhoto = "TAKING_PHOTO";
    public const string Loitering = "LOITERING";
    public const string Chasing = "CHASING";
    public const string Jogging = "JOGGING";
}

public sealed record NpcBehaviorConfig(
    double AggressionRadius = 20,
    double AttackRange = 1.65,
    double ChaseDuration = 7,
    double AttackCooldown = 1.2,
    double PostFightCooldownMinimum = 12,
    double PostFightCooldownMaximum = 22,
    double InitialAggressionDelayMinimum = 5,
    double InitialAggressionDelayMaximum = 14,
    double TouristWalkMinimum = 5,
    double TouristWalkMaximum = 10,
    double TouristPhotoMinimum = 2,
    double TouristPhotoMaximum = 4);

public sealed record NpcBehaviorState(
    string Mode,
    double Timer,
    string? TargetId = null,
    double ChaseElapsed = 0,
    double AttackCooldown = 0);

public sealed record NpcCandidate(
    string Id,
    string Archetype,
    PedestrianVector3 Position,
    bool KnockedDown = false,
    bool IsHijacking = false,
    string? AttackedById = null);

public sealed record AggressionTransition(
    bool Applied,
    NpcBehaviorState State,
    string? TargetAttackedById);

/// <summary>Pure tourist and bounded aggression state transitions using explicit deterministic samples.</summary>
public static class NpcBehaviorModel
{
    public static readonly NpcBehaviorConfig DefaultConfig = new();

    public static NpcBehaviorState CreateState(
        string? archetype,
        double timingSample = 0.5,
        NpcBehaviorConfig? config = null)
    {
        config ??= DefaultConfig;
        return archetype switch
        {
            "CAFE_READER" => new NpcBehaviorState(NpcBehaviorModes.SittingReading, double.PositiveInfinity),
            "TOURIST" => new NpcBehaviorState(
                NpcBehaviorModes.Walking,
                Range(config.TouristWalkMinimum, config.TouristWalkMaximum, timingSample)),
            "CRIMINAL" => new NpcBehaviorState(
                NpcBehaviorModes.Loitering,
                Range(config.InitialAggressionDelayMinimum, config.InitialAggressionDelayMaximum, timingSample)),
            "JOGGER" => new NpcBehaviorState(NpcBehaviorModes.Jogging, double.PositiveInfinity),
            _ => new NpcBehaviorState(NpcBehaviorModes.Walking, double.PositiveInfinity),
        };
    }

    public static NpcBehaviorState CreateState(
        string? archetype,
        IRandomStream stream,
        NpcBehaviorConfig? config = null) =>
        CreateState(archetype, NextBehaviorSample(stream), config);

    public static NpcBehaviorState AdvanceTourist(
        NpcBehaviorState state,
        double delta,
        double timingSample = 0.5,
        NpcBehaviorConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(state);
        config ??= DefaultConfig;
        if (state.Mode is not NpcBehaviorModes.Walking and not NpcBehaviorModes.TakingPhoto) return state;
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.25) : 0;
        double timer = state.Timer - safeDelta;
        if (timer > 0) return state with { Timer = timer };
        return state.Mode == NpcBehaviorModes.Walking
            ? state with
            {
                Mode = NpcBehaviorModes.TakingPhoto,
                Timer = Range(config.TouristPhotoMinimum, config.TouristPhotoMaximum, timingSample),
            }
            : state with
            {
                Mode = NpcBehaviorModes.Walking,
                Timer = Range(config.TouristWalkMinimum, config.TouristWalkMaximum, timingSample),
            };
    }

    public static NpcBehaviorState AdvanceTourist(
        NpcBehaviorState state,
        double delta,
        IRandomStream stream,
        NpcBehaviorConfig? config = null) =>
        AdvanceTourist(state, delta, NextBehaviorSample(stream), config);

    public static NpcCandidate? SelectAggressionTarget(
        string criminalId,
        PedestrianVector3 criminalPosition,
        IReadOnlyList<NpcCandidate>? candidates,
        string? controlledPedestrianId = null,
        NpcBehaviorConfig? config = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(criminalId);
        ArgumentNullException.ThrowIfNull(criminalPosition);
        if (candidates is null) return null;
        config ??= DefaultConfig;
        double radius = double.IsFinite(config.AggressionRadius)
            ? Math.Max(0, config.AggressionRadius)
            : DefaultConfig.AggressionRadius;
        NpcCandidate[] available = candidates.Where(candidate =>
            candidate is not null
            && candidate.Id != criminalId
            && candidate.Position is not null
            && candidate.Position.IsFinite
            && !candidate.KnockedDown
            && !candidate.IsHijacking
            && (candidate.Archetype != "CRIMINAL" || candidate.Id == controlledPedestrianId)
            && (candidate.AttackedById is null || candidate.AttackedById == criminalId)
            && criminalPosition.DistanceTo(candidate.Position) <= radius).ToArray();
        if (available.Length == 0) return null;
        NpcCandidate? controlled = available.FirstOrDefault(candidate => candidate.Id == controlledPedestrianId);
        if (controlled is not null) return controlled;
        return available.Aggregate((closest, candidate) =>
            criminalPosition.DistanceSquaredTo(candidate.Position)
                < criminalPosition.DistanceSquaredTo(closest.Position)
                ? candidate
                : closest);
    }

    public static AggressionTransition BeginAggression(
        string criminalId,
        NpcBehaviorState state,
        string targetId,
        string? targetAttackedById)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(criminalId);
        ArgumentNullException.ThrowIfNull(state);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetId);
        if (targetAttackedById is not null && targetAttackedById != criminalId)
        {
            return new AggressionTransition(false, state, targetAttackedById);
        }
        return new AggressionTransition(
            true,
            state with
            {
                Mode = NpcBehaviorModes.Chasing,
                TargetId = targetId,
                ChaseElapsed = 0,
                AttackCooldown = 0,
            },
            criminalId);
    }

    public static AggressionTransition FinishAggression(
        string criminalId,
        NpcBehaviorState state,
        string? targetAttackedById,
        double timingSample = 0.5,
        NpcBehaviorConfig? config = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(criminalId);
        ArgumentNullException.ThrowIfNull(state);
        config ??= DefaultConfig;
        return new AggressionTransition(
            true,
            state with
            {
                Mode = NpcBehaviorModes.Loitering,
                TargetId = null,
                ChaseElapsed = 0,
                AttackCooldown = 0,
                Timer = Range(config.PostFightCooldownMinimum, config.PostFightCooldownMaximum, timingSample),
            },
            targetAttackedById == criminalId ? null : targetAttackedById);
    }

    public static AggressionTransition FinishAggression(
        string criminalId,
        NpcBehaviorState state,
        string? targetAttackedById,
        IRandomStream stream,
        NpcBehaviorConfig? config = null) =>
        FinishAggression(
            criminalId,
            state,
            targetAttackedById,
            NextBehaviorSample(stream),
            config);

    private static double NextBehaviorSample(IRandomStream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);
        if (stream.Name != RandomStreamNames.PedestrianBehavior)
        {
            throw new ArgumentException(
                $"NPC behavior requires the {RandomStreamNames.PedestrianBehavior} stream.",
                nameof(stream));
        }
        try
        {
            double sample = stream.NextDouble();
            return double.IsFinite(sample) ? Math.Clamp(sample, 0, 1) : 0.5;
        }
        catch
        {
            return 0.5;
        }
    }

    private static double Range(double minimum, double maximum, double sample)
    {
        double roll = double.IsFinite(sample) ? Math.Clamp(sample, 0, 1) : 0.5;
        return minimum + (maximum - minimum) * roll;
    }
}
