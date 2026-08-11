namespace MetroPulse.Domain.Traffic;

public sealed record HitAndRunPursuitConfig(
    double NearbyPoliceRadius = 65,
    int MaximumResponders = 2,
    double Duration = 22,
    double FugitiveSpeedMultiplier = 1.55,
    double MaximumFugitiveSpeed = 38,
    double PoliceMaximumSpeed = 42,
    double PoliceCatchUpSpeed = 8,
    double PoliceFollowingDistance = 5);

public sealed record HitAndRunPoliceCandidate(
    string Id,
    TrafficPoint Position,
    bool Police,
    bool PlayerControlled = false,
    bool Disabled = false,
    bool Parked = false,
    bool AlreadyAssigned = false);

public sealed record HitAndRunPursuitState(
    string OffenderId,
    double Elapsed,
    double Duration,
    double NormalMaximumSpeed,
    double EscapeSpeed,
    IReadOnlyList<string> ResponderIds)
{
    public bool Active => Elapsed < Duration;
}

/// <summary>Deterministic responder selection, pursuit timing, and speed policy.</summary>
public static class HitAndRunPursuitModel
{
    public static readonly HitAndRunPursuitConfig DefaultConfig = new();

    public static IReadOnlyList<string> SelectNearbyPolice(
        IReadOnlyList<HitAndRunPoliceCandidate> candidates,
        TrafficPoint origin,
        HitAndRunPursuitConfig? config = null)
    {
        ArgumentNullException.ThrowIfNull(candidates);
        config ??= DefaultConfig;
        double radius = Positive(config.NearbyPoliceRadius, DefaultConfig.NearbyPoliceRadius);
        int maximum = Math.Max(0, config.MaximumResponders);
        return candidates
            .Where(candidate => candidate.Police
                && !candidate.PlayerControlled
                && !candidate.Disabled
                && !candidate.Parked
                && !candidate.AlreadyAssigned)
            .Select(candidate => new
            {
                candidate.Id,
                Distance = DistanceSquared(candidate.Position, origin),
            })
            .Where(candidate => candidate.Distance <= radius * radius)
            .OrderBy(candidate => candidate.Distance)
            .ThenBy(candidate => candidate.Id, StringComparer.Ordinal)
            .Take(maximum)
            .Select(candidate => candidate.Id)
            .ToArray();
    }

    public static HitAndRunPursuitState Create(
        string offenderId,
        double normalMaximumSpeed,
        IReadOnlyList<string> responders,
        HitAndRunPursuitConfig? config = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(offenderId);
        ArgumentNullException.ThrowIfNull(responders);
        config ??= DefaultConfig;
        double normal = Positive(normalMaximumSpeed, 20);
        double multiplier = Positive(config.FugitiveSpeedMultiplier, DefaultConfig.FugitiveSpeedMultiplier);
        double maximum = Positive(config.MaximumFugitiveSpeed, DefaultConfig.MaximumFugitiveSpeed);
        return new HitAndRunPursuitState(
            offenderId,
            0,
            Positive(config.Duration, DefaultConfig.Duration),
            normal,
            Math.Min(maximum, normal * multiplier),
            responders.Where(id => !string.IsNullOrWhiteSpace(id)).Distinct(StringComparer.Ordinal).ToArray());
    }

    public static HitAndRunPursuitState Advance(HitAndRunPursuitState state, double delta)
    {
        ArgumentNullException.ThrowIfNull(state);
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.25) : 0;
        return state with { Elapsed = state.Elapsed + safeDelta };
    }

    public static double GetPoliceSpeed(
        double normalMaximumSpeed,
        double offenderSpeed,
        double distance,
        HitAndRunPursuitConfig? config = null)
    {
        config ??= DefaultConfig;
        double maximum = Positive(config.PoliceMaximumSpeed, DefaultConfig.PoliceMaximumSpeed);
        double normal = Positive(normalMaximumSpeed, 20);
        double offender = double.IsFinite(offenderSpeed) ? Math.Max(0, offenderSpeed) : 0;
        double following = Positive(config.PoliceFollowingDistance, DefaultConfig.PoliceFollowingDistance);
        if (double.IsFinite(distance) && distance <= following) return Math.Min(maximum, offender);
        double catchUp = Positive(config.PoliceCatchUpSpeed, DefaultConfig.PoliceCatchUpSpeed);
        return Math.Min(maximum, Math.Max(normal, offender + catchUp));
    }

    private static double DistanceSquared(TrafficPoint first, TrafficPoint second)
    {
        double x = first.X - second.X;
        double z = first.Z - second.Z;
        return x * x + z * z;
    }

    private static double Positive(double value, double fallback) =>
        double.IsFinite(value) && value > 0 ? value : fallback;
}
