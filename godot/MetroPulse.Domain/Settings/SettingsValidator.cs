using System.Collections.ObjectModel;
using System.Text.Json;

namespace MetroPulse.Domain.Settings;

/// <summary>Versioned schema, migration, range, enum, and binding validation authority.</summary>
public static class SettingsValidator
{
    public const int SchemaVersion = 2;
    public const string StorageKey = "metropulse3d:settings:v1";

    private static readonly HashSet<string> ReducedMotionValues =
        [SettingValues.SystemMotion, SettingValues.ReduceMotion, SettingValues.FullMotion];
    private static readonly HashSet<string> ContrastValues =
        [SettingValues.StandardContrast, SettingValues.HighContrast, SettingValues.DarkContrast];
    private static readonly HashSet<string> EffectValues =
        [SettingValues.FullEffect, SettingValues.ReducedEffect, SettingValues.OffEffect];
    private static readonly HashSet<string> ToggleHoldValues =
        [SettingValues.Hold, SettingValues.Toggle];
    private static readonly HashSet<string> SteeringValues =
        [SettingValues.StandardSteering, SettingValues.AssistedSteering];
    private static readonly HashSet<string> DifficultyValues =
        [SettingValues.RelaxedDifficulty, SettingValues.StandardDifficulty, SettingValues.ExpertDifficulty];

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    public static SettingsPreferences DefaultSettings { get; } = new()
    {
        MouseSensitivity = 1,
        CameraSensitivity = new CameraSensitivitySettings(1, 1, 1),
        Audio = new AudioSettings(0.5, 0.7, 1, 0.8, 1),
        Subtitles = new SubtitleSettings(true, true, true),
        TextScale = 1,
        ContrastMode = SettingValues.StandardContrast,
        ColorSafePatterns = true,
        Motion = new MotionSettings(
            SettingValues.SystemMotion,
            1,
            SettingValues.FullEffect,
            SettingValues.FullEffect),
        ToggleHold = new ToggleHoldSettings(SettingValues.Hold, SettingValues.Hold, SettingValues.Hold),
        DrivingAssists = new DrivingAssistSettings(SettingValues.StandardSteering, true, false),
        Difficulty = SettingValues.StandardDifficulty,
        TimerLeniency = 1,
    };

    public static SettingsDocument CreateDefaultDocument() => new()
    {
        Settings = DefaultSettings,
        Bindings = ControlBindingCatalog.EmptyOverrides(),
    };

