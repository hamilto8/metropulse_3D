using MetroPulse.Domain.Enforcement;
using MetroPulse.Domain.Pedestrians;
using MetroPulse.Domain.Randomness;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Simulation;

public sealed class Phase6LivingCitySoakTests
{
    private const double StepSeconds = 0.1;
    private const int SoakSteps = 18_000;

    [Fact]
    public void ThirtyMinuteLivingCitySoakPreservesPopulationQueriesAndCleanup()
    {
        TrafficRoadGraph roadGraph = TrafficRoadGraph.CreateProduction();
        var traffic = new TrafficPopulationSimulation(roadGraph, new RandomStreamRegistry("phase6-soak-traffic"));
        var pedestrians = new PedestrianPopulationSimulation(
            PedestrianSidewalkGraph.CreateProduction(),
            new RandomStreamRegistry("phase6-soak-pedestrians"));
        HeatEnforcementState heat = HeatEnforcementState.Clear;
        IReadOnlyDictionary<string, RoadGraphNodeSnapshot> roadNodes = roadGraph.Snapshot().Nodes
            .ToDictionary(node => node.Id, StringComparer.Ordinal);
        string? controlledId = null;
        string? knockedDownId = null;
        int trafficCulls = 0;
        int pedestrianCulls = 0;
        int possessionCycles = 0;
        int hitAndRunCycles = 0;
        int enforcementCycles = 0;
        int bridgeSamples = 0;
        int stoppedSamples = 0;
        int turnSamples = 0;

        for (int step = 1; step <= SoakSteps; step += 1)
        {
            TrafficPoint focus = FocusFor(step);
            pedestrians.Advance(StepSeconds, new PedestrianVector3(focus.X, 0, focus.Z));

            if (step % 1_500 == 1)
            {
                TrafficAgentSnapshot selected = traffic.Snapshot().Moving
                    .First(agent => !agent.Emergency && !agent.PlayerControlled);
                Assert.True(traffic.SetPlayerControlled(selected.Id, true));
                traffic.SyncPlayerPose(selected.Id, selected.Position, selected.Heading, Math.Max(6, selected.Speed));
                controlledId = selected.Id;
            }
            else if (controlledId is not null && step % 1_500 == 20)
            {
                Assert.True(traffic.SetPlayerControlled(controlledId, false));
                controlledId = null;
                possessionCycles += 1;
            }

            if (step % 1_800 == 50)
            {
                TrafficAgentSnapshot offender = traffic.Snapshot().Moving.First(agent =>
                    !agent.Emergency && !agent.PlayerControlled && agent.Speed > 2
                    && !agent.HitAndRunOffender && agent.DamageState == TrafficDamageStates.Healthy);
                PedestrianAgentSnapshot victim = pedestrians.Snapshot().Citizens.First(agent =>
                    !agent.KnockedDown && !agent.Seated);
                TrafficPedestrianInteraction impact = traffic.UpdatePedestrianEncounter(
                    offender.Id,
                    new PedestrianTrafficContact(victim.Id, 1, 1, 0, false, false),
                    StepSeconds);
                Assert.True(impact.ShouldKnockDown);
                Assert.True(impact.HitAndRunStarted);
                Assert.True(pedestrians.KnockDown(victim.Id, new PedestrianVector3(0, 0.3, 1), 9));
                knockedDownId = victim.Id;
                hitAndRunCycles += 1;

                HeatReportResult report = HeatEnforcementModel.Report(heat, new CrimeReport(
                    "SOAK_HIT_AND_RUN", offender.Position, Severity: 3, Witnessed: true, Security: 0.5));
                Assert.True(report.IncidentCreated);
                heat = report.State;
                EnforcementResponseSnapshot response = traffic.DispatchOrUpdateEnforcement(
                    "player", focus, report.RequestedResponders);
                Assert.InRange(response.ResponderIds.Count, 1, 4);
                enforcementCycles += 1;
            }

            if (knockedDownId is not null && step % 1_800 == 70)
            {
                pedestrians.RecoverToSidewalk(knockedDownId);
                knockedDownId = null;
            }

            if (heat.Wanted)
            {
                EnforcementAdvanceResult advance = HeatEnforcementModel.Advance(
                    heat,
                    new EnforcementObservation("player", focus, controlledId is not null,
                        double.PositiveInfinity, VisibleToPolice: false, SafeState: true),
                    StepSeconds);
                heat = advance.State;
                if (advance.ResolveIncident) Assert.True(traffic.ClearEnforcement("player"));
            }

            if (step % 1_800 == 0)
            {
                string id = traffic.Snapshot().Moving.First(agent => !agent.PlayerControlled).Id;
                Assert.True(traffic.Cull(id));
                trafficCulls += 1;
            }
            if (step % 1_200 == 0)
            {
                string id = pedestrians.Snapshot().Citizens.First(agent => !agent.KnockedDown).Id;
                Assert.True(pedestrians.Cull(id));
                pedestrianCulls += 1;
            }

            TrafficPopulationSnapshot beforeAdvance = traffic.Snapshot();
            TrafficAgentSnapshot sampledVehicle = beforeAdvance.Moving[(step / 10) % beforeAdvance.Moving.Count];
            PedestrianTrafficContact? contact = pedestrians.FindBlockingPedestrian(
                new PedestrianVector3(sampledVehicle.Position.X, 0, sampledVehicle.Position.Z),
                sampledVehicle.Heading,
                traffic.GetPedestrianDetectionDistance(sampledVehicle.Id));
            _ = traffic.UpdatePedestrianEncounter(sampledVehicle.Id, contact, StepSeconds);
            traffic.Advance(StepSeconds, focus, bridgePriorityEnabled: step % 600 < 300);

            if (step % 10 == 0)
            {
                TrafficPopulationSnapshot trafficSnapshot = traffic.Snapshot();
                PedestrianPopulationSnapshot pedestrianSnapshot = pedestrians.Snapshot();
                AssertPopulationInvariants(roadGraph, trafficSnapshot, pedestrianSnapshot);
                bridgeSamples += trafficSnapshot.Moving.Count(IsPrimaryBridgeTraversal);
                stoppedSamples += trafficSnapshot.Moving.Count(agent => agent.TargetSpeed == 0);
                turnSamples += trafficSnapshot.Moving.Count(agent =>
                    Math.Abs(NormalizeAngle(HeadingTo(agent.Position,
                        roadNodes[agent.TargetNodeId].Position) - agent.Heading)) > 0.15);
            }
        }

        foreach (PedestrianAgentSnapshot pedestrian in pedestrians.Snapshot().Citizens.Where(agent => agent.KnockedDown))
        {
            pedestrians.RecoverToSidewalk(pedestrian.Id);
        }
        TrafficPopulationSnapshot finalTraffic = traffic.Snapshot();
        PedestrianPopulationSnapshot finalPedestrians = pedestrians.Snapshot();
        Assert.Equal(SoakSteps, finalTraffic.Frame);
        Assert.Equal(SoakSteps, finalPedestrians.Frame);
        Assert.Equal(10, trafficCulls);
        Assert.Equal(15, pedestrianCulls);
        Assert.Equal(12, possessionCycles);
        Assert.Equal(10, hitAndRunCycles);
        Assert.Equal(10, enforcementCycles);
        Assert.True(bridgeSamples > 0);
        Assert.True(stoppedSamples > 0);
        Assert.True(turnSamples > 0);
        Assert.InRange(finalTraffic.MaximumLocalCandidates, 1, 47);
        Assert.InRange(finalPedestrians.MaximumLocalCandidates, 1, 59);
        Assert.False(heat.Wanted);
        Assert.Null(heat.ActiveIncidentId);
        Assert.DoesNotContain(finalTraffic.Moving, agent =>
            agent.PlayerControlled || agent.HitAndRunOffender || agent.PursuitTargetId is not null
            || agent.EnforcementTargetId is not null || agent.SirenActive);
        Assert.Equal(0, finalPedestrians.ActiveKnockdowns);
    }

