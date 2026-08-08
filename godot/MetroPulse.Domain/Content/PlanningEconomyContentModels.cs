using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Content;

public sealed record EconomyBalanceDocument : CanonicalDocument
{
    [JsonPropertyName("fiscalStates")]
    public IReadOnlyDictionary<string, string>? FiscalStates { get; init; }

    [JsonPropertyName("spendingCategories")]
    public IReadOnlyDictionary<string, string>? SpendingCategories { get; init; }

    [JsonPropertyName("balance")]
    public EconomyBalanceDefinition? Balance { get; init; }
}

public sealed record EconomyBalanceDefinition
{
    [JsonPropertyName("startingTreasury")]
    public double StartingTreasury { get; init; } = double.NaN;

    [JsonPropertyName("baseRevenuePerSecond")]
    public double BaseRevenuePerSecond { get; init; } = double.NaN;

    [JsonPropertyName("fiscal")]
    public FiscalBalanceDefinition? Fiscal { get; init; }

    [JsonPropertyName("construction")]
    public ConstructionBalanceDefinition? Construction { get; init; }

    [JsonPropertyName("missions")]
    public MissionBalanceDefinition? Missions { get; init; }

    [JsonPropertyName("incidents")]
    public IncidentBalanceDefinition? Incidents { get; init; }

    [JsonPropertyName("policies")]
    public PolicyBalanceDefinition? Policies { get; init; }

    [JsonPropertyName("fines")]
    public FineBalanceDefinition? Fines { get; init; }

    [JsonPropertyName("progression")]
    public ProgressionBalanceDefinition? Progression { get; init; }

    [JsonPropertyName("sessionTargets")]
    public IReadOnlyDictionary<string, SessionTargetDefinition>? SessionTargets { get; init; }
}

public sealed record FiscalBalanceDefinition
{
    [JsonPropertyName("reserveFloor")]
    public double ReserveFloor { get; init; } = double.NaN;

    [JsonPropertyName("warningRunwayMinutes")]
    public double WarningRunwayMinutes { get; init; } = double.NaN;

    [JsonPropertyName("emergencyGrant")]
    public double EmergencyGrant { get; init; } = double.NaN;
}

public sealed record ConstructionBalanceDefinition
{
    [JsonPropertyName("zoningCost")]
    public double ZoningCost { get; init; } = double.NaN;

    [JsonPropertyName("defaultSalvageRate")]
    public double DefaultSalvageRate { get; init; } = double.NaN;

    [JsonPropertyName("starterPaybackMinutes")]
    public NumericRangeDefinition? StarterPaybackMinutes { get; init; }
}

public sealed record MissionBalanceDefinition
{
    [JsonPropertyName("rewardScale")]
    public double RewardScale { get; init; } = double.NaN;

    [JsonPropertyName("targetRewardRange")]
    public NumericRangeDefinition? TargetRewardRange { get; init; }
}

public sealed record NumericRangeDefinition
{
    [JsonPropertyName("min")]
    public double Minimum { get; init; } = double.NaN;

    [JsonPropertyName("max")]
    public double Maximum { get; init; } = double.NaN;
}

public sealed record IncidentBalanceDefinition
{
    [JsonPropertyName("cleanupCostPerSeverity")]
    public double CleanupCostPerSeverity { get; init; } = double.NaN;

    [JsonPropertyName("repairCostPerSeverity")]
    public double RepairCostPerSeverity { get; init; } = double.NaN;
}

public sealed record PolicyBalanceDefinition
{
    [JsonPropertyName("freightPriorityCostPerSecond")]
    public double FreightPriorityCostPerSecond { get; init; } = double.NaN;
}

public sealed record FineBalanceDefinition
{
    [JsonPropertyName("maximum")]
    public double Maximum { get; init; } = double.NaN;

    [JsonPropertyName("treasuryShare")]
    public double TreasuryShare { get; init; } = double.NaN;
}

public sealed record ProgressionBalanceDefinition
{
    [JsonPropertyName("eastDistrictUnlockCost")]
    public double EastDistrictUnlockCost { get; init; } = double.NaN;
}

public sealed record SessionTargetDefinition
{
    [JsonPropertyName("label")]
    public string? Label { get; init; }

    [JsonPropertyName("minimumTreasury")]
    public double MinimumTreasury { get; init; } = double.NaN;

    [JsonPropertyName("minimumAssets")]
    public int MinimumAssets { get; init; }
}

public sealed record CountrysidePlanDocument : CanonicalDocument
{
    [JsonPropertyName("grid")]
    public CountrysideGridDefinition? Grid { get; init; }

    [JsonPropertyName("homeRules")]
    public SuburbanHomeRulesDefinition? HomeRules { get; init; }

    [JsonPropertyName("reservations")]
    public IReadOnlyList<PlanarReservationDefinition>? Reservations { get; init; }

