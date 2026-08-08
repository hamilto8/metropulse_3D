using System.Text.Json;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Missions;

public static class OutcomeSourceKinds
{
    public const string Mission = "MISSION";
    public const string Management = "MANAGEMENT";
    public const string System = "SYSTEM";
    public const string Migration = "MIGRATION";
}

public static class OutcomeCommandTypes
{
    public const string CapitalAdjusted = "CAPITAL_ADJUSTED";
    public const string BuildingStateSet = "BUILDING_STATE_SET";
    public const string InfrastructureStateSet = "INFRASTRUCTURE_STATE_SET";
    public const string IncidentRecorded = "INCIDENT_RECORDED";
    public const string IncidentResolved = "INCIDENT_RESOLVED";
    public const string RepairSet = "REPAIR_SET";
    public const string ServiceOutageSet = "SERVICE_OUTAGE_SET";
    public const string TrafficSet = "TRAFFIC_SET";
    public const string FactionReputationAdjusted = "FACTION_REPUTATION_ADJUSTED";
    public const string ProgressionSet = "PROGRESSION_SET";
    public const string UnlockSet = "UNLOCK_SET";
    public const string NewsPublished = "NEWS_PUBLISHED";
    public const string FollowUpMissionSet = "FOLLOW_UP_MISSION_SET";
    public const string AuthoredFlagSet = "AUTHORED_FLAG_SET";
}

public static class RepairStatuses
{
    public const string NotStarted = "NOT_STARTED";
    public const string Scheduled = "SCHEDULED";
    public const string InProgress = "IN_PROGRESS";
    public const string Complete = "COMPLETE";
    public const string Cancelled = "CANCELLED";
}

public static class WorkOrderTypes
{
    public const string Repair = "REPAIR";
    public const string Cleanup = "CLEANUP";
}

public static class AccessStates
{
    public const string Open = "OPEN";
    public const string Restricted = "RESTRICTED";
    public const string Closed = "CLOSED";
}

public static class FollowUpStatuses
{
    public const string Locked = "LOCKED";
    public const string Available = "AVAILABLE";
    public const string Completed = "COMPLETED";
    public const string Failed = "FAILED";
    public const string Expired = "EXPIRED";
}

public sealed record OutcomePosition(double X, double Z);

public sealed record OutcomeSource(
    string Kind,
    string ContentId,
    string? Outcome = null,
    string? RunId = null,
    string? ActorId = null,
    string? Reason = null);

public sealed record OutcomeSummary(string Title, string Description);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(CapitalAdjustedCommand), OutcomeCommandTypes.CapitalAdjusted)]
[JsonDerivedType(typeof(BuildingStateSetCommand), OutcomeCommandTypes.BuildingStateSet)]
[JsonDerivedType(typeof(InfrastructureStateSetCommand), OutcomeCommandTypes.InfrastructureStateSet)]
[JsonDerivedType(typeof(IncidentRecordedCommand), OutcomeCommandTypes.IncidentRecorded)]
[JsonDerivedType(typeof(IncidentResolvedCommand), OutcomeCommandTypes.IncidentResolved)]
[JsonDerivedType(typeof(RepairSetCommand), OutcomeCommandTypes.RepairSet)]
[JsonDerivedType(typeof(ServiceOutageSetCommand), OutcomeCommandTypes.ServiceOutageSet)]
[JsonDerivedType(typeof(TrafficSetCommand), OutcomeCommandTypes.TrafficSet)]
[JsonDerivedType(typeof(FactionReputationAdjustedCommand), OutcomeCommandTypes.FactionReputationAdjusted)]
[JsonDerivedType(typeof(ProgressionSetCommand), OutcomeCommandTypes.ProgressionSet)]
[JsonDerivedType(typeof(UnlockSetCommand), OutcomeCommandTypes.UnlockSet)]
[JsonDerivedType(typeof(NewsPublishedCommand), OutcomeCommandTypes.NewsPublished)]
[JsonDerivedType(typeof(FollowUpMissionSetCommand), OutcomeCommandTypes.FollowUpMissionSet)]
[JsonDerivedType(typeof(AuthoredFlagSetCommand), OutcomeCommandTypes.AuthoredFlagSet)]
public abstract record OutcomeCommand(string? CommandId = null, string? Reason = null);

