using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionExecutionModelTests
{
    private const double RewardScale = 100;

    [Fact]
    public void MarkersUseStableMvpScopeAndPublishExactEligibilityReasons()
    {
        Harness normal = CreateHarness();
        IReadOnlyList<MissionOfferMarker> unoccupied = normal.Execution.GetOfferMarkers();

        Assert.Equal(9, unoccupied.Count);
        Assert.DoesNotContain(unoccupied, marker => marker.MissionId == "mission_mayhem_escape");
        Assert.All(unoccupied, marker =>
        {
            Assert.StartsWith("mission-pickup:", marker.Id, StringComparison.Ordinal);
            Assert.False(marker.Eligible);
            Assert.Equal("Take direct control of a vehicle first.", marker.IneligibleReason);
        });

        MissionVehicleSnapshot taxi = Vehicle("taxi-1", "TAXI", 0, 30);
        IReadOnlyList<MissionOfferMarker> taxiMarkers = normal.Execution.GetOfferMarkers(taxi);
        Assert.Equal(["mission_executive", "mission_scientist"], taxiMarkers.Select(marker => marker.MissionId));
        Assert.True(taxiMarkers[0].Eligible);
        Assert.Equal("Drive into the mission pickup marker first.", taxiMarkers[1].IneligibleReason);

        MissionOfferDecision wrongType = normal.Execution.EvaluateOffer("mission_sports_trial", taxi);
        Assert.False(wrongType.Allowed);
        Assert.Equal("Requires a SPORTS vehicle.", wrongType.Reason);

        Harness mayhem = CreateHarness(temporaryMayhemEnabled: true);
        Assert.Contains(mayhem.Execution.GetOfferMarkers(), marker => marker.MissionId == "mission_mayhem_escape");
        Assert.DoesNotContain(
            mayhem.Execution.GetOfferMarkers(trafficProvider: _ => new MissionTrafficModifier(false, "Bridge route closed.")),
            marker => marker.MissionId == "mission_executive");
    }

    [Fact]
    public void TaxiBindsAcceptingVehicleAndCalculatesDeterministicSatisfactionPayout()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot taxi = Vehicle("taxi-accepted", "TAXI", 0, 30);
        harness.Execution.BeginBriefing("mission_executive", taxi);

        MissionExecutionState started = harness.Execution.Accept(
            taxi,
            new MissionAcceptanceChoice(RushBonus: 300, TimeLimitOverride: 45, NodeId: "accept_rush"));

        Assert.Equal(MissionPhases.Active, harness.Lifecycle.Phase);
        Assert.Equal("taxi-accepted", started.VehicleId);
        Assert.Equal(45, started.TimeRemaining);
        Assert.Equal(75_000, started.BasePayout);
        Assert.Equal(new MissionWorldPoint(100, -80, "Financial Plaza Skyscraper", "WEST_CORE"), harness.Execution.NavigationTarget);

        MissionExecutionUpdate completed = harness.Execution.Advance(
            22.5,
            Vehicle("taxi-accepted", "TAXI", 100, -80),
            congestion: 0.5);

        Assert.Equal(MissionExecutionSignals.Completed, completed.Signal);
        Assert.Equal(62, completed.Satisfaction);
        Assert.Equal(79_500, completed.State.Payout);
        Assert.Equal(MissionPhases.Completion, harness.Lifecycle.Phase);
        Assert.Equal(79_500, harness.Lifecycle.Snapshot().Run!.Resolution!.Payout);
    }

    [Theory]
    [InlineData("mission_scientist", "TAXI", -50, -80, 260, 50, "COURIER")]
    [InlineData("mission_police_park", "POLICE", -100, -50, -50, -100, "DELIVERY")]
    public void CourierAndDeliveryCompleteAtTheirAuthoredDestination(
        string missionId,
        string vehicleType,
        double pickupX,
        double pickupZ,
        double destinationX,
        double destinationZ,
        string objective)
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot vehicle = Vehicle("accepted", vehicleType, pickupX, pickupZ);
        harness.Execution.BeginBriefing(missionId, vehicle);
        MissionExecutionState started = harness.Execution.Accept(vehicle);

        MissionExecutionUpdate completed = harness.Execution.Advance(
            1,
            Vehicle("accepted", vehicleType, destinationX, destinationZ));

        Assert.Equal(objective, started.Objective);
        Assert.Equal(MissionExecutionSignals.Completed, completed.Signal);
        Assert.Null(completed.Satisfaction);
        Assert.Equal(started.BasePayout, completed.State.Payout);
    }

    [Fact]
    public void RaceAdvancesOrderedCheckpointsAndUsesAuthoredRivalPressure()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot sports = Vehicle("sports-1", "SPORTS", 210, 0);
        harness.Execution.BeginBriefing("mission_sports_trial", sports);
        MissionExecutionState started = harness.Execution.Accept(sports);

        Assert.Equal(4, started.Route.Count);
        Assert.Equal("Nova Kade", started.RaceLeaderName);
        Assert.Equal(35, started.RaceLeaderFinishTime);

        MissionExecutionUpdate first = harness.Execution.Advance(2, Vehicle("sports-1", "SPORTS", 260, 50));
        Assert.Equal(MissionExecutionSignals.Checkpoint, first.Signal);
        Assert.Equal("mission_sports_trial:route-1", first.Checkpoint!.Id);
        Assert.Equal(1, first.State.RouteIndex);
        Assert.Equal(new MissionWorldPoint(100, 50, "Financial Chicane", "WEST_CORE"), harness.Execution.NavigationTarget);
        Assert.Equal(MissionPhases.Active, harness.Lifecycle.Phase);

        _ = harness.Execution.Advance(1, Vehicle("sports-1", "SPORTS", 100, 50));
        _ = harness.Execution.Advance(1, Vehicle("sports-1", "SPORTS", 0, 100));
        MissionExecutionUpdate finish = harness.Execution.Advance(1, Vehicle("sports-1", "SPORTS", -100, 100));
        Assert.Equal(MissionExecutionSignals.Completed, finish.Signal);

        Harness losingHarness = CreateHarness();
        losingHarness.Execution.BeginBriefing("mission_sports_trial", sports);
        _ = losingHarness.Execution.Accept(sports);
        MissionExecutionUpdate loss = losingHarness.Execution.Advance(35, sports);
        Assert.Equal(MissionExecutionSignals.Failed, loss.Signal);
        Assert.Equal("race_lost", loss.Reason);
    }

    [Fact]
    public void SabotageRequiresExplicitStoppedHoldAndRestartsAfterInterruption()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot police = Vehicle("police-1", "POLICE", 0, 0);
        harness.Execution.BeginBriefing("mission_police_robbery", police);
        _ = harness.Execution.Accept(police);

        MissionExecutionUpdate arrived = harness.Execution.Advance(1, Vehicle("police-1", "POLICE", -50, 50));
        Assert.Equal(MissionExecutionSignals.ObjectiveReady, arrived.Signal);
        Assert.Equal("mission_police_robbery:sabotage-target", arrived.Checkpoint!.Id);

        MissionExecutionUpdate moving = harness.Execution.BeginObjectiveHold(Vehicle("police-1", "POLICE", -50, 50, speed: 2));
        Assert.Equal(MissionExecutionSignals.None, moving.Signal);
        Assert.Equal("Stop the vehicle before starting the sabotage action.", moving.Reason);

        Assert.Equal(
            MissionExecutionSignals.HoldStarted,
            harness.Execution.BeginObjectiveHold(Vehicle("police-1", "POLICE", -50, 50)).Signal);
        Assert.Equal(
            MissionExecutionSignals.HoldInterrupted,
            harness.Execution.Advance(1, Vehicle("police-1", "POLICE", -50, 50, speed: 2)).Signal);
        _ = harness.Execution.BeginObjectiveHold(Vehicle("police-1", "POLICE", -50, 50));
        MissionExecutionUpdate completed = harness.Execution.Advance(3, Vehicle("police-1", "POLICE", -50, 50));
        Assert.Equal(MissionExecutionSignals.Completed, completed.Signal);
    }

    [Fact]
    public void SurvivalHasNoFalseDestinationAndTimerExpiryIsSuccessOnlyWhenEnabled()
    {
        Harness harness = CreateHarness(temporaryMayhemEnabled: true);
        MissionVehicleSnapshot sports = Vehicle("sports-survival", "SPORTS", 210, -50);
        harness.Execution.BeginBriefing("mission_mayhem_escape", sports);
        MissionExecutionState started = harness.Execution.Accept(sports);

        Assert.Equal(MissionObjectiveTypes.Survival, started.Objective);
        Assert.Empty(started.Route);
        Assert.Null(harness.Execution.NavigationTarget);
        Assert.Equal(MissionExecutionSignals.None, harness.Execution.Advance(44, sports).Signal);
        Assert.Equal(MissionExecutionSignals.Completed, harness.Execution.Advance(1, sports).Signal);
    }

    [Theory]
    [InlineData("vehicle_lost")]
    [InlineData("cancelled")]
    [InlineData("arrested")]
    public void FailureProducersRetainTypedRecoveryReason(string reason)
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot taxi = Vehicle("taxi-1", "TAXI", 0, 30);
        harness.Execution.BeginBriefing("mission_executive", taxi);
        _ = harness.Execution.Accept(taxi);

        MissionExecutionUpdate failed = reason == "vehicle_lost"
            ? harness.Execution.Advance(0.1, Vehicle("different", "TAXI", 0, 30))
            : harness.Execution.Fail(reason);

        Assert.Equal(MissionExecutionSignals.Failed, failed.Signal);
        Assert.Equal(reason, failed.Reason);
        Assert.Equal(reason, harness.Lifecycle.Snapshot().Run!.Resolution!.Reason);
    }

    [Fact]
    public void RestoreRequiresExactLifecycleMissionAndAuthoredRoute()
    {
        Harness source = CreateHarness();
        MissionVehicleSnapshot bus = Vehicle("bus-1", "BUS", 0, 100);
        source.Execution.BeginBriefing("mission_bus_loop", bus);
        MissionExecutionState captured = source.Execution.Accept(bus);
        MissionLifecycleState lifecycleState = source.Lifecycle.Serialize();

        Harness restored = CreateHarness();
        restored.Lifecycle.Restore(lifecycleState);
        MissionExecutionState snapshot = restored.Execution.Restore(captured);
        Assert.Equal(captured.MissionId, snapshot.MissionId);
        Assert.Equal(captured.VehicleId, snapshot.VehicleId);
        Assert.Equal(captured.Route, snapshot.Route);
        Assert.Equal(captured.TimeRemaining, snapshot.TimeRemaining);
        Assert.Throws<InvalidDataException>(() => restored.Execution.Restore(captured with
        {
            Route = [new MissionWorldPoint(999, 999)],
        }));
    }

    [Fact]
    public void RetryReacquiresExactVehicleAndRestoresLastRaceCheckpoint()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot sports = Vehicle("sports-retry", "SPORTS", 210, 0);
        harness.Execution.BeginBriefing("mission_sports_trial", sports);
        _ = harness.Execution.Accept(sports);
        _ = harness.Execution.Advance(2, Vehicle("sports-retry", "SPORTS", 260, 50));
        MissionExecutionState checkpointState = harness.Execution.Snapshot!;
        _ = harness.Execution.Fail("vehicle_lost");
        harness.Lifecycle.BeginCleanup();
        MissionOutcomeReceipt receipt = new MissionOutcomeService().Apply(harness.Lifecycle.CreateOutcomeTransaction());
        harness.Lifecycle.CommitCleanup(receipt);
        MissionRecoveryResult recovery = harness.Lifecycle.BeginRecovery(retry: true);

        Assert.Throws<MissionLifecycleException>(() => harness.Execution.RecoverForRetry(
            Vehicle("replacement", "SPORTS", 260, 50),
            recovery.Decision!));
        MissionExecutionState retried = harness.Execution.RecoverForRetry(
            Vehicle("sports-retry", "SPORTS", 260, 50),
            recovery.Decision!);

        Assert.Equal(MissionPhases.Active, harness.Lifecycle.Phase);
        Assert.Equal(2, harness.Lifecycle.Snapshot().Run!.Attempt);
        Assert.Equal(checkpointState.RouteIndex, retried.RouteIndex);
        Assert.Equal(checkpointState.TimeRemaining, retried.TimeRemaining);
        Assert.Equal(checkpointState.RaceElapsed, retried.RaceElapsed);
    }

    private static Harness CreateHarness(bool temporaryMayhemEnabled = false)
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();
        var lifecycle = new MissionLifecycleController(registry.Definitions);
        var execution = new MissionExecutionModel(registry, lifecycle, RewardScale, temporaryMayhemEnabled);
        return new Harness(registry, lifecycle, execution);
    }

    private static MissionVehicleSnapshot Vehicle(
        string stableId,
        string type,
        double x,
        double z,
        double speed = 0) => new(stableId, type, x, z, speed);

    private sealed record Harness(
        MissionRegistry Registry,
        MissionLifecycleController Lifecycle,
        MissionExecutionModel Execution);
}
