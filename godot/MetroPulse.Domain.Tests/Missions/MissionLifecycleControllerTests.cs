using System.Text.Json;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionLifecycleControllerTests
{
    private static readonly GameContentRegistry Content = GameContentRegistry.LoadProduction();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    [Fact]
    public void AvailabilityComposesMissionFollowUpAndCityConditionPrerequisites()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateOutcomeHarness();
        outcomes.Apply(Transaction(
            "seed:follow-up",
            [new FollowUpMissionSetCommand("mission-alpha")]));
        var conditions = new CityConditionService(economy, outcomes);
        MissionDefinition alpha = Mission();
        MissionDefinition beta = Mission("mission-beta", "Beta Run") with
        {
            Prerequisites =
            [
                new MissionPrerequisite { Type = MissionPrerequisiteTypes.MissionCompleted, MissionId = "mission-alpha" },
                new MissionPrerequisite
                {
                    Type = MissionPrerequisiteTypes.FollowUpStatus,
                    MissionId = "mission-alpha",
                    Status = FollowUpStatuses.Available,
                },
                new MissionPrerequisite
                {
                    Type = MissionPrerequisiteTypes.CityCondition,
                    Requirement = JsonSerializer.SerializeToElement(new CityConditionRequirement(
                        new CityConditionRequest { Type = CityConditionTypes.AuthoredFlag, FlagId = "bridge.ready" })),
                    Reason = "Repair the bridge first.",
                },
            ],
        };
        var lifecycle = Controller([alpha, beta], conditions, outcomes);

        MissionAvailability unavailable = lifecycle.EvaluateAvailability("mission-beta");

        Assert.Equal(MissionAvailabilityStatuses.Locked, unavailable.Status);
        Assert.Equal(["Complete Alpha Run first.", "Repair the bridge first."], unavailable.Reasons);

        Begin(lifecycle);
        CommitResult(lifecycle, outcomes, success: true);
        lifecycle.BeginRecovery();
        lifecycle.FinishRecovery();
        outcomes.Apply(Transaction(
            "seed:bridge-ready",
            [new AuthoredFlagSetCommand("bridge.ready", OutcomeValues.From(true))]));

        MissionAvailability available = lifecycle.EvaluateAvailability("mission-beta");
        Assert.True(available.Available);
        Assert.Equal(MissionAvailabilityStatuses.Available, available.Status);
    }

    [Fact]
    public void SuccessPathRetainsMissionOwnershipThroughCommittedResultAndRecovery()
    {
        (_, MissionOutcomeService outcomes) = CreateOutcomeHarness();
        var lifecycle = Controller([Mission()], outcomeService: outcomes);
        var phases = new List<string>();
        lifecycle.Subscribe(message =>
        {
            if (message.Type == "PHASE_CHANGED") phases.Add(message.Current.Phase);
        });

        lifecycle.Prepare("mission-alpha");
        lifecycle.BeginBriefing();
        lifecycle.Accept(60, 500);
        lifecycle.BeginExecution();
        lifecycle.ResolveSuccess(650);
        lifecycle.BeginCleanup();
        Assert.False(lifecycle.CanSave().Allowed);
        MissionOutcomeTransaction transaction = lifecycle.CreateOutcomeTransaction();
        Assert.Equal(650, Assert.IsType<CapitalAdjustedCommand>(transaction.Commands[0]).Amount);
        lifecycle.CommitCleanup(outcomes.Apply(transaction));

        Assert.Equal(MissionPhases.Result, lifecycle.Phase);
        Assert.Equal("mission-alpha", lifecycle.CurrentMission!.Id);
        Assert.Contains("mission-alpha", lifecycle.ProgressSnapshot().CompletedMissionIds);
        Assert.True(lifecycle.CanSave().Allowed);
        lifecycle.BeginRecovery();
        lifecycle.FinishRecovery();
        Assert.Equal(MissionPhases.Idle, lifecycle.Phase);
        Assert.Null(lifecycle.CurrentMission);
        Assert.Equal(
        [
            MissionPhases.Preparation,
            MissionPhases.Briefing,
            MissionPhases.Approach,
            MissionPhases.Active,
            MissionPhases.Completion,
            MissionPhases.Cleanup,
            MissionPhases.Result,
            MissionPhases.Recovery,
            MissionPhases.Idle,
        ], phases);
    }

    [Fact]
    public void CleanupUsesOneIdempotentTransactionIdentityPerRunAttempt()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateOutcomeHarness();
        var lifecycle = Controller([Mission()], outcomeService: outcomes);
        Begin(lifecycle);
        lifecycle.ResolveSuccess(500);
        lifecycle.BeginCleanup();
        MissionOutcomeTransaction transaction = lifecycle.CreateOutcomeTransaction();
        MissionOutcomeReceipt first = outcomes.Apply(transaction);
        MissionOutcomeReceipt duplicate = outcomes.Apply(transaction);
        lifecycle.CommitCleanup(first);

        Assert.Equal("mission:mission-alpha:run-1:attempt-1:SUCCESS", transaction.TransactionId);
        Assert.Equal(1_500, economy.Treasury);
        Assert.True(duplicate.Duplicate);
        Assert.Equal(first.TransactionId, lifecycle.Snapshot().Run!.Receipt!.TransactionId);
    }

    [Fact]
    public void RaceAndSabotageRecoverLatestCheckpointWhileDeliveryRestarts()
    {
        (_, MissionOutcomeService raceOutcomes) = CreateOutcomeHarness();
        var race = Controller([Mission() with { MissionType = "RACE" }], outcomeService: raceOutcomes);
        Begin(race);
        race.RecordCheckpoint(
            "race:checkpoint-2",
            JsonSerializer.SerializeToElement(new { routeIndex = 2, timeRemaining = 31 }));
        race.ResumeFromCheckpoint();
        CommitResult(race, raceOutcomes, success: false, reason: "race_lost");
        MissionRetryDecision raceRetry = race.GetRetryDecision();
        Assert.Equal(MissionRetryStrategies.LastCheckpoint, raceRetry.Strategy);
        Assert.Equal(2, raceRetry.Checkpoint!.Payload.GetProperty("routeIndex").GetInt32());
        Assert.Equal(31, raceRetry.Checkpoint.Payload.GetProperty("timeRemaining").GetInt32());

        race.BeginRecovery(retry: true);
        race.FinishRecovery(retry: true);
        Assert.Equal(MissionPhases.Approach, race.Phase);
        Assert.Equal(2, race.Snapshot().Run!.Attempt);

        (_, MissionOutcomeService deliveryOutcomes) = CreateOutcomeHarness();
        var delivery = Controller([Mission()], outcomeService: deliveryOutcomes);
        Begin(delivery);
        delivery.RecordCheckpoint("delivery:approach", JsonSerializer.SerializeToElement(new { timeRemaining = 25 }));
        delivery.ResumeFromCheckpoint();
        CommitResult(delivery, deliveryOutcomes, success: false);
        MissionRetryDecision deliveryRetry = delivery.GetRetryDecision();
        Assert.Equal(MissionRetryStrategies.Restart, deliveryRetry.Strategy);
        Assert.Null(deliveryRetry.Checkpoint);
    }

    [Fact]
    public void RetryAttemptsAreBoundedAndFailedAttemptsHaveDistinctTransactions()
    {
        (_, MissionOutcomeService outcomes) = CreateOutcomeHarness();
        var lifecycle = Controller(
            [Mission() with { RetryPolicy = new MissionRetryPolicy { Strategy = MissionRetryStrategies.Restart, MaxAttempts = 2 } }],
            outcomeService: outcomes);
        Begin(lifecycle);
        MissionOutcomeTransaction first = CommitResult(lifecycle, outcomes, success: false);
        lifecycle.BeginRecovery(retry: true);
        lifecycle.FinishRecovery(retry: true);
        lifecycle.BeginExecution();
        MissionOutcomeTransaction second = CommitResult(lifecycle, outcomes, success: false);

        Assert.NotEqual(first.TransactionId, second.TransactionId);
        Assert.Contains("attempt-2", second.TransactionId, StringComparison.Ordinal);
        MissionRetryDecision decision = lifecycle.GetRetryDecision();
        Assert.False(decision.Allowed);
        Assert.Contains("limit reached", decision.Reason, StringComparison.OrdinalIgnoreCase);
        MissionLifecycleException error = Assert.Throws<MissionLifecycleException>(() => lifecycle.BeginRecovery(retry: true));
        Assert.Contains("limit reached", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void WeatherPolicyAllowsAdaptsDelaysAndBlocksMissionStarts()
    {
        MissionDefinition standard = Mission();
        MissionWeatherDecision clear = MissionLifecycleController.EvaluateMissionWeather(
            standard, "clear", Content.MissionWeatherPolicies);
        MissionWeatherDecision rain = MissionLifecycleController.EvaluateMissionWeather(
            standard, "rain", Content.MissionWeatherPolicies);
        MissionWeatherDecision storm = MissionLifecycleController.EvaluateMissionWeather(
            standard, "thunderstorm", Content.MissionWeatherPolicies);
        MissionWeatherDecision race = MissionLifecycleController.EvaluateMissionWeather(
            Mission() with { WeatherPolicy = "DRY_COMPETITION" },
            "thunderstorm",
            Content.MissionWeatherPolicies);

        Assert.Equal(MissionWeatherDispositions.Allowed, clear.Disposition);
        Assert.Equal(MissionWeatherDispositions.Adapted, rain.Disposition);
        Assert.Equal(1.2, rain.TimeLimitMultiplier);
        Assert.Equal(MissionWeatherDispositions.Delayed, storm.Disposition);
        Assert.Equal(MissionWeatherDispositions.Blocked, race.Disposition);

        var delayed = Controller([standard], weatherProvider: () => "thunderstorm");
        Assert.Equal(MissionAvailabilityStatuses.Delayed, delayed.EvaluateAvailability("mission-alpha").Status);
        MissionLifecycleException error = Assert.Throws<MissionLifecycleException>(() => delayed.Prepare("mission-alpha"));
        Assert.Equal("MISSION_DELAYED", error.Code);
        Assert.Contains("thunderstorm passes", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CheckpointStateRoundTripsWithoutExposingMutableInternals()
    {
        var source = Controller([Mission() with { MissionType = "SABOTAGE" }]);
        Begin(source);
        source.RecordCheckpoint(
            "target-arrival",
            JsonSerializer.SerializeToElement(new { targetId = "bridge-relay", timeRemaining = 41 }));
        string json = JsonSerializer.Serialize(source.Serialize(), JsonOptions);
        MissionLifecycleState serialized = JsonSerializer.Deserialize<MissionLifecycleState>(json, JsonOptions)!;
        Assert.True(MissionLifecycleController.ValidateState(serialized));

        var target = Controller([Mission() with { MissionType = "SABOTAGE" }]);
        MissionLifecycleState restored = target.Restore(serialized);
        Assert.Equal(MissionPhases.Checkpoint, restored.Phase);
        Assert.Equal("bridge-relay", restored.Run!.Checkpoint!.Payload.GetProperty("targetId").GetString());
        Assert.Equal(41, restored.Run.Checkpoint.Payload.GetProperty("timeRemaining").GetInt32());

        Assert.Throws<NotSupportedException>(() =>
            ((IList<MissionRunCount>)target.ProgressSnapshot().RunCounts).Add(new MissionRunCount("mission-alpha", 99)));
        Assert.Equal(1, target.ProgressSnapshot().RunCounts[0].Count);
    }

    [Fact]
    public void CleanupFailuresRemainMissionCriticalAndCannotSavePartialResults()
    {
        var lifecycle = Controller([Mission()]);
        Begin(lifecycle);
        lifecycle.ResolveSuccess(500);
        lifecycle.BeginCleanup();
        lifecycle.RecordCleanupFailure(new InvalidOperationException("outcome storage unavailable"));

        Assert.Equal(MissionPhases.Cleanup, lifecycle.Phase);
        Assert.True(lifecycle.IsMissionCritical);
        Assert.False(lifecycle.CanSave().Allowed);
        Assert.Contains("storage unavailable", lifecycle.Snapshot().Run!.CleanupError, StringComparison.Ordinal);
        Assert.Throws<MissionLifecycleException>(() => lifecycle.BeginRecovery());
    }

    private static MissionDefinition Mission(string id = "mission-alpha", string title = "Alpha Run") => new()
    {
        Id = id,
        Title = title,
        MissionType = "DELIVERY",
        Prerequisites = Array.Empty<MissionPrerequisite>(),
        WeatherPolicy = "STANDARD_ROAD",
    };

    private static MissionLifecycleController Controller(
        IReadOnlyList<MissionDefinition> missions,
        CityConditionService? conditionService = null,
        MissionOutcomeService? outcomeService = null,
        Func<string?>? weatherProvider = null) => new(
            missions,
            conditionService,
            outcomeService,
            weatherProvider ?? (() => "clear"),
            Content.MissionWeatherPolicies);

    private static void Begin(MissionLifecycleController lifecycle, string missionId = "mission-alpha")
    {
        lifecycle.Prepare(missionId);
        lifecycle.BeginBriefing();
        lifecycle.Accept(60, 500);
        lifecycle.BeginExecution();
    }

    private static MissionOutcomeTransaction CommitResult(
        MissionLifecycleController lifecycle,
        MissionOutcomeService outcomes,
        bool success,
        string reason = "timeout")
    {
        if (success) lifecycle.ResolveSuccess(500, "Delivered.");
        else lifecycle.ResolveFailure(reason, "Not delivered.");
        lifecycle.BeginCleanup();
        MissionOutcomeTransaction transaction = lifecycle.CreateOutcomeTransaction();
        lifecycle.CommitCleanup(outcomes.Apply(transaction));
        return transaction;
    }

    private static (EconomyLedger Economy, MissionOutcomeService Outcomes) CreateOutcomeHarness()
    {
        var economy = new EconomyLedger(Content.EconomyBalance, 1_000, 0);
        return (economy, new MissionOutcomeService(economy));
    }

    private static MissionOutcomeTransaction Transaction(string id, IReadOnlyList<OutcomeCommand> commands) => new(
        id,
        new OutcomeSource(OutcomeSourceKinds.System, "mission-lifecycle-test", "SEED"),
        commands,
        new OutcomeSummary("Mission lifecycle test", "Establish lifecycle test state."));
}
