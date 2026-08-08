using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MetroPulse.Domain.Content;

public static class CanonicalContentLoader
{
    private const string BuildingsResource = "MetroPulse.Domain.Content.Data.buildings.json";
    private const string WeatherResource = "MetroPulse.Domain.Content.Data.weather.json";
    private const string MissionWeatherPoliciesResource = "MetroPulse.Domain.Content.Data.mission-weather-policies.json";

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