    [JsonPropertyName("parcels")]
    public IReadOnlyList<SuburbanParcelDefinition>? Parcels { get; init; }
}

public sealed record CountrysideGridDefinition
{
    [JsonPropertyName("bounds")]
    public PlanarExtentDefinition? Bounds { get; init; }

    [JsonPropertyName("buildableBounds")]
    public PlanarExtentDefinition? BuildableBounds { get; init; }

    [JsonPropertyName("roadWidth")]
    public double RoadWidth { get; init; } = double.NaN;

    [JsonPropertyName("horizontalRoadCenters")]
    public IReadOnlyList<double>? HorizontalRoadCenters { get; init; }

    [JsonPropertyName("verticalRoadCenters")]
    public IReadOnlyList<double>? VerticalRoadCenters { get; init; }

    [JsonPropertyName("verticalRoadMinZ")]
    public double VerticalRoadMinZ { get; init; } = double.NaN;

    [JsonPropertyName("verticalRoadMaxZ")]
    public double VerticalRoadMaxZ { get; init; } = double.NaN;

    [JsonPropertyName("residentialColumnCenters")]
    public IReadOnlyList<double>? ResidentialColumnCenters { get; init; }

    [JsonPropertyName("residentialRowCenters")]
    public IReadOnlyList<double>? ResidentialRowCenters { get; init; }

    [JsonPropertyName("rocketAccessRoad")]
    public VerticalRoadDefinition? RocketAccessRoad { get; init; }

    [JsonPropertyName("missionControlSpur")]
    public HorizontalRoadDefinition? MissionControlSpur { get; init; }
}

public record PlanarExtentDefinition
{
    [JsonPropertyName("minX")]
    public double MinX { get; init; } = double.NaN;

    [JsonPropertyName("maxX")]
    public double MaxX { get; init; } = double.NaN;

    [JsonPropertyName("minZ")]
    public double MinZ { get; init; } = double.NaN;

    [JsonPropertyName("maxZ")]
    public double MaxZ { get; init; } = double.NaN;
}

public sealed record VerticalRoadDefinition
{
    [JsonPropertyName("centerX")]
    public double CenterX { get; init; } = double.NaN;

    [JsonPropertyName("minZ")]
    public double MinZ { get; init; } = double.NaN;

    [JsonPropertyName("maxZ")]
    public double MaxZ { get; init; } = double.NaN;

    [JsonPropertyName("width")]
    public double Width { get; init; } = double.NaN;
}

public sealed record HorizontalRoadDefinition
{
    [JsonPropertyName("minX")]
    public double MinX { get; init; } = double.NaN;

    [JsonPropertyName("maxX")]
    public double MaxX { get; init; } = double.NaN;

    [JsonPropertyName("centerZ")]
    public double CenterZ { get; init; } = double.NaN;

    [JsonPropertyName("width")]
    public double Width { get; init; } = double.NaN;
}

public sealed record SuburbanHomeRulesDefinition
{
    [JsonPropertyName("footprint")]
    public BuildingFootprint? Footprint { get; init; }

    [JsonPropertyName("roadSetback")]
    public double RoadSetback { get; init; } = double.NaN;

    [JsonPropertyName("occupancyProbability")]
    public double OccupancyProbability { get; init; } = double.NaN;
}

public sealed record PlanarReservationDefinition : PlanarExtentDefinition
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }

    [JsonPropertyName("kind")]
    public string? Kind { get; init; }
}

public sealed record SuburbanParcelDefinition
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }

    [JsonPropertyName("zone")]
    public string? Zone { get; init; }

    [JsonPropertyName("x")]
    public double X { get; init; } = double.NaN;

    [JsonPropertyName("z")]
    public double Z { get; init; } = double.NaN;

    [JsonPropertyName("rotationY")]
    public double RotationY { get; init; } = double.NaN;
}

public sealed record StreetFurnitureDocument : CanonicalDocument
{
    [JsonPropertyName("minSpacing")]
    public double MinSpacing { get; init; } = double.NaN;

    [JsonPropertyName("roads")]
    public StreetRoadCoordinates? Roads { get; init; }

    [JsonPropertyName("placements")]
    public IReadOnlyList<StreetLampPlacement>? Placements { get; init; }
}

public sealed record StreetRoadCoordinates
{
    [JsonPropertyName("x")]
    public IReadOnlyList<double>? X { get; init; }

    [JsonPropertyName("z")]
    public IReadOnlyList<double>? Z { get; init; }
}

public sealed record StreetLampPlacement
{
    [JsonPropertyName("x")]
    public double X { get; init; } = double.NaN;

    [JsonPropertyName("z")]
    public double Z { get; init; } = double.NaN;

    [JsonPropertyName("roadAxis")]
    public string? RoadAxis { get; init; }

    [JsonPropertyName("roadCenter")]
    public double RoadCenter { get; init; } = double.NaN;

    [JsonPropertyName("rot")]
    public double Rotation { get; init; } = double.NaN;
}
