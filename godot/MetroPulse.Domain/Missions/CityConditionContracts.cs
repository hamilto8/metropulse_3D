using System.Text.Json;

namespace MetroPulse.Domain.Missions;

public static class CityConditionTypes
{
    public const string Traffic = "TRAFFIC";
    public const string Bridge = "BRIDGE";
    public const string ServiceCoverage = "SERVICE_COVERAGE";
    public const string Safety = "SAFETY";
    public const string Repair = "REPAIR";
    public const string LandValue = "LAND_VALUE";
    public const string Weather = "WEATHER";
    public const string District = "DISTRICT";
    public const string AuthoredFlag = "AUTHORED_FLAG";
}

public static class ConditionOperators
{
    public new const string Equals = "EQUALS";
    public const string NotEquals = "NOT_EQUALS";
    public const string GreaterThan = "GREATER_THAN";
    public const string GreaterThanOrEqual = "GREATER_THAN_OR_EQUAL";
    public const string LessThan = "LESS_THAN";
    public const string LessThanOrEqual = "LESS_THAN_OR_EQUAL";
    public const string In = "IN";
    public const string Contains = "CONTAINS";
    public const string Truthy = "TRUTHY";
    public const string Falsy = "FALSY";
}

public sealed record TrafficBridgeMetrics(
    double Index = 0,
    int Vehicles = 0,
    int StoppedVehicles = 0);

public sealed record TrafficConditionMetrics
{
    public long Revision { get; init; }

    public double Index { get; init; }

    public int ActiveVehicles { get; init; }

    public int StoppedVehicles { get; init; }

    public int CrashedVehicles { get; init; }

    public TrafficBridgeMetrics Bridge { get; init; } = new();

    public IReadOnlyList<string> Hotspots { get; init; } = Array.Empty<string>();

    public bool IncludesAuthoredPolicies { get; init; }
}

public sealed record BridgeConditionState(
    string Id,
    string State = AccessStates.Open,
    string Access = AccessStates.Open,
    double Condition = 1,
    double Safety = 1);

public sealed record WeatherConditionState(string Mode = "clear", long Revision = 0);

public sealed record CityConditionRequest
{
    public required string Type { get; init; }

    public string? ScopeId { get; init; }

    public string? DistrictId { get; init; }

    public string? BridgeId { get; init; }

    public string? Service { get; init; }

    public string? TargetId { get; init; }

    public string? FlagId { get; init; }

    public double? X { get; init; }

    public double? Z { get; init; }

    public IReadOnlyDictionary<string, JsonElement>? Parameters { get; init; }
}

public sealed record CityConditionSource(string TransactionId, OutcomeSummary? Summary);

public sealed record CityConditionResult(
    string Type,
    string SubjectId,
    JsonElement Value,
    JsonElement Facts,
    IReadOnlyList<CityConditionSource> Sources,
    long Revision)
{
    public T ValueAs<T>() => Value.Deserialize<T>()
        ?? throw new InvalidOperationException($"Condition {Type} value cannot be read as {typeof(T).Name}.");

    public T FactsAs<T>() => Facts.Deserialize<T>()
        ?? throw new InvalidOperationException($"Condition {Type} facts cannot be read as {typeof(T).Name}.");
}

public sealed record CityConditionContext(
    Economy.EconomyLedgerSnapshot Economy,
    MissionOutcomeSnapshot Outcomes,
    IReadOnlyList<Content.DistrictDefinition> Districts);

public sealed record CityConditionRequirement(
    CityConditionRequest Query,
    string Operator = ConditionOperators.Truthy,
    string? Path = null,
    JsonElement? Expected = null);

public sealed record CityConditionEvaluation(
    bool Passed,
    string Operator,
    JsonElement? Expected,
    JsonElement? Actual,
    CityConditionResult Condition);

public sealed record CityConditionEvaluationSet(
    bool Passed,
    string Mode,
    IReadOnlyList<CityConditionEvaluation> Results);

public static class ConditionValues
{
    public static JsonElement From<T>(T value) => JsonSerializer.SerializeToElement(value);
}
