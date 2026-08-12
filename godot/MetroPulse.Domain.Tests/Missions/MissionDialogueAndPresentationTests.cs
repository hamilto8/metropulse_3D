using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Interactions;
using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionDialogueAndPresentationTests
{
    [Fact]
    public void DialogueUsesStableNodesHistoryPauseIntentAndDeterministicPortraits()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot taxi = Vehicle("taxi-1", "TAXI", 0, 30);
        harness.Execution.BeginBriefing("mission_executive", taxi);
        var dialogue = new MissionDialogueModel(harness.Registry, harness.Lifecycle);

        MissionDialogueSnapshot opened = dialogue.Open("mission_executive");
        Assert.Equal("start", opened.NodeId);
        Assert.Equal("Marcus Vance", opened.Speaker);
        Assert.Equal("Venture Capital Executive", opened.Role);
        Assert.True(opened.PauseRequested);
        Assert.Equal("DIALOGUE", opened.PauseReason);
        Assert.Equal(3, opened.Choices.Count);
        Assert.StartsWith("dialogue:mission_executive:start:0:", opened.Choices[0].Id, StringComparison.Ordinal);

        Assert.Equal(2, dialogue.MoveFocus(-1).FocusIndex);
        Assert.Equal(0, dialogue.MoveFocus(1).FocusIndex);
        MissionDialogueDecision navigated = dialogue.ChooseFocused();
        Assert.Equal(MissionDialogueActions.Navigated, navigated.Action);
        Assert.Equal("accept_rush", navigated.Snapshot!.NodeId);
        MissionDialogueHistoryEntry history = Assert.Single(harness.Lifecycle.ProgressSnapshot().DialogueChoices);
        Assert.Equal("start", history.NodeId);
        Assert.Equal("accept_rush", history.Next);

        MissionDialogueDecision accepted = dialogue.Confirm();
        Assert.Equal(MissionDialogueActions.StartMission, accepted.Action);
        Assert.Equal(300, accepted.Acceptance!.RushBonus);
        Assert.Equal(45, accepted.Acceptance.TimeLimitOverride);
        _ = harness.Execution.Accept(taxi, accepted.Acceptance);
        Assert.Equal(MissionDialogueActions.StartMission, dialogue.CompleteAccepted().Action);
        Assert.Null(dialogue.Snapshot);
        Assert.Equal(MissionPhases.Active, harness.Lifecycle.Phase);

        Harness repeat = CreateHarness();
        repeat.Execution.BeginBriefing("mission_executive", taxi);
        var repeatedDialogue = new MissionDialogueModel(repeat.Registry, repeat.Lifecycle);
        Assert.Equal(opened.PortraitSeed, repeatedDialogue.Open("mission_executive").PortraitSeed);
    }

    [Fact]
    public void DialogueCloseAndDeclineReleaseBriefingOwnershipWithoutStartingMission()
    {
        Harness closedHarness = CreateHarness();
        MissionVehicleSnapshot taxi = Vehicle("taxi-1", "TAXI", 0, 30);
        closedHarness.Execution.BeginBriefing("mission_executive", taxi);
        var closed = new MissionDialogueModel(closedHarness.Registry, closedHarness.Lifecycle);
        _ = closed.Open("mission_executive");
        Assert.Equal(MissionDialogueActions.Closed, closed.Close().Action);
        Assert.Equal(MissionPhases.Idle, closedHarness.Lifecycle.Phase);

        Harness declinedHarness = CreateHarness();
        declinedHarness.Execution.BeginBriefing("mission_executive", taxi);
        var declined = new MissionDialogueModel(declinedHarness.Registry, declinedHarness.Lifecycle);
        _ = declined.Open("mission_executive");
        _ = declined.Choose(2);
        Assert.Equal("decline", declined.Snapshot!.NodeId);
        Assert.Equal(MissionDialogueActions.Declined, declined.Confirm().Action);
        Assert.Equal(MissionPhases.Idle, declinedHarness.Lifecycle.Phase);
    }

    [Fact]
    public void OfferDisclosesObjectiveRewardRiskConditionsAndPrerequisites()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot sports = Vehicle("sports-1", "SPORTS", 210, 0);
        MissionOfferView offer = harness.Execution.BuildOffer(
            "mission_sports_trial",
            sports,
            new MissionTrafficModifier(true, "Congestion adds pressure.", 1.1, 1.2));

        Assert.Equal(MissionObjectiveTypes.Race, offer.Objective);
        Assert.Equal("SPORTS", offer.RequiredVehicleType);
        Assert.Equal(99_000, offer.BaseReward);
        Assert.Equal(48, offer.TimeLimit);
        Assert.Contains("A rival can finish before the route timer expires.", offer.Risks);
        Assert.Contains("Congestion adds pressure.", offer.Risks);
        Assert.Empty(offer.Prerequisites);
        Assert.True(offer.Eligibility.Allowed);
    }

    [Fact]
    public void SharedInteractionServiceSelectsOneMissionCandidateAndExplainsBlockedObjective()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot currentVehicle = Vehicle("taxi-1", "TAXI", 0, 30);
        var opened = new List<string>();
        var provider = new MissionInteractionProvider(
            harness.Registry,
            harness.Lifecycle,
            harness.Execution,
            () => currentVehicle,
            missionId => { opened.Add(missionId); return true; });
        var service = new InteractionService();
        _ = provider.Register(service);
        _ = service.RegisterProvider("vehicle", _ =>
        [
            new InteractionCandidateInput
            {
                Id = "vehicle-exit:taxi-1",
                Kind = "VEHICLE_EXIT",
                Priority = InteractionPriorities.ControlledEntityExit,
                Prompt = "Exit taxi",
                AccessibilityLabel = "Exit controlled taxi",
                Distance = 0,
                Eligibility = new InteractionEligibility(true),
                Action = _ => true,
            },
        ]);

        InteractionSnapshot pickup = service.Refresh();
        Assert.Equal("mission-pickup:mission_executive", pickup.Primary!.Id);
        Assert.Equal(2, pickup.Candidates.Count);
        Assert.Equal(InteractionResolutionStatuses.Completed, service.ResolvePrimary().Status);
        Assert.Equal(["mission_executive"], opened);

        Harness sabotageHarness = CreateHarness();
        currentVehicle = Vehicle("police-1", "POLICE", 0, 0);
        sabotageHarness.Execution.BeginBriefing("mission_police_robbery", currentVehicle);
        _ = sabotageHarness.Execution.Accept(currentVehicle);
        var sabotageProvider = new MissionInteractionProvider(
            sabotageHarness.Registry,
            sabotageHarness.Lifecycle,
            sabotageHarness.Execution,
            () => currentVehicle,
            _ => false);
        var sabotageService = new InteractionService();
        _ = sabotageProvider.Register(sabotageService);
        InteractionSnapshot objective = sabotageService.Refresh();
        Assert.Equal("mission-objective:mission_police_robbery", objective.Primary!.Id);
        Assert.False(objective.Primary.Eligibility.Allowed);
        Assert.Equal("Reach the sabotage target first.", objective.Primary.FailureReason);
        Assert.False(sabotageProvider.ControlledEntityReleaseEligibility().Allowed);
        Assert.Equal(InteractionResolutionStatuses.Ineligible, sabotageService.ResolvePrimary().Status);
    }

    [Fact]
    public void ResultProjectionUsesCommittedReceiptAndSeparatesEverySection()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(content.EconomyBalance, 1_000, 0);
        var outcomes = new MissionOutcomeService(economy, content);
        MissionRegistry registry = content.Missions;
        var lifecycle = new MissionLifecycleController(registry.Definitions, outcomeService: outcomes, weatherProvider: () => "rain");
        lifecycle.Prepare("mission_executive");
        lifecycle.BeginBriefing();
        lifecycle.Accept(60, 250);
        lifecycle.BeginExecution();
        lifecycle.ResolveSuccess(250, "The bridge response succeeded.", satisfaction: 88, damage: 0.12, heat: 2);
        lifecycle.BeginCleanup();
        MissionOutcomeTransaction transaction = lifecycle.CreateOutcomeTransaction(
        [
            new CapitalAdjustedCommand(250, Reason: "Emergency contract payment."),
            new TrafficSetCommand("primary-bridge", Access: AccessStates.Open, Reason: "The emergency lane reopened."),
            new FactionReputationAdjustedCommand("RESIDENTS", 8, Reason: "Residents noticed the quick response."),
            new UnlockSetCommand("bridge-emergency-lane", Reason: "The emergency lane is now available."),
        ],
            "Bridge response complete",
            "The response restored access and public confidence.");
        MissionOutcomeReceipt receipt = outcomes.Apply(transaction);
        lifecycle.CommitCleanup(receipt);

        MissionResultView view = MissionResultViewModel.Build(
            outcomes.Explain(receipt.TransactionId)!,
            lifecycle.Snapshot(),
            registry.Get("mission_executive"),
            lifecycle.GetRetryDecision(),
            receipt.Sequence);

        Assert.Equal(MissionResultKinds.Success, view.Kind);
        Assert.Equal("Success", view.OutcomeLabel);
        Assert.Contains(view.Why, reason => reason.Contains("Wet roads reduce grip", StringComparison.Ordinal));
        Assert.Equal(
            [MissionResultSectionIds.Reward, MissionResultSectionIds.City, MissionResultSectionIds.Faction, MissionResultSectionIds.Progression],
            view.Sections.Select(section => section.Id));
        IReadOnlyDictionary<string, MissionResultSection> sections = view.Sections.ToDictionary(section => section.Id);
        Assert.Equal(4, sections[MissionResultSectionIds.Reward].Items.Count);
        Assert.Equal("$1,000 → $1,250 (+$250)", sections[MissionResultSectionIds.Reward].Items[0].Value);
        Assert.Equal("88%", sections[MissionResultSectionIds.Reward].Items[1].Value);
        Assert.Equal("Open access", sections[MissionResultSectionIds.City].Items[0].Value);
        Assert.Equal("0 → 8 (+8)", sections[MissionResultSectionIds.Faction].Items[0].Value);
        Assert.Equal("Unlocked", sections[MissionResultSectionIds.Progression].Items[0].Value);
        Assert.False(view.NextAction.CanRetry);
        Assert.Contains("7 recorded changes", view.Announcement, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("SUCCESS", null, MissionResultKinds.Success)]
    [InlineData("PARTIAL", null, MissionResultKinds.PartialSuccess)]
    [InlineData("FAILURE", "timeout", MissionResultKinds.Failure)]
    [InlineData("FAILURE", "cancelled", MissionResultKinds.Abandoned)]
    [InlineData("FAILURE", "arrested", MissionResultKinds.Arrested)]
    [InlineData("FAILURE", "vehicle_lost", MissionResultKinds.VehicleLoss)]
    public void ResultClassificationCoversAllAuthoredRecoveryKinds(string outcome, string? reason, string expected)
    {
        Assert.Equal(expected, MissionResultViewModel.Classify(
            new MissionResolution(outcome, Reason: reason),
            new OutcomeSource(OutcomeSourceKinds.Mission, "mission_executive", outcome, Reason: reason)));
    }

    [Fact]
    public void ResultHistoryIsNewestFirstAndRetainsReceiptTimeExplanation()
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();
        MissionOutcomeReceipt first = Receipt(
            1,
            "first",
            "FAILURE",
            "timeout",
            "First result",
            "The timer expired.");
        MissionOutcomeReceipt second = Receipt(
            2,
            "second",
            "PARTIAL",
            "One objective remained.",
            "Second result",
            "Access improved, but repairs remain.",
            new OutcomeEffect(
                OutcomeCommandTypes.RepairSet,
                "primary-bridge",
                OutcomeValues.From(new { status = "NOT_STARTED" }),
                OutcomeValues.From(new { status = "SCHEDULED" }),
                "Repair crews were scheduled when the result committed."));

        IReadOnlyList<MissionResultView> history = MissionResultViewModel.BuildHistory([first, second], registry);

        Assert.Equal(["second", "first"], history.Select(entry => entry.TransactionId));
        Assert.Equal(MissionResultKinds.PartialSuccess, history[0].Kind);
        Assert.Equal(
            "Repair crews were scheduled when the result committed.",
            history[0].Sections.Single(section => section.Id == MissionResultSectionIds.City).Items[0].Explanation);
        Assert.Equal("The mission timer expired before the final objective was completed.", history[1].Why[0]);
    }

    [Fact]
    public void LifecyclePerformanceFactsRoundTripAndRejectInvalidRestoreValues()
    {
        Harness harness = CreateHarness();
        MissionVehicleSnapshot taxi = Vehicle("taxi-1", "TAXI", 0, 30);
        harness.Execution.BeginBriefing("mission_executive", taxi);
        _ = harness.Execution.Accept(taxi);
        harness.Lifecycle.ResolveSuccess(100, "Complete", satisfaction: 88, damage: 0.2, heat: 3);
        MissionLifecycleState captured = harness.Lifecycle.Serialize();

        Assert.True(MissionLifecycleController.ValidateState(captured, harness.Registry.Definitions.Select(mission => mission.Id!).ToArray()));
        Assert.Equal(88, captured.Run!.Resolution!.Satisfaction);
        Assert.Throws<ArgumentOutOfRangeException>(() => MissionLifecycleController.ValidateState(captured with
        {
            Run = captured.Run with
            {
                Resolution = captured.Run.Resolution with { Satisfaction = 101 },
            },
        }));
    }

    private static Harness CreateHarness()
    {
        MissionRegistry registry = MissionRegistry.LoadProduction();
        var lifecycle = new MissionLifecycleController(registry.Definitions);
        return new Harness(registry, lifecycle, new MissionExecutionModel(registry, lifecycle, 100));
    }

    private static MissionVehicleSnapshot Vehicle(string id, string type, double x, double z, double speed = 0) =>
        new(id, type, x, z, speed);

    private static MissionOutcomeReceipt Receipt(
        long sequence,
        string id,
        string outcome,
        string? reason,
        string title,
        string description,
        params OutcomeEffect[] effects) => new()
        {
            TransactionId = id,
            Fingerprint = $"fingerprint-{id}",
            Sequence = sequence,
            Source = new OutcomeSource(OutcomeSourceKinds.Mission, "mission_executive", outcome, $"run-{sequence}", Reason: reason),
            Summary = new OutcomeSummary(title, description),
            Commands = Array.Empty<OutcomeCommand>(),
            Effects = effects,
            Duplicate = false,
        };

    private sealed record Harness(
        MissionRegistry Registry,
        MissionLifecycleController Lifecycle,
        MissionExecutionModel Execution);
}
