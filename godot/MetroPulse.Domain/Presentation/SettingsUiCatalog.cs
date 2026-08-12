using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Presentation;

public static class SettingControlKinds
{
    public const string Slider = "SLIDER";
    public const string Toggle = "TOGGLE";
    public const string Choice = "CHOICE";
}

public sealed record SettingControlSpec(
    string Path,
    string Group,
    string Label,
    string Description,
    string Kind,
    double Minimum = 0,
    double Maximum = 1,
    double Step = 0.05,
    IReadOnlyList<string>? Options = null);

/// <summary>Complete ordered UI catalog for every SettingsPreferences leaf.</summary>
public static class SettingsUiCatalog
{
    private static readonly IReadOnlyList<string> MotionOptions = Array.AsReadOnly([
        SettingValues.SystemMotion,
        SettingValues.ReduceMotion,
        SettingValues.FullMotion,
    ]);
    private static readonly IReadOnlyList<string> ContrastOptions = Array.AsReadOnly([
        SettingValues.StandardContrast,
        SettingValues.HighContrast,
        SettingValues.DarkContrast,
    ]);
    private static readonly IReadOnlyList<string> EffectOptions = Array.AsReadOnly([
        SettingValues.FullEffect,
        SettingValues.ReducedEffect,
        SettingValues.OffEffect,
    ]);
    private static readonly IReadOnlyList<string> ToggleOptions = Array.AsReadOnly([
        SettingValues.Hold,
        SettingValues.Toggle,
    ]);

    public static readonly IReadOnlyList<SettingControlSpec> All = Array.AsReadOnly<SettingControlSpec>([
        Slider("mouseSensitivity", "Controls", "Mouse sensitivity", "Pointer look sensitivity", 0.2, 3, 0.1),
        Slider("cameraSensitivity.orbit", "Controls", "Orbit sensitivity", "Management orbit camera sensitivity", 0.2, 3, 0.1),
        Slider("cameraSensitivity.onFoot", "Controls", "On-foot sensitivity", "Pedestrian camera sensitivity", 0.2, 3, 0.1),
        Slider("cameraSensitivity.vehicle", "Controls", "Vehicle sensitivity", "Vehicle camera sensitivity", 0.2, 3, 0.1),
        Choice("toggleHold.sprint", "Controls", "Sprint input", "Use hold or toggle for sprint", ToggleOptions),
        Choice("toggleHold.braking", "Controls", "Braking input", "Use hold or toggle for braking", ToggleOptions),
        Choice("toggleHold.repeatedActions", "Controls", "Repeated actions", "Use hold or toggle for repeated actions", ToggleOptions),
        Choice("drivingAssists.steering", "Controls", "Steering", "Standard or assisted steering", [SettingValues.StandardSteering, SettingValues.AssistedSteering]),
        Toggle("drivingAssists.autoRecovery", "Controls", "Automatic recovery", "Recover stuck vehicles automatically"),
        Toggle("drivingAssists.brakingAssist", "Controls", "Braking assist", "Assist vehicle braking"),

        Slider("audio.master", "Audio", "Master volume", "Overall output volume", 0, 1),
        Slider("audio.music", "Audio", "Music volume", "Music bus volume", 0, 1),
        Slider("audio.effects", "Audio", "Effects volume", "Effects bus volume", 0, 1),
        Slider("audio.ambience", "Audio", "Ambience volume", "Ambient city bus volume", 0, 1),
        Slider("audio.dialogue", "Audio", "Dialogue volume", "Dialogue bus volume", 0, 1),

        Toggle("subtitles.enabled", "Accessibility", "Subtitles", "Show authored dialogue subtitles"),
        Toggle("subtitles.speakerLabels", "Accessibility", "Speaker labels", "Identify subtitle speakers"),
        Toggle("subtitles.closedCaptions", "Accessibility", "Closed captions", "Describe important non-speech sounds"),
        Slider("textScale", "Accessibility", "Text scale", "Scale all player-facing text", 0.8, 1.5, 0.05),
        Choice("contrastMode", "Accessibility", "Contrast", "Select the interface contrast palette", ContrastOptions),
        Toggle("colorSafePatterns", "Accessibility", "Color-safe patterns", "Pair color with patterns and text"),
        Choice("motion.reducedMotion", "Accessibility", "Motion", "Follow system, reduce, or allow full motion", MotionOptions),
        Slider("motion.cameraShake", "Accessibility", "Camera shake", "Scale camera shake intensity", 0, 1),
        Choice("motion.flashIntensity", "Accessibility", "Flash intensity", "Full, reduced, or disabled flashes", EffectOptions),
        Choice("motion.bloom", "Accessibility", "Bloom", "Full, reduced, or disabled bloom", EffectOptions),

        Choice("difficulty", "Gameplay", "Difficulty", "Relaxed, standard, or expert gameplay", [SettingValues.RelaxedDifficulty, SettingValues.StandardDifficulty, SettingValues.ExpertDifficulty]),
        Slider("timerLeniency", "Gameplay", "Timer leniency", "Scale mission time limits", 1, 2, 0.05),
    ]);

    private static SettingControlSpec Slider(string path, string group, string label, string description, double min, double max, double step = 0.05) =>
        new(path, group, label, description, SettingControlKinds.Slider, min, max, step);

    private static SettingControlSpec Toggle(string path, string group, string label, string description) =>
        new(path, group, label, description, SettingControlKinds.Toggle);

    private static SettingControlSpec Choice(string path, string group, string label, string description, IReadOnlyList<string> options) =>
        new(path, group, label, description, SettingControlKinds.Choice, Options: options);
}
