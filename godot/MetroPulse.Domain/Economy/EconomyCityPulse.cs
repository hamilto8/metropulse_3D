using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Economy;

public static class ServiceTypes
{
    public const string Power = "power";
    public const string Water = "water";
    public const string Fire = "fire";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly([Power, Water, Fire]);
}

public static class EconomyDistrictIds
{
    public const string EastCyberMetropolis = "EAST_CYBER_METROPOLIS";
    public const string EastCyber = "EAST_CYBER";
}

public sealed record EconomyPoint(double X, double Z);

public sealed record EconomyServiceBase(double Capacity = 0, double Demand = 0);

public sealed record EconomyBuildingService(double Capacity = 0, double Demand = 0, double Reach = 0);

public sealed record EconomyBuildingServices
{
    public EconomyBuildingService Power { get; init; } = new();

    public EconomyBuildingService Water { get; init; } = new();

    public EconomyBuildingService Fire { get; init; } = new();

    public EconomyBuildingService Get(string service) => service switch
    {
        ServiceTypes.Power => Power,
        ServiceTypes.Water => Water,
        ServiceTypes.Fire => Fire,
        _ => throw new ArgumentOutOfRangeException(nameof(service), service, "Unknown service."),
    };
}

public sealed record EconomyBaseServices
{
    public EconomyServiceBase Power { get; init; } = new();

    public EconomyServiceBase Water { get; init; } = new();

    public EconomyServiceBase Fire { get; init; } = new();

    public EconomyServiceBase Get(string service) => service switch
    {
        ServiceTypes.Power => Power,
        ServiceTypes.Water => Water,
        ServiceTypes.Fire => Fire,
        _ => throw new ArgumentOutOfRangeException(nameof(service), service, "Unknown service."),
    };
}

public sealed record EconomyServiceState(
    double Capacity,
    double Demand,
    double Surplus,
    double Coverage,
    bool Adequate);

public sealed record EconomyServicesSnapshot
{
    public required EconomyServiceState Power { get; init; }

    public required EconomyServiceState Water { get; init; }

    public required EconomyServiceState Fire { get; init; }

    public EconomyServiceState Get(string service) => service switch
    {
        ServiceTypes.Power => Power,
        ServiceTypes.Water => Water,
        ServiceTypes.Fire => Fire,
        _ => throw new ArgumentOutOfRangeException(nameof(service), service, "Unknown service."),
    };
}

public sealed record EconomyBuilding
{
    public EconomyBuilding(
        string id,
        double grossIncomeRate = 0,
        double operatingCostRate = 0,
        bool operational = true)
    {
        Id = id;
        GrossIncomeRate = grossIncomeRate;
        OperatingCostRate = operatingCostRate;
        Operational = operational;
    }

    public string Id { get; init; }

    public string? Name { get; init; }

    public string? Kind { get; init; }

    public double Value { get; init; }

    public int Employees { get; init; }

    public int Population { get; init; }

    public string Status { get; init; } = "ACTIVE";

    public bool Operational { get; init; }

    public double PassiveIncomeRate { get; init; }

    public double GrossIncomeRate { get; init; }

    public double OperatingCostRate { get; init; }

    public int JobCapacity { get; init; }

    public int? HousingCapacity { get; init; }

    public double HappinessModifier { get; init; }

    public double LandValueModifier { get; init; }

    public EconomyPoint? Position { get; init; }

    public double AmenityRadius { get; init; }

    public EconomyBuildingServices Services { get; init; } = new();
}

public sealed record EconomyZoneEffect(
    string Id,
    string Type,
    double HappinessModifier = 0,
    double LandValueModifier = 0,
    EconomyPoint? Position = null);

public sealed record EconomyIncident
{
    public required string Id { get; init; }

    public string Type { get; init; } = "GENERAL";

    public double Severity { get; init; } = 1;

    public bool Active { get; init; } = true;

    public double ReputationDelta { get; init; }

    public double HappinessModifier { get; init; }

    public double LandValueModifier { get; init; }

    public EconomyPoint? Position { get; init; }

