using Godot;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.UI;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Audio;

/// <summary>Session-owned bus layout, procedural cache, ambience, settings, and caption adapter.</summary>
public partial class SessionAudioRuntime : Node
{
    private readonly Dictionary<string, AudioGainState> gains = new(StringComparer.Ordinal);
    private readonly List<string> addedBuses = [];
    private readonly Dictionary<string, int> hornCounts = new(StringComparer.Ordinal);
    private readonly HashSet<string> activeSirens = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> impactCounts = new(StringComparer.Ordinal);
    private readonly List<AudioStreamPlayer3D> spatialVoices = [];
    private SettingsStore settings = null!;
    private PlayerInterface playerInterface = null!;
    private LivingTrafficRuntime? traffic;
    private PlayerControlRuntime? player;
    private WorldEnvironmentController? environment;
    private Func<bool>? unsubscribeSettings;
    private Func<bool>? unsubscribeEnvironment;
    private AudioStreamPlayer music = null!;
    private AudioStreamPlayer ambience = null!;
    private AudioStreamPlayer rain = null!;
    private AudioStreamPlayer ui = null!;
    private bool captionsEnabled;
    private string lastWeatherMode = string.Empty;
    private int nextSpatialVoice;
    private double observationRemaining;

    public bool Initialized { get; private set; }

    public int InitialBusCount { get; private set; }

    public int CaptionCount { get; private set; }

    public string LastCaption { get; private set; } = string.Empty;

    public int CachedStreamCount => ProceduralAudioStreamCache.Count;

    public int SpatialVoiceCount => spatialVoices.Count;

    public int ActiveVoiceCount => spatialVoices.Count(voice => voice.Playing)
        + (music?.Playing == true ? 1 : 0)
        + (ambience?.Playing == true ? 1 : 0)
        + (rain?.Playing == true ? 1 : 0)
        + (ui?.Playing == true ? 1 : 0);

    public IReadOnlyDictionary<string, AudioGainState> Gains => gains;

    public void Initialize(SettingsStore settingsAuthority, PlayerInterface interfaceOwner)
        => Initialize(settingsAuthority, interfaceOwner, QualityProfilePolicy.Resolve(QualityProfileIds.High));

    public void Initialize(
        SettingsStore settingsAuthority,
        PlayerInterface interfaceOwner,
        QualityProfilePolicy quality)
    {
        if (Initialized) throw new InvalidOperationException("Session audio is already initialized.");
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        playerInterface = interfaceOwner ?? throw new ArgumentNullException(nameof(interfaceOwner));
        InitialBusCount = AudioServer.BusCount;
        EnsureBuses();
        music = GlobalPlayer("Music", "music-city", AudioBusIds.Music);
        ambience = GlobalPlayer("CityAmbience", "city-ambience", AudioBusIds.Ambience);
        rain = GlobalPlayer("Rain", "rain", AudioBusIds.Ambience, play: false);
        ui = GlobalPlayer("UiOneShot", "ui-confirm", AudioBusIds.UI, play: false);
        ArgumentNullException.ThrowIfNull(quality);
        for (int index = 0; index < quality.SpatialAudioVoices; index++)
        {
            var voice = new AudioStreamPlayer3D
            {
                Name = $"SpatialVoice{index:00}",
                MaxDistance = 520,
                UnitSize = 24,
            };
            AddChild(voice);
            spatialVoices.Add(voice);
        }
        unsubscribeSettings = settings.Subscribe(change => ApplySettings(change.Current.Settings), emitCurrent: true);
        Initialized = true;
        SetProcess(true);
    }

    public void AttachSources(
        LivingTrafficRuntime trafficOwner,
        PlayerControlRuntime playerOwner,
        WorldEnvironmentController environmentOwner)
    {
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        player = playerOwner ?? throw new ArgumentNullException(nameof(playerOwner));
        environment = environmentOwner ?? throw new ArgumentNullException(nameof(environmentOwner));
        unsubscribeEnvironment = environment.SubscribeState(ApplyEnvironment, emitCurrent: true);
    }

    public override void _Process(double delta)
    {
        _ = delta;
        if (!Initialized || traffic is null) return;
        observationRemaining -= Math.Max(0, delta);
        if (observationRemaining > 0) return;
        observationRemaining = 0.1;
        TrafficPopulationSnapshot snapshot = traffic.CurrentSnapshot;
        foreach (TrafficAgentSnapshot agent in snapshot.Moving)
        {
            int previous = hornCounts.GetValueOrDefault(agent.Id);
            if (agent.HornCount > previous) PublishCaption("[vehicle horn]");
            hornCounts[agent.Id] = agent.HornCount;
            if (agent.SirenActive && activeSirens.Add(agent.Id)) PublishCaption("[police siren approaching]");
            if (!agent.SirenActive) activeSirens.Remove(agent.Id);
        }
        foreach (string stale in hornCounts.Keys.Except(snapshot.Moving.Select(agent => agent.Id), StringComparer.Ordinal).ToArray()) hornCounts.Remove(stale);
        if (player is not null)
        {
            foreach (var vehicle in player.Vehicles)
            {
                int previous = impactCounts.GetValueOrDefault(vehicle.StableId);
                if (vehicle.ImpactCount > previous) PublishCaption("[vehicle impact]");
                impactCounts[vehicle.StableId] = vehicle.ImpactCount;
            }
            foreach (string stale in impactCounts.Keys.Except(player.Vehicles.Select(vehicle => vehicle.StableId), StringComparer.Ordinal).ToArray()) impactCounts.Remove(stale);
        }
    }