    private static void AssertPopulationInvariants(
        TrafficRoadGraph roadGraph,
        TrafficPopulationSnapshot traffic,
        PedestrianPopulationSnapshot pedestrians)
    {
        Assert.Equal(48, traffic.Moving.Count);
        Assert.Equal(12, traffic.Parked.Count);
        Assert.Equal(48, traffic.Moving.Select(agent => agent.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(12, traffic.Parked.Select(agent => agent.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(60, pedestrians.Citizens.Count);
        Assert.Equal(60, pedestrians.Citizens.Select(agent => agent.Id).Distinct(StringComparer.Ordinal).Count());
        Assert.All(traffic.Moving, agent =>
        {
            Assert.True(double.IsFinite(agent.Position.X));
            Assert.True(double.IsFinite(agent.Position.Z));
            Assert.True(double.IsFinite(agent.Speed));
            LaneCorridorResult corridor = roadGraph.EnforceLaneCorridor(
                agent.Position, agent.CurrentNodeId, agent.TargetNodeId, VehicleWidth(agent.TypeId));
            Assert.True(corridor.Projection.Deviation <= corridor.MaximumDeviation + 5,
                $"{agent.Id} left the bounded lane/intersection envelope.");
        });
        Assert.All(pedestrians.Citizens, agent => Assert.True(agent.Position.IsFinite));
    }

    private static TrafficPoint FocusFor(int step)
    {
        TrafficPoint[] anchors =
        [
            new(0, 0),
            new(100, 50),
            new(260, 0),
            new(450, -50),
            new(800, 50),
            new(260, -600),
        ];
        return anchors[(step / 300) % anchors.Length];
    }

    private static bool IsPrimaryBridgeTraversal(TrafficAgentSnapshot agent) =>
        (agent.CurrentNodeId == "EB_OUT:100,0" && agent.TargetNodeId == "EB_IN:210,0")
        || (agent.CurrentNodeId == "WB_OUT:210,0" && agent.TargetNodeId == "WB_IN:100,0");

    private static double VehicleWidth(string typeId) => typeId switch
    {
        "BUS" or "TRUCK" => 2.5,
        "MOTORBIKE" => 0.8,
        _ => 1.9,
    };

    private static double HeadingTo(TrafficPoint first, TrafficPoint second) =>
        Math.Atan2(second.X - first.X, second.Z - first.Z);

    private static double NormalizeAngle(double angle)
    {
        while (angle < -Math.PI) angle += Math.PI * 2;
        while (angle > Math.PI) angle -= Math.PI * 2;
        return angle;
    }
}
