using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Traffic;

public sealed class HitAndRunPursuitModelTests
{
    [Fact]
    public void ResponderSelectionIsBoundedEligibleDistanceOrderedAndStable()
    {
        HitAndRunPoliceCandidate[] candidates =
        [
            new("police-b", new TrafficPoint(3, 4), true),
            new("police-a", new TrafficPoint(0, 5), true),
            new("civilian", new TrafficPoint(1, 0), false),
            new("controlled", new TrafficPoint(2, 0), true, PlayerControlled: true),
            new("assigned", new TrafficPoint(2, 0), true, AlreadyAssigned: true),
            new("distant", new TrafficPoint(66, 0), true),
        ];

        Assert.Equal(["police-a", "police-b"],
            HitAndRunPursuitModel.SelectNearbyPolice(candidates, new TrafficPoint(0, 0)));
    }

    [Fact]
    public void PursuitSpeedsAndDurationReturnToPatrolBounds()
    {
        HitAndRunPursuitState state = HitAndRunPursuitModel.Create("offender", 20, ["police"]);
        Assert.Equal(31, state.EscapeSpeed);
        Assert.Equal(28, HitAndRunPursuitModel.GetPoliceSpeed(20, 20, 20));
        Assert.Equal(20, HitAndRunPursuitModel.GetPoliceSpeed(20, 20, 4));
        for (int index = 0; index < 88; index += 1) state = HitAndRunPursuitModel.Advance(state, 0.25);
        Assert.False(state.Active);
    }

    [Fact]
    public void TrafficEncounterYieldsImpactsAndCleansHitAndRunState()
    {
        var simulation = new TrafficPopulationSimulation(
            TrafficRoadGraph.CreateProduction(),
            new RandomStreamRegistry("pedestrian-traffic"));
        TrafficAgentSnapshot patient = simulation.Snapshot().Moving.First(agent => !agent.Impatient && !agent.Emergency);
        TrafficPedestrianInteraction yielding = simulation.UpdatePedestrianEncounter(
            patient.Id,
            new PedestrianTrafficContact("pedestrian", 8, 8, 0, false, false),
            0.1);
        Assert.True(yielding.ShouldYield);
        simulation.Advance(0.1, patient.Position);
        Assert.True(simulation.GetSnapshot(patient.Id).TargetSpeed <= 0.01);

        TrafficAgentSnapshot offender = simulation.Snapshot().Moving.First(agent => !agent.Emergency && !agent.PlayerControlled && agent.Speed > 2);
        TrafficPedestrianInteraction impact = simulation.UpdatePedestrianEncounter(
            offender.Id,
            new PedestrianTrafficContact("pedestrian", 1.5, 1.5, 0, false, false),
            0.1);
        Assert.True(impact.ShouldKnockDown);
        Assert.True(impact.HitAndRunStarted);
        Assert.True(simulation.GetSnapshot(offender.Id).HitAndRunOffender);
        for (int index = 0; index < 89; index += 1) simulation.Advance(0.25, offender.Position);
        Assert.False(simulation.GetSnapshot(offender.Id).HitAndRunOffender);
        Assert.DoesNotContain(simulation.Snapshot().Moving, agent => agent.PursuitTargetId == offender.Id || agent.SirenActive);
    }
}
