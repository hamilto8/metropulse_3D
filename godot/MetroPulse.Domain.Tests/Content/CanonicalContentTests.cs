using System.Collections.Frozen;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using MetroPulse.Domain.Content;
using Xunit;

namespace MetroPulse.Domain.Tests.Content;

public sealed class CanonicalContentTests
{
    private static readonly JsonSerializerOptions ComparisonJsonOptions = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [Fact]
    public void ProductionRegistryMatchesEveryFrozenBuildingAndWeatherScalar()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("content-registry.json"));
        JsonElement data = fixture.RootElement.GetProperty("data");
        JsonElement counts = data.GetProperty("counts");

        Assert.Equal(counts.GetProperty("missions").GetInt32(), registry.Counts.Missions);
        Assert.Equal(counts.GetProperty("buildings").GetInt32(), registry.Counts.Buildings);
        Assert.Equal(counts.GetProperty("zones").GetInt32(), registry.Counts.Zones);
        Assert.Equal(counts.GetProperty("districts").GetInt32(), registry.Counts.Districts);
        Assert.Equal(counts.GetProperty("factions").GetInt32(), registry.Counts.Factions);
        Assert.Equal(counts.GetProperty("progression").GetInt32(), registry.Counts.Progression);
        Assert.Equal(counts.GetProperty("weather").GetInt32(), registry.Counts.Weather);
        Assert.Equal(counts.GetProperty("dialogue").GetInt32(), registry.Counts.Dialogue);

        JsonNode expectedBuildings = JsonNode.Parse(data.GetProperty("records").GetProperty("buildings").GetRawText())!;
        JsonNode actualBuildings = JsonSerializer.SerializeToNode(registry.BuildingRecords, ComparisonJsonOptions)!;
        Assert.True(JsonNode.DeepEquals(expectedBuildings, actualBuildings), "Typed building records changed a frozen scalar.");

        JsonNode expectedWeather = JsonNode.Parse(data.GetProperty("records").GetProperty("weather").GetRawText())!;
        JsonNode actualWeather = JsonSerializer.SerializeToNode(registry.WeatherRecords, ComparisonJsonOptions)!;
        Assert.True(JsonNode.DeepEquals(expectedWeather, actualWeather), "Typed weather records changed a frozen scalar.");

        JsonObject canonicalBuildings = ReadDomainJson("MetroPulse.Domain.Content.Data.buildings.json");
        Assert.True(JsonNode.DeepEquals(
            canonicalBuildings["categories"],
            JsonSerializer.SerializeToNode(registry.BuildingCategories, ComparisonJsonOptions)));
        Assert.True(JsonNode.DeepEquals(
            canonicalBuildings["catalogStages"],
            JsonSerializer.SerializeToNode(registry.CatalogStages, ComparisonJsonOptions)));
        Assert.True(JsonNode.DeepEquals(
            canonicalBuildings["progressionTiers"],
            JsonSerializer.SerializeToNode(registry.ProgressionTiers, ComparisonJsonOptions)));

        JsonObject canonicalPolicies = ReadDomainJson("MetroPulse.Domain.Content.Data.mission-weather-policies.json");
        JsonNode actualPolicies = JsonSerializer.SerializeToNode(registry.MissionWeatherPolicies, ComparisonJsonOptions)!;
        Assert.True(JsonNode.DeepEquals(
            canonicalPolicies["records"],
            actualPolicies),
            "Typed mission-weather policies changed an extracted scalar.");

        Assert.Equal("clear", registry.DefaultWeatherMode);
        Assert.Equal(new[] { "clear", "mist", "rain", "thunderstorm" }, registry.WeatherSequence);
        Assert.Equal(5, registry.MissionWeatherPolicies.Count);
        Assert.Equal(19, registry.BuildingRecords.Select(record => record.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal("Quantum Energy Array", registry.GetBuilding("SOLAR_GRID")!.Name);
        Assert.Equal(0.48, registry.GetWeather("rain")!.GripMultiplier);
    }

    [Fact]
    public void PublishedCanonicalCollectionsAreReadOnly()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();

        Assert.Throws<NotSupportedException>(() =>
            ((IList<BuildingDefinition>)registry.BuildingRecords).Add(new BuildingDefinition()));
        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, MissionWeatherPolicyDefinition>)registry.MissionWeatherPolicies)
                .Add("NEW_POLICY", new MissionWeatherPolicyDefinition()));
    }

    [Fact]
    public void BuildingValidationRejectsDuplicatesAndInvalidRoadTypes()
    {
        JsonObject duplicate = ReadDomainJson("MetroPulse.Domain.Content.Data.buildings.json");
        duplicate["records"]![1]!["id"] = "NEOTECH_HQ";
        ContentValidationException duplicateError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateBuildings(
                CanonicalContentLoader.LoadBuildings(duplicate.ToJsonString())));
        Assert.Equal("DUPLICATE_ID", duplicateError.Code);
        Assert.Equal("buildings[NEOTECH_HQ].id", duplicateError.Path);

        JsonObject road = ReadDomainJson("MetroPulse.Domain.Content.Data.buildings.json");
        JsonNode roadRecord = road["records"]!.AsArray().Single(record => record!["id"]!.GetValue<string>() == "ROAD_STRAIGHT")!;
        roadRecord["roadType"] = "ROUNDABOUT";
        ContentValidationException roadError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateBuildings(
                CanonicalContentLoader.LoadBuildings(road.ToJsonString())));
        Assert.Equal("INVALID_ENUM", roadError.Code);
        Assert.Equal("buildings[ROAD_STRAIGHT].roadType", roadError.Path);
    }

    [Fact]
    public void WeatherValidationRejectsUnsafeScalarsAndMissingDefaults()
    {
        JsonObject unsafeWeather = ReadDomainJson("MetroPulse.Domain.Content.Data.weather.json");
        unsafeWeather["records"]![2]!["groundFriction"] = 1.1;
        ContentValidationException scalarError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateWeather(
                CanonicalContentLoader.LoadWeather(unsafeWeather.ToJsonString())));
        Assert.Equal("weather[rain].groundFriction", scalarError.Path);

        JsonObject missingDefault = ReadDomainJson("MetroPulse.Domain.Content.Data.weather.json");
        missingDefault["defaultMode"] = "hail";
        ContentValidationException defaultError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateWeather(
                CanonicalContentLoader.LoadWeather(missingDefault.ToJsonString())));
        Assert.Equal("MISSING_REFERENCE", defaultError.Code);
        Assert.Equal("weather[<default>].id", defaultError.Path);
    }

    [Fact]
    public void MissionWeatherPoliciesRejectUnknownModes()
    {
        JsonObject policies = ReadDomainJson("MetroPulse.Domain.Content.Data.mission-weather-policies.json");
        policies["records"]!["STANDARD_ROAD"]!["modes"]!["hail"] = new JsonObject
        {
            ["disposition"] = "BLOCKED",
            ["reason"] = "No hail route is authored.",
        };
        MissionWeatherPolicyDocument document = CanonicalContentLoader.LoadMissionWeatherPolicies(policies.ToJsonString());
        IReadOnlySet<string> weatherIds = new[] { "clear", "mist", "rain", "thunderstorm" }
            .ToFrozenSet(StringComparer.Ordinal);

        ContentValidationException error = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateMissionWeatherPolicies(document, weatherIds));
        Assert.Equal("MISSING_REFERENCE", error.Code);
        Assert.Equal("mission-weather-policies[STANDARD_ROAD].modes.hail", error.Path);
    }

    private static JsonObject ReadDomainJson(string resourceName)
    {
        Assembly assembly = typeof(GameContentRegistry).Assembly;
        using Stream stream = assembly.GetManifestResourceStream(resourceName)!;
        return JsonNode.Parse(stream)!.AsObject();
    }
}
