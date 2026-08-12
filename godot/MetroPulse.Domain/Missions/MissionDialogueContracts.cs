namespace MetroPulse.Domain.Missions;

public static class MissionDialogueActions
{
    public const string None = "NONE";
    public const string Navigated = "NAVIGATED";
    public const string StartMission = "START_MISSION";
    public const string Declined = "DECLINED";
    public const string Closed = "CLOSED";
}

public sealed record MissionDialogueChoiceView(
    string Id,
    string Label,
    string NextNodeId,
    int Index);

public sealed record MissionDialogueSnapshot(
    string MissionId,
    string NodeId,
    string Speaker,
    string Role,
    string Avatar,
    uint PortraitSeed,
    string PortraitAccessibilityLabel,
    string Text,
    string? AuthoredAction,
    IReadOnlyList<MissionDialogueChoiceView> Choices,
    int FocusIndex,
    bool PauseRequested,
    string PauseReason,
    bool IsTerminal);

public sealed record MissionDialogueDecision(
    string Action,
    MissionDialogueSnapshot? Snapshot,
    MissionAcceptanceChoice? Acceptance = null);
