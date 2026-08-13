using MetroPulse.Domain.Settings;

namespace MetroPulse.Domain.Presentation;

public static class AudioBusIds
{
    public const string Master = "Master";
    public const string Music = "Music";
    public const string Effects = "Effects";
    public const string Ambience = "Ambience";
    public const string Dialogue = "Dialogue";
    public const string Vehicle = "Vehicle";
    public const string Emergency = "Emergency";
    public const string UI = "UI";

    public static readonly IReadOnlyList<string> All = Array.AsReadOnly([
        Master,
        Music,
        Effects,
        Ambience,
        Dialogue,
        Vehicle,
        Emergency,
        UI,
    ]);
}

public sealed record AudioBusSpec(string Id, string? Parent, string? SettingPath);

public sealed record AudioGainState(double Linear, double Decibels, bool Muted, double LastAudibleDecibels);

public sealed record ProceduralSoundSpec(
    string Id,
    string Bus,
    double Frequency,
    double DurationSeconds,
    double Gain,
    bool Loop,
    bool Spatial,
    int Priority,
    int VoiceCap,
    string Caption);

public sealed record AudioVoiceRequest(string Id, string SoundId, string Bus, int Priority, double Distance, bool Loop = false);

public sealed record VehicleEngineAudioProfile(double SpeedRatio, double PitchScale, double Gain);

public static class AudioPresentationModel
{
    public const double SilenceDecibels = -80;
    public const int TotalVoiceCap = 64;

    public static readonly IReadOnlyList<AudioBusSpec> Buses = Array.AsReadOnly<AudioBusSpec>([
        new(AudioBusIds.Master, null, "audio.master"),
        new(AudioBusIds.Music, AudioBusIds.Master, "audio.music"),
        new(AudioBusIds.Effects, AudioBusIds.Master, "audio.effects"),
        new(AudioBusIds.Ambience, AudioBusIds.Master, "audio.ambience"),
        new(AudioBusIds.Dialogue, AudioBusIds.Master, "audio.dialogue"),
        new(AudioBusIds.Vehicle, AudioBusIds.Effects, null),
        new(AudioBusIds.Emergency, AudioBusIds.Effects, null),
        new(AudioBusIds.UI, AudioBusIds.Effects, null),
    ]);

    public static readonly IReadOnlyList<ProceduralSoundSpec> Sounds = Array.AsReadOnly<ProceduralSoundSpec>([
        new("music-city", AudioBusIds.Music, 110, 4, 0.08, true, false, 10, 1, "[city music]"),
        new("city-ambience", AudioBusIds.Ambience, 54, 3, 0.05, true, false, 10, 1, "[city ambience]"),
        new("rain", AudioBusIds.Ambience, 180, 2, 0.035, true, false, 15, 1, "[rain falling]"),
        new("vehicle-engine", AudioBusIds.Vehicle, 68, 2, 0.09, true, true, 30, 48, "[engine revving]"),
        new("aircraft-propeller", AudioBusIds.Vehicle, 82, 2, 0.08, true, true, 35, 1, "[propeller engine running]"),
        new("vehicle-impact", AudioBusIds.Vehicle, 46, 0.35, 0.18, false, true, 80, 8, "[vehicle impact]"),
        new("horn", AudioBusIds.Vehicle, 360, 0.25, 0.12, false, true, 55, 12, "[vehicle horn]"),
        new("police-siren", AudioBusIds.Emergency, 720, 1.2, 0.09, true, true, 90, 8, "[police siren approaching]"),
        new("thunder", AudioBusIds.Emergency, 38, 0.8, 0.2, false, true, 85, 4, "[thunder]"),
        new("explosion", AudioBusIds.Effects, 42, 0.65, 0.22, false, true, 95, 8, "[explosion]"),
        new("fire", AudioBusIds.Effects, 92, 1.5, 0.08, false, true, 50, 8, "[fire crackling]"),
        new("rubble", AudioBusIds.Effects, 58, 0.5, 0.13, false, true, 60, 8, "[rubble falling]"),
        new("comet", AudioBusIds.Ambience, 240, 1.1, 0.07, false, true, 40, 4, "[comet streaks overhead]"),
        new("ui-confirm", AudioBusIds.UI, 620, 0.12, 0.08, false, false, 100, 4, "[confirmation tone]"),
    ]);

    public static AudioGainState ResolveGain(double linear, AudioGainState? previous = null)
    {
        double normalized = double.IsFinite(linear) ? Math.Clamp(linear, 0, 1) : 1;
        if (normalized <= 0)
        {
            double last = previous is { Muted: false } ? previous.Decibels : previous?.LastAudibleDecibels ?? 0;
            return new(0, last, true, last);
        }
        double decibels = Math.Max(SilenceDecibels, 20 * Math.Log10(normalized));
        return new(normalized, decibels, false, decibels);
    }

    public static IReadOnlyList<AudioVoiceRequest> AllocateVoices(
        IEnumerable<AudioVoiceRequest> requests,
        IReadOnlyDictionary<string, int>? busCaps = null,
        int totalCap = TotalVoiceCap)
    {
        ArgumentNullException.ThrowIfNull(requests);
        busCaps ??= Sounds.GroupBy(sound => sound.Bus, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Sum(sound => sound.VoiceCap), StringComparer.Ordinal);
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        AudioVoiceRequest[] selected = requests
            .OrderByDescending(request => request.Priority)
            .ThenBy(request => request.Distance)
            .ThenBy(request => request.Id, StringComparer.Ordinal)
            .Where(request =>
            {
                int count = counts.GetValueOrDefault(request.Bus);
                if (count >= busCaps.GetValueOrDefault(request.Bus, totalCap)) return false;
                counts[request.Bus] = count + 1;
                return true;
            })
            .Take(Math.Max(0, totalCap))
            .ToArray();
        return Array.AsReadOnly(selected);
    }

    public static double SettingVolume(SettingsPreferences settings, AudioBusSpec bus) => bus.SettingPath switch
    {
        "audio.master" => settings.Audio.Master,
        "audio.music" => settings.Audio.Music,
        "audio.effects" => settings.Audio.Effects,
        "audio.ambience" => settings.Audio.Ambience,
        "audio.dialogue" => settings.Audio.Dialogue,
        _ => 1,
    };

    public static VehicleEngineAudioProfile VehicleEngine(double speedMetresPerSecond, double maximumSpeed, bool controlled)
    {
        double speed = double.IsFinite(speedMetresPerSecond) ? Math.Abs(speedMetresPerSecond) : 0;
        double maximum = double.IsFinite(maximumSpeed) && maximumSpeed > 0 ? maximumSpeed : 1;
        double ratio = Math.Clamp(speed / maximum, 0, 1);
        return new(ratio, 0.68 + ratio * 1.12, (controlled ? 0.12 : 0.065) + ratio * 0.08);
    }
}
