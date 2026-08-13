using Godot;
using MetroPulse.Domain.Presentation;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Domain.Traffic;
using MetroPulse.Godot.Audio;
using MetroPulse.Godot.Camera;
using MetroPulse.Godot.Player;
using MetroPulse.Godot.Traffic;
using MetroPulse.Godot.World;

namespace MetroPulse.Godot.Effects;

/// <summary>Fixed-budget presentation effects. It never owns collision, roads, or economy state.</summary>
public partial class SessionEffectRuntime : Node3D
{
    private readonly Dictionary<string, EffectPoolModel> models = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EffectPoolSpec> effectiveSpecs = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<PooledWorldEffect>> pools = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> impactCounts = new(StringComparer.Ordinal);
    private readonly HashSet<string> fireSources = new(StringComparer.Ordinal);
    private SettingsStore settings = null!;
    private PlayerControlRuntime player = null!;
    private LivingTrafficRuntime traffic = null!;
    private WorldEnvironmentController environment = null!;
    private GameplayCameraRig camera = null!;
    private SessionAudioRuntime audio = null!;
    private Func<bool>? unsubscribeSettings;
    private Func<bool>? unsubscribeEnvironment;
    private EnvironmentPresentationSnapshot? environmentState;
    private double elapsed;
    private double nextLightning = 6;
    private double lightningClearAt = double.PositiveInfinity;
    private double nextComet = 15;
    private int cometSequence;

    public bool Initialized { get; private set; }

    public int PoolNodeCount => pools.Values.Sum(pool => pool.Count);

    public int ActiveCount => pools.Values.Sum(pool => pool.Count(effect => effect.Active));

    public int SpawnCount { get; private set; }

    public int CleanupCount { get; private set; }

    public double LastLightningFlash { get; private set; }

    public EffectAccessibilityPolicy CurrentPolicy { get; private set; } = new(1, 1, true, true);

    public bool RainEmitterReused => environment.GetNodeOrNull<GpuParticles3D>("Rain") is not null;

    public IReadOnlyDictionary<string, int> ActiveCounts => pools.ToDictionary(
        pair => pair.Key,
        pair => pair.Value.Count(effect => effect.Active),
        StringComparer.Ordinal);

    public void Initialize(
        SettingsStore settingsAuthority,
        PlayerControlRuntime playerOwner,
        LivingTrafficRuntime trafficOwner,
        WorldEnvironmentController environmentOwner,
        GameplayCameraRig cameraOwner,
        SessionAudioRuntime audioOwner,
        QualityProfilePolicy? qualityProfile = null)
    {
        if (Initialized) throw new InvalidOperationException("Session effects are already initialized.");
        settings = settingsAuthority ?? throw new ArgumentNullException(nameof(settingsAuthority));
        player = playerOwner ?? throw new ArgumentNullException(nameof(playerOwner));
        traffic = trafficOwner ?? throw new ArgumentNullException(nameof(trafficOwner));
        environment = environmentOwner ?? throw new ArgumentNullException(nameof(environmentOwner));
        camera = cameraOwner ?? throw new ArgumentNullException(nameof(cameraOwner));
        audio = audioOwner ?? throw new ArgumentNullException(nameof(audioOwner));
        QualityProfilePolicy quality = qualityProfile ?? QualityProfilePolicy.Resolve(QualityProfileIds.High);
        foreach (EffectPoolSpec authoredSpec in EffectPresentationModel.Pools)
        {
            EffectPoolSpec spec = authoredSpec with
            {
                Capacity = Math.Max(1, (int)Math.Ceiling(authoredSpec.Capacity * quality.EffectBudgetScale)),
            };
            effectiveSpecs.Add(spec.Id, spec);
            models.Add(spec.Id, new EffectPoolModel(spec));
            var pool = new List<PooledWorldEffect>(spec.Capacity);
            for (int slot = 0; slot < spec.Capacity; slot++)
            {
                var effect = new PooledWorldEffect();
                AddChild(effect);
                effect.Initialize(spec, slot);
                pool.Add(effect);
            }
            pools.Add(spec.Id, pool);
        }
        foreach (var vehicle in player.Vehicles) impactCounts[vehicle.StableId] = vehicle.ImpactCount;
        unsubscribeSettings = settings.Subscribe(change => CurrentPolicy = EffectPresentationModel.Accessibility(change.Current.Settings), emitCurrent: true);
        unsubscribeEnvironment = environment.SubscribeState(snapshot => environmentState = snapshot, emitCurrent: true);
        ProcessPriority = 25;
        Initialized = true;
        SetProcess(true);
    }

    public override void _Process(double delta)
    {
        if (!Initialized) return;
        double safeDelta = double.IsFinite(delta) ? Math.Clamp(delta, 0, 0.25) : 0;
        elapsed += safeDelta;
        AdvanceVisuals(safeDelta);
        ObserveVehicleImpacts();
        ReconcileTrafficFires();
        AdvanceWeatherEffects();
    }

    public void TriggerExplosion(Vector3 position, string? sourceId = null)
    {
        Spawn(EffectIds.Explosion, position, sourceId);
        audio.PlaySpatial("explosion", position);
        if (CurrentPolicy.ShakeScale > 0) camera.TriggerShake(0.65);
    }

