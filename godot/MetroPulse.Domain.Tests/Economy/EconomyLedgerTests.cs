using System.Text.Json;
using System.Text.Json.Nodes;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using Xunit;

namespace MetroPulse.Domain.Tests.Economy;

public sealed class EconomyLedgerTests
{
    private static readonly JsonSerializerOptions JsonOptions = new();

    [Fact]
    public void SpendingPolicyMatchesEveryFrozenDecision()
    {
        EconomyBalanceDefinition balance = ProductionBalance();
        JsonElement decisions = ReadFixtureData().GetProperty("spendingDecisions");

        SpendingDecision affordableEssential = EconomyPolicy.EvaluateSpending(
            30_000,
            0,
            false,
            6_000,
            new SpendingContext { Source = "incident-response" },
            balance);
        SpendingDecision insufficientCapital = EconomyPolicy.EvaluateSpending(
            30_000,
            0,
            false,
            40_000,
            new SpendingContext { Source = "building-placement" },
            balance);
        SpendingDecision reserveAtRisk = EconomyPolicy.EvaluateSpending(
            30_000,
            0,
            false,
            10_000,
            new SpendingContext { RecurringCostRate = 2 },
            balance);

        AssertJsonEqual(decisions.GetProperty("affordableEssential"), affordableEssential);
        AssertJsonEqual(decisions.GetProperty("insufficientCapital"), insufficientCapital);
        AssertJsonEqual(decisions.GetProperty("reserveAtRisk"), reserveAtRisk);
    }

    [Fact]
    public void BalancedSessionsMatchEveryFrozenTransactionAndSummary()
    {
        JsonElement scenarios = ReadFixtureData().GetProperty("scenarios");

        foreach (string minutes in new[] { "15", "30", "60", "120" })
        {
            JsonElement expected = scenarios.GetProperty(minutes);
            EconomyScenarioResult actual = EconomyScenarioSimulator.RunBalancedSession(double.Parse(minutes));
            JsonElement expectedSnapshot = expected.GetProperty("snapshot");

            Assert.Equal(expected.GetProperty("durationMinutes").GetDouble(), actual.DurationMinutes);
            Assert.Equal(expected.GetProperty("assetCount").GetInt32(), actual.AssetCount);
            Assert.Equal(expected.GetProperty("missionCount").GetInt32(), actual.MissionCount);
            Assert.Equal(expectedSnapshot.GetProperty("treasury").GetDouble(), actual.Snapshot.Treasury);
            Assert.Equal(
                expectedSnapshot.GetProperty("passiveIncomeRate").GetDouble(),
                actual.Snapshot.PassiveIncomeRate);
            Assert.Equal(
                expectedSnapshot.GetProperty("operatingCostRate").GetDouble(),
                actual.Snapshot.OperatingCostRate);
            Assert.Equal(expectedSnapshot.GetProperty("fiscalStatus").GetString(), actual.Snapshot.FiscalStatus);

            JsonElement expectedTransactions = expected.GetProperty("transactions");
            Assert.Equal(expectedTransactions.GetArrayLength(), actual.Transactions.Count);
            for (int index = 0; index < actual.Transactions.Count; index += 1)
            {
                JsonElement expectedTransaction = expectedTransactions[index];
                EconomyScenarioTransaction actualTransaction = actual.Transactions[index];
                Assert.Equal(expectedTransaction.GetProperty("minute").GetDouble(), actualTransaction.Minute);
                Assert.Equal(expectedTransaction.GetProperty("type").GetString(), actualTransaction.Type);
                Assert.Equal(expectedTransaction.GetProperty("id").GetString(), actualTransaction.Id);
                Assert.Equal(expectedTransaction.GetProperty("treasury").GetDouble(), actualTransaction.Treasury);
                Assert.Equal(
                    expectedTransaction.GetProperty("fiscalStatus").GetString(),
                    actualTransaction.FiscalStatus);
            }
        }
    }

