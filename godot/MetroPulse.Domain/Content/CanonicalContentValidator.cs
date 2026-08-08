using System.Collections.Frozen;

namespace MetroPulse.Domain.Content;

public static partial class CanonicalContentValidator
{
    public const int SchemaVersion = 1;
    public const string SourceRevision = "44a286a74557adfe4fabd3a6e16b9006079eba32";

    private static readonly FrozenSet<string> BuildingGenerators =
        new[]
        {
            "SKYSCRAPER", "SHOP", "RESIDENTIAL", "CIVIC", "PARK_PLAZA",
            "ROAD_SEGMENT", "ENERGY_ARRAY", "INDUSTRIAL", "UTILITY",
        }.ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> RoadTypes =
        new[] { "STRAIGHT", "INTERSECTION", "BRIDGE" }.ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenSet<string> WeatherDispositions =
        new[] { "ALLOWED", "ADAPTED", "DELAYED", "BLOCKED" }.ToFrozenSet(StringComparer.Ordinal);

    public static void ValidateBuildings(BuildingCatalogDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "buildings");
        IReadOnlyDictionary<string, string> categories = RequireMap(document.Categories, "building-categories");
        IReadOnlyDictionary<string, string> stages = RequireMap(document.CatalogStages, "catalog-stages");
        IReadOnlyDictionary<string, string> tiers = RequireMap(document.ProgressionTiers, "progression-tiers");
        IReadOnlyList<BuildingDefinition> records = RequireRecords(document.Records, "buildings");

