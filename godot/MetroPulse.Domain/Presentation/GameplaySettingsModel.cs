using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Presentation;

public static class CameraSensitivityTargets
{
    public const string Orbit = "ORBIT";
    public const string OnFoot = "ON_FOOT";
    public const string Vehicle = "VEHICLE";
}

public sealed record VehicleAssistPolicy(
    bool AssistedSteering,
    bool AutomaticRecovery,
    double BrakeForceScale);

public sealed record GameplayPreferenceProjection(
    string Difficulty,
    bool ColorSafePatterns,
    bool SubtitlesEnabled,
    bool SpeakerLabelsEnabled,
    bool ClosedCaptionsEnabled,
    bool RepeatActionsToggleEnabled,
    double TimerLeniency);

/// <summary>Pure interpretation of preferences shared by live Godot consumers.</summary>
public static class GameplaySettingsModel
{
    public static double PointerSensitivity(SettingsPreferences settings, string target)
    {
        ArgumentNullException.ThrowIfNull(settings);
        double camera = target switch
        {
            CameraSensitivityTargets.Orbit => settings.CameraSensitivity.Orbit,
            CameraSensitivityTargets.OnFoot => settings.CameraSensitivity.OnFoot,
            CameraSensitivityTargets.Vehicle => settings.CameraSensitivity.Vehicle,
            _ => throw new ArgumentOutOfRangeException(nameof(target), target, "Unknown camera sensitivity target."),
        };
        return Math.Clamp(settings.MouseSensitivity * camera, 0.04, 9);
    }

    public static VehicleAssistPolicy VehicleAssists(SettingsPreferences settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new(
            settings.DrivingAssists.Steering == SettingValues.AssistedSteering,
            settings.DrivingAssists.AutoRecovery,
            settings.DrivingAssists.BrakingAssist ? 1.25 : 1);
    }

    public static double ApplySteering(double input, VehicleAssistPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        double normalized = Math.Clamp(double.IsFinite(input) ? input : 0, -1, 1);
        if (!policy.AssistedSteering) return normalized;
        return Math.CopySign(Math.Pow(Math.Abs(normalized), 1.35), normalized);
    }

    public static GameplayPreferenceProjection Project(SettingsPreferences settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new(
            settings.Difficulty,
            settings.ColorSafePatterns,
            settings.Subtitles.Enabled,
            settings.Subtitles.SpeakerLabels,
            settings.Subtitles.ClosedCaptions,
            settings.ToggleHold.RepeatedActions == SettingValues.Toggle,
            settings.TimerLeniency);
    }
}

/// <summary>Edge-triggered hold/toggle adapter used for keyboard and controller actions.</summary>
public sealed class HoldToggleActionModel
{
    private bool previousHeld;

    public bool Toggled { get; private set; }

    public bool Resolve(bool held, string mode)
    {
        if (mode == SettingValues.Toggle)
        {
            if (held && !previousHeld) Toggled = !Toggled;
            previousHeld = held;
            return Toggled;
        }
        if (mode != SettingValues.Hold)
            throw new ArgumentOutOfRangeException(nameof(mode), mode, "Unknown hold/toggle mode.");
        previousHeld = held;
        Toggled = false;
        return held;
    }

    public void Reset()
    {
        previousHeld = false;
        Toggled = false;
    }
}
