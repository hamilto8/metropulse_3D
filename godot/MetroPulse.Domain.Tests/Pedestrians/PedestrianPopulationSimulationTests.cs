using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Randomness;
using Xunit;

namespace MetroPulse.Domain.Tests.Pedestrians;

public sealed class PedestrianPopulationSimulationTests
{
    [Fact]
    public void ProductionSidewalkGraphHasAuthoredBridgeGapsAndNoDeadEnds()
    {
        PedestrianSidewalkGraph graph = PedestrianSidewalkGraph.CreateProduction();
        PedestrianSidewalkGraphSnapshot snapshot = graph.Snapshot();

        Assert.Equal(246, snapshot.Nodes.Count);
        Assert.All(snapshot.Nodes, node => Assert.NotEmpty(node.NextNodeIds));
        Assert.DoesNotContain("201,41", snapshot.Nodes.Single(node => node.Id == "109,41").NextNodeIds);
        Assert.Contains("201,9", snapshot.Nodes.Single(node => node.Id == "109,9").NextNodeIds);
        Assert.Contains(snapshot.Nodes, node => node.Id == "park_center" && node.ParkPath);
    }

    [Fact]
    public void SeededPopulationMaintainsSixtyCitizensAndCanonicalMix()
    {
        PedestrianPopulationSimulation first = Create("pedestrian-population");
        PedestrianPopulationSimulation second = Create("pedestrian-population");
        PedestrianPopulationSnapshot snapshot = first.Snapshot();

        Assert.Equal(60, snapshot.Citizens.Count);
        Assert.Equal(
            snapshot.Citizens.Select(agent => (agent.Id, agent.Name, agent.Descriptor.Archetype, agent.Descriptor.Color, agent.Position)),
            second.Snapshot().Citizens.Select(agent => (agent.Id, agent.Name, agent.Descriptor.Archetype, agent.Descriptor.Color, agent.Position)));
        Assert.Equal(18, Count(snapshot, "CASUAL"));
        Assert.Equal(12, Count(snapshot, "BUSINESS"));
        Assert.Equal(9, Count(snapshot, "JOGGER"));
        Assert.Equal(6, Count(snapshot, "CAFE_READER"));
        Assert.Equal(9, Count(snapshot, "TOURIST"));
        Assert.Equal(6, Count(snapshot, "CRIMINAL"));
    }

    [Fact]
    public void CullingKnockdownRecoveryAndLocalTrafficQueriesPreserveFloor()
    {
        PedestrianPopulationSimulation simulation = Create("pedestrian-lifecycle");
        PedestrianAgentSnapshot target = simulation.Snapshot().Citizens.First(agent => agent.Descriptor.Archetype == "CASUAL");
        PedestrianTrafficContact? contact = simulation.FindBlockingPedestrian(
            new PedestrianVector3(target.Position.X, target.Position.Y, target.Position.Z - 3),
            0,
            12);
        Assert.Equal(target.Id, contact?.PedestrianId);
        Assert.True(simulation.KnockDown(target.Id, new PedestrianVector3(0, 0.3, 1), 12));
        Assert.True(simulation.GetSnapshot(target.Id).KnockedDown);
        simulation.RecoverToSidewalk(target.Id);
        Assert.False(simulation.GetSnapshot(target.Id).KnockedDown);
        Assert.Equal(1, simulation.GetSnapshot(target.Id).RecoveryCount);

        Assert.True(simulation.Cull(target.Id));
        Assert.Equal(60, simulation.CitizenCount);
        Assert.DoesNotContain(simulation.Snapshot().Citizens, agent => agent.Id == target.Id);
        Assert.InRange(simulation.MaximumLocalCandidates, 1, 20);
    }

    [Fact]
    public void SimulationAndRenderInputsUseIndependentDistanceCadences()
    {
        PedestrianPopulationSimulation simulation = Create("pedestrian-lod");
        for (int frame = 0; frame < 16; frame += 1)
        {
            simulation.Advance(1d / 60, PedestrianVector3.Zero);
        }
        PedestrianPopulationSnapshot snapshot = simulation.Snapshot();
        Assert.Contains(snapshot.Citizens, agent => agent.DetailTier == PedestrianDetailTiers.Near && agent.SimulationCadence == 1);
        Assert.Contains(snapshot.Citizens, agent => agent.DetailTier == PedestrianDetailTiers.Medium && agent.SimulationCadence == 2);
        Assert.Contains(snapshot.Citizens, agent => agent.DetailTier == PedestrianDetailTiers.Far && agent.SimulationCadence == 8);
    }

    private static int Count(PedestrianPopulationSnapshot snapshot, string archetype) =>
        snapshot.Citizens.Count(agent => agent.Descriptor.Archetype == archetype);

    private static PedestrianPopulationSimulation Create(string seed) => new(
        PedestrianSidewalkGraph.CreateProduction(),
        new RandomStreamRegistry(seed));
}
