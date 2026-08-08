using System.Collections.Frozen;
using System.Collections.ObjectModel;
using System.Globalization;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;

namespace MetroPulse.Domain.Placement;

public static class PlacementBlockerCodes
{
    public const string InvalidInput = "INVALID_INPUT";
    public const string ContentLocked = "CONTENT_LOCKED";
    public const string DistrictLocked = "DISTRICT_LOCKED";
    public const string OutOfBounds = "OUT_OF_BOUNDS";
    public const string ProtectedLandmark = "PROTECTED_LANDMARK";
    public const string Water = "WATER";
    public const string Slope = "SLOPE";
    public const string PlayerOccupied = "PLAYER_OCCUPIED";
    public const string RoadOverlap = "ROAD_OVERLAP";
    public const string Collision = "COLLISION";
    public const string ZoneRestriction = "ZONE_RESTRICTION";
    public const string RoadAccess = "ROAD_ACCESS";
    public const string ServiceShortage = "SERVICE_SHORTAGE";
    public const string FiscalRestriction = "FISCAL_RESTRICTION";
    public const string InsufficientFunds = "INSUFFICIENT_FUNDS";
}

public sealed record PlacementSpec
{
    public string? Id { get; init; }
    public string? Name { get; init; }
    public string? Category { get; init; }
    public string? GeneratorType { get; init; }
    public PlacementFootprint? Footprint { get; init; }
    public double Cost { get; init; }
    public double IncomePerMinute { get; init; }
    public double? RevenuePerMinute { get; init; }
    public double? GrossIncomePerMinute { get; init; }
    public double? OperatingCostPerMinute { get; init; }
    public double? UpkeepPerMinute { get; init; }
    public double Residents { get; init; }
    public double Employees { get; init; }
    public double TrafficCapacity { get; init; }
    public double PowerDemand { get; init; }
    public double PowerSupply { get; init; }
    public double WaterDemand { get; init; }
    public double WaterSupply { get; init; }
    public double? FireDemand { get; init; }
    public double FireCoverage { get; init; }
    public double Happiness { get; init; }
    public double? LandValueModifier { get; init; }
    public double AmenityRadius { get; init; }
    public string? RoadType { get; init; }
    public IReadOnlyList<string>? RequiredServices { get; init; }

    public static PlacementSpec FromBuilding(BuildingDefinition building)
    {
        ArgumentNullException.ThrowIfNull(building);
        return new PlacementSpec
        {
            Id = building.Id,
            Name = building.Name,
            Category = building.Category,
            GeneratorType = building.GeneratorType,
            Footprint = building.Footprint is null
                ? null
                : new PlacementFootprint(building.Footprint.Width, building.Footprint.Depth),
            Cost = building.Cost,
            IncomePerMinute = building.IncomePerMinute,
            Residents = building.Residents ?? 0,
            Employees = building.Employees ?? 0,
            TrafficCapacity = building.TrafficCapacity ?? 0,
            PowerDemand = building.PowerDemand ?? 0,
            PowerSupply = building.PowerSupply ?? 0,
            WaterDemand = building.WaterDemand ?? 0,
            WaterSupply = building.WaterSupply ?? 0,
            FireCoverage = building.FireCoverage ?? 0,
            Happiness = building.Happiness ?? 0,
            AmenityRadius = building.AmenityRadius ?? 0,
            RoadType = building.RoadType,
        };
    }
}

public sealed record PlacementDemandSnapshot(
    double Residential = 0,
    double Commercial = 0,
    double Operations = 0,
    double Services = 0)
{
    public double Get(string demandType) => demandType switch
    {
        "residential" => Residential,
        "commercial" => Commercial,
        "operations" => Operations,
        "services" => Services,
        _ => 0,
    };
}

public sealed record PlacementServiceSnapshot(double Capacity = 0, double Demand = 0);

