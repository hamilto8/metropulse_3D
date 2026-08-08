using System.Text.Json;

namespace MetroPulse.Domain.Settings;

public static class SettingValues
{
    public const string SystemMotion = "SYSTEM";
    public const string ReduceMotion = "REDUCE";
    public const string FullMotion = "FULL";

    public const string StandardContrast = "STANDARD";
    public const string HighContrast = "HIGH";
    public const string DarkContrast = "DARK";

    public const string FullEffect = "FULL";
    public const string ReducedEffect = "REDUCED";
    public const string OffEffect = "OFF";

    public const string Hold = "HOLD";
    public const string Toggle = "TOGGLE";

    public const string StandardSteering = "STANDARD";
    public const string AssistedSteering = "ASSISTED";

    public const string RelaxedDifficulty = "RELAXED";
    public const string StandardDifficulty = "STANDARD";
    public const string ExpertDifficulty = "EXPERT";
}

public sealed record CameraSensitivitySettings(double Orbit, double OnFoot, double Vehicle);

public sealed record AudioSettings(double Master, double Music, double Effects, double Ambience, double Dialogue);

public sealed record SubtitleSettings(bool Enabled, bool SpeakerLabels, bool ClosedCaptions);

public sealed record MotionSettings(
    string ReducedMotion,
    double CameraShake,
    string FlashIntensity,
    string Bloom);

public sealed record ToggleHoldSettings(string Sprint, string Braking, string RepeatedActions);

public sealed record DrivingAssistSettings(string Steering, bool AutoRecovery, bool BrakingAssist);

public sealed record SettingsPreferences
{
    public required double MouseSensitivity { get; init; }

    public required CameraSensitivitySettings CameraSensitivity { get; init; }

    public required AudioSettings Audio { get; init; }

    public required SubtitleSettings Subtitles { get; init; }

    public required double TextScale { get; init; }

    public required string ContrastMode { get; init; }

    public required bool ColorSafePatterns { get; init; }

    public required MotionSettings Motion { get; init; }

    public required ToggleHoldSettings ToggleHold { get; init; }

    public required DrivingAssistSettings DrivingAssists { get; init; }

    public required string Difficulty { get; init; }

    public required double TimerLeniency { get; init; }
}

public sealed record SettingsDocument
{
    public int Version { get; init; } = SettingsValidator.SchemaVersion;

    public required SettingsPreferences Settings { get; init; }

    public required IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> Bindings { get; init; }
}

public sealed record BindingConflict(string Context, string Input, IReadOnlyList<string> Actions);

public sealed record ReservedBindingIssue(string Context, string Action, string Input);

public sealed record SettingsLoadResult(
    SettingsPreferences Settings,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> Bindings,
    IReadOnlyList<string> Warnings);

public sealed record SettingsEvent
{
    public required string Type { get; init; }

    public required SettingsDocument? Previous { get; init; }

    public required SettingsDocument Current { get; init; }

    public string? Path { get; init; }

    public string? Context { get; init; }

    public string? Action { get; init; }

    public string? Input { get; init; }

    public int? Index { get; init; }

    public string? Source { get; init; }
}

public interface ISettingsStorage
{
    string? GetItem(string key);

    void SetItem(string key, string value);
}

public static class SettingJson
{
    public static JsonElement From<T>(T value) => JsonSerializer.SerializeToElement(value);
}
