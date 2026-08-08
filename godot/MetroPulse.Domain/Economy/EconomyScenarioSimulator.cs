using MetroPulse.Domain.Content;

namespace MetroPulse.Domain.Economy;

public static class EconomyScenarioActions
{
    public const string Build = "BUILD";
    public const string Fine = "FINE";
    public const string Mission = "MISSION";
    public const string Spend = "SPEND";
}

public sealed record EconomyScenarioEvent(
    double Minute,
    string Type,
    string Id,
    double Amount = 0,
    double IncomePerMinute = 0,
    string Source = "manual");

public sealed record EconomyScenarioTransaction(
    double Minute,
    string Type,
    string Id,
    double Treasury,
    string FiscalStatus);

public sealed record EconomyScenarioResult(
    double DurationMinutes,
    EconomyLedgerSnapshot Snapshot,
    int AssetCount,
    int MissionCount,
    IReadOnlyList<EconomyScenarioTransaction> Transactions);

public static class EconomyScenarioSimulator
{
    public static readonly IReadOnlyList<EconomyScenarioEvent> BalancedSessionEvents = Array.AsReadOnly(new EconomyScenarioEvent[]
    {
        new(5, EconomyScenarioActions.Build, "CYBERCAFE", Amount: 200_000, IncomePerMinute: 2_400),
        new(10, EconomyScenarioActions.Mission, "session-contract-1", Amount: 45_000),
        new(25, EconomyScenarioActions.Build, "METRO_LOFTS", Amount: 350_000, IncomePerMinute: 1_900),
        new(30, EconomyScenarioActions.Mission, "session-contract-2", Amount: 52_000),
        new(45, EconomyScenarioActions.Spend, "incident-response-1", Amount: 6_000, Source: "incident-response"),
        new(50, EconomyScenarioActions.Mission, "session-contract-3", Amount: 68_000),
        new(70, EconomyScenarioActions.Build, "SOLAR_GRID", Amount: 280_000, IncomePerMinute: -450),
        new(75, EconomyScenarioActions.Mission, "session-contract-4", Amount: 75_000),
        new(90, EconomyScenarioActions.Mission, "session-contract-5", Amount: 85_000),
        new(105, EconomyScenarioActions.Fine, "session-fine-1", Amount: 60_000),
        new(110, EconomyScenarioActions.Build, "CYBER_FAB", Amount: 390_000, IncomePerMinute: 6_200),
    });

    public static EconomyScenarioResult RunBalancedSession(double durationMinutes)
    {
        EconomyBalanceDefinition balance = GameContentRegistry.LoadProduction().EconomyBalance;
        return Run(
            durationMinutes,
            BalancedSessionEvents,
            balance,
            balance.StartingTreasury,
            balance.BaseRevenuePerSecond);
    }

    public static EconomyScenarioResult Run(
        double durationMinutes,
        IEnumerable<EconomyScenarioEvent> events,
        EconomyBalanceDefinition balance,
        double initialTreasury,
        double passiveIncomeRate)
    {
        if (!double.IsFinite(durationMinutes) || durationMinutes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(durationMinutes));
        }
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(balance);

        EconomyScenarioEvent[] materializedEvents = events.ToArray();
        for (int index = 0; index < materializedEvents.Length; index += 1)
        {
            EconomyScenarioEvent scenarioEvent = materializedEvents[index]
                ?? throw new ArgumentException($"Scenario event {index} is required.", nameof(events));
            if (!double.IsFinite(scenarioEvent.Minute) || scenarioEvent.Minute < 0)
            {
                throw new ArgumentException(
                    $"Scenario event {index} requires a non-negative finite minute.",
                    nameof(events));
            }
        }

        var ledger = new EconomyLedger(balance, initialTreasury, passiveIncomeRate);
        var transactions = new List<EconomyScenarioTransaction>();
        double elapsedMinutes = 0;
        IEnumerable<EconomyScenarioEvent> ordered = materializedEvents
            .Select((scenarioEvent, index) => (Event: scenarioEvent, Index: index))
            .Where(item => item.Event.Minute <= durationMinutes)
            .OrderBy(item => item.Event.Minute)
            .ThenBy(item => item.Index)
            .Select(item => item.Event);

        foreach (EconomyScenarioEvent scenarioEvent in ordered)
        {
            ledger.Update((scenarioEvent.Minute - elapsedMinutes) * 60);
            ApplyEvent(ledger, scenarioEvent);
            elapsedMinutes = scenarioEvent.Minute;
            transactions.Add(new EconomyScenarioTransaction(
                scenarioEvent.Minute,
                scenarioEvent.Type,
                scenarioEvent.Id,
                ledger.Treasury,
                ledger.GetFiscalOverview().Status));
        }

        ledger.Update((durationMinutes - elapsedMinutes) * 60);
        EconomyLedgerSnapshot snapshot = ledger.Snapshot();
        return new EconomyScenarioResult(
            durationMinutes,
            snapshot,
            snapshot.Buildings.Count,
            snapshot.CompletedMissions.Count,
            Array.AsReadOnly(transactions.ToArray()));
    }

    private static void ApplyEvent(EconomyLedger ledger, EconomyScenarioEvent scenarioEvent)
    {
        switch (scenarioEvent.Type)
        {
            case EconomyScenarioActions.Build:
                {
                    var spec = new EconomyInvestmentSpec { IncomePerMinute = scenarioEvent.IncomePerMinute };
                    bool funded = ledger.Spend(scenarioEvent.Amount, new SpendingContext
                    {
                        Source = "building-placement",
                        ReferenceId = scenarioEvent.Id,
                        Spec = spec,
                    });
                    if (!funded)
                    {
                        throw new InvalidOperationException(
                            $"Scenario could not fund {scenarioEvent.Id} at minute {scenarioEvent.Minute}.");
                    }
                    ledger.RegisterBuilding(new EconomyBuilding(
                        $"scenario:{scenarioEvent.Id}",
                        Math.Max(0, scenarioEvent.IncomePerMinute) / 60,
                        Math.Max(0, -scenarioEvent.IncomePerMinute) / 60));
                    return;
                }
            case EconomyScenarioActions.Mission:
                ledger.CompleteMission(scenarioEvent.Id, scenarioEvent.Amount);
                return;
            case EconomyScenarioActions.Fine:
                ledger.ApplyFine(scenarioEvent.Amount, referenceId: scenarioEvent.Id);
                return;
            case EconomyScenarioActions.Spend:
                if (!ledger.Spend(scenarioEvent.Amount, new SpendingContext
                {
                    Source = scenarioEvent.Source,
                    ReferenceId = scenarioEvent.Id,
                }))
                {
                    throw new InvalidOperationException(
                        $"Scenario debit {scenarioEvent.Id} was rejected at minute {scenarioEvent.Minute}.");
                }
                return;
            default:
                throw new ArgumentOutOfRangeException(
                    nameof(scenarioEvent),
                    scenarioEvent.Type,
                    "Unsupported economy scenario action.");
        }
    }
}
