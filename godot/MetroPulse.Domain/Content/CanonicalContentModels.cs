using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Content;

public sealed record BuildingCatalogDocument
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("sourceRevision")]
    public string? SourceRevision { get; init; }

    [JsonPropertyName("categories")]
    public IReadOnlyDictionary<string, string>? Categories { get; init; }

    [JsonPropertyName("catalogStages")]
    public IReadOnlyDictionary<string, string>? CatalogStages { get; init; }

    [JsonPropertyName("progressionTiers")]
    public IReadOnlyDictionary<string, string>? ProgressionTiers { get; init; }

    [JsonPropertyName("records")]
    public IReadOnlyList<BuildingDefinition>? Records { get; init; }
}

public sealed record BuildingDefinition
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }

    [JsonPropertyName("name")]
    public string? Name { get; init; }

    [JsonPropertyName("category")]
    public string? Category { get; init; }

    [JsonPropertyName("catalogStage")]
    public string? CatalogStage { get; init; }

    [JsonPropertyName("progressionTier")]
    public string? ProgressionTier { get; init; }

    [JsonPropertyName("icon")]
    public string? Icon { get; init; }

    [JsonPropertyName("description")]
    public string? Description { get; init; }

    [JsonPropertyName("footprint")]
    public BuildingFootprint? Footprint { get; init; }

    [JsonPropertyName("height")]
    public double Height { get; init; } = double.NaN;

    [JsonPropertyName("cost")]
    public double Cost { get; init; } = double.NaN;

    [JsonPropertyName("value")]
    public double Value { get; init; } = double.NaN;

    [JsonPropertyName("status")]
    public string? Status { get; init; }

    [JsonPropertyName("baseColor")]
    public int BaseColor { get; init; } = -1;

    [JsonPropertyName("accentColor")]
    public int AccentColor { get; init; } = -1;

    [JsonPropertyName("generatorType")]
    public string? GeneratorType { get; init; }

    [JsonPropertyName("signText")]
    public string? SignText { get; init; }

    [JsonPropertyName("employees")]
    public double? Employees { get; init; }

    [JsonPropertyName("residents")]
    public double? Residents { get; init; }

    [JsonPropertyName("incomePerMinute")]
    public double IncomePerMinute { get; init; } = double.NaN;

    [JsonPropertyName("powerDemand")]
    public double? PowerDemand { get; init; }

    [JsonPropertyName("powerSupply")]
    public double? PowerSupply { get; init; }

    [JsonPropertyName("powerReach")]
    public double? PowerReach { get; init; }

    [JsonPropertyName("waterDemand")]
    public double? WaterDemand { get; init; }

    [JsonPropertyName("waterSupply")]
    public double? WaterSupply { get; init; }

    [JsonPropertyName("waterReach")]
    public double? WaterReach { get; init; }

    [JsonPropertyName("fireCoverage")]
    public double? FireCoverage { get; init; }

    [JsonPropertyName("fireReach")]
    public double? FireReach { get; init; }

    [JsonPropertyName("happiness")]
    public double? Happiness { get; init; }

    [JsonPropertyName("amenityRadius")]
    public double? AmenityRadius { get; init; }

    [JsonPropertyName("trafficCapacity")]
    public double? TrafficCapacity { get; init; }

    [JsonPropertyName("roadType")]
    public string? RoadType { get; init; }

    [JsonPropertyName("specialty")]
    public string? Specialty { get; init; }
}

public sealed record BuildingFootprint
{
    [JsonPropertyName("width")]
    public double Width { get; init; } = double.NaN;

    [JsonPropertyName("depth")]
    public double Depth { get; init; } = double.NaN;
}

public sealed record WeatherCatalogDocument
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("sourceRevision")]
    public string? SourceRevision { get; init; }

    [JsonPropertyName("defaultMode")]
    public string? DefaultMode { get; init; }

    [JsonPropertyName("sequence")]
    public IReadOnlyList<string>? Sequence { get; init; }

    [JsonPropertyName("records")]
    public IReadOnlyList<WeatherDefinition>? Records { get; init; }
}

public sealed record WeatherDefinition
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }

    [JsonPropertyName("durationSeconds")]
    public double DurationSeconds { get; init; } = double.NaN;

    [JsonPropertyName("fogDensity")]
    public double FogDensity { get; init; } = double.NaN;

    [JsonPropertyName("rainOpacity")]
    public double RainOpacity { get; init; } = double.NaN;

    [JsonPropertyName("wetness")]
    public double Wetness { get; init; } = double.NaN;

    [JsonPropertyName("groundFriction")]
    public double GroundFriction { get; init; } = double.NaN;

    [JsonPropertyName("gripMultiplier")]
    public double GripMultiplier { get; init; } = double.NaN;

    [JsonPropertyName("statusText")]
    public string? StatusText { get; init; }
}

public sealed record MissionWeatherPolicyDocument
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("sourceRevision")]
    public string? SourceRevision { get; init; }

    [JsonPropertyName("records")]
    public IReadOnlyDictionary<string, MissionWeatherPolicyDefinition>? Records { get; init; }
}

public sealed record MissionWeatherPolicyDefinition
{
    [JsonPropertyName("defaultDisposition")]
    public string? DefaultDisposition { get; init; }

    [JsonPropertyName("defaultReason")]
    public string? DefaultReason { get; init; }

    [JsonPropertyName("timeLimitMultiplier")]
    public double? TimeLimitMultiplier { get; init; }

    [JsonPropertyName("rewardMultiplier")]
    public double? RewardMultiplier { get; init; }

    [JsonPropertyName("modes")]
    public IReadOnlyDictionary<string, MissionWeatherModeDefinition>? Modes { get; init; }
}

public sealed record MissionWeatherModeDefinition
{
    [JsonPropertyName("disposition")]
    public string? Disposition { get; init; }

    [JsonPropertyName("reason")]
    public string? Reason { get; init; }

    [JsonPropertyName("timeLimitMultiplier")]
    public double? TimeLimitMultiplier { get; init; }

    [JsonPropertyName("rewardMultiplier")]
    public double? RewardMultiplier { get; init; }
}
