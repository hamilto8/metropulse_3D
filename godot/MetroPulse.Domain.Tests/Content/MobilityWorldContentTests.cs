using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using Xunit;

namespace MetroPulse.Domain.Tests.Content;

public sealed class MobilityWorldContentTests
{
    private static readonly JsonSerializerOptions ComparisonJsonOptions = new();

    [Fact]
    public void ProductionRegistryMatchesFrozenMobilityAndWorldScalars()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();
        using JsonDocument worldFixture = JsonDocument.Parse(FixtureReader.Read("world-landmarks.json"));
        using JsonDocument agentsFixture = JsonDocument.Parse(FixtureReader.Read("seeded-agents-navigation.json"));
        JsonElement worldData = worldFixture.RootElement.GetProperty("data");
        JsonElement agentsData = agentsFixture.RootElement.GetProperty("data");

        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(agentsData.GetProperty("vehicleContentIds").GetRawText()),
            JsonSerializer.SerializeToNode(registry.VehicleContentIds, ComparisonJsonOptions)));

        JsonObject expectedSelectedVehicles = JsonNode
            .Parse(worldData.GetProperty("vehicleProfiles").GetRawText())!
            .AsObject();
        var actualSelectedVehicles = expectedSelectedVehicles
            .Select(entry => entry.Key)
            .ToDictionary(id => id, id => registry.GetVehicleProfile(id)!);
        Assert.True(JsonNode.DeepEquals(
            expectedSelectedVehicles,
            JsonSerializer.SerializeToNode(actualSelectedVehicles, ComparisonJsonOptions)),
            "Typed vehicle profiles changed a frozen scalar.");

        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(agentsData.GetProperty("pedestrianArchetypeSequence").GetRawText()),
            JsonSerializer.SerializeToNode(registry.PedestrianArchetypeSequence, ComparisonJsonOptions)));
        var expectedArchetypes = new JsonObject();
        foreach (JsonElement pedestrian in agentsData.GetProperty("pedestrians").EnumerateArray())
        {
            JsonElement descriptor = pedestrian.GetProperty("descriptor");
            string id = descriptor.GetProperty("archetype").GetString()!;
            expectedArchetypes[id] ??= JsonNode.Parse(descriptor.GetProperty("profile").GetRawText());
        }
        Assert.True(JsonNode.DeepEquals(
            expectedArchetypes,
            JsonSerializer.SerializeToNode(registry.PedestrianArchetypes, ComparisonJsonOptions)),
            "Typed pedestrian archetypes changed a frozen scalar.");

        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(worldData.GetProperty("cameraPresets").GetRawText()),
            JsonSerializer.SerializeToNode(registry.CameraPresets, ComparisonJsonOptions)),
            "Typed camera presets changed a frozen scalar.");

        JsonElement expectedBridge = worldData.GetProperty("bridge");
        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(expectedBridge.GetProperty("layout").GetRawText()),
            JsonSerializer.SerializeToNode(registry.SuspensionBridgeLayout, ComparisonJsonOptions)));
        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse(expectedBridge.GetProperty("cableSamples").GetRawText()),
            JsonSerializer.SerializeToNode(registry.SuspensionBridgeCableSamples, ComparisonJsonOptions)));

        Assert.Equal(11, registry.VehicleProfiles.Count);
        Assert.Equal(6, registry.PedestrianArchetypes.Count);
        Assert.Equal(9, registry.CameraPresets.Count);
        Assert.Equal("rear", registry.GetVehicleProfile("MOTORBIKE")!.Profile!.PlayerDynamics!.DrivenAxle);
        Assert.Equal(320, registry.GetCameraPreset("birdseye")!.Position![1]);
    }

    [Fact]
    public void ProductionRegistryMatchesEveryNewCanonicalDocumentScalar()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();

        AssertCanonicalRecords("MetroPulse.Domain.Content.Data.vehicle-profiles.json", registry.VehicleProfiles);
        AssertCanonicalRecords("MetroPulse.Domain.Content.Data.pedestrian-archetypes.json", registry.PedestrianArchetypes);
        AssertCanonicalRecords("MetroPulse.Domain.Content.Data.camera-presets.json", registry.CameraPresets);
    }

    [Fact]
    public void MobilityValidationRejectsMissingProfilesAndUnknownArchetypes()
    {
        JsonObject vehicles = ReadDomainJson("MetroPulse.Domain.Content.Data.vehicle-profiles.json");
        vehicles["records"]!.AsObject().Remove("MOTORBIKE");
        ContentValidationException vehicleError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateVehicleProfiles(
                CanonicalContentLoader.LoadVehicleProfiles(vehicles.ToJsonString())));
        Assert.Equal("INVALID_RECORD_SET", vehicleError.Code);

        JsonObject pedestrians = ReadDomainJson("MetroPulse.Domain.Content.Data.pedestrian-archetypes.json");
        pedestrians["sequence"]![0] = "UNKNOWN";
        ContentValidationException pedestrianError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidatePedestrianArchetypes(
                CanonicalContentLoader.LoadPedestrianArchetypes(pedestrians.ToJsonString())));
        Assert.Equal("MISSING_REFERENCE", pedestrianError.Code);
        Assert.Equal("pedestrian-archetype-sequence.[0]", pedestrianError.Path);
    }

    [Fact]
    public void WorldContentValidationRejectsMalformedVectorsAndDerivedGeometry()
    {
        JsonObject cameras = ReadDomainJson("MetroPulse.Domain.Content.Data.camera-presets.json");
        cameras["records"]!["street"]!["pos"] = new JsonArray(3.5, 3.6);
        ContentValidationException cameraError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateCameraPresets(
                CanonicalContentLoader.LoadCameraPresets(cameras.ToJsonString())));
        Assert.Equal("camera-presets[street].pos", cameraError.Path);

        JsonObject bridge = ReadDomainJson("MetroPulse.Domain.Content.Data.suspension-bridge.json");
        bridge["cableSamples"]![4]!["height"] = 15;
        ContentValidationException bridgeError = Assert.Throws<ContentValidationException>(() =>
            CanonicalContentValidator.ValidateSuspensionBridge(
                CanonicalContentLoader.LoadSuspensionBridge(bridge.ToJsonString())));
        Assert.Equal("INVALID_DERIVED_VALUE", bridgeError.Code);
        Assert.Equal("suspension-bridge-cable-samples[4].height", bridgeError.Path);
    }

    [Fact]
    public void PublishedMobilityCollectionsAreReadOnly()
    {
        GameContentRegistry registry = GameContentRegistry.LoadProduction();

        Assert.Throws<NotSupportedException>(() =>
            ((IDictionary<string, VehicleProfileRecord>)registry.VehicleProfiles)
                .Add("NEW", new VehicleProfileRecord()));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)registry.PedestrianArchetypeSequence).Add("CASUAL"));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<int>)registry.PedestrianArchetypes["CASUAL"].Colors!).Add(0));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<double>)registry.CameraPresets["street"].Position!).Add(0));
    }

    private static void AssertCanonicalRecords(string resourceName, object actual)
    {
        JsonObject canonical = ReadDomainJson(resourceName);
        Assert.True(JsonNode.DeepEquals(
            canonical["records"],
            JsonSerializer.SerializeToNode(actual, ComparisonJsonOptions)));
    }

    private static JsonObject ReadDomainJson(string resourceName)
    {
        Assembly assembly = typeof(GameContentRegistry).Assembly;
        using Stream stream = assembly.GetManifestResourceStream(resourceName)!;
        return JsonNode.Parse(stream)!.AsObject();
    }
}
