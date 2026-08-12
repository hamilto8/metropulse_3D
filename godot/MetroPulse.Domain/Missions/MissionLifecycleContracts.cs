using System.Text.Json;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Missions;

public static class MissionPhases
{
    public const string Idle = "IDLE";
    public const string Preparation = "PREPARATION";
    public const string Briefing = "BRIEFING";
    public const string Approach = "APPROACH";
    public const string Active = "ACTIVE";
    public const string Checkpoint = "CHECKPOINT";
    public const string Completion = "COMPLETION";
    public const string Failure = "FAILURE";
    public const string Cleanup = "CLEANUP";
    public const string Result = "RESULT";
    public const string Recovery = "RECOVERY";
}

public static class MissionWeatherDispositions
{
    public const string Allowed = "ALLOWED";
    public const string Adapted = "ADAPTED";
    public const string Delayed = "DELAYED";
    public const string Blocked = "BLOCKED";
}

public static class MissionAvailabilityStatuses
{
    public const string Available = "AVAILABLE";
    public const string Delayed = "DELAYED";
    public const string Locked = "LOCKED";
    public const string Blocked = "BLOCKED";
}

public static class MissionRetryStrategies
{
    public const string Restart = "RESTART";
    public const string LastCheckpoint = "LAST_CHECKPOINT";
    public const string NoRetry = "NO_RETRY";
}

public static class MissionPrerequisiteTypes
{
    public const string MissionCompleted = "MISSION_COMPLETED";
    public const string FollowUpStatus = "FOLLOW_UP_STATUS";
    public const string CityCondition = "CITY_CONDITION";
}

public sealed record MissionWeatherDecision(
    string Mode,
    string Disposition,
    string Reason,
    double TimeLimitMultiplier,
    double RewardMultiplier,
    bool Allowed,
    bool Delayed);

public sealed record MissionLifecycleRetryPolicy(string Strategy, int MaxAttempts);

public sealed record MissionPrerequisiteResult(bool Passed, string Reason, MissionPrerequisite Requirement);

public sealed record MissionAvailability(
    string? MissionId,
    bool Available,
    string Status,
    IReadOnlyList<string> Reasons,
    IReadOnlyList<MissionPrerequisiteResult> Prerequisites,
    MissionWeatherDecision? Weather);

[JsonConverter(typeof(MissionRunCountConverter))]
public sealed record MissionRunCount(string MissionId, int Count);

public sealed class MissionRunCountConverter : JsonConverter<MissionRunCount>
{
    public override MissionRunCount? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartArray) throw new JsonException("Mission run counts must be [missionId, count].");
        reader.Read();
        string? missionId = reader.GetString();
        reader.Read();
        int count = reader.GetInt32();
        reader.Read();
        if (reader.TokenType != JsonTokenType.EndArray) throw new JsonException("Mission run counts must contain two values.");
        return new MissionRunCount(missionId!, count);
    }

    public override void Write(Utf8JsonWriter writer, MissionRunCount value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        writer.WriteStringValue(value.MissionId);
        writer.WriteNumberValue(value.Count);
        writer.WriteEndArray();
    }
}

public sealed record MissionDialogueHistoryEntry(string MissionId, string NodeId, string Choice, string Next);

public sealed record MissionLifecycleProgress
{
    public required IReadOnlyList<string> CompletedMissionIds { get; init; }

    public required IReadOnlyList<MissionDialogueHistoryEntry> DialogueChoices { get; init; }

    public required int ChronologyStep { get; init; }

    public required IReadOnlyList<MissionRunCount> RunCounts { get; init; }
}

public sealed record MissionCheckpoint(string Id, int Sequence, JsonElement Payload);

public sealed record MissionResolution(
    string Outcome,
    double? Payout = null,
    string? Summary = null,
    string? Reason = null,
    double? Satisfaction = null,
    double? Damage = null,
    double? Heat = null);

public sealed record MissionLifecycleRun
{
    public required string RunId { get; init; }

    public required string MissionId { get; init; }

    public required string Objective { get; init; }

    public required int RunNumber { get; init; }

    public required int Attempt { get; init; }

    public required MissionLifecycleRetryPolicy RetryPolicy { get; init; }

    public required MissionWeatherDecision Weather { get; init; }

    public JsonElement? Choice { get; init; }

    public required double InitialTimeLimit { get; init; }

    public required double BaseReward { get; init; }

    public MissionCheckpoint? Checkpoint { get; init; }

    public MissionResolution? Resolution { get; init; }

    public string? TransactionId { get; init; }

    public MissionOutcomeReceipt? Receipt { get; init; }

    public string? CleanupError { get; init; }
}

public sealed record MissionLifecycleState
{
    public int Version { get; init; } = 1;

    public required long Revision { get; init; }

    public required string Phase { get; init; }

    public required string? SelectedMissionId { get; init; }

    public required MissionLifecycleRun? Run { get; init; }

    public required MissionLifecycleProgress Progress { get; init; }
}

public sealed record MissionLifecycleEvent(
    string Type,
    string? PreviousPhase,
    MissionLifecycleState Current,
    JsonElement? Detail = null);

public sealed record MissionSaveDecision(bool Allowed, string? Code, string? Reason);

public sealed record MissionRetryDecision(
    bool Allowed,
    string Reason,
    string? Strategy,
    MissionCheckpoint? Checkpoint,
    int? NextAttempt = null,
    int? AttemptsRemaining = null);

public sealed record MissionRecoveryResult(
    MissionLifecycleState Snapshot,
    bool Retry,
    MissionRetryDecision? Decision);

public sealed class MissionLifecycleException : InvalidOperationException
{
    public MissionLifecycleException(string message, string code = "MISSION_LIFECYCLE_REJECTED", JsonElement? details = null)
        : base(message)
    {
        Code = code;
        Details = details?.Clone();
    }

    public string Code { get; }

    public JsonElement? Details { get; }
}