    [Fact]
    public void TransactionsAreAtomicAndMissionRewardsCannotRepeat()
    {
        var ledger = new EconomyLedger(ProductionBalance(), 100, 0);

        Assert.Equal(120, ledger.Earn(20, "contract"));
        Assert.Equal(1, ledger.Revision);

        Assert.False(ledger.Spend(121));
        Assert.Equal(120, ledger.Treasury);
        Assert.Equal(1, ledger.Revision);

        Assert.True(ledger.Spend(20, new SpendingContext { Source = "incident-response" }));
        Assert.True(ledger.CompleteMission("mission-1", 50, 2, 3));
        EconomyLedgerSnapshot completed = ledger.Snapshot();
        Assert.Equal(150, completed.Treasury);
        Assert.Equal(2, completed.NarrativeProgress);
        Assert.Equal(3, completed.Reputation);
        Assert.Equal(3, completed.Revision);

        Assert.False(ledger.CompleteMission("mission-1", 999));
        EconomyLedgerSnapshot afterDuplicate = ledger.Snapshot();
        Assert.Equal(completed.Revision, afterDuplicate.Revision);
        Assert.Equal(completed.Treasury, afterDuplicate.Treasury);
        Assert.Equal(completed.NarrativeProgress, afterDuplicate.NarrativeProgress);
        Assert.Equal(completed.Reputation, afterDuplicate.Reputation);
        Assert.Equal(completed.CompletedMissions.ToArray(), afterDuplicate.CompletedMissions.ToArray());
    }

    [Fact]
    public void DeficitsClampAtZeroAndRecoveryHasAReachableExit()
    {
        var ledger = new EconomyLedger(ProductionBalance(), 100, 0);
        ledger.RegisterBuilding(new EconomyBuilding("cost-center", OperatingCostRate: 2));

        Assert.Equal(-100, ledger.Update(100));
        Assert.Equal(0, ledger.Treasury);
        Assert.Equal(FiscalStates.Insolvent, ledger.GetFiscalOverview().Status);

        EconomyAssistanceReceipt assistance = ledger.RequestEmergencyAssistance();
        Assert.True(assistance.Granted);
        Assert.Equal(100_000, assistance.Amount);
        Assert.True(ledger.Recovery.Active);
        Assert.Equal(FiscalStates.Recovery, ledger.GetFiscalOverview().Status);

        Assert.False(ledger.Spend(1, new SpendingContext { Source = "building-placement" }));
        Assert.True(ledger.EvaluateSpending(1, new SpendingContext
        {
            Source = "building-placement",
            ProjectedNetRateDelta = 2,
        }).Allowed);

        Assert.NotNull(ledger.RemoveBuilding("cost-center"));
        Assert.False(ledger.Recovery.Active);
        Assert.Equal(1, ledger.Recovery.CompletedRecoveries);
        Assert.Equal(FiscalStates.Stable, ledger.GetFiscalOverview().Status);
    }

    [Fact]
    public void BoundedFinesAndListenerFailuresCannotBreakAuthorityState()
    {
        var ledger = new EconomyLedger(ProductionBalance(), 100_000, 0);
        int observed = 0;
        ledger.Subscribe(_ => throw new InvalidOperationException("adapter failure"));
        Func<bool> unsubscribe = ledger.Subscribe(_ => observed += 1);

        FineReceipt receipt = ledger.ApplyFine(60_000, referenceId: "fine-1");
        Assert.Equal(new FineReceipt(60_000, 10_000, true), receipt);
        Assert.Equal(90_000, ledger.Treasury);
        Assert.Equal(1, observed);
        Assert.True(unsubscribe());
        Assert.False(unsubscribe());

        ledger.Earn(1);
        Assert.Equal(90_001, ledger.Treasury);
        Assert.Equal(1, observed);
    }

    private static EconomyBalanceDefinition ProductionBalance() =>
        GameContentRegistry.LoadProduction().EconomyBalance;

    private static JsonElement ReadFixtureData()
    {
        using JsonDocument fixture = JsonDocument.Parse(FixtureReader.Read("economy.json"));
        return fixture.RootElement.GetProperty("data").Clone();
    }

    private static void AssertJsonEqual(JsonElement expected, object actual)
    {
        JsonNode? expectedNode = JsonNode.Parse(expected.GetRawText());
        JsonNode? actualNode = JsonSerializer.SerializeToNode(actual, JsonOptions);
        Assert.True(JsonNode.DeepEquals(expectedNode, actualNode), $"Expected {expectedNode}; actual {actualNode}");
    }
}