public sealed record PlacementServicesSnapshot
{
    public PlacementServiceSnapshot Power { get; init; } = new();
    public PlacementServiceSnapshot Water { get; init; } = new();
    public PlacementServiceSnapshot Fire { get; init; } = new();

    public PlacementServiceSnapshot Get(string service) => service switch
    {
        ServiceTypes.Power => Power,
        ServiceTypes.Water => Water,
        ServiceTypes.Fire => Fire,
        _ => new PlacementServiceSnapshot(),
    };
}

public sealed record PlacementEconomySnapshot
{
    public PlacementDemandSnapshot Demand { get; init; } = new();
    public PlacementServicesSnapshot Services { get; init; } = new();

    public static PlacementEconomySnapshot FromEconomy(EconomyLedgerSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return new PlacementEconomySnapshot
        {
            Demand = new PlacementDemandSnapshot(
                snapshot.Demand.Residential,
                snapshot.Demand.Commercial,
                snapshot.Demand.Operations,
                snapshot.Demand.Services),
            Services = new PlacementServicesSnapshot
            {
                Power = new PlacementServiceSnapshot(snapshot.Services.Power.Capacity, snapshot.Services.Power.Demand),
                Water = new PlacementServiceSnapshot(snapshot.Services.Water.Capacity, snapshot.Services.Water.Demand),
                Fire = new PlacementServiceSnapshot(snapshot.Services.Fire.Capacity, snapshot.Services.Fire.Demand),
            },
        };
    }
}

public sealed record PlacementPayback(string Category, string Label, double? Minutes);

public sealed record PlacementCapacity(int Residents, int Jobs, int Traffic);

public sealed record PlacementDemandEffect(
    string? Type,
    double? Current,
    string Effect,
    string Label);

public sealed record PlacementServiceEffect(
    double CapacityDelta,
    double DemandDelta,
    double ProjectedCapacity,
    double ProjectedDemand,
    double ProjectedSurplus,
    bool Adequate);

public sealed record PlacementRisk(string Level, string Label);

public sealed record PlacementSummary(string Cost, string OperatingCost, string NetCashflow);

public sealed record PlacementPreview(
    string? SpecId,
    string Name,
    double Cost,
    double OperatingCost,
    double GrossIncome,
    double NetCashflow,
    PlacementPayback Payback,
    PlacementCapacity Capacity,
    PlacementDemandEffect DemandEffect,
    IReadOnlyDictionary<string, PlacementServiceEffect> ServiceEffect,
    double Happiness,
    double LandValue,
    IReadOnlyList<PlacementRisk> Risks,
    PlacementSummary Summary);

public sealed record PlacementAccess(
    bool Unlocked = true,
    string? RequiredTier = null,
    string? Reason = null);

public sealed record PlacementDistrictAccess(
    bool Allowed = true,
    string? Id = null,
    string? Reason = null,
    string? Remedy = null);

public sealed record PlacementCollision(
    string? Kind = null,
    string? Id = null,
    string? Name = null,
    string? Message = null,
    string? Remedy = null);

public sealed record PlacementZone(string? ZoneType = null, string? Label = null);

public sealed record PlacementBlocker(
    string Code,
    int Priority,
    string Message,
    string Remedy,
    IReadOnlyDictionary<string, object?> Detail);

public sealed record PlacementEvaluationInput
{
    public PlacementSpec? Spec { get; init; }
    public PlacementVector3? Position { get; init; }
    public PlacementAccess Access { get; init; } = new();
    public PlacementDistrictAccess District { get; init; } = new();
    public bool InBounds { get; init; } = true;
    public string? ProtectedLandmark { get; init; }
    public bool Water { get; init; }
    public double SlopeDegrees { get; init; }
    public double MaxSlopeDegrees { get; init; } = 8;
    public bool PlayerOccupied { get; init; }
    public bool RoadOverlap { get; init; }
    public PlacementCollision? Collision { get; init; }
    public PlacementZone? Zone { get; init; }
    public bool ZoneCompatible { get; init; } = true;
    public bool? RequiresRoadAccess { get; init; }
    public bool HasRoadAccess { get; init; } = true;
    public PlacementEconomySnapshot EconomySnapshot { get; init; } = new();
    public double? AvailableCredits { get; init; }
    public SpendingDecision? SpendingDecision { get; init; }
}

