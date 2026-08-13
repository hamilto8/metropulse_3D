using System.Collections.ObjectModel;
using MetroPulse.Domain.Randomness;

namespace MetroPulse.Domain.Mayhem;

public static class TemporaryMayhemPolicy
{
    public const double InitialSpawnDelaySeconds = 2;
    public const double MinimumSpawnDelaySeconds = 2.2;
    public const double MaximumSpawnDelaySeconds = 5;
    public const double CometFlightSeconds = 1.25;
    public const double BuildingImpactRadius = 24;
    public const double AgentBlastRadius = 28;
    public const int MaximumActiveComets = 4;
    public const int MaximumDestroyedTargets = 6;
}

public sealed record MayhemTarget(string Id, double X, double Y, double Z);

public sealed record MayhemComet(string Id, MayhemTarget Target, double RemainingSeconds);

public enum MayhemEventKind
{
    CometSpawned,
    Impact,
}

public sealed record MayhemEvent(MayhemEventKind Kind, string CometId, MayhemTarget Target);

public sealed record TemporaryMayhemSnapshot(
    bool Active,
    bool WarningAcknowledged,
    int Sequence,
    double SpawnCountdown,
    IReadOnlyList<MayhemComet> Comets,
    IReadOnlyList<string> DestroyedTargetIds);

/// <summary>
/// Deterministic, bounded authority for the temporary-Mayhem lifecycle. World,
/// economy, road, mission, and presentation mutations remain adapter concerns.
/// </summary>
public sealed class TemporaryMayhemModel
{
    private readonly IReadOnlyList<MayhemTarget> targets;
    private readonly IRandomStream random;
    private readonly List<MayhemComet> comets = [];
    private readonly HashSet<string> destroyedTargets = new(StringComparer.Ordinal);
    private double spawnCountdown;
    private int sequence;

    public TemporaryMayhemModel(IEnumerable<MayhemTarget> targets, IRandomStream random)
    {
        ArgumentNullException.ThrowIfNull(targets);
        this.random = random ?? throw new ArgumentNullException(nameof(random));
        MayhemTarget[] materialized = targets
            .OrderBy(target => target.Id, StringComparer.Ordinal)
            .ToArray();
        if (materialized.Length == 0) throw new ArgumentException("Temporary Mayhem requires at least one target.", nameof(targets));
        if (materialized.Any(target => string.IsNullOrWhiteSpace(target.Id)
            || !double.IsFinite(target.X) || !double.IsFinite(target.Y) || !double.IsFinite(target.Z)))
        {
            throw new ArgumentException("Temporary Mayhem targets require stable IDs and finite positions.", nameof(targets));
        }
        if (materialized.Select(target => target.Id).Distinct(StringComparer.Ordinal).Count() != materialized.Length)
        {
            throw new ArgumentException("Temporary Mayhem target IDs must be unique.", nameof(targets));
        }
        this.targets = Array.AsReadOnly(materialized);
    }

    public bool Active { get; private set; }

    public bool WarningAcknowledged { get; private set; }

    public TemporaryMayhemSnapshot Snapshot() => new(
        Active,
        WarningAcknowledged,
        sequence,
        spawnCountdown,
        new ReadOnlyCollection<MayhemComet>(comets.ToArray()),
        new ReadOnlyCollection<string>(destroyedTargets.Order(StringComparer.Ordinal).ToArray()));

    public void Start(bool warningAcknowledged)
    {
        if (Active) return;
        if (!warningAcknowledged)
        {
            throw new InvalidOperationException("Temporary Mayhem requires an explicit destructive-content warning acknowledgement.");
        }
        WarningAcknowledged = true;
        Active = true;
        spawnCountdown = TemporaryMayhemPolicy.InitialSpawnDelaySeconds;
    }

    public IReadOnlyList<MayhemEvent> Advance(double deltaSeconds)
    {
        if (!double.IsFinite(deltaSeconds) || deltaSeconds < 0) throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
        if (!Active || deltaSeconds == 0) return Array.Empty<MayhemEvent>();

        var events = new List<MayhemEvent>();
        for (int index = comets.Count - 1; index >= 0; index--)
        {
            MayhemComet advanced = comets[index] with { RemainingSeconds = comets[index].RemainingSeconds - deltaSeconds };
            if (advanced.RemainingSeconds > 0)
            {
                comets[index] = advanced;
                continue;
            }
            comets.RemoveAt(index);
            if (destroyedTargets.Count < TemporaryMayhemPolicy.MaximumDestroyedTargets
                && destroyedTargets.Add(advanced.Target.Id))
            {
                events.Add(new MayhemEvent(MayhemEventKind.Impact, advanced.Id, advanced.Target));
            }
        }

        spawnCountdown -= deltaSeconds;
        if (spawnCountdown <= 0
            && comets.Count < TemporaryMayhemPolicy.MaximumActiveComets
            && destroyedTargets.Count < Math.Min(targets.Count, TemporaryMayhemPolicy.MaximumDestroyedTargets))
        {
            MayhemTarget[] available = targets
                .Where(target => !destroyedTargets.Contains(target.Id)
                    && comets.All(comet => comet.Target.Id != target.Id))
                .ToArray();
            if (available.Length > 0)
            {
                MayhemTarget target = available[random.NextInt(available.Length)];
                var comet = new MayhemComet(
                    $"mayhem-comet-{++sequence}",
                    target,
                    TemporaryMayhemPolicy.CometFlightSeconds);
                comets.Add(comet);
                events.Add(new MayhemEvent(MayhemEventKind.CometSpawned, comet.Id, target));
            }
            spawnCountdown = random.NextRange(
                TemporaryMayhemPolicy.MinimumSpawnDelaySeconds,
                TemporaryMayhemPolicy.MaximumSpawnDelaySeconds);
        }
        else if (destroyedTargets.Count >= Math.Min(targets.Count, TemporaryMayhemPolicy.MaximumDestroyedTargets))
        {
            spawnCountdown = 0;
        }
        return new ReadOnlyCollection<MayhemEvent>(events);
    }

    public TemporaryMayhemSnapshot StopAndReset()
    {
        Active = false;
        WarningAcknowledged = false;
        comets.Clear();
        destroyedTargets.Clear();
        spawnCountdown = 0;
        sequence = 0;
        return Snapshot();
    }
}
