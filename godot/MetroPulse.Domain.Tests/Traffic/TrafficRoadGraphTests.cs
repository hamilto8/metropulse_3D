using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Traffic;

public sealed class TrafficRoadGraphTests
{
    [Fact]
    public void ProductionGraphPreservesAuthoredNodeVocabularyAndHasNoDeadEnds()
    {
        TrafficRoadGraph graph = TrafficRoadGraph.CreateProduction();
        TrafficRoadGraphSnapshot snapshot = graph.Snapshot();

        Assert.Equal(480, snapshot.BaseNodeCount);
        Assert.Equal(480, snapshot.Nodes.Count);
        Assert.All(snapshot.Nodes, node => Assert.NotEmpty(node.NextNodeIds));
        Assert.Contains(snapshot.Nodes, node => node.Id == "EB_IN:100,0" && node.Position == new TrafficPoint(90, 3.5));
        Assert.DoesNotContain(snapshot.Edges, edge => edge.FromNodeId == "EB_OUT:100,50" && edge.ToNodeId == "EB_IN:210,50");
        Assert.Contains(snapshot.Edges, edge => edge.FromNodeId == "EB_OUT:100,0"
            && edge.ToNodeId == "EB_IN:210,0" && edge.HasBridgePriority);
        Assert.Contains(snapshot.Edges, edge => edge.FromNodeId == "EB_OUT:310,50"
            && edge.ToNodeId == "EB_IN:450,50" && !edge.HasBridgePriority);
    }

    [Fact]
    public void RouteAdvanceDetectsOvershootAndUsesNamedRandomStream()
    {
        TrafficRoadGraph graph = TrafficRoadGraph.CreateProduction();
        var randoms = new RandomStreamRegistry("road-route-test");

        RouteAdvanceResult waiting = graph.AdvanceRoute(
            "EB_OUT:50,0", "EB_IN:100,0", new TrafficPoint(70, 3.5), randoms.TrafficBehavior);
        RouteAdvanceResult advanced = graph.AdvanceRoute(
            "EB_OUT:50,0", "EB_IN:100,0", new TrafficPoint(95, 3.5), randoms.TrafficBehavior);

        Assert.False(waiting.Advanced);
        Assert.True(advanced.Advanced);
        Assert.Equal("EB_IN:100,0", advanced.CurrentNodeId);
        Assert.Contains(advanced.TargetNodeId, graph.Snapshot().Nodes.Single(node => node.Id == "EB_IN:100,0").NextNodeIds);
        Assert.Equal(1ul, randoms.TrafficBehavior.DrawCount);
    }

    [Fact]
    public void CorridorCorrectionRetainsVehicleInsideGeometricLaneLimit()
    {
        TrafficRoadGraph graph = TrafficRoadGraph.CreateProduction();
        LaneCorridorResult result = graph.EnforceLaneCorridor(
            new TrafficPoint(60, 9), "EB_OUT:50,0", "EB_IN:100,0", vehicleWidth: 2);

        Assert.True(result.Corrected);
        Assert.Equal(1.5, result.MaximumDeviation, 9);
        NavigationProjection corrected = TrafficNavigationModel.ProjectToSegment(
            result.Position, new TrafficPoint(60, 3.5), new TrafficPoint(90, 3.5))!;
        Assert.Equal(result.MaximumDeviation, corrected.Deviation, 9);
    }

    [Fact]
    public void UserRoadRegistrationPublishesDetachedTopologyAndUnregistersCleanly()
    {
        TrafficRoadGraph graph = TrafficRoadGraph.CreateProduction();
        UserRoadRegistration registration = graph.RegisterUserRoad(new UserRoadSegmentDefinition(
            "operations-link", new TrafficPoint(50, 125), 30, 30, 0, false));
        TrafficRoadGraphSnapshot registered = graph.Snapshot();

        Assert.True(registration.Connected);
        Assert.Equal(483, registered.Nodes.Count);
        Assert.Equal(1, registered.Revision);
        Assert.Equal(new[] { "operations-link" }, registered.UserRoadIds);
        Assert.Throws<InvalidOperationException>(() => graph.RegisterUserRoad(new UserRoadSegmentDefinition(
            "operations-link", new TrafficPoint(50, 125), 30, 30, 0, false)));

        Assert.True(graph.UnregisterUserRoad("operations-link"));
        Assert.False(graph.UnregisterUserRoad("operations-link"));
        Assert.Equal(480, graph.NodeCount);
        Assert.Equal(2, graph.Revision);
        Assert.Equal(483, registered.Nodes.Count);
    }

    [Fact]
    public void NearestNodeSelectionIsStableAndInvalidRoadsFailClosed()
    {
        TrafficRoadGraph graph = TrafficRoadGraph.CreateProduction();
        Assert.Equal("EB_IN:0,0", graph.FindNearestRoutableNode(new TrafficPoint(-10, 3.5)));
        Assert.Throws<ArgumentException>(() => graph.RegisterUserRoad(new UserRoadSegmentDefinition(
            "bad:id", new TrafficPoint(0, 0), 30, 30, 0, false)));
        Assert.Throws<ArgumentOutOfRangeException>(() => graph.RegisterUserRoad(new UserRoadSegmentDefinition(
            "bad-geometry", new TrafficPoint(0, 0), 5, 30, 0, false)));
    }

    [Fact]
    public void ObstacleIndexReturnsClosestLaneBlockerWithoutScanningFarPopulation()
    {
        var index = new TrafficObstacleIndex(20);
        index.Rebuild([
            new TrafficObstacle("near", new TrafficPoint(0, 8), 1, 1, 0),
            new TrafficObstacle("off-lane", new TrafficPoint(8, 6), 1, 1, 0),
            new TrafficObstacle("far", new TrafficPoint(0, 100), 1, 1, 0),
            new TrafficObstacle("inactive", new TrafficPoint(0, 4), 1, 1, 0, false),
        ]);

        TrafficObstacleHit? hit = index.FindAhead(
            new TrafficPoint(0, 0), rotationY: 0, speed: 10, vehicleWidth: 2, vehicleLength: 4);

        Assert.NotNull(hit);
        Assert.Equal("near", hit.ObstacleId);
        Assert.Equal(5, hit.Distance, 9);
        Assert.Equal(3, index.IndexedCount);
    }
}
