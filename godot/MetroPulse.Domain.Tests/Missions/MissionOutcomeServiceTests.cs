using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using MetroPulse.Domain.Missions;
using Xunit;

namespace MetroPulse.Domain.Tests.Missions;

public sealed class MissionOutcomeServiceTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    [Fact]
    public void ValidatedTransactionAppliesEveryConsequenceFamilyWithExplanations()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateHarness();
        var events = new List<MissionOutcomeEvent>();
        outcomes.Subscribe(events.Add);

        MissionOutcomeReceipt receipt = outcomes.Apply(FullTransaction());
        MissionOutcomeSnapshot snapshot = outcomes.Snapshot();

        Assert.False(receipt.Duplicate);
        Assert.Equal(13, receipt.Effects.Count);
        Assert.Equal(1_250, economy.Treasury);
        Assert.Equal("DAMAGED", snapshot.State.BuildingStates["bridge-operations"].State);
        Assert.False(snapshot.State.BuildingStates["bridge-operations"].Operational);
        Assert.Equal("command-2", snapshot.State.BuildingStates["bridge-operations"].CommandId);
        Assert.Equal(AccessStates.Restricted, snapshot.State.Infrastructure["primary-bridge"].Access);
        Assert.True(snapshot.State.Incidents["bridge-collision-1"].Active);
        Assert.Equal(RepairStatuses.Scheduled, snapshot.State.Repairs["primary-bridge"].Status);
        Assert.Equal(0.6, snapshot.State.ServiceOutages["bridge-power-outage"].CoverageMultiplier);
        Assert.Equal(0.35, snapshot.State.Traffic["primary-bridge"].HazardLevel);
        Assert.Equal(12, snapshot.State.Factions["RESIDENTS"]);
        Assert.True(snapshot.State.Progression["OPERATOR"]);
        Assert.True(snapshot.State.Unlocks["bridge-emergency-lane"]);
        Assert.Equal(2, snapshot.State.News["news-bridge-response"].Priority);
        Assert.Equal(FollowUpStatuses.Available, snapshot.State.FollowUpMissions["mission_scientist"].Status);
        Assert.True(snapshot.State.Flags["bridge.response.success"].Value.GetBoolean());
        Assert.Single(events);

        MissionOutcomeExplanation explanation = outcomes.Explain(receipt.TransactionId)!;
        Assert.Equal("mission_executive", explanation.Source.ContentId);
        Assert.Equal("Bridge response succeeded", explanation.Title);
        Assert.Equal(1_000, explanation.Effects[0].Before!.Value.GetDouble());
        Assert.Equal(1_250, explanation.Effects[0].After!.Value.GetDouble());
        Assert.Equal("Emergency contract payment.", explanation.Effects[0].Explanation);
    }

    [Fact]
    public void DuplicateTransactionIsIdempotentAndChangedContentConflicts()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateHarness();
        MissionOutcomeTransaction transaction = FullTransaction();
        MissionOutcomeReceipt first = outcomes.Apply(transaction);
        MissionOutcomeReceipt duplicate = outcomes.Apply(transaction);

        Assert.True(duplicate.Duplicate);
        Assert.Equal(first.TransactionId, duplicate.TransactionId);
        Assert.Equal(1_250, economy.Treasury);
        Assert.Single(outcomes.Snapshot().Transactions);

        MissionOutcomeTransaction changed = FullTransaction(commands:
        [
            new CapitalAdjustedCommand(251),
        ]);
        Assert.Throws<OutcomeConflictException>(() => outcomes.Apply(changed));
        Assert.Equal(1_250, economy.Treasury);
    }

    [Fact]
    public void EconomyObserverCannotReplayBeforeReceiptCommits()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateHarness();
        MissionOutcomeTransaction transaction = FullTransaction(
            transactionId: "reentrant-outcome",
            commands: [new CapitalAdjustedCommand(25)]);
        Exception? reentrant = null;
        economy.Subscribe(economyEvent =>
        {
            if (economyEvent.Detail.GetValueOrDefault("referenceId") as string != transaction.TransactionId) return;
            reentrant = Record.Exception(() => outcomes.Apply(transaction));
        });

        outcomes.Apply(transaction);
        OutcomeApplicationException error = Assert.IsType<OutcomeApplicationException>(reentrant);
        Assert.Contains("while outcome reentrant-outcome is committing", error.Message, StringComparison.Ordinal);
        Assert.Equal(1_025, economy.Treasury);
        Assert.Single(outcomes.Snapshot().Transactions);
    }

    [Fact]
    public void WholeTransactionValidationAndAffordabilityPreventPartialConsequences()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateHarness();
        var invalid = FullTransaction(
            transactionId: "invalid-late-command",
            commands:
            [
                new CapitalAdjustedCommand(500),
                new ServiceOutageSetCommand("bad", "internet"),
            ]);
        Assert.Throws<ArgumentOutOfRangeException>(() => outcomes.Apply(invalid));
        Assert.Equal(1_000, economy.Treasury);
        Assert.Equal(0, outcomes.Snapshot().Revision);

        var unaffordable = FullTransaction(
            transactionId: "unaffordable",
            commands:
            [
                new CapitalAdjustedCommand(-1_001),
                new AuthoredFlagSetCommand("should.not.exist", OutcomeValues.From(true)),
            ]);
        Assert.Throws<OutcomeApplicationException>(() => outcomes.Apply(unaffordable));
        Assert.Equal(1_000, economy.Treasury);
        Assert.False(outcomes.Snapshot().State.Flags.ContainsKey("should.not.exist"));
    }

    [Fact]
    public void AuthoredIdsAndCommandIdsFailClosed()
    {
        (_, MissionOutcomeService outcomes) = CreateHarness();
        Assert.Throws<ArgumentOutOfRangeException>(() => outcomes.Apply(FullTransaction(
            transactionId: "unknown-faction",
            commands: [new FactionReputationAdjustedCommand("REMOVED", 1)])));
        Assert.Throws<ArgumentOutOfRangeException>(() => outcomes.Apply(FullTransaction(
            transactionId: "unknown-district",
            commands: [new TrafficSetCommand("road", "ATLANTIS", CommandId: "same")])));
        Assert.Throws<InvalidOperationException>(() => outcomes.Apply(FullTransaction(
            transactionId: "duplicate-command-id",
            commands:
            [
                new UnlockSetCommand("one", CommandId: "same"),
                new UnlockSetCommand("two", CommandId: "same"),
            ])));
    }

    [Fact]
    public void ResolutionAndFactionBoundsRecordExplicitBeforeAndAfter()
    {
        (_, MissionOutcomeService outcomes) = CreateHarness();
        outcomes.Apply(FullTransaction());
        MissionOutcomeReceipt receipt = outcomes.Apply(new MissionOutcomeTransaction(
            "mission:bridge-response:cleanup",
            new OutcomeSource(OutcomeSourceKinds.System, "incident-cleanup", "RESOLVED"),
            [
                new IncidentResolvedCommand("bridge-collision-1"),
                new FactionReputationAdjustedCommand("RESIDENTS", 500),
            ],
            new OutcomeSummary("Bridge cleanup", "Cleanup crews cleared the collision.")));

        Assert.False(outcomes.Snapshot().State.Incidents["bridge-collision-1"].Active);
        Assert.Equal(100, outcomes.Snapshot().State.Factions["RESIDENTS"]);
        Assert.True(receipt.Effects[0].Before!.Value.GetProperty("active").GetBoolean());
        Assert.False(receipt.Effects[0].After!.Value.GetProperty("active").GetBoolean());
        Assert.Equal(12, receipt.Effects[1].Before!.Value.GetDouble());
        Assert.Equal(100, receipt.Effects[1].After!.Value.GetDouble());
    }

    [Fact]
    public void StateRoundTripsWithoutReplayingCapitalAndRejectsCorruptionAtomically()
    {
        (EconomyLedger economy, MissionOutcomeService outcomes) = CreateHarness();
        outcomes.Apply(FullTransaction());
        MissionOutcomeStateDocument document = outcomes.Serialize();
        MissionOutcomeService.ValidateState(document, economy, GameContentRegistry.LoadProduction());
        string json = JsonSerializer.Serialize(document, JsonOptions);
        MissionOutcomeStateDocument decoded = JsonSerializer.Deserialize<MissionOutcomeStateDocument>(json, JsonOptions)!;

        var restored = new MissionOutcomeService(economy, GameContentRegistry.LoadProduction());
        restored.Restore(decoded);
        AssertJsonEqual(document, restored.Serialize());
        Assert.IsType<List<MissionOutcomeReceipt>>(decoded.Transactions).Clear();
        Assert.Equal(1_250, economy.Treasury);
        Assert.True(restored.HasApplied("mission:bridge-response:run-1:success"));

        MissionOutcomeState corruptState = document.State with
        {
            Progression = new Dictionary<string, bool> { ["REMOVED_TIER"] = true },
        };
        Assert.Throws<ArgumentOutOfRangeException>(() => restored.Restore(document with { State = corruptState }));
        Assert.True(restored.HasApplied("mission:bridge-response:run-1:success"));
        MissionOutcomeStateDocument empty = MissionOutcomeService.CreateEmptyState(
            new Dictionary<string, double> { ["RESIDENTS"] = 3 },
            new Dictionary<string, bool> { ["OPERATOR"] = true });
        MissionOutcomeService.ValidateState(empty, content: GameContentRegistry.LoadProduction());
    }

    [Fact]
    public void MissionCompletionAdapterRetainsDuplicateRewardProtection()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(content.EconomyBalance, 0, 0);
        var mission = new EconomyMissionCompletionInput("courier-1", NarrativeProgressDelta: 2);

        Assert.True(economy.RecordMissionCompletion(mission, 250, satisfaction: 84));
        EconomyMissionCompletion completion = Assert.Single(economy.Snapshot().CompletedMissions);
        Assert.Equal(250, economy.Treasury);
        Assert.Equal("courier-1", completion.Id);
        Assert.Equal(84, completion.Satisfaction);
        Assert.Equal(2, completion.NarrativeProgressDelta);
        Assert.False(economy.RecordMissionCompletion(mission, 999));
        Assert.Equal(250, economy.Treasury);
    }

    private static (EconomyLedger Economy, MissionOutcomeService Outcomes) CreateHarness()
    {
        GameContentRegistry content = GameContentRegistry.LoadProduction();
        var economy = new EconomyLedger(
            content.EconomyBalance,
            1_000,
            0,
            services: new EconomyBaseServices
            {
                Power = new EconomyServiceBase(100, 100),
                Water = new EconomyServiceBase(100, 100),
                Fire = new EconomyServiceBase(100, 100),
            });
        economy.RegisterBuilding(new EconomyBuilding("bridge-operations"));
        return (economy, new MissionOutcomeService(economy, content));
    }

    private static MissionOutcomeTransaction FullTransaction(
        string transactionId = "mission:bridge-response:run-1:success",
        IReadOnlyList<OutcomeCommand>? commands = null) => new(
            transactionId,
            new OutcomeSource(
                OutcomeSourceKinds.Mission,
                "mission_executive",
                "SUCCESS",
                "run-1",
                "player",
                "The emergency lane was restored before rush hour."),
            commands ??
            [
                new CapitalAdjustedCommand(250, Reason: "Emergency contract payment."),
                new BuildingStateSetCommand("bridge-operations", "DAMAGED", false),
                new InfrastructureStateSetCommand(
                    "primary-bridge", "DEGRADED", "PRIMARY_BRIDGE_CORRIDOR",
                    AccessStates.Restricted, 0.65, 0.72),
                new IncidentRecordedCommand(
                    "bridge-collision-1", "TRAFFIC_COLLISION", "PRIMARY_BRIDGE_CORRIDOR", 4,
                    -2, -5, new OutcomePosition(220, 0), 80),
                new RepairSetCommand("primary-bridge", RepairStatuses.Scheduled, EstimatedCost: 400),
                new ServiceOutageSetCommand(
                    "bridge-power-outage", ServiceTypes.Power, "PRIMARY_BRIDGE_CORRIDOR",
                    Severity: 0.5, CoverageMultiplier: 0.6),
                new TrafficSetCommand(
                    "primary-bridge", "PRIMARY_BRIDGE_CORRIDOR", 1.4,
                    AccessStates.Restricted, 0.8, 0.35),
                new FactionReputationAdjustedCommand("RESIDENTS", 12),
                new ProgressionSetCommand("OPERATOR"),
                new UnlockSetCommand("bridge-emergency-lane"),
                new NewsPublishedCommand(
                    "news-bridge-response", "Emergency lane restored",
                    "Crews reopened one bridge lane before the evening peak.", 2),
                new FollowUpMissionSetCommand("mission_scientist"),
                new AuthoredFlagSetCommand("bridge.response.success", OutcomeValues.From(true)),
            ],
            new OutcomeSummary(
                "Bridge response succeeded",
                "Rapid response restored access and public confidence."));

    private static void AssertJsonEqual(object expected, object actual)
    {
        JsonNode? expectedNode = JsonSerializer.SerializeToNode(expected, JsonOptions);
        JsonNode? actualNode = JsonSerializer.SerializeToNode(actual, JsonOptions);
        Assert.True(JsonNode.DeepEquals(expectedNode, actualNode), $"Expected {expectedNode}; actual {actualNode}");
    }
}
