using System.Text.Json;
using MetroPulse.Domain.Camera;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.World;
using Xunit;

namespace MetroPulse.Domain.Tests.World;

public sealed class Phase4LandmarkTests
{
    [Fact]
    public void PlotRoadParkAndDistrictLandmarksMatchFrozenBrowserSources()
    {
        using JsonDocument fixture = ReadFixture();
        JsonElement root = fixture.RootElement;
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(GameContentRegistry.LoadProduction());
        HashSet<(double X, double Z)> expectedPlots = root.GetProperty("plotCenters").EnumerateArray()
            .Select(item => (item.GetProperty("x").GetDouble(), item.GetProperty("z").GetDouble()))
            .ToHashSet();
        HashSet<(double X, double Z)> actualPlots = layout.Objects
            .Where(item => item.Kind == "building")
            .Select(item => (item.Position.X, item.Position.Z))
            .ToHashSet();
        Assert.Equal(expectedPlots, actualPlots);

        JsonElement roads = root.GetProperty("roads");
        Assert.Equal(
            roads.GetProperty("x").EnumerateArray().Select(item => item.GetDouble()),
            layout.Objects.Where(item => item.Kind == "road" && item.Id.StartsWith("road-x-", StringComparison.Ordinal)).Select(item => item.Position.X));
        Assert.Equal(
            roads.GetProperty("z").EnumerateArray().Select(item => item.GetDouble()),
            layout.Objects.Where(item => item.Kind == "road" && item.Id.StartsWith("road-west-z-", StringComparison.Ordinal)).Select(item => item.Position.Z));

        JsonElement park = root.GetProperty("park");
        WorldObjectDefinition parkSurface = layout.Objects.Single(item => item.Id == "central-park-grass");
        double[] parkCenter = park.GetProperty("center").EnumerateArray().Select(item => item.GetDouble()).ToArray();
        double[] parkSize = park.GetProperty("size").EnumerateArray().Select(item => item.GetDouble()).ToArray();
        Assert.Equal(new WorldVector3(parkCenter[0], parkCenter[1], parkCenter[2]), parkSurface.Position);
        Assert.Equal(new WorldVector3(parkSize[0], parkSize[1], parkSize[2]), parkSurface.Size);
        JsonElement[] expectedDistricts = root.GetProperty("districtBounds").EnumerateArray().ToArray();
        DistrictDefinition[] actualDistricts = ContentDefinitions.Districts.Where(item => item.ReleaseScope == "MVP").ToArray();
        Assert.Equal(expectedDistricts.Select(item => item.GetProperty("id").GetString()), actualDistricts.Select(item => item.Id));
        foreach (DistrictDefinition district in actualDistricts)
        {
            JsonElement expected = expectedDistricts.Single(item => item.GetProperty("id").GetString() == district.Id);
            Assert.Equal(expected.GetProperty("minX").GetDouble(), district.Bounds.MinX);
            Assert.Equal(expected.GetProperty("maxX").GetDouble(), district.Bounds.MaxX);
            Assert.Equal(expected.GetProperty("minZ").GetDouble(), district.Bounds.MinZ);
            Assert.Equal(expected.GetProperty("maxZ").GetDouble(), district.Bounds.MaxZ);
        }
    }

    [Fact]
    public void BridgeCameraAndTerrainLandmarksMatchFrozenBrowserSources()
    {
        using JsonDocument fixture = ReadFixture();
        JsonElement root = fixture.RootElement;
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(GameContentRegistry.LoadProduction());
        JsonElement bridge = root.GetProperty("bridge");
        AssertVector(layout.Objects.Single(item => item.Id == "grand-suspension-deck"), bridge.GetProperty("deck"));
        WorldObjectDefinition[] barriers = layout.Objects.Where(item => item.Kind == "bridge-barrier").OrderBy(item => item.Position.Z).ToArray();
        JsonElement[] expectedBarriers = bridge.GetProperty("barriers").EnumerateArray().ToArray();
        Assert.Equal(expectedBarriers.Length, barriers.Length);
        for (int index = 0; index < barriers.Length; index++)
        {
            AssertVector(barriers[index], expectedBarriers[index]);
        }
        foreach (JsonElement sample in bridge.GetProperty("cableSamples").EnumerateArray())
        {
            Assert.InRange(Math.Abs(MvpWorldLayout.CableHeight(sample.GetProperty("x").GetDouble(), GameContentRegistry.LoadProduction().SuspensionBridgeLayout)
                - sample.GetProperty("height").GetDouble()), 0, 1e-9);
        }

        CameraPresetModel presets = CameraPresetModel.LoadProduction();
        foreach (JsonProperty expected in root.GetProperty("cameraPresets").EnumerateObject())
        {
            string canonicalId = expected.Name == "management" ? "birdseye" : expected.Name;
            CameraPose actual = presets.Get(canonicalId) ?? throw new InvalidOperationException($"Missing camera preset {canonicalId}.");
            AssertCameraVector(actual.Position, expected.Value.GetProperty("pos"));
            AssertCameraVector(actual.LookAt, expected.Value.GetProperty("target"));
        }

        WorldSurfaceModel surface = new();
        foreach (JsonElement sample in root.GetProperty("terrainSamples").EnumerateArray())
        {
            Assert.InRange(Math.Abs(surface.GetTerrainHeight(sample.GetProperty("x").GetDouble(), sample.GetProperty("z").GetDouble())
                - sample.GetProperty("height").GetDouble()), 0, 1e-6);
        }
    }

