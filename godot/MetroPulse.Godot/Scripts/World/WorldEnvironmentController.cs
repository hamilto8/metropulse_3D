using Godot;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Settings;
using MetroPulse.Domain.TimeWeather;
using MetroPulse.Domain.World;

namespace MetroPulse.Godot.World;

public partial class WorldEnvironmentController : Node3D
{
    private static readonly string[] WetMaterialIds = ["ground", "road", "bridge-deck", "bridge-sidewalk", "sidewalk"];
    private EnvironmentPresentationModel? model;
    private GameContentRegistry? content;
    private WorldResourceCache? resources;
    private IReadOnlyDictionary<string, WorldMaterialDefinition>? materialDefinitions;
    private global::Godot.Environment? environment;
    private ProceduralSkyMaterial? skyMaterial;
    private DirectionalLight3D? sunLight;
    private DirectionalLight3D? moonLight;
    private MeshInstance3D? sunBody;
    private MeshInstance3D? moonBody;
    private GpuParticles3D? rain;
    private Func<bool>? unsubscribeSettings;
    private SettingsPreferences? preferences;

    public bool Initialized { get; private set; }

    public EnvironmentPresentationSnapshot? Current { get; private set; }

    public string QualityProfile { get; private set; } = "HIGH";

    public double FlashScale { get; private set; } = 1;

    public double CameraShakeScale { get; private set; } = 1;

    public bool BloomEnabled => environment?.GlowEnabled == true;

    public void Initialize(GameContentRegistry registry, SettingsStore settings, MvpWorldGenerator world)
    {
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(world);
        if (Initialized)
        {
            throw new InvalidOperationException("World environment is already initialized.");
        }
        content = registry;
        resources = world.Resources;
        materialDefinitions = world.Layout?.Materials
            ?? throw new InvalidOperationException("The authored world must be built before environment initialization.");
        model = new EnvironmentPresentationModel(registry.WeatherRecords, registry.DefaultWeatherMode);
        BuildEnvironmentNodes();
        ApplyPreferences(settings.GetSettings());
        unsubscribeSettings = settings.Subscribe(change => ApplyPreferences(change.Current.Settings));
        SetState(12, registry.DefaultWeatherMode, 320);
        Initialized = true;
    }

    public EnvironmentPresentationSnapshot SetState(double time, string? weatherMode, double cameraHeight = 0)
    {
        EnvironmentPresentationModel presentation = model ?? throw new InvalidOperationException("World environment is not initialized.");
        Current = presentation.Evaluate(time, weatherMode, cameraHeight);
        Apply(Current);
        return Current;
    }

    public void SetQualityProfile(string? profile)
    {
        QualityProfile = profile is "LOW" or "MEDIUM" ? profile : "HIGH";
        if (sunLight is not null)
        {
            sunLight.ShadowEnabled = QualityProfile != "LOW";
            sunLight.DirectionalShadowMaxDistance = QualityProfile == "HIGH" ? 500 : 260;
        }
        if (environment is not null)
        {
            environment.VolumetricFogEnabled = QualityProfile == "HIGH";
        }
        ApplyPreferences(preferences);
    }

    public double ApplyLightningFlash(double intensity)
    {
        double applied = Math.Clamp(double.IsFinite(intensity) ? intensity : 0, 0, 1) * FlashScale;
        if (environment is not null && Current is not null)
        {
            environment.AdjustmentEnabled = applied > 0;
            environment.AdjustmentBrightness = (float)(1 + (applied * 0.55));
        }
        return applied;
    }

    public void ClearLightningFlash()
    {
        if (environment is not null)
        {
            environment.AdjustmentEnabled = false;
            environment.AdjustmentBrightness = 1;
        }
    }

    public void Shutdown()
    {
        unsubscribeSettings?.Invoke();
        unsubscribeSettings = null;
        Initialized = false;
    }

    public override void _ExitTree()
    {
        Shutdown();
    }

    private void BuildEnvironmentNodes()
    {
        skyMaterial = new ProceduralSkyMaterial();
        Sky sky = new() { SkyMaterial = skyMaterial };
        environment = new global::Godot.Environment
        {
            BackgroundMode = global::Godot.Environment.BGMode.Sky,
            Sky = sky,
            AmbientLightSource = global::Godot.Environment.AmbientSource.Color,
            TonemapMode = global::Godot.Environment.ToneMapper.Filmic,
            FogEnabled = true,
            GlowEnabled = true,
        };
        global::Godot.WorldEnvironment worldEnvironment = new()
        {
            Name = "WorldEnvironment",
            Environment = environment,
        };
        AddChild(worldEnvironment);

        sunLight = new DirectionalLight3D { Name = "SunLight", ShadowEnabled = true };
        moonLight = new DirectionalLight3D { Name = "MoonLight", ShadowEnabled = false };
        AddChild(sunLight);
        AddChild(moonLight);

        WorldResourceCache cache = resources!;
        sunBody = new MeshInstance3D
        {
            Name = "Sun",
            Mesh = cache.GetMesh(WorldPrimitiveKind.Sphere, new WorldVector3(220, 220, 220)),
            MaterialOverride = cache.GetMaterial(new("sun", 0xfff2c2, 0.05, 0, 0xffbb22, 3.5)),
        };
        moonBody = new MeshInstance3D
        {
            Name = "Moon",
            Mesh = cache.GetMesh(WorldPrimitiveKind.Sphere, new WorldVector3(136, 136, 136)),
            MaterialOverride = cache.GetMaterial(new("moon", 0xffffdd, 0.9, 0, 0xffeedd, 0.9)),
        };
        AddChild(sunBody);
        AddChild(moonBody);

        var rainMaterial = new ParticleProcessMaterial
        {
            Direction = Vector3.Down,
            InitialVelocityMin = 28,
            InitialVelocityMax = 42,
            Gravity = new Vector3(0, -8, 0),
            EmissionShape = ParticleProcessMaterial.EmissionShapeEnum.Box,
            EmissionBoxExtents = new Vector3(180, 60, 180),
        };
        rain = new GpuParticles3D
        {
            Name = "Rain",
            Amount = 2_000,
            Lifetime = 3,
            ProcessMaterial = rainMaterial,
            DrawPass1 = new QuadMesh { Size = new Vector2(0.08f, 1.4f) },
            Emitting = false,
            VisibilityAabb = new Aabb(new Vector3(-200, -80, -200), new Vector3(400, 160, 400)),
        };
        AddChild(rain);
    }

