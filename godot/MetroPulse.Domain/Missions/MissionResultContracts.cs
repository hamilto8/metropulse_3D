namespace MetroPulse.Domain.Missions;

public static class MissionResultKinds
{
    public const string Success = "SUCCESS";
    public const string PartialSuccess = "PARTIAL_SUCCESS";
    public const string Failure = "FAILURE";
    public const string Abandoned = "ABANDONED";
    public const string Arrested = "ARRESTED";
    public const string VehicleLoss = "VEHICLE_LOSS";
}

public static class MissionResultSectionIds
{
    public const string Reward = "REWARD";
    public const string City = "CITY";
    public const string Faction = "FACTION";
    public const string Progression = "PROGRESSION";
}

public sealed record MissionResultEffectItem(
    string Id,
    string Type,
    string Label,
    string Value,
    string Explanation);

public sealed record MissionResultSection(
    string Id,
    string Title,
    string Empty,
    IReadOnlyList<MissionResultEffectItem> Items);

public sealed record MissionResultNextAction(
    string Title,
    string Description,
    bool CanRetry,
    string RetryLabel,
    string ContinueLabel);

public sealed record MissionResultView(
    string TransactionId,
    long? Sequence,
    string Kind,
    string OutcomeLabel,
    string Tone,
    string MissionTitle,
    string Title,
    string Description,
    IReadOnlyList<string> Why,
    int? Attempt,
    IReadOnlyList<MissionResultSection> Sections,
    MissionResultNextAction NextAction,
    string Announcement);
