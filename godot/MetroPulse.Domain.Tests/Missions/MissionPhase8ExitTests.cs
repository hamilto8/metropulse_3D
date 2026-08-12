using MetroPulse.Domain.Content;
using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionPhase8ExitTests
{
    [Theory]
    [InlineData("mission_executive", MissionObjectiveTypes.Taxi)]
    [InlineData("mission_scientist", MissionObjectiveTypes.Courier)]
    [InlineData("mission_police_robbery", MissionObjectiveTypes.Sabotage)]
    [InlineData("mission_police_park", MissionObjectiveTypes.Delivery)]
    [InlineData("mission_sports_trial", MissionObjectiveTypes.Race)]
    [InlineData("mission_sports_smuggle", MissionObjectiveTypes.Courier)]
    [InlineData("mission_bus_loop", MissionObjectiveTypes.Delivery)]
    [InlineData("mission_truck_delivery", MissionObjectiveTypes.Courier)]
    [InlineData("mission_sedan_grocery", MissionObjectiveTypes.Taxi)]
    [InlineData("mission_mayhem_escape", MissionObjectiveTypes.Survival)]
    public void EveryMvpMissionCompletesItsAuthoredTemplateAndCommitsOneReceipt(
        string missionId,
        string objective)
    {
        Harness harness = CreateHarness(temporaryMayhemEnabled: missionId == "mission_mayhem_escape");
        MissionDefinition mission = harness.Registry.Get(missionId)!;
        MissionVehicleSnapshot vehicle = At("phase8-playthrough-vehicle", mission.VehicleType!, mission.Pickup!);
        harness.Execution.BeginBriefing(missionId, vehicle);
        MissionExecutionState started = harness.Execution.Accept(vehicle);

        MissionExecutionUpdate completed = CompleteTemplate(harness, mission, vehicle);
        harness.Lifecycle.BeginCleanup();
        MissionOutcomeReceipt receipt = harness.Outcomes.Apply(harness.Lifecycle.CreateOutcomeTransaction());
        harness.Lifecycle.CommitCleanup(receipt);

        Assert.Equal(objective, started.Objective);
        Assert.Equal(MissionExecutionSignals.Completed, completed.Signal);
        Assert.Equal(MissionPhases.Result, harness.Lifecycle.Phase);
        Assert.Equal(missionId, receipt.Source.ContentId);
        Assert.Equal("SUCCESS", receipt.Source.Outcome);
        Assert.Single(harness.Outcomes.Snapshot().Transactions);
    }

    [Theory]
    [InlineData("timeout", MissionResultKinds.Failure)]
    [InlineData("cancelled", MissionResultKinds.Abandoned)]
    [InlineData("arrested", MissionResultKinds.Arrested)]
    [InlineData("vehicle_lost", MissionResultKinds.VehicleLoss)]
    public void FailureProducersCommitTypedDebriefsWithoutSuccessReward(
        string reason,
        string expectedResultKind)
    {
        Harness harness = CreateHarness();
        MissionDefinition mission = harness.Registry.Get("mission_executive")!;
        MissionVehicleSnapshot vehicle = At("failure-taxi", "TAXI", mission.Pickup!);
        harness.Execution.BeginBriefing(mission.Id!, vehicle);
        _ = harness.Execution.Accept(vehicle);
        MissionExecutionUpdate failed = reason switch
        {
            "timeout" => harness.Execution.Advance(harness.Execution.Snapshot!.TimeRemaining + 1, vehicle),
            "vehicle_lost" => harness.Execution.Advance(0.1, vehicle with { StableId = "replacement" }),
            _ => harness.Execution.Fail(reason),
        };
        harness.Lifecycle.BeginCleanup();
        MissionOutcomeReceipt receipt = harness.Outcomes.Apply(harness.Lifecycle.CreateOutcomeTransaction());
        harness.Lifecycle.CommitCleanup(receipt);
        MissionResultView result = MissionResultViewModel.Build(
            harness.Outcomes.Explain(receipt.TransactionId)!,
            harness.Lifecycle.Snapshot(),
            mission,
            harness.Lifecycle.GetRetryDecision(),
            receipt.Sequence);

        Assert.Equal(MissionExecutionSignals.Failed, failed.Signal);
        Assert.Equal(expectedResultKind, result.Kind);
        Assert.Equal(0, receipt.Effects.Single(effect => effect.Type == OutcomeCommandTypes.CapitalAdjusted).After!.Value.GetDouble());
    }

    [Fact]
    public void RetryExhaustionUsesDistinctAttemptTransactionsAndStopsAtAuthoredLimit()
    {
        Harness harness = CreateHarness();
        MissionDefinition mission = harness.Registry.Get("mission_executive")!;
        MissionVehicleSnapshot vehicle = At("retry-taxi", "TAXI", mission.Pickup!);
        harness.Execution.BeginBriefing(mission.Id!, vehicle);
        _ = harness.Execution.Accept(vehicle);

        for (int attempt = 1; attempt <= 3; attempt += 1)
        {
            _ = harness.Execution.Fail("timeout");
            harness.Lifecycle.BeginCleanup();
            MissionOutcomeReceipt receipt = harness.Outcomes.Apply(harness.Lifecycle.CreateOutcomeTransaction());
            harness.Lifecycle.CommitCleanup(receipt);
            Assert.Contains($":attempt-{attempt}:", receipt.TransactionId, StringComparison.Ordinal);
            MissionRetryDecision decision = harness.Lifecycle.GetRetryDecision();
            if (attempt < 3)
            {
                Assert.True(decision.Allowed);
                MissionRecoveryResult recovery = harness.Lifecycle.BeginRecovery(retry: true);
                _ = harness.Execution.RecoverForRetry(vehicle, recovery.Decision!);
            }
            else
            {
                Assert.False(decision.Allowed);
                Assert.Contains("Retry limit reached", decision.Reason, StringComparison.Ordinal);
            }
        }

        Assert.Equal(3, harness.Outcomes.Snapshot().Transactions.Count);
        Assert.Equal(3, harness.Outcomes.Snapshot().Transactions.Select(receipt => receipt.TransactionId).Distinct().Count());
    }

    [Fact]
    public void CleanupFailureRetainsOwnershipBlocksSavingAndPublishesNoReceipt()
    {
        Harness harness = CreateHarness();
        MissionDefinition mission = harness.Registry.Get("mission_executive")!;
        MissionVehicleSnapshot vehicle = At("cleanup-taxi", "TAXI", mission.Pickup!);
        harness.Execution.BeginBriefing(mission.Id!, vehicle);
        _ = harness.Execution.Accept(vehicle);
        _ = harness.Execution.Fail("cancelled");
        harness.Lifecycle.BeginCleanup();

        harness.Lifecycle.RecordCleanupFailure(new IOException("late participant rejected cleanup"));

        Assert.Equal(MissionPhases.Cleanup, harness.Lifecycle.Phase);
        Assert.False(harness.Lifecycle.CanSave().Allowed);
        Assert.Contains("late participant", harness.Lifecycle.Snapshot().Run!.CleanupError, StringComparison.Ordinal);
        Assert.Null(harness.Lifecycle.Snapshot().Run!.Receipt);
        Assert.Empty(harness.Outcomes.Snapshot().Transactions);
    }

    [Fact]
    public void NormalAndTemporaryScopesPublishOnlyTheirAuthorizedStableMissionIds()
    {
        Harness normal = CreateHarness();
        Harness mayhem = CreateHarness(temporaryMayhemEnabled: true);
        string[] normalIds = normal.Execution.GetOfferMarkers().Select(marker => marker.MissionId).ToArray();
        string[] mayhemIds = mayhem.Execution.GetOfferMarkers().Select(marker => marker.MissionId).ToArray();

        Assert.Equal(ContentDefinitions.MvpMissionIds.Take(9), normalIds);
        Assert.Equal(ContentDefinitions.MvpMissionIds, mayhemIds);
        Assert.DoesNotContain(normal.Registry.Definitions
            .Where(mission => !ContentDefinitions.MvpMissionIds.Contains(mission.Id!, StringComparer.Ordinal))
            .Select(mission => mission.Id!), normalIds.Contains);
    }

    private static MissionExecutionUpdate CompleteTemplate(
        Harness harness,
        MissionDefinition mission,
        MissionVehicleSnapshot vehicle)
    {
        switch (harness.Execution.Snapshot!.Objective)
        {
            case MissionObjectiveTypes.Race:
                {
                    MissionExecutionUpdate update = new(harness.Execution.Snapshot, MissionExecutionSignals.None);
                    for (int step = 0; step < 8 && update.Signal != MissionExecutionSignals.Completed; step += 1)
                    {
                        MissionWorldPoint target = harness.Execution.NavigationTarget!;
                        update = harness.Execution.Advance(0.5, vehicle with { X = target.X, Z = target.Z });
                    }
                    return update;
                }
            case MissionObjectiveTypes.Sabotage:
                {
                    MissionWorldPoint target = harness.Execution.NavigationTarget!;
                    MissionVehicleSnapshot stopped = vehicle with { X = target.X, Z = target.Z, Speed = 0 };
                    _ = harness.Execution.Advance(0.5, stopped);
                    _ = harness.Execution.BeginObjectiveHold(stopped);
                    return harness.Execution.Advance(
                        mission.SabotageDuration ?? throw new InvalidDataException("Sabotage duration is missing."),
                        stopped);
                }
            case MissionObjectiveTypes.Survival:
                return harness.Execution.Advance(harness.Execution.Snapshot.TimeRemaining, vehicle);
            default:
                {
                    MissionWorldPoint target = harness.Execution.NavigationTarget!;
                    return harness.Execution.Advance(1, vehicle with { X = target.X, Z = target.Z });
                }
        }
    }

    private static Harness CreateHarness(bool temporaryMayhemEnabled = false)
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();
        var outcomes = new MissionOutcomeService();
        var lifecycle = new MissionLifecycleController(registry.Definitions, outcomeService: outcomes);
        var execution = new MissionExecutionModel(registry, lifecycle, rewardScale: 100, temporaryMayhemEnabled);
        return new Harness(registry, lifecycle, execution, outcomes);
    }

    private static MissionVehicleSnapshot At(string id, string type, MissionLocation location) =>
        new(id, type, location.X, location.Z, 0);

    private sealed record Harness(
        MissionRegistry Registry,
        MissionLifecycleController Lifecycle,
        MissionExecutionModel Execution,
        MissionOutcomeService Outcomes);
}
