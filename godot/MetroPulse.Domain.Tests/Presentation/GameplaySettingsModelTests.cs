using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class GameplaySettingsModelTests
{
    [Fact]
    public void IndependentCameraSensitivityMultipliesPointerPreference()
    {
        SettingsPreferences settings = SettingsValidator.DefaultSettings with
        {
            MouseSensitivity = 1.5,
            CameraSensitivity = new CameraSensitivitySettings(0.5, 1.25, 2),
        };

        Assert.Equal(0.75, GameplaySettingsModel.PointerSensitivity(settings, CameraSensitivityTargets.Orbit));
        Assert.Equal(1.875, GameplaySettingsModel.PointerSensitivity(settings, CameraSensitivityTargets.OnFoot));
        Assert.Equal(3, GameplaySettingsModel.PointerSensitivity(settings, CameraSensitivityTargets.Vehicle));
    }

    [Fact]
    public void ToggleActionsChangeOnlyOnPressEdgesAndResetForHold()
    {
        var action = new HoldToggleActionModel();

        Assert.True(action.Resolve(true, SettingValues.Toggle));
        Assert.True(action.Resolve(true, SettingValues.Toggle));
        Assert.True(action.Resolve(false, SettingValues.Toggle));
        Assert.False(action.Resolve(true, SettingValues.Toggle));
        Assert.False(action.Resolve(false, SettingValues.Hold));
        Assert.True(action.Resolve(true, SettingValues.Hold));
        action.Reset();
        Assert.False(action.Toggled);
    }

    [Fact]
    public void DrivingAssistsAndGameplayProjectionPreserveEveryLivePreference()
    {
        SettingsPreferences settings = SettingsValidator.DefaultSettings with
        {
            DrivingAssists = new DrivingAssistSettings(SettingValues.AssistedSteering, false, true),
            ToggleHold = SettingsValidator.DefaultSettings.ToggleHold with { RepeatedActions = SettingValues.Toggle },
            Subtitles = new SubtitleSettings(false, false, true),
            ColorSafePatterns = false,
            Difficulty = SettingValues.ExpertDifficulty,
            TimerLeniency = 1.5,
        };
        VehicleAssistPolicy assists = GameplaySettingsModel.VehicleAssists(settings);
        GameplayPreferenceProjection projection = GameplaySettingsModel.Project(settings);

        Assert.True(assists.AssistedSteering);
        Assert.False(assists.AutomaticRecovery);
        Assert.Equal(1.25, assists.BrakeForceScale);
        Assert.InRange(GameplaySettingsModel.ApplySteering(0.5, assists), 0.39, 0.4);
        Assert.Equal(SettingValues.ExpertDifficulty, projection.Difficulty);
        Assert.False(projection.ColorSafePatterns);
        Assert.False(projection.SubtitlesEnabled);
        Assert.False(projection.SpeakerLabelsEnabled);
        Assert.True(projection.ClosedCaptionsEnabled);
        Assert.True(projection.RepeatActionsToggleEnabled);
        Assert.Equal(1.5, projection.TimerLeniency);
    }
}