public sealed record PlacementDecision(
    bool Valid,
    IReadOnlyList<PlacementBlocker> Blockers,
    PlacementBlocker? PrimaryBlocker,
    PlacementPreview? Preview,
    PlacementVector3? Position);

/// <summary>Pure forecast and prioritized placement-decision authority.</summary>
public static class PlacementIntelligence
{
    private static readonly FrozenDictionary<string, int> BlockerPriority =
        new Dictionary<string, int>(StringComparer.Ordinal)
        {
            [PlacementBlockerCodes.InvalidInput] = 0,
            [PlacementBlockerCodes.ContentLocked] = 10,
            [PlacementBlockerCodes.DistrictLocked] = 20,
            [PlacementBlockerCodes.OutOfBounds] = 30,
            [PlacementBlockerCodes.ProtectedLandmark] = 40,
            [PlacementBlockerCodes.Water] = 50,
            [PlacementBlockerCodes.Slope] = 60,
            [PlacementBlockerCodes.PlayerOccupied] = 70,
            [PlacementBlockerCodes.RoadOverlap] = 80,
            [PlacementBlockerCodes.Collision] = 90,
            [PlacementBlockerCodes.ZoneRestriction] = 100,
            [PlacementBlockerCodes.RoadAccess] = 110,
            [PlacementBlockerCodes.ServiceShortage] = 120,
            [PlacementBlockerCodes.FiscalRestriction] = 125,
            [PlacementBlockerCodes.InsufficientFunds] = 130,
        }.ToFrozenDictionary(StringComparer.Ordinal);

    private static readonly FrozenSet<string> OrdinaryDevelopmentCategories =
        new[] { "RESIDENTIAL", "COMMERCIAL", "OPERATIONS" }.ToFrozenSet(StringComparer.Ordinal);

