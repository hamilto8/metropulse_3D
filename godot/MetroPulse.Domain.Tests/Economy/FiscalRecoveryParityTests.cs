using MetroPulse.Domain.Alerts;
using MetroPulse.Domain.Content;
using MetroPulse.Domain.Economy;
using Xunit;

namespace MetroPulse.Domain.Tests.Economy;

public sealed class FiscalRecoveryParityTests
{
    [Fact]
    public void RunwayAssistanceRestrictionsAndRecoveryExitMatchBrowserScenario()
    {
        EconomyLedger economy = Create(10);
        economy.RegisterBuilding(new EconomyBuilding("cost-center", operatingCostRate: 1));

        Assert.Equal(FiscalStates.Deficit, economy.Snapshot().FiscalStatus);
        Assert.Equal(1d / 6, economy.Snapshot().Fiscal.RunwayMinutes);
        Assert.Equal("The city is drawing down reserves with about 1 minutes of runway.", economy.Snapshot().Fiscal.Explanation);
        economy.Update(10);
        Assert.Equal(FiscalStates.Insolvent, economy.Snapshot().FiscalStatus);
        Assert.True(economy.Snapshot().Fiscal.AssistanceEligible);

        EconomyAssistanceReceipt assistance = economy.RequestEmergencyAssistance();
        Assert.True(assistance.Granted);
        Assert.Equal(100_000, assistance.Amount);
        Assert.Equal(FiscalStates.Recovery, economy.Snapshot().FiscalStatus);
        Assert.True(economy.Snapshot().Fiscal.RestrictionsActive);
        SpendingDecision optional = economy.EvaluateSpending(2_500, new SpendingContext { Source = "zoning" });
        Assert.False(optional.Allowed);
        Assert.Equal("RECOVERY_RESTRICTION", optional.Code);
        Assert.False(economy.Spend(2_500, new SpendingContext { Source = "zoning" }));
        Assert.True(economy.Spend(1_000, new SpendingContext { Source = "incident-response" }));

        economy.RemoveBuilding("cost-center");
        Assert.Equal(FiscalStates.Stable, economy.Snapshot().FiscalStatus);
        Assert.Equal(1, economy.Snapshot().Fiscal.Recovery.CompletedRecoveries);
    }

    [Fact]
    public void ReserveRulePermitsOnlyCashPositiveRecoveryInvestment()
    {
        EconomyLedger economy = Create(30_000);
        economy.RegisterBuilding(new EconomyBuilding("upkeep", operatingCostRate: 1));

        SpendingDecision risky = economy.EvaluateSpending(10_000, new SpendingContext { Source = "zoning" });
        Assert.False(risky.Allowed);
        Assert.Equal("RESERVE_AT_RISK", risky.Code);
        Assert.Contains("25,000", risky.Remedy, StringComparison.Ordinal);

        economy.Update(30_000);
        Assert.Equal(0, economy.Treasury);
        Assert.True(economy.RequestEmergencyAssistance().Granted);
        SpendingDecision investment = economy.EvaluateSpending(50_000, new SpendingContext
        {
            Source = "building-placement",
            ProjectedNetRateDelta = 2,
        });
        Assert.True(investment.Allowed);
        Assert.True(investment.RecoveryInvestment);
    }

    [Fact]
    public void AssistanceIsIdempotentUntilThePriorGrantIsExhausted()
    {
        EconomyLedger economy = Create(1);
        economy.RegisterBuilding(new EconomyBuilding("upkeep", operatingCostRate: 10));
        economy.Update(1);

        Assert.True(economy.RequestEmergencyAssistance().Granted);
        Assert.False(economy.RequestEmergencyAssistance().Granted);
        economy.Update(20_000);
        Assert.Equal(0, economy.Treasury);
        Assert.True(economy.RequestEmergencyAssistance().Granted);
        Assert.Equal(2, economy.Snapshot().Fiscal.Recovery.AssistanceClaims);
    }

    [Fact]
    public void BoundedFineAndFiscalAlertMatchBrowserOutputs()
    {
        EconomyBalanceDefinition balance = GameContentRegistry.LoadProduction().EconomyBalance;
        Assert.Equal(25_000, EconomyPolicy.CalculateBoundedFine(60_000, 500_000, balance));
        Assert.Equal(2_000, EconomyPolicy.CalculateBoundedFine(60_000, 20_000, balance));
        EconomyLedger economy = Create(20_000);
        Assert.Equal(new FineReceipt(60_000, 2_000, true), economy.ApplyFine(60_000, referenceId: "traffic-violation"));
        Assert.Equal(18_000, economy.Treasury);

        EconomyLedger stressed = Create(5);
        var alerts = new AlertService();
        using var adapter = new EconomyAlertAdapter(stressed, alerts);
        stressed.RegisterBuilding(new EconomyBuilding("upkeep", operatingCostRate: 1));
        AlertRecord warning = Assert.Single(alerts.Snapshot().Active);
        Assert.Equal(AlertSeverities.Warning, warning.Severity);
        Assert.Contains("runway", warning.Cause, StringComparison.OrdinalIgnoreCase);
        stressed.Update(5);
        AlertRecord critical = Assert.Single(alerts.Snapshot().Active);
        Assert.Equal(AlertSeverities.Critical, critical.Severity);
        Assert.Contains("stabilization grant", critical.Recommendation, StringComparison.OrdinalIgnoreCase);
        stressed.RequestEmergencyAssistance();
        Assert.Single(alerts.Snapshot().Active);
        stressed.RemoveBuilding("upkeep");
        Assert.Empty(alerts.Snapshot().Active);
    }

    private static EconomyLedger Create(double treasury) => new(
        GameContentRegistry.LoadProduction().EconomyBalance,
        treasury,
        0);
}
