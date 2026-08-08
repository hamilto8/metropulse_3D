using System.Reflection;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionRegistryTests
{
    [Fact]
    public void ProductionRegistryLoadsAllAuthoredMissionsAndAppliesMvpScope()
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();

        Assert.Equal(15, registry.Count);
        Assert.Equal(
            new[]
            {
                "mission_executive", "mission_cyberdj", "mission_scientist", "mission_tourist",
                "mission_police_robbery", "mission_police_park", "mission_sports_trial",
                "mission_sports_smuggle", "mission_bus_loop", "mission_bus_tour",
                "mission_truck_delivery", "mission_truck_goods", "mission_sedan_grocery",
                "mission_sedan_testing", "mission_mayhem_escape",
            },
            registry.Definitions.Select(mission => mission.Id));
        Assert.Equal(47, registry.Definitions.Sum(mission => mission.DialogueTree!.Count));
        Assert.Equal(9, registry.GetMvpMissions().Count);
        Assert.Equal(10, registry.GetMvpMissions(temporaryMayhemEnabled: true).Count);
        Assert.DoesNotContain(registry.GetMvpMissions(), mission => mission.Id == "mission_mayhem_escape");
    }

    [Theory]
    [InlineData("missionType", "TELEPORT", "INVALID_ENUM", "missions[mission_executive].missionType")]
    [InlineData("vehicleType", "UNKNOWN", "INVALID_ENUM", "missions[mission_executive].vehicleType")]
    public void InvalidEnumsFailAtTheExactAuthoredPath(string field, string value, string code, string path)
    {
        JsonArray missions = ReadProductionJson();
        missions[0]![field] = value;

        ContentValidationException error = Assert.Throws<ContentValidationException>(() => MissionRegistry.Load(missions.ToJsonString()));
        Assert.Equal(code, error.Code);
        Assert.Equal(path, error.Path);
        Assert.Single(error.Actions);
    }

    [Fact]
    public void ImpossibleCoordinateAndMissingDistrictFailClosed()
    {
        JsonArray coordinates = ReadProductionJson();
        coordinates[0]!["pickup"]!["x"] = 811;
        ContentValidationException coordinateError = Assert.Throws<ContentValidationException>(
            () => MissionRegistry.Load(coordinates.ToJsonString()));
        Assert.Equal("missions[mission_executive].pickup.x", coordinateError.Path);
        Assert.Contains("range -190..810", coordinateError.Message, StringComparison.Ordinal);

        JsonArray districts = ReadProductionJson();
        districts[0]!["pickup"]!["districtId"] = "REMOVED_DISTRICT";
        ContentValidationException districtError = Assert.Throws<ContentValidationException>(
            () => MissionRegistry.Load(districts.ToJsonString()));
        Assert.Equal("MISSING_REFERENCE", districtError.Code);
        Assert.Equal("missions[mission_executive].pickup.districtId", districtError.Path);
    }

    [Fact]
    public void DialogueReferencesAndReachabilityAreValidated()
    {
        JsonArray broken = ReadProductionJson();
        broken[0]!["dialogueTree"]!["start"]!["choices"]![0]!["next"] = "missing_node";
        ContentValidationException brokenError = Assert.Throws<ContentValidationException>(
            () => MissionRegistry.Load(broken.ToJsonString()));
        Assert.Equal("MISSING_REFERENCE", brokenError.Code);
        Assert.Equal("missions[mission_executive].dialogueTree.start.choices[0].next", brokenError.Path);

        JsonArray unreachable = ReadProductionJson();
        unreachable[0]!["dialogueTree"]!["orphan"] = new JsonObject { ["text"] = "Unreachable" };
        ContentValidationException unreachableError = Assert.Throws<ContentValidationException>(
            () => MissionRegistry.Load(unreachable.ToJsonString()));
        Assert.Equal("UNREACHABLE_RECORD", unreachableError.Code);
        Assert.Equal("missions[mission_executive].dialogueTree.orphan", unreachableError.Path);
    }

    [Fact]
    public void DuplicateAndCircularMissionIdsFailAtomically()
    {
        JsonArray duplicate = ReadProductionJson();
        duplicate[1]!["id"] = "mission_executive";
        ContentValidationException duplicateError = Assert.Throws<ContentValidationException>(
            () => MissionRegistry.Load(duplicate.ToJsonString()));
        Assert.Equal("DUPLICATE_ID", duplicateError.Code);

        JsonArray circular = ReadProductionJson();
        circular[0]!["prerequisites"] = new JsonArray("mission_cyberdj");
        circular[1]!["prerequisites"] = new JsonArray("mission_executive");
        ContentValidationException circularError = Assert.Throws<ContentValidationException>(
            () => MissionRegistry.Load(circular.ToJsonString()));
        Assert.Equal("CIRCULAR_PREREQUISITE", circularError.Code);
        Assert.Equal("missions[mission_executive].prerequisites", circularError.Path);
    }

    private static JsonArray ReadProductionJson()
    {
        Assembly assembly = typeof(MissionRegistry).Assembly;
        using Stream stream = assembly.GetManifestResourceStream("MetroPulse.Domain.Content.missions.json")!;
        return JsonNode.Parse(stream)!.AsArray();
    }
}
