using System.Collections.ObjectModel;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Services;

public static class MvpServiceTypes
{
    public const string Energy = ServiceTypes.Power;
    public const string Safety = ServiceTypes.Fire;
}

public static class ServiceHealth
{
    public const string Healthy = "HEALTHY";
    public const string Strained = "STRAINED";
    public const string Critical = "CRITICAL";
}

public sealed record ServiceCoverageSelector(string? DistrictId = null, OutcomePosition? Position = null);

public sealed record ServiceFacilityReading(
    string Id,
    string? Name,
    EconomyPoint? Position,
    double Capacity,
    double Reach,
    double? Weight);

public sealed record ServiceOutageReading(string Id, OutcomeServiceOutageState State);

public sealed record ServiceCoverageFacts(
    EconomyServiceState Aggregate,
    string? DistrictId,
    double NetworkAccess,
    double OutageMultiplier,
    IReadOnlyList<ServiceFacilityReading> Facilities,
    IReadOnlyList<ServiceOutageReading> Outages);

public sealed record ServiceCoverageReading(
    string Service,
    string? DistrictId,
    OutcomePosition? Position,
    double Coverage,
    double CoveragePercent,
    bool Adequate,
    string Health,
    bool OutageActive,
    string Explanation,
    ServiceCoverageFacts Facts);

public sealed record CityServiceSnapshot(
    long Revision,
    IReadOnlyDictionary<string, ServiceCoverageReading> Services,
    ServiceCoverageReading Energy,
    ServiceCoverageReading Safety,
    IReadOnlyList<KeyValuePair<string, OutcomeIncidentState>> ActiveIncidents,
    int ActiveIncidentCount,
    IReadOnlyList<KeyValuePair<string, OutcomeRepairState>> WorkOrders,
    IReadOnlyList<KeyValuePair<string, OutcomeRepairState>> OpenWorkOrders,
    int OpenWorkOrderCount);

public sealed record CityServiceEvent(string Type, CityServiceSnapshot Current);

/// <summary>
/// Read-only local service projection over the economy capacity authority and mission outcome authority.
/// </summary>
public sealed class CityServiceModel
{
    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> DistrictAccess =
        new ReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>(
            new Dictionary<string, IReadOnlyDictionary<string, double>>(StringComparer.Ordinal)
            {
                ["WEST_CORE"] = Access(0.9, 1, 0.72),
                ["CENTRAL_PARK"] = Access(0.86, 1, 0.84),
                ["PRIMARY_BRIDGE_CORRIDOR"] = Access(0.76, 1, 0.58),
                ["EAST_CYBER_METROPOLIS"] = Access(0.42, 0.7, 0.36),
            });

    private readonly EconomyLedger economy;
    private readonly MissionOutcomeService outcomes;
    private readonly IReadOnlyList<DistrictDefinition> districts;
    private readonly IReadOnlyDictionary<string, DistrictDefinition> districtsById;
    private readonly List<Action<CityServiceEvent>> listeners = [];
    private readonly Func<bool> unsubscribeEconomy;
    private readonly Func<bool> unsubscribeOutcomes;
    private long revision;

    public CityServiceModel(
        EconomyLedger economy,
        MissionOutcomeService outcomes,
        IReadOnlyList<DistrictDefinition>? districtDefinitions = null)
    {
        this.economy = economy ?? throw new ArgumentNullException(nameof(economy));
        this.outcomes = outcomes ?? throw new ArgumentNullException(nameof(outcomes));
        districts = Array.AsReadOnly((districtDefinitions ?? ContentDefinitions.Districts)
            .OrderBy(Area)
            .ToArray());
        districtsById = new ReadOnlyDictionary<string, DistrictDefinition>(
            districts.ToDictionary(item => item.Id, StringComparer.Ordinal));
        unsubscribeEconomy = economy.Subscribe(_ => Publish());
        unsubscribeOutcomes = outcomes.Subscribe(_ => Publish());
    }