public sealed record CapitalAdjustedCommand(
    double Amount,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record BuildingStateSetCommand(
    string BuildingId,
    string State,
    bool? Operational = null,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record InfrastructureStateSetCommand(
    string InfrastructureId,
    string State,
    string? DistrictId = null,
    string Access = AccessStates.Open,
    double Condition = 1,
    double Safety = 1,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record IncidentRecordedCommand(
    string IncidentId,
    string IncidentType = "GENERAL",
    string? DistrictId = null,
    double Severity = 1,
    double HappinessModifier = 0,
    double LandValueModifier = 0,
    OutcomePosition? Position = null,
    double InfluenceRadius = 0,
    string? Title = null,
    string? Cause = null,
    string? TargetId = null,
    string? Service = null,
    bool CleanupRequired = false,
    bool RepairRequired = false,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record IncidentResolvedCommand(
    string IncidentId,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record RepairSetCommand(
    string TargetId,
    string Status = RepairStatuses.NotStarted,
    double Progress = 0,
    double EstimatedCost = 0,
    string WorkType = WorkOrderTypes.Repair,
    string? Label = null,
    string? IncidentId = null,
    string? PrerequisiteTargetId = null,
    string? OutageId = null,
    string? InfrastructureId = null,
    string? Service = null,
    string? DistrictId = null,
    OutcomePosition? Position = null,
    double InteractionRadius = 7,
    bool ResolvesIncident = false,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record ServiceOutageSetCommand(
    string OutageId,
    string Service,
    string? DistrictId = null,
    bool Active = true,
    double Severity = 1,
    double CoverageMultiplier = 0,
    string? TargetId = null,
    string? Cause = null,
    OutcomePosition? Position = null,
    double InfluenceRadius = 0,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record TrafficSetCommand(
    string ScopeId,
    string? DistrictId = null,
    double DensityMultiplier = 1,
    string Access = AccessStates.Open,
    double Enforcement = 0.5,
    double HazardLevel = 0,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record FactionReputationAdjustedCommand(
    string FactionId,
    double Delta,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record ProgressionSetCommand(
    string ProgressionId,
    bool Unlocked = true,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record UnlockSetCommand(
    string UnlockId,
    bool Unlocked = true,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record NewsPublishedCommand(
    string NewsId,
    string Headline,
    string Body,
    double Priority = 1,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record FollowUpMissionSetCommand(
    string MissionId,
    string Status = FollowUpStatuses.Available,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public sealed record AuthoredFlagSetCommand(
    string FlagId,
    JsonElement Value,
    string? CommandId = null,
    string? Reason = null) : OutcomeCommand(CommandId, Reason);

public static class OutcomeValues
{
    public static JsonElement From<T>(T value) => JsonSerializer.SerializeToElement(value);
}

public sealed record MissionOutcomeTransaction(
    string TransactionId,
    OutcomeSource Source,
    IReadOnlyList<OutcomeCommand> Commands,
    OutcomeSummary? Summary = null);

public sealed record OutcomeEffect(
    string Type,
    string SubjectId,
    JsonElement? Before,
    JsonElement? After,
    string Explanation);

public sealed record OutcomeBuildingState(string State, bool Operational, string TransactionId, string CommandId);

public sealed record OutcomeInfrastructureState(
    string? DistrictId,
    string State,
    string Access,
    double Condition,
    double Safety,
    string TransactionId,
    string CommandId);

public sealed record OutcomeIncidentState(
    string Type,
    string? DistrictId,
    double Severity,
    bool Active,
    double HappinessModifier,
    double LandValueModifier,
    OutcomePosition? Position,
    double InfluenceRadius,
    string TransactionId,
    string CommandId,
    string? Title = null,
    string? Cause = null,
    string? TargetId = null,
    string? Service = null,
    bool CleanupRequired = false,
    bool RepairRequired = false);

public sealed record OutcomeRepairState(
    string WorkType,
    string? Label,
    string? IncidentId,
    string? PrerequisiteTargetId,
    string? OutageId,
    string? InfrastructureId,
    string? Service,
    string? DistrictId,
    OutcomePosition? Position,
    double InteractionRadius,
    bool ResolvesIncident,
    string Status,
    double Progress,
    double EstimatedCost,
    string TransactionId,
    string CommandId);

public sealed record OutcomeServiceOutageState(
    string Service,
    string? TargetId,
    string? Cause,
    OutcomePosition? Position,
    double InfluenceRadius,
    string? DistrictId,
    bool Active,
    double Severity,
    double CoverageMultiplier,
    string TransactionId,
    string CommandId);

public sealed record OutcomeTrafficState(
    string? DistrictId,
    double DensityMultiplier,
    string Access,
    double Enforcement,
    double HazardLevel,
    string TransactionId,
    string CommandId);

public sealed record OutcomeNewsState(
    string Headline,
    string Body,
    double Priority,
    string TransactionId,
    string CommandId);

public sealed record OutcomeFollowUpState(string Status, string TransactionId, string CommandId);

public sealed record OutcomeFlagState(JsonElement Value, string TransactionId, string CommandId);

public sealed record MissionOutcomeState
{
    public required IReadOnlyDictionary<string, OutcomeBuildingState> BuildingStates { get; init; }

    public required IReadOnlyDictionary<string, OutcomeInfrastructureState> Infrastructure { get; init; }

    public required IReadOnlyDictionary<string, OutcomeIncidentState> Incidents { get; init; }

    public required IReadOnlyDictionary<string, OutcomeRepairState> Repairs { get; init; }

    public required IReadOnlyDictionary<string, OutcomeServiceOutageState> ServiceOutages { get; init; }

    public required IReadOnlyDictionary<string, OutcomeTrafficState> Traffic { get; init; }

    public required IReadOnlyDictionary<string, double> Factions { get; init; }

    public required IReadOnlyDictionary<string, bool> Progression { get; init; }

    public required IReadOnlyDictionary<string, bool> Unlocks { get; init; }

    public required IReadOnlyDictionary<string, OutcomeNewsState> News { get; init; }

    public required IReadOnlyDictionary<string, OutcomeFollowUpState> FollowUpMissions { get; init; }

    public required IReadOnlyDictionary<string, OutcomeFlagState> Flags { get; init; }
}

public sealed record MissionOutcomeReceipt
{
    public int Version { get; init; } = 1;

    public required string TransactionId { get; init; }

    public required string Fingerprint { get; init; }

    public required long Sequence { get; init; }

    public required OutcomeSource Source { get; init; }

    public required OutcomeSummary Summary { get; init; }

    public required IReadOnlyList<OutcomeCommand> Commands { get; init; }

    public required IReadOnlyList<OutcomeEffect> Effects { get; init; }

    public required bool Duplicate { get; init; }
}

public sealed record MissionOutcomeSnapshot
{
    public required long Revision { get; init; }

    public required MissionOutcomeState State { get; init; }

    public required IReadOnlyList<MissionOutcomeReceipt> Transactions { get; init; }
}

public sealed record MissionOutcomeStateDocument
{
    public int Version { get; init; } = 1;

    public required long Sequence { get; init; }

    public required MissionOutcomeState State { get; init; }

    public required IReadOnlyList<MissionOutcomeReceipt> Transactions { get; init; }
}

public sealed record MissionOutcomeExplanation(
    string TransactionId,
    OutcomeSource Source,
    string Title,
    string Description,
    IReadOnlyList<OutcomeEffect> Effects);

public sealed record MissionOutcomeEvent(
    string Type,
    MissionOutcomeReceipt? Receipt,
    MissionOutcomeSnapshot Current);

public sealed class OutcomeConflictException(string transactionId)
    : InvalidOperationException($"Outcome transaction {transactionId} was already applied with different content")
{
    public string TransactionId { get; } = transactionId;
}

public sealed class OutcomeApplicationException : InvalidOperationException
{
    public OutcomeApplicationException(string message, string? transactionId = null, int? commandIndex = null)
        : base(message)
    {
        TransactionId = transactionId;
        CommandIndex = commandIndex;
    }

    public string? TransactionId { get; }

    public int? CommandIndex { get; }
}
