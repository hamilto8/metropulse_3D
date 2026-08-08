using System.Text.Json;
using MetroPulse.Domain.Content;
using Xunit;

namespace MetroPulse.Domain.Tests.Content;

public sealed class ContentDefinitionsTests
{
    [Fact]
    public void StablePrimitiveCatalogMatchesPhaseZeroFixture()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("content-registry.json"));
        JsonElement data = fixture.RootElement.GetProperty("data");

        JsonElement bounds = data.GetProperty("worldBounds");
        Assert.Equal(bounds.GetProperty("minX").GetDouble(), ContentDefinitions.WorldBounds.MinX);
        Assert.Equal(bounds.GetProperty("maxX").GetDouble(), ContentDefinitions.WorldBounds.MaxX);
        Assert.Equal(bounds.GetProperty("minY").GetDouble(), ContentDefinitions.WorldBounds.MinY);
        Assert.Equal(bounds.GetProperty("maxY").GetDouble(), ContentDefinitions.WorldBounds.MaxY);
        Assert.Equal(bounds.GetProperty("minZ").GetDouble(), ContentDefinitions.WorldBounds.MinZ);
        Assert.Equal(bounds.GetProperty("maxZ").GetDouble(), ContentDefinitions.WorldBounds.MaxZ);

        JsonElement records = data.GetProperty("records");
        AssertDistricts(records.GetProperty("districts"));
        AssertZones(records.GetProperty("zones"));
        AssertFactions(records.GetProperty("factions"));
        AssertProgression(records.GetProperty("progression"));
        Assert.Equal(data.GetProperty("vehicleIds").EnumerateArray().Select(item => item.GetString()!), ContentDefinitions.VehicleIds);

        JsonElement scope = data.GetProperty("scope");
        Assert.Equal(ReadStrings(scope.GetProperty("worldFootprint")), ContentDefinitions.MvpWorldFootprint);
        Assert.Equal(ReadStrings(scope.GetProperty("activityTemplates")), ContentDefinitions.MvpActivityTemplates);
        Assert.Equal(ReadStrings(scope.GetProperty("missionIds")), ContentDefinitions.MvpMissionIds);
        Assert.Equal(
            fixture.RootElement.GetProperty("reference").GetProperty("featureFlags").EnumerateObject()
                .Select(flag => (flag.Name, flag.Value.GetBoolean()))
                .OrderBy(flag => flag.Name),
            ContentDefinitions.MvpFeatureFlags.Select(flag => (flag.Key, flag.Value)).OrderBy(flag => flag.Key));
    }

    [Fact]
    public void ProgressionValidationRejectsCircularGraphWithActionablePath()
    {
        IReadOnlyList<ProgressionDefinition> circular = Array.AsReadOnly([
            new ProgressionDefinition("OPERATOR", "Operator", 1, Array.AsReadOnly(["MAGNATE"])),
            new ProgressionDefinition("BROKER", "Broker", 2, Array.AsReadOnly(["OPERATOR"])),
            new ProgressionDefinition("MAGNATE", "Magnate", 3, Array.AsReadOnly(["BROKER"])),
        ]);

        ContentValidationException error = Assert.Throws<ContentValidationException>(
            () => ContentCatalogValidator.ValidateProgression(circular));
        Assert.Equal("CIRCULAR_REFERENCE", error.Code);
        Assert.Equal("progression[OPERATOR].prerequisiteIds", error.Path);
        Assert.Contains("OPERATOR -> MAGNATE -> BROKER -> OPERATOR", error.Message, StringComparison.Ordinal);
    }

    private static IEnumerable<string> ReadStrings(JsonElement array) =>
        array.EnumerateArray().Select(item => item.GetString()!);

    private static void AssertDistricts(JsonElement expectedRecords)
    {
        JsonElement[] expected = expectedRecords.EnumerateArray().ToArray();
        Assert.Equal(expected.Length, ContentDefinitions.Districts.Count);
        for (int index = 0; index < expected.Length; index++)
        {
            JsonElement record = expected[index];
            DistrictDefinition actual = ContentDefinitions.Districts[index];
            Assert.Equal(record.GetProperty("id").GetString(), actual.Id);
            Assert.Equal(record.GetProperty("label").GetString(), actual.Label);
            Assert.Equal(record.GetProperty("releaseScope").GetString(), actual.ReleaseScope);
            JsonElement bounds = record.GetProperty("bounds");
            Assert.Equal(bounds.GetProperty("minX").GetDouble(), actual.Bounds.MinX);
            Assert.Equal(bounds.GetProperty("maxX").GetDouble(), actual.Bounds.MaxX);
            Assert.Equal(bounds.GetProperty("minZ").GetDouble(), actual.Bounds.MinZ);
            Assert.Equal(bounds.GetProperty("maxZ").GetDouble(), actual.Bounds.MaxZ);
        }
    }

    private static void AssertZones(JsonElement expectedRecords)
    {
        JsonElement[] expected = expectedRecords.EnumerateArray().ToArray();
        Assert.Equal(expected.Length, ContentDefinitions.Zones.Count);
        for (int index = 0; index < expected.Length; index++)
        {
            JsonElement record = expected[index];
            ZoneDefinition actual = ContentDefinitions.Zones[index];
            Assert.Equal(record.GetProperty("id").GetString(), actual.Id);
            Assert.Equal(record.GetProperty("label").GetString(), actual.Label);
            Assert.Equal(ReadStrings(record.GetProperty("aliases")), actual.Aliases);
            Assert.Equal(record.GetProperty("color").GetInt32(), actual.Color);
            Assert.Equal(record.GetProperty("happiness").GetDouble(), actual.Happiness);
            Assert.Equal(record.GetProperty("landValue").GetDouble(), actual.LandValue);
            Assert.Equal(record.GetProperty("kind").GetString(), actual.Kind);
            Assert.Equal(record.GetProperty("releaseScope").GetString(), actual.ReleaseScope);
        }
    }

    private static void AssertFactions(JsonElement expectedRecords)
    {
        JsonElement[] expected = expectedRecords.EnumerateArray().ToArray();
        Assert.Equal(expected.Length, ContentDefinitions.Factions.Count);
        for (int index = 0; index < expected.Length; index++)
        {
            JsonElement record = expected[index];
            FactionDefinition actual = ContentDefinitions.Factions[index];
            Assert.Equal(record.GetProperty("id").GetString(), actual.Id);
            Assert.Equal(record.GetProperty("label").GetString(), actual.Label);
            Assert.Equal(record.GetProperty("minReputation").GetDouble(), actual.MinReputation);
            Assert.Equal(record.GetProperty("maxReputation").GetDouble(), actual.MaxReputation);
        }
    }

    private static void AssertProgression(JsonElement expectedRecords)
    {
        JsonElement[] expected = expectedRecords.EnumerateArray().ToArray();
        Assert.Equal(expected.Length, ContentDefinitions.Progression.Count);
        for (int index = 0; index < expected.Length; index++)
        {
            JsonElement record = expected[index];
            ProgressionDefinition actual = ContentDefinitions.Progression[index];
            Assert.Equal(record.GetProperty("id").GetString(), actual.Id);
            Assert.Equal(record.GetProperty("label").GetString(), actual.Label);
            Assert.Equal(record.GetProperty("rank").GetInt32(), actual.Rank);
            Assert.Equal(ReadStrings(record.GetProperty("prerequisiteIds")), actual.PrerequisiteIds);
        }
    }
}