        var categoryIds = categories.Keys.ToFrozenSet(StringComparer.Ordinal);
        var stageIds = stages.Values.ToFrozenSet(StringComparer.Ordinal);
        var tierIds = tiers.Values.ToFrozenSet(StringComparer.Ordinal);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (BuildingDefinition record in records)
        {
            string id = RequireStableId(record.Id, "buildings", record.Id ?? "<missing>", "id");
            if (!ids.Add(id))
            {
                throw Error($"duplicates stable ID {id}.", "buildings", id, "id", "DUPLICATE_ID");
            }

            RequireString(record.Name, "buildings", id, "name");
            RequireString(record.Icon, "buildings", id, "icon");
            RequireString(record.Description, "buildings", id, "description");
            RequireString(record.Status, "buildings", id, "status");
            RequireString(record.Specialty, "buildings", id, "specialty");
            RequireEnum(record.Category, categoryIds, "buildings", id, "category");
            RequireEnum(record.CatalogStage, stageIds, "buildings", id, "catalogStage");
            RequireEnum(record.ProgressionTier, tierIds, "buildings", id, "progressionTier");
            string generator = RequireEnum(record.GeneratorType, BuildingGenerators, "buildings", id, "generatorType");

            if (record.Footprint is null)
            {
                throw Error("must be an object.", "buildings", id, "footprint");
            }
            RequireFinite(record.Footprint.Width, "buildings", id, "footprint.width", 0.001);
            RequireFinite(record.Footprint.Depth, "buildings", id, "footprint.depth", 0.001);

            RequireFinite(record.Height, "buildings", id, "height", 0);
            RequireFinite(record.Cost, "buildings", id, "cost", 0);
            RequireFinite(record.Value, "buildings", id, "value", 0);
            RequireFinite(record.IncomePerMinute, "buildings", id, "incomePerMinute");
            ValidateOptionalNonNegative(record.Employees, "employees");
            ValidateOptionalNonNegative(record.Residents, "residents");
            ValidateOptionalNonNegative(record.PowerDemand, "powerDemand");
            ValidateOptionalNonNegative(record.PowerSupply, "powerSupply");
            ValidateOptionalNonNegative(record.PowerReach, "powerReach");
            ValidateOptionalNonNegative(record.WaterDemand, "waterDemand");
            ValidateOptionalNonNegative(record.WaterSupply, "waterSupply");
            ValidateOptionalNonNegative(record.WaterReach, "waterReach");
            ValidateOptionalNonNegative(record.FireCoverage, "fireCoverage");
            ValidateOptionalNonNegative(record.FireReach, "fireReach");
            ValidateOptionalNonNegative(record.AmenityRadius, "amenityRadius");
            ValidateOptionalNonNegative(record.TrafficCapacity, "trafficCapacity");
            if (record.Happiness.HasValue)
            {
                RequireFinite(record.Happiness.Value, "buildings", id, "happiness");
            }

            RequireFinite(record.BaseColor, "buildings", id, "baseColor", 0, 0xffffff);
            RequireFinite(record.AccentColor, "buildings", id, "accentColor", 0, 0xffffff);
            if (record.SignText is not null)
            {
                RequireString(record.SignText, "buildings", id, "signText");
            }

            if (generator == "ROAD_SEGMENT")
            {
                RequireEnum(record.RoadType, RoadTypes, "buildings", id, "roadType");
            }

            void ValidateOptionalNonNegative(double? value, string field)
            {
                if (value.HasValue)
                {
                    RequireFinite(value.Value, "buildings", id, field, 0);
                }
            }
        }
    }

    public static void ValidateWeather(WeatherCatalogDocument document)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "weather");
        IReadOnlyList<WeatherDefinition> records = RequireRecords(document.Records, "weather");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (WeatherDefinition record in records)
        {
            string id = RequireStableId(record.Id, "weather", record.Id ?? "<missing>", "id");
            if (!ids.Add(id))
            {
                throw Error($"duplicates stable ID {id}.", "weather", id, "id", "DUPLICATE_ID");
            }

            RequireFinite(record.DurationSeconds, "weather", id, "durationSeconds", 0.001);
            RequireFinite(record.FogDensity, "weather", id, "fogDensity", 0);
            RequireUnitInterval(record.RainOpacity, id, "rainOpacity");
            RequireUnitInterval(record.Wetness, id, "wetness");
            RequireUnitInterval(record.GroundFriction, id, "groundFriction");
            RequireUnitInterval(record.GripMultiplier, id, "gripMultiplier");
            RequireString(record.StatusText, "weather", id, "statusText");
        }

        string defaultMode = RequireStableId(document.DefaultMode, "weather", "<default>", "id");
        if (!ids.Contains(defaultMode))
        {
            throw Error($"references missing weather record {defaultMode}.", "weather", "<default>", "id", "MISSING_REFERENCE");
        }

        IReadOnlyList<string> sequence = RequireRecords(document.Sequence, "weather-sequence");
        if (sequence.Count != ids.Count || sequence.Distinct(StringComparer.Ordinal).Count() != sequence.Count)
        {
            throw Error("must contain every weather ID exactly once.", "weather-sequence", code: "INVALID_SEQUENCE");
        }
        for (int index = 0; index < sequence.Count; index++)
        {
            if (!ids.Contains(sequence[index]))
            {
                throw Error($"references missing weather record {sequence[index]}.", "weather-sequence", field: $"[{index}]", code: "MISSING_REFERENCE");
            }
        }

        void RequireUnitInterval(double value, string id, string field) =>
            RequireFinite(value, "weather", id, field, 0, 1);
    }

    public static void ValidateMissionWeatherPolicies(
        MissionWeatherPolicyDocument document,
        IReadOnlySet<string> weatherIds)
    {
        ValidateEnvelope(document.SchemaVersion, document.SourceRevision, "mission-weather-policies");
        IReadOnlyDictionary<string, MissionWeatherPolicyDefinition> records =
            RequireMap(document.Records, "mission-weather-policies");

        foreach ((string id, MissionWeatherPolicyDefinition policy) in records)
        {
            RequireStableId(id, "mission-weather-policies", id, "id");
            RequireEnum(policy.DefaultDisposition, WeatherDispositions, "mission-weather-policies", id, "defaultDisposition");
            if (policy.DefaultReason is not null)
            {
                RequireString(policy.DefaultReason, "mission-weather-policies", id, "defaultReason");
            }
            ValidateMultiplier(policy.TimeLimitMultiplier, id, "timeLimitMultiplier", 0.001);
            ValidateMultiplier(policy.RewardMultiplier, id, "rewardMultiplier", 0);

            if (policy.Modes is null)
            {
                throw Error("must be an object.", "mission-weather-policies", id, "modes");
            }
            foreach ((string mode, MissionWeatherModeDefinition entry) in policy.Modes)
            {
                if (!weatherIds.Contains(mode))
                {
                    throw Error($"references missing weather record {mode}.", "mission-weather-policies", id, $"modes.{mode}", "MISSING_REFERENCE");
                }
                RequireEnum(entry.Disposition, WeatherDispositions, "mission-weather-policies", id, $"modes.{mode}.disposition");
                if (entry.Reason is not null)
                {
                    RequireString(entry.Reason, "mission-weather-policies", id, $"modes.{mode}.reason");
                }
                ValidateMultiplier(entry.TimeLimitMultiplier, id, $"modes.{mode}.timeLimitMultiplier", 0.001);
                ValidateMultiplier(entry.RewardMultiplier, id, $"modes.{mode}.rewardMultiplier", 0);
            }
        }

        void ValidateMultiplier(double? value, string id, string field, double minimum)
        {
            if (value.HasValue)
            {
                RequireFinite(value.Value, "mission-weather-policies", id, field, minimum);
            }
        }
    }

    private static void ValidateEnvelope(int schemaVersion, string? sourceRevision, string source)
    {
        if (schemaVersion != SchemaVersion)
        {
            throw Error($"uses unsupported schema version {schemaVersion}; expected {SchemaVersion}.", source, field: "schemaVersion", code: "UNSUPPORTED_VERSION");
        }
        if (!string.Equals(sourceRevision, SourceRevision, StringComparison.Ordinal))
        {
            throw Error($"must identify frozen source revision {SourceRevision}.", source, field: "sourceRevision", code: "SOURCE_REVISION_MISMATCH");
        }
    }

    private static IReadOnlyList<T> RequireRecords<T>(IReadOnlyList<T>? records, string source)
    {
        if (records is null || records.Count == 0)
        {
            throw Error("must be a non-empty array.", source);
        }
        return records;
    }

    private static IReadOnlyDictionary<string, T> RequireMap<T>(IReadOnlyDictionary<string, T>? records, string source)
    {
        if (records is null || records.Count == 0)
        {
            throw Error("must be a non-empty object.", source);
        }
        return records;
    }

    private static string RequireString(string? value, string source, object? recordId, string field)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw Error("must be a non-empty string.", source, recordId, field);
        }
        return value.Trim();
    }

    private static string RequireStableId(string? value, string source, object? recordId, string field)
    {
        string normalized = RequireString(value, source, recordId, field);
        if (!StableId.IsValid(normalized))
        {
            throw Error("must be a stable ID containing only letters, numbers, underscores, or hyphens.", source, recordId, field);
        }
        return normalized;
    }

    private static string RequireEnum(
        string? value,
        IReadOnlySet<string> allowed,
        string source,
        object? recordId,
        string field)
    {
        if (value is null || !allowed.Contains(value))
        {
            throw Error($"uses invalid enum value {value}; expected one of {string.Join(", ", allowed)}.", source, recordId, field, "INVALID_ENUM");
        }
        return value;
    }

    private static double RequireFinite(
        double value,
        string source,
        object? recordId,
        string field,
        double minimum = double.NegativeInfinity,
        double maximum = double.PositiveInfinity)
    {
        if (!double.IsFinite(value) || value < minimum || value > maximum)
        {
            throw Error("must be a finite number in the supported range.", source, recordId, field);
        }
        return value;
    }

    private static ContentValidationException Error(
        string message,
        string source,
        object? recordId = null,
        string? field = null,
        string code = "INVALID_GAME_DATA") =>
        new(message, source, recordId, field, code);
}
