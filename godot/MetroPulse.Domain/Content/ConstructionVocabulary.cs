using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Content;

public static class ConstructionCategories
{
    public const string Residential = "RESIDENTIAL";
    public const string Commercial = "COMMERCIAL";
    public const string Operations = "OPERATIONS";
    public const string Facilities = "FACILITIES";
    public const string Infrastructure = "INFRASTRUCTURE";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly([
        Residential,
        Commercial,
        Operations,
        Facilities,
        Infrastructure,
    ]);
}

public static class CatalogStages
{
    public const string Starter = "STARTER";
    public const string Advanced = "ADVANCED";
}

public static class ProgressionTiers
{
    public const string Operator = "OPERATOR";
    public const string Broker = "BROKER";
    public const string Magnate = "MAGNATE";
}

public sealed record CatalogAccess(
    bool Unlocked,
    string CurrentTier,
    string RequiredTier,
    string Stage,
    string? Reason);

/// <summary>
/// Exact renderer-independent construction vocabulary and catalog disclosure policy.
/// The UI may filter this projection, but it cannot grant access independently.
/// </summary>
public static class ConstructionVocabulary
{
    private static readonly IReadOnlyDictionary<string, string> ZoneAliases =
        new ReadOnlyDictionary<string, string>(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["RES"] = ConstructionCategories.Residential,
            ["RESIDENTIAL"] = ConstructionCategories.Residential,
            ["COM"] = ConstructionCategories.Commercial,
            ["COMMERCIAL"] = ConstructionCategories.Commercial,
            ["OFFICE"] = ConstructionCategories.Commercial,
            ["OPS"] = ConstructionCategories.Operations,
            ["IND"] = ConstructionCategories.Operations,
            ["INDUSTRIAL"] = ConstructionCategories.Operations,
            ["OPERATIONS"] = ConstructionCategories.Operations,
            ["POWER"] = "POWER_SERVICE",
            ["POWER_SERVICE"] = "POWER_SERVICE",
            ["WATER"] = "WATER_SERVICE",
            ["WATER_SERVICE"] = "WATER_SERVICE",
            ["FIRE"] = "FIRE_SERVICE",
            ["FIRE_SERVICE"] = "FIRE_SERVICE",
            ["SUBURBAN_RESIDENTIAL"] = "SUBURBAN_RESIDENTIAL",
        });

    private static readonly IReadOnlyDictionary<string, int> TierRanks =
        new ReadOnlyDictionary<string, int>(new Dictionary<string, int>(StringComparer.Ordinal)
        {
            [ProgressionTiers.Operator] = 1,
            [ProgressionTiers.Broker] = 2,
            [ProgressionTiers.Magnate] = 3,
        });

    public static string? NormalizeZoneId(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return ZoneAliases.GetValueOrDefault(value.Trim().ToUpperInvariant());
    }

    public static bool IsMvpDevelopmentZone(string? value) => NormalizeZoneId(value) is
        ConstructionCategories.Residential or ConstructionCategories.Commercial or ConstructionCategories.Operations;

    public static string GetUnlockedTier(IEnumerable<string>? unlockedTiers)
    {
        int rank = TierRanks[ProgressionTiers.Operator];
        foreach (string tier in unlockedTiers ?? Array.Empty<string>())
        {
            if (TierRanks.TryGetValue(tier, out int candidate)) rank = Math.Max(rank, candidate);
        }
        return TierRanks.Single(entry => entry.Value == rank).Key;
    }

    public static CatalogAccess GetCatalogAccess(BuildingDefinition spec, IEnumerable<string>? unlockedTiers = null)
    {
        ArgumentNullException.ThrowIfNull(spec);
        string requiredTier = spec.ProgressionTier ?? ProgressionTiers.Operator;
        if (!TierRanks.TryGetValue(requiredTier, out int requiredRank))
        {
            throw new ArgumentOutOfRangeException(nameof(spec), requiredTier, "Unknown catalog progression tier.");
        }
        string currentTier = GetUnlockedTier(unlockedTiers);
        bool unlocked = TierRanks[currentTier] >= requiredRank;
        return new CatalogAccess(
            unlocked,
            currentTier,
            requiredTier,
            spec.CatalogStage ?? CatalogStages.Advanced,
            unlocked ? null : $"Unlocks at {ToTitle(requiredTier)} tier");
    }

    public static bool IsDisclosed(BuildingDefinition spec, bool includeAdvanced = false)
    {
        ArgumentNullException.ThrowIfNull(spec);
        return spec.CatalogStage == CatalogStages.Starter || includeAdvanced;
    }

    public static IReadOnlyList<BuildingDefinition> FilterCatalog(
        IEnumerable<BuildingDefinition> records,
        string? category = null,
        bool includeAdvanced = false,
        IEnumerable<string>? unlockedTiers = null,
        bool includeLocked = true)
    {
        ArgumentNullException.ThrowIfNull(records);
        BuildingDefinition[] filtered = records.Where(spec =>
            (string.IsNullOrWhiteSpace(category)
                || string.Equals(category, "ALL", StringComparison.Ordinal)
                || string.Equals(spec.Category, category, StringComparison.Ordinal))
            && IsDisclosed(spec, includeAdvanced)
            && (includeLocked || GetCatalogAccess(spec, unlockedTiers).Unlocked))
            .ToArray();
        return Array.AsReadOnly(filtered);
    }

    private static string ToTitle(string value) =>
        string.Concat(value[0], value[1..].ToLowerInvariant());
}