    public void PlayUiConfirm(bool caption = false)
    {
        ui.Play();
        if (caption) PublishCaption("[confirmation tone]");
    }

    public void PlaySpatial(string soundId, Vector3 position, bool caption = true)
    {
        if (!Initialized || spatialVoices.Count == 0) return;
        ProceduralSoundSpec spec = AudioPresentationModel.Sounds.SingleOrDefault(sound => sound.Id == soundId)
            ?? throw new ArgumentOutOfRangeException(nameof(soundId), soundId, "Unknown spatial procedural sound.");
        AudioStreamPlayer3D voice = spatialVoices.FirstOrDefault(candidate => !candidate.Playing)
            ?? spatialVoices[nextSpatialVoice++ % spatialVoices.Count];
        voice.Stop();
        voice.Stream = ProceduralAudioStreamCache.Get(soundId);
        voice.Bus = spec.Bus;
        voice.GlobalPosition = position;
        voice.Play();
        if (caption) PublishCaption(spec.Caption);
    }

    public void PublishCaption(string caption)
    {
        if (!captionsEnabled || string.IsNullOrWhiteSpace(caption)) return;
        LastCaption = caption;
        CaptionCount++;
        playerInterface.Announce(caption);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetProcess(false);
        _ = unsubscribeEnvironment?.Invoke();
        unsubscribeEnvironment = null;
        _ = unsubscribeSettings?.Invoke();
        unsubscribeSettings = null;
        music.Stop();
        ambience.Stop();
        rain.Stop();
        ui.Stop();
        foreach (AudioStreamPlayer3D voice in spatialVoices) voice.Stop();
        foreach (string bus in addedBuses.AsEnumerable().Reverse())
        {
            int index = AudioServer.GetBusIndex(bus);
            if (index >= 0) AudioServer.RemoveBus(index);
        }
        addedBuses.Clear();
        gains.Clear();
        traffic = null;
        player = null;
        environment = null;
        spatialVoices.Clear();
        lastWeatherMode = string.Empty;
        nextSpatialVoice = 0;
        observationRemaining = 0;
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void EnsureBuses()
    {
        foreach (AudioBusSpec bus in AudioPresentationModel.Buses.Skip(1))
        {
            if (AudioServer.GetBusIndex(bus.Id) < 0)
            {
                AudioServer.AddBus();
                int added = AudioServer.BusCount - 1;
                AudioServer.SetBusName(added, bus.Id);
                addedBuses.Add(bus.Id);
            }
            int index = AudioServer.GetBusIndex(bus.Id);
            AudioServer.SetBusSend(index, bus.Parent ?? AudioBusIds.Master);
        }
    }

    private void ApplySettings(SettingsPreferences preferences)
    {
        captionsEnabled = preferences.Subtitles.Enabled && preferences.Subtitles.ClosedCaptions;
        foreach (AudioBusSpec bus in AudioPresentationModel.Buses)
        {
            int index = AudioServer.GetBusIndex(bus.Id);
            if (index < 0) continue;
            AudioGainState gain = AudioPresentationModel.ResolveGain(
                AudioPresentationModel.SettingVolume(preferences, bus),
                gains.GetValueOrDefault(bus.Id));
            gains[bus.Id] = gain;
            AudioServer.SetBusVolumeDb(index, (float)gain.Decibels);
            AudioServer.SetBusMute(index, gain.Muted);
        }
    }

    private void ApplyEnvironment(EnvironmentPresentationSnapshot snapshot)
    {
        bool wet = snapshot.WeatherMode is "rain" or "storm" or "thunderstorm";
        if (wet && !rain.Playing) rain.Play();
        if (!wet && rain.Playing) rain.Stop();
        if (snapshot.WeatherMode == "thunderstorm" && lastWeatherMode != "thunderstorm") PublishCaption("[thunder]");
        lastWeatherMode = snapshot.WeatherMode;
    }

    private AudioStreamPlayer GlobalPlayer(string name, string soundId, string bus, bool play = true)
    {
        var result = new AudioStreamPlayer
        {
            Name = name,
            Stream = ProceduralAudioStreamCache.Get(soundId),
            Bus = bus,
        };
        AddChild(result);
        if (play) result.Play();
        return result;
    }
}