    public ServiceCoverageReading GetCoverage(
        string service,
        ServiceCoverageSelector? selector = null)
    {
        string normalizedService = NormalizeService(service);
        selector ??= new ServiceCoverageSelector();
        OutcomePosition? position = selector.Position;
        ValidatePosition(position);
        DistrictDefinition? district = ResolveDistrict(selector.DistrictId, position);
        EconomyLedgerSnapshot economySnapshot = economy.Snapshot();
        EconomyServiceState aggregate = economySnapshot.Services.Get(normalizedService);
        ServiceFacilityReading[] facilities = economySnapshot.Buildings
            .Where(building => building.Operational && building.Services.Get(normalizedService).Capacity > 0)
            .Select(building =>
            {
                EconomyBuildingService state = building.Services.Get(normalizedService);
                return new ServiceFacilityReading(
                    building.Id,
                    building.Name,
                    building.Position,
                    state.Capacity,
                    state.Reach,
                    PositionWeight(building.Position, state.Reach, position));
            })
            .ToArray();
        double networkAccess = position is not null || district is not null
            ? NetworkAccess(normalizedService, district, position, facilities)
            : 1;
        ServiceOutageReading[] activeOutages = outcomes.Snapshot().State.ServiceOutages
            .Where(pair => pair.Value.Active && pair.Value.Service == normalizedService)
            .Select(pair => new ServiceOutageReading(pair.Key, pair.Value))
            .Where(outage => OutageApplies(outage.State, district, position))
            .ToArray();
        double outageMultiplier = activeOutages.Aggregate(
            1d,
            (current, outage) => current * OutageMultiplier(outage.State, district, position));
        double coverage = Math.Clamp(aggregate.Coverage * networkAccess * outageMultiplier, 0, 1);
        string health = HealthFor(coverage);
        return new ServiceCoverageReading(
            normalizedService,
            district?.Id,
            position,
            coverage,
            coverage * 100,
            aggregate.Adequate && coverage >= 0.9,
            health,
            activeOutages.Length > 0,
            Explain(normalizedService, coverage, health, networkAccess, outageMultiplier, activeOutages.Length),
            new ServiceCoverageFacts(
                aggregate,
                district?.Id,
                networkAccess,
                outageMultiplier,
                Array.AsReadOnly(facilities),
                Array.AsReadOnly(activeOutages)));
    }

    public CityServiceSnapshot Snapshot()
    {
        EconomyLedgerSnapshot economySnapshot = economy.Snapshot();
        MissionOutcomeSnapshot outcomeSnapshot = outcomes.Snapshot();
        ServiceCoverageReading power = GetCoverage(ServiceTypes.Power);
        ServiceCoverageReading fire = GetCoverage(ServiceTypes.Fire);
        ServiceCoverageReading water = GetCoverage(ServiceTypes.Water);
        KeyValuePair<string, OutcomeIncidentState>[] activeIncidents = outcomeSnapshot.State.Incidents
            .Where(pair => pair.Value.Active)
            .ToArray();
        KeyValuePair<string, OutcomeRepairState>[] workOrders = outcomeSnapshot.State.Repairs.ToArray();
        KeyValuePair<string, OutcomeRepairState>[] openWorkOrders = workOrders
            .Where(pair => pair.Value.Status is not (RepairStatuses.Complete or RepairStatuses.Cancelled))
            .ToArray();
        return new CityServiceSnapshot(
            Math.Max(revision, Math.Max(economySnapshot.Revision, outcomeSnapshot.Revision)),
            new ReadOnlyDictionary<string, ServiceCoverageReading>(
                new Dictionary<string, ServiceCoverageReading>(StringComparer.Ordinal)
                {
                    [ServiceTypes.Power] = power,
                    [ServiceTypes.Fire] = fire,
                    [ServiceTypes.Water] = water,
                }),
            power,
            fire,
            Array.AsReadOnly(activeIncidents),
            activeIncidents.Length,
            Array.AsReadOnly(workOrders),
            Array.AsReadOnly(openWorkOrders),
            openWorkOrders.Length);
    }

    public Func<bool> Subscribe(Action<CityServiceEvent> listener, bool emitCurrent = false)
    {
        ArgumentNullException.ThrowIfNull(listener);
        listeners.Add(listener);
        if (emitCurrent) listener(new CityServiceEvent("SNAPSHOT", Snapshot()));
        bool subscribed = true;
        return () =>
        {
            if (!subscribed) return false;
            subscribed = false;
            return listeners.Remove(listener);
        };
    }

    public void Destroy()
    {
        _ = unsubscribeEconomy();
        _ = unsubscribeOutcomes();
        listeners.Clear();
    }

    private void Publish()
    {
        revision += 1;
        var serviceEvent = new CityServiceEvent("CHANGED", Snapshot());
        foreach (Action<CityServiceEvent> listener in listeners.ToArray())
        {
            try
            {
                listener(serviceEvent);
            }
            catch
            {
                // Projection listeners cannot compromise either authority.
            }
        }
    }

    private DistrictDefinition? ResolveDistrict(string? districtId, OutcomePosition? position)
    {
        if (districtId is not null)
        {
            return districtsById.GetValueOrDefault(RequireText(districtId, "districtId"))
                ?? throw new ArgumentOutOfRangeException(nameof(districtId), $"Unknown district: {districtId}");
        }
        return position is null
            ? null
            : districts.FirstOrDefault(definition => Contains(definition, position));
    }