    private void Apply(EnvironmentPresentationSnapshot snapshot)
    {
        if (environment is null || skyMaterial is null || sunLight is null || moonLight is null
            || sunBody is null || moonBody is null || rain is null || content is null || resources is null
            || materialDefinitions is null)
        {
            throw new InvalidOperationException("World environment nodes are incomplete.");
        }
        skyMaterial.SkyTopColor = ToColor(snapshot.SkyTop);
        skyMaterial.SkyHorizonColor = ToColor(snapshot.SkyHorizon);
        skyMaterial.GroundHorizonColor = ToColor(snapshot.SkyHorizon);
        skyMaterial.GroundBottomColor = ToColor(PresentationColor.Lerp(snapshot.SkyTop, PresentationColor.FromRgb(0x05070f), 0.7));
        environment.AmbientLightColor = ToColor(snapshot.SkyHorizon);
        environment.AmbientLightEnergy = (float)snapshot.AmbientEnergy;
        environment.FogDensity = (float)snapshot.FogDensity;
        environment.TonemapExposure = (float)snapshot.Exposure;
        environment.GlowIntensity = (float)snapshot.BloomStrength;
        environment.GlowHdrThreshold = (float)snapshot.BloomThreshold;
        sunLight.LightEnergy = (float)snapshot.SunEnergy;
        moonLight.LightEnergy = (float)snapshot.MoonEnergy;
        sunLight.LightColor = new Color(1, 0.86f, 0.66f);
        moonLight.LightColor = new Color(0.55f, 0.67f, 1);
        sunBody.Position = ToVector(snapshot.SunPosition);
        moonBody.Position = ToVector(snapshot.MoonPosition);
        sunBody.Visible = snapshot.SunVisible;
        moonBody.Visible = snapshot.MoonVisible;
        sunLight.Rotation = DirectionRotation(snapshot.SunPosition);
        moonLight.Rotation = DirectionRotation(snapshot.MoonPosition);
        rain.Emitting = snapshot.RainOpacity > 0;
        rain.AmountRatio = (float)snapshot.RainOpacity;

        foreach (string materialId in WetMaterialIds)
        {
            if (!resources.TryGetMaterial(materialId, out StandardMaterial3D? material) || material is null
                || !materialDefinitions.TryGetValue(materialId, out WorldMaterialDefinition? definition))
            {
                continue;
            }
            material.Roughness = (float)Lerp(definition.Roughness, 0.2, snapshot.Wetness);
            material.Metallic = (float)Lerp(definition.Metallic, Math.Max(definition.Metallic, 0.48), snapshot.Wetness);
        }
        if (resources.TryGetMaterial("window", out StandardMaterial3D? windows) && windows is not null)
        {
            windows.EmissionEnergyMultiplier = (float)Lerp(0.14, 0.54, snapshot.NightFactor);
        }
        if (resources.TryGetMaterial("lamp-bulb", out StandardMaterial3D? lamps) && lamps is not null)
        {
            lamps.EmissionEnergyMultiplier = (float)Lerp(0.1, 2.2, snapshot.NightFactor);
        }

    }

    private void ApplyPreferences(SettingsPreferences? next)
    {
        if (next is null || environment is null)
        {
            return;
        }
        preferences = next;
        FlashScale = next.Motion.FlashIntensity switch
        {
            SettingValues.OffEffect => 0,
            SettingValues.ReducedEffect => 0.35,
            _ => 1,
        };
        CameraShakeScale = next.Motion.ReducedMotion == SettingValues.ReduceMotion
            ? 0
            : Math.Clamp(next.Motion.CameraShake, 0, 1);
        bool bloomAllowed = next.Motion.Bloom != SettingValues.OffEffect && QualityProfile != "LOW";
        environment.GlowEnabled = bloomAllowed;
        if (bloomAllowed && next.Motion.Bloom == SettingValues.ReducedEffect && Current is not null)
        {
            environment.GlowIntensity = (float)(Current.BloomStrength * 0.45);
        }
        else if (bloomAllowed && Current is not null)
        {
            environment.GlowIntensity = (float)Current.BloomStrength;
        }
    }

    private static Color ToColor(PresentationColor value) => new((float)value.Red, (float)value.Green, (float)value.Blue);

    private static Vector3 ToVector(CelestialPosition value) => new((float)value.X, (float)value.Y, (float)value.Z);

    private static Vector3 DirectionRotation(CelestialPosition value)
    {
        Vector3 direction = -ToVector(value).Normalized();
        return new Vector3(Mathf.Asin(-direction.Y), Mathf.Atan2(direction.X, direction.Z), 0);
    }

    private static double Lerp(double from, double to, double amount) => from + ((to - from) * amount);
}