    private static readonly FrozenDictionary<string, string> ServiceLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [ServiceTypes.Power] = "Power",
            [ServiceTypes.Water] = "Water",
            [ServiceTypes.Fire] = "Fire safety",
        }.ToFrozenDictionary(StringComparer.Ordinal);

    public static bool IsOrdinaryDevelopment(PlacementSpec? spec) =>
        spec is not null && OrdinaryDevelopmentCategories.Contains(spec.Category ?? string.Empty);

    public static PlacementPreview CreatePreview(
        PlacementSpec spec,
        PlacementEconomySnapshot? economySnapshot = null,
        double? availableCredits = null,
        SpendingDecision? spendingDecision = null)
    {
        ArgumentNullException.ThrowIfNull(spec);
        economySnapshot ??= new PlacementEconomySnapshot();
        double cost = Math.Max(0, FiniteOrZero(spec.Cost));
        double authoredNet = FiniteOrZero(spec.IncomePerMinute);
        double grossIncome = Math.Max(
            0,
            FiniteOrFallback(
                spec.RevenuePerMinute ?? spec.GrossIncomePerMinute,
                Math.Max(0, authoredNet)));
        double operatingCost = Math.Max(
            0,
            FiniteOrFallback(
                spec.OperatingCostPerMinute ?? spec.UpkeepPerMinute,
                Math.Max(0, -authoredNet)));
        double netCashflow = spec.RevenuePerMinute is not null || spec.GrossIncomePerMinute is not null
            ? grossIncome - operatingCost
            : authoredNet;
        IReadOnlyDictionary<string, PlacementServiceEffect> services = ProjectServices(spec, economySnapshot);
        double happiness = FiniteOrZero(spec.Happiness);
        double amenityRadius = Math.Max(0, FiniteOrZero(spec.AmenityRadius));
        double landValue = spec.LandValueModifier is { } authoredLandValue
            ? FiniteOrZero(authoredLandValue)
            : happiness * 0.6 + (amenityRadius > 0 ? 3 : 0);
        var risks = new List<PlacementRisk>();
        if (services.Values.Any(state => !state.Adequate))
        {
            risks.Add(new PlacementRisk("HIGH", "Service shortage"));
        }
        if (happiness < 0)
        {
            risks.Add(new PlacementRisk("MODERATE", "Local satisfaction pressure"));
        }
        if (availableCredits is not null && cost > FiniteOrZero(availableCredits.Value) * 0.6)
        {
            risks.Add(new PlacementRisk("MODERATE", "Treasury concentration"));
        }
        if (!string.IsNullOrEmpty(spendingDecision?.Warning))
        {
            risks.Add(new PlacementRisk("HIGH", spendingDecision.Warning));
        }
        else if (spendingDecision is { Allowed: false }
            && spendingDecision.Code != PlacementBlockerCodes.InsufficientFunds)
        {
            risks.Add(new PlacementRisk("HIGH", spendingDecision.Reason));
        }
        if (risks.Count == 0)
        {
            risks.Add(new PlacementRisk("LOW", "No material forecast risk"));
        }

        return new PlacementPreview(
            EmptyToNull(spec.Id),
            FirstNonEmpty(spec.Name, spec.Id, "Structure"),
            cost,
            operatingCost,
            grossIncome,
            netCashflow,
            GetPayback(cost, netCashflow),
            new PlacementCapacity(
                NonNegativeJavascriptRound(spec.Residents),
                NonNegativeJavascriptRound(spec.Employees),
                NonNegativeJavascriptRound(spec.TrafficCapacity)),
            GetDemandEffect(spec, economySnapshot),
            services,
            happiness,
            landValue,
            new ReadOnlyCollection<PlacementRisk>(risks),
            new PlacementSummary(
                Money(cost),
                $"{Money(operatingCost)}/min",
                $"{(netCashflow >= 0 ? "+" : "−")}{Money(netCashflow)}/min"));
    }

    public static PlacementDecision Evaluate(PlacementEvaluationInput? input = null)
    {
        input ??= new PlacementEvaluationInput();
        if (input.Spec is null || input.Position is not { IsFinite: true })
        {
            PlacementBlocker invalid = MakeBlocker(
                PlacementBlockerCodes.InvalidInput,
                "The placement target is not available.",
                "Move the cursor onto buildable terrain and try again.");
            return new PlacementDecision(
                false,
                new ReadOnlyCollection<PlacementBlocker>([invalid]),
                invalid,
                null,
                null);
        }

        PlacementSpec spec = input.Spec;
        PlacementPreview preview = CreatePreview(
            spec,
            input.EconomySnapshot,
            input.AvailableCredits,
            input.SpendingDecision);
        var blockers = new List<PlacementBlocker>();

        if (!input.Access.Unlocked)
        {
            string requiredTier = FirstNonEmpty(input.Access.RequiredTier, "required");
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.ContentLocked,
                FirstNonEmpty(input.Access.Reason, $"{DisplayName(spec)} is not unlocked."),
                $"Reach the {requiredTier} progression tier, then select this blueprint again.",
                ("requiredTier", EmptyToNull(input.Access.RequiredTier))));
        }
        if (!input.District.Allowed)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.DistrictLocked,
                FirstNonEmpty(input.District.Reason, "This district is not open for development."),
                FirstNonEmpty(
                    input.District.Remedy,
                    "Unlock the district or choose a parcel in the current MVP footprint."),
                ("districtId", EmptyToNull(input.District.Id))));
        }
        if (!input.InBounds)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.OutOfBounds,
                "The full footprint extends beyond the buildable city boundary.",
                "Move the structure inward until the complete footprint is inside the boundary."));
        }
        if (!string.IsNullOrEmpty(input.ProtectedLandmark))
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.ProtectedLandmark,
                $"{input.ProtectedLandmark} is protected from construction.",
                "Choose a parcel outside the landmark protection boundary.",
                ("landmark", input.ProtectedLandmark)));
        }
        if (input.Water && spec.RoadType != "BRIDGE")
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.Water,
                $"{DisplayName(spec)} cannot be supported on open water.",
                "Move onto dry terrain or use an unlocked bridge segment where a crossing is valid."));
        }
        if (input.SlopeDegrees > input.MaxSlopeDegrees)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.Slope,
                $"Terrain slope is {input.SlopeDegrees.ToString("0.0", CultureInfo.InvariantCulture)}°; "
                    + $"{DisplayName(spec)} supports up to "
                    + $"{input.MaxSlopeDegrees.ToString("0.0", CultureInfo.InvariantCulture)}°.",
                "Move to flatter ground or rotate the footprint to follow the terrain.",
                ("slopeDegrees", input.SlopeDegrees),
                ("maxSlopeDegrees", input.MaxSlopeDegrees)));
        }
        if (input.PlayerOccupied)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.PlayerOccupied,
                "The controlled character or vehicle is inside the construction safety area.",
                "Move clear of the highlighted footprint before confirming construction."));
        }
        if (input.RoadOverlap)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.RoadOverlap,
                "The structure overlaps an active road corridor.",
                spec.GeneratorType == "ROAD_SEGMENT"
                    ? "Align the road segment edge-to-edge with the road socket without overlapping it."
                    : "Set the building beside the road while keeping the travel lanes clear."));
        }
        if (input.Collision is not null)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.Collision,
                FirstNonEmpty(
                    input.Collision.Message,
                    $"The footprint collides with {FirstNonEmpty(input.Collision.Name, "another world object")}."),
                FirstNonEmpty(
                    input.Collision.Remedy,
                    "Choose an unoccupied parcel with clearance on every side."),
                ("kind", FirstNonEmpty(input.Collision.Kind, "WORLD")),
                ("id", EmptyToNull(input.Collision.Id))));
        }
        if (input.Zone is not null && !input.ZoneCompatible)
        {
            string zoneName = FirstNonEmpty(input.Zone.Label, input.Zone.ZoneType, "the current");
            string category = string.IsNullOrEmpty(spec.Category)
                ? "compatible"
                : spec.Category.ToLowerInvariant();
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.ZoneRestriction,
                $"{DisplayName(spec)} is incompatible with {zoneName} zoning.",
                $"Choose a compatible {category} parcel or rezone this parcel first.",
                ("zoneType", EmptyToNull(input.Zone.ZoneType))));
        }
        bool requiresRoadAccess = input.RequiresRoadAccess ?? IsOrdinaryDevelopment(spec);
        if (requiresRoadAccess && !input.HasRoadAccess)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.RoadAccess,
                $"{DisplayName(spec)} has no valid road access.",
                "Place it beside a connected road, or construct and connect a road segment first."));
        }

        foreach (string service in GetRequiredServices(spec))
        {
            if (!preview.ServiceEffect.TryGetValue(service, out PlacementServiceEffect? projected)
                || projected.Adequate)
            {
                continue;
            }
            double shortage = Math.Abs(projected.ProjectedSurplus);
            string label = ServiceLabels[service];
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.ServiceShortage,
                $"{label} needs {FormatNumber(shortage)} more capacity after placement.",
                $"Add a {label.ToLowerInvariant()} facility before constructing {DisplayName(spec)}.",
                ("service", service),
                ("shortage", shortage)));
        }
        if (input.AvailableCredits is { } availableCredits && availableCredits < preview.Cost)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.InsufficientFunds,
                $"{DisplayName(spec)} costs {Money(preview.Cost)}, but the treasury has {Money(availableCredits)}.",
                $"Earn or recover {Money(preview.Cost - availableCredits)} before construction.",
                ("cost", preview.Cost),
                ("availableCredits", availableCredits),
                ("shortfall", preview.Cost - availableCredits)));
        }
        if (input.SpendingDecision is { Allowed: false } spendingDecision
            && spendingDecision.Code != PlacementBlockerCodes.InsufficientFunds)
        {
            blockers.Add(MakeBlocker(
                PlacementBlockerCodes.FiscalRestriction,
                spendingDecision.Reason,
                FirstNonEmpty(
                    spendingDecision.Remedy,
                    "Choose a lower-risk action and rebuild city reserves."),
                ("decisionCode", spendingDecision.Code),
                ("fiscalState", spendingDecision.State)));
        }

        blockers.Sort((left, right) =>
        {
            int priority = left.Priority.CompareTo(right.Priority);
            return priority != 0 ? priority : string.CompareOrdinal(left.Code, right.Code);
        });
        var readOnlyBlockers = new ReadOnlyCollection<PlacementBlocker>(blockers);
        return new PlacementDecision(
            blockers.Count == 0,
            readOnlyBlockers,
            blockers.FirstOrDefault(),
            preview,
            new PlacementVector3(input.Position.X, input.Position.Y, input.Position.Z));
    }

    private static IReadOnlyDictionary<string, PlacementServiceEffect> ProjectServices(
        PlacementSpec spec,
        PlacementEconomySnapshot economySnapshot)
    {
        var result = new Dictionary<string, PlacementServiceEffect>(StringComparer.Ordinal);
        foreach (string service in ServiceTypes.All)
        {
            PlacementServiceSnapshot current = economySnapshot.Services.Get(service);
            double capacitySource = service switch
            {
                ServiceTypes.Power => spec.PowerSupply,
                ServiceTypes.Water => spec.WaterSupply,
                _ => spec.FireCoverage,
            };
            double demandSource = service switch
            {
                ServiceTypes.Power => spec.PowerDemand,
                ServiceTypes.Water => spec.WaterDemand,
                _ => spec.FireDemand ?? double.NaN,
            };
            double fireDemandFallback = Math.Ceiling((FiniteOrZero(spec.Residents) + FiniteOrZero(spec.Employees)) / 180);
            double capacityDelta = Math.Max(0, FiniteOrZero(capacitySource));
            double demandDelta = Math.Max(
                0,
                FiniteOrFallback(demandSource, service == ServiceTypes.Fire ? fireDemandFallback : 0));
            double capacity = FiniteOrZero(current.Capacity) + capacityDelta;
            double demand = FiniteOrZero(current.Demand) + demandDelta;
            result[service] = new PlacementServiceEffect(
                capacityDelta,
                demandDelta,
                capacity,
                demand,
                capacity - demand,
                capacity >= demand);
        }
        return result.ToFrozenDictionary(StringComparer.Ordinal);
    }

    private static PlacementPayback GetPayback(double cost, double netCashflow)
    {
        if (netCashflow <= 0)
        {
            return new PlacementPayback("PUBLIC_SERVICE", "No direct payback", null);
        }
        double minutes = cost / netCashflow;
        string category = minutes <= 60 ? "FAST" : minutes <= 240 ? "MEDIUM" : "LONG";
        string title = category[0] + category[1..].ToLowerInvariant();
        return new PlacementPayback(category, $"{title} · {Math.Ceiling(minutes):0} min", minutes);
    }

    private static PlacementDemandEffect GetDemandEffect(
        PlacementSpec spec,
        PlacementEconomySnapshot economySnapshot)
    {
        string? type = spec.Category switch
        {
            "RESIDENTIAL" => "residential",
            "COMMERCIAL" => "commercial",
            "OPERATIONS" => "operations",
            "FACILITIES" => "services",
            _ => null,
        };
        if (type is null)
        {
            return new PlacementDemandEffect(null, null, "NEUTRAL", "No aggregate demand effect");
        }
        double current = FiniteOrZero(economySnapshot.Demand.Get(type));
        double capacity = type switch
        {
            "residential" => FiniteOrZero(spec.Residents),
            "services" => FiniteOrZero(spec.PowerSupply)
                + FiniteOrZero(spec.WaterSupply)
                + FiniteOrZero(spec.FireCoverage),
            _ => FiniteOrZero(spec.Employees),
        };
        string effect = capacity >= 300 ? "HIGH" : capacity > 0 ? "MODERATE" : "LOW";
        string title = char.ToUpperInvariant(type[0]) + type[1..];
        return new PlacementDemandEffect(
            type,
            current,
            effect,
            $"{title} demand {JavascriptRound(current)} · {effect.ToLowerInvariant()} relief");
    }

    private static IReadOnlyList<string> GetRequiredServices(PlacementSpec spec)
    {
        if (spec.RequiredServices is not null)
        {
            return new ReadOnlyCollection<string>(spec.RequiredServices
                .Where(ServiceLabels.ContainsKey)
                .ToList());
        }
        if (spec.GeneratorType is "ROAD_SEGMENT" or "PARK_PLAZA") return Array.Empty<string>();
        if (spec.GeneratorType == "ENERGY_ARRAY")
        {
            return spec.WaterDemand > 0 ? [ServiceTypes.Water] : Array.Empty<string>();
        }
        if (spec.GeneratorType == "UTILITY")
        {
            return spec.PowerDemand > 0 ? [ServiceTypes.Power] : Array.Empty<string>();
        }

        var result = new List<string>();
        foreach (string service in ServiceTypes.All)
        {
            if (service == ServiceTypes.Fire && FiniteOrZero(spec.FireCoverage) > 0) continue;
            if (service == ServiceTypes.Fire)
            {
                if (FiniteOrZero(spec.FireDemand ?? 0) > 0) result.Add(service);
                continue;
            }
            double demand = service == ServiceTypes.Power ? spec.PowerDemand : spec.WaterDemand;
            if (FiniteOrZero(demand) > 0 || IsOrdinaryDevelopment(spec)) result.Add(service);
        }
        return new ReadOnlyCollection<string>(result);
    }

    private static PlacementBlocker MakeBlocker(
        string code,
        string message,
        string remedy,
        params (string Key, object? Value)[] detail)
    {
        var values = detail.ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
        return new PlacementBlocker(
            code,
            BlockerPriority.GetValueOrDefault(code, 1_000),
            message,
            remedy,
            values.ToFrozenDictionary(StringComparer.Ordinal));
    }

    private static string DisplayName(PlacementSpec spec) =>
        FirstNonEmpty(spec.Name, spec.Id, "Structure");

    private static string FirstNonEmpty(params string?[] values) =>
        values.First(value => !string.IsNullOrEmpty(value))!;

    private static string? EmptyToNull(string? value) => string.IsNullOrEmpty(value) ? null : value;

    private static int NonNegativeJavascriptRound(double value) =>
        (int)Math.Max(0, JavascriptRound(FiniteOrZero(value)));

    private static long JavascriptRound(double value) => (long)Math.Floor(value + 0.5);

    private static double FiniteOrZero(double value) => double.IsFinite(value) ? value : 0;

    private static double FiniteOrFallback(double? value, double fallback) =>
        value is { } number && double.IsFinite(number) ? number : fallback;

    private static string Money(double value) =>
        $"${Math.Round(Math.Abs(FiniteOrZero(value)), MidpointRounding.AwayFromZero).ToString("N0", CultureInfo.GetCultureInfo("en-US"))}";

    private static string FormatNumber(double value) =>
        FiniteOrZero(value).ToString("#,0.###", CultureInfo.GetCultureInfo("en-US"));
}
