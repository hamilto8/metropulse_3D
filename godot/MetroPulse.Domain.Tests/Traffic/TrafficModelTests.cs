using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using MetroPulse.Domain.Traffic;
using Xunit;

namespace MetroPulse.Domain.Tests.Traffic;

public sealed class TrafficModelTests
{
    private static readonly GameContentRegistry Content = GameContentRegistry.LoadProduction();

    [Fact]
    public void SegmentProjectionAndTargetPlaneMatchBrowserNavigationGeometry()
    {
        TrafficPoint start = new(0, 0);
        TrafficPoint target = new(0, 20);
        NavigationProjection projection = TrafficNavigationModel.ProjectToSegment(
            new TrafficPoint(7, 10), start, target)!;

        Assert.Equal(0, projection.X);
        Assert.Equal(10, projection.Z);
        Assert.Equal(0.5, projection.Progress);
        Assert.Equal(7, projection.Deviation);
        Assert.True(TrafficNavigationModel.HasReachedTarget(new TrafficPoint(0.5, 24), target, start));
        Assert.False(TrafficNavigationModel.HasReachedTarget(new TrafficPoint(0.5, 10), target, start));
        Assert.Null(TrafficNavigationModel.ProjectToSegment(start, start, start));
    }

    [Fact]
    public void TurnSpeedLimitSlowsNinetyDegreeTurnButLeavesDistantStraightRouteUnlimited()
    {
        double turn = TrafficNavigationModel.GetTurnSpeedLimit(
            new TrafficPoint(0, 0), new TrafficPoint(10, 0), 0, 20);
        double straight = TrafficNavigationModel.GetTurnSpeedLimit(
            new TrafficPoint(0, 0), new TrafficPoint(0, 30), 0, 20);

        Assert.True(turn < 10);
        Assert.Equal(5.6, turn, 9);
        Assert.Equal(double.PositiveInfinity, straight);
        Assert.Equal(5.5, TrafficNavigationModel.GetTurnSpeedLimit(
            new TrafficPoint(1, 1), new TrafficPoint(1, 1), 0));
    }

    [Fact]
    public void SignalCycleIncludesBothAllRedWindowsAndWrapsNegativeTime()
    {
        Assert.Equal(24, TrafficRulesModel.GetSignalCycleDuration());
        Assert.Equal(TrafficSignalStates.Green, TrafficRulesModel.GetSignalState(0, "NS"));
        Assert.Equal(TrafficSignalStates.Yellow, TrafficRulesModel.GetSignalState(9, "NS"));
        Assert.Equal(TrafficSignalStates.Red, TrafficRulesModel.GetSignalState(11, "NS"));
        Assert.Equal(TrafficSignalStates.Green, TrafficRulesModel.GetSignalState(12, "EW"));
        Assert.Equal(TrafficSignalStates.Yellow, TrafficRulesModel.GetSignalState(21, "EW"));
        Assert.Equal(TrafficSignalStates.Red, TrafficRulesModel.GetSignalState(-1, "EW"));
    }

    [Fact]
    public void AuthoredControlPlanApproachesAndDriverProfilesPreserveStableTokens()
    {
        IReadOnlyList<TrafficControl> plan = TrafficRulesModel.CreateControlPlan(
            new double[] { 0, 420 },
            new double[] { 0, 50 });

        Assert.Equal(4, plan.Count);
        Assert.Equal("SIGNAL:0,0", plan[0].Id);
        Assert.Equal(TrafficControlTypes.Stop, plan[3].Type);
        Assert.Equal("COUNTRYSIDE", plan[3].District);
        Assert.Equal(12, plan[2].PhaseOffset);
        Assert.True(TrafficRulesModel.CreateDriverProfile(4).Compliant);
        Assert.Equal("RECKLESS", TrafficRulesModel.CreateDriverProfile(5).Style);
        Assert.Equal(new TrafficApproach("EB", "EW", -12.5, 30),
            TrafficRulesModel.ParseApproach("EB_IN:-12.5,30"));
        Assert.Null(TrafficRulesModel.ParseApproach("EB_OUT:0,0"));
    }