    private static double NetworkAccess(
        string service,
        DistrictDefinition? district,
        OutcomePosition? position,
        IReadOnlyList<ServiceFacilityReading> facilities)
    {
        double baseAccess = district is null
            ? 0.25
            : DistrictAccess.GetValueOrDefault(district.Id)?.GetValueOrDefault(service) ?? 0.35;
        if (position is null) return baseAccess;
        double facilityAccess = facilities.Select(facility => facility.Weight ?? 0).DefaultIfEmpty(0).Max();
        return Math.Clamp(Math.Max(baseAccess, facilityAccess), 0, 1);
    }

    private static bool OutageApplies(
        OutcomeServiceOutageState outage,
        DistrictDefinition? district,
        OutcomePosition? position)
    {
        if (outage.DistrictId is not null && district is not null && outage.DistrictId != district.Id) return false;
        if (outage.DistrictId is not null && district is null && position is not null) return false;
        double? weight = PositionWeight(outage.Position, outage.InfluenceRadius, position);
        return weight is null
            || weight > 0
            || (position is null && (outage.DistrictId is null || outage.DistrictId == district?.Id));
    }

    private static double OutageMultiplier(
        OutcomeServiceOutageState outage,
        DistrictDefinition? district,
        OutcomePosition? position)
    {
        double loss = 1 - Math.Clamp(outage.CoverageMultiplier, 0, 1);
        double? spatialWeight = PositionWeight(outage.Position, outage.InfluenceRadius, position);
        if (spatialWeight is not null) return 1 - loss * spatialWeight.Value;
        if (position is not null || district is not null) return Math.Clamp(outage.CoverageMultiplier, 0, 1);
        double aggregateWeight = Math.Clamp(outage.Severity * (outage.DistrictId is null ? 0.5 : 0.25), 0, 1);
        return 1 - loss * aggregateWeight;
    }

    private static double? PositionWeight(EconomyPoint? origin, double radius, OutcomePosition? position) =>
        origin is null ? null : PositionWeight(new OutcomePosition(origin.X, origin.Z), radius, position);

    private static double? PositionWeight(OutcomePosition? origin, double radius, OutcomePosition? position)
    {
        if (origin is null || radius <= 0 || position is null) return null;
        double distance = Math.Sqrt(Math.Pow(origin.X - position.X, 2) + Math.Pow(origin.Z - position.Z, 2));
        return Math.Clamp(1 - distance / radius, 0, 1);
    }

    private static string Explain(
        string service,
        double coverage,
        string health,
        double networkAccess,
        double outageMultiplier,
        int outageCount)
    {
        string label = service == ServiceTypes.Power
            ? "Energy"
            : service == ServiceTypes.Fire ? "Safety response" : "Water";
        var contributors = new List<string> { $"{Math.Round(networkAccess * 100)}% local access" };
        if (outageCount > 0) contributors.Add($"{outageCount} active outage{(outageCount == 1 ? string.Empty : "s")}");
        if (outageMultiplier < 1) contributors.Add($"{Math.Round((1 - outageMultiplier) * 100)}% outage loss");
        return $"{label} is {health.ToLowerInvariant()} at {Math.Round(coverage * 100)}% ({string.Join(", ", contributors)}).";
    }

    private static string HealthFor(double coverage) => coverage >= 0.9
        ? ServiceHealth.Healthy
        : coverage >= 0.65 ? ServiceHealth.Strained : ServiceHealth.Critical;

    private static string NormalizeService(string service)
    {
        string normalized = RequireText(service, nameof(service)).ToLowerInvariant();
        return ServiceTypes.All.Contains(normalized, StringComparer.Ordinal)
            ? normalized
            : throw new ArgumentOutOfRangeException(nameof(service), "Service must be power, water, or fire.");
    }

    private static void ValidatePosition(OutcomePosition? position)
    {
        if (position is null) return;
        if (!double.IsFinite(position.X) || !double.IsFinite(position.Z))
        {
            throw new ArgumentOutOfRangeException(nameof(position), "Service position requires finite X and Z.");
        }
    }

    private static bool Contains(DistrictDefinition definition, OutcomePosition position) =>
        position.X >= definition.Bounds.MinX && position.X <= definition.Bounds.MaxX
        && position.Z >= definition.Bounds.MinZ && position.Z <= definition.Bounds.MaxZ;

    private static double Area(DistrictDefinition definition) =>
        (definition.Bounds.MaxX - definition.Bounds.MinX) * (definition.Bounds.MaxZ - definition.Bounds.MinZ);

    private static IReadOnlyDictionary<string, double> Access(double power, double water, double fire) =>
        new ReadOnlyDictionary<string, double>(new Dictionary<string, double>(StringComparer.Ordinal)
        {
            [ServiceTypes.Power] = power,
            [ServiceTypes.Water] = water,
            [ServiceTypes.Fire] = fire,
        });

    private static string RequireText(string value, string label) => string.IsNullOrWhiteSpace(value)
        ? throw new ArgumentException($"{label} must be a non-empty string.", label)
        : value.Trim();
}
