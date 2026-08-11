using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Traffic;

public sealed class TrafficPopulationSimulationTests
{
    [Fact]
    public void SeededPopulationMaintainsFortyEightMovingAndSeparateParkedInventory()
    {
        TrafficPopulationSimulation first = Create("population-seed");
        TrafficPopulationSimulation second = Create("population-seed");

        TrafficPopulationSnapshot firstSnapshot = first.Snapshot();
        TrafficPopulationSnapshot secondSnapshot = second.Snapshot();
        Assert.Equal(48, firstSnapshot.Moving.Count);
        Assert.Equal(12, firstSnapshot.Parked.Count);
        Assert.All(firstSnapshot.Moving, agent => Assert.StartsWith("traffic-moving-", agent.Id));
        Assert.All(firstSnapshot.Parked, agent => Assert.StartsWith("traffic-parked-", agent.Id));
        Assert.Equal(firstSnapshot.Moving, secondSnapshot.Moving);
        Assert.Equal(39, firstSnapshot.Moving.Count(agent => agent.Driver.Compliant));
    }

    [Fact]
    public void CullingAndPlayerHandoffNeverReduceMovingFloor()
    {
        TrafficPopulationSimulation simulation = Create("population-floor");
        string id = simulation.Snapshot().Moving[0].Id;
        Assert.True(simulation.SetPlayerControlled(id, true));
        simulation.SyncPlayerPose(id, new TrafficPoint(25, 3.5), 0, 12);
        simulation.Advance(1d / 60, new TrafficPoint(0, 0));
        Assert.Equal(48, simulation.MovingCount);
        Assert.True(simulation.GetSnapshot(id).PlayerControlled);

        Assert.True(simulation.SetPlayerControlled(id, false));
        Assert.True(simulation.Cull(id));
        Assert.Equal(48, simulation.MovingCount);
        Assert.DoesNotContain(simulation.Snapshot().Moving, agent => agent.Id == id);
    }

    [Fact]
    public void SignalCycleAndFourWayStopUseDeterministicArrivalOrder()
    {
        var controls = new TrafficControlCoordinator();
        TrafficControl signal = controls.Controls.Single(control => control.Id == "SIGNAL:0,0");
        TrafficControl stop = controls.Controls.First(control => control.Type == TrafficControlTypes.Stop);
        Assert.Equal(TrafficSignalStates.Green, controls.SignalState(signal, "NS"));
        Assert.Equal(TrafficSignalStates.Red, controls.SignalState(signal, "EW"));
        controls.Arrive(stop.Id, "traffic-b");
        controls.Arrive(stop.Id, "traffic-a");
        controls.Advance(1.1);

        Assert.True(controls.CanProceed(stop.Id, "traffic-b"));
        Assert.False(controls.CanProceed(stop.Id, "traffic-a"));
        Assert.True(controls.Depart(stop.Id, "traffic-b"));
        Assert.True(controls.CanProceed(stop.Id, "traffic-a"));
        Assert.Equal(240, controls.Posts.Count);
    }

    [Fact]
    public void SimulationLodUsesSeparateCadencesAndBoundedLocalQueries()
    {
        TrafficPopulationSimulation simulation = Create("lod-seed");
        for (int frame = 0; frame < 180; frame += 1)
        {
            simulation.Advance(1d / 60, new TrafficPoint(0, 0));
        }
        TrafficPopulationSnapshot snapshot = simulation.Snapshot();

        Assert.Contains(snapshot.Moving, agent => agent.DetailTier == TrafficAgentDetailTiers.Near && agent.SimulationCadence == 1);
        Assert.Contains(snapshot.Moving, agent => agent.DetailTier == TrafficAgentDetailTiers.Medium && agent.SimulationCadence == 2);
        Assert.Contains(snapshot.Moving, agent => agent.DetailTier == TrafficAgentDetailTiers.Far && agent.SimulationCadence == 8);
        Assert.InRange(snapshot.MaximumLocalCandidates, 1, 20);
    }

    [Fact]
    public void DamageFireAndInvalidInputsHaveBoundedLifecycle()
    {
        TrafficPopulationSimulation simulation = Create("damage-seed");
        string id = simulation.Snapshot().Moving[0].Id;
        Assert.Equal(TrafficDamageStates.Damaged, simulation.ApplyDamage(id, 60));
        Assert.Equal(TrafficDamageStates.OnFire, simulation.ApplyDamage(id, 1, ignite: true));
        for (int frame = 0; frame < 400; frame += 1)
        {
            simulation.Advance(1d / 60, new TrafficPoint(0, 0));
        }
        Assert.Equal(TrafficDamageStates.Disabled, simulation.GetSnapshot(id).DamageState);
        Assert.Throws<ArgumentOutOfRangeException>(() => simulation.Advance(double.NaN, new TrafficPoint(0, 0)));
        Assert.Throws<ArgumentOutOfRangeException>(() => simulation.SyncPlayerPose(id, new TrafficPoint(double.NaN, 0), 0, 0));
    }

    private static TrafficPopulationSimulation Create(string seed) => new(
        TrafficRoadGraph.CreateProduction(),
        new RandomStreamRegistry(seed));
}