    [Fact]
    public void StoppingKinematicsClampDetectionDistanceLikeBrowserRules()
    {
        TrafficStoppingKinematics stopped = TrafficRulesModel.GetStoppingKinematics(0, -5);
        TrafficStoppingKinematics moving = TrafficRulesModel.GetStoppingKinematics(-30, 12);

        Assert.Equal(18, stopped.DetectionDistance);
        Assert.Equal(30, moving.Speed);
        Assert.Equal(30, moving.Deceleration);
        Assert.Equal(15, moving.StoppingDistance);
        Assert.Equal(28, moving.DetectionDistance);
        Assert.Equal(34, TrafficRulesModel.GetStoppingKinematics(100, 0).DetectionDistance);
    }

    [Fact]
    public void AggregateSnapshotMatchesFrozenBrowserFormulasAndDrivesEconomyFeedback()
    {
        Harness harness = CreateHarness();
        TrafficProductivitySnapshot snapshot = harness.Model.Snapshot();
        EconomyLedgerSnapshot city = harness.Economy.Snapshot();

        Assert.Equal(0.46251636363636367, snapshot.Network.Congestion, 12);
        Assert.Equal(0.5710379937304076, snapshot.Bridge.Congestion, 12);
        Assert.Equal(0.712775212539185, snapshot.Deliveries.Reliability, 12);
        Assert.Equal(2160, snapshot.Jobs.AccessibleJobs);
        Assert.Equal(84, snapshot.Productivity.Percent);
        Assert.Equal(snapshot.Network.Congestion, city.Mobility.Congestion);
        Assert.Equal(snapshot.Productivity.Multiplier, city.BudgetBreakdown.MobilityProductivityMultiplier);
        Assert.Equal(snapshot.Satisfaction.Modifier, city.HappinessBreakdown.Traffic);
    }

    [Fact]
    public void ConnectedRoadsIncreaseCapacityAndUnchangedInputsDoNotAdvanceRevision()
    {
        RoadNetworkSnapshot roads = new([
            new RoadNetworkSegment("road-a", false, new TrafficPoint(20, 20)),
        ]);
        Harness harness = CreateHarness(() => roads);
        TrafficProductivitySnapshot disconnected = harness.Model.Snapshot();
        Assert.Single(disconnected.Network.Hotspots, hotspot => hotspot.Id == "road-a");

        roads = new RoadNetworkSnapshot([
            new RoadNetworkSegment("road-a", true, new TrafficPoint(20, 20)),
            new RoadNetworkSegment("road-b", true, new TrafficPoint(50, 20)),
        ]);
        TrafficProductivitySnapshot connected = harness.Model.Update();
        Assert.Equal(2, connected.Network.ConnectedRoadSegments);
        Assert.Equal(0, connected.Network.DisconnectedRoadSegments);
        Assert.True(connected.Network.Capacity > disconnected.Network.Capacity);
        Assert.True(connected.Network.Congestion < disconnected.Network.Congestion);
        Assert.Same(connected, harness.Model.Update());
    }

    [Fact]
    public void FreightPriorityTradeoffPersistsAndUpdatesEconomyManagementCost()
    {
        Harness harness = CreateHarness();
        TrafficProductivitySnapshot balanced = harness.Model.Snapshot();
        TrafficProductivitySnapshot priority = harness.Model.SetBridgePolicy(BridgePolicies.FreightPriority);

        Assert.True(priority.Bridge.Capacity > balanced.Bridge.Capacity);
        Assert.True(priority.Deliveries.Reliability > balanced.Deliveries.Reliability);
        Assert.True(priority.Satisfaction.Modifier < balanced.Satisfaction.Modifier);
        Assert.Equal(2, priority.Policy.OperatingCostRate);
        Assert.Equal(2, harness.Economy.Snapshot().BudgetBreakdown.ManagementCostRate);
        Assert.Contains("$120/min", priority.Policy.Tradeoff, StringComparison.Ordinal);

        TrafficProductivityState state = harness.Model.Serialize();
        TrafficProductivityModel.ValidateState(state);
        harness.Model.SetBridgePolicy(BridgePolicies.Balanced);
        harness.Model.Restore(state);
        Assert.Equal(BridgePolicies.FreightPriority, harness.Model.BridgePolicy);
        Assert.Throws<ArgumentOutOfRangeException>(() => harness.Model.Restore(
            new TrafficProductivityState { BridgePolicy = "MAGIC_LANE" }));
    }

