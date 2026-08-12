using MetroPulse.Domain.Content;
using MetroPulse.Domain.Core;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Presentation;
using Xunit;

namespace MetroPulse.Domain.Tests.Presentation;

public sealed class MinimapViewModelTests
{
    [Fact]
    public void ProjectsRoadsRouteAgentsAndWorkWithoutDuplicateReverseEdges()
    {
        var a = new MinimapWorldPoint(-100, -100);
        var b = new MinimapWorldPoint(100, 100);
        MinimapSnapshot view = MinimapViewModel.Build(Source() with
        {
            Roads = [new("a-b", a, b), new("b-a", b, a)],
            Agents = [new("moving-police", MinimapMarkerKinds.Vehicle, a, HeatResponder: true)],
            Player = new MinimapWorldPoint(0, 0),
            Congestion = 0.8,
            MissionRoute = [a, new(0, 0), b],
            MissionMarkers = [new("pickup", MinimapMarkerKinds.Pickup, "Pickup", a), new("objective", MinimapMarkerKinds.Objective, "Dropoff", b)],
            WorkOrders = [new("repair", MinimapMarkerKinds.WorkOrder, "Repair bridge", new(50, 20))],
        });

        Assert.Single(view.Roads);
        Assert.Equal(2, view.Route.Count);
        Assert.Equal(0.8, view.Roads[0].Congestion);
        Assert.Contains(view.Icons, icon => icon.Kind == MinimapMarkerKinds.Player);
        Assert.Contains(view.Icons, icon => icon.Kind == MinimapMarkerKinds.Emergency);
        Assert.Equal(1, view.HeatResponderCount);
        Assert.All(view.Icons, icon =>
        {
            Assert.InRange(icon.Position.X, 0, 1);
            Assert.InRange(icon.Position.Y, 0, 1);
        });
    }

    [Fact]
    public void ParkedVehiclesNeverBecomeHeatRespondersAndSurvivalHasNoFalseDestination()
    {
        MinimapSnapshot view = MinimapViewModel.Build(Source() with
        {
            MissionObjective = MissionObjectiveTypes.Survival,
            MissionRoute = [new(0, 0), new(100, 100)],
            MissionMarkers = [new("destination", MinimapMarkerKinds.Objective, "Irrelevant destination", new(100, 100))],
            Agents = [new("parked-police", MinimapMarkerKinds.Vehicle, new(0, 0), Parked: true, HeatResponder: true)],
        });

        Assert.Empty(view.Route);
        Assert.DoesNotContain(view.Icons, icon => icon.Kind == MinimapMarkerKinds.Objective);
        Assert.Contains(view.Icons, icon => icon.Kind == MinimapMarkerKinds.ParkedVehicle);
        Assert.Equal(0, view.HeatResponderCount);
    }

    private static MinimapSource Source() => new(
        GameState.StreetVehicle,
        ContentDefinitions.WorldBounds,
        [],
        [],
        null,
        0,
        0,
        null,
        [],
        0,
        [],
        []);
}
