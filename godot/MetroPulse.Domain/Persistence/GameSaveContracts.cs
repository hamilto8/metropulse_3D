using System.Collections.ObjectModel;

namespace MetroPulse.Domain.Persistence;

public static class GameSaveConstants
{
    public const string Format = "METROPULSE_3D_SAVE";
    public const int SchemaVersion = 2;
    public const int FeatureVersion = 2;
}

public static class GameSaveSlotIds
{
    public const string Current = "current";
    public const string Recovery = "recovery";
}

public static class BootActionIds
{
    public const string NewGame = "NEW_GAME";
    public const string Continue = "CONTINUE";
    public const string Recover = "RECOVER";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly([NewGame, Continue, Recover]);
}

public static class AutosaveReasonIds
{
    public const string Economy = "economy-change";
    public const string GameState = "game-state-change";
    public const string WorldEdit = "world-edit";
    public const string Mission = "mission-progress";
    public const string Checkpoint = "checkpoint";
    public const string ApplicationPaused = "application-paused";
    public const string Manual = "manual";
}

public sealed class GameSaveValidationException : Exception
{
    public GameSaveValidationException(
        string message,
        string path,
        string code = "INVALID_SAVE",
        Exception? innerException = null)
        : base($"{path}: {message}", innerException)
    {
        Path = path;
        Code = code;
        UserMessage = code == "FUTURE_SAVE_VERSION"
            ? "This city was saved by a newer MetroPulse version and cannot be opened safely here."
            : $"This city save was not applied because {path} {message}";
    }

    public string Path { get; }

    public string Code { get; }

    public string UserMessage { get; }
}

public sealed record ValidatedGameSaveDocument(
    string Json,
    int SchemaVersion,
    int FeatureVersion,
    string SaveId,
    string SavedAt,
    string Reason,
    IReadOnlyList<string> Reasons,
    string? Checkpoint,
    string DataJson);

public sealed record GameSaveInspection(
    string Slot,
    bool Present,
    bool Valid,
    string? SavedAt,
    string? Reason,
    ValidatedGameSaveDocument? Document);

public sealed record GameSaveDiscoveryReport(
    GameSaveInspection Current,
    GameSaveInspection Recovery,
    IReadOnlyDictionary<string, bool> Actions)
{
    public static IReadOnlyDictionary<string, bool> FreezeActions(bool canContinue, bool canRecover) =>
        new ReadOnlyDictionary<string, bool>(new Dictionary<string, bool>(StringComparer.Ordinal)
        {
            [BootActionIds.NewGame] = true,
            [BootActionIds.Continue] = canContinue,
            [BootActionIds.Recover] = canRecover,
        });
}

public sealed record PreparedBootSave(
    string Action,
    bool Restore,
    ValidatedGameSaveDocument? SaveDocument,
    IGameSaveRepository Repository);

public enum GameSaveStatus
{
    Idle,
    Scheduled,
    Saving,
    Saved,
    Loading,
    Error,
    Unavailable,
}

public sealed record GameSaveStatusSnapshot(
    GameSaveStatus Status,
    bool Available,
    bool Pending,
    bool Restoring,
    string? LastSavedAt,
    string? Error);