    [Fact]
    public void BridgeClosureChangesStreetDirectiveAndCrossingMissionAvailability()
    {
        Harness harness = CreateHarness();
        ApplyBridgeClosure(harness.Outcomes);
        TrafficProductivitySnapshot snapshot = harness.Model.Update();
        TrafficMissionImpact crossing = harness.Model.GetMissionImpact(new TrafficMissionRequest(
            MissionType: "COURIER",
            Pickup: new TrafficPoint(0, 0),
            Dropoff: new TrafficPoint(300, 0)));
        TrafficMissionImpact local = harness.Model.GetMissionImpact(new TrafficMissionRequest(
            MissionType: "TAXI",
            Pickup: new TrafficPoint(-50, 0),
            Dropoff: new TrafficPoint(50, 0)));

        Assert.Equal(TrafficAccess.Closed, snapshot.Bridge.Access);
        Assert.True(snapshot.Bridge.OutageActive);
        Assert.Equal(0, harness.Model.GetStreetDirective(new TrafficPoint(155, 0)).SpeedMultiplier);
        Assert.False(crossing.Available);
        Assert.True(local.Available);
        Assert.NotEqual("NORMAL", local.Difficulty);
    }

    [Fact]
    public void StructuredAlertsExposeTrafficBridgeAndDeliveryConsequences()
    {
        Harness harness = CreateHarness();
        ApplyBridgeClosure(harness.Outcomes);
        harness.Model.Update();
        var alerts = new AlertService(
            () => DateTimeOffset.Parse("2026-07-18T12:00:00.000Z"),
            idFactory: SequentialIds());
        using var adapter = new TrafficAlertAdapter(harness.Model, alerts);
        IReadOnlyList<AlertRecord> active = alerts.Snapshot().Active;

        Assert.Contains(active, alert => alert.DedupeKey == "traffic:network-congestion");
        Assert.Contains(active, alert => alert.DedupeKey == "traffic:bridge-disruption");
        Assert.Contains(active, alert => alert.DedupeKey == "traffic:delivery-reliability");
        Assert.Contains("productivity", active.Single(alert =>
            alert.DedupeKey == "traffic:network-congestion").Cause, StringComparison.OrdinalIgnoreCase);
    }

    private static Harness CreateHarness(Func<RoadNetworkSnapshot?>? roadProvider = null)
    {
        var economy = new EconomyLedger(
            Content.EconomyBalance,
            50_000,
            20,
            population: 4_000,
            happiness: 75,
            services: new EconomyBaseServices
            {
                Power = new EconomyServiceBase(100, 100),
                Water = new EconomyServiceBase(100, 100),
                Fire = new EconomyServiceBase(100, 100),
            });
        economy.RegisterBuilding(new EconomyBuilding("operations-hub", 80, 10) { JobCapacity = 3_500 });
        var outcomes = new MissionOutcomeService(economy, Content);
        var model = new TrafficProductivityModel(
            economy,
            Content.EconomyBalance.Policies!,
            outcomes,
            roadProvider,
            48);
        return new Harness(economy, outcomes, model);
    }

    private static void ApplyBridgeClosure(MissionOutcomeService outcomes) => outcomes.Apply(new MissionOutcomeTransaction(
        "traffic-test:bridge-closure",
        new OutcomeSource(OutcomeSourceKinds.System, "traffic-test"),
        new OutcomeCommand[]
        {
            new TrafficSetCommand(
                "primary-bridge",
                TrafficProductivityModel.PrimaryBridgeDistrict,
                2,
                AccessStates.Closed,
                0.8,
                1),
            new TrafficSetCommand(
                "CITY",
                DensityMultiplier: 1.25,
                Access: AccessStates.Restricted,
                HazardLevel: 0.5),
            new ServiceOutageSetCommand(
                "bridge-relay",
                ServiceTypes.Power,
                TrafficProductivityModel.PrimaryBridgeDistrict,
                Severity: 1),
        }));

    private static Func<string> SequentialIds()
    {
        int sequence = 0;
        return () => $"traffic-alert-{++sequence}";
    }

    private sealed record Harness(
        EconomyLedger Economy,
        MissionOutcomeService Outcomes,
        TrafficProductivityModel Model);
}
