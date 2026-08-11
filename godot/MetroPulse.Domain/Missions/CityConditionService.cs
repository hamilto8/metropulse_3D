using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Services;

namespace MetroPulse.Domain.Missions;

/// <summary>Renderer-independent query facade for authored mission requirements.</summary>
public sealed class CityConditionService
{
    private static readonly HashSet<string> BuiltInTypes =
    [
        CityConditionTypes.Traffic,
        CityConditionTypes.Bridge,
        CityConditionTypes.ServiceCoverage,
        CityConditionTypes.Safety,
        CityConditionTypes.Repair,
        CityConditionTypes.LandValue,
        CityConditionTypes.Weather,
        CityConditionTypes.District,
        CityConditionTypes.AuthoredFlag,
    ];
    private static readonly HashSet<string> OperatorValues =
    [
        ConditionOperators.Equals,
        ConditionOperators.NotEquals,
        ConditionOperators.GreaterThan,
        ConditionOperators.GreaterThanOrEqual,
        ConditionOperators.LessThan,
        ConditionOperators.LessThanOrEqual,
        ConditionOperators.In,
        ConditionOperators.Contains,
        ConditionOperators.Truthy,
        ConditionOperators.Falsy,
    ];
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };
    private static readonly IReadOnlyDictionary<string, WeatherProfile> WeatherProfiles =
        new ReadOnlyDictionary<string, WeatherProfile>(new Dictionary<string, WeatherProfile>(StringComparer.Ordinal)
        {
            ["clear"] = new(0, 1, 1),
            ["mist"] = new(0.25, 0.65, 0.9),
            ["rain"] = new(0.55, 0.72, 0.7),
            ["storm"] = new(1, 0.42, 0.5),
        });

    private readonly EconomyLedger economy;
    private readonly MissionOutcomeService? outcomes;
    private readonly Func<TrafficConditionMetrics?>? trafficProvider;
    private readonly Func<string, BridgeConditionState?>? bridgeProvider;
    private readonly Func<WeatherConditionState?>? weatherProvider;
    private readonly CityServiceModel? serviceModel;
    private readonly IReadOnlyList<DistrictDefinition> districts;
    private readonly IReadOnlyDictionary<string, DistrictDefinition> districtsById;
    private readonly Dictionary<string, Func<CityConditionRequest, CityConditionContext, CityConditionResult>> customResolvers =
        new(StringComparer.Ordinal);

    public CityConditionService(
        EconomyLedger economy,
        MissionOutcomeService? outcomes = null,
        Func<TrafficConditionMetrics?>? trafficProvider = null,
        Func<string, BridgeConditionState?>? bridgeProvider = null,
        Func<WeatherConditionState?>? weatherProvider = null,
        IReadOnlyList<DistrictDefinition>? districtDefinitions = null,
        CityServiceModel? serviceModel = null)
    {
        this.economy = economy ?? throw new ArgumentNullException(nameof(economy));
        this.outcomes = outcomes;
        this.trafficProvider = trafficProvider;
        this.bridgeProvider = bridgeProvider;
        this.weatherProvider = weatherProvider;
        this.serviceModel = serviceModel;
        districts = Array.AsReadOnly((districtDefinitions ?? ContentDefinitions.Districts).ToArray());
        districtsById = new ReadOnlyDictionary<string, DistrictDefinition>(
            districts.ToDictionary(item => item.Id, StringComparer.Ordinal));
    }

    public CityConditionResult Query(CityConditionRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        string type = RequireText(request.Type, "condition request.type").ToUpperInvariant();
        if (customResolvers.TryGetValue(type, out Func<CityConditionRequest, CityConditionContext, CityConditionResult>? custom))
        {
            IReadOnlyDictionary<string, JsonElement>? parameters = request.Parameters is null
                ? null
                : new ReadOnlyDictionary<string, JsonElement>(request.Parameters.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value.Clone(),
                    StringComparer.Ordinal));
            return custom(request with { Type = type, Parameters = parameters }, Context());
        }
        if (!BuiltInTypes.Contains(type)) throw new ArgumentOutOfRangeException(nameof(request), $"Unsupported city condition type: {type}");
        return type switch
        {
            CityConditionTypes.Traffic => GetTraffic(request.ScopeId, request.DistrictId),
            CityConditionTypes.Bridge => GetBridge(request.BridgeId),
            CityConditionTypes.ServiceCoverage => GetServiceCoverage(request.Service, request.DistrictId, request.X, request.Z),
            CityConditionTypes.Safety => GetSafety(request.DistrictId),
            CityConditionTypes.Repair => GetRepair(request.TargetId),
            CityConditionTypes.LandValue => GetLandValue(request.X, request.Z, request.DistrictId),
            CityConditionTypes.Weather => GetWeather(),
            CityConditionTypes.District => GetDistrict(request.DistrictId),
            CityConditionTypes.AuthoredFlag => GetAuthoredFlag(request.FlagId),
            _ => throw new ArgumentOutOfRangeException(nameof(request), $"Unsupported city condition type: {type}"),
        };
    }

    public Func<bool> RegisterResolver(
        string type,
        Func<CityConditionRequest, CityConditionContext, CityConditionResult> resolver)
    {
        string normalizedType = RequireText(type, "condition type").ToUpperInvariant();
        ArgumentNullException.ThrowIfNull(resolver);
        if (BuiltInTypes.Contains(normalizedType) || !customResolvers.TryAdd(normalizedType, resolver))
        {
            throw new InvalidOperationException($"Condition resolver already registered: {normalizedType}");
        }
        bool registered = true;
        return () =>
        {
            if (!registered) return false;
            registered = false;
            return customResolvers.Remove(normalizedType);
        };
    }

    public CityConditionEvaluation Evaluate(CityConditionRequirement requirement)
    {
        ArgumentNullException.ThrowIfNull(requirement);
        CityConditionResult condition = Query(requirement.Query);
        string conditionOperator = RequireText(requirement.Operator, "condition requirement.operator").ToUpperInvariant();
        if (!OperatorValues.Contains(conditionOperator))
        {
            throw new ArgumentOutOfRangeException(nameof(requirement), $"Unsupported condition operator: {conditionOperator}");
        }
        JsonElement? actual = GetPath(condition.Value, requirement.Path);
        return new CityConditionEvaluation(
            Compare(actual, conditionOperator, requirement.Expected),
            conditionOperator,
            requirement.Expected?.Clone(),
            actual?.Clone(),
            condition);
    }

    public CityConditionEvaluationSet EvaluateAll(
        IReadOnlyList<CityConditionRequirement> requirements,
        string mode = "ALL")
    {
        ArgumentNullException.ThrowIfNull(requirements);
        string normalizedMode = RequireText(mode, "condition evaluation mode").ToUpperInvariant();
        if (normalizedMode is not ("ALL" or "ANY"))
        {
            throw new ArgumentOutOfRangeException(nameof(mode), "Condition evaluation mode must be ALL or ANY.");
        }
        CityConditionEvaluation[] results = requirements.Select(Evaluate).ToArray();
        bool passed = normalizedMode == "ALL"
            ? results.All(result => result.Passed)
            : results.Any(result => result.Passed);
        return new CityConditionEvaluationSet(passed, normalizedMode, Array.AsReadOnly(results));
    }

    public CityConditionResult GetTraffic(string? scopeId = "CITY", string? districtId = null)
    {
        string scope = string.IsNullOrWhiteSpace(scopeId) ? "CITY" : scopeId.Trim();
        if (districtId is not null) KnownDistrict(districtId);
        TrafficConditionMetrics metrics = trafficProvider?.Invoke() ?? new TrafficConditionMetrics();
        MissionOutcomeSnapshot outcome = OutcomeSnapshot();
        KeyValuePair<string, OutcomeTrafficState>[] policies = outcome.State.Traffic
            .Where(pair => pair.Key == scope
                || pair.Key == "CITY"
                || (districtId is not null && pair.Value.DistrictId == districtId))
            .ToArray();
        double densityMultiplier = policies.Aggregate(1d, (value, policy) => value * policy.Value.DensityMultiplier);
        string access = policies.Any(policy => policy.Value.Access == AccessStates.Closed)
            ? AccessStates.Closed
            : policies.Any(policy => policy.Value.Access == AccessStates.Restricted)
                ? AccessStates.Restricted
                : AccessStates.Open;
        double enforcement = policies.Select(policy => policy.Value.Enforcement).DefaultIfEmpty(0).Max();
        double hazardLevel = policies.Select(policy => policy.Value.HazardLevel).DefaultIfEmpty(0).Max();
        double baseIndex = scope.Contains("bridge", StringComparison.OrdinalIgnoreCase)
            ? metrics.Bridge.Index
            : metrics.Index;
        double congestion = metrics.IncludesAuthoredPolicies
            ? Math.Clamp(baseIndex, 0, 1)
            : Math.Clamp(baseIndex * densityMultiplier + hazardLevel * 0.15, 0, 1);
        return Result(
            CityConditionTypes.Traffic,
            scope,
            new { congestion, baseCongestion = baseIndex, densityMultiplier, access, enforcement, hazardLevel },
            new
            {
                metrics.Revision,
                metrics.Index,
                metrics.ActiveVehicles,
                metrics.StoppedVehicles,
                metrics.CrashedVehicles,
                metrics.Bridge,
                metrics.Hotspots,
                policies = policies.Select(pair => new { id = pair.Key, value = pair.Value }).ToArray(),
            },
            Sources(policies.Select(pair => pair.Value)),
            Revision(metrics.Revision));
    }

    public CityConditionResult GetBridge(string? bridgeId)
    {
        string id = RequireText(bridgeId, "bridgeId");
        BridgeConditionState baseline = bridgeProvider?.Invoke(id) ?? new BridgeConditionState(id);
        MissionOutcomeSnapshot outcome = OutcomeSnapshot();
        outcome.State.Infrastructure.TryGetValue(id, out OutcomeInfrastructureState? authored);
        outcome.State.Repairs.TryGetValue(id, out OutcomeRepairState? repair);
        CityConditionResult traffic = GetTraffic(id);
        double congestion = traffic.Value.GetProperty("congestion").GetDouble();
        return Result(
            CityConditionTypes.Bridge,
            id,
            new
            {
                state = authored?.State ?? baseline.State,
                access = authored?.Access ?? baseline.Access,
                condition = authored?.Condition ?? baseline.Condition,
                safety = authored?.Safety ?? baseline.Safety,
                repairStatus = repair?.Status ?? RepairStatuses.NotStarted,
                repairProgress = repair?.Progress ?? 0,
                congestion,
            },
            new { baseline, authored, repair, traffic = traffic.Value },
            Sources([authored, repair]),
            Revision());
    }

    public CityConditionResult GetServiceCoverage(
        string? service,
        string? districtId = null,
        double? x = null,
        double? z = null)
    {
        string normalizedService = NormalizeService(service);
        if (districtId is not null) KnownDistrict(districtId);
        if ((x is null) != (z is null)) throw new ArgumentException("Service queries require both x and z.");
        if (serviceModel is not null)
        {
            ServiceCoverageReading reading = serviceModel.GetCoverage(
                normalizedService,
                new ServiceCoverageSelector(
                    districtId,
                    x is null ? null : new OutcomePosition(x.Value, z!.Value)));
            return Result(
                CityConditionTypes.ServiceCoverage,
                districtId is null ? normalizedService : $"{districtId}:{normalizedService}",
                new
                {
                    service = normalizedService,
                    reading.DistrictId,
                    reading.Position,
                    reading.Coverage,
                    reading.CoveragePercent,
                    reading.Adequate,
                    reading.Health,
                    reading.OutageActive,
                    reading.Explanation,
                },
                reading.Facts,
                Sources(reading.Facts.Outages.Select(outage => outage.State)),
                serviceModel.Snapshot().Revision);
        }
        EconomyLedgerSnapshot economySnapshot = economy.Snapshot();
        EconomyServiceState baseline = economySnapshot.Services.Get(normalizedService);
        KeyValuePair<string, OutcomeServiceOutageState>[] outages = OutcomeSnapshot().State.ServiceOutages
            .Where(pair => pair.Value.Active
                && pair.Value.Service == normalizedService
                && (pair.Value.DistrictId is null || pair.Value.DistrictId == districtId))
            .ToArray();
        double coverageMultiplier = outages.Aggregate(1d, (value, outage) => value * outage.Value.CoverageMultiplier);
        double coverage = Math.Clamp(baseline.Coverage * coverageMultiplier, 0, 1);
        return Result(
            CityConditionTypes.ServiceCoverage,
            districtId is null ? normalizedService : $"{districtId}:{normalizedService}",
            new
            {
                service = normalizedService,
                districtId,
                coverage,
                coveragePercent = coverage * 100,
                adequate = coverage >= 1 && baseline.Adequate,
                outageActive = outages.Length > 0,
            },
            new
            {
                baseline,
                coverageMultiplier,
                outages = outages.Select(pair => new { id = pair.Key, value = pair.Value }).ToArray(),
            },
            Sources(outages.Select(pair => pair.Value)),
            Revision(economySnapshot.Revision));
    }

    public CityConditionResult GetSafety(string? districtId = null)
    {
        if (districtId is not null) KnownDistrict(districtId);
        CityConditionResult fire = GetServiceCoverage(ServiceTypes.Fire, districtId);
        double fireCoverage = fire.Value.GetProperty("coverage").GetDouble();
        OutcomeIncidentState[] incidents = OutcomeSnapshot().State.Incidents.Values
            .Where(incident => incident.Active && (incident.DistrictId is null || incident.DistrictId == districtId))
            .ToArray();
        OutcomeTrafficState[] traffic = OutcomeSnapshot().State.Traffic.Values
            .Where(policy => policy.DistrictId is null || policy.DistrictId == districtId)
            .ToArray();
        double incidentPenalty = incidents.Sum(incident => incident.Severity * 4);
        double trafficPenalty = traffic.Select(policy => policy.HazardLevel * 25).DefaultIfEmpty(0).Max();
        double score = Math.Clamp(fireCoverage * 100 - incidentPenalty - trafficPenalty, 0, 100);
        string rating = score >= 80 ? "SAFE" : score >= 55 ? "STRAINED" : "DANGEROUS";
        return Result(
            CityConditionTypes.Safety,
            districtId ?? "CITY",
            new { score, rating, activeIncidentCount = incidents.Length },
            new { fireCoverage, incidentPenalty, trafficPenalty, incidents },
            Sources(incidents),
            Revision());
    }

    public CityConditionResult GetRepair(string? targetId)
    {
        string id = RequireText(targetId, "targetId");
        OutcomeSnapshot().State.Repairs.TryGetValue(id, out OutcomeRepairState? repair);
        return Result(
            CityConditionTypes.Repair,
            id,
            repair is null
                ? new { status = RepairStatuses.NotStarted, progress = 0d, estimatedCost = 0d }
                : new { status = repair.Status, progress = repair.Progress, estimatedCost = repair.EstimatedCost },
            new { repair },
            Sources([repair]),
            Revision());
    }

    public CityConditionResult GetLandValue(double? x = null, double? z = null, string? districtId = null)
    {
        if ((x is null) != (z is null)) throw new ArgumentException("Land-value queries require both x and z.");
        string? resolvedDistrict = districtId;
        EconomyLandValueBreakdown? breakdown = null;
        double baseValue;
        if (x is not null)
        {
            RequireFinite(x.Value, "x");
            RequireFinite(z!.Value, "z");
            resolvedDistrict ??= DistrictForPosition(x.Value, z.Value)?.Id;
            breakdown = economy.GetLandValueBreakdownAt(x.Value, z.Value);
            baseValue = breakdown.LandValue;
        }
        else
        {
            if (resolvedDistrict is not null) KnownDistrict(resolvedDistrict);
            baseValue = economy.Snapshot().CityPulse.LandValue;
        }
        OutcomeIncidentState[] incidents = OutcomeSnapshot().State.Incidents.Values
            .Where(incident => incident.Active && (incident.DistrictId is null || incident.DistrictId == resolvedDistrict))
            .ToArray();
        double authoredModifier = incidents.Sum(incident => incident.LandValueModifier);
        double landValue = Math.Max(0, baseValue + authoredModifier);
        string subjectId = resolvedDistrict ?? (x is null
            ? "CITY"
            : $"{x.Value.ToString(CultureInfo.InvariantCulture)},{z!.Value.ToString(CultureInfo.InvariantCulture)}");
        return Result(
            CityConditionTypes.LandValue,
            subjectId,
            new { landValue, districtId = resolvedDistrict, x, z },
            new { economy = breakdown, baseLandValue = baseValue, authoredModifier },
            Sources(incidents),
            Revision());
    }

    public CityConditionResult GetWeather()
    {
        WeatherConditionState supplied = weatherProvider?.Invoke() ?? new WeatherConditionState();
        string mode = string.IsNullOrWhiteSpace(supplied.Mode) ? "clear" : supplied.Mode.Trim().ToLowerInvariant();
        WeatherProfile profile = WeatherProfiles.GetValueOrDefault(mode) ?? WeatherProfiles["clear"];
        return Result(
            CityConditionTypes.Weather,
            "CURRENT",
            new { mode, profile.Severity, profile.Visibility, profile.RoadGrip, supplied.Revision },
            new { profile },
            Array.Empty<CityConditionSource>(),
            Revision(supplied.Revision));
    }

    public CityConditionResult GetDistrict(string? districtId)
    {
        string id = KnownDistrict(districtId);
        DistrictDefinition definition = districtsById[id];
        EconomyLedgerSnapshot economySnapshot = economy.Snapshot();
        economySnapshot.Districts.TryGetValue(id, out EconomyDistrict? economyDistrict);
        MissionOutcomeSnapshot outcome = OutcomeSnapshot();
        bool unlocked = outcome.State.Unlocks.TryGetValue(id, out bool authoredUnlock)
            ? authoredUnlock
            : economyDistrict?.Unlocked ?? definition.ReleaseScope == "MVP";
        OutcomeIncidentState[] incidents = outcome.State.Incidents.Values
            .Where(incident => incident.Active && incident.DistrictId == id)
            .ToArray();
        return Result(
            CityConditionTypes.District,
            id,
            new
            {
                id,
                definition.Label,
                definition.ReleaseScope,
                unlocked,
                state = incidents.Length > 0 ? "DISRUPTED" : "STABLE",
                activeIncidentCount = incidents.Length,
            },
            new { definition, economy = economyDistrict, incidents },
            Sources(incidents),
            Revision(economySnapshot.Revision));
    }

    public CityConditionResult GetAuthoredFlag(string? flagId)
    {
        string id = RequireText(flagId, "flagId");
        OutcomeSnapshot().State.Flags.TryGetValue(id, out OutcomeFlagState? flag);
        JsonElement value = flag?.Value.Clone() ?? ConditionValues.From<object?>(null);
        return Result(
            CityConditionTypes.AuthoredFlag,
            id,
            value,
            new { set = flag is not null, flag },
            Sources([flag]),
            Revision());
    }

    private CityConditionContext Context() => new(economy.Snapshot(), OutcomeSnapshot(), districts);

    private MissionOutcomeSnapshot OutcomeSnapshot() => outcomes?.Snapshot() ?? new MissionOutcomeSnapshot
    {
        Revision = 0,
        State = MissionOutcomeService.CreateEmptyState().State,
        Transactions = Array.Empty<MissionOutcomeReceipt>(),
    };

    private IReadOnlyList<CityConditionSource> Sources(IEnumerable<object?> records)
    {
        string[] transactionIds = records
            .Select(TransactionId)
            .Where(id => id is not null)
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        return Array.AsReadOnly(transactionIds
            .Select(id => new CityConditionSource(id, outcomes?.GetReceipt(id)?.Summary))
            .ToArray());
    }

    private long Revision(params long[] revisions) => Math.Max(
        OutcomeSnapshot().Revision,
        revisions.Length == 0 ? 0 : revisions.Max());

    private string KnownDistrict(string? districtId)
    {
        string id = RequireText(districtId, "districtId");
        if (!districtsById.ContainsKey(id)) throw new ArgumentOutOfRangeException(nameof(districtId), $"Unknown district: {id}");
        return id;
    }

    private DistrictDefinition? DistrictForPosition(double x, double z) => districts.FirstOrDefault(definition =>
        x >= definition.Bounds.MinX && x <= definition.Bounds.MaxX
        && z >= definition.Bounds.MinZ && z <= definition.Bounds.MaxZ);

    private static CityConditionResult Result(
        string type,
        string subjectId,
        object value,
        object facts,
        IReadOnlyList<CityConditionSource> sources,
        long revision) => new(
            type,
            subjectId,
            value is JsonElement valueElement ? valueElement.Clone() : JsonSerializer.SerializeToElement(value, JsonOptions),
            facts is JsonElement factsElement ? factsElement.Clone() : JsonSerializer.SerializeToElement(facts, JsonOptions),
            sources,
            revision);

    private static string? TransactionId(object? record) => record switch
    {
        OutcomeInfrastructureState value => value.TransactionId,
        OutcomeIncidentState value => value.TransactionId,
        OutcomeRepairState value => value.TransactionId,
        OutcomeServiceOutageState value => value.TransactionId,
        OutcomeTrafficState value => value.TransactionId,
        OutcomeFlagState value => value.TransactionId,
        _ => null,
    };

    private static JsonElement? GetPath(JsonElement value, string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return value;
        JsonElement current = value;
        foreach (string segment in path.Split('.'))
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(segment, out current)) return null;
        }
        return current;
    }

    private static bool Compare(JsonElement? actual, string conditionOperator, JsonElement? expected) => conditionOperator switch
    {
        ConditionOperators.Equals => JsonEquals(actual, expected),
        ConditionOperators.NotEquals => !JsonEquals(actual, expected),
        ConditionOperators.GreaterThan => Number(actual) > Number(expected),
        ConditionOperators.GreaterThanOrEqual => Number(actual) >= Number(expected),
        ConditionOperators.LessThan => Number(actual) < Number(expected),
        ConditionOperators.LessThanOrEqual => Number(actual) <= Number(expected),
        ConditionOperators.In => expected is { ValueKind: JsonValueKind.Array }
            && expected.Value.EnumerateArray().Any(value => JsonEquals(actual, value)),
        ConditionOperators.Contains => Contains(actual, expected),
        ConditionOperators.Truthy => Truthy(actual),
        ConditionOperators.Falsy => !Truthy(actual),
        _ => throw new ArgumentOutOfRangeException(nameof(conditionOperator), $"Unsupported condition operator: {conditionOperator}"),
    };

    private static bool Contains(JsonElement? actual, JsonElement? expected)
    {
        if (actual is null) return false;
        if (actual.Value.ValueKind == JsonValueKind.Array)
        {
            return actual.Value.EnumerateArray().Any(value => JsonEquals(value, expected));
        }
        return actual.Value.ValueKind == JsonValueKind.String
            && expected is { ValueKind: JsonValueKind.String }
            && actual.Value.GetString()!.Contains(expected.Value.GetString()!, StringComparison.Ordinal);
    }

    private static bool Truthy(JsonElement? value) => value?.ValueKind switch
    {
        null or JsonValueKind.Undefined or JsonValueKind.Null or JsonValueKind.False => false,
        JsonValueKind.Number => value.Value.GetDouble() != 0,
        JsonValueKind.String => value.Value.GetString()!.Length > 0,
        _ => true,
    };

    private static double Number(JsonElement? value)
    {
        if (value is not { ValueKind: JsonValueKind.Number } || !value.Value.TryGetDouble(out double number))
        {
            throw new ArgumentException("Relational condition operators require numeric actual and expected values.");
        }
        return number;
    }

    private static bool JsonEquals(JsonElement? left, JsonElement? right)
    {
        if (left is null || right is null) return left is null && right is null;
        JsonNode? leftNode = JsonNode.Parse(left.Value.GetRawText());
        JsonNode? rightNode = JsonNode.Parse(right.Value.GetRawText());
        return JsonNode.DeepEquals(leftNode, rightNode);
    }

    private static string NormalizeService(string? service)
    {
        string value = RequireText(service, "service").ToLowerInvariant();
        if (!ServiceTypes.All.Contains(value)) throw new ArgumentOutOfRangeException(nameof(service), "Service must be power, water, or fire.");
        return value;
    }

    private static double RequireFinite(double value, string label)
    {
        if (!double.IsFinite(value)) throw new ArgumentOutOfRangeException(nameof(value), $"{label} must be finite.");
        return value;
    }

    private static string RequireText(string? value, string label)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new ArgumentException($"{label} must be a non-empty string.", label);
        return value.Trim();
    }

    private sealed record WeatherProfile(double Severity, double Visibility, double RoadGrip);
}
