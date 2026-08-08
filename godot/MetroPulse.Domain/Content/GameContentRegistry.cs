using System.Collections.Frozen;
using MetroPulse.Domain.Missions;

namespace MetroPulse.Domain.Content;

public sealed record ContentCounts(
    int Missions,
    int Buildings,
    int Zones,
    int Districts,
    int Factions,
    int Progression,
    int Weather,
    int Dialogue);

public sealed class GameContentRegistry
{
    private readonly FrozenDictionary<string, BuildingDefinition> buildings;
    private readonly FrozenDictionary<string, WeatherDefinition> weather;

    private GameContentRegistry(
        MissionRegistry missions,
        BuildingCatalogDocument buildingDocument,
        WeatherCatalogDocument weatherDocument,
        MissionWeatherPolicyDocument weatherPolicyDocument,
        VehicleProfileDocument vehicleDocument,
        PedestrianArchetypeDocument pedestrianDocument,
        CameraPresetDocument cameraDocument,
        SuspensionBridgeDocument bridgeDocument)
    {
        Missions = missions;
        BuildingRecords = Array.AsReadOnly(buildingDocument.Records!.ToArray());
        WeatherRecords = Array.AsReadOnly(weatherDocument.Records!.ToArray());
        BuildingCategories = buildingDocument.Categories!.ToFrozenDictionary(StringComparer.Ordinal);
        CatalogStages = buildingDocument.CatalogStages!.ToFrozenDictionary(StringComparer.Ordinal);
        ProgressionTiers = buildingDocument.ProgressionTiers!.ToFrozenDictionary(StringComparer.Ordinal);
        WeatherSequence = Array.AsReadOnly(weatherDocument.Sequence!.ToArray());
        DefaultWeatherMode = weatherDocument.DefaultMode!;
        MissionWeatherPolicies = weatherPolicyDocument.Records!.ToFrozenDictionary(
            entry => entry.Key,
            entry => Freeze(entry.Value),
            StringComparer.Ordinal);
        VehicleContentIds = Array.AsReadOnly(vehicleDocument.ContentIds!.ToArray());
        VehicleProfiles = vehicleDocument.Records!.ToFrozenDictionary(
            entry => entry.Key,
            entry => entry.Value,
            StringComparer.Ordinal);
        PedestrianArchetypeSequence = Array.AsReadOnly(pedestrianDocument.Sequence!.ToArray());
        PedestrianArchetypes = pedestrianDocument.Records!.ToFrozenDictionary(
            entry => entry.Key,
            entry => Freeze(entry.Value),
            StringComparer.Ordinal);
        CameraPresets = cameraDocument.Records!.ToFrozenDictionary(
            entry => entry.Key,
            entry => Freeze(entry.Value),
            StringComparer.Ordinal);
        SuspensionBridgeLayout = bridgeDocument.Layout!;
        SuspensionBridgeCableSamples = Array.AsReadOnly(bridgeDocument.CableSamples!.ToArray());
        buildings = BuildingRecords.ToFrozenDictionary(record => record.Id!, StringComparer.Ordinal);
        weather = WeatherRecords.ToFrozenDictionary(record => record.Id!, StringComparer.Ordinal);
        Counts = new ContentCounts(
            Missions.Count,
            BuildingRecords.Count,
            ContentDefinitions.Zones.Count,
            ContentDefinitions.Districts.Count,
            ContentDefinitions.Factions.Count,
            ContentDefinitions.Progression.Count,
            WeatherRecords.Count,
            Missions.Definitions.Sum(mission => mission.DialogueTree!.Count));
    }

    public MissionRegistry Missions { get; }

    public IReadOnlyList<BuildingDefinition> BuildingRecords { get; }

    public IReadOnlyList<WeatherDefinition> WeatherRecords { get; }

    public IReadOnlyDictionary<string, string> BuildingCategories { get; }

    public IReadOnlyDictionary<string, string> CatalogStages { get; }

    public IReadOnlyDictionary<string, string> ProgressionTiers { get; }

    public string DefaultWeatherMode { get; }

    public IReadOnlyList<string> WeatherSequence { get; }

