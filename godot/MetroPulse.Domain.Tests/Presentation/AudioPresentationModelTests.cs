using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class AudioPresentationModelTests
{
    [Fact]
    public void RequiredBusTreeAndSettingsMappingAreComplete()
    {
        Assert.Equal(AudioBusIds.All, AudioPresentationModel.Buses.Select(bus => bus.Id));
        Assert.Equal(AudioBusIds.Effects, AudioPresentationModel.Buses.Single(bus => bus.Id == AudioBusIds.Vehicle).Parent);
        Assert.Equal(AudioBusIds.Effects, AudioPresentationModel.Buses.Single(bus => bus.Id == AudioBusIds.Emergency).Parent);
        Assert.Equal(AudioBusIds.Effects, AudioPresentationModel.Buses.Single(bus => bus.Id == AudioBusIds.UI).Parent);
        Assert.Equal(0.5, AudioPresentationModel.SettingVolume(SettingsValidator.DefaultSettings, AudioPresentationModel.Buses[0]));
    }

    [Fact]
    public void ZeroMutesWithoutDestroyingLastAudibleGainAndRestoreIsExact()
    {
        AudioGainState audible = AudioPresentationModel.ResolveGain(0.25);
        AudioGainState muted = AudioPresentationModel.ResolveGain(0, audible);
        AudioGainState restored = AudioPresentationModel.ResolveGain(0.25, muted);

        Assert.Equal(-12.041, audible.Decibels, 3);
        Assert.True(muted.Muted);
        Assert.Equal(audible.Decibels, muted.LastAudibleDecibels);
        Assert.False(restored.Muted);
        Assert.Equal(audible.Decibels, restored.Decibels, 6);
    }

    [Fact]
    public void VoiceAllocationPrioritizesEmergencyAndNearestSourcesWithinCaps()
    {
        AudioVoiceRequest[] requests = [
            new("far-horn", "horn", AudioBusIds.Vehicle, 50, 90),
            new("near-horn", "horn", AudioBusIds.Vehicle, 50, 5),
            new("siren", "police-siren", AudioBusIds.Emergency, 90, 40),
            new("ui", "ui-confirm", AudioBusIds.UI, 100, 0),
        ];
        IReadOnlyList<AudioVoiceRequest> voices = AudioPresentationModel.AllocateVoices(
            requests,
            new Dictionary<string, int> { [AudioBusIds.Vehicle] = 1, [AudioBusIds.Emergency] = 1, [AudioBusIds.UI] = 1 },
            totalCap: 3);

        Assert.Equal(["ui", "siren", "near-horn"], voices.Select(voice => voice.Id));
        Assert.DoesNotContain(voices, voice => voice.Id == "far-horn");
        Assert.All(AudioPresentationModel.Sounds, sound => Assert.False(string.IsNullOrWhiteSpace(sound.Caption)));
    }

    [Fact]
    public void VehicleEnginePitchAndGainFollowBoundedSpeedRatio()
    {
        VehicleEngineAudioProfile idle = AudioPresentationModel.VehicleEngine(0, 40, false);
        VehicleEngineAudioProfile fast = AudioPresentationModel.VehicleEngine(80, 40, true);

        Assert.Equal(0, idle.SpeedRatio);
        Assert.Equal(0.68, idle.PitchScale, 6);
        Assert.Equal(1, fast.SpeedRatio);
        Assert.Equal(1.8, fast.PitchScale, 6);
        Assert.True(fast.Gain > idle.Gain);
    }
}
