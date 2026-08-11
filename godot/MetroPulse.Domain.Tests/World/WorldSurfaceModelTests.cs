using System.Text.Json;
using MetroPulse.Domain.World;
using Xunit;

namespace MetroPulse.Domain.Tests.World;

public sealed class WorldSurfaceModelTests
{
    [Fact]
    public void DenseProductionGridMatchesFrozenBrowserSurface()
    {
        WorldSurfaceModel model = new();
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("world-surface-grid.json"));
        JsonElement root = fixture.RootElement;
        double tolerance = root.GetProperty("toleranceMeters").GetDouble();
        int compared = 0;
        foreach (JsonElement sample in root.GetProperty("samples").EnumerateArray())
        {
            double x = sample.GetProperty("x").GetDouble();
            double z = sample.GetProperty("z").GetDouble();
            double terrain = sample.GetProperty("terrainHeight").GetDouble();
            Assert.InRange(Math.Abs(model.GetHillHeight(x, z) - sample.GetProperty("hillHeight").GetDouble()), 0, tolerance);
            Assert.InRange(Math.Abs(model.GetTerrainHeight(x, z) - terrain), 0, tolerance);
            Assert.Equal(sample.GetProperty("waterBelowDeck").GetBoolean(), model.IsWater(x, terrain - 1.01, z));
            Assert.Equal(sample.GetProperty("waterAtSurface").GetBoolean(), model.IsWater(x, terrain, z));
            Assert.Equal(sample.GetProperty("withinWorld").GetBoolean(), model.IsWithinWorldBounds(x, z));
            Assert.Equal(sample.GetProperty("withinDrivable").GetBoolean(), model.IsWithinDrivableBounds(x, z));
            compared++;
        }
        Assert.Equal(7_979, compared);
    }

    [Fact]
    public void BoundaryAndBridgePrecedenceMatchesFrozenBrowserSurface()
    {
        WorldSurfaceModel model = new();
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("world-surface-grid.json"));
        double tolerance = fixture.RootElement.GetProperty("toleranceMeters").GetDouble();
        foreach (JsonElement sample in fixture.RootElement.GetProperty("boundarySamples").EnumerateArray())
        {
            double x = sample.GetProperty("x").GetDouble();
            double z = sample.GetProperty("z").GetDouble();
            Assert.InRange(Math.Abs(model.GetHillHeight(x, z) - sample.GetProperty("hillHeight").GetDouble()), 0, tolerance);
            Assert.InRange(Math.Abs(model.GetTerrainHeight(x, z) - sample.GetProperty("terrainHeight").GetDouble()), 0, tolerance);
            Assert.Equal(sample.GetProperty("waterAtZero").GetBoolean(), model.IsWater(x, 0, z));
            Assert.Equal(sample.GetProperty("waterBelowDeck").GetBoolean(), model.IsWater(x, -1.01, z));
            Assert.Equal(sample.GetProperty("withinWorld").GetBoolean(), model.IsWithinWorldBounds(x, z));
            Assert.Equal(sample.GetProperty("withinDrivable").GetBoolean(), model.IsWithinDrivableBounds(x, z));
        }
        Assert.Equal(10, model.Decks.Count);
        Assert.Equal("grand-suspension", model.Decks[0].Id);
        Assert.Equal(0, model.GetBridgeDeckHeight(160, 0));
        Assert.Null(model.GetBridgeDeckHeight(160, 9.01));
    }

    [Fact]
    public void InvalidQueriesFailSafelyAndCustomDecksRemainSingleSourceData()
    {
        WorldSurfaceModel invalidSafe = new();
        Assert.Equal(0, invalidSafe.GetHillHeight(double.NaN, 0));
        Assert.Equal(0, invalidSafe.GetTerrainHeight(0, double.PositiveInfinity));
        Assert.False(invalidSafe.IsWater(double.NaN, 0, 0));
        Assert.False(invalidSafe.IsWithinWorldBounds(0, double.NegativeInfinity));
        Assert.False(invalidSafe.IsWithinDrivableBounds(double.PositiveInfinity, 0));

        WorldSurfaceModel custom = new([new SurfaceDeck("editor-bridge-7", 150, 170, 20, 30, 2.5)]);
        Assert.Equal(2.5, custom.GetTerrainHeight(160, 25));
        Assert.False(custom.IsWater(160, 2.5, 25));
        Assert.True(custom.IsWater(160, 1.49, 25));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<SurfaceDeck>)custom.Decks).Add(new("duplicate", 0, 1, 0, 1, 0)));
    }

    [Fact]
    public void RuntimeDeckRegistrationRemovesAndRestoresRiverHazardWithoutDuplicates()
    {
        WorldSurfaceModel surface = new();
        var deck = new SurfaceDeck("USER_BRIDGE_1", 145, 175, 135, 165, 2);
        Assert.True(surface.IsWater(160, 2, 150));

        Assert.True(surface.RegisterDeck(deck));
        Assert.False(surface.RegisterDeck(deck));
        Assert.Equal(2, surface.GetTerrainHeight(160, 150));
        Assert.False(surface.IsWater(160, 2, 150));

        Assert.True(surface.UnregisterDeck(deck.Id));
        Assert.False(surface.UnregisterDeck(deck.Id));
        Assert.Equal(-4, surface.GetTerrainHeight(160, 150));
        Assert.True(surface.IsWater(160, 2, 150));
    }
}