    public void TriggerFire(Vector3 position, string sourceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceId);
        PooledWorldEffect? existing = pools[EffectIds.Fire].FirstOrDefault(effect => effect.Active && effect.SourceId == sourceId);
        if (existing is not null)
        {
            existing.GlobalPosition = position;
            return;
        }
        Spawn(EffectIds.Fire, position, sourceId);
        fireSources.Add(sourceId);
        audio.PlaySpatial("fire", position);
    }

    public void StopFire(string sourceId)
    {
        if (!fireSources.Remove(sourceId)) return;
        _ = models[EffectIds.Fire].ReleaseSource(sourceId);
        foreach (PooledWorldEffect effect in pools[EffectIds.Fire].Where(effect => effect.SourceId == sourceId))
        {
            effect.Deactivate();
            CleanupCount++;
        }
    }

    public void TriggerRubble(Vector3 position, string? sourceId = null)
    {
        Spawn(EffectIds.Rubble, position, sourceId);
        audio.PlaySpatial("rubble", position);
    }

    public void TriggerComet(Vector3 position, string? sourceId = null)
    {
        if (!CurrentPolicy.SpawnComets) return;
        Spawn(EffectIds.Comet, position, sourceId);
        audio.PlaySpatial("comet", position);
    }

    public int ReleaseSourcesWithPrefix(string prefix)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefix);
        int released = 0;
        foreach ((string id, List<PooledWorldEffect> pool) in pools)
        {
            foreach (PooledWorldEffect effect in pool.Where(effect => effect.Active
                && effect.SourceId?.StartsWith(prefix, StringComparison.Ordinal) == true))
            {
                if (effect.SourceId is string sourceId) _ = models[id].ReleaseSource(sourceId);
                fireSources.Remove(effect.SourceId ?? string.Empty);
                effect.Deactivate();
                released++;
                CleanupCount++;
            }
        }
        return released;
    }

    public void TriggerLightning(Vector3? position = null)
    {
        LastLightningFlash = environment.ApplyLightningFlash(1);
        lightningClearAt = elapsed + 0.12;
        audio.PlaySpatial("thunder", position ?? new Vector3(0, 80, 0));
        if (CurrentPolicy.ShakeScale > 0) camera.TriggerShake(0.2);
    }

    public void AdvanceForTest(double delta)
    {
        if (!Initialized || !double.IsFinite(delta) || delta < 0) return;
        elapsed += delta;
        AdvanceVisuals(delta);
    }

    public void Shutdown()
    {
        if (!Initialized) return;
        SetProcess(false);
        _ = unsubscribeEnvironment?.Invoke();
        _ = unsubscribeSettings?.Invoke();
        unsubscribeEnvironment = null;
        unsubscribeSettings = null;
        environment.ClearLightningFlash();
        foreach (PooledWorldEffect effect in pools.Values.SelectMany(pool => pool)) effect.Deactivate();
        models.Clear();
        effectiveSpecs.Clear();
        pools.Clear();
        impactCounts.Clear();
        fireSources.Clear();
        Initialized = false;
    }

    public override void _ExitTree() => Shutdown();

    private void Spawn(string effectId, Vector3 position, string? sourceId = null)
    {
        EffectPoolSpec spec = effectiveSpecs[effectId];
        EffectLease lease = models[effectId].Acquire(elapsed, sourceId);
        pools[effectId][lease.Slot].Activate(position, spec.LifetimeSeconds, lease.Generation, sourceId);
        SpawnCount++;
    }

    private void AdvanceVisuals(double delta)
    {
        foreach ((string id, List<PooledWorldEffect> pool) in pools)
        {
            int expired = 0;
            foreach (PooledWorldEffect effect in pool)
            {
                if (effect.Advance(delta)) expired++;
            }
            _ = models[id].Cleanup(elapsed);
            CleanupCount += expired;
        }
        if (elapsed >= lightningClearAt)
        {
            environment.ClearLightningFlash();
            lightningClearAt = double.PositiveInfinity;
        }
    }

    private void ObserveVehicleImpacts()
    {
        foreach (var vehicle in player.Vehicles)
        {
            int previous = impactCounts.GetValueOrDefault(vehicle.StableId, vehicle.ImpactCount);
            if (vehicle.ImpactCount > previous) TriggerExplosion(vehicle.GlobalPosition, $"impact:{vehicle.StableId}");
            impactCounts[vehicle.StableId] = vehicle.ImpactCount;
        }
        foreach (string stale in impactCounts.Keys.Except(player.Vehicles.Select(vehicle => vehicle.StableId), StringComparer.Ordinal).ToArray()) impactCounts.Remove(stale);
    }

    private void ReconcileTrafficFires()
    {
        TrafficAgentSnapshot[] burning = traffic.Simulation.Snapshot().Moving
            .Where(agent => agent.DamageState == TrafficDamageStates.OnFire)
            .ToArray();
        foreach (TrafficAgentSnapshot agent in burning)
        {
            TriggerFire(new Vector3((float)agent.Position.X, 2.2f, (float)agent.Position.Z), agent.Id);
        }
        foreach (string stale in fireSources.Except(burning.Select(agent => agent.Id), StringComparer.Ordinal).ToArray()) StopFire(stale);
    }

    private void AdvanceWeatherEffects()
    {
        if (environmentState?.WeatherMode == "thunderstorm" && elapsed >= nextLightning)
        {
            TriggerLightning();
            nextLightning = elapsed + 6;
        }
        if (environmentState is { NightFactor: > 0.7 } && CurrentPolicy.SpawnComets && elapsed >= nextComet)
        {
            float offset = (cometSequence++ % 4) * 24 - 36;
            TriggerComet(new Vector3(offset, 115 + offset * 0.2f, 90));
            nextComet = elapsed + 15;
        }
    }
}
