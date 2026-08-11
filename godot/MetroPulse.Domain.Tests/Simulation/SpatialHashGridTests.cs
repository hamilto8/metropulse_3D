using MetroPulse.Domain.Simulation;
using Xunit;

namespace MetroPulse.Domain.Tests.Simulation;

public sealed class SpatialHashGridTests
{
    [Fact]
    public void QueryCrossesPositiveAndNegativeCellBoundariesInStableIdOrder()
    {
        var grid = new SpatialHashGrid<Entity>(10, entity => entity.Id, entity => entity.Position);
        grid.Rebuild([
            new Entity("z-origin", new SpatialPoint(0, 0)),
            new Entity("b-positive", new SpatialPoint(9, 0)),
            new Entity("a-negative", new SpatialPoint(-9, 0)),
            new Entity("far", new SpatialPoint(40, 0)),
        ]);

        SpatialQueryResult<Entity> result = grid.Query(new SpatialPoint(0, 0), 10);

        Assert.Equal(new[] { "a-negative", "b-positive", "z-origin" }, result.Items.Select(item => item.Id));
        Assert.Equal(3, result.CandidatesTested);
        Assert.True(result.CellsVisited <= 9);
        Assert.Equal(4, grid.IndexedCount);
    }

    [Fact]
    public void RebuildRejectsDuplicateIdsAndSkipsNonfinitePositions()
    {
        var grid = new SpatialHashGrid<Entity>(10, entity => entity.Id, entity => entity.Position);
        Assert.Throws<ArgumentException>(() => grid.Rebuild([
            new Entity("same", new SpatialPoint(0, 0)),
            new Entity("same", new SpatialPoint(1, 1)),
        ]));

        grid.Rebuild([
            new Entity("valid", new SpatialPoint(0, 0)),
            new Entity("invalid", new SpatialPoint(double.NaN, 0)),
        ]);
        Assert.Equal(1, grid.IndexedCount);
        Assert.Empty(grid.Query(new SpatialPoint(double.NaN, 0), 10).Items);
        Assert.Empty(grid.Query(new SpatialPoint(0, 0), -1).Items);
    }

    private sealed record Entity(string Id, SpatialPoint Position);
}