    public double InfluenceRadius { get; init; }

    public long RecordedAtRevision { get; init; }

    public long? ResolvedAtRevision { get; init; }
}

public sealed record EconomyMobilityFeedback
{
    public long Revision { get; init; }

    public double ProductivityMultiplier { get; init; } = 1;

    public double JobAccessMultiplier { get; init; } = 1;

    public double SatisfactionModifier { get; init; }

    public double DeliveryReliability { get; init; } = 1;

    public double Congestion { get; init; }

    public double BridgeCongestion { get; init; }

    public double ManagementCostRate { get; init; }

    public IReadOnlyList<string> Explanation { get; init; } = Array.Empty<string>();
}

public sealed record EconomyDemographics
{
    public required int Population { get; init; }

    public required int HousingCapacity { get; init; }

    public required double HousingOccupancy { get; init; }

    public required int Workforce { get; init; }

    public required int Employed { get; init; }

    public required int AccessibleEmployed { get; init; }

    public required int JobCapacity { get; init; }

    public required int AvailableJobs { get; init; }

    public required double UnemploymentRate { get; init; }

    public required double EmploymentRate { get; init; }

    public required double AccessibleEmploymentRate { get; init; }
}

public sealed record EconomyDemand(int Residential, int Commercial, int Operations, int Services);

public sealed record EconomyHappinessBreakdown
{
    public required double Baseline { get; init; }

    public required double Buildings { get; init; }

    public required double Zoning { get; init; }

    public required double Incidents { get; init; }

    public required double Services { get; init; }

    public required double Employment { get; init; }

    public required double Traffic { get; init; }

    public required double Total { get; init; }
}

public sealed record EconomyCityPulse
{
    public required double Budget { get; init; }

    public required double Cash { get; init; }

    public required double Energy { get; init; }

    public required double EnergySurplus { get; init; }

    public required double ServiceHealth { get; init; }

    public required int Population { get; init; }

    public required double Happiness { get; init; }

    public required double LandValue { get; init; }

    public required int Employees { get; init; }

    public required double TotalBuildingValue { get; init; }

    public required double Employment { get; init; }

    public required double AccessibleEmployment { get; init; }

    public required double Unemployment { get; init; }

    public required double HousingOccupancy { get; init; }

    public required double NetIncomeRate { get; init; }

    public required string FiscalStatus { get; init; }

    public required double Productivity { get; init; }

    public required double DeliveryReliability { get; init; }

    public required double TrafficCongestion { get; init; }
}

public sealed record EconomyLandValueBreakdown(
    double X,
    double Z,
    double BaseLandValue,
    double GlobalModifier,
    double AmenityModifier,
    double MayhemModifier,
    double ServiceMultiplier,
    double LandValue);

public sealed record EconomyDistrict(string Id, string Name, double UnlockCost, bool Unlocked);

public sealed record EconomyLedgerState
{
    public int Version { get; init; } = 1;

    public required double Treasury { get; init; }

    public required double BasePassiveIncomeRate { get; init; }

    public required int BasePopulation { get; init; }

    public required double BaseHappiness { get; init; }

    public required double BaseLandValue { get; init; }

    public required double Reputation { get; init; }

    public required int NarrativeProgress { get; init; }

    public required EconomyBaseServices BaseServices { get; init; }

    public required IReadOnlyList<EconomyBuilding> Buildings { get; init; }

    public required IReadOnlyList<EconomyMissionCompletion> CompletedMissions { get; init; }

    public required IReadOnlyList<EconomyIncident> Incidents { get; init; }

    public required IReadOnlyList<EconomyZoneEffect> Zones { get; init; }

    public required IReadOnlyList<EconomyDistrict> Districts { get; init; }

    public required EconomyRecoveryState Recovery { get; init; }
}

internal static class EconomyCollections
{
    public static IReadOnlyDictionary<string, T> ReadOnlyCopy<T>(IEnumerable<KeyValuePair<string, T>> source) =>
        new ReadOnlyDictionary<string, T>(source.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal));
}