    public IReadOnlyDictionary<string, MissionWeatherPolicyDefinition> MissionWeatherPolicies { get; }

    public IReadOnlyList<string> VehicleContentIds { get; }

    public IReadOnlyDictionary<string, VehicleProfileRecord> VehicleProfiles { get; }

    public IReadOnlyList<string> PedestrianArchetypeSequence { get; }

    public IReadOnlyDictionary<string, PedestrianArchetypeDefinition> PedestrianArchetypes { get; }

    public IReadOnlyDictionary<string, CameraPresetDefinition> CameraPresets { get; }

    public SuspensionBridgeLayout SuspensionBridgeLayout { get; }

    public IReadOnlyList<BridgeCableSample> SuspensionBridgeCableSamples { get; }

    public ContentCounts Counts { get; }

    public BuildingDefinition? GetBuilding(string id) => buildings.GetValueOrDefault(id);

    public WeatherDefinition? GetWeather(string id) => weather.GetValueOrDefault(id);

    public VehicleProfileRecord? GetVehicleProfile(string id) => VehicleProfiles.GetValueOrDefault(id);

    public PedestrianArchetypeDefinition? GetPedestrianArchetype(string id) =>
        PedestrianArchetypes.GetValueOrDefault(id);

    public CameraPresetDefinition? GetCameraPreset(string id) => CameraPresets.GetValueOrDefault(id);

    public static GameContentRegistry LoadProduction()
    {
        ContentCatalogValidator.ValidateStaticDefinitions();
        BuildingCatalogDocument buildings = CanonicalContentLoader.LoadBuildings();
        WeatherCatalogDocument weather = CanonicalContentLoader.LoadWeather();
        MissionWeatherPolicyDocument policies = CanonicalContentLoader.LoadMissionWeatherPolicies();
        VehicleProfileDocument vehicles = CanonicalContentLoader.LoadVehicleProfiles();
        PedestrianArchetypeDocument pedestrians = CanonicalContentLoader.LoadPedestrianArchetypes();
        CameraPresetDocument cameras = CanonicalContentLoader.LoadCameraPresets();
        SuspensionBridgeDocument bridge = CanonicalContentLoader.LoadSuspensionBridge();

        CanonicalContentValidator.ValidateBuildings(buildings);
        CanonicalContentValidator.ValidateWeather(weather);
        CanonicalContentValidator.ValidateVehicleProfiles(vehicles);
        CanonicalContentValidator.ValidatePedestrianArchetypes(pedestrians);
        CanonicalContentValidator.ValidateCameraPresets(cameras);
        CanonicalContentValidator.ValidateSuspensionBridge(bridge);
        IReadOnlySet<string> weatherIds = weather.Records!.Select(record => record.Id!).ToFrozenSet(StringComparer.Ordinal);
        CanonicalContentValidator.ValidateMissionWeatherPolicies(policies, weatherIds);
        IReadOnlySet<string> policyIds = policies.Records!.Keys.ToFrozenSet(StringComparer.Ordinal);
        MissionRegistry missions = MissionRegistry.LoadProduction(policyIds);

        return new GameContentRegistry(
            missions,
            buildings,
            weather,
            policies,
            vehicles,
            pedestrians,
            cameras,
            bridge);
    }

    private static MissionWeatherPolicyDefinition Freeze(MissionWeatherPolicyDefinition policy) => policy with
    {
        Modes = (policy.Modes ?? new Dictionary<string, MissionWeatherModeDefinition>())
            .ToFrozenDictionary(StringComparer.Ordinal),
    };

    private static PedestrianArchetypeDefinition Freeze(PedestrianArchetypeDefinition archetype) => archetype with
    {
        Colors = Array.AsReadOnly(archetype.Colors!.ToArray()),
        Hair = Array.AsReadOnly(archetype.Hair!.ToArray()),
    };

    private static CameraPresetDefinition Freeze(CameraPresetDefinition preset) => preset with
    {
        Position = Array.AsReadOnly(preset.Position!.ToArray()),
        Target = Array.AsReadOnly(preset.Target!.ToArray()),
    };
}
