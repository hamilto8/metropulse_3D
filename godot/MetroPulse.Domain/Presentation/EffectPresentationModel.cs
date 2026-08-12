using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Presentation;

public static class EffectIds
{
    public const string Explosion = "EXPLOSION";
    public const string Fire = "FIRE";
    public const string Rubble = "RUBBLE";
    public const string Comet = "COMET";
}

public sealed record EffectPoolSpec(
    string Id,
    int Capacity,
    double LifetimeSeconds,
    bool Persistent,
    bool CollisionEnabled,
    bool MutatesRoadGraph,
    bool MutatesEconomy,
    string Caption);

public sealed record EffectLease(string EffectId, int Slot, long Generation, double ExpiresAt, string? SourceId);

public sealed record EffectAccessibilityPolicy(double ShakeScale, double FlashScale, bool BloomEnabled, bool SpawnComets);

public sealed class EffectPoolModel
{
    private sealed record SlotState(int Slot, long Generation, double ExpiresAt, string? SourceId);

    private readonly EffectPoolSpec spec;
    private readonly Dictionary<int, SlotState> active = [];
    private long generation;

    public EffectPoolModel(EffectPoolSpec poolSpec)
    {
        spec = poolSpec ?? throw new ArgumentNullException(nameof(poolSpec));
        if (spec.Capacity <= 0 || !double.IsFinite(spec.LifetimeSeconds) || spec.LifetimeSeconds <= 0)
            throw new ArgumentOutOfRangeException(nameof(poolSpec), "Effect pools require positive capacity and lifetime.");
    }

    public int ActiveCount => active.Count;

    public EffectLease Acquire(double now, string? sourceId = null)
    {
        if (!double.IsFinite(now)) throw new ArgumentOutOfRangeException(nameof(now));
        _ = Cleanup(now);
        SlotState? existing = sourceId is null ? null : active.Values.FirstOrDefault(slot => slot.SourceId == sourceId);
        int slot = existing?.Slot
            ?? Enumerable.Range(0, spec.Capacity).FirstOrDefault(candidate => !active.ContainsKey(candidate), -1);
        if (slot < 0)
        {
            slot = active.Values.OrderBy(value => value.ExpiresAt).ThenBy(value => value.Generation).First().Slot;
        }
        double expires = spec.Persistent ? double.PositiveInfinity : now + spec.LifetimeSeconds;
        var state = new SlotState(slot, ++generation, expires, sourceId);
        active[slot] = state;
        return new EffectLease(spec.Id, slot, state.Generation, state.ExpiresAt, sourceId);
    }

    public int Cleanup(double now)
    {
        int before = active.Count;
        foreach (int slot in active.Where(pair => pair.Value.ExpiresAt <= now).Select(pair => pair.Key).ToArray()) active.Remove(slot);
        return before - active.Count;
    }

    public bool ReleaseSource(string sourceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceId);
        int[] slots = active.Where(pair => pair.Value.SourceId == sourceId).Select(pair => pair.Key).ToArray();
        foreach (int slot in slots) active.Remove(slot);
        return slots.Length > 0;
    }
}

public static class EffectPresentationModel
{
    public static readonly IReadOnlyList<EffectPoolSpec> Pools = Array.AsReadOnly<EffectPoolSpec>([
        new(EffectIds.Explosion, 8, 1.1, false, false, false, false, "[explosion]"),
        new(EffectIds.Fire, 12, 30, true, false, false, false, "[fire crackling]"),
        new(EffectIds.Rubble, 24, 12, false, false, false, false, "[rubble falling]"),
        new(EffectIds.Comet, 4, 3.5, false, false, false, false, "[comet streaks overhead]"),
    ]);

    public static int TotalPooledNodes => Pools.Sum(pool => pool.Capacity);

    public static EffectAccessibilityPolicy Accessibility(SettingsPreferences settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        bool reducedMotion = settings.Motion.ReducedMotion == SettingValues.ReduceMotion;
        double flash = settings.Motion.FlashIntensity switch
        {
            SettingValues.OffEffect => 0,
            SettingValues.ReducedEffect => 0.35,
            _ => 1,
        };
        return new(
            reducedMotion ? 0 : Math.Clamp(settings.Motion.CameraShake, 0, 1),
            flash,
            settings.Motion.Bloom != SettingValues.OffEffect,
            !reducedMotion);
    }
}
