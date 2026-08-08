using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Content;

public static class CanonicalContentLoader
{
    private const string BuildingsResource = "MetroPulse.Domain.Content.Data.buildings.json";
    private const string WeatherResource = "MetroPulse.Domain.Content.Data.weather.json";
    private const string MissionWeatherPoliciesResource = "MetroPulse.Domain.Content.Data.mission-weather-policies.json";
    private const string VehicleProfilesResource = "MetroPulse.Domain.Content.Data.vehicle-profiles.json";
    private const string PedestrianArchetypesResource = "MetroPulse.Domain.Content.Data.pedestrian-archetypes.json";
    private const string CameraPresetsResource = "MetroPulse.Domain.Content.Data.camera-presets.json";
    private const string SuspensionBridgeResource = "MetroPulse.Domain.Content.Data.suspension-bridge.json";
    private const string EconomyBalanceResource = "MetroPulse.Domain.Content.Data.economy-balance.json";
    private const string CountrysidePlanResource = "MetroPulse.Domain.Content.Data.countryside-plan.json";
    private const string StreetFurnitureResource = "MetroPulse.Domain.Content.Data.street-furniture.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public static BuildingCatalogDocument LoadBuildings() =>
        LoadEmbedded<BuildingCatalogDocument>(BuildingsResource, "buildings");

    public static BuildingCatalogDocument LoadBuildings(string json) =>
        Load<BuildingCatalogDocument>(json, "buildings");

    public static WeatherCatalogDocument LoadWeather() =>
        LoadEmbedded<WeatherCatalogDocument>(WeatherResource, "weather");

    public static WeatherCatalogDocument LoadWeather(string json) =>
        Load<WeatherCatalogDocument>(json, "weather");

    public static MissionWeatherPolicyDocument LoadMissionWeatherPolicies() =>
        LoadEmbedded<MissionWeatherPolicyDocument>(MissionWeatherPoliciesResource, "mission-weather-policies");

    public static MissionWeatherPolicyDocument LoadMissionWeatherPolicies(string json) =>
        Load<MissionWeatherPolicyDocument>(json, "mission-weather-policies");

    public static VehicleProfileDocument LoadVehicleProfiles() =>
        LoadEmbedded<VehicleProfileDocument>(VehicleProfilesResource, "vehicle-profiles");

    public static VehicleProfileDocument LoadVehicleProfiles(string json) =>
        Load<VehicleProfileDocument>(json, "vehicle-profiles");

    public static PedestrianArchetypeDocument LoadPedestrianArchetypes() =>
        LoadEmbedded<PedestrianArchetypeDocument>(PedestrianArchetypesResource, "pedestrian-archetypes");

    public static PedestrianArchetypeDocument LoadPedestrianArchetypes(string json) =>
        Load<PedestrianArchetypeDocument>(json, "pedestrian-archetypes");

    public static CameraPresetDocument LoadCameraPresets() =>
        LoadEmbedded<CameraPresetDocument>(CameraPresetsResource, "camera-presets");

    public static CameraPresetDocument LoadCameraPresets(string json) =>
        Load<CameraPresetDocument>(json, "camera-presets");

    public static SuspensionBridgeDocument LoadSuspensionBridge() =>
        LoadEmbedded<SuspensionBridgeDocument>(SuspensionBridgeResource, "suspension-bridge");

    public static SuspensionBridgeDocument LoadSuspensionBridge(string json) =>
        Load<SuspensionBridgeDocument>(json, "suspension-bridge");

    public static EconomyBalanceDocument LoadEconomyBalance() =>
        LoadEmbedded<EconomyBalanceDocument>(EconomyBalanceResource, "economy-balance");

    public static EconomyBalanceDocument LoadEconomyBalance(string json) =>
        Load<EconomyBalanceDocument>(json, "economy-balance");

    public static CountrysidePlanDocument LoadCountrysidePlan() =>
        LoadEmbedded<CountrysidePlanDocument>(CountrysidePlanResource, "countryside-plan");

    public static CountrysidePlanDocument LoadCountrysidePlan(string json) =>
        Load<CountrysidePlanDocument>(json, "countryside-plan");

    public static StreetFurnitureDocument LoadStreetFurniture() =>
        LoadEmbedded<StreetFurnitureDocument>(StreetFurnitureResource, "street-furniture");

    public static StreetFurnitureDocument LoadStreetFurniture(string json) =>
        Load<StreetFurnitureDocument>(json, "street-furniture");

    private static T LoadEmbedded<T>(string resourceName, string source)
    {
        Assembly assembly = typeof(CanonicalContentLoader).Assembly;
        using Stream stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Missing embedded canonical content: {resourceName}");
        using var reader = new StreamReader(stream);
        return Load<T>(reader.ReadToEnd(), source);
    }

    private static T Load<T>(string json, string source)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            return JsonSerializer.Deserialize<T>(json, JsonOptions)
                ?? throw new ContentValidationException("must contain a JSON document.", source);
        }
        catch (JsonException error)
        {
            string field = string.IsNullOrWhiteSpace(error.Path) ? "<json>" : error.Path;
            throw new ContentValidationException(
                $"contains malformed JSON ({error.Message}).",
                source,
                field: field,
                code: "MALFORMED_JSON");
        }
    }
}
