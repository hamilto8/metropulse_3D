using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Missions;

public static class MissionObjectiveTypes
{
    public const string Taxi = "TAXI";
    public const string Courier = "COURIER";
    public const string Delivery = "DELIVERY";
    public const string Race = "RACE";
    public const string Sabotage = "SABOTAGE";
    public const string Survival = "SURVIVAL";
}

public static class MissionExecutionSignals
{
    public const string None = "NONE";
    public const string Checkpoint = "CHECKPOINT";
    public const string ObjectiveReady = "OBJECTIVE_READY";
    public const string HoldStarted = "HOLD_STARTED";
    public const string HoldInterrupted = "HOLD_INTERRUPTED";
    public const string Completed = "COMPLETED";
    public const string Failed = "FAILED";
}

public sealed record MissionWorldPoint(
    double X,
    double Z,
    string? Label = null,
    string? DistrictId = null);

public sealed record MissionVehicleSnapshot(
    string StableId,
    string TypeId,
    double X,
    double Z,
    double Speed,
    bool DirectlyControlled = true);

public sealed record MissionTrafficModifier(
    bool Available = true,
    string? Reason = null,
    double RewardMultiplier = 1,
    double TimeLimitMultiplier = 1);

public sealed record MissionAcceptanceChoice(
    double RushBonus = 0,
    double? TimeLimitOverride = null,
    string? NodeId = null);

public sealed record MissionOfferDecision(
    bool Allowed,
    string? Reason,
    MissionAvailability Availability,
    double Distance,
    MissionTrafficModifier Traffic);

public sealed record MissionOfferMarker(
    string Id,
    string MissionId,
    string Title,
    string RequiredVehicleType,
    MissionWorldPoint Position,
    bool Eligible,
    string? IneligibleReason,
    double Distance);

public sealed record MissionExecutionState
{
    public int Version { get; init; } = 1;

    public required string MissionId { get; init; }

    public required string Objective { get; init; }

    public required string VehicleId { get; init; }

    public required string VehicleType { get; init; }

    public required double InitialTimeLimit { get; init; }

    public required double TimeRemaining { get; init; }

    public required double BasePayout { get; init; }

    public required double Payout { get; init; }

    public required IReadOnlyList<MissionWorldPoint> Route { get; init; }

    public required int RouteIndex { get; init; }

    public required double RaceElapsed { get; init; }

    public required string? RaceLeaderName { get; init; }

    public required double? RaceLeaderFinishTime { get; init; }

    public required bool SabotageActive { get; init; }

    public required double SabotageProgress { get; init; }

    public required bool SabotageTargetCheckpointRecorded { get; init; }

    public required long CongestionSamples { get; init; }

    public required double CongestionTotal { get; init; }
}

public sealed record MissionExecutionUpdate(
    MissionExecutionState State,
    string Signal,
    string? Reason = null,
    MissionCheckpoint? Checkpoint = null,
    double? Satisfaction = null);

public sealed record MissionExecutionCheckpointPayload
{
    [JsonPropertyName("timeRemaining")]
    public required double TimeRemaining { get; init; }

    [JsonPropertyName("payout")]
    public required double Payout { get; init; }

    [JsonPropertyName("routeIndex")]
    public required int RouteIndex { get; init; }

    [JsonPropertyName("raceElapsed")]
    public required double RaceElapsed { get; init; }

    [JsonPropertyName("congestionSamples")]
    public required long CongestionSamples { get; init; }

    [JsonPropertyName("congestionTotal")]
    public required double CongestionTotal { get; init; }
}
