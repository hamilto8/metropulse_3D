namespace MetroPulse.Domain.Traffic;

public static class BridgePolicies
{
    public const string Balanced = "BALANCED";
    public const string FreightPriority = "FREIGHT_PRIORITY";
}

public static class TrafficAccess
{
    public const string Open = "OPEN";
    public const string Restricted = "RESTRICTED";
    public const string Closed = "CLOSED";
}

public sealed record TrafficPolicyProfile(
    string Id,
    string Label,
    double BridgeCapacityMultiplier,
    double FreightReliabilityBonus,
    double CommuterSatisfactionPenalty,
    double OperatingCostRate,
    string Tradeoff,
    bool Active = false);

public sealed record RoadNetworkSegment(
    string Id,
    bool Connected,
    TrafficPoint? Position = null);

public sealed record RoadNetworkSnapshot(
    IReadOnlyList<RoadNetworkSegment> Segments,
    int BaseNodeCount = 0)
{
    public static readonly RoadNetworkSnapshot Empty = new(Array.Empty<RoadNetworkSegment>());
}

public sealed record TrafficHotspot(
    string Id,
    string Label,
    double X,
    double Z,
    double Intensity,
    string Cause);

public sealed record TrafficNetworkProductivity(
    double Congestion,
    string Rating,
    string Access,
    int Demand,
    int Capacity,
    int ConnectedRoadSegments,
    int DisconnectedRoadSegments,
    IReadOnlyList<TrafficHotspot> Hotspots);

public sealed record BridgeProductivity(
    string Id,
    double Congestion,
    string Rating,
    string Access,
    int Demand,
    int Capacity,
    bool OutageActive,
    IReadOnlyList<string> OutageIds,
    string StreetStatus);

public sealed record TrafficJobAccess(
    double AccessMultiplier,
    int AccessibleJobs,
    int JobsDelayedByCommute);

public sealed record TrafficDeliveryProductivity(
    double Reliability,
    int OnTimePercent,
    int DelayedPercent,
    string Demand);

public sealed record TrafficProductivity(double Multiplier, int Percent);

public sealed record TrafficSatisfaction(double Modifier, int RoundedModifier);

public sealed record TrafficPresentation(
    int TargetMovingVehicles,
    double DensityMultiplier,
    double SpeedMultiplier,
    double BridgeSpeedMultiplier);

public sealed record TrafficProductivityInputs(
    double Workforce,
    double JobCapacity,
    int ActiveOutageCount);

public sealed record TrafficProductivitySnapshot(
    int Version,
    long Revision,
    TrafficNetworkProductivity Network,
    BridgeProductivity Bridge,
    TrafficJobAccess Jobs,
    TrafficDeliveryProductivity Deliveries,
    TrafficProductivity Productivity,
    TrafficSatisfaction Satisfaction,
    TrafficPolicyProfile Policy,
    TrafficPresentation Presentation,
    IReadOnlyList<string> Explanation,
    TrafficProductivityInputs Inputs);

public sealed record TrafficProductivityEvent(
    string Type,
    TrafficProductivitySnapshot? Previous,
    TrafficProductivitySnapshot Current);

public sealed record TrafficMissionRequest(
    string? MissionType = null,
    string? ObjectiveType = null,
    TrafficPoint? Pickup = null,
    TrafficPoint? Dropoff = null);

public sealed record TrafficMissionImpact(
    bool Available,
    string? Reason,
    string Objective,
    bool CrossesBridge,
    string Difficulty,
    double Congestion,
    string DemandStatus,
    double RewardMultiplier,
    double TimeLimitMultiplier,
    string Summary);

public sealed record TrafficStreetDirective(
    bool OnBridge,
    string Access,
    double SpeedMultiplier,
    bool PriorityActive,
    bool OutageActive,
    string Label);

public sealed record TrafficProductivityState
{
    public int Version { get; init; } = 1;

    public required string BridgePolicy { get; init; }
}