    [Fact]
    public void EveryMvpMissionPickupMatchesTheFrozenBrowserLandmark()
    {
        using JsonDocument fixture = ReadFixture();
        MissionRegistry missions = MissionRegistry.LoadProduction();
        JsonElement[] expected = fixture.RootElement.GetProperty("missionPickups").EnumerateArray().ToArray();
        Assert.Equal(ContentDefinitions.MvpMissionIds.Count, expected.Length);
        foreach (JsonElement landmark in expected)
        {
            string id = landmark.GetProperty("id").GetString()!;
            MissionLocation pickup = missions.Get(id)?.Pickup ?? throw new InvalidOperationException($"Missing pickup for {id}.");
            Assert.Equal(landmark.GetProperty("districtId").GetString(), pickup.DistrictId);
            Assert.Equal(landmark.GetProperty("x").GetDouble(), pickup.X);
            Assert.Equal(landmark.GetProperty("z").GetDouble(), pickup.Z);
        }
    }

    [Fact]
    public void PerformanceEvidenceMatchesTheGeneratedLayoutAndStaysWithinBudgets()
    {
        using JsonDocument evidence = JsonDocument.Parse(FixtureReader.Read("phase4-world-performance.json"));
        JsonElement root = evidence.RootElement;
        JsonElement totals = root.GetProperty("totals");
        JsonElement budgets = root.GetProperty("budgets");
        MvpWorldLayout layout = MvpWorldLayout.CreateProduction(GameContentRegistry.LoadProduction());
        Assert.Equal(totals.GetProperty("objects").GetInt32(), layout.Objects.Count);
        Assert.Equal(totals.GetProperty("colliders").GetInt32(), layout.Objects.Count(item => item.Role != WorldObjectRole.Decoration));
        Assert.Equal(totals.GetProperty("instances").GetInt32(), layout.InstanceGroups.Sum(item => item.Instances.Count));
        Assert.Equal(totals.GetProperty("segments").GetInt32(), layout.SegmentGroups.Sum(item => item.Segments.Count));
        foreach (string chunkId in layout.ChunkIds)
        {
            JsonElement chunk = root.GetProperty("chunks").GetProperty(chunkId);
            Assert.Equal(chunk.GetProperty("objects").GetInt32(), layout.Objects.Count(item => item.ChunkId == chunkId));
            Assert.Equal(chunk.GetProperty("colliders").GetInt32(), layout.Objects.Count(item => item.ChunkId == chunkId && item.Role != WorldObjectRole.Decoration));
            Assert.Equal(chunk.GetProperty("instances").GetInt32(), layout.InstanceGroups.Where(item => item.ChunkId == chunkId).Sum(item => item.Instances.Count));
            Assert.Equal(chunk.GetProperty("segments").GetInt32(), layout.SegmentGroups.Where(item => item.ChunkId == chunkId).Sum(item => item.Segments.Count));
        }
        foreach (string budget in new[] { "objects", "colliders", "multiMeshGroups", "cachedMeshes", "cachedMaterials", "cachedShapes" })
        {
            Assert.True(totals.GetProperty(budget).GetInt32() <= budgets.GetProperty(budget).GetInt32(), $"{budget} exceeded its Phase 4 budget.");
        }
        Assert.All(root.GetProperty("afterShutdown").EnumerateObject(), item => Assert.Equal(0, item.Value.GetInt32()));
    }

    private static JsonDocument ReadFixture() => JsonDocument.Parse(FixtureReader.Read("phase4-world-landmarks.json"));

    private static void AssertVector(WorldObjectDefinition actual, JsonElement expected)
    {
        double[] position = expected.GetProperty("position").EnumerateArray().Select(item => item.GetDouble()).ToArray();
        double[] size = expected.GetProperty("size").EnumerateArray().Select(item => item.GetDouble()).ToArray();
        Assert.Equal(new WorldVector3(position[0], position[1], position[2]), actual.Position);
        Assert.Equal(new WorldVector3(size[0], size[1], size[2]), actual.Size);
    }

    private static void AssertCameraVector(CameraVector3 actual, JsonElement expected)
    {
        double[] values = expected.EnumerateArray().Select(item => item.GetDouble()).ToArray();
        Assert.Equal(new CameraVector3(values[0], values[1], values[2]), actual);
    }
}
