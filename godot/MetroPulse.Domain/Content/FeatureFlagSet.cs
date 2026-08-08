using System.Collections.Frozen;

namespace MetroPulse.Domain.Content;

/// <summary>Immutable validated feature-scope configuration.</summary>
public sealed class FeatureFlagSet
{
    private readonly FrozenDictionary<string, bool> values;

    public FeatureFlagSet()
        : this(new Dictionary<string, bool>(StringComparer.Ordinal))
    {
    }

    public FeatureFlagSet(IReadOnlyDictionary<string, bool> overrides)
    {
        ArgumentNullException.ThrowIfNull(overrides);
        var configured = ContentDefinitions.MvpFeatureFlags.ToDictionary(StringComparer.Ordinal);
        foreach ((string featureId, bool enabled) in overrides)
        {
            ValidateFeatureId(featureId);
            configured[featureId] = enabled;
        }
        values = configured.ToFrozenDictionary(StringComparer.Ordinal);
    }

    public bool IsEnabled(string featureId)
    {
        ValidateFeatureId(featureId);
        return values[featureId];
    }

    public IReadOnlyDictionary<string, bool> Snapshot() => values;

    private static void ValidateFeatureId(string? featureId)
    {
        if (featureId is null || !ContentDefinitions.MvpFeatureFlags.ContainsKey(featureId))
        {
            throw new ArgumentOutOfRangeException(
                nameof(featureId),
                featureId,
                $"Unknown feature flag: {featureId ?? "null"}");
        }
    }
}