    public static SettingsDocument Validate(string json, bool allowMigration = true)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return Validate(document.RootElement, allowMigration);
    }

    public static SettingsDocument Validate(SettingsDocument document, bool allowMigration = false)
    {
        ArgumentNullException.ThrowIfNull(document);
        return Validate(JsonSerializer.SerializeToElement(document, JsonOptions), allowMigration);
    }

    public static SettingsDocument Validate(JsonElement value, bool allowMigration = true)
    {
        RequireObject(value, "settings document");
        int? version = OptionalInteger(value, "version");
        if (version == 1 && allowMigration) return MigrateVersionOne(value);
        if (version != SchemaVersion)
        {
            throw new ArgumentOutOfRangeException(nameof(value), $"Unsupported settings version: {version?.ToString() ?? "<missing>"}.");
        }

        JsonElement settings = RequiredProperty(value, "settings");
        RequireObject(settings, "settings");
        JsonElement camera = RequiredObject(settings, "cameraSensitivity", "settings.cameraSensitivity");
        JsonElement audio = RequiredObject(settings, "audio", "settings.audio");
        JsonElement subtitles = RequiredObject(settings, "subtitles", "settings.subtitles");
        JsonElement motion = RequiredObject(settings, "motion", "settings.motion");
        JsonElement toggleHold = RequiredObject(settings, "toggleHold", "settings.toggleHold");
        JsonElement drivingAssists = RequiredObject(settings, "drivingAssists", "settings.drivingAssists");

        var preferences = new SettingsPreferences
        {
            MouseSensitivity = Range(settings, "mouseSensitivity", 0.2, 3, "settings.mouseSensitivity"),
            CameraSensitivity = new CameraSensitivitySettings(
                Range(camera, "orbit", 0.2, 3, "settings.cameraSensitivity.orbit"),
                Range(camera, "onFoot", 0.2, 3, "settings.cameraSensitivity.onFoot"),
                Range(camera, "vehicle", 0.2, 3, "settings.cameraSensitivity.vehicle")),
            Audio = new AudioSettings(
                Range(audio, "master", 0, 1, "settings.audio.master"),
                Range(audio, "music", 0, 1, "settings.audio.music"),
                Range(audio, "effects", 0, 1, "settings.audio.effects"),
                Range(audio, "ambience", 0, 1, "settings.audio.ambience"),
                Range(audio, "dialogue", 0, 1, "settings.audio.dialogue")),
            Subtitles = new SubtitleSettings(
                Boolean(subtitles, "enabled", "settings.subtitles.enabled"),
                Boolean(subtitles, "speakerLabels", "settings.subtitles.speakerLabels"),
                Boolean(subtitles, "closedCaptions", "settings.subtitles.closedCaptions")),
            TextScale = Range(settings, "textScale", 0.8, 1.5, "settings.textScale"),
            ContrastMode = Enumeration(settings, "contrastMode", ContrastValues, "settings.contrastMode"),
            ColorSafePatterns = Boolean(settings, "colorSafePatterns", "settings.colorSafePatterns"),
            Motion = new MotionSettings(
                Enumeration(motion, "reducedMotion", ReducedMotionValues, "settings.motion.reducedMotion"),
                Range(motion, "cameraShake", 0, 1, "settings.motion.cameraShake"),
                Enumeration(motion, "flashIntensity", EffectValues, "settings.motion.flashIntensity"),
                Enumeration(motion, "bloom", EffectValues, "settings.motion.bloom")),
            ToggleHold = new ToggleHoldSettings(
                Enumeration(toggleHold, "sprint", ToggleHoldValues, "settings.toggleHold.sprint"),
                Enumeration(toggleHold, "braking", ToggleHoldValues, "settings.toggleHold.braking"),
                Enumeration(toggleHold, "repeatedActions", ToggleHoldValues, "settings.toggleHold.repeatedActions")),
            DrivingAssists = new DrivingAssistSettings(
                Enumeration(drivingAssists, "steering", SteeringValues, "settings.drivingAssists.steering"),
                Boolean(drivingAssists, "autoRecovery", "settings.drivingAssists.autoRecovery"),
                Boolean(drivingAssists, "brakingAssist", "settings.drivingAssists.brakingAssist")),
            Difficulty = Enumeration(settings, "difficulty", DifficultyValues, "settings.difficulty"),
            TimerLeniency = Range(settings, "timerLeniency", 1, 2, "settings.timerLeniency"),
        };
        IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> bindings =
            ParseBindings(value.TryGetProperty("bindings", out JsonElement bindingValue) ? bindingValue : default);
        return new SettingsDocument { Settings = preferences, Bindings = bindings };
    }

    private static SettingsDocument MigrateVersionOne(JsonElement value)
    {
        SettingsPreferences settings = DefaultSettings;
        if (value.TryGetProperty("textScale", out JsonElement scale) && scale.ValueKind == JsonValueKind.Number &&
            scale.TryGetDouble(out double textScale) && double.IsFinite(textScale))
        {
            settings = settings with { TextScale = Math.Clamp(textScale, 0.8, 1.5) };
        }
        if (value.TryGetProperty("reducedMotion", out JsonElement motion) && motion.ValueKind == JsonValueKind.String)
        {
            string? reducedMotion = motion.GetString();
            if (reducedMotion is not null && ReducedMotionValues.Contains(reducedMotion))
            {
                settings = settings with { Motion = settings.Motion with { ReducedMotion = reducedMotion } };
            }
        }
        return new SettingsDocument { Settings = settings, Bindings = ControlBindingCatalog.EmptyOverrides() };
    }

    private static IReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>> ParseBindings(
        JsonElement value)
    {
        if (value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
        {
            return ControlBindingCatalog.EmptyOverrides();
        }
        if (value.ValueKind != JsonValueKind.Object) throw new ArgumentException("Binding overrides must be an object.", nameof(value));
        var bindings = new Dictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(StringComparer.Ordinal);
        foreach (JsonProperty context in value.EnumerateObject())
        {
            if (context.Value.ValueKind != JsonValueKind.Object)
            {
                throw new ArgumentException($"Unknown binding context: {context.Name}.", nameof(value));
            }
            var actions = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
            foreach (JsonProperty action in context.Value.EnumerateObject())
            {
                if (action.Value.ValueKind != JsonValueKind.Array)
                {
                    actions[action.Name] = Array.Empty<string>();
                    continue;
                }
                actions[action.Name] = Array.AsReadOnly(action.Value.EnumerateArray()
                    .Select(input => input.ValueKind == JsonValueKind.String ? input.GetString()! : string.Empty)
                    .ToArray());
            }
            bindings[context.Name] = new ReadOnlyDictionary<string, IReadOnlyList<string>>(actions);
        }
        return ControlBindingCatalog.ValidateOverrides(
            new ReadOnlyDictionary<string, IReadOnlyDictionary<string, IReadOnlyList<string>>>(bindings));
    }

    private static JsonElement RequiredObject(JsonElement owner, string property, string path)
    {
        JsonElement value = RequiredProperty(owner, property);
        RequireObject(value, path);
        return value;
    }

    private static JsonElement RequiredProperty(JsonElement owner, string property)
    {
        if (!owner.TryGetProperty(property, out JsonElement value))
        {
            throw new ArgumentException($"settings.{property} is required.", nameof(owner));
        }
        return value;
    }

    private static void RequireObject(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new ArgumentException($"{path} must be an object.", nameof(value));
    }

    private static double Range(JsonElement owner, string property, double minimum, double maximum, string path)
    {
        if (!owner.TryGetProperty(property, out JsonElement value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDouble(out double number) || !double.IsFinite(number) || number < minimum || number > maximum)
        {
            throw new ArgumentOutOfRangeException(path, $"{path} must be between {minimum} and {maximum}.");
        }
        return number;
    }

    private static bool Boolean(JsonElement owner, string property, string path)
    {
        if (!owner.TryGetProperty(property, out JsonElement value) ||
            value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new ArgumentException($"{path} must be boolean.", path);
        }
        return value.GetBoolean();
    }

    private static string Enumeration(
        JsonElement owner,
        string property,
        IReadOnlyCollection<string> allowed,
        string path)
    {
        string? value = owner.TryGetProperty(property, out JsonElement element) && element.ValueKind == JsonValueKind.String
            ? element.GetString()
            : null;
        if (value is null || !allowed.Contains(value))
        {
            throw new ArgumentOutOfRangeException(path, $"{path} must be one of {string.Join(", ", allowed)}.");
        }
        return value;
    }

    private static int? OptionalInteger(JsonElement owner, string property) =>
        owner.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int number)
            ? number
            : null;
}
